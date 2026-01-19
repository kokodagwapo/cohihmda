/**
 * Version Service
 * Reads and serves version information from version.json
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface VersionInfo {
  version: string;
  commit: {
    short: string;
    full: string;
  };
  tag?: string;
  branch: string;
  buildTime: string;
  deployment: {
    environment: string;
    ebVersionLabel?: string;
  };
}

let cachedVersion: VersionInfo | null = null;

/**
 * Get version information
 * Reads from version.json file, with fallback if file doesn't exist
 */
export function getVersionInfo(): VersionInfo {
  // Return cached version if available
  if (cachedVersion) {
    return cachedVersion;
  }

  try {
    // Try to read version.json from src directory (development) or dist directory (production)
    let versionPath = join(__dirname, '../version.json');
    
    try {
      const versionData = readFileSync(versionPath, 'utf8');
      cachedVersion = JSON.parse(versionData);
      return cachedVersion!;
    } catch (error) {
      // If not found in src, try dist directory (for production builds)
      versionPath = join(__dirname, '../../version.json');
      try {
        const versionData = readFileSync(versionPath, 'utf8');
        cachedVersion = JSON.parse(versionData);
        return cachedVersion!;
      } catch (error2) {
        // Fallback if version.json doesn't exist
        console.warn('⚠️  version.json not found, using fallback version information');
        cachedVersion = getFallbackVersion();
        return cachedVersion;
      }
    }
  } catch (error: any) {
    console.warn('⚠️  Error reading version information:', error.message);
    cachedVersion = getFallbackVersion();
    return cachedVersion;
  }
}

/**
 * Get fallback version information when version.json is not available
 */
function getFallbackVersion(): VersionInfo {
  // Try to read package.json as fallback
  try {
    const packageJsonPath = join(__dirname, '../../package.json');
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
    const packageVersion = packageJson.version || '1.0.0';

    return {
      version: packageVersion,
      commit: {
        short: 'unknown',
        full: 'unknown',
      },
      branch: 'unknown',
      buildTime: new Date().toISOString(),
      deployment: {
        environment: process.env.NODE_ENV || 'development',
        ebVersionLabel: process.env.EB_VERSION_LABEL || process.env.VERSION_LABEL || undefined,
      },
    };
  } catch (error) {
    // Ultimate fallback
    return {
      version: '1.0.0',
      commit: {
        short: 'unknown',
        full: 'unknown',
      },
      branch: 'unknown',
      buildTime: new Date().toISOString(),
      deployment: {
        environment: process.env.NODE_ENV || 'development',
      },
    };
  }
}

/**
 * Clear cached version (useful for testing or reloading)
 */
export function clearVersionCache(): void {
  cachedVersion = null;
}
