/**
 * BaseConnector - Abstract base class for LOS connectors
 * 
 * This provides a unified interface for connecting to different
 * Loan Origination Systems (LOS) like Encompass, MeridianLink, etc.
 * 
 * Part of the Universal Connector architecture.
 */

import pg from 'pg';

/**
 * LOS types supported by the system
 */
export type LOSType = 'encompass' | 'meridianlink' | 'byte' | 'calyx' | 'custom';

/**
 * Connection configuration for a LOS
 */
export interface LOSConnectionConfig {
  id: string;
  tenant_id: string;
  los_type: LOSType;
  name: string;
  
  // Connection details (varies by LOS)
  api_server?: string;
  client_id?: string;
  client_secret?: string;
  username?: string;
  password?: string;
  
  // Instance/environment
  instance_id?: string;
  environment?: 'production' | 'sandbox' | 'test';
  
  // Additional config
  config?: Record<string, any>;
  
  // Status
  is_active: boolean;
  last_sync_at?: Date;
  last_sync_status?: 'success' | 'failed' | 'in_progress';
}

/**
 * Standard loan record format
 * All connectors must transform their data to this format
 */
export interface StandardLoanRecord {
  // Required identifiers
  loan_id: string;
  loan_number?: string;
  guid?: string;
  
  // Core loan data
  loan_amount?: number;
  interest_rate?: number;
  loan_term?: number;
  loan_type?: string;
  loan_purpose?: string;
  loan_program?: string;
  
  // Property info
  property_street?: string;
  property_city?: string;
  property_state?: string;
  property_zip?: string;
  property_county?: string;
  property_type?: string;
  
  // Borrower info
  borrower_first_name?: string;
  borrower_last_name?: string;
  borrower_email?: string;
  
  // Key dates
  application_date?: Date;
  closing_date?: Date;
  funding_date?: Date;
  lock_date?: Date;
  lock_expiration_date?: Date;
  
  // Status
  current_milestone?: string;
  current_loan_status?: string;
  
  // Personnel
  loan_officer?: string;
  loan_officer_id?: string;
  processor?: string;
  underwriter?: string;
  
  // Organization
  branch?: string;
  channel?: string;
  
  // Financial
  appraised_value?: number;
  sales_price?: number;
  ltv_ratio?: number;
  fico_score?: number;
  
  // Tracking
  last_modified_date?: Date;
  
  // Allow additional fields
  [key: string]: any;
}

/**
 * Result of a sync operation
 */
export interface SyncResult {
  success: boolean;
  records_synced: number;
  records_failed: number;
  records_skipped: number;
  errors: string[];
  warnings: string[];
  duration: number;
  sync_type: 'full' | 'incremental';
  started_at: Date;
  completed_at: Date;
}

/**
 * Options for syncing data
 */
export interface SyncOptions {
  // Sync type
  fullSync?: boolean;
  
  // Date filters
  modifiedFrom?: Date;
  modifiedTo?: Date;
  createdFrom?: Date;
  createdTo?: Date;
  
  // Loan filters
  loanStartDate?: Date;
  loanStatus?: string[];
  loanFolders?: string[];
  
  // Pagination
  limit?: number;
  offset?: number;
  
  // Field selection
  fields?: string[];
  
  // LOS-specific options
  losOptions?: Record<string, any>;
}

/**
 * Connection test result
 */
export interface ConnectionTestResult {
  success: boolean;
  message: string;
  details?: {
    server_version?: string;
    api_version?: string;
    permissions?: string[];
    available_fields?: number;
  };
  error?: string;
}

/**
 * Field mapping entry
 */
export interface FieldMapping {
  source_field: string;       // Field ID in the LOS
  target_column: string;      // PostgreSQL column name
  alias: string;              // Coheus alias
  data_type: 'string' | 'number' | 'date' | 'boolean' | 'array' | 'object';
  transform?: string;         // Optional transformation function
  default_value?: any;        // Default value if source is null/missing
}

/**
 * Field definition from LOS
 */
export interface LOSField {
  id: string;
  name: string;
  description?: string;
  data_type: string;
  category?: string;
  is_custom?: boolean;
  is_readonly?: boolean;
}

/**
 * Abstract base class for LOS connectors
 */
export abstract class BaseConnector {
  protected config: LOSConnectionConfig;
  protected tenantPool?: pg.Pool;
  protected isConnected: boolean = false;

  constructor(config: LOSConnectionConfig, tenantPool?: pg.Pool) {
    this.config = config;
    this.tenantPool = tenantPool;
  }

  /**
   * Get the LOS type this connector handles
   */
  abstract get losType(): LOSType;

  /**
   * Get display name for this LOS
   */
  abstract get displayName(): string;

  /**
   * Test the connection to the LOS
   */
  abstract testConnection(): Promise<ConnectionTestResult>;

  /**
   * Authenticate with the LOS API
   */
  abstract authenticate(): Promise<void>;

  /**
   * Check if currently authenticated
   */
  abstract isAuthenticated(): boolean;

  /**
   * Refresh authentication if needed
   */
  abstract refreshAuth(): Promise<void>;

  /**
   * Extract loans from the LOS
   * Returns raw loan data in LOS-native format
   */
  abstract extractLoans(options: SyncOptions): Promise<any[]>;

  /**
   * Transform raw LOS data to standard format
   */
  abstract transformLoans(rawLoans: any[]): Promise<StandardLoanRecord[]>;

  /**
   * Get available fields from the LOS
   */
  abstract getAvailableFields(): Promise<LOSField[]>;

  /**
   * Get the default field mappings for this LOS
   */
  abstract getDefaultFieldMappings(): FieldMapping[];

  /**
   * Sync loans - full ETL pipeline
   */
  async syncLoans(options: SyncOptions = {}): Promise<SyncResult> {
    const startTime = new Date();
    const errors: string[] = [];
    const warnings: string[] = [];
    let recordsSynced = 0;
    let recordsFailed = 0;
    let recordsSkipped = 0;

    try {
      // Ensure authenticated
      if (!this.isAuthenticated()) {
        await this.authenticate();
      }

      // Update sync status
      await this.updateSyncStatus('in_progress');

      // Extract
      console.log(`[${this.displayName}] Starting extraction...`);
      const rawLoans = await this.extractLoans(options);
      console.log(`[${this.displayName}] Extracted ${rawLoans.length} loans`);

      // Transform
      console.log(`[${this.displayName}] Transforming loans...`);
      const standardLoans = await this.transformLoans(rawLoans);
      console.log(`[${this.displayName}] Transformed ${standardLoans.length} loans`);

      // Load
      console.log(`[${this.displayName}] Loading loans to database...`);
      const loadResult = await this.loadLoans(standardLoans);
      recordsSynced = loadResult.success;
      recordsFailed = loadResult.failed;
      recordsSkipped = loadResult.skipped;
      errors.push(...loadResult.errors);
      warnings.push(...loadResult.warnings);

      // Update sync status
      await this.updateSyncStatus('success', recordsSynced);

      console.log(`[${this.displayName}] Sync complete: ${recordsSynced} synced, ${recordsFailed} failed`);

    } catch (error: any) {
      errors.push(error.message);
      await this.updateSyncStatus('failed', 0, error.message);
      throw error;
    }

    const endTime = new Date();
    return {
      success: errors.length === 0,
      records_synced: recordsSynced,
      records_failed: recordsFailed,
      records_skipped: recordsSkipped,
      errors,
      warnings,
      duration: endTime.getTime() - startTime.getTime(),
      sync_type: options.fullSync ? 'full' : 'incremental',
      started_at: startTime,
      completed_at: endTime
    };
  }

  /**
   * Load transformed loans to database
   */
  protected async loadLoans(loans: StandardLoanRecord[]): Promise<{
    success: number;
    failed: number;
    skipped: number;
    errors: string[];
    warnings: string[];
  }> {
    if (!this.tenantPool) {
      throw new Error('Tenant database pool not available');
    }

    let success = 0;
    let failed = 0;
    let skipped = 0;
    const errors: string[] = [];
    const warnings: string[] = [];

    for (const loan of loans) {
      try {
        if (!loan.loan_id) {
          warnings.push(`Skipping loan without loan_id`);
          skipped++;
          continue;
        }

        // Build column names and values from the loan record
        const columns: string[] = [];
        const values: any[] = [];
        const placeholders: string[] = [];

        for (const [key, value] of Object.entries(loan)) {
          if (value !== undefined && value !== null) {
            columns.push(key);
            values.push(value);
            placeholders.push(`$${values.length}`);
          }
        }

        // Upsert the loan
        const query = `
          INSERT INTO public.loans (${columns.join(', ')})
          VALUES (${placeholders.join(', ')})
          ON CONFLICT (loan_id) DO UPDATE SET
            ${columns.map(c => `${c} = EXCLUDED.${c}`).join(', ')},
            updated_at = NOW()
        `;

        await this.tenantPool.query(query, values);
        success++;
      } catch (error: any) {
        failed++;
        errors.push(`Failed to load loan ${loan.loan_id}: ${error.message}`);
      }
    }

    return { success, failed, skipped, errors, warnings };
  }

  /**
   * Update sync status in the database
   */
  protected async updateSyncStatus(
    status: 'in_progress' | 'success' | 'failed',
    recordCount?: number,
    errorMessage?: string
  ): Promise<void> {
    if (!this.tenantPool) return;

    try {
      await this.tenantPool.query(
        `UPDATE public.los_connections 
         SET last_sync_status = $1,
             last_sync_at = CASE WHEN $1 = 'success' THEN NOW() ELSE last_sync_at END,
             last_sync_records = COALESCE($2, last_sync_records),
             last_sync_error = $3,
             updated_at = NOW()
         WHERE id = $4`,
        [status, recordCount, errorMessage, this.config.id]
      );
    } catch (error: any) {
      console.error(`Failed to update sync status: ${error.message}`);
    }
  }

  /**
   * Get tenant-specific field mappings
   */
  protected async getFieldMappings(): Promise<Map<string, string>> {
    if (!this.tenantPool) {
      return new Map();
    }

    try {
      const result = await this.tenantPool.query(
        `SELECT coheus_alias, custom_field_id 
         FROM public.los_field_mappings 
         WHERE los_connection_id = $1`,
        [this.config.id]
      );

      const mappings = new Map<string, string>();
      for (const row of result.rows) {
        if (row.custom_field_id) {
          mappings.set(row.coheus_alias, row.custom_field_id);
        }
      }
      return mappings;
    } catch (error) {
      return new Map();
    }
  }
}

export default BaseConnector;
