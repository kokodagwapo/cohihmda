import { pool as managementPool } from "../config/managementDatabase.js";
import { tenantDbManager } from "../config/tenantDatabaseManager.js";
import {
  getPlatformSetting,
  setPlatformSetting,
} from "./platformSettingsService.js";

const POLL_INTERVAL_MS = Math.max(
  10_000,
  Number(process.env.ALETHEIA_PREFETCH_POLL_MS || 60_000)
);
const MAX_JOBS_PER_TICK = Math.max(
  1,
  Number(process.env.ALETHEIA_PREFETCH_MAX_JOBS_PER_TICK || 2)
);
const NIGHTLY_HOUR_UTC = Math.max(
  0,
  Math.min(23, Number(process.env.ALETHEIA_NIGHTLY_PREFETCH_HOUR_UTC || 2))
);
const NIGHTLY_ENABLED_KEY = "aletheia_nightly_prefetch_enabled";
const NIGHTLY_LAST_RUN_KEY = "aletheia_nightly_prefetch_last_run_at";

let pollTimer: ReturnType<typeof setInterval> | null = null;
let isTickRunning = false;
let nightlyRunStamp = "";

function isPrefetchWorkerEnabled(): boolean {
  return process.env.ALETHEIA_PREFETCH_WORKER_ENABLED === "true";
}

type ClaimedJob = {
  id: number;
  tenantId: string;
  contextHash: string;
  briefingContext: any;
};

export async function enqueueAletheiaPrefetchJob(input: {
  tenantId: string;
  contextHash: string;
  briefingContext: unknown;
  requestedBy?: string;
}): Promise<number> {
  const tenantPool = await tenantDbManager.getTenantPool(input.tenantId);
  const result = await tenantPool.query(
    `INSERT INTO public.podcast_prefetch_jobs (
        job_type, context_hash, briefing_context, status, requested_by, run_after
     ) VALUES (
        'aletheia_briefing', $1, $2::jsonb, 'pending', $3, NOW()
     )
     RETURNING id`,
    [
      input.contextHash,
      JSON.stringify(input.briefingContext ?? {}),
      input.requestedBy || null,
    ]
  );
  return Number(result.rows[0].id);
}

async function listActiveTenantIds(): Promise<string[]> {
  const result = await managementPool.query(
    `SELECT id
     FROM coheus_tenants
     WHERE status = 'active'
     ORDER BY id ASC`
  );
  return result.rows.map((row: any) => row.id);
}

async function claimOnePendingJob(tenantId: string): Promise<ClaimedJob | null> {
  const tenantPool = await tenantDbManager.getTenantPool(tenantId);
  const client = await tenantPool.connect();

  try {
    await client.query("BEGIN");
    const claim = await client.query(
      `SELECT id, context_hash, briefing_context
       FROM public.podcast_prefetch_jobs
       WHERE status = 'pending'
         AND run_after <= NOW()
       ORDER BY created_at ASC
       FOR UPDATE SKIP LOCKED
       LIMIT 1`
    );
    if (!claim.rows.length) {
      await client.query("COMMIT");
      return null;
    }

    const row = claim.rows[0];
    await client.query(
      `UPDATE public.podcast_prefetch_jobs
       SET status = 'processing',
           started_at = NOW(),
           attempt_count = attempt_count + 1
       WHERE id = $1`,
      [row.id]
    );
    await client.query("COMMIT");

    return {
      id: Number(row.id),
      tenantId,
      contextHash: String(row.context_hash),
      briefingContext: row.briefing_context || {},
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function completeJob(tenantId: string, jobId: number): Promise<void> {
  const tenantPool = await tenantDbManager.getTenantPool(tenantId);
  await tenantPool.query(
    `UPDATE public.podcast_prefetch_jobs
     SET status = 'completed',
         completed_at = NOW(),
         error_message = NULL
     WHERE id = $1`,
    [jobId]
  );
}

async function failJob(
  tenantId: string,
  jobId: number,
  errorMessage: string
): Promise<void> {
  const tenantPool = await tenantDbManager.getTenantPool(tenantId);
  await tenantPool.query(
    `UPDATE public.podcast_prefetch_jobs
     SET status = CASE WHEN attempt_count >= 3 THEN 'failed' ELSE 'pending' END,
         error_message = $2,
         run_after = CASE WHEN attempt_count >= 3 THEN run_after ELSE NOW() + INTERVAL '5 minutes' END
     WHERE id = $1`,
    [jobId, errorMessage.slice(0, 2000)]
  );
}

async function processOneJob(job: ClaimedJob): Promise<void> {
  const mod = await import("../routes/podcast.js");
  await mod.prefetchAletheiaBriefing(job.tenantId, job.briefingContext);
}

async function maybeRunNightlyPrefetch(tenantIds: string[]): Promise<void> {
  const enabledValue = (await getPlatformSetting(NIGHTLY_ENABLED_KEY)) || "false";
  if (enabledValue.toLowerCase() !== "true") return;

  const now = new Date();
  if (now.getUTCHours() !== NIGHTLY_HOUR_UTC) return;

  const runStamp = now.toISOString().slice(0, 10);
  if (nightlyRunStamp === runStamp) return;
  nightlyRunStamp = runStamp;

  const mod = await import("../routes/podcast.js");
  let queuedCount = 0;

  for (const tenantId of tenantIds) {
    try {
      const briefingContext = await mod.buildDefaultAletheiaBriefingContext(tenantId);
      const contextHash = mod.hashBriefingContext(briefingContext);
      await enqueueAletheiaPrefetchJob({
        tenantId,
        contextHash,
        briefingContext,
        requestedBy: "nightly-worker",
      });
      queuedCount += 1;
    } catch (error: any) {
      console.warn(
        `[AletheiaPrefetchWorker] Nightly enqueue failed for tenant ${tenantId}:`,
        error?.message || error
      );
    }
  }

  await setPlatformSetting(NIGHTLY_LAST_RUN_KEY, new Date().toISOString());
  console.log(
    `[AletheiaPrefetchWorker] Nightly prefetch enqueued for ${queuedCount}/${tenantIds.length} tenants`
  );
}

async function pollOnce(): Promise<void> {
  if (isTickRunning) return;
  isTickRunning = true;

  try {
    const tenantIds = await listActiveTenantIds();
    await maybeRunNightlyPrefetch(tenantIds);
    let processed = 0;

    for (const tenantId of tenantIds) {
      if (processed >= MAX_JOBS_PER_TICK) break;
      const job = await claimOnePendingJob(tenantId);
      if (!job) continue;

      try {
        await processOneJob(job);
        await completeJob(job.tenantId, job.id);
        processed += 1;
      } catch (error: any) {
        await failJob(job.tenantId, job.id, error?.message || "Prefetch job failed");
      }
    }
  } catch (error) {
    console.warn("[AletheiaPrefetchWorker] Poll failed:", error);
  } finally {
    isTickRunning = false;
  }
}

export function startAletheiaPrefetchWorker(): void {
  if (!isPrefetchWorkerEnabled() || pollTimer) return;
  console.log(
    `[AletheiaPrefetchWorker] Starting poller (interval=${POLL_INTERVAL_MS}ms, maxJobsPerTick=${MAX_JOBS_PER_TICK})`
  );
  pollTimer = setInterval(() => {
    void pollOnce();
  }, POLL_INTERVAL_MS);
  void pollOnce();
}

