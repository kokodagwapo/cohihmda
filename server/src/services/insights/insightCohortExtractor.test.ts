import { describe, expect, it } from "vitest";
import type { InsightFinding } from "./agents/insightInvestigatorAgent.js";
import { extractInsightCohortSql } from "./insightCohortExtractor.js";

function makeFinding(partial: Partial<InsightFinding>): InsightFinding {
  return {
    questionId: 1,
    title: "Active pipeline issue in branch 2001",
    summary: "Active branch 2001 has milestone gaps.",
    confidence: "medium",
    evidence: [],
    keyMetrics: {},
    suggestedBucket: "context",
    ...partial,
  };
}

describe("extractInsightCohortSql", () => {
  it("prefers headlineMetricSignature when it includes loan_id", () => {
    const finding = makeFinding({
      headlineMetricSignature: {
        sql: "SELECT loan_id FROM public.loans WHERE current_loan_status = 'Active Loan'",
        keyFields: ["loan_id"],
      },
    });
    const r = extractInsightCohortSql(finding);
    expect(r.cohortSource).toBe("headlineMetricSignature");
    expect(r.cohortSql || "").toContain("loan_id");
  });

  it("falls back to canonical active cohort and branch hint", () => {
    const finding = makeFinding({
      headlineMetricSignature: undefined,
      metricSignature: undefined,
      title: "Milestone issue in branch 2001 active pipeline",
      summary: "Active loans in branch 2001 have milestone capture gaps.",
    });
    const r = extractInsightCohortSql(finding);
    expect(r.cohortSource).toBe("fallback");
    expect(r.cohortSql || "").toContain("current_loan_status = 'Active Loan'");
    expect(r.cohortSql || "").toContain("branch = '2001'");
  });
});
