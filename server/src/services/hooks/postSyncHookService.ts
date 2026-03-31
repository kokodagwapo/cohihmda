/**
 * Post-Sync Hook Service
 *
 * Registry-based hook system that runs registered callbacks after
 * a successful data sync (Encompass ETL, generic API, CSV).
 * Hooks run asynchronously and do not block sync completion.
 *
 * Each hook run is persisted to `post_sync_hook_runs` in the tenant DB,
 * giving platform admins visibility into the full post-sync pipeline.
 */

import { logAlways, logError } from "../logger.js";

export interface PostSyncContext {
  tenantId: string;
  tenantPool: import("pg").Pool;
  connectionId: string;
  syncType: "encompass" | "api" | "csv";
  recordsSynced: number;
  loansAdded?: number;
  loansUpdated?: number;
  /** ID of the los_sync_history row that triggered this hook run (optional). */
  syncHistoryId?: number;
}

type PostSyncHookFn = (ctx: PostSyncContext) => Promise<void>;

interface RegisteredHook {
  name: string;
  fn: PostSyncHookFn;
  priority: number; // lower = runs first
}

const hooks: RegisteredHook[] = [];

/**
 * Register a hook to run after data sync completes.
 * Hooks are sorted by priority (ascending) before execution.
 */
export function registerPostSyncHook(
  name: string,
  fn: PostSyncHookFn,
  priority = 100
): void {
  hooks.push({ name, fn, priority });
  hooks.sort((a, b) => a.priority - b.priority);
  logAlways(`[PostSyncHooks] Registered hook: ${name} (priority ${priority})`);
}

/** Insert a pending hook run row and return its id. */
async function insertHookRun(
  ctx: PostSyncContext,
  hookName: string
): Promise<number | null> {
  try {
    const result = await ctx.tenantPool.query(
      `INSERT INTO public.post_sync_hook_runs
         (sync_history_id, los_connection_id, tenant_id, hook_name, status, started_at)
       VALUES ($1, $2, $3, $4, 'running', NOW())
       RETURNING id`,
      [ctx.syncHistoryId ?? null, ctx.connectionId, ctx.tenantId, hookName]
    );
    return Number(result.rows[0]?.id);
  } catch (err: any) {
    logAlways(`[PostSyncHooks] insertHookRun failed for "${hookName}" (tenant=${ctx.tenantId}): ${err?.message ?? err}`);
    return null;
  }
}

/** Mark a hook run row as completed. */
async function completeHookRun(
  ctx: PostSyncContext,
  runId: number,
  durationMs: number,
  metadata?: Record<string, unknown>
): Promise<void> {
  try {
    await ctx.tenantPool.query(
      `UPDATE public.post_sync_hook_runs
       SET status = 'completed',
           completed_at = NOW(),
           duration_ms = $2,
           metadata = $3
       WHERE id = $1`,
      [runId, durationMs, JSON.stringify(metadata ?? {})]
    );
  } catch {
    // Best-effort; don't fail the hook for a tracking error
  }
}

/** Mark a hook run row as failed. */
async function failHookRun(
  ctx: PostSyncContext,
  runId: number,
  durationMs: number,
  errorMessage: string
): Promise<void> {
  try {
    await ctx.tenantPool.query(
      `UPDATE public.post_sync_hook_runs
       SET status = 'failed',
           completed_at = NOW(),
           duration_ms = $2,
           error_message = $3
       WHERE id = $1`,
      [runId, durationMs, errorMessage.slice(0, 2000)]
    );
  } catch {
    // Best-effort
  }
}

/**
 * Run all registered post-sync hooks.
 * Each hook runs independently — a failure in one does not block others.
 * Each hook run is persisted to post_sync_hook_runs for admin visibility.
 */
export async function runPostSyncHooks(ctx: PostSyncContext): Promise<void> {
  if (hooks.length === 0) return;

  logAlways(
    `[PostSyncHooks] Running ${hooks.length} hook(s) for tenant=${ctx.tenantId}, ` +
      `connection=${ctx.connectionId}, synced=${ctx.recordsSynced}`
  );

  for (const hook of hooks) {
    const runId = await insertHookRun(ctx, hook.name);
    if (runId === null) {
      logAlways(`[PostSyncHooks] Hook "${hook.name}" running without DB tracking (insertHookRun returned null)`);
    }
    const start = Date.now();

    try {
      await hook.fn(ctx);
      const duration = Date.now() - start;
      logAlways(
        `[PostSyncHooks] Hook "${hook.name}" completed in ${duration}ms for tenant=${ctx.tenantId}`
      );
      if (runId !== null) {
        await completeHookRun(ctx, runId, duration);
      }
    } catch (err: any) {
      const duration = Date.now() - start;
      logError(
        `[PostSyncHooks] Hook "${hook.name}" failed: ${err.message}`,
        err
      );
      if (runId !== null) {
        await failHookRun(ctx, runId, duration, err.message ?? "Unknown error");
      }
    }
  }
}

/**
 * Get the list of registered hook names (for diagnostics).
 */
export function getRegisteredHooks(): string[] {
  return hooks.map((h) => h.name);
}
