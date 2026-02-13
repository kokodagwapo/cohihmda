import { describe, it, expect } from "vitest";
import {
  getStandardDateRanges,
  getVerifiedMetricsSQL,
} from "./canonicalMetrics.js";

// ============================================================================
// getStandardDateRanges
// ============================================================================
describe("getStandardDateRanges", () => {
  it("should return all expected date range keys", () => {
    const ranges = getStandardDateRanges();
    expect(ranges).toHaveProperty("today");
    expect(ranges).toHaveProperty("mtd");
    expect(ranges).toHaveProperty("ytd");
    expect(ranges).toHaveProperty("rolling90D");
    expect(ranges).toHaveProperty("rolling60D");
    expect(ranges).toHaveProperty("trailing30");
    expect(ranges).toHaveProperty("lastMonth");
    expect(ranges).toHaveProperty("lastYear");
    expect(ranges).toHaveProperty("prior30");
    expect(ranges).toHaveProperty("prior60");
    expect(ranges).toHaveProperty("prior90");
  });

  it("each range should have start and end strings in YYYY-MM-DD format", () => {
    const ranges = getStandardDateRanges();
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

    for (const [key, range] of Object.entries(ranges)) {
      expect(range.start, `${key}.start`).toMatch(dateRegex);
      expect(range.end, `${key}.end`).toMatch(dateRegex);
    }
  });

  it("today range should have same start and end", () => {
    const ranges = getStandardDateRanges();
    expect(ranges.today.start).toBe(ranges.today.end);
  });

  it("ytd should start on Jan 1 of current year", () => {
    const ranges = getStandardDateRanges();
    const currentYear = new Date().getFullYear();
    expect(ranges.ytd.start).toBe(`${currentYear}-01-01`);
  });

  it("prior ranges should end before current ranges start", () => {
    const ranges = getStandardDateRanges();
    // prior30 should end before trailing30 starts
    expect(new Date(ranges.prior30.end).getTime()).toBeLessThan(
      new Date(ranges.trailing30.start).getTime()
    );
  });

  it("rolling ranges should be wider than trailing30", () => {
    const ranges = getStandardDateRanges();
    const rolling90Start = new Date(ranges.rolling90D.start).getTime();
    const trailing30Start = new Date(ranges.trailing30.start).getTime();
    expect(rolling90Start).toBeLessThan(trailing30Start);
  });
});

// ============================================================================
// getVerifiedMetricsSQL
// ============================================================================
describe("getVerifiedMetricsSQL", () => {
  it("should include all key metric sections", () => {
    const sql = getVerifiedMetricsSQL("COALESCE(orig_fee_borr_pd, 0)");
    expect(sql).toContain("Pull-Through Rate");
    expect(sql).toContain("Fallout Rate");
    expect(sql).toContain("Revenue");
    expect(sql).toContain("Funded Volume");
    expect(sql).toContain("Cycle Time");
    expect(sql).toContain("Revenue BPS");
  });

  it("should inject the revenue expression", () => {
    const revenueExpr = "COALESCE(custom_revenue_field, 0)";
    const sql = getVerifiedMetricsSQL(revenueExpr);
    expect(sql).toContain(revenueExpr);
  });

  it("should contain proper SQL syntax", () => {
    const sql = getVerifiedMetricsSQL("1");
    expect(sql).toContain("SELECT");
    expect(sql).toContain("FROM public.loans");
    expect(sql).toContain("WHERE");
  });
});
