import { describe, it, expect } from "vitest";
import {
  loanRowToComplexityData,
  resolveLoanComplexityScoreForRead,
  normalizePersistedScore,
} from "./persistedLoanComplexity.js";
import { calcLoanComplexity } from "../../utils/scorecard-utils.js";

describe("persistedLoanComplexity", () => {
  it("normalizePersistedScore parses decimals", () => {
    expect(normalizePersistedScore("112.5")).toBe(112.5);
    expect(normalizePersistedScore(null)).toBeNull();
  });

  it("resolveLoanComplexityScoreForRead prefers persisted value", () => {
    const row = {
      complexity_score: 115.2,
      loan_type: "Conventional",
      loan_purpose: "Purchase",
    };
    const resolved = resolveLoanComplexityScoreForRead(row, undefined, false);
    expect(resolved).toBe(115.2);
  });

  it("loanRowToComplexityData matches calcLoanComplexity single-arg path", () => {
    const row = {
      loan_type: "FHA",
      loan_purpose: "Purchase",
      loan_amount: 400000,
      fico_score: 680,
      ltv_ratio: 90,
      be_dti_ratio: 45,
      occupancy_type: "PRIMARY",
      borr_self_employed: false,
      non_qm: false,
    };
    const a = calcLoanComplexity(loanRowToComplexityData(row));
    const b = calcLoanComplexity(loanRowToComplexityData(row), undefined);
    expect(a).toBe(b);
  });
});
