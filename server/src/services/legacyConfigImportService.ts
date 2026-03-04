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

/** Trigger date field from XML OperationalScorecards section */
export interface ParsedTriggerDateField {
  name: string;
  defaultFieldId: string;
  selectedFieldId: string;
}

/**
 * Build a set of all core column names derived from the default field mappings.
 * This is used to prevent the import from creating additional fields that would
 * collide with core schema columns (e.g. milestone short names like "Funding"
 * that resolve to "funding_date" via COLUMN_NAME_ALIASES).
 */
function buildCoreColumnNameSet(): Set<string> {
  const coreColumns = new Set<string>();
  for (const alias of Object.keys(DEFAULT_ENCOMPASS_FIELD_MAPPINGS)) {
    coreColumns.add(coheusAliasToColumnName(alias).toLowerCase());
  }
  return coreColumns;
}

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
  /** Parsed OperationalScorecards trigger date fields (for tenant trigger date config) */
  operationalScorecards?: ParsedTriggerDateField[];
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
  milestones: Array<{ name: string; fieldId: string; isCustom: boolean }>;
  operationalScorecards: ParsedTriggerDateField[];
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
    milestones: [] as Array<{
      name: string;
      fieldId: string;
      isCustom: boolean;
    }>,
    operationalScorecards: [] as ParsedTriggerDateField[],
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

  // Extract Milestones (used to recognize milestone date entries in the DataDictionary)
  const milestonesMatch = xmlContent.match(
    /<Milestones>([\s\S]*?)<\/Milestones>/
  );
  if (milestonesMatch) {
    const milestoneRegex =
      /<Milestone\s+Name="([^"]+)"\s+SortOrder="[^"]*"\s+FieldId="([^"]+)"\s+IsCustom="([^"]+)"/g;
    let match;
    while ((match = milestoneRegex.exec(milestonesMatch[1])) !== null) {
      result.milestones.push({
        name: match[1],
        fieldId: match[2],
        isCustom: match[3].toLowerCase() === "true",
      });
    }
  }

  // Extract OperationalScorecards TriggerDateField entries
  const opsMatch = xmlContent.match(
    /<OperationalScorecards>([\s\S]*?)<\/OperationalScorecards>/
  );
  if (opsMatch) {
    const triggerRegex =
      /<TriggerDateField\s+Name="([^"]+)"\s+DefaultFieldId="([^"]*)"\s+SelectedFieldId="([^"]*)"[^/]*\/>/g;
    let match;
    while ((match = triggerRegex.exec(opsMatch[1])) !== null) {
      result.operationalScorecards.push({
        name: match[1],
        defaultFieldId: match[2] || "",
        selectedFieldId: match[3] || "",
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
 * Build a map from normalized Encompass field ID to loans table column name
 * using the default Coheus alias -> field ID mappings, plus fallbacks for
 * common IDs that appear in tenant XMLs but may not have a display-name mapping.
 */
function buildFieldIdToColumnMap(): Map<string, string> {
  const map = new Map<string, string>();
  for (const [alias, fieldId] of Object.entries(DEFAULT_ENCOMPASS_FIELD_MAPPINGS)) {
    if (!fieldId || fieldId === "dates" || fieldId === "team") continue;
    const normalized = normalizeFieldId(fieldId);
    const column = coheusAliasToColumnName(alias);
    map.set(normalized.toLowerCase(), column);
  }
  const fallbacks: Array<[string, string]> = [
    ["fields.1997", "funding_date"],
    ["fields.748", "closing_date"],
    ["fields.2305", "ctc_date"],
    ["fields.log.ms.date.approval", "submitted_to_underwriting_date"],
    ["fields.log.ms.date.processing", "processing_date"],
    ["fields.log.ms.date.sent to processing", "submitted_to_processing_date"],
    ["fields.log.ms.date.send to processing", "submitted_to_processing_date"],
    ["fields.log.ms.date.submittal", "submitted_to_underwriting_date"],
  ];
  for (const [key, column] of fallbacks) {
    if (!map.has(key)) map.set(key, column);
  }
  return map;
}

/** Milestone keys used to derive operations actor config from trigger dates */
const TRIGGER_NAME_TO_MILESTONE: Record<string, "processing" | "underwriting" | "closing" | "funding"> = {
  "Processing Date": "processing",
  "Sent to Processing": "processing",
  "Sent to Processing Date": "processing",
  "Underwriting Date": "underwriting",
  "Sent to Underwriting": "underwriting",
  "Sent to Underwriting Date": "underwriting",
  "Closing Date": "closing",
  "Sent to Closing": "closing",
  "Sent to Closing Date": "closing",
  "End Date to indicate Loan Closed/Funded": "funding",
};

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
    lowerAlias.includes(" amt") ||
    lowerAlias.endsWith(" amt") ||
    lowerAlias.endsWith("_amt") ||
    lowerAlias.includes("revenue") ||
    lowerAlias.includes("fee") ||
    lowerAlias.includes("price") ||
    lowerAlias.includes("payment") ||
    lowerAlias.includes(" pmt") ||
    lowerAlias.endsWith(" pmt") ||
    lowerAlias.endsWith("_pmt") ||
    lowerAlias.includes("payout") ||
    lowerAlias.includes("concession") ||
    lowerAlias.includes("credit") ||
    lowerAlias.includes("sell amount") ||
    lowerAlias.includes("sell amt") ||
    lowerAlias.includes("srp") ||
    lowerAlias.includes("loan amount") ||
    lowerAlias.includes("loan_amount") ||
    lowerAlias.includes("balance") ||
    lowerAlias.includes("cost") ||
    lowerAlias.includes("charge") ||
    lowerAlias.includes("income") ||
    lowerAlias.includes("salary") ||
    lowerAlias.includes("origination") ||
    lowerAlias.includes("warehouse")
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
    lowerAlias.includes("points") ||
    lowerAlias.includes("term") ||
    lowerAlias.includes("ltv") ||
    lowerAlias.includes("dti") ||
    lowerAlias.includes("fico") ||
    lowerAlias.includes("months") ||
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
    operationalScorecards:
      parsed.operationalScorecards?.length > 0
        ? parsed.operationalScorecards
        : undefined,
  };

  const processedAliases = new Set<string>();

  // Build set of core column names so we can detect when a proposed additional
  // field would collide with an existing core schema column.
  const coreColumnNames = buildCoreColumnNameSet();

  // Build a set of milestone field IDs from the XML's <Milestones> section.
  // Entries whose field ID matches a milestone are milestone date values that
  // map to existing core columns (e.g. "Funding" -> funding_date) and should
  // NOT be imported as additional fields.
  const milestoneFieldIds = new Set<string>();
  for (const ms of parsed.milestones) {
    milestoneFieldIds.add(normalizeFieldId(ms.fieldId).toLowerCase());
  }

  // 1. Process DataDictionary fields
  for (const field of parsed.dataDictionary) {
    const alias = field.alias;
    const clientFieldId = field.fieldId;
    const defaultFieldId = getDefaultEncompassFieldId(alias);

    // Check if this is a milestone short name (e.g. "Funding" -> "Funding Date")
    const variantDefaultFieldId = !defaultFieldId
      ? getDefaultEncompassFieldId(alias + " Date")
      : null;

    if (defaultFieldId) {
      // This alias exists directly in our defaults
      if (fieldIdsMatch(clientFieldId, defaultFieldId)) {
        analysis.matchingFields++;
      } else {
        analysis.fieldSwaps.push({
          alias,
          clientFieldId,
          defaultFieldId,
          reason: "different_mapping",
        });
      }
    } else if (variantDefaultFieldId) {
      // Milestone short name matched via " Date" variant (e.g. "Funding" -> "Funding Date").
      // These are duplicate entries for milestone dates that are already handled by the
      // full-name alias. Count as matching and skip - the real swap (if any) comes from
      // the full-name entry (e.g. "Funding Date").
      analysis.matchingFields++;
    } else {
      const columnName = coheusAliasToColumnName(alias);
      const normalizedFieldId = normalizeFieldId(clientFieldId).toLowerCase();

      // Skip if this is a milestone date entry whose column resolves to a core column.
      // This catches cases like "Funding" (Fields.Log.MS.Date.Funding) -> "funding_date"
      // and "Processing" (Fields.Log.MS.Date.Processing) -> "processing_date".
      if (coreColumnNames.has(columnName.toLowerCase())) {
        analysis.warnings.push(
          `Skipping "${alias}": column "${columnName}" is a core schema column`
        );
        processedAliases.add(alias.toLowerCase());
        analysis.matchingFields++;
        continue;
      }

      // Also skip entries whose field ID is a known milestone
      if (milestoneFieldIds.has(normalizedFieldId)) {
        analysis.warnings.push(
          `Skipping "${alias}": field "${clientFieldId}" is a milestone date handled by core schema`
        );
        processedAliases.add(alias.toLowerCase());
        analysis.matchingFields++;
        continue;
      }

      // This alias is genuinely NOT in our defaults - it's an additional field
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
    const defaultFieldId =
      getDefaultEncompassFieldId(alias) ||
      getDefaultEncompassFieldId(alias + " Date");
    if (defaultFieldId) {
      analysis.warnings.push(
        `AdHoc field "${alias}" exists in default mappings`
      );
      continue;
    }

    const columnName = coheusAliasToColumnName(alias);

    // Skip if column collides with core schema
    if (coreColumnNames.has(columnName.toLowerCase())) {
      analysis.warnings.push(
        `Skipping AdHoc "${alias}": column "${columnName}" is a core schema column`
      );
      processedAliases.add(aliasLower);
      continue;
    }

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
      const defaultFieldId =
        getDefaultEncompassFieldId(alias) ||
        getDefaultEncompassFieldId(alias + " Date");

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

          // Skip if column collides with core schema
          if (coreColumnNames.has(columnName.toLowerCase())) {
            analysis.warnings.push(
              `Skipping FieldSwap "${alias}": column "${columnName}" is a core schema column`
            );
            processedAliases.add(aliasLower);
            continue;
          }

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
      const ourDefaultFieldId =
        getDefaultEncompassFieldId(alias) ||
        getDefaultEncompassFieldId(alias + " Date");

      if (!ourDefaultFieldId) {
        const columnName = coheusAliasToColumnName(alias);

        // Skip if column collides with core schema
        if (coreColumnNames.has(columnName.toLowerCase())) {
          analysis.warnings.push(
            `Skipping FieldSwap "${alias}": column "${columnName}" is a core schema column`
          );
          processedAliases.add(aliasLower);
          continue;
        }

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

  // Remove duplicates from additionalFields to match execution behavior:
  // execution skips when los_field_id OR column_name already exists, so we deduplicate by all three.
  const uniqueAdditional = new Map<string, AdditionalFieldToImport>();
  const seenFieldIds = new Set<string>();
  const seenColumnNames = new Set<string>();

  for (const field of analysis.additionalFields) {
    const aliasKey = field.alias.toLowerCase();
    const fieldIdKey = field.fieldId.toLowerCase();
    const columnKey = field.columnName.toLowerCase();

    if (uniqueAdditional.has(aliasKey)) {
      continue; // duplicate alias
    }
    if (seenFieldIds.has(fieldIdKey)) {
      analysis.warnings.push(
        `Skipping "${field.alias}": field ID "${field.fieldId}" already mapped by another alias`
      );
      continue;
    }
    if (seenColumnNames.has(columnKey)) {
      analysis.warnings.push(
        `Skipping "${field.alias}": column name "${field.columnName}" conflicts with another field`
      );
      continue;
    }

    uniqueAdditional.set(aliasKey, field);
    seenFieldIds.add(fieldIdKey);
    seenColumnNames.add(columnKey);
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

    // Build core column set for runtime safety check
    const coreColumns = buildCoreColumnNameSet();

    for (const field of fieldsToImport) {
      // Safety net: refuse to create additional fields that collide with core columns.
      // The analysis phase should already filter these, but this catches edge cases.
      if (coreColumns.has(field.columnName.toLowerCase())) {
        console.warn(
          `[LegacyImport] Skipping "${field.alias}": column "${field.columnName}" is a core schema column`
        );
        continue;
      }

      const client = await tenantPool.connect();
      try {
        // Check if field already exists
        const existing = await client.query(
          `SELECT id FROM additional_field_definitions 
           WHERE los_connection_id = $1 AND (los_field_id = $2 OR column_name = $3)`,
          [losConnectionId, field.fieldId, field.columnName]
        );

        if (existing.rows.length > 0) {
          continue;
        }

        // Skip if column already exists in the loans table (core or previously created).
        // This prevents creating additional_field_definitions rows that point to
        // columns not managed by the additional field system.
        const columnExistsAlready = await client.query(
          `SELECT 1 FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'loans' AND column_name = $1`,
          [field.columnName]
        );
        if (
          columnExistsAlready.rows.length > 0 &&
          !field.columnName.startsWith("af_")
        ) {
          console.warn(
            `[LegacyImport] Skipping "${field.alias}": column "${field.columnName}" already exists in loans table (likely a core column)`
          );
          continue;
        }

        const dbColumnType =
          {
            string: "TEXT",
            number: "DECIMAL(15,4)",
            date: "DATE",
            boolean: "BOOLEAN",
            currency: "DECIMAL(15,2)",
          }[field.dataType] || "TEXT";

        await client.query("BEGIN");

        // Validate column name (SQL identifier safety)
        if (!/^[a-z][a-z0-9_]*$/i.test(field.columnName)) {
          await client.query("ROLLBACK");
          result.errors.push(`Additional field "${field.alias}": invalid column name`);
          continue;
        }
        await client.query(
          `ALTER TABLE public.loans ADD COLUMN IF NOT EXISTS ${field.columnName} ${dbColumnType}`
        );

        const columnExists = await client.query(
          `SELECT column_name FROM information_schema.columns 
           WHERE table_schema = 'public' AND table_name = 'loans' AND column_name = $1`,
          [field.columnName]
        );
        if (columnExists.rows.length === 0) {
          await client.query("ROLLBACK");
          result.errors.push(`Additional field "${field.alias}": column could not be created`);
          continue;
        }

        await client.query(
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

        await client.query("COMMIT");
        console.log(
          `[LegacyImport] Created additional field: ${field.alias} (${field.columnName})`
        );
        result.additionalFieldsCreated++;
      } catch (error: any) {
        try {
          await client.query("ROLLBACK");
        } catch (_) {
          /* no-op */
        }
        console.error(
          `[LegacyImport] Additional field error for "${field.alias}" (${field.columnName}):`,
          error.message
        );
        result.errors.push(
          `Additional field "${field.alias}": ${error.message}`
        );
      } finally {
        client.release();
      }
    }
  }

  // 3. Import operational scorecard trigger dates (tenant-level config)
  if (analysis.operationalScorecards && analysis.operationalScorecards.length > 0) {
    const fieldIdToColumn = buildFieldIdToColumnMap();
    const milestoneColumns: Record<string, string> = {};

    for (const trigger of analysis.operationalScorecards) {
      const milestone = TRIGGER_NAME_TO_MILESTONE[trigger.name];
      if (!milestone) continue;
      const effectiveFieldId =
        trigger.selectedFieldId?.trim() || trigger.defaultFieldId?.trim();
      if (!effectiveFieldId) continue;
      const normalized = normalizeFieldId(effectiveFieldId).toLowerCase();
      const column = fieldIdToColumn.get(normalized);
      if (column) {
        milestoneColumns[milestone] = column;
      }
    }

    const processing = milestoneColumns.processing;
    const underwriting = milestoneColumns.underwriting;
    const closing = milestoneColumns.closing;
    const funding = milestoneColumns.funding;

    if (processing && underwriting && closing && funding) {
      try {
        const configs: Array<{
          actor_type: string;
          output_date_field: string;
          turn_time_start_field: string;
          turn_time_end_field: string;
        }> = [
          {
            actor_type: "processor",
            output_date_field: underwriting,
            turn_time_start_field: processing || underwriting,
            turn_time_end_field: underwriting,
          },
          {
            actor_type: "underwriter",
            output_date_field: closing,
            turn_time_start_field: underwriting,
            turn_time_end_field: closing,
          },
          {
            actor_type: "closer",
            output_date_field: funding,
            turn_time_start_field: closing,
            turn_time_end_field: funding,
          },
        ];
        for (const c of configs) {
          await tenantPool.query(
            `
            INSERT INTO public.operational_scorecard_config (actor_type, output_date_field, turn_time_start_field, turn_time_end_field, is_active, updated_at)
            VALUES ($1, $2, $3, $4, true, NOW())
            ON CONFLICT (actor_type) DO UPDATE SET
              output_date_field = EXCLUDED.output_date_field,
              turn_time_start_field = EXCLUDED.turn_time_start_field,
              turn_time_end_field = EXCLUDED.turn_time_end_field,
              is_active = true,
              updated_at = NOW()
            `,
            [
              c.actor_type,
              c.output_date_field,
              c.turn_time_start_field,
              c.turn_time_end_field,
            ]
          );
        }
        console.log(
          "[LegacyImport] Updated operational_scorecard_config from TriggerDateField definitions"
        );
      } catch (error: any) {
        console.error(
          "[LegacyImport] Operational scorecard config import error:",
          error.message
        );
        result.errors.push(
          `Operational scorecard config: ${error.message}`
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
