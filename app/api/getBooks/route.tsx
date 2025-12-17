import { NextRequest, NextResponse } from 'next/server';
import sqlite from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { getResolvedPaths } from '@/lib/config';

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

//TODO: actually fetch language from ZILPCOURSEDE ZLANGUAGECODE
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
        const { dbPath: DB_PATH, imgPath: IMG_PATH } = getResolvedPaths();
        const db = sqlite(DB_PATH);

        const sql = `
            SELECT 
                ${allDefCols.map(col => `D."${col}"`).join(', ')},
                ${allProductCols.map(col => `P."${col}"`).join(', ')},
                D."ZLANGUAGECODE" AS "ZLANG"
            FROM "${TABLE_DEF}" D
            LEFT JOIN "${TABLE_PRODUCT}" P
            ON D."ZREFERENCE" = P."ZCOURSEREFERENCE"
            WHERE D."${INDEX_COL}" IS NOT NULL
        `;

        const statement = db.prepare(sql);
        const rows = statement.all() as Record<string, unknown>[];


        const resultList: any[] = [];

        rows.forEach(row => {
            const key = row[INDEX_COL];
            const value: Record<string, any> = {
                Z_PK: key
            };

            // Add basic course data
            COL_NAME_MAP.forEach(col => {
                value[col] = (row[col] as string)?.toString() || '';
            });

            // Add language code
            value["ZLANG"] = (row["ZLANG"] as string)?.toString() || '';

            // Extract folder from ZCOURSECONFIGFILEREFERENCE
            const configRefRaw = row["ZCOURSECONFIGFILEREFERENCE"];
            let folder = '';
            if (configRefRaw) {
                try {
                    const adjusted = (parseInt((configRefRaw as string).toString(), 16) - 1).toString(16).toUpperCase();
                    folder = adjusted.padStart((configRefRaw as string).length, '0');
                } catch {
                    folder = (configRefRaw as string).toString();
                }
            }

            // Process image fields
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

        // Get issue numbers for each course
        const sqlIssue = `
            SELECT "ZREFERENCE", "ZISSUEPRODUCT"
            FROM "ZILPISSUEDEF"
            WHERE "ZREFERENCE" IS NOT NULL AND "ZISSUEPRODUCT" IS NOT NULL
        `;

        const issueStatement = db.prepare(sqlIssue);
        const issueRows = issueStatement.all() as Record<string, unknown>[];

        const issueMap: Record<string, number[]> = {};
        issueRows.forEach(row => {
            const reference = (row["ZREFERENCE"] as string)?.toString() || '';
            const issueProduct = parseInt((row["ZISSUEPRODUCT"] as string)?.toString() || '0', 10);

            if (reference && !isNaN(issueProduct)) {
                if (!issueMap[reference]) {
                    issueMap[reference] = [];
                }
                issueMap[reference].push(issueProduct);
            }
        });

        // Get titles for each course
        //TODO: BUG: Title has potentially the wrong language, problem lies with Beook but is not a reliable source of data.
        const sqlTitle = `
            SELECT "ZCOURSEIDENTIFIER", "ZTITLE"
            FROM "ZILPCOURSESERIES"
            WHERE "ZCOURSEIDENTIFIER" IS NOT NULL AND "ZTITLE" IS NOT NULL
        `;

        const titleStatement = db.prepare(sqlTitle);
        const titleRows = titleStatement.all() as Record<string, unknown>[];

        const titleMap: Record<string, string[]> = {};
        titleRows.forEach(row => {
            const reference = (row["ZCOURSEIDENTIFIER"] as string)?.toString() || '';
            const title = (row["ZTITLE"] as string)?.toString() || '';

            if (reference && title) {
                if (!titleMap[reference]) {
                    titleMap[reference] = [];
                }
                titleMap[reference].push(title);
            }
        });

        // Transform data to match frontend Book type
        const transformedResultList: any[] = [];
        const transformedImgResultList: any[] = [];

        resultList.forEach(rawData => {
            const courseProductNumber = 0;
            const reference = rawData["ZREFERENCE"]?.toString() || "";
            const courseId = rawData["ZCOURSEID"]?.toString() || "";

            // Look up issues for this course reference
            const issueNumbers = issueMap[reference] ?? [];

            // Important: if there are no issues at all for this reference, we
            // treat it as a deleted / legacy / non-installed book and skip it.
            if (issueNumbers.length === 0) {
                return;
            }

            const bookId = rawData["Z_PK"].toString();
            const title = titleMap[courseId] || [];

            transformedResultList.push({
                BookID: bookId,                         // 1 Note: Beook2Pdf internal ID. Number taken from Z_PK but fundametally arbitrary and does not give any information about datastructure TODO: make it just the counter of the foreach to avoid confusion
                Titel: title,                           // Allgemeine Luftfahrzeugkenntnisse
                CourseName: courseId,                   // PPL020A
                Refrence: reference,                    // 978-3-905036-95-4
                ProductNumber: courseProductNumber,     // 40       TODO: ADD BUT FOR WHAT
                Issue: issueNumbers,                    // [[10, PPL020A00, Vorwort], [11, PPL020A01, 1 Einteilung der Luftfahrzeuge], [12, PPL020A02, 2 Komponenten eines Flugzeuges], [13, PPL020A03, 3 Flugzeugzelle (airfra...
                // TODO:rename to issues (everywhere (pain)) Should contain ZISSUEIDENTIFIER, ZISSUEPRODUCT and ZTITLE all from ZILPISSUEDEF (does not right now) order it like it is in ZORDER
                Lang: rawData["ZLANG"] || "",
                Toggled: false,
            });

            transformedImgResultList.push({
                BookID: bookId,
                CourseName: courseId,
                SymbolImg: rawData["ZSYMBOLFILENAMELOWRESON"] || "",
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