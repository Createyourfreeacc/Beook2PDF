// ==========================================================================
// /app/api/decrypt/misc/route.tsx
// ==========================================================================
//
// Decrypts remaining encrypted strings in the Beook DB that are not handled
// by /api/quiz/decrypt:
//
//   - ZILPUSER.ZCLOUDID      (prefix "UT$")
//   - ZILPPROPERTY.ZVALUE    (prefix "PR$")
//
// Format is the same as for QT$/AT$ in /app/api/route.ts:
//
//   "<PREFIX>$" + Base64( DES-CBC("<idString>:<plaintext>") )
//
// Using the same DES/CBC/PKCS5(PKCS7) behavior via crypto-js.
// ==========================================================================

import { NextResponse } from "next/server";
import CryptoJS from "crypto-js";
import Database from "better-sqlite3";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// DB path loaded from centralized config
import { getResolvedPaths } from '@/lib/config';

// From ILPBookSettingsHelper (same as quiz decrypt)
const KEY_STRING = "fdäK?s^dw-+ç,W!El";
const IV_STRING = "/D}$2al!";

// --------------------------------------------------------------------------
// Decrypt any "*T$" stored value (UT$, PR$, AT$, QT$, …)
//
// Logic mirrors decryptStoredAnswer() from /app/api/route.ts
// --------------------------------------------------------------------------
function decryptStoredPrefixed(stored: string) {
  if (!stored || stored.length <= 3) {
    return { idString: null as string | null, plaintext: null as string | null };
  }

  // Strip the 3-char prefix
  const base64Payload = stored.substring(3);

  try {
    const key = CryptoJS.enc.Utf8.parse(KEY_STRING.substring(0, 8));
    const iv = CryptoJS.enc.Utf8.parse(IV_STRING);

    const decrypted = CryptoJS.DES.decrypt(
      { ciphertext: CryptoJS.enc.Base64.parse(base64Payload) },
      key,
      {
        iv,
        mode: CryptoJS.mode.CBC,
        padding: CryptoJS.pad.Pkcs7,
      }
    );

    const text = decrypted.toString(CryptoJS.enc.Utf8);
    if (!text) return { idString: null, plaintext: null };

    const idx = text.indexOf(":");
    if (idx === -1) {
      // No idString separator – treat whole as plaintext
      return { idString: null, plaintext: text };
    }

    return {
      idString: text.substring(0, idx),
      plaintext: text.substring(idx + 1),
    };
  } catch {
    return { idString: null, plaintext: null };
  }
}

// ==========================================================================
// GET handler
// ==========================================================================

export async function GET() {
  let db: Database.Database;
  const { dbPath: DB_PATH } = getResolvedPaths();

  try {
    db = new Database(DB_PATH, { readonly: false });
  } catch (err: any) {
    return NextResponse.json(
      { error: `Failed to open DB at ${DB_PATH}`, details: String(err) },
      { status: 500 }
    );
  }

  try {
    // ======================================================================
    // ZILPUSER → ZILPUSER_DECRYPTED (ZCLOUDID, "UT$" prefix)
    // ======================================================================
    const userTableInfo = db.prepare("PRAGMA table_info(ZILPUSER)").all();
    const userTableExists = userTableInfo && userTableInfo.length > 0;

    let userProcessedRows = 0;
    let userDecryptedRows = 0;
    let userWithPrefix = 0;
    let userPrefixButFailed = 0;

    if (userTableExists) {
      const userColNames = userTableInfo.map((c: any) => c.name as string);
      const userBaseCols = userColNames.join(", ");

      const hasUserDecryptedTable = !!db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='ZILPUSER_DECRYPTED';"
        )
        .get();

      if (!hasUserDecryptedTable) {
        db.exec(`
          CREATE TABLE ZILPUSER_DECRYPTED AS
          SELECT * FROM ZILPUSER WHERE 0;
        `);
      } else {
        db.exec(`DELETE FROM ZILPUSER_DECRYPTED;`);
      }

      try {
        db.exec(
          `ALTER TABLE ZILPUSER_DECRYPTED ADD COLUMN ZCLOUDID_DECRYPTED TEXT;`
        );
      } catch {}
      try {
        db.exec(
          `ALTER TABLE ZILPUSER_DECRYPTED ADD COLUMN ZCLOUDID_IDSTRING TEXT;`
        );
      } catch {}

      const userPlaceholders =
        userColNames.map((n) => `@${n}`).join(", ") +
        ", @ZCLOUDID_DECRYPTED, @ZCLOUDID_IDSTRING";

      const userInsertStmt = db.prepare(
        `INSERT INTO ZILPUSER_DECRYPTED (${userBaseCols}, ZCLOUDID_DECRYPTED, ZCLOUDID_IDSTRING)
         VALUES (${userPlaceholders})`
      );

      const userRows = db.prepare("SELECT * FROM ZILPUSER").all();

      const userTx = db.transaction((rows: any[]) => {
        for (const row of rows) {
          userProcessedRows++;

          const raw =
            typeof row.ZCLOUDID === "string" ? (row.ZCLOUDID as string) : null;

          let ZCLOUDID_DECRYPTED: string | null = null;
          let ZCLOUDID_IDSTRING: string | null = null;

          if (raw && raw.startsWith("UT$")) {
            userWithPrefix++;
            const { idString, plaintext } = decryptStoredPrefixed(raw);

            if (plaintext !== null) {
              userDecryptedRows++;
              ZCLOUDID_DECRYPTED = plaintext;
              ZCLOUDID_IDSTRING = idString;
            } else {
              userPrefixButFailed++;
            }
          }

          userInsertStmt.run({
            ...row,
            ZCLOUDID_DECRYPTED,
            ZCLOUDID_IDSTRING,
          });
        }
      });

      userTx(userRows);
    }

    // ======================================================================
    // ZILPPROPERTY → ZILPPROPERTY_DECRYPTED (ZVALUE, "PR$" prefix)
    // ======================================================================
    const propTableInfo = db.prepare("PRAGMA table_info(ZILPPROPERTY)").all();
    const propTableExists = propTableInfo && propTableInfo.length > 0;

    let propertyProcessedRows = 0;
    let propertyDecryptedRows = 0;
    let propertyWithPrefix = 0;
    let propertyPrefixButFailed = 0;

    if (propTableExists) {
      const propColNames = propTableInfo.map((c: any) => c.name as string);
      const propBaseCols = propColNames.join(", ");

      const hasPropDecryptedTable = !!db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='ZILPPROPERTY_DECRYPTED';"
        )
        .get();

      if (!hasPropDecryptedTable) {
        db.exec(`
          CREATE TABLE ZILPPROPERTY_DECRYPTED AS
          SELECT * FROM ZILPPROPERTY WHERE 0;
        `);
      } else {
        db.exec(`DELETE FROM ZILPPROPERTY_DECRYPTED;`);
      }

      try {
        db.exec(
          `ALTER TABLE ZILPPROPERTY_DECRYPTED ADD COLUMN ZVALUE_DECRYPTED TEXT;`
        );
      } catch {}
      try {
        db.exec(
          `ALTER TABLE ZILPPROPERTY_DECRYPTED ADD COLUMN ZVALUE_IDSTRING TEXT;`
        );
      } catch {}

      const propPlaceholders =
        propColNames.map((n) => `@${n}`).join(", ") +
        ", @ZVALUE_DECRYPTED, @ZVALUE_IDSTRING";

      const propInsertStmt = db.prepare(
        `INSERT INTO ZILPPROPERTY_DECRYPTED (${propBaseCols}, ZVALUE_DECRYPTED, ZVALUE_IDSTRING)
         VALUES (${propPlaceholders})`
      );

      const propRows = db.prepare("SELECT * FROM ZILPPROPERTY").all();

      const propTx = db.transaction((rows: any[]) => {
        for (const row of rows) {
          propertyProcessedRows++;

          const raw =
            typeof row.ZVALUE === "string" ? (row.ZVALUE as string) : null;

          let ZVALUE_DECRYPTED: string | null = null;
          let ZVALUE_IDSTRING: string | null = null;

          if (raw && raw.startsWith("PR$")) {
            propertyWithPrefix++;
            const { idString, plaintext } = decryptStoredPrefixed(raw);

            if (plaintext !== null) {
              propertyDecryptedRows++;
              ZVALUE_DECRYPTED = plaintext;
              ZVALUE_IDSTRING = idString;
            } else {
              propertyPrefixButFailed++;
            }
          }

          propInsertStmt.run({
            ...row,
            ZVALUE_DECRYPTED,
            ZVALUE_IDSTRING,
          });
        }
      });

      propTx(propRows);
    }

    db.close();

    return NextResponse.json({
      ok: true,

      userTableExists,
      userProcessedRows,
      userDecryptedRows,
      userWithPrefix,
      userPrefixButFailed,
      userTable: userTableExists ? "ZILPUSER_DECRYPTED" : null,

      propertyTableExists: propTableExists,
      propertyProcessedRows,
      propertyDecryptedRows,
      propertyWithPrefix,
      propertyPrefixButFailed,
      propertyTable: propTableExists ? "ZILPPROPERTY_DECRYPTED" : null,
    });
  } catch (err: any) {
    try {
      db.close();
    } catch {}
    return NextResponse.json(
      {
        error: "Failed to decrypt/write user/property data",
        details: String(err),
      },
      { status: 500 }
    );
  }
}
