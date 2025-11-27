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
  // Canonical book (course) – aligned with /api/getBooks
  bookId: number;              // ZILPCOURSEDEF.Z_PK
  bookCourseId: string | null; // ZILPCOURSEDEF.ZCOURSEID (e.g. "PPL020H")
  bookRef: string | null;      // ZILPCOURSEDEF.ZREFERENCE

  // Real chapter (issue product)
  chapterId: number;
  chapterTitle: string | null;
  chapterRef: string | null;
  issueId: string | null;

  // Exercise inside the chapter
  exerciseId: number;
  exerciseTitle: string | null;
  exerciseCode: string | null; // ZEXERCISEID like "010-3.3-02"

  // Question
  questionId: number;
  questionRef: string | null;
  questionText: string | null;

  // Answer
  answerId: number | null;
  answerNumber: number | null;
  answerText: string | null;        // from ZANSWER_TEXT
  answerIsCorrect: number | null;   // from ZCORRECT_DECRYPTED
};

function cleanQuestionText(text: string | null): string {
  if (!text) return "";
  // Strip the ${answerBlock} placeholder and basic <br> tags
  return text
    .replace(/\$\{answerBlock\}/g, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?[^>]+>/g, "") // strip other HTML tags if any
    .trim();
}

function cleanAnswerText(text: string | null): string {
  if (!text) return "";
  return text
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?[^>]+>/g, "")
    .trim();
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
    // --------------------------------------------------------------------
    // Canonical books (courses), same base as /api/getBooks
    // --------------------------------------------------------------------
    // Map courseId -> array of localized titles (from ZILPCOURSESERIES)
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

    // Map canonical bookId (ZILPCOURSEDEF.Z_PK) -> book meta
    const courseDefRows = db
      .prepare(
        `
        SELECT
          "Z_PK"          AS bookId,
          "ZCOURSEID"     AS courseId,
          "ZREFERENCE"    AS courseRef
        FROM "ZILPCOURSEDEF"
        WHERE "Z_PK" IS NOT NULL
        `
      )
      .all() as any[];

    const canonicalBooks = new Map<
      number,
      { id: number; title: string; courseId: string | null; ref: string | null }
    >();

    for (const row of courseDefRows) {
      const id = Number(row.bookId);
      const courseId: string | null =
        row.courseId != null ? String(row.courseId) : null;
      const ref: string | null =
        row.bookRef != null ? String(row.bookRef) : null;

      const titles = courseId ? courseIdToTitles.get(courseId) : undefined;
      const title =
        titles?.[0] ??
        courseId ??
        ref ??
        `Book ${id}`;

      canonicalBooks.set(id, {
        id,
        title,
        courseId,
        ref,
      });
    }

    // Pull **decrypted** questions & answers and map them to book/exercise
    // NOTE: assumes /api/quiz/decrypt has already created and populated:
    //   ZILPQUESTION_DECRYPTED, ZILPANSWER_DECRYPTED
    const rows = db
      .prepare<[], RawRow>(
        `
        SELECT
          -- Canonical book (course)
          cd."Z_PK"               AS bookId,
          cd."ZCOURSEID"          AS bookCourseId,
          cd."ZREFERENCE"         AS bookRef,

          -- Real chapter (issue product)
          chap."Z_PK"             AS chapterId,
          chap."ZTITLE"           AS chapterTitle,
          chap."ZPRODUCTREFERENCE" AS chapterRef,
          issue."ZISSUEID"        AS issueId,

          -- Exercise
          ex."Z_PK"               AS exerciseId,
          ex."ZTITLE"             AS exerciseTitle,
          ex."ZEXERCISEID"        AS exerciseCode,

          -- Question
          q."Z_PK"                AS questionId,
          q."ZREFERENCE"          AS questionRef,
          qd."ZTEXT_DECRYPTED"    AS questionText,

          -- Answer
          ans."Z_PK"              AS answerId,
          ans."ZNUMBER"           AS answerNumber,
          ans."ZANSWER_TEXT"      AS answerText,
          ans."ZCORRECT_DECRYPTED" AS answerIsCorrect

        FROM ZILPQUESTION_DECRYPTED qd
        JOIN ZILPQUESTION q
          ON q."Z_PK" = qd."Z_PK"

        JOIN ZILPEXERCISE ex
          ON ex."Z_PK" = q."ZEXERCISE"

        -- Link exercise -> issue (chapter)
        JOIN ZILPISSUEDEF issue
          ON issue."Z_PK" = ex."ZISSUE"

        -- Map issue -> issue-product -> chapter product
        JOIN ZILPISSUEPRODUCT ip
          ON ip."ZISSUEPRODUCT" = issue."ZISSUEPRODUCT"

        JOIN ZILPEPRODUCT chap
          ON chap."Z_PK" = ip."ZEPRODUCT"

        -- Map exercise -> course product -> course def (canonical book)
        JOIN ZILPTOPICDEFINITION td
          ON td."Z_PK" = ex."ZTOPICDEFINITION"

        JOIN ZILPCOURSEPRODUCT cp
          ON td."ZRELATIVEFILEPATH" LIKE '%' || '/courses/' || cp."ZCOURSEIDENTIFIER" || '/' || '%'

        JOIN ZILPCOURSEDEF cd
          ON cd."ZREFERENCE" = cp."ZCOURSEREFERENCE"

        LEFT JOIN ZILPANSWER_DECRYPTED ans
          ON ans."ZQUESTION" = q."Z_PK"
         AND ans."ZTYPE" = 3  -- only real answer options

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

    // Now build nested structure: book -> chapter(exercise) -> question -> answers
    const booksMap = new Map<
      number,
      {
        id: number;
        title: string;
        ref: string | null;
        chapters: Map<
          number,
          {
            id: number;
            title: string;
            questions: Map<
              number,
              {
                id: number;
                ref: string | null;
                text: string;
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
      // Book (canonical course def)
      let book = booksMap.get(row.bookId);
      if (!book) {
        const canonical = canonicalBooks.get(row.bookId);

        book = {
          id: row.bookId,
          title:
            canonical?.title ??
            row.bookCourseId ??
            "Unknown Book",
          ref:
            canonical?.ref ??
            row.bookRef ??
            row.bookCourseId,
          chapters: new Map(),
        };
        booksMap.set(row.bookId, book);
      }

      // Chapter = actual book chapter (issue product)
      let chapter = book.chapters.get(row.chapterId);
      if (!chapter) {
        chapter = {
          id: row.chapterId,
          // Prefer the real chapter title, fall back to issueId or generic
          title:
            row.chapterTitle ??
            row.issueId ??
            "Unknown Chapter",
          questions: new Map(),
        };
        book.chapters.set(row.chapterId, chapter);
      }

      // Question
      let question = chapter.questions.get(row.questionId);
      if (!question) {
        question = {
          id: row.questionId,
          ref: row.questionRef,
          text: cleanQuestionText(row.questionText),
          answers: [],
        };
        chapter.questions.set(row.questionId, question);
      }

      // Answer (may be null if no answers in row)
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

    // Ensure all canonical books exist, even if they have no exercises
    for (const canonical of canonicalBooks.values()) {
      if (!booksMap.has(canonical.id)) {
        booksMap.set(canonical.id, {
          id: canonical.id,
          title: canonical.title,
          ref: canonical.ref,
          chapters: new Map(),
        });
      }
    }

    // Convert nested Maps → plain arrays for JSON
    const books = Array.from(booksMap.values()).map((b) => ({
      id: b.id,
      title: b.title,
      ref: b.ref,
      chapters: Array.from(b.chapters.values()).map((ch) => ({
        id: ch.id,
        title: ch.title,
        questions: Array.from(ch.questions.values()).map((q) => ({
          ...q,
          // sort answers by number
          answers: [...q.answers].sort((a, b) => a.number - b.number),
        })),
      })),
    }));

    return NextResponse.json({ ok: true, books });
  } catch (err: any) {
    try {
      db.close();
    } catch { }
    return NextResponse.json(
      { error: "Failed to read quiz data", details: String(err) },
      { status: 500 }
    );
  }
}
