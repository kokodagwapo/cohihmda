/**
 * Unified history dual-read adapter (COHI-395 / meeting spec §11.3, COHI-402).
 * When UNIFIED_CHAT_HISTORY_DUAL_READ=true, merges legacy `research_sessions`
 * rows into the canonical list and dedupes against unified rows by `legacy_ref`.
 */

import { tenantDbManager } from "../../config/tenantDatabaseManager.js";
import type { UnifiedConversationChatType } from "./unifiedConversationService.js";
import { listUnifiedConversations } from "./unifiedConversationService.js";
import { listUnifiedChatFolders } from "./unifiedChatFolderService.js";
import { listSharedResearchHistoryRows } from "./sharedResearchHistory.js";

export interface CanonicalHistoryRow {
  conversation_id: string;
  title: string;
  chat_type: UnifiedConversationChatType;
  scope_type?: string | null;
  scope_key?: string | null;
  updated_at: string;
  created_at?: string | null;
  legacy_source?: string | null;
  legacy_ref?: string | null;
  folder_id?: string | null;
  parent_conversation_id?: string | null;
  forked_to_conversation_id?: string | null;
  conversation_origin?: string | null;
  /** Research Lab session phase when row comes from dual-read legacy list. */
  phase?: string | null;
  /** Viewer opened someone else's shared research (unified row, not dual-read). */
  is_shared_view?: boolean;
  shared_by_email?: string | null;
  shared_by_name?: string | null;
}

export interface HistoryListQuery {
  tenantId: string;
  userId: string;
  userEmail?: string | null;
  scopeType?: string;
  scopeKey?: string | null;
  chatType?: UnifiedConversationChatType;
  search?: string;
  limit?: number;
  offset?: number;
  folderId?: string;
  includeSubfolders?: boolean;
  /** When true, return only materialized shared research conversations for the viewer. */
  sharedWithMe?: boolean;
}

function isDualReadEnabled(): boolean {
  return process.env.UNIFIED_CHAT_HISTORY_DUAL_READ === "true";
}

/**
 * Loads unified conversation rows. When dual-read is on, also pulls Research
 * sessions that were created before the unified write path existed (no matching
 * `unified_chat_conversations.legacy_ref`) so they still show up in the
 * unified history UI per meeting spec §7.3.
 */
export async function listCanonicalHistory(
  query: HistoryListQuery,
): Promise<CanonicalHistoryRow[]> {
  if (query.sharedWithMe) {
    return listSharedResearchHistoryRows({
      tenantId: query.tenantId,
      userId: query.userId,
      userEmail: query.userEmail,
    });
  }

  let folderIds: string[] | undefined;
  if (query.folderId) {
    const folders = await listUnifiedChatFolders({
      tenantId: query.tenantId,
      userId: query.userId,
    });
    const includeSubfolders = query.includeSubfolders !== false;
    if (includeSubfolders) {
      const blocked = new Set<string>([query.folderId]);
      const byParent = new Map<string, typeof folders>();
      for (const folder of folders) {
        if (!folder.parent_id) continue;
        const siblings = byParent.get(folder.parent_id) ?? [];
        siblings.push(folder);
        byParent.set(folder.parent_id, siblings);
      }
      const walk = (id: string) => {
        for (const child of byParent.get(id) ?? []) {
          blocked.add(child.id);
          walk(child.id);
        }
      };
      walk(query.folderId);
      folderIds = [...blocked];
    } else {
      folderIds = [query.folderId];
    }
  }

  const unified = await listUnifiedConversations({
    tenantId: query.tenantId,
    userId: query.userId,
    scopeType: query.scopeType,
    scopeKey: query.scopeKey,
    chatType: query.chatType,
    search: query.search,
    limit: query.limit,
    offset: query.offset,
    folderIds,
  });

  const rows: CanonicalHistoryRow[] = unified.map((r) => ({
    conversation_id: r.id,
    title: r.title,
    chat_type: r.chat_type,
    scope_type: r.scope_type,
    scope_key: r.scope_key,
    updated_at: r.updated_at,
    created_at: r.created_at,
    legacy_source: r.legacy_source,
    legacy_ref: r.legacy_ref,
    folder_id: r.folder_id,
    parent_conversation_id: r.parent_conversation_id ?? null,
    forked_to_conversation_id: r.forked_to_conversation_id ?? null,
    conversation_origin: r.conversation_origin ?? null,
  }));

  // Dual-read legacy rows have no folder_id and ignore SQL filters; skip when narrowed.
  const skipDualRead =
    Boolean(query.folderId) ||
    Boolean(query.search?.trim()) ||
    Boolean(query.scopeType) ||
    (query.chatType != null && query.chatType !== "research");

  let merged = rows;

  if (isDualReadEnabled() && !skipDualRead) {
    const legacyResearch = await loadLegacyResearchRows(
      query.tenantId,
      query.userId,
    ).catch((err: any) => {
      console.warn(
        "[historyRepository] legacy research load failed:",
        err?.message ?? err,
      );
      return [] as CanonicalHistoryRow[];
    });
    merged = mergeHistoryRows(merged, legacyResearch);
  }

  return merged;
}

/**
 * Query `research_sessions` for the user and normalize each row into a
 * canonical history shape. The unified row (if any) wins on dedupe because we
 * iterate unified first in {@link mergeHistoryRows}.
 */
async function loadLegacyResearchRows(
  tenantId: string,
  userId: string,
): Promise<CanonicalHistoryRow[]> {
  const pool = await tenantDbManager.getTenantPool(tenantId);
  // research_sessions.user_id is UUID; tolerate text/UUID mismatch
  const result = await pool.query(
    `
    SELECT id, topic, phase, created_at, updated_at
    FROM public.research_sessions
    WHERE user_id::text = $1::text
    ORDER BY updated_at DESC
    LIMIT 200
    `,
    [userId],
  );
  return result.rows.map((row: any) => ({
    conversation_id: row.id, // synthetic: legacy session id stands in until backfill
    title: (row.topic as string | null) ?? deriveTitleFromPhase(row.phase),
    chat_type: "research" as const,
    scope_type: "global_session",
    scope_key: null,
    updated_at: toIso(row.updated_at),
    created_at: toIso(row.created_at),
    legacy_source: "research_lab",
    legacy_ref: row.id,
    folder_id: null,
    phase: (row.phase as string | null) ?? null,
  }));
}

function deriveTitleFromPhase(phase: string | null | undefined): string {
  if (!phase) return "Research";
  return `Research (${phase})`;
}

function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "toISOString" in value) {
    try {
      return (value as { toISOString: () => string }).toISOString();
    } catch {
      /* fall through */
    }
  }
  return new Date().toISOString();
}

/**
 * Merge unified + legacy rows. A legacy row whose `id` already appears as
 * `legacy_ref` on a unified row is dropped (unified wins) so backfilled rows
 * don't double up. Result is sorted by `updated_at` desc.
 */
export function mergeHistoryRows(
  unified: CanonicalHistoryRow[],
  legacy: CanonicalHistoryRow[],
): CanonicalHistoryRow[] {
  const byKey = new Map<string, CanonicalHistoryRow>();
  for (const r of unified) {
    const key = r.legacy_ref ? `legacy:${r.legacy_ref}` : `id:${r.conversation_id}`;
    byKey.set(key, r);
  }
  for (const r of legacy) {
    const key = r.legacy_ref ? `legacy:${r.legacy_ref}` : `id:${r.conversation_id}`;
    if (!byKey.has(key)) byKey.set(key, r);
  }
  return Array.from(byKey.values()).sort(
    (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
  );
}
