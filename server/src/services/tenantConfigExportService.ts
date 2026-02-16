/**
 * Tenant Configuration Export/Import Service
 *
 * Exports and imports a tenant's entire configuration as JSON.
 * Platform admin only — allows copying configuration between tenants.
 *
 * Exported tables (10):
 *   encompass_field_swaps, additional_field_definitions, custom_fields,
 *   scoring_weights, complexity_components, staffing_unit_targets,
 *   tenant_calculations, personas, saved_filters (org-scoped), range_rules
 *
 * Excluded (security/irrelevance):
 *   los_connections (credentials), users, config_versions, field_mappings, loan data
 */

import pg from "pg";
import { logInfo, logError, logWarn } from "./logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Metadata about a LOS connection (no credentials) */
export interface LosConnectionRef {
  id: string;
  name: string;
  losType: string;
}

/** The full export envelope */
export interface TenantConfigExport {
  version: string;
  exportedAt: string;
  exportedBy: string;
  sourceTenant: { id: string; name: string; slug: string };
  losConnections: LosConnectionRef[];
  config: {
    encompassFieldSwaps: any[];
    additionalFieldDefinitions: any[];
    customFields: any[];
    scoringWeights: any[];
    complexityComponents: any[];
    staffingUnitTargets: any[];
    tenantCalculations: any[];
    personas: any[];
    savedFilters: any[];
    rangeRules: any[];
  };
}

/** Options for import */
export interface ImportOptions {
  overwrite: boolean;
  connectionMapping: Record<string, string>; // sourceConnectionId -> targetConnectionId
  selectedSections: string[];
}

/** Per-section import result */
export interface SectionImportResult {
  section: string;
  imported: number;
  skipped: number;
  deleted: number;
  errors: string[];
}

/** Overall import result */
export interface ImportResult {
  success: boolean;
  sections: SectionImportResult[];
  totalImported: number;
  totalSkipped: number;
  totalErrors: number;
  warnings: string[];
}

/** Validation report (dry-run) */
export interface ValidationReport {
  valid: boolean;
  version: string;
  sourceTenant: { id: string; name: string; slug: string };
  sectionCounts: Record<string, number>;
  unmappedConnections: LosConnectionRef[];
  conflicts: Record<string, number>;
  warnings: string[];
}

// All config section keys
const ALL_SECTIONS = [
  "encompassFieldSwaps",
  "additionalFieldDefinitions",
  "customFields",
  "scoringWeights",
  "complexityComponents",
  "staffingUnitTargets",
  "tenantCalculations",
  "personas",
  "savedFilters",
  "rangeRules",
] as const;

type SectionKey = (typeof ALL_SECTIONS)[number];

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export async function exportTenantConfig(
  pool: pg.Pool,
  tenantInfo: { id: string; name: string; slug: string },
  exportedBy: string,
): Promise<TenantConfigExport> {
  logInfo("[ConfigExport] Starting export", {
    tenantId: tenantInfo.id,
    tenantName: tenantInfo.name,
    exportedBy,
  });

  // Query LOS connections for metadata (no credentials)
  const losResult = await pool.query(`
    SELECT id, connection_name, los_type
    FROM public.los_connections
    WHERE is_active = TRUE
    ORDER BY connection_name
  `).catch(() => ({ rows: [] }));

  const losConnections: LosConnectionRef[] = losResult.rows.map((r: any) => ({
    id: r.id,
    name: r.connection_name,
    losType: r.los_type,
  }));

  // Query all 10 config tables in parallel
  const [
    fieldSwapsRes,
    additionalFieldsRes,
    customFieldsRes,
    scoringWeightsRes,
    complexityRes,
    staffingRes,
    calculationsRes,
    personasRes,
    filtersRes,
    rangeRulesRes,
  ] = await Promise.all([
    pool.query(`
      SELECT los_connection_id, coheus_alias, encompass_field_id, swap_type, is_active
      FROM public.encompass_field_swaps
      ORDER BY coheus_alias
    `).catch(() => ({ rows: [] })),

    pool.query(`
      SELECT los_connection_id, los_field_id, column_name, display_name,
             data_type, db_column_type, category, description,
             include_in_rag, column_created, sort_order
      FROM public.additional_field_definitions
      ORDER BY sort_order, display_name
    `).catch(() => ({ rows: [] })),

    pool.query(`
      SELECT los_field_id, los_field_name, coheus_alias, display_name,
             data_type, category, description, is_enabled, is_custom,
             visible_to_personas, formatting_rules
      FROM public.custom_fields
      ORDER BY display_name
    `).catch(() => ({ rows: [] })),

    pool.query(`
      SELECT scorecard_type, persona_id, metric_name, weight, is_active, description
      FROM public.scoring_weights
      ORDER BY scorecard_type, metric_name
    `).catch(() => ({ rows: [] })),

    pool.query(`
      SELECT component_name, condition_value, weight, description, is_active
      FROM public.complexity_components
      ORDER BY component_name, condition_value
    `).catch(() => ({ rows: [] })),

    pool.query(`
      SELECT role_key, units_per_month
      FROM public.staffing_unit_targets
      ORDER BY role_key
    `).catch(() => ({ rows: [] })),

    pool.query(`
      SELECT calculation_type, name, description, formula_components,
             sql_expression, is_active, is_validated
      FROM public.tenant_calculations
      ORDER BY calculation_type, name
    `).catch(() => ({ rows: [] })),

    pool.query(`
      SELECT name, description, is_system, permissions, dashboard_config
      FROM public.personas
      ORDER BY is_system DESC, name
    `).catch(() => ({ rows: [] })),

    // Only export organization-scoped filters (skip personal/team)
    pool.query(`
      SELECT name, description, filter_expression, scope,
             is_locked, is_default, icon, color, sort_order
      FROM public.saved_filters
      WHERE scope IN ('organization', 'persona')
      ORDER BY sort_order, name
    `).catch(() => ({ rows: [] })),

    pool.query(`
      SELECT field_alias, rule_name, description, conditions,
             min_value, max_value, warning_min, warning_max,
             severity, tooltip_text, violation_message,
             highlight_color, is_active
      FROM public.range_rules
      ORDER BY field_alias, rule_name
    `).catch(() => ({ rows: [] })),
  ]);

  const exportData: TenantConfigExport = {
    version: "1.0",
    exportedAt: new Date().toISOString(),
    exportedBy,
    sourceTenant: {
      id: tenantInfo.id,
      name: tenantInfo.name,
      slug: tenantInfo.slug,
    },
    losConnections,
    config: {
      encompassFieldSwaps: fieldSwapsRes.rows,
      additionalFieldDefinitions: additionalFieldsRes.rows,
      customFields: customFieldsRes.rows,
      scoringWeights: scoringWeightsRes.rows,
      complexityComponents: complexityRes.rows,
      staffingUnitTargets: staffingRes.rows,
      tenantCalculations: calculationsRes.rows,
      personas: personasRes.rows,
      savedFilters: filtersRes.rows,
      rangeRules: rangeRulesRes.rows,
    },
  };

  logInfo("[ConfigExport] Export complete", {
    tenantId: tenantInfo.id,
    sections: Object.entries(exportData.config).map(([k, v]) => `${k}: ${v.length}`),
  });

  return exportData;
}

// ---------------------------------------------------------------------------
// Validate (dry-run)
// ---------------------------------------------------------------------------

export async function validateTenantConfigImport(
  pool: pg.Pool,
  importData: TenantConfigExport,
  options: ImportOptions,
): Promise<ValidationReport> {
  const warnings: string[] = [];

  // Validate version
  if (!importData.version || !importData.config) {
    return {
      valid: false,
      version: importData.version || "unknown",
      sourceTenant: importData.sourceTenant || { id: "", name: "", slug: "" },
      sectionCounts: {},
      unmappedConnections: [],
      conflicts: {},
      warnings: ["Invalid export format: missing version or config"],
    };
  }

  // Count records per section
  const sectionCounts: Record<string, number> = {};
  for (const key of ALL_SECTIONS) {
    const data = importData.config[key];
    sectionCounts[key] = Array.isArray(data) ? data.length : 0;
  }

  // Check for unmapped LOS connections
  const connectionIdsInExport = new Set<string>();
  for (const swap of importData.config.encompassFieldSwaps || []) {
    if (swap.los_connection_id) connectionIdsInExport.add(swap.los_connection_id);
  }
  for (const field of importData.config.additionalFieldDefinitions || []) {
    if (field.los_connection_id) connectionIdsInExport.add(field.los_connection_id);
  }

  const unmappedConnections: LosConnectionRef[] = [];
  for (const connId of connectionIdsInExport) {
    if (!options.connectionMapping[connId]) {
      const ref = importData.losConnections.find((c) => c.id === connId);
      unmappedConnections.push(
        ref || { id: connId, name: "Unknown", losType: "unknown" },
      );
    }
  }

  if (unmappedConnections.length > 0) {
    warnings.push(
      `${unmappedConnections.length} LOS connection(s) need mapping before import`,
    );
  }

  // Check conflicts (existing records that overlap)
  const conflicts: Record<string, number> = {};
  const selected = options.selectedSections.length > 0
    ? options.selectedSections
    : [...ALL_SECTIONS];

  for (const section of selected) {
    const count = await countConflicts(pool, section as SectionKey, importData, options);
    if (count > 0) {
      conflicts[section] = count;
    }
  }

  if (Object.keys(conflicts).length > 0 && !options.overwrite) {
    warnings.push(
      "Some records conflict with existing data. Enable overwrite to replace them.",
    );
  }

  return {
    valid: unmappedConnections.length === 0,
    version: importData.version,
    sourceTenant: importData.sourceTenant,
    sectionCounts,
    unmappedConnections,
    conflicts,
    warnings,
  };
}

async function countConflicts(
  pool: pg.Pool,
  section: SectionKey,
  importData: TenantConfigExport,
  options: ImportOptions,
): Promise<number> {
  try {
    switch (section) {
      case "encompassFieldSwaps": {
        const items = importData.config.encompassFieldSwaps || [];
        if (items.length === 0) return 0;
        const aliases = items.map((i: any) => i.coheus_alias);
        const result = await pool.query(
          `SELECT COUNT(*) FROM public.encompass_field_swaps WHERE coheus_alias = ANY($1)`,
          [aliases],
        );
        return parseInt(result.rows[0].count, 10);
      }
      case "customFields": {
        const items = importData.config.customFields || [];
        if (items.length === 0) return 0;
        const fieldIds = items.map((i: any) => i.los_field_id).filter(Boolean);
        if (fieldIds.length === 0) return 0;
        const result = await pool.query(
          `SELECT COUNT(*) FROM public.custom_fields WHERE los_field_id = ANY($1)`,
          [fieldIds],
        );
        return parseInt(result.rows[0].count, 10);
      }
      case "scoringWeights": {
        const items = importData.config.scoringWeights || [];
        if (items.length === 0) return 0;
        const result = await pool.query(
          `SELECT COUNT(*) FROM public.scoring_weights`,
        );
        return parseInt(result.rows[0].count, 10);
      }
      case "personas": {
        const items = importData.config.personas || [];
        if (items.length === 0) return 0;
        const names = items.map((i: any) => i.name);
        const result = await pool.query(
          `SELECT COUNT(*) FROM public.personas WHERE name = ANY($1)`,
          [names],
        );
        return parseInt(result.rows[0].count, 10);
      }
      default:
        return 0;
    }
  } catch {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

export async function importTenantConfig(
  pool: pg.Pool,
  importData: TenantConfigExport,
  options: ImportOptions,
): Promise<ImportResult> {
  const selectedSections: SectionKey[] =
    options.selectedSections.length > 0
      ? (options.selectedSections as SectionKey[])
      : [...ALL_SECTIONS];

  const sectionResults: SectionImportResult[] = [];
  const warnings: string[] = [];
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    for (const section of selectedSections) {
      if (!ALL_SECTIONS.includes(section as any)) {
        warnings.push(`Skipping unknown section: ${section}`);
        continue;
      }

      const result = await importSection(
        client,
        section,
        importData,
        options,
      );
      sectionResults.push(result);
    }

    await client.query("COMMIT");

    const totalImported = sectionResults.reduce((s, r) => s + r.imported, 0);
    const totalSkipped = sectionResults.reduce((s, r) => s + r.skipped, 0);
    const totalErrors = sectionResults.reduce(
      (s, r) => s + r.errors.length,
      0,
    );

    logInfo("[ConfigImport] Import complete", {
      totalImported,
      totalSkipped,
      totalErrors,
    });

    return {
      success: totalErrors === 0,
      sections: sectionResults,
      totalImported,
      totalSkipped,
      totalErrors,
      warnings,
    };
  } catch (error: any) {
    await client.query("ROLLBACK");
    logError("[ConfigImport] Import failed, rolled back", error, {});
    throw error;
  } finally {
    client.release();
  }
}

async function importSection(
  client: pg.PoolClient,
  section: SectionKey,
  importData: TenantConfigExport,
  options: ImportOptions,
): Promise<SectionImportResult> {
  const result: SectionImportResult = {
    section,
    imported: 0,
    skipped: 0,
    deleted: 0,
    errors: [],
  };

  const data = importData.config[section];
  if (!Array.isArray(data) || data.length === 0) {
    return result;
  }

  try {
    switch (section) {
      case "encompassFieldSwaps":
        await importFieldSwaps(client, data, options, result);
        break;
      case "additionalFieldDefinitions":
        await importAdditionalFields(client, data, options, result);
        break;
      case "customFields":
        await importCustomFields(client, data, options, result);
        break;
      case "scoringWeights":
        await importScoringWeights(client, data, options, result);
        break;
      case "complexityComponents":
        await importComplexityComponents(client, data, options, result);
        break;
      case "staffingUnitTargets":
        await importStaffingUnitTargets(client, data, options, result);
        break;
      case "tenantCalculations":
        await importTenantCalculations(client, data, options, result);
        break;
      case "personas":
        await importPersonas(client, data, options, result);
        break;
      case "savedFilters":
        await importSavedFilters(client, data, options, result);
        break;
      case "rangeRules":
        await importRangeRules(client, data, options, result);
        break;
    }
  } catch (error: any) {
    result.errors.push(`${section}: ${error.message}`);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Per-section import helpers
// ---------------------------------------------------------------------------

function remapConnectionId(
  connectionId: string | null | undefined,
  mapping: Record<string, string>,
): string | null {
  if (!connectionId) return null;
  return mapping[connectionId] || connectionId;
}

async function importFieldSwaps(
  client: pg.PoolClient,
  data: any[],
  options: ImportOptions,
  result: SectionImportResult,
) {
  if (options.overwrite) {
    const del = await client.query(`DELETE FROM public.encompass_field_swaps`);
    result.deleted = del.rowCount || 0;
  }

  for (const row of data) {
    try {
      const connId = remapConnectionId(row.los_connection_id, options.connectionMapping);
      if (!connId) {
        result.skipped++;
        continue;
      }

      await client.query(
        `INSERT INTO public.encompass_field_swaps
           (los_connection_id, coheus_alias, encompass_field_id, swap_type, is_active)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (los_connection_id, coheus_alias, swap_type) DO UPDATE SET
           encompass_field_id = EXCLUDED.encompass_field_id,
           is_active = EXCLUDED.is_active,
           updated_at = NOW()`,
        [connId, row.coheus_alias, row.encompass_field_id, row.swap_type, row.is_active ?? true],
      );
      result.imported++;
    } catch (error: any) {
      result.errors.push(`Field swap ${row.coheus_alias}: ${error.message}`);
    }
  }
}

async function importAdditionalFields(
  client: pg.PoolClient,
  data: any[],
  options: ImportOptions,
  result: SectionImportResult,
) {
  if (options.overwrite) {
    const del = await client.query(`DELETE FROM public.additional_field_definitions`);
    result.deleted = del.rowCount || 0;
  }

  for (const row of data) {
    try {
      const connId = remapConnectionId(row.los_connection_id, options.connectionMapping);

      // Import as metadata only — column_created = false
      // Admin must manually trigger column creation to avoid DDL side effects
      await client.query(
        `INSERT INTO public.additional_field_definitions
           (los_connection_id, los_field_id, column_name, display_name,
            data_type, db_column_type, category, description,
            include_in_rag, column_created, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, FALSE, $10)
         ON CONFLICT (los_connection_id, column_name) DO UPDATE SET
           los_field_id = EXCLUDED.los_field_id,
           display_name = EXCLUDED.display_name,
           data_type = EXCLUDED.data_type,
           db_column_type = EXCLUDED.db_column_type,
           category = EXCLUDED.category,
           description = EXCLUDED.description,
           include_in_rag = EXCLUDED.include_in_rag,
           sort_order = EXCLUDED.sort_order,
           updated_at = NOW()`,
        [
          connId,
          row.los_field_id,
          row.column_name,
          row.display_name,
          row.data_type,
          row.db_column_type,
          row.category,
          row.description,
          row.include_in_rag ?? false,
          row.sort_order ?? 0,
        ],
      );
      result.imported++;
    } catch (error: any) {
      result.errors.push(`Additional field ${row.column_name}: ${error.message}`);
    }
  }
}

async function importCustomFields(
  client: pg.PoolClient,
  data: any[],
  options: ImportOptions,
  result: SectionImportResult,
) {
  if (options.overwrite) {
    const del = await client.query(`DELETE FROM public.custom_fields`);
    result.deleted = del.rowCount || 0;
  }

  for (const row of data) {
    try {
      await client.query(
        `INSERT INTO public.custom_fields
           (los_field_id, los_field_name, coheus_alias, display_name,
            data_type, category, description, is_enabled, is_custom,
            visible_to_personas, formatting_rules)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (los_field_id) DO UPDATE SET
           los_field_name = EXCLUDED.los_field_name,
           coheus_alias = EXCLUDED.coheus_alias,
           display_name = EXCLUDED.display_name,
           data_type = EXCLUDED.data_type,
           category = EXCLUDED.category,
           description = EXCLUDED.description,
           is_enabled = EXCLUDED.is_enabled,
           is_custom = EXCLUDED.is_custom,
           visible_to_personas = EXCLUDED.visible_to_personas,
           formatting_rules = EXCLUDED.formatting_rules,
           updated_at = NOW()`,
        [
          row.los_field_id,
          row.los_field_name,
          row.coheus_alias,
          row.display_name,
          row.data_type,
          row.category,
          row.description,
          row.is_enabled ?? true,
          row.is_custom ?? true,
          row.visible_to_personas || null,
          row.formatting_rules ? JSON.stringify(row.formatting_rules) : null,
        ],
      );
      result.imported++;
    } catch (error: any) {
      result.errors.push(`Custom field ${row.los_field_id}: ${error.message}`);
    }
  }
}

async function importScoringWeights(
  client: pg.PoolClient,
  data: any[],
  options: ImportOptions,
  result: SectionImportResult,
) {
  if (options.overwrite) {
    const del = await client.query(`DELETE FROM public.scoring_weights`);
    result.deleted = del.rowCount || 0;
  }

  for (const row of data) {
    try {
      // persona_id from source won't map — set to null (default weights)
      await client.query(
        `INSERT INTO public.scoring_weights
           (scorecard_type, persona_id, metric_name, weight, is_active, description)
         VALUES ($1, NULL, $2, $3, $4, $5)
         ON CONFLICT (scorecard_type, persona_id, metric_name)
           WHERE persona_id IS NULL
         DO UPDATE SET
           weight = EXCLUDED.weight,
           is_active = EXCLUDED.is_active,
           description = EXCLUDED.description,
           updated_at = NOW()`,
        [
          row.scorecard_type,
          row.metric_name,
          row.weight,
          row.is_active ?? true,
          row.description,
        ],
      );
      result.imported++;
    } catch (error: any) {
      result.errors.push(`Scoring weight ${row.metric_name}: ${error.message}`);
    }
  }
}

async function importComplexityComponents(
  client: pg.PoolClient,
  data: any[],
  options: ImportOptions,
  result: SectionImportResult,
) {
  if (options.overwrite) {
    const del = await client.query(`DELETE FROM public.complexity_components`);
    result.deleted = del.rowCount || 0;
  }

  for (const row of data) {
    try {
      await client.query(
        `INSERT INTO public.complexity_components
           (component_name, condition_value, weight, description, is_active)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (component_name, condition_value) DO UPDATE SET
           weight = EXCLUDED.weight,
           description = EXCLUDED.description,
           is_active = EXCLUDED.is_active,
           updated_at = NOW()`,
        [
          row.component_name,
          row.condition_value,
          row.weight,
          row.description,
          row.is_active ?? true,
        ],
      );
      result.imported++;
    } catch (error: any) {
      result.errors.push(`Complexity ${row.component_name}: ${error.message}`);
    }
  }
}

async function importStaffingUnitTargets(
  client: pg.PoolClient,
  data: any[],
  options: ImportOptions,
  result: SectionImportResult,
) {
  if (options.overwrite) {
    const del = await client.query(`DELETE FROM public.staffing_unit_targets`);
    result.deleted = del.rowCount || 0;
  }

  for (const row of data) {
    try {
      await client.query(
        `INSERT INTO public.staffing_unit_targets (role_key, units_per_month, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (role_key) DO UPDATE SET
           units_per_month = EXCLUDED.units_per_month,
           updated_at = NOW()`,
        [row.role_key, row.units_per_month],
      );
      result.imported++;
    } catch (error: any) {
      result.errors.push(`Staffing target ${row.role_key}: ${error.message}`);
    }
  }
}

async function importTenantCalculations(
  client: pg.PoolClient,
  data: any[],
  options: ImportOptions,
  result: SectionImportResult,
) {
  if (options.overwrite) {
    const del = await client.query(`DELETE FROM public.tenant_calculations`);
    result.deleted = del.rowCount || 0;
  }

  for (const row of data) {
    try {
      await client.query(
        `INSERT INTO public.tenant_calculations
           (calculation_type, name, description, formula_components,
            sql_expression, is_active, is_validated)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (calculation_type, name) DO UPDATE SET
           description = EXCLUDED.description,
           formula_components = EXCLUDED.formula_components,
           sql_expression = EXCLUDED.sql_expression,
           is_active = EXCLUDED.is_active,
           is_validated = EXCLUDED.is_validated,
           updated_at = NOW()`,
        [
          row.calculation_type,
          row.name,
          row.description,
          JSON.stringify(row.formula_components),
          row.sql_expression,
          row.is_active ?? true,
          row.is_validated ?? false,
        ],
      );
      result.imported++;
    } catch (error: any) {
      result.errors.push(`Calculation ${row.name}: ${error.message}`);
    }
  }
}

async function importPersonas(
  client: pg.PoolClient,
  data: any[],
  options: ImportOptions,
  result: SectionImportResult,
) {
  if (options.overwrite) {
    // Don't delete system personas
    const del = await client.query(
      `DELETE FROM public.personas WHERE is_system = FALSE`,
    );
    result.deleted = del.rowCount || 0;
  }

  for (const row of data) {
    try {
      await client.query(
        `INSERT INTO public.personas
           (name, description, is_system, permissions, dashboard_config)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (name) DO UPDATE SET
           description = EXCLUDED.description,
           permissions = EXCLUDED.permissions,
           dashboard_config = EXCLUDED.dashboard_config,
           updated_at = NOW()`,
        [
          row.name,
          row.description,
          row.is_system ?? false,
          row.permissions ? JSON.stringify(row.permissions) : null,
          row.dashboard_config ? JSON.stringify(row.dashboard_config) : null,
        ],
      );
      result.imported++;
    } catch (error: any) {
      result.errors.push(`Persona ${row.name}: ${error.message}`);
    }
  }
}

async function importSavedFilters(
  client: pg.PoolClient,
  data: any[],
  options: ImportOptions,
  result: SectionImportResult,
) {
  if (options.overwrite) {
    // Only delete org/persona scoped filters
    const del = await client.query(
      `DELETE FROM public.saved_filters WHERE scope IN ('organization', 'persona')`,
    );
    result.deleted = del.rowCount || 0;
  }

  for (const row of data) {
    try {
      await client.query(
        `INSERT INTO public.saved_filters
           (name, description, filter_expression, scope,
            is_locked, is_default, icon, color, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT DO NOTHING`,
        [
          row.name,
          row.description,
          JSON.stringify(row.filter_expression),
          row.scope || "organization",
          row.is_locked ?? false,
          row.is_default ?? false,
          row.icon,
          row.color,
          row.sort_order ?? 0,
        ],
      );
      result.imported++;
    } catch (error: any) {
      result.errors.push(`Filter ${row.name}: ${error.message}`);
    }
  }
}

async function importRangeRules(
  client: pg.PoolClient,
  data: any[],
  options: ImportOptions,
  result: SectionImportResult,
) {
  if (options.overwrite) {
    const del = await client.query(`DELETE FROM public.range_rules`);
    result.deleted = del.rowCount || 0;
  }

  for (const row of data) {
    try {
      await client.query(
        `INSERT INTO public.range_rules
           (field_alias, rule_name, description, conditions,
            min_value, max_value, warning_min, warning_max,
            severity, tooltip_text, violation_message,
            highlight_color, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         ON CONFLICT DO NOTHING`,
        [
          row.field_alias,
          row.rule_name,
          row.description,
          row.conditions ? JSON.stringify(row.conditions) : "{}",
          row.min_value,
          row.max_value,
          row.warning_min,
          row.warning_max,
          row.severity || "warning",
          row.tooltip_text,
          row.violation_message,
          row.highlight_color,
          row.is_active ?? true,
        ],
      );
      result.imported++;
    } catch (error: any) {
      result.errors.push(`Range rule ${row.rule_name}: ${error.message}`);
    }
  }
}
