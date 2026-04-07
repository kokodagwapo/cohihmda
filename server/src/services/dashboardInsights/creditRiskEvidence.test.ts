import { describe, expect, it, vi } from "vitest";
import type { DashboardInsight, DashboardPageContext } from "./types.js";
import {
  buildCreditRiskCohortSubjectRowsSync,
  buildCreditRiskSupportingDataForInsight,
  selectCreditRiskEvidenceIntent,
} from "./creditRiskEvidence.js";

vi.mock("../metrics/metricsService.js", () => ({
  queryCreditRiskDrilldownLoans: vi.fn().mockResolvedValue([
    {
      id: "1",
      loan_number: "1001",
      borrower: "A Borrower",
      officer: "Officer A",
      amount: "$100,000",
      amountValue: 100000,
      riskLevel: "High",
      riskScore: 88,
      reason: "DTI",
      ficoScore: 660,
      ltvRatio: 86,
      dtiRatio: 52,
    },
  ]),
}));

const baseInsight: DashboardInsight = {
  headline: "YTD Loans with DTI >50.00% account for 19.1% of Applications Taken",
  understory: "",
  sentiment: "warning",
  severity_score: 0.7,
  cited_numbers: [],
  what_changed: "",
  why: "",
  business_impact: "",
  risk_if_ignored: "",
  recommended_action: "",
  owner: "",
  scope: "widget",
  filter_context: { applicationType: "Applications Taken", datePeriod: "ytd" },
  evidence_refs: [
    {
      widgetId: "credit-risk-dti-distribution",
      role: "primary",
      target: { type: "row", label: ">50.00" },
    },
  ],
  escalate: true,
  sourcePageId: "credit-risk-management",
  sourcePageName: "Credit Risk Management",
};

const baseContext: DashboardPageContext = {
  pageId: "credit-risk-management",
  pageName: "Credit Risk Management",
  filters: {},
  dimensions: [],
  data: {
    summary: {},
    by_dimension: {},
    by_time_period: {
      YTD: {
        periodLabel: "2026 YTD",
        dateRange: "2026-01-01 to 2026-03-23",
        byApplicationType: {
          "Applications Taken": {
            kpis: { units: 813, volume: 187670000, wac: 6.167, waFico: 717, waLtv: 78.3, waDti: 39.4 },
            distributions: {
              dti: [{ range: ">50.00", units: 156, percentage: 19.2, volume: 36740000 }],
            },
          },
        },
      },
      L13M: {
        periodLabel: "Last 13 Months",
        dateRange: "2025-03-01 to 2026-03-23",
        byApplicationType: {
          "Applications Taken": {
            kpis: { units: 3885, volume: 898900000, wac: 6.392, waFico: 718, waLtv: 80.6, waDti: 39.6 },
            distributions: {
              dti: [{ range: ">50.00", units: 711, percentage: 18.3, volume: 172470000 }],
            },
          },
        },
      },
    },
  },
  widget_catalog: [],
};

describe("creditRiskEvidence", () => {
  it("selects cohort trend for distribution insights", () => {
    const intent = selectCreditRiskEvidenceIntent(baseInsight);
    expect(intent.profile).toBe("cohort_period_trend");
  });

  it("buildCreditRiskCohortSubjectRowsSync matches bucket across periods", () => {
    const rows = buildCreditRiskCohortSubjectRowsSync(
      baseInsight,
      baseContext,
      ">50.00"
    );
    expect(rows).not.toBeNull();
    expect(rows!.length).toBe(2);
    expect(rows![0].bucketLabel).toBe(">50.00");
    expect(rows![0].totalUnits).toBe(156);
  });

  it("builds cohort trend rows from page context", async () => {
    const supporting = await buildCreditRiskSupportingDataForInsight(
      baseContext,
      baseInsight,
      {} as import("pg").Pool
    );
    expect(supporting?.profile).toBe("cohort_period_trend");
    expect(supporting?.byPeriod?.length).toBe(2);
    expect(supporting?.byPeriod?.[0]?.period).toBe("YTD");
    expect(supporting?.byPeriod?.[1]?.period).toBe("L13M");
    expect(supporting?.byPeriod?.[0]?.bucketLabel).toBe(">50.00");
    expect(supporting?.byPeriod?.[0]?.totalUnits).toBe(156);
  });
});
