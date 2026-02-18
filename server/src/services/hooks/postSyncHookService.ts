/**
 * Post-Sync Hook Service
 *
 * Registry-based hook system that runs registered callbacks after
 * a successful data sync (Encompass ETL, generic API, CSV).
 * Hooks run asynchronously and do not block sync completion.
 */

import { logInfo, logError, logWarn } from "../logger.js";

export interface PostSyncContext {
  tenantId: string;
  tenantPool: import("pg").Pool;
  connectionId: string;
  syncType: "encompass" | "api" | "csv";
  recordsSynced: number;
  loansAdded?: number;
  loansUpdated?: number;
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
  logInfo(`[PostSyncHooks] Registered hook: ${name} (priority ${priority})`);
}

/**
 * Run all registered post-sync hooks.
 * Each hook runs independently — a failure in one does not block others.
 */
export async function runPostSyncHooks(ctx: PostSyncContext): Promise<void> {
  if (hooks.length === 0) return;

  logInfo(
    `[PostSyncHooks] Running ${hooks.length} hook(s) for tenant=${ctx.tenantId}, ` +
      `connection=${ctx.connectionId}, synced=${ctx.recordsSynced}`
  );

  for (const hook of hooks) {
    try {
      const start = Date.now();
      await hook.fn(ctx);
      logInfo(
        `[PostSyncHooks] Hook "${hook.name}" completed in ${Date.now() - start}ms`
      );
    } catch (err: any) {
      logError(
        `[PostSyncHooks] Hook "${hook.name}" failed: ${err.message}`,
        err
      );
    }
  }
}

/**
 * Get the list of registered hook names (for diagnostics).
 */
export function getRegisteredHooks(): string[] {
  return hooks.map((h) => h.name);
}
