import { describe, it, expect } from "vitest";
import {
  validateUnifiedChatRequest,
  validateUnifiedChatResponse,
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
});
