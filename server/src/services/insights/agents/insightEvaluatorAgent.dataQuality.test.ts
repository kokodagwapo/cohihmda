import { describe, expect, it } from "vitest";
import { normalizeInsightDataQuality } from "./insightEvaluatorAgent.js";
describe("normalizeInsightDataQuality parsing", () => {
  it("keeps flagged DQ payload even without review_test_ids", () => {
    const raw = {
      flagged: true,
      issue_summary: "Loan purpose missing on active loans.",
      trust_impact: "medium",
      affected_loan_count: 8,
      reference_loan_count: 1072,
      counts_confidence: "estimated",
    };

    const normalized = normalizeInsightDataQuality(raw);
    expect(normalized?.flagged).toBe(true);
    expect(normalized?.review_test_ids).toBeUndefined();
  });

  it("normalizes provided canonical review ids", () => {
    const raw = {
      flagged: true,
      issue_summary: "HMDA loan purpose missing for originated loans.",
      review_test_ids: ["hmda_missing_loan_purpose"],
      trust_impact: "medium",
      affected_loan_count: 8,
      reference_loan_count: 1072,
      counts_confidence: "estimated",
    };

    const normalized = normalizeInsightDataQuality(raw);
    expect(normalized?.flagged).toBe(true);
    expect(normalized?.review_test_ids).toContain("hmda_missing_loan_purpose");
  });

  it("normalizes high-recall prefilter candidates and metadata", () => {
    const raw = {
      flagged: true,
      issue_summary: "Active loans are stale and may need status review.",
      prefilter_candidate_test_ids: [
        "stale_active_6_to_12_months",
        "stale_active_over_1_year",
        "not_a_real_test",
      ],
      prefilter_basis: "required_columns",
      prefilter_notes: "Required columns overlap with active status and application date.",
      review_test_ids: ["stale_active_6_to_12_months"],
    };

    const normalized = normalizeInsightDataQuality(raw);
    expect(normalized?.prefilter_candidate_test_ids).toEqual([
      "stale_active_6_to_12_months",
      "stale_active_over_1_year",
    ]);
    expect(normalized?.prefilter_basis).toBe("required_columns");
    expect(normalized?.prefilter_notes).toContain("Required columns overlap");
  });
});
