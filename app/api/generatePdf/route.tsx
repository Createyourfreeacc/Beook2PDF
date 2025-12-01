//first get all resources neccessary
//second stitch together the content
//third load content and convert to pdf

import { NextRequest, NextResponse } from 'next/server';
import sqlite from 'better-sqlite3';
import puppeteer from 'puppeteer';
import { PDFDocument, PDFName, PDFString, PDFArray, PDFNull, PDFDict, PDFRef, PDFNumber } from 'pdf-lib';
import { setProgress, setPhaseProgress } from '@/lib/progressStore';
import { getResolvedPaths } from '@/lib/config';

const { dbPath: DB_PATH } = getResolvedPaths();

type Book = {
  BookID: string;
  Titel: string;
  CourseName: string;
  Refrence: string;
  Issue: number[];
  Toggled: boolean;
};

interface TOCItem {
  title: string;
  page: number;
  level: number;
}

interface TOCData {
  zpk: number;
  title: string;
  pagenum: number;
  chapterSection: string;
  zOrder: number;
  zIssue: number;
  zLevel: number;
}

export async function GET(request: NextRequest) {
  const searchParams = new URL(request.url).searchParams;
  const jobId = searchParams.get('jobId') || 'default';
  const booksParam = searchParams.get('books');

  if (!booksParam) {
    return NextResponse.json({ error: 'Missing ID parameter' }, { status: 400 });
  }

  const books: Book[] = JSON.parse(booksParam);

  try {
    const allData: Record<string, any> = {};

    let offset = 0;
    const limit = 300;
    let hasMore = true;

    // Flatten all allowed issue numbers
    const allowedIssues = books
      .filter(book => book.Toggled)     // only books that are toggled on
      .flatMap(book => book.Issue)      // flatten all Issue arrays
      .join(',');

    // Guard against empty array
    const zissueCondition = allowedIssues.length > 0
      ? `AND "ZISSUE" IN (${allowedIssues})`
      : '';

    setPhaseProgress(jobId, 'init', 0.5);
    await new Promise(res => setImmediate(res))
    const maxZPk = await getMaxZPk();
    setPhaseProgress(jobId, 'init', 1);
    await new Promise(res => setImmediate(res))

    // Fetch all data using pagination
    while (hasMore) {
      const result = await fetchPaginatedData(offset, limit, maxZPk, zissueCondition);

      // Merge the data from this page
      Object.assign(allData, result.data);

      // Check if there's more data
      hasMore = result.pagination.hasMore;
      offset += limit;
      setPhaseProgress(jobId, 'fetch', Math.min(offset / maxZPk, 1));
      await new Promise(res => setImmediate(res))
    }

    setPhaseProgress(jobId, 'process', 0);
    await new Promise(res => setImmediate(res))
    const dataMap: Record<string, { Z_PK: number; ZDATA: any; ZTOPIC: number; ZMEDIATYPE: string; ZISSUE: string }> = allData;
    const htmlPages = await modifyContent(books, dataMap, jobId);

    setPhaseProgress(jobId, 'convert', 0);
    await new Promise(res => setImmediate(res))
    const mergedPdfBytes = await generateMergedPdf(books, htmlPages, jobId);

    setPhaseProgress(jobId, 'finalize', 1);
    await new Promise(res => setImmediate(res))
    return new Response(mergedPdfBytes, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename=book.pdf',
      },
    });
  } catch (error) {
    console.error('PDF generation failed:', error);
    setProgress(jobId, 0);
    return new Response(JSON.stringify({ error: 'Failed to generate PDF' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

export async function getMaxZPk(): Promise<number> {
  const db = sqlite(DB_PATH);

  const maxZPkSql = `SELECT COUNT(*) as maxZPk FROM ZILPRESOURCE WHERE Z_PK IS NOT NULL`;
  const maxZPkResult = db.prepare(maxZPkSql).get() as { maxZPk: number };

  db.close();

  return maxZPkResult.maxZPk;
}

export async function modifyContent(books: Book[], dataMap: Record<string, { Z_PK: number; ZDATA: any; ZTOPIC: number; ZMEDIATYPE: string; ZISSUE: string }>, jobId: string): Promise<string[]> {
  const htmlPages: string[] = [];
  const sortedEntries: {
    zpk: string;
    ZDATA: any;
    ZTOPIC: number;
    ZMEDIATYPE: string;
    ZISSUE: string;
  }[] = [];

  // Convert the object values to an array and sort pages into correct order
  for (const book of books) {
    if (!book.Toggled) continue;

    for (const zissue of book.Issue) {
      const issueEntries = Object.entries(dataMap)
        .map(([zpk, values]) => ({ zpk, ...values }))
        .filter(entry => parseInt(entry.ZISSUE) === zissue)
        .sort((a, b) => a.ZTOPIC - b.ZTOPIC);

      sortedEntries.push(...issueEntries);
    }
  }

  // Fetch TOC Entries Dynamically & create TOC pages
  //TODO BUG: RIGHT NOW THE WRONG TOCS ARE PRINTED SHOWN ITS ALL A WORK IN PROGRESS
  const fetchTOCEntries = async () => {
    const entries = await getTOCData();

    const bookTOCs = await generateTOCHtml(books, entries);

    //TODO: ADD BOOK TOC WITHIN THE FIRST 20 pages(or between first zissue and first item of zissue number there is a page missing)
    // at the first page that is missing or at the very start of the book
    for (const toc of bookTOCs) {
      const tocHtml = toc.content;

      // Simple strategy: insert within the first 20 pages (or at index 0 if less)
      //const insertIndex = Math.min(20, htmlPages.length);
      //htmlPages.splice(insertIndex, 0, tocHtml);
      htmlPages.push(tocHtml);
    }
  };
  //TODO: Make beautiful and respect pdf bookmarks, then add back
  //fetchTOCEntries();

  const maxZtopic = Math.max(...Object.values(dataMap).map(entry => entry.ZTOPIC));

  for (const entry of sortedEntries) {
    const ztopic = entry.ZTOPIC;
    const zdata = entry.ZDATA;

    if (ztopic) {
      // Convert zdata to string if it's a Buffer/Uint8Array
      const fetchedHtml = zdata;

      // Process HTML to replace image sources with data URLs
      let processedHtml = fetchedHtml;
      const imgTags = fetchedHtml.match(/<img.*?src=".*?pk\/(\d+)".*?>/gm) || [];

      for (const imgTag of imgTags) {
        const match = imgTag.match(/src=".*?pk\/(\d+)"/);
        if (match && match[1]) {
          const imgId = match[1];

          // Check if we have the image data in our fetched data
          if (dataMap[imgId]?.ZDATA) {
            const imageData = dataMap[imgId].ZDATA;

            // Check if it's already a data URL (converted by getColumn API)
            if (imageData.startsWith('data:image/')) {
              const newImgTag = imgTag.replace(/src=".*?pk\/\d+"/, `src="${imageData}"`);
              processedHtml = processedHtml.replace(imgTag, newImgTag);
            }
          }
        }
      }

      // Extract CSS ID from HTML
      const htmlLines = processedHtml.split('\n');
      const linkTagLine = htmlLines[4];  // 5th line (0-based index is 4)
      const hrefMatch = linkTagLine.match(/href=".*\/(\d+)"/);
      const cssId = hrefMatch ? parseInt(hrefMatch[1]) : null;

      // Remove everything but the body
      const lines = processedHtml.split('\n');
      const modifiedHtml = lines.slice(6, -1).join('\n');

      // If CSS ID is valid, fetch the CSS; otherwise, set fetchedCss to empty string
      let fetchedCss = "";
      if (cssId !== null && dataMap[cssId]?.ZDATA) {
        fetchedCss = dataMap[cssId].ZDATA;
      }

      /* this is stuff for pagesize it replaces the body with a div so the body can be sized well (not complete needs change when stitching together)
      // fetchedCss: replace first occurrence of "body" with ".old-body {"
      fetchedCss = fetchedCss.replace(/\bbody\b/, '.old-body');

      // modifiedHtml: replace first <body> and last </body>
      const firstBodyIndex = modifiedHtml.indexOf('<body>');
      const lastBodyIndex = modifiedHtml.lastIndexOf('</body>');

      if (firstBodyIndex !== -1 && lastBodyIndex !== -1) {
        const beforeBody = modifiedHtml.slice(0, firstBodyIndex);
        const afterOpenBody = modifiedHtml.slice(firstBodyIndex + 6, lastBodyIndex); // skip '<body>'.length == 6
        const afterCloseBody = modifiedHtml.slice(lastBodyIndex + 7); // skip '</body>'.length == 7

        // Replace body tags
        modifiedHtml = `${beforeBody}<div class="old-body">${afterOpenBody}</div>${afterCloseBody}`;
      }*/

      const htmlWithCss = `
        <html>
            <head>
                <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
                <style>
                  ${fetchedCss}
                </style>
            </head>
            ${modifiedHtml}
        </html>
        `;

      htmlPages.push(htmlWithCss);

      setPhaseProgress(jobId, 'process', Math.min(ztopic / maxZtopic, 1));
      await new Promise(res => setImmediate(res))
    }
  };

  return htmlPages;
}

export async function generateMergedPdf(books: Book[], htmlPages: string[], jobId: string): Promise<Uint8Array> {
  const pageCount = htmlPages.length;

  if (!Array.isArray(htmlPages) || pageCount === 0) {
    throw new Error('Missing HTML pages');
  }

  const browser = await puppeteer.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    headless: true,
  });

  const pdfBuffers: Buffer[] = new Array(pageCount);
  const maxConcurrentProcesses = 20;
  let pagesProcessed = 0;
  
  const processPageBatch = async (startIndex: number) => {
    const page = await browser.newPage();
    await page.setViewport({ width: 2434, height: 3445 });

    for (let i = startIndex; i < Math.min(startIndex + maxConcurrentProcesses, pageCount); i++) {
      pdfBuffers[i] = await processPage(page, htmlPages[i], i);
      pagesProcessed++;
      setPhaseProgress(jobId, 'convert', Math.min(pagesProcessed / pageCount, 0.95));
    }

    await page.close();

  };

  const promises = [];
  for (let i = 0; i < pageCount; i += maxConcurrentProcesses) {
    promises.push(processPageBatch(i));
  }

  await Promise.all(promises);
  await browser.close();

  setPhaseProgress(jobId, 'convert', 1);
  const mergedPdfDoc = await PDFDocument.create();
  const pdfDocuments = await Promise.all(pdfBuffers.map(buffer => PDFDocument.load(buffer)));

  setPhaseProgress(jobId, 'merge', 0.3);
  for (const pdf of pdfDocuments) {
    const copiedPages = await mergedPdfDoc.copyPages(pdf, pdf.getPageIndices());
    copiedPages.forEach(page => {
      // Set dimensions BEFORE adding the page
      // TODO: This creates consistent page sizes but needs work to properly show the content
      //page.setMediaBox(0, 0, 2434, 3445);

      // Then add to merged document
      mergedPdfDoc.addPage(page);
    });
  }

  const entries = await getTOCData();
  //TODO: The page is wrong, especially if there are multiple books
  function extractPageNumbers(htmlPages: string[]): (number | null)[][] {
    const result: (number | null)[][] = [];
    let currentGroup: (number | null)[] = [];

    const getNumberFromHTML = (html: string): number | null => {
      const target = '<span class="pageInfo">';
      const startIndex = html.lastIndexOf(target);
      if (startIndex === -1) return null;

      const contentStart = startIndex + target.length;
      const endIndex = html.indexOf("</span>", contentStart);
      if (endIndex === -1) return null;

      const insideText = html.slice(contentStart, endIndex).trim();
      const numberMatch = insideText.match(/\d+/);
      return numberMatch ? parseInt(numberMatch[0], 10) : null;
    };

    let lastNumber: number | null = null;

    for (const html of htmlPages) {
      const pageNumber = getNumberFromHTML(html);

      if (
        lastNumber !== null &&
        pageNumber !== null &&
        pageNumber < lastNumber // break condition
      ) {
        result.push(currentGroup);
        currentGroup = [];
      }

      currentGroup.push(pageNumber);
      if (pageNumber !== null) {
        lastNumber = pageNumber;
      }
    }

    // Push the last group if it has any elements
    if (currentGroup.length > 0) {
      result.push(currentGroup);
    }

    return result;
  }
  const pageNum = extractPageNumbers(htmlPages);
  const tocOutline = await generateTOCOutline(books, entries, pageNum);

  //TODO: REMOVE DEBUG MSG
  //console.log(pageNum);
  /*   tocOutline.forEach((item, index) => {
      console.log(item);
    }); */

  const PdfDoc = await mergeWithOutlines(mergedPdfDoc, tocOutline);

  setPhaseProgress(jobId, 'merge', 1);
  return await PdfDoc.save();
}

async function processPage(page: puppeteer.Page, htmlContent: string, index: number): Promise<Buffer> {
  try {
    await page.setContent(htmlContent, {
      waitUntil: ['domcontentloaded', 'load'],
    });

    // Measure content dimensions
    const dimensions = await page.evaluate(() => {
      const body = document.body;
      return {
        width: Math.max(body.scrollWidth, body.offsetWidth),
        height: Math.max(body.scrollHeight, body.offsetHeight),
      };
    });

    // Generate PDF with exact content dimensions
    const pdf = await page.pdf({
      width: dimensions.width,
      height: dimensions.height,
      //width: '2434px',
      //height: '3445px',
      printBackground: true,
      margin: { top: 72, right: 72, bottom: 72, left: 72 },
      //margin: { top: 0, right: 0, bottom: 0, left: 0 }, // optional: remove default margins
    });

    return Buffer.from(pdf);
  } catch (error) {
    console.error('Error:', error);
    throw new Error('Failed');
  }
}

const TABLE = "ZILPRESOURCE";
const INDEX_COL = "Z_PK";
const COL_NAME_MAP = ["ZDATA", "ZTOPIC", "Z_PK", "ZMEDIATYPE", "ZISSUE"];

export async function fetchPaginatedData(offset: number, limit: number, maxZPk: number, zissueCondition: string): Promise<{
  data: Record<string, { ZDATA: any; ZTOPIC: number }>;
  pagination: { total: number; limit: number; offset: number; hasMore: boolean };
}> {
  const allColumns = [INDEX_COL, ...COL_NAME_MAP];

  try {
    const db = sqlite(DB_PATH);

    const sql = `
      SELECT ${allColumns.map(col => `"${col}"`).join(', ')}
      FROM "${TABLE}"
      WHERE "${INDEX_COL}" IS NOT NULL
      ${zissueCondition}
      LIMIT ${limit} OFFSET ${offset}
    `;

    const statement = db.prepare(sql);
    const rows = statement.all();

    const resultMap: Record<string, Record<string, any>> = {};

    rows.forEach(row => {
      const key = row[INDEX_COL];
      const value: Record<string, any> = {};

      COL_NAME_MAP.forEach(col => {
        if (col === 'ZDATA' && row['ZMEDIATYPE'] === 'image/png') {
          // Handle image data - convert to base64
          const buffer = Buffer.from(row[col] as any);
          const base64Image = buffer.toString('base64');
          value[col] = `data:image/png;base64,${base64Image}`;
        } else {
          // Handle other data types as strings
          value[col] = row[col as string]?.toString() || '';
        }
      });

      resultMap[key] = value;
    });

    db.close();

    return {
      data: resultMap,
      pagination: {
        total: maxZPk,
        limit,
        offset,
        hasMore: offset + limit < maxZPk
      }
    };

  } catch (error) {
    console.error('Error querying database:', error);
    throw new Error('Failed to fetch data');
  }
}

async function generateTOCOutline(books: Book[], entries: TOCData[], pageNum: (number | null)[][]): Promise<TOCItem[]> {
  const tocOutline: TOCItem[] = [];

  //TODO: REMOVE DEBUG
  console.log(pageNum);

  function findGlobalPageIndexForPrintedNumber(
    bookNum: number,
    printedNum: number,
    pageNum: (number | null)[][]): number | null {
    // defensive checks
    if (printedNum == null) return null;
    const bookPages = pageNum?.[bookNum];
    if (!bookPages || bookPages.length === 0) return null;

    const target = Number(printedNum);
    if (Number.isNaN(target)) return null;

    // helper to find numeric index in bookPages
    const findNumericIndex = (val: number) =>
      bookPages.findIndex(p => p != null && Number(p) === val);

    // try exact match first
    let localIndex = findNumericIndex(target);

    // if not found, try common off-by-one alternatives
    if (localIndex === -1) localIndex = findNumericIndex(target - 1);
    if (localIndex === -1) localIndex = findNumericIndex(target + 1);

    if (localIndex === -1) return null;

    // sum lengths of all book arrays before bookNum to get the global offset
    let offset = 0;
    for (let i = 0; i < bookNum; i++) {
      const pagesForBook = pageNum?.[i];
      if (pagesForBook && pagesForBook.length) offset += pagesForBook.length;
    }

    // global zero-based page index
    return offset + localIndex;
  }

  books
    .filter(book => book.Toggled)
    .forEach((book, bookNum) => {
      // 1. Get only the entries relevant to this book
      const matchingEntries = entries.filter(entry =>
        book.Issue.includes(entry.zIssue)
      );

      // 2. Sort same as before
      matchingEntries.sort((a, b) => {
        if (a.zIssue !== b.zIssue) return a.zIssue - b.zIssue;
        if (a.pagenum !== b.pagenum) return a.pagenum - b.pagenum;
        if (a.zOrder !== b.zOrder) return a.zOrder - b.zOrder;
        return (a.chapterSection || '').localeCompare(b.chapterSection || '');
      });

      // 3. Create TOC items in the order of sorted entries
      let i = 0;
      while (i < matchingEntries.length) {
        const entry = matchingEntries[i];

        const startsBlock =
          entry.zLevel >= 2 &&
          i + 1 < matchingEntries.length &&
          matchingEntries[i + 1].zLevel >= entry.zLevel;

        if (startsBlock) {
          const currentZLevel = entry.zLevel;
          let j = i;

          while (
            j < matchingEntries.length &&
            matchingEntries[j].zLevel >= currentZLevel
          ) {
            // compute actual page for matchingEntries[j]
            const printed = matchingEntries[j].pagenum;
            const globalIndex = findGlobalPageIndexForPrintedNumber(bookNum, printed, pageNum);
            const actualPage = globalIndex !== null ? globalIndex : 0; // fallback to 0
            //TODO: REMOVE DEBUG
            console.log(printed);
            console.log(globalIndex, "  ", actualPage);
            // TODO: More testing required as it is still buggy. findGlobalPageIndexForPrintedNumber probably finds the correct pagenumber
            //       but the level 1s never account for not being the first book. Also, not beeing the first book might send the user to one
            //       page before the right page, subsequent books may be even more of, maybe 0 index bug.
            //       Also, did not work with all my books, why, idk.
            tocOutline.push({
              title: `${matchingEntries[j].chapterSection} ${matchingEntries[j].title}`.trim(),
              page: actualPage, // zero-based page index
              level: matchingEntries[j].zLevel,
            });

            const next = matchingEntries[j + 1];
            if (!next || next.zLevel <= 2) break;

            j++;
          }

          i = j + 1;
        } else {
          tocOutline.push({
            title: `${entry.chapterSection} ${entry.title}`.trim(),
            page: entry.pagenum - 1,
            level: entry.zLevel,
          });
          i++;
        }
      }
    });

  return tocOutline;
}

async function generateTOCHtml(books: Book[], entries: TOCData[]): Promise<{ id: string; content: string }[]> {

  return books.map(book => {
    const matchingEntries = entries.filter(entry =>
      book.Issue.includes(entry.zIssue)
    );

    matchingEntries.sort((a, b) => {
      if (a.zIssue !== b.zIssue) return a.zIssue - b.zIssue;
      if (a.pagenum !== b.pagenum) return a.pagenum - b.pagenum;
      if (a.zOrder !== b.zOrder) return a.zOrder - b.zOrder;
      return (a.chapterSection || '').localeCompare(b.chapterSection || '');
    });

    const tocPage = (
      (() => {
        const tocElements = [];
        let i = 0;

        //TODO: BUG: page-number stays on line one if text is too long and wraps around to second line
        const createEntryElement = (e) => (
          `<div
                      key="${e.zpk}"
                      style="display: flex;
                            justify-content: space-between;
                            font-weight: ${e.zLevel === 1 ? 'bold' : 'normal'};
                            margin-left: ${(e.zLevel - 1) * 20}px;"
                    >
                    <span>
                      ${e.chapterSection} ${e.title}
                    <span>
                    <span>${e.pagenum}</span>
                  </div>`
        );

        while (i < matchingEntries.length) {
          const entry = matchingEntries[i];

          // Detect if current entry starts a block
          const startsBlock =
            entry.zLevel >= 2 &&
            i + 1 < matchingEntries.length &&
            matchingEntries[i + 1].zLevel >= entry.zLevel;

          if (startsBlock) {
            const blockElements = [];
            const currentZLevel = entry.zLevel;
            let j = i;

            while (
              j < matchingEntries.length &&
              matchingEntries[j].zLevel >= currentZLevel
            ) {
              blockElements.push(createEntryElement(matchingEntries[j]));

              const next = matchingEntries[j + 1];
              if (!next || next.zLevel <= 2) break;

              j++;
            }

            // Look ahead: does the next entry start another block at zLevel 2?
            const nextBlockStarts =
              matchingEntries[j + 1] &&
              matchingEntries[j + 1].zLevel >= 2 &&
              matchingEntries[j + 1].zLevel <= currentZLevel;

            tocElements.push(
              `<div
                        key="block-${entry.zpk}"
                        style="line-height: 1em; ${nextBlockStarts ? ' margin-bottom: 0.5em;' : ''}"
                      >
                        ${blockElements.join('')}
                      </div>`
            );

            i = j + 1; // Move index past the block
          } else {
            tocElements.push(createEntryElement(entry));
            i++;
          }
        }

        return tocElements.join('');
      })()
    );

    const content =
      `<html>
        <head>
          <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
            <style>
            </style>
          </meta>
        </head>
        <body>
            <div
              style={{
                width: 2434,
                height: 3445,
                overflow: 'hidden',           // prevent content overflow
                boxSizing: 'border-box',      // ensures padding/border don't add to size
                padding: 0,
                margin: 0
              }}
            >
              <div style={{ width: '100%', padding: 0, margin: 0, boxSizing: 'border-box' }}>
              <h2 style={{ fontSize: '0.1em' }}>Table of contents</h2>
              <div style={{ fontSize: '0.9em', lineHeight: '2em' }}>
                ${tocPage}
              </div>
          </div>
        </div>
        </body>
      </html>`;

    return {
      id: book.BookID,
      content,
    };
  });
};

export async function getTOCData(): Promise<TOCData[]> {
  try {
    const db = sqlite(DB_PATH);

    const statement = db.prepare(`
                SELECT Z_PK, ZTITLE, ZPAGENUMBER, ZACCESSPATH, ZORDER, ZTOPICDEFINITION, ZISSUE, ZLEVEL
                FROM ZILPTOPIC 
                WHERE ZTOPICDELETED IS NULL AND ZTITLE IS NOT NULL AND TRIM(ZTITLE) != ''
                ORDER BY Z_PK
            `);

    const rows = statement.all();

    const entries: TOCData[] = rows.map(row => ({
      zpk: row.Z_PK,
      title: row.ZTITLE,
      pagenum: row.ZPAGENUMBER,
      chapterSection: row.ZACCESSPATH,
      zOrder: row.ZORDER,
      zIssue: row.ZISSUE,
      zLevel: row.ZLEVEL
    }));

    db.close();

    return entries;
  } catch (error) {
    console.error('Error fetching TOC data:', error);
    return [];
  }
}

// TODO: collapse/close every level except nr 1
export async function mergeWithOutlines(
  mergedPdfDoc: PDFDocument,
  toc: TOCItem[]
): Promise<PDFDocument> {
  if (!toc || toc.length === 0) return mergedPdfDoc;

  // --- Get page refs (flat list) ---
  const pages = mergedPdfDoc.getPages();
  const pageRefs = pages.map((p) => p.ref);

  const { context, catalog } = mergedPdfDoc;

  // Convert flat list into tree structure
  type TOCNode = TOCItem & { children: TOCNode[] };
  const root: TOCNode = { title: '__ROOT__', page: -1, level: 0, children: [] };
  const stack: TOCNode[] = [root];

  toc.forEach((item) => {
    const node: TOCNode = { ...item, children: [] };
    // Pop until we find the parent level
    while (stack.length > 0 && stack[stack.length - 1].level >= item.level) {
      stack.pop();
    }
    stack[stack.length - 1].children.push(node);
    stack.push(node);
  });

  // Recursive builder for outline items
  function buildOutlineTree(
    nodes: TOCNode[],
    parentRef: PDFRef
  ): { firstRef: PDFRef | null; lastRef: PDFRef | null; count: number } {
    if (nodes.length === 0) return { firstRef: null, lastRef: null, count: 0 };

    let firstRef: PDFRef | null = null;
    let lastRef: PDFRef | null = null;
    let prevRef: PDFRef | null = null;
    let totalCount = 0;

    nodes.forEach((node, index) => {
      const thisRef = context.nextRef();
      if (!firstRef) firstRef = thisRef;
      lastRef = thisRef;

      // Destination array for this outline item
      const destArray = context.obj([
        pageRefs[node.page],
        PDFName.of('XYZ'),
        PDFNull,
        PDFNull,
        PDFNull,
      ]);

      // Recursively create children
      const { firstRef: childFirst, lastRef: childLast, count: childCount } =
        buildOutlineTree(node.children, thisRef);

      const outlineDictEntries: any = {
        Title: PDFString.of(node.title),
        Parent: parentRef,
        Dest: destArray,
      };

      if (prevRef) outlineDictEntries.Prev = prevRef;
      if (index < nodes.length - 1) {
        // Next will be set in the NEXT loop item
      }
      if (childCount > 0) {
        outlineDictEntries.First = childFirst;
        outlineDictEntries.Last = childLast;
        outlineDictEntries.Count = PDFNumber.of(childCount);
      }

      // Assign this item now (Next will be set in previous node’s dict)
      context.assign(thisRef, context.obj(outlineDictEntries));

      // Set the Next pointer for the previous node if applicable
      if (prevRef) {
        const prevDict = context.lookup(prevRef, PDFDict);
        prevDict.set(PDFName.of('Next'), thisRef);
      }

      prevRef = thisRef;
      totalCount += 1 + childCount; // Include children in total
    });

    return { firstRef, lastRef, count: totalCount };
  }

  // Create the root outlines dictionary
  const outlinesDictRef = context.nextRef();
  const { firstRef, lastRef, count } = buildOutlineTree(root.children, outlinesDictRef);

  const outlinesDict = context.obj({
    Type: PDFName.of('Outlines'),
    First: firstRef,
    Last: lastRef,
    Count: PDFNumber.of(count),
  });

  context.assign(outlinesDictRef, outlinesDict);

  // Attach to catalog
  catalog.set(PDFName.of('Outlines'), outlinesDictRef);

  return mergedPdfDoc;
}