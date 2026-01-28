/**
 * AutoMapper Service
 * 
 * Automatically maps LOS fields to Cohi's universal schema (Coheus aliases).
 * Part of the Universal Connector architecture.
 * 
 * Features:
 * - Field detection: Identify which LOS fields a client is using
 * - Auto-mapping: Match LOS fields to Coheus aliases using multiple strategies
 * - Confidence scoring: Rate how confident we are in each mapping
 * - Manual override support: Allow users to correct/customize mappings
 */

import pg from 'pg';
import { LOSType, FieldMapping } from '../connectors/BaseConnector.js';

/**
 * Mapping strategy types
 */
export type MappingStrategy = 
  | 'exact_id_match'      // Exact field ID match (highest confidence)
  | 'alias_match'         // Coheus alias name match
  | 'name_similarity'     // Field name similarity matching
  | 'semantic_match'      // AI/semantic similarity (future)
  | 'manual';             // User-defined mapping

/**
 * Auto-mapping result for a single field
 */
export interface AutoMappingResult {
  source_field_id: string;
  source_field_name: string;
  source_field_type?: string;
  
  // Suggested mapping
  suggested_alias: string | null;
  suggested_column: string | null;
  
  // Confidence and reasoning
  confidence: number;  // 0.0 - 1.0
  strategy: MappingStrategy;
  reasoning: string;
  
  // Alternative suggestions
  alternatives: Array<{
    alias: string;
    column: string;
    confidence: number;
    strategy: MappingStrategy;
  }>;
  
  // Status
  is_mapped: boolean;
  is_custom: boolean;
}

/**
 * Bulk auto-mapping result
 */
export interface BulkMappingResult {
  total_fields: number;
  mapped_fields: number;
  unmapped_fields: number;
  high_confidence: number;  // confidence >= 0.8
  medium_confidence: number; // confidence 0.5-0.8
  low_confidence: number;    // confidence < 0.5
  mappings: AutoMappingResult[];
}

/**
 * Field dictionary entry for a LOS
 */
export interface LOSFieldDictionary {
  field_id: string;
  field_name: string;
  description?: string;
  data_type: string;
  category?: string;
  canonical_id?: string;  // Standard MISMO/ULDD ID if applicable
  common_aliases?: string[];
}

/**
 * Coheus alias dictionary entry
 */
export interface CoheusAliasEntry {
  alias: string;
  column_name: string;
  description?: string;
  data_type: string;
  category?: string;
  default_field_ids: Record<LOSType, string>; // Default field ID per LOS
  keywords: string[];  // Keywords for matching
}

/**
 * AutoMapper class
 */
export class AutoMapper {
  private tenantPool?: pg.Pool;
  
  // Cached dictionaries
  private coheusAliases: Map<string, CoheusAliasEntry> = new Map();
  private losDictionaries: Map<LOSType, Map<string, LOSFieldDictionary>> = new Map();
  
  constructor(tenantPool?: pg.Pool) {
    this.tenantPool = tenantPool;
    this.initializeCoheusAliases();
  }

  /**
   * Initialize the Coheus alias dictionary
   * This defines our universal schema
   */
  private initializeCoheusAliases(): void {
    const aliases: CoheusAliasEntry[] = [
      // Core Identifiers
      {
        alias: 'GUID',
        column_name: 'guid',
        description: 'Unique loan identifier',
        data_type: 'string',
        category: 'Identifiers',
        default_field_ids: { encompass: 'Fields.GUID', meridianlink: 'LoanId', byte: 'GUID', calyx: 'LoanGUID', custom: '' },
        keywords: ['guid', 'uuid', 'unique', 'identifier', 'loan_id']
      },
      {
        alias: 'Loan Number',
        column_name: 'loan_number',
        description: 'Loan number/identifier',
        data_type: 'string',
        category: 'Identifiers',
        default_field_ids: { encompass: 'Fields.364', meridianlink: 'LoanNumber', byte: 'LoanNum', calyx: 'LoanNumber', custom: '' },
        keywords: ['loan', 'number', 'loan_number', 'loannumber', 'file_number']
      },
      
      // Loan Terms
      {
        alias: 'Loan Amount',
        column_name: 'loan_amount',
        description: 'Total loan amount',
        data_type: 'number',
        category: 'Loan Terms',
        default_field_ids: { encompass: 'Fields.2', meridianlink: 'LoanAmount', byte: 'LoanAmt', calyx: 'LoanAmount', custom: '' },
        keywords: ['loan', 'amount', 'principal', 'loan_amount', 'loanamount', 'base_amount']
      },
      {
        alias: 'Interest Rate',
        column_name: 'interest_rate',
        description: 'Note interest rate',
        data_type: 'number',
        category: 'Loan Terms',
        default_field_ids: { encompass: 'Fields.3', meridianlink: 'InterestRate', byte: 'IntRate', calyx: 'NoteRate', custom: '' },
        keywords: ['interest', 'rate', 'note_rate', 'interest_rate', 'noterate', 'int_rate']
      },
      {
        alias: 'Loan Term',
        column_name: 'loan_term',
        description: 'Loan term in months',
        data_type: 'number',
        category: 'Loan Terms',
        default_field_ids: { encompass: 'Fields.4', meridianlink: 'LoanTerm', byte: 'Term', calyx: 'AmortTerm', custom: '' },
        keywords: ['term', 'months', 'loan_term', 'amortization', 'period']
      },
      {
        alias: 'Loan Type',
        column_name: 'loan_type',
        description: 'Loan type (Conventional, FHA, VA, etc.)',
        data_type: 'string',
        category: 'Loan Terms',
        default_field_ids: { encompass: 'Fields.1172', meridianlink: 'LoanType', byte: 'LoanType', calyx: 'MortgageType', custom: '' },
        keywords: ['loan', 'type', 'mortgage_type', 'loantype', 'product_type']
      },
      {
        alias: 'Loan Purpose',
        column_name: 'loan_purpose',
        description: 'Loan purpose (Purchase, Refinance, etc.)',
        data_type: 'string',
        category: 'Loan Terms',
        default_field_ids: { encompass: 'Fields.19', meridianlink: 'LoanPurpose', byte: 'Purpose', calyx: 'Purpose', custom: '' },
        keywords: ['purpose', 'loan_purpose', 'transaction_type']
      },
      {
        alias: 'Loan Program',
        column_name: 'loan_program',
        description: 'Loan program name',
        data_type: 'string',
        category: 'Loan Terms',
        default_field_ids: { encompass: 'Fields.1401', meridianlink: 'Program', byte: 'Program', calyx: 'Program', custom: '' },
        keywords: ['program', 'loan_program', 'product', 'program_name']
      },
      
      // Property Information
      {
        alias: 'Property Street',
        column_name: 'property_street',
        description: 'Property street address',
        data_type: 'string',
        category: 'Property',
        default_field_ids: { encompass: 'Fields.11', meridianlink: 'PropertyAddress', byte: 'PropAddr', calyx: 'SubjPropAddr', custom: '' },
        keywords: ['property', 'street', 'address', 'property_address', 'subject_property']
      },
      {
        alias: 'Property City',
        column_name: 'property_city',
        description: 'Property city',
        data_type: 'string',
        category: 'Property',
        default_field_ids: { encompass: 'Fields.12', meridianlink: 'PropertyCity', byte: 'PropCity', calyx: 'SubjPropCity', custom: '' },
        keywords: ['property', 'city', 'property_city']
      },
      {
        alias: 'Property State',
        column_name: 'property_state',
        description: 'Property state',
        data_type: 'string',
        category: 'Property',
        default_field_ids: { encompass: 'Fields.14', meridianlink: 'PropertyState', byte: 'PropState', calyx: 'SubjPropState', custom: '' },
        keywords: ['property', 'state', 'property_state']
      },
      {
        alias: 'Property Zip',
        column_name: 'property_zip',
        description: 'Property ZIP code',
        data_type: 'string',
        category: 'Property',
        default_field_ids: { encompass: 'Fields.15', meridianlink: 'PropertyZip', byte: 'PropZip', calyx: 'SubjPropZip', custom: '' },
        keywords: ['property', 'zip', 'zipcode', 'postal', 'property_zip']
      },
      
      // Key Dates
      {
        alias: 'Application Date',
        column_name: 'application_date',
        description: 'Loan application date',
        data_type: 'date',
        category: 'Dates',
        default_field_ids: { encompass: 'Fields.3142', meridianlink: 'ApplicationDate', byte: 'AppDate', calyx: 'AppDate', custom: '' },
        keywords: ['application', 'date', 'application_date', 'app_date', 'started']
      },
      {
        alias: 'Closing Date',
        column_name: 'closing_date',
        description: 'Loan closing date',
        data_type: 'date',
        category: 'Dates',
        default_field_ids: { encompass: 'Fields.748', meridianlink: 'ClosingDate', byte: 'CloseDate', calyx: 'CloseDate', custom: '' },
        keywords: ['closing', 'close', 'date', 'closing_date', 'settlement']
      },
      {
        alias: 'Funding Date',
        column_name: 'funding_date',
        description: 'Loan funding date',
        data_type: 'date',
        category: 'Dates',
        default_field_ids: { encompass: 'Fields.MS.FUN', meridianlink: 'FundingDate', byte: 'FundDate', calyx: 'FundDate', custom: '' },
        keywords: ['funding', 'funded', 'fund_date', 'funding_date', 'disbursement']
      },
      
      // Status
      {
        alias: 'Current Milestone',
        column_name: 'current_milestone',
        description: 'Current loan milestone',
        data_type: 'string',
        category: 'Status',
        default_field_ids: { encompass: 'Fields.Log.MS.CurrentMilestone', meridianlink: 'Milestone', byte: 'Status', calyx: 'Status', custom: '' },
        keywords: ['milestone', 'current', 'status', 'stage', 'current_milestone']
      },
      {
        alias: 'Current Loan Status',
        column_name: 'current_loan_status',
        description: 'Loan status',
        data_type: 'string',
        category: 'Status',
        default_field_ids: { encompass: 'Fields.1393', meridianlink: 'LoanStatus', byte: 'LoanStatus', calyx: 'LoanStatus', custom: '' },
        keywords: ['loan', 'status', 'loan_status', 'current_status']
      },
      
      // Personnel
      {
        alias: 'Loan Officer',
        column_name: 'loan_officer',
        description: 'Loan officer name',
        data_type: 'string',
        category: 'Personnel',
        default_field_ids: { encompass: 'Fields.317', meridianlink: 'LoanOfficer', byte: 'LO_Name', calyx: 'LO', custom: '' },
        keywords: ['loan', 'officer', 'lo', 'originator', 'loan_officer']
      },
      {
        alias: 'Processor',
        column_name: 'processor',
        description: 'Loan processor name',
        data_type: 'string',
        category: 'Personnel',
        default_field_ids: { encompass: 'Fields.LoanTeamMember.Name.Loan Processor', meridianlink: 'Processor', byte: 'Processor', calyx: 'Processor', custom: '' },
        keywords: ['processor', 'loan_processor', 'processing']
      },
      {
        alias: 'Underwriter',
        column_name: 'underwriter',
        description: 'Underwriter name',
        data_type: 'string',
        category: 'Personnel',
        default_field_ids: { encompass: 'Fields.LoanTeamMember.Name.Underwriter', meridianlink: 'Underwriter', byte: 'UW', calyx: 'Underwriter', custom: '' },
        keywords: ['underwriter', 'uw', 'underwriting']
      },
      
      // Organization
      {
        alias: 'Branch',
        column_name: 'branch',
        description: 'Branch/office code',
        data_type: 'string',
        category: 'Organization',
        default_field_ids: { encompass: 'Fields.ORGID', meridianlink: 'Branch', byte: 'Branch', calyx: 'Branch', custom: '' },
        keywords: ['branch', 'office', 'org', 'orgid', 'branch_code']
      },
      {
        alias: 'Channel',
        column_name: 'channel',
        description: 'Loan channel (Retail, Wholesale, etc.)',
        data_type: 'string',
        category: 'Organization',
        default_field_ids: { encompass: 'Fields.2626', meridianlink: 'Channel', byte: 'Channel', calyx: 'Channel', custom: '' },
        keywords: ['channel', 'loan_channel', 'origination_channel']
      },
      
      // Financial
      {
        alias: 'Appraised Value',
        column_name: 'appraised_value',
        description: 'Appraised property value',
        data_type: 'number',
        category: 'Financial',
        default_field_ids: { encompass: 'Fields.356', meridianlink: 'AppraisedValue', byte: 'ApprValue', calyx: 'AppraisedValue', custom: '' },
        keywords: ['appraised', 'value', 'appraisal', 'appraised_value', 'appr_value']
      },
      {
        alias: 'Sales Price',
        column_name: 'sales_price',
        description: 'Property sales price',
        data_type: 'number',
        category: 'Financial',
        default_field_ids: { encompass: 'Fields.136', meridianlink: 'SalesPrice', byte: 'SalePrice', calyx: 'SalesPrice', custom: '' },
        keywords: ['sales', 'price', 'purchase', 'sales_price', 'purchase_price']
      },
      {
        alias: 'LTV Ratio',
        column_name: 'ltv_ratio',
        description: 'Loan-to-value ratio',
        data_type: 'number',
        category: 'Financial',
        default_field_ids: { encompass: 'Fields.353', meridianlink: 'LTV', byte: 'LTV', calyx: 'LTV', custom: '' },
        keywords: ['ltv', 'loan_to_value', 'ltv_ratio']
      },
      {
        alias: 'FICO Score',
        column_name: 'fico_score',
        description: 'Borrower credit score',
        data_type: 'number',
        category: 'Financial',
        default_field_ids: { encompass: 'Fields.VASUMM.X23', meridianlink: 'CreditScore', byte: 'FICO', calyx: 'CreditScore', custom: '' },
        keywords: ['fico', 'credit', 'score', 'credit_score', 'fico_score']
      },
    ];

    // Build the map
    for (const entry of aliases) {
      this.coheusAliases.set(entry.alias.toLowerCase(), entry);
      // Also index by column name
      this.coheusAliases.set(entry.column_name.toLowerCase(), entry);
    }
  }

  /**
   * Auto-map a list of LOS fields to Coheus aliases
   */
  async autoMapFields(
    losType: LOSType,
    sourceFields: Array<{ id: string; name: string; type?: string }>
  ): Promise<BulkMappingResult> {
    const mappings: AutoMappingResult[] = [];
    let highConfidence = 0;
    let mediumConfidence = 0;
    let lowConfidence = 0;
    let mapped = 0;

    for (const field of sourceFields) {
      const result = await this.mapField(losType, field.id, field.name, field.type);
      mappings.push(result);

      if (result.is_mapped) {
        mapped++;
        if (result.confidence >= 0.8) highConfidence++;
        else if (result.confidence >= 0.5) mediumConfidence++;
        else lowConfidence++;
      }
    }

    return {
      total_fields: sourceFields.length,
      mapped_fields: mapped,
      unmapped_fields: sourceFields.length - mapped,
      high_confidence: highConfidence,
      medium_confidence: mediumConfidence,
      low_confidence: lowConfidence,
      mappings
    };
  }

  /**
   * Map a single LOS field to Coheus alias
   */
  async mapField(
    losType: LOSType,
    fieldId: string,
    fieldName: string,
    fieldType?: string
  ): Promise<AutoMappingResult> {
    const alternatives: AutoMappingResult['alternatives'] = [];
    
    // Strategy 1: Exact field ID match
    for (const [key, entry] of this.coheusAliases) {
      if (entry.default_field_ids[losType] === fieldId) {
        return {
          source_field_id: fieldId,
          source_field_name: fieldName,
          source_field_type: fieldType,
          suggested_alias: entry.alias,
          suggested_column: entry.column_name,
          confidence: 1.0,
          strategy: 'exact_id_match',
          reasoning: `Exact match: ${fieldId} is the default Encompass field for "${entry.alias}"`,
          alternatives: [],
          is_mapped: true,
          is_custom: false
        };
      }
    }

    // Strategy 2: Alias name match
    const normalizedName = this.normalizeFieldName(fieldName);
    const aliasEntry = this.coheusAliases.get(normalizedName);
    if (aliasEntry) {
      return {
        source_field_id: fieldId,
        source_field_name: fieldName,
        source_field_type: fieldType,
        suggested_alias: aliasEntry.alias,
        suggested_column: aliasEntry.column_name,
        confidence: 0.9,
        strategy: 'alias_match',
        reasoning: `Field name "${fieldName}" matches Coheus alias "${aliasEntry.alias}"`,
        alternatives: [],
        is_mapped: true,
        is_custom: false
      };
    }

    // Strategy 3: Keyword similarity matching
    const keywordMatches = this.findKeywordMatches(fieldName);
    if (keywordMatches.length > 0) {
      const best = keywordMatches[0];
      
      // Add alternatives
      for (let i = 1; i < Math.min(keywordMatches.length, 4); i++) {
        alternatives.push({
          alias: keywordMatches[i].alias,
          column: keywordMatches[i].column_name,
          confidence: keywordMatches[i].score,
          strategy: 'name_similarity'
        });
      }

      if (best.score >= 0.5) {
        return {
          source_field_id: fieldId,
          source_field_name: fieldName,
          source_field_type: fieldType,
          suggested_alias: best.alias,
          suggested_column: best.column_name,
          confidence: best.score,
          strategy: 'name_similarity',
          reasoning: `Field name "${fieldName}" has ${Math.round(best.score * 100)}% similarity to "${best.alias}"`,
          alternatives,
          is_mapped: true,
          is_custom: false
        };
      }
    }

    // No confident mapping found
    return {
      source_field_id: fieldId,
      source_field_name: fieldName,
      source_field_type: fieldType,
      suggested_alias: null,
      suggested_column: null,
      confidence: 0,
      strategy: 'name_similarity',
      reasoning: 'No confident mapping found. Manual mapping recommended.',
      alternatives: keywordMatches.slice(0, 3).map(m => ({
        alias: m.alias,
        column: m.column_name,
        confidence: m.score,
        strategy: 'name_similarity' as MappingStrategy
      })),
      is_mapped: false,
      is_custom: false
    };
  }

  /**
   * Normalize a field name for matching
   */
  private normalizeFieldName(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '');
  }

  /**
   * Find keyword matches for a field name
   */
  private findKeywordMatches(fieldName: string): Array<{
    alias: string;
    column_name: string;
    score: number;
  }> {
    const normalized = this.normalizeFieldName(fieldName);
    const words = normalized.split('_').filter(w => w.length > 1);
    const matches: Array<{ alias: string; column_name: string; score: number }> = [];

    for (const [key, entry] of this.coheusAliases) {
      if (entry.alias === entry.column_name) continue; // Skip duplicate entries
      
      let score = 0;
      const keywordMatches = words.filter(w => 
        entry.keywords.some(kw => kw.includes(w) || w.includes(kw))
      );
      
      // Score based on keyword overlap
      if (keywordMatches.length > 0) {
        score = keywordMatches.length / Math.max(words.length, entry.keywords.length);
        
        // Boost if all words match
        if (keywordMatches.length === words.length) {
          score = Math.min(score + 0.2, 0.95);
        }
      }

      if (score > 0) {
        matches.push({
          alias: entry.alias,
          column_name: entry.column_name,
          score
        });
      }
    }

    // Sort by score descending
    return matches.sort((a, b) => b.score - a.score);
  }

  /**
   * Get all Coheus aliases
   */
  getCoheusAliases(): CoheusAliasEntry[] {
    const seen = new Set<string>();
    const aliases: CoheusAliasEntry[] = [];
    
    for (const entry of this.coheusAliases.values()) {
      if (!seen.has(entry.alias)) {
        seen.add(entry.alias);
        aliases.push(entry);
      }
    }
    
    return aliases;
  }

  /**
   * Get default field ID for a Coheus alias and LOS type
   */
  getDefaultFieldId(alias: string, losType: LOSType): string | null {
    const entry = this.coheusAliases.get(alias.toLowerCase());
    return entry?.default_field_ids[losType] || null;
  }

  /**
   * Save custom field mapping to database
   */
  async saveCustomMapping(
    tenantId: string,
    losConnectionId: string,
    coheusAlias: string,
    customFieldId: string
  ): Promise<void> {
    if (!this.tenantPool) {
      throw new Error('Tenant pool required to save mapping');
    }

    await this.tenantPool.query(
      `INSERT INTO public.los_field_mappings (los_connection_id, coheus_alias, custom_field_id, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (los_connection_id, coheus_alias) 
       DO UPDATE SET custom_field_id = $3, updated_at = NOW()`,
      [losConnectionId, coheusAlias, customFieldId]
    );
  }

  /**
   * Get custom field mappings for a connection
   */
  async getCustomMappings(losConnectionId: string): Promise<Map<string, string>> {
    if (!this.tenantPool) {
      return new Map();
    }

    const result = await this.tenantPool.query(
      `SELECT coheus_alias, custom_field_id FROM public.los_field_mappings 
       WHERE los_connection_id = $1 AND custom_field_id IS NOT NULL`,
      [losConnectionId]
    );

    const mappings = new Map<string, string>();
    for (const row of result.rows) {
      mappings.set(row.coheus_alias, row.custom_field_id);
    }
    return mappings;
  }

  /**
   * Reset a custom mapping to default
   */
  async resetToDefault(
    losConnectionId: string,
    coheusAlias: string
  ): Promise<void> {
    if (!this.tenantPool) {
      throw new Error('Tenant pool required to reset mapping');
    }

    await this.tenantPool.query(
      `DELETE FROM public.los_field_mappings 
       WHERE los_connection_id = $1 AND coheus_alias = $2`,
      [losConnectionId, coheusAlias]
    );
  }
}

export default AutoMapper;
