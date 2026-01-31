/**
 * Encompass ETL Service
 * Complete ETL pipeline for Encompass data: Extract, Transform, Load
 */

import pg from 'pg';
import { EncompassLoanExtractor, LoanRecord } from '../encompassLoanExtractor.js';
import { coheusAliasToColumnName } from '../encompassFieldMapper.js';

export interface SyncResult {
  success: boolean;
  records_synced: number;
  records_failed: number;
  errors: string[];
  duration: number;
}

export interface SyncOptions {
  fullSync?: boolean;
  modifiedFrom?: Date;
  loanStartDate?: Date; // Date filter for Fields.Log.MS.Date.Started (defaults to 5 years ago)
  loanStartDateField?: string; // Field to use for loan start date filter (defaults to 'Fields.Log.MS.Date.Started')
  limit?: number;
  fields?: string[];
  folderName?: string; // Deprecated: use folderNames instead
  folderNames?: string[]; // Array of folder names to sync
}

export class EncompassEtlService {
  private extractor: EncompassLoanExtractor;
  private tenantPool?: pg.Pool;

  constructor(tenantPool?: pg.Pool) {
    this.tenantPool = tenantPool;
    this.extractor = new EncompassLoanExtractor(tenantPool);
  }

  /**
   * Sync loans from Encompass
   */
  async syncLoans(
    tenantId: string,
    losConnectionId: string,
    options: SyncOptions = {}
  ): Promise<SyncResult> {
    const startTime = Date.now();
    const errors: string[] = [];
    let recordsSynced = 0;
    let recordsFailed = 0;

    if (!this.tenantPool) {
      throw new Error('Tenant database pool not available');
    }

    // Log whether a limit is being used
    if (options.limit) {
      console.log(`[EncompassEtlService] Using provided limit: ${options.limit} records`);
    } else {
      console.log(`[EncompassEtlService] No limit specified - will sync all matching loans`);
    }

    try {
      // Update sync status to 'in_progress' (tenant DB)
      await this.tenantPool.query(
        `UPDATE public.los_connections 
         SET last_sync_status = 'in_progress', 
             last_sync_error = NULL,
             updated_at = NOW()
         WHERE id = $1`,
        [losConnectionId]
      );

      // Extract loans from Encompass
      console.log(`[EncompassEtlService] Starting extraction for connection: ${losConnectionId}`);
      const loans = await this.extract(tenantId, losConnectionId, options);
      console.log(`[EncompassEtlService] Extracted ${loans.length} loans from Encompass API`);

      // Transform loans
      console.log(`[EncompassEtlService] Transforming ${loans.length} loans`);
      const transformedLoans = await this.transform(loans, tenantId);
      console.log(`[EncompassEtlService] Transformed ${transformedLoans.length} loans`);

      // Load loans to database
      console.log(`[EncompassEtlService] Loading ${transformedLoans.length} loans to database`);
      const loadResult = await this.load(tenantId, transformedLoans);
      console.log(`[EncompassEtlService] Load complete: ${loadResult.successCount} succeeded, ${loadResult.failureCount} failed`);
      recordsSynced = loadResult.successCount;
      recordsFailed = loadResult.failureCount;
      errors.push(...loadResult.errors);
      
      // Verify actual database count after load
      try {
        const verifyResult = await this.tenantPool.query(
          'SELECT COUNT(*) as count, COUNT(DISTINCT guid) as unique_count FROM public.loans'
        );
        const dbCount = parseInt(verifyResult.rows[0]?.count || '0', 10);
        const uniqueCount = parseInt(verifyResult.rows[0]?.unique_count || '0', 10);
        console.log(`[EncompassEtlService] Database verification - Total rows: ${dbCount}, Unique GUIDs: ${uniqueCount}`);
        
        if (dbCount !== recordsSynced) {
          console.warn(`[EncompassEtlService] WARNING: Expected ${recordsSynced} loans in DB but found ${dbCount}`);
        }
      } catch (verifyError: any) {
        console.error('[EncompassEtlService] Error verifying database count:', verifyError.message);
      }

      // Update sync status (tenant DB)
      // IMPORTANT: Only update last_synced_at if we actually synced at least one loan
      // This prevents using a recent timestamp when no loans were synced, which would
      // cause the next sync to filter by a very recent date and return 0 loans
      const duration = Date.now() - startTime;
      
      if (recordsSynced > 0) {
        // Query the MAX(last_modified_date) from loans table
        // This is the key value for incremental sync - matches Qlik's RetrieveLastModDate approach
        // Qlik uses the actual Loan.LastModified value, not when the sync was run
        let maxLastModifiedDate: Date | null = null;
        try {
          const maxModifiedResult = await this.tenantPool.query(
            `SELECT MAX(last_modified_date) as max_modified FROM public.loans WHERE last_modified_date IS NOT NULL`
          );
          if (maxModifiedResult.rows[0]?.max_modified) {
            maxLastModifiedDate = new Date(maxModifiedResult.rows[0].max_modified);
            console.log(`[EncompassEtlService] MAX(last_modified_date) from loans: ${maxLastModifiedDate.toISOString()}`);
          }
        } catch (error: any) {
          console.warn(`[EncompassEtlService] Could not query MAX(last_modified_date): ${error.message}`);
        }

        // Update both last_synced_at (when sync ran) and last_loan_modified_at (max loan modified date)
        await this.tenantPool.query(
          `UPDATE public.los_connections 
           SET last_synced_at = NOW(),
               last_loan_modified_at = $1,
               last_sync_status = $2,
               last_sync_error = $3,
               updated_at = NOW()
           WHERE id = $4`,
          [
            maxLastModifiedDate,
            recordsFailed === 0 ? 'success' : 'partial',
            errors.length > 0 ? errors.slice(0, 5).join('; ') : null,
            losConnectionId,
          ]
        );
        console.log(`[EncompassEtlService] Updated last_synced_at and last_loan_modified_at=${maxLastModifiedDate?.toISOString() || 'null'} (synced ${recordsSynced} loans)`);
      } else {
        // Don't update last_synced_at or last_loan_modified_at if no loans were synced
        await this.tenantPool.query(
          `UPDATE public.los_connections 
           SET last_sync_status = $1,
               last_sync_error = $2,
               updated_at = NOW()
           WHERE id = $3`,
          [
            recordsFailed === 0 ? 'success' : 'partial',
            errors.length > 0 ? errors.slice(0, 5).join('; ') : null,
            losConnectionId,
          ]
        );
        console.log(`[EncompassEtlService] Did NOT update last_synced_at or last_loan_modified_at (0 loans synced)`);
      }

      return {
        success: recordsFailed === 0,
        records_synced: recordsSynced,
        records_failed: recordsFailed,
        errors: errors.slice(0, 10), // Return first 10 errors
        duration: Date.now() - startTime,
      };
    } catch (error: any) {
      console.error('[EncompassEtlService] Sync failed:', error);
      
      // Update sync status with error (tenant DB)
      await this.tenantPool.query(
        `UPDATE public.los_connections 
         SET last_sync_status = 'failed',
             last_sync_error = $1,
             updated_at = NOW()
         WHERE id = $2`,
        [error.message, losConnectionId]
      );

      return {
        success: false,
        records_synced: recordsSynced,
        records_failed: recordsFailed,
        errors: [error.message],
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * Extract loans from Encompass
   */
  private async extract(
    tenantId: string,
    losConnectionId: string,
    options: SyncOptions
  ): Promise<LoanRecord[]> {
    return await this.extractor.extractLoans(tenantId, losConnectionId, {
      modifiedFrom: options.modifiedFrom,
      loanStartDate: options.loanStartDate,
      loanStartDateField: options.loanStartDateField,
      limit: options.limit,
      fields: options.fields,
      folderName: options.folderName, // Deprecated: for backward compatibility
      folderNames: options.folderNames, // Use folderNames if provided
    });
  }

  /**
   * Transform loans (map fields, convert types, validate)
   */
  private async transform(
    loans: LoanRecord[],
    tenantId: string
  ): Promise<LoanRecord[]> {
    const transformed: LoanRecord[] = [];

    // Log first loan for debugging
    if (loans.length > 0) {
      console.log('[EncompassEtlService] Sample raw loan object (first loan):');
      console.log(JSON.stringify(loans[0], null, 2));
    }

    for (const loan of loans) {
      try {
        const transformedLoan: LoanRecord = {
          tenant_id: tenantId,
          ...loan,
        };

        // Ensure guid is set (primary identifier)
        if (!transformedLoan.guid) {
          transformedLoan.guid = loan.guid || loan.loanGuid || loan['Fields.GUID'] || loan['GUID'];
          // Normalize GUID - remove curly braces, lowercase
          if (transformedLoan.guid) {
            transformedLoan.guid = transformedLoan.guid.replace(/[{}]/g, '').toLowerCase();
          }
        }
        
        // Ensure loan_number is set (human-readable)
        if (!transformedLoan.loan_number) {
          transformedLoan.loan_number = loan.loan_number || loan['Fields.364'] || loan['Loan.LoanNumber'];
        }
        
        // Set loan_id for backwards compatibility (DEPRECATED)
        if (!transformedLoan.loan_id) {
          transformedLoan.loan_id = transformedLoan.guid || transformedLoan.loan_number;
        }

        // Validate required fields - guid is required
        if (!transformedLoan.guid) {
          throw new Error('Missing guid');
        }

        transformed.push(transformedLoan);
      } catch (error: any) {
        console.error('[EncompassEtlService] Transform error:', error.message);
        // Skip this loan
      }
    }

    return transformed;
  }

  /**
   * Load loans to PostgreSQL
   */
  private async load(
    tenantId: string,
    loans: LoanRecord[]
  ): Promise<{ successCount: number; failureCount: number; errors: string[] }> {
    // Ensure ratio fields are migrated to DECIMAL(12,2) before loading
    // This migration runs on-demand to fix schema issues
    try {
      await this.tenantPool!.query(`
        DO $$
        BEGIN
          -- Migrate ltv_ratio if it exists with precision < 12
          IF EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_schema = 'public' 
            AND table_name = 'loans' 
            AND column_name = 'ltv_ratio'
            AND data_type = 'numeric'
            AND numeric_precision < 12
          ) THEN
            ALTER TABLE public.loans ALTER COLUMN ltv_ratio TYPE DECIMAL(12,2);
          END IF;
          
          -- Migrate cltv if it exists with precision < 12
          IF EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_schema = 'public' 
            AND table_name = 'loans' 
            AND column_name = 'cltv'
            AND data_type = 'numeric'
            AND numeric_precision < 12
          ) THEN
            ALTER TABLE public.loans ALTER COLUMN cltv TYPE DECIMAL(12,2);
          END IF;
          
          -- Migrate hcltv if it exists with precision < 12
          IF EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_schema = 'public' 
            AND table_name = 'loans' 
            AND column_name = 'hcltv'
            AND data_type = 'numeric'
            AND numeric_precision < 12
          ) THEN
            ALTER TABLE public.loans ALTER COLUMN hcltv TYPE DECIMAL(12,2);
          END IF;
          
          -- Migrate be_dti_ratio if it exists with precision < 12
          IF EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_schema = 'public' 
            AND table_name = 'loans' 
            AND column_name = 'be_dti_ratio'
            AND data_type = 'numeric'
            AND numeric_precision < 12
          ) THEN
            ALTER TABLE public.loans ALTER COLUMN be_dti_ratio TYPE DECIMAL(12,2);
          END IF;
          
          -- Migrate cu_risk_score from INTEGER to DECIMAL (CU Risk Score is a decimal 1.0-5.0)
          IF EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_schema = 'public' 
            AND table_name = 'loans' 
            AND column_name = 'cu_risk_score'
            AND data_type = 'integer'
          ) THEN
            ALTER TABLE public.loans ALTER COLUMN cu_risk_score TYPE DECIMAL(5,2);
            RAISE NOTICE 'Migrated cu_risk_score from INTEGER to DECIMAL(5,2)';
          END IF;
          
          -- Migrate interest_rate from DECIMAL(5,3) to DECIMAL(8,4) to handle rates >= 100
          IF EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_schema = 'public' 
            AND table_name = 'loans' 
            AND column_name = 'interest_rate'
            AND data_type = 'numeric'
            AND numeric_precision = 5
            AND numeric_scale = 3
          ) THEN
            ALTER TABLE public.loans ALTER COLUMN interest_rate TYPE DECIMAL(8,4);
            RAISE NOTICE 'Migrated interest_rate from DECIMAL(5,3) to DECIMAL(8,4)';
          END IF;
          
          -- Migrate borr_yrs_on_job from INTEGER to DECIMAL (years can be fractional)
          IF EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_schema = 'public' 
            AND table_name = 'loans' 
            AND column_name = 'borr_yrs_on_job'
            AND data_type = 'integer'
          ) THEN
            ALTER TABLE public.loans ALTER COLUMN borr_yrs_on_job TYPE DECIMAL(5,2);
            RAISE NOTICE 'Migrated borr_yrs_on_job from INTEGER to DECIMAL(5,2)';
          END IF;
          
          -- Migrate borr_yrs_on_job_2nd from INTEGER to DECIMAL
          IF EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_schema = 'public' 
            AND table_name = 'loans' 
            AND column_name = 'borr_yrs_on_job_2nd'
            AND data_type = 'integer'
          ) THEN
            ALTER TABLE public.loans ALTER COLUMN borr_yrs_on_job_2nd TYPE DECIMAL(5,2);
            RAISE NOTICE 'Migrated borr_yrs_on_job_2nd from INTEGER to DECIMAL(5,2)';
          END IF;
          
          -- Migrate co_borr_yrs_on_job from INTEGER to DECIMAL
          IF EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_schema = 'public' 
            AND table_name = 'loans' 
            AND column_name = 'co_borr_yrs_on_job'
            AND data_type = 'integer'
          ) THEN
            ALTER TABLE public.loans ALTER COLUMN co_borr_yrs_on_job TYPE DECIMAL(5,2);
            RAISE NOTICE 'Migrated co_borr_yrs_on_job from INTEGER to DECIMAL(5,2)';
          END IF;
        END $$;
      `);
      console.log('[EncompassEtlService] Ratio fields migration check completed before load');
    } catch (error: any) {
      console.warn('[EncompassEtlService] Ratio fields migration warning (continuing):', error.message);
    }

    let successCount = 0;
    let failureCount = 0;
    const errors: string[] = [];

    // Check for duplicate GUIDs in the batch before inserting
    const guidMap = new Map<string, number>();
    const duplicateGuids: string[] = [];
    for (const loan of loans) {
      const guid = loan.guid;
      if (guid) {
        const count = (guidMap.get(guid) || 0) + 1;
        guidMap.set(guid, count);
        if (count === 2) {
          duplicateGuids.push(guid);
        }
      }
    }
    
    if (duplicateGuids.length > 0) {
      console.warn(`[EncompassEtlService] Found ${duplicateGuids.length} duplicate GUIDs in batch:`, duplicateGuids.slice(0, 10));
      console.warn(`[EncompassEtlService] Total unique GUIDs: ${guidMap.size}, Total loans: ${loans.length}`);
    } else {
      console.log(`[EncompassEtlService] All ${loans.length} loans have unique GUIDs`);
    }

    // Get all available database columns with their data types dynamically
    // This ensures we write to all columns that exist, not just a hardcoded list
    let availableColumns: Array<{ name: string; data_type: string; numeric_precision?: number; numeric_scale?: number }> = [];
    try {
      const columnsResult = await this.tenantPool!.query(`
        SELECT column_name, data_type, numeric_precision, numeric_scale
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'loans'
          AND column_name NOT IN ('id', 'created_at', 'updated_at', 'tenant_id')
        ORDER BY column_name
      `);
      availableColumns = columnsResult.rows.map((r: any) => ({
        name: r.column_name,
        data_type: r.data_type,
        numeric_precision: r.numeric_precision,
        numeric_scale: r.numeric_scale,
      }));
    } catch (error: any) {
      console.warn('[EncompassEtlService] Could not fetch column list, using fallback:', error.message);
      // Fallback to common fields if schema query fails
      availableColumns = [
        { name: 'guid', data_type: 'text' },
        { name: 'loan_number', data_type: 'text' },
        { name: 'loan_id', data_type: 'text' }, // Deprecated, for backwards compatibility
        { name: 'loan_amount', data_type: 'numeric' },
        { name: 'loan_type', data_type: 'text' },
        { name: 'loan_program', data_type: 'text' },
        { name: 'loan_purpose', data_type: 'text' },
        { name: 'application_date', data_type: 'date' },
        { name: 'closing_date', data_type: 'date' },
        { name: 'funding_date', data_type: 'date' },
        { name: 'interest_rate', data_type: 'numeric' },
        { name: 'ltv_ratio', data_type: 'numeric' },
        { name: 'be_dti_ratio', data_type: 'numeric' },
        { name: 'fico_score', data_type: 'integer' },
        { name: 'current_loan_status', data_type: 'text' },
        { name: 'branch', data_type: 'text' },
        { name: 'loan_officer_id', data_type: 'text' },
      ];
    }
    
    // Create a map for quick lookup
    const columnTypeMap = new Map<string, { data_type: string; numeric_precision?: number; numeric_scale?: number }>();
    for (const col of availableColumns) {
      columnTypeMap.set(col.name, { data_type: col.data_type, numeric_precision: col.numeric_precision, numeric_scale: col.numeric_scale });
    }

    let processedCount = 0;
    const totalLoans = loans.length;
    
    for (const loan of loans) {
      // Build column list and values
      // Note: Tenant databases don't have tenant_id column
      const columns: string[] = [];
      const values: any[] = [];
      const placeholders: string[] = [];
      let paramIndex = 1;
      
      try {

        // Add all available database columns that exist in the loan record
        // Convert values to match database column types (safety net if transformation missed something)
        for (const col of availableColumns) {
          const field = col.name;
          if (Object.prototype.hasOwnProperty.call(loan, field) && loan[field] !== null && loan[field] !== undefined) {
            let value: any = loan[field];
            
            // Handle empty strings - convert to null
            if (value === '') {
              value = null;
            }
            
            // Type conversion based on database column type (safety net)
            // This ensures values match what PostgreSQL expects - CRITICAL for data integrity
            const colType = col.data_type;
            
            // Convert string numbers to proper types based on column type
            if (typeof value === 'string') {
              const trimmed = value.trim();
              if (trimmed === '') {
                value = null;
              } else {
                // Check if it's a numeric string (handles "0.0000000000", "123", "-45.67", etc.)
                const numValue = parseFloat(trimmed);
                const isNumericString = !isNaN(numValue) && isFinite(numValue);
                
                if (isNumericString) {
                  if (colType === 'integer' || colType === 'bigint' || colType === 'smallint') {
                    value = Math.round(numValue);
                  } else if (colType === 'numeric' || colType === 'decimal' || colType === 'double precision' || colType === 'real') {
                    value = numValue;
                  }
                } else if (colType === 'boolean') {
                  // Convert string to boolean
                  const lower = trimmed.toLowerCase();
                  value = lower === 'true' || lower === 'yes' || lower === 'y' || lower === '1' || lower === 'x';
                } else if (colType === 'date' || colType === 'timestamp' || colType === 'timestamp with time zone') {
                  // Try to parse date string - handle Encompass format "M/d/yyyy HH:mm:ss AM/PM"
                  let date = new Date(trimmed);
                  if (isNaN(date.getTime())) {
                    // Try parsing Encompass date format: "M/d/yyyy" or "M/d/yyyy HH:mm:ss AM/PM"
                    const match = trimmed.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
                    if (match) {
                      const [, month, day, year] = match;
                      date = new Date(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`);
                    }
                  }
                  if (!isNaN(date.getTime())) {
                    value = colType === 'date' ? date.toISOString().split('T')[0] : date;
                  } else {
                    value = null; // Invalid date
                  }
                }
              }
            } else if (value === null || value === undefined) {
              value = null;
            } else if (typeof value === 'number') {
              // Handle number values going into date columns
              // Small numbers (< 10000) are clearly not Unix timestamps and not dates
              if (colType === 'date' || colType === 'timestamp' || colType === 'timestamp with time zone') {
                // Numbers < 100000 are too small to be valid Unix timestamps (would be before 1970)
                // They're likely days/months counts, not dates
                if (Math.abs(value) < 100000) {
                  value = null; // Set to null - not a valid date
                } else {
                  // Might be a Unix timestamp (seconds or milliseconds)
                  try {
                    const date = value > 10000000000 ? new Date(value) : new Date(value * 1000);
                    if (!isNaN(date.getTime()) && date.getFullYear() >= 1970 && date.getFullYear() <= 2100) {
                      value = colType === 'date' ? date.toISOString().split('T')[0] : date;
                    } else {
                      value = null;
                    }
                  } catch {
                    value = null;
                  }
                }
              } else if (colType === 'boolean') {
                // Convert number to boolean (0 = false, anything else = true)
                value = value !== 0;
              }
              // Numbers going into numeric columns are fine as-is
            }
            
            columns.push(field);
            values.push(value);
            placeholders.push(`$${paramIndex}`);
            paramIndex++;
          }
        }

        // Note: raw_data column has been removed. Unmapped fields are no longer stored.
        // Clients should use the additional_field_definitions system to define which 
        // additional fields they want to track beyond the default Coheus fields.

        // Build UPDATE clause for ON CONFLICT
        // Note: Tenant databases don't have tenant_id column
        // guid is the unique identifier, loan_id is deprecated
        const updateClauses: string[] = [];
        for (let i = 1; i < columns.length; i++) {
          const col = columns[i];
          // Don't update guid (the unique key) or id (the primary key)
          if (col !== 'guid' && col !== 'id') {
            updateClauses.push(`${col} = EXCLUDED.${col}`);
          }
        }
        updateClauses.push('updated_at = NOW()');

        // PRE-INSERTION VALIDATION: Check for type mismatches that would cause PostgreSQL errors
        // This helps identify exactly which field is problematic before the insert fails
        const integerIssues: Array<{ column: string; value: any; dbType: string }> = [];
        for (let i = 0; i < columns.length; i++) {
          const col = columns[i];
          const val = values[i];
          const colType = columnTypeMap.get(col);
          
          if (colType) {
            const dbType = colType.data_type;
            
            // Check INTEGER columns receiving non-integer values
            if ((dbType === 'integer' || dbType === 'bigint' || dbType === 'smallint') && val !== null) {
              if (typeof val === 'string') {
                // String going into INTEGER column - this will fail
                integerIssues.push({ column: col, value: val, dbType });
              } else if (typeof val === 'number' && !Number.isInteger(val)) {
                // Decimal number going into INTEGER column - PostgreSQL might truncate or fail
                integerIssues.push({ column: col, value: val, dbType });
              }
            }
          }
        }
        
        // Log pre-insertion issues for debugging
        if (integerIssues.length > 0 && failureCount < 5) {
          console.error(`[EncompassEtlService] PRE-INSERT WARNING for loan ${loan.guid || loan.loan_number || 'unknown'}:`);
          console.error(`  INTEGER columns with problematic values:`, integerIssues);
        }

        // Use guid as the unique conflict target (loan_id is deprecated)
        const query = `
          INSERT INTO public.loans (${columns.join(', ')})
          VALUES (${placeholders.join(', ')})
          ON CONFLICT (guid) 
          DO UPDATE SET ${updateClauses.join(', ')}
        `;

        await this.tenantPool!.query(query, values);
        successCount++;
        processedCount++;
        
        // Log progress every 1000 loans to avoid spam
        if (processedCount % 1000 === 0) {
          console.log(`[EncompassEtlService] Load progress: ${processedCount}/${totalLoans} loans processed (${successCount} succeeded, ${failureCount} failed)`);
        }
      } catch (error: any) {
        failureCount++;
        processedCount++;
        
        // Enhanced error logging to identify the problematic field
        let errorMsg = `Loan ${loan.guid || loan.loan_number || 'unknown'}: ${error.message}`;
        
        // For type conversion errors, try to identify which field failed
        if (error.message && (error.message.includes('invalid input syntax for type') || error.message.includes('numeric field overflow'))) {
          // Log the error position to help identify the field
          if (error.position) {
            // Try to find which parameter position failed
            const paramMatch = error.message.match(/\$(\d+)/);
            if (paramMatch) {
              const paramIndex = parseInt(paramMatch[1]) - 1;
              if (paramIndex >= 0 && paramIndex < columns.length) {
                const failedColumn = columns[paramIndex];
                const failedValue = values[paramIndex];
                const colType = columnTypeMap.get(failedColumn);
                console.error(`[EncompassEtlService] Field conversion error for column "${failedColumn}":`);
                console.error(`  - Column type: ${colType?.data_type || 'unknown'}`);
                console.error(`  - Value type: ${typeof failedValue}`);
                console.error(`  - Value: ${JSON.stringify(failedValue)}`);
                errorMsg += ` (field: ${failedColumn}, value: ${JSON.stringify(failedValue)}, type: ${colType?.data_type || 'unknown'})`;
              }
            }
          }
          
          // Log first few failing loans with their problematic values
          if (failureCount <= 3) {
            console.error(`[EncompassEtlService] Sample failing loan values for ${loan.guid || loan.loan_number || 'unknown'}:`);
            const problematicFields: Array<{ field: string; value: any; valueType: string; dbType: string }> = [];
            for (let i = 0; i < columns.length; i++) {
              const col = columns[i];
              const val = values[i];
              const colType = columnTypeMap.get(col);
              if (colType) {
                const dbType = colType.data_type;
                // Check for type mismatches
                const isDateColumn = dbType === 'date' || dbType === 'timestamp' || dbType === 'timestamp with time zone';
                const isIntColumn = dbType === 'integer' || dbType === 'bigint' || dbType === 'smallint';
                const isNumericColumn = dbType === 'numeric' || dbType === 'decimal' || dbType === 'double precision' || dbType === 'real';
                
                // Date columns with non-date values
                if (isDateColumn && val !== null && typeof val !== 'object') {
                  if (typeof val === 'number' || (typeof val === 'string' && !/^\d{4}-\d{2}-\d{2}/.test(val))) {
                    problematicFields.push({ field: col, value: val, valueType: typeof val, dbType });
                  }
                }
                // Integer columns with string values
                if (isIntColumn && typeof val === 'string' && val.trim() !== '') {
                  problematicFields.push({ field: col, value: val, valueType: typeof val, dbType });
                }
              }
            }
            if (problematicFields.length > 0) {
              console.error(`[EncompassEtlService] Type mismatches found:`, problematicFields.slice(0, 15));
            }
          }
        }
        
        if (error.message && error.message.includes('numeric field overflow')) {
          // Log full error object to see what properties are available
          console.error('[EncompassEtlService] Full error object:', {
            message: error.message,
            code: error.code,
            detail: error.detail,
            hint: error.hint,
            column: error.column,
            position: error.position,
            internalPosition: error.internalPosition,
            internalQuery: error.internalQuery,
            where: error.where,
            schema: error.schema,
            table: error.table,
            constraint: error.constraint,
            file: error.file,
            line: error.line,
            routine: error.routine
          });
          
          // Try to extract column name from error message or detail
          let fieldName: string | undefined;
          if (error.column) {
            fieldName = error.column;
          } else if (error.detail) {
            const detailMatch = error.detail.match(/column "(\w+)"/i);
            if (detailMatch) {
              fieldName = detailMatch[1];
            }
          } else if (error.message) {
            const msgMatch = error.message.match(/column "(\w+)"|field "(\w+)"/i);
            if (msgMatch) {
              fieldName = msgMatch[1] || msgMatch[2];
            }
          }
          
          if (fieldName) {
            const fieldValue = loan[fieldName];
            errorMsg += ` (Field: ${fieldName}, Value: ${fieldValue})`;
            console.error(`[EncompassEtlService] Numeric overflow detected - Field: ${fieldName}, Value: ${fieldValue}, Type: ${typeof fieldValue}`);
          } else {
            // If we can't identify the field, log all numeric fields from the loan
            const numericFields: Record<string, any> = {};
            for (const [key, value] of Object.entries(loan)) {
              if (typeof value === 'number') {
                numericFields[key] = value;
              }
            }
            console.error(`[EncompassEtlService] Numeric overflow detected but field unknown. All numeric fields for loan ${loan.guid || loan.loan_number || 'unknown'}:`, numericFields);
            errorMsg += ` (Unable to identify field - see logs for all numeric values)`;
          }
        }
        
        errors.push(errorMsg);
        
        // Only log first 10 errors to avoid spam, but track all failures
        if (errors.length <= 10) {
          console.error('[EncompassEtlService] Load error:', errorMsg);
        }
        
        // Log more details for debugging count discrepancies
        if (error.code === '23505') { // Unique violation
          // Don't log duplicates - they're expected with ON CONFLICT DO UPDATE
          // Just count them as successes since they update existing records
        }
        
        // Log progress even on errors
        if (processedCount % 1000 === 0) {
          console.log(`[EncompassEtlService] Load progress: ${processedCount}/${totalLoans} loans processed (${successCount} succeeded, ${failureCount} failed)`);
        }
      }
    }

    console.log(`[EncompassEtlService] Load complete: ${successCount} succeeded, ${failureCount} failed out of ${totalLoans} total loans`);
    return { successCount, failureCount, errors };
  }
}
