import { describe, it, expect } from "vitest";
import { resolveTrackedInsightSqlParams } from "./trackedInsightParamResolution.js";

describe("resolveTrackedInsightSqlParams", () => {
  it("returns static params when param_resolution is not rolling_dashboard", () => {
    expect(
      resolveTrackedInsightSqlParams({
        metric_signature: {
          sql: "SELECT $1",
          param_resolution: "none",
          params: ["a"],
        },
        display_metadata: {},
      })
    ).toEqual(["a"]);
  });

  it("resolves company-scorecard rolling window to two date strings", () => {
    const p = resolveTrackedInsightSqlParams({
      metric_signature: {
        sql: "SELECT 1",
        param_resolution: "rolling_dashboard",
      },
      display_metadata: {
        source_page_id: "company-scorecard",
        filter_context_snapshot: { datePeriod: "ytd" },
      },
    });
    expect(p?.length).toBe(2);
    expect(String(p?.[0])).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(String(p?.[1])).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("resolves leaderboard rolling window", () => {
    const p = resolveTrackedInsightSqlParams({
      metric_signature: {
        sql: "SELECT 1",
        param_resolution: "rolling_dashboard",
      },
      display_metadata: {
        source_page_id: "leaderboard",
        filter_context_snapshot: { datePeriod: "mtd" },
      },
    });
    expect(p?.length).toBe(2);
  });
});
