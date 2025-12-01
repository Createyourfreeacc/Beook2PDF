import fs from 'fs';
import path from 'path';
import os from 'os';

export interface AppConfig {
  dbPath: string;
  imgPath: string;
}

const CONFIG_FILE = path.join(process.cwd(), 'config.json');

// Default paths
function getDefaultConfig(): AppConfig {
  const username = os.userInfo().username;
  return {
    dbPath: `C:/Users/${username}/AppData/Roaming/ionesoft/beook/release/profiles/1/data/beook_book_v6.sqlite`,
    imgPath: `C:/Users/${username}/AppData/Roaming/ionesoft/beook/release/assetStage/prod/fileSynch`,
  };
}

// Resolve username placeholder in paths
function resolvePath(pathString: string): string {
  const username = os.userInfo().username;
  return pathString.replace(/\$\{username\}/g, username);
}

// Read config from file or return defaults
export function getConfig(): AppConfig {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const fileContent = fs.readFileSync(CONFIG_FILE, 'utf-8');
      const config: AppConfig = JSON.parse(fileContent);
      
      // Validate config structure
      if (typeof config.dbPath === 'string' && typeof config.imgPath === 'string') {
        return config;
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
    if (typeof config.dbPath !== 'string' || typeof config.imgPath !== 'string') {
      throw new Error('Invalid config: dbPath and imgPath must be strings');
    }
    
    if (!config.dbPath.trim() || !config.imgPath.trim()) {
      throw new Error('Invalid config: dbPath and imgPath cannot be empty');
    }
    
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
  } catch (error) {
    console.error('Error writing config file:', error);
    throw error;
  }
}

// Get resolved paths (with username placeholder replaced)
export function getResolvedPaths(): { dbPath: string; imgPath: string } {
  const config = getConfig();
  return {
    dbPath: path.resolve(resolvePath(config.dbPath)),
    imgPath: resolvePath(config.imgPath),
  };
}

// Reset config to defaults
export function resetConfig(): AppConfig {
  const defaultConfig = getDefaultConfig();
  setConfig(defaultConfig);
  return defaultConfig;
}

