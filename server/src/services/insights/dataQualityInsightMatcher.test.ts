import { describe, expect, it } from "vitest";
import type { InsightFinding } from "./agents/insightInvestigatorAgent.js";
import {
  matchInsightToDataQualityTests,
  prefilterDataQualityTests,
  rankRelevantVerifiedTests,
} from "./dataQualityInsightMatcher.js";

function buildFinding(summary: string, title = "DQ finding"): InsightFinding {
  return {
    questionId: 1,
    title,
    summary,
    confidence: "medium",
    evidence: [],
    keyMetrics: {},
    suggestedBucket: "context",
  };
}

describe("matchInsightToDataQualityTests", () => {
  it("matches HMDA loan purpose only for originated/funded cohorts", () => {
    const r = matchInsightToDataQualityTests({
      finding: buildFinding(
        "Among originated and funded loans, loan purpose is missing on a subset of records."
      ),
      issueSummary:
        "HMDA loan purpose missing on originated loans impacts reporting completeness.",
    });
    expect(r.matchedTestIds).toContain("hmda_missing_loan_purpose");
  });

  it("does not map active-loan loan purpose wording to HMDA originated test", () => {
    const r = matchInsightToDataQualityTests({
      finding: buildFinding(
        "Among active loans, loan purpose is missing on a small subset."
      ),
      issueSummary:
        "Loan purpose is missing on active loans and may affect interpretation.",
    });
    expect(r.matchedTestIds).not.toContain("hmda_missing_loan_purpose");
  });

  it("does not match non-canonical market-at-lock missingness", () => {
    const r = matchInsightToDataQualityTests({
      finding: buildFinding(
        "Market-at-lock pricing context is missing for many recent lock records."
      ),
      issueSummary:
        "Rate-regret analysis is limited because market_at_lock context is missing.",
    });
    expect(r.matchedTestIds).toEqual([]);
  });

  it("final relevance ranking drops contradicted missingness tests", () => {
    const input = {
      finding: buildFinding(
        "In active loans, branch and loan officer are 100% populated while milestone fields are weak."
      ),
      issueSummary:
        "Milestone gaps are present, but branch and loan officer are fully populated.",
    };
    const pre = prefilterDataQualityTests(input);
    const ranked = rankRelevantVerifiedTests(input, [
      ...pre.candidateTestIds,
      "missing_branch",
      "missing_loan_officer",
    ]);
    expect(ranked.matchedTestIds).not.toContain("missing_branch");
    expect(ranked.matchedTestIds).not.toContain("missing_loan_officer");
  });
});
