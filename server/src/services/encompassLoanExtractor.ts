/**
 * Encompass Loan Extractor Service
 * Extracts loans from Encompass API and maps fields to PostgreSQL columns
 * Enhanced to support additional client-defined fields
 */

import { EncompassApiService, EncompassLoan } from "./encompassApiService.js";
import {
  getFieldMapping,
  coheusAliasToColumnName,
  buildFieldIdList,
  getFieldSwaps,
  getAllCoheusAliases,
  normalizeColumnName,
  getColumnNameAliases,
} from "./encompassFieldMapper.js";
import {
  AdditionalFieldService,
  AdditionalFieldDefinition,
} from "./additionalFieldService.js";

export interface LoanRecord {
  [columnName: string]: any;
}

export interface ExtractOptions {
  modifiedFrom?: Date;
  loanStartDate?: Date; // Date filter for Fields.Log.MS.Date.Started (defaults to 5 years ago)
  loanStartDateField?: string; // Field to use for loan start date filter (defaults to 'Fields.Log.MS.Date.Started')
  limit?: number;
  fields?: string[]; // Coheus aliases to extract (if not provided, extracts all)
  folderName?: string; // Deprecated: use folderNames instead
  folderNames?: string[]; // Array of folder names to sync
}

export class EncompassLoanExtractor {
  private apiService: EncompassApiService;
  private tenantPool?: any;
  // Cache for RDB field format maps (keyed by tenantId + losConnectionId)
  private static rdbFormatCache = new Map<string, Map<string, string>>();

  constructor(tenantPool?: any) {
    // API server will be set per-request based on connection config
    this.apiService = new EncompassApiService(tenantPool);
    this.tenantPool = tenantPool;
  }

  /**
   * Get cache key for RDB format map
   */
  private static getCacheKey(
    tenantId: string,
    losConnectionId: string
  ): string {
    return `${tenantId}:${losConnectionId}`;
  }

  /**
   * Clear RDB format cache for a specific connection (or all if no params)
   */
  static clearRdbFormatCache(
    tenantId?: string,
    losConnectionId?: string
  ): void {
    if (tenantId && losConnectionId) {
      const key = this.getCacheKey(tenantId, losConnectionId);
      this.rdbFormatCache.delete(key);
      console.log(
        `[EncompassLoanExtractor] Cleared RDB format cache for ${key}`
      );
    } else {
      this.rdbFormatCache.clear();
      console.log(`[EncompassLoanExtractor] Cleared all RDB format cache`);
    }
  }

  /**
   * Extract loans from Encompass API
   */
  async extractLoans(
    tenantId: string,
    losConnectionId: string,
    options: ExtractOptions = {}
  ): Promise<LoanRecord[]> {
    console.log(
      `[EncompassLoanExtractor] Extracting loans for connection: ${losConnectionId}`
    );

    // Reset logging flag for new extraction

    if (!this.tenantPool) {
      throw new Error("Tenant pool is required for EncompassLoanExtractor");
    }

    // Get field swaps for this connection
    const fieldSwaps = await getFieldSwaps(this.tenantPool, losConnectionId);
    console.log(
      `[EncompassLoanExtractor] Loaded ${fieldSwaps.size} field swaps for connection ${losConnectionId}`
    );
    if (fieldSwaps.size > 0) {
      const sampleSwaps = Array.from(fieldSwaps.entries()).slice(0, 5);
      console.log(`[EncompassLoanExtractor] Sample field swaps:`, sampleSwaps);
    }

    // Fetch RDB field definitions to get actual field types/formats
    // This allows us to properly convert values based on Encompass field types
    // Use cache to avoid fetching on every sync (only fetch once per connection)
    const cacheKey = EncompassLoanExtractor.getCacheKey(
      tenantId,
      losConnectionId
    );
    let fieldFormatMap = EncompassLoanExtractor.rdbFormatCache.get(cacheKey);

    if (!fieldFormatMap) {
      // Cache miss - fetch from API
      fieldFormatMap = new Map<string, string>(); // fieldID -> format
      try {
        console.log(
          `[EncompassLoanExtractor] Fetching RDB field definitions (cache miss for ${cacheKey})...`
        );
        const rdbFieldsResponse = await this.apiService.getRdbFields(
          tenantId,
          losConnectionId
        );
        if (rdbFieldsResponse.data && rdbFieldsResponse.data.length > 0) {
          console.log(
            `[EncompassLoanExtractor] Received ${rdbFieldsResponse.data.length} RDB field definitions`
          );
          for (const field of rdbFieldsResponse.data) {
            // Map fieldID (with and without Fields. prefix) to format
            const fieldId = field.fieldID;
            if (field.format) {
              fieldFormatMap.set(fieldId, field.format);
              // Also add with Fields. prefix if it doesn't have it
              if (!fieldId.startsWith("Fields.")) {
                fieldFormatMap.set(`Fields.${fieldId}`, field.format);
              } else {
                fieldFormatMap.set(
                  fieldId.replace("Fields.", ""),
                  field.format
                );
              }
            }
          }
          // Store in cache for future use
          EncompassLoanExtractor.rdbFormatCache.set(cacheKey, fieldFormatMap);
          console.log(
            `[EncompassLoanExtractor] Loaded ${fieldFormatMap.size} field format mappings from RDB and cached`
          );
          // Log sample formats for debugging
          const sampleFormats = Array.from(fieldFormatMap.entries()).slice(
            0,
            10
          );
          console.log(
            `[EncompassLoanExtractor] Sample field formats:`,
            sampleFormats
          );
        } else {
          console.warn(
            `[EncompassLoanExtractor] RDB field definitions returned empty array`
          );
          // Cache empty map to avoid repeated failed fetches
          EncompassLoanExtractor.rdbFormatCache.set(cacheKey, fieldFormatMap);
        }
      } catch (error: any) {
        console.error(
          `[EncompassLoanExtractor] Error fetching RDB field definitions: ${error.message}`
        );
        console.error(`[EncompassLoanExtractor] Stack:`, error.stack);
        // Don't cache errors - allow retry on next sync
      }
    } else {
      console.log(
        `[EncompassLoanExtractor] Using cached RDB field format map (${fieldFormatMap.size} formats) for ${cacheKey}`
      );
    }

    // Build list of Encompass field IDs to request
    let encompassFieldIds: string[];
    if (options.fields && options.fields.length > 0) {
      // Use specified fields
      encompassFieldIds = await buildFieldIdList(
        this.tenantPool,
        losConnectionId,
        options.fields
      );
    } else {
      // Get ALL fields from data dictionary (all Coheus aliases)
      // This ensures we pull all fields that are configured in the field mapping
      const allCoheusAliases = getAllCoheusAliases();

      console.log(
        `[EncompassLoanExtractor] Building field list from ${allCoheusAliases.length} Coheus aliases`
      );

      // DEBUG: Check if Application Date alias is in the list
      const applicationDateAlias = allCoheusAliases.find((a) =>
        a.toLowerCase().includes("application date")
      );
      if (applicationDateAlias) {
        console.log(
          `[EncompassLoanExtractor] ✅ Found Application Date alias: "${applicationDateAlias}"`
        );
      } else {
        console.warn(
          `[EncompassLoanExtractor] ⚠️ Application Date alias NOT found in allCoheusAliases!`
        );
      }

      encompassFieldIds = await buildFieldIdList(
        this.tenantPool,
        losConnectionId,
        allCoheusAliases
      );

      console.log(
        `[EncompassLoanExtractor] Built ${encompassFieldIds.length} Encompass field IDs`
      );

      // DEBUG: Check if Fields.3142 (Application Date) is in the field list
      if (
        encompassFieldIds.includes("Fields.3142") ||
        encompassFieldIds.includes("3142")
      ) {
        console.log(
          `[EncompassLoanExtractor] ✅ Fields.3142 (Application Date) is in the field list to request`
        );
      } else {
        console.warn(
          `[EncompassLoanExtractor] ⚠️ Fields.3142 (Application Date) NOT in field list! Sample fields:`,
          encompassFieldIds.slice(0, 10)
        );
      }

      // DEBUG: Check if Fields.761 (Lock Date) is in the field list
      if (
        encompassFieldIds.includes("Fields.761") ||
        encompassFieldIds.includes("761")
      ) {
        console.log(
          `[EncompassLoanExtractor] ✅ Fields.761 (Lock Date) is in the field list to request`
        );
      } else {
        console.warn(
          `[EncompassLoanExtractor] ⚠️ Fields.761 (Lock Date) NOT in field list!`
        );
        // Check what field ID Lock Date maps to
        const lockDateAlias = allCoheusAliases.find(
          (a) => a.toLowerCase() === "lock date"
        );
        if (lockDateAlias) {
          console.warn(
            `[EncompassLoanExtractor] Found "Lock Date" alias: "${lockDateAlias}", checking default field ID...`
          );
        }
      }

      // Log summary of field IDs being requested
      console.log(
        `[EncompassLoanExtractor] Requesting ${encompassFieldIds.length} field IDs from Encompass API`
      );
      if (encompassFieldIds.length < allCoheusAliases.length) {
        console.warn(
          `[EncompassLoanExtractor] ⚠️ Only requesting ${encompassFieldIds.length} of ${allCoheusAliases.length} mapped fields. Some fields may be missing from field mapping.`
        );
      }
    }

    // Load additional field definitions for this connection
    let additionalFields: AdditionalFieldDefinition[] = [];
    try {
      const additionalFieldService = new AdditionalFieldService(
        this.tenantPool
      );
      additionalFields = await additionalFieldService.getEnabledFieldsForEtl(
        losConnectionId
      );

      if (additionalFields.length > 0) {
        console.log(
          `[EncompassLoanExtractor] Found ${additionalFields.length} additional fields to sync`
        );

        // Add additional field IDs to the request
        for (const field of additionalFields) {
          // Add the LOS field ID if not already in the list
          const fieldId = field.losFieldId;
          if (!encompassFieldIds.includes(fieldId)) {
            encompassFieldIds.push(fieldId);
          }
          // Also add without/with Fields. prefix variation
          if (fieldId.startsWith("Fields.")) {
            const withoutPrefix = fieldId.replace("Fields.", "");
            if (!encompassFieldIds.includes(withoutPrefix)) {
              encompassFieldIds.push(withoutPrefix);
            }
          } else if (!fieldId.startsWith("CX.")) {
            const withPrefix = `Fields.${fieldId}`;
            if (!encompassFieldIds.includes(withPrefix)) {
              encompassFieldIds.push(withPrefix);
            }
          }
        }

        console.log(
          `[EncompassLoanExtractor] Total field IDs after adding additional fields: ${encompassFieldIds.length}`
        );
      }
    } catch (error: any) {
      console.warn(
        `[EncompassLoanExtractor] Could not load additional fields (table may not exist yet): ${error.message}`
      );
      // Continue without additional fields
    }

    // Request loans from Encompass API
    // Use folderNames if provided, otherwise fall back to folderName for backward compatibility
    const folderNames =
      options.folderNames ||
      (options.folderName ? [options.folderName] : undefined);
    const response = await this.apiService.getLoans(tenantId, losConnectionId, {
      modifiedFrom: options.modifiedFrom,
      loanStartDate: options.loanStartDate,
      loanStartDateField: options.loanStartDateField,
      limit: options.limit,
      fields: encompassFieldIds,
      folderName: options.folderName, // Deprecated: for backward compatibility
      folderNames: folderNames, // Use folderNames array
    });

    console.log(
      `[EncompassLoanExtractor] Received ${response.data.length} loans from API (after pagination)`
    );

    // =========================================================================
    // OPTIMIZATION: Pre-build lookup maps ONCE before loan iteration
    // This prevents rebuilding these expensive data structures for every loan
    // =========================================================================

    // Import field mapper functions ONCE (not per-loan)
    const {
      getAllCoheusAliases: getAliases,
      getDefaultFieldId,
      coheusAliasToColumnName: aliasToColumn,
      getColumnNameAliases,
    } = await import("./encompassFieldMapper.js");

    const allAliases = getAliases();
    console.log(
      `[EncompassLoanExtractor] Pre-building lookup maps for ${allAliases.length} aliases`
    );

    // Pre-build columnToAliasMap ONCE (for reverse lookup)
    const columnToAliasMap = new Map<string, string>();
    for (const alias of allAliases) {
      const columnName = aliasToColumn(alias);
      if (!columnToAliasMap.has(columnName)) {
        columnToAliasMap.set(columnName, alias);
      }
    }

    // Pre-build fieldIdToColumnMap ONCE (for field ID -> column lookup)
    const fieldIdToColumnMap = new Map<string, string>();
    for (const alias of allAliases) {
      let fieldIdForAlias: string | null = null;
      if (fieldSwaps.has(alias)) {
        fieldIdForAlias = fieldSwaps.get(alias)!;
      } else {
        fieldIdForAlias = getDefaultFieldId(alias);
      }

      if (fieldIdForAlias) {
        const columnName = aliasToColumn(alias);
        // Map both with and without Fields. prefix
        fieldIdToColumnMap.set(fieldIdForAlias, columnName);
        if (fieldIdForAlias.startsWith("Fields.")) {
          fieldIdToColumnMap.set(fieldIdForAlias.substring(7), columnName);
        } else {
          fieldIdToColumnMap.set(`Fields.${fieldIdForAlias}`, columnName);
        }
      }
    }

    // Get column name aliases ONCE
    const columnAliases = getColumnNameAliases();

    console.log(
      `[EncompassLoanExtractor] Lookup maps ready: ${columnToAliasMap.size} columns, ${fieldIdToColumnMap.size} field IDs`
    );

    // Map Encompass loans to PostgreSQL records
    const records: LoanRecord[] = [];
    let processedCount = 0;
    const totalLoans = response.data.length;

    for (const loan of response.data) {
      try {
        const record = this.mapLoanToRecord(
          loan,
          fieldSwaps,
          fieldFormatMap,
          additionalFields,
          // Pass pre-built lookup structures
          allAliases,
          columnToAliasMap,
          fieldIdToColumnMap,
          columnAliases,
          getDefaultFieldId,
          aliasToColumn
        );
        records.push(record);
        processedCount++;

        // Log progress every 1000 loans with memory usage
        if (processedCount % 1000 === 0) {
          const memUsage = process.memoryUsage();
          const heapMB = Math.round(memUsage.heapUsed / 1024 / 1024);
          const rssMB = Math.round(memUsage.rss / 1024 / 1024);
          console.log(
            `[EncompassLoanExtractor] Processed ${processedCount}/${totalLoans} loans (heap: ${heapMB}MB, rss: ${rssMB}MB)`
          );
        }
      } catch (error: any) {
        console.error(
          `[EncompassLoanExtractor] Error mapping loan: ${error.message}`,
          error
        );
        // Continue with next loan
        processedCount++;
      }
    }

    // Final memory usage log
    const finalMem = process.memoryUsage();
    console.log(
      `[EncompassLoanExtractor] Completed mapping ${
        records.length
      }/${totalLoans} loans (final heap: ${Math.round(
        finalMem.heapUsed / 1024 / 1024
      )}MB)`
    );
    return records;
  }

  /**
   * Map Encompass loan to PostgreSQL record
   *
   * OPTIMIZED: Now accepts pre-built lookup maps to avoid rebuilding them for every loan.
   * Maps are built once in extractLoans() and passed here.
   */
  private mapLoanToRecord(
    loan: EncompassLoan,
    fieldSwaps: Map<string, string>,
    fieldFormatMap: Map<string, string>,
    additionalFields: AdditionalFieldDefinition[],
    // Pre-built lookup structures (built once in extractLoans)
    allAliases: string[],
    columnToAliasMap: Map<string, string>,
    fieldIdToColumnMap: Map<string, string>,
    columnAliases: Record<string, string>,
    getDefaultFieldId: (alias: string) => string | null,
    coheusAliasToColumnName: (alias: string) => string
  ): LoanRecord {
    const record: LoanRecord = {};

    // APPROACH 1: Forward mapping - For each alias, try to find its value in the loan
    for (const alias of allAliases) {
      // Get field ID for this alias (check swaps first, then default)
      let fieldIdForAlias: string | null = null;

      // Check field swaps
      if (fieldSwaps.has(alias)) {
        fieldIdForAlias = fieldSwaps.get(alias)!;
      } else {
        // Use default from data dictionary
        fieldIdForAlias = getDefaultFieldId(alias);
      }

      if (!fieldIdForAlias) {
        continue; // Skip aliases without field IDs
      }

      // Check if this field ID exists in the loan (try with and without Fields. prefix)
      let value: any = undefined;

      // Helper to get value from loan with various key formats
      const tryGetValue = (keyToTry: string): any => {
        if (loan[keyToTry] !== undefined && loan[keyToTry] !== null) {
          return loan[keyToTry];
        }
        return undefined;
      };

      // Generate all possible key variations for a field ID
      const getKeyVariations = (fieldId: string): string[] => {
        const variations: string[] = [fieldId];

        // With/without Fields. prefix
        if (fieldId.startsWith("Fields.")) {
          variations.push(fieldId.substring(7)); // Without prefix
        } else {
          variations.push(`Fields.${fieldId}`); // With prefix
        }

        // Handle special characters - # might be encoded
        if (fieldId.includes("#")) {
          variations.push(fieldId.replace(/#/g, "%23")); // URL encoded #
          variations.push(fieldId.replace(/#/g, "_")); // _ instead of #
          // Also try variations without Fields. prefix
          if (fieldId.startsWith("Fields.")) {
            const withoutPrefix = fieldId.substring(7);
            variations.push(withoutPrefix.replace(/#/g, "%23"));
            variations.push(withoutPrefix.replace(/#/g, "_"));
          }
        }

        // Handle spaces in field IDs (like milestone dates)
        if (fieldId.includes(" ")) {
          variations.push(fieldId.replace(/ /g, "%20")); // URL encoded space
          variations.push(fieldId.replace(/ /g, "+")); // + for space
          variations.push(fieldId.replace(/ /g, "_")); // _ for space
          // Also without Fields. prefix
          if (fieldId.startsWith("Fields.")) {
            const withoutPrefix = fieldId.substring(7);
            variations.push(withoutPrefix.replace(/ /g, "%20"));
            variations.push(withoutPrefix.replace(/ /g, "+"));
            variations.push(withoutPrefix.replace(/ /g, "_"));
          }
        }

        return [...new Set(variations)]; // Deduplicate
      };

      // Try all variations of the field ID
      const keyVariations = getKeyVariations(fieldIdForAlias);
      for (const keyVar of keyVariations) {
        value = tryGetValue(keyVar);
        if (value !== undefined) break;
      }

      // Strategy: Case-insensitive search for field ID (handles case variations)
      // Note: Don't strip # because it denotes borrower index (e.g., FE0110#2 = second borrower)
      // Note: For numeric field IDs (e.g., Fields.1200), require EXACT match to prevent 1200 matching 12
      // Note: For structured field IDs (e.g., FE0210), also require EXACT match to prevent FE0210 matching FE0102
      if (value === undefined || value === null) {
        const lowerFieldId = fieldIdForAlias.toLowerCase();
        const lowerFieldIdNoPrefix = lowerFieldId.replace("fields.", "");

        // Check if this is a purely numeric field ID (like "1200", "12", etc.)
        const isNumericFieldId = /^\d+$/.test(lowerFieldIdNoPrefix);

        // Check if this is a structured field ID (letters + numbers, like FE0210, ULDD.X26, etc.)
        // These should also require exact matches to prevent FE0210 matching FE0102
        const isStructuredFieldId =
          /^[a-z]+\d+$/i.test(lowerFieldIdNoPrefix) ||
          /^[a-z]+\.[a-z]+\d*$/i.test(lowerFieldIdNoPrefix);

        const matchingKey = Object.keys(loan).find((key) => {
          const lowerKey = key.toLowerCase();
          const lowerKeyNoPrefix = lowerKey.replace("fields.", "");

          // Exact match (case-insensitive)
          if (
            lowerKey === lowerFieldId ||
            lowerKeyNoPrefix === lowerFieldIdNoPrefix
          ) {
            return true;
          }

          // For numeric or structured field IDs, ONLY allow exact match - no fuzzy matching
          // This prevents Fields.1200 from matching Fields.12
          // And prevents Fields.FE0210 from matching Fields.FE0102
          if (isNumericFieldId || isStructuredFieldId) {
            return false;
          }

          // Only normalize spaces, not # (which is significant for borrower index)
          const normalizedKey = lowerKeyNoPrefix.replace(/[%20+ ]/g, "");
          const normalizedFieldId = lowerFieldIdNoPrefix.replace(
            /[%20+ ]/g,
            ""
          );
          return normalizedKey === normalizedFieldId;
        });
        if (matchingKey) {
          value = tryGetValue(matchingKey);
        }
      }

      // Fallback: If field ID lookup failed, try column name strategies
      if (value === undefined || value === null) {
        const columnName = coheusAliasToColumnName(alias);

        // Strategy 1: Check for column name directly (API may return snake_case)
        if (loan[columnName] !== undefined && loan[columnName] !== null) {
          value = loan[columnName];
        }
        // Strategy 2: Check for camelCase version
        else {
          const camelCase = columnName.replace(/_([a-z])/g, (_, letter) =>
            letter.toUpperCase()
          );
          if (loan[camelCase] !== undefined && loan[camelCase] !== null) {
            value = loan[camelCase];
          }
        }
        // Strategy 3: Check for PascalCase version
        if (value === undefined || value === null) {
          const pascalCase = columnName
            .split("_")
            .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
            .join("");
          if (loan[pascalCase] !== undefined && loan[pascalCase] !== null) {
            value = loan[pascalCase];
          }
        }
        // Strategy 4: Case-insensitive search (last resort)
        if (value === undefined || value === null) {
          const lowerColumnName = columnName.toLowerCase();
          const matchingKey = Object.keys(loan).find(
            (key) => key.toLowerCase() === lowerColumnName
          );
          if (
            matchingKey &&
            loan[matchingKey] !== undefined &&
            loan[matchingKey] !== null
          ) {
            value = loan[matchingKey];
          }
        }

        // Note: Removed excessive debug logging - use debug endpoint instead
      }

      // If we found the value, populate the column
      if (value !== undefined && value !== null) {
        const columnName = coheusAliasToColumnName(alias);
        // Get the Encompass format for proper type conversion
        const format =
          fieldFormatMap.get(fieldIdForAlias) ||
          fieldFormatMap.get(
            `Fields.${fieldIdForAlias.replace("Fields.", "")}`
          ) ||
          null;
        const transformedValue = this.transformValue(value, alias, format);
        record[columnName] = transformedValue;
      }
      // Note: Removed excessive debug logging for lock_date - use debug endpoint instead
    }

    // APPROACH 2: Reverse mapping - For each field in the loan, try to find its column
    // This catches fields that exist but weren't found by forward mapping
    // NOTE: fieldIdToColumnMap and columnAliases are now passed as parameters (pre-built)

    // Iterate through loan keys and match efficiently
    const loanKeys = Object.keys(loan);
    for (const loanKey of loanKeys) {
      // Skip if already mapped or if it's a system field
      if (
        loanKey === "loanGuid" ||
        loanKey === "guid" ||
        loanKey === "fields"
      ) {
        continue;
      }

      const loanValue = loan[loanKey];
      if (loanValue === undefined || loanValue === null || loanValue === "") {
        continue;
      }

      // Strategy 1: Check if this key matches a column name directly (with alias normalization)
      let matchedColumn: string | null = null;

      // First, try to normalize the loan key (convert OLD column names to NEW)
      const normalizedLoanKey = normalizeColumnName(loanKey);

      if (columnToAliasMap.has(normalizedLoanKey)) {
        matchedColumn = normalizedLoanKey;
      } else if (columnToAliasMap.has(loanKey)) {
        matchedColumn = loanKey;
      } else {
        // Strategy 2: Check if it's a field ID (with or without Fields. prefix)
        if (fieldIdToColumnMap.has(loanKey)) {
          matchedColumn = fieldIdToColumnMap.get(loanKey)!;
        } else {
          // Strategy 3: Try snake_case conversion (then normalize)
          const snakeCaseKey = loanKey
            .replace(/([A-Z])/g, "_$1")
            .toLowerCase()
            .replace(/^_/, "");

          const normalizedSnakeCase = normalizeColumnName(snakeCaseKey);

          if (columnToAliasMap.has(normalizedSnakeCase)) {
            matchedColumn = normalizedSnakeCase;
          } else if (columnToAliasMap.has(snakeCaseKey)) {
            matchedColumn = snakeCaseKey;
          } else {
            // Strategy 4: Check if the loan key is in the alias map (OLD -> NEW mapping)
            if (columnAliases[loanKey]) {
              const aliasedColumn = columnAliases[loanKey];
              if (columnToAliasMap.has(aliasedColumn)) {
                matchedColumn = aliasedColumn;
              }
            }

            // Strategy 5: Case-insensitive match on column names
            if (!matchedColumn) {
              const lowerLoanKey = loanKey.toLowerCase();
              for (const [columnName] of columnToAliasMap.entries()) {
                if (columnName.toLowerCase() === lowerLoanKey) {
                  matchedColumn = columnName;
                  break;
                }
              }
            }
          }
        }
      }

      // If we found a match and the column isn't already populated, set it
      if (matchedColumn && record[matchedColumn] === undefined) {
        const alias = columnToAliasMap.get(matchedColumn);
        // Try to find format for this loan key
        const format =
          fieldFormatMap.get(loanKey) ||
          fieldFormatMap.get(loanKey.replace("Fields.", "")) ||
          fieldFormatMap.get(`Fields.${loanKey.replace("Fields.", "")}`) ||
          null;
        const transformedValue = this.transformValue(
          loanValue,
          alias || "",
          format
        );
        record[matchedColumn] = transformedValue;
      }
    }

    // ADDITIONAL FIELDS: Map client-defined additional fields to their columns
    // These fields are tracked in the additional_field_definitions table
    if (additionalFields.length > 0) {
      for (const additionalField of additionalFields) {
        const { losFieldId, columnName, dataType, displayName } =
          additionalField;

        // Skip if column doesn't exist or is disabled
        if (!columnName || !additionalField.columnCreated) {
          continue;
        }

        // Try to find the value in the loan using various key formats
        let value: any = undefined;

        // Try various key formats
        const keyVariations = [
          losFieldId,
          losFieldId.replace("Fields.", ""),
          `Fields.${losFieldId.replace("Fields.", "")}`,
          losFieldId.replace("CX.", ""),
          losFieldId.toLowerCase(),
          losFieldId.replace("Fields.", "").toLowerCase(),
        ];

        for (const key of keyVariations) {
          if (
            loan[key] !== undefined &&
            loan[key] !== null &&
            loan[key] !== ""
          ) {
            value = loan[key];
            break;
          }
        }

        // Case-insensitive search as fallback
        if (value === undefined) {
          const lowerFieldId = losFieldId.toLowerCase();
          const matchingKey = Object.keys(loan).find((key) => {
            const lowerKey = key.toLowerCase();
            return (
              lowerKey === lowerFieldId ||
              lowerKey === lowerFieldId.replace("fields.", "") ||
              lowerKey.replace("fields.", "") ===
                lowerFieldId.replace("fields.", "")
            );
          });
          if (matchingKey) {
            value = loan[matchingKey];
          }
        }

        // If value found, transform based on data type and add to record
        if (value !== undefined && value !== null && value !== "") {
          // Get Encompass format if available
          const format =
            fieldFormatMap.get(losFieldId) ||
            fieldFormatMap.get(losFieldId.replace("Fields.", "")) ||
            null;

          // Transform the value (use displayName as alias for type detection)
          const transformedValue = this.transformValueForAdditionalField(
            value,
            dataType,
            format
          );
          record[columnName] = transformedValue;
        }
      }
    }

    // Note: raw_data column has been removed. Unmapped fields are no longer stored.
    // Use the additional_field_definitions system to track additional fields.

    // =============================================================================
    // IMPORTANT: Loan Identifiers
    // =============================================================================
    // guid: Encompass GUID - unique system identifier (used for joins/access filtering)
    // loan_number: Human-readable loan number (Fields.364) - for display
    // loan_id: DEPRECATED - will be removed in future, kept for backwards compatibility
    // =============================================================================

    // Extract GUID from various possible locations in the Encompass response
    const guid =
      loan["Fields.GUID"] || loan["GUID"] || loan.loanGuid || loan.guid;

    // Extract loan number from Fields.364 or other locations
    const loanNumber =
      loan["Fields.364"] ||
      loan["Loan.LoanNumber"] ||
      loan.loanNumber ||
      record.loan_number;

    // Set guid (primary identifier)
    if (!record.guid && guid) {
      // Normalize GUID - remove curly braces if present, lowercase
      record.guid = guid.replace(/[{}]/g, "").toLowerCase();
    }

    // Set loan_number (human-readable)
    if (!record.loan_number && loanNumber) {
      record.loan_number = loanNumber;
    }

    // Set loan_id for backwards compatibility (DEPRECATED)
    // Prefer GUID, fallback to loan_number
    if (!record.loan_id) {
      record.loan_id = record.guid || record.loan_number || null;
    }

    // Validate guid is set (required for database uniqueness)
    if (!record.guid) {
      console.warn(
        `[EncompassLoanExtractor] Loan missing GUID, loan object keys:`,
        Object.keys(loan).slice(0, 20)
      );
      // Generate a fallback GUID if absolutely necessary
      record.guid = `generated-${Date.now()}-${Math.random()
        .toString(36)
        .substr(2, 9)}`;
    }

    // Note: Removed verbose logging - use debug endpoint for field mapping issues

    return record;
  }

  /**
   * Transform value based on Encompass field format type
   * Uses actual Encompass format from RDB when available, falls back to heuristics
   */
  private transformValue(
    value: any,
    coheusAlias: string,
    encompassFormat?: string | null
  ): any {
    // Handle empty strings - convert to null
    if (value === "" || value === null || value === undefined) {
      return null;
    }

    // Use Encompass format if available (most accurate)
    if (encompassFormat) {
      const formatUpper = encompassFormat.toUpperCase();

      // INTEGER types
      if (formatUpper === "INTEGER" || formatUpper.startsWith("RA_INTEGER")) {
        if (typeof value === "string") {
          const num = parseFloat(value);
          return isNaN(num) ? null : Math.round(num);
        }
        return typeof value === "number" ? Math.round(value) : null;
      }

      // DECIMAL types (DECIMAL, DECIMAL_2, DECIMAL_3, etc., RA_DECIMAL_2, etc.)
      if (
        formatUpper.startsWith("DECIMAL") ||
        formatUpper.startsWith("RA_DECIMAL")
      ) {
        if (typeof value === "string") {
          const num = parseFloat(value);
          return isNaN(num) ? null : num;
        }
        return typeof value === "number" ? value : null;
      }

      // DATE types
      if (formatUpper === "DATE" || formatUpper === "MONTHDAY") {
        if (typeof value === "string") {
          const dateStr = value.trim();
          if (!dateStr) return null; // Empty string = null

          // Handle Encompass date format: "MM/dd/yyyy" or "MM/dd/yyyy HH:mm:ss AM/PM"
          // Also handle ISO format: "yyyy-MM-dd"
          let date = new Date(dateStr);
          if (isNaN(date.getTime())) {
            // Try Encompass format: "M/d/yyyy" or "MM/dd/yyyy"
            const match = dateStr.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
            if (match) {
              const [, month, day, year] = match;
              date = new Date(
                `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`
              );
            }
          }
          if (!isNaN(date.getTime())) {
            return date.toISOString().split("T")[0]; // Return as DATE (YYYY-MM-DD)
          }
          // Return original string - let ETL handle conversion
          return dateStr;
        }
        if (value instanceof Date) {
          return value.toISOString().split("T")[0];
        }
        // Return as-is - let ETL handle it
        return value;
      }

      // DATETIME types
      if (formatUpper === "DATETIME") {
        if (typeof value === "string") {
          const trimmed = value.trim();
          if (!trimmed) return null;
          const date = new Date(trimmed);
          return !isNaN(date.getTime()) ? date : trimmed; // Return original if can't parse
        }
        return value instanceof Date ? value : value; // Return as-is
      }

      // BOOLEAN types (YN, X flags)
      if (formatUpper === "YN" || formatUpper === "X") {
        if (typeof value === "boolean") {
          return value;
        }
        if (typeof value === "string") {
          const upper = value.toUpperCase();
          if (formatUpper === "YN") {
            return (
              upper === "Y" ||
              upper === "YES" ||
              upper === "TRUE" ||
              upper === "1"
            );
          } else if (formatUpper === "X") {
            return upper === "X" || upper === "TRUE" || upper === "1";
          }
        }
        return value === 1 || value === true;
      }
    }

    // Fallback to heuristics if format not available
    // Handle dates - look for common date field patterns
    const aliasLower = coheusAlias.toLowerCase();
    if (
      aliasLower.includes("date") ||
      aliasLower.includes("expiration") ||
      aliasLower.endsWith(" set") || // Appt Set, etc.
      aliasLower.includes("ordered") ||
      aliasLower.includes("received") ||
      aliasLower.includes("completed")
    ) {
      if (typeof value === "string" && value.trim()) {
        // Try to parse the date
        const dateStr = value.trim();
        let date = new Date(dateStr);

        // If direct parsing fails, try Encompass date format: "M/d/yyyy" or with time
        if (isNaN(date.getTime())) {
          const match = dateStr.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
          if (match) {
            const [, month, day, year] = match;
            date = new Date(
              `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`
            );
          }
        }

        if (!isNaN(date.getTime())) {
          return date.toISOString().split("T")[0];
        }
      }
      return value; // Return as-is if we can't parse it
    }

    // Handle numeric fields
    if (
      aliasLower.includes("amount") ||
      aliasLower.includes("price") ||
      aliasLower.includes("fee") ||
      aliasLower.includes("ratio") ||
      aliasLower.includes("rate") ||
      aliasLower.includes("percent") ||
      aliasLower.includes("score")
    ) {
      if (typeof value === "string") {
        const num = parseFloat(value);
        return isNaN(num) ? null : num;
      }
      return typeof value === "number" ? value : null;
    }

    // Handle boolean fields - expanded patterns
    if (
      aliasLower.includes("flag") ||
      aliasLower.includes("indicator") ||
      aliasLower.includes("self employed") ||
      aliasLower.includes("is same as") ||
      aliasLower.includes("is the same")
    ) {
      if (typeof value === "boolean") {
        return value;
      }
      if (typeof value === "string") {
        const upper = value.toUpperCase().trim();
        return (
          upper === "Y" ||
          upper === "YES" ||
          upper === "TRUE" ||
          upper === "1" ||
          upper === "X"
        );
      }
      return value === 1;
    }

    // Default: return as-is
    return value;
  }

  /**
   * Transform value for additional fields based on configured data type
   * Uses explicit data type from field definition rather than heuristics
   */
  private transformValueForAdditionalField(
    value: any,
    dataType: string,
    encompassFormat?: string | null
  ): any {
    // Handle empty values
    if (value === "" || value === null || value === undefined) {
      return null;
    }

    // Use Encompass format if available (most accurate)
    if (encompassFormat) {
      // Delegate to the main transformValue method for format-based conversion
      return this.transformValue(value, "", encompassFormat);
    }

    // Transform based on configured data type
    switch (dataType) {
      case "string":
        // Return as string
        return String(value);

      case "number":
      case "currency":
      case "percentage":
        // Parse as number
        if (typeof value === "string") {
          // Remove currency symbols, commas, etc.
          const cleanValue = value.replace(/[$,]/g, "").trim();
          const num = parseFloat(cleanValue);
          return isNaN(num) ? null : num;
        }
        return typeof value === "number" ? value : null;

      case "date":
        // Parse as date
        if (typeof value === "string") {
          const dateStr = value.trim();
          if (!dateStr) return null;

          // Try ISO format first
          let date = new Date(dateStr);

          // If that fails, try Encompass format: "M/d/yyyy"
          if (isNaN(date.getTime())) {
            const match = dateStr.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
            if (match) {
              const [, month, day, year] = match;
              date = new Date(
                `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`
              );
            }
          }

          if (!isNaN(date.getTime())) {
            return date.toISOString().split("T")[0]; // Return as DATE (YYYY-MM-DD)
          }

          // Return original if can't parse
          return dateStr;
        }
        if (value instanceof Date) {
          return value.toISOString().split("T")[0];
        }
        return value;

      case "boolean":
        // Parse as boolean
        if (typeof value === "boolean") {
          return value;
        }
        if (typeof value === "string") {
          const upper = value.toUpperCase().trim();
          return (
            upper === "Y" ||
            upper === "YES" ||
            upper === "TRUE" ||
            upper === "1" ||
            upper === "X"
          );
        }
        return value === 1 || value === true;

      default:
        // Unknown type - return as-is
        return value;
    }
  }
}
