/**
 * Prompt Configuration Service
 *
 * Manages AI prompt configurations with:
 * - Database persistence (management DB)
 * - In-memory caching with TTL
 * - Version tracking for changes
 * - Default fallback to hardcoded prompts
 * - Export/import functionality
 */

import { pool as managementPool } from "../config/database.js";
import {
  DEFAULT_PROMPT_CONFIGS,
  PromptConfig,
  getDefaultPromptConfig,
  getPromptCategories,
} from "../config/defaultPromptConfigs.js";

// ============================================================================
// Types
// ============================================================================

export interface StoredPromptConfig extends PromptConfig {
  is_active: boolean;
  updated_by?: string;
  updated_at: Date;
  created_at: Date;
  current_version: number;
}

export interface PromptVersion {
  id: string;
  prompt_id: string;
  version: number;
  system_prompt: string;
  user_prompt_template?: string;
  model: string;
  temperature: number;
  max_tokens: number;
  json_mode: boolean;
  change_summary?: string;
  created_by?: string;
  created_at: Date;
}

export interface PromptUpdateInput {
  system_prompt?: string;
  user_prompt_template?: string;
  model?: string;
  temperature?: number;
  max_tokens?: number;
  json_mode?: boolean;
  change_summary?: string;
}

export interface PromptExport {
  version: string;
  exportedAt: string;
  exportedBy?: string;
  prompts: PromptConfig[];
}

export interface ImportResult {
  imported: number;
  skipped: number;
  errors: string[];
  details: {
    id: string;
    status: "imported" | "skipped" | "error";
    reason?: string;
  }[];
}

// ============================================================================
// Cache
// ============================================================================

interface CacheEntry {
  data: StoredPromptConfig;
  expiresAt: number;
}

const promptCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function getCacheKey(promptId: string): string {
  return `prompt:${promptId}`;
}

function getFromCache(promptId: string): StoredPromptConfig | null {
  const key = getCacheKey(promptId);
  const entry = promptCache.get(key);

  if (!entry) return null;

  if (Date.now() > entry.expiresAt) {
    promptCache.delete(key);
    return null;
  }

  return entry.data;
}

function setCache(promptId: string, data: StoredPromptConfig): void {
  const key = getCacheKey(promptId);
  promptCache.set(key, {
    data,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
}

function invalidateCache(promptId?: string): void {
  if (promptId) {
    promptCache.delete(getCacheKey(promptId));
  } else {
    promptCache.clear();
  }
}

// ============================================================================
// Database Operations
// ============================================================================

/**
 * Check if the ai_prompt_configs table exists
 */
async function tableExists(): Promise<boolean> {
  try {
    const result = await managementPool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'ai_prompt_configs'
      ) as exists
    `);
    return result.rows[0]?.exists || false;
  } catch {
    return false;
  }
}

/**
 * Seed the database with default prompts if empty
 */
export async function seedDefaultPrompts(): Promise<number> {
  if (!(await tableExists())) {
    console.log("[PromptConfig] Table does not exist, skipping seed");
    return 0;
  }

  const client = await managementPool.connect();
  let seeded = 0;

  try {
    await client.query("BEGIN");

    for (const prompt of DEFAULT_PROMPT_CONFIGS) {
      // Check if already exists
      const exists = await client.query(
        "SELECT 1 FROM ai_prompt_configs WHERE id = $1",
        [prompt.id]
      );

      if (exists.rows.length === 0) {
        await client.query(
          `
          INSERT INTO ai_prompt_configs (
            id, name, description, category,
            system_prompt, user_prompt_template,
            model, temperature, max_tokens, json_mode,
            available_variables,
            default_system_prompt, default_user_prompt_template,
            default_model, default_temperature, default_max_tokens,
            is_active
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $5, $6, $7, $8, $9, true)
        `,
          [
            prompt.id,
            prompt.name,
            prompt.description,
            prompt.category,
            prompt.system_prompt,
            prompt.user_prompt_template || null,
            prompt.model,
            prompt.temperature,
            prompt.max_tokens,
            prompt.json_mode,
            JSON.stringify(prompt.available_variables),
          ]
        );
        seeded++;
      }
    }

    await client.query("COMMIT");
    console.log(`[PromptConfig] Seeded ${seeded} default prompts`);
    return seeded;
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("[PromptConfig] Error seeding defaults:", error);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Get a prompt configuration by ID
 * Falls back to defaults if not in database
 */
export async function getPromptConfig(
  promptId: string
): Promise<StoredPromptConfig> {
  // Check cache first
  const cached = getFromCache(promptId);
  if (cached) {
    return cached;
  }

  // Try database
  if (await tableExists()) {
    try {
      const result = await managementPool.query(
        `
        SELECT 
          p.*,
          COALESCE(
            (SELECT MAX(version) FROM ai_prompt_versions WHERE prompt_id = p.id),
            0
          ) as current_version
        FROM ai_prompt_configs p
        WHERE p.id = $1 AND p.is_active = true
      `,
        [promptId]
      );

      if (result.rows.length > 0) {
        const row = result.rows[0];
        const config: StoredPromptConfig = {
          id: row.id,
          name: row.name,
          description: row.description,
          category: row.category,
          system_prompt: row.system_prompt,
          user_prompt_template: row.user_prompt_template,
          model: row.model,
          temperature: parseFloat(row.temperature),
          max_tokens: row.max_tokens,
          json_mode: row.json_mode,
          available_variables: row.available_variables || [],
          is_active: row.is_active,
          updated_by: row.updated_by,
          updated_at: row.updated_at,
          created_at: row.created_at,
          current_version: row.current_version || 0,
        };

        setCache(promptId, config);
        return config;
      }
    } catch (error) {
      console.error(`[PromptConfig] Error fetching ${promptId}:`, error);
    }
  }

  // Fall back to defaults
  const defaultConfig = getDefaultPromptConfig(promptId);
  if (defaultConfig) {
    const config: StoredPromptConfig = {
      ...defaultConfig,
      is_active: true,
      updated_at: new Date(),
      created_at: new Date(),
      current_version: 0,
    };
    return config;
  }

  throw new Error(`Prompt configuration not found: ${promptId}`);
}

/**
 * Get all prompt configurations
 */
export async function getAllPromptConfigs(
  category?: string
): Promise<StoredPromptConfig[]> {
  const configs: StoredPromptConfig[] = [];

  if (await tableExists()) {
    try {
      let query = `
        SELECT 
          p.*,
          COALESCE(
            (SELECT MAX(version) FROM ai_prompt_versions WHERE prompt_id = p.id),
            0
          ) as current_version
        FROM ai_prompt_configs p
        WHERE p.is_active = true
      `;
      const params: any[] = [];

      if (category) {
        query += " AND p.category = $1";
        params.push(category);
      }

      query += " ORDER BY p.category, p.name";

      const result = await managementPool.query(query, params);

      for (const row of result.rows) {
        configs.push({
          id: row.id,
          name: row.name,
          description: row.description,
          category: row.category,
          system_prompt: row.system_prompt,
          user_prompt_template: row.user_prompt_template,
          model: row.model,
          temperature: parseFloat(row.temperature),
          max_tokens: row.max_tokens,
          json_mode: row.json_mode,
          available_variables: row.available_variables || [],
          is_active: row.is_active,
          updated_by: row.updated_by,
          updated_at: row.updated_at,
          created_at: row.created_at,
          current_version: row.current_version || 0,
        });
      }

      return configs;
    } catch (error) {
      console.error("[PromptConfig] Error fetching all configs:", error);
    }
  }

  // Fall back to defaults
  let defaults = DEFAULT_PROMPT_CONFIGS;
  if (category) {
    defaults = defaults.filter((p) => p.category === category);
  }

  return defaults.map((p) => ({
    ...p,
    is_active: true,
    updated_at: new Date(),
    created_at: new Date(),
    current_version: 0,
  }));
}

/**
 * Update a prompt configuration with version tracking
 */
export async function updatePromptConfig(
  promptId: string,
  updates: PromptUpdateInput,
  userId?: string
): Promise<StoredPromptConfig> {
  if (!(await tableExists())) {
    throw new Error("Prompt configuration table not available");
  }

  const client = await managementPool.connect();

  try {
    await client.query("BEGIN");

    // Get current config
    const current = await client.query(
      "SELECT * FROM ai_prompt_configs WHERE id = $1",
      [promptId]
    );

    if (current.rows.length === 0) {
      throw new Error(`Prompt not found: ${promptId}`);
    }

    const currentConfig = current.rows[0];

    // Get next version number
    const versionResult = await client.query(
      "SELECT COALESCE(MAX(version), 0) + 1 as next_version FROM ai_prompt_versions WHERE prompt_id = $1",
      [promptId]
    );
    const nextVersion = versionResult.rows[0].next_version;

    // Create version record (snapshot of current state before update)
    await client.query(
      `
      INSERT INTO ai_prompt_versions (
        prompt_id, version, system_prompt, user_prompt_template,
        model, temperature, max_tokens, json_mode,
        change_summary, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    `,
      [
        promptId,
        nextVersion,
        updates.system_prompt ?? currentConfig.system_prompt,
        updates.user_prompt_template ?? currentConfig.user_prompt_template,
        updates.model ?? currentConfig.model,
        updates.temperature ?? currentConfig.temperature,
        updates.max_tokens ?? currentConfig.max_tokens,
        updates.json_mode ?? currentConfig.json_mode,
        updates.change_summary || `Version ${nextVersion}`,
        userId || null,
      ]
    );

    // Update main config
    const updateFields: string[] = [];
    const updateValues: any[] = [];
    let paramIndex = 1;

    if (updates.system_prompt !== undefined) {
      updateFields.push(`system_prompt = $${paramIndex++}`);
      updateValues.push(updates.system_prompt);
    }
    if (updates.user_prompt_template !== undefined) {
      updateFields.push(`user_prompt_template = $${paramIndex++}`);
      updateValues.push(updates.user_prompt_template);
    }
    if (updates.model !== undefined) {
      updateFields.push(`model = $${paramIndex++}`);
      updateValues.push(updates.model);
    }
    if (updates.temperature !== undefined) {
      updateFields.push(`temperature = $${paramIndex++}`);
      updateValues.push(updates.temperature);
    }
    if (updates.max_tokens !== undefined) {
      updateFields.push(`max_tokens = $${paramIndex++}`);
      updateValues.push(updates.max_tokens);
    }
    if (updates.json_mode !== undefined) {
      updateFields.push(`json_mode = $${paramIndex++}`);
      updateValues.push(updates.json_mode);
    }

    updateFields.push(`updated_at = NOW()`);
    if (userId) {
      updateFields.push(`updated_by = $${paramIndex++}`);
      updateValues.push(userId);
    }

    updateValues.push(promptId);

    await client.query(
      `
      UPDATE ai_prompt_configs 
      SET ${updateFields.join(", ")}
      WHERE id = $${paramIndex}
    `,
      updateValues
    );

    await client.query("COMMIT");

    // Invalidate cache
    invalidateCache(promptId);

    // Return updated config
    return getPromptConfig(promptId);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Reset a prompt to its default configuration
 */
export async function resetToDefault(
  promptId: string,
  userId?: string
): Promise<StoredPromptConfig> {
  const defaultConfig = getDefaultPromptConfig(promptId);
  if (!defaultConfig) {
    throw new Error(`No default configuration for: ${promptId}`);
  }

  return updatePromptConfig(
    promptId,
    {
      system_prompt: defaultConfig.system_prompt,
      user_prompt_template: defaultConfig.user_prompt_template,
      model: defaultConfig.model,
      temperature: defaultConfig.temperature,
      max_tokens: defaultConfig.max_tokens,
      json_mode: defaultConfig.json_mode,
      change_summary: "Reset to default configuration",
    },
    userId
  );
}

/**
 * Get version history for a prompt
 */
export async function getPromptVersionHistory(
  promptId: string
): Promise<PromptVersion[]> {
  if (!(await tableExists())) {
    return [];
  }

  const result = await managementPool.query(
    `
    SELECT * FROM ai_prompt_versions
    WHERE prompt_id = $1
    ORDER BY version DESC
    LIMIT 50
  `,
    [promptId]
  );

  return result.rows.map((row) => ({
    id: row.id,
    prompt_id: row.prompt_id,
    version: row.version,
    system_prompt: row.system_prompt,
    user_prompt_template: row.user_prompt_template,
    model: row.model,
    temperature: parseFloat(row.temperature),
    max_tokens: row.max_tokens,
    json_mode: row.json_mode,
    change_summary: row.change_summary,
    created_by: row.created_by,
    created_at: row.created_at,
  }));
}

/**
 * Restore a specific version
 */
export async function restoreVersion(
  promptId: string,
  version: number,
  userId?: string
): Promise<StoredPromptConfig> {
  if (!(await tableExists())) {
    throw new Error("Prompt configuration table not available");
  }

  const versionResult = await managementPool.query(
    "SELECT * FROM ai_prompt_versions WHERE prompt_id = $1 AND version = $2",
    [promptId, version]
  );

  if (versionResult.rows.length === 0) {
    throw new Error(`Version ${version} not found for prompt: ${promptId}`);
  }

  const versionData = versionResult.rows[0];

  return updatePromptConfig(
    promptId,
    {
      system_prompt: versionData.system_prompt,
      user_prompt_template: versionData.user_prompt_template,
      model: versionData.model,
      temperature: parseFloat(versionData.temperature),
      max_tokens: versionData.max_tokens,
      json_mode: versionData.json_mode,
      change_summary: `Restored from version ${version}`,
    },
    userId
  );
}

// ============================================================================
// Variable Substitution
// ============================================================================

/**
 * Build a prompt with variable substitution
 */
export function buildPrompt(
  template: string,
  variables: Record<string, string | number | undefined>
): string {
  let result = template;

  for (const [key, value] of Object.entries(variables)) {
    if (value !== undefined) {
      const regex = new RegExp(`\\{\\{${key}\\}\\}`, "g");
      result = result.replace(regex, String(value));
    }
  }

  return result;
}

// ============================================================================
// Export/Import
// ============================================================================

/**
 * Export all prompts as JSON
 */
export async function exportAllPrompts(
  exportedBy?: string
): Promise<PromptExport> {
  const configs = await getAllPromptConfigs();

  return {
    version: "1.0",
    exportedAt: new Date().toISOString(),
    exportedBy,
    prompts: configs.map((c) => ({
      id: c.id,
      name: c.name,
      description: c.description,
      category: c.category,
      system_prompt: c.system_prompt,
      user_prompt_template: c.user_prompt_template,
      model: c.model,
      temperature: c.temperature,
      max_tokens: c.max_tokens,
      json_mode: c.json_mode,
      available_variables: c.available_variables,
    })),
  };
}

/**
 * Import prompts from JSON
 */
export async function importPrompts(
  data: PromptExport,
  userId?: string,
  options: {
    overwrite?: boolean;
    selectedIds?: string[];
  } = {}
): Promise<ImportResult> {
  const { overwrite = false, selectedIds } = options;
  const result: ImportResult = {
    imported: 0,
    skipped: 0,
    errors: [],
    details: [],
  };

  if (!(await tableExists())) {
    result.errors.push("Prompt configuration table not available");
    return result;
  }

  // Validate format
  if (!data.version || !Array.isArray(data.prompts)) {
    result.errors.push("Invalid export format");
    return result;
  }

  for (const prompt of data.prompts) {
    // Skip if not in selectedIds (when provided)
    if (selectedIds && !selectedIds.includes(prompt.id)) {
      result.details.push({
        id: prompt.id,
        status: "skipped",
        reason: "Not selected",
      });
      result.skipped++;
      continue;
    }

    try {
      // Check if exists
      const existing = await managementPool.query(
        "SELECT 1 FROM ai_prompt_configs WHERE id = $1",
        [prompt.id]
      );

      if (existing.rows.length > 0) {
        if (!overwrite) {
          result.details.push({
            id: prompt.id,
            status: "skipped",
            reason: "Already exists",
          });
          result.skipped++;
          continue;
        }

        // Update existing
        await updatePromptConfig(
          prompt.id,
          {
            system_prompt: prompt.system_prompt,
            user_prompt_template: prompt.user_prompt_template,
            model: prompt.model,
            temperature: prompt.temperature,
            max_tokens: prompt.max_tokens,
            json_mode: prompt.json_mode,
            change_summary: "Imported from JSON export",
          },
          userId
        );

        result.details.push({
          id: prompt.id,
          status: "imported",
          reason: "Updated",
        });
        result.imported++;
      } else {
        // Insert new
        const defaultConfig = getDefaultPromptConfig(prompt.id);

        await managementPool.query(
          `
          INSERT INTO ai_prompt_configs (
            id, name, description, category,
            system_prompt, user_prompt_template,
            model, temperature, max_tokens, json_mode,
            available_variables,
            default_system_prompt, default_user_prompt_template,
            default_model, default_temperature, default_max_tokens,
            is_active, updated_by
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, true, $17)
        `,
          [
            prompt.id,
            prompt.name,
            prompt.description,
            prompt.category,
            prompt.system_prompt,
            prompt.user_prompt_template || null,
            prompt.model,
            prompt.temperature,
            prompt.max_tokens,
            prompt.json_mode,
            JSON.stringify(prompt.available_variables || []),
            defaultConfig?.system_prompt || prompt.system_prompt,
            defaultConfig?.user_prompt_template ||
              prompt.user_prompt_template ||
              null,
            defaultConfig?.model || prompt.model,
            defaultConfig?.temperature || prompt.temperature,
            defaultConfig?.max_tokens || prompt.max_tokens,
            userId || null,
          ]
        );

        result.details.push({
          id: prompt.id,
          status: "imported",
          reason: "Created",
        });
        result.imported++;
      }
    } catch (error: any) {
      result.details.push({
        id: prompt.id,
        status: "error",
        reason: error.message,
      });
      result.errors.push(`${prompt.id}: ${error.message}`);
    }
  }

  // Clear all cache after import
  invalidateCache();

  return result;
}

// ============================================================================
// Utility
// ============================================================================

/**
 * Get available categories
 */
export async function getCategories(): Promise<string[]> {
  if (await tableExists()) {
    try {
      const result = await managementPool.query(
        "SELECT DISTINCT category FROM ai_prompt_configs WHERE is_active = true ORDER BY category"
      );
      if (result.rows.length > 0) {
        return result.rows.map((r) => r.category);
      }
    } catch {
      // Fall through to defaults
    }
  }
  return getPromptCategories();
}

/**
 * Clear all caches (useful for testing)
 */
export function clearAllCaches(): void {
  invalidateCache();
}

export default {
  getPromptConfig,
  getAllPromptConfigs,
  updatePromptConfig,
  resetToDefault,
  getPromptVersionHistory,
  restoreVersion,
  buildPrompt,
  seedDefaultPrompts,
  exportAllPrompts,
  importPrompts,
  getCategories,
  clearAllCaches,
};
