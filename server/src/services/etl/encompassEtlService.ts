/**
 * Encompass ETL Service
 * Complete ETL pipeline for Encompass data: Extract, Transform, Load
 */

import pg from "pg";
import {
  EncompassLoanExtractor,
  LoanRecord,
} from "../encompassLoanExtractor.js";
import { coheusAliasToColumnName } from "../encompassFieldMapper.js";
import { FieldBackfillService } from "./fieldBackfillService.js";
import { FolderReconciliationService } from "./folderReconciliationService.js";
import { runPostSyncHooks } from "../hooks/postSyncHookService.js";
import type { SyncTrigger } from "../../utils/schedulerPolicy.js";
import { attachPersistedComplexityScores } from "../scoring/persistedLoanComplexity.js";

export interface SyncResult {
  success: boolean;
  records_synced: number;
  records_failed: number;
  loans_added: number;
  loans_updated: number;
  loans_unchanged: number;
  loans_deleted: number;
  errors: string[];
  duration: number;
  /** Hint when a new field is mostly NULL after incremental sync; run full sync to backfill */
  backfill_hint?: string;
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
  // Chunked processing options for memory efficiency with large datasets
  chunkSize?: number; // Process loans in chunks of this size (default: 5000)
  useChunkedProcessing?: boolean; // Enable chunked processing (default: true for datasets > 10000 loans)
  /** Post-sync hooks use this for business-day insight policy (default unknown). */
  syncTrigger?: SyncTrigger;
}

const LOAD_BATCH_SIZE = 500;

export class EncompassEtlService {
  private extractor: EncompassLoanExtractor;
  private tenantPool?: pg.Pool;

  constructor(tenantPool?: pg.Pool) {
    this.tenantPool = tenantPool;
    this.extractor = new EncompassLoanExtractor(tenantPool);
  }

  /**
   * Convert a single value for a database column (type coercion for INSERT).
   * Used for both batch and single-row load paths.
   */
  private convertValueForColumn(
    value: any,
    col: { name: string; data_type: string; numeric_precision?: number; numeric_scale?: number },
    _columnTypeMap: Map<string, { data_type: string; numeric_precision?: number; numeric_scale?: number }>
  ): any {
    if (value === null || value === undefined) return null;
    if (value === "") return null;
    const colType = col.data_type;

    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed === "") return null;
      const numValue = parseFloat(trimmed);
      const isNumericString = !isNaN(numValue) && isFinite(numValue);
      if (isNumericString) {
        if (colType === "integer" || colType === "bigint" || colType === "smallint") return Math.round(numValue);
        if (colType === "numeric" || colType === "decimal" || colType === "double precision" || colType === "real") return numValue;
      }
      // Non-parseable string targeting a numeric/integer column (e.g. Encompass "Y"/"N" in a numeric field)
      if (!isNumericString && (colType === "integer" || colType === "bigint" || colType === "smallint" ||
          colType === "numeric" || colType === "decimal" || colType === "double precision" || colType === "real")) {
        return null;
      }
      if (colType === "boolean") {
        const lower = trimmed.toLowerCase();
        return lower === "true" || lower === "yes" || lower === "y" || lower === "1" || lower === "x";
      }
      if (colType === "date" || colType === "timestamp" || colType === "timestamp with time zone") {
        // Extract date components directly to avoid timezone-shift bugs.
        // NEVER use `new Date(str).toISOString()` — local→UTC conversion shifts dates ±1 day.
        const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (isoMatch) {
          const dateOnly = `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
          if (colType === "date") return dateOnly;
          return new Date(dateOnly + "T00:00:00Z"); // explicit UTC for timestamp cols
        }
        const slashMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
        if (slashMatch) {
          const [, month, day, year] = slashMatch;
          const dateOnly = `${year}-${(month as string).padStart(2, "0")}-${(day as string).padStart(2, "0")}`;
          if (colType === "date") return dateOnly;
          return new Date(dateOnly + "T00:00:00Z");
        }
        // Last resort: parse with UTC components
        const parsed = new Date(trimmed);
        if (!isNaN(parsed.getTime())) {
          if (colType === "date") {
            const y = parsed.getUTCFullYear();
            const m = String(parsed.getUTCMonth() + 1).padStart(2, "0");
            const d = String(parsed.getUTCDate()).padStart(2, "0");
            return `${y}-${m}-${d}`;
          }
          return parsed;
        }
        return null;
      }
      return value;
    }

    if (typeof value === "number") {
      if (colType === "date" || colType === "timestamp" || colType === "timestamp with time zone") {
        if (Math.abs(value) < 100000) return null;
        try {
          const date = value > 10000000000 ? new Date(value) : new Date(value * 1000);
          if (!isNaN(date.getTime()) && date.getFullYear() >= 1970 && date.getFullYear() <= 2100) {
            if (colType === "date") {
              const y = date.getUTCFullYear();
              const m = String(date.getUTCMonth() + 1).padStart(2, "0");
              const d = String(date.getUTCDate()).padStart(2, "0");
              return `${y}-${m}-${d}`;
            }
            return date;
          }
        } catch {
          return null;
        }
        return null;
      }
      if (colType === "boolean") return value !== 0;
    }

    // Date objects (e.g. from EncompassConnector.parseDate) → extract date-only safely
    if (value instanceof Date && !isNaN(value.getTime())) {
      if (colType === "date") {
        // Use local components: the Date was created via new Date(localString),
        // so local components represent the business-intended calendar date.
        const y = value.getFullYear();
        const m = String(value.getMonth() + 1).padStart(2, "0");
        const d = String(value.getDate()).padStart(2, "0");
        return `${y}-${m}-${d}`;
      }
    }

    return value;
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
    let loansAdded = 0;
    let loansUpdated = 0;
    let loansUnchanged = 0;
    let loansDeleted = 0;

    if (!this.tenantPool) {
      throw new Error("Tenant database pool not available");
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

      // =========================================================================
      // CHUNKED ETL: Process loans in chunks to avoid memory exhaustion
      // Each chunk is extracted -> transformed -> loaded -> freed from memory
      // This allows processing 100K+ loans without running out of memory
      // =========================================================================
      const chunkSize = options.chunkSize || 5000;
      const useChunkedProcessing = options.useChunkedProcessing !== false;

      if (useChunkedProcessing) {
        // CHUNKED PROCESSING: Transform and load each chunk as it's extracted
        let chunkCount = 0;

        await this.extractor.extractLoans(tenantId, losConnectionId, {
          modifiedFrom: options.modifiedFrom,
          loanStartDate: options.loanStartDate,
          loanStartDateField: options.loanStartDateField,
          limit: options.limit,
          fields: options.fields,
          folderName: options.folderName,
          folderNames: options.folderNames,
          chunkSize: chunkSize,
          // This callback is called for each chunk of loans
          onChunkProcessed: async (
            chunk: LoanRecord[],
            chunkIndex: number,
            totalProcessed: number
          ) => {
            chunkCount++;

            const transformedChunk = await this.transform(chunk, tenantId);
            const loadResult = await this.load(tenantId, transformedChunk);

            recordsSynced += loadResult.successCount;
            recordsFailed += loadResult.failureCount;
            loansAdded += loadResult.insertCount;
            loansUpdated += loadResult.updateCount;
            loansUnchanged += loadResult.unchangedCount;
            errors.push(...loadResult.errors);

            if (loadResult.failureCount > 0) {
              console.warn(
                `[Sync] Chunk ${chunkIndex + 1}: ${loadResult.failureCount} failed out of ${chunk.length}`
              );
            }
          },
        });

      } else {
        const loans = await this.extract(tenantId, losConnectionId, options);

        const transformedLoans = await this.transform(loans, tenantId);
        const loadResult = await this.load(tenantId, transformedLoans);
        recordsSynced = loadResult.successCount;
        recordsFailed = loadResult.failureCount;
        loansAdded = loadResult.insertCount;
        loansUpdated = loadResult.updateCount;
        loansUnchanged = loadResult.unchangedCount;
        errors.push(...loadResult.errors);
      }

      // =========================================================================
      // FOLDER RECONCILIATION: Remove loans that have moved out of synced folders
      // Runs after the main ETL load so any newly-synced loans are already in the DB.
      // =========================================================================
      const syncedFolders = options.folderNames?.length
        ? options.folderNames
        : options.folderName
          ? [options.folderName]
          : [];

      if (syncedFolders.length === 0) {
        console.warn(
          `[Sync] No folder configuration for connection ${losConnectionId} — folder reconciliation skipped. ` +
          `Loans that moved to non-configured folders will NOT be removed. ` +
          `Set encompass_selected_folders on the los_connections row to enable reconciliation.`
        );
      }

      if (syncedFolders.length > 0) {
        try {
          const reconciler = new FolderReconciliationService(this.tenantPool);
          const reconcileResult = await reconciler.reconcileFolders(
            tenantId,
            losConnectionId,
            syncedFolders,
            options.loanStartDate,
          );
          loansDeleted = reconcileResult.loansDeleted;
          if (reconcileResult.loansDeleted > 0) {
            console.log(
              `[Sync] Reconciliation: ${reconcileResult.loansDeleted} loan(s) deleted (moved out of synced folders), ` +
              `${reconcileResult.loansChecked} total checked`,
            );
          }
        } catch (reconcileErr: any) {
          console.warn(
            `[Sync] Folder reconciliation failed (main sync still succeeded): ${reconcileErr.message}`,
          );
        }
      }

      // Verify actual database count after load
      // Update sync status (tenant DB)
      const duration = Date.now() - startTime;

      if (recordsSynced > 0) {
        // Query the MAX(last_modified_date) for incremental sync bookmark.
        // This value becomes last_loan_modified_at on the connection, which the
        // next sync uses as its modifiedFrom filter to run incrementally.
        let maxLastModifiedDate: Date | null = null;
        try {
          const maxModifiedResult = await this.tenantPool.query(
            `SELECT MAX(last_modified_date) as max_modified FROM public.loans WHERE last_modified_date IS NOT NULL`
          );
          if (maxModifiedResult.rows[0]?.max_modified) {
            maxLastModifiedDate = new Date(
              maxModifiedResult.rows[0].max_modified
            );
          }
        } catch (error: any) {
          console.warn(
            `[Sync] Could not query MAX(last_modified_date): ${error.message}`
          );
        }

        // INCREMENTAL SYNC BOOKMARK FIX:
        // If last_modified_date is NULL for all loans (e.g. Loan.LastModified not returned
        // by the Encompass API), fall back to the sync start time. This ensures the next
        // sync will use a modifiedFrom of ~now and run incrementally rather than as a full
        // sync again. The start time is slightly conservative (catches any loans modified
        // concurrently during this sync).
        if (!maxLastModifiedDate) {
          maxLastModifiedDate = new Date(startTime);
          console.warn(
            `[Sync] MAX(last_modified_date) is NULL for connection ${losConnectionId} — ` +
            `last_modified_date may not be populated in the loans table. ` +
            `Using sync start time (${maxLastModifiedDate.toISOString()}) as the incremental bookmark. ` +
            `Verify that Loan.LastModified is being returned by the Encompass Pipeline API.`
          );
        } else {
          console.log(
            `[Sync] Incremental bookmark for connection ${losConnectionId}: last_loan_modified_at → ${maxLastModifiedDate.toISOString()}`
          );
        }

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
            recordsFailed === 0 ? "success" : "partial",
            errors.length > 0 ? errors.slice(0, 5).join("; ") : null,
            losConnectionId,
          ]
        );
      } else {
        await this.tenantPool.query(
          `UPDATE public.los_connections 
           SET last_sync_status = $1,
               last_sync_error = $2,
               updated_at = NOW()
           WHERE id = $3`,
          [
            recordsFailed === 0 ? "success" : "partial",
            errors.length > 0 ? errors.slice(0, 5).join("; ") : null,
            losConnectionId,
          ]
        );
      }

      // Write sync history audit row
      let totalLoansAfter = 0;
      try {
        const countResult = await this.tenantPool.query(
          "SELECT COUNT(*) as count FROM public.loans"
        );
        totalLoansAfter = parseInt(countResult.rows[0]?.count || "0", 10);
      } catch { /* table may not exist */ }

      const syncStatus = recordsFailed === 0 ? "success" : "partial";
      const syncType = options.modifiedFrom ? "incremental" : "full";

      let syncHistoryId: number | undefined;
      try {
        const histResult = await this.tenantPool.query(
          `INSERT INTO public.los_sync_history
           (los_connection_id, sync_type, status, loans_added, loans_updated, loans_unchanged, loans_failed,
            total_loans_after, modified_from, duration_ms, error_message, started_at, completed_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())
           RETURNING id`,
          [
            losConnectionId,
            syncType,
            syncStatus,
            loansAdded,
            loansUpdated,
            loansUnchanged,
            recordsFailed,
            totalLoansAfter,
            options.modifiedFrom || null,
            duration,
            errors.length > 0 ? errors.slice(0, 5).join("; ") : null,
            new Date(startTime),
          ]
        );
        syncHistoryId = histResult.rows[0]?.id ? Number(histResult.rows[0].id) : undefined;
      } catch (histErr: any) {
        console.warn(`[Sync] Could not write sync history: ${histErr.message}`);
      }

      try {
        const backfillService = new FieldBackfillService(this.tenantPool);
        const pendingBackfills = await backfillService.getPendingBackfillCount(losConnectionId);
        if (pendingBackfills > 0) {
          console.log(
            `[Sync] Running post-sync backfill for ${pendingBackfills} swapped field mapping(s)`
          );
          const backfillResult = await backfillService.backfillSwappedFields(
            tenantId,
            losConnectionId,
            {
              loanStartDate: options.loanStartDate,
              loanStartDateField: options.loanStartDateField,
              folderName: options.folderName,
              folderNames: options.folderNames,
            }
          );
          console.log(
            `[Sync] Post-sync backfill complete: ${backfillResult.loansUpdated} loans updated across ${backfillResult.fieldsBackfilled} field(s)`
          );
        }
      } catch (backfillError: any) {
        console.warn(
          `[Sync] Post-sync backfill failed (main sync still succeeded): ${backfillError.message}`
        );
      }

      console.log(
        `[Sync] Complete: +${loansAdded} new, ~${loansUpdated} updated, =${loansUnchanged} unchanged, -${loansDeleted} deleted, ${recordsFailed} failed in ${Math.round(duration / 1000)}s (${totalLoansAfter} total)`
      );

      // Fire post-sync hooks asynchronously (don't block return)
      if (recordsFailed === 0 || loansAdded + loansUpdated > 0) {
        runPostSyncHooks({
          tenantId,
          tenantPool: this.tenantPool!,
          connectionId: losConnectionId,
          syncType: "encompass",
          recordsSynced,
          loansAdded,
          loansUpdated,
          syncHistoryId,
          trigger: options.syncTrigger ?? "unknown",
        }).catch((err) =>
          console.error("[Sync] Post-sync hooks error:", err.message)
        );
      }

      // After incremental sync: detect when a new field (e.g. is_archived) is mostly NULL so user knows to run full sync to backfill
      let backfillHint: string | undefined;
      if (options.modifiedFrom && totalLoansAfter > 0) {
        try {
          const nullCheck = await this.tenantPool.query(
            `SELECT COUNT(*) FILTER (WHERE is_archived IS NULL) AS null_count, COUNT(*) AS total FROM public.loans`
          );
          const row = nullCheck.rows[0];
          const nullCount = parseInt(row?.null_count || "0", 10);
          const total = parseInt(row?.total || "0", 10);
          if (total > 0 && nullCount / total > 0.5) {
            backfillHint = `is_archived is NULL for ${nullCount.toLocaleString()} of ${total.toLocaleString()} loans. Run a full sync (fullSync=true) to backfill this field.`;
            console.warn(`[Sync] ${backfillHint}`);
          }
        } catch (colErr: any) {
          if (colErr?.code !== "42703") {
            console.warn("[Sync] Could not check is_archived for backfill hint:", colErr?.message);
          }
        }
      }

      return {
        success: recordsFailed === 0,
        records_synced: recordsSynced,
        records_failed: recordsFailed,
        loans_added: loansAdded,
        loans_updated: loansUpdated,
        loans_unchanged: loansUnchanged,
        loans_deleted: loansDeleted,
        errors: errors.slice(0, 10),
        duration: Date.now() - startTime,
        backfill_hint: backfillHint,
      };
    } catch (error: any) {
      console.error("[Sync] Failed:", error.message);

      // Write failed sync history
      try {
        await this.tenantPool.query(
          `INSERT INTO public.los_sync_history
           (los_connection_id, sync_type, status, loans_failed, duration_ms, error_message, started_at, completed_at)
           VALUES ($1, $2, 'failed', $3, $4, $5, $6, NOW())`,
          [
            losConnectionId,
            options.modifiedFrom ? "incremental" : "full",
            recordsFailed,
            Date.now() - startTime,
            error.message,
            new Date(startTime),
          ]
        );
      } catch { /* best effort */ }

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
        loans_added: loansAdded,
        loans_updated: loansUpdated,
        loans_unchanged: loansUnchanged,
        loans_deleted: loansDeleted,
        errors: [error.message],
        duration: Date.now() - startTime,
        backfill_hint: undefined,
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

    

    for (const loan of loans) {
      try {
        const transformedLoan: LoanRecord = {
          tenant_id: tenantId,
          ...loan,
        };

        // Ensure guid is set (primary identifier)
        if (!transformedLoan.guid) {
          transformedLoan.guid =
            loan.guid || loan.loanGuid || loan["Fields.GUID"] || loan["GUID"];
          // Normalize GUID - remove curly braces, lowercase
          if (transformedLoan.guid) {
            transformedLoan.guid = transformedLoan.guid
              .replace(/[{}]/g, "")
              .toLowerCase();
          }
        }

        // Ensure loan_number is set (human-readable)
        if (!transformedLoan.loan_number) {
          transformedLoan.loan_number =
            loan.loan_number || loan["Fields.364"] || loan["Loan.LoanNumber"];
        }

        // Set loan_id for backwards compatibility (DEPRECATED)
        if (!transformedLoan.loan_id) {
          transformedLoan.loan_id =
            transformedLoan.guid || transformedLoan.loan_number;
        }

        // Validate required fields - guid is required
        if (!transformedLoan.guid) {
          throw new Error("Missing guid");
        }

        transformed.push(transformedLoan);
      } catch (error: any) {
        console.error("[EncompassEtlService] Transform error:", error.message);
        // Skip this loan
      }
    }

    if (transformed.length > 0 && this.tenantPool) {
      await attachPersistedComplexityScores(this.tenantPool, transformed as Record<string, any>[]);
    }

    return transformed;
  }

  /**
   * Load loans to PostgreSQL
   */
  private async load(
    tenantId: string,
    loans: LoanRecord[]
  ): Promise<{ successCount: number; failureCount: number; insertCount: number; updateCount: number; unchangedCount: number; errors: string[] }> {
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
      
    } catch (error: any) {
      console.warn(
        "[EncompassEtlService] Ratio fields migration warning (continuing):",
        error.message
      );
    }

    let successCount = 0;
    let failureCount = 0;
    let insertCount = 0;
    let updateCount = 0;
    let unchangedCount = 0;
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
      console.warn(
        `[Sync] ${duplicateGuids.length} duplicate GUIDs in batch (${guidMap.size} unique / ${loans.length} total)`
      );
    }

    // Get all available database columns with their data types dynamically
    // This ensures we write to all columns that exist, not just a hardcoded list
    let availableColumns: Array<{
      name: string;
      data_type: string;
      numeric_precision?: number;
      numeric_scale?: number;
    }> = [];
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
      console.warn(
        "[EncompassEtlService] Could not fetch column list, using fallback:",
        error.message
      );
      // Fallback to common fields if schema query fails
      availableColumns = [
        { name: "guid", data_type: "text" },
        { name: "loan_number", data_type: "text" },
        { name: "loan_id", data_type: "text" }, // Deprecated, for backwards compatibility
        { name: "loan_amount", data_type: "numeric" },
        { name: "loan_type", data_type: "text" },
        { name: "loan_program", data_type: "text" },
        { name: "loan_purpose", data_type: "text" },
        { name: "application_date", data_type: "date" },
        { name: "closing_date", data_type: "date" },
        { name: "funding_date", data_type: "date" },
        { name: "interest_rate", data_type: "numeric" },
        { name: "ltv_ratio", data_type: "numeric" },
        { name: "be_dti_ratio", data_type: "numeric" },
        { name: "fico_score", data_type: "integer" },
        { name: "current_loan_status", data_type: "text" },
        { name: "branch", data_type: "text" },
        { name: "loan_officer_id", data_type: "text" },
      ];
    }

    // Create a map for quick lookup
    const columnTypeMap = new Map<
      string,
      { data_type: string; numeric_precision?: number; numeric_scale?: number }
    >();
    for (const col of availableColumns) {
      columnTypeMap.set(col.name, {
        data_type: col.data_type,
        numeric_precision: col.numeric_precision,
        numeric_scale: col.numeric_scale,
      });
    }

    let processedCount = 0;
    const totalLoans = loans.length;
    const columnNames = availableColumns.map((c) => c.name);

    // Columns included in the SET clause (all non-key columns)
    const setColumns = columnNames.filter((n) => n !== "guid" && n !== "id");
    const updateClauses = setColumns
      .map((n) => `${n} = EXCLUDED.${n}`)
      .concat(["updated_at = NOW()"]);

    // IS DISTINCT FROM WHERE clause: only update the row when at least one
    // value actually changed. Skips unchanged rows entirely, preventing false
    // "updated" counts and unnecessary row version churn.
    // Exclude USER-DEFINED types (e.g. pgvector embedding) which may not support
    // row-level comparison.
    const comparableTypes = new Set([
      "text", "character varying", "character", "uuid",
      "integer", "bigint", "smallint", "numeric", "decimal",
      "double precision", "real", "boolean",
      "date", "timestamp without time zone", "timestamp with time zone",
      "jsonb", "json",
    ]);
    const compareColumns = setColumns.filter((n) => {
      const col = columnTypeMap.get(n);
      return col && comparableTypes.has(col.data_type);
    });
    // Always apply UPDATE when complexity_score is still NULL so incremental rows
    // get a persisted score even if all other comparable columns match the prior row.
    const hasComplexityScoreCol = setColumns.includes("complexity_score");
    const tupleChangedClause =
      compareColumns.length > 0
        ? `(${compareColumns.map((n) => `loans.${n}`).join(", ")}) IS DISTINCT FROM (${compareColumns.map((n) => `EXCLUDED.${n}`).join(", ")})`
        : "FALSE";
    const whereClause = hasComplexityScoreCol
      ? `WHERE (${tupleChangedClause}) OR (loans.complexity_score IS NULL)`
      : compareColumns.length > 0
        ? `WHERE (${tupleChangedClause})`
        : "";

    const runOneRow = async (loan: Record<string, any>) => {
      const values = availableColumns.map((col) =>
        this.convertValueForColumn(loan[col.name], col, columnTypeMap)
      );
      const placeholders = columnNames.map((_, i) => `$${i + 1}`).join(", ");
      const query = `
          INSERT INTO public.loans (${columnNames.join(", ")})
          VALUES (${placeholders})
          ON CONFLICT (guid)
          DO UPDATE SET ${updateClauses.join(", ")}
          ${whereClause}
          RETURNING (xmax = 0) AS is_insert
        `;
      const result = await this.tenantPool!.query(query, values);
      if (result.rows.length === 0) return "unchanged";
      return result.rows[0]?.is_insert === true ? "insert" : "update";
    };

    const useBulkLoad = true;
    if (useBulkLoad) {
      for (let start = 0; start < loans.length; start += LOAD_BATCH_SIZE) {
        const batch = loans.slice(start, start + LOAD_BATCH_SIZE);
        try {
          const flatValues: any[] = [];
          for (const loan of batch) {
            const row = availableColumns.map((col) =>
              this.convertValueForColumn(loan[col.name], col, columnTypeMap)
            );
            flatValues.push(...row);
          }
          const numCols = columnNames.length;
          const placeholders = batch
            .map((_, i) =>
              "(" +
              Array.from({ length: numCols }, (_, j) => `$${i * numCols + j + 1}`).join(",") +
              ")"
            )
            .join(", ");
          const query = `
          INSERT INTO public.loans (${columnNames.join(", ")})
          VALUES ${placeholders}
          ON CONFLICT (guid)
          DO UPDATE SET ${updateClauses.join(", ")}
          ${whereClause}
          RETURNING (xmax = 0) AS is_insert
        `;
          const result = await this.tenantPool!.query(query, flatValues);
          const rows = result.rows as { is_insert: boolean }[];
          const batchInserted = rows.filter((r) => r.is_insert).length;
          const batchUpdated = rows.filter((r) => !r.is_insert).length;
          const batchUnchanged = batch.length - batchInserted - batchUpdated;
          successCount += batch.length;
          insertCount += batchInserted;
          updateCount += batchUpdated;
          unchangedCount += batchUnchanged;
          processedCount += batch.length;
        } catch (batchError: any) {
          for (const loan of batch) {
            try {
              const outcome = await runOneRow(loan);
              successCount++;
              if (outcome === "insert") insertCount++;
              else if (outcome === "update") updateCount++;
              else unchangedCount++;
            } catch (err: any) {
              failureCount++;
              errors.push(
                `Loan ${loan.guid || loan.loan_number || "unknown"}: ${err?.message || err}`
              );
              if (errors.length <= 10) console.error("[EncompassEtlService] Load error:", err?.message);
            }
            processedCount++;
          }
        }
        if (processedCount % 1000 === 0 && processedCount > 0) {
          console.log(
            `[EncompassEtlService] Load progress: ${processedCount}/${totalLoans} (${successCount} succeeded, ${failureCount} failed)`
          );
        }
      }
    } else {
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
          if (
            Object.prototype.hasOwnProperty.call(loan, field) &&
            loan[field] !== null &&
            loan[field] !== undefined
          ) {
            let value: any = loan[field];

            // Handle empty strings - convert to null
            if (value === "") {
              value = null;
            }

            // Type conversion based on database column type (safety net)
            // This ensures values match what PostgreSQL expects - CRITICAL for data integrity
            const colType = col.data_type;

            // Convert string values to proper types based on column type.
            // IMPORTANT: use separate `if` blocks (not else-if) so that date
            // strings like "2026-03-10" (which parseFloat reads as 2026) still
            // reach the date handler. Matches convertValueForColumn logic.
            if (typeof value === "string") {
              const trimmed = value.trim();
              if (trimmed === "") {
                value = null;
              } else {
                const numValue = parseFloat(trimmed);
                const isNumericString = !isNaN(numValue) && isFinite(numValue);

                if (isNumericString) {
                  if (
                    colType === "integer" ||
                    colType === "bigint" ||
                    colType === "smallint"
                  ) {
                    value = Math.round(numValue);
                  } else if (
                    colType === "numeric" ||
                    colType === "decimal" ||
                    colType === "double precision" ||
                    colType === "real"
                  ) {
                    value = numValue;
                  }
                }
                if (!isNumericString && (
                  colType === "integer" || colType === "bigint" || colType === "smallint" ||
                  colType === "numeric" || colType === "decimal" ||
                  colType === "double precision" || colType === "real"
                )) {
                  value = null;
                }
                if (colType === "boolean") {
                  const lower = trimmed.toLowerCase();
                  value =
                    lower === "true" ||
                    lower === "yes" ||
                    lower === "y" ||
                    lower === "1" ||
                    lower === "x";
                }
                if (
                  colType === "date" ||
                  colType === "timestamp" ||
                  colType === "timestamp with time zone"
                ) {
                  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
                  if (isoMatch) {
                    const dateOnly = `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
                    value = colType === "date" ? dateOnly : new Date(dateOnly + "T00:00:00Z");
                  } else {
                    const slashMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
                    if (slashMatch) {
                      const [, month, day, year] = slashMatch;
                      const dateOnly = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
                      value = colType === "date" ? dateOnly : new Date(dateOnly + "T00:00:00Z");
                    } else {
                      const parsed = new Date(trimmed);
                      if (!isNaN(parsed.getTime())) {
                        if (colType === "date") {
                          const y = parsed.getUTCFullYear();
                          const m = String(parsed.getUTCMonth() + 1).padStart(2, "0");
                          const d = String(parsed.getUTCDate()).padStart(2, "0");
                          value = `${y}-${m}-${d}`;
                        } else {
                          value = parsed;
                        }
                      } else {
                        value = null;
                      }
                    }
                  }
                }
              }
            } else if (value === null || value === undefined) {
              value = null;
            } else if (typeof value === "number") {
              if (
                colType === "date" ||
                colType === "timestamp" ||
                colType === "timestamp with time zone"
              ) {
                if (Math.abs(value) < 100000) {
                  value = null;
                } else {
                  try {
                    const date =
                      value > 10000000000
                        ? new Date(value)
                        : new Date(value * 1000);
                    if (
                      !isNaN(date.getTime()) &&
                      date.getFullYear() >= 1970 &&
                      date.getFullYear() <= 2100
                    ) {
                      if (colType === "date") {
                        const y = date.getUTCFullYear();
                        const m = String(date.getUTCMonth() + 1).padStart(2, "0");
                        const d = String(date.getUTCDate()).padStart(2, "0");
                        value = `${y}-${m}-${d}`;
                      } else {
                        value = date;
                      }
                    } else {
                      value = null;
                    }
                  } catch {
                    value = null;
                  }
                }
              } else if (colType === "boolean") {
                // Convert number to boolean (0 = false, anything else = true)
                value = value !== 0;
              }
              // Numbers going into numeric columns are fine as-is
            } else if (value instanceof Date && !isNaN(value.getTime())) {
              // Date objects (from connector parseDate): extract date-only safely
              if (colType === "date") {
                const y = value.getFullYear();
                const m = String(value.getMonth() + 1).padStart(2, "0");
                const d = String(value.getDate()).padStart(2, "0");
                value = `${y}-${m}-${d}`;
              }
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
          if (col !== "guid" && col !== "id") {
            updateClauses.push(`${col} = EXCLUDED.${col}`);
          }
        }
        updateClauses.push("updated_at = NOW()");

        // PRE-INSERTION VALIDATION: Check for type mismatches that would cause PostgreSQL errors
        // This helps identify exactly which field is problematic before the insert fails
        const integerIssues: Array<{
          column: string;
          value: any;
          dbType: string;
        }> = [];
        for (let i = 0; i < columns.length; i++) {
          const col = columns[i];
          const val = values[i];
          const colType = columnTypeMap.get(col);

          if (colType) {
            const dbType = colType.data_type;

            // Check INTEGER columns receiving non-integer values
            if (
              (dbType === "integer" ||
                dbType === "bigint" ||
                dbType === "smallint") &&
              val !== null
            ) {
              if (typeof val === "string") {
                // String going into INTEGER column - this will fail
                integerIssues.push({ column: col, value: val, dbType });
              } else if (typeof val === "number" && !Number.isInteger(val)) {
                // Decimal number going into INTEGER column - PostgreSQL might truncate or fail
                integerIssues.push({ column: col, value: val, dbType });
              }
            }
          }
        }

        // Log pre-insertion issues for debugging
        if (integerIssues.length > 0 && failureCount < 5) {
          console.error(
            `[EncompassEtlService] PRE-INSERT WARNING for loan ${
              loan.guid || loan.loan_number || "unknown"
            }:`
          );
          console.error(
            `  INTEGER columns with problematic values:`,
            integerIssues
          );
        }

        // Use guid as the unique conflict target (loan_id is deprecated)
        // RETURNING xmax = 0 tells us if this was an INSERT (true) or UPDATE (false)
        // The WHERE clause skips unchanged rows so they return no RETURNING row.
        const query = `
          INSERT INTO public.loans (${columns.join(", ")})
          VALUES (${placeholders.join(", ")})
          ON CONFLICT (guid) 
          DO UPDATE SET ${updateClauses.join(", ")}
          ${whereClause}
          RETURNING (xmax = 0) AS is_insert
        `;

        const result = await this.tenantPool!.query(query, values);
        successCount++;
        if (result.rows.length === 0) {
          unchangedCount++;
        } else if (result.rows[0]?.is_insert) {
          insertCount++;
        } else {
          updateCount++;
        }
        processedCount++;

        
      } catch (error: any) {
        failureCount++;
        processedCount++;

        // Enhanced error logging to identify the problematic field
        let errorMsg = `Loan ${loan.guid || loan.loan_number || "unknown"}: ${
          error.message
        }`;

        // For type conversion errors, try to identify which field failed
        if (
          error.message &&
          (error.message.includes("invalid input syntax for type") ||
            error.message.includes("numeric field overflow"))
        ) {
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
                console.error(
                  `[EncompassEtlService] Field conversion error for column "${failedColumn}":`
                );
                console.error(
                  `  - Column type: ${colType?.data_type || "unknown"}`
                );
                console.error(`  - Value type: ${typeof failedValue}`);
                console.error(`  - Value: ${JSON.stringify(failedValue)}`);
                errorMsg += ` (field: ${failedColumn}, value: ${JSON.stringify(
                  failedValue
                )}, type: ${colType?.data_type || "unknown"})`;
              }
            }
          }

          // Log first few failing loans with their problematic values
          if (failureCount <= 3) {
            console.error(
              `[EncompassEtlService] Sample failing loan values for ${
                loan.guid || loan.loan_number || "unknown"
              }:`
            );
            const problematicFields: Array<{
              field: string;
              value: any;
              valueType: string;
              dbType: string;
            }> = [];
            for (let i = 0; i < columns.length; i++) {
              const col = columns[i];
              const val = values[i];
              const colType = columnTypeMap.get(col);
              if (colType) {
                const dbType = colType.data_type;
                // Check for type mismatches
                const isDateColumn =
                  dbType === "date" ||
                  dbType === "timestamp" ||
                  dbType === "timestamp with time zone";
                const isIntColumn =
                  dbType === "integer" ||
                  dbType === "bigint" ||
                  dbType === "smallint";
                const isNumericColumn =
                  dbType === "numeric" ||
                  dbType === "decimal" ||
                  dbType === "double precision" ||
                  dbType === "real";

                // Date columns with non-date values
                if (isDateColumn && val !== null && typeof val !== "object") {
                  if (
                    typeof val === "number" ||
                    (typeof val === "string" && !/^\d{4}-\d{2}-\d{2}/.test(val))
                  ) {
                    problematicFields.push({
                      field: col,
                      value: val,
                      valueType: typeof val,
                      dbType,
                    });
                  }
                }
                // Integer columns with string values
                if (
                  isIntColumn &&
                  typeof val === "string" &&
                  val.trim() !== ""
                ) {
                  problematicFields.push({
                    field: col,
                    value: val,
                    valueType: typeof val,
                    dbType,
                  });
                }
              }
            }
            if (problematicFields.length > 0) {
              console.error(
                `[EncompassEtlService] Type mismatches found:`,
                problematicFields.slice(0, 15)
              );
            }
          }
        }

        if (error.message && error.message.includes("numeric field overflow")) {
          // Log full error object to see what properties are available
          console.error("[EncompassEtlService] Full error object:", {
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
            routine: error.routine,
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
            const msgMatch = error.message.match(
              /column "(\w+)"|field "(\w+)"/i
            );
            if (msgMatch) {
              fieldName = msgMatch[1] || msgMatch[2];
            }
          }

          if (fieldName) {
            const fieldValue = loan[fieldName];
            errorMsg += ` (Field: ${fieldName}, Value: ${fieldValue})`;
            console.error(
              `[EncompassEtlService] Numeric overflow detected - Field: ${fieldName}, Value: ${fieldValue}, Type: ${typeof fieldValue}`
            );
          } else {
            // If we can't identify the field, log all numeric fields from the loan
            const numericFields: Record<string, any> = {};
            for (const [key, value] of Object.entries(loan)) {
              if (typeof value === "number") {
                numericFields[key] = value;
              }
            }
            console.error(
              `[EncompassEtlService] Numeric overflow detected but field unknown. All numeric fields for loan ${
                loan.guid || loan.loan_number || "unknown"
              }:`,
              numericFields
            );
            errorMsg += ` (Unable to identify field - see logs for all numeric values)`;
          }
        }

        errors.push(errorMsg);

        // Only log first 10 errors to avoid spam, but track all failures
        if (errors.length <= 10) {
          console.error("[EncompassEtlService] Load error:", errorMsg);
        }

        // Log more details for debugging count discrepancies
        if (error.code === "23505") {
          // Unique violation
          // Don't log duplicates - they're expected with ON CONFLICT DO UPDATE
          // Just count them as successes since they update existing records
        }

        // Log progress even on errors
        if (processedCount % 1000 === 0) {
          console.log(
            `[EncompassEtlService] Load progress: ${processedCount}/${totalLoans} loans processed (${successCount} succeeded, ${failureCount} failed)`
          );
        }
      }
    }
    }

    console.log(
      `[Sync] Loaded ${successCount}/${totalLoans}: +${insertCount} new, ~${updateCount} updated, =${unchangedCount} unchanged${failureCount > 0 ? `, ${failureCount} failed` : ""}`
    );
    return { successCount, failureCount, insertCount, updateCount, unchangedCount, errors };
  }
}
