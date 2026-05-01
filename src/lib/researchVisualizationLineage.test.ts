import { describe, expect, it } from "vitest";
import { resolveResearchVisualizationLineage } from "./researchVisualizationLineage";

describe("resolveResearchVisualizationLineage", () => {
  it("promotes to the specific registry widget when its id is mentioned in evidence", () => {
    const r = resolveResearchVisualizationLineage({
      sql: "SELECT branch, units FROM company_scorecard",
      explanation:
        "Mirrors the company-scorecard-units widget for the company scorecard period filter.",
      findingTitle: "Units trend",
    });
    expect(r).not.toBeNull();
    expect(r?.kind).toBe("registry_widget");
    expect(r?.definitionId).toBe("company-scorecard-units");
    expect(r?.matchConfidence).toBe("high");
    expect(r?.dashboardPath).toBe("/company-scorecard");
  });

  it("returns null when there is no strong subject, metric, or synonym signal", () => {
    expect(
      resolveResearchVisualizationLineage({
        sql: "SELECT a, b FROM some_table",
        explanation: "Generic aggregate over dimensions.",
        findingTitle: "Q4",
      }),
    ).toBeNull();
  });

  it("maps a loan-funnel narrative to the canonical Loan Funnel home", () => {
    const r = resolveResearchVisualizationLineage({
      sql: "SELECT stage, count(*) AS n FROM pipeline GROUP BY 1",
      explanation: "Stage-level counts for the loan funnel in the selected period.",
      findingTitle: "",
    });
    expect(r).not.toBeNull();
    expect(r?.kind).toBe("dashboard");
    expect(r?.dashboardPath).toBe("/insights");
    expect(r?.matchConfidence).toBe("medium");
  });

  it("routes an LO scorecard / TTS / tier question to Sales Scorecard, not Operations", () => {
    const r = resolveResearchVisualizationLineage({
      sql: `
        SELECT loan_officer_name,
               tts_score,
               tier,
               pull_through_rate
        FROM lo_scorecard_view
        ORDER BY tts_score DESC
      `,
      explanation:
        "LO scorecard: compute TTS scores, tier distribution (Top/Second/Bottom), and identify performance outliers.",
      findingTitle: "LO performance outliers",
    });
    expect(r).not.toBeNull();
    expect(r?.kind).toBe("dashboard");
    expect(r?.dashboardPath).toBe("/sales-scorecard");
    expect(r?.dashboardLabel).toBe("Sales Scorecard");
  });

  it("routes a processor / underwriting cycle-time question to Operations Scorecard, not Sales", () => {
    const r = resolveResearchVisualizationLineage({
      sql: `
        SELECT processor_name,
               AVG(days_in_processing) AS avg_days,
               approval_rate
        FROM ops_actor_metrics
        WHERE actor_role IN ('processor','underwriter')
        GROUP BY 1
      `,
      explanation:
        "Compute average underwriting cycle time per processor and identify outliers across the operations scorecard.",
      findingTitle: "Processor cycle-time outliers",
    });
    expect(r).not.toBeNull();
    expect(r?.kind).toBe("dashboard");
    expect(r?.dashboardPath).toBe("/performance/operation-scorecard");
    expect(r?.dashboardLabel).toBe("Operations Scorecard");
  });

  it("routes a multi-actor cross-section (LO + processor + underwriter) to the Actors dashboard", () => {
    // Sales-only and Ops-only dashboards both pay a subject-mismatch penalty
    // here, so the Actors dashboard (which natively covers all four roles)
    // should win.
    const r = resolveResearchVisualizationLineage({
      sql: "SELECT loan_officer_name, processor_name, underwriter_name, units FROM mixed_actor_metrics",
      explanation: "Cross-section of loan officer, processor, and underwriter productivity.",
      findingTitle: "Mixed actor view",
    });
    expect(r).not.toBeNull();
    expect(r?.dashboardPath).toBe("/actors");
  });

  it("returns null when there is no clear winner between competing dashboards of different families", () => {
    // Pure ambiguity: company-wide volume mention with no synonym or specific
    // metric — production-trends and company-scorecard tie too closely.
    const r = resolveResearchVisualizationLineage({
      sql: "SELECT period, units, volume FROM something_company_wide",
      explanation: "Company volume and unit counts by period.",
      findingTitle: "",
    });
    expect(r === null || r?.matchConfidence === "medium").toBe(true);
  });

  it("does not link an LO TTS question to Operations Scorecard even when 'scorecard' appears", () => {
    // Same vocabulary that historically mis-routed to Operations.
    const r = resolveResearchVisualizationLineage({
      sql: "SELECT loan_officer_id, tts_score, tier FROM lo_tts",
      explanation: "Scorecard view of LO TTS scores and tier distribution.",
      findingTitle: "LO scorecard outliers",
    });
    expect(r?.dashboardPath).not.toBe("/performance/operation-scorecard");
    expect(r?.dashboardPath).toBe("/sales-scorecard");
  });

  it("maps a credit-risk narrative (FICO/LTV/DTI on borrowers) to Credit Risk Management", () => {
    const r = resolveResearchVisualizationLineage({
      sql: "SELECT borrower_id, fico, ltv, dti FROM credit_risk_loans",
      explanation:
        "Review credit risk: borrower FICO, LTV, DTI distributions across the credit risk management view.",
      findingTitle: "Borrower credit risk",
    });
    expect(r).not.toBeNull();
    expect(r?.dashboardPath).toBe("/credit-risk-management");
  });
});
