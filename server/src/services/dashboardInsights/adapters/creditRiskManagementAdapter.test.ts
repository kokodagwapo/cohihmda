import { describe, it, expect, vi } from "vitest";
import { creditRiskManagementAdapter } from "./creditRiskManagementAdapter.js";

vi.mock("../../metrics/metricsService.js", () => ({
  queryMetrics: vi.fn().mockResolvedValue({
    total_units: { value: 120 },
    total_volume: { value: 42000000 },
    wac: { value: 6.125 },
    wa_fico: { value: 706 },
    wa_ltv: { value: 77.2 },
    wa_dti: { value: 40.1 },
  }),
  queryFicoDistribution: vi.fn().mockResolvedValue([
    { range: "680-749", rangeLabel: "680-749", units: 50, volume: 15000000, percentage: 41.7, sortOrder: 3 },
  ]),
  queryLtvDistribution: vi.fn().mockResolvedValue([
    { range: "75.01-80.00", rangeLabel: "75.01-80.00", units: 30, volume: 10000000, percentage: 25, sortOrder: 3 },
  ]),
  queryDtiDistribution: vi.fn().mockResolvedValue([
    { range: "36.01-43.00", rangeLabel: "36.01-43.00", units: 35, volume: 12000000, percentage: 29.2, sortOrder: 3 },
  ]),
  queryLoanMix: vi.fn().mockResolvedValue([
    {
      category: "Conventional",
      units: 70,
      unitsPercent: 58.3,
      volume: 26000000,
      volumePercent: 61.9,
      wac: 6.05,
      waFico: 720,
      waLtv: 74.2,
      waDti: 38.1,
    },
  ]),
  queryCreditRiskStory: vi.fn().mockResolvedValue({
    largestLoanType: { category: "", volumePercent: 0 },
    largestLoanPurpose: { category: "", volumePercent: 0 },
    largestOccupancy: { category: "", volumePercent: 0 },
    conventionalQualifiedPercent: 62,
    governmentQualifiedPercent: 55,
  }),
}));

describe("creditRiskManagementAdapter", () => {
  it("has correct page identity", () => {
    expect(creditRiskManagementAdapter.pageId).toBe("credit-risk-management");
    expect(creditRiskManagementAdapter.pageName).toBe("Credit Risk Management");
  });

  it("getFilterCombinations returns page-level [{}]", async () => {
    const combinations = await creditRiskManagementAdapter.getFilterCombinations({} as import("pg").Pool);
    expect(combinations).toEqual([{}]);
  });

  it("getWidgetCatalog returns credit risk widget ids", () => {
    const catalog = creditRiskManagementAdapter.getWidgetCatalog();
    expect(catalog.some((w) => w.id === "credit-risk-story-panel")).toBe(true);
    expect(catalog.some((w) => w.id === "credit-risk-kpi-cards")).toBe(true);
    expect(catalog.some((w) => w.id === "credit-risk-loan-mix-table")).toBe(true);
  });

  it("buildContext includes period/application data and guidance", async () => {
    const context = await creditRiskManagementAdapter.buildContext({} as import("pg").Pool, {});
    expect(context.pageId).toBe("credit-risk-management");
    expect(context.pageGuidance?.length).toBeGreaterThan(4);
    const byPeriod = context.data.by_time_period as Record<string, { byApplicationType?: Record<string, unknown> }>;
    expect(byPeriod.L13M).toBeDefined();
    expect(byPeriod.L13M.byApplicationType?.["Applications Taken"]).toBeDefined();
  });
});

