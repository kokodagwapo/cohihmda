/**
 * Internal AI Audit Ledger Endpoint
 *
 * Machine-to-machine proxy over the fail-closed `aiAgentOrchestrator`
 * (`startAction` + `transitionAction`) for pipeline-side callers that cannot
 * reach the management database directly (e.g. the AC validator running
 * inside Bitbucket). Without this endpoint the pipeline hits
 * ECONNREFUSED 127.0.0.1:5432 when the orchestrator tries to open its
 * dedicated pg pool, which trips SecurityBoundaryViolation before any LLM
 * call or browser action can run.
 *
 * Auth: same HMAC-SHA256 scheme used by `/api/internal/qa-run`
 *   (X-QA-Runner-Key + X-QA-Timestamp + X-QA-Signature). No JWT — the
 *   pipeline machine does not hold user credentials.
 *
 * Signature: HMAC-SHA256(QA_RUNNER_HMAC_SECRET, `${timestamp}.${rawBody}`)
 * Requests older than 5 minutes are rejected to prevent replay.
 */

import express, { Request, Response } from "express";
import { createHmac, timingSafeEqual } from "crypto";
import { z } from "zod";
import {
  startAction,
  transitionAction,
  SecurityBoundaryViolation,
  type ArtifactRef,
  type LedgerStatus,
} from "../../services/aiAgentOrchestrator.js";
import { logError, logInfo, logWarn } from "../../services/logger.js";

const router = express.Router();

const MAX_TIMESTAMP_SKEW_MS = 5 * 60 * 1000;

// ---------------------------------------------------------------------------
// Request schemas
// ---------------------------------------------------------------------------

const StartActionBodySchema = z.object({
  agentId: z.string().min(1),
  actionType: z.string().min(1),
  tenantId: z.string().nullable().optional(),
  requestId: z.string().min(1),
  metadata: z.record(z.unknown()).optional(),
});

const LedgerStatusSchema: z.ZodType<LedgerStatus> = z.enum([
  "started",
  "pending_approval",
  "pending_evidence_review",
  "approved",
  "evidence_approved",
  "evidence_rejected",
  "executed",
  "failed",
]);

const TransitionActionBodySchema = z.object({
  actionId: z.string().min(1),
  status: LedgerStatusSchema,
  approvedBy: z.string().optional(),
  approvalNote: z.string().optional(),
  artifacts: z
    .array(
      z.object({
        bucket: z.string(),
        s3_key: z.string(),
        size_bytes: z.number().int().nonnegative(),
        checksum: z.string().optional(),
        content_type: z.string().optional(),
      }),
    )
    .optional(),
  metadata: z.record(z.unknown()).optional(),
  errorMessage: z.string().optional(),
});

// ---------------------------------------------------------------------------
// HMAC auth middleware (shared contract with qaResults.ts)
// ---------------------------------------------------------------------------

function verifyQaRunnerSignature(req: Request, res: Response): boolean {
  const apiKey = req.headers["x-qa-runner-key"];
  const timestamp = req.headers["x-qa-timestamp"];
  const signature = req.headers["x-qa-signature"];

  const expectedApiKey = process.env.QA_RUNNER_API_KEY;
  const hmacSecret = process.env.QA_RUNNER_HMAC_SECRET;

  if (!expectedApiKey || !hmacSecret) {
    logWarn("[AiLedger] QA_RUNNER_API_KEY or QA_RUNNER_HMAC_SECRET not configured");
    res.status(503).json({ error: "Endpoint not configured" });
    return false;
  }

  if (
    typeof apiKey !== "string" ||
    typeof timestamp !== "string" ||
    typeof signature !== "string"
  ) {
    res.status(401).json({
      error: "Unauthorized",
      message: "Missing required auth headers: X-QA-Runner-Key, X-QA-Timestamp, X-QA-Signature",
    });
    return false;
  }

  try {
    const keyBuf = Buffer.from(apiKey);
    const expectedBuf = Buffer.from(expectedApiKey);
    if (keyBuf.length !== expectedBuf.length || !timingSafeEqual(keyBuf, expectedBuf)) {
      res.status(401).json({ error: "Unauthorized", message: "Invalid API key" });
      return false;
    }
  } catch {
    res.status(401).json({ error: "Unauthorized", message: "Invalid API key" });
    return false;
  }

  const tsMs = parseInt(timestamp, 10);
  if (isNaN(tsMs) || Math.abs(Date.now() - tsMs) > MAX_TIMESTAMP_SKEW_MS) {
    res.status(401).json({
      error: "Unauthorized",
      message: "Request timestamp expired or invalid (must be within 5 minutes)",
    });
    return false;
  }

  const rawBody: string = (req as any).rawBody ?? JSON.stringify(req.body);
  const expected = createHmac("sha256", hmacSecret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");

  try {
    const sigBuf = Buffer.from(signature, "hex");
    const expectedBuf = Buffer.from(expected, "hex");
    if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) {
      res.status(401).json({ error: "Unauthorized", message: "Invalid signature" });
      return false;
    }
  } catch {
    res.status(401).json({ error: "Unauthorized", message: "Signature verification failed" });
    return false;
  }

  return true;
}

// ---------------------------------------------------------------------------
// POST /api/internal/ai-ledger/start
// ---------------------------------------------------------------------------

router.post("/start", async (req: Request, res: Response) => {
  if (!verifyQaRunnerSignature(req, res)) return;

  const parsed = StartActionBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid request body",
      details: parsed.error.flatten().fieldErrors,
    });
  }

  try {
    const actionId = await startAction({
      agentId: parsed.data.agentId,
      actionType: parsed.data.actionType,
      tenantId: parsed.data.tenantId ?? null,
      requestId: parsed.data.requestId,
      metadata: parsed.data.metadata,
    });

    logInfo("[AiLedger] Action started via proxy", {
      actionId,
      agentId: parsed.data.agentId,
      actionType: parsed.data.actionType,
      requestId: parsed.data.requestId,
    });

    return res.status(201).json({ actionId });
  } catch (err) {
    if (err instanceof SecurityBoundaryViolation) {
      logError("[AiLedger] SecurityBoundaryViolation while proxying startAction", err, {
        requestId: parsed.data.requestId,
        actionType: parsed.data.actionType,
      });
      return res.status(500).json({
        error: "SecurityBoundaryViolation",
        message: err.message,
      });
    }
    logError("[AiLedger] Failed to proxy startAction", err, {
      requestId: parsed.data.requestId,
      actionType: parsed.data.actionType,
    });
    return res.status(500).json({ error: "Failed to start action" });
  }
});

// ---------------------------------------------------------------------------
// POST /api/internal/ai-ledger/transition
// ---------------------------------------------------------------------------

router.post("/transition", async (req: Request, res: Response) => {
  if (!verifyQaRunnerSignature(req, res)) return;

  const parsed = TransitionActionBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid request body",
      details: parsed.error.flatten().fieldErrors,
    });
  }

  try {
    await transitionAction({
      actionId: parsed.data.actionId,
      status: parsed.data.status,
      approvedBy: parsed.data.approvedBy,
      approvalNote: parsed.data.approvalNote,
      artifacts: parsed.data.artifacts as ArtifactRef[] | undefined,
      metadata: parsed.data.metadata,
      errorMessage: parsed.data.errorMessage,
    });

    return res.status(200).json({ ok: true });
  } catch (err) {
    logError("[AiLedger] Failed to proxy transitionAction", err, {
      actionId: parsed.data.actionId,
      status: parsed.data.status,
    });
    return res.status(500).json({ error: "Failed to transition action" });
  }
});

export default router;
