/**
 * Idempotent backfill: link research_sessions → unified_chat_conversations (COHI-395).
 * Safe to run on every deploy; skips rows that already have a matching legacy_ref.
 * Skips orphan sessions whose user_id is not in public.users (no FK on research_sessions).
 */

import { tenantDbManager } from "../../config/tenantDatabaseManager.js";

export interface BackfillUnifiedChatLegacyResult {
  tenantId: string;
  inserted: number;
  skipped: number;
  orphaned: number;
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
      orphaned: 0,
      total: 0,
      skippedReason: "research_sessions table missing",
    };
  }

  if (!(await tableExists(pool, "unified_chat_conversations"))) {
    return {
      tenantId,
      inserted: 0,
      skipped: 0,
      orphaned: 0,
      total: 0,
      skippedReason: "unified_chat_conversations table missing",
    };
  }

  const totalResult = await pool.query(
    `SELECT COUNT(*)::int AS count FROM public.research_sessions`,
  );
  const total = (totalResult.rows[0] as { count: number }).count;

  const orphanResult = await pool.query(
    `
    SELECT COUNT(*)::int AS count
    FROM public.research_sessions rs
    LEFT JOIN public.users u ON u.id = rs.user_id
    WHERE u.id IS NULL
    `,
  );
  const orphaned = (orphanResult.rows[0] as { count: number }).count;

  const sessions = await pool.query(
    `
    SELECT rs.id, rs.user_id, rs.topic, rs.created_at, rs.updated_at
    FROM public.research_sessions rs
    INNER JOIN public.users u ON u.id = rs.user_id
    ORDER BY rs.created_at ASC
    `,
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

  if (orphaned > 0) {
    console.warn(
      `[backfillUnifiedChatLegacy] tenant=${tenantId} skipped ${orphaned} orphan research_sessions (user_id not in users)`,
    );
  }

  return {
    tenantId,
    inserted,
    skipped,
    orphaned,
    total,
  };
}
