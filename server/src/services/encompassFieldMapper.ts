/**
 * Encompass Field Mapper Service
 * Maps Coheus aliases to Encompass field IDs with support for client-specific field swaps
 */

import { pool } from '../config/database.js';
import { 
  DEFAULT_ENCOMPASS_FIELD_MAPPINGS, 
  getAllCoheusAliases as getAliases,
  getDefaultEncompassFieldId,
  getFieldMappingCount 
} from '../config/defaultEncompassFieldMappings.js';

// Cache the data dictionary as a Map for backward compatibility
let dataDictionary: Map<string, string> | null = null;

/**
 * Get the data dictionary as a Map
 * Uses the TypeScript constants from defaultEncompassFieldMappings.ts
 */
function loadDataDictionary(): Map<string, string> {
  if (dataDictionary) {
    return dataDictionary;
  }

  // Convert the constants object to a Map
  dataDictionary = new Map(Object.entries(DEFAULT_ENCOMPASS_FIELD_MAPPINGS));
  
  return dataDictionary;
}

/**
 * Column name aliases - maps generated column names to actual database column names
 * This handles cases where the auto-generated snake_case doesn't match the DB schema
 */
const COLUMN_NAME_ALIASES: Record<string, string> = {
  // Co-borrower fields (DB uses co_borr_ prefix with underscore)
  'coborr_employer': 'co_borr_employer',
  'coborr_position': 'co_borr_position',
  'coborr_self_employed': 'co_borr_self_employed',
  'coborr_yrs_on_job': 'co_borr_yrs_on_job',
  'coborrower_mailing_address_is_same_as_the_property_address': 'co_borrower_mailing_address_is_same_as_the_property_address',
  'coborrower_type': 'co_borrower_type',
  
  // Milestone dates (DB uses _date suffix)
  'started': 'started_date',
  'approval': 'approval_date',
  'cond_approval': 'conditional_approval_date',
  'disclosure_prep': 'disclosure_prep_date',
  'docs_out': 'docs_out_date',
  'docs_signing': 'docs_signing_date',
  'funding': 'funding_date',
  'processing': 'processing_date',
  'resubmittal': 'resubmittal_date',
  'scrubbed': 'scrubbed_date',
  'signed': 'signed_date',
  'submittal': 'submittal_date',
  'shipping': 'shipped_date',
  'pre_approval': 'pre_approval_date',
  'closing': 'closing_date',
  
  // Special naming cases
  'dulp_case_id': 'du_lp_case_id',
  '1st_change_months': 'first_change_months',
  'frefinance_cash_out_type': 'refinance_cash_out_type',
  
  // Payment fields
  'pampi_payment': 'p_and_i_payment',  // P&I Payment (P&amp;I Payment alias) maps to p_and_i_payment column
  
  // MI fields (dictionary has "MI % Coverage 1" -> "mi_coverage_1", DB has "mi_percent_coverage_1")
  'mi_coverage_1': 'mi_percent_coverage_1',
  'mi_coverage_2': 'mi_percent_coverage_2',
  'mi_cancel': 'mi_cancel_percent',
  
  // HELOC fields (dictionary has typo "Intial" instead of "Initial")
  'heloc_intial_draw': 'heloc_initial_draw',
  
  // QM/Compliance fields (dictionary has no underscore/hyphen)
  'meets_agencygse_qm': 'meets_agency_gse_qm',
  'mavent_highcost_result': 'mavent_high_cost_result',
  'mavent_atrqm_result': 'mavent_atr_qm_result',
  
};

/**
 * Convert Coheus alias to PostgreSQL column name (snake_case)
 */
export function coheusAliasToColumnName(coheusAlias: string): string {
  const generated = coheusAlias
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9_]/g, '')
    .replace(/_+/g, '_')
    .toLowerCase()
    .replace(/^_|_$/g, '');
  
  // Check if there's an alias mapping for this column name
  return COLUMN_NAME_ALIASES[generated] || generated;
}

/**
 * Normalize a column name from potential OLD format to NEW format
 * This handles cases where incoming data uses non-aliased column names
 */
export function normalizeColumnName(columnName: string): string {
  // If the column name is in the alias map, return the aliased version
  if (COLUMN_NAME_ALIASES[columnName]) {
    return COLUMN_NAME_ALIASES[columnName];
  }
  return columnName;
}

/**
 * Get the column name aliases map (for use in ETL service)
 */
export function getColumnNameAliases(): Record<string, string> {
  return { ...COLUMN_NAME_ALIASES };
}

/**
 * Get field mapping for a Coheus alias
 * Returns Encompass field ID (default or swapped)
 * @param tenantPool - The tenant-specific database pool (optional, only needed if losConnectionId is provided)
 * @param losConnectionId - The LOS connection ID (optional)
 * @param coheusAlias - The Coheus alias
 */
export async function getFieldMapping(
  tenantPool: any | null,
  losConnectionId: string | null,
  coheusAlias: string
): Promise<string> {
  // Check for field swap first
  if (losConnectionId && tenantPool) {
    try {
      const swap = await getFieldSwap(tenantPool, losConnectionId, coheusAlias);
      if (swap) {
        return swap;
      }
    } catch (error: any) {
      // If table doesn't exist or other error, fall through to default
      console.warn('[EncompassFieldMapper] Error getting field swap, using default:', error.message);
    }
  }

  // Use default from data dictionary
  const dict = loadDataDictionary();
  const defaultFieldId = dict.get(coheusAlias);
  if (!defaultFieldId) {
    throw new Error(`No Encompass field ID found for Coheus alias: ${coheusAlias}`);
  }

  return defaultFieldId;
}

/**
 * Get field swap for a Coheus alias (if exists)
 * @param tenantPool - The tenant-specific database pool (no tenant_id needed in query)
 * @param losConnectionId - The LOS connection ID
 * @param coheusAlias - The Coheus alias
 */
async function getFieldSwap(
  tenantPool: any,
  losConnectionId: string,
  coheusAlias: string
): Promise<string | null> {
  try {
    const result = await tenantPool.query(
      `SELECT encompass_field_id 
       FROM public.encompass_field_swaps 
       WHERE los_connection_id = $1 
         AND coheus_alias = $2 
         AND is_active = TRUE
       ORDER BY swap_type DESC
       LIMIT 1`,
      [losConnectionId, coheusAlias]
    );

    if (result.rows.length > 0) {
      return result.rows[0].encompass_field_id;
    }
  } catch (error: any) {
    console.error('[EncompassFieldMapper] Error getting field swap:', error.message);
    // If table doesn't exist, return null (graceful degradation)
    if (error.code === '42P01') {
      return null;
    }
  }

  return null;
}

/**
 * Get all field swaps for a connection
 * Returns Map of coheus_alias -> encompass_field_id
 * @param tenantPool - The tenant-specific database pool (no tenant_id needed in query)
 * @param losConnectionId - The LOS connection ID
 */
export async function getFieldSwaps(
  tenantPool: any,
  losConnectionId: string
): Promise<Map<string, string>> {
  const swaps = new Map<string, string>();

  try {
    const result = await tenantPool.query(
      `SELECT coheus_alias, encompass_field_id 
       FROM public.encompass_field_swaps 
       WHERE los_connection_id = $1 
         AND is_active = TRUE`,
      [losConnectionId]
    );

    for (const row of result.rows) {
      swaps.set(row.coheus_alias, row.encompass_field_id);
    }
  } catch (error: any) {
    console.error('[EncompassFieldMapper] Error getting field swaps:', error.message);
    // If table doesn't exist, return empty map (graceful degradation)
    if (error.code === '42P01') {
      return swaps;
    }
    throw error;
  }

  return swaps;
}

/**
 * Normalize an Encompass field ID to canonical form with the "Fields." prefix.
 * The Encompass RDB API returns bare numeric IDs (e.g. "1994") but our defaults
 * and internal representation use "Fields.1994". CX.*, Loan.*, ULDD.*, etc. are
 * left as-is.
 */
export function normalizeEncompassFieldId(fieldId: string): string {
  if (!fieldId) return fieldId;
  if (
    fieldId.startsWith("Fields.") ||
    fieldId.startsWith("Loan.") ||
    fieldId.startsWith("CX.") ||
    fieldId.startsWith("ULDD.") ||
    fieldId.startsWith("VASUMM.") ||
    fieldId.startsWith("Document.")
  ) {
    return fieldId;
  }
  if (/^\d/.test(fieldId)) {
    return `Fields.${fieldId}`;
  }
  return fieldId;
}

/**
 * Save field swap mapping
 * @param tenantPool - The tenant-specific database pool (no tenant_id needed in query)
 * @param losConnectionId - The LOS connection ID
 * @param coheusAlias - The Coheus alias
 * @param encompassFieldId - The Encompass field ID
 * @param swapType - The swap type (Standard or Profitability)
 */
export async function saveFieldSwap(
  tenantPool: any,
  losConnectionId: string,
  coheusAlias: string,
  encompassFieldId: string,
  swapType: 'Standard' | 'Profitability' = 'Standard'
): Promise<void> {
  const normalizedFieldId = normalizeEncompassFieldId(encompassFieldId);
  try {
    const existing = await tenantPool.query(
      `SELECT encompass_field_id
       FROM public.encompass_field_swaps
       WHERE los_connection_id = $1
         AND coheus_alias = $2
         AND swap_type = $3
       LIMIT 1`,
      [losConnectionId, coheusAlias, swapType]
    );
    const previousFieldId = existing.rows[0]?.encompass_field_id ?? null;

    await tenantPool.query(
      `INSERT INTO public.encompass_field_swaps 
       (los_connection_id, coheus_alias, encompass_field_id, previous_field_id, swap_type, is_active, backfill_status, backfill_completed_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, TRUE, 'pending', NULL, NOW())
       ON CONFLICT (los_connection_id, coheus_alias, swap_type) 
       DO UPDATE SET 
         previous_field_id = public.encompass_field_swaps.encompass_field_id,
         encompass_field_id = EXCLUDED.encompass_field_id,
         is_active = TRUE,
         backfill_status = 'pending',
         backfill_completed_at = NULL,
         updated_at = NOW()`,
      [
        losConnectionId,
        coheusAlias,
        normalizedFieldId,
        previousFieldId,
        swapType,
      ]
    );
  } catch (error: any) {
    console.error('[EncompassFieldMapper] Error saving field swap:', error.message);
    throw error;
  }
}

export interface PendingFieldSwap {
  id: string;
  losConnectionId: string;
  coheusAlias: string;
  encompassFieldId: string;
  previousFieldId: string | null;
  swapType: 'Standard' | 'Profitability';
}

/**
 * Get active swaps that still need targeted backfill.
 */
export async function getFieldSwapsPendingBackfill(
  tenantPool: any,
  losConnectionId: string
): Promise<PendingFieldSwap[]> {
  try {
    const result = await tenantPool.query(
      `SELECT
         id,
         los_connection_id,
         coheus_alias,
         encompass_field_id,
         previous_field_id,
         swap_type
       FROM public.encompass_field_swaps
       WHERE los_connection_id = $1
         AND is_active = TRUE
         AND COALESCE(backfill_status, 'pending') = 'pending'
       ORDER BY updated_at ASC`,
      [losConnectionId]
    );

    return result.rows.map((row: any) => ({
      id: row.id,
      losConnectionId: row.los_connection_id,
      coheusAlias: row.coheus_alias,
      encompassFieldId: row.encompass_field_id,
      previousFieldId: row.previous_field_id ?? null,
      swapType: row.swap_type,
    }));
  } catch (error: any) {
    console.error('[EncompassFieldMapper] Error reading pending backfill swaps:', error.message);
    if (error.code === '42703') {
      // backfill_status not migrated yet
      return [];
    }
    throw error;
  }
}

/**
 * Update backfill status for a set of swap IDs.
 */
export async function updateFieldSwapBackfillStatus(
  tenantPool: any,
  swapIds: string[],
  status: 'pending' | 'in_progress' | 'completed' | 'skipped'
): Promise<void> {
  if (swapIds.length === 0) return;
  try {
    await tenantPool.query(
      `UPDATE public.encompass_field_swaps
       SET backfill_status = $2,
           backfill_completed_at = CASE WHEN $2 = 'completed' THEN NOW() ELSE backfill_completed_at END,
           updated_at = NOW()
       WHERE id = ANY($1::uuid[])`,
      [swapIds, status]
    );
  } catch (error: any) {
    console.error('[EncompassFieldMapper] Error updating backfill status:', error.message);
    if (error.code === '42703') {
      return;
    }
    throw error;
  }
}

/**
 * Delete field swap mapping
 * @param tenantPool - The tenant-specific database pool (no tenant_id needed in query)
 * @param losConnectionId - The LOS connection ID
 * @param coheusAlias - The Coheus alias
 * @param swapType - Optional swap type (Standard or Profitability)
 */
export async function deleteFieldSwap(
  tenantPool: any,
  losConnectionId: string,
  coheusAlias: string,
  swapType?: 'Standard' | 'Profitability'
): Promise<void> {
  try {
    if (swapType) {
      await tenantPool.query(
        `UPDATE public.encompass_field_swaps 
         SET is_active = FALSE, updated_at = NOW()
         WHERE los_connection_id = $1 
           AND coheus_alias = $2 
           AND swap_type = $3`,
        [losConnectionId, coheusAlias, swapType]
      );
    } else {
      await tenantPool.query(
        `UPDATE public.encompass_field_swaps 
         SET is_active = FALSE, updated_at = NOW()
         WHERE los_connection_id = $1 
           AND coheus_alias = $2`,
        [losConnectionId, coheusAlias]
      );
    }
  } catch (error: any) {
    console.error('[EncompassFieldMapper] Error deleting field swap:', error.message);
    throw error;
  }
}

/**
 * Get all Coheus aliases from data dictionary
 */
export function getAllCoheusAliases(): string[] {
  const dict = loadDataDictionary();
  return Array.from(dict.keys()).sort();
}

/**
 * Get default Encompass field ID for a Coheus alias
 */
// Cache for field ID lookups to avoid repeated dictionary lookups
const fieldIdCache = new Map<string, string | null>();

export function getDefaultFieldId(coheusAlias: string): string | null {
  // Check cache first
  if (fieldIdCache.has(coheusAlias)) {
    return fieldIdCache.get(coheusAlias)!;
  }
  
  const dict = loadDataDictionary();
  const fieldId = dict.get(coheusAlias) || null;
  
  // Cache the result
  fieldIdCache.set(coheusAlias, fieldId);
  
  return fieldId;
}

/**
 * Build list of Encompass field IDs for a list of Coheus aliases
 * @param tenantPool - The tenant-specific database pool (optional, only needed if losConnectionId is provided)
 * @param losConnectionId - The LOS connection ID (optional)
 * @param coheusAliases - Array of Coheus aliases
 */
export async function buildFieldIdList(
  tenantPool: any | null,
  losConnectionId: string | null,
  coheusAliases: string[]
): Promise<string[]> {
  const fieldIds: string[] = [];

  for (const alias of coheusAliases) {
    try {
      const fieldId = await getFieldMapping(tenantPool, losConnectionId, alias);
      fieldIds.push(fieldId);
    } catch (error: any) {
      // Field mapping not found - skip silently
    }
  }

  return fieldIds;
}
