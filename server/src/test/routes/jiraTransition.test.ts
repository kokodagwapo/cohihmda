import { createHmac } from "crypto";
import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../services/aiAgentOrchestrator.js", () => ({
  listActionsByStatus: vi.fn(),
  transitionAction: vi.fn(),
}));

import jiraTransitionRoute from "../../routes/webhooks/jiraTransition.js";
import * as orchestrator from "../../services/aiAgentOrchestrator.js";

const mockListActionsByStatus = vi.mocked(orchestrator.listActionsByStatus);
const mockTransitionAction = vi.mocked(orchestrator.transitionAction);

function buildApp() {
  const app = express();
  app.use(
    express.json({
      verify: (req: any, _res, buf) => {
        req.rawBody = buf.toString("utf8");
      },
    }),
  );
  app.use("/api/webhooks/jira-transition", jiraTransitionRoute);
  return app;
}

function signedHeaders(body: unknown, secret = "jira-secret") {
  const rawBody = JSON.stringify(body);
  return {
    "X-Jira-Webhook-Signature": createHmac("sha256", secret).update(rawBody).digest("hex"),
  };
}

describe("jira transition webhook", () => {
  const app = buildApp();
  const payload = {
    issue: { key: "COHI-96" },
    transition: { to_status: { name: "Evidence Approved" } },
  };

  beforeEach(() => {
    process.env.JIRA_WEBHOOK_SECRET = "jira-secret";
    mockListActionsByStatus.mockResolvedValue([
      {
        action_id: "action-1",
        metadata: { issueKey: "COHI-96" },
      } as any,
    ]);
    mockTransitionAction.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.JIRA_WEBHOOK_SECRET;
  });

  it("rejects invalid signatures", async () => {
    const res = await request(app)
      .post("/api/webhooks/jira-transition")
      .set("X-Jira-Webhook-Signature", "deadbeef")
      .send(payload);

    expect(res.status).toBe(401);
    expect(mockTransitionAction).not.toHaveBeenCalled();
  });

  it("transitions matching pending evidence-review actions", async () => {
    const res = await request(app)
      .post("/api/webhooks/jira-transition")
      .set(signedHeaders(payload))
      .send(payload);

    expect(res.status).toBe(200);
    expect(mockListActionsByStatus).toHaveBeenCalledWith("pending_evidence_review");
    expect(mockTransitionAction).toHaveBeenCalledWith(
      expect.objectContaining({
        actionId: "action-1",
        status: "evidence_approved",
      }),
    );
  });
});
