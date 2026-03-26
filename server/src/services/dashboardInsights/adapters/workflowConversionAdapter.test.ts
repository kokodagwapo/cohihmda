import { describe, it, expect, vi } from "vitest";
import { workflowConversionAdapter } from "./workflowConversionAdapter.js";

vi.mock("../../dashboard/analyticsService.js", () => ({
  getDateRangeForTimeframe: vi.fn().mockReturnValue({
    start: new Date("2026-01-01"),
    end: new Date("2026-01-31"),
  }),
}));

vi.mock("../../dashboard/workflowConversionService.js", () => ({
  getWorkflowConversionMilestones: vi.fn().mockResolvedValue([
    { id: "started_date", label: "Started", column: "started_date" },
    { id: "application_date", label: "Application", column: "application_date" },
    { id: "processing_date", label: "Processing", column: "processing_date" },
    { id: "submitted_to_underwriting_date", label: "Submitted To Underwriting", column: "submitted_to_underwriting_date" },
    { id: "uw_final_approval_date", label: "Uw Final Approval", column: "uw_final_approval_date" },
    { id: "ctc_date", label: "CTC", column: "ctc_date" },
    { id: "funding_date", label: "Funding", column: "funding_date" },
  ]),
  getWorkflowConversionData: vi.fn().mockResolvedValue({
    segments: [
      { from: "started_date", to: "application_date", leftCount: 100, rightCount: 80, conversionPercent: 80, avgTurnTimeDays: 3, series: [] },
      { from: "application_date", to: "processing_date", leftCount: 80, rightCount: 60, conversionPercent: 75, avgTurnTimeDays: 5, series: [] },
      { from: "processing_date", to: "submitted_to_underwriting_date", leftCount: 60, rightCount: 50, conversionPercent: 83.33, avgTurnTimeDays: 7, series: [] },
      { from: "submitted_to_underwriting_date", to: "uw_final_approval_date", leftCount: 50, rightCount: 40, conversionPercent: 80, avgTurnTimeDays: 10, series: [] },
      { from: "uw_final_approval_date", to: "ctc_date", leftCount: 40, rightCount: 35, conversionPercent: 87.5, avgTurnTimeDays: 4, series: [] },
      { from: "ctc_date", to: "funding_date", leftCount: 35, rightCount: 30, conversionPercent: 85.71, avgTurnTimeDays: 12, series: [] },
    ],
  }),
}));

describe("workflowConversionAdapter", () => {
  it("has correct page identity", () => {
    expect(workflowConversionAdapter.pageId).toBe("workflow-conversion");
    expect(workflowConversionAdapter.pageName).toBe("Workflow Conversion");
    expect(workflowConversionAdapter.pageDescription).toContain("Started");
    expect(workflowConversionAdapter.pageDescription).toContain("Conversion");
  });

  it("getFilterCombinations returns page-level [{}]", async () => {
    const combinations = await workflowConversionAdapter.getFilterCombinations({} as import("pg").Pool);
    expect(combinations).toEqual([{}]);
  });

  it("getWidgetCatalog lists six segment widget ids", () => {
    const catalog = workflowConversionAdapter.getWidgetCatalog();
    expect(catalog.length).toBe(6);
    expect(catalog[0].id).toBe("workflow-conversion-segment-0");
    expect(catalog[5].id).toBe("workflow-conversion-segment-5");
    expect(catalog.every((w) => w.dimension === "workflow_segment")).toBe(true);
  });

  it("buildContext includes by_time_period with defaultSegments", async () => {
    const pool = {} as import("pg").Pool;
    const context = await workflowConversionAdapter.buildContext(pool, {});
    expect(context.pageId).toBe("workflow-conversion");
    expect(context.pageGuidance?.length).toBeGreaterThan(3);
    expect(context.data?.by_time_period).toBeDefined();
    const btp = context.data!.by_time_period as Record<
      string,
      { summary?: { defaultSegments?: { label: string; conversionPercent: number | null }[] } }
    >;
    expect(btp.MTD?.summary?.defaultSegments?.[0]?.label).toContain("Started");
    expect(btp.MTD?.summary?.defaultSegments?.[0]?.conversionPercent).toBe(80);
  });
});
