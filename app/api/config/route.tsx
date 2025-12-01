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
        dbPath: config.dbPath,
        imgPath: config.imgPath,
      },
      resolved: {
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
    const { dbPath, imgPath, reset } = body;

    // Handle reset request
    if (reset === true) {
      const defaultConfig = resetConfig();
      const resolved = getResolvedPaths();
      
      return NextResponse.json({
        success: true,
        message: 'Config reset to defaults',
        config: {
          dbPath: defaultConfig.dbPath,
          imgPath: defaultConfig.imgPath,
        },
        resolved: {
          dbPath: resolved.dbPath,
          imgPath: resolved.imgPath,
        },
      });
    }

    // Validate input
    if (typeof dbPath !== 'string' || typeof imgPath !== 'string') {
      return NextResponse.json(
        { success: false, error: 'dbPath and imgPath must be strings' },
        { status: 400 }
      );
    }

    if (!dbPath.trim() || !imgPath.trim()) {
      return NextResponse.json(
        { success: false, error: 'dbPath and imgPath cannot be empty' },
        { status: 400 }
      );
    }

    // Update config
    setConfig({ dbPath, imgPath });
    const resolved = getResolvedPaths();

    return NextResponse.json({
      success: true,
      message: 'Config updated successfully',
      config: {
        dbPath,
        imgPath,
      },
      resolved: {
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

