import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { getConfig, getResolvedPaths } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ProfileInfo = {
  id: string; // folder number e.g. "1"
  name: string; // e.g. "1 John Doe"
  firstName: string | null;
  lastName: string | null;
};

function getStringFieldInsensitive(row: Record<string, any>, candidates: string[]): string | null {
  const keys = Object.keys(row);
  const lowerToKey = new Map(keys.map((k) => [k.toLowerCase(), k]));

  for (const cand of candidates) {
    const key = lowerToKey.get(cand.toLowerCase());
    if (!key) continue;
    const v = row[key];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (v != null) {
      const s = String(v).trim();
      if (s) return s;
    }
  }
  return null;
}

export async function GET() {
  try {
    const config = getConfig();
    const resolved = getResolvedPaths();
    const profilesRoot = path.join(resolved.beookPath, "release", "profiles");

    if (!fs.existsSync(profilesRoot)) {
      return NextResponse.json({
        success: true,
        profiles: [] as ProfileInfo[],
        selectedProfileId: config.profileId,
        warning: `Profiles folder not found at ${profilesRoot}`,
      });
    }

    const dirents = fs.readdirSync(profilesRoot, { withFileTypes: true });
    const profileIds = dirents
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .filter((name) => /^\d+$/.test(name))
      .filter((name) => name !== "0")
      .sort((a, b) => parseInt(a, 10) - parseInt(b, 10));

    const profiles: ProfileInfo[] = [];

    for (const id of profileIds) {
      const dbPath = path.join(profilesRoot, id, "data", "beook_book_v6.sqlite");
      if (!fs.existsSync(dbPath)) continue;

      let db: Database.Database | null = null;
      try {
        db = new Database(dbPath, { readonly: true, fileMustExist: true });

        // A profile is considered "real" if ZILPUSER has at least one row.
        let row: any = null;
        try {
          row = db.prepare("SELECT * FROM ZILPUSER LIMIT 1").get();
        } catch {
          row = null;
        }

        if (!row) continue;

        const firstName =
          getStringFieldInsensitive(row, [
            "ZFIRSTNAME",
            "ZFIRST_NAME",
            "ZNAMEFIRST",
            "ZVORNAME",
            "ZVORNAME_DECRYPTED",
          ]) ?? null;

        const lastName =
          getStringFieldInsensitive(row, [
            "ZLASTNAME",
            "ZLAST_NAME",
            "ZNAME",
            "ZSURNAME",
            "ZFAMILYNAME",
            "ZNACHNAME",
            "ZNACHNAME_DECRYPTED",
          ]) ?? null;

        const displayName = [id, firstName, lastName].filter(Boolean).join(" ").trim() || id;

        profiles.push({
          id,
          name: displayName,
          firstName,
          lastName,
        });
      } catch {
        // Ignore broken/inaccessible profiles
      } finally {
        try {
          db?.close();
        } catch {}
      }
    }

    return NextResponse.json({
      success: true,
      profiles,
      selectedProfileId: config.profileId,
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error?.message ?? "Failed to list profiles" },
      { status: 500 }
    );
  }
}


