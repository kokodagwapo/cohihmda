import { describe, it, expect } from "vitest";
import { buildDetailFromSupportingData } from "./dashboardInsightDetailHydrator.js";
import type { DashboardInsight, SupportingData, DashboardPageContext } from "./types.js";
import {
  TRACKED_DASHBOARD_HANDLER_LEADERBOARD_AGGREGATE,
  TRACKED_DASHBOARD_HANDLER_LEADERBOARD_SUBJECT,
  TRACKED_DASHBOARD_HANDLER_LOAN_COMPLEXITY_AGGREGATE,
  TRACKED_DASHBOARD_HANDLER_LOAN_COMPLEXITY_SUBJECT,
  TRACKED_DASHBOARD_HANDLER_TOP_TIERING_SUBJECT,
  TRACKED_DASHBOARD_HANDLER_CREDIT_RISK_COHORT_SUBJECT,
} from "../insights/trackedInsightHandlers.js";

const baseInsight: DashboardInsight = {
  headline: "LQ vs MTD: High Performer Decline for Jane Doe",
  understory: "Jane Doe was top in LQ but dropped in MTD.",
  sentiment: "warning",
  severity_score: 0.7,
  cited_numbers: ["61%", "0%"],
  what_changed: "Jane Doe's pull-through declined.",
  why: "Fewer units closed in MTD.",
  business_impact: "Impact on volume.",
  risk_if_ignored: "Continued decline.",
  recommended_action: "Review pipeline.",
  owner: "Sales Manager",
  scope: "page",
  filter_context: {},
  evidence_refs: [],
  escalate: true,
  sourcePageId: "leaderboard",
  sourcePageName: "Leaderboard",
};

describe("dashboardInsightDetailHydrator", () => {
  it("buildDetailFromSupportingData with subjectName and context returns person-focused rows", () => {
    const context: DashboardPageContext = {
      pageId: "leaderboard",
      pageName: "Leaderboard",
      filters: {},
      dimensions: [],
      data: {
        summary: {},
        by_dimension: {},
        by_time_period: {
          MTD: {
            periodLabel: "Month-to-Date",
            leaderboard: [
              { name: "Jane Doe", rank: 2, pullThroughRate: 0, loansClosed: 5, totalVolume: 1.2e6 },
              { name: "Bob Smith", rank: 1, pullThroughRate: 60, loansClosed: 11, totalVolume: 2.6e6 },
            ],
          },
          LQ: {
            periodLabel: "Last Quarter",
            leaderboard: [
              { name: "Jane Doe", rank: 1, pullThroughRate: 66, loansClosed: 57, totalVolume: 12.04e6 },
              { name: "Bob Smith", rank: 2, pullThroughRate: 60, loansClosed: 28, totalVolume: 6.27e6 },
            ],
          },
        },
      },
      widget_catalog: [],
    };
    const result = buildDetailFromSupportingData(baseInsight, undefined, {
      subjectName: "Jane Doe",
      context,
    });
    expect(result).not.toBeNull();
    expect(result!.rows).toHaveLength(2);
    expect(result!.rows.every((r) => r.name === "Jane Doe")).toBe(true);
    expect(result!.rows.map((r) => r.period).sort()).toEqual(["LQ", "MTD"]);
    const mtdRow = result!.rows.find((r) => r.period === "MTD");
    expect(mtdRow?.pullThroughRate).toBe(0);
    expect(mtdRow?.loansClosed).toBe(5);
    const lqRow = result!.rows.find((r) => r.period === "LQ");
    expect(lqRow?.pullThroughRate).toBe(66);
    expect(lqRow?.loansClosed).toBe(57);
    expect(result!.audit?.trackedRefreshKind).toBe("handler");
    expect(result!.audit?.handlerId).toBe(
      TRACKED_DASHBOARD_HANDLER_LEADERBOARD_SUBJECT
    );
  });

  it("buildDetailFromSupportingData without subjectName uses supportingData aggregate rows", () => {
    const supportingData: SupportingData = {
      byPeriod: [
        { period: "MTD", periodLabel: "Month-to-Date", averagePullThrough: 0, totalUnits: 58, totalVolume: 14.17e6, topPerformerName: "Craig James Nielsen", topPerformerUnits: 11, topPerformerVolume: 2.6e6 },
        { period: "LQ", periodLabel: "Last Quarter", averagePullThrough: 66, totalUnits: 273, totalVolume: 62.82e6, topPerformerName: "Stanley Edward Obrecht Jr.", topPerformerUnits: 57, topPerformerVolume: 12.04e6 },
      ],
    };
    const result = buildDetailFromSupportingData(baseInsight, supportingData, {});
    expect(result).not.toBeNull();
    expect(result!.rows).toHaveLength(2);
    expect(result!.rows[0].period).toBe("MTD");
    expect(result!.rows[0].topPerformerName).toBe("Craig James Nielsen");
    expect(result!.rows[1].period).toBe("LQ");
    expect(result!.rows[1].topPerformerName).toBe("Stanley Edward Obrecht Jr.");
    expect(result!.audit?.trackedRefreshKind).toBe("handler");
    expect(result!.audit?.handlerId).toBe(
      TRACKED_DASHBOARD_HANDLER_LEADERBOARD_AGGREGATE
    );
  });

  it("buildDetailFromSupportingData with subjectName but subject not in context falls back to aggregate when supportingData provided", () => {
    const context: DashboardPageContext = {
      pageId: "leaderboard",
      pageName: "Leaderboard",
      filters: {},
      dimensions: [],
      data: {
        summary: {},
        by_dimension: {},
        by_time_period: {
          MTD: { periodLabel: "MTD", leaderboard: [{ name: "Other Person", rank: 1, loansClosed: 10 }] },
        },
      },
      widget_catalog: [],
    };
    const supportingData: SupportingData = {
      byPeriod: [{ period: "MTD", periodLabel: "MTD", averagePullThrough: 50, totalUnits: 100, totalVolume: 25e6 }],
    };
    const result = buildDetailFromSupportingData(baseInsight, supportingData, {
      subjectName: "Jane Doe",
      context,
    });
    expect(result).not.toBeNull();
    expect(result!.rows).toHaveLength(1);
    expect(result!.rows[0].averagePullThrough).toBe(50);
    expect(result!.rows[0].totalUnits).toBe(100);
    expect(result!.audit?.handlerId).toBe(
      TRACKED_DASHBOARD_HANDLER_LEADERBOARD_AGGREGATE
    );
  });

  it("buildDetailFromSupportingData loan-complexity aggregate uses WA complexity columns", () => {
    const cxInsight: DashboardInsight = {
      ...baseInsight,
      sourcePageId: "loan-complexity",
      sourcePageName: "Loan Complexity",
    };
    const supportingData: SupportingData = {
      byPeriod: [
        {
          period: "QTD",
          periodLabel: "Quarter-to-Date",
          portfolioWaComplexity: 104.2,
          portfolioPullThrough: 48,
          averagePullThrough: 48,
          totalUnits: 200,
        },
      ],
    };
    const result = buildDetailFromSupportingData(cxInsight, supportingData, {
      context: { pageId: "loan-complexity" } as DashboardPageContext,
    });
    expect(result).not.toBeNull();
    expect(result!.rows[0].portfolioWaComplexity).toBe(104.2);
    expect(result!.displayConfig.columns).toContain("portfolioWaComplexity");
    expect(result!.audit?.trackedRefreshKind).toBe("handler");
    expect(result!.audit?.handlerId).toBe(TRACKED_DASHBOARD_HANDLER_LOAN_COMPLEXITY_AGGREGATE);
  });

  it("buildDetailFromSupportingData loan-complexity subject uses pivot slice from primary widget", () => {
    const cxInsight: DashboardInsight = {
      ...baseInsight,
      sourcePageId: "loan-complexity",
      sourcePageName: "Loan Complexity",
      evidence_refs: [
        {
          widgetId: "loan-complexity-pivot-branch",
          role: "primary",
          target: { type: "row", label: "North" },
        },
      ],
    };
    const context: DashboardPageContext = {
      pageId: "loan-complexity",
      pageName: "Loan Complexity",
      filters: {},
      dimensions: [],
      data: {
        summary: {},
        by_dimension: {},
        by_time_period: {
          MTD: {
            periodLabel: "Month-to-Date",
            pivotSlices: {
              branch: [{ groupName: "North", units: 5, waComplexity: 112, timeInMotionDays: 9 }],
            },
          },
          LQ: {
            periodLabel: "Last Quarter",
            pivotSlices: {
              branch: [{ groupName: "North", units: 40, waComplexity: 108, timeInMotionDays: 11 }],
            },
          },
        },
      },
      widget_catalog: [],
    };
    const result = buildDetailFromSupportingData(cxInsight, undefined, {
      subjectName: "North",
      context,
    });
    expect(result).not.toBeNull();
    expect(result!.rows).toHaveLength(2);
    expect(result!.rows.every((r) => r.name === "North")).toBe(true);
    expect(result!.audit?.trackedRefreshKind).toBe("handler");
    expect(result!.audit?.handlerId).toBe(TRACKED_DASHBOARD_HANDLER_LOAN_COMPLEXITY_SUBJECT);
  });

  it("buildDetailFromSupportingData top-tiering subject summary uses TTC metrics not leaderboard branch", () => {
    const ttcInsight: DashboardInsight = {
      ...baseInsight,
      sourcePageId: "top-tiering-comparison",
      sourcePageName: "TopTiering Comparison",
      evidence_refs: [
        { widgetId: "ttc-detail-table", role: "primary", target: { type: "row" as const, label: "Branch 2201" } },
      ],
    };
    const context: DashboardPageContext = {
      pageId: "top-tiering-comparison",
      pageName: "TopTiering Comparison",
      filters: {},
      dimensions: [],
      data: {
        summary: {},
        by_dimension: {},
        by_time_period: {
          MTD_BRANCH: {
            periodLabel: "Month to Date",
            actors: [
              {
                name: "Branch 2201",
                tier: "top",
                revenue: 26000,
                units: 3,
                volume: 1.2e6,
                revenueBPS: 216,
                revenuePerLoan: 8666,
              },
            ],
          },
        },
      },
      widget_catalog: [],
    };
    const result = buildDetailFromSupportingData(ttcInsight, undefined, {
      subjectName: "Branch 2201",
      context,
    });
    expect(result).not.toBeNull();
    expect(result!.displayConfig.summary_defs?.map((s) => s.key)).toEqual([
      "revenue",
      "units",
      "volume",
      "revenueBPS",
      "revenuePerLoan",
    ]);
    expect(result!.summary?.revenue).toBe(26000);
    expect(result!.audit?.handlerId).toBe(TRACKED_DASHBOARD_HANDLER_TOP_TIERING_SUBJECT);
  });

  it("buildDetailFromSupportingData credit-risk cohort subject uses cohort handler and summary_defs", () => {
    const crInsight: DashboardInsight = {
      ...baseInsight,
      sourcePageId: "credit-risk-management",
      sourcePageName: "Credit Risk Management",
      filter_context: {
        datePeriod: "ytd",
        applicationType: "Applications Taken",
      },
      evidence_refs: [
        {
          widgetId: "credit-risk-fico-distribution",
          role: "primary" as const,
          target: { type: "row" as const, label: "620-679" },
        },
      ],
    };
    const context: DashboardPageContext = {
      pageId: "credit-risk-management",
      pageName: "Credit Risk Management",
      filters: {},
      dimensions: [
        {
          id: "credit_risk_fico_bucket",
          label: "FICO bucket",
          type: "structural",
          values: ["620-679"],
        },
      ],
      data: {
        summary: {},
        by_dimension: {},
        by_time_period: {
          YTD: {
            periodLabel: "2026 YTD",
            dateRange: "2026-01-01 to 2026-04-01",
            byApplicationType: {
              "Applications Taken": {
                kpis: {
                  units: 1000,
                  volume: 1e8,
                  wac: 6,
                  waFico: 720,
                  waLtv: 80,
                  waDti: 40,
                },
                distributions: {
                  fico: [
                    { range: "620-679", units: 50, percentage: 5, volume: 5e6 },
                  ],
                },
              },
            },
          },
        },
      },
      widget_catalog: [
        {
          id: "credit-risk-fico-distribution",
          type: "chart",
          label: "FICO Distribution",
          dimension: "credit_risk_fico_bucket",
        },
      ],
    };
    const result = buildDetailFromSupportingData(crInsight, undefined, {
      subjectName: "620-679",
      context,
    });
    expect(result).not.toBeNull();
    expect(result!.audit?.handlerId).toBe(
      TRACKED_DASHBOARD_HANDLER_CREDIT_RISK_COHORT_SUBJECT
    );
    expect(result!.displayConfig.summary_defs?.map((s) => s.key)).toEqual(
      expect.arrayContaining(["totalUnits", "unitsPercent", "totalVolume"])
    );
  });

  it("buildDetailFromSupportingData credit-risk cohort detail uses loan-level columns", () => {
    const crInsight: DashboardInsight = {
      ...baseInsight,
      sourcePageId: "credit-risk-management",
      sourcePageName: "Credit Risk Management",
    };
    const supportingData: SupportingData = {
      profile: "cohort_detail",
      detailRows: [
        {
          loanNumber: "1001",
          borrower: "A Borrower",
          officer: "Officer A",
          loanAmount: 100000,
          ficoScore: 660,
          ltvRatio: 86,
          dtiRatio: 52,
        },
      ],
    };
    const result = buildDetailFromSupportingData(crInsight, supportingData, {
      context: { pageId: "credit-risk-management" } as DashboardPageContext,
    });
    expect(result).not.toBeNull();
    expect(result!.displayConfig.columns).toContain("loanNumber");
    expect(result!.displayConfig.columns).toContain("dtiRatio");
  });
});
