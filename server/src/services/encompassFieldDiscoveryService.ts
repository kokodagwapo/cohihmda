/**
 * Encompass Field Discovery Service
 * Provides automated field discovery, sample analysis, and smart mapping suggestions
 * Uses existing V1 APIs (getRdbFields, getCustomFields, getLoans) for all operations
 */

import pg from 'pg';
import { EncompassApiService, EncompassField, EncompassCustomFieldFromApi, EncompassLoan } from './encompassApiService.js';
import { getAllCoheusAliases, getDefaultFieldId, coheusAliasToColumnName } from './encompassFieldMapper.js';

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

    // Fetch sample loans
    let sampleLoans: EncompassLoan[] = [];
    try {
      const loansResponse = await this.apiService.getLoans(tenantId, connectionId, {
        limit: sampleSize,
        fields: fieldsToAnalyze,
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

    // Try to find best match
    let suggestedFieldId: string | null = null;
    let suggestedFieldDescription: string | undefined;
    let confidence = 0;
    let matchReason = '';
    let populationRate: number | undefined;

    // Case 1: Current swap exists and is valid
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
    }
    // Case 2: Default field exists
    else if (defaultField) {
      suggestedFieldId = defaultFieldId;
      suggestedFieldDescription = defaultField.description;
      populationRate = defaultFieldStats?.populationRate;

      // Calculate confidence based on match quality
      const descriptionMatch = this.calculateDescriptionSimilarity(alias, defaultField.description);
      const hasPopulation = defaultFieldStats && defaultFieldStats.populationRate > 0;

      if (descriptionMatch > 0.8 && hasPopulation && defaultFieldStats!.populationRate > 50) {
        confidence = 98;
        matchReason = 'Exact match with high population';
      } else if (descriptionMatch > 0.8 && hasPopulation) {
        confidence = 90;
        matchReason = 'Exact match with data';
      } else if (descriptionMatch > 0.8) {
        confidence = 85;
        matchReason = 'Exact match (no population data)';
      } else if (descriptionMatch > 0.5 && hasPopulation) {
        confidence = 75;
        matchReason = 'Good match with data';
      } else if (descriptionMatch > 0.5) {
        confidence = 65;
        matchReason = 'Good match (no population data)';
      } else if (hasPopulation && defaultFieldStats!.populationRate > 50) {
        confidence = 70;
        matchReason = 'Field exists with high population';
      } else if (hasPopulation) {
        confidence = 55;
        matchReason = 'Field exists with some data';
      } else {
        confidence = 45;
        matchReason = 'Field exists in schema';
      }
    }
    // Case 3: Try to find by description matching
    else {
      const match = this.findBestMatchByDescription(alias, fieldMap, populationMap);
      if (match) {
        suggestedFieldId = match.fieldId;
        suggestedFieldDescription = match.description;
        confidence = match.confidence;
        matchReason = match.reason;
        populationRate = populationMap.get(match.fieldId)?.populationRate;
      } else {
        confidence = 0;
        matchReason = 'No matching field found';
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
    };
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

  /**
   * Find best matching field by description
   */
  private findBestMatchByDescription(
    alias: string,
    fieldMap: Map<string, DiscoveredField>,
    populationMap: Map<string, FieldPopulationStats>
  ): { fieldId: string; description: string; confidence: number; reason: string } | null {
    let bestMatch: { fieldId: string; description: string; score: number } | null = null;

    for (const [fieldId, field] of fieldMap) {
      if (!field.description) continue;
      
      const similarity = this.calculateDescriptionSimilarity(alias, field.description);
      
      if (similarity > 0.5 && (!bestMatch || similarity > bestMatch.score)) {
        bestMatch = { fieldId, description: field.description, score: similarity };
      }
    }

    if (!bestMatch) return null;

    const stats = populationMap.get(bestMatch.fieldId);
    let confidence = Math.round(bestMatch.score * 60); // Base confidence from similarity
    let reason = 'Description match';

    // Boost confidence if field has data
    if (stats && stats.populationRate > 50) {
      confidence = Math.min(confidence + 25, 80);
      reason = 'Description match with high population';
    } else if (stats && stats.populationRate > 0) {
      confidence = Math.min(confidence + 15, 70);
      reason = 'Description match with data';
    }

    return {
      fieldId: bestMatch.fieldId,
      description: bestMatch.description,
      confidence,
      reason,
    };
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
        await this.tenantPool.query(
          `INSERT INTO public.encompass_field_swaps 
           (los_connection_id, coheus_alias, encompass_field_id, swap_type, is_active, updated_at)
           VALUES ($1, $2, $3, 'Standard', TRUE, NOW())
           ON CONFLICT (los_connection_id, coheus_alias, swap_type) 
           DO UPDATE SET 
             encompass_field_id = EXCLUDED.encompass_field_id,
             is_active = TRUE,
             updated_at = NOW()`,
          [connectionId, suggestion.coheusAlias, suggestion.fieldId]
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

      // Insert new cache entries (batch insert)
      if (stats.length > 0) {
        const chunkSize = 500;
        for (let i = 0; i < stats.length; i += chunkSize) {
          const chunkStats = stats.slice(i, i + chunkSize);
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

      console.log(`[FieldDiscovery] Cached ${stats.length} field analysis results`);
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
