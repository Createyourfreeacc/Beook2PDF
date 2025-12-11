//first get all resources neccessary
//second stitch together the content
//third load content and convert to pdf
// TODO: navigation/footer space is removed but should be used in the background to gain additional info for each page!
//       this info could then be used to determin each pages content (chapter/topic/page num)
//       could be used to make links within the book functional, display page num, place quiz at correct place, create better toc and so forth

// TODO: add back navigation/footer??????

//TODO: Show page info in pdf footer (use last/next page info text for the current page)

//TODO: show title of book on the left bottom footer??? & Fach 010, if somehow possible

import { NextRequest, NextResponse } from 'next/server';
import sqlite from 'better-sqlite3';
import puppeteer from 'puppeteer';
import {
  PDFDocument,
  PDFName,
  PDFString,
  PDFArray,
  PDFNull,
  PDFDict,
  PDFRef,
  PDFNumber,
  StandardFonts,
  rgb,
} from 'pdf-lib';
import { setProgress, setPhaseProgress } from '@/lib/progressStore';
import { getResolvedPaths } from '@/lib/config';

const { dbPath: DB_PATH } = getResolvedPaths();

// High-DPI A4-ish canvas (≈300 DPI)
// 210mm x 297mm @ ~294 DPI -> ~2434 x 3445 px
const PAGE_WIDTH_PX = 2434;
const PAGE_HEIGHT_PX = 3445;

type Book = {
  BookID: string;
  Titel: string;
  CourseName: string;
  Refrence: string;
  Issue: number[];
  Toggled: boolean;
};

interface TOCData {
  zpk: number;
  title: string;
  pagenum: number;
  chapterSection: string;
  zOrder: number;
  zIssue: number;
  zLevel: number;
}


// [pdf page number, book page number]
type PageMapping = [number, number | null];

// [pdf page number, book page number, toc item titel, toc item level]
type MergedTOCEntry = [number, number | null, string, number];

function getPageInfoNumber(html: string): number | null {
  const target = '<span class="pageInfo">';
  const startIndex = html.lastIndexOf(target);
  if (startIndex === -1) return null;

  const contentStart = startIndex + target.length;
  const endIndex = html.indexOf('</span>', contentStart);
  if (endIndex === -1) return null;

  const insideText = html.slice(contentStart, endIndex).trim();
  const numberMatch = insideText.match(/\d+/);
  return numberMatch ? parseInt(numberMatch[0], 10) : null;
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
    //TODO: replace with new setPhaseProgress
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

// Map ZMEDIATYPE → MIME type we want in the data: URL
function mapFontMimeType(mediatype?: string | null): string {
  if (!mediatype) return 'font/woff';

  const mt = mediatype.toLowerCase();

  if (mt.includes('font-woff')) return 'font/woff';
  if (mt.includes('font-ttf')) return 'font/ttf';
  if (mt.includes('opentype')) return 'font/otf';

  // Fallback – most of your fonts are application/font-woff
  return 'font/woff';
}

/**
 * Take the raw CSS from ZILPRESOURCE and inline any @font-face src:url(<id>)
 * as data: URLs by loading the font blobs from the SQLite DB.
 *
 * Only used in the PDF generator (not the reader).
 */
function embedFontsIntoCss(css: string): string {
  if (!css) return css;

  // Find all numeric URLs: url(389), url(387), ...
  // In your data these only appear in @font-face rules.
  const urlRegex = /url\((\d+)\)/g;
  const fontIds = new Set<number>();

  let match: RegExpExecArray | null;
  while ((match = urlRegex.exec(css)) !== null) {
    const id = parseInt(match[1], 10);
    if (!Number.isNaN(id)) {
      fontIds.add(id);
    }
  }

  if (fontIds.size === 0) {
    return css; // nothing to do
  }

  let db: sqlite.Database | null = null;
  const idToDataUrl: Record<number, string> = {};

  try {
    db = sqlite(DB_PATH);

    const stmt = db.prepare(
      `SELECT "ZDATA", "ZMEDIATYPE" FROM "ZILPRESOURCE" WHERE "Z_PK" = ?`
    );

    for (const id of fontIds) {
      try {
        const row = stmt.get(id) as { ZDATA?: any; ZMEDIATYPE?: string } | undefined;

        if (!row || !row.ZDATA) {
          continue;
        }

        const buffer: Buffer = Buffer.isBuffer(row.ZDATA)
          ? row.ZDATA
          : Buffer.from(row.ZDATA as any);

        const base64 = buffer.toString('base64');
        const mime = mapFontMimeType(row.ZMEDIATYPE);
        const dataUrl = `data:${mime};base64,${base64}`;

        idToDataUrl[id] = dataUrl;
      } catch (err) {
        console.error('Failed to embed font with Z_PK =', id, err);
      }
    }
  } catch (err) {
    console.error('Failed to open DB for font embedding', err);
    return css; // degrade gracefully
  } finally {
    if (db) {
      db.close();
    }
  }

  // Replace url(<id>) with url("data:...") in the CSS string
  let resultCss = css;

  for (const [idStr, dataUrl] of Object.entries(idToDataUrl)) {
    const id = Number(idStr);
    if (!dataUrl) continue;

    const re = new RegExp(`url\\(${id}\\)`, 'g');
    resultCss = resultCss.replace(re, `url("${dataUrl}")`);
  }

  return resultCss;
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

      // Embed font blobs as data: URLs so Puppeteer can actually use them
      if (fetchedCss) {
        fetchedCss = embedFontsIntoCss(fetchedCss);
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
                <style>
                  /* beook2pdf overrides:
                     - remove internal navigation UI and page number from the canvas
                     - keep only the actual page content
                  */
                  .navigationWrapper,
                  .pageNavigationTable,
                  .navigationMiniToc,
                  .pageInfo {
                    display: none !important;
                  }

                  /* Optional but helps avoid surprises from global margins */
                  body {
                    margin: 0;
                    padding: 0;
                  }
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
    await page.setViewport({ width: PAGE_WIDTH_PX, height: PAGE_HEIGHT_PX });

    for (
      let i = startIndex;
      i < Math.min(startIndex + maxConcurrentProcesses, pageCount);
      i++
    ) {
      pdfBuffers[i] = await processPage(page, htmlPages[i], i);
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

  // A4 size in PDF points (72 pt/inch)
  const A4_WIDTH = 595.28;
  const A4_HEIGHT = 841.89;

  // One printed page number (or null) per HTML page, in order
  const printedPageNumbers: (number | null)[] = htmlPages.map(getPageInfoNumber);

  // Font for page numbers
  const pageNumberFont = await mergedPdfDoc.embedFont(StandardFonts.Helvetica);

  setPhaseProgress(jobId, 'merge', 0.3);

  let pageIndex = 0;

  // For each generated per-page PDF buffer, embed and scale into A4
  for (const buffer of pdfBuffers) {
    if (!buffer) continue;

    // Embed all pages from this buffer (should usually be a single page)
    const embeddedPages = await mergedPdfDoc.embedPdf(buffer);

    for (const embeddedPage of embeddedPages) {
      const { width, height } = embeddedPage;

      // Compute scale so the entire original page fits into A4
      const scale = Math.min(A4_WIDTH / width, A4_HEIGHT / height);

      const { width: scaledWidth, height: scaledHeight } = embeddedPage.scale(scale);

      // Create a new A4 page and center the embedded page on it
      const page = mergedPdfDoc.addPage([A4_WIDTH, A4_HEIGHT]);

      const x = (A4_WIDTH - scaledWidth) / 2;
      const y = (A4_HEIGHT - scaledHeight) / 2;

      page.drawPage(embeddedPage, {
        x,
        y,
        width: scaledWidth,
        height: scaledHeight,
      });


      // draw printed page number, if available
      const printedNumber = printedPageNumbers[pageIndex] ?? null;
      if (printedNumber != null) {
        const text = String(printedNumber);
        const fontSize = 10;
        const textWidth = pageNumberFont.widthOfTextAtSize(text, fontSize);

        const bottomMargin = 24;  // ~1/3 inch from bottom
        const xCenter = (A4_WIDTH - textWidth) / 2; // center page number
        const yBottom = bottomMargin;

        const rightMargin = 24;   // distance from right edge
        const xRight = A4_WIDTH - rightMargin - textWidth;

        page.drawText(text, {
          x: xRight,
          y: yBottom,
          size: fontSize,
          font: pageNumberFont,
          color: rgb(0, 0, 0),
        });
      }

      pageIndex++;
    }
  }

  const pageNum = extractPageNumbers(htmlPages);
  const entries = await getTOCData();
  const tocData = mergeTOCData(books, entries, pageNum);
  // TODO: do everything toc page related here
  // 1. function that return the updated tocData and the pages in the correct form 

  const PdfDoc = await addOutlineToPdf(mergedPdfDoc, tocData);

  setPhaseProgress(jobId, 'merge', 1);
  return await PdfDoc.save();
}

async function processPage(
  page: puppeteer.Page,
  htmlContent: string,
  index: number
): Promise<Buffer> {
  try {
    await page.setContent(htmlContent, {
      waitUntil: ['domcontentloaded', 'load'],
    });

    // Remove margins so the page is just the content canvas
    await page.evaluate(() => {
      const html = document.documentElement as HTMLElement;
      const body = document.body as HTMLElement;

      html.style.margin = '0';
      html.style.padding = '0';
      body.style.margin = '0';
      body.style.padding = '0';

      const selectorsToHide = [
        '.navigationWrapper',
        '.pageNavigationTable',
        '.navigationMiniToc',
        '.pageInfo',
      ];

      selectorsToHide.forEach((sel) => {
        document.querySelectorAll(sel).forEach((el) => {
          (el as HTMLElement).style.display = 'none';
        });
      });
    });

    // Measure the true content canvas using both body & document
    const dimensions = await page.evaluate(() => {
      const body = document.body as HTMLElement;
      const docEl = document.documentElement as HTMLElement;

      const width = Math.max(
        body.scrollWidth,
        docEl.scrollWidth,
        body.offsetWidth,
        docEl.offsetWidth
      );
      const height = Math.max(
        body.scrollHeight,
        docEl.scrollHeight,
        body.offsetHeight,
        docEl.offsetHeight
      );

      return { width, height };
    });

    const contentWidth = Math.max(dimensions.width || 1, 1);
    const contentHeight = Math.max(dimensions.height || 1, 1);

    // Let Puppeteer render the page at its natural size – no scaling.
    // This PDF now contains the full content.
    const pdf = await page.pdf({
      width: contentWidth,
      height: contentHeight,
      printBackground: true,
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
    });

    return Buffer.from(pdf);
  } catch (error) {
    console.error('Error while processing page', index, error);
    throw new Error('Failed to generate page PDF');
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

// TODO: Ordering is borked Bug: FACH 062 PPL FUNKNAVIGATION (RADIONAVIGATION) overview sometimes trims entire 6th chapter and
//      Angang is not always first as compared to Seite (95)
//      overview item is probably not trimmed but part of the wrong toc item. The entire 6th chapter is inside Anhang or Seite (75)
//      this points to an ordering bug but since the beook app gets its top level toc item from somewhere else than (Bug:) ZILPTOPIC
//      this is complicated further.
export async function addOutlineToPdf(
  mergedPdfDoc: PDFDocument,
  tocdata: MergedTOCEntry[][]
): Promise<PDFDocument> {
  // Nothing to do
  if (!tocdata || tocdata.length === 0) {
    return mergedPdfDoc;
  }

  const pages = mergedPdfDoc.getPages();
  const pageRefs = pages.map((p) => p.ref);

  const { context, catalog } = mergedPdfDoc;

  type OutlineNode = {
    title: string;
    pageIndex: number;   // 0-based index into pageRefs[]
    level: number;       // hierarchy level, 1 = top-level
    children: OutlineNode[];
  };

  // Global root of the outline tree
  const globalRoot: OutlineNode = {
    title: '__ROOT__',
    pageIndex: -1,
    level: 0,
    children: [],
  };

  // Build a small tree for each book (group) and append to the global root.
  for (const group of tocdata) {
    if (!group || group.length === 0) continue;

    const groupRoot: OutlineNode = {
      title: '__GROUP_ROOT__',
      pageIndex: -1,
      level: 0,
      children: [],
    };

    const stack: OutlineNode[] = [groupRoot];

    for (const [pdfPage, _bookPage, label, rawLevel] of group) {
      if (pdfPage == null) continue;

      // Convert global 1-based PDF page number to 0-based index
      const pageIndex = pdfPage - 1;
      if (pageIndex < 0 || pageIndex >= pageRefs.length) {
        // Out-of-range – skip this entry
        continue;
      }

      let level = Number(rawLevel);
      if (!Number.isFinite(level) || level < 1) level = 1;

      const node: OutlineNode = {
        title: (label ?? '').trim(),
        pageIndex,
        level,
        children: [],
      };

      // Pop stack until the top has a smaller level than the new node
      while (stack.length > 0 && stack[stack.length - 1].level >= node.level) {
        stack.pop();
      }

      const parent = stack[stack.length - 1] ?? groupRoot;
      parent.children.push(node);
      stack.push(node);
    }

    if (groupRoot.children.length > 0) {
      globalRoot.children.push(...groupRoot.children);
    }
  }

  // If nothing valid ended up in the tree, leave the PDF as-is.
  if (globalRoot.children.length === 0) {
    return mergedPdfDoc;
  }

  // Recursive builder, adapted from mergeWithOutlines
  function buildOutlineTree(
    nodes: OutlineNode[],
    parentRef: PDFRef
  ): { firstRef: PDFRef | null; lastRef: PDFRef | null; count: number } {
    if (!nodes || nodes.length === 0) {
      return { firstRef: null, lastRef: null, count: 0 };
    }

    let firstRef: PDFRef | null = null;
    let lastRef: PDFRef | null = null;
    let prevRef: PDFRef | null = null;
    let totalCount = 0;

    nodes.forEach((node) => {
      const pageRef = pageRefs[node.pageIndex];
      if (!pageRef) {
        // If the page index is somehow invalid, skip this node (and its subtree)
        return;
      }

      const thisRef = context.nextRef();
      if (!firstRef) firstRef = thisRef;
      lastRef = thisRef;

      const destArray = context.obj([
        pageRef,
        PDFName.of('XYZ'),
        PDFNull,
        PDFNull,
        PDFNull,
      ]);

      const {
        firstRef: childFirst,
        lastRef: childLast,
        count: childCount,
      } = buildOutlineTree(node.children, thisRef);

      const outlineDictEntries: Record<string, any> = {
        // ensures titles are safely escaped according to the PDF spec §7.3.4.2 “Literal Strings”.
        // prevents pdf-lib from creating malformed pdf outlines
        Title: PDFString.of(
          node.title.replace(/([()\\])/g, '\\$1')
        ),
        Parent: parentRef,
        Dest: destArray,
      };

      if (prevRef) {
        outlineDictEntries.Prev = prevRef;
      }
      if (childCount > 0) {
        outlineDictEntries.First = childFirst;
        outlineDictEntries.Last = childLast;
        outlineDictEntries.Count = PDFNumber.of(childCount);
      }

      context.assign(thisRef, context.obj(outlineDictEntries));

      if (prevRef) {
        const prevDict = context.lookup(prevRef, PDFDict);
        prevDict.set(PDFName.of('Next'), thisRef);
      }

      prevRef = thisRef;
      totalCount += 1 + childCount;
    });

    return { firstRef, lastRef, count: totalCount };
  }

  const outlinesDictRef = context.nextRef();
  const { firstRef, lastRef, count } = buildOutlineTree(
    globalRoot.children,
    outlinesDictRef
  );

  if (!firstRef || !lastRef || count === 0) {
    // Nothing meaningful was built, don't touch the catalog
    return mergedPdfDoc;
  }

  const outlinesDict = context.obj({
    Type: PDFName.of('Outlines'),
    First: firstRef,
    Last: lastRef,
    Count: PDFNumber.of(count),
  });

  context.assign(outlinesDictRef, outlinesDict);
  catalog.set(PDFName.of('Outlines'), outlinesDictRef);

  return mergedPdfDoc;
}

function extractPageNumbers(htmlPages: string[]): PageMapping[][] {
  const result: PageMapping[][] = [];
  let currentGroup: PageMapping[] = [];

  let lastBookPage: number | null = null;
  let pdfPage = 1; // PDF pages are 1-based and just count up globally

  for (const html of htmlPages) {
    const bookPage = getPageInfoNumber(html); // number | null

    // whenever the printed number jumps backwards, start a new group (new book)
    if (
      lastBookPage !== null &&
      bookPage !== null &&
      bookPage < lastBookPage
    ) {
      result.push(currentGroup);
      currentGroup = [];
      lastBookPage = null; // reset for the new book
    }

    // push [pdf page number, book page number]
    currentGroup.push([pdfPage, bookPage]);

    if (bookPage !== null) {
      lastBookPage = bookPage;
    }

    pdfPage += 1;
  }

  // push last group
  if (currentGroup.length > 0) {
    result.push(currentGroup);
  }

  return result;
}

  function mergeTOCData(
    books: Book[],
    entries: TOCData[],
    pageNum: PageMapping[][]
  ): MergedTOCEntry[][] {
    // Only books that are actually exported
    const toggledBooks = books.filter((b) => b.Toggled);

    // pageNum groups are created in the same order as we looped over books in generatePdf
    // (for each toggled book, in order), so index 0 in pageNum == first toggled book, etc.
    const groupCount = Math.min(toggledBooks.length, pageNum.length);

    // Map each issue number (ZISSUE / ZISSUEPRODUCT) to the index of the book group
    const issueToBookIndex = new Map<number, number>();
    for (let i = 0; i < groupCount; i++) {
      const book = toggledBooks[i];
      for (const issue of book.Issue) {
        issueToBookIndex.set(Number(issue), i);
      }
    }

    // For each group/book: map "book printed page" -> "global pdf page"
    const pageMapPerBook: Map<number, number>[] = [];
    for (let i = 0; i < groupCount; i++) {
      const m = new Map<number, number>();
      const group = pageNum[i] || [];

      for (const [pdfPage, bookPage] of group) {
        if (bookPage == null) continue;
        const bp = Number(bookPage);
        if (!Number.isFinite(bp)) continue;

        // If multiple pdf pages share the same printed page, keep the first occurrence
        if (!m.has(bp)) m.set(bp, pdfPage);
      }

      pageMapPerBook[i] = m;
    }

    type TempEntry = {
      pdfPage: number;
      bookPage: number;
      label: string;
      level: number;
      order: number;
    };

    const tempResult: TempEntry[][] = Array.from(
      { length: groupCount },
      () => []
    );

    for (const entry of entries) {
      const bookIdx = issueToBookIndex.get(Number(entry.zIssue));
      if (bookIdx === undefined) continue; // TOC for a non-exported book

      const pageMap = pageMapPerBook[bookIdx];
      if (!pageMap) continue;

      // ZPAGENUMBER comes from SQLite as text -> convert to number
      const bookPageNum = Number(entry.pagenum);
      if (!Number.isFinite(bookPageNum)) continue;

      const pdfPage = pageMap.get(bookPageNum);
      if (pdfPage === undefined) continue; // that printed page isn't in the export

      const label =
        (entry.chapterSection ? entry.chapterSection + ' ' : '') +
        entry.title;

      tempResult[bookIdx].push({
        pdfPage,
        bookPage: bookPageNum,
        label,
        level: entry.zLevel,
        order: entry.zOrder,
      });
    }

    // After you've built tempResult[bookIdx] but before sorting:
    for (const bookEntries of tempResult) {
      for (let i = bookEntries.length - 1; i >= 0; i--) {
        const e = bookEntries[i];

        // Must have a valid mapped PDF page
        if (!Number.isFinite(e.pdfPage) || e.pdfPage <= 0) {
          bookEntries.splice(i, 1);
          continue;
        }

        // Book page sanity
        if (!Number.isFinite(e.bookPage) || e.bookPage <= 0) {
          bookEntries.splice(i, 1);
          continue;
        }

        // Label sanity
        if (!e.label || typeof e.label !== 'string' || e.label.trim().length === 0) {
          bookEntries.splice(i, 1);
          continue;
        }

        e.label = e.label.trim();
      }
    }

    // Sort each book’s TOC entries by book page, then by ZORDER
    const result: MergedTOCEntry[][] = tempResult.map((bookEntries, bookIdx) => {
      bookEntries.sort((a, b) => {
        if (a.bookPage !== b.bookPage) return a.bookPage - b.bookPage;
        if (a.order !== b.order) return a.order - b.order;
        return a.label.localeCompare(b.label);
      });

      // SPECIAL CASE:
      // If the first 2 entries are on the same page and the first one
      // is "less top-level" (higher order or same order but deeper level),
      // drop the first one. This filters out "FACH 010" etc.
      if (bookEntries.length >= 2) {
        const first = bookEntries[0];
        const second = bookEntries[1];

        const samePage =
          first.bookPage === second.bookPage &&
          first.pdfPage === second.pdfPage;

        const firstHasHigherOrder = first.order > second.order;
        const sameOrderFirstDeeper =
          first.order === second.order && first.level > second.level;

        if (samePage && (firstHasHigherOrder || sameOrderFirstDeeper)) {
          bookEntries.shift();
        }
      }

      // INSERT BOOK TITLE AS TOP-LEVEL ENTRY + SHIFT LEVELS
      if (bookEntries.length > 0) {
        const first = bookEntries[0];

        // Titel can be string, string[], or something else -> normalise
        const rawTitle = (toggledBooks[bookIdx] as any)?.Titel;

        let bookTitle = '';
        if (Array.isArray(rawTitle)) {
          // take first entry if it's an array
          bookTitle = String(rawTitle[0] ?? '');
        } else if (typeof rawTitle === 'string') {
          bookTitle = rawTitle;
        } else if (rawTitle != null) {
          // fallback for odd cases (number, etc.)
          bookTitle = String(rawTitle);
        }

        bookTitle = bookTitle.trim();

        if (bookTitle.length > 0) {
          // Raise the level of all existing entries by +1
          for (const e of bookEntries) {
            e.level = e.level + 1;
          }

          // Insert the book title as the very first entry
          bookEntries.unshift({
            pdfPage: first.pdfPage,
            bookPage: first.bookPage,
            label: bookTitle,
            level: 1,
            // order is not used after this point, 0 keeps it at the top if re-sorted
            order: 0,
          });
        }
      }

      return bookEntries.map(
        (e) => [e.pdfPage, e.bookPage, e.label, e.level] as MergedTOCEntry
      );
    });

    return result;
  }