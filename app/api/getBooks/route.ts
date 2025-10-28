import { NextRequest, NextResponse } from 'next/server';
import sqlite from 'better-sqlite3';
import path from 'path';
import os from 'os';
import fs from 'fs';

const username = os.userInfo().username;
const DB_PATH = path.resolve(`C:/Users/${username}/AppData/Roaming/ionesoft/beook/release/profiles/2/data/beook_book_v6.sqlite`);
const IMG_PATH = "C:/Users/pilot/AppData/Roaming/ionesoft/beook/release/assetStage/prod/fileSynch"

function findFolderContainingFile(rootDir: string, filename: string): string | null {
    const subdirs = fs.readdirSync(rootDir);
    for (const subdir of subdirs) {
        const subPath = path.join(rootDir, subdir, filename);
        if (fs.existsSync(subPath)) {
            return subdir;
        }
    }
    return null;
}

export async function GET(request: Request) {
    const TABLE_DEF = "ZILPCOURSEDEF";
    const TABLE_PRODUCT = "ZILPCOURSEPRODUCT";
    const INDEX_COL = "Z_PK";
    const COL_NAME_MAP = ["ZCOURSEID", "ZREFERENCE"];

    const IMAGE_COLS = ["ZCOVERFILENAMELOWRES", "ZSYMBOLFILENAMELOWRESOFF", "ZSYMBOLFILENAMELOWRESON"];
    const ADDITIONAL_COLS = ["ZCOURSECONFIGFILEREFERENCE", ...IMAGE_COLS];


    const allDefCols = [INDEX_COL, ...COL_NAME_MAP];
    const allProductCols = ADDITIONAL_COLS;

    try {
        const db = sqlite(DB_PATH);

        const sql = `
            SELECT 
                ${allDefCols.map(col => `D."${col}"`).join(', ')},
                ${allProductCols.map(col => `P."${col}"`).join(', ')}
            FROM "${TABLE_DEF}" D
            LEFT JOIN "${TABLE_PRODUCT}" P
            ON D."ZREFERENCE" = P."ZCOURSEREFERENCE"
            WHERE D."${INDEX_COL}" IS NOT NULL
        `;

        const statement = db.prepare(sql);
        const rows = statement.all();


        const resultList: any[] = [];

        rows.forEach(row => {
            const key = row[INDEX_COL];
            const value: Record<string, any> = {
                Z_PK: key
            };

            // === 1. Add basic course data ===
            COL_NAME_MAP.forEach(col => {
                value[col] = row[col]?.toString() || '';
            });

            // === 2. Extract folder from ZCOURSECONFIGFILEREFERENCE ===
            const configRefRaw = row["ZCOURSECONFIGFILEREFERENCE"];
            let folder = '';
            if (configRefRaw) {
                try {
                    const adjusted = (parseInt(configRefRaw.toString(), 16) - 1).toString(16).toUpperCase();
                    folder = adjusted.padStart(configRefRaw.length, '0');
                } catch {
                    folder = configRefRaw.toString();
                }
            }

            // === 3. Process image fields ===
            IMAGE_COLS.forEach(col => {
                const rawFilename = row[col]?.toString() || '';
                if (!rawFilename || !folder) {
                    value[col] = '';
                    return;
                }

                // Apply @2x to symbols
                let filename = rawFilename;
                if (
                    (col === 'ZSYMBOLFILENAMELOWRESOFF' || col === 'ZSYMBOLFILENAMELOWRESON') &&
                    rawFilename.includes('.')
                ) {
                    const lastDotIndex = rawFilename.lastIndexOf('.');
                    filename = rawFilename.slice(0, lastDotIndex) + '@2x' + rawFilename.slice(lastDotIndex);
                }

                const fullPath = path.join(IMG_PATH, folder, filename);
                try {
                    const imageBuffer = fs.readFileSync(fullPath);
                    const base64 = `data:image/${path.extname(filename).slice(1)};base64,${imageBuffer.toString('base64')}`;
                    value[col] = base64;
                } catch {
                    try {
                        const searchResult = findFolderContainingFile(IMG_PATH, filename);
                        if (searchResult) {
                            const newFullPath = path.join(IMG_PATH, searchResult, filename);
                            const imageBuffer = fs.readFileSync(newFullPath);
                            const base64 = `data:image/${path.extname(filename).slice(1)};base64,${imageBuffer.toString('base64')}`;
                            value[col] = base64;
                        }
                    } catch {
                        console.warn(`Missing image at ${fullPath}`);
                        value[col] = '';
                    }
                }
            });

            resultList.push(value);
        });

        // === 4. Get issue numbers for each course ===
        const sqlIssue = `
            SELECT "ZREFERENCE", "ZISSUEPRODUCT"
            FROM "ZILPISSUEDEF"
            WHERE "ZREFERENCE" IS NOT NULL AND "ZISSUEPRODUCT" IS NOT NULL
        `;

        const issueStatement = db.prepare(sqlIssue);
        const issueRows = issueStatement.all();

        const issueMap: Record<string, number[]> = {};
        issueRows.forEach(row => {
            const reference = row["ZREFERENCE"]?.toString() || '';
            const issueProduct = parseInt(row["ZISSUEPRODUCT"]?.toString() || '0', 10);

            if (reference && !isNaN(issueProduct)) {
                if (!issueMap[reference]) {
                    issueMap[reference] = [];
                }
                issueMap[reference].push(issueProduct);
            }
        });

        // === 5. Get titles for each course ===
        //TODO: BUG: Title has potentially the wrong language, presumably if the user downloads the book in a different language first.
        const sqlTitle = `
            SELECT "ZCOURSEIDENTIFIER", "ZTITLE"
            FROM "ZILPCOURSESERIES"
            WHERE "ZCOURSEIDENTIFIER" IS NOT NULL AND "ZTITLE" IS NOT NULL
        `;

        const titleStatement = db.prepare(sqlTitle);
        const titleRows = titleStatement.all();

        const titleMap: Record<string, number[]> = {};
        titleRows.forEach(row => {
            const reference = row["ZCOURSEIDENTIFIER"]?.toString() || '';
            const title = row["ZTITLE"]?.toString() || '';

            if (reference && title) {
                if (!titleMap[reference]) {
                    titleMap[reference] = [];
                }
                titleMap[reference].push(title);
            }
        });

        // === 6. Transform data to match frontend Book type ===
        const transformedResultList: any[] = [];
        const transformedImgResultList: any[] = [];

        resultList.forEach(rawData => {
            const bookId = rawData["Z_PK"].toString();
            const reference = rawData["ZREFERENCE"];
            const issueNumbers = issueMap[reference] || [];
            const courseId = rawData["ZCOURSEID"];
            const title = titleMap[courseId] || [];

            transformedResultList.push({
                BookID: bookId,
                Titel: title,
                CourseName: rawData["ZCOURSEID"] || '',
                Refrence: reference || '',
                Issue: issueNumbers,
                Toggled: false
            });

            transformedImgResultList.push({
                BookID: bookId,
                CourseName: rawData["ZCOURSEID"] || '',
                SymbolImg: rawData["ZSYMBOLFILENAMELOWRESON"] || '',
                // TODO: IMAGES UNUSED REMOVE IN PROD
                //SymbolImgTransparent: rawData["ZSYMBOLFILENAMELOWRESOFF"] || ''
                //CoverImage: rawData["ZCOVERFILENAMELOWRES"] || '',
            });
        });

        db.close();
        return NextResponse.json({
            success: true,
            booklist: transformedResultList,
            booksymbols: transformedImgResultList
        });
    } catch (error) {
        console.error('Error fetching web resources:', error);
        return NextResponse.json(
            { success: false, error: 'Error fetching web resources' },
            { status: 500 }
        );
    }
}