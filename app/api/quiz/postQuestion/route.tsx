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
  return open({
    filename: DB_PATH,
    driver: sqlite3.Database,
  });
}

export async function POST(req: Request) {
  const { question, correctAnswer, wrongAnswers } = await req.json();

  if (!question || !correctAnswer || !wrongAnswers || wrongAnswers.length < 3) {
    return NextResponse.json(
      { error: "Invalid input. Need 1 question, 1 correct answer, and at least 3 wrong answers." },
      { status: 400 }
    );
  }
  if (wrongAnswers.length > 30) {
    return NextResponse.json({ error: "Too many wrong answers (max 30)." }, { status: 400 });
  }

  const db = await getDb();

  await db.run(`
    CREATE TABLE IF NOT EXISTS custom_quiz_questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      question TEXT NOT NULL,
      correct_answer TEXT NOT NULL,
      wrong_answers TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.run(
    `INSERT INTO custom_quiz_questions (question, correct_answer, wrong_answers)
     VALUES (?, ?, ?)`,
    [question, correctAnswer, JSON.stringify(wrongAnswers)]
  );

  await db.close();

  return NextResponse.json({ success: true });
}

// NEW: list questions
export async function GET() {
  const db = await getDb();

  await db.run(`
    CREATE TABLE IF NOT EXISTS custom_quiz_questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      question TEXT NOT NULL,
      correct_answer TEXT NOT NULL,
      wrong_answers TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const rows = await db.all<{
    id: number;
    question: string;
    correct_answer: string;
    wrong_answers: string;
    created_at: string;
  }[]>(`SELECT id, question, correct_answer, wrong_answers, created_at
        FROM custom_quiz_questions
        ORDER BY datetime(created_at) DESC, id DESC`);

  await db.close();
  return NextResponse.json({ rows });
}

// NEW: delete question by id
export async function DELETE(req: Request) {
  const { searchParams } = new URL(req.url);
  const idRaw = searchParams.get("id");
  const id = Number(idRaw);
  if (!id || Number.isNaN(id)) {
    return NextResponse.json({ error: "Missing or invalid id" }, { status: 400 });
  }

  const db = await getDb();
  const result = await db.run(`DELETE FROM custom_quiz_questions WHERE id = ?`, [id]);
  await db.close();

  if (result.changes === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
