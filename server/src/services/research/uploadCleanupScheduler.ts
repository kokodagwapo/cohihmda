/**
 * Upload Cleanup Scheduler
 *
 * Periodically scans research_uploads for expired table-strategy uploads
 * and drops their temporary tables from all tenant databases.
 *
 * Runs every 6 hours.
 * An upload is eligible for cleanup when:
 *   - status = 'ready' (or any non-expired)
 *   - expires_at <= NOW()
 *   - storage_strategy = 'table'
 */

import { tenantDbManager } from "../../config/tenantDatabaseManager.js";
import { pool as managementPool } from "../../config/managementDatabase.js";
import { dropUploadTable } from "./uploadProcessor.js";

const CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

export function startUploadCleanupScheduler(): void {
  runCleanup().catch((err) =>
    console.error("[UploadCleanup] Initial run failed:", err.message)
  );
  setInterval(() => {
    runCleanup().catch((err) =>
      console.error("[UploadCleanup] Scheduled run failed:", err.message)
    );
  }, CLEANUP_INTERVAL_MS);

  console.log("✅ Research upload cleanup scheduler started (runs every 6h)");
}

async function runCleanup(): Promise<void> {
  try {
    // Get all active tenants
    const tenantsResult = await managementPool.query(
      `SELECT id FROM coheus_tenants WHERE status = 'active'`
    );

    let totalExpired = 0;

    for (const tenant of tenantsResult.rows) {
      try {
        const tenantPool = await tenantDbManager.getTenantPool(tenant.id);

        // Find expired uploads for this tenant
        const expiredResult = await tenantPool.query(
          `SELECT id, table_name, storage_strategy
           FROM research_uploads
           WHERE status != 'expired'
             AND expires_at IS NOT NULL
             AND expires_at <= NOW()`
        );

        for (const row of expiredResult.rows) {
          try {
            // Drop temp table if applicable
            if (row.storage_strategy === "table" && row.table_name) {
              await dropUploadTable(row.table_name, tenantPool);
            }

            // Mark as expired
            await tenantPool.query(
              `UPDATE research_uploads SET status = 'expired', updated_at = NOW() WHERE id = $1`,
              [row.id]
            );
            totalExpired++;
          } catch (rowErr: any) {
            console.warn(`[UploadCleanup] Failed to clean up upload ${row.id}:`, rowErr.message);
          }
        }
      } catch (tenantErr: any) {
        // Skip tenant DB errors (tenant may be offline)
        console.warn(`[UploadCleanup] Skipping tenant ${tenant.id}:`, tenantErr.message);
      }
    }

    if (totalExpired > 0) {
      console.log(`[UploadCleanup] Cleaned up ${totalExpired} expired upload(s).`);
    }
  } catch (err: any) {
    console.error("[UploadCleanup] Cleanup error:", err.message);
  }
}
