/**
 * Encompass Field Discovery Service
 * Provides automated field discovery, sample analysis, and smart mapping suggestions
 * Uses existing V1 APIs (getRdbFields, getCustomFields, getLoans) for all operations
 */

import pg from 'pg';
import { EncompassApiService, EncompassField, EncompassCustomFieldFromApi, EncompassLoan, LoanSchemaField } from './encompassApiService.js';
import { getAllCoheusAliases, getDefaultFieldId, coheusAliasToColumnName, saveFieldSwap } from './encompassFieldMapper.js';

// ============================================================================
// Types
// ============================================================================

export interface DiscoveredField {
  fieldId: string;
  description: string;
  format?: string;
  fieldType?: number;
  isCustom: boolean;
  source: 'rdb' | 'custom';
}

export interface FieldPopulationStats {
  fieldId: string;
  sampleSize: number;
  populatedCount: number;
  populationRate: number; // 0-100
  sampleValues: string[]; // Up to 5 sample values (anonymized)
  detectedFormat?: string; // Inferred from values: DATE, DECIMAL, INTEGER, STRING, BOOLEAN
  minValue?: string;
  maxValue?: string;
  uniqueValueCount: number;
}

export interface MappingSuggestion {
  coheusAlias: string;
  postgresqlColumn: string;
  defaultFieldId: string | null;
  suggestedFieldId: string | null;
  suggestedFieldDescription?: string;
  confidence: number; // 0-100
  confidenceLevel: 'high' | 'medium' | 'low' | 'none';
  matchReason: string;
  populationRate?: number;
  isCurrentlyMapped: boolean;
  currentMappedFieldId?: string;
  alternativeSuggestions?: Array<{
    fieldId: string;
    description: string;
    confidence: number;
    reason: string;
  }>;
}

export interface FieldDiscoveryResult {
  discoveredFields: DiscoveredField[];
  rdbFieldCount: number;
  customFieldCount: number;
  cachedAt?: Date;
}

export interface FieldAnalysisResult {
  populationStats: FieldPopulationStats[];
  sampleSize: number;
  analyzedAt: Date;
  fieldsWithData: number;
  fieldsWithoutData: number;
}

export interface MappingSuggestionResult {
  suggestions: MappingSuggestion[];
  highConfidenceCount: number;
  mediumConfidenceCount: number;
  lowConfidenceCount: number;
  unmappedCount: number;
  generatedAt: Date;
}

// ============================================================================
// Service Implementation
// ============================================================================

export class EncompassFieldDiscoveryService {
  private tenantPool: pg.Pool;
  private apiService: EncompassApiService;

  constructor(tenantPool: pg.Pool, apiServer?: string) {
    this.tenantPool = tenantPool;
    this.apiService = new EncompassApiService(tenantPool, apiServer);
  }

  // --------------------------------------------------------------------------
  // Phase 1: Field Discovery
  // --------------------------------------------------------------------------

  /**
   * Discover all available fields from Encompass (RDB + Custom)
   * Uses existing V1 APIs: getRdbFields() and getCustomFields()
   */
  async discoverAvailableFields(
    tenantId: string,
    connectionId: string,
    useCache: boolean = true
  ): Promise<FieldDiscoveryResult> {
    console.log(`[FieldDiscovery] Discovering fields for connection: ${connectionId}`);

    // Check cache first if enabled
    if (useCache) {
      const cached = await this.getCachedFieldDiscovery(connectionId);
      if (cached && cached.length > 0) {
        console.log(`[FieldDiscovery] Using cached field discovery (${cached.length} fields)`);
        const rdbCount = cached.filter(f => f.source === 'rdb').length;
        const customCount = cached.filter(f => f.source === 'custom').length;
        return {
          discoveredFields: cached,
          rdbFieldCount: rdbCount,
          customFieldCount: customCount,
          cachedAt: new Date(),
        };
      }
    }

    const discoveredFields: DiscoveredField[] = [];

    // Fetch RDB fields (standard Encompass fields)
    try {
      console.log(`[FieldDiscovery] Fetching RDB field definitions...`);
      const rdbResponse = await this.apiService.getRdbFields(tenantId, connectionId);
      
      for (const field of rdbResponse.data) {
        discoveredFields.push({
          fieldId: field.fieldID,
          description: field.description || '',
          format: field.format,
          fieldType: field.fieldType,
          isCustom: false,
          source: 'rdb',
        });
      }
      console.log(`[FieldDiscovery] Found ${rdbResponse.data.length} RDB fields`);
    } catch (error: any) {
      console.error(`[FieldDiscovery] Error fetching RDB fields:`, error.message);
    }

    // Fetch custom fields (CX.* fields)
    try {
      console.log(`[FieldDiscovery] Fetching custom fields...`);
      const customResponse = await this.apiService.getCustomFields(tenantId, connectionId);
      
      for (const field of customResponse.data) {
        discoveredFields.push({
          fieldId: field.Id,
          description: field.Audit?.Data || field.Id,
          isCustom: true,
          source: 'custom',
        });
      }
      console.log(`[FieldDiscovery] Found ${customResponse.data.length} custom fields`);
    } catch (error: any) {
      console.error(`[FieldDiscovery] Error fetching custom fields:`, error.message);
    }

    // Cache the results
    await this.cacheFieldDiscovery(connectionId, discoveredFields);

    const rdbCount = discoveredFields.filter(f => f.source === 'rdb').length;
    const customCount = discoveredFields.filter(f => f.source === 'custom').length;

    console.log(`[FieldDiscovery] Discovery complete: ${discoveredFields.length} total fields (${rdbCount} RDB, ${customCount} custom)`);

    return {
      discoveredFields,
      rdbFieldCount: rdbCount,
      customFieldCount: customCount,
    };
  }

  // --------------------------------------------------------------------------
  // Phase 2: Sample Analysis
  // --------------------------------------------------------------------------

  /**
   * Fetch sample loans and analyze field population
   * Uses existing V1 API: getLoans()
   */
  async analyzeFieldPopulation(
    tenantId: string,
    connectionId: string,
    options: {
      sampleSize?: number;
      fieldsToAnalyze?: string[];
    } = {}
  ): Promise<FieldAnalysisResult> {
    const sampleSize = options.sampleSize || 50;
    console.log(`[FieldDiscovery] Analyzing field population with ${sampleSize} sample loans...`);

    // Get fields to analyze (either provided or from discovered fields)
    let fieldsToAnalyze = options.fieldsToAnalyze;
    if (!fieldsToAnalyze || fieldsToAnalyze.length === 0) {
      // Use all Coheus aliases to get their default field IDs
      const coheusAliases = getAllCoheusAliases();
      fieldsToAnalyze = coheusAliases
        .map(alias => getDefaultFieldId(alias))
        .filter((id): id is string => id !== null);
      
      // Also add some commonly used canonical names
      fieldsToAnalyze.push(
        'Loan.LoanNumber',
        'Loan.LoanAmount',
        'Loan.LoanFolder',
        'Loan.LastModified',
        'Fields.GUID'
      );
    }

    console.log(`[FieldDiscovery] Fetching ${sampleSize} sample loans with ${fieldsToAnalyze.length} fields...`);

    // Fetch recent sample loans (last 6 months) for representative population data
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    sixMonthsAgo.setDate(1);
    sixMonthsAgo.setHours(0, 0, 0, 0);

    let sampleLoans: EncompassLoan[] = [];
    try {
      const loansResponse = await this.apiService.getLoans(tenantId, connectionId, {
        limit: sampleSize,
        fields: fieldsToAnalyze,
        loanStartDate: sixMonthsAgo,
      });
      sampleLoans = loansResponse.data;
      console.log(`[FieldDiscovery] Fetched ${sampleLoans.length} sample loans`);
    } catch (error: any) {
      console.error(`[FieldDiscovery] Error fetching sample loans:`, error.message);
      throw new Error(`Failed to fetch sample loans: ${error.message}`);
    }

    if (sampleLoans.length === 0) {
      return {
        populationStats: [],
        sampleSize: 0,
        analyzedAt: new Date(),
        fieldsWithData: 0,
        fieldsWithoutData: fieldsToAnalyze.length,
      };
    }

    // Analyze each field's population
    const populationStats: FieldPopulationStats[] = [];
    
    for (const fieldId of fieldsToAnalyze) {
      const stats = this.analyzeFieldInSample(fieldId, sampleLoans);
      populationStats.push(stats);
    }

    // Cache the analysis results
    await this.cacheFieldAnalysis(connectionId, populationStats);

    const fieldsWithData = populationStats.filter(s => s.populationRate > 0).length;
    const fieldsWithoutData = populationStats.filter(s => s.populationRate === 0).length;

    console.log(`[FieldDiscovery] Analysis complete: ${fieldsWithData} fields with data, ${fieldsWithoutData} without data`);

    return {
      populationStats,
      sampleSize: sampleLoans.length,
      analyzedAt: new Date(),
      fieldsWithData,
      fieldsWithoutData,
    };
  }

  /**
   * Alternative field population analysis that fetches complete loans via
   * GET /v3/loans/{id} and reverse-engineers which fields are populated.
   * No batching or field-list limits — every field that exists on the loan
   * is returned in a single call.
   */
  async analyzeFieldPopulationViaFullLoans(
    tenantId: string,
    connectionId: string,
    options: {
      sampleSize?: number;
      emit?: (type: string, phase: string, message: string) => void;
    } = {}
  ): Promise<FieldAnalysisResult & { schemaFields: LoanSchemaField[]; fieldIdToJsonPath: Map<string, string> }> {
    const sampleSize = options.sampleSize || 30;
    const emit = options.emit || (() => {});

    // Step 1: Fetch the full loan schema (standard + custom + virtual fields) for fieldId→jsonPath bridging.
    emit("progress", "sampling", "Fetching loan schema and field metadata...");
    let schemaFields: LoanSchemaField[] = [];
    const fieldIdToJsonPath = new Map<string, string>();
    try {
      const schemaResp = await this.apiService.getLoanSchema(tenantId, connectionId);
      schemaFields = schemaResp.data;
      for (const field of schemaFields) {
        if (field.jsonPath) {
          fieldIdToJsonPath.set(field.fieldId, field.jsonPath);
          if (!field.fieldId.startsWith("Fields.") && !field.fieldId.startsWith("Loan.")) {
            fieldIdToJsonPath.set(`Fields.${field.fieldId}`, field.jsonPath);
          }
          if (field.fieldId.startsWith("Fields.")) {
            fieldIdToJsonPath.set(field.fieldId.substring(7), field.jsonPath);
          }
        }
      }
      console.log(
        `[FieldDiscovery:FullLoan] Schema loaded: ${schemaFields.length} fields, ${fieldIdToJsonPath.size} fieldId→jsonPath mappings`,
      );
    } catch (err: any) {
      console.warn(`[FieldDiscovery:FullLoan] Metadata fetch failed (non-fatal): ${err.message}`);
    }

    // Build a bidirectional lookup: jsonPath → fieldId AND fieldId → jsonPath
    const pathToFieldId = new Map<string, string>();
    for (const [fid, jp] of fieldIdToJsonPath) {
      // Normalize: remove "$." prefix and convert [N] → .N
      const normalized = jp.replace(/^\$\.?/, "").replace(/\[(\d+)\]/g, ".$1");
      pathToFieldId.set(normalized, fid);
      pathToFieldId.set(normalized.toLowerCase(), fid);
      // Also set the raw jsonPath
      if (jp !== normalized) pathToFieldId.set(jp, fid);
    }
    console.log(
      `[FieldDiscovery:FullLoan] pathToFieldId map: ${pathToFieldId.size} entries from ${fieldIdToJsonPath.size} resolved fields`
    );
    // Log a few sample mappings for verification
    const sampleMappings = [...fieldIdToJsonPath.entries()].slice(0, 8);
    console.log(
      `[FieldDiscovery:FullLoan] Sample mappings: ${sampleMappings.map(([fid, jp]) => `${fid}→${jp}`).join("; ")}`
    );

    // Step 2: Get recent loan GUIDs via lightweight Pipeline call
    emit("progress", "sampling", "Fetching recent loan GUIDs...");
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    sixMonthsAgo.setDate(1);
    sixMonthsAgo.setHours(0, 0, 0, 0);

    let loanGuids: string[] = [];
    try {
      const guidResp = await this.apiService.getLoans(tenantId, connectionId, {
        limit: sampleSize,
        fields: ["Fields.GUID", "Loan.LoanNumber"],
        loanStartDate: sixMonthsAgo,
      });
      loanGuids = guidResp.data
        .map((l) => l["Fields.GUID"] || l.loanGuid || l.GUID)
        .filter(Boolean)
        .map((g: string) => g.replace(/[{}]/g, ""));
    } catch (err: any) {
      throw new Error(`Failed to fetch loan GUIDs: ${err.message}`);
    }

    console.log(`[FieldDiscovery:FullLoan] Got ${loanGuids.length} loan GUIDs for sampling`);
    if (loanGuids.length === 0) {
      return {
        populationStats: [],
        sampleSize: 0,
        analyzedAt: new Date(),
        fieldsWithData: 0,
        fieldsWithoutData: 0,
        schemaFields,
        fieldIdToJsonPath,
      };
    }

    // Step 3: Fetch each loan individually and collect all leaf values
    // Maps fieldId → array of values (one per loan that has it)
    const fieldValues = new Map<string, string[]>();
    let fetchedCount = 0;

    for (const guid of loanGuids) {
      emit("progress", "sampling", `Fetching loan ${++fetchedCount}/${loanGuids.length}...`);
      try {
        const loanResp = await this.apiService.getLoanById(tenantId, connectionId, guid);
        const loanData = loanResp.data;

        // Log the top-level structure of the first loan for debugging
        if (fetchedCount === 1) {
          const topKeys = Object.keys(loanData).slice(0, 30);
          console.log(`[FieldDiscovery:FullLoan] First loan top-level keys (${Object.keys(loanData).length} total): ${topKeys.join(", ")}`);
          // Log a few specific values to understand format
          const sampleValues: Record<string, any> = {};
          for (const k of ["loanAmount", "interestRate", "loanNumber", "borrowerRequestedLoanAmount", "id", "loanFolder"]) {
            if (loanData[k] !== undefined) sampleValues[k] = loanData[k];
          }
          console.log(`[FieldDiscovery:FullLoan] Sample values:`, JSON.stringify(sampleValues).substring(0, 500));
        }

        // Walk the loan JSON recursively and collect all leaf values
        const leaves = this.extractLeafValues(loanData);

        // Log sample paths from first loan
        if (fetchedCount === 1) {
          const samplePaths = leaves.slice(0, 30).map(([p, v]) => `${p}=${String(v).substring(0, 30)}`);
          console.log(`[FieldDiscovery:FullLoan] First loan sample paths (${leaves.length} total): ${samplePaths.join("; ")}`);
        }

        for (const [path, value] of leaves) {
          if (!fieldValues.has(path)) fieldValues.set(path, []);
          fieldValues.get(path)!.push(value);
        }
      } catch (err: any) {
        console.warn(`[FieldDiscovery:FullLoan] Failed to fetch loan ${guid}: ${err.message}`);
      }

      // Respect concurrency — 500ms between calls
      if (fetchedCount < loanGuids.length) {
        await new Promise((r) => setTimeout(r, 500));
      }
    }

    console.log(
      `[FieldDiscovery:FullLoan] Fetched ${fetchedCount} loans, discovered ${fieldValues.size} unique field paths`
    );

    // Step 4: Build population stats from collected values
    emit("progress", "sampling", "Computing field population stats...");
    const populationStats: FieldPopulationStats[] = [];

    for (const [fieldPath, values] of fieldValues) {
      const populatedCount = values.length;
      const populationRate = Math.round((populatedCount / loanGuids.length) * 100);
      const uniqueValues = new Set(values);
      const sampleValues = this.getAnonymizedSampleValues(values.slice(0, 10));
      const detectedFormat = this.detectValueFormat(values);

      let minValue: string | undefined;
      let maxValue: string | undefined;
      if (detectedFormat === "DECIMAL" || detectedFormat === "INTEGER") {
        const numericValues = values.map((v) => parseFloat(v)).filter((v) => !isNaN(v));
        if (numericValues.length > 0) {
          minValue = String(Math.min(...numericValues));
          maxValue = String(Math.max(...numericValues));
        }
      }

      populationStats.push({
        fieldId: fieldPath,
        sampleSize: loanGuids.length,
        populatedCount,
        populationRate,
        sampleValues,
        detectedFormat,
        minValue,
        maxValue,
        uniqueValueCount: uniqueValues.size,
      });
    }

    // Sort by population rate descending
    populationStats.sort((a, b) => b.populationRate - a.populationRate);

    const fieldsWithData = populationStats.filter((s) => s.populationRate > 0).length;
    const fieldsWithoutData = populationStats.filter((s) => s.populationRate === 0).length;

    console.log(
      `[FieldDiscovery:FullLoan] Analysis complete: ${fieldsWithData} fields with data, ${fieldsWithoutData} without data (out of ${populationStats.length} total)`
    );

    return {
      populationStats,
      sampleSize: loanGuids.length,
      analyzedAt: new Date(),
      fieldsWithData,
      fieldsWithoutData,
      schemaFields,
      fieldIdToJsonPath,
    };
  }

  /**
   * Get recent loan GUIDs (e.g. for Field Reader gap-fill). Uses pipeline with minimal fields.
   */
  async getRecentLoanGuids(
    tenantId: string,
    connectionId: string,
    limit: number = 5,
  ): Promise<string[]> {
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    sixMonthsAgo.setDate(1);
    sixMonthsAgo.setHours(0, 0, 0, 0);
    const resp = await this.apiService.getLoans(tenantId, connectionId, {
      limit,
      fields: ["Fields.GUID", "Loan.LoanNumber"],
      loanStartDate: sixMonthsAgo,
    });
    return (resp.data as any[])
      .map((l) => l["Fields.GUID"] ?? l.loanGuid ?? l.GUID)
      .filter(Boolean)
      .map((g: string) => String(g).replace(/[{}]/g, ""));
  }

  /**
   * Return the set of canonical field names configured in the tenant's Reporting Database.
   * Delegates to EncompassApiService.getCanonicalFields (GET /v3/loanPipeline/canonicalFields).
   */
  async getCanonicalFields(
    tenantId: string,
    connectionId: string,
  ): Promise<{ canonicalName: string; displayName: string; dataType?: string }[]> {
    const resp = await this.apiService.getCanonicalFields(tenantId, connectionId);
    return resp.data;
  }

  /**
   * Get population stats for specific field IDs by reading values via V3 Field Reader API.
   * Used by hybrid onboarding strategy to fill gaps for default fields not resolved by pipeline or full-loan bridging.
   */
  async getFieldPopulationViaFieldReader(
    tenantId: string,
    connectionId: string,
    loanGuids: string[],
    fieldIds: string[],
  ): Promise<FieldPopulationStats[]> {
    if (loanGuids.length === 0 || fieldIds.length === 0) return [];

    const fieldValues = new Map<string, string[]>();
    for (const fid of fieldIds) {
      fieldValues.set(fid, []);
    }

    for (const guid of loanGuids) {
      try {
        const resp = await this.apiService.readLoanFields(
          tenantId,
          connectionId,
          guid,
          fieldIds,
        );
        for (const { fieldId, value } of resp.data) {
          if (value !== "" && value != null) {
            const arr = fieldValues.get(fieldId);
            if (arr) arr.push(value);
          }
        }
      } catch (err: any) {
        console.warn(
          `[FieldDiscovery:FieldReader] Failed to read loan ${guid}: ${err.message}`,
        );
      }
      await new Promise((r) => setTimeout(r, 200));
    }

    const sampleSize = loanGuids.length;
    const stats: FieldPopulationStats[] = [];
    for (const [fieldId, values] of fieldValues) {
      const populatedCount = values.length;
      const populationRate = Math.round((populatedCount / sampleSize) * 100);
      const uniqueValues = new Set(values);
      const sampleValues = this.getAnonymizedSampleValues(values.slice(0, 10));
      const detectedFormat = this.detectValueFormat(values);
      let minValue: string | undefined;
      let maxValue: string | undefined;
      if (detectedFormat === "DECIMAL" || detectedFormat === "INTEGER") {
        const numericValues = values
          .map((v) => parseFloat(v))
          .filter((v) => !isNaN(v));
        if (numericValues.length > 0) {
          minValue = String(Math.min(...numericValues));
          maxValue = String(Math.max(...numericValues));
        }
      }
      stats.push({
        fieldId,
        sampleSize,
        populatedCount,
        populationRate,
        sampleValues,
        detectedFormat,
        minValue,
        maxValue,
        uniqueValueCount: uniqueValues.size,
      });
    }
    return stats;
  }

  /**
   * Recursively walk a loan JSON object and extract all leaf key-value pairs.
   * Returns entries as [fieldPath, stringValue].
   * Flattens arrays (e.g., applications[0].borrower.firstName → "applications.0.borrower.firstName")
   * but also maps common Encompass JSON paths to their field IDs.
   */
  private extractLeafValues(
    obj: any,
    prefix: string = "",
    results: Array<[string, string]> = []
  ): Array<[string, string]> {
    if (obj === null || obj === undefined) return results;

    if (Array.isArray(obj)) {
      for (let i = 0; i < obj.length; i++) {
        this.extractLeafValues(obj[i], `${prefix}${i}.`, results);
      }
      return results;
    }

    if (typeof obj === "object") {
      for (const [key, val] of Object.entries(obj)) {
        const fullPath = prefix ? `${prefix}${key}` : key;

        if (val === null || val === undefined || val === "") continue;

        if (typeof val === "object") {
          this.extractLeafValues(val, `${fullPath}.`, results);
        } else {
          const strVal = String(val);
          if (strVal !== "") {
            results.push([fullPath, strVal]);
          }
        }
      }
      return results;
    }

    // Primitive at root level
    if (prefix && obj !== "" && obj !== null && obj !== undefined) {
      results.push([prefix.replace(/\.$/, ""), String(obj)]);
    }
    return results;
  }

  /**
   * Analyze a single field across sample loans
   */
  private analyzeFieldInSample(fieldId: string, sampleLoans: EncompassLoan[]): FieldPopulationStats {
    const values: string[] = [];
    const uniqueValues = new Set<string>();

    for (const loan of sampleLoans) {
      // Try different field ID formats
      const value = loan[fieldId] 
        || loan[`Fields.${fieldId}`] 
        || loan[fieldId.replace('Fields.', '')];
      
      if (value !== null && value !== undefined && value !== '') {
        const strValue = String(value);
        values.push(strValue);
        uniqueValues.add(strValue);
      }
    }

    const populatedCount = values.length;
    const populationRate = Math.round((populatedCount / sampleLoans.length) * 100);

    // Get sample values (anonymized - just patterns)
    const sampleValues = this.getAnonymizedSampleValues(values.slice(0, 10));

    // Detect format from values
    const detectedFormat = this.detectValueFormat(values);

    // Get min/max for numeric fields
    let minValue: string | undefined;
    let maxValue: string | undefined;
    if (detectedFormat === 'DECIMAL' || detectedFormat === 'INTEGER') {
      const numericValues = values.map(v => parseFloat(v)).filter(v => !isNaN(v));
      if (numericValues.length > 0) {
        minValue = String(Math.min(...numericValues));
        maxValue = String(Math.max(...numericValues));
      }
    }

    return {
      fieldId,
      sampleSize: sampleLoans.length,
      populatedCount,
      populationRate,
      sampleValues,
      detectedFormat,
      minValue,
      maxValue,
      uniqueValueCount: uniqueValues.size,
    };
  }

  /**
   * Anonymize sample values to avoid PII exposure
   */
  private getAnonymizedSampleValues(values: string[]): string[] {
    return values.slice(0, 5).map(value => {
      // Mask potential PII patterns
      if (/^\d{3}-\d{2}-\d{4}$/.test(value)) return '***-**-****'; // SSN
      if (/^\d{10,}$/.test(value)) return value.substring(0, 3) + '***'; // Phone/Account
      if (/@/.test(value)) return '***@***.***'; // Email
      if (value.length > 50) return value.substring(0, 20) + '...'; // Long text
      return value;
    });
  }

  /**
   * Detect the format/type of values
   */
  private detectValueFormat(values: string[]): string {
    if (values.length === 0) return 'UNKNOWN';

    // Sample a subset for analysis
    const sample = values.slice(0, 20);
    
    let dateCount = 0;
    let integerCount = 0;
    let decimalCount = 0;
    let booleanCount = 0;

    for (const value of sample) {
      // Check for date patterns
      if (/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(value) || 
          /^\d{4}-\d{2}-\d{2}/.test(value)) {
        dateCount++;
        continue;
      }

      // Check for boolean
      if (/^(Y|N|Yes|No|True|False|X|0|1)$/i.test(value)) {
        booleanCount++;
        continue;
      }

      // Check for numeric
      const numValue = parseFloat(value);
      if (!isNaN(numValue)) {
        if (Number.isInteger(numValue) && !value.includes('.')) {
          integerCount++;
        } else {
          decimalCount++;
        }
        continue;
      }
    }

    // Determine format based on majority
    const threshold = sample.length * 0.6;
    if (dateCount >= threshold) return 'DATE';
    if (booleanCount >= threshold) return 'BOOLEAN';
    if (integerCount >= threshold) return 'INTEGER';
    if (decimalCount >= threshold) return 'DECIMAL';
    if (integerCount + decimalCount >= threshold) return 'DECIMAL';

    return 'STRING';
  }

  // --------------------------------------------------------------------------
  // Phase 3: Smart Matching & Suggestions
  // --------------------------------------------------------------------------

  /**
   * Generate mapping suggestions by matching Coheus aliases to discovered fields
   */
  async generateMappingSuggestions(
    tenantId: string,
    connectionId: string,
    options: {
      runAnalysis?: boolean;
      sampleSize?: number;
    } = {}
  ): Promise<MappingSuggestionResult> {
    console.log(`[FieldDiscovery] Generating mapping suggestions for connection: ${connectionId}`);

    // Step 1: Discover available fields
    const discoveryResult = await this.discoverAvailableFields(tenantId, connectionId);
    const fieldMap = new Map<string, DiscoveredField>();
    for (const field of discoveryResult.discoveredFields) {
      fieldMap.set(field.fieldId, field);
      // Also index without Fields. prefix
      if (field.fieldId.startsWith('Fields.')) {
        fieldMap.set(field.fieldId.replace('Fields.', ''), field);
      }
    }

    // Step 2: Optionally run sample analysis
    let analysisResult: FieldAnalysisResult | null = null;
    const populationMap = new Map<string, FieldPopulationStats>();
    
    if (options.runAnalysis !== false) {
      try {
        analysisResult = await this.analyzeFieldPopulation(tenantId, connectionId, {
          sampleSize: options.sampleSize || 50,
        });
        for (const stats of analysisResult.populationStats) {
          populationMap.set(stats.fieldId, stats);
          // Also index without Fields. prefix
          if (stats.fieldId.startsWith('Fields.')) {
            populationMap.set(stats.fieldId.replace('Fields.', ''), stats);
          }
        }
      } catch (error: any) {
        console.warn(`[FieldDiscovery] Sample analysis failed, continuing without population data:`, error.message);
      }
    } else {
      // Try to load cached analysis
      const cachedAnalysis = await this.getCachedFieldAnalysis(connectionId);
      if (cachedAnalysis) {
        for (const stats of cachedAnalysis) {
          populationMap.set(stats.fieldId, stats);
        }
      }
    }

    // Step 3: Get existing field swaps
    const existingSwaps = await this.getExistingFieldSwaps(connectionId);

    // Step 4: Generate suggestions for each Coheus alias
    const coheusAliases = getAllCoheusAliases();
    const suggestions: MappingSuggestion[] = [];

    for (const alias of coheusAliases) {
      const suggestion = this.generateSuggestionForAlias(
        alias,
        fieldMap,
        populationMap,
        existingSwaps
      );
      suggestions.push(suggestion);
    }

    // Sort by confidence (highest first), then by alias
    suggestions.sort((a, b) => {
      if (b.confidence !== a.confidence) return b.confidence - a.confidence;
      return a.coheusAlias.localeCompare(b.coheusAlias);
    });

    const highConfidenceCount = suggestions.filter(s => s.confidenceLevel === 'high').length;
    const mediumConfidenceCount = suggestions.filter(s => s.confidenceLevel === 'medium').length;
    const lowConfidenceCount = suggestions.filter(s => s.confidenceLevel === 'low').length;
    const unmappedCount = suggestions.filter(s => s.confidenceLevel === 'none').length;

    console.log(`[FieldDiscovery] Generated ${suggestions.length} suggestions: ${highConfidenceCount} high, ${mediumConfidenceCount} medium, ${lowConfidenceCount} low, ${unmappedCount} unmapped`);

    return {
      suggestions,
      highConfidenceCount,
      mediumConfidenceCount,
      lowConfidenceCount,
      unmappedCount,
      generatedAt: new Date(),
    };
  }

  /**
   * Generate suggestion for a single Coheus alias
   * SMART MATCHING: Always searches for best match across ALL fields, not just default
   */
  private generateSuggestionForAlias(
    alias: string,
    fieldMap: Map<string, DiscoveredField>,
    populationMap: Map<string, FieldPopulationStats>,
    existingSwaps: Map<string, string>
  ): MappingSuggestion {
    const defaultFieldId = getDefaultFieldId(alias);
    const postgresqlColumn = coheusAliasToColumnName(alias);
    const currentMappedFieldId = existingSwaps.get(alias);
    const isCurrentlyMapped = !!currentMappedFieldId;

    // Check if default field exists in discovered fields
    const defaultField = defaultFieldId ? fieldMap.get(defaultFieldId) : null;
    const defaultFieldStats = defaultFieldId ? populationMap.get(defaultFieldId) : null;

    // ALWAYS search for best matches across all discovered fields
    const allMatches = this.findAllMatchesByDescription(alias, fieldMap, populationMap);
    
    // Track alternatives for the response
    const alternativeSuggestions: Array<{
      fieldId: string;
      description: string;
      confidence: number;
      reason: string;
    }> = [];

    let suggestedFieldId: string | null = null;
    let suggestedFieldDescription: string | undefined;
    let confidence = 0;
    let matchReason = '';
    let populationRate: number | undefined;

    // Case 1: Current swap exists and is valid - respect existing mappings
    if (currentMappedFieldId && fieldMap.has(currentMappedFieldId)) {
      suggestedFieldId = currentMappedFieldId;
      suggestedFieldDescription = fieldMap.get(currentMappedFieldId)?.description;
      const stats = populationMap.get(currentMappedFieldId);
      populationRate = stats?.populationRate;
      
      if (stats && stats.populationRate > 50) {
        confidence = 95;
        matchReason = 'Existing mapping with good population';
      } else if (stats && stats.populationRate > 0) {
        confidence = 80;
        matchReason = 'Existing mapping with some data';
      } else {
        confidence = 60;
        matchReason = 'Existing mapping (no population data)';
      }
      
      // Add alternatives from search (excluding current)
      for (const match of allMatches.slice(0, 3)) {
        if (match.fieldId !== currentMappedFieldId) {
          alternativeSuggestions.push(match);
        }
      }
    }
    // Case 2: Evaluate default field vs discovered alternatives
    else {
      // Score the default field if it exists
      let defaultScore = 0;
      let defaultReason = '';
      
      if (defaultField) {
        const descMatch = this.calculateDescriptionSimilarity(alias, defaultField.description);
        const hasPopulation = defaultFieldStats && defaultFieldStats.populationRate > 0;
        const highPopulation = defaultFieldStats && defaultFieldStats.populationRate > 50;
        
        // Calculate default field score
        defaultScore = descMatch * 40; // Up to 40 points for description match
        if (highPopulation) defaultScore += 35;
        else if (hasPopulation) defaultScore += 20;
        defaultScore += 15; // Bonus for being the known default
        
        if (descMatch > 0.8 && highPopulation) {
          defaultReason = 'Default field with exact match and high population';
        } else if (descMatch > 0.8) {
          defaultReason = 'Default field with exact match';
        } else if (highPopulation) {
          defaultReason = 'Default field with high population';
        } else if (hasPopulation) {
          defaultReason = 'Default field with some data';
        } else {
          defaultReason = 'Default field (no population data)';
        }
      }
      
      // Find best alternative from description search
      const bestAlternative = allMatches.length > 0 ? allMatches[0] : null;
      
      // Compare default vs best alternative
      if (defaultField && (!bestAlternative || defaultScore >= bestAlternative.confidence)) {
        // Default field wins
        suggestedFieldId = defaultFieldId;
        suggestedFieldDescription = defaultField.description;
        populationRate = defaultFieldStats?.populationRate;
        confidence = Math.min(Math.round(defaultScore), 98);
        matchReason = defaultReason;
        
        // Add alternatives
        for (const match of allMatches.slice(0, 3)) {
          if (match.fieldId !== defaultFieldId) {
            alternativeSuggestions.push(match);
          }
        }
      } else if (bestAlternative) {
        // Alternative wins - suggest it instead of default
        suggestedFieldId = bestAlternative.fieldId;
        suggestedFieldDescription = bestAlternative.description;
        confidence = bestAlternative.confidence;
        matchReason = bestAlternative.reason + (defaultFieldId ? ' (better than default)' : '');
        populationRate = populationMap.get(bestAlternative.fieldId)?.populationRate;
        
        // Add default as an alternative if it exists
        if (defaultField && defaultFieldId) {
          alternativeSuggestions.push({
            fieldId: defaultFieldId,
            description: defaultField.description,
            confidence: Math.round(defaultScore),
            reason: defaultReason,
          });
        }
        
        // Add other alternatives
        for (const match of allMatches.slice(1, 3)) {
          if (match.fieldId !== suggestedFieldId) {
            alternativeSuggestions.push(match);
          }
        }
      } else {
        // No matches found at all
        confidence = 0;
        matchReason = 'No matching field found in Encompass';
      }
    }

    // Determine confidence level
    let confidenceLevel: 'high' | 'medium' | 'low' | 'none';
    if (confidence >= 85) confidenceLevel = 'high';
    else if (confidence >= 65) confidenceLevel = 'medium';
    else if (confidence >= 40) confidenceLevel = 'low';
    else confidenceLevel = 'none';

    return {
      coheusAlias: alias,
      postgresqlColumn,
      defaultFieldId,
      suggestedFieldId,
      suggestedFieldDescription,
      confidence,
      confidenceLevel,
      matchReason,
      populationRate,
      isCurrentlyMapped,
      currentMappedFieldId,
      alternativeSuggestions: alternativeSuggestions.length > 0 ? alternativeSuggestions : undefined,
    };
  }

  /**
   * Find ALL matching fields by description (returns top matches sorted by score)
   */
  private findAllMatchesByDescription(
    alias: string,
    fieldMap: Map<string, DiscoveredField>,
    populationMap: Map<string, FieldPopulationStats>
  ): Array<{ fieldId: string; description: string; confidence: number; reason: string }> {
    const matches: Array<{ fieldId: string; description: string; score: number; populationBonus: number }> = [];
    const seenFieldIds = new Set<string>();

    for (const [fieldId, field] of fieldMap) {
      // Skip duplicates (fields indexed with and without Fields. prefix)
      const normalizedId = fieldId.replace(/^Fields\./, '');
      if (seenFieldIds.has(normalizedId)) continue;
      seenFieldIds.add(normalizedId);

      if (!field.description) continue;
      
      const similarity = this.calculateDescriptionSimilarity(alias, field.description);
      
      // Only consider fields with decent similarity
      if (similarity >= 0.3) {
        const stats = populationMap.get(fieldId);
        const populationBonus = stats 
          ? (stats.populationRate > 50 ? 30 : stats.populationRate > 0 ? 15 : 0)
          : 0;
        
        matches.push({
          fieldId,
          description: field.description,
          score: similarity * 50 + populationBonus, // Base score + population bonus
          populationBonus,
        });
      }
    }

    // Sort by score descending
    matches.sort((a, b) => b.score - a.score);

    // Convert to final format with confidence and reason
    return matches.slice(0, 5).map(match => {
      const confidence = Math.min(Math.round(match.score), 90);
      let reason = 'Description match';
      if (match.populationBonus > 20) {
        reason = 'Description match with high population';
      } else if (match.populationBonus > 0) {
        reason = 'Description match with data';
      }
      
      return {
        fieldId: match.fieldId,
        description: match.description,
        confidence,
        reason,
      };
    });
  }

  /**
   * Calculate similarity between alias and field description
   */
  private calculateDescriptionSimilarity(alias: string, description: string): number {
    const normalizedAlias = alias.toLowerCase().replace(/[^a-z0-9]/g, '');
    const normalizedDesc = description.toLowerCase().replace(/[^a-z0-9]/g, '');

    // Exact match
    if (normalizedAlias === normalizedDesc) return 1.0;

    // Contains match
    if (normalizedDesc.includes(normalizedAlias) || normalizedAlias.includes(normalizedDesc)) {
      return 0.85;
    }

    // Word overlap
    const aliasWords = alias.toLowerCase().split(/[\s_-]+/).filter(w => w.length > 2);
    const descWords = description.toLowerCase().split(/[\s_-]+/).filter(w => w.length > 2);
    
    if (aliasWords.length === 0 || descWords.length === 0) return 0;

    const matchingWords = aliasWords.filter(w => descWords.some(dw => dw.includes(w) || w.includes(dw)));
    const overlapScore = matchingWords.length / Math.max(aliasWords.length, descWords.length);

    return Math.min(overlapScore, 0.8);
  }

  // --------------------------------------------------------------------------
  // Apply Suggestions
  // --------------------------------------------------------------------------

  /**
   * Apply selected mapping suggestions as field swaps
   */
  async applySuggestions(
    connectionId: string,
    suggestions: Array<{ coheusAlias: string; fieldId: string }>
  ): Promise<{ applied: number; errors: string[] }> {
    console.log(`[FieldDiscovery] Applying ${suggestions.length} mapping suggestions...`);

    let applied = 0;
    const errors: string[] = [];

    for (const suggestion of suggestions) {
      try {
        await saveFieldSwap(
          this.tenantPool,
          connectionId,
          suggestion.coheusAlias,
          suggestion.fieldId
        );
        applied++;
      } catch (error: any) {
        errors.push(`Failed to apply ${suggestion.coheusAlias}: ${error.message}`);
      }
    }

    console.log(`[FieldDiscovery] Applied ${applied} suggestions, ${errors.length} errors`);
    return { applied, errors };
  }

  // --------------------------------------------------------------------------
  // Caching
  // --------------------------------------------------------------------------

  /**
   * Cache field discovery results
   */
  private async cacheFieldDiscovery(connectionId: string, fields: DiscoveredField[]): Promise<void> {
    try {
      // Clear existing cache
      await this.tenantPool.query(
        `DELETE FROM public.encompass_field_discovery_cache WHERE los_connection_id = $1`,
        [connectionId]
      );

      // Insert new cache entries (batch insert)
      if (fields.length > 0) {
        const values: any[] = [];
        const placeholders: string[] = [];
        let paramIndex = 1;

        for (const field of fields) {
          placeholders.push(`($${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, NOW())`);
          values.push(connectionId, field.fieldId, field.description, field.format || null, field.fieldType || null, field.isCustom);
        }

        // Batch insert in chunks of 500
        const chunkSize = 500;
        for (let i = 0; i < fields.length; i += chunkSize) {
          const chunkFields = fields.slice(i, i + chunkSize);
          const chunkValues: any[] = [];
          const chunkPlaceholders: string[] = [];
          let idx = 1;

          for (const field of chunkFields) {
            chunkPlaceholders.push(`($${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, NOW())`);
            chunkValues.push(connectionId, field.fieldId, field.description, field.format || null, field.fieldType || null, field.isCustom);
          }

          await this.tenantPool.query(
            `INSERT INTO public.encompass_field_discovery_cache 
             (los_connection_id, field_id, description, format, field_type, is_custom, cached_at)
             VALUES ${chunkPlaceholders.join(', ')}
             ON CONFLICT (los_connection_id, field_id) DO UPDATE SET
               description = EXCLUDED.description,
               format = EXCLUDED.format,
               field_type = EXCLUDED.field_type,
               is_custom = EXCLUDED.is_custom,
               cached_at = NOW()`,
            chunkValues
          );
        }
      }

      console.log(`[FieldDiscovery] Cached ${fields.length} field definitions`);
    } catch (error: any) {
      // If table doesn't exist, log warning but don't fail
      if (error.code === '42P01') {
        console.warn(`[FieldDiscovery] Cache table doesn't exist, skipping cache`);
      } else {
        console.error(`[FieldDiscovery] Error caching field discovery:`, error.message);
      }
    }
  }

  /**
   * Get cached field discovery results
   */
  private async getCachedFieldDiscovery(connectionId: string): Promise<DiscoveredField[] | null> {
    try {
      const result = await this.tenantPool.query(
        `SELECT field_id, description, format, field_type, is_custom
         FROM public.encompass_field_discovery_cache
         WHERE los_connection_id = $1
         AND cached_at > NOW() - INTERVAL '7 days'`,
        [connectionId]
      );

      if (result.rows.length === 0) return null;

      return result.rows.map(row => ({
        fieldId: row.field_id,
        description: row.description || '',
        format: row.format,
        fieldType: row.field_type,
        isCustom: row.is_custom,
        source: row.is_custom ? 'custom' as const : 'rdb' as const,
      }));
    } catch (error: any) {
      if (error.code === '42P01') {
        // Table doesn't exist
        return null;
      }
      console.error(`[FieldDiscovery] Error getting cached fields:`, error.message);
      return null;
    }
  }

  /**
   * Cache field analysis results
   */
  private async cacheFieldAnalysis(connectionId: string, stats: FieldPopulationStats[]): Promise<void> {
    try {
      // Clear existing cache
      await this.tenantPool.query(
        `DELETE FROM public.encompass_field_analysis WHERE los_connection_id = $1`,
        [connectionId]
      );

      // Insert new cache entries (batch insert) — deduplicate by field_id first
      const deduped = [...new Map(stats.map(s => [s.fieldId, s])).values()];
      if (deduped.length > 0) {
        const chunkSize = 500;
        for (let i = 0; i < deduped.length; i += chunkSize) {
          const chunkStats = deduped.slice(i, i + chunkSize);
          const chunkValues: any[] = [];
          const chunkPlaceholders: string[] = [];
          let idx = 1;

          for (const stat of chunkStats) {
            chunkPlaceholders.push(`($${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, NOW())`);
            chunkValues.push(
              connectionId,
              stat.fieldId,
              stat.sampleSize,
              stat.populationRate,
              JSON.stringify(stat.sampleValues),
              stat.detectedFormat || null
            );
          }

          await this.tenantPool.query(
            `INSERT INTO public.encompass_field_analysis 
             (los_connection_id, field_id, sample_size, population_rate, sample_values, detected_format, analyzed_at)
             VALUES ${chunkPlaceholders.join(', ')}
             ON CONFLICT (los_connection_id, field_id) DO UPDATE SET
               sample_size = EXCLUDED.sample_size,
               population_rate = EXCLUDED.population_rate,
               sample_values = EXCLUDED.sample_values,
               detected_format = EXCLUDED.detected_format,
               analyzed_at = NOW()`,
            chunkValues
          );
        }
      }

      console.log(`[FieldDiscovery] Cached ${deduped.length} field analysis results${deduped.length < stats.length ? ` (${stats.length - deduped.length} duplicates removed)` : ""}`);
    } catch (error: any) {
      if (error.code === '42P01') {
        console.warn(`[FieldDiscovery] Analysis cache table doesn't exist, skipping cache`);
      } else {
        console.error(`[FieldDiscovery] Error caching field analysis:`, error.message);
      }
    }
  }

  /**
   * Get cached field analysis results
   */
  private async getCachedFieldAnalysis(connectionId: string): Promise<FieldPopulationStats[] | null> {
    try {
      const result = await this.tenantPool.query(
        `SELECT field_id, sample_size, population_rate, sample_values, detected_format
         FROM public.encompass_field_analysis
         WHERE los_connection_id = $1
         AND analyzed_at > NOW() - INTERVAL '24 hours'`,
        [connectionId]
      );

      if (result.rows.length === 0) return null;

      return result.rows.map(row => ({
        fieldId: row.field_id,
        sampleSize: row.sample_size,
        populatedCount: Math.round(row.sample_size * row.population_rate / 100),
        populationRate: row.population_rate,
        sampleValues: row.sample_values || [],
        detectedFormat: row.detected_format,
        uniqueValueCount: 0, // Not cached
      }));
    } catch (error: any) {
      if (error.code === '42P01') {
        return null;
      }
      console.error(`[FieldDiscovery] Error getting cached analysis:`, error.message);
      return null;
    }
  }

  /**
   * Get existing field swaps for a connection
   */
  private async getExistingFieldSwaps(connectionId: string): Promise<Map<string, string>> {
    const swaps = new Map<string, string>();
    
    try {
      const result = await this.tenantPool.query(
        `SELECT coheus_alias, encompass_field_id
         FROM public.encompass_field_swaps
         WHERE los_connection_id = $1 AND is_active = TRUE`,
        [connectionId]
      );

      for (const row of result.rows) {
        swaps.set(row.coheus_alias, row.encompass_field_id);
      }
    } catch (error: any) {
      if (error.code !== '42P01') {
        console.error(`[FieldDiscovery] Error getting existing swaps:`, error.message);
      }
    }

    return swaps;
  }
}
