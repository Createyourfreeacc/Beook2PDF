import { NextRequest, NextResponse } from 'next/server';
import { getConfig, setConfig, resetConfig, getResolvedPaths } from '@/lib/config';

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
        beookDir: config.beookDir,
        selectedProfile: config.selectedProfile,
      },
      resolved: {
        beookDir: resolved.beookDir,
        selectedProfile: resolved.selectedProfile,
        profilesDir: resolved.profilesDir,
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
    const { beookDir, selectedProfile, reset } = body;

    // Handle reset request
    if (reset === true) {
      const defaultConfig = resetConfig();
      const resolved = getResolvedPaths();
      
      return NextResponse.json({
        success: true,
        message: 'Config reset to defaults',
        config: {
          beookDir: defaultConfig.beookDir,
          selectedProfile: defaultConfig.selectedProfile,
        },
        resolved: {
          beookDir: resolved.beookDir,
          selectedProfile: resolved.selectedProfile,
          profilesDir: resolved.profilesDir,
          dbPath: resolved.dbPath,
          imgPath: resolved.imgPath,
        },
      });
    }

    // Partial update: keep existing values if not provided
    const current = getConfig();

    const nextBeookDir =
      typeof beookDir === 'string' ? beookDir : current.beookDir;
    const nextSelectedProfile =
      typeof selectedProfile === 'string'
        ? selectedProfile
        : current.selectedProfile;

    if (typeof nextBeookDir !== 'string' || !nextBeookDir.trim()) {
      return NextResponse.json(
        { success: false, error: 'beookDir must be a non-empty string' },
        { status: 400 }
      );
    }

    // Update config (lib/config will normalize selectedProfile and validate)
    setConfig({ beookDir: nextBeookDir, selectedProfile: nextSelectedProfile });
    const resolved = getResolvedPaths();

    return NextResponse.json({
      success: true,
      message: 'Config updated successfully',
      config: {
        beookDir: nextBeookDir,
        selectedProfile: nextSelectedProfile,
      },
      resolved: {
        beookDir: resolved.beookDir,
        selectedProfile: resolved.selectedProfile,
        profilesDir: resolved.profilesDir,
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

