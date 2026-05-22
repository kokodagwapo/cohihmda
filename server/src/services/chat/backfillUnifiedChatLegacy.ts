/**
 * Idempotent backfill: link research_sessions → unified_chat_conversations (COHI-395).
 * Safe to run on every deploy; skips rows that already have a matching legacy_ref.
 */

import { tenantDbManager } from "../../config/tenantDatabaseManager.js";

export interface BackfillUnifiedChatLegacyResult {
  tenantId: string;
  inserted: number;
  skipped: number;
  total: number;
  skippedReason?: string;
}

async function tableExists(
  pool: { query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }> },
  tableName: string,
): Promise<boolean> {
  const r = await pool.query(
    `
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = $1
    LIMIT 1
    `,
    [tableName],
  );
  return r.rows.length > 0;
}

export async function backfillUnifiedChatLegacyForTenant(
  tenantId: string,
): Promise<BackfillUnifiedChatLegacyResult> {
  const pool = await tenantDbManager.getTenantPool(tenantId);

  if (!(await tableExists(pool, "research_sessions"))) {
    return {
      tenantId,
      inserted: 0,
      skipped: 0,
      total: 0,
      skippedReason: "research_sessions table missing",
    };
  }

  if (!(await tableExists(pool, "unified_chat_conversations"))) {
    return {
      tenantId,
      inserted: 0,
      skipped: 0,
      total: 0,
      skippedReason: "unified_chat_conversations table missing",
    };
  }

  const sessions = await pool.query(
    `SELECT id, user_id, topic, created_at, updated_at FROM public.research_sessions ORDER BY created_at ASC`,
  );

  let inserted = 0;
  let skipped = 0;

  for (const s of sessions.rows as Array<{
    id: string;
    user_id: string;
    topic: string | null;
    created_at: Date | string;
    updated_at: Date | string | null;
  }>) {
    const exists = await pool.query(
      `SELECT 1 FROM public.unified_chat_conversations WHERE legacy_ref = $1 AND user_id = $2::uuid LIMIT 1`,
      [s.id, s.user_id],
    );
    if (exists.rows.length > 0) {
      skipped++;
      continue;
    }
    await pool.query(
      `INSERT INTO public.unified_chat_conversations (
        user_id, scope_type, scope_key, title, chat_type, legacy_ref, legacy_source, messages, created_at, updated_at
      ) VALUES ($1::uuid, 'global_session', NULL, $2, 'research', $3, 'research_lab', '[]'::jsonb, $4, $5)`,
      [
        s.user_id,
        (s.topic || "Research").slice(0, 200),
        s.id,
        s.created_at,
        s.updated_at ?? s.created_at,
      ],
    );
    inserted++;
  }

  return {
    tenantId,
    inserted,
    skipped,
    total: sessions.rows.length,
  };
}
