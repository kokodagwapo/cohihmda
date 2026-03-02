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
 * Runs every 15 minutes. Each run checks which connections are overdue for sync
 * based on their configured sync_frequency and last_synced_at timestamp.
 */

import { pool as managementPool } from '../config/managementDatabase.js';
import { tenantDbManager } from '../config/tenantDatabaseManager.js';
import pg from 'pg';

interface SyncJob {
  tenantId: string;
  connectionId: string;
  connectionMethod: string;
  losType: string;
  syncFrequency: string;
  lastSyncedAt?: Date;
  lastLoanModifiedAt?: Date;
  encompassSelectedFolders?: string[];
}

/**
 * Determine if a connection is overdue for sync based on frequency and last sync time.
 * Returns true if enough time has elapsed since the last sync.
 */
function isSyncOverdue(frequency: string, lastSyncedAt?: Date): boolean {
  // Never synced before — always overdue
  if (!lastSyncedAt) {
    return true;
  }

  const now = Date.now();
  const lastSync = new Date(lastSyncedAt).getTime();
  const elapsed = now - lastSync;

  switch (frequency) {
    case 'realtime':
      // Realtime is handled via webhooks, but if we're checking the scheduler,
      // treat anything older than 5 minutes as overdue
      return elapsed > 5 * 60 * 1000;
    case 'hourly':
      return elapsed > 60 * 60 * 1000; // 1 hour
    case 'daily':
      return elapsed > 24 * 60 * 60 * 1000; // 24 hours
    case 'weekly':
      return elapsed > 7 * 24 * 60 * 60 * 1000; // 7 days
    default:
      // Unknown frequency — default to hourly
      return elapsed > 60 * 60 * 1000;
  }
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
async function getConnectionsToSync(tenantId: string, tenantPool: pg.Pool): Promise<SyncJob[]> {
  try {
    const result = await tenantPool.query(
      `SELECT id, connection_method, los_type, sync_frequency, 
              last_synced_at, last_loan_modified_at, encompass_selected_folders
       FROM public.los_connections
       WHERE sync_enabled = true
         AND connection_method IN ('api', 'csv_upload')
         AND is_active = true`
    );

    const jobs: SyncJob[] = [];

    for (const row of result.rows) {
      if (isSyncOverdue(row.sync_frequency, row.last_synced_at)) {
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
          syncFrequency: row.sync_frequency,
          lastSyncedAt: row.last_synced_at ? new Date(row.last_synced_at) : undefined,
          lastLoanModifiedAt: row.last_loan_modified_at ? new Date(row.last_loan_modified_at) : undefined,
          encompassSelectedFolders: folders,
        });
      }
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
  } else if (job.lastLoanModifiedAt) {
    // Best case: use last_loan_modified_at from a previous successful sync
    modifiedFrom = job.lastLoanModifiedAt;
  } else {
    // Fallback: query MAX(last_modified_date) directly from loans table.
    // Handles interrupted syncs where last_loan_modified_at was never written.
    try {
      const maxModifiedResult = await tenantPool.query(
        `SELECT MAX(last_modified_date) as max_modified FROM public.loans WHERE last_modified_date IS NOT NULL`
      );
      if (maxModifiedResult.rows[0]?.max_modified) {
        modifiedFrom = new Date(maxModifiedResult.rows[0].max_modified);
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
  const result = await syncLoansFromAPI(job.connectionId);
  console.log(`[SyncScheduler] Generic API sync complete for connection=${job.connectionId}: ` +
    `${result.records_synced} synced, ${result.records_failed} failed`);
}

/**
 * Run a scheduled sync for a CSV connection
 */
async function runCsvSync(job: SyncJob): Promise<void> {
  const { processCSVFilesFromPath } = await import('./csvProcessor.js');

  console.log(`[SyncScheduler] Running CSV sync for connection=${job.connectionId}`);
  await processCSVFilesFromPath(job.connectionId);
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
