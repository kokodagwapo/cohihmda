import { tenantDbManager } from "../config/tenantDatabaseManager.js";
import { pool as managementPool } from "../config/managementDatabase.js";

const CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000;

export function startFeedbackAttachmentCleanupScheduler(): void {
  runCleanup().catch((err) => {
    console.error("[FeedbackAttachmentCleanup] Initial run failed:", err.message);
  });

  setInterval(() => {
    runCleanup().catch((err) => {
      console.error("[FeedbackAttachmentCleanup] Scheduled run failed:", err.message);
    });
  }, CLEANUP_INTERVAL_MS);

  console.log("✅ Feedback attachment cleanup scheduler started (runs every 6h)");
}

async function runCleanup(): Promise<void> {
  try {
    const tenantsResult = await managementPool.query(
      `SELECT id
       FROM coheus_tenants
       WHERE status = 'active'`
    );

    let totalExpired = 0;
    for (const tenant of tenantsResult.rows) {
      try {
        const tenantPool = await tenantDbManager.getTenantPool(tenant.id);
        const expiredRows = await tenantPool.query(
          `SELECT id
           FROM user_feedback_attachments
           WHERE status != 'expired'
             AND expires_at IS NOT NULL
             AND expires_at <= NOW()`
        );

        for (const row of expiredRows.rows) {
          await tenantPool.query(
            `UPDATE user_feedback_attachments
             SET status = 'expired',
                 data = NULL,
                 updated_at = NOW()
             WHERE id = $1`,
            [row.id]
          );
          totalExpired += 1;
        }
      } catch (tenantErr: any) {
        console.warn(`[FeedbackAttachmentCleanup] Skipping tenant ${tenant.id}:`, tenantErr.message);
      }
    }

    if (totalExpired > 0) {
      console.log(`[FeedbackAttachmentCleanup] Expired ${totalExpired} attachment(s).`);
    }
  } catch (err: any) {
    console.error("[FeedbackAttachmentCleanup] Cleanup error:", err.message);
  }
}
