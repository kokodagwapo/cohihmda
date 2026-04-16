import { createHmac } from "crypto";
import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../services/aiAgentOrchestrator.js", () => ({
  startAction: vi.fn(),
  transitionAction: vi.fn(),
}));

vi.mock("../../services/logger.js", () => ({
  logError: vi.fn(),
  logInfo: vi.fn(),
  logWarn: vi.fn(),
}));

import qaResultsRoutes from "../../routes/internal/qaResults.js";
import * as orchestrator from "../../services/aiAgentOrchestrator.js";

const mockStartAction = vi.mocked(orchestrator.startAction);
const mockTransitionAction = vi.mocked(orchestrator.transitionAction);

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.id = "test-request-id";
    next();
  });
  app.use("/api/internal/qa-run", qaResultsRoutes);
  return app;
}

function signedHeaders(body: unknown, overrides?: { apiKey?: string; hmacSecret?: string; timestamp?: string }) {
  const apiKey = overrides?.apiKey ?? "test-api-key";
  const hmacSecret = overrides?.hmacSecret ?? "test-hmac-secret";
  const timestamp = overrides?.timestamp ?? String(Date.now());
  const rawBody = JSON.stringify(body);
  const signature = createHmac("sha256", hmacSecret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");

  return {
    "X-QA-Runner-Key": apiKey,
    "X-QA-Timestamp": timestamp,
    "X-QA-Signature": signature,
  };
}

describe("qaResults internal route", () => {
  const app = buildApp();
  const originalEnv = {
    QA_RUNNER_API_KEY: process.env.QA_RUNNER_API_KEY,
    QA_RUNNER_HMAC_SECRET: process.env.QA_RUNNER_HMAC_SECRET,
    AI_ARTIFACTS_BUCKET: process.env.AI_ARTIFACTS_BUCKET,
  };

  const body = {
    suite: "critical",
    browser: "chromium",
    environment: "dev",
    total: 10,
    passed: 9,
    failed: 1,
    skipped: 0,
    durationMs: 1234,
    pipelineBuild: "42",
    commitHash: "abc1234",
    triggeredBy: "pipeline:bitbucket/42",
    s3ReportKey: "ai-control-plane/dev/2026/04/14/qa-runs/42/report.tar.gz",
    jiraIssueKeys: ["COHI-106"],
    confluencePageUrls: ["https://cohi.atlassian.net/wiki/pages/12345"],
    failedTests: [
      {
        title: "example test",
        file: "e2e/example.spec.ts",
        error: "Assertion failed",
      },
    ],
  } as const;

  beforeEach(() => {
    process.env.QA_RUNNER_API_KEY = "test-api-key";
    process.env.QA_RUNNER_HMAC_SECRET = "test-hmac-secret";
    process.env.AI_ARTIFACTS_BUCKET = "qa-artifacts-bucket";
    mockStartAction.mockResolvedValue("action-123");
    mockTransitionAction.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
    process.env.QA_RUNNER_API_KEY = originalEnv.QA_RUNNER_API_KEY;
    process.env.QA_RUNNER_HMAC_SECRET = originalEnv.QA_RUNNER_HMAC_SECRET;
    process.env.AI_ARTIFACTS_BUCKET = originalEnv.AI_ARTIFACTS_BUCKET;
  });

  it("rejects requests missing HMAC auth headers", async () => {
    const res = await request(app)
      .post("/api/internal/qa-run")
      .send(body);

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Unauthorized");
    expect(mockStartAction).not.toHaveBeenCalled();
  });

  it("rejects requests with invalid signatures", async () => {
    const res = await request(app)
      .post("/api/internal/qa-run")
      .set({
        ...signedHeaders(body),
        "X-QA-Signature": "deadbeef",
      })
      .send(body);

    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/signature/i);
    expect(mockStartAction).not.toHaveBeenCalled();
  });

  it("records a valid QA run and transitions the ledger row", async () => {
    const res = await request(app)
      .post("/api/internal/qa-run")
      .set(signedHeaders(body))
      .send(body);

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      actionId: "action-123",
      status: "failed",
      recorded: true,
    });

    expect(mockStartAction).toHaveBeenCalledWith(expect.objectContaining({
      agentId: "qa-runner",
      actionType: "qa_test_run",
      requestId: "test-request-id",
      metadata: expect.objectContaining({
        suite: "critical",
        jiraIssueKeys: ["COHI-106"],
      }),
    }));

    expect(mockTransitionAction).toHaveBeenCalledWith(expect.objectContaining({
      actionId: "action-123",
      status: "failed",
      artifacts: [
        expect.objectContaining({
          bucket: "qa-artifacts-bucket",
          s3_key: body.s3ReportKey,
        }),
      ],
      metadata: expect.objectContaining({
        passRate: 90,
      }),
    }));
  });
});
