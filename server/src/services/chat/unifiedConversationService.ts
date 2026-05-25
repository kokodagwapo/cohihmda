/**
 * Persistence for /api/chat/v1 threads (tenant DB).
 */

import { randomUUID } from "crypto";
import { tenantDbManager } from "../../config/tenantDatabaseManager.js";

export type UnifiedConversationChatType =
  | "chat"
  | "research"
  | "insight_builder"
  | "workbench";

export interface UnifiedChatTurnRecord {
  role: "user" | "assistant";
  content?: string;
  blocks?: unknown[];
  /** Turn-level metadata (e.g. insightBuilderPhase) for history restore. */
  metadata?: Record<string, unknown>;
  turnId?: string;
  at: string;
}

export type UnifiedLegacySource = "cohi_chat" | "research_lab" | string;

export interface UnifiedConversationListRow {
  id: string;
  title: string;
  scope_type: string;
  scope_key: string | null;
  chat_type: UnifiedConversationChatType;
  legacy_ref: string | null;
  legacy_source: string | null;
  folder_id: string | null;
  parent_conversation_id?: string | null;
  forked_to_conversation_id?: string | null;
  conversation_origin?: string | null;
  created_at: string;
  updated_at: string;
}

export interface UnifiedConversationDetail extends UnifiedConversationListRow {
  messages: unknown[];
}

async function ensureTable(tenantId: string): Promise<boolean> {
  try {
    const pool = await tenantDbManager.getTenantPool(tenantId);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS public.unified_chat_conversations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
        scope_type TEXT NOT NULL DEFAULT 'global_session',
        scope_key TEXT,
        title TEXT NOT NULL DEFAULT 'Chat',
        messages JSONB NOT NULL DEFAULT '[]'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await pool.query(`
      ALTER TABLE public.unified_chat_conversations
        ADD COLUMN IF NOT EXISTS chat_type TEXT NOT NULL DEFAULT 'chat',
        ADD COLUMN IF NOT EXISTS legacy_ref TEXT,
        ADD COLUMN IF NOT EXISTS legacy_source TEXT,
        ADD COLUMN IF NOT EXISTS folder_id UUID,
        ADD COLUMN IF NOT EXISTS parent_conversation_id UUID,
        ADD COLUMN IF NOT EXISTS forked_to_conversation_id UUID,
        ADD COLUMN IF NOT EXISTS conversation_origin TEXT
    `);
    return true;
  } catch (e: any) {
    console.warn("[unifiedConversation] ensureTable:", e.message);
    return false;
  }
}

/**
 * Append user + assistant turns to a conversation (upsert first segment on create).
 */
export async function appendUnifiedChatTurns(args: {
  tenantId: string;
  userId: string;
  conversationId: string;
  userMessage: string;
  assistantBlocks: unknown[];
  assistantMetadata?: Record<string, unknown>;
  assistantTurnId: string;
  scopeType?: string;
  scopeKey?: string | null;
  chatType?: UnifiedConversationChatType;
  legacyRef?: string | null;
  legacySource?: string | null;
  carryOverContext?: {
    fromConversationId: string;
    fromChatType?: string;
    fromTitle?: string;
    summary: string;
  } | null;
}): Promise<void> {
  const ok = await ensureTable(args.tenantId);
  if (!ok) return;

  const pool = await tenantDbManager.getTenantPool(args.tenantId);
  const chatType = args.chatType ?? "chat";
  const userTurn: UnifiedChatTurnRecord = {
    role: "user",
    content: args.userMessage,
    at: new Date().toISOString(),
  };
  const assistantTurn: UnifiedChatTurnRecord = {
    role: "assistant",
    blocks: args.assistantBlocks,
    ...(args.assistantMetadata && Object.keys(args.assistantMetadata).length > 0
      ? { metadata: args.assistantMetadata }
      : {}),
    turnId: args.assistantTurnId,
    at: new Date().toISOString(),
  };
  const chunk = JSON.stringify([userTurn, assistantTurn]);

  const exists = await pool.query(
    `SELECT 1 FROM public.unified_chat_conversations WHERE id = $1::uuid AND user_id = $2::uuid LIMIT 1`,
    [args.conversationId, args.userId],
  );

  if (exists.rows.length === 0) {
    const parentId = args.carryOverContext?.fromConversationId ?? null;
    const origin = parentId ? "fork_on_type_change" : null;
    await pool.query(
      `
      INSERT INTO public.unified_chat_conversations (
        id, user_id, scope_type, scope_key, title, chat_type, legacy_ref, legacy_source,
        parent_conversation_id, conversation_origin, messages, created_at, updated_at
      )
      VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9::uuid, $10, $11::jsonb, NOW(), NOW())
      `,
      [
        args.conversationId,
        args.userId,
        args.scopeType ?? "global_session",
        args.scopeKey ?? null,
        args.userMessage.substring(0, 80),
        chatType,
        args.legacyRef ?? null,
        args.legacySource ?? null,
        parentId,
        origin,
        chunk,
      ],
    );
    if (parentId) {
      const { linkConversationFork } = await import("./chatConversationFork.js");
      await linkConversationFork({
        tenantId: args.tenantId,
        userId: args.userId,
        parentConversationId: parentId,
        childConversationId: args.conversationId,
        origin: "fork_on_type_change",
      });
    }
    return;
  }

  await pool.query(
    `
    UPDATE public.unified_chat_conversations
    SET messages = COALESCE(messages, '[]'::jsonb) || $2::jsonb,
        title = CASE WHEN title = 'Chat' THEN LEFT($3, 80) ELSE title END,
        legacy_ref = COALESCE($5, legacy_ref),
        legacy_source = COALESCE($6, legacy_source),
        updated_at = NOW()
    WHERE id = $1::uuid AND user_id = $4::uuid
    `,
    [
      args.conversationId,
      chunk,
      args.userMessage,
      args.userId,
      args.legacyRef ?? null,
      args.legacySource ?? null,
    ],
  );
}

export async function patchUnifiedConversation(args: {
  tenantId: string;
  userId: string;
  conversationId: string;
  title?: string;
  folderId?: string | null;
}): Promise<UnifiedConversationDetail | null> {
  const ok = await ensureTable(args.tenantId);
  if (!ok) return null;
  const pool = await tenantDbManager.getTenantPool(args.tenantId);
  const sets: string[] = [];
  const params: unknown[] = [args.conversationId, args.userId];
  let i = 3;
  if (args.title !== undefined) {
    const title = args.title.trim().slice(0, 200) || "Chat";
    sets.push(`title = $${i++}`);
    params.push(title);
  }
  if (args.folderId !== undefined) {
    sets.push(`folder_id = $${i++}`);
    params.push(args.folderId);
  }
  if (sets.length === 0) {
    return getUnifiedConversation({
      tenantId: args.tenantId,
      userId: args.userId,
      conversationId: args.conversationId,
    });
  }
  sets.push("updated_at = NOW()");
  const r = await pool.query(
    `
    UPDATE public.unified_chat_conversations
    SET ${sets.join(", ")}
    WHERE id = $1::uuid AND user_id = $2::uuid
    RETURNING id, title, scope_type, scope_key, chat_type, legacy_ref, legacy_source, folder_id, messages, created_at, updated_at
    `,
    params,
  );
  if (r.rows.length === 0) return null;
  const row = r.rows[0];
  return {
    id: row.id,
    title: row.title,
    scope_type: row.scope_type,
    scope_key: row.scope_key,
    chat_type: row.chat_type,
    legacy_ref: row.legacy_ref,
    legacy_source: row.legacy_source ?? null,
    folder_id: row.folder_id ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    messages: Array.isArray(row.messages) ? row.messages : [],
  };
}

export async function listUnifiedConversations(args: {
  tenantId: string;
  userId: string;
  scopeType?: string;
  scopeKey?: string | null;
  chatType?: UnifiedConversationChatType;
  search?: string;
  limit?: number;
  offset?: number;
  folderIds?: string[];
}): Promise<UnifiedConversationListRow[]> {
  const ok = await ensureTable(args.tenantId);
  if (!ok) return [];
  const pool = await tenantDbManager.getTenantPool(args.tenantId);
  const rawLimit = args.limit;
  const rawOffset = args.offset;
  const lim =
    typeof rawLimit === "number" && Number.isFinite(rawLimit) ? Math.floor(rawLimit) : 50;
  const off =
    typeof rawOffset === "number" && Number.isFinite(rawOffset) ? Math.floor(rawOffset) : 0;
  const limit = Math.min(Math.max(lim, 1), 100);
  const offset = Math.max(off, 0);
  const params: unknown[] = [];
  const where: string[] = [];
  let i = 1;
  where.push(`user_id = $${i++}::uuid`);
  params.push(args.userId);
  if (args.scopeType) {
    where.push(`scope_type = $${i++}::text`);
    params.push(args.scopeType);
  }
  if (args.scopeKey !== undefined && args.scopeKey !== null && args.scopeKey !== "") {
    where.push(`scope_key = $${i++}::text`);
    params.push(args.scopeKey);
  } else if (args.scopeKey === "") {
    where.push(`(scope_key IS NULL OR scope_key = '')`);
  }
  if (args.chatType) {
    where.push(`chat_type = $${i++}::text`);
    params.push(args.chatType);
  }
  if (args.search?.trim()) {
    where.push(`title ILIKE $${i++}::text`);
    params.push(`%${args.search.trim()}%`);
  }
  if (args.folderIds && args.folderIds.length > 0) {
    where.push(`folder_id = ANY($${i++}::uuid[])`);
    params.push(args.folderIds);
  }
  const limitPh = `$${i++}::int`;
  params.push(limit);
  const offsetPh = `$${i++}::int`;
  params.push(offset);
  // Viewer-owned rows materialized for shared research (legacy_ref → someone else's
  // session) belong in Shared With Me only, not the user's own history list.
  where.push(`NOT (
    legacy_source = 'research_lab'
    AND legacy_ref IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.research_sessions rs
      WHERE rs.id::text = legacy_ref
        AND rs.user_id::text <> $1::text
    )
  )`);
  const q = `
    SELECT id, title, scope_type, scope_key, chat_type, legacy_ref, legacy_source, folder_id,
           parent_conversation_id, forked_to_conversation_id, conversation_origin,
           created_at, updated_at
    FROM public.unified_chat_conversations
    WHERE ${where.join(" AND ")}
    ORDER BY updated_at DESC
    LIMIT ${limitPh}
    OFFSET ${offsetPh}
  `;
  const r = await pool.query(q, params);
  return r.rows as UnifiedConversationListRow[];
}

export async function getUnifiedConversation(args: {
  tenantId: string;
  userId: string;
  conversationId: string;
}): Promise<UnifiedConversationDetail | null> {
  const ok = await ensureTable(args.tenantId);
  if (!ok) return null;
  const pool = await tenantDbManager.getTenantPool(args.tenantId);
  const r = await pool.query(
    `
    SELECT id, title, scope_type, scope_key, chat_type, legacy_ref, legacy_source, folder_id,
           parent_conversation_id, forked_to_conversation_id, conversation_origin,
           messages, created_at, updated_at
    FROM public.unified_chat_conversations
    WHERE id = $1::uuid AND user_id = $2::uuid
    LIMIT 1
    `,
    [args.conversationId, args.userId],
  );
  if (r.rows.length === 0) return null;
  const row = r.rows[0];
  return {
    id: row.id,
    title: row.title,
    scope_type: row.scope_type,
    scope_key: row.scope_key,
    chat_type: row.chat_type,
    legacy_ref: row.legacy_ref,
    legacy_source: row.legacy_source ?? null,
    folder_id: row.folder_id ?? null,
    parent_conversation_id: row.parent_conversation_id ?? null,
    forked_to_conversation_id: row.forked_to_conversation_id ?? null,
    conversation_origin: row.conversation_origin ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    messages: Array.isArray(row.messages) ? row.messages : [],
  };
}

export async function createUnifiedConversation(args: {
  tenantId: string;
  userId: string;
  scopeType: string;
  scopeKey?: string | null;
  chatType: UnifiedConversationChatType;
  title?: string;
  legacyRef?: string | null;
  legacySource?: string | null;
  folderId?: string | null;
}): Promise<string> {
  const ok = await ensureTable(args.tenantId);
  if (!ok) throw new Error("unified_chat_conversations unavailable");
  const pool = await tenantDbManager.getTenantPool(args.tenantId);
  const id = randomUUID();
  const title = (args.title ?? "Chat").trim().slice(0, 200) || "Chat";
  await pool.query(
    `
    INSERT INTO public.unified_chat_conversations (
      id, user_id, scope_type, scope_key, title, chat_type, legacy_ref, legacy_source, folder_id, messages, created_at, updated_at
    )
    VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9, '[]'::jsonb, NOW(), NOW())
    `,
    [
      id,
      args.userId,
      args.scopeType,
      args.scopeKey ?? null,
      title,
      args.chatType,
      args.legacyRef ?? null,
      args.legacySource ?? null,
      args.folderId ?? null,
    ],
  );
  return id;
}

/**
 * Look up an existing unified conversation by legacy_ref so research follow-ups
 * land on the same row (COHI-402: stable conversation_id across resume).
 */
export async function findUnifiedConversationByLegacyRef(args: {
  tenantId: string;
  userId: string;
  legacyRef: string;
}): Promise<UnifiedConversationListRow | null> {
  const ok = await ensureTable(args.tenantId);
  if (!ok) return null;
  const pool = await tenantDbManager.getTenantPool(args.tenantId);
  const r = await pool.query(
    `
    SELECT id, title, scope_type, scope_key, chat_type, legacy_ref, legacy_source, folder_id, created_at, updated_at
    FROM public.unified_chat_conversations
    WHERE user_id = $1::uuid AND legacy_ref = $2
    ORDER BY updated_at DESC
    LIMIT 1
    `,
    [args.userId, args.legacyRef],
  );
  return r.rows.length === 0 ? null : (r.rows[0] as UnifiedConversationListRow);
}

export async function deleteUnifiedConversation(args: {
  tenantId: string;
  userId: string;
  conversationId: string;
}): Promise<boolean> {
  const ok = await ensureTable(args.tenantId);
  if (!ok) return false;
  const pool = await tenantDbManager.getTenantPool(args.tenantId);
  const r = await pool.query(
    `DELETE FROM public.unified_chat_conversations WHERE id = $1::uuid AND user_id = $2::uuid`,
    [args.conversationId, args.userId],
  );
  return (r.rowCount ?? 0) > 0;
}

export async function rebindUnifiedConversation(args: {
  tenantId: string;
  userId: string;
  conversationId: string;
  scopeType: string;
  scopeKey?: string | null;
  chatType?: UnifiedConversationChatType;
}): Promise<UnifiedConversationDetail | null> {
  const ok = await ensureTable(args.tenantId);
  if (!ok) return null;
  const pool = await tenantDbManager.getTenantPool(args.tenantId);
  const r = await pool.query(
    `
    UPDATE public.unified_chat_conversations
    SET scope_type = $3,
        scope_key = $4,
        chat_type = COALESCE($5, chat_type),
        updated_at = NOW()
    WHERE id = $1::uuid AND user_id = $2::uuid
    RETURNING id, title, scope_type, scope_key, chat_type, legacy_ref, legacy_source, folder_id, messages, created_at, updated_at
    `,
    [
      args.conversationId,
      args.userId,
      args.scopeType,
      args.scopeKey ?? null,
      args.chatType ?? null,
    ],
  );
  if (r.rows.length === 0) return null;
  const row = r.rows[0];
  return {
    id: row.id,
    title: row.title,
    scope_type: row.scope_type,
    scope_key: row.scope_key,
    chat_type: row.chat_type,
    legacy_ref: row.legacy_ref,
    legacy_source: row.legacy_source ?? null,
    folder_id: row.folder_id ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    messages: Array.isArray(row.messages) ? row.messages : [],
  };
}
