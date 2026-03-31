/**
 * Sync job poller: reads pending jobs from sync_jobs (management DB),
 * claims them atomically, runs Encompass ETL, and updates status/result/error.
 * Used by the dedicated worker container and by legacy single-process mode.
 */

import { pool as managementPool } from "../config/managementDatabase.js";
import { tenantDbManager } from "../config/tenantDatabaseManager.js";
import { EncompassEtlService } from "./etl/encompassEtlService.js";
import { FieldBackfillService } from "./etl/fieldBackfillService.js";
import {
  backfillNullComplexityScoresAfterIncrementalSync,
  enqueueLoanComplexityRecompute,
} from "./scoring/loanComplexityBackgroundJob.js";

const POLL_INTERVAL_MS = 5000;

export interface SyncJobOptions {
  fullSync?: boolean;
  modifiedFrom?: string;
  limit?: number;
  fields?: string[];
  folderName?: string;
  folderNames?: string[];
  loanStartDate?: string;
  loanStartDateField?: string;
  clearDatabase?: boolean;
}

interface SyncJobRow {
  id: string;
  tenant_id: string;
  los_connection_id: string;
  job_type: string;
  status: string;
  options: SyncJobOptions;
  requested_by: string | null;
  progress: number;
  progress_message: string | null;
  result: Record<string, unknown> | null;
  error: string | null;
  created_at: Date;
  started_at: Date | null;
  completed_at: Date | null;
}

/**
 * Enqueue a sync job into the management DB for the worker to pick up.
 * Returns the job ID so the caller can poll for status.
 */
export async function enqueueSyncJob(
  tenantId: string,
  losConnectionId: string,
  options: SyncJobOptions,
  requestedBy?: string | null
): Promise<string> {
  const result = await managementPool.query(
    `INSERT INTO sync_jobs (tenant_id, los_connection_id, job_type, status, options, requested_by)
     VALUES ($1, $2, 'encompass-sync', 'pending', $3, $4)
     RETURNING id`,
    [tenantId, losConnectionId, JSON.stringify(options), requestedBy ?? null]
  );
  return result.rows[0].id;
}

/**
 * Enqueue a targeted field backfill job.
 */
export async function enqueueBackfillJob(
  tenantId: string,
  losConnectionId: string,
  options: SyncJobOptions = {},
  requestedBy?: string | null
): Promise<string> {
  const result = await managementPool.query(
    `INSERT INTO sync_jobs (tenant_id, los_connection_id, job_type, status, options, requested_by)
     VALUES ($1, $2, 'field-backfill', 'pending', $3, $4)
     RETURNING id`,
    [tenantId, losConnectionId, JSON.stringify(options), requestedBy ?? null]
  );
  return result.rows[0].id;
}

/**
 * Claim a pending job atomically. Returns the job row if claimed, null otherwise.
 */
async function claimNextJob(): Promise<SyncJobRow | null> {
  const client = await managementPool.connect();
  try {
    await client.query("BEGIN");
    const selectResult = await client.query(
      `SELECT id FROM sync_jobs
       WHERE status = 'pending'
       ORDER BY created_at ASC
       LIMIT 1
       FOR UPDATE SKIP LOCKED`
    );
    if (selectResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return null;
    }
    const jobId = selectResult.rows[0].id;
    const updateResult = await client.query(
      `UPDATE sync_jobs
       SET status = 'processing', started_at = NOW(), progress = 10, progress_message = 'Starting sync...'
       WHERE id = $1
       RETURNING id, tenant_id, los_connection_id, job_type, status, options, requested_by,
                 progress, progress_message, result, error, created_at, started_at, completed_at`,
      [jobId]
    );
    await client.query("COMMIT");
    return updateResult.rows[0] as SyncJobRow;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Update job progress in the management DB.
 */
export async function updateSyncJobProgress(
  jobId: string,
  progress: number,
  message: string
): Promise<void> {
  await managementPool.query(
    `UPDATE sync_jobs SET progress = $1, progress_message = $2 WHERE id = $3`,
    [Math.min(100, Math.max(0, progress)), message, jobId]
  );
}

/**
 * Mark job completed with result.
 */
async function completeSyncJob(
  jobId: string,
  result: Record<string, unknown>
): Promise<void> {
  await managementPool.query(
    `UPDATE sync_jobs
     SET status = 'completed', progress = 100, progress_message = 'Sync completed',
         result = $1, completed_at = NOW()
     WHERE id = $2`,
    [JSON.stringify(result), jobId]
  );
}

/**
 * Mark job failed with error message.
 */
async function failSyncJob(jobId: string, error: string): Promise<void> {
  await managementPool.query(
    `UPDATE sync_jobs
     SET status = 'failed', progress_message = $1, error = $2, completed_at = NOW()
     WHERE id = $3`,
    [error, error, jobId]
  );
}

/**
 * Process a single sync job: get tenant pool, run ETL, update sync_jobs.
 */
async function processJob(job: SyncJobRow): Promise<void> {
  const { id: jobId, tenant_id: tenantId, los_connection_id: losConnectionId, options: opts } = job;

  try {
    const tenantPool = await tenantDbManager.getTenantPool(tenantId);

    if (job.job_type === "field-backfill") {
      await updateSyncJobProgress(jobId, 20, "Backfilling swapped fields...");
      const backfillService = new FieldBackfillService(tenantPool);
      const result = await backfillService.backfillSwappedFields(tenantId, losConnectionId, {
        loanStartDate: opts.loanStartDate ? new Date(opts.loanStartDate) : undefined,
        loanStartDateField: opts.loanStartDateField,
        folderName: opts.folderName,
        folderNames: opts.folderNames,
        limit: opts.limit,
      });
      await completeSyncJob(jobId, result as unknown as Record<string, unknown>);
      return;
    }

    if (opts.clearDatabase) {
      console.log(`[SyncJobPoller] Clearing loans table before full sync for tenant ${tenantId}`);
      await tenantPool.query("TRUNCATE TABLE public.loans RESTART IDENTITY CASCADE").catch(() => {});
    }

    const etlService = new EncompassEtlService(tenantPool);

    await updateSyncJobProgress(jobId, 20, "Syncing loans from Encompass...");

    const result = await etlService.syncLoans(tenantId, losConnectionId, {
      fullSync: opts.fullSync,
      modifiedFrom: opts.modifiedFrom ? new Date(opts.modifiedFrom) : undefined,
      limit: opts.limit,
      fields: opts.fields,
      folderName: opts.folderName,
      folderNames: opts.folderNames,
      loanStartDate: opts.loanStartDate ? new Date(opts.loanStartDate) : undefined,
      loanStartDateField: opts.loanStartDateField,
    });

    // After a full sync, enqueue tenant-wide persisted complexity recompute.
    // After incremental sync, changed loans already get scores in transform/load; also
    // backfill any loans that still have NULL complexity_score (bounded batches per job).
    let complexityNullBackfill: { rowsUpdated: number } | undefined;
    if (opts.fullSync) {
      await enqueueLoanComplexityRecompute(tenantPool);
    } else {
      complexityNullBackfill =
        await backfillNullComplexityScoresAfterIncrementalSync(tenantPool);
    }

    await completeSyncJob(jobId, {
      ...(result as unknown as Record<string, unknown>),
      ...(complexityNullBackfill != null
        ? { complexity_null_score_backfill: complexityNullBackfill }
        : {}),
    });
  } catch (error: any) {
    const message = error?.message || String(error);
    console.error("[SyncJobPoller] Job failed:", jobId, message);
    await failSyncJob(jobId, message);
  }
}

/**
 * Poll once for a pending job; if found, claim and process it.
 * Processes at most one job per invocation (one job at a time per worker).
 */
async function pollAndProcessOne(): Promise<void> {
  try {
    const job = await claimNextJob();
    if (!job) return;
    console.log("[SyncJobPoller] Processing job:", job.id, "tenant:", job.tenant_id);
    await processJob(job);
  } catch (error: any) {
    console.error("[SyncJobPoller] Poll/process error:", error?.message || error);
  }
}

let pollIntervalId: ReturnType<typeof setInterval> | null = null;

/**
 * Start the sync job poller. Runs every POLL_INTERVAL_MS; processes one job at a time.
 */
export function startSyncJobPoller(): void {
  if (pollIntervalId != null) {
    console.warn("[SyncJobPoller] Already running");
    return;
  }
  pollIntervalId = setInterval(pollAndProcessOne, POLL_INTERVAL_MS);
  // Run once immediately
  pollAndProcessOne();
}

/**
 * Stop the sync job poller (e.g. for graceful shutdown).
 */
export function stopSyncJobPoller(): void {
  if (pollIntervalId != null) {
    clearInterval(pollIntervalId);
    pollIntervalId = null;
  }
}
