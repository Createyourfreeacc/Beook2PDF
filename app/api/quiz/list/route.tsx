import { NextResponse } from "next/server";
import Database from "better-sqlite3";
import path from "path";
import os from "os";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const username = os.userInfo().username;
const DB_PATH = path.resolve(
  `C:/Users/${username}/AppData/Roaming/ionesoft/beook/release/profiles/1/data/beook_book_v6.sqlite`
);

type RawRow = {
  // Canonical book (course)
  bookId: number;              // ZILPCOURSEDEF.Z_PK
  bookCourseId: string | null; // ZILPCOURSEDEF.ZCOURSEID
  bookRef: string | null;      // ZILPCOURSEDEF.ZREFERENCE

  // Chapter (issue product)
  chapterId: number;
  chapterTitle: string | null;
  chapterRef: string | null;
  issueId: string | null;

  // Exercise
  exerciseId: number;
  exerciseTitle: string | null;
  exerciseCode: string | null;

  // Question
  questionId: number;
  questionRef: string | null;
  questionText: string | null;

  // Answer
  answerId: number | null;
  answerNumber: number | null;
  answerText: string | null;
  answerIsCorrect: number | null; // 0/1 or null
};

type AssetRow = {
  exerciseId: number;
  resId: number;
  mediaType: string | null;
  data: Buffer | null;
};

function cleanQuestionText(text: string | null): string {
  if (!text) return "";
  return text
    .replace(/\$\{answerBlock\}/g, "")   // remove placeholder
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?[^>]+>/g, "")          // strip other HTML
    .trim();
}

function cleanAnswerText(text: string | null): string {
  if (!text) return "";
  return text
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?[^>]+>/g, "")
    .trim();
}

// For sorting chapters "1 Foo", "2 Bar", "10 Baz" by the leading number
function extractNumberPrefix(title: string | null): number {
  if (!title) return Number.MAX_SAFE_INTEGER;
  const match = title.trim().match(/^(\d+)/);
  return match ? parseInt(match[1], 10) : Number.MAX_SAFE_INTEGER;
}

export async function GET() {
  let db: Database.Database;

  try {
    db = new Database(DB_PATH, { readonly: true });
  } catch (err: any) {
    return NextResponse.json(
      { error: `Failed to open DB at ${DB_PATH}`, details: String(err) },
      { status: 500 }
    );
  }

  try {
    // ------------------------------------------------------------------
    // Course titles from ZILPCOURSESERIES (courseId -> [titles])
    // ------------------------------------------------------------------
    const titleRows = db
      .prepare(
        `
        SELECT "ZCOURSEIDENTIFIER", "ZTITLE"
        FROM "ZILPCOURSESERIES"
        WHERE "ZCOURSEIDENTIFIER" IS NOT NULL
          AND "ZTITLE" IS NOT NULL
        `
      )
      .all();

    const courseIdToTitles = new Map<string, string[]>();
    for (const row of titleRows as any[]) {
      const courseId = row["ZCOURSEIDENTIFIER"]?.toString() ?? "";
      const title = row["ZTITLE"]?.toString() ?? "";
      if (!courseId || !title) continue;
      const arr = courseIdToTitles.get(courseId) ?? [];
      arr.push(title);
      courseIdToTitles.set(courseId, arr);
    }

    const getCourseTitle = (courseId: string | null): string | null => {
      if (!courseId) return null;
      const titles = courseIdToTitles.get(courseId) ?? [];
      return titles.length ? titles[0] : null;
    };

    // ------------------------------------------------------------------
    // Load exercise assets (images) once
    // ------------------------------------------------------------------
    const assetRows = db
      .prepare<[], AssetRow>(
        `
        SELECT
          er."Z_EXERCISES" AS exerciseId,
          r."Z_PK"         AS resId,
          r."ZMEDIATYPE"   AS mediaType,
          r."ZDATA"        AS data
        FROM Z_EXERCISE_RESOURCE er
        JOIN ZILPRESOURCE r
          ON r."Z_PK" = er."Z_RESOURCES"
        `
      )
      .all();

    const exerciseAssets = new Map<
      number,
      { id: number; mediaType: string; dataUrl: string }[]
    >();

    for (const row of assetRows) {
      if (!row.mediaType || !row.data) continue;
      const mediaType = row.mediaType.toLowerCase();
      if (!mediaType.startsWith("image/")) continue; // focus on images for now

      const buf = Buffer.isBuffer(row.data)
        ? row.data
        : Buffer.from(row.data as any);
      const base64 = buf.toString("base64");
      const dataUrl = `data:${row.mediaType};base64,${base64}`;

      const list = exerciseAssets.get(row.exerciseId) ?? [];
      list.push({
        id: row.resId,
        mediaType: row.mediaType,
        dataUrl,
      });
      exerciseAssets.set(row.exerciseId, list);
    }

    // ------------------------------------------------------------------
    // Main query: question + answer + exercise + chapter + book
    // Using: Question -> Exercise -> Issue -> Course
    // ------------------------------------------------------------------
    const rows = db
      .prepare<[], RawRow>(
        `
        SELECT
          -- Book (course)
          cd."Z_PK"                AS bookId,
          cd."ZCOURSEID"           AS bookCourseId,
          cd."ZREFERENCE"          AS bookRef,

          -- Chapter (issue product)
          chap."Z_PK"              AS chapterId,
          chap."ZTITLE"            AS chapterTitle,
          chap."ZPRODUCTREFERENCE" AS chapterRef,
          issue."ZISSUEID"         AS issueId,

          -- Exercise
          ex."Z_PK"                AS exerciseId,
          ex."ZTITLE"              AS exerciseTitle,
          ex."ZEXERCISEID"         AS exerciseCode,

          -- Question
          q."Z_PK"                 AS questionId,
          q."ZREFERENCE"           AS questionRef,
          qd."ZTEXT_DECRYPTED"     AS questionText,

          -- Answer
          ans."Z_PK"               AS answerId,
          ans."ZNUMBER"            AS answerNumber,
          ans."ZANSWER_TEXT"       AS answerText,
          ans."ZCORRECT_DECRYPTED" AS answerIsCorrect

        FROM ZILPQUESTION_DECRYPTED qd
        JOIN ZILPQUESTION q
          ON q."Z_PK" = qd."Z_PK"

        JOIN ZILPEXERCISE ex
          ON ex."Z_PK" = q."ZEXERCISE"

        -- Exercise -> Issue (chapter)
        JOIN ZILPISSUEDEF issue
          ON issue."Z_PK" = ex."ZISSUE"

        -- Issue -> issue-product -> chapter product
        JOIN ZILPISSUEPRODUCT ip
          ON ip."ZISSUEPRODUCT" = issue."ZISSUEPRODUCT"

        JOIN ZILPEPRODUCT chap
          ON chap."Z_PK" = ip."ZEPRODUCT"

        -- Issue -> Course (book)
        JOIN ZILPCOURSEDEF cd
          ON cd."Z_PK" = issue."ZCOURSE"

        -- Answers
        LEFT JOIN ZILPANSWER_DECRYPTED ans
          ON ans."ZQUESTION" = q."Z_PK"
         AND ans."ZTYPE" = 3

        ORDER BY
          cd."ZCOURSEID",
          chap."ZTITLE",
          ex."ZEXERCISEID",
          q."ZREFERENCE",
          ans."ZNUMBER"
        `
      )
      .all();

    db.close();

    // ------------------------------------------------------------------
    // Fold into: book -> chapter -> question -> answers (+ assets)
    // ------------------------------------------------------------------
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
                assets: { id: number; mediaType: string; dataUrl: string }[];
                answers: {
                  id: number;
                  number: number;
                  text: string;
                  isCorrect: boolean | null;
                }[];
              }
            >;
          }
        >;
      }
    >();

    for (const row of rows) {
      // Book
      let book = booksMap.get(row.bookId);
      if (!book) {
        const computedTitle =
          getCourseTitle(row.bookCourseId) ??
          row.bookCourseId ??
          row.bookRef ??
          `Buch ${row.bookId}`;

        book = {
          id: row.bookId,
          courseId: row.bookCourseId,
          ref: row.bookRef,
          title: computedTitle,
          chapters: new Map(),
        };
        booksMap.set(row.bookId, book);
      }

      // Chapter
      let chapter = book.chapters.get(row.chapterId);
      if (!chapter) {
        chapter = {
          id: row.chapterId,
          title:
            row.chapterTitle ??
            row.issueId ??
            row.chapterRef ??
            `Kapitel ${row.chapterId}`,
          ref: row.chapterRef,
          issueId: row.issueId,
          questions: new Map(),
        };
        book.chapters.set(row.chapterId, chapter);
      }

      // Question
      let question = chapter.questions.get(row.questionId);
      if (!question) {
        const assetsForExercise =
          exerciseAssets.get(row.exerciseId) ?? [];

        question = {
          id: row.questionId,
          ref: row.questionRef,
          text: cleanQuestionText(row.questionText),
          exerciseTitle: row.exerciseTitle,
          exerciseCode: row.exerciseCode,
          assets: assetsForExercise,
          answers: [],
        };
        chapter.questions.set(row.questionId, question);
      }

      // Answer
      if (row.answerId != null && row.answerNumber != null) {
        question.answers.push({
          id: row.answerId,
          number: row.answerNumber,
          text: cleanAnswerText(row.answerText),
          isCorrect:
            row.answerIsCorrect === null
              ? null
              : row.answerIsCorrect === 1,
        });
      }
    }

    // Convert maps -> arrays, sort chapters & answers
    const books = Array.from(booksMap.values()).map((book) => ({
      id: book.id,
      title: book.title,
      ref: book.ref,
      chapters: Array.from(book.chapters.values())
        .sort(
          (a, b) =>
            extractNumberPrefix(a.title) - extractNumberPrefix(b.title)
        )
        .map((ch) => ({
          id: ch.id,
          title: ch.title,
          questions: Array.from(ch.questions.values()).map((q) => ({
            id: q.id,
            ref: q.ref,
            text: q.text,
            assets: q.assets,
            answers: [...q.answers].sort(
              (a, b) => a.number - b.number
            ),
          })),
        })),
    }));

    return NextResponse.json({ ok: true, books });
  } catch (err: any) {
    try {
      db.close();
    } catch {}
    return NextResponse.json(
      { error: "Failed to read quiz data", details: String(err) },
      { status: 500 }
    );
  }
}
