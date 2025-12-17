import { NextRequest, NextResponse } from "next/server";
import sqlite from "better-sqlite3";
import { getResolvedPaths } from '@/lib/config';

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/getChapters?bookRef=978-3-905036-95-4
 *
 * Returns the chapter list for a given book (by ZILPCOURSEDEF.ZREFERENCE).
 * Chapters come from ZILPEPRODUCT via ZILPISSUEDEF / ZILPISSUEPRODUCT,
 * the same join that is used in the quiz aggregation.
 */
export async function GET(request: NextRequest) {
  const { dbPath: DB_PATH } = getResolvedPaths();
  const searchParams = new URL(request.url).searchParams;
  const bookRef = searchParams.get("bookRef");

  if (!bookRef) {
    return NextResponse.json(
      { success: false, error: "Missing 'bookRef' query parameter." },
      { status: 400 }
    );
  }

  try {
    const db = sqlite(DB_PATH);

    const stmt = db.prepare(`
      SELECT DISTINCT
        chap."Z_PK"              AS chapterId,
        chap."ZTITLE"            AS chapterTitle,
        chap."ZPRODUCTREFERENCE" AS chapterRef,
        issue."ZISSUEID"         AS issueId
      FROM ZILPCOURSEDEF cd
      JOIN ZILPISSUEDEF issue
        ON issue."ZCOURSE" = cd."Z_PK"
      JOIN ZILPISSUEPRODUCT ip
        ON ip."ZISSUEPRODUCT" = issue."ZISSUEPRODUCT"
      JOIN ZILPEPRODUCT chap
        ON chap."Z_PK" = ip."ZEPRODUCT"
      WHERE cd."ZREFERENCE" = ?
      ORDER BY issue."ZISSUEID", chap."ZTITLE"
    `);

    const rows = stmt.all(bookRef);

    const chapters = rows.map((row: any) => ({
      chapterId: row.chapterId as number,
      title: row.chapterTitle as string,
      ref: row.chapterRef as string,        // ZPRODUCTREFERENCE (e.g. "P5cec")
      issueId: (row.issueId ?? null) as string | null, // e.g. "PPL020A01"
    }));

    db.close();
    return NextResponse.json({ success: true, chapters });
  } catch (err: any) {
    console.error("Error fetching chapters for book:", err);
    return NextResponse.json(
      { success: false, error: "Error fetching chapters for book." },
      { status: 500 }
    );
  }
}