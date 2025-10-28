import { NextResponse } from 'next/server';
import sqlite from 'better-sqlite3';
import path from 'path';
import os from 'os';

const username = os.userInfo().username;
const DB_PATH = path.resolve(`C:/Users/${username}/AppData/Roaming/ionesoft/beook/release/profiles/2/data/beook_book_v6.sqlite`);

export async function GET(request: Request) {
    const searchParams = new URL(request.url).searchParams;
    const col = searchParams.get('col')?.toString();
    const table = searchParams.get('table')?.toString();

    if (!col || !table) {
        return NextResponse.json({ error: 'Missing required parameters' }, { status: 400 });
    }

    try {
        const db = sqlite(DB_PATH);
        const stmt = db.prepare(`SELECT MAX(${col}) AS maxInt FROM ${table}`);

        // Assert the type of result to help TypeScript
        const result = stmt.get() as { maxInt: number | null } | undefined;

        // Safely extract maxInt: use optional chaining and nullish coalescing
        const maxInt = result?.maxInt ?? 0;

        db.close();
        return NextResponse.json({ success: true, content: maxInt });
    } catch (error) {
        console.error('Error fetching max Int:', error);
        return NextResponse.json(
            { success: false, error: 'Failed to fetch max Int' },
            { status: 500 }
        );
    }
}