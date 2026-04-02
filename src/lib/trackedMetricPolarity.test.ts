import { describe, it, expect } from "vitest";
import { inferTrackedMetricPolarity } from "./trackedMetricPolarity";

/**
 * Stage 6: frontend polarity must stay aligned with server `trackedPolarityInference.ts`
 * (trend delta colors in TrackedInsightDetailModal).
 */
describe("inferTrackedMetricPolarity (client)", () => {
  it("matches server expectations for ticket-mentioned lower-is-better fields", () => {
    expect(inferTrackedMetricPolarity("cycle_time_avg")).toBe("lower_better");
    expect(inferTrackedMetricPolarity("fallout_rate")).toBe("lower_better");
    expect(inferTrackedMetricPolarity("stale_count")).toBe("lower_better");
  });
});
