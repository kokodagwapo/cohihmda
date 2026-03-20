import { describe, it, expect, vi } from "vitest";
import { loanComplexityAdapter } from "./loanComplexityAdapter.js";

vi.mock("../../dashboard/analyticsService.js", () => ({
  getDateRangeForTimeframe: vi.fn().mockReturnValue({
    start: new Date("2026-01-01"),
    end: new Date("2026-01-31"),
  }),
}));

vi.mock("../../dashboard/loanComplexityDashboardService.js", () => {
  const mockPivotTotal = {
    groupName: "Portfolio",
    units: 100,
    waComplexity: 105.2,
    timeInMotionDays: 12,
    pctActive: 40,
    pctOriginated: 30,
    pctDenied: 10,
    pctWithdrawn: 5,
  };
  return {
    getLoanComplexityPivotData: vi.fn().mockResolvedValue({
      dimensions: [
        {
          dimension: "loan_officer",
          label: "Loan Officer",
          total: mockPivotTotal,
          rows: [{ groupName: "Jane LO", units: 20, waComplexity: 110, timeInMotionDays: 11 }],
        },
        {
          dimension: "current_loan_status",
          label: "Current Loan Status",
          total: mockPivotTotal,
          rows: [{ groupName: "Active Loan", units: 40, waComplexity: 102, timeInMotionDays: 10 }],
        },
      ],
      loanTypes: [],
      purposes: [],
    }),
  getLoanComplexityDashboardData: vi.fn().mockResolvedValue({
    bars: [{ groupName: "Jane LO", avgComplexity: 108, loanCount: 20 }],
  }),
  getLoanComplexityPortfolioPullThrough: vi.fn().mockResolvedValue({
    pullThroughRate: 55,
    unitsInCohort: 100,
  }),
    getLoanComplexityStatusOptions: vi.fn().mockResolvedValue({
      statuses: ["Application Denied"],
      hasFallout: false,
    }),
  };
});

describe("loanComplexityAdapter", () => {
  it("has correct page identity", () => {
    expect(loanComplexityAdapter.pageId).toBe("loan-complexity");
    expect(loanComplexityAdapter.pageName).toBe("Loan Complexity");
    expect(loanComplexityAdapter.pageDescription).toContain("application_date");
    expect(loanComplexityAdapter.pageDescription).toContain("pull-through");
  });

  it("getFilterCombinations returns page-level [{}]", async () => {
    const combinations = await loanComplexityAdapter.getFilterCombinations({} as import("pg").Pool);
    expect(combinations).toEqual([{}]);
  });

  it("getWidgetCatalog includes bar and pivot ids", () => {
    const catalog = loanComplexityAdapter.getWidgetCatalog();
    expect(catalog.some((w) => w.id === "loan-complexity-bar-chart")).toBe(true);
    expect(catalog.some((w) => w.id === "loan-complexity-pivot-loan-officer")).toBe(true);
    expect(catalog.some((w) => w.id === "loan-complexity-pivot-current-loan-status")).toBe(true);
  });

  it("buildContext includes by_time_period and status in summary", async () => {
    const pool = {} as import("pg").Pool;
    const context = await loanComplexityAdapter.buildContext(pool, {});
    expect(context.pageId).toBe("loan-complexity");
    expect(context.data?.by_time_period).toBeDefined();
    const btp = context.data!.by_time_period as Record<string, { summary?: { portfolioPullThrough?: number } }>;
    expect(btp.MTD?.summary?.portfolioPullThrough).toBe(55);
    const summary = context.data!.summary as { status_catalog?: string[] };
    expect(Array.isArray(summary.status_catalog)).toBe(true);
    expect(summary.status_catalog).toContain("All");
  });
});
