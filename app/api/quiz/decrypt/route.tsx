// ==========================================================================
// /app/api/route.ts
// ==========================================================================
//
// This route decrypts encrypted answer & question strings from the SQLite
// database used by the Beook e-learning platform (Ionesoft AG).
//
// The original application is a closed-source Eclipse RCP / OSGi Java app
// that stores encrypted question/answer text inside the SQLite DB.
// The encryption was reverse-engineered using decompilation of the involved
// Java classes (DESEncrypter.class and ILPBookSettingsHelper.class).
//
// Encrypted values appear in:
//   - ZILPANSWER.ZTEXT with prefixes, for example:
//       "AT$Yi6ozUicZvYNoRAc+zS8coBQurid1WRAiGiyNvcU2OE="   (for answers)
//   - ZILPQUESTION.ZTEXT with prefixes, for example:
//       "QT$Yi6ozUicZvZS92aTtnzoFn1ajV2VeptHUipNM0+hvuG5X2JKt/A2c6/3VwvWsKF6ygXMi7Nfubx67hpuC/nWSpMMf9rExYNN5cPSSlgEnAU="
//
// The prefix "AT$" or "QT$" is followed by Base64(DES-CBC("<id>:<plaintext>"))
// where id = "<exerciseId>-<answerNumber>" (for answers) or similar for questions.
//
// Example decrypted form: "001-02:der Kugellagerdruck"
//
// Encryption details confirmed from Java code:
//   Cipher.getInstance("DES/CBC/PKCS5Padding")
//   Key derived directly from UTF-8 bytes of string:
//        new DESKeySpec(keyString.getBytes())
//   IV = literal UTF-8 bytes of string "/D}$2al!"
//
// KEY STRING (raw): "fdäK?s^dw-+ç,W!El"
// Java DESKeySpec uses **first 8 bytes only** (DES = 56bit key)
//
// NOTE ABOUT DES PARITY:
//   DES keys expect 8 bytes, where each byte has an odd parity bit.
//   Java quietly normalizes invalid parity automatically.
//   Node's OpenSSL crypto subsystem rejected DES entirely because modern
//   OpenSSL ships with DES disabled for security compliance (FIPS).
//   This is why all attempts using createDecipheriv("des-cbc") failed.
//
// Because of OpenSSL restrictions, we switched to **crypto-js**, which has
// a pure-JS DES CBC implementation with PKCS7 padding that matches Java's
// PKCS5Padding behavior.
//
// ==========================================================================

import { NextResponse } from "next/server";
import CryptoJS from "crypto-js";
import Database from "better-sqlite3";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";


import { getResolvedPaths } from '@/lib/config';

// ==========================================================================
// CRYPTO CONSTANTS — FROM ILPBookSettingsHelper (decompiled)
//
// databaseEncryptionKey():
//   return String.format("%s%c%s%c%c%s", "fdäK?s^d", 'w', "-+ç", ',', 'W', "!El");
// Result string: "fdäK?s^dw-+ç,W!El"
//
// databaseEncryptionIV(): "/D}$2al!"
//
// DESKeySpec(var1.getBytes()) → takes the raw bytes and **only first 8**
// because DES requires 8-byte keys.
// ==========================================================================
const KEY_STRING = "fdäK?s^dw-+ç,W!El"; // full Java string
const IV_STRING = "/D}$2al!"; // exactly 8 chars

// Raw bytes from full KEY_STRING. Subarray to 8 bytes because DES = 8 byte key
// (Java silently ignores rest beyond byte 8).
const RAW_KEY_BYTES = Buffer.from(KEY_STRING, "utf8").subarray(0, 8);

// Node would require parity-corrected DES key bytes for OpenSSL
// but since OpenSSL DES was disabled entirely, we moved to CryptoJS.
// Keeping variable here for debugging purposes.
const KEY_BYTES = RAW_KEY_BYTES;
const IV_BYTES = Buffer.from(IV_STRING, "utf8");

// ==========================================================================
// Decrypt AT$<Base64> or QT$<Base64> using DES/CBC/PKCS7 (Java PKCS5 equiv)
//
// CryptoJS encryption format call must mimic:
//   Cipher.getInstance("DES/CBC/PKCS5Padding")
//   dcipher.doFinal(base64DecodedBytes)
//
// Java and CryptoJS both consider PKCS5Padding == PKCS7 for 8-byte block ciphers.
// ==========================================================================
function decryptStoredAnswer(stored: string) {
  if (!stored || stored.length <= 3)
    return { idString: null, plaintext: null };

  // Remove "AT$" or "QT$"
  const base64Payload = stored.substring(3);

  try {
    // First 8 UTF-8 chars of password — same behavior as Java DESKeySpec(keyString.getBytes())
    const key = CryptoJS.enc.Utf8.parse(KEY_STRING.substring(0, 8));
    const iv = CryptoJS.enc.Utf8.parse(IV_STRING);

    // DES decrypt
    const decrypted = CryptoJS.DES.decrypt(
      { ciphertext: CryptoJS.enc.Base64.parse(base64Payload) },
      key,
      {
        iv,
        mode: CryptoJS.mode.CBC,
        padding: CryptoJS.pad.Pkcs7, // PKCS5Padding equivalent
      }
    );

    const text = decrypted.toString(CryptoJS.enc.Utf8);
    if (!text) return { idString: null, plaintext: null };

    // Split "<idString>:<plaintext>"
    const idx = text.indexOf(":");
    if (idx === -1) return { idString: null, plaintext: text };

    return {
      idString: text.substring(0, idx),
      plaintext: text.substring(idx + 1),
    };
  } catch (e) {
    // Decryption failed — caller will count prefixButFailed
    return { idString: null, plaintext: null };
  }
}

// ==========================================================================
// Helper: parse decrypted answer payload "0=d) 50’000 m"
//
// "0=d) 50’000 m" →
//   isCorrect = 0
//   letter    = "d"
//   text      = "50’000 m"
//
// We keep ZTEXT_DECRYPTED as the full plaintext and add:
//   ZCORRECT_DECRYPTED, ZANSWER_LETTER, ZANSWER_TEXT
// ==========================================================================
function parseDecryptedAnswerPayload(plaintext: string | null): {
  isCorrect: number | null;
  letter: string | null;
  text: string | null;
} {
  if (!plaintext) {
    return { isCorrect: null, letter: null, text: null };
  }

  const trimmed = plaintext.trim();
  const match = /^([01])=([a-zA-Z])\)\s*(.*)$/.exec(trimmed);

  if (!match) {
    // Not in the expected "0=a) text" format.
    // Still return the full text as ZANSWER_TEXT if non-empty.
    return {
      isCorrect: null,
      letter: null,
      text: trimmed.length > 0 ? trimmed : null,
    };
  }

  const [, flag, letter, rest] = match;

  return {
    isCorrect: flag === "1" ? 1 : 0,
    letter,
    text: rest.trim().length > 0 ? rest.trim() : null,
  };
}

// ==========================================================================
// GET handler: reads every row from ZILPANSWER and ZILPQUESTION,
// decrypts all encrypted rows, and writes results into mirror tables
// ZILPANSWER_DECRYPTED and ZILPQUESTION_DECRYPTED.
// ==========================================================================
export async function GET() {
  const { dbPath: DB_PATH } = getResolvedPaths();
  let db: Database.Database;

  try {
    // open DB writable because we will create / delete table rows
    db = new Database(DB_PATH, { readonly: false });
  } catch (err: any) {
    return NextResponse.json(
      { error: `Failed to open DB at ${DB_PATH}`, details: String(err) },
      { status: 500 }
    );
  }

  try {
    // ----------------------------------------------------------------------
    // ANSWERS: ZILPANSWER  →  ZILPANSWER_DECRYPTED
    // ----------------------------------------------------------------------
    const answerTableInfo = db.prepare("PRAGMA table_info(ZILPANSWER)").all();
    if (!answerTableInfo || answerTableInfo.length === 0) {
      db.close();
      return NextResponse.json(
        { error: "ZILPANSWER table not found in database." },
        { status: 500 }
      );
    }

    // Collect original column names to mirror structure
    const answerColNames = answerTableInfo.map((c: any) => c.name);
    const answerBaseCols = answerColNames.join(", ");

    // Create decrypted table on first run or wipe existing
    const hasAnswerDecryptedTable = !!db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='ZILPANSWER_DECRYPTED';"
      )
      .get();

    if (!hasAnswerDecryptedTable) {
      // New table with same structure but empty
      db.exec(`
        CREATE TABLE ZILPANSWER_DECRYPTED AS
        SELECT * FROM ZILPANSWER WHERE 0;
      `);
    } else {
      // Clean table so repeating calls don't multiply rows
      db.exec(`DELETE FROM ZILPANSWER_DECRYPTED;`);
    }

    // Adds our own decrypted text + id columns if missing
    try {
      db.exec(
        `ALTER TABLE ZILPANSWER_DECRYPTED ADD COLUMN ZTEXT_DECRYPTED TEXT;`
      );
    } catch {}
    try {
      db.exec(`ALTER TABLE ZILPANSWER_DECRYPTED ADD COLUMN ZIDSTRING TEXT;`);
    } catch {}

    // Additional parsed columns:
    //  - ZCORRECT_DECRYPTED : 0/1 from the first char
    //  - ZANSWER_LETTER     : "a"/"b"/"c"/"d"
    //  - ZANSWER_TEXT       : answer text without the flag/letter prefix
    try {
      db.exec(
        `ALTER TABLE ZILPANSWER_DECRYPTED ADD COLUMN ZCORRECT_DECRYPTED INTEGER;`
      );
    } catch {}
    try {
      db.exec(
        `ALTER TABLE ZILPANSWER_DECRYPTED ADD COLUMN ZANSWER_LETTER TEXT;`
      );
    } catch {}
    try {
      db.exec(`ALTER TABLE ZILPANSWER_DECRYPTED ADD COLUMN ZANSWER_TEXT TEXT;`);
    } catch {}

    const answerPlaceholders =
      answerColNames.map((n: string) => `@${n}`).join(", ") +
      ", @ZTEXT_DECRYPTED, @ZIDSTRING, @ZCORRECT_DECRYPTED, @ZANSWER_LETTER, @ZANSWER_TEXT";

    const answerInsertStmt = db.prepare(
      `INSERT INTO ZILPANSWER_DECRYPTED (${answerBaseCols}, ZTEXT_DECRYPTED, ZIDSTRING, ZCORRECT_DECRYPTED, ZANSWER_LETTER, ZANSWER_TEXT)
       VALUES (${answerPlaceholders})`
    );

    const answerRows = db.prepare("SELECT * FROM ZILPANSWER").all();

    // counters for answers
    let answerTotal = 0;
    let answerDecrypted = 0;
    let answerWithPrefix = 0;
    let answerPrefixButFailed = 0;

    // Run insert inside transaction for performance
    const answerTx = db.transaction((rows: any[]) => {
      for (const row of rows) {
        answerTotal++;

        const raw = typeof row.ZTEXT === "string" ? row.ZTEXT : null;
        let ZTEXT_DECRYPTED: string | null = null;
        let ZIDSTRING: string | null = null;
        let ZCORRECT_DECRYPTED: number | null = null;
        let ZANSWER_LETTER: string | null = null;
        let ZANSWER_TEXT: string | null = null;

        // detect encrypted strings
        if (raw && (raw.startsWith("AT$") || raw.startsWith("QT$"))) {
          answerWithPrefix++;
          const { idString, plaintext } = decryptStoredAnswer(raw);

          if (plaintext !== null) {
            ZTEXT_DECRYPTED = plaintext;
            ZIDSTRING = idString;

            // parse "0=d) 50’000 m" into separate fields
            const parsed = parseDecryptedAnswerPayload(plaintext);
            ZCORRECT_DECRYPTED = parsed.isCorrect;
            ZANSWER_LETTER = parsed.letter;
            ZANSWER_TEXT = parsed.text;

            answerDecrypted++;
          } else {
            answerPrefixButFailed++;
          }
        }

        answerInsertStmt.run({
          ...row,
          ZTEXT_DECRYPTED,
          ZIDSTRING,
          ZCORRECT_DECRYPTED,
          ZANSWER_LETTER,
          ZANSWER_TEXT,
        });
      }
    });

    answerTx(answerRows);

    // ----------------------------------------------------------------------
    // QUESTIONS: ZILPQUESTION  →  ZILPQUESTION_DECRYPTED
    // ----------------------------------------------------------------------
    const questionTableInfo = db.prepare("PRAGMA table_info(ZILPQUESTION)").all();
    if (!questionTableInfo || questionTableInfo.length === 0) {
      db.close();
      return NextResponse.json(
        {
          error: "ZILPQUESTION table not found in database.",
          // still return answer stats so far
          answerProcessedRows: answerTotal,
          answerDecryptedRows: answerDecrypted,
        },
        { status: 500 }
      );
    }

    const questionColNames = questionTableInfo.map((c: any) => c.name);
    const questionBaseCols = questionColNames.join(", ");

    const hasQuestionDecryptedTable = !!db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='ZILPQUESTION_DECRYPTED';"
      )
      .get();

    if (!hasQuestionDecryptedTable) {
      db.exec(`
        CREATE TABLE ZILPQUESTION_DECRYPTED AS
        SELECT * FROM ZILPQUESTION WHERE 0;
      `);
    } else {
      db.exec(`DELETE FROM ZILPQUESTION_DECRYPTED;`);
    }

    try {
      db.exec(
        `ALTER TABLE ZILPQUESTION_DECRYPTED ADD COLUMN ZTEXT_DECRYPTED TEXT;`
      );
    } catch {}
    try {
      db.exec(`ALTER TABLE ZILPQUESTION_DECRYPTED ADD COLUMN ZIDSTRING TEXT;`);
    } catch {}

    const questionPlaceholders =
      questionColNames.map((n: string) => `@${n}`).join(", ") +
      ", @ZTEXT_DECRYPTED, @ZIDSTRING";

    const questionInsertStmt = db.prepare(
      `INSERT INTO ZILPQUESTION_DECRYPTED (${questionBaseCols}, ZTEXT_DECRYPTED, ZIDSTRING)
       VALUES (${questionPlaceholders})`
    );

    const questionRows = db.prepare("SELECT * FROM ZILPQUESTION").all();

    let questionTotal = 0;
    let questionDecrypted = 0;
    let questionWithPrefix = 0;
    let questionPrefixButFailed = 0;

    const questionTx = db.transaction((rows: any[]) => {
      for (const row of rows) {
        questionTotal++;

        const raw = typeof row.ZTEXT === "string" ? row.ZTEXT : null;
        let ZTEXT_DECRYPTED: string | null = null;
        let ZIDSTRING: string | null = null;

        if (raw && (raw.startsWith("AT$") || raw.startsWith("QT$"))) {
          questionWithPrefix++;
          const { idString, plaintext } = decryptStoredAnswer(raw);

          if (plaintext !== null) {
            ZTEXT_DECRYPTED = plaintext;
            ZIDSTRING = idString;
            questionDecrypted++;
          } else {
            questionPrefixButFailed++;
          }
        }

        questionInsertStmt.run({
          ...row,
          ZTEXT_DECRYPTED,
          ZIDSTRING,
        });
      }
    });

    questionTx(questionRows);

    // Done with DB
    db.close();

    // returning debug info
    return NextResponse.json({
      ok: true,
      dbPath: DB_PATH,

      // Backwards-compatible "answer" stats:
      processedRows: answerTotal,
      decryptedRows: answerDecrypted,
      withPrefix: answerWithPrefix,
      prefixButFailed: answerPrefixButFailed,
      table: "ZILPANSWER_DECRYPTED",

      // Explicit separated stats:
      answerProcessedRows: answerTotal,
      answerDecryptedRows: answerDecrypted,
      answerWithPrefix,
      answerPrefixButFailed,

      questionProcessedRows: questionTotal,
      questionDecryptedRows: questionDecrypted,
      questionWithPrefix,
      questionPrefixButFailed,
      questionTable: "ZILPQUESTION_DECRYPTED",

      rawKeyBytesHex: RAW_KEY_BYTES.toString("hex"),
    });
  } catch (err: any) {
    try {
      db!.close();
    } catch {}
    return NextResponse.json(
      { error: "Failed to decrypt/write answers/questions", details: String(err) },
      { status: 500 }
    );
  }
}
