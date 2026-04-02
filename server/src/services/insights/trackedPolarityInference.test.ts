import { describe, it, expect } from "vitest";
import { inferTrackedMetricPolarity } from "./trackedPolarityInference.js";

/**
 * Stage 6 / Suggested Test Plan: polarity for lower-is-better metrics (cycle_time, fallout_rate, stale_count).
 */
describe("inferTrackedMetricPolarity", () => {
  it("treats cycle_time style keys as lower_better", () => {
    expect(inferTrackedMetricPolarity("avg_cycle_time_days")).toBe("lower_better");
    expect(inferTrackedMetricPolarity("cycle_time_mtd")).toBe("lower_better");
  });

  it("treats fallout_rate style keys as lower_better (fallout substring)", () => {
    expect(inferTrackedMetricPolarity("fallout_rate")).toBe("lower_better");
    expect(inferTrackedMetricPolarity("pipeline_fallout_pct")).toBe("lower_better");
  });

  it("treats stale_count style keys as lower_better (stale substring)", () => {
    expect(inferTrackedMetricPolarity("stale_count")).toBe("lower_better");
    expect(inferTrackedMetricPolarity("stale_loans")).toBe("lower_better");
  });

  it("treats revenue and loan_count style metrics as higher_better", () => {
    expect(inferTrackedMetricPolarity("revenue_mtd")).toBe("higher_better");
    expect(inferTrackedMetricPolarity("loan_count")).toBe("higher_better");
  });

  it("returns neutral when no rule matches", () => {
    expect(inferTrackedMetricPolarity("foobar_metric")).toBe("neutral");
  });
});
