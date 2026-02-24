import { pool as managementPool } from "../config/managementDatabase.js";
import { tenantDbManager } from "../config/tenantDatabaseManager.js";
import { EncompassWebhookService } from "./encompassWebhookService.js";

async function getActiveTenants(): Promise<Array<{ id: string; name: string }>> {
  const result = await managementPool.query(
    `SELECT id, name FROM coheus_tenants WHERE status = 'active'`,
  );
  return result.rows;
}

async function anyWebhookConnectionsExist(): Promise<boolean> {
  const tenants = await getActiveTenants();
  for (const tenant of tenants) {
    try {
      const tenantPool = await tenantDbManager.getTenantPool(tenant.id);
      const result = await tenantPool.query(
        `SELECT 1 FROM public.los_connections
         WHERE webhook_enabled = true AND is_active = true
         LIMIT 1`,
      );
      if (result.rows.length > 0) return true;
    } catch {
      // tenant pool unavailable — skip
    }
  }
  return false;
}

export async function runEncompassWebhookQueueProcessor(): Promise<void> {
  const tenants = await getActiveTenants();
  for (const tenant of tenants) {
    try {
      const tenantPool = await tenantDbManager.getTenantPool(tenant.id);
      const webhookService = new EncompassWebhookService(tenantPool);
      await webhookService.processPendingQueue(tenant.id, 5);
    } catch (error: any) {
      console.warn(
        `[EncompassWebhookScheduler] Queue processing failed for tenant ${tenant.id}: ${error.message}`,
      );
    }
  }
}

export async function runEncompassWebhookReconciliation(): Promise<void> {
  const tenants = await getActiveTenants();
  for (const tenant of tenants) {
    try {
      const tenantPool = await tenantDbManager.getTenantPool(tenant.id);
      const webhookService = new EncompassWebhookService(tenantPool);
      await webhookService.runReconciliation(tenant.id);
    } catch (error: any) {
      console.warn(
        `[EncompassWebhookScheduler] Reconciliation failed for tenant ${tenant.id}: ${error.message}`,
      );
    }
  }
}

export function startEncompassWebhookScheduler(): void {
  let active = false;

  const checkAndActivate = async () => {
    if (active) return;
    const hasConnections = await anyWebhookConnectionsExist();
    if (!hasConnections) return;

    active = true;
    console.log("[EncompassWebhookScheduler] Webhook connections detected — activating scheduler");

    setInterval(() => {
      runEncompassWebhookQueueProcessor().catch((err) =>
        console.warn("[EncompassWebhookScheduler] Queue run failed:", err.message),
      );
    }, 60 * 1000);

    setInterval(() => {
      runEncompassWebhookReconciliation().catch((err) =>
        console.warn("[EncompassWebhookScheduler] Reconciliation run failed:", err.message),
      );
    }, 30 * 60 * 1000);
  };

  // Check on startup (after 20s delay), then re-check every 5 minutes
  // until a webhook connection is found
  setTimeout(() => checkAndActivate().catch(() => {}), 20 * 1000);
  const probeInterval = setInterval(() => {
    if (active) {
      clearInterval(probeInterval);
      return;
    }
    checkAndActivate().catch(() => {});
  }, 5 * 60 * 1000);
}
