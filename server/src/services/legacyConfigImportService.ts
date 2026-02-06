/**
 * Legacy Config Import Service
 *
 * Parses legacy Coheus XML configuration files and imports:
 * - Field swaps (when client uses different Encompass field IDs for default aliases)
 * - Additional fields (custom fields not in the default 260)
 */

import { Pool } from "pg";
import {
  DEFAULT_ENCOMPASS_FIELD_MAPPINGS,
  getDefaultEncompassFieldId,
  getFieldCategory,
  inferFieldDataType,
} from "../config/defaultEncompassFieldMappings.js";
import { coheusAliasToColumnName } from "./encompassFieldMapper.js";

// ============================================================================
// Types
// ============================================================================

export interface ParsedField {
  alias: string;
  fieldId: string;
  isDate?: boolean;
}

export interface FieldSwapToImport {
  alias: string;
  clientFieldId: string;
  defaultFieldId: string;
  reason: "different_mapping" | "new_field_id_swap";
}

export interface AdditionalFieldToImport {
  alias: string;
  fieldId: string;
  columnName: string;
  dataType: "string" | "number" | "date" | "boolean" | "currency";
  category: string;
  source: "data_dictionary" | "adhoc" | "field_swap";
}

export interface ImportAnalysis {
  clientName: string;
  clientId: string;
  totalFieldsInXml: number;
  fieldSwaps: FieldSwapToImport[];
  additionalFields: AdditionalFieldToImport[];
  matchingFields: number;
  warnings: string[];
}

export interface ImportResult {
  success: boolean;
  fieldSwapsCreated: number;
  additionalFieldsCreated: number;
  errors: string[];
}

// ============================================================================
// XML Parsing
// ============================================================================

/**
 * Parse the legacy XML and extract field mappings
 */
export function parseLegacyXml(xmlContent: string): {
  clientInfo: { id: string; name: string };
  dataDictionary: ParsedField[];
  adHocFields: ParsedField[];
  fieldSwaps: Array<{
    alias: string;
    defaultFieldId: string;
    newFieldId: string;
    isDate: boolean;
  }>;
} {
  const result = {
    clientInfo: { id: "", name: "" },
    dataDictionary: [] as ParsedField[],
    adHocFields: [] as ParsedField[],
    fieldSwaps: [] as Array<{
      alias: string;
      defaultFieldId: string;
      newFieldId: string;
      isDate: boolean;
    }>,
  };

  // Extract ClientInfo
  const clientInfoMatch = xmlContent.match(
    /<ClientInfo\s+Id="([^"]*)"[^>]*Name="([^"]*)"/
  );
  if (clientInfoMatch) {
    result.clientInfo.id = clientInfoMatch[1];
    result.clientInfo.name = clientInfoMatch[2];
  }

  // Extract DataDictionary fields
  const dataDictMatch = xmlContent.match(
    /<DataDictionary>([\s\S]*?)<\/DataDictionary>/
  );
  if (dataDictMatch) {
    const fieldRegex = /<Field\s+Id="([^"]+)"\s+Alias="([^"]+)"/g;
    let match;
    while ((match = fieldRegex.exec(dataDictMatch[1])) !== null) {
      result.dataDictionary.push({
        fieldId: match[1],
        alias: match[2],
      });
    }
  }

  // Extract AdHoc fields
  const adHocMatch = xmlContent.match(/<AdHoc>([\s\S]*?)<\/AdHoc>/);
  if (adHocMatch) {
    const fieldRegex = /<Field\s+Id="([^"]+)"\s+Alias="([^"]+)"/g;
    let match;
    while ((match = fieldRegex.exec(adHocMatch[1])) !== null) {
      result.adHocFields.push({
        fieldId: match[1],
        alias: match[2],
      });
    }
  }

  // Extract FieldSwap entries
  const fieldSwapMatch = xmlContent.match(/<FieldSwap>([\s\S]*?)<\/FieldSwap>/);
  if (fieldSwapMatch) {
    // More complex regex for FieldSwap entries
    const swapRegex =
      /<Field\s+Alias="([^"]+)"\s+DefaultFieldId="([^"]*)"\s+NewFieldId="([^"]*)"\s+ExpirationDate="[^"]*"\s+IsDate="([^"]+)"/g;
    let match;
    while ((match = swapRegex.exec(fieldSwapMatch[1])) !== null) {
      result.fieldSwaps.push({
        alias: match[1],
        defaultFieldId: match[2],
        newFieldId: match[3],
        isDate: match[4].toLowerCase() === "true",
      });
    }
  }

  return result;
}

// ============================================================================
// Analysis
// ============================================================================

/**
 * Normalize a field ID for comparison (add Fields. prefix if missing)
 */
function normalizeFieldId(fieldId: string): string {
  if (!fieldId) return "";

  // If it already starts with "Fields." or "Loan.", return as-is
  if (fieldId.startsWith("Fields.") || fieldId.startsWith("Loan.")) {
    return fieldId;
  }

  // Add "Fields." prefix
  return `Fields.${fieldId}`;
}

/**
 * Check if two field IDs are equivalent (handling the "Fields." prefix)
 */
function fieldIdsMatch(id1: string, id2: string): boolean {
  if (!id1 || !id2) return false;

  const norm1 = normalizeFieldId(id1);
  const norm2 = normalizeFieldId(id2);

  return norm1.toLowerCase() === norm2.toLowerCase();
}

/**
 * Infer data type from alias name
 */
function inferDataType(
  alias: string,
  fieldId: string
): "string" | "number" | "date" | "boolean" | "currency" {
  const lowerAlias = alias.toLowerCase();
  const lowerFieldId = fieldId.toLowerCase();

  // Date fields
  if (
    lowerAlias.includes("date") ||
    lowerAlias.includes(" dt") ||
    lowerFieldId.includes(".date.")
  ) {
    return "date";
  }

  // Boolean fields
  if (
    lowerAlias.includes("flag") ||
    lowerAlias.includes("indicator") ||
    lowerAlias.includes("y/n")
  ) {
    return "boolean";
  }

  // Currency/amount fields
  if (
    lowerAlias.includes("amount") ||
    lowerAlias.includes("revenue") ||
    lowerAlias.includes("fee") ||
    lowerAlias.includes("price") ||
    lowerAlias.includes("payment") ||
    lowerAlias.includes("concession")
  ) {
    return "currency";
  }

  // Number fields
  if (
    lowerAlias.includes("count") ||
    lowerAlias.includes("score") ||
    lowerAlias.includes("ratio") ||
    lowerAlias.includes("rate") ||
    lowerAlias.includes("number") ||
    lowerAlias.includes("%")
  ) {
    return "number";
  }

  return "string";
}

/**
 * Analyze the parsed XML and determine what needs to be imported
 */
export function analyzeImport(
  parsed: ReturnType<typeof parseLegacyXml>
): ImportAnalysis {
  const analysis: ImportAnalysis = {
    clientName: parsed.clientInfo.name || "Unknown Client",
    clientId: parsed.clientInfo.id || "Unknown",
    totalFieldsInXml: parsed.dataDictionary.length + parsed.adHocFields.length,
    fieldSwaps: [],
    additionalFields: [],
    matchingFields: 0,
    warnings: [],
  };

  const processedAliases = new Set<string>();

  // 1. Process DataDictionary fields
  for (const field of parsed.dataDictionary) {
    const alias = field.alias;
    const clientFieldId = field.fieldId;
    const defaultFieldId = getDefaultEncompassFieldId(alias);

    if (defaultFieldId) {
      // This alias exists in our defaults
      if (fieldIdsMatch(clientFieldId, defaultFieldId)) {
        // Field IDs match - no action needed
        analysis.matchingFields++;
      } else {
        // Field IDs differ - need a swap
        analysis.fieldSwaps.push({
          alias,
          clientFieldId,
          defaultFieldId,
          reason: "different_mapping",
        });
      }
    } else {
      // This alias is NOT in our defaults - it's an additional field
      const columnName = coheusAliasToColumnName(alias);
      analysis.additionalFields.push({
        alias,
        fieldId: clientFieldId,
        columnName,
        dataType: inferDataType(alias, clientFieldId),
        category: "custom",
        source: "data_dictionary",
      });
    }

    processedAliases.add(alias.toLowerCase());
  }

  // 2. Process AdHoc fields (always additional fields)
  for (const field of parsed.adHocFields) {
    const alias = field.alias;
    const aliasLower = alias.toLowerCase();

    // Skip if already processed
    if (processedAliases.has(aliasLower)) {
      continue;
    }

    // Check if it exists in defaults (shouldn't, but check anyway)
    const defaultFieldId = getDefaultEncompassFieldId(alias);
    if (defaultFieldId) {
      // It's in defaults but in AdHoc section - weird, add warning
      analysis.warnings.push(
        `AdHoc field "${alias}" exists in default mappings`
      );
      continue;
    }

    const columnName = coheusAliasToColumnName(alias);
    analysis.additionalFields.push({
      alias,
      fieldId: field.fieldId,
      columnName,
      dataType: inferDataType(alias, field.fieldId),
      category: "adhoc",
      source: "adhoc",
    });

    processedAliases.add(aliasLower);
  }

  // 3. Process FieldSwap entries
  for (const swap of parsed.fieldSwaps) {
    const alias = swap.alias;
    const aliasLower = alias.toLowerCase();

    // If NewFieldId is set, this is an explicit swap
    if (swap.newFieldId && swap.newFieldId.trim()) {
      const defaultFieldId = getDefaultEncompassFieldId(alias);

      if (defaultFieldId) {
        // Check if this swap is already captured from DataDictionary
        const existingSwap = analysis.fieldSwaps.find(
          (s) => s.alias.toLowerCase() === aliasLower
        );

        if (!existingSwap) {
          analysis.fieldSwaps.push({
            alias,
            clientFieldId: normalizeFieldId(swap.newFieldId),
            defaultFieldId,
            reason: "new_field_id_swap",
          });
        }
      } else {
        // Not in defaults - it's a custom field with a swap
        if (!processedAliases.has(aliasLower)) {
          const columnName = coheusAliasToColumnName(alias);
          const effectiveFieldId = swap.newFieldId || swap.defaultFieldId;

          analysis.additionalFields.push({
            alias,
            fieldId: normalizeFieldId(effectiveFieldId),
            columnName,
            dataType: swap.isDate
              ? "date"
              : inferDataType(alias, effectiveFieldId),
            category: "custom",
            source: "field_swap",
          });

          processedAliases.add(aliasLower);
        }
      }
    } else if (swap.defaultFieldId && !processedAliases.has(aliasLower)) {
      // No NewFieldId but has DefaultFieldId - check if it's a custom field
      const ourDefaultFieldId = getDefaultEncompassFieldId(alias);

      if (!ourDefaultFieldId) {
        // Not in our defaults - it's a custom field
        const columnName = coheusAliasToColumnName(alias);

        analysis.additionalFields.push({
          alias,
          fieldId: normalizeFieldId(swap.defaultFieldId),
          columnName,
          dataType: swap.isDate
            ? "date"
            : inferDataType(alias, swap.defaultFieldId),
          category: "custom",
          source: "field_swap",
        });

        processedAliases.add(aliasLower);
      }
    }
  }

  // Remove duplicates from additionalFields (by alias, case-insensitive)
  const uniqueAdditional = new Map<string, AdditionalFieldToImport>();
  for (const field of analysis.additionalFields) {
    const key = field.alias.toLowerCase();
    if (!uniqueAdditional.has(key)) {
      uniqueAdditional.set(key, field);
    }
  }
  analysis.additionalFields = Array.from(uniqueAdditional.values());

  return analysis;
}

// ============================================================================
// Import Execution
// ============================================================================

/**
 * Execute the import - create field swaps and additional fields
 */
export async function executeImport(
  tenantPool: Pool,
  losConnectionId: string,
  analysis: ImportAnalysis,
  userId: string,
  options: {
    importFieldSwaps?: boolean;
    importAdditionalFields?: boolean;
    selectedSwaps?: string[]; // Aliases to import (empty = all)
    selectedAdditional?: string[]; // Aliases to import (empty = all)
  } = {}
): Promise<ImportResult> {
  const result: ImportResult = {
    success: true,
    fieldSwapsCreated: 0,
    additionalFieldsCreated: 0,
    errors: [],
  };

  const {
    importFieldSwaps = true,
    importAdditionalFields = true,
    selectedSwaps = [],
    selectedAdditional = [],
  } = options;

  // 1. Import field swaps
  if (importFieldSwaps && analysis.fieldSwaps.length > 0) {
    const swapsToImport =
      selectedSwaps.length > 0
        ? analysis.fieldSwaps.filter((s) => selectedSwaps.includes(s.alias))
        : analysis.fieldSwaps;

    for (const swap of swapsToImport) {
      try {
        // Check if swap already exists
        const existing = await tenantPool.query(
          `SELECT id FROM encompass_field_swaps 
           WHERE los_connection_id = $1 AND coheus_alias = $2`,
          [losConnectionId, swap.alias]
        );

        if (existing.rows.length > 0) {
          // Update existing
          await tenantPool.query(
            `UPDATE encompass_field_swaps 
             SET encompass_field_id = $1, updated_at = NOW()
             WHERE los_connection_id = $2 AND coheus_alias = $3`,
            [swap.clientFieldId, losConnectionId, swap.alias]
          );
          console.log(
            `[LegacyImport] Updated field swap: ${swap.alias} -> ${swap.clientFieldId}`
          );
        } else {
          // Insert new (note: table doesn't have created_by column)
          await tenantPool.query(
            `INSERT INTO encompass_field_swaps 
             (los_connection_id, coheus_alias, encompass_field_id, swap_type)
             VALUES ($1, $2, $3, 'Standard')`,
            [losConnectionId, swap.alias, swap.clientFieldId]
          );
          console.log(
            `[LegacyImport] Created field swap: ${swap.alias} -> ${swap.clientFieldId}`
          );
        }

        result.fieldSwapsCreated++;
      } catch (error: any) {
        console.error(
          `[LegacyImport] Field swap error for "${swap.alias}":`,
          error.message
        );
        result.errors.push(`Field swap "${swap.alias}": ${error.message}`);
      }
    }
  }

  // 2. Import additional fields
  if (importAdditionalFields && analysis.additionalFields.length > 0) {
    const fieldsToImport =
      selectedAdditional.length > 0
        ? analysis.additionalFields.filter((f) =>
            selectedAdditional.includes(f.alias)
          )
        : analysis.additionalFields;

    for (const field of fieldsToImport) {
      try {
        // Check if field already exists
        const existing = await tenantPool.query(
          `SELECT id FROM additional_field_definitions 
           WHERE los_connection_id = $1 AND (los_field_id = $2 OR column_name = $3)`,
          [losConnectionId, field.fieldId, field.columnName]
        );

        if (existing.rows.length > 0) {
          // Already exists - skip
          continue;
        }

        // Determine DB column type
        const dbColumnType =
          {
            string: "TEXT",
            number: "DECIMAL(15,4)",
            date: "DATE",
            boolean: "BOOLEAN",
            currency: "DECIMAL(15,2)",
          }[field.dataType] || "TEXT";

        // Create the column if it doesn't exist
        const columnExists = await tenantPool.query(
          `SELECT column_name FROM information_schema.columns 
           WHERE table_schema = 'public' AND table_name = 'loans' AND column_name = $1`,
          [field.columnName]
        );

        if (columnExists.rows.length === 0) {
          console.log(
            `[LegacyImport] Creating column: ${field.columnName} ${dbColumnType}`
          );
          await tenantPool.query(
            `ALTER TABLE public.loans ADD COLUMN ${field.columnName} ${dbColumnType}`
          );
        } else {
          console.log(
            `[LegacyImport] Column already exists: ${field.columnName}`
          );
        }

        // Insert field definition (created_by is optional, don't include if it might fail)
        await tenantPool.query(
          `INSERT INTO additional_field_definitions 
           (los_connection_id, los_field_id, column_name, display_name, 
            data_type, db_column_type, category, include_in_rag, column_created)
           VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE, TRUE)`,
          [
            losConnectionId,
            field.fieldId,
            field.columnName,
            field.alias,
            field.dataType,
            dbColumnType,
            field.category || "custom",
          ]
        );

        console.log(
          `[LegacyImport] Created additional field: ${field.alias} (${field.columnName})`
        );
        result.additionalFieldsCreated++;
      } catch (error: any) {
        console.error(
          `[LegacyImport] Additional field error for "${field.alias}" (${field.columnName}):`,
          error.message
        );
        result.errors.push(
          `Additional field "${field.alias}": ${error.message}`
        );
      }
    }
  }

  result.success = result.errors.length === 0;
  return result;
}

// ============================================================================
// Main Service Class
// ============================================================================

export class LegacyConfigImportService {
  constructor(private tenantPool: Pool) {}

  /**
   * Analyze an XML file without making changes
   */
  analyzeXml(xmlContent: string): ImportAnalysis {
    const parsed = parseLegacyXml(xmlContent);
    return analyzeImport(parsed);
  }

  /**
   * Import from an analyzed XML
   */
  async import(
    losConnectionId: string,
    analysis: ImportAnalysis,
    userId: string,
    options?: Parameters<typeof executeImport>[4]
  ): Promise<ImportResult> {
    return executeImport(
      this.tenantPool,
      losConnectionId,
      analysis,
      userId,
      options
    );
  }
}
