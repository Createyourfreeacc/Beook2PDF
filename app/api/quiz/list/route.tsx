import { NextResponse } from "next/server";
import Database from "better-sqlite3";
import { getResolvedPaths } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RawRow = {
  // Book
  bookId: number;
  bookCourseId: string | null;
  bookRef: string | null;

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
  answerIsCorrect: number | null;
};

type AssetRow = {
  exerciseId: number;
  resId: number;
  mediaType: string | null;
  data: Buffer | null;
};

type Asset = {
  id: number;
  mediaType: string;
  dataUrl: string;
};

function cleanQuestionText(text: string | null): string {
  if (!text) return "";
  return text
    .replace(/\$\{answerBlock\}/g, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?[^>]+>/g, "")
    .trim();
}

function cleanAnswerText(text: string | null): string {
  if (!text) return "";
  return text
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?[^>]+>/g, "")
    .trim();
}

// For sorting chapters "1 Foo", "10 Bar" numerically by the prefix
function extractNumberPrefix(title: string | null): number {
  if (!title) return Number.MAX_SAFE_INTEGER;
  const match = title.trim().match(/^(\d+)/);
  return match ? parseInt(match[1], 10) : Number.MAX_SAFE_INTEGER;
}

export async function GET() {
  let db: Database.Database;
  const { dbPath: DB_PATH } = getResolvedPaths();

  try {
    db = new Database(DB_PATH, { readonly: true });
  } catch (err: any) {
    return NextResponse.json(
      { error: `Failed to open DB at ${DB_PATH}`, details: String(err) },
      { status: 500 }
    );
  }

  try {
    // --------------------------------------------------------------
    // Course titles from ZILPCOURSESERIES
    // --------------------------------------------------------------
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

    // --------------------------------------------------------------
    // Load exercise assets once
    // --------------------------------------------------------------
    const assetRows = db
      .prepare<[], AssetRow>(
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
      .all();

    // Map resourceId -> Asset
    const assetById = new Map<number, Asset>();
    // Map exerciseId -> array of resourceIds
    const exerciseAssetIds = new Map<number, number[]>();

    for (const row of assetRows) {
      if (!row.mediaType || !row.data) continue;
      const mediaType = row.mediaType.toLowerCase();
      if (!mediaType.startsWith("image/")) continue; // only images for now

      let asset = assetById.get(row.resId);
      if (!asset) {
        const buf = Buffer.isBuffer(row.data)
          ? row.data
          : Buffer.from(row.data as any);
        const base64 = buf.toString("base64");
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
    // Main query: Question -> Exercise -> Issue -> Course
    // --------------------------------------------------------------
    const rows = db
      .prepare<[], RawRow>(
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

    // --------------------------------------------------------------
    // Fold into book -> chapter -> question (+ per-question assets)
    // --------------------------------------------------------------
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
                assets: Asset[];
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
        const assetIds = exerciseAssetIds.get(row.exerciseId) ?? [];
        const assets = assetIds
          .map((id) => assetById.get(id))
          .filter((a): a is Asset => !!a);

        question = {
          id: row.questionId,
          ref: row.questionRef,
          text: cleanQuestionText(row.questionText),
          exerciseTitle: row.exerciseTitle,
          exerciseCode: row.exerciseCode,
          exerciseId: row.exerciseId,
          assets,
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

    // --------------------------------------------------------------
    // Convert to arrays, sort, and pull out shared assets per chapter
    // --------------------------------------------------------------
    const SHARED_THRESHOLD = 3; // >=3 questions in the same chapter

    const books = Array.from(booksMap.values()).map((book) => {
      const chapters = Array.from(book.chapters.values())
        .sort(
          (a, b) =>
            extractNumberPrefix(a.title) - extractNumberPrefix(b.title)
        )
        .map((ch) => {
          // questions array (keep current order)
          const questions = Array.from(ch.questions.values()).map((q) => ({
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

          // Build asset usage map: assetId -> { asset, questionIndices }
          const usage = new Map<
            number,
            { asset: Asset; questionIndices: number[] }
          >();

          questions.forEach((q, idx) => {
            q.assets.forEach((asset) => {
              const existing = usage.get(asset.id);
              if (!existing) {
                usage.set(asset.id, {
                  asset,
                  questionIndices: [idx + 1], // 1-based for display
                });
              } else {
                existing.questionIndices.push(idx + 1);
              }
            });
          });

          // Group assets by their set of question indices so that
          // multi-page “sets” (like the 4 pages in Flugplanung)
          // show up as a single shared asset group.
          const groupsMap = new Map<
            string,
            { assets: Asset[]; questionNumbers: number[] }
          >();

          for (const { asset, questionIndices } of usage.values()) {
            if (questionIndices.length < SHARED_THRESHOLD) continue;
            const key = questionIndices.join(",");
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
            q.assets = q.assets.filter((a) => !sharedIds.has(a.id));
          });

          return {
            id: ch.id,
            title: ch.title,
            // these are the "chapter level" assets used by many questions
            sharedAssets: sharedGroups.map((g, idx) => ({
              id: idx,
              questionNumbers: g.questionNumbers,
              pages: g.assets,
            })),
            questions,
          };
        });

      return {
        id: book.id,
        title: book.title,
        ref: book.ref,
        chapters,
      };
    });

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
