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
  PDFFont,
} from 'pdf-lib';
import { setProgress, setPhaseProgress } from '@/lib/progressStore';
import { getResolvedPaths } from '@/lib/config';

const { dbPath: DB_PATH } = getResolvedPaths();

// A4 size in PDF points (72 pt/inch)
const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;

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
  Lang: string;
  Toggled: boolean;
};

interface ExportOptions {
  generateTocPages: boolean;
  exportQuiz: boolean;
  exportMyQuiz: boolean;
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

// [pdf page number, book page number]
type PageMapping = [number, number | null];

// [pdf page number, book page number, toc item titel, toc item level]
type MergedTOCEntry = [number, number | null, string, number];

type QuizAnswer = {
  id: number;
  number: number;
  text: string;
  isCorrect: boolean | null;
};

type QuizQuestion = {
  id: number;
  ref: string | null;
  text: string;
  exerciseTitle: string | null;
  exerciseCode: string | null;
  exerciseId: number;
  answers: QuizAnswer[];
};

type QuizChapter = {
  id: number;
  title: string;
  ref: string | null;
  issueId: string | null;
  questions: QuizQuestion[];
};

type QuizBook = {
  id: number;               // cd.Z_PK
  courseId: string | null;  // cd.ZCOURSEID
  ref: string | null;       // cd.ZREFERENCE
  title: string;            // nice label taken from your Book object
  chapters: QuizChapter[];
};

type RawQuizRow = {
  bookId: number;
  bookCourseId: string | null;
  bookRef: string | null;

  chapterId: number;
  chapterTitle: string | null;
  chapterRef: string | null;
  issueId: string | null;

  exerciseId: number;
  exerciseTitle: string | null;
  exerciseCode: string | null;

  questionId: number;
  questionRef: string | null;
  questionText: string | null;

  answerId: number | null;
  answerNumber: number | null;
  answerText: string | null;
  answerIsCorrect: number | null;
};

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

  const generateTocPagesParam = searchParams.get('generateTocPages');
  const exportQuizParam = searchParams.get('exportQuiz');
  const exportMyQuizParam = searchParams.get('exportMyQuiz');

  if (!booksParam) {
    return NextResponse.json({ error: 'Missing ID parameter' }, { status: 400 });
  }

  const books: Book[] = JSON.parse(booksParam);

  const exportOptions: ExportOptions = {
    // default: true if param missing
    generateTocPages:
      generateTocPagesParam === null ? true : generateTocPagesParam === 'true',
    exportQuiz:
      exportQuizParam === null ? true : exportQuizParam === 'true',
    // default: false if param missing
    exportMyQuiz: exportMyQuizParam === 'true',
  };

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
    const mergedPdfBytes = await generateMergedPdf(books, htmlPages, jobId, exportOptions);

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

export async function generateMergedPdf(
  books: Book[],
  htmlPages: string[],
  jobId: string,
  exportOptions: ExportOptions
): Promise<Uint8Array> {
  const pageCount = htmlPages.length;
  const { generateTocPages, exportQuiz } = exportOptions;

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

  let pdfDocWithToc: PDFDocument;
  let updatedTocData: MergedTOCEntry[][];
  if (generateTocPages) {
    const result = await insertTocPagesForBooks(
      mergedPdfDoc,
      books,
      tocData,
      pageNum
    );

    pdfDocWithToc = result.pdfDocWithToc;
    updatedTocData = result.updatedTocData;
  } else {
    pdfDocWithToc = mergedPdfDoc;
    updatedTocData = tocData;
  }

  let pdfDocWithQuiz = pdfDocWithToc;
  if (exportQuiz) {
    try {
      const quizBooks = await loadQuizDataForBooks(books);
      if (quizBooks.length > 0) {
        // append question pages
        pdfDocWithQuiz = await appendQuizPagesToPdf(pdfDocWithQuiz, quizBooks);
        // append solution pages
        pdfDocWithQuiz = await appendQuizSolutionPagesToPdf(
          pdfDocWithQuiz,
          quizBooks
        );
      }
    } catch (err) {
      console.error('Failed to append quiz pages / solutions:', err);
      // fail soft, keep main PDF
    }
  }

  const PdfDoc = await addOutlineToPdf(pdfDocWithQuiz, updatedTocData);

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

async function insertTocPagesForBooks(
  mergedPdfDoc: PDFDocument,
  books: Book[],
  tocData: MergedTOCEntry[][],
  pageNum: PageMapping[][]
): Promise<{ pdfDocWithToc: PDFDocument; updatedTocData: MergedTOCEntry[][] }> {
  // No TOC data -> nothing to insert
  if (!tocData || tocData.length === 0) {
    return { pdfDocWithToc: mergedPdfDoc, updatedTocData: tocData };
  }

  const toggledBooks = books.filter((b) => b.Toggled);
  const groupCount = Math.min(toggledBooks.length, pageNum.length, tocData.length);

  // Clone tocData so we can mutate safely
  const updatedTocData: MergedTOCEntry[][] = tocData.map((bookEntries) =>
    bookEntries.map(([pdfPage, bookPage, label, level]) => [
      pdfPage,
      bookPage,
      label,
      level,
    ] as MergedTOCEntry)
  );

  const { context } = mergedPdfDoc;

  type TocLinkJob = {
    bookIdx: number;
    entryIdx: number;        // index into updatedTocData[bookIdx]
    tocPageIndex: number;    // 1-based global page index of the TOC page
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  };

  const tocLinkJobs: TocLinkJob[] = [];

  const MAX_LINES_PER_PAGE = 50;
  const TITLE_FONT_SIZE = 14;
  const ENTRY_FONT_SIZE = 10;
  const LINE_HEIGHT = 14;
  const MARGIN_LEFT = 48;
  const MARGIN_RIGHT = 48;
  const MARGIN_TOP = 72;

  const tocFont = await mergedPdfDoc.embedFont(StandardFonts.Helvetica);
  const tocTitleFont = await mergedPdfDoc.embedFont(StandardFonts.HelveticaBold);
  const tocLevel1Font = tocTitleFont;

  type TocGap = { startBookPage: number; length: number };

  // how many pages we’ve already inserted before the current book
  let globalOffset = 0;

  for (let bookIdx = 0; bookIdx < groupCount; bookIdx++) {
    const book = toggledBooks[bookIdx];
    const bookPageMappings = pageNum[bookIdx];
    const bookTocEntries = updatedTocData[bookIdx];

    // Build a *view-only* TOC for the page TOC:
    // - assume first item is the book title -> skip it
    // - shift all remaining levels down by 1 (clamped to >= 1)
    // - this does NOT modify bookTocEntries / updatedTocData
    type PageTocEntry = {
      bookEntryIndex: number;   // index into updatedTocData[bookIdx]
      entry: MergedTOCEntry;    // [pdfPage, bookPage, label, levelForLayout]
    };

    let pageTocEntries: PageTocEntry[] = [];
    if (bookTocEntries && bookTocEntries.length > 0) {
      for (let i = 1; i < bookTocEntries.length; i++) {
        const [pdfPage, bookPage, label, level] = bookTocEntries[i];
        const currentLevel =
          typeof level === 'number' && Number.isFinite(level) ? level : 1;
        const newLevel = Math.max(1, currentLevel - 1);

        pageTocEntries.push({
          bookEntryIndex: i,
          entry: [pdfPage, bookPage, label, newLevel],
        });
      }
    }

    if (!bookPageMappings || bookPageMappings.length === 0 || !bookTocEntries) {
      continue;
    }

    // Apply offset from TOC pages inserted for previous books
    for (const entry of bookTocEntries) {
      entry[0] += globalOffset;
    }

    // Determine the last printed page for this book
    const printedPages = bookPageMappings
      .map((m) => m[1])
      .filter((p): p is number => p != null);

    const lastPrintedPage = printedPages.length
      ? Math.max(...printedPages)
      : 0;

    // Skip TOC page insertion if the book has fewer than 10 printed pages
    if (lastPrintedPage < 10) {
      continue;
    }

    if (!pageTocEntries || pageTocEntries.length === 0) {
      continue;
    }

    // Find gaps in printed page numbers within the first 10 printed pages
    const presentFirstTen = new Set<number>();
    for (const [pdfPage, bookPage] of bookPageMappings) {
      if (bookPage != null && bookPage >= 1 && bookPage <= 10) {
        presentFirstTen.add(bookPage);
      }
    }

    const gaps: TocGap[] = [];
    let inGap = false;
    let gapStart = 0;

    for (let p = 1; p <= 10; p++) {
      const occupied = presentFirstTen.has(p);
      if (!occupied && !inGap) {
        inGap = true;
        gapStart = p;
      } else if (occupied && inGap) {
        gaps.push({ startBookPage: gapStart, length: p - gapStart });
        inGap = false;
      }
    }
    if (inGap) {
      gaps.push({ startBookPage: gapStart, length: 11 - gapStart });
    }

    // Map "printed book page" -> "current global pdf page" (1-based)
    const bookPageToGlobalPdfPage = new Map<number, number>();
    for (const [pdfPage, bookPage] of bookPageMappings) {
      if (bookPage != null) {
        bookPageToGlobalPdfPage.set(bookPage, pdfPage + globalOffset);
      }
    }

    // Decide where to insert the TOC pages for this book
    let insertBeforePdfPage: number | null = null;

    if (gaps.length > 0) {
      const firstGap = gaps[0];
      const firstPageAfterGap = firstGap.startBookPage + firstGap.length;
      const pdfAfterGap = bookPageToGlobalPdfPage.get(firstPageAfterGap);

      if (pdfAfterGap != null) {
        insertBeforePdfPage = pdfAfterGap;
      }
    }

    if (insertBeforePdfPage == null) {
      // Fallback: append TOC at the end of this book
      let lastBookPdfPage = 0;
      for (const [pdfPage] of bookPageMappings) {
        const globalPdfPage = pdfPage + globalOffset;
        if (globalPdfPage > lastBookPdfPage) {
          lastBookPdfPage = globalPdfPage;
        }
      }
      insertBeforePdfPage = lastBookPdfPage + 1;
    }

    // Paginate this book's TOC entries for the *page TOC* (no book title, levels shifted)
    type PagedEntry = {
      bookEntryIndex: number;
      entry: MergedTOCEntry;
      lines: string[];
    };

    const paginatedEntries: PagedEntry[][] = [];
    let currentPage: PagedEntry[] = [];
    let currentLineCount = 0;

    for (const pageEntry of pageTocEntries) {
      const { entry, bookEntryIndex } = pageEntry;
      const [_, __, label, level] = entry;
      const safeLevel = level && level > 0 ? level : 1;
      const indent = (safeLevel - 1) * 16;
      const textX = MARGIN_LEFT + indent;
      const entryFont = safeLevel === 1 ? tocLevel1Font : tocFont;

      const maxTextWidth = A4_WIDTH - MARGIN_RIGHT - textX - 32;
      const wrappedLines = wrapText(
        label || '',
        maxTextWidth,
        entryFont,
        ENTRY_FONT_SIZE
      );
      const neededLines = wrappedLines.length;

      if (currentLineCount + neededLines > MAX_LINES_PER_PAGE) {
        if (currentPage.length > 0) {
          paginatedEntries.push(currentPage);
        }
        currentPage = [];
        currentLineCount = 0;
      }

      currentPage.push({ bookEntryIndex, entry, lines: wrappedLines });
      currentLineCount += neededLines;
    }

    if (currentPage.length > 0) {
      paginatedEntries.push(currentPage);
    }

    const pagesInserted = paginatedEntries.length;

    // Insert the TOC pages into the PDF
    let insertIndex = insertBeforePdfPage - 1; // pdf-lib pages are 0-based
    for (let pageIdx = 0; pageIdx < paginatedEntries.length; pageIdx++) {
      const entriesForPage = paginatedEntries[pageIdx];
      const page = mergedPdfDoc.insertPage(insertIndex, [A4_WIDTH, A4_HEIGHT]);

      let y = A4_HEIGHT - MARGIN_TOP;

      // Draw title on first TOC page for the book
      if (pageIdx === 0) {
        const rawTitle = (book as any)?.Titel;
        let bookTitle = '';
        if (Array.isArray(rawTitle)) {
          bookTitle = rawTitle.join(' ');
        } else if (typeof rawTitle === 'string') {
          bookTitle = rawTitle;
        } else if (rawTitle != null) {
          bookTitle = String(rawTitle);
        }

        // Language-dependent TOC title
        let lang = (book as any)?.Lang;
        if (typeof lang !== "string") lang = "DE";     // default if null/undefined
        lang = lang.trim().toUpperCase();

        let tocTitle = "";
        switch (lang) {
          case "EN":
            tocTitle = bookTitle
              ? `Table of Contents – ${bookTitle}`
              : "Table of Contents";
            break;
          case "FR":
            tocTitle = bookTitle
              ? `Table des Matières – ${bookTitle}`
              : "Table des Matières";
            break;
          case "ES":
            tocTitle = bookTitle
              ? `Índice – ${bookTitle}`
              : "Índice";
            break;
          case "IT":
            tocTitle = bookTitle
              ? `Indice – ${bookTitle}`
              : "Indice";
            break;
          case "DE":
          default:
            tocTitle = bookTitle
              ? `Inhaltsverzeichnis – ${bookTitle}`
              : "Inhaltsverzeichnis";
            break;
        }

        page.drawText(tocTitle, {
          x: MARGIN_LEFT,
          y,
          size: TITLE_FONT_SIZE,
          font: tocTitleFont,
          color: rgb(0, 0, 0),
        });
        y -= TITLE_FONT_SIZE + 10;
      }

      // Draw each TOC entry with wrapped lines, respecting MAX_LINES_PER_PAGE
      for (const { entry, lines, bookEntryIndex } of entriesForPage) {
        const [_, bookPage, _label, level] = entry;

        if (y < 72) {
          // Safety check; in theory line-based pagination should prevent this
          break;
        }

        const safeLevel = level && level > 0 ? level : 1;
        const indent = (safeLevel - 1) * 16;
        const textX = MARGIN_LEFT + indent;

        const entryFont = safeLevel === 1 ? tocLevel1Font : tocFont;

        let firstLineY: number | null = null;
        let lastLineY: number | null = null;

        for (const line of lines) {
          if (y < 72) break;

          if (firstLineY === null) {
            firstLineY = y;
          }

          page.drawText(line, {
            x: textX,
            y,
            size: ENTRY_FONT_SIZE,
            font: entryFont,
            color: rgb(0, 0, 0),
          });

          lastLineY = y;
          y -= LINE_HEIGHT;
        }

        // Draw the page number aligned with the *last* drawn line for this entry
        if (bookPage != null && lastLineY != null) {
          const pageText = String(bookPage);
          const pageWidth = tocFont.widthOfTextAtSize(pageText, ENTRY_FONT_SIZE);
          const pageX = A4_WIDTH - MARGIN_RIGHT - pageWidth;

          page.drawText(pageText, {
            x: pageX,
            y: lastLineY,
            size: ENTRY_FONT_SIZE,
            font: tocFont,
            color: rgb(0, 0, 0),
          });
        }

        // Register link area for this TOC line (whole line clickable)
        if (firstLineY != null && lastLineY != null) {
          const x1 = MARGIN_LEFT;
          const x2 = A4_WIDTH - MARGIN_RIGHT;
          const yTop = firstLineY + ENTRY_FONT_SIZE + 2;
          const yBottom = lastLineY - 2;

          tocLinkJobs.push({
            bookIdx,
            entryIdx: bookEntryIndex,
            tocPageIndex: insertBeforePdfPage + pageIdx, // 1-based global page number
            x1,
            y1: Math.max(Math.min(yBottom, yTop), 0),
            y2: Math.min(Math.max(yBottom, yTop), A4_HEIGHT),
            x2,
          });
        }
      }

      insertIndex++;
    }

    // Shift this book's TOC entries for pages that come after the inserted block
    for (const entry of bookTocEntries) {
      if (entry[0] >= insertBeforePdfPage) {
        entry[0] += pagesInserted;
      }
    }

    // All subsequent books' pages are shifted by the number of pages we inserted
    globalOffset += pagesInserted;
  }

  // After inserting all TOC pages and updating updatedTocData,
  // create clickable link annotations for each TOC entry.
  const pages = mergedPdfDoc.getPages();

  for (const job of tocLinkJobs) {
    const bookEntries = updatedTocData[job.bookIdx];
    if (!bookEntries) continue;

    const targetEntry = bookEntries[job.entryIdx];
    if (!targetEntry) continue;

    const targetPdfPageNum = Number(targetEntry[0]);
    if (
      !Number.isFinite(targetPdfPageNum) ||
      targetPdfPageNum < 1 ||
      targetPdfPageNum > pages.length
    ) {
      continue;
    }

    const tocPage = pages[job.tocPageIndex - 1];
    const targetPage = pages[targetPdfPageNum - 1];
    if (!tocPage || !targetPage) continue;

    let annots = tocPage.node.lookup(PDFName.of('Annots'), PDFArray);
    if (!annots) {
      annots = context.obj([]) as PDFArray;
      tocPage.node.set(PDFName.of('Annots'), annots);
    }

    const linkRef = context.register(
      context.obj({
        Type: PDFName.of('Annot'),
        Subtype: PDFName.of('Link'),
        Rect: [job.x1, job.y1, job.x2, job.y2],
        Border: [0, 0, 0],
        Dest: [targetPage.ref, 'XYZ', null, null, null],
      })
    );

    annots.push(linkRef);
  }

  return { pdfDocWithToc: mergedPdfDoc, updatedTocData };
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

function cleanQuizQuestionText(text: string | null): string {
  if (!text) return '';
  return text
    .replace(/\$\{answerBlock\}/g, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?[^>]+>/g, '')
    .trim();
}

function cleanQuizAnswerText(text: string | null): string {
  if (!text) return '';
  return text
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?[^>]+>/g, '')
    .trim();
}

function extractQuizChapterNumberPrefix(title: string | null): number {
  if (!title) return Number.MAX_SAFE_INTEGER;
  const match = title.trim().match(/^(\d+)/);
  return match ? parseInt(match[1], 10) : Number.MAX_SAFE_INTEGER;
}

async function loadQuizDataForBooks(books: Book[]): Promise<QuizBook[]> {
  const toggledBooks = books.filter((b) => b.Toggled);
  if (toggledBooks.length === 0) return [];

  // BookID is cd.Z_PK as string
  const bookIds = Array.from(
    new Set(
      toggledBooks
        .map((b) => {
          const n = parseInt(b.BookID, 10);
          return Number.isFinite(n) ? n : null;
        })
        .filter((n): n is number => n !== null)
    )
  );
  if (bookIds.length === 0) return [];

  const db = sqlite(DB_PATH);
  try {
    const placeholders = bookIds.map(() => '?').join(', ');

    const rows = db
      .prepare(
        `
        SELECT
          cd."Z_PK"                AS bookId,
          cd."ZCOURSEID"           AS bookCourseId,
          cd."ZREFERENCE"          AS bookRef,

          chap."Z_PK"              AS chapterId,
          chap."ZTITLE"            AS chapterTitle,
          chap."ZPRODUCTREFERENCE" AS chapterRef,
          issue."ZISSUEID"         AS issueId,

          ex."Z_PK"                AS exerciseId,
          ex."ZTITLE"              AS exerciseTitle,
          ex."ZEXERCISEID"         AS exerciseCode,

          q."Z_PK"                 AS questionId,
          q."ZREFERENCE"           AS questionRef,
          qd."ZTEXT_DECRYPTED"     AS questionText,

          ans."Z_PK"               AS answerId,
          ans."ZNUMBER"            AS answerNumber,
          ans."ZANSWER_TEXT"       AS answerText,
          ans."ZCORRECT_DECRYPTED" AS answerIsCorrect

        FROM ZILPQUESTION_DECRYPTED qd
        JOIN ZILPQUESTION q
          ON q."Z_PK" = qd."Z_PK"

        JOIN ZILPEXERCISE ex
          ON ex."Z_PK" = q."ZEXERCISE"

        JOIN ZILPISSUEDEF issue
          ON issue."Z_PK" = ex."ZISSUE"

        JOIN ZILPISSUEPRODUCT ip
          ON ip."ZISSUEPRODUCT" = issue."ZISSUEPRODUCT"

        JOIN ZILPEPRODUCT chap
          ON chap."Z_PK" = ip."ZEPRODUCT"

        JOIN ZILPCOURSEDEF cd
          ON cd."Z_PK" = issue."ZCOURSE"

        LEFT JOIN ZILPANSWER_DECRYPTED ans
          ON ans."ZQUESTION" = q."Z_PK"
         AND ans."ZTYPE" = 3

        WHERE cd."Z_PK" IN (${placeholders})

        ORDER BY
          cd."ZCOURSEID",
          chap."ZTITLE",
          ex."ZEXERCISEID",
          q."ZREFERENCE",
          ans."ZNUMBER"
        `
      )
      .all(...bookIds) as RawQuizRow[];

    if (rows.length === 0) return [];

    const booksMap = new Map<
      number,
      {
        id: number;
        courseId: string | null;
        ref: string | null;
        title: string;
        chapters: Map<
          number,
          {
            id: number;
            title: string;
            ref: string | null;
            issueId: string | null;
            questions: Map<
              number,
              {
                id: number;
                ref: string | null;
                text: string;
                exerciseTitle: string | null;
                exerciseCode: string | null;
                exerciseId: number;
                answers: QuizAnswer[];
              }
            >;
          }
        >;
      }
    >();

    for (const row of rows) {
      // --- Book ---
      let book = booksMap.get(row.bookId);
      if (!book) {
        const toggledBook = toggledBooks.find(
          (b) => parseInt(b.BookID, 10) === row.bookId
        );

        const titleFromBook =
          toggledBook?.Titel ||
          toggledBook?.CourseName ||
          toggledBook?.Refrence ||
          `Buch ${row.bookId}`;

        book = {
          id: row.bookId,
          courseId: row.bookCourseId,
          ref: row.bookRef,
          title: titleFromBook,
          chapters: new Map(),
        };
        booksMap.set(row.bookId, book);
      }

      // --- Chapter ---
      let chapter = book.chapters.get(row.chapterId);
      if (!chapter) {
        chapter = {
          id: row.chapterId,
          title:
            row.chapterTitle ||
            row.issueId ||
            row.chapterRef ||
            `Kapitel ${row.chapterId}`,
          ref: row.chapterRef,
          issueId: row.issueId,
          questions: new Map(),
        };
        book.chapters.set(row.chapterId, chapter);
      }

      // --- Question ---
      let question = chapter.questions.get(row.questionId);
      if (!question) {
        question = {
          id: row.questionId,
          ref: row.questionRef,
          text: cleanQuizQuestionText(row.questionText),
          exerciseTitle: row.exerciseTitle,
          exerciseCode: row.exerciseCode,
          exerciseId: row.exerciseId,
          answers: [],
        };
        chapter.questions.set(row.questionId, question);
      }

      // --- Answer ---
      if (row.answerId != null && row.answerNumber != null) {
        question.answers.push({
          id: row.answerId,
          number: row.answerNumber,
          text: cleanQuizAnswerText(row.answerText),
          isCorrect:
            row.answerIsCorrect == null
              ? null
              : row.answerIsCorrect === 1,
        });
      }
    }

    const quizBooks: QuizBook[] = Array.from(booksMap.values()).map(
      (book) => {
        const chapters: QuizChapter[] = Array.from(book.chapters.values())
          .sort(
            (a, b) =>
              extractQuizChapterNumberPrefix(a.title) -
              extractQuizChapterNumberPrefix(b.title)
          )
          .map((ch) => ({
            id: ch.id,
            title: ch.title,
            ref: ch.ref,
            issueId: ch.issueId,
            questions: Array.from(ch.questions.values()).map((q) => ({
              id: q.id,
              ref: q.ref,
              text: q.text,
              exerciseTitle: q.exerciseTitle,
              exerciseCode: q.exerciseCode,
              exerciseId: q.exerciseId,
              answers: q.answers
                .slice()
                .sort((a, b) => a.number - b.number),
            })),
          }));

        return {
          id: book.id,
          courseId: book.courseId,
          ref: book.ref,
          title: book.title,
          chapters,
        };
      }
    );

    return quizBooks;
  } finally {
    db.close();
  }
}

async function appendQuizPagesToPdf(
  pdfDoc: PDFDocument,
  quizBooks: QuizBook[]
): Promise<PDFDocument> {
  if (!quizBooks || quizBooks.length === 0) {
    return pdfDoc;
  }

  const bodyFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const margin = 50;
  const sectionSpacing = 24;
  const questionSpacing = 6;
  const lineHeight = 12;

  const questionFontSize = 9;
  const answerFontSize = 10;
  const titleFontSize = 16;
  const chapterFontSize = 12;

  const maxWidth = A4_WIDTH - 2 * margin;
  const answerIndent = 20;

  let page = pdfDoc.addPage([A4_WIDTH, A4_HEIGHT]);
  let y = A4_HEIGHT - margin;

  const startNewPage = () => {
    page = pdfDoc.addPage([A4_WIDTH, A4_HEIGHT]);
    y = A4_HEIGHT - margin;
  };

  const usablePageHeight = A4_HEIGHT - 2 * margin;

  for (const book of quizBooks) {
    const bookTitle = book.title || 'Quiz';

    // Book heading
    if (y < margin + 3 * lineHeight) {
      startNewPage();
    }

    page.drawText(`Quiz – ${bookTitle}`, {
      x: margin,
      y,
      size: titleFontSize,
      font: boldFont,
    });
    y -= sectionSpacing;

    for (const chapter of book.chapters) {
      if (!chapter.questions || chapter.questions.length === 0) continue;

      // Chapter heading
      if (y < margin + 3 * lineHeight) {
        startNewPage();
      }

      const chapterTitle = chapter.title || 'Kapitel';

      page.drawText(chapterTitle, {
        x: margin,
        y,
        size: chapterFontSize,
        font: boldFont,
      });
      y -= sectionSpacing;

      let questionIndex = 1;

      for (const question of chapter.questions) {
        const questionLabel = `${questionIndex}. ${question.text || ''}`;
        const questionLines = wrapText(
          questionLabel,
          maxWidth,
          bodyFont,
          questionFontSize
        );

        const answers = question.answers || [];
        const allAnswerLines: string[][] = [];
        let totalAnswerLines = 0;

        // Pre-wrap all answers once so we can compute total block height
        for (let i = 0; i < answers.length; i++) {
          const answer = answers[i];
          const letter = String.fromCharCode(65 + i); // A, B, C, ...
          const answerText = `${letter}) ${answer.text || ''}`;
          const answerLines = wrapText(
            answerText,
            maxWidth - answerIndent,
            bodyFont,
            answerFontSize
          );
          allAnswerLines.push(answerLines);
          totalAnswerLines += answerLines.length;
        }

        const questionLinesCount = questionLines.length;
        const totalLinesForBlock = questionLinesCount + totalAnswerLines;
        const blockHeight =
          totalLinesForBlock * lineHeight + questionSpacing;

        const availableHeight = y - margin;

        // Decide whether we *try* to keep this question block together
        const canFitOnFreshPage =
          blockHeight <= usablePageHeight && blockHeight > 0;
        const keepTogether = canFitOnFreshPage;

        if (keepTogether && blockHeight > availableHeight) {
          // Not enough room on this page – start the whole block on a fresh page
          startNewPage();
        }

        // --- Draw question lines ---
        for (const line of questionLines) {
          // If we *can't* keep together, fall back to old per-line page break behavior
          if (!keepTogether && y < margin + 2 * lineHeight) {
            startNewPage();
          }
          page.drawText(line, {
            x: margin,
            y,
            size: questionFontSize,
            font: bodyFont,
          });
          y -= lineHeight;
        }

        // --- Draw answer lines ---
        for (const answerLines of allAnswerLines) {
          for (const line of answerLines) {
            if (!keepTogether && y < margin + 2 * lineHeight) {
              startNewPage();
            }
            page.drawText(line, {
              x: margin + answerIndent,
              y,
              size: answerFontSize,
              font: bodyFont,
            });
            y -= lineHeight;
          }
        }

        y -= questionSpacing;
        questionIndex++;
      }

      y -= sectionSpacing; // gap between chapters
    }

    y -= sectionSpacing; // gap between books
  }

  return pdfDoc;
}

function wrapText(
  text: string,
  maxWidth: number,
  font: PDFFont,
  fontSize: number
): string[] {
  const words = (text || '').split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let currentLine = '';

  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    const testWidth = font.widthOfTextAtSize(testLine, fontSize);

    if (testWidth <= maxWidth) {
      currentLine = testLine;
    } else {
      if (currentLine) {
        lines.push(currentLine);
        currentLine = word;
      } else {
        // Single word longer than max width: hard-break by characters
        let remaining = word;
        while (remaining.length > 0) {
          let low = 1;
          let high = remaining.length;
          let fitChars = 1;

          while (low <= high) {
            const mid = Math.floor((low + high) / 2);
            const piece = remaining.slice(0, mid);
            const w = font.widthOfTextAtSize(piece, fontSize);
            if (w <= maxWidth) {
              fitChars = mid;
              low = mid + 1;
            } else {
              high = mid - 1;
            }
          }

          lines.push(remaining.slice(0, fitChars));
          remaining = remaining.slice(fitChars);
        }
        currentLine = '';
      }
    }
  }

  if (currentLine) {
    lines.push(currentLine);
  }

  return lines.length ? lines : [''];
}

async function appendQuizSolutionPagesToPdf(
  pdfDoc: PDFDocument,
  quizBooks: QuizBook[]
): Promise<PDFDocument> {
  if (!quizBooks || quizBooks.length === 0) {
    return pdfDoc;
  }

  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const margin = 50;
  const headerSpacing = 24;
  const sectionSpacing = 20;
  const solutionLineHeight = 12;

  const titleFontSize = 16;
  const chapterFontSize = 12;
  const solutionFontSize = 10;

  const maxWidth = A4_WIDTH - 2 * margin;
  const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

  // configurable number of solution columns
  const numColumns = 3;
  const columnGap = 20;
  const columnWidth =
    (maxWidth - columnGap * (numColumns - 1)) / numColumns;

  let page = pdfDoc.addPage([A4_WIDTH, A4_HEIGHT]);
  let y = A4_HEIGHT - margin;

  const drawBookHeader = (bookTitle: string) => {
    page.drawText(`Lösungen – ${bookTitle}`, {
      x: margin,
      y,
      size: titleFontSize,
      font: boldFont,
    });
    y -= headerSpacing;
  };

  const drawChapterHeader = (chapterTitle: string) => {
    page.drawText(chapterTitle, {
      x: margin,
      y,
      size: chapterFontSize,
      font: boldFont,
    });
    y -= sectionSpacing;
  };

  const startNewPage = (
    bookTitle?: string,
    chapterTitle?: string
  ) => {
    page = pdfDoc.addPage([A4_WIDTH, A4_HEIGHT]);
    y = A4_HEIGHT - margin;

    if (bookTitle) {
      drawBookHeader(bookTitle);
    }
    if (chapterTitle) {
      drawChapterHeader(chapterTitle);
    }
  };

  for (const book of quizBooks) {
    const bookTitle = book.title || 'Quiz';

    // Book heading
    if (y < margin + 3 * solutionLineHeight) {
      startNewPage(bookTitle);
    } else {
      drawBookHeader(bookTitle);
    }

    for (const chapter of book.chapters) {
      const questions = chapter.questions || [];
      if (questions.length === 0) continue;

      const chapterTitle = chapter.title || 'Kapitel';

      if (y < margin + 3 * solutionLineHeight) {
        startNewPage(bookTitle, chapterTitle);
      } else {
        drawChapterHeader(chapterTitle);
      }

      let rowY = y;
      let colIndex = 0;
      let questionIndex = 1;

      const finishRowIfNeeded = () => {
        if (colIndex !== 0) {
          rowY -= solutionLineHeight;
          colIndex = 0;
        }
      };

      for (const question of questions) {
        const answers = (question.answers || [])
          .slice()
          .sort((a, b) => a.number - b.number);

        let label: string;

        if (!answers.length) {
          label = `${questionIndex}. –`;
        } else {
          const correctIndex = answers.findIndex(
            (a) => a.isCorrect === true
          );

          if (correctIndex === -1) {
            label = `${questionIndex}. –`;
          } else {
            const letter =
              LETTERS[correctIndex] ??
              `#${answers[correctIndex].number}`;
            // number + letter only
            label = `${questionIndex}. ${letter}`;
          }
        }

        // page break if no vertical room for another row
        if (rowY < margin + solutionLineHeight) {
          startNewPage(bookTitle, chapterTitle);
          rowY = y;
          colIndex = 0;
        }

        const x =
          margin + colIndex * (columnWidth + columnGap);

        // Bold number + letter, in 3 columns across
        page.drawText(label, {
          x,
          y: rowY,
          size: solutionFontSize,
          font: boldFont,
        });

        colIndex++;
        if (colIndex >= numColumns) {
          colIndex = 0;
          rowY -= solutionLineHeight;
        }

        questionIndex++;
      }

      // move down after last partially filled row
      finishRowIfNeeded();

      // gap before next chapter
      y = rowY - sectionSpacing;
    }

    // gap between books
    y -= sectionSpacing;
  }

  return pdfDoc;
}
