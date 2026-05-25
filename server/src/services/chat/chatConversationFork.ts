/**
 * Auto-fork when the user switches chat type mid-conversation.
 */

import type { UnifiedChatRequestBody } from "./unifiedChatOrchestrator.js";
import { tenantDbManager } from "../../config/tenantDatabaseManager.js";

export type CarryOverContextPayload = {
  fromConversationId: string;
  fromChatType?: string;
  fromTitle?: string;
  summary: string;
};

export function readCarryOverContext(
  body: UnifiedChatRequestBody,
): CarryOverContextPayload | null {
  const raw = body.context?.carryOverContext as CarryOverContextPayload | undefined;
  if (!raw?.fromConversationId || !raw.summary?.trim()) return null;
  return {
    fromConversationId: raw.fromConversationId,
    fromChatType: raw.fromChatType,
    fromTitle: raw.fromTitle,
    summary: raw.summary.trim(),
  };
}

export function prependCarryOverToHistory(
  body: UnifiedChatRequestBody,
  carryOver: CarryOverContextPayload,
): void {
  const label = carryOver.fromChatType ?? "previous";
  const prefix = {
    role: "user" as const,
    content: `[Context carried over from ${label} conversation${carryOver.fromTitle ? ` "${carryOver.fromTitle}"` : ""}]\n${carryOver.summary}`,
  };
  body.history = [prefix, ...(body.history ?? [])];
}

export async function ensureForkColumns(tenantId: string): Promise<boolean> {
  try {
    const pool = await tenantDbManager.getTenantPool(tenantId);
    await pool.query(`
      ALTER TABLE public.unified_chat_conversations
        ADD COLUMN IF NOT EXISTS parent_conversation_id UUID,
        ADD COLUMN IF NOT EXISTS forked_to_conversation_id UUID,
        ADD COLUMN IF NOT EXISTS conversation_origin TEXT
    `);
    return true;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[chatConversationFork] ensureForkColumns:", msg);
    return false;
  }
}

/** Link parent ↔ child after the child conversation is first persisted. */
export async function linkConversationFork(args: {
  tenantId: string;
  userId: string;
  parentConversationId: string;
  childConversationId: string;
  origin?: string;
}): Promise<void> {
  const ok = await ensureForkColumns(args.tenantId);
  if (!ok) return;

  const pool = await tenantDbManager.getTenantPool(args.tenantId);
  const origin = args.origin ?? "fork_on_type_change";

  await pool.query(
    `
    UPDATE public.unified_chat_conversations
    SET forked_to_conversation_id = $3::uuid,
        updated_at = NOW()
    WHERE id = $1::uuid AND user_id = $2::uuid
      AND (forked_to_conversation_id IS NULL OR forked_to_conversation_id = $3::uuid)
    `,
    [args.parentConversationId, args.userId, args.childConversationId],
  );

  await pool.query(
    `
    UPDATE public.unified_chat_conversations
    SET parent_conversation_id = $3::uuid,
        conversation_origin = $4,
        updated_at = NOW()
    WHERE id = $1::uuid AND user_id = $2::uuid
    `,
    [args.childConversationId, args.userId, args.parentConversationId, origin],
  );
}
