/**
 * Onboarding Routes
 *
 * SSE endpoints for the onboarding analysis agent (Phase 1) and
 * interactive onboarding chat agent (Phase 2).
 */

import { Router, type Response } from "express";
import { authenticateToken, type AuthRequest } from "../middleware/auth.js";
import {
  attachTenantContext,
  getTenantContext,
} from "../middleware/tenantContext.js";
import {
  runOnboardingAnalysis,
  type AnalysisEvent,
  type OnboardingAnalysis,
  type SamplingStrategy,
} from "../services/onboarding/onboardingAnalysisAgent.js";
import {
  runOnboardingChat,
  type ChatEvent,
} from "../services/onboarding/onboardingChatAgent.js";

const router = Router();

// ============================================================================
// SSE Helpers
// ============================================================================

function setupSSE(res: Response): void {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
}

function sseWrite(res: Response, event: Record<string, any>): void {
  try {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  } catch {
    // client disconnected
  }
}

// ============================================================================
// In-memory analysis result cache (per connection, replaced each run)
// ============================================================================

const analysisCache = new Map<string, OnboardingAnalysis>();

// ============================================================================
// POST /analyze/:connectionId — Phase 1: Automated Schema Analysis (SSE)
// ============================================================================

router.post(
  "/analyze/:connectionId",
  authenticateToken,
  attachTenantContext,
  async (req: AuthRequest, res: Response) => {
    const connectionId = req.params.connectionId as string;
    const { tenantPool, tenantId } = getTenantContext(req);

    const strategyParam = (req.query.strategy as string) || "hybrid";
    const strategy: SamplingStrategy =
      strategyParam === "fullLoan"
        ? "fullLoan"
        : strategyParam === "pipeline"
          ? "pipeline"
          : "hybrid";

    setupSSE(res);

    let clientDisconnected = false;
    req.on("close", () => {
      clientDisconnected = true;
    });

    const emit = (event: AnalysisEvent) => {
      if (!clientDisconnected) sseWrite(res, event);
    };

    // Heartbeat
    sseWrite(res, {
      type: "heartbeat",
      data: { connectionId, strategy },
      timestamp: Date.now(),
    });

    try {
      const analysis = await runOnboardingAnalysis(
        tenantId,
        connectionId,
        tenantPool,
        emit,
        strategy,
      );

      // Cache for chat phase
      analysisCache.set(`${tenantId}:${connectionId}`, analysis);
    } catch (err: any) {
      if (!clientDisconnected) {
        sseWrite(res, {
          type: "error",
          message: err.message || "Analysis failed",
          timestamp: Date.now(),
        });
      }
    }

    if (!clientDisconnected) res.end();
  },
);

// ============================================================================
// POST /chat/:connectionId — Phase 2: Interactive Onboarding Chat (SSE)
// ============================================================================

router.post(
  "/chat/:connectionId",
  authenticateToken,
  attachTenantContext,
  async (req: AuthRequest, res: Response) => {
    const connectionId = req.params.connectionId as string;
    const { tenantPool, tenantId } = getTenantContext(req);
    const { message, chatHistory } = req.body || {};

    if (!message) {
      return res.status(400).json({ error: "message is required" });
    }

    setupSSE(res);

    let clientDisconnected = false;
    req.on("close", () => {
      clientDisconnected = true;
    });

    const emit = (event: ChatEvent) => {
      if (!clientDisconnected) sseWrite(res, event);
    };

    sseWrite(res, {
      type: "heartbeat",
      data: { connectionId },
      timestamp: Date.now(),
    });

    // Retrieve cached analysis (or empty)
    const cachedAnalysis =
      analysisCache.get(`${tenantId}:${connectionId}`) || null;

    try {
      await runOnboardingChat({
        tenantId,
        connectionId,
        tenantPool,
        userMessage: message,
        chatHistory: chatHistory || [],
        analysis: cachedAnalysis,
        onEvent: emit,
      });
    } catch (err: any) {
      if (!clientDisconnected) {
        sseWrite(res, {
          type: "error",
          message: err.message || "Chat agent failed",
          timestamp: Date.now(),
        });
      }
    }

    if (!clientDisconnected) res.end();
  },
);

export default router;
