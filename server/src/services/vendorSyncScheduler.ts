/**
 * Vendor Sync Scheduler
 * Handles scheduled sync jobs for vendor connections (reads from loans table)
 */

import { pool } from '../config/database.js';
import { syncLoansToVendor } from './vendorConnector.js';

interface VendorSyncJob {
  connectionId: string;
  vendorCategory: string;
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
      return now;
    case 'hourly':
      const nextHour = new Date(now);
      nextHour.setHours(nextHour.getHours() + 1, 0, 0, 0);
      return nextHour;
    case 'daily':
      const nextDay = new Date(now);
      nextDay.setDate(nextDay.getDate() + 1);
      nextDay.setHours(2, 0, 0, 0);
      return nextDay;
    case 'weekly':
      const nextWeek = new Date(now);
      const daysUntilMonday = (1 + 7 - nextWeek.getDay()) % 7 || 7;
      nextWeek.setDate(nextWeek.getDate() + daysUntilMonday);
      nextWeek.setHours(2, 0, 0, 0);
      return nextWeek;
    default:
      return new Date(now.getTime() + 60 * 60 * 1000);
  }
}

/**
 * Get all vendor connections that need syncing
 */
async function getVendorConnectionsToSync(): Promise<VendorSyncJob[]> {
  const result = await pool.query(
    `SELECT id, vendor_category, sync_frequency, last_synced_at, sync_enabled
     FROM public.vendor_connections
     WHERE sync_enabled = true
     AND connection_status = 'active'
     AND is_active = true`
  );

  const jobs: VendorSyncJob[] = [];

  for (const row of result.rows) {
    const lastSync = row.last_synced_at ? new Date(row.last_synced_at) : undefined;
    const nextSync = calculateNextSync(row.sync_frequency, lastSync);
    const now = new Date();

    // Only include jobs that are due
    if (nextSync <= now || !lastSync) {
      jobs.push({
        connectionId: row.id,
        vendorCategory: row.vendor_category,
        syncFrequency: row.sync_frequency,
        lastSync,
        nextSync,
      });
    }
  }

  return jobs;
}

/**
 * Run scheduled sync for a vendor connection
 * Reads from loans table and pushes to vendor
 */
async function runScheduledVendorSync(job: VendorSyncJob): Promise<void> {
  try {
    console.log(`Starting scheduled vendor sync for connection ${job.connectionId} (${job.vendorCategory})`);

    // syncLoansToVendor reads from loans table and pushes to vendor
    await syncLoansToVendor(job.connectionId);

    console.log(`Completed scheduled vendor sync for connection ${job.connectionId}`);
  } catch (error: any) {
    console.error(`Error in scheduled vendor sync for connection ${job.connectionId}:`, error.message);
  }
}

/**
 * Run all scheduled vendor syncs
 */
export async function runScheduledVendorSyncs(): Promise<void> {
  try {
    const jobs = await getVendorConnectionsToSync();
    
    console.log(`Found ${jobs.length} vendor connections to sync`);

    // Run syncs in parallel (with limit to avoid overwhelming the system)
    const batchSize = 5;
    for (let i = 0; i < jobs.length; i += batchSize) {
      const batch = jobs.slice(i, i + batchSize);
      await Promise.allSettled(batch.map(job => runScheduledVendorSync(job)));
    }
  } catch (error: any) {
    console.error('Error running scheduled vendor syncs:', error);
  }
}

/**
 * Start vendor sync scheduler (runs every 15 minutes)
 */
export function startVendorSyncScheduler(): void {
  console.log('🔄 Starting vendor sync scheduler...');

  // Run immediately on start
  runScheduledVendorSyncs().catch(console.error);

  // Then run every 15 minutes
  setInterval(() => {
    runScheduledVendorSyncs().catch(console.error);
  }, 15 * 60 * 1000); // 15 minutes

  console.log('✅ Vendor sync scheduler started (runs every 15 minutes, reads from loans table)');
}
