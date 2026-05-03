/**
 * LOS Sync Scheduler
 * Handles scheduled sync jobs for LOS connections across all tenants.
 *
 * Architecture:
 *  - Queries the management database for all active tenants
 *  - For each tenant, connects to their tenant database to find LOS connections
 *  - Routes Encompass connections through EncompassEtlService (same logic as manual sync)
 *  - Routes other API connections through losApiService
 *  - Routes CSV connections through csvProcessor
 *
 * Runs every 15 minutes. Each run checks each connection's explicit
 * sync_run_at_times in scheduler_timezone and starts at most one sync per
 * configured local-time slot per local calendar day.
 */

import { pool as managementPool } from '../config/managementDatabase.js';
import { tenantDbManager } from '../config/tenantDatabaseManager.js';
import pg from 'pg';
import {
  normalizeSyncRunAtTimes,
  shouldRunFixedClockTimes,
} from '../utils/schedulerPolicy.js';

interface SyncJob {
  tenantId: string;
  connectionId: string;
  connectionMethod: string;
  losType: string;
  lastSyncedAt?: Date;
  lastLoanModifiedAt?: Date;
  encompassSelectedFolders?: string[];
  syncBusinessDaysOnly?: boolean;
  insightsBusinessDaysOnly?: boolean;
  schedulerTimezone?: string;
  syncAllowedWeekdays?: number[];
  encompassUsersSyncEnabled?: boolean;
  lastEncompassUsersSyncAt?: Date;
}

/**
 * Get all active tenants from the management database
 */
async function getActiveTenants(): Promise<Array<{ id: string; name: string }>> {
  const result = await managementPool.query(
    `SELECT id, name FROM coheus_tenants WHERE status = 'active'`
  );
  return result.rows;
}

/**
 * Get all connections that need syncing for a specific tenant
 */
export async function getConnectionsToSync(tenantId: string, tenantPool: pg.Pool): Promise<SyncJob[]> {
  try {
    const result = await tenantPool.query(
      `SELECT id, connection_method, los_type,
              last_synced_at, last_loan_modified_at, encompass_selected_folders,
              encompass_users_sync_enabled, sync_business_days_only,
              insights_business_days_only, scheduler_timezone,
              sync_allowed_weekdays, sync_run_at_times,
              last_encompass_users_sync_at
       FROM public.los_connections
       WHERE sync_enabled = true
         AND connection_method IN ('api', 'csv_upload')
         AND is_active = true`
    );

    const jobs: SyncJob[] = [];

    for (const row of result.rows) {
      const runAtParsed = normalizeSyncRunAtTimes(row.sync_run_at_times);
      const fixedSlots = runAtParsed.valid ? runAtParsed.value : [];

      if (
        fixedSlots.length === 0 ||
        !shouldRunFixedClockTimes({
          runAtTimes: fixedSlots,
          timeZone: row.scheduler_timezone,
          allowedWeekdays: row.sync_allowed_weekdays,
          businessDaysOnly: row.sync_business_days_only,
          lastSyncedAt: row.last_synced_at ? new Date(row.last_synced_at) : null,
          now: new Date(),
        })
      ) {
        continue;
      }

      // Parse encompass_selected_folders safely
      let folders: string[] = [];
      if (row.encompass_selected_folders) {
        try {
          folders = typeof row.encompass_selected_folders === 'string'
            ? JSON.parse(row.encompass_selected_folders)
            : row.encompass_selected_folders;
        } catch {
          folders = [];
        }
      }

      jobs.push({
        tenantId,
        connectionId: row.id,
        connectionMethod: row.connection_method,
        losType: row.los_type,
        lastSyncedAt: row.last_synced_at ? new Date(row.last_synced_at) : undefined,
        lastLoanModifiedAt: row.last_loan_modified_at ? new Date(row.last_loan_modified_at) : undefined,
        encompassSelectedFolders: folders,
        syncBusinessDaysOnly: row.sync_business_days_only,
        insightsBusinessDaysOnly: row.insights_business_days_only,
        schedulerTimezone: row.scheduler_timezone,
        syncAllowedWeekdays: row.sync_allowed_weekdays,
        encompassUsersSyncEnabled: row.encompass_users_sync_enabled,
        lastEncompassUsersSyncAt: row.last_encompass_users_sync_at
          ? new Date(row.last_encompass_users_sync_at)
          : undefined,
      });
    }

    return jobs;
  } catch (error: any) {
    // Table might not exist yet for this tenant — that's fine
    if (error.code === '42P01') {
      return [];
    }
    throw error;
  }
}

/**
 * Run a scheduled sync for an Encompass connection.
 * Uses the same EncompassEtlService as the manual sync button.
 */
async function runEncompassSync(job: SyncJob, tenantPool: pg.Pool): Promise<void> {
  const { EncompassEtlService } = await import('./etl/encompassEtlService.js');
  const etlService = new EncompassEtlService(tenantPool);

  // Determine modifiedFrom for incremental sync
  let modifiedFrom: Date | undefined;

  // Check if there are existing loans
  let loansCount = 0;
  try {
    const countResult = await tenantPool.query('SELECT COUNT(*) as count FROM public.loans');
    loansCount = parseInt(countResult.rows[0]?.count || '0', 10);
  } catch {
    // loans table may not exist
  }

  if (loansCount === 0) {
    // No existing loans — full sync, no date filter
    modifiedFrom = undefined;
    console.log(`[SyncScheduler] No existing loans for connection=${job.connectionId} — will run full sync`);
  } else if (job.lastLoanModifiedAt) {
    // Best case: use last_loan_modified_at from a previous successful sync
    modifiedFrom = job.lastLoanModifiedAt;
    console.log(`[SyncScheduler] Using last_loan_modified_at=${modifiedFrom.toISOString()} for incremental sync (connection=${job.connectionId})`);
  } else {
    // Fallback: query MAX(last_modified_date) directly from loans table.
    // Handles interrupted syncs where last_loan_modified_at was never written.
    try {
      const maxModifiedResult = await tenantPool.query(
        `SELECT MAX(last_modified_date) as max_modified FROM public.loans WHERE last_modified_date IS NOT NULL`
      );
      if (maxModifiedResult.rows[0]?.max_modified) {
        modifiedFrom = new Date(maxModifiedResult.rows[0].max_modified);
        console.log(`[SyncScheduler] last_loan_modified_at is NULL, using MAX(last_modified_date)=${modifiedFrom.toISOString()} for incremental sync (connection=${job.connectionId})`);
      } else {
        console.warn(
          `[SyncScheduler] MAX(last_modified_date) is NULL for connection=${job.connectionId} with ${loansCount} loans — ` +
          `will run full sync. last_modified_date may not be populated. ` +
          `This will be fixed after the next sync via the incremental bookmark fallback.`
        );
      }
    } catch {
      // will do full sync
    }
  }

  // Set loanStartDate to 36 months ago (matching Qlik's vLoanStartDate)
  const threeYearsAgo = new Date();
  threeYearsAgo.setMonth(threeYearsAgo.getMonth() - 36);
  threeYearsAgo.setDate(1);
  threeYearsAgo.setHours(0, 0, 0, 0);

  console.log(`[SyncScheduler] Running Encompass sync for tenant=${job.tenantId}, connection=${job.connectionId}, ` +
    `modifiedFrom=${modifiedFrom?.toISOString() || 'full sync'}, existingLoans=${loansCount}`);

  const result = await etlService.syncLoans(job.tenantId, job.connectionId, {
    fullSync: false,
    modifiedFrom,
    loanStartDate: threeYearsAgo,
    loanStartDateField: 'Fields.Log.MS.Date.Started',
    folderNames: job.encompassSelectedFolders?.length ? job.encompassSelectedFolders : undefined,
    syncTrigger: 'scheduled',
  });

  console.log(`[SyncScheduler] Encompass sync complete for connection=${job.connectionId}: ` +
    `${result.records_synced} synced, ${result.records_failed} failed, ${result.duration}ms`);
}

/**
 * Run a scheduled sync for a generic (non-Encompass) API connection
 */
async function runGenericApiSync(job: SyncJob): Promise<void> {
  const { syncLoansFromAPI } = await import('./losApiService.js');

  console.log(`[SyncScheduler] Running generic API sync for connection=${job.connectionId}`);
  const result = await syncLoansFromAPI(job.connectionId, { syncTrigger: 'scheduled' });
  console.log(`[SyncScheduler] Generic API sync complete for connection=${job.connectionId}: ` +
    `${result.records_synced} synced, ${result.records_failed} failed`);
}

/**
 * Run a scheduled sync for a CSV connection
 */
async function runCsvSync(job: SyncJob): Promise<void> {
  const { processCSVFilesFromPath } = await import('./csvProcessor.js');

  console.log(`[SyncScheduler] Running CSV sync for connection=${job.connectionId}`);
  await processCSVFilesFromPath(job.connectionId, { syncTrigger: 'scheduled' });
  console.log(`[SyncScheduler] CSV sync complete for connection=${job.connectionId}`);
}

/**
 * Run a single sync job, routing to the appropriate service
 */
async function runScheduledSync(job: SyncJob, tenantPool: pg.Pool): Promise<void> {
  try {
    if (job.connectionMethod === 'api' && job.losType === 'encompass') {
      await runEncompassSync(job, tenantPool);
    } else if (job.connectionMethod === 'api') {
      await runGenericApiSync(job);
    } else if (job.connectionMethod === 'csv_upload') {
      await runCsvSync(job);
    }
  } catch (error: any) {
    console.error(`[SyncScheduler] Error syncing connection=${job.connectionId} (tenant=${job.tenantId}):`, error.message);
  }
}

/**
 * Run all scheduled syncs across all tenants
 */
export async function runScheduledSyncs(): Promise<void> {
  try {
    // Get all active tenants from management DB
    const tenants = await getActiveTenants();

    if (tenants.length === 0) {
      return; // No active tenants — nothing to do
    }

    let totalJobs = 0;

    // Process each tenant
    for (const tenant of tenants) {
      try {
        const tenantPool = await tenantDbManager.getTenantPool(tenant.id);
        const jobs = await getConnectionsToSync(tenant.id, tenantPool);

        if (jobs.length > 0) {
          console.log(`[SyncScheduler] Found ${jobs.length} connections to sync for tenant "${tenant.name}"`);
          totalJobs += jobs.length;

          // Run syncs in batches of 3 per tenant to avoid overwhelming the system
          const batchSize = 3;
          for (let i = 0; i < jobs.length; i += batchSize) {
            const batch = jobs.slice(i, i + batchSize);
            await Promise.allSettled(batch.map(job => runScheduledSync(job, tenantPool)));
          }

          // After scheduled sync: if the latest Monday's row does not exist, compute and insert it (run only when today is not Monday)
          try {
            const { insertPipelineSnapshotForLatestMondayIfMissing } = await import('./dashboard/pipelineAnalysisService.js');
            await insertPipelineSnapshotForLatestMondayIfMissing(tenantPool);
          } catch (err: any) {
            console.warn(`[SyncScheduler] Pipeline analysis snapshot update failed for tenant "${tenant.name}":`, err?.message ?? err);
          }
        }
      } catch (error: any) {
        console.error(`[SyncScheduler] Error processing tenant "${tenant.name}" (${tenant.id}):`, error.message);
      }
    }

    if (totalJobs > 0) {
      console.log(`[SyncScheduler] Completed scheduled sync run: ${totalJobs} connections processed`);
    }
    // If totalJobs === 0, stay silent to reduce log noise
  } catch (error: any) {
    console.error('[SyncScheduler] Error running scheduled syncs:', error.message);
  }
}

/**
 * Clean up stale 'in_progress' sync statuses across all tenants.
 * Called on server startup to recover from crashes/restarts that left
 * connections stuck in 'in_progress' state.
 */
async function cleanupStaleSyncStatuses(): Promise<void> {
  try {
    const tenants = await getActiveTenants();

    let cleaned = 0;
    for (const tenant of tenants) {
      try {
        const tenantPool = await tenantDbManager.getTenantPool(tenant.id);
        const result = await tenantPool.query(
          `UPDATE public.los_connections
           SET last_sync_status = 'interrupted',
               last_sync_error = 'Sync was interrupted (server restart)',
               updated_at = NOW()
           WHERE last_sync_status = 'in_progress'
           RETURNING id`
        );
        cleaned += result.rowCount || 0;
      } catch {
        // Table may not exist for this tenant — skip
      }
    }

    if (cleaned > 0) {
      console.log(`[SyncScheduler] Cleaned up ${cleaned} stale in_progress sync status(es) from previous run`);
    }
  } catch (error: any) {
    console.warn('[SyncScheduler] Error cleaning up stale sync statuses:', error.message);
  }
}

/**
 * Start sync scheduler (runs every 15 minutes)
 */
export function startSyncScheduler(): void {
  console.log('[SyncScheduler] Starting LOS sync scheduler (runs every 15 minutes)');

  // Immediately clean up any stale sync statuses from previous server run
  cleanupStaleSyncStatuses().catch(err =>
    console.warn('[SyncScheduler] Stale status cleanup failed:', err.message)
  );

  // Run initial sync check after a 30-second delay to let the server fully start
  setTimeout(() => {
    runScheduledSyncs().catch(err =>
      console.error('[SyncScheduler] Initial sync run failed:', err.message)
    );
  }, 30 * 1000);

  // Then run every 15 minutes
  setInterval(() => {
    runScheduledSyncs().catch(err =>
      console.error('[SyncScheduler] Scheduled sync run failed:', err.message)
    );
  }, 15 * 60 * 1000);
}
