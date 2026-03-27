/**
 * Periodically processes durable loan complexity recompute jobs for all active tenants.
 */

import { pool as managementPool } from "../config/managementDatabase.js";
import { tenantDbManager } from "../config/tenantDatabaseManager.js";
import { startLoanComplexityRecomputeScheduler } from "./scoring/loanComplexityBackgroundJob.js";

async function getActiveTenantPools(): Promise<Array<{ id: string; pool: import("pg").Pool }>> {
  const r = await managementPool.query(
    `SELECT id FROM coheus_tenants WHERE status = 'active'`,
  );
  const out: Array<{ id: string; pool: import("pg").Pool }> = [];
  for (const row of r.rows) {
    try {
      out.push({
        id: row.id,
        pool: await tenantDbManager.getTenantPool(row.id),
      });
    } catch {
      /* tenant DB unavailable */
    }
  }
  return out;
}

export function startLoanComplexityRecomputeSchedulerFromManagement(): void {
  startLoanComplexityRecomputeScheduler(getActiveTenantPools, 30_000);
}
