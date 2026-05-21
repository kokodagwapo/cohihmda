/**
 * Idempotency for clientMessageId (COHI-387).
 * Default: Postgres tenant table (multi-instance safe).
 * Set UNIFIED_CHAT_IDEMPOTENCY=memory for single-process dev without migration 129.
 */

import { tenantDbManager } from "../../config/tenantDatabaseManager.js";

const MEMORY_TTL_MS = 10 * 60 * 1000;
const seen = new Map<string, number>();

function memoryGc(): void {
  const now = Date.now();
  for (const [k, t] of seen) {
    if (now - t > MEMORY_TTL_MS) seen.delete(k);
  }
}

function memoryTryReserve(
  tenantId: string,
  userId: string,
  clientMessageId: string,
): "reserved" | "duplicate" {
  memoryGc();
  const key = `${tenantId}:${userId}:${clientMessageId}`;
  const now = Date.now();
  if (seen.has(key)) return "duplicate";
  seen.set(key, now);
  return "reserved";
}

/**
 * Reserve idempotency key before processing (matches legacy in-process semantics).
 * @returns skipped (no key), reserved (first use), duplicate (replay)
 */
export async function tryReserveClientMessageId(
  tenantId: string,
  userId: string,
  clientMessageId: string | undefined,
): Promise<"skipped" | "reserved" | "duplicate"> {
  if (!clientMessageId) return "skipped";
  if (process.env.UNIFIED_CHAT_IDEMPOTENCY === "memory") {
    const m = memoryTryReserve(tenantId, userId, clientMessageId);
    return m === "duplicate" ? "duplicate" : "reserved";
  }
  try {
    const pool = await tenantDbManager.getTenantPool(tenantId);
    const r = await pool.query(
      `
      INSERT INTO public.unified_chat_idempotency_keys (
        tenant_id, user_id, client_message_id, expires_at
      )
      VALUES ($1, $2::uuid, $3::uuid, NOW() + INTERVAL '10 days')
      ON CONFLICT (tenant_id, user_id, client_message_id) DO NOTHING
      RETURNING id
      `,
      [tenantId, userId, clientMessageId],
    );
    if (r.rows.length > 0) return "reserved";
    return "duplicate";
  } catch (e: any) {
    if (e?.code === "42P01") {
      console.warn(
        "[unifiedChatIdempotency] unified_chat_idempotency_keys missing; using in-memory fallback (set UNIFIED_CHAT_IDEMPOTENCY=memory or run tenant migration 129).",
      );
      return memoryTryReserve(tenantId, userId, clientMessageId) === "duplicate"
        ? "duplicate"
        : "reserved";
    }
    throw e;
  }
}
