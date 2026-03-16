import { describe, it, expect } from "vitest";
import { leaderboardAdapter } from "./leaderboardAdapter.js";

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
});
