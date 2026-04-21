import { describe, expect, it } from "vitest";
import { selectBulletSource } from "./bulletSource.js";

describe("selectBulletSource", () => {
  it("uses detail_data.summary for agent findings", () => {
    const result = selectBulletSource({
      generation_method: "agent",
      detail_data: {
        type: "agent_finding",
        summary: "Summary-first sentence.",
      },
      understory: "Fallback understory.",
    });
    expect(result).toEqual({
      text: "Summary-first sentence.",
      sourceLabel: "summary",
    });
  });

  it("falls back to understory when summary is missing", () => {
    const result = selectBulletSource({
      generation_method: "agent",
      detail_data: { type: "agent_finding" },
      understory: "Use this understory.",
    });
    expect(result).toEqual({
      text: "Use this understory.",
      sourceLabel: "understory",
    });
  });
});
