import { NextResponse } from "next/server";
import sqlite3 from "sqlite3";
import { open } from "sqlite";
import path from "path";
import os from "os";

const username = os.userInfo().username;
const DB_PATH = path.resolve(
  `C:/Users/${username}/AppData/Roaming/ionesoft/beook/release/profiles/1/data/beook_book_v6.sqlite`
);

async function getDb() {
  const db = await open({
    filename: DB_PATH,
    driver: sqlite3.Database,
  });
  await db.run(`PRAGMA foreign_keys = ON;`);
  return db;
}

async function ensureTables(db: any) {
  // Questions table: has_asset flag + book_ref + chapter_ref
  await db.run(`
    CREATE TABLE IF NOT EXISTS custom_quiz_questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      question TEXT NOT NULL,
      correct_answer TEXT NOT NULL,
      wrong_answers TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      has_asset INTEGER NOT NULL DEFAULT 0,
      book_ref TEXT,
      chapter_ref TEXT
    )
  `);

  const cols = await db.all<{ name: string }[]>(
    `PRAGMA table_info(custom_quiz_questions);`
  );

  const hasHasAsset = cols.some((c) => c.name === "has_asset");
  if (!hasHasAsset) {
    await db.run(
      `ALTER TABLE custom_quiz_questions ADD COLUMN has_asset INTEGER NOT NULL DEFAULT 0`
    );
  }

  const hasBookRef = cols.some((c) => c.name === "book_ref");
  if (!hasBookRef) {
    await db.run(
      `ALTER TABLE custom_quiz_questions ADD COLUMN book_ref TEXT`
    );
  }

  const hasChapterRef = cols.some((c) => c.name === "chapter_ref");
  if (!hasChapterRef) {
    await db.run(
      `ALTER TABLE custom_quiz_questions ADD COLUMN chapter_ref TEXT`
    );
  }

  // Assets table
  await db.run(`
    CREATE TABLE IF NOT EXISTS custom_quiz_assets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      question_id INTEGER NOT NULL,
      mime_type TEXT NOT NULL,
      filename TEXT,
      data BLOB NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (question_id) REFERENCES custom_quiz_questions(id) ON DELETE CASCADE
    )
  `);
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);

  if (!body) {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const {
    question,
    correctAnswer,
    wrongAnswers,
    assetBase64,
    assetMime,
    assetName,
    bookRef,
    chapterRef,
  } = body as {
    question?: string;
    correctAnswer?: string;
    wrongAnswers?: string[];
    assetBase64?: string | null;
    assetMime?: string | null;
    assetName?: string | null;
    bookRef?: string | null;
    chapterRef?: string | null;
  };

  if (
    !question ||
    !correctAnswer ||
    !wrongAnswers ||
    !Array.isArray(wrongAnswers) ||
    wrongAnswers.length < 3
  ) {
    return NextResponse.json(
      {
        error:
          "Invalid input. Need 1 question, 1 correct answer, and at least 3 wrong answers.",
      },
      { status: 400 }
    );
  }

  if (wrongAnswers.length > 30) {
    return NextResponse.json(
      { error: "Too many wrong answers (max 30)." },
      { status: 400 }
    );
  }

  const db = await getDb();
  try {
    await ensureTables(db);

    const trimmedWrong = wrongAnswers.map((w) => String(w));
    const bookRefValue =
      typeof bookRef === "string" && bookRef.trim().length > 0
        ? bookRef.trim()
        : null;
    const chapterRefValue =
      typeof chapterRef === "string" && chapterRef.trim().length > 0
        ? chapterRef.trim()
        : null;

    // Insert question with optional book_ref + chapter_ref
    const result = await db.run(
      `INSERT INTO custom_quiz_questions (question, correct_answer, wrong_answers, book_ref, chapter_ref)
       VALUES (?, ?, ?, ?, ?)`,
      [
        question,
        correctAnswer,
        JSON.stringify(trimmedWrong),
        bookRefValue,
        chapterRefValue,
      ]
    );
    const newId = result.lastID as number;

    // Store asset (images) in DB if provided
    if (
      assetBase64 &&
      typeof assetBase64 === "string" &&
      assetMime &&
      typeof assetMime === "string" &&
      assetMime.toLowerCase().startsWith("image/")
    ) {
      try {
        const buf = Buffer.from(assetBase64, "base64");
        const safeName =
          assetName && typeof assetName === "string"
            ? assetName.replace(/[^a-zA-Z0-9._-]/g, "_")
            : null;

        await db.run(
          `INSERT INTO custom_quiz_assets (question_id, mime_type, filename, data)
           VALUES (?, ?, ?, ?)`,
          [newId, assetMime, safeName, buf]
        );

        await db.run(
          `UPDATE custom_quiz_questions SET has_asset = 1 WHERE id = ?`,
          [newId]
        );
      } catch (err) {
        console.error("Failed to store asset in DB:", err);
        // keep question; has_asset stays 0 if asset insert fails
      }
    }

    return NextResponse.json({ success: true, id: newId });
  } catch (err: any) {
    console.error(err);
    return NextResponse.json(
      { error: "Failed to store question", details: String(err) },
      { status: 500 }
    );
  } finally {
    await db.close();
  }
}

export async function GET() {
  const db = await getDb();
  try {
    await ensureTables(db);

    const questions = await db.all<{
      id: number;
      question: string;
      correct_answer: string;
      wrong_answers: string;
      created_at: string;
      has_asset: number;
      book_ref: string | null;
      chapter_ref: string | null;
    }[]>(
      `SELECT id, question, correct_answer, wrong_answers, created_at, has_asset, book_ref, chapter_ref
       FROM custom_quiz_questions
       ORDER BY datetime(created_at) DESC, id DESC`
    );

    const idsWithAssets = questions
      .filter((q) => q.has_asset)
      .map((q) => q.id);

    const assetMap = new Map<
      number,
      { mimeType: string; dataUrl: string }
    >();

    if (idsWithAssets.length > 0) {
      const placeholders = idsWithAssets.map(() => "?").join(", ");
      const assetRows = await db.all<{
        question_id: number;
        mime_type: string;
        data: Buffer;
      }[]>(
        `
        SELECT a1.question_id, a1.mime_type, a1.data
        FROM custom_quiz_assets a1
        WHERE a1.question_id IN (${placeholders})
          AND a1.id = (
            SELECT a2.id
            FROM custom_quiz_assets a2
            WHERE a2.question_id = a1.question_id
            ORDER BY a2.created_at DESC, a2.id DESC
            LIMIT 1
          )
        `,
        idsWithAssets
      );

      for (const row of assetRows) {
        if (!row.data || !row.mime_type) continue;
        const buf = Buffer.isBuffer(row.data)
          ? row.data
          : Buffer.from(row.data as any);
        const base64 = buf.toString("base64");
        const dataUrl = `data:${row.mime_type};base64,${base64}`;
        assetMap.set(row.question_id, {
          mimeType: row.mime_type,
          dataUrl,
        });
      }
    }

    const rows = questions.map((q) => {
      const asset = assetMap.get(q.id);
      return {
        ...q,
        assetMimeType: asset?.mimeType ?? null,
        assetDataUrl: asset?.dataUrl ?? null,
      };
    });

    return NextResponse.json({ rows });
  } catch (err: any) {
    console.error(err);
    return NextResponse.json(
      { error: "Failed to load questions", details: String(err) },
      { status: 500 }
    );
  } finally {
    await db.close();
  }
}

export async function DELETE(req: Request) {
  const { searchParams } = new URL(req.url);
  const idRaw = searchParams.get("id");
  const id = Number(idRaw);
  if (!id || Number.isNaN(id)) {
    return NextResponse.json(
      { error: "Missing or invalid id" },
      { status: 400 }
    );
  }

  const db = await getDb();
  try {
    await ensureTables(db);

    const result = await db.run(
      `DELETE FROM custom_quiz_questions WHERE id = ?`,
      [id]
    );

    if (result.changes === 0) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // related assets deleted via ON DELETE CASCADE
    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error(err);
    return NextResponse.json(
      { error: "Failed to delete question", details: String(err) },
      { status: 500 }
    );
  } finally {
    await db.close();
  }
}
