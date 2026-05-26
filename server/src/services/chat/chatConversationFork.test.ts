import { describe, expect, it } from "vitest";
import {
  formatCarryOverPriorContext,
  formatCarryOverSteeringDirective,
  prependCarryOverToHistory,
  readCarryOverContext,
} from "./chatConversationFork.js";
import type { UnifiedChatRequestBody } from "./unifiedChatOrchestrator.js";

describe("chatConversationFork", () => {
  it("readCarryOverContext returns null when missing", () => {
    expect(readCarryOverContext({ message: "hi" } as UnifiedChatRequestBody)).toBeNull();
  });

  it("prepends carry-over block to history", () => {
    const body = {
      message: "Continue",
      history: [{ role: "user" as const, content: "Earlier" }],
      context: {
        carryOverContext: {
          fromConversationId: "11111111-1111-4111-8111-111111111111",
          fromChatType: "workbench",
          fromTitle: "MTD build",
          summary: "User asked for MTD dashboard.",
        },
      },
    } as UnifiedChatRequestBody;

    const carry = readCarryOverContext(body);
    expect(carry?.fromConversationId).toBe("11111111-1111-4111-8111-111111111111");
    prependCarryOverToHistory(body, carry!);
    expect(body.history?.[0]?.content).toContain("Context carried over");
    expect(body.history?.[0]?.content).toContain("MTD build");
  });

  it("formatCarryOverPriorContext includes summary and chat type", () => {
    const carry = {
      fromConversationId: "11111111-1111-4111-8111-111111111111",
      fromChatType: "chat",
      fromTitle: "Pipeline Q&A",
      summary: "User asked about pull-through.",
    };
    const ctx = formatCarryOverPriorContext(carry);
    expect(ctx).toContain("PRIOR CHAT CONTEXT");
    expect(ctx).toContain("Pipeline Q&A");
    expect(ctx).toContain("pull-through");
  });

  it("formatCarryOverSteeringDirective includes summary", () => {
    const carry = {
      fromConversationId: "11111111-1111-4111-8111-111111111111",
      fromChatType: "workbench",
      summary: "Built MTD widgets.",
    };
    const directive = formatCarryOverSteeringDirective(carry);
    expect(directive).toContain("workbench");
    expect(directive).toContain("MTD widgets");
  });
});
