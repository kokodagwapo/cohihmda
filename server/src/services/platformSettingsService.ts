/**
 * Platform Settings Service
 * Manages platform-wide configuration stored in coheus_management database
 *
 * Used for:
 * - API keys for global knowledge processing
 * - Platform-wide AI configuration
 * - Other platform-level settings
 */

import { pool as managementPool } from "../config/managementDatabase.js";
import { decryptField, encryptField } from "./encryption.js";

export interface PlatformSetting {
  id: string;
  setting_key: string;
  setting_value: string | null;
  encrypted: boolean;
  description: string | null;
  created_at: Date;
  updated_at: Date;
}

/**
 * Get a platform setting by key
 * Automatically decrypts if the setting is marked as encrypted
 */
export async function getPlatformSetting(key: string): Promise<string | null> {
  try {
    const result = await managementPool.query(
      `SELECT setting_value, encrypted FROM platform_settings WHERE setting_key = $1`,
      [key]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const { setting_value, encrypted } = result.rows[0];

    if (!setting_value) {
      return null;
    }

    if (encrypted) {
      const decrypted = await decryptField(setting_value);
      console.log(
        `[PlatformSettings] Read "${key}" (encrypted=true, decrypted length=${decrypted?.length ?? 0})`
      );
      return decrypted;
    }

    console.log(
      `[PlatformSettings] Read "${key}" (encrypted=false, raw length=${setting_value.length})`
    );
    return setting_value;
  } catch (error: any) {
    console.error(
      `[PlatformSettings] Error getting setting "${key}":`,
      error.message
    );
    return null;
  }
}

/**
 * Set a platform setting
 * Automatically encrypts if the setting is marked as encrypted in the schema
 */
export async function setPlatformSetting(
  key: string,
  value: string | null
): Promise<boolean> {
  try {
    // Check if setting exists and if it should be encrypted
    const existingResult = await managementPool.query(
      `SELECT encrypted FROM platform_settings WHERE setting_key = $1`,
      [key]
    );

    const encryptedDefaults = new Set([
      "openai_api_key",
      "anthropic_api_key",
      "gemini_api_key",
    ]);
    let shouldEncrypt = encryptedDefaults.has(key);
    if (existingResult.rows.length > 0) {
      shouldEncrypt = existingResult.rows[0].encrypted;
    }

    // Encrypt value if needed
    let storedValue = value;
    if (shouldEncrypt && value) {
      storedValue = await encryptField(value);
    }

    // Upsert the setting — always persist the encrypted flag so reads
    // know whether to decrypt.  Without this the INSERT path defaults
    // encrypted to false (the column default), creating a state where
    // the value is KMS-encrypted but getPlatformSetting returns the
    // raw ciphertext.
    await managementPool.query(
      `INSERT INTO platform_settings (setting_key, setting_value, encrypted, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (setting_key) DO UPDATE SET
         setting_value = $2,
         encrypted = $3,
         updated_at = NOW()`,
      [key, storedValue, shouldEncrypt]
    );

    console.log(`[PlatformSettings] Updated setting: ${key}`);
    return true;
  } catch (error: any) {
    console.error(`[PlatformSettings] Error setting "${key}":`, error.message);
    return false;
  }
}

/**
 * Get the platform OpenAI API key
 * Falls back to environment variable if not set in database
 */
export async function getPlatformOpenAIKey(): Promise<string | null> {
  // First try to get from database
  const dbKey = await getPlatformSetting("openai_api_key");
  if (dbKey) {
    console.log("[PlatformSettings] Using OpenAI key from platform_settings");
    return dbKey;
  }

  // Fall back to environment variable
  if (process.env.OPENAI_API_KEY) {
    console.log("[PlatformSettings] Using OpenAI key from environment");
    return process.env.OPENAI_API_KEY;
  }

  console.warn("[PlatformSettings] No OpenAI API key configured");
  return null;
}

/**
 * Get all platform settings (for admin UI)
 * Returns settings with values masked for encrypted fields
 */
export async function getAllPlatformSettings(): Promise<
  Array<{
    setting_key: string;
    has_value: boolean;
    encrypted: boolean;
    description: string | null;
    updated_at: Date;
  }>
> {
  try {
    const result = await managementPool.query(
      `SELECT 
        setting_key, 
        setting_value IS NOT NULL as has_value,
        encrypted,
        description,
        updated_at
       FROM platform_settings
       ORDER BY setting_key`
    );

    return result.rows;
  } catch (error: any) {
    console.error(
      "[PlatformSettings] Error getting all settings:",
      error.message
    );
    return [];
  }
}

/**
 * Check if platform settings table exists
 */
export async function platformSettingsTableExists(): Promise<boolean> {
  try {
    const result = await managementPool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_name = 'platform_settings'
      ) as exists
    `);
    return result.rows[0]?.exists || false;
  } catch {
    return false;
  }
}
