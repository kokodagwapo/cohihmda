import { describe, expect, it } from "vitest";
import { applyChartReadabilityGuard } from "./chartReadability";

describe("applyChartReadabilityGuard", () => {
  const rows = Array.from({ length: 60 }, (_, i) => ({
    loan_officer: `LO ${i}`,
    loan_count: 60 - i,
  }));

  it("trims to max categories for horizontal_bar", () => {
    const result = applyChartReadabilityGuard(
      {
        type: "horizontal_bar",
        title: "Top LOs",
        data: rows,
        xKey: "loan_officer",
        yKey: "loan_count",
      },
      { maxCategories: 10 },
    );
    expect(result.trimmed).toBe(true);
    expect(result.config.data).toHaveLength(10);
    expect(result.config.subtitle).toMatch(/Showing top 10 of 60/);
    expect(result.fullData).toHaveLength(60);
  });

  it("does not trim small datasets", () => {
    const small = rows.slice(0, 5);
    const result = applyChartReadabilityGuard({
      type: "horizontal_bar",
      title: "Top LOs",
      data: small,
      xKey: "loan_officer",
      yKey: "loan_count",
    });
    expect(result.trimmed).toBe(false);
    expect(result.config.data).toHaveLength(5);
  });
});
