import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

const SCORECARD_METRIC_IDS = [
  "loans_started",
  "scorecard_total_loans",
  "scorecard_originated_loans",
  "fallout_withdrawn",
  "fallout_denied",
  "total_volume",
  "originated_volume",
  "funded_volume",
  "avg_cycle_time",
  "pull_through_rate",
  "credit_pulls",
  "wa_fico",
  "wa_ltv",
  "wa_dti",
  "wac",
  "total_revenue",
  "originated_revenue",
  "govt_originated_units",
  "purchase_originated_units",
  "hmda_volume",
  "hmda_units",
  "withdrawn_volume",
  "withdrawn_proforma_revenue",
  "denied_volume",
] as const;

const AVERAGED_METRICS = new Set<string>([
  "avg_cycle_time",
  "pull_through_rate",
  "wa_fico",
  "wa_ltv",
  "wa_dti",
  "wac",
]);

type ScorecardMetricId = (typeof SCORECARD_METRIC_IDS)[number];
type MockMetricRow = { name: string } & Record<ScorecardMetricId, number>;

function buildMockRows(prefix: string, count: number): MockMetricRow[] {
  return Array.from({ length: count }, (_, index) => {
    const apps = 18 + index;
    const originated = 9 + index;
    const withdrawn = 2 + (index % 3);
    const denied = 1 + (index % 2);
    const totalVolume = 1_500_000 + index * 125_000;
    const originatedVolume = 900_000 + index * 100_000;
    const originatedRevenue = 24_000 + index * 1_800;

    return {
      name: `${prefix} ${index + 1}`,
      loans_started: apps + 3,
      scorecard_total_loans: apps,
      scorecard_originated_loans: originated,
      fallout_withdrawn: withdrawn,
      fallout_denied: denied,
      total_volume: totalVolume,
      originated_volume: originatedVolume,
      funded_volume: originatedVolume,
      avg_cycle_time: 32 + (index % 4),
      pull_through_rate: (originated / apps) * 100,
      credit_pulls: apps + 1,
      wa_fico: 700 + index,
      wa_ltv: 69 + index * 0.4,
      wa_dti: 31 + index * 0.3,
      wac: 6.05 + index * 0.01,
      total_revenue: originatedRevenue + 3_500,
      originated_revenue: originatedRevenue,
      govt_originated_units: 2 + (index % 4),
      purchase_originated_units: 4 + (index % 5),
      hmda_volume: totalVolume - 40_000,
      hmda_units: apps - 1,
      withdrawn_volume: 140_000 + index * 8_000,
      withdrawn_proforma_revenue: 4_500 + index * 350,
      denied_volume: 90_000 + index * 6_500,
    };
  });
}

function buildGroupedMetrics(rows: MockMetricRow[]) {
  return Object.fromEntries(
    SCORECARD_METRIC_IDS.map((metricId) => [
      metricId,
      rows.map((row) => ({
        groupKey: row.name,
        value: row[metricId],
      })),
    ]),
  );
}

function buildTotalsMetrics(rows: MockMetricRow[]) {
  return Object.fromEntries(
    SCORECARD_METRIC_IDS.map((metricId) => {
      const total = AVERAGED_METRICS.has(metricId)
        ? rows.reduce((sum, row) => sum + row[metricId], 0) / Math.max(rows.length, 1)
        : rows.reduce((sum, row) => sum + row[metricId], 0);

      return [
        metricId,
        {
          metricId,
          value: total,
        },
      ];
    }),
  );
}

async function mockCompanyScorecardApis(page: Page) {
  const branchRows = buildMockRows("Branch", 12);
  const loanOfficerRows = buildMockRows("Loan Officer", 12);

  await page.route("**/api/dashboard-insights?**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ insights: [], generatedAt: null }),
    });
  });

  await page.route("**/api/loans/distinct-values/branch*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ values: branchRows.map((row) => row.name) }),
    });
  });

  await page.route("**/api/loans/distinct-values/loan_officer*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ values: loanOfficerRows.map((row) => row.name) }),
    });
  });

  await page.route("**/api/metrics/query*", async (route) => {
    const body = route.request().postDataJSON() as { groupBy?: string } | null;

    let responseBody: unknown;
    if (body?.groupBy === "branch") {
      responseBody = { metrics: buildGroupedMetrics(branchRows), groupedBy: "branch" };
    } else if (body?.groupBy === "loan_officer") {
      responseBody = { metrics: buildGroupedMetrics(loanOfficerRows), groupedBy: "loan_officer" };
    } else {
      responseBody = { metrics: buildTotalsMetrics(branchRows) };
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(responseBody),
    });
  });
}

async function openCompanyScorecardDetail(userPage: Page) {
  await userPage.goto("/company-scorecard", { waitUntil: "domcontentloaded" });
  await expect(userPage).toHaveURL(/\/company-scorecard/);
  await expect(
    userPage.getByRole("heading", { name: "Company Scorecard" }).first(),
  ).toBeVisible({ timeout: 15_000 });
  await userPage.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});

  const detailTab = userPage.getByRole("tab", { name: /^Detail$/ });
  await expect(detailTab).toBeVisible({ timeout: 15_000 });
  await detailTab.click();

  const detailTable = userPage.locator("#company-scorecard-detail-branch-table table");
  await expect(detailTable).toBeVisible({ timeout: 15_000 });
  await expect(detailTable.getByText("Totals")).toBeVisible({ timeout: 15_000 });

  return detailTable;
}

function parseDetailRowCount(summaryText: string): number {
  const allMatch = summaryText.match(/All\s+(\d+)/i);
  if (allMatch) {
    return Number(allMatch[1]);
  }

  const pagedMatch = summaryText.match(/of\s+(\d+)/i);
  if (pagedMatch) {
    return Number(pagedMatch[1]);
  }

  return 0;
}

test.describe("Company Scorecard detail table", () => {
  test("@regression @COHI-348 uses final-status labels and table-scoped actions", async ({
    userPage,
  }) => {
    await mockCompanyScorecardApis(userPage);
    const detailTable = await openCompanyScorecardDetail(userPage);

    await expect(userPage.getByRole("button", { name: "Export" })).toHaveCount(1);
    await expect(userPage.getByRole("button", { name: "Export" })).toBeVisible();
    await expect(userPage.getByRole("button", { name: "Fullscreen" })).toBeVisible();

    await expect(
      detailTable.getByRole("columnheader", { name: /Final Vol/i }),
    ).toBeVisible();
    await expect(
      detailTable.getByRole("columnheader", { name: /Final Units/i }),
    ).toBeVisible();

    await expect(detailTable.getByText("Vol HMDA")).toHaveCount(0);
    await expect(detailTable.getByText("Units HMDA")).toHaveCount(0);
  });

  test("@regression @COHI-348 supports show-all rows and fullscreen full dataset", async ({
    userPage,
  }) => {
    await mockCompanyScorecardApis(userPage);
    const detailTable = await openCompanyScorecardDetail(userPage);
    const rowsPerPageSelect = userPage.getByRole("combobox").last();

    await expect(rowsPerPageSelect).toContainText(/All/i);

    const allSummary = userPage.getByText(/All\s+\d+/i).first();
    await expect(allSummary).toBeVisible();
    const allSummaryText = (await allSummary.textContent()) ?? "";
    const totalRows = parseDetailRowCount(allSummaryText);
    expect(totalRows).toBeGreaterThan(0);

    await rowsPerPageSelect.click();
    await userPage.getByRole("option", { name: "10" }).click();

    if (totalRows > 10) {
      await expect(userPage.getByText(/1-10 of \d+/i)).toBeVisible();
      await expect(detailTable.locator("tbody tr")).toHaveCount(11);

      await userPage.getByRole("button", { name: "Fullscreen" }).click();

      const dialog = userPage.locator("[role='dialog']").last();
      await expect(dialog).toBeVisible({ timeout: 10_000 });
      await expect(
        dialog.getByRole("columnheader", { name: /Final Vol/i }),
      ).toBeVisible();
      await expect(dialog.locator("tbody tr")).toHaveCount(totalRows + 1);
    } else {
      await expect(rowsPerPageSelect).toContainText("10");
      await expect(detailTable.locator("tbody tr")).toHaveCount(totalRows + 1);
    }
  });
});
