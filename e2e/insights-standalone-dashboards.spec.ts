import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

async function mockStandaloneDashboardApis(page: Page) {
  await page.route("**/api/user/preferences/dashboardVisibility", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        CohiInsights: true,
        industryNews: false,
        leaderboard: true,
      }),
    });
  });

  await page.route("**/api/dashboard-insights?**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ insights: [], generatedAt: null }),
    });
  });

  await page.route("**/api/dashboard/insights**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ insights: [] }),
    });
  });

  await page.route("**/api/dashboard/leaderboard?**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        timeframe: "lq",
        leaderboard: [
          {
            employeeId: "lo-1",
            name: "Avery Adams",
            role: "Loan Officer",
            branch: "Main",
            rank: 1,
            loansClosed: 18,
            loansStarted: 24,
            totalVolume: 7200000,
            totalRevenue: 180000,
            pullThroughRate: 75,
            avgCycleTime: 31,
          },
        ],
      }),
    });
  });

  await page.route("**/api/metrics/query**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ metrics: {} }),
    });
  });
}

test.describe("Insights standalone dashboards", () => {
  test("@critical @COHI-79 removes leaderboard and business overview sections from /insights", async ({
    userPage,
  }) => {
    await mockStandaloneDashboardApis(userPage);
    await userPage.goto("/insights", { waitUntil: "domcontentloaded" });

    await expect(userPage).toHaveURL(/\/insights/);
    await expect(userPage.locator("#CohiInsights")).toBeVisible({ timeout: 15_000 });
    await expect(userPage.locator(".section-business-overview")).toHaveCount(0);
    await expect(userPage.locator(".section-leaderboard")).toHaveCount(0);
  });

  test("@critical @COHI-79 renders Leaderboard on its dedicated route", async ({
    userPage,
  }) => {
    await mockStandaloneDashboardApis(userPage);
    await userPage.goto("/leaderboard", { waitUntil: "domcontentloaded" });

    await expect(userPage).toHaveURL(/\/leaderboard/);
    await expect(
      userPage.getByRole("heading", { name: /^Leaderboard$/ }).first(),
    ).toBeVisible({ timeout: 15_000 });
    await expect(userPage.getByText("Avery Adams")).toBeVisible({ timeout: 15_000 });
  });

  test("@critical @COHI-79 renders Business Overview on its dedicated route", async ({
    userPage,
  }) => {
    await mockStandaloneDashboardApis(userPage);
    await userPage.goto("/business-overview", { waitUntil: "domcontentloaded" });

    await expect(userPage).toHaveURL(/\/business-overview/);
    await expect(
      userPage.getByRole("heading", { name: /^Business Overview$/ }).first(),
    ).toBeVisible({ timeout: 15_000 });
  });
});
