import crypto from "crypto";
import type { Pool } from "pg";
import { pool as managementPool } from "../config/managementDatabase.js";
import { tenantDbManager } from "../config/tenantDatabaseManager.js";
import { updateTenantStatus } from "./tenantProvisioningService.js";
import {
  CONFIG_TABLES,
  LOAN_DATA_TABLES,
  buildAnonymizationMappings,
  copyConfigTables,
  copyEmployeesAnonymized,
  copyEncompassUsersAnonymized,
  copyLoanRelatedData,
  copyLoansAnonymized,
  getTenantPoolById,
} from "./tenantDuplicationService.js";
import { runDemoTenantGenerationPipeline } from "./demoTenantGenerationPipeline.js";
import { logError, logInfo } from "./logger.js";

export interface DemoTenantRefreshJob {
  id: string;
  tenantId: string;
  status: "running" | "completed" | "failed";
  startedAt: Date;
  completedAt?: Date;
  result?: any;
  error?: string;
}

const refreshJobs = new Map<string, DemoTenantRefreshJob>();
const runningRefreshByTenantId = new Map<string, string>();

async function truncateTablesIfExist(
  tenantPool: Pool,
  tables: string[],
): Promise<void> {
  if (tables.length === 0) return;
  const result = await tenantPool.query(
    `SELECT table_name
     FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name = ANY($1::text[])`,
    [tables],
  );
  const existing = result.rows.map((row: any) => String(row.table_name));
  if (existing.length === 0) return;
  const quoted = existing.map((name) => `"${name}"`).join(", ");
  await tenantPool.query(
    `TRUNCATE TABLE ${quoted} RESTART IDENTITY CASCADE`,
  );
}

async function clearDemoTenantData(tenantPool: Pool): Promise<void> {
  const tablesToClear = [
    ...new Set([
      "employees",
      "loans",
      "encompass_users",
      ...LOAN_DATA_TABLES,
      ...CONFIG_TABLES,
    ]),
  ];
  await truncateTablesIfExist(tenantPool, tablesToClear);
}

export async function refreshDemoTenant(
  demoTenantId: string,
): Promise<{
  sourceTenantId: string;
  employeesCopied: number;
  loansCopied: number;
}> {
  const tenantMeta = await managementPool.query(
    `SELECT id, source_tenant_id, status
     FROM coheus_tenants
     WHERE id = $1`,
    [demoTenantId],
  );
  if (!tenantMeta.rows.length) {
    throw new Error("Demo tenant not found");
  }

  const sourceTenantId = tenantMeta.rows[0].source_tenant_id as string | null;
  if (!sourceTenantId) {
    throw new Error("Tenant is not linked to a source tenant");
  }

  const sourceTenant = await managementPool.query(
    `SELECT id, status
     FROM coheus_tenants
     WHERE id = $1`,
    [sourceTenantId],
  );
  if (!sourceTenant.rows.length || sourceTenant.rows[0].status === "deleted") {
    throw new Error("Source tenant is missing or deleted");
  }

  const src = await getTenantPoolById(sourceTenantId);
  const demoPool = await tenantDbManager.getTenantPool(demoTenantId);

  try {
    await updateTenantStatus(demoTenantId, "provisioning");
    await clearDemoTenantData(demoPool);

    const mappings = await buildAnonymizationMappings(src.pool);
    await copyConfigTables(src.pool, demoPool);
    const employeesCopied = await copyEmployeesAnonymized(
      src.pool,
      demoPool,
      mappings,
    );
    const loansCopied = await copyLoansAnonymized(src.pool, demoPool, mappings);
    await copyEncompassUsersAnonymized(src.pool, demoPool, mappings);
    await copyLoanRelatedData(src.pool, demoPool);

    await managementPool.query(
      `UPDATE coheus_tenants
       SET last_refreshed_at = NOW(),
           updated_at = NOW()
       WHERE id = $1`,
      [demoTenantId],
    );
    await updateTenantStatus(demoTenantId, "active");

    await runDemoTenantGenerationPipeline(demoTenantId, demoPool);

    return { sourceTenantId, employeesCopied, loansCopied };
  } catch (error: any) {
    await updateTenantStatus(demoTenantId, "active");
    throw error;
  } finally {
    await src.cleanup();
  }
}

export function startDemoTenantRefresh(
  demoTenantId: string,
): DemoTenantRefreshJob {
  const existingJobId = runningRefreshByTenantId.get(demoTenantId);
  if (existingJobId) {
    const existingJob = refreshJobs.get(existingJobId);
    if (existingJob && existingJob.status === "running") {
      return existingJob;
    }
  }

  const id = crypto.randomUUID();
  const job: DemoTenantRefreshJob = {
    id,
    tenantId: demoTenantId,
    status: "running",
    startedAt: new Date(),
  };
  refreshJobs.set(id, job);
  runningRefreshByTenantId.set(demoTenantId, id);

  refreshDemoTenant(demoTenantId)
    .then((result) => {
      job.status = "completed";
      job.completedAt = new Date();
      job.result = result;
      runningRefreshByTenantId.delete(demoTenantId);
      logInfo(`[DemoRefresh] Completed demo tenant refresh for ${demoTenantId}`);
    })
    .catch((error: any) => {
      job.status = "failed";
      job.completedAt = new Date();
      job.error = error.message || "Unknown error";
      runningRefreshByTenantId.delete(demoTenantId);
      logError(
        `[DemoRefresh] Failed demo tenant refresh for ${demoTenantId}: ${job.error}`,
        error,
      );
    });

  return job;
}

export function getDemoTenantRefreshJob(
  jobId: string,
): DemoTenantRefreshJob | null {
  return refreshJobs.get(jobId) || null;
}

export async function queueAutoRefreshForSourceTenant(
  sourceTenantId: string,
): Promise<number> {
  const result = await managementPool.query(
    `SELECT id
     FROM coheus_tenants
     WHERE source_tenant_id = $1
       AND is_demo = true
       AND auto_refresh = true
       AND status = 'active'`,
    [sourceTenantId],
  );

  let queued = 0;
  for (const row of result.rows) {
    const existingJobId = runningRefreshByTenantId.get(row.id);
    if (existingJobId) continue;
    startDemoTenantRefresh(row.id);
    queued += 1;
  }
  return queued;
}
