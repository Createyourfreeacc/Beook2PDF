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
  // Use os.homedir() to get the actual user's home directory
  // This works across different Windows setups and avoids hardcoding C:/Users/
  const homeDir = os.homedir();
  const appDataDir = process.platform === 'win32' 
    ? (process.env.APPDATA ?? path.join(homeDir, 'AppData', 'Roaming'))
    : path.join(homeDir, '.config');
  
  return {
    beookDir: path.join(appDataDir, 'ionesoft', 'beook'),
    selectedProfile: '1',
  };
}

// Resolve username placeholder in paths
function resolvePath(pathString: string): string {
  const username = os.userInfo().username;
  return pathString.replace(/\$\{username\}/g, username);
}

// Fix hardcoded usernames in paths - replaces any username in a path with the current user's path
function fixHardcodedUsername(pathString: string): string {
  if (!pathString || typeof pathString !== 'string') return pathString;
  
  const currentHomeDir = os.homedir();
  const currentUsername = os.userInfo().username;
  
  // Normalize both paths for comparison (use forward slashes)
  const normalized = pathString.replace(/\\/g, '/');
  const normalizedHome = currentHomeDir.replace(/\\/g, '/');
  
  // Pattern to match Windows user paths: C:/Users/<username>/ or /Users/<username>/
  // This matches the drive letter (optional), /Users/, username, and the rest
  const userPathPattern = /^([A-Z]:)?\/Users\/([^\/]+)(\/.*)$/i;
  const match = normalized.match(userPathPattern);
  
  if (match) {
    const [, drive, oldUsername, rest] = match;
    
    // Only fix if the username in the path doesn't match the current user
    if (oldUsername.toLowerCase() !== currentUsername.toLowerCase()) {
      // Reconstruct the path with the current user's home directory
      // Preserve the original drive letter if present, otherwise use the current home's drive
      const driveLetter = drive || (normalizedHome.match(/^([A-Z]:)/i)?.[1] || '');
      const fixedPath = `${driveLetter}/Users/${currentUsername}${rest}`;
      
      // Convert back to the original path separator style (preserve backslashes if original had them)
      return pathString.includes('\\') ? fixedPath.replace(/\//g, '\\') : fixedPath;
    }
  }
  
  return pathString;
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

  const beookDir = beookDirGuess || getDefaultConfig().beookDir;
  return {
    beookDir: fixHardcodedUsername(beookDir),
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
        // Fix any hardcoded usernames in the path
        const fixedBeookDir = fixHardcodedUsername(parsed.beookDir);
        
        // If the path was fixed, save it back to the config file
        if (fixedBeookDir !== parsed.beookDir) {
          setConfig({
            beookDir: fixedBeookDir,
            selectedProfile: normalizeProfileId(parsed.selectedProfile),
          });
        }
        
        return {
          beookDir: fixedBeookDir,
          selectedProfile: normalizeProfileId(parsed.selectedProfile),
        };
      }

      if (isLegacyConfig(parsed)) {
        const migrated = migrateLegacyConfig(parsed);
        // Fix any hardcoded usernames in the migrated path
        migrated.beookDir = fixHardcodedUsername(migrated.beookDir);
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

