import { describe, it, expect } from "vitest";
import {
  isActorMissing,
  filterByChannel,
  getActorColumnForChannel,
  getActorLabelForChannel,
  isTPOChannel,
  calcLoanRevenue,
  calcLoanComplexity,
  assignTTSTier,
  assignTTSTierByPercentile,
  assignTiersByCumulativeValue,
  isValidForWA,
  formatDateForSQL,
  formatMonthKey,
  buildChannelWhereClause,
  buildActorNotMissingClause,
  parseComplexityConfig,
  DEFAULT_COMPLEXITY_WEIGHTS,
} from "./scorecard-utils.js";

// ============================================================================
// isActorMissing
// ============================================================================
describe("isActorMissing", () => {
  it("should return true for null, undefined, and empty strings", () => {
    expect(isActorMissing(null)).toBe(true);
    expect(isActorMissing(undefined)).toBe(true);
    expect(isActorMissing("")).toBe(true);
    expect(isActorMissing("  ")).toBe(true);
  });

  it("should detect '99-Missing' in strict mode", () => {
    expect(isActorMissing("99-Missing", "strict")).toBe(true);
    expect(isActorMissing("99-MISSING", "strict")).toBe(true);
    expect(isActorMissing("No LO Found", "strict")).toBe(false);
  });

  it("should detect all placeholder values in extended mode", () => {
    expect(isActorMissing("99-Missing")).toBe(true);
    expect(isActorMissing("Missing")).toBe(true);
    expect(isActorMissing("No LO Found")).toBe(true);
    expect(isActorMissing("No Loan Officer")).toBe(true);
    expect(isActorMissing("No Branch Found")).toBe(true);
    expect(isActorMissing("Unknown")).toBe(true);
    expect(isActorMissing("99-SomeOther")).toBe(true);
  });

  it("should return false for valid actor names", () => {
    expect(isActorMissing("John Smith")).toBe(false);
    expect(isActorMissing("Main Branch")).toBe(false);
  });
});

// ============================================================================
// filterByChannel
// ============================================================================
describe("filterByChannel", () => {
  it("should match all when channelGroup is undefined or 'All'", () => {
    expect(filterByChannel("Retail", undefined)).toBe(true);
    expect(filterByChannel("Wholesale", "All")).toBe(true);
    expect(filterByChannel(null, "All")).toBe(true);
  });

  it("should filter Retail channels", () => {
    expect(filterByChannel("Retail", "Retail")).toBe(true);
    expect(filterByChannel("Brokered", "Retail")).toBe(true);
    expect(filterByChannel("Wholesale", "Retail")).toBe(false);
    expect(filterByChannel("Correspondent", "Retail")).toBe(false);
  });

  it("should filter TPO channels", () => {
    expect(filterByChannel("Wholesale", "TPO")).toBe(true);
    expect(filterByChannel("Correspondent", "TPO")).toBe(true);
    expect(filterByChannel("Retail", "TPO")).toBe(false);
  });

  it("should filter 99-Missing channels", () => {
    expect(filterByChannel(null, "99-Missing")).toBe(true);
    expect(filterByChannel("", "99-Missing")).toBe(true);
    expect(filterByChannel("Retail", "99-Missing")).toBe(false);
  });

  it("should filter Other channels", () => {
    expect(filterByChannel("Consumer Direct", "Other")).toBe(true);
    expect(filterByChannel("Retail", "Other")).toBe(false);
    expect(filterByChannel("Wholesale", "Other")).toBe(false);
    expect(filterByChannel("", "Other")).toBe(false);
  });
});

// ============================================================================
// getActorColumnForChannel / getActorLabelForChannel / isTPOChannel
// ============================================================================
describe("channel-aware actor selection", () => {
  it("should return account_executive for TPO", () => {
    expect(getActorColumnForChannel("TPO")).toBe("account_executive");
    expect(getActorColumnForChannel("tpo")).toBe("account_executive");
  });

  it("should return loan_officer for non-TPO", () => {
    expect(getActorColumnForChannel("Retail")).toBe("loan_officer");
    expect(getActorColumnForChannel(undefined)).toBe("loan_officer");
    expect(getActorColumnForChannel("All")).toBe("loan_officer");
  });

  it("should return correct label for channel", () => {
    expect(getActorLabelForChannel("TPO")).toBe("Account Executive");
    expect(getActorLabelForChannel("Retail")).toBe("Loan Officer");
    expect(getActorLabelForChannel()).toBe("Loan Officer");
  });

  it("isTPOChannel should detect TPO", () => {
    expect(isTPOChannel("tpo")).toBe(true);
    expect(isTPOChannel("TPO")).toBe(true);
    expect(isTPOChannel("Retail")).toBe(false);
    expect(isTPOChannel(undefined)).toBe(false);
  });
});

// ============================================================================
// buildChannelWhereClause
// ============================================================================
describe("buildChannelWhereClause", () => {
  it("should return empty for undefined or 'All'", () => {
    expect(buildChannelWhereClause(undefined)).toBe("");
    expect(buildChannelWhereClause("All")).toBe("");
  });

  it("should return SQL for known channels", () => {
    expect(buildChannelWhereClause("Retail")).toContain("ILIKE '%retail%'");
    expect(buildChannelWhereClause("TPO")).toContain("ILIKE '%broker%'");
    expect(buildChannelWhereClause("99-Missing")).toContain("IS NULL");
  });
});

// ============================================================================
// buildActorNotMissingClause
// ============================================================================
describe("buildActorNotMissingClause", () => {
  it("should build strict clause", () => {
    const clause = buildActorNotMissingClause("processor", "strict");
    expect(clause).toContain("IS NOT NULL");
    expect(clause).toContain("99-MISSING");
    expect(clause).not.toContain("NO LO FOUND");
  });

  it("should build extended clause", () => {
    const clause = buildActorNotMissingClause("loan_officer", "extended");
    expect(clause).toContain("99-MISSING");
    expect(clause).toContain("NO LO FOUND");
    expect(clause).toContain("LIKE '99-%'");
  });
});

// ============================================================================
// calcLoanRevenue
// ============================================================================
describe("calcLoanRevenue", () => {
  it("should calculate revenue with all components", () => {
    const revenue = calcLoanRevenue({
      rate_lock_buy_side_base_price_rate: 101, // 1% premium
      loan_amount: 300000,
      orig_fee_borr_pd: 1500,
      orig_fees_seller: 500,
      cd_lender_credits: 200,
    });
    // Base Buy = ((101 - 100) / 100) * 300000 = 3000
    // Revenue = 3000 + 1500 + 500 - 200 = 4800
    expect(revenue).toBe(4800);
  });

  it("should handle par pricing (100)", () => {
    const revenue = calcLoanRevenue({
      rate_lock_buy_side_base_price_rate: 100,
      loan_amount: 300000,
      orig_fee_borr_pd: 1000,
      orig_fees_seller: 0,
      cd_lender_credits: 0,
    });
    // Base Buy = ((100 - 100) / 100) * 300000 = 0
    // Revenue = 0 + 1000 + 0 - 0 = 1000
    expect(revenue).toBe(1000);
  });

  it("should handle discount pricing (below par)", () => {
    const revenue = calcLoanRevenue({
      rate_lock_buy_side_base_price_rate: 99, // 1% discount
      loan_amount: 300000,
      orig_fee_borr_pd: 2000,
      orig_fees_seller: 0,
      cd_lender_credits: 0,
    });
    // Base Buy = ((99 - 100) / 100) * 300000 = -3000
    // Revenue = -3000 + 2000 + 0 - 0 = -1000
    expect(revenue).toBe(-1000);
  });

  it("should handle missing fields gracefully", () => {
    expect(calcLoanRevenue({})).toBe(0);
    expect(
      calcLoanRevenue({ loan_amount: 300000, orig_fee_borr_pd: 1000 })
    ).toBe(1000);
  });

  it("should handle string values (from PostgreSQL)", () => {
    const revenue = calcLoanRevenue({
      rate_lock_buy_side_base_price_rate: "101" as any,
      loan_amount: "300000" as any,
      orig_fee_borr_pd: "1500" as any,
      orig_fees_seller: "500" as any,
      cd_lender_credits: "200" as any,
    });
    expect(revenue).toBe(4800);
  });
});

// ============================================================================
// calcLoanComplexity
// ============================================================================
describe("calcLoanComplexity", () => {
  it("should return baseline 100 for empty/default loan", () => {
    expect(calcLoanComplexity({})).toBe(100);
  });

  it("should add complexity for government loans", () => {
    const complexity = calcLoanComplexity({ loan_type: "FHA" });
    expect(complexity).toBeGreaterThan(100);
    expect(complexity).toBe(100 + (DEFAULT_COMPLEXITY_WEIGHTS.loan_type_government ?? 10));
  });

  it("should add complexity for purchase loans", () => {
    const complexity = calcLoanComplexity({ loan_purpose: "Purchase" });
    expect(complexity).toBe(100 + (DEFAULT_COMPLEXITY_WEIGHTS.loan_purpose_purchase ?? 5));
  });

  it("should add complexity for low FICO", () => {
    const complexity = calcLoanComplexity({ fico_score: 600 });
    expect(complexity).toBe(100 + (DEFAULT_COMPLEXITY_WEIGHTS.fico_poor ?? 10));
  });

  it("should subtract complexity for excellent FICO", () => {
    const complexity = calcLoanComplexity({ fico_score: 800 });
    expect(complexity).toBe(100 + (DEFAULT_COMPLEXITY_WEIGHTS.fico_excellent ?? -5));
  });

  it("should add complexity for high LTV", () => {
    const complexity = calcLoanComplexity({ ltv_ratio: 95 });
    expect(complexity).toBe(100 + (DEFAULT_COMPLEXITY_WEIGHTS.ltv_high ?? 5));
  });

  it("should add complexity for high DTI", () => {
    const complexity = calcLoanComplexity({ be_dti_ratio: 50 });
    expect(complexity).toBe(100 + (DEFAULT_COMPLEXITY_WEIGHTS.dti_high ?? 5));
  });

  it("should add complexity for self-employed borrowers", () => {
    expect(calcLoanComplexity({ borr_self_employed: true })).toBeGreaterThan(100);
    expect(calcLoanComplexity({ borr_self_employed: "Y" })).toBeGreaterThan(100);
    expect(calcLoanComplexity({ borr_self_employed: "Yes" })).toBeGreaterThan(100);
  });

  it("should accumulate complexity from multiple factors", () => {
    const complexity = calcLoanComplexity({
      loan_type: "VA",
      loan_purpose: "Purchase",
      fico_score: 600,
      ltv_ratio: 95,
      be_dti_ratio: 50,
      borr_self_employed: true,
    });
    // All high-complexity factors
    expect(complexity).toBeGreaterThan(130);
  });

  it("should use custom config when provided", () => {
    const complexity = calcLoanComplexity(
      { loan_type: "FHA" },
      { loan_type_government: 20 }
    );
    expect(complexity).toBe(120);
  });
});

// ============================================================================
// parseComplexityConfig
// ============================================================================
describe("parseComplexityConfig", () => {
  it("should convert database rows to config with point-based weights", () => {
    const rows = [
      { component_name: "loan_type", condition_value: "government", weight: 0.15 },
      { component_name: "fico", condition_value: "poor", weight: 0.20 },
    ];
    const config = parseComplexityConfig(rows);
    expect(config.loan_type_government).toBe(15);
    expect(config.fico_poor).toBe(20);
  });
});

// ============================================================================
// TTS Tier Assignment
// ============================================================================
describe("assignTTSTier (score-based)", () => {
  it("should assign top tier for score >= 120", () => {
    expect(assignTTSTier(120)).toBe("top");
    expect(assignTTSTier(150)).toBe("top");
  });

  it("should assign second tier for score >= 80 and < 120", () => {
    expect(assignTTSTier(80)).toBe("second");
    expect(assignTTSTier(100)).toBe("second");
  });

  it("should assign bottom tier for score < 80", () => {
    expect(assignTTSTier(79)).toBe("bottom");
    expect(assignTTSTier(0)).toBe("bottom");
  });
});

describe("assignTTSTierByPercentile", () => {
  it("should handle empty population", () => {
    expect(assignTTSTierByPercentile(0, 0)).toBe("bottom");
  });

  it("should handle small populations (< 5)", () => {
    // 1 actor: top
    expect(assignTTSTierByPercentile(1, 0)).toBe("top");
    // 2 actors: top, bottom
    expect(assignTTSTierByPercentile(2, 0)).toBe("top");
    expect(assignTTSTierByPercentile(2, 1)).toBe("bottom");
    // 3 actors: top, second, bottom
    expect(assignTTSTierByPercentile(3, 0)).toBe("top");
    expect(assignTTSTierByPercentile(3, 1)).toBe("second");
    expect(assignTTSTierByPercentile(3, 2)).toBe("bottom");
  });

  it("should assign standard percentile tiers for larger populations", () => {
    // 10 actors: top 20% = indices 0-1, second 20-50% = indices 2-4, bottom 50%+ = 5-9
    expect(assignTTSTierByPercentile(10, 0)).toBe("top");
    expect(assignTTSTierByPercentile(10, 1)).toBe("top");
    expect(assignTTSTierByPercentile(10, 2)).toBe("second");
    expect(assignTTSTierByPercentile(10, 4)).toBe("second");
    expect(assignTTSTierByPercentile(10, 5)).toBe("bottom");
    expect(assignTTSTierByPercentile(10, 9)).toBe("bottom");
  });
});

describe("assignTiersByCumulativeValue", () => {
  it("should assign Pareto tiers by cumulative value", () => {
    const actors = [
      { name: "A", units: 50 },
      { name: "B", units: 30 },
      { name: "C", units: 10 },
      { name: "D", units: 5 },
      { name: "E", units: 5 },
    ];
    const result = assignTiersByCumulativeValue(actors, 100);
    // running starts at 0:
    // A: running=0 < 50 → top, then running=50
    // B: running=50 >= 50 but < 80 → second, then running=80
    // C: running=80 >= 80 → bottom, then running=90
    // D: running=90 → bottom
    // E: running=95 → bottom
    expect(result[0].tier).toBe("top");
    expect(result[1].tier).toBe("second");
    expect(result[2].tier).toBe("bottom");
    expect(result[3].tier).toBe("bottom");
  });

  it("should handle empty arrays", () => {
    const result = assignTiersByCumulativeValue([], 0);
    expect(result).toEqual([]);
  });
});

// ============================================================================
// isValidForWA
// ============================================================================
describe("isValidForWA", () => {
  it("should validate FICO ranges", () => {
    expect(isValidForWA(750, "fico")).toBe(true);
    expect(isValidForWA(350, "fico")).toBe(true);
    expect(isValidForWA(900, "fico")).toBe(true);
    expect(isValidForWA(349, "fico")).toBe(false);
    expect(isValidForWA(901, "fico")).toBe(false);
    expect(isValidForWA(null, "fico")).toBe(false);
  });

  it("should validate LTV ranges", () => {
    expect(isValidForWA(80, "ltv")).toBe(true);
    expect(isValidForWA(0, "ltv")).toBe(true);
    expect(isValidForWA(111, "ltv")).toBe(false);
  });

  it("should validate DTI ranges", () => {
    expect(isValidForWA(43, "dti")).toBe(true);
    expect(isValidForWA(71, "dti")).toBe(false);
  });

  it("should validate interest rate ranges", () => {
    expect(isValidForWA(6.5, "interestRate")).toBe(true);
    expect(isValidForWA(-1, "interestRate")).toBe(false);
    expect(isValidForWA(16, "interestRate")).toBe(false);
  });
});

// ============================================================================
// formatDateForSQL / formatMonthKey
// ============================================================================
describe("date formatting", () => {
  it("formatDateForSQL should return YYYY-MM-DD", () => {
    const d = new Date(2026, 0, 15); // Jan 15, 2026
    expect(formatDateForSQL(d)).toBe("2026-01-15");
  });

  it("formatMonthKey should return YYYY-MM", () => {
    const d = new Date(2026, 0, 15);
    expect(formatMonthKey(d)).toBe("2026-01");
    const d2 = new Date(2026, 11, 1);
    expect(formatMonthKey(d2)).toBe("2026-12");
  });
});
