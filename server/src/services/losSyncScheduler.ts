/**
 * LOS Sync Scheduler
 * Handles scheduled sync jobs for LOS connections
 */

import { pool } from '../config/database.js';
import { syncLoansFromAPI } from './losApiService.js';
import { processCSVFilesFromPath } from './csvProcessor.js';

interface SyncJob {
  connectionId: string;
  connectionMethod: string;
  syncFrequency: string;
  lastSync?: Date;
  nextSync: Date;
}

/**
 * Calculate next sync time based on frequency
 */
function calculateNextSync(frequency: string, lastSync?: Date): Date {
  const now = new Date();
  
  switch (frequency) {
    case 'realtime':
      // For realtime, sync immediately (handled by webhooks)
      return now;
    case 'hourly':
      const nextHour = new Date(now);
      nextHour.setHours(nextHour.getHours() + 1, 0, 0, 0);
      return nextHour;
    case 'daily':
      const nextDay = new Date(now);
      nextDay.setDate(nextDay.getDate() + 1);
      nextDay.setHours(2, 0, 0, 0); // 2 AM
      return nextDay;
    case 'weekly':
      const nextWeek = new Date(now);
      const daysUntilMonday = (1 + 7 - nextWeek.getDay()) % 7 || 7;
      nextWeek.setDate(nextWeek.getDate() + daysUntilMonday);
      nextWeek.setHours(2, 0, 0, 0); // Monday 2 AM
      return nextWeek;
    default:
      return new Date(now.getTime() + 60 * 60 * 1000); // Default: 1 hour
  }
}

/**
 * Get all connections that need syncing
 */
async function getConnectionsToSync(): Promise<SyncJob[]> {
  const result = await pool.query(
    `SELECT id, connection_method, sync_frequency, last_synced_at, sync_enabled
     FROM public.los_connections
     WHERE sync_enabled = true
     AND connection_method IN ('api', 'csv_upload')
     AND is_active = true`
  );

  const jobs: SyncJob[] = [];

  for (const row of result.rows) {
    const lastSync = row.last_synced_at ? new Date(row.last_synced_at) : undefined;
    const nextSync = calculateNextSync(row.sync_frequency, lastSync);
    const now = new Date();

    // Only include jobs that are due
    if (nextSync <= now || !lastSync) {
      jobs.push({
        connectionId: row.id,
        connectionMethod: row.connection_method,
        syncFrequency: row.sync_frequency,
        lastSync,
        nextSync,
      });
    }
  }

  return jobs;
}

/**
 * Run scheduled sync for a connection
 */
async function runScheduledSync(job: SyncJob): Promise<void> {
  try {
    console.log(`Starting scheduled sync for connection ${job.connectionId} (${job.connectionMethod})`);

    if (job.connectionMethod === 'api') {
      await syncLoansFromAPI(job.connectionId);
    } else if (job.connectionMethod === 'csv_upload') {
      await processCSVFilesFromPath(job.connectionId);
    }

    console.log(`Completed scheduled sync for connection ${job.connectionId}`);
  } catch (error: any) {
    console.error(`Error in scheduled sync for connection ${job.connectionId}:`, error.message);
  }
}

/**
 * Run all scheduled syncs
 */
export async function runScheduledSyncs(): Promise<void> {
  try {
    const jobs = await getConnectionsToSync();
    
    console.log(`Found ${jobs.length} connections to sync`);

    // Run syncs in parallel (with limit to avoid overwhelming the system)
    const batchSize = 5;
    for (let i = 0; i < jobs.length; i += batchSize) {
      const batch = jobs.slice(i, i + batchSize);
      await Promise.allSettled(batch.map(job => runScheduledSync(job)));
    }
  } catch (error: any) {
    console.error('Error running scheduled syncs:', error);
  }
}

/**
 * Start sync scheduler (runs every 15 minutes)
 */
export function startSyncScheduler(): void {
  console.log('🔄 Starting LOS sync scheduler...');

  // Run immediately on start
  runScheduledSyncs().catch(console.error);

  // Then run every 15 minutes
  setInterval(() => {
    runScheduledSyncs().catch(console.error);
  }, 15 * 60 * 1000); // 15 minutes

  console.log('✅ LOS sync scheduler started (runs every 15 minutes)');
}
