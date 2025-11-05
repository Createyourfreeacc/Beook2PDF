import { NextResponse } from 'next/server';
import sqlite from 'better-sqlite3';
import path from 'path';
import os from 'os';

const username = os.userInfo().username;
const DB_PATH = path.resolve(`C:/Users/${username}/AppData/Roaming/ionesoft/beook/release/profiles/1/data/beook_book_v6.sqlite`);

export async function GET(request: Request) {
    const searchParams = new URL(request.url).searchParams;
    const id = searchParams.get('id')?.toString();
    const col1 = searchParams.get('col1')?.toString();
    const col2 = searchParams.get('col2')?.toString();
    const col3 = searchParams.get('table')?.toString();

    if (!id || !col1 || !col2 || !col3) {
        return NextResponse.json({ error: 'Missing required parameters' }, { status: 400 });
    }

    try {
        const db = sqlite(DB_PATH);
        const statement = db.prepare(`SELECT ${col1} FROM ${col3} WHERE ${col2} = ${id}`);
        const row = statement.get() as any;

        let content = '';
        if (row) {
            content = row[col1 as string]?.toString() || '';
        }

        db.close();
        return NextResponse.json({ success: true, content: content });
    } catch (error) {
        console.error('Error fetching web resources:', error);
        return NextResponse.json(
            { success: false, error: 'Error fetching web resources' },
            { status: 500 }
        );
    }
}