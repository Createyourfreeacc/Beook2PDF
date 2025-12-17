import { NextRequest, NextResponse } from 'next/server';
import { getConfig, setConfig, resetConfig, getResolvedPaths } from '@/lib/config';
import path from 'path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET: Returns current config
export async function GET() {
  try {
    const config = getConfig();
    const resolved = getResolvedPaths();
    
    return NextResponse.json({
      success: true,
      config: {
        beookPath: config.beookPath,
        profileId: config.profileId,
      },
      resolved: {
        beookPath: resolved.beookPath,
        profileId: resolved.profileId,
        dbPath: resolved.dbPath,
        imgPath: resolved.imgPath,
      },
    });
  } catch (error) {
    console.error('Error getting config:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to get config' },
      { status: 500 }
    );
  }
}

// POST: Updates config
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { beookPath, profileId, reset, dbPath } = body;

    // Handle reset request
    if (reset === true) {
      const defaultConfig = resetConfig();
      const resolved = getResolvedPaths();
      
      return NextResponse.json({
        success: true,
        message: 'Config reset to defaults',
        config: {
          beookPath: defaultConfig.beookPath,
          profileId: defaultConfig.profileId,
        },
        resolved: {
          beookPath: resolved.beookPath,
          profileId: resolved.profileId,
          dbPath: resolved.dbPath,
          imgPath: resolved.imgPath,
        },
      });
    }

    // Back-compat: if older client sends dbPath, derive the beook base folder from it.
    if (typeof beookPath !== 'string') {
      if (typeof dbPath !== 'string' || !dbPath.trim()) {
        return NextResponse.json(
          { success: false, error: 'beookPath must be a string' },
          { status: 400 }
        );
      }

      const dbPathNormalized = dbPath.trim();
      const match = dbPathNormalized.replace(/\\/g, '/').match(/\/release\/profiles\/(\d+)\//i);
      const derivedProfileId = match?.[1] ?? String(profileId ?? '1');
      const derivedBeookPath = path.resolve(dbPathNormalized, '..', '..', '..', '..', '..');
      setConfig({ beookPath: derivedBeookPath, profileId: derivedProfileId });
    } else {
      setConfig({ beookPath, profileId: String(profileId ?? '1') });
    }
    const resolved = getResolvedPaths();

    return NextResponse.json({
      success: true,
      message: 'Config updated successfully',
      config: {
        beookPath: getConfig().beookPath,
        profileId: getConfig().profileId,
      },
      resolved: {
        beookPath: resolved.beookPath,
        profileId: resolved.profileId,
        dbPath: resolved.dbPath,
        imgPath: resolved.imgPath,
      },
    });
  } catch (error: any) {
    console.error('Error updating config:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: error.message || 'Failed to update config' 
      },
      { status: 500 }
    );
  }
}

