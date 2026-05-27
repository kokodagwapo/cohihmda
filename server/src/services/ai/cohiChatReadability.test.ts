import { describe, expect, it } from "vitest";
import { applyVisualizationReadabilityGuard } from "./cohiChatService.js";

describe("applyVisualizationReadabilityGuard", () => {
  it("trims ranking chart to top N with subtitle", () => {
    const data = Array.from({ length: 40 }, (_, i) => ({
      loan_officer: `LO ${i}`,
      loan_count: 40 - i,
    }));
    const config = applyVisualizationReadabilityGuard(
      {
        type: "horizontal_bar",
        title: "Top LOs",
        data,
        xKey: "loan_officer",
        yKey: "loan_count",
      },
      { rankingIntent: { kind: "top", limit: 10, isRanking: true } },
    );
    expect(config.data).toHaveLength(10);
    expect(config.fullData).toHaveLength(40);
    expect(config.subtitle).toMatch(/Showing top 10 of 40/);
  });
});
