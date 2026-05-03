// @ts-nocheck
/**
 * CSV Processing Service
 * Handles CSV file uploads and loan data import
 */

import { pool } from '../config/database.js';
import { readFile, readdir, stat } from 'fs/promises';
import { join } from 'path';
import { parse } from 'csv-parse/sync';
import { runPostSyncHooks } from './hooks/postSyncHookService.js';
import type { SyncTrigger } from '../utils/schedulerPolicy.js';
import {
  attachPersistedComplexityScores,
  warnIfCsvComplexityDiverges,
} from './scoring/persistedLoanComplexity.js';
import { getTenantFieldMappings, applyFieldMapping, suggestFieldMappings } from './fieldMapper.js';

export interface LoanData {
  loan_id: string;
  borrower_name?: string;
  loan_amount?: number;
  loan_type?: string;
  status?: string;
  application_date?: Date;
  closing_date?: Date;
  interest_rate?: number;
  [key: string]: any;
}

export interface CSVProcessingResult {
  success: boolean;
  records_processed: number;
  records_failed: number;
  errors: string[];
  duration: number;
}

export interface ProcessCsvFromPathOptions {
  syncTrigger?: SyncTrigger;
  scheduledInsightsEnabled?: boolean;
}

export interface ProcessCSVFileOptions {
  fieldMapping?: Record<string, string>;
  syncTrigger?: SyncTrigger;
  scheduledInsightsEnabled?: boolean;
}

/**
 * Process CSV file and import loan data
 */
export async function processCSVFile(
  connectionId: string,
  filePath: string,
  fileOptions: ProcessCSVFileOptions = {},
): Promise<CSVProcessingResult> {
  const fieldMapping = fileOptions.fieldMapping;
  const startTime = Date.now();
  const errors: string[] = [];
  let recordsProcessed = 0;
  let recordsFailed = 0;

  try {
    // Get connection details
    const connectionResult = await pool.query(
      'SELECT * FROM public.los_connections WHERE id = $1',
      [connectionId]
    );

    if (connectionResult.rows.length === 0) {
      throw new Error('Connection not found');
    }

    const connection = connectionResult.rows[0];

    // Read CSV file
    const fileContent = await readFile(filePath, 'utf-8');

    // Parse CSV
    const records = parse(fileContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      cast: (value, context) => {
        // Ensure context.column is a string before using string methods
        const columnName = context?.column ? String(context.column).toLowerCase() : '';
        
        // Parse dates: extract YYYY-MM-DD directly to avoid timezone shift from new Date()
        if (columnName && columnName.includes('date')) {
          const trimmed = String(value).trim();
          const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
          if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
          const slashMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
          if (slashMatch) {
            const [, m, d, y] = slashMatch;
            return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
          }
          const date = new Date(trimmed);
          if (!isNaN(date.getTime())) {
            const y = date.getUTCFullYear();
            const m = String(date.getUTCMonth() + 1).padStart(2, "0");
            const d = String(date.getUTCDate()).padStart(2, "0");
            return `${y}-${m}-${d}`;
          }
        }
        // Try to parse numbers
        if (columnName && (
            columnName.includes('amount') || 
            columnName.includes('rate') ||
            columnName.includes('interest'))) {
          const num = parseFloat(value);
          if (!isNaN(num)) {
            return num;
          }
        }
        return value;
      },
    });

    // Get tenant field mappings if available
    const tenantMappings = await getTenantFieldMappings(connection.tenant_id);
    
    // If no explicit field mapping provided, try to detect from CSV headers
    let effectiveMapping = fieldMapping;
    if (!effectiveMapping && records.length > 0) {
      const csvHeaders = Object.keys(records[0]);
      const suggestions = suggestFieldMappings(csvHeaders);
      
      // Convert suggestions to mapping rules format
      effectiveMapping = {};
      for (const [source, target] of Object.entries(suggestions)) {
        effectiveMapping[source] = target;
      }
    }

    // Process each record
    for (const record of records) {
      try {
        // Apply field mapping if provided
        let mappedRecord = record;
        
        if (effectiveMapping) {
          // Convert simple mapping to rule format
          const mappingRules: Record<string, any> = {};
          for (const [source, target] of Object.entries(effectiveMapping)) {
            mappingRules[source] = { source, target };
          }
          mappedRecord = applyFieldMapping(record, mappingRules);
        } else if (tenantMappings) {
          // Use tenant-specific mappings
          mappedRecord = applyFieldMapping(record, tenantMappings.field_mappings);
        }

        // Transform to loan data format
        const loanData = transformCSVRecordToLoan(mappedRecord);

        // Validate required fields
        if (!loanData.loan_id) {
          throw new Error('Missing loan_id');
        }

        // Get connection details for tenant_id
        const connResult = await pool.query(
          'SELECT tenant_id FROM public.los_connections WHERE id = $1',
          [connectionId]
        );
        const tenantId = connResult.rows[0]?.tenant_id;

        if (!tenantId) {
          throw new Error('Connection tenant_id not found');
        }

        // Extract additional fields for Business Overview, Leaderboard, and Loan Funnel
        const getFieldFromRecord = (patterns: string[], defaultValue?: any) => {
          for (const pattern of patterns) {
            if (mappedRecord[pattern] !== undefined && mappedRecord[pattern] !== null && mappedRecord[pattern] !== '') {
              return mappedRecord[pattern];
            }
          }
          return defaultValue;
        };
        
        const parseDateFromRecord = (value: any): Date | undefined => {
          if (!value) return undefined;
          if (value instanceof Date) return value;
          const date = new Date(value);
          return isNaN(date.getTime()) ? undefined : date;
        };
        
        const parseNumberFromRecord = (value: any): number | undefined => {
          if (value === undefined || value === null || value === '') return undefined;
          const num = typeof value === 'number' ? value : parseFloat(String(value));
          return isNaN(num) ? undefined : num;
        };
        
        const respaDate = parseDateFromRecord(getFieldFromRecord(['respa_date', 'respaDate', 'respa_application_date']));
        const creditPullDate = parseDateFromRecord(getFieldFromRecord(['credit_pull_date', 'creditPullDate', 'credit_pull']));
        const ficoScore = parseNumberFromRecord(getFieldFromRecord(['fico_score', 'fico', 'credit_score']));
        const ltv = parseNumberFromRecord(getFieldFromRecord(['ltv', 'loan_to_value', 'loan_to_value_ratio']));
        const loanPurpose = getFieldFromRecord(['loan_purpose', 'purpose', 'loanPurpose']);
        const branch = getFieldFromRecord(['branch', 'branch_name', 'office']);
        const loanOfficerName = getFieldFromRecord(['loan_officer_name', 'loan_officer', 'officer_name', 'lo_name']);
        const falloutReason = getFieldFromRecord(['fallout_reason', 'falloutReason', 'fallout']);
        const cycleTimeDays = parseNumberFromRecord(getFieldFromRecord(['cycle_time_days', 'cycleTime', 'cycle_time']));
        const complexityScore = parseNumberFromRecord(getFieldFromRecord(['complexity_score', 'complexityScore', 'complexity'])); // For TopTiering Ops scoring
        const beDti = parseNumberFromRecord(getFieldFromRecord(['be_dti_ratio', 'dti', 'back_end_dti', 'beDti']));
        const occupancyType = getFieldFromRecord(['occupancy_type', 'occupancy', 'occupancyType']);
        const selfEmployedRaw = getFieldFromRecord(['borr_self_employed', 'self_employed', 'selfEmployed']);
        const nonQmRaw = getFieldFromRecord(['non_qm', 'nonQm', 'nonqm']);
        const parseBoolish = (v: any): boolean | undefined => {
          if (v === undefined || v === null || v === '') return undefined;
          if (typeof v === 'boolean') return v;
          const s = String(v).trim().toLowerCase();
          if (s === 'y' || s === 'yes' || s === 'true' || s === '1' || s === 'x') return true;
          if (s === 'n' || s === 'no' || s === 'false' || s === '0') return false;
          return undefined;
        };

        const rowForComplexity: Record<string, any> = {
          loan_type: loanData.loan_type,
          loan_purpose: loanPurpose ?? loanData.loan_purpose,
          loan_amount: loanData.loan_amount,
          fico_score: ficoScore,
          ltv_ratio: ltv,
          be_dti_ratio: beDti,
          occupancy_type: occupancyType,
          borr_self_employed: parseBoolish(selfEmployedRaw),
          non_qm: parseBoolish(nonQmRaw),
        };
        await attachPersistedComplexityScores(pool, [rowForComplexity]);
        const persistedComplexity = rowForComplexity.complexity_score as number;
        warnIfCsvComplexityDiverges(complexityScore, persistedComplexity, {
          loan_id: loanData.loan_id,
        });
        
        // Calculate cycle time if not provided but dates are available
        const calculatedCycleTime = cycleTimeDays || 
          (loanData.application_date && loanData.closing_date 
            ? Math.round((new Date(loanData.closing_date).getTime() - new Date(loanData.application_date).getTime()) / (1000 * 60 * 60 * 24))
            : null);
        
        // Prepare raw_data with all fields for Business Overview, Leaderboard, Loan Funnel, and Ops
        const rawDataObj: any = {};
        if (typeof mappedRecord === 'object' && mappedRecord !== null) {
          Object.assign(rawDataObj, mappedRecord);
        }
        // Add extracted fields
        if (respaDate) rawDataObj.respa_date = respaDate; // For Ops turn time by stage
        if (ficoScore !== undefined) rawDataObj.fico_score = ficoScore;
        if (ltv !== undefined) rawDataObj.ltv = ltv;
        if (loanOfficerName) rawDataObj.loan_officer_name = loanOfficerName;
        if (falloutReason) rawDataObj.fallout_reason = falloutReason;
        if (complexityScore !== undefined) rawDataObj.complexity_score = complexityScore; // CSV value retained for audit
        rawDataObj.complexity_score_computed = persistedComplexity;
        
        // Store loan data in the database - include all fields in raw_data for comprehensive access
        await pool.query(
          `INSERT INTO public.loans (
            tenant_id, loan_id, borrower_name, loan_amount, loan_type, 
            status, application_date, closing_date, interest_rate,
            loan_purpose, branch, credit_pull_date, cycle_time_days,
            complexity_score, raw_data, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW(), NOW())
          ON CONFLICT (tenant_id, loan_id) 
          DO UPDATE SET
            borrower_name = EXCLUDED.borrower_name,
            loan_amount = EXCLUDED.loan_amount,
            loan_type = EXCLUDED.loan_type,
            status = EXCLUDED.status,
            application_date = EXCLUDED.application_date,
            closing_date = EXCLUDED.closing_date,
            interest_rate = EXCLUDED.interest_rate,
            loan_purpose = EXCLUDED.loan_purpose,
            branch = EXCLUDED.branch,
            credit_pull_date = EXCLUDED.credit_pull_date,
            cycle_time_days = EXCLUDED.cycle_time_days,
            complexity_score = EXCLUDED.complexity_score,
            raw_data = EXCLUDED.raw_data,
            updated_at = NOW()`,
          [
            tenantId,
            loanData.loan_id,
            loanData.borrower_name,
            loanData.loan_amount,
            loanData.loan_type,
            loanData.status,
            loanData.application_date,
            loanData.closing_date,
            loanData.interest_rate,
            loanPurpose,
            branch,
            creditPullDate,
            calculatedCycleTime,
            persistedComplexity,
            JSON.stringify(rawDataObj),
          ]
        );
        console.log(`Processed loan from CSV: ${loanData.loan_id}`);
        recordsProcessed++;
      } catch (e: any) {
        errors.push(`Row ${records.indexOf(record) + 1}: ${e.message}`);
        recordsFailed++;
      }
    }

    // Update connection last upload time
    await pool.query(
      `UPDATE public.los_connections 
       SET csv_last_uploaded_at = NOW(), last_synced_at = NOW(), last_sync_status = 'success', updated_at = NOW()
       WHERE id = $1`,
      [connectionId]
    );

    // Log processing
    await pool.query(
      `INSERT INTO public.los_sync_logs (los_connection_id, tenant_id, sync_type, status, records_synced, records_failed, started_at, completed_at, error_message)
       VALUES ($1, $2, 'csv', 'success', $3, $4, $5, NOW(), $6)`,
      [
        connectionId,
        connection.tenant_id,
        recordsProcessed,
        recordsFailed,
        new Date(startTime),
        errors.length > 0 ? errors.slice(0, 5).join('; ') : null, // Store first 5 errors
      ]
    );

    // Fire post-sync hooks asynchronously
    if (recordsProcessed > 0) {
      runPostSyncHooks({
        tenantId: connection.tenant_id,
        tenantPool: pool,
        connectionId,
        syncType: "csv",
        recordsSynced: recordsProcessed,
        trigger: fileOptions.syncTrigger ?? "unknown",
        scheduledInsightsEnabled: fileOptions.scheduledInsightsEnabled,
      }).catch((err) =>
        console.error("[CSV Sync] Post-sync hooks error:", err.message)
      );
    }

    return {
      success: recordsFailed === 0,
      records_processed: recordsProcessed,
      records_failed: recordsFailed,
      errors: errors.slice(0, 10),
      duration: Date.now() - startTime,
    };
  } catch (error: any) {
    // Log failed processing
    const connectionResult = await pool.query(
      'SELECT tenant_id FROM public.los_connections WHERE id = $1',
      [connectionId]
    );
    const tenantId = connectionResult.rows[0]?.tenant_id;

    await pool.query(
      `INSERT INTO public.los_sync_logs (los_connection_id, tenant_id, sync_type, status, records_synced, records_failed, started_at, completed_at, error_message)
       VALUES ($1, $2, 'csv', 'failed', $3, $4, $5, NOW(), $6)`,
      [connectionId, tenantId, recordsProcessed, recordsFailed, new Date(startTime), error.message]
    );

    return {
      success: false,
      records_processed: recordsProcessed,
      records_failed: recordsFailed,
      errors: [error.message, ...errors],
      duration: Date.now() - startTime,
    };
  }
}

/**
 * Process CSV files from upload path
 */
export async function processCSVFilesFromPath(
  connectionId: string,
  options: ProcessCsvOptions = {},
): Promise<CSVProcessingResult> {
  try {
    const connectionResult = await pool.query(
      'SELECT csv_upload_path, csv_field_mapping FROM public.los_connections WHERE id = $1',
      [connectionId]
    );

    if (connectionResult.rows.length === 0) {
      throw new Error('Connection not found');
    }

    const { csv_upload_path, csv_field_mapping } = connectionResult.rows[0];

    if (!csv_upload_path) {
      throw new Error('CSV upload path not configured');
    }

    // Check if path is a directory or file
    const stats = await stat(csv_upload_path);
    const files: string[] = [];

    if (stats.isDirectory()) {
      // Get all CSV files in directory
      const dirFiles = await readdir(csv_upload_path);
      files.push(...dirFiles.filter(f => f.endsWith('.csv')).map(f => join(csv_upload_path, f)));
    } else if (stats.isFile() && csv_upload_path.endsWith('.csv')) {
      files.push(csv_upload_path);
    } else {
      throw new Error('CSV upload path must be a directory or CSV file');
    }

    if (files.length === 0) {
      return {
        success: true,
        records_processed: 0,
        records_failed: 0,
        errors: ['No CSV files found'],
        duration: 0,
      };
    }

    // Process each file
    let totalProcessed = 0;
    let totalFailed = 0;
    const allErrors: string[] = [];

    for (const file of files) {
      const fieldMapping = csv_field_mapping ? JSON.parse(csv_field_mapping) : undefined;
      const result = await processCSVFile(connectionId, file, {
        fieldMapping,
        syncTrigger: options.syncTrigger,
        scheduledInsightsEnabled: options.scheduledInsightsEnabled,
      });
      
      totalProcessed += result.records_processed;
      totalFailed += result.records_failed;
      allErrors.push(...result.errors);
    }

    return {
      success: totalFailed === 0,
      records_processed: totalProcessed,
      records_failed: totalFailed,
      errors: allErrors.slice(0, 20), // Return first 20 errors
      duration: 0, // Will be calculated per file
    };
  } catch (error: any) {
    return {
      success: false,
      records_processed: 0,
      records_failed: 0,
      errors: [error.message],
      duration: 0,
    };
  }
}

/**
 * Apply field mapping to CSV record
 */
function applyFieldMapping(record: Record<string, any>, mapping: Record<string, string>): Record<string, any> {
  const mapped: Record<string, any> = {};

  for (const [csvColumn, systemField] of Object.entries(mapping)) {
    if (record[csvColumn] !== undefined) {
      mapped[systemField] = record[csvColumn];
    }
  }

  // Also include unmapped fields
  for (const [key, value] of Object.entries(record)) {
    if (!mapping[key]) {
      mapped[key] = value;
    }
  }

  return mapped;
}

/**
 * Transform CSV record to loan data format
 * Uses mapped fields and preserves original source
 */
function transformCSVRecordToLoan(record: Record<string, any>): LoanData {
  // Helper to get field value with multiple fallback patterns
  const getField = (patterns: string[], defaultValue?: any) => {
    for (const pattern of patterns) {
      if (record[pattern] !== undefined && record[pattern] !== null && record[pattern] !== '') {
        return record[pattern];
      }
    }
    return defaultValue;
  };

  // Build borrower name from various sources
  const borrowerName = getField(['borrower_name', 'applicant_name', 'name', 'customer_name']) ||
    (() => {
      const firstName = getField(['first_name', 'borrower_first_name', 'fname']);
      const lastName = getField(['last_name', 'borrower_last_name', 'lname', 'surname']);
      if (firstName || lastName) {
        return `${firstName || ''} ${lastName || ''}`.trim();
      }
      return undefined;
    })();

  // Parse dates
  const parseDate = (value: any): Date | undefined => {
    if (!value) return undefined;
    if (value instanceof Date) return value;
    const date = new Date(value);
    return isNaN(date.getTime()) ? undefined : date;
  };

  // Parse numbers
  const parseNumber = (value: any): number | undefined => {
    if (value === undefined || value === null || value === '') return undefined;
    const num = typeof value === 'number' ? value : parseFloat(String(value));
    return isNaN(num) ? undefined : num;
  };

  return {
    loan_id: getField(['loan_id', 'loan_number', 'id', 'application_id', 'loanId', 'loanNumber']) || 
             `AUTO-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    borrower_name: borrowerName,
    loan_amount: parseNumber(getField(['loan_amount', 'amount', 'requested_amount', 'principal_amount'], '0')),
    loan_type: getField(['loan_type', 'product_type', 'product', 'loan_purpose', 'loanProduct']),
    status: getField(['status', 'loan_status', 'application_status', 'state', 'stage']),
    application_date: parseDate(getField(['application_date', 'app_date', 'submitted_date', 'created_date'])),
    closing_date: parseDate(getField(['closing_date', 'close_date', 'fund_date', 'funded_date'])),
    interest_rate: parseNumber(getField(['interest_rate', 'rate', 'apr', 'note_rate'])),
    raw_data: record, // Store all original data for reference
  };
}
