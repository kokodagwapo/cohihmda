/**
 * Unified Cohi Chat API v1 — /api/chat/v1/*
 */

import { Router, type Response } from "express";
import type { AuthRequest } from "../middleware/auth.js";
import { authenticateToken } from "../middleware/auth.js";
import { attachTenantContext } from "../middleware/tenantContext.js";
import { apiLimiter } from "../middleware/rateLimiter.js";
import {
  validateUnifiedChatRequest,
  formatAjvErrors,
  validateUnifiedChatResponse,
  validateUnifiedStreamEvent,
  validateUnifiedConversationCreate,
  validateUnifiedConversationRebind,
} from "../services/chat/unifiedChatSchemas.js";
import { isUnifiedChatApiEnabled } from "../services/chat/unifiedChatConfig.js";
import { tryReserveClientMessageId } from "../services/chat/unifiedChatIdempotency.js";
import {
  processUnifiedChatMessage,
  type UnifiedChatRequestBody,
} from "../services/chat/unifiedChatOrchestrator.js";
import {
  appendUnifiedChatTurns,
  listUnifiedConversations,
  getUnifiedConversation,
  createUnifiedConversation,
  deleteUnifiedConversation,
  rebindUnifiedConversation,
  type UnifiedConversationChatType,
} from "../services/chat/unifiedConversationService.js";
import { checkSectionAccess } from "../services/ai/queryBuilderService.js";

const router = Router();

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(s: string): boolean {
  return UUID_RE.test(s);
}

function unifiedChatGuard(_req: AuthRequest, res: Response, next: () => void) {
  if (!isUnifiedChatApiEnabled()) {
    return res.status(404).json({
      error: "not_found",
      message: "Unified chat API is disabled",
    });
  }
  next();
}

function writeSseData(res: Response, payload: unknown) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function emitValidatedStream(
  res: Response,
  conversationId: string,
  turnId: string,
  blocks: Array<Record<string, unknown>>,
  streamMetadata?: Record<string, unknown>,
) {
  const emit = (ev: Record<string, unknown>) => {
    if (!validateUnifiedStreamEvent(ev)) {
      console.warn(
        "[chat/v1 stream] Event failed schema validation:",
        validateUnifiedStreamEvent.errors,
        ev,
      );
      throw new Error("stream_event_schema_invalid");
    }
    writeSseData(res, ev);
  };

  emit({ event: "turn.started", conversationId, turnId });

  blocks.forEach((block, blockIndex) => {
    const rawType = String(block.type || "text");
    const allowedBt = new Set([
      "text",
      "citations",
      "visualization",
      "actions",
      "artifacts",
      "navigation_hints",
      "safety",
    ]);
    const blockType = allowedBt.has(rawType) ? rawType : "text";
    emit({
      event: "block.started",
      conversationId,
      turnId,
      blockIndex,
      blockType,
    });
    emit({
      event: "block.completed",
      conversationId,
      turnId,
      blockIndex,
      blockType,
      block,
    });
  });

  emit({
    event: "turn.completed",
    conversationId,
    turnId,
    metadata: streamMetadata ?? {},
  });
}

router.get(
  "/permissions",
  unifiedChatGuard,
  authenticateToken,
  attachTenantContext,
  apiLimiter,
  async (req: AuthRequest, res) => {
    try {
      const tenantId = req.tenantContext?.tenantId || req.tenantId;
      const userId = req.userId;
      if (!tenantId || !userId) {
        return res.status(400).json({
          error: "bad_request",
          message: "Tenant and user context required",
        });
      }
      const allowed = await checkSectionAccess("cohi_chat", {
        userId,
        tenantId,
        userRole: req.userRole || "user",
        userEmail: req.userEmail,
      });
      const chatTypes: UnifiedConversationChatType[] = allowed
        ? ["chat", "research", "insight_builder", "workbench"]
        : [];
      res.json({ cohiChat: allowed, chatTypes });
    } catch (err: any) {
      console.error("[chat/v1/permissions] Error:", err);
      res.status(500).json({
        error: "internal_error",
        message: err.message || "Failed to load permissions",
      });
    }
  },
);

router.get(
  "/conversations",
  unifiedChatGuard,
  authenticateToken,
  attachTenantContext,
  apiLimiter,
  async (req: AuthRequest, res) => {
    try {
      const tenantId = req.tenantContext?.tenantId || req.tenantId;
      const userId = req.userId;
      if (!tenantId || !userId) {
        return res.status(400).json({
          error: "bad_request",
          message: "Tenant and user context required",
        });
      }
      const q = req.query as Record<string, string | string[] | undefined>;
      const first = (v: string | string[] | undefined): string | undefined =>
        Array.isArray(v) ? v[0] : v;
      const scopeType = first(q.scope_type) ?? first(q["scope.type"]);
      const scopeKey = first(q.scope_key) ?? first(q["scope.id"]);
      const chatType = first(q.chat_type) as UnifiedConversationChatType | undefined;
      const limitRaw = first(q.limit);
      const offsetRaw = first(q.offset);
      const limitParsed = limitRaw !== undefined ? parseInt(limitRaw, 10) : undefined;
      const offsetParsed = offsetRaw !== undefined ? parseInt(offsetRaw, 10) : undefined;
      const limit =
        limitParsed !== undefined && Number.isFinite(limitParsed) ? limitParsed : undefined;
      const offset =
        offsetParsed !== undefined && Number.isFinite(offsetParsed) ? offsetParsed : undefined;
      const rows = await listUnifiedConversations({
        tenantId,
        userId,
        scopeType: scopeType || undefined,
        scopeKey: scopeKey !== undefined ? scopeKey : undefined,
        chatType:
          chatType === "chat" ||
          chatType === "research" ||
          chatType === "insight_builder" ||
          chatType === "workbench"
            ? chatType
            : undefined,
        limit,
        offset,
      });
      res.json({
        conversations: rows.map((r) => ({
          id: r.id,
          title: r.title,
          scope: { type: r.scope_type, id: r.scope_key ?? undefined },
          chat_type: r.chat_type,
          legacy_ref: r.legacy_ref,
          created_at: r.created_at,
          updated_at: r.updated_at,
        })),
      });
    } catch (err: any) {
      console.error("[chat/v1/conversations GET] Error:", err);
      res.status(500).json({
        error: "internal_error",
        message: err.message || "Failed to list conversations",
      });
    }
  },
);

router.post(
  "/conversations",
  unifiedChatGuard,
  authenticateToken,
  attachTenantContext,
  apiLimiter,
  async (req: AuthRequest, res) => {
    try {
      const raw = req.body as Record<string, unknown>;
      if (!validateUnifiedConversationCreate(raw)) {
        const { message, details } = formatAjvErrors(
          validateUnifiedConversationCreate.errors,
        );
        return res.status(400).json({
          error: "validation_error",
          message,
          details,
        });
      }
      const body = raw as {
        scope: { type: string; id?: string };
        chat_type?: UnifiedConversationChatType;
        title?: string;
        legacy_ref?: string | null;
      };
      const tenantId = req.tenantContext?.tenantId || req.tenantId;
      const userId = req.userId;
      if (!tenantId || !userId) {
        return res.status(400).json({
          error: "bad_request",
          message: "Tenant and user context required",
        });
      }
      const scope = body.scope;
      const chatType = (body.chat_type ?? "chat") as UnifiedConversationChatType;
      const conversationId = await createUnifiedConversation({
        tenantId,
        userId,
        scopeType: scope.type,
        scopeKey: scope.id ?? null,
        chatType,
        title: body.title,
        legacyRef: body.legacy_ref ?? null,
      });
      res.status(201).json({ conversationId });
    } catch (err: any) {
      console.error("[chat/v1/conversations POST] Error:", err);
      res.status(500).json({
        error: "internal_error",
        message: err.message || "Failed to create conversation",
      });
    }
  },
);

router.get(
  "/conversations/:id",
  unifiedChatGuard,
  authenticateToken,
  attachTenantContext,
  apiLimiter,
  async (req: AuthRequest, res) => {
    try {
      const idParam = req.params.id;
      const id = Array.isArray(idParam) ? idParam[0] : idParam;
      if (!id || !isUuid(id)) {
        return res.status(400).json({ error: "validation_error", message: "Invalid conversation id" });
      }
      const tenantId = req.tenantContext?.tenantId || req.tenantId;
      const userId = req.userId;
      if (!tenantId || !userId) {
        return res.status(400).json({
          error: "bad_request",
          message: "Tenant and user context required",
        });
      }
      const row = await getUnifiedConversation({ tenantId, userId, conversationId: id });
      if (!row) {
        return res.status(404).json({ error: "not_found", message: "Conversation not found" });
      }
      res.json({
        id: row.id,
        title: row.title,
        scope: { type: row.scope_type, id: row.scope_key ?? undefined },
        chat_type: row.chat_type,
        legacy_ref: row.legacy_ref,
        messages: row.messages,
        created_at: row.created_at,
        updated_at: row.updated_at,
      });
    } catch (err: any) {
      console.error("[chat/v1/conversations/:id GET] Error:", err);
      res.status(500).json({
        error: "internal_error",
        message: err.message || "Failed to load conversation",
      });
    }
  },
);

router.delete(
  "/conversations/:id",
  unifiedChatGuard,
  authenticateToken,
  attachTenantContext,
  apiLimiter,
  async (req: AuthRequest, res) => {
    try {
      const idParam = req.params.id;
      const id = Array.isArray(idParam) ? idParam[0] : idParam;
      if (!id || !isUuid(id)) {
        return res.status(400).json({ error: "validation_error", message: "Invalid conversation id" });
      }
      const tenantId = req.tenantContext?.tenantId || req.tenantId;
      const userId = req.userId;
      if (!tenantId || !userId) {
        return res.status(400).json({
          error: "bad_request",
          message: "Tenant and user context required",
        });
      }
      const deleted = await deleteUnifiedConversation({ tenantId, userId, conversationId: id });
      if (!deleted) {
        return res.status(404).json({ error: "not_found", message: "Conversation not found" });
      }
      res.status(204).send();
    } catch (err: any) {
      console.error("[chat/v1/conversations/:id DELETE] Error:", err);
      res.status(500).json({
        error: "internal_error",
        message: err.message || "Failed to delete conversation",
      });
    }
  },
);

router.post(
  "/conversations/:id/rebind",
  unifiedChatGuard,
  authenticateToken,
  attachTenantContext,
  apiLimiter,
  async (req: AuthRequest, res) => {
    try {
      const idParam = req.params.id;
      const id = Array.isArray(idParam) ? idParam[0] : idParam;
      if (!id || !isUuid(id)) {
        return res.status(400).json({ error: "validation_error", message: "Invalid conversation id" });
      }
      const raw = req.body as Record<string, unknown>;
      if (!validateUnifiedConversationRebind(raw)) {
        const { message, details } = formatAjvErrors(
          validateUnifiedConversationRebind.errors,
        );
        return res.status(400).json({
          error: "validation_error",
          message,
          details,
        });
      }
      const body = raw as {
        scope: { type: string; id?: string };
        chat_type?: UnifiedConversationChatType;
      };
      const tenantId = req.tenantContext?.tenantId || req.tenantId;
      const userId = req.userId;
      if (!tenantId || !userId) {
        return res.status(400).json({
          error: "bad_request",
          message: "Tenant and user context required",
        });
      }
      const scope = body.scope;
      const updated = await rebindUnifiedConversation({
        tenantId,
        userId,
        conversationId: id,
        scopeType: scope.type,
        scopeKey: scope.id ?? null,
        chatType: body.chat_type as UnifiedConversationChatType | undefined,
      });
      if (!updated) {
        return res.status(404).json({ error: "not_found", message: "Conversation not found" });
      }
      res.json({
        id: updated.id,
        title: updated.title,
        scope: { type: updated.scope_type, id: updated.scope_key ?? undefined },
        chat_type: updated.chat_type,
        legacy_ref: updated.legacy_ref,
        messages: updated.messages,
        created_at: updated.created_at,
        updated_at: updated.updated_at,
      });
    } catch (err: any) {
      console.error("[chat/v1/conversations/:id/rebind] Error:", err);
      res.status(500).json({
        error: "internal_error",
        message: err.message || "Failed to rebind conversation",
      });
    }
  },
);

async function handlePostMessage(
  req: AuthRequest,
  res: Response,
  options: { stream: boolean },
): Promise<void> {
  try {
    const body = req.body as UnifiedChatRequestBody;
    if (!validateUnifiedChatRequest(body)) {
      const { message, details } = formatAjvErrors(validateUnifiedChatRequest.errors);
      res.status(400).json({
        error: "validation_error",
        message,
        details,
      });
      return;
    }

    const tenantId = req.tenantContext?.tenantId || req.tenantId;
    const userId = req.userId;
    if (!tenantId || !userId) {
      res.status(400).json({
        error: "bad_request",
        message: "Tenant and user context required",
      });
      return;
    }

    const idem = await tryReserveClientMessageId(tenantId, userId, body.clientMessageId);
    if (idem === "duplicate") {
      res.status(409).json({
        error: "duplicate_message",
        message: "This clientMessageId was already processed (idempotency conflict)",
      });
      return;
    }

    const result = await processUnifiedChatMessage(req, body);

    const envelope = {
      conversationId: result.conversationId,
      turn: result.turn,
      metadata: result.metadata,
    };

    const chatType =
      (body.chat_type === "research" ||
      body.chat_type === "insight_builder" ||
      body.chat_type === "workbench" ||
      body.chat_type === "chat"
        ? body.chat_type
        : "chat") as UnifiedConversationChatType;

    if (process.env.UNIFIED_CHAT_PERSIST !== "false") {
      try {
        await appendUnifiedChatTurns({
          tenantId,
          userId,
          conversationId: result.conversationId,
          userMessage: body.message,
          assistantBlocks: result.turn.blocks,
          assistantTurnId: result.turn.id,
          scopeType: body.scope?.type,
          scopeKey:
            body.scope?.type === "workbench_hub" && body.scope?.id
              ? body.scope.id
              : body.scope?.id ?? null,
          chatType,
        });
      } catch (persistErr: any) {
        console.warn("[chat/v1] Persist skipped:", persistErr?.message);
      }
    }

    if (
      process.env.NODE_ENV !== "production" &&
      !validateUnifiedChatResponse(envelope)
    ) {
      console.warn(
        "[chat/v1] Response schema validation failed:",
        validateUnifiedChatResponse.errors,
      );
    }

    if (!options.stream) {
      res.json(envelope);
      return;
    }

    res.status(200);
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    (res as Response & { flushHeaders?: () => void }).flushHeaders?.();

    emitValidatedStream(
      res,
      result.conversationId,
      result.turn.id,
      result.turn.blocks as Array<Record<string, unknown>>,
      {
        suggestedQuestions: (result.metadata?.suggestedQuestions as string[]) ?? [],
        chatType: result.metadata?.chatType,
      },
    );
    res.end();
  } catch (err: any) {
    const code = err.code || "internal_error";
    const status = Number(err.statusCode) > 0 ? err.statusCode : 500;
    console.error(options.stream ? "[chat/v1 stream] Error:" : "[chat/v1] Error:", err);
    if (options.stream && res.headersSent) {
      try {
        const errEv = {
          event: "error",
          error: {
            code: String(code),
            message: err.message || "Stream failed",
            retryable: false,
          },
        };
        if (validateUnifiedStreamEvent(errEv)) {
          writeSseData(res, errEv);
        }
      } catch {
        /* ignore */
      }
      res.end();
    } else if (!res.headersSent) {
      res.status(status).json({
        error: code,
        message: err.message || "Failed to process message",
      });
    }
  }
}

router.post(
  "/messages:stream",
  unifiedChatGuard,
  authenticateToken,
  attachTenantContext,
  apiLimiter,
  (req: AuthRequest, res: Response) => {
    void handlePostMessage(req, res, { stream: true });
  },
);

router.post(
  "/messages",
  unifiedChatGuard,
  authenticateToken,
  attachTenantContext,
  apiLimiter,
  (req: AuthRequest, res: Response) => {
    void handlePostMessage(req, res, { stream: false });
  },
);

export default router;
