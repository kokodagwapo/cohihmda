import { describe, it, expect } from "vitest";
import {
  validateUnifiedChatRequest,
  validateUnifiedChatResponse,
  validateUnifiedStreamEvent,
} from "./unifiedChatSchemas.js";

describe("unified chat JSON schemas", () => {
  it("accepts minimal valid request", () => {
    const ok = validateUnifiedChatRequest({ message: "Hello" });
    expect(ok).toBe(true);
  });

  it("rejects empty message", () => {
    const ok = validateUnifiedChatRequest({ message: "" });
    expect(ok).toBe(false);
  });

  it("accepts chat_type research with deepAnalysis true", () => {
    const ok = validateUnifiedChatRequest({
      message: "Dig in",
      chat_type: "research",
      options: { research: { deepAnalysis: true } },
    });
    expect(ok).toBe(true);
  });

  it("accepts research uploadIds when chat_type is research", () => {
    const ok = validateUnifiedChatRequest({
      message: "Analyze upload",
      chat_type: "research",
      options: {
        research: {
          uploadIds: ["550e8400-e29b-41d4-a716-446655440001"],
        },
      },
    });
    expect(ok).toBe(true);
  });

  it("rejects uploadIds when chat_type is not research", () => {
    const ok = validateUnifiedChatRequest({
      message: "x",
      chat_type: "chat",
      options: {
        research: {
          uploadIds: ["550e8400-e29b-41d4-a716-446655440001"],
        },
      },
    });
    expect(ok).toBe(false);
  });

  it("rejects deepAnalysis true when chat_type is not research", () => {
    const ok = validateUnifiedChatRequest({
      message: "x",
      chat_type: "chat",
      options: { research: { deepAnalysis: true } },
    });
    expect(ok).toBe(false);
  });

  it("accepts datasetUploadIds when chat_type is chat", () => {
    const ok = validateUnifiedChatRequest({
      message: "Analyze CSV",
      chat_type: "chat",
      options: {
        datasetUploadIds: ["550e8400-e29b-41d4-a716-446655440001"],
      },
    });
    expect(ok).toBe(true);
  });

  it("accepts datasetUploadIds when chat_type is workbench", () => {
    const ok = validateUnifiedChatRequest({
      message: "Build widget",
      chat_type: "workbench",
      options: {
        datasetUploadIds: ["550e8400-e29b-41d4-a716-446655440001"],
      },
    });
    expect(ok).toBe(true);
  });

  it("rejects datasetUploadIds when chat_type is insight_builder", () => {
    const ok = validateUnifiedChatRequest({
      message: "x",
      chat_type: "insight_builder",
      options: {
        datasetUploadIds: ["550e8400-e29b-41d4-a716-446655440001"],
      },
    });
    expect(ok).toBe(false);
  });

  it("accepts valid response envelope", () => {
    const ok = validateUnifiedChatResponse({
      conversationId: "550e8400-e29b-41d4-a716-446655440000",
      turn: {
        id: "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
        blocks: [{ type: "text", markdown: "Hi" }],
      },
    });
    expect(ok).toBe(true);
  });

  it("accepts streaming MVP event sequence shapes", () => {
    const cid = "550e8400-e29b-41d4-a716-446655440000";
    const tid = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";
    expect(validateUnifiedStreamEvent({ event: "turn.started", conversationId: cid, turnId: tid })).toBe(true);
    expect(
      validateUnifiedStreamEvent({
        event: "block.started",
        conversationId: cid,
        turnId: tid,
        blockIndex: 0,
        blockType: "text",
      }),
    ).toBe(true);
    expect(
      validateUnifiedStreamEvent({
        event: "block.completed",
        conversationId: cid,
        turnId: tid,
        blockIndex: 0,
        blockType: "text",
        block: { type: "text", markdown: "Hello" },
      }),
    ).toBe(true);
    expect(
      validateUnifiedStreamEvent({
        event: "turn.completed",
        conversationId: cid,
        turnId: tid,
        metadata: { chatType: "chat" },
      }),
    ).toBe(true);
  });

  it("accepts block.delta events (COHI-388 streaming)", () => {
    const cid = "550e8400-e29b-41d4-a716-446655440000";
    const tid = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";
    expect(
      validateUnifiedStreamEvent({
        event: "block.delta",
        conversationId: cid,
        turnId: tid,
        blockIndex: 0,
        blockType: "text",
        delta: "Hello ",
      }),
    ).toBe(true);
  });
});
