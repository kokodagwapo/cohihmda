import { createHmac } from "crypto";
import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../services/aiAgentOrchestrator.js", async () => {
  const actual = await vi.importActual<
    typeof import("../../services/aiAgentOrchestrator.js")
  >("../../services/aiAgentOrchestrator.js");
  return {
    ...actual,
    startAction: vi.fn(),
    transitionAction: vi.fn(),
  };
});

vi.mock("../../services/logger.js", () => ({
  logError: vi.fn(),
  logInfo: vi.fn(),
  logWarn: vi.fn(),
}));

import aiLedgerRoutes from "../../routes/internal/aiLedger.js";
import * as orchestrator from "../../services/aiAgentOrchestrator.js";

const mockStartAction = vi.mocked(orchestrator.startAction);
const mockTransitionAction = vi.mocked(orchestrator.transitionAction);

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/internal/ai-ledger", aiLedgerRoutes);
  return app;
}

function signedHeaders(
  body: unknown,
  overrides?: { apiKey?: string; hmacSecret?: string; timestamp?: string },
) {
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

describe("aiLedger internal route", () => {
  const app = buildApp();
  const originalEnv = {
    QA_RUNNER_API_KEY: process.env.QA_RUNNER_API_KEY,
    QA_RUNNER_HMAC_SECRET: process.env.QA_RUNNER_HMAC_SECRET,
  };

  beforeEach(() => {
    process.env.QA_RUNNER_API_KEY = "test-api-key";
    process.env.QA_RUNNER_HMAC_SECRET = "test-hmac-secret";
    mockStartAction.mockResolvedValue("action-abc");
    mockTransitionAction.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
    process.env.QA_RUNNER_API_KEY = originalEnv.QA_RUNNER_API_KEY;
    process.env.QA_RUNNER_HMAC_SECRET = originalEnv.QA_RUNNER_HMAC_SECRET;
  });

  it("rejects /start with invalid signature", async () => {
    const body = {
      agentId: "ai-ac-validator",
      actionType: "ac_validation",
      requestId: "qa-ac-1-cohi-96",
    };

    const res = await request(app)
      .post("/api/internal/ai-ledger/start")
      .set({
        ...signedHeaders(body),
        "X-QA-Signature": "deadbeef",
      })
      .send(body);

    expect(res.status).toBe(401);
    expect(mockStartAction).not.toHaveBeenCalled();
  });

  it("proxies /start to orchestrator.startAction on valid HMAC", async () => {
    const body = {
      agentId: "ai-ac-validator",
      actionType: "ac_validation",
      requestId: "qa-ac-1-cohi-96",
      metadata: { issueKey: "COHI-96" },
    };

    const res = await request(app)
      .post("/api/internal/ai-ledger/start")
      .set(signedHeaders(body))
      .send(body);

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ actionId: "action-abc" });
    expect(mockStartAction).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: "ai-ac-validator",
        actionType: "ac_validation",
        requestId: "qa-ac-1-cohi-96",
        tenantId: null,
        metadata: { issueKey: "COHI-96" },
      }),
    );
  });

  it("proxies /transition to orchestrator.transitionAction on valid HMAC", async () => {
    const body = {
      actionId: "action-abc",
      status: "pending_evidence_review",
      metadata: { writesPerformed: 2 },
    };

    const res = await request(app)
      .post("/api/internal/ai-ledger/transition")
      .set(signedHeaders(body))
      .send(body);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(mockTransitionAction).toHaveBeenCalledWith(
      expect.objectContaining({
        actionId: "action-abc",
        status: "pending_evidence_review",
        metadata: { writesPerformed: 2 },
      }),
    );
  });
});
