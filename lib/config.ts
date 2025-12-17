import fs from 'fs';
import path from 'path';
import os from 'os';

export interface AppConfig {
  // User points this at the Beook base folder, e.g.
  // C:/Users/${username}/AppData/Roaming/ionesoft/beook
  beookPath: string;

  // Selected profile folder number under <beookPath>/release/profiles/<profileId>
  // Note: profile "0" is a dummy/empty profile and should not be used.
  profileId: string;
}

const CONFIG_FILE = path.join(process.cwd(), 'config.json');

// Default paths
function getDefaultConfig(): AppConfig {
  const username = os.userInfo().username;
  return {
    beookPath: `C:/Users/${username}/AppData/Roaming/ionesoft/beook`,
    profileId: '1',
  };
}

// Resolve username placeholder in paths
function resolvePath(pathString: string): string {
  const username = os.userInfo().username;
  return pathString.replace(/\$\{username\}/g, username);
}

function normalizeProfileId(profileId: unknown): string {
  const s = String(profileId ?? '').trim();
  const m = s.match(/^(\d+)$/);
  if (!m) return '1';
  // profile "0" is a known dummy/empty folder
  if (m[1] === '0') return '1';
  return m[1];
}

function deriveFromAnyPath(inputRaw: string): { beookPath: string; profileId: string } | null {
  const input = resolvePath(String(inputRaw ?? '').trim());
  if (!input) return null;

  const normalized = input.replace(/\\/g, '/');

  // Common case: user pastes something *inside* the Beook folder like:
  // <beook>/release/profiles/<n>/data/beook_book_v6.sqlite
  // <beook>/release/profiles/<n>/data/
  // <beook>/release/profiles/<n>/
  // <beook>/release/profiles/
  const m = normalized.match(/^(.*)\/release\/profiles\/(\d+)(?:\/|$)/i);
  if (m) {
    const beookPath = path.resolve(m[1]);
    const profileId = normalizeProfileId(m[2]);
    return { beookPath, profileId };
  }

  // If someone pastes a direct SQLite path but it doesn't match the above for some reason,
  // fall back to the original "go up 5 levels" heuristic.
  if (normalized.toLowerCase().endsWith('.sqlite')) {
    const profileMatch = normalized.match(/\/release\/profiles\/(\d+)\//i);
    const profileId = normalizeProfileId(profileMatch?.[1] ?? '1');
    const beookPath = path.resolve(input, '..', '..', '..', '..', '..');
    return { beookPath, profileId };
  }

  // If user points at "<beook>/release" or "<beook>/release/..."
  const releaseMatch = normalized.match(/^(.*)\/release(?:\/|$)/i);
  if (releaseMatch) {
    return { beookPath: path.resolve(releaseMatch[1]), profileId: '1' };
  }

  // Otherwise assume they already pointed at the Beook base folder.
  return { beookPath: path.resolve(input), profileId: '1' };
}

// Read config from file or return defaults
export function getConfig(): AppConfig {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const fileContent = fs.readFileSync(CONFIG_FILE, 'utf-8');
      const raw: any = JSON.parse(fileContent);

      // v2 config (beookPath + profileId)
      if (typeof raw?.beookPath === 'string') {
        const beookPath = raw.beookPath.trim();
        const profileId = normalizeProfileId(raw.profileId);
        if (beookPath) {
          return { beookPath, profileId };
        }
      }

      // v1 config (dbPath + imgPath) -> migrate
      if (typeof raw?.dbPath === 'string') {
        const derived = deriveFromAnyPath(raw.dbPath);
        if (derived?.beookPath) {
          const migrated: AppConfig = {
            beookPath: derived.beookPath,
            profileId: derived.profileId,
          };
          // Best-effort write-back to avoid keeping stale schema around
          try {
            setConfig(migrated);
          } catch {}
          return migrated;
        }
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
    // Validate config
    if (typeof config.beookPath !== 'string') {
      throw new Error('Invalid config: beookPath must be a string');
    }

    let beookPath = config.beookPath.trim();
    let profileId = normalizeProfileId(config.profileId);

    // Be forgiving if a user pastes a path *inside* the Beook folder (DB path, profile folder, etc.).
    // In that case, derive the base folder + profileId from it.
    const inputNormalized = resolvePath(beookPath).replace(/\\/g, '/');
    const impliesProfileInPath =
      /\/release\/profiles\/\d+(?:\/|$)/i.test(inputNormalized) ||
      inputNormalized.toLowerCase().endsWith('.sqlite');

    const derived = deriveFromAnyPath(beookPath);
    if (derived?.beookPath) {
      beookPath = derived.beookPath;
      // Only infer profileId from the path if the user actually pasted a profile-specific path.
      // Otherwise keep the explicitly selected profileId.
      if (impliesProfileInPath) {
        profileId = normalizeProfileId(derived.profileId);
      }
    }

    if (!beookPath) {
      throw new Error('Invalid config: beookPath cannot be empty');
    }

    fs.writeFileSync(
      CONFIG_FILE,
      JSON.stringify({ beookPath, profileId }, null, 2),
      'utf-8'
    );
  } catch (error) {
    console.error('Error writing config file:', error);
    throw error;
  }
}

// Get resolved paths (with username placeholder replaced)
export function getResolvedPaths(profileIdOverride?: string): {
  beookPath: string;
  profileId: string;
  dbPath: string;
  imgPath: string;
} {
  const config = getConfig();
  const profileId = normalizeProfileId(profileIdOverride ?? config.profileId);
  const beookPath = path.resolve(resolvePath(config.beookPath));

  return {
    beookPath,
    profileId,
    dbPath: path.join(beookPath, 'release', 'profiles', profileId, 'data', 'beook_book_v6.sqlite'),
    imgPath: path.join(beookPath, 'release', 'assetStage', 'prod', 'fileSynch'),
  };
}

// Reset config to defaults
export function resetConfig(): AppConfig {
  const defaultConfig = getDefaultConfig();
  setConfig(defaultConfig);
  return defaultConfig;
}

