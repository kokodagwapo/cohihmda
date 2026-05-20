/**
 * W1-5 — mocked v1 API route tests (permissions + validation).
 */

import { describe, it, expect, vi, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import type { Router } from "express";

vi.mock("../middleware/auth.js", () => ({
  authenticateToken: (
    _req: express.Request,
    _res: express.Response,
    next: express.NextFunction,
  ) => {
    next();
  },
}));

vi.mock("../middleware/tenantContext.js", () => ({
  attachTenantContext: (
    req: express.Request,
    _res: express.Response,
    next: express.NextFunction,
  ) => {
    (req as express.Request & { tenantId?: string; userId?: string }).tenantId =
      "t1";
    (req as express.Request & { userId?: string }).userId =
      "550e8400-e29b-41d4-a716-446655440000";
    (req as express.Request & { tenantContext?: { tenantId: string } }).tenantContext =
      { tenantId: "t1" };
    next();
  },
}));

vi.mock("../middleware/rateLimiter.js", () => ({
  apiLimiter: (
    _req: express.Request,
    _res: express.Response,
    next: express.NextFunction,
  ) => next(),
}));

vi.mock("../services/chat/unifiedChatConfig.js", () => ({
  isUnifiedChatApiEnabled: () => true,
}));

const rebindMock = vi.fn(async () => ({
  id: "550e8400-e29b-41d4-a716-446655440010",
  title: "Canvas chat",
  scope_type: "canvas",
  scope_key: "canvas-1",
  chat_type: "workbench",
  legacy_ref: null,
  legacy_source: null,
  folder_id: null,
  messages: [],
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
}));

vi.mock("../services/chat/unifiedConversationService.js", () => ({
  appendUnifiedChatTurns: vi.fn(),
  getUnifiedConversation: vi.fn(),
  createUnifiedConversation: vi.fn(),
  deleteUnifiedConversation: vi.fn(),
  patchUnifiedConversation: vi.fn(),
  findUnifiedConversationByLegacyRef: vi.fn(),
  rebindUnifiedConversation: (...args: unknown[]) => rebindMock(...args),
}));

vi.mock("../services/chat/unifiedChatOrchestrator.js", () => ({
  processUnifiedChatMessage: vi.fn(),
  shouldUseWorkbench: vi.fn(() => false),
}));

vi.mock("../services/chat/unifiedChatFolderService.js", () => ({
  listUnifiedChatFolders: vi.fn(async () => []),
  createUnifiedChatFolder: vi.fn(),
  renameUnifiedChatFolder: vi.fn(),
  moveUnifiedChatFolder: vi.fn(),
  deleteUnifiedChatFolder: vi.fn(),
}));

vi.mock("../services/chat/historyRepository.js", () => ({
  listCanonicalHistory: vi.fn(async () => []),
}));

vi.mock("../services/chat/unifiedChatIdempotency.js", () => ({
  tryReserveClientMessageId: vi.fn(async () => "ok"),
}));

vi.mock("../services/chat/unifiedChatGlobalStream.js", () => ({
  runUnifiedGlobalStream: vi.fn(),
}));

vi.mock("../services/chat/unifiedResearchStream.js", () => ({
  runUnifiedResearchStream: vi.fn(),
}));

vi.mock("../services/chat/unifiedChatInsightBuilderStream.js", () => ({
  runUnifiedInsightBuilderStream: vi.fn(),
}));

vi.mock("../services/chat/unifiedChatStream.js", () => ({
  emitValidatedStreamWithDeltas: vi.fn(),
}));

vi.mock("../services/chat/policyEngine.js", () => ({
  buildUnifiedChatPermissions: vi.fn(async () => ({
    cohiChat: true,
    chatTypes: ["chat", "research", "insight_builder", "workbench"],
  })),
  assertUnifiedChatAllowed: vi.fn(async () => ({
    ok: true,
    decision: {
      allowed: true,
      decisionId: "pol_test",
      chatType: "chat",
      retrieval: "allow",
      sqlExecution: "allow",
    },
  })),
}));

let chatV1Router: Router;

beforeAll(async () => {
  const mod = await import("./chatV1.js");
  chatV1Router = mod.default;
});

function chatV1App(): express.Express {
  const app = express();
  app.use(express.json());
  app.use("/api/chat/v1", chatV1Router);
  return app;
}

describe("GET /api/chat/v1/permissions", () => {
  it("returns permissions when unified API enabled", async () => {
    const res = await request(chatV1App()).get("/api/chat/v1/permissions");
    expect(res.status).toBe(200);
    expect(res.body.cohiChat).toBe(true);
    expect(Array.isArray(res.body.chatTypes)).toBe(true);
  });
});

describe("POST /api/chat/v1/conversations/:id/rebind (COHI-395 AC4)", () => {
  it("rebinds scope when body is valid", async () => {
    rebindMock.mockClear();

    const res = await request(chatV1App())
      .post(
        "/api/chat/v1/conversations/550e8400-e29b-41d4-a716-446655440010/rebind",
      )
      .send({
        scope: { type: "canvas", id: "canvas-1" },
        chat_type: "workbench",
      });
    expect(res.status).toBe(200);
    expect(res.body.scope).toEqual({ type: "canvas", id: "canvas-1" });
    expect(rebindMock).toHaveBeenCalled();
  });
});

describe("POST /api/chat/v1/messages validation", () => {
  it("rejects empty message", async () => {
    const res = await request(chatV1App())
      .post("/api/chat/v1/messages")
      .send({ message: "" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("validation_error");
  });
});
