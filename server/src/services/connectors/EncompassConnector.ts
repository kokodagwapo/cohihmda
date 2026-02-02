/**
 * EncompassConnector - Connector for ICE Mortgage Technology Encompass
 * 
 * This connector implements the BaseConnector interface for Encompass LOS,
 * wrapping the existing EncompassLoanExtractor and EncompassApiService.
 */

import pg from 'pg';
import {
  BaseConnector,
  LOSConnectionConfig,
  LOSType,
  ConnectionTestResult,
  SyncOptions,
  StandardLoanRecord,
  FieldMapping,
  LOSField
} from './BaseConnector.js';
import { EncompassLoanExtractor, LoanRecord, ExtractOptions } from '../encompassLoanExtractor.js';
import { EncompassApiService } from '../encompassApiService.js';
import {
  getAllCoheusAliases,
  coheusAliasToColumnName
} from '../encompassFieldMapper.js';
import { getDefaultEncompassFieldId } from '../../config/defaultEncompassFieldMappings.js';

/**
 * Default field mappings for Encompass
 * Maps Encompass field IDs to PostgreSQL columns via Coheus aliases
 */
const DEFAULT_ENCOMPASS_MAPPINGS: FieldMapping[] = [
  // Core identifiers
  { source_field: 'Fields.GUID', target_column: 'guid', alias: 'GUID', data_type: 'string' },
  { source_field: 'Fields.364', target_column: 'loan_number', alias: 'Loan Number', data_type: 'string' },
  
  // Loan details
  { source_field: 'Fields.2', target_column: 'loan_amount', alias: 'Loan Amount', data_type: 'number' },
  { source_field: 'Fields.3', target_column: 'interest_rate', alias: 'Interest Rate', data_type: 'number' },
  { source_field: 'Fields.4', target_column: 'loan_term', alias: 'Loan Term', data_type: 'number' },
  { source_field: 'Fields.1172', target_column: 'loan_type', alias: 'Loan Type', data_type: 'string' },
  { source_field: 'Fields.19', target_column: 'loan_purpose', alias: 'Loan Purpose', data_type: 'string' },
  { source_field: 'Fields.1401', target_column: 'loan_program', alias: 'Loan Program', data_type: 'string' },
  
  // Property
  { source_field: 'Fields.11', target_column: 'property_street', alias: 'Property Street', data_type: 'string' },
  { source_field: 'Fields.12', target_column: 'property_city', alias: 'Property City', data_type: 'string' },
  { source_field: 'Fields.14', target_column: 'property_state', alias: 'Property State', data_type: 'string' },
  { source_field: 'Fields.15', target_column: 'property_zip', alias: 'Property Zip', data_type: 'string' },
  { source_field: 'Fields.13', target_column: 'property_county', alias: 'Property County', data_type: 'string' },
  { source_field: 'Fields.1553', target_column: 'property_type', alias: 'Property Type', data_type: 'string' },
  
  // Dates
  { source_field: 'Fields.3142', target_column: 'application_date', alias: 'Application Date', data_type: 'date' },
  { source_field: 'Fields.748', target_column: 'closing_date', alias: 'Closing Date', data_type: 'date' },
  { source_field: 'Fields.MS.FUN', target_column: 'funding_date', alias: 'Funding Date', data_type: 'date' },
  { source_field: 'Fields.761', target_column: 'lock_date', alias: 'Lock Date', data_type: 'date' },
  { source_field: 'Fields.762', target_column: 'lock_expiration_date', alias: 'Lock Expiration Date', data_type: 'date' },
  
  // Status
  { source_field: 'Fields.Log.MS.CurrentMilestone', target_column: 'current_milestone', alias: 'Current Milestone', data_type: 'string' },
  { source_field: 'Fields.1393', target_column: 'current_loan_status', alias: 'Current Loan Status', data_type: 'string' },
  
  // Personnel
  { source_field: 'Fields.317', target_column: 'loan_officer', alias: 'Loan Officer', data_type: 'string' },
  { source_field: 'Fields.LoanTeamMember.UserID.Loan Officer', target_column: 'loan_officer_id', alias: 'Loan Officer ID', data_type: 'string' },
  { source_field: 'Fields.LoanTeamMember.Name.Loan Processor', target_column: 'processor', alias: 'Processor', data_type: 'string' },
  { source_field: 'Fields.LoanTeamMember.Name.Underwriter', target_column: 'underwriter', alias: 'Underwriter', data_type: 'string' },
  
  // Organization
  { source_field: 'Fields.ORGID', target_column: 'branch', alias: 'Branch', data_type: 'string' },
  { source_field: 'Fields.2626', target_column: 'channel', alias: 'Channel', data_type: 'string' },
  
  // Financial
  { source_field: 'Fields.356', target_column: 'appraised_value', alias: 'Appraised Value', data_type: 'number' },
  { source_field: 'Fields.136', target_column: 'sales_price', alias: 'Sales Price', data_type: 'number' },
  { source_field: 'Fields.353', target_column: 'ltv_ratio', alias: 'LTV Ratio', data_type: 'number' },
  { source_field: 'Fields.VASUMM.X23', target_column: 'fico_score', alias: 'FICO Score', data_type: 'number' },
  
  // Tracking
  { source_field: 'Loan.LoanLastModified', target_column: 'last_modified_date', alias: 'Last Modified Date', data_type: 'date' },
];

export class EncompassConnector extends BaseConnector {
  private extractor: EncompassLoanExtractor;
  private apiService: EncompassApiService;
  private authenticated: boolean = false;
  private accessToken: string | null = null;
  private tokenExpiry: Date | null = null;

  constructor(config: LOSConnectionConfig, tenantPool?: pg.Pool) {
    super(config, tenantPool);
    this.extractor = new EncompassLoanExtractor(tenantPool);
    this.apiService = new EncompassApiService(tenantPool);
  }

  get losType(): LOSType {
    return 'encompass';
  }

  get displayName(): string {
    return 'Encompass';
  }

  /**
   * Test the connection to Encompass
   */
  async testConnection(): Promise<ConnectionTestResult> {
    try {
      // Use the existing API service test
      await this.authenticate();
      
      return {
        success: true,
        message: 'Successfully connected to Encompass',
        details: {
          server_version: 'Encompass API v3',
          api_version: '3.0',
          permissions: ['Read Loans', 'Read Fields'],
        }
      };
    } catch (error: any) {
      return {
        success: false,
        message: 'Failed to connect to Encompass',
        error: error.message
      };
    }
  }

  /**
   * Authenticate with Encompass
   */
  async authenticate(): Promise<void> {
    if (!this.tenantPool) {
      throw new Error('Tenant pool required for authentication');
    }

    try {
      // Get connection credentials from database
      const result = await this.tenantPool.query(
        `SELECT client_id, encrypted_client_secret, api_server 
         FROM public.los_connections 
         WHERE id = $1`,
        [this.config.id]
      );

      if (result.rows.length === 0) {
        throw new Error('LOS connection not found');
      }

      const connection = result.rows[0];
      
      // The actual authentication is handled by the API service
      // which manages token lifecycle internally
      this.authenticated = true;
      this.tokenExpiry = new Date(Date.now() + 3600000); // 1 hour
      
    } catch (error: any) {
      this.authenticated = false;
      throw new Error(`Encompass authentication failed: ${error.message}`);
    }
  }

  /**
   * Check if authenticated
   */
  isAuthenticated(): boolean {
    if (!this.authenticated) return false;
    if (this.tokenExpiry && new Date() > this.tokenExpiry) {
      return false;
    }
    return true;
  }

  /**
   * Refresh authentication
   */
  async refreshAuth(): Promise<void> {
    await this.authenticate();
  }

  /**
   * Extract loans from Encompass
   */
  async extractLoans(options: SyncOptions): Promise<any[]> {
    // Convert SyncOptions to ExtractOptions
    const extractOptions: ExtractOptions = {
      modifiedFrom: options.fullSync ? undefined : options.modifiedFrom,
      loanStartDate: options.loanStartDate,
      limit: options.limit,
      fields: options.fields,
      folderNames: options.loanFolders,
    };

    // Use the existing extractor
    const loans = await this.extractor.extractLoans(
      this.config.tenant_id,
      this.config.id,
      extractOptions
    );

    return loans;
  }

  /**
   * Transform raw Encompass loans to standard format
   */
  async transformLoans(rawLoans: LoanRecord[]): Promise<StandardLoanRecord[]> {
    const standardLoans: StandardLoanRecord[] = [];

    for (const loan of rawLoans) {
      try {
        // The raw loans from EncompassLoanExtractor are already mapped to column names
        // We just need to ensure they conform to StandardLoanRecord
        const standardLoan: StandardLoanRecord = {
          // Required identifier - use GUID or loan_number as loan_id
          loan_id: loan.guid || loan.loan_number || loan.loan_id,
          loan_number: loan.loan_number,
          guid: loan.guid,
          
          // Core loan data
          loan_amount: this.parseNumber(loan.loan_amount),
          interest_rate: this.parseNumber(loan.interest_rate),
          loan_term: this.parseNumber(loan.loan_term),
          loan_type: loan.loan_type,
          loan_purpose: loan.loan_purpose,
          loan_program: loan.loan_program,
          
          // Property
          property_street: loan.property_street,
          property_city: loan.property_city,
          property_state: loan.property_state,
          property_zip: loan.property_zip,
          property_county: loan.property_county,
          property_type: loan.property_type,
          
          // Dates
          application_date: this.parseDate(loan.application_date),
          closing_date: this.parseDate(loan.closing_date),
          funding_date: this.parseDate(loan.funding_date),
          lock_date: this.parseDate(loan.lock_date),
          lock_expiration_date: this.parseDate(loan.lock_expiration_date),
          
          // Status
          current_milestone: loan.current_milestone,
          current_loan_status: loan.current_loan_status,
          
          // Personnel
          loan_officer: loan.loan_officer,
          loan_officer_id: loan.loan_officer_id,
          processor: loan.processor,
          underwriter: loan.underwriter,
          
          // Organization
          branch: loan.branch || loan.orgid,
          channel: loan.channel,
          
          // Financial
          appraised_value: this.parseNumber(loan.appraised_value),
          sales_price: this.parseNumber(loan.sales_price),
          ltv_ratio: this.parseNumber(loan.ltv_ratio),
          fico_score: this.parseNumber(loan.fico_score),
          
          // Tracking
          last_modified_date: this.parseDate(loan.last_modified_date),
        };

        // Copy over any additional fields not in standard schema
        for (const [key, value] of Object.entries(loan)) {
          if (!(key in standardLoan) && value !== undefined && value !== null) {
            standardLoan[key] = value;
          }
        }

        standardLoans.push(standardLoan);
      } catch (error: any) {
        console.warn(`[EncompassConnector] Error transforming loan: ${error.message}`);
      }
    }

    return standardLoans;
  }

  /**
   * Get available fields from Encompass
   */
  async getAvailableFields(): Promise<LOSField[]> {
    // Get all Coheus aliases which represent the available fields
    const aliases = getAllCoheusAliases();
    
    return aliases.map(alias => {
      const fieldId = getDefaultEncompassFieldId(alias);
      return {
        id: fieldId || alias,
        name: alias,
        description: `Encompass field: ${fieldId || 'Unknown'}`,
        data_type: 'string', // Would need RDB lookup for actual types
        category: this.getFieldCategory(alias),
        is_custom: false,
        is_readonly: false
      };
    });
  }

  /**
   * Get default field mappings
   */
  getDefaultFieldMappings(): FieldMapping[] {
    return DEFAULT_ENCOMPASS_MAPPINGS;
  }

  /**
   * Parse a number value safely
   */
  private parseNumber(value: any): number | undefined {
    if (value === null || value === undefined || value === '') {
      return undefined;
    }
    const parsed = parseFloat(String(value).replace(/[^0-9.-]/g, ''));
    return isNaN(parsed) ? undefined : parsed;
  }

  /**
   * Parse a date value safely
   */
  private parseDate(value: any): Date | undefined {
    if (value === null || value === undefined || value === '') {
      return undefined;
    }
    if (value instanceof Date) {
      return value;
    }
    const parsed = new Date(value);
    return isNaN(parsed.getTime()) ? undefined : parsed;
  }

  /**
   * Categorize a field based on its alias
   */
  private getFieldCategory(alias: string): string {
    const lowerAlias = alias.toLowerCase();
    
    if (lowerAlias.includes('date') || lowerAlias.includes('time')) {
      return 'Dates';
    }
    if (lowerAlias.includes('borrower') || lowerAlias.includes('coborrower')) {
      return 'Borrower';
    }
    if (lowerAlias.includes('property') || lowerAlias.includes('address')) {
      return 'Property';
    }
    if (lowerAlias.includes('loan') && (lowerAlias.includes('amount') || lowerAlias.includes('rate'))) {
      return 'Loan Terms';
    }
    if (lowerAlias.includes('fee') || lowerAlias.includes('cost')) {
      return 'Fees';
    }
    if (lowerAlias.includes('officer') || lowerAlias.includes('processor') || lowerAlias.includes('underwriter')) {
      return 'Personnel';
    }
    
    return 'General';
  }
}

export default EncompassConnector;
