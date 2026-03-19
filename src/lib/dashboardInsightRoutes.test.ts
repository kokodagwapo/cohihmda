import { describe, it, expect } from "vitest";
import {
  getDashboardInsightPath,
  getDashboardInsightNavigateState,
} from "./dashboardInsightRoutes";

describe("dashboardInsightRoutes", () => {
  it("getDashboardInsightPath maps loan-complexity to standalone route", () => {
    expect(getDashboardInsightPath("loan-complexity")).toBe("/loan-complexity");
  });

  it("getDashboardInsightPath maps leaderboard to insights hash", () => {
    expect(getDashboardInsightPath("leaderboard")).toBe("/insights#leaderboard");
  });

  it("getDashboardInsightNavigateState applies filter context only for leaderboard", () => {
    const fc = { datePeriod: "qtd", leaderName: "Jane Doe" };
    expect(getDashboardInsightNavigateState("leaderboard", fc)).toEqual({
      scrollToSection: "leaderboard",
      dashboardInsightFilterContext: fc,
      sourcePageId: "leaderboard",
    });
  });

  it("getDashboardInsightNavigateState omits filter state for loan-complexity", () => {
    expect(
      getDashboardInsightNavigateState("loan-complexity", { datePeriod: "mtd" })
    ).toEqual({});
  });
});
