/**
 * Internal QA Run Result Endpoint
 *
 * Machine-to-machine endpoint called by the pipeline QA runner after each
 * Playwright execution. Records the run in ai_control_plane.audit_ledger for
 * SOC 2 traceability, including resolved Jira issue keys and generated
 * Confluence QA page URLs when available.
 *
 * Auth: HMAC-SHA256 signed request (X-QA-Runner-Key + X-QA-Timestamp +
 * X-QA-Signature). No JWT — pipeline machines do not hold user credentials.
 *
 * Signature: HMAC-SHA256(QA_RUNNER_HMAC_SECRET, `${timestamp}.${rawBody}`)
 * Requests older than 5 minutes are rejected to prevent replay attacks.
 */

import express, { Request, Response } from "express";
import { createHmac, timingSafeEqual } from "crypto";
import { z } from "zod";
import {
  startAction,
  transitionAction,
} from "../../services/aiAgentOrchestrator.js";
import { logError, logInfo, logWarn } from "../../services/logger.js";

const router = express.Router();

const MAX_TIMESTAMP_SKEW_MS = 5 * 60 * 1000; // 5 minutes

// ---------------------------------------------------------------------------
// Request schema
// ---------------------------------------------------------------------------

const QaRunBodySchema = z.object({
  suite: z.enum(["smoke", "critical", "regression", "all"]),
  browser: z.string().default("chromium"),
  environment: z.enum(["dev", "production", "staging"]),
  total: z.number().int().nonnegative(),
  passed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative(),
  pipelineBuild: z.string(),
  commitHash: z.string(),
  triggeredBy: z.string(),
  confluencePageUrl: z.string().url().optional(),
  confluencePageUrls: z.array(z.string().url()).optional(),
  jiraIssueKeys: z.array(z.string()).optional(),
  s3ReportKey: z.string().optional(),
  issueBreakdowns: z
    .array(
      z.object({
        issueKey: z.string(),
        tests: z.array(
          z.object({
            title: z.string(),
            status: z.string(),
            durationMs: z.number().int().nonnegative(),
          })
        ),
        confluencePageUrl: z.string().url().optional(),
        hasEvidenceGap: z.boolean(),
      })
    )
    .optional(),
  failedTests: z
    .array(
      z.object({
        title: z.string(),
        file: z.string(),
        error: z.string().optional(),
      })
    )
    .optional(),
});

type QaRunBody = z.infer<typeof QaRunBodySchema>;

// ---------------------------------------------------------------------------
// HMAC auth middleware
// ---------------------------------------------------------------------------

function verifyQaRunnerSignature(req: Request, res: Response): boolean {
  const apiKey = req.headers["x-qa-runner-key"];
  const timestamp = req.headers["x-qa-timestamp"];
  const signature = req.headers["x-qa-signature"];

  const expectedApiKey = process.env.QA_RUNNER_API_KEY;
  const hmacSecret = process.env.QA_RUNNER_HMAC_SECRET;

  if (!expectedApiKey || !hmacSecret) {
    logWarn("[QaResults] QA_RUNNER_API_KEY or QA_RUNNER_HMAC_SECRET not configured");
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

  // Validate API key with timing-safe compare
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

  // Reject stale timestamps
  const tsMs = parseInt(timestamp, 10);
  if (isNaN(tsMs) || Math.abs(Date.now() - tsMs) > MAX_TIMESTAMP_SKEW_MS) {
    res.status(401).json({
      error: "Unauthorized",
      message: "Request timestamp expired or invalid (must be within 5 minutes)",
    });
    return false;
  }

  // Verify HMAC signature over `timestamp.rawBody`
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
// POST /api/internal/qa-run
// ---------------------------------------------------------------------------

router.post("/", async (req: Request, res: Response) => {
  if (!verifyQaRunnerSignature(req, res)) return;

  const parsed = QaRunBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid request body",
      details: parsed.error.flatten().fieldErrors,
    });
  }

  const body: QaRunBody = parsed.data;
  const requestId = (req as any).id ?? `qa-${Date.now()}`;

  // Derive final status: any failures → 'failed', otherwise 'executed'
  const finalStatus = body.failed > 0 ? "failed" : "executed";

  let actionId: string;

  try {
    actionId = await startAction({
      agentId: "qa-runner",
      actionType: "qa_test_run",
      requestId,
      tenantId: null,
      metadata: {
        suite: body.suite,
        browser: body.browser,
        environment: body.environment,
        total: body.total,
        passed: body.passed,
        failed: body.failed,
        skipped: body.skipped,
        durationMs: body.durationMs,
        pipelineBuild: body.pipelineBuild,
        commitHash: body.commitHash,
        triggeredBy: body.triggeredBy,
        ...(body.confluencePageUrl && { confluencePageUrl: body.confluencePageUrl }),
        ...(body.confluencePageUrls && { confluencePageUrls: body.confluencePageUrls }),
        ...(body.jiraIssueKeys && { jiraIssueKeys: body.jiraIssueKeys }),
        ...(body.issueBreakdowns && { issueBreakdowns: body.issueBreakdowns }),
      },
    });
  } catch (err) {
    logError("[QaResults] Failed to start audit ledger action", err, { requestId });
    return res.status(500).json({ error: "Failed to record QA run in audit ledger" });
  }

  // Build artifact refs for S3 report
  const artifacts = body.s3ReportKey
    ? [
        {
          bucket: process.env.AI_ARTIFACTS_BUCKET ?? "",
          s3_key: body.s3ReportKey,
          size_bytes: 0,
          content_type: "application/gzip",
        },
      ]
    : undefined;

  try {
    await transitionAction({
      actionId,
      status: finalStatus,
      artifacts,
      metadata: {
        failedTests: body.failedTests ?? [],
        passRate: body.total > 0 ? Math.round((body.passed / body.total) * 100) : 0,
        ...(body.issueBreakdowns && { issueBreakdowns: body.issueBreakdowns }),
      },
      ...(finalStatus === "failed" && {
        errorMessage: `${body.failed} test(s) failed in suite '${body.suite}' (build ${body.pipelineBuild})`,
      }),
    });
  } catch (err) {
    // Non-fatal: ledger row was created, transition is best-effort
    logWarn("[QaResults] Failed to transition audit ledger action", { actionId, finalStatus });
    logError("[QaResults] Transition error", err);
  }

  logInfo("[QaResults] QA run recorded", {
    actionId,
    suite: body.suite,
    environment: body.environment,
    total: body.total,
    passed: body.passed,
    failed: body.failed,
    status: finalStatus,
    build: body.pipelineBuild,
  });

  return res.status(201).json({
    actionId,
    status: finalStatus,
    recorded: true,
  });
});

export default router;
