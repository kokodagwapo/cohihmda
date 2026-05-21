/**
 * Persistence for /api/chat/v1 threads (tenant DB).
 */

import { tenantDbManager } from "../../config/tenantDatabaseManager.js";

export interface UnifiedChatTurnRecord {
  role: "user" | "assistant";
  content?: string;
  blocks?: unknown[];
  turnId?: string;
  at: string;
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
  assistantTurnId: string;
  scopeType?: string;
  scopeKey?: string | null;
}): Promise<void> {
  const ok = await ensureTable(args.tenantId);
  if (!ok) return;

  const pool = await tenantDbManager.getTenantPool(args.tenantId);
  const userTurn: UnifiedChatTurnRecord = {
    role: "user",
    content: args.userMessage,
    at: new Date().toISOString(),
  };
  const assistantTurn: UnifiedChatTurnRecord = {
    role: "assistant",
    blocks: args.assistantBlocks,
    turnId: args.assistantTurnId,
    at: new Date().toISOString(),
  };
  const chunk = JSON.stringify([userTurn, assistantTurn]);

  const exists = await pool.query(
    `SELECT 1 FROM public.unified_chat_conversations WHERE id = $1::uuid AND user_id = $2::uuid LIMIT 1`,
    [args.conversationId, args.userId],
  );

  if (exists.rows.length === 0) {
    await pool.query(
      `
      INSERT INTO public.unified_chat_conversations (
        id, user_id, scope_type, scope_key, title, messages, created_at, updated_at
      )
      VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6::jsonb, NOW(), NOW())
      `,
      [
        args.conversationId,
        args.userId,
        args.scopeType ?? "global_session",
        args.scopeKey ?? null,
        args.userMessage.substring(0, 80),
        chunk,
      ],
    );
    return;
  }

  await pool.query(
    `
    UPDATE public.unified_chat_conversations
    SET messages = COALESCE(messages, '[]'::jsonb) || $2::jsonb,
        title = CASE WHEN title = 'Chat' THEN LEFT($3, 80) ELSE title END,
        updated_at = NOW()
    WHERE id = $1::uuid AND user_id = $4::uuid
    `,
    [args.conversationId, chunk, args.userMessage, args.userId],
  );
}
