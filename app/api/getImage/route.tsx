import { NextResponse } from 'next/server';
import sqlite3 from 'sqlite3';
import { getResolvedPaths } from '@/lib/config';

export async function GET(request: Request) {
    const searchParams = new URL(request.url).searchParams;
    const id = searchParams.get('id')?.toString();
    
    if (!id) {
        return NextResponse.json({ error: 'Missing ID parameter' }, { status: 400 });
    }

    try {
        const { dbPath: DB_PATH } = getResolvedPaths();
        const db = new sqlite3.Database(DB_PATH, sqlite3.OPEN_READONLY);

        return new Promise<NextResponse>((resolve, reject) => {
            db.get(
                'SELECT ZDATA FROM ZILPRESOURCE WHERE Z_PK = ?',
                [id],
                (err, row) => {
                    db.close();
                    
                    if (err) {
                        return reject(NextResponse.json({ error: 'Database error' }, { status: 500 }));
                    }

                    if (!(row as any)?.ZDATA) {
                        return resolve(NextResponse.json({ error: 'Resource not found' }, { status: 404 }));
                    }

                    const buffer = Buffer.from((row as any).ZDATA);
                    const base64Image = buffer.toString('base64');
                    const mimeType = 'image/png';

                    resolve(
                        NextResponse.json({
                            data: `data:${mimeType};base64,${base64Image}`
                        })
                    );
                }
            );
        });
    } catch (error) {
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}