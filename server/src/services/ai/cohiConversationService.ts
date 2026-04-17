/**
 * Cohi Conversation Service
 *
 * CRUD operations for persisting workbench chat conversations.
 * Each conversation is scoped to a user + workbench canvas.
 * Also manages context window limits to keep LLM prompts efficient.
 */

import { tenantDbManager } from "../../config/tenantDatabaseManager.js";

// ============================================================================
// Types
// ============================================================================

export interface ConversationMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  actions?: any[];
  teachingNotes?: string;
  timestamp: string;
  qaAgentRunTag?: string;
}

export interface Conversation {
  id: string;
  userId: string;
  canvasId: string | null;
  title: string;
  messages: ConversationMessage[];
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// Constants
// ============================================================================

/** Maximum number of messages to send to the LLM per request */
export const MAX_CONTEXT_MESSAGES = 20;

/** Maximum number of conversations to keep per user/canvas pair */
const MAX_CONVERSATIONS_PER_CANVAS = 10;

// ============================================================================
// Table management
// ============================================================================

async function ensureTableExists(tenantId: string): Promise<boolean> {
  try {
    const pool = await tenantDbManager.getTenantPool(tenantId);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS public.cohi_conversations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id TEXT NOT NULL,
        canvas_id TEXT,
        title TEXT NOT NULL DEFAULT 'Untitled conversation',
        messages JSONB NOT NULL DEFAULT '[]'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // Create index for fast lookup
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_cohi_conv_user_canvas 
      ON public.cohi_conversations (user_id, canvas_id, updated_at DESC)
    `);

    return true;
  } catch (error: any) {
    console.error(
      `[CohiConversation] Failed to ensure table for tenant ${tenantId}:`,
      error.message
    );
    return false;
  }
}

// ============================================================================
// CRUD Operations
// ============================================================================

/**
 * Create a new conversation
 */
export async function createConversation(
  tenantId: string,
  userId: string,
  canvasId: string | null,
  title?: string
): Promise<Conversation | null> {
  try {
    const ready = await ensureTableExists(tenantId);
    if (!ready) return null;

    const pool = await tenantDbManager.getTenantPool(tenantId);
    const result = await pool.query(
      `INSERT INTO public.cohi_conversations (user_id, canvas_id, title, messages)
       VALUES ($1, $2, $3, '[]'::jsonb)
       RETURNING id, user_id, canvas_id, title, messages, created_at, updated_at`,
      [userId, canvasId, title || "Untitled conversation"]
    );

    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    return {
      id: row.id,
      userId: row.user_id,
      canvasId: row.canvas_id,
      title: row.title,
      messages: row.messages || [],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  } catch (error: any) {
    console.error("[CohiConversation] Create error:", error.message);
    return null;
  }
}

/**
 * Get a conversation by ID
 */
export async function getConversation(
  tenantId: string,
  conversationId: string,
  userId: string
): Promise<Conversation | null> {
  try {
    const ready = await ensureTableExists(tenantId);
    if (!ready) return null;

    const pool = await tenantDbManager.getTenantPool(tenantId);
    const result = await pool.query(
      `SELECT id, user_id, canvas_id, title, messages, created_at, updated_at
       FROM public.cohi_conversations
       WHERE id = $1 AND user_id = $2`,
      [conversationId, userId]
    );

    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    return {
      id: row.id,
      userId: row.user_id,
      canvasId: row.canvas_id,
      title: row.title,
      messages: row.messages || [],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  } catch (error: any) {
    console.error("[CohiConversation] Get error:", error.message);
    return null;
  }
}

/**
 * List conversations for a user/canvas pair (most recent first)
 */
export async function listConversations(
  tenantId: string,
  userId: string,
  canvasId?: string | null,
  limit = 10
): Promise<Conversation[]> {
  try {
    const ready = await ensureTableExists(tenantId);
    if (!ready) return [];

    const pool = await tenantDbManager.getTenantPool(tenantId);
    let query = `
      SELECT id, user_id, canvas_id, title, messages, created_at, updated_at
      FROM public.cohi_conversations
      WHERE user_id = $1
    `;
    const params: any[] = [userId];

    if (canvasId !== undefined) {
      query += canvasId
        ? ` AND canvas_id = $2`
        : ` AND canvas_id IS NULL`;
      if (canvasId) params.push(canvasId);
    }

    query += ` ORDER BY updated_at DESC LIMIT $${params.length + 1}`;
    params.push(limit);

    const result = await pool.query(query, params);

    return result.rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      canvasId: row.canvas_id,
      title: row.title,
      messages: row.messages || [],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  } catch (error: any) {
    console.error("[CohiConversation] List error:", error.message);
    return [];
  }
}

/**
 * Append a message to a conversation
 */
export async function appendMessage(
  tenantId: string,
  conversationId: string,
  userId: string,
  message: ConversationMessage
): Promise<boolean> {
  try {
    const ready = await ensureTableExists(tenantId);
    if (!ready) return false;

    const pool = await tenantDbManager.getTenantPool(tenantId);
    const result = await pool.query(
      `UPDATE public.cohi_conversations
       SET messages = messages || $1::jsonb,
           updated_at = NOW()
       WHERE id = $2 AND user_id = $3
       RETURNING id`,
      [JSON.stringify([message]), conversationId, userId]
    );

    return result.rows.length > 0;
  } catch (error: any) {
    console.error("[CohiConversation] Append error:", error.message);
    return false;
  }
}

/**
 * Update conversation title
 */
export async function updateConversationTitle(
  tenantId: string,
  conversationId: string,
  userId: string,
  title: string
): Promise<boolean> {
  try {
    const ready = await ensureTableExists(tenantId);
    if (!ready) return false;

    const pool = await tenantDbManager.getTenantPool(tenantId);
    const result = await pool.query(
      `UPDATE public.cohi_conversations
       SET title = $1, updated_at = NOW()
       WHERE id = $2 AND user_id = $3
       RETURNING id`,
      [title, conversationId, userId]
    );

    return result.rows.length > 0;
  } catch (error: any) {
    console.error("[CohiConversation] Update title error:", error.message);
    return false;
  }
}

/**
 * Delete a conversation
 */
export async function deleteConversation(
  tenantId: string,
  conversationId: string,
  userId: string
): Promise<boolean> {
  try {
    const ready = await ensureTableExists(tenantId);
    if (!ready) return false;

    const pool = await tenantDbManager.getTenantPool(tenantId);
    const result = await pool.query(
      `DELETE FROM public.cohi_conversations
       WHERE id = $1 AND user_id = $2
       RETURNING id`,
      [conversationId, userId]
    );

    return result.rows.length > 0;
  } catch (error: any) {
    console.error("[CohiConversation] Delete error:", error.message);
    return false;
  }
}

/**
 * Rebind all conversations from one scope key to another for a user.
 * Used when an unsaved draft canvas (draft:*) gets its first real id (canvas:*).
 */
export async function rebindConversationScope(
  tenantId: string,
  userId: string,
  fromScopeId: string,
  toScopeId: string
): Promise<number> {
  try {
    const ready = await ensureTableExists(tenantId);
    if (!ready) return 0;
    if (!fromScopeId || !toScopeId || fromScopeId === toScopeId) return 0;

    const pool = await tenantDbManager.getTenantPool(tenantId);
    const result = await pool.query(
      `UPDATE public.cohi_conversations
       SET canvas_id = $1,
           updated_at = NOW()
       WHERE user_id = $2
         AND canvas_id = $3`,
      [toScopeId, userId, fromScopeId]
    );

    return result.rowCount || 0;
  } catch (error: any) {
    console.error("[CohiConversation] Rebind scope error:", error.message);
    return 0;
  }
}

/**
 * Prune old conversations to keep within limit
 */
export async function pruneConversations(
  tenantId: string,
  userId: string,
  canvasId: string | null
): Promise<number> {
  try {
    const ready = await ensureTableExists(tenantId);
    if (!ready) return 0;

    const pool = await tenantDbManager.getTenantPool(tenantId);

    // Find conversations to prune
    const condition = canvasId
      ? `user_id = $1 AND canvas_id = $2`
      : `user_id = $1 AND canvas_id IS NULL`;
    const params = canvasId ? [userId, canvasId] : [userId];

    const result = await pool.query(
      `DELETE FROM public.cohi_conversations
       WHERE id IN (
         SELECT id FROM public.cohi_conversations
         WHERE ${condition}
         ORDER BY updated_at DESC
         OFFSET $${params.length + 1}
       )
       RETURNING id`,
      [...params, MAX_CONVERSATIONS_PER_CANVAS]
    );

    if (result.rows.length > 0) {
      console.log(
        `[CohiConversation] Pruned ${result.rows.length} old conversations for user ${userId}`
      );
    }

    return result.rows.length;
  } catch (error: any) {
    console.error("[CohiConversation] Prune error:", error.message);
    return 0;
  }
}

// ============================================================================
// Context Window Management
// ============================================================================

/**
 * Build the message history for LLM context, keeping within limits.
 * Strategy: always include the last N messages, prioritize user messages.
 */
export function buildContextMessages(
  messages: ConversationMessage[],
  maxMessages = MAX_CONTEXT_MESSAGES
): { role: string; content: string }[] {
  if (messages.length <= maxMessages) {
    return messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));
  }

  // Keep the most recent messages
  const recent = messages.slice(-maxMessages);

  return recent.map((m) => ({
    role: m.role,
    content: m.content,
  }));
}
