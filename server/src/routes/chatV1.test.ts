/**
 * chatV1 route tests (COHI-387 / COHI-401 / Wave 1 W1-3):
 *   - 404 when UNIFIED_CHAT_ENABLED=false
 *   - 400 on validation failure
 *   - 409 on duplicate clientMessageId
 *   - 200 on /conversations list (canonical history through dual-read adapter)
 *   - 204 on conversation delete
 */

import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  reserveMock,
  processMock,
  appendMock,
  listCanonicalMock,
  deleteMock,
  permsMock,
  assertAllowedMock,
  researchStreamMock,
} = vi.hoisted(() => ({
  reserveMock: vi.fn(),
  processMock: vi.fn(),
  appendMock: vi.fn(),
  listCanonicalMock: vi.fn(),
  deleteMock: vi.fn(),
  permsMock: vi.fn(),
  assertAllowedMock: vi.fn(),
  researchStreamMock: vi.fn(),
}));

vi.mock("../middleware/auth.js", () => ({
  authenticateToken: (req: any, _res: any, next: any) => {
    req.userId = "11111111-1111-1111-1111-111111111111";
    req.userEmail = "user@example.com";
    req.userRole = "user";
    req.tenantId = "tenant-test";
    next();
  },
}));

vi.mock("../middleware/tenantContext.js", () => ({
  attachTenantContext: (req: any, _res: any, next: any) => {
    req.tenantContext = { tenantId: "tenant-test" };
    next();
  },
}));

vi.mock("../middleware/rateLimiter.js", () => ({
  apiLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../services/chat/unifiedChatIdempotency.js", () => ({
  tryReserveClientMessageId: reserveMock,
}));

vi.mock("../services/chat/unifiedChatOrchestrator.js", () => ({
  processUnifiedChatMessage: processMock,
}));

vi.mock("../services/chat/unifiedConversationService.js", () => ({
  appendUnifiedChatTurns: appendMock,
  getUnifiedConversation: vi.fn(),
  createUnifiedConversation: vi.fn(),
  deleteUnifiedConversation: deleteMock,
  rebindUnifiedConversation: vi.fn(),
  findUnifiedConversationByLegacyRef: vi.fn(),
}));

vi.mock("../services/chat/historyRepository.js", () => ({
  listCanonicalHistory: listCanonicalMock,
}));

vi.mock("../services/chat/policyEngine.js", () => ({
  buildUnifiedChatPermissions: permsMock,
  assertUnifiedChatAllowed: assertAllowedMock,
}));

vi.mock("../services/chat/unifiedResearchStream.js", () => ({
  runUnifiedResearchStream: researchStreamMock,
}));

function buildApp(): Promise<express.Express> {
  // import after mocks
  return import("./chatV1.js").then((mod) => {
    const app = express();
    app.use(express.json());
    app.use("/api/chat/v1", mod.default);
    return app;
  });
}

beforeEach(() => {
  reserveMock.mockReset();
  processMock.mockReset();
  appendMock.mockReset();
  listCanonicalMock.mockReset();
  deleteMock.mockReset();
  permsMock.mockReset();
  assertAllowedMock.mockReset();
  researchStreamMock.mockReset();
  appendMock.mockResolvedValue(undefined);
  permsMock.mockResolvedValue({
    cohiChat: true,
    chatTypes: ["chat", "research", "workbench"],
  });
  assertAllowedMock.mockResolvedValue({
    ok: true,
    decision: {
      allowed: true,
      decisionId: "pol_test",
      chatType: "research",
      retrieval: "allow",
      sqlExecution: "allow",
    },
  });
});

describe("chatV1 — guard / validation / idempotency", () => {
  it("returns 404 when UNIFIED_CHAT_ENABLED=false", async () => {
    const prev = process.env.UNIFIED_CHAT_ENABLED;
    process.env.UNIFIED_CHAT_ENABLED = "false";
    try {
      const app = await buildApp();
      const res = await request(app).post("/api/chat/v1/messages").send({ message: "hi" });
      expect(res.status).toBe(404);
      expect(res.body.error).toBe("not_found");
    } finally {
      if (prev === undefined) delete process.env.UNIFIED_CHAT_ENABLED;
      else process.env.UNIFIED_CHAT_ENABLED = prev;
    }
  });

  it("returns 400 when message is missing", async () => {
    process.env.UNIFIED_CHAT_ENABLED = "true";
    const app = await buildApp();
    const res = await request(app).post("/api/chat/v1/messages").send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("validation_error");
  });

  it("returns 409 on duplicate clientMessageId", async () => {
    process.env.UNIFIED_CHAT_ENABLED = "true";
    reserveMock.mockResolvedValue("duplicate");
    const app = await buildApp();
    const res = await request(app)
      .post("/api/chat/v1/messages")
      .send({
        message: "hello",
        clientMessageId: "550e8400-e29b-41d4-a716-446655440000",
      });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("duplicate_message");
  });

  it("returns 200 with turn envelope on successful POST /messages", async () => {
    process.env.UNIFIED_CHAT_ENABLED = "true";
    reserveMock.mockResolvedValue("reserved");
    processMock.mockResolvedValue({
      conversationId: "550e8400-e29b-41d4-a716-446655440000",
      turn: {
        id: "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
        blocks: [{ type: "text", markdown: "ack" }],
      },
      metadata: { chatType: "chat" },
      legacyRef: null,
      legacySource: null,
    });
    const app = await buildApp();
    const res = await request(app).post("/api/chat/v1/messages").send({ message: "hi" });
    expect(res.status).toBe(200);
    expect(res.body.conversationId).toBe("550e8400-e29b-41d4-a716-446655440000");
    expect(res.body.turn.blocks[0].markdown).toBe("ack");
    expect(appendMock).toHaveBeenCalled();
  });
});

describe("chatV1 — POST /messages:stream research (COHI-402 AC4)", () => {
  it("returns SSE with block.delta and researchShellExpand metadata", async () => {
    process.env.UNIFIED_CHAT_ENABLED = "true";
    reserveMock.mockResolvedValue("reserved");
    const conversationId = "550e8400-e29b-41d4-a716-446655440000";
    const turnId = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";

    researchStreamMock.mockImplementation(
      async (args: {
        res: { write: (s: string) => void; end: () => void; status: (n: number) => unknown; setHeader: () => void };
        conversationId: string;
        turnId: string;
      }) => {
        args.res.status(200);
        args.res.setHeader("Content-Type", "text/event-stream");
        const emit = (payload: Record<string, unknown>) => {
          args.res.write(`data: ${JSON.stringify(payload)}\n\n`);
        };
        emit({
          event: "turn.started",
          conversationId: args.conversationId,
          turnId: args.turnId,
          metadata: { researchShellExpand: true, chatType: "research" },
        });
        emit({
          event: "block.delta",
          conversationId: args.conversationId,
          turnId: args.turnId,
          blockIndex: 0,
          blockType: "text",
          delta: "Planning",
        });
        emit({
          event: "turn.completed",
          conversationId: args.conversationId,
          turnId: args.turnId,
          metadata: { researchShellExpand: true, chatType: "research" },
        });
        return {
          finalBlocks: [{ type: "text", markdown: "Planning" }],
          metadata: { researchShellExpand: true, researchSessionId: "rs-1" },
          legacyRef: "rs-1",
        };
      },
    );

    const app = await buildApp();
    const res = await request(app)
      .post("/api/chat/v1/messages:stream")
      .send({
        message: "Analyze branch 2001",
        chat_type: "research",
        clientMessageId: "6ba7b810-9dad-11d1-80b4-00c04fd430c9",
        location: { surface: "data_chat_page" },
        scope: { type: "global_session" },
        options: { stream: true },
      });

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/event-stream/);
    expect(res.text).toContain("block.delta");
    expect(res.text).toContain("researchShellExpand");
    expect(researchStreamMock).toHaveBeenCalled();
    expect(appendMock).toHaveBeenCalled();
  });
});

describe("chatV1 — /conversations dual-read wiring (COHI-395/402)", () => {
  it("delegates to listCanonicalHistory and normalizes shape", async () => {
    process.env.UNIFIED_CHAT_ENABLED = "true";
    listCanonicalMock.mockResolvedValue([
      {
        conversation_id: "550e8400-e29b-41d4-a716-446655440000",
        title: "Unified row",
        chat_type: "chat",
        scope_type: "global_session",
        scope_key: null,
        updated_at: "2024-06-01T00:00:00.000Z",
        created_at: "2024-05-01T00:00:00.000Z",
        legacy_source: null,
        legacy_ref: null,
        folder_id: null,
      },
      {
        conversation_id: "legacy-1",
        title: "Legacy research",
        chat_type: "research",
        scope_type: "global_session",
        scope_key: null,
        updated_at: "2024-05-01T00:00:00.000Z",
        created_at: null,
        legacy_source: "research_lab",
        legacy_ref: "legacy-1",
        folder_id: null,
      },
    ]);

    const app = await buildApp();
    const res = await request(app).get("/api/chat/v1/conversations");
    expect(res.status).toBe(200);
    expect(listCanonicalMock).toHaveBeenCalled();
    expect(res.body.conversations).toHaveLength(2);
    expect(res.body.conversations[0]).toMatchObject({
      id: "550e8400-e29b-41d4-a716-446655440000",
      chat_type: "chat",
      legacy_source: null,
    });
    expect(res.body.conversations[1]).toMatchObject({
      id: "legacy-1",
      chat_type: "research",
      legacy_source: "research_lab",
      legacy_ref: "legacy-1",
    });
  });
});

describe("chatV1 — DELETE /conversations/:id", () => {
  it("returns 404 when delete misses", async () => {
    process.env.UNIFIED_CHAT_ENABLED = "true";
    deleteMock.mockResolvedValue(false);
    const app = await buildApp();
    const res = await request(app).delete(
      "/api/chat/v1/conversations/550e8400-e29b-41d4-a716-446655440000",
    );
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("not_found");
  });

  it("returns 204 on successful delete", async () => {
    process.env.UNIFIED_CHAT_ENABLED = "true";
    deleteMock.mockResolvedValue(true);
    const app = await buildApp();
    const res = await request(app).delete(
      "/api/chat/v1/conversations/550e8400-e29b-41d4-a716-446655440000",
    );
    expect(res.status).toBe(204);
  });

  it("returns 400 on invalid uuid", async () => {
    process.env.UNIFIED_CHAT_ENABLED = "true";
    const app = await buildApp();
    const res = await request(app).delete("/api/chat/v1/conversations/not-a-uuid");
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("validation_error");
  });
});
