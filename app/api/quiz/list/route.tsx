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
  bookId: number;
  bookTitle: string;
  bookRef: string | null;

  // Real chapter (book chapter / issue product)
  chapterId: number;
  chapterTitle: string | null;
  chapterRef: string | null;
  issueId: string | null;

  // Exercise inside the chapter
  exerciseId: number;
  exerciseTitle: string | null;
  exerciseCode: string | null; // ZEXERCISEID like "010-3.3-02"

  questionId: number;
  questionRef: string | null;
  questionText: string | null;

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
    // Pull **decrypted** questions & answers and map them to book/exercise
    // NOTE: assumes /api/quiz/decrypt has already created and populated:
    //   ZILPQUESTION_DECRYPTED, ZILPANSWER_DECRYPTED
    const rows = db
      .prepare<[], RawRow>(
        `
    SELECT
      -- Book (course product)
      p.Z_PK                         AS bookId,
      p.ZTITLE                       AS bookTitle,
      p.ZPRODUCTREFERENCE            AS bookRef,

      -- Real chapter (issue product → ZILPEPRODUCT)
      chap.Z_PK                      AS chapterId,
      chap.ZTITLE                    AS chapterTitle,
      chap.ZPRODUCTREFERENCE         AS chapterRef,
      issue.ZISSUEID                 AS issueId,

      -- Exercise (inside chapter)
      ex.Z_PK                        AS exerciseId,
      ex.ZTITLE                      AS exerciseTitle,
      ex.ZEXERCISEID                 AS exerciseCode,

      -- Question
      q.Z_PK                         AS questionId,
      q.ZREFERENCE                   AS questionRef,
      qd.ZTEXT_DECRYPTED             AS questionText,

      -- Answer
      ans.Z_PK                       AS answerId,
      ans.ZNUMBER                    AS answerNumber,
      ans.ZANSWER_TEXT               AS answerText,
      ans.ZCORRECT_DECRYPTED         AS answerIsCorrect

    FROM ZILPQUESTION_DECRYPTED qd
    JOIN ZILPQUESTION q
      ON q.Z_PK = qd.Z_PK

    JOIN ZILPEXERCISE ex
      ON ex.Z_PK = q.ZEXERCISE

    -- Link exercise → issue (chapter)
    JOIN ZILPISSUEDEF issue
      ON issue.Z_PK = ex.ZISSUE

    -- Map issue → issue-product → chapter product
    JOIN ZILPISSUEPRODUCT ip
      ON ip.ZISSUEPRODUCT = issue.ZISSUEPRODUCT

    JOIN ZILPEPRODUCT chap
      ON chap.Z_PK = ip.ZEPRODUCT

    -- Existing course/product join (book)
    JOIN ZILPTOPICDEFINITION td
      ON td.Z_PK = ex.ZTOPICDEFINITION

    JOIN ZILPCOURSEPRODUCT cp
      ON td.ZRELATIVEFILEPATH LIKE '%' || '/courses/' || cp.ZCOURSEIDENTIFIER || '/' || '%'

    JOIN ZILPEPRODUCT p
      ON p.Z_PK = cp.ZEPRODUCT

    LEFT JOIN ZILPANSWER_DECRYPTED ans
      ON ans.ZQUESTION = q.Z_PK
     AND ans.ZTYPE = 3  -- only real answer options

    ORDER BY
      p.ZTITLE,
      chap.ZTITLE,
      ex.ZEXERCISEID,
      q.ZREFERENCE,
      ans.ZNUMBER
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
      // Book
      let book = booksMap.get(row.bookId);
      if (!book) {
        book = {
          id: row.bookId,
          title: row.bookTitle,
          ref: row.bookRef,
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
            "Unbenannter Abschnitt",
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
