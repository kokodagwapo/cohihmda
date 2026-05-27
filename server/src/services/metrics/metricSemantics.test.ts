import { describe, expect, it } from "vitest";
import {
  detectSnapshotColumnsInTimeframeTable,
  isSnapshotMetricId,
  validateMetricSpecWindows,
} from "./metricSemantics.js";

describe("metricSemantics", () => {
  it("identifies snapshot catalog metrics", () => {
    expect(isSnapshotMetricId("active_loans")).toBe(true);
    expect(isSnapshotMetricId("pull_through_rate")).toBe(false);
  });

  it("warns when snapshot metrics use a date window", () => {
    const warnings = validateMetricSpecWindows({
      metricIds: ["active_loans"],
      window: "ytd",
    });
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toMatch(/snapshot/i);
  });

  it("detects identical snapshot columns across timeframe rows", () => {
    const cols = detectSnapshotColumnsInTimeframeTable(
      ["timeframe", "active_loans", "applications"],
      [
        { timeframe: "YTD", active_loans: 496, applications: 1402 },
        { timeframe: "90D", active_loans: 496, applications: 829 },
      ],
    );
    expect(cols).toContain("active_loans");
    expect(cols).not.toContain("applications");
  });
});
