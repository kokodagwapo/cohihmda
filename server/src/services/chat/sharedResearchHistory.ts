/**
 * Materialize shared research_sessions as viewer-owned unified_chat_conversations
 * (unified research chat history — not legacy dual-read sessions).
 */

import { tenantDbManager } from "../../config/tenantDatabaseManager.js";
import {
  canAccessSession,
  loadSession,
  researchUserIdsEqual,
} from "../research/orchestrator.js";
import { ensureTenantUserRow } from "./tenantUserEnsure.js";
import { formatUserDisplayName } from "../../utils/userDisplayName.js";
import type { CanonicalHistoryRow } from "./historyRepository.js";
import {
  createUnifiedConversation,
  findUnifiedConversationByLegacyRef,
} from "./unifiedConversationService.js";

const SHARED_SESSIONS_SQL = `
  SELECT
    rs.id,
    rs.topic,
    rs.phase,
    rs.user_email,
    u.full_name AS owner_full_name,
    rs.created_at,
    rs.updated_at
  FROM public.research_sessions rs
  LEFT JOIN public.users u ON u.id = rs.user_id
  WHERE rs.user_id::text != $1::text
    AND (
      rs.visibility = 'global'
      OR (
        rs.visibility = 'shared'
        AND EXISTS (
          SELECT 1
          FROM unnest(COALESCE(rs.shared_with_user_ids, ARRAY[]::uuid[])) AS uid
          WHERE uid::text = $1::text
        )
      )
    )
  ORDER BY rs.updated_at DESC
  LIMIT 50
`;

function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  return new Date().toISOString();
}

function deriveTitle(topic: string | null | undefined, phase: string | null | undefined): string {
  const t = topic?.trim();
  if (t) return t.slice(0, 200);
  if (!phase) return "Research";
  return `Research (${phase})`;
}

export async function ensureSharedResearchConversation(args: {
  tenantId: string;
  viewerId: string;
  viewerEmail?: string | null;
  researchSessionId: string;
}): Promise<string | null> {
  const pool = await tenantDbManager.getTenantPool(args.tenantId);
  const session = await loadSession(args.researchSessionId, pool, { refresh: true });
  if (!session || !canAccessSession(session, args.viewerId)) {
    return null;
  }
  if (researchUserIdsEqual(session.userId, args.viewerId)) {
    const existing = await findUnifiedConversationByLegacyRef({
      tenantId: args.tenantId,
      userId: args.viewerId,
      legacyRef: args.researchSessionId,
    });
    return existing?.id ?? null;
  }

  const existing = await findUnifiedConversationByLegacyRef({
    tenantId: args.tenantId,
    userId: args.viewerId,
    legacyRef: args.researchSessionId,
  });
  if (existing) return existing.id;

  const userOk = await ensureTenantUserRow(pool, args.viewerId, args.viewerEmail);
  if (!userOk) {
    console.warn(
      `[sharedResearchHistory] viewer ${args.viewerId} not in tenant users; cannot materialize session ${args.researchSessionId}`,
    );
    return null;
  }

  const conversationId = await createUnifiedConversation({
    tenantId: args.tenantId,
    userId: args.viewerId,
    scopeType: "global_session",
    scopeKey: null,
    chatType: "research",
    title: deriveTitle(session.topic, session.phase),
    legacyRef: args.researchSessionId,
    legacySource: "research_lab",
    folderId: null,
  });
  return conversationId;
}

async function loadSharedResearchSessionRows(
  tenantId: string,
  viewerId: string,
): Promise<
  Array<{
    id: string;
    topic: string | null;
    phase: string | null;
    user_email: string | null;
    owner_full_name: string | null;
    created_at: unknown;
    updated_at: unknown;
  }>
> {
  const pool = await tenantDbManager.getTenantPool(tenantId);
  try {
    const result = await pool.query(SHARED_SESSIONS_SQL, [viewerId]);
    return result.rows;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("visibility") && message.includes("does not exist")) {
      console.warn(
        "[sharedResearchHistory] visibility column missing — run migration 064_research_session_sharing.sql",
      );
      return [];
    }
    throw err;
  }
}

export async function listSharedResearchHistoryRows(args: {
  tenantId: string;
  userId: string;
  userEmail?: string | null;
}): Promise<CanonicalHistoryRow[]> {
  const sessions = await loadSharedResearchSessionRows(
    args.tenantId,
    args.userId,
  );
  const rows: CanonicalHistoryRow[] = [];

  for (const row of sessions) {
    let conversationId: string | null = null;
    try {
      conversationId = await ensureSharedResearchConversation({
        tenantId: args.tenantId,
        viewerId: args.userId,
        viewerEmail: args.userEmail,
        researchSessionId: row.id,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(
        `[sharedResearchHistory] materialize failed session=${row.id} viewer=${args.userId}:`,
        message,
      );
    }

    rows.push({
      conversation_id: conversationId ?? row.id,
      title: deriveTitle(row.topic, row.phase),
      chat_type: "research",
      scope_type: "global_session",
      scope_key: null,
      updated_at: toIso(row.updated_at),
      created_at: toIso(row.created_at),
      legacy_source: "research_lab",
      legacy_ref: row.id,
      folder_id: null,
      phase: row.phase ?? null,
      is_shared_view: true,
      shared_by_email: row.user_email ?? null,
      shared_by_name: formatUserDisplayName(
        row.owner_full_name,
        row.user_email,
      ),
    });
  }

  if (sessions.length > 0 && rows.length === 0) {
    console.warn(
      `[sharedResearchHistory] ${sessions.length} shared session(s) found but none materialized for viewer=${args.userId} tenant=${args.tenantId}`,
    );
  } else if (sessions.length > 0) {
    console.log(
      `[sharedResearchHistory] listed ${rows.length}/${sessions.length} shared research row(s) for viewer=${args.userId}`,
    );
  }

  return rows;
}
