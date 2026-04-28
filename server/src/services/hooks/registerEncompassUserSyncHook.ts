/**
 * COHI-351: After successful Encompass loan sync, refresh Encompass user cache
 * (encompass_users) when enabled on the connection. Runs before insight hooks (priority 15).
 */

import { registerPostSyncHook, type PostSyncContext } from "./postSyncHookService.js";
import { createEncompassUserSyncService } from "../encompassUserSyncService.js";
import { logInfo, logWarn } from "../logger.js";

let registered = false;

export async function runEncompassUserCacheSyncHook(ctx: PostSyncContext): Promise<void> {
  if (ctx.syncType !== "encompass") return;

  let encompassUsersSyncEnabled = true;
  let lastUsersSyncAt: Date | null = null;
  try {
    const policy = await ctx.tenantPool.query(
      `SELECT encompass_users_sync_enabled, last_encompass_users_sync_at
       FROM public.los_connections
       WHERE id = $1`,
      [ctx.connectionId],
    );
    const row = policy.rows[0];
    encompassUsersSyncEnabled = row?.encompass_users_sync_enabled ?? true;
    lastUsersSyncAt = row?.last_encompass_users_sync_at
      ? new Date(row.last_encompass_users_sync_at)
      : null;
  } catch (err: any) {
    logWarn("[PostSyncHook] Could not read encompass user sync policy; skipping", {
      connectionId: ctx.connectionId,
      message: err?.message,
    });
    return;
  }

  if (!encompassUsersSyncEnabled) {
    logInfo(
      `[PostSyncHook] Encompass user cache sync disabled for connection ${ctx.connectionId} — skipping`,
    );
    return;
  }

  const minHoursRaw = process.env.ENCOMPASS_USER_SYNC_MIN_INTERVAL_HOURS ?? "0";
  const minHours = parseFloat(minHoursRaw);
  if (
    Number.isFinite(minHours) &&
    minHours > 0 &&
    ctx.trigger === "scheduled" &&
    lastUsersSyncAt
  ) {
    const elapsedMs = Date.now() - lastUsersSyncAt.getTime();
    if (elapsedMs < minHours * 3600000) {
      logInfo(
        `[PostSyncHook] Encompass user cache sync throttled (scheduled, min ${minHours}h) for connection ${ctx.connectionId}`,
      );
      return;
    }
  }

  try {
    const svc = createEncompassUserSyncService(ctx.tenantPool, ctx.tenantId);
    const result = await svc.syncUsers(ctx.connectionId);
    if (result.success) {
      await ctx.tenantPool
        .query(
          `UPDATE public.los_connections
           SET last_encompass_users_sync_at = NOW(), updated_at = NOW()
           WHERE id = $1`,
          [ctx.connectionId],
        )
        .catch(() => {});
    } else {
      logWarn("[PostSyncHook] Encompass user cache sync completed unsuccessfully (loan sync unaffected)", {
        connectionId: ctx.connectionId,
        error: result.error,
      });
    }
  } catch (err: any) {
    logWarn("[PostSyncHook] Encompass user cache sync failed (loan sync unaffected)", {
      connectionId: ctx.connectionId,
      message: err?.message ?? err,
    });
  }
}

export function registerEncompassUserSyncHook(): void {
  if (registered) return;
  registered = true;

  registerPostSyncHook(
    "encompass-user-cache-sync",
    runEncompassUserCacheSyncHook,
    15,
  );
}
