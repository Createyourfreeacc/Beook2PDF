import { NextRequest, NextResponse } from 'next/server';
import sqlite from 'better-sqlite3';
import path from 'path';
import os from 'os';

const username = os.userInfo().username;
const DB_PATH = path.resolve(`C:/Users/${username}/AppData/Roaming/ionesoft/beook/release/profiles/2/data/beook_book_v6.sqlite`);

export async function GET(request: NextRequest) {
    const searchParams = new URL(request.url).searchParams;

    try {
        const db = sqlite(DB_PATH);

        const statement = db.prepare(`
            SELECT Z_PK, ZTITLE, ZPAGENUMBER, ZACCESSPATH, ZORDER, ZTOPICDEFINITION, ZISSUE, ZLEVEL
            FROM ZILPTOPIC 
            WHERE ZTOPICDELETED IS NULL AND ZTITLE IS NOT NULL AND TRIM(ZTITLE) != ''
            ORDER BY Z_PK
        `);

        const rows = statement.all();

        const entries = rows.map(row => ({
            zpk: row.Z_PK,
            title: row.ZTITLE,
            pagenum: row.ZPAGENUMBER,
            chapterSection: row.ZACCESSPATH,
            zOrder: row.ZORDER,
            zIssue: row.ZISSUE,
            zLevel: row.ZLEVEL
        }));

        db.close();
        return NextResponse.json({ success: true, entries });
    } catch (error) {
        console.error('Error fetching TOC entries:', error);
        return NextResponse.json(
            { success: false, error: 'Error fetching TOC entries' },
            { status: 500 }
        );
    }
}