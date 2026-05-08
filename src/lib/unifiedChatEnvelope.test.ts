import { describe, it, expect } from "vitest";
import { parseGlobalUnifiedEnvelope } from "./unifiedChatEnvelope";

describe("parseGlobalUnifiedEnvelope", () => {
  it("extracts navigation_hints from unified turn blocks", () => {
    const env = {
      conversationId: "c1",
      turn: {
        id: "t1",
        blocks: [
          { type: "text" as const, markdown: "Here are the pages." },
          {
            type: "navigation_hints" as const,
            items: [
              { label: "Company Scorecard", path: "/company-scorecard" },
            ],
          },
        ],
      },
      metadata: {},
    };
    const parsed = parseGlobalUnifiedEnvelope(env);
    expect(parsed.navigationHints?.[0]?.path).toBe("/company-scorecard");
  });
});
