import { describe, it, expect, vi } from "vitest";
import { leaderboardAdapter } from "./leaderboardAdapter.js";

vi.mock("../../dashboard/analyticsService.js", () => ({
  getLeaderboardData: vi.fn().mockResolvedValue({
    leaderboard: [
      { name: "Test LO", branch: "Main", rank: 1, loansClosed: 10, loansStarted: 12, totalVolume: 2e6, pullThroughRate: 60 },
    ],
    timeframe: "mtd",
  }),
  getDateRangeForTimeframe: vi.fn().mockReturnValue({ start: new Date("2026-01-01"), end: new Date("2026-01-31") }),
}));

describe("leaderboardAdapter", () => {
  it("has correct page identity", () => {
    expect(leaderboardAdapter.pageId).toBe("leaderboard");
    expect(leaderboardAdapter.pageName).toBe("Leaderboard");
    expect(leaderboardAdapter.pageDescription).toContain("Ranks loan officers");
  });

  it("getFilterCombinations returns single page-level combination (no datePeriod)", async () => {
    const combinations = await leaderboardAdapter.getFilterCombinations(
      {} as any
    );
    expect(Array.isArray(combinations)).toBe(true);
    expect(combinations.length).toBe(1);
    expect(combinations[0]).toEqual({});
  });

  it("getWidgetCatalog returns leaderboard widgets", () => {
    const catalog = leaderboardAdapter.getWidgetCatalog();
    expect(Array.isArray(catalog)).toBe(true);
    expect(catalog.some((w) => w.id === "leaderboard-main-table")).toBe(true);
    expect(catalog.some((w) => w.id === "kpi-top-performer-units")).toBe(true);
    expect(catalog.some((w) => w.id === "kpi-top-performer-volume")).toBe(true);
  });

  it("buildContext returns context with pageGuidance for leaderboard", async () => {
    const pool = {} as import("pg").Pool;
    const context = await leaderboardAdapter.buildContext(pool, {});
    expect(context.pageGuidance).toBeDefined();
    expect(Array.isArray(context.pageGuidance)).toBe(true);
    expect(context.pageGuidance!.length).toBeGreaterThanOrEqual(3);
    expect(context.pageGuidance!.some((s) => s.includes("Prioritize insights"))).toBe(true);
    expect(context.pageGuidance!.some((s) => s.includes("current period"))).toBe(true);
    expect(context.pageGuidance!.some((s) => s.includes("high performers"))).toBe(true);
  });
});
