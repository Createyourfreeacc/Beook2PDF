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
import fontkit from '@pdf-lib/fontkit';
import { setProgress, setPhaseProgress } from '@/lib/progressStore';
import { getResolvedPaths } from '@/lib/config';
import fs from 'fs';
import path from 'path';
import CryptoJS from 'crypto-js';

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

type QuizAsset = {
  id: number;
  mediaType: string;
  dataUrl: string;
};

type QuizSharedAssetGroup = {
  id: number;
  questionNumbers: number[]; // 1-based indices in this chapter
  pages: QuizAsset[];        // multi-page asset sets
};

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
  assets: QuizAsset[];
};

type QuizChapter = {
  id: number;
  title: string;
  ref: string | null;
  issueId: string | null;
  questions: QuizQuestion[];
  sharedAssets: QuizSharedAssetGroup[];
};

type QuizBook = {
  id: number;               // cd.Z_PK
  courseId: string | null;  // cd.ZCOURSEID
  ref: string | null;       // cd.ZREFERENCE
  title: string;            // nice label taken from your Book object
  lang?: string | null;     // language code
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

type AssetRow = {
  exerciseId: number;
  resId: number;
  mediaType: string | null;
  data: Buffer | null;
};

// Use Montserrat Unicode fonts from assets/fonts for all pdf-lib text we draw
const FONT_DIR = path.join(process.cwd(), 'assets', 'fonts');
const MONT_REGULAR_PATH = path.join(
  FONT_DIR,
  'montserrat-v13-latin_latin-ext-regular.ttf'
);
const MONT_BOLD_PATH = path.join(
  FONT_DIR,
  'montserrat-v13-latin_latin-ext-700.ttf'
);

let montserratRegularBytes: Uint8Array | null = null;
let montserratBoldBytes: Uint8Array | null = null;

function getFontBytes(kind: 'regular' | 'bold'): Uint8Array {
  if (kind === 'regular') {
    if (!montserratRegularBytes) {
      montserratRegularBytes = fs.readFileSync(MONT_REGULAR_PATH);
    }
    return montserratRegularBytes;
  } else {
    if (!montserratBoldBytes) {
      montserratBoldBytes = fs.readFileSync(MONT_BOLD_PATH);
    }
    return montserratBoldBytes;
  }
}

// Helper: get Unicode-capable fonts for this PDF document
async function getUnicodeFonts(
  pdfDoc: PDFDocument
): Promise<{ bodyFont: PDFFont; boldFont: PDFFont }> {
  const regularBytes = getFontBytes('regular');
  const boldBytes = getFontBytes('bold');
  const bodyFont = await pdfDoc.embedFont(regularBytes, { subset: true });
  const boldFont = await pdfDoc.embedFont(boldBytes, { subset: true });
  return { bodyFont, boldFont };
}

// Helper: normalize to NFC so combining marks become precomposed glyphs
function normalizePdfText(text: string | null | undefined): string {
  if (!text) return '';
  return text.normalize('NFC');
}

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
  mergedPdfDoc.registerFontkit(fontkit);

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
  let tocDataAfterQuiz = updatedTocData;

  if (exportQuiz) {
    try {
      setPhaseProgress(jobId, 'quiz-decrypt', 0);
      await ensureQuizDecryptedTablesForExport(books);
      setPhaseProgress(jobId, 'quiz-decrypt', 1);

      const quizBooks = await loadQuizDataForBooks(books);
      if (quizBooks.length > 0) {
        setPhaseProgress(jobId, 'quiz-insert', 0);

        const result = await insertQuizAndSolutionsAtEndOfEachBook(
          pdfDocWithQuiz,
          tocDataAfterQuiz,
          books,
          quizBooks
        );

        pdfDocWithQuiz = result.pdfDoc;
        tocDataAfterQuiz = result.updatedTocData;

        setPhaseProgress(jobId, 'quiz-insert', 1);
      }
    } catch (err) {
      console.error('Failed to insert quiz pages / solutions:', err);
      // fail soft, keep main PDF
    }
  }

  const PdfDoc = await addOutlineToPdf(pdfDocWithQuiz, tocDataAfterQuiz);
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

function formatQuestionNumbers(nums: number[]): string {
  if (!nums || nums.length === 0) return '';
  const sorted = [...nums].sort((a, b) => a - b);
  const ranges: string[] = [];
  let start = sorted[0];
  let prev = sorted[0];

  for (let i = 1; i < sorted.length; i++) {
    const n = sorted[i];
    if (n === prev + 1) {
      prev = n;
      continue;
    }
    if (start === prev) {
      ranges.push(`${start}`);
    } else {
      ranges.push(`${start}–${prev}`);
    }
    start = prev = n;
  }

  if (start === prev) {
    ranges.push(`${start}`);
  } else {
    ranges.push(`${start}–${prev}`);
  }

  return ranges.join(', ');
}

async function loadQuizDataForBooks(books: Book[]): Promise<QuizBook[]> {
  const toggledBooks = books.filter((b) => b.Toggled);
  if (toggledBooks.length === 0) return [];

  // Map cd.Z_PK -> Book (from the UI selection)
  const toggledByPk = new Map<number, Book>();
  const bookIds: number[] = [];

  for (const b of toggledBooks) {
    const n = parseInt(b.BookID, 10);
    if (!Number.isNaN(n)) {
      toggledByPk.set(n, b);
      bookIds.push(n);
    }
  }
  if (bookIds.length === 0) return [];

  const db = sqlite(DB_PATH);
  try {
    const placeholders = bookIds.map(() => '?').join(', ');

    // --------------------------------------------------------------
    // 1) Load exercise assets (images) once, like the Quiz tab
    // --------------------------------------------------------------
    const assetRows = db
      .prepare(
        `
        SELECT
          er."Z_EXERCISES" AS exerciseId,
          er."Z_RESOURCES" AS resId,
          r."ZMEDIATYPE"   AS mediaType,
          r."ZDATA"        AS data
        FROM Z_EXERCISE_RESOURCE er
        LEFT JOIN ZILPRESOURCE r
          ON r."Z_PK" = er."Z_RESOURCES"
      `
      )
      .all() as AssetRow[];

    const assetById = new Map<number, QuizAsset>();
    const exerciseAssetIds = new Map<number, number[]>();

    for (const row of assetRows) {
      if (!row.mediaType || !row.data) continue;
      const mediaType = row.mediaType.toLowerCase();
      if (!mediaType.startsWith('image/')) continue; // only embed images

      let asset = assetById.get(row.resId);
      if (!asset) {
        const buf = Buffer.isBuffer(row.data)
          ? row.data
          : Buffer.from(row.data as any);
        const base64 = buf.toString('base64');
        const dataUrl = `data:${row.mediaType};base64,${base64}`;
        asset = {
          id: row.resId,
          mediaType: row.mediaType,
          dataUrl,
        };
        assetById.set(row.resId, asset);
      }

      const list = exerciseAssetIds.get(row.exerciseId) ?? [];
      list.push(row.resId);
      exerciseAssetIds.set(row.exerciseId, list);
    }

    // --------------------------------------------------------------
    // 2) Main query: Question -> Exercise -> Issue -> Course
    // --------------------------------------------------------------
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

    // --------------------------------------------------------------
    // 3) Aggregate rows → books → chapters → questions (+ assets)
    // --------------------------------------------------------------
    const booksMap = new Map<
      number,
      {
        id: number;
        courseId: string | null;
        ref: string | null;
        title: string;
        lang: string;
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
                assets: QuizAsset[];
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
        const toggledBook = toggledByPk.get(row.bookId);

        const titleFromBooks =
          (toggledBook?.Titel ?? '').toString().trim() ||
          (toggledBook?.CourseName ?? '').toString().trim() ||
          (toggledBook?.Refrence ?? '').toString().trim();

        const finalTitle =
          titleFromBooks ||
          row.bookCourseId ||
          row.bookRef ||
          `Buch ${row.bookId}`;

        // NEW: derive language, default DE
        let lang = (toggledBook as any)?.Lang;
        if (typeof lang !== 'string') lang = 'DE';
        lang = lang.trim().toUpperCase();

        book = {
          id: row.bookId,
          courseId: row.bookCourseId,
          ref: row.bookRef,
          title: finalTitle,
          lang,
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
        const assetIds = exerciseAssetIds.get(row.exerciseId) ?? [];
        const assets = assetIds
          .map((id) => assetById.get(id))
          .filter((a): a is QuizAsset => !!a);

        question = {
          id: row.questionId,
          ref: row.questionRef,
          text: cleanQuizQuestionText(row.questionText),
          exerciseTitle: row.exerciseTitle,
          exerciseCode: row.exerciseCode,
          exerciseId: row.exerciseId,
          assets,
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

    // --------------------------------------------------------------
    // 4) Convert to arrays, sort, and pull out shared assets per chapter
    // --------------------------------------------------------------
    const SHARED_THRESHOLD = 3; // must be used by ≥3 questions to become "shared"

    const quizBooks: QuizBook[] = Array.from(booksMap.values()).map(
      (book) => {
        const chapters: QuizChapter[] = Array.from(book.chapters.values())
          .sort(
            (a, b) =>
              extractQuizChapterNumberPrefix(a.title) -
              extractQuizChapterNumberPrefix(b.title)
          )
          .map((ch) => {
            // questions array (keep current insertion order)
            const questions: QuizQuestion[] = Array.from(
              ch.questions.values()
            ).map((q) => ({
              id: q.id,
              ref: q.ref,
              text: q.text,
              exerciseTitle: q.exerciseTitle,
              exerciseCode: q.exerciseCode,
              exerciseId: q.exerciseId,
              assets: [...q.assets],
              answers: [...q.answers].sort(
                (a, b) => a.number - b.number
              ),
            }));

            // Build asset usage: assetId -> { asset, questionIndices }
            const usage = new Map<
              number,
              { asset: QuizAsset; questionIndices: number[] }
            >();

            questions.forEach((q, idx) => {
              q.assets.forEach((asset) => {
                const existing = usage.get(asset.id);
                if (!existing) {
                  usage.set(asset.id, {
                    asset,
                    questionIndices: [idx + 1], // 1-based
                  });
                } else {
                  existing.questionIndices.push(idx + 1);
                }
              });
            });

            // Group assets by identical question sets to form multi-page groups
            const groupsMap = new Map<
              string,
              { assets: QuizAsset[]; questionNumbers: number[] }
            >();

            for (const { asset, questionIndices } of usage.values()) {
              if (questionIndices.length < SHARED_THRESHOLD) continue;
              const key = questionIndices.join(',');
              let group = groupsMap.get(key);
              if (!group) {
                group = {
                  assets: [],
                  questionNumbers: [...questionIndices],
                };
                groupsMap.set(key, group);
              }
              group.assets.push(asset);
            }

            const sharedGroups = Array.from(groupsMap.values());

            // Remove shared assets from per-question lists
            const sharedIds = new Set<number>();
            sharedGroups.forEach((g) =>
              g.assets.forEach((a) => sharedIds.add(a.id))
            );

            questions.forEach((q) => {
              q.assets = q.assets.filter(
                (a) => !sharedIds.has(a.id)
              );
            });

            const sharedAssets: QuizSharedAssetGroup[] =
              sharedGroups.map((g, idx) => ({
                id: idx,
                questionNumbers: g.questionNumbers,
                pages: g.assets,
              }));

            return {
              id: ch.id,
              title: ch.title,
              ref: ch.ref,
              issueId: ch.issueId,
              questions,
              sharedAssets,
            };
          });

        return {
          id: book.id,
          courseId: book.courseId,
          ref: book.ref,
          title: book.title,
          lang: book.lang,
          chapters,
        };
      }
    );

    return quizBooks;
  } finally {
    db.close();
  }
}

function parseDataUrlToBuffer(
  dataUrl: string
): { mimeType: string; buffer: Uint8Array } | null {
  if (!dataUrl || !dataUrl.startsWith('data:')) return null;
  const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  if (!match) return null;
  const mimeType = match[1];
  const base64 = match[2];
  const buffer = Buffer.from(base64, 'base64');
  return { mimeType, buffer };
}

async function embedQuizImage(
  pdfDoc: PDFDocument,
  asset: QuizAsset,
  cache: Map<number, any>
) {
  if (!asset || !asset.dataUrl || !asset.mediaType) return null;

  const cached = cache.get(asset.id);
  if (cached) return cached;

  const parsed = parseDataUrlToBuffer(asset.dataUrl);
  if (!parsed) return null;

  const { mimeType, buffer } = parsed;
  let image: any;
  try {
    if (mimeType === 'image/png') {
      image = await pdfDoc.embedPng(buffer);
    } else if (
      mimeType === 'image/jpeg' ||
      mimeType === 'image/jpg' ||
      mimeType === 'image/pjpeg'
    ) {
      image = await pdfDoc.embedJpg(buffer);
    } else {
      // unsupported type – skip silently
      return null;
    }
  } catch (err) {
    console.error('Failed to embed quiz image', err);
    return null;
  }

  cache.set(asset.id, image);
  return image;
}

async function appendQuizPagesToPdf(
  pdfDoc: PDFDocument,
  quizBooks: QuizBook[]
): Promise<PDFDocument> {
  if (!quizBooks || quizBooks.length === 0) {
    return pdfDoc;
  }

  const { bodyFont, boldFont } = await getUnicodeFonts(pdfDoc);

  const margin = 50;
  const sectionSpacing = 24;
  const questionSpacing = 6;
  const lineHeight = 12;

  const questionFontSize = 9;
  const answerFontSize = 10;
  const titleFontSize = 16;
  const chapterFontSize = 12;

  const maxTextWidth = A4_WIDTH - 2 * margin;
  const answerIndent = 20;
  const imageGap = 8;

  const usablePageHeight = A4_HEIGHT - 2 * margin;

  let page = pdfDoc.addPage([A4_WIDTH, A4_HEIGHT]);
  let y = A4_HEIGHT - margin;

  const startNewPage = () => {
    page = pdfDoc.addPage([A4_WIDTH, A4_HEIGHT]);
    y = A4_HEIGHT - margin;
  };

  // Cache embedded images so each asset is only embedded once
  const imageCache = new Map<number, any>();

  for (const book of quizBooks) {
    const rawBookTitle = book.title || 'Quiz';

    // language detection
    let lang = (book as any)?.lang || (book as any)?.Lang || 'DE';
    if (typeof lang !== 'string') lang = 'DE';
    lang = lang.trim().toUpperCase();

    let quizLabel: string;
    switch (lang) {
      case 'EN':
        quizLabel = 'Quiz';
        break;
      case 'FR':
        quizLabel = 'Quiz';
        break;
      case 'ES':
        quizLabel = 'Cuestionario';
        break;
      case 'IT':
        quizLabel = 'Quiz';
        break;
      case 'DE':
      default:
        quizLabel = 'Quiz';
        break;
    }

    const headerText = rawBookTitle
      ? `${quizLabel} – ${rawBookTitle}`
      : quizLabel;

    if (y < margin + 3 * lineHeight) {
      startNewPage();
    }

    // Book heading
    page.drawText(normalizePdfText(headerText), {
      x: margin,
      y,
      size: titleFontSize,
      font: boldFont,
    });
    y -= sectionSpacing;

    for (const chapter of book.chapters) {
      const questions = chapter.questions || [];
      if (questions.length === 0) continue;

      if (y < margin + 3 * lineHeight) {
        startNewPage();
      }

      const chapterTitle = normalizePdfText(
        chapter.title || 'Kapitel'
      );

      // Chapter heading
      page.drawText(chapterTitle, {
        x: margin,
        y,
        size: chapterFontSize,
        font: boldFont,
      });
      y -= sectionSpacing;

      // ------------------------------------------------------
      // 1) Shared assets (chapter-level), like in the Quiz tab
      // ------------------------------------------------------
      const sharedGroups = chapter.sharedAssets || [];
      for (const group of sharedGroups) {
        const pages = group.pages || [];

        for (const asset of pages) {
          const image = await embedQuizImage(
            pdfDoc,
            asset,
            imageCache
          );
          if (!image) continue;

          const origWidth = image.width;
          const origHeight = image.height;

          const maxImageWidth = maxTextWidth;
          const maxImageHeight = usablePageHeight * 0.6;

          const scale = Math.min(
            maxImageWidth / origWidth,
            maxImageHeight / origHeight,
            1
          );

          const drawWidth = origWidth * scale;
          const drawHeight = origHeight * scale;

          if (y - drawHeight < margin) {
            startNewPage();
          }

          const xImg = margin + (maxTextWidth - drawWidth) / 2;
          y -= drawHeight;
          page.drawImage(image, {
            x: xImg,
            y,
            width: drawWidth,
            height: drawHeight,
          });
          y -= imageGap;
        }

        let caption: string;
        const formattedNums = group.questionNumbers && group.questionNumbers.length
          ? formatQuestionNumbers(group.questionNumbers)
          : '';

        switch (lang) {
          case 'EN':
            caption = formattedNums
              ? `Material for questions ${formattedNums}`
              : 'Material for multiple questions';
            break;
          case 'FR':
            caption = formattedNums
              ? `Matériel pour les questions ${formattedNums}`
              : 'Matériel pour plusieurs questions';
            break;
          case 'ES':
            caption = formattedNums
              ? `Material para las preguntas ${formattedNums}`
              : 'Material para varias preguntas';
            break;
          case 'IT':
            caption = formattedNums
              ? `Materiale per le domande ${formattedNums}`
              : 'Materiale per più domande';
            break;
          case 'DE':
          default:
            caption = formattedNums
              ? `Material für Fragen ${formattedNums}`
              : 'Material für mehrere Fragen';
            break;
        }

        const captionLines = wrapText(
          normalizePdfText(caption),
          maxTextWidth,
          bodyFont,
          questionFontSize
        );

        for (const line of captionLines) {
          if (y < margin + 2 * lineHeight) {
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

        y -= sectionSpacing;
      }

      // ------------------------------------------------------
      // 2) Questions + per-question assets
      // ------------------------------------------------------
      let questionIndex = 1;

      for (const question of questions) {
        const questionLabel = `${questionIndex}. ${normalizePdfText(
          question.text || ''
        )}`;
        const questionLines = wrapText(
          questionLabel,
          maxTextWidth,
          bodyFont,
          questionFontSize
        );

        const answers = question.answers || [];
        const allAnswerLines: string[][] = [];
        let totalAnswerLines = 0;

        for (let i = 0; i < answers.length; i++) {
          const answer = answers[i];
          const letter = String.fromCharCode(65 + i); // A,B,...
          const answerText = `${letter}) ${normalizePdfText(
            answer.text || ''
          )}`;
          const answerLines = wrapText(
            answerText,
            maxTextWidth - answerIndent,
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
        const canFitOnFreshPage =
          blockHeight <= usablePageHeight && blockHeight > 0;
        const keepTogether = canFitOnFreshPage;

        if (keepTogether && blockHeight > availableHeight) {
          startNewPage();
        }

        // Question text
        for (const line of questionLines) {
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

        // Answers
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

        // Question-specific assets (images)
        const questionAssets = question.assets || [];
        for (const asset of questionAssets) {
          const image = await embedQuizImage(
            pdfDoc,
            asset,
            imageCache
          );
          if (!image) continue;

          const origWidth = image.width;
          const origHeight = image.height;
          const maxImageWidth = maxTextWidth;
          const maxImageHeight = usablePageHeight * 0.6;

          const scale = Math.min(
            maxImageWidth / origWidth,
            maxImageHeight / origHeight,
            1
          );

          const drawWidth = origWidth * scale;
          const drawHeight = origHeight * scale;

          if (y - drawHeight < margin) {
            startNewPage();
          }

          const xImg = margin + (maxTextWidth - drawWidth) / 2;
          y -= drawHeight;
          page.drawImage(image, {
            x: xImg,
            y,
            width: drawWidth,
            height: drawHeight,
          });
          y -= imageGap;
        }

        y -= sectionSpacing / 2;
        questionIndex++;
      }

      y -= sectionSpacing; // between chapters
    }

    y -= sectionSpacing; // between books
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

  const { boldFont } = await getUnicodeFonts(pdfDoc);

  const margin = 50;
  const headerSpacing = 24;
  const sectionSpacing = 20;
  const solutionLineHeight = 12;

  const titleFontSize = 16;
  const chapterFontSize = 12;
  const solutionFontSize = 10;

  const maxWidth = A4_WIDTH - 2 * margin;
  const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

  const numColumns = 3;
  const columnGap = 20;
  const columnWidth =
    (maxWidth - columnGap * (numColumns - 1)) / numColumns;

  let page = pdfDoc.addPage([A4_WIDTH, A4_HEIGHT]);
  let y = A4_HEIGHT - margin;

  let currentLang: string = 'DE';

  const drawBookHeader = (bookTitle: string) => {
    let headerLabel: string;
    switch (currentLang) {
      case 'EN':
        headerLabel = 'Solutions';
        break;
      case 'FR':
        headerLabel = 'Solutions';
        break;
      case 'ES':
        headerLabel = 'Soluciones';
        break;
      case 'IT':
        headerLabel = 'Soluzioni';
        break;
      case 'DE':
      default:
        headerLabel = 'Lösungen';
        break;
    }

    const fullTitle = bookTitle
      ? `${headerLabel} – ${bookTitle}`
      : headerLabel;

    page.drawText(normalizePdfText(fullTitle), {
      x: margin,
      y,
      size: titleFontSize,
      font: boldFont,
    });
    y -= headerSpacing;
  };

  const drawChapterHeader = (chapterTitle: string) => {
    page.drawText(normalizePdfText(chapterTitle), {
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

    let lang = (book as any)?.lang || (book as any)?.Lang || 'DE';
    if (typeof lang !== 'string') lang = 'DE';
    currentLang = lang.trim().toUpperCase();

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
            label = `${questionIndex}. ${letter}`;
          }
        }

        if (rowY < margin + solutionLineHeight) {
          startNewPage(bookTitle, chapterTitle);
          rowY = y;
          colIndex = 0;
        }

        const x =
          margin + colIndex * (columnWidth + columnGap);

        page.drawText(normalizePdfText(label), {
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

      finishRowIfNeeded();
      y = rowY - sectionSpacing;
    }

    y -= sectionSpacing;
  }

  return pdfDoc;
}

// ==========================================================================
// QUIZ DECRYPT (export-side)
// Ensures ZILPQUESTION_DECRYPTED + ZILPANSWER_DECRYPTED exist + are populated
// for the currently exported issues.
// Reuses logic from /api/quiz/decrypt, but scopes work to selected issues.
// ==========================================================================

const QUIZ_KEY_STRING = 'fdäK?s^dw-+ç,W!El';
const QUIZ_IV_STRING = '/D}$2al!';

function decryptStoredQA(stored: string) {
  if (!stored || stored.length <= 3) return { idString: null as string | null, plaintext: null as string | null };

  const base64Payload = stored.substring(3);

  try {
    const key = CryptoJS.enc.Utf8.parse(QUIZ_KEY_STRING.substring(0, 8));
    const iv = CryptoJS.enc.Utf8.parse(QUIZ_IV_STRING);

    const decrypted = CryptoJS.DES.decrypt(
      { ciphertext: CryptoJS.enc.Base64.parse(base64Payload) },
      key,
      { iv, mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7 }
    );

    const text = decrypted.toString(CryptoJS.enc.Utf8);
    if (!text) return { idString: null, plaintext: null };

    const idx = text.indexOf(':');
    if (idx === -1) return { idString: null, plaintext: text };

    return { idString: text.substring(0, idx), plaintext: text.substring(idx + 1) };
  } catch {
    return { idString: null, plaintext: null };
  }
}

function parseDecryptedAnswerPayload(plaintext: string | null): {
  isCorrect: number | null;
  letter: string | null;
  text: string | null;
} {
  if (!plaintext) return { isCorrect: null, letter: null, text: null };

  const trimmed = plaintext.trim();
  const match = /^([01])=([a-zA-Z])\)\s*(.*)$/.exec(trimmed);

  if (!match) {
    return { isCorrect: null, letter: null, text: trimmed.length ? trimmed : null };
  }

  const [, flag, letter, rest] = match;
  return {
    isCorrect: flag === '1' ? 1 : 0,
    letter,
    text: rest.trim().length ? rest.trim() : null,
  };
}

function ensureTableExistsFromBase(db: any, decryptedTable: string, baseTable: string) {
  const exists = !!db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
    .get(decryptedTable);

  if (!exists) {
    db.exec(`CREATE TABLE ${decryptedTable} AS SELECT * FROM ${baseTable} WHERE 0;`);
  }
}

function ensureColumn(db: any, table: string, colDefSql: string) {
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${colDefSql};`);
  } catch {
    // ignore "duplicate column" errors
  }
}

function getBaseColumnNames(db: any, baseTable: string): string[] {
  const info = db.prepare(`PRAGMA table_info(${baseTable})`).all() as any[];
  return info.map((c) => c.name).filter(Boolean);
}

async function ensureQuizDecryptedTablesForExport(books: Book[]) {
  // Only decrypt for issues we actually export
  const issueIds = Array.from(
    new Set(
      books
        .filter((b) => b.Toggled)
        .flatMap((b) => b.Issue)
        .map((n) => Number(n))
        .filter((n) => Number.isFinite(n))
    )
  );

  if (issueIds.length === 0) return { ok: true, issues: 0, updatedQuestions: 0, updatedAnswers: 0 };

  // open writable (needed to create/populate decrypted tables)
  const db = sqlite(DB_PATH, { readonly: false });

  try {
    // Guard: base tables must exist
    const hasAnswer = !!db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='ZILPANSWER'`)
      .get();
    const hasQuestion = !!db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='ZILPQUESTION'`)
      .get();

    if (!hasAnswer || !hasQuestion) {
      return { ok: false, issues: issueIds.length, error: 'Missing ZILPANSWER or ZILPQUESTION base tables.' };
    }

    // Ensure decrypted tables exist (don’t wipe them)
    ensureTableExistsFromBase(db, 'ZILPANSWER_DECRYPTED', 'ZILPANSWER');
    ensureTableExistsFromBase(db, 'ZILPQUESTION_DECRYPTED', 'ZILPQUESTION');

    // Ensure required decrypted columns exist
    ensureColumn(db, 'ZILPANSWER_DECRYPTED', 'ZTEXT_DECRYPTED TEXT');
    ensureColumn(db, 'ZILPANSWER_DECRYPTED', 'ZIDSTRING TEXT');
    ensureColumn(db, 'ZILPANSWER_DECRYPTED', 'ZCORRECT_DECRYPTED INTEGER');
    ensureColumn(db, 'ZILPANSWER_DECRYPTED', 'ZANSWER_LETTER TEXT');
    ensureColumn(db, 'ZILPANSWER_DECRYPTED', 'ZANSWER_TEXT TEXT');

    ensureColumn(db, 'ZILPQUESTION_DECRYPTED', 'ZTEXT_DECRYPTED TEXT');
    ensureColumn(db, 'ZILPQUESTION_DECRYPTED', 'ZIDSTRING TEXT');

    const placeholders = issueIds.map(() => '?').join(', ');

    // ---- QUESTIONS (scoped by issue) ----
    // Delete existing decrypted rows for these issues so we can refresh cleanly
    db.prepare(
      `
      DELETE FROM ZILPQUESTION_DECRYPTED
      WHERE Z_PK IN (
        SELECT q."Z_PK"
        FROM ZILPQUESTION q
        JOIN ZILPEXERCISE ex ON ex."Z_PK" = q."ZEXERCISE"
        WHERE ex."ZISSUE" IN (${placeholders})
      )
      `
    ).run(...issueIds);

    const qColNames = getBaseColumnNames(db, 'ZILPQUESTION');
    const qBaseCols = qColNames.join(', ');
    const qPlaceholders = qColNames.map((n) => `@${n}`).join(', ') + ', @ZTEXT_DECRYPTED, @ZIDSTRING';

    const qInsert = db.prepare(
      `INSERT INTO ZILPQUESTION_DECRYPTED (${qBaseCols}, ZTEXT_DECRYPTED, ZIDSTRING) VALUES (${qPlaceholders})`
    );

    const qRows = db
      .prepare(
        `
        SELECT q.*
        FROM ZILPQUESTION q
        JOIN ZILPEXERCISE ex ON ex."Z_PK" = q."ZEXERCISE"
        WHERE ex."ZISSUE" IN (${placeholders})
        `
      )
      .all(...issueIds) as any[];

    let updatedQuestions = 0;

    const qTx = db.transaction((rows: any[]) => {
      for (const row of rows) {
        const raw = typeof row.ZTEXT === 'string' ? row.ZTEXT : null;

        let ZTEXT_DECRYPTED: string | null = null;
        let ZIDSTRING: string | null = null;

        if (raw && (raw.startsWith('AT$') || raw.startsWith('QT$'))) {
          const { idString, plaintext } = decryptStoredQA(raw);
          if (plaintext != null) {
            ZTEXT_DECRYPTED = plaintext;
            ZIDSTRING = idString;
          }
        } else if (raw) {
          // fallback: some rows might not be prefixed; keep plaintext so joins still work
          ZTEXT_DECRYPTED = raw;
        }

        qInsert.run({ ...row, ZTEXT_DECRYPTED, ZIDSTRING });
        updatedQuestions++;
      }
    });

    qTx(qRows);

    // ---- ANSWERS (scoped by issue) ----
    db.prepare(
      `
      DELETE FROM ZILPANSWER_DECRYPTED
      WHERE Z_PK IN (
        SELECT a."Z_PK"
        FROM ZILPANSWER a
        JOIN ZILPQUESTION q ON q."Z_PK" = a."ZQUESTION"
        JOIN ZILPEXERCISE ex ON ex."Z_PK" = q."ZEXERCISE"
        WHERE ex."ZISSUE" IN (${placeholders})
      )
      `
    ).run(...issueIds);

    const aColNames = getBaseColumnNames(db, 'ZILPANSWER');
    const aBaseCols = aColNames.join(', ');
    const aPlaceholders =
      aColNames.map((n) => `@${n}`).join(', ') +
      ', @ZTEXT_DECRYPTED, @ZIDSTRING, @ZCORRECT_DECRYPTED, @ZANSWER_LETTER, @ZANSWER_TEXT';

    const aInsert = db.prepare(
      `INSERT INTO ZILPANSWER_DECRYPTED (${aBaseCols}, ZTEXT_DECRYPTED, ZIDSTRING, ZCORRECT_DECRYPTED, ZANSWER_LETTER, ZANSWER_TEXT)
       VALUES (${aPlaceholders})`
    );

    const aRows = db
      .prepare(
        `
        SELECT a.*
        FROM ZILPANSWER a
        JOIN ZILPQUESTION q ON q."Z_PK" = a."ZQUESTION"
        JOIN ZILPEXERCISE ex ON ex."Z_PK" = q."ZEXERCISE"
        WHERE ex."ZISSUE" IN (${placeholders})
        `
      )
      .all(...issueIds) as any[];

    let updatedAnswers = 0;

    const aTx = db.transaction((rows: any[]) => {
      for (const row of rows) {
        const raw = typeof row.ZTEXT === 'string' ? row.ZTEXT : null;

        let ZTEXT_DECRYPTED: string | null = null;
        let ZIDSTRING: string | null = null;
        let ZCORRECT_DECRYPTED: number | null = null;
        let ZANSWER_LETTER: string | null = null;
        let ZANSWER_TEXT: string | null = null;

        if (raw && (raw.startsWith('AT$') || raw.startsWith('QT$'))) {
          const { idString, plaintext } = decryptStoredQA(raw);
          if (plaintext != null) {
            ZTEXT_DECRYPTED = plaintext;
            ZIDSTRING = idString;

            const parsed = parseDecryptedAnswerPayload(plaintext);
            ZCORRECT_DECRYPTED = parsed.isCorrect;
            ZANSWER_LETTER = parsed.letter;
            ZANSWER_TEXT = parsed.text;
          }
        } else if (raw) {
          ZTEXT_DECRYPTED = raw;
          const parsed = parseDecryptedAnswerPayload(raw);
          ZCORRECT_DECRYPTED = parsed.isCorrect;
          ZANSWER_LETTER = parsed.letter;
          ZANSWER_TEXT = parsed.text;
        }

        aInsert.run({
          ...row,
          ZTEXT_DECRYPTED,
          ZIDSTRING,
          ZCORRECT_DECRYPTED,
          ZANSWER_LETTER,
          ZANSWER_TEXT,
        });

        updatedAnswers++;
      }
    });

    aTx(aRows);

    return { ok: true, issues: issueIds.length, updatedQuestions, updatedAnswers };
  } finally {
    db.close();
  }
}

function getMinPdfPageOfBookGroup(group: MergedTOCEntry[] | undefined): number | null {
  if (!group || group.length === 0) return null;

  let min = Number.POSITIVE_INFINITY;
  for (const [pdfPage] of group) {
    const p = Number(pdfPage);
    if (Number.isFinite(p) && p > 0 && p < min) min = p;
  }
  return min === Number.POSITIVE_INFINITY ? null : min;
}

function findInsertBeforeForBookEnd(
  tocData: MergedTOCEntry[][],
  bookIdx: number,
  pageCount: number
): number {
  // Insert before the next book's first page (based on TOC groups)
  for (let j = bookIdx + 1; j < tocData.length; j++) {
    const nextStart = getMinPdfPageOfBookGroup(tocData[j]);
    if (nextStart != null) return nextStart;
  }
  // Last book -> append to end
  return pageCount + 1;
}

function shiftTocDataForBooksAfter(
  tocData: MergedTOCEntry[][],
  fromBookIdxExclusive: number,
  deltaPages: number
) {
  if (!deltaPages) return;

  for (let b = fromBookIdxExclusive + 1; b < tocData.length; b++) {
    const group = tocData[b];
    if (!group) continue;

    for (const entry of group) {
      entry[0] += deltaPages;
    }
  }
}

async function insertQuizAndSolutionsAtEndOfEachBook(
  pdfDoc: PDFDocument,
  tocData: MergedTOCEntry[][],
  books: Book[],
  quizBooks: QuizBook[]
): Promise<{ pdfDoc: PDFDocument; updatedTocData: MergedTOCEntry[][] }> {
  const toggledBooks = books.filter((b) => b.Toggled);
  const groupCount = Math.min(toggledBooks.length, tocData.length);
  if (groupCount === 0) return { pdfDoc, updatedTocData: tocData };

  // Map quiz book by cd.Z_PK (which matches Book.BookID in your UI list)
  const quizByBookId = new Map<number, QuizBook>();
  for (const qb of quizBooks) quizByBookId.set(qb.id, qb);

  // Reuse embedded fonts + image cache across all inserted quiz pages
  const fonts = await getUnicodeFonts(pdfDoc);
  const imageCache = new Map<number, any>();

  for (let bookIdx = 0; bookIdx < groupCount; bookIdx++) {
    const uiBook = toggledBooks[bookIdx];
    const bookId = parseInt(uiBook.BookID, 10);
    if (Number.isNaN(bookId)) continue;

    const quizBook = quizByBookId.get(bookId);
    if (!quizBook) continue; // no quiz for this book -> no insertion, no shifting

    const insertBefore1Based = findInsertBeforeForBookEnd(
      tocData,
      bookIdx,
      pdfDoc.getPageCount()
    );
    const insertIndex0Based = insertBefore1Based - 1;

    const insertedPages = await insertQuizAndSolutionsForSingleBookAtIndex(
      pdfDoc,
      quizBook,
      insertIndex0Based,
      fonts,
      imageCache
    );

    if (insertedPages > 0) {
      // shift TOC for all subsequent books so outlines remain correct
      shiftTocDataForBooksAfter(tocData, bookIdx, insertedPages);
    }
  }

  return { pdfDoc, updatedTocData: tocData };
}

async function insertQuizAndSolutionsForSingleBookAtIndex(
  pdfDoc: PDFDocument,
  book: QuizBook,
  insertIndex0Based: number,
  fonts: { bodyFont: PDFFont; boldFont: PDFFont },
  imageCache: Map<number, any>
): Promise<number> {
  const { bodyFont, boldFont } = fonts;

  // Only include chapters with questions
  const chapters = (book.chapters || []).filter((c) => (c.questions || []).length > 0);
  if (chapters.length === 0) return 0;

  // ---------- shared layout ----------
  const margin = 50;
  const sectionSpacing = 24;
  const questionSpacing = 6;
  const lineHeight = 12;

  const questionFontSize = 9;
  const answerFontSize = 10;
  const titleFontSize = 16;
  const chapterFontSize = 12;

  const maxTextWidth = A4_WIDTH - 2 * margin;
  const answerIndent = 20;
  const imageGap = 8;
  const usablePageHeight = A4_HEIGHT - 2 * margin;

  let inserted = 0;
  let cursorInsertIndex = insertIndex0Based;

  const insertNewPage = () => {
    const p = pdfDoc.insertPage(cursorInsertIndex, [A4_WIDTH, A4_HEIGHT]);
    cursorInsertIndex += 1;
    inserted += 1;
    return p;
  };

  // language detection
  let lang = (book as any)?.lang || (book as any)?.Lang || 'DE';
  if (typeof lang !== 'string') lang = 'DE';
  lang = lang.trim().toUpperCase();

  let quizLabel: string;
  switch (lang) {
    case 'ES': quizLabel = 'Cuestionario'; break;
    default: quizLabel = 'Quiz'; break;
  }

  // ============================================================
  // PART A) QUIZ PAGES (end-of-book)
  // ============================================================
  let page = insertNewPage();
  let y = A4_HEIGHT - margin;

  const headerText = book.title ? `${quizLabel} – ${book.title}` : quizLabel;

  page.drawText(normalizePdfText(headerText), {
    x: margin,
    y,
    size: titleFontSize,
    font: boldFont,
  });
  y -= sectionSpacing;

  for (const chapter of chapters) {
    if (y < margin + 3 * lineHeight) {
      page = insertNewPage();
      y = A4_HEIGHT - margin;
    }

    const chapterTitle = normalizePdfText(chapter.title || 'Kapitel');

    page.drawText(chapterTitle, {
      x: margin,
      y,
      size: chapterFontSize,
      font: boldFont,
    });
    y -= sectionSpacing;

    // 1) Shared assets (chapter-level)
    const sharedGroups = chapter.sharedAssets || [];
    for (const group of sharedGroups) {
      const pages = group.pages || [];
      for (const asset of pages) {
        const image = await embedQuizImage(pdfDoc, asset, imageCache);
        if (!image) continue;

        const maxImageWidth = maxTextWidth;
        const maxImageHeight = usablePageHeight * 0.6;

        const scale = Math.min(
          maxImageWidth / image.width,
          maxImageHeight / image.height,
          1
        );

        const drawWidth = image.width * scale;
        const drawHeight = image.height * scale;

        if (y - drawHeight < margin) {
          page = insertNewPage();
          y = A4_HEIGHT - margin;
        }

        const xImg = margin + (maxTextWidth - drawWidth) / 2;
        y -= drawHeight;

        page.drawImage(image, {
          x: xImg,
          y,
          width: drawWidth,
          height: drawHeight,
        });

        y -= imageGap;
      }

      const formattedNums =
        group.questionNumbers && group.questionNumbers.length
          ? formatQuestionNumbers(group.questionNumbers)
          : '';

      let caption: string;
      switch (lang) {
        case 'EN':
          caption = formattedNums
            ? `Material for questions ${formattedNums}`
            : 'Material for multiple questions';
          break;
        case 'ES':
          caption = formattedNums
            ? `Material para las preguntas ${formattedNums}`
            : 'Material para varias preguntas';
          break;
        default:
          caption = formattedNums
            ? `Material für Fragen ${formattedNums}`
            : 'Material für mehrere Fragen';
          break;
      }

      const captionLines = wrapText(
        normalizePdfText(caption),
        maxTextWidth,
        bodyFont,
        questionFontSize
      );

      for (const line of captionLines) {
        if (y < margin + 2 * lineHeight) {
          page = insertNewPage();
          y = A4_HEIGHT - margin;
        }
        page.drawText(line, {
          x: margin,
          y,
          size: questionFontSize,
          font: bodyFont,
        });
        y -= lineHeight;
      }

      y -= sectionSpacing;
    }

    // 2) Questions + per-question assets
    let questionIndex = 1;
    for (const question of chapter.questions || []) {
      const questionLabel = `${questionIndex}. ${normalizePdfText(question.text || '')}`;
      const questionLines = wrapText(
        questionLabel,
        maxTextWidth,
        bodyFont,
        questionFontSize
      );

      const answers = question.answers || [];
      const allAnswerLines: string[][] = [];
      let totalAnswerLines = 0;

      for (let i = 0; i < answers.length; i++) {
        const answer = answers[i];
        const letter = String.fromCharCode(65 + i); // A,B,...
        const answerText = `${letter}) ${normalizePdfText(answer.text || '')}`;
        const answerLines = wrapText(
          answerText,
          maxTextWidth - answerIndent,
          bodyFont,
          answerFontSize
        );
        allAnswerLines.push(answerLines);
        totalAnswerLines += answerLines.length;
      }

      const totalLinesForBlock = questionLines.length + totalAnswerLines;
      const blockHeight = totalLinesForBlock * lineHeight + questionSpacing;
      const availableHeight = y - margin;
      const canFitOnFreshPage = blockHeight <= usablePageHeight && blockHeight > 0;
      const keepTogether = canFitOnFreshPage;

      if (keepTogether && blockHeight > availableHeight) {
        page = insertNewPage();
        y = A4_HEIGHT - margin;
      }

      for (const line of questionLines) {
        if (!keepTogether && y < margin + 2 * lineHeight) {
          page = insertNewPage();
          y = A4_HEIGHT - margin;
        }
        page.drawText(line, {
          x: margin,
          y,
          size: questionFontSize,
          font: bodyFont,
        });
        y -= lineHeight;
      }

      for (const answerLines of allAnswerLines) {
        for (const line of answerLines) {
          if (!keepTogether && y < margin + 2 * lineHeight) {
            page = insertNewPage();
            y = A4_HEIGHT - margin;
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

      // Question-specific assets
      for (const asset of question.assets || []) {
        const image = await embedQuizImage(pdfDoc, asset, imageCache);
        if (!image) continue;

        const maxImageWidth = maxTextWidth;
        const maxImageHeight = usablePageHeight * 0.6;

        const scale = Math.min(
          maxImageWidth / image.width,
          maxImageHeight / image.height,
          1
        );

        const drawWidth = image.width * scale;
        const drawHeight = image.height * scale;

        if (y - drawHeight < margin) {
          page = insertNewPage();
          y = A4_HEIGHT - margin;
        }

        const xImg = margin + (maxTextWidth - drawWidth) / 2;
        y -= drawHeight;

        page.drawImage(image, {
          x: xImg,
          y,
          width: drawWidth,
          height: drawHeight,
        });

        y -= imageGap;
      }

      y -= sectionSpacing / 2;
      questionIndex++;
    }

    y -= sectionSpacing;
  }

  // ============================================================
  // PART B) SOLUTIONS PAGES (immediately after quiz pages)
  // ============================================================
  page = insertNewPage();
  y = A4_HEIGHT - margin;

  let solutionsLabel: string;
  switch (lang) {
    case 'EN': solutionsLabel = 'Solutions'; break;
    case 'ES': solutionsLabel = 'Soluciones'; break;
    default: solutionsLabel = 'Lösungen'; break;
  }

  const solutionsHeader = book.title ? `${solutionsLabel} – ${book.title}` : solutionsLabel;

  page.drawText(normalizePdfText(solutionsHeader), {
    x: margin,
    y,
    size: 16,
    font: boldFont,
  });
  y -= 24;

  const solutionLineHeight = 12;
  const solutionFontSize = 10;
  const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

  const maxWidth = A4_WIDTH - 2 * margin;
  const numColumns = 3;
  const columnGap = 20;
  const columnWidth = (maxWidth - columnGap * (numColumns - 1)) / numColumns;

  const startSolutionsPage = (chapterTitle?: string) => {
    page = insertNewPage();
    y = A4_HEIGHT - margin;

    page.drawText(normalizePdfText(solutionsHeader), {
      x: margin,
      y,
      size: 16,
      font: boldFont,
    });
    y -= 24;

    if (chapterTitle) {
      page.drawText(normalizePdfText(chapterTitle), {
        x: margin,
        y,
        size: 12,
        font: boldFont,
      });
      y -= 20;
    }
  };

  for (const chapter of chapters) {
    const chapterTitle = chapter.title || 'Kapitel';

    if (y < margin + 3 * solutionLineHeight) {
      startSolutionsPage(chapterTitle);
    } else {
      page.drawText(normalizePdfText(chapterTitle), {
        x: margin,
        y,
        size: 12,
        font: boldFont,
      });
      y -= 20;
    }

    let rowY = y;
    let colIndex = 0;
    let qIdx = 1;

    for (const question of chapter.questions || []) {
      const answers = (question.answers || []).slice().sort((a, b) => a.number - b.number);
      let label: string;

      const correctIndex = answers.findIndex((a) => a.isCorrect === true);
      if (correctIndex === -1) {
        label = `${qIdx}. –`;
      } else {
        const letter = LETTERS[correctIndex] ?? `#${answers[correctIndex].number}`;
        label = `${qIdx}. ${letter}`;
      }

      if (rowY < margin + solutionLineHeight) {
        startSolutionsPage(chapterTitle);
        rowY = y;
        colIndex = 0;
      }

      const x = margin + colIndex * (columnWidth + columnGap);
      page.drawText(normalizePdfText(label), {
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

      qIdx++;
    }

    // move y forward for next chapter
    if (colIndex !== 0) rowY -= solutionLineHeight;
    y = rowY - 20;
  }

  return inserted;
}

