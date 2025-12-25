import fs from 'fs';
import path from 'path';
import os from 'os';

export interface AppConfig {
  /**
   * Path to the Beook installation folder, e.g.
   * C:/Users/<username>/AppData/Roaming/ionesoft/beook
   */
  beookDir: string;
  /**
   * Selected profile folder number (stringified), e.g. "1"
   * NOTE: profile "0" is a dummy and should be ignored.
   */
  selectedProfile: string;
}

const CONFIG_DIR = (() => {
  // For the packaged Windows app, we must store config in a writable user folder,
  // NOT next to the installed executable (Program Files is read-only for non-admins).
  if (process.platform === 'win32') {
    const appData =
      process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(appData, 'Beook2PDF');
  }

  // Fallback (mainly for local/dev use on non-Windows).
  return path.join(os.homedir(), '.beook2pdf');
})();

const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const LEGACY_CONFIG_FILE = path.join(process.cwd(), 'config.json');

// Default paths
function getDefaultConfig(): AppConfig {
  const username = os.userInfo().username;
  return {
    beookDir: `C:/Users/${username}/AppData/Roaming/ionesoft/beook`,
    selectedProfile: '1',
  };
}

// Resolve username placeholder in paths
function resolvePath(pathString: string): string {
  const username = os.userInfo().username;
  return pathString.replace(/\$\{username\}/g, username);
}

type LegacyAppConfig = {
  dbPath: string;
  imgPath: string;
};

function isLegacyConfig(config: any): config is LegacyAppConfig {
  return (
    config &&
    typeof config.dbPath === 'string' &&
    typeof config.imgPath === 'string'
  );
}

function isV2Config(config: any): config is AppConfig {
  return (
    config &&
    typeof config.beookDir === 'string' &&
    typeof config.selectedProfile === 'string'
  );
}

function migrateLegacyConfig(legacy: LegacyAppConfig): AppConfig {
  const dbPath = legacy.dbPath ?? '';
  const imgPath = legacy.imgPath ?? '';

  const extractBeookDir = (p: string) => {
    const normalized = p.replace(/\\/g, '/');
    const releaseIdx = normalized.toLowerCase().indexOf('/release/');
    if (releaseIdx !== -1) return normalized.slice(0, releaseIdx);
    return normalized;
  };

  const beookDirGuess = extractBeookDir(dbPath || imgPath).trim();

  // Try to parse ".../release/profiles/<n>/" from the legacy dbPath
  let selectedProfile = '1';
  const normalizedDb = dbPath.replace(/\\/g, '/');
  const m = normalizedDb.match(/\/release\/profiles\/(\d+)\//i);
  if (m?.[1]) selectedProfile = m[1];

  return {
    beookDir: beookDirGuess || getDefaultConfig().beookDir,
    selectedProfile,
  };
}

function normalizeProfileId(profile: unknown): string {
  const raw = typeof profile === 'string' ? profile : String(profile ?? '');
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return '1';
  if (trimmed === '0') return '1';
  return trimmed;
}

// Read config from file or return defaults
export function getConfig(): AppConfig {
  try {
    // One-time migration: move dev-era config (project root) into the per-user config dir.
    // This also makes the installed app work (Program Files is not writable).
    try {
      if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
      if (!fs.existsSync(CONFIG_FILE) && fs.existsSync(LEGACY_CONFIG_FILE)) {
        fs.copyFileSync(LEGACY_CONFIG_FILE, CONFIG_FILE);
      }
    } catch (migrationError) {
      console.warn('Config migration failed (continuing with defaults):', migrationError);
    }

    if (fs.existsSync(CONFIG_FILE)) {
      const fileContent = fs.readFileSync(CONFIG_FILE, 'utf-8');
      const parsed: any = JSON.parse(fileContent);

      if (isV2Config(parsed)) {
        return {
          beookDir: parsed.beookDir,
          selectedProfile: normalizeProfileId(parsed.selectedProfile),
        };
      }

      if (isLegacyConfig(parsed)) {
        const migrated = migrateLegacyConfig(parsed);
        // Persist migration so the rest of the app uses the new shape.
        setConfig(migrated);
        return migrated;
      }
    }
  } catch (error) {
    console.error('Error reading config file:', error);
  }
  
  // Return defaults if file doesn't exist or is invalid
  return getDefaultConfig();
}

// Write config to file
export function setConfig(config: AppConfig): void {
  try {
    if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
    // Validate config
    if (typeof config.beookDir !== 'string' || typeof config.selectedProfile !== 'string') {
      throw new Error('Invalid config: beookDir and selectedProfile must be strings');
    }
    
    if (!config.beookDir.trim()) {
      throw new Error('Invalid config: beookDir cannot be empty');
    }
    
    const normalized: AppConfig = {
      beookDir: config.beookDir.trim(),
      selectedProfile: normalizeProfileId(config.selectedProfile),
    };

    fs.writeFileSync(CONFIG_FILE, JSON.stringify(normalized, null, 2), 'utf-8');
  } catch (error) {
    console.error('Error writing config file:', error);
    throw error;
  }
}

export type ResolvedPaths = {
  beookDir: string;
  selectedProfile: string;
  profilesDir: string;
  dbPath: string;
  imgPath: string;
};

// Get resolved paths (with username placeholder replaced)
export function getResolvedPaths(): ResolvedPaths {
  const config = getConfig();
  const beookDir = path.resolve(resolvePath(config.beookDir));
  const selectedProfile = normalizeProfileId(config.selectedProfile);
  return {
    beookDir,
    selectedProfile,
    profilesDir: path.join(beookDir, 'release', 'profiles'),
    dbPath: path.join(
      beookDir,
      'release',
      'profiles',
      selectedProfile,
      'data',
      'beook_book_v6.sqlite'
    ),
    imgPath: path.join(beookDir, 'release', 'assetStage', 'prod', 'fileSynch'),
  };
}

// Reset config to defaults
export function resetConfig(): AppConfig {
  const defaultConfig = getDefaultConfig();
  setConfig(defaultConfig);
  return defaultConfig;
}

