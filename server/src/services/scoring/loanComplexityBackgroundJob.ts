/**
 * Durable loan complexity recompute jobs (tenant DB table background_jobs).
 */

import crypto from "crypto";
import type pg from "pg";
import { logInfo, logError, logWarn } from "../logger.js";
import { LoanComplexityService } from "./loanComplexityService.js";
import { loanRecordToLoanData } from "./persistedLoanComplexity.js";

export const LOAN_COMPLEXITY_RECOMPUTE_JOB_TYPE = "loan_complexity_recompute";

const ADVISORY_LOCK_KEY = 92001423;

function batchSize(): number {
  const n = parseInt(process.env.LOAN_COMPLEXITY_RECOMPUTE_BATCH_SIZE || "1000", 10);
  return Number.isFinite(n) && n > 0 ? n : 1000;
}

/** Stable hash of active complexity_components rows (for deduping enqueue). */
export async function hashActiveComplexityComponents(
  client: pg.Pool | pg.PoolClient,
): Promise<string> {
  const res = await client.query(`
    SELECT component_name, condition_value, weight, is_active, range_min, range_max
    FROM public.complexity_components
    WHERE is_active = TRUE
    ORDER BY component_name, COALESCE(range_min, 0), condition_value
  `);
  const payload = JSON.stringify(res.rows);
  return crypto.createHash("sha256").update(payload).digest("hex");
}

/** Enqueue tenant-wide recompute if no pending/processing job exists. */
export async function enqueueLoanComplexityRecompute(pool: pg.Pool): Promise<boolean> {
  const ins = await pool.query(
    `
    INSERT INTO public.background_jobs (job_type, status, cursor_state)
    SELECT $1, 'pending', '{"last_id":null,"processed_count":0,"failed_count":0}'::jsonb
    WHERE NOT EXISTS (
      SELECT 1 FROM public.background_jobs b
      WHERE b.job_type = $1
        AND b.status IN ('pending', 'processing')
    )
    RETURNING id
    `,
    [LOAN_COMPLEXITY_RECOMPUTE_JOB_TYPE],
  );
  const enqueued = ins.rowCount !== null && ins.rowCount > 0;
  if (enqueued) {
    logInfo("[LoanComplexity] Enqueued bulk recompute job", {});
  }
  return enqueued;
}

/** After complexity config changed: enqueue only if post-change hash differs from pre-change. */
export async function enqueueLoanComplexityRecomputeIfChanged(
  pool: pg.Pool,
  hashBefore: string,
): Promise<boolean> {
  const hashAfter = await hashActiveComplexityComponents(pool);
  if (hashAfter === hashBefore) {
    return false;
  }
  return enqueueLoanComplexityRecompute(pool);
}

function nullBackfillBatchSize(): number {
  const n = parseInt(process.env.LOAN_COMPLEXITY_NULL_BACKFILL_BATCH_SIZE || "500", 10);
  return Number.isFinite(n) && n > 0 ? n : 500;
}

function nullBackfillMaxBatches(): number {
  const n = parseInt(process.env.LOAN_COMPLEXITY_NULL_BACKFILL_MAX_BATCHES || "40", 10);
  return Number.isFinite(n) && n > 0 ? n : 40;
}

/**
 * After an incremental sync, fill persisted complexity_score for loans that are still NULL.
 * Bounded work per sync so the worker stays responsive; remaining NULLs are chipped away on later syncs
 * or by the durable loan_complexity_recompute job / admin full sync.
 */
export async function backfillNullComplexityScoresAfterIncrementalSync(
  pool: pg.Pool,
): Promise<{ rowsUpdated: number }> {
  const bs = nullBackfillBatchSize();
  const maxBatches = nullBackfillMaxBatches();
  let rowsUpdated = 0;

  const svc = new LoanComplexityService(pool);
  await svc.loadCustomWeights();

  for (let b = 0; b < maxBatches; b++) {
    const sel = await pool.query(
      `
      SELECT id,
             loan_type, loan_purpose, loan_amount, fico_score, ltv_ratio, be_dti_ratio,
             occupancy_type, borr_self_employed, co_borr_self_employed, non_qm
      FROM public.loans
      WHERE complexity_score IS NULL
      ORDER BY id ASC
      LIMIT $1
      `,
      [bs],
    );

    if (sel.rows.length === 0) break;

    const pairs: Array<{ id: string; score: number }> = [];
    for (const row of sel.rows) {
      try {
        const score = svc.calculateComplexity(loanRecordToLoanData(row)).totalScore;
        pairs.push({ id: row.id, score: Math.round(score * 100) / 100 });
      } catch (e: any) {
        logError("[LoanComplexity] Null-score backfill row failed", e, { loanId: row.id });
      }
    }

    if (pairs.length > 0) {
      const parts: string[] = [];
      const params: unknown[] = [];
      let i = 1;
      for (const p of pairs) {
        parts.push(`($${i}::uuid, $${i + 1}::numeric)`);
        params.push(p.id, p.score);
        i += 2;
      }
      await pool.query(
        `
        UPDATE public.loans l
        SET complexity_score = v.score
        FROM (VALUES ${parts.join(", ")}) AS v(id, score)
        WHERE l.id = v.id
        `,
        params,
      );
      rowsUpdated += pairs.length;
    }

    if (sel.rows.length < bs) break;
  }

  if (rowsUpdated > 0) {
    logInfo("[LoanComplexity] Incremental sync null-score backfill", { rowsUpdated });
  }

  return { rowsUpdated };
}

let schedulerStarted = false;

/** Process at most one batch on this tenant pool (serialized via advisory lock on one connection). */
export async function processLoanComplexityJobsForPool(pool: pg.Pool): Promise<void> {
  const client = await pool.connect();
  let jobIdForFailure: string | null = null;
  try {
    const lock = await client.query("SELECT pg_try_advisory_lock($1) AS ok", [
      ADVISORY_LOCK_KEY,
    ]);
    if (!lock.rows[0]?.ok) return;

    try {
      const jobRes = await client.query(
        `
        SELECT * FROM public.background_jobs
        WHERE job_type = $1
          AND status IN ('pending', 'processing')
        ORDER BY CASE WHEN status = 'pending' THEN 0 ELSE 1 END, created_at ASC
        LIMIT 1
        `,
        [LOAN_COMPLEXITY_RECOMPUTE_JOB_TYPE],
      );

      if (jobRes.rows.length === 0) return;

      const job = jobRes.rows[0] as {
        id: string;
        status: string;
        cursor_state: {
          last_id?: string | null;
          processed_count?: number;
          failed_count?: number;
        };
      };
      jobIdForFailure = job.id;

      if (job.status === "pending") {
        await client.query(
          `UPDATE public.background_jobs SET status = 'processing', updated_at = NOW() WHERE id = $1`,
          [job.id],
        );
      }

      const cursor = job.cursor_state || {};
      const lastId = cursor.last_id ?? null;
      const bs = batchSize();
      const svc = new LoanComplexityService(pool);
      await svc.loadCustomWeights();

      const sel = await client.query(
        `
        SELECT id,
               loan_type, loan_purpose, loan_amount, fico_score, ltv_ratio, be_dti_ratio,
               occupancy_type, borr_self_employed, co_borr_self_employed, non_qm
        FROM public.loans
        WHERE ($1::uuid IS NULL OR id > $1::uuid)
        ORDER BY id ASC
        LIMIT $2
        `,
        [lastId, bs],
      );

      if (sel.rows.length === 0) {
        await client.query(
          `
          UPDATE public.background_jobs
          SET status = 'completed', completed_at = NOW(), updated_at = NOW()
          WHERE id = $1
          `,
          [job.id],
        );
        logInfo("[LoanComplexity] Bulk recompute job completed", {
          processedTotal: cursor.processed_count ?? 0,
        });
        return;
      }

      const pairs: Array<{ id: string; score: number }> = [];
      let failed = 0;
      for (const row of sel.rows) {
        try {
          const score = svc.calculateComplexity(loanRecordToLoanData(row)).totalScore;
          pairs.push({ id: row.id, score: Math.round(score * 100) / 100 });
        } catch (e: any) {
          failed++;
          logError("[LoanComplexity] Row recompute failed", e, { loanId: row.id });
        }
      }

      if (pairs.length > 0) {
        const parts: string[] = [];
        const params: unknown[] = [];
        let i = 1;
        for (const p of pairs) {
          parts.push(`($${i}::uuid, $${i + 1}::numeric)`);
          params.push(p.id, p.score);
          i += 2;
        }
        await client.query(
          `
          UPDATE public.loans l
          SET complexity_score = v.score
          FROM (VALUES ${parts.join(", ")}) AS v(id, score)
          WHERE l.id = v.id
          `,
          params,
        );
      }

      const newLast = String(sel.rows[sel.rows.length - 1].id);
      const processed = (cursor.processed_count ?? 0) + sel.rows.length;
      const failedTotal = (cursor.failed_count ?? 0) + failed;

      await client.query(
        `
        UPDATE public.background_jobs
        SET cursor_state = $1::jsonb, updated_at = NOW()
        WHERE id = $2
        `,
        [
          JSON.stringify({
            last_id: newLast,
            processed_count: processed,
            failed_count: failedTotal,
          }),
          job.id,
        ],
      );

      if (processed % (bs * 10) < bs || sel.rows.length < bs) {
        logInfo("[LoanComplexity] Recompute progress", {
          processed,
          batchRows: sel.rows.length,
          lastId: newLast,
        });
      }
    } catch (e: any) {
      logError("[LoanComplexity] Job tick failed", e, {});
      if (jobIdForFailure) {
        try {
          await client.query(
            `
            UPDATE public.background_jobs
            SET status = 'failed', error_message = $2, updated_at = NOW()
            WHERE id = $1
            `,
            [jobIdForFailure, String(e?.message ?? e).slice(0, 2000)],
          );
        } catch {
          /* ignore */
        }
      }
    } finally {
      await client.query("SELECT pg_advisory_unlock($1)", [ADVISORY_LOCK_KEY]);
    }
  } finally {
    client.release();
  }
}

export async function tickLoanComplexityJobsAllTenants(
  getPools: () => Promise<Array<{ id: string; pool: pg.Pool }>>,
): Promise<void> {
  const tenants = await getPools();
  for (const t of tenants) {
    try {
      await processLoanComplexityJobsForPool(t.pool);
    } catch (e: any) {
      logWarn("[LoanComplexity] Tenant job tick error", {
        tenantId: t.id,
        message: e?.message,
      });
    }
  }
}

export function startLoanComplexityRecomputeScheduler(
  getPools: () => Promise<Array<{ id: string; pool: pg.Pool }>>,
  intervalMs = 30_000,
): void {
  if (schedulerStarted) return;
  schedulerStarted = true;
  const run = () => {
    tickLoanComplexityJobsAllTenants(getPools).catch((e) =>
      logError("[LoanComplexity] Scheduler tick", e, {}),
    );
  };
  run();
  setInterval(run, intervalMs);
}
