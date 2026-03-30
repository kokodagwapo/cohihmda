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

  it("getDashboardInsightPath maps company-scorecard to standalone route", () => {
    expect(getDashboardInsightPath("company-scorecard")).toBe("/company-scorecard");
  });

  it("getDashboardInsightNavigateState omits filter state for company-scorecard", () => {
    expect(
      getDashboardInsightNavigateState("company-scorecard", { datePeriod: "l13m", branch: "North" })
    ).toEqual({});
  });

  it("getDashboardInsightPath maps credit-risk-management to standalone route", () => {
    expect(getDashboardInsightPath("credit-risk-management")).toBe("/credit-risk-management");
  });

  it("getDashboardInsightNavigateState omits filter state for credit-risk-management", () => {
    expect(
      getDashboardInsightNavigateState("credit-risk-management", {
        datePeriod: "l13m",
        applicationType: "Applications Taken",
      })
    ).toEqual({});
  });

  it("getDashboardInsightPath maps workflow-conversion to standalone route", () => {
    expect(getDashboardInsightPath("workflow-conversion")).toBe("/workflow-conversion");
  });

  it("getDashboardInsightNavigateState omits filter state for workflow-conversion", () => {
    expect(getDashboardInsightNavigateState("workflow-conversion", { datePeriod: "mtd" })).toEqual({});
  });
});
