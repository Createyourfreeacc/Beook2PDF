import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import sqlite from 'better-sqlite3';
import { getResolvedPaths } from '@/lib/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type ProfileInfo = {
  id: string; // folder number, e.g. "1"
  label: string; // e.g. "1 John Doe"
  selectable: boolean;
  firstName?: string;
  lastName?: string;
  reason?: string;
};

function buildProfileLabel(id: string, firstName?: string, lastName?: string) {
  const parts = [id, firstName ?? '', lastName ?? '']
    .map((p) => String(p).trim())
    .filter(Boolean);
  return parts.join(' ');
}

export async function GET() {
  try {
    const { profilesDir, selectedProfile } = getResolvedPaths();

    if (!fs.existsSync(profilesDir)) {
      return NextResponse.json(
        {
          success: false,
          error: `Profiles directory not found: ${profilesDir}`,
          selectedProfile,
          profiles: [],
        },
        { status: 400 }
      );
    }

    const dirEntries = fs.readdirSync(profilesDir, { withFileTypes: true });
    const profileIds = dirEntries
      .filter((d) => d.isDirectory() && /^\d+$/.test(d.name))
      .map((d) => d.name)
      .filter((id) => id !== '0')
      .sort((a, b) => parseInt(a, 10) - parseInt(b, 10));

    const profiles: ProfileInfo[] = [];

    for (const id of profileIds) {
      const dbPath = path.join(
        profilesDir,
        id,
        'data',
        'beook_book_v6.sqlite'
      );

      if (!fs.existsSync(dbPath)) {
        profiles.push({
          id,
          label: buildProfileLabel(id),
          selectable: false,
          reason: `Missing DB file: ${dbPath}`,
        });
        continue;
      }

      let db: sqlite.Database | null = null;
      try {
        db = sqlite(dbPath, { readonly: true });

        const hasUserTable = !!db
          .prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='ZILPUSER';"
          )
          .get();

        if (!hasUserTable) {
          profiles.push({
            id,
            label: buildProfileLabel(id),
            selectable: false,
            reason: 'ZILPUSER table not found',
          });
          continue;
        }

        const row = db.prepare('SELECT * FROM ZILPUSER LIMIT 1').get() as
          | Record<string, any>
          | undefined;

        if (!row) {
          profiles.push({
            id,
            label: buildProfileLabel(id),
            selectable: false,
            reason: 'ZILPUSER is empty',
          });
          continue;
        }

        const cols = Object.keys(row);
        const firstCol =
          cols.find((c) => /first/i.test(c)) ??
          cols.find((c) => /vorname/i.test(c));
        const lastCol =
          cols.find((c) => /last/i.test(c)) ??
          cols.find((c) => /surname/i.test(c)) ??
          cols.find((c) => /nachname/i.test(c));

        const firstName = firstCol ? String(row[firstCol] ?? '').trim() : '';
        const lastName = lastCol ? String(row[lastCol] ?? '').trim() : '';

        profiles.push({
          id,
          label: buildProfileLabel(id, firstName, lastName),
          selectable: true,
          firstName,
          lastName,
        });
      } catch (e: any) {
        profiles.push({
          id,
          label: buildProfileLabel(id),
          selectable: false,
          reason: `Failed to read profile DB: ${String(e?.message ?? e)}`,
        });
      } finally {
        try {
          db?.close();
        } catch {}
      }
    }

    return NextResponse.json({
      success: true,
      selectedProfile,
      profiles,
    });
  } catch (e: any) {
    return NextResponse.json(
      { success: false, error: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}


