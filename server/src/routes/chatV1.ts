/**
 * Unified Cohi Chat API v1 — POST /api/chat/v1/messages
 */

import { Router } from "express";
import type { AuthRequest } from "../middleware/auth.js";
import { authenticateToken } from "../middleware/auth.js";
import {
  attachTenantContext,
} from "../middleware/tenantContext.js";
import { apiLimiter } from "../middleware/rateLimiter.js";
import {
  validateUnifiedChatRequest,
  formatAjvErrors,
  validateUnifiedChatResponse,
} from "../services/chat/unifiedChatSchemas.js";
import { isUnifiedChatApiEnabled } from "../services/chat/unifiedChatConfig.js";
import { isDuplicateClientMessage } from "../services/chat/unifiedChatIdempotency.js";
import {
  processUnifiedChatMessage,
  type UnifiedChatRequestBody,
} from "../services/chat/unifiedChatOrchestrator.js";
import { appendUnifiedChatTurns } from "../services/chat/unifiedConversationService.js";

const router = Router();

function unifiedChatGuard(_req: AuthRequest, res: any, next: any) {
  if (!isUnifiedChatApiEnabled()) {
    return res.status(404).json({
      error: "not_found",
      message: "Unified chat API is disabled",
    });
  }
  next();
}

router.post(
  "/messages",
  unifiedChatGuard,
  authenticateToken,
  attachTenantContext,
  apiLimiter,
  async (req: AuthRequest, res) => {
    try {
      const body = req.body as UnifiedChatRequestBody;
      if (!validateUnifiedChatRequest(body)) {
        const { message, details } = formatAjvErrors(
          validateUnifiedChatRequest.errors,
        );
        return res.status(400).json({
          error: "validation_error",
          message,
          details,
        });
      }

      const tenantId = req.tenantContext?.tenantId || req.tenantId;
      const userId = req.userId;
      if (!tenantId || !userId) {
        return res.status(400).json({
          error: "bad_request",
          message: "Tenant and user context required",
        });
      }

      if (
        body.clientMessageId &&
        isDuplicateClientMessage(tenantId, userId, body.clientMessageId)
      ) {
        return res.status(409).json({
          error: "duplicate_message",
          message:
            "This clientMessageId was already processed (idempotency conflict)",
        });
      }

      const result = await processUnifiedChatMessage(req, body);

      const envelope = {
        conversationId: result.conversationId,
        turn: result.turn,
        metadata: result.metadata,
      };

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

      res.json(envelope);
    } catch (err: any) {
      const code = err.code || "internal_error";
      const status = Number(err.statusCode) > 0 ? err.statusCode : 500;
      console.error("[chat/v1] Error:", err);
      res.status(status).json({
        error: code,
        message: err.message || "Failed to process message",
      });
    }
  },
);

export default router;
