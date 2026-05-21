import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";
import { gotoDashboardPage } from "./helpers/unifiedChat";

const mockInsight = {
  id: 1501,
  type: "info",
  priority: "standard",
  bucket: "context",
  headline: "Pipeline data is ready for review",
  understory: "Review refreshed metrics before the next scheduled sync.",
  source: "qa",
};

async function mockInsightsRefreshApis(
  page: Page,
  options: { lastSyncedAt: string | null; syncFrequency?: string | null },
) {
  await page.route(/\/api\/user\/preferences\/dashboardVisibility(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ CohiInsights: true, industryNews: false }),
    });
  });

  await page.route(/\/api\/dashboard\/insights(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        insights: [mockInsight],
        usedLLM: true,
        generatedAt: new Date().toISOString(),
      }),
    });
  });

  await page.route(/\/api\/dashboard-insights(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ insights: [], generatedAt: null }),
    });
  });

  await page.route(/\/api\/los\/connections(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        connections: [
          {
            id: "los-connection-1",
            name: "Encompass",
            status: "connected",
            last_synced_at: options.lastSyncedAt,
            sync_frequency: options.syncFrequency ?? "hourly",
          },
        ],
      }),
    });
  });
}

test.describe("Insights refresh schedule display", () => {
  test("@critical @COHI-15 shows last sync and upcoming next sync on Insights", async ({
    userPage,
  }) => {
    const lastSyncedAt = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    await mockInsightsRefreshApis(userPage, {
      lastSyncedAt,
      syncFrequency: "hourly",
    });

    await gotoDashboardPage(userPage, "/insights");

    const insightsSection = userPage.locator("#CohiInsights");
    await expect(insightsSection).toBeVisible({ timeout: 15_000 });
    await expect(insightsSection.getByText("Pipeline data is ready for review")).toBeVisible();
    await expect(insightsSection.getByText(/Data Last Synced:/)).toBeVisible();
    await expect(insightsSection.getByText(/Data Next Sync:/)).toBeVisible();
    await expect(insightsSection.getByText(/Data Next Sync: Soon/)).toHaveCount(0);
  });

  test("@critical @COHI-15 hides next sync when no future sync can be estimated", async ({
    userPage,
  }) => {
    await mockInsightsRefreshApis(userPage, {
      lastSyncedAt: null,
      syncFrequency: null,
    });

    await gotoDashboardPage(userPage, "/insights");

    const insightsSection = userPage.locator("#CohiInsights");
    await expect(insightsSection).toBeVisible({ timeout: 15_000 });
    await expect(insightsSection.getByText(/Data Last Synced:/)).toBeVisible();
    await expect(insightsSection.getByText(/Data Next Sync:/)).toHaveCount(0);
    await expect(insightsSection.getByText(/Data Next Sync: Soon/)).toHaveCount(0);
  });
});
