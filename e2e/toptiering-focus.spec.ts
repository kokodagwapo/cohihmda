import { test, expect } from "./fixtures";
import { resetUnifiedChatShellToCompact } from "./helpers/unifiedChat";
import fs from "node:fs/promises";
import type { Locator, Page, TestInfo } from "@playwright/test";

type ActorType = "branch" | "loan-officer";
type Tier = "top" | "second" | "bottom";

interface MockActor {
  id: string;
  name: string;
  tier: Tier;
  revenue: number;
  units: number;
  volume: number;
  revenueBPS: number;
  revenuePerLoan: number;
}

interface MockComparisonResponse {
  actors: MockActor[];
  totals: {
    revenue: number;
    units: number;
    volume: number;
    avgRevenueBPS: number;
    actorCount: number;
    avgRevenuePerActor: number;
    avgUnitsPerActor: number;
  };
  tierSummary: {
    top: {
      count: number;
      revenue: number;
      revenuePercent: number;
      units: number;
      unitsPercent: number;
      avgRevenue: number;
      avgUnits: number;
    };
    second: {
      count: number;
      revenue: number;
      revenuePercent: number;
      units: number;
      unitsPercent: number;
      avgRevenue: number;
      avgUnits: number;
    };
    bottom: {
      count: number;
      revenue: number;
      revenuePercent: number;
      units: number;
      unitsPercent: number;
      avgRevenue: number;
      avgUnits: number;
    };
  };
  dateRange: {
    start: string;
    end: string;
    label: string;
    periodType: string;
  };
  yoyGrowth: number;
}

const BRANCH_ACTORS: MockActor[] = [
  {
    id: "BR-001",
    name: "Redwood Branch",
    tier: "top",
    revenue: 1_200_000,
    units: 30,
    volume: 15_000_000,
    revenueBPS: 80,
    revenuePerLoan: 40_000,
  },
  {
    id: "BR-002",
    name: "Summit Branch",
    tier: "top",
    revenue: 900_000,
    units: 22,
    volume: 11_000_000,
    revenueBPS: 82,
    revenuePerLoan: 40_909,
  },
  {
    id: "BR-003",
    name: "Harbor Branch",
    tier: "second",
    revenue: 600_000,
    units: 15,
    volume: 8_000_000,
    revenueBPS: 75,
    revenuePerLoan: 40_000,
  },
  {
    id: "BR-004",
    name: "Prairie Branch",
    tier: "bottom",
    revenue: 300_000,
    units: 8,
    volume: 4_500_000,
    revenueBPS: 67,
    revenuePerLoan: 37_500,
  },
];

const LOAN_OFFICER_ACTORS: MockActor[] = [
  {
    id: "LO-001",
    name: "Avery Stone",
    tier: "top",
    revenue: 500_000,
    units: 12,
    volume: 6_000_000,
    revenueBPS: 83,
    revenuePerLoan: 41_667,
  },
  {
    id: "LO-002",
    name: "Jordan Lee",
    tier: "top",
    revenue: 430_000,
    units: 10,
    volume: 5_100_000,
    revenueBPS: 84,
    revenuePerLoan: 43_000,
  },
  {
    id: "LO-003",
    name: "Morgan Diaz",
    tier: "second",
    revenue: 320_000,
    units: 8,
    volume: 4_000_000,
    revenueBPS: 80,
    revenuePerLoan: 40_000,
  },
  {
    id: "LO-004",
    name: "Casey Patel",
    tier: "bottom",
    revenue: 190_000,
    units: 5,
    volume: 2_600_000,
    revenueBPS: 73,
    revenuePerLoan: 38_000,
  },
];

const MOCK_RESPONSES: Record<ActorType, MockComparisonResponse> = {
  branch: buildComparisonResponse(BRANCH_ACTORS, "Last Quarter"),
  "loan-officer": buildComparisonResponse(LOAN_OFFICER_ACTORS, "Last Quarter"),
};

function buildComparisonResponse(
  actors: MockActor[],
  label: string,
): MockComparisonResponse {
  const totalRevenue = actors.reduce((sum, actor) => sum + actor.revenue, 0);
  const totalUnits = actors.reduce((sum, actor) => sum + actor.units, 0);
  const totalVolume = actors.reduce((sum, actor) => sum + actor.volume, 0);

  const summarizeTier = (tier: Tier) => {
    const tierActors = actors.filter((actor) => actor.tier === tier);
    const revenue = tierActors.reduce((sum, actor) => sum + actor.revenue, 0);
    const units = tierActors.reduce((sum, actor) => sum + actor.units, 0);
    return {
      count: tierActors.length,
      revenue,
      revenuePercent: totalRevenue > 0 ? (revenue / totalRevenue) * 100 : 0,
      units,
      unitsPercent: totalUnits > 0 ? (units / totalUnits) * 100 : 0,
      avgRevenue: tierActors.length > 0 ? revenue / tierActors.length : 0,
      avgUnits: tierActors.length > 0 ? units / tierActors.length : 0,
    };
  };

  return {
    actors,
    totals: {
      revenue: totalRevenue,
      units: totalUnits,
      volume: totalVolume,
      avgRevenueBPS: totalVolume > 0 ? (totalRevenue / totalVolume) * 10000 : 0,
      actorCount: actors.length,
      avgRevenuePerActor: actors.length > 0 ? totalRevenue / actors.length : 0,
      avgUnitsPerActor: actors.length > 0 ? totalUnits / actors.length : 0,
    },
    tierSummary: {
      top: summarizeTier("top"),
      second: summarizeTier("second"),
      bottom: summarizeTier("bottom"),
    },
    dateRange: {
      start: "2026-01-01",
      end: "2026-03-31",
      label,
      periodType: "quarter",
    },
    yoyGrowth: 8.4,
  };
}

async function dismissBlockingOverlays(page: Page) {
  for (let i = 0; i < 5; i++) {
    const blockingDialog = page
      .locator("[role='dialog']")
      .filter({ hasText: /quick tour|welcome|what's new|let us give you a quick tour/i })
      .first();
    const overlay = page.locator("div[data-state='open'][aria-hidden='true']").first();
    const dialogVisible = await blockingDialog
      .isVisible({ timeout: 1_500 })
      .catch(() => false);
    const overlayVisible = await overlay.isVisible({ timeout: 1_500 }).catch(() => false);

    if (dialogVisible || overlayVisible) {
      await page.keyboard.press("Escape");
      await page.waitForTimeout(500);
    } else {
      break;
    }
  }
}

async function mockTopTieringApis(page: Page) {
  await page.addInitScript(() => {
    for (const key of Object.keys(window.localStorage)) {
      if (key.startsWith("toptiering-comparison-")) {
        window.localStorage.removeItem(key);
      }
    }
  });

  await page.route("**/api/toptiering/comparison?**", async (route) => {
    const url = new URL(route.request().url());
    const actorType =
      (url.searchParams.get("actor_type") as ActorType | null) || "loan-officer";
    const payload = MOCK_RESPONSES[actorType] || MOCK_RESPONSES["loan-officer"];

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(payload),
    });
  });

  await page.route("**/api/dashboard-insights?**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ insights: [], generatedAt: null }),
    });
  });
}

function waitForComparisonResponse(page: Page, actorType: ActorType) {
  return page.waitForResponse((response) => {
    if (
      response.request().method() !== "GET" ||
      !response.url().includes("/api/toptiering/comparison?")
    ) {
      return false;
    }
    const url = new URL(response.url());
    return url.searchParams.get("actor_type") === actorType;
  });
}

async function openTopTiering(page: Page) {
  const initialResponse = waitForComparisonResponse(page, "loan-officer");
  await page.goto("/performance/toptiering-comparison", {
    waitUntil: "domcontentloaded",
  });
  await initialResponse;
  await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
  await dismissBlockingOverlays(page);
  await resetUnifiedChatShellToCompact(page);
}

async function switchActorMode(page: Page, tabLabel: "Branch" | "Loan Officer") {
  const tab = page.getByRole("tab", { name: tabLabel });
  await expect(tab).toBeVisible();
  await tab.click();
  await expect(tab).toHaveAttribute("data-state", "active");
  await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
  await page.waitForTimeout(1_200);
}

function chartBars(pageOrScope: Page | Locator, chartId: string) {
  return pageOrScope.locator(`#${chartId} .recharts-bar-rectangle path`);
}

async function expectPositiveBars(
  bars: Locator,
  expectedCount: number,
  contextLabel: string,
) {
  await expect(bars).toHaveCount(expectedCount);
  await expect
    .poll(
      async () => {
        const heights = await bars.evaluateAll((elements) =>
          elements.map((element) => {
            const attrHeight = Number(element.getAttribute("height") || "0");
            if (!Number.isNaN(attrHeight) && attrHeight > 0) {
              return attrHeight;
            }

            const bounds = element.getBoundingClientRect();
            return bounds.height;
          }),
        );
        return heights.filter((height) => height > 2).length;
      },
      { timeout: 10_000, message: `${contextLabel} should render ${expectedCount} visible bars` },
    )
    .toBe(expectedCount);
}

async function expectChartToRenderData(
  page: Page,
  chartId: string,
  expectedCount: number,
  expectedTitle: string,
) {
  const chart = page.locator(`#${chartId}`);
  await expect(chart).toBeVisible();
  await expect(chart).toContainText(expectedTitle);
  await expectPositiveBars(
    chartBars(page, chartId),
    expectedCount,
    `${chartId} (${expectedTitle})`,
  );
}

async function clickChartBar(page: Page, chartId: string, index: number) {
  const bars = chartBars(page, chartId);
  await expect(bars.nth(index)).toBeVisible();
  await bars.nth(index).click();
}

async function exportCsv(page: Page, testInfo: TestInfo, filename: string) {
  const downloadPromise = page.waitForEvent("download");
  await page.getByTestId("ttc-export-button").click();
  const download = await downloadPromise;
  const outputPath = testInfo.outputPath(filename);
  await download.saveAs(outputPath);
  return fs.readFile(outputPath, "utf8");
}

function dataRowCount(csvContent: string) {
  const lines = csvContent
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return Math.max(0, lines.length - 1);
}

test.describe("TopTiering Comparison — Actor Focus (COHI-327)", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(90_000);

  test.beforeEach(async ({ userPage }) => {
    await mockTopTieringApis(userPage);
    await openTopTiering(userPage);
  });

  test("@critical @COHI-327 page renders with non-zero branch charts and focus panel", async ({
    userPage,
  }) => {
    await switchActorMode(userPage, "Branch");

    await expect(userPage.locator("h1")).toContainText("TopTiering Comparison");
    await expect(userPage.getByTestId("ttc-focus-panel")).toBeVisible();
    await expect(
      userPage.getByRole("button", { name: "Focus Dashboard" }),
    ).toBeDisabled();
    await expect(
      userPage.getByRole("button", { name: "Clear Selection" }),
    ).toBeDisabled();
    await expect(
      userPage.getByText(
        /click a bar in any chart to select a branch, or click and drag across bars to select several/i,
      ),
    ).toBeVisible();

    await expectChartToRenderData(
      userPage,
      "ttc-revenue-chart",
      BRANCH_ACTORS.length,
      "Revenue by Branch",
    );
    await expectChartToRenderData(
      userPage,
      "ttc-units-volume-chart",
      BRANCH_ACTORS.length,
      "Units by Branch",
    );
    await expectChartToRenderData(
      userPage,
      "ttc-revenue-quality-chart",
      BRANCH_ACTORS.length,
      "Revenue BPS by Branch",
    );

    await expect(userPage.locator("#ttc-revenue-chart")).toContainText("BR-001");
    await expect(userPage.locator("#ttc-units-volume-chart")).toContainText(
      "BR-004",
    );

    const bpsCard = userPage.locator("#ttc-kpi-avg-revenue-bps");
    await expect(bpsCard).toBeVisible();
    const bpsValueText = await bpsCard.locator("p").nth(1).textContent();
    const bpsValue = Number(bpsValueText?.replace(/[^0-9.-]/g, ""));
    expect(bpsValue).toBeGreaterThan(0);

    await expect(userPage.locator("body")).not.toContainText("Branchs");
  });

  test(
    "@critical @COHI-327 focus scopes charts, detail table, and CSV export to selected branches",
    async ({ userPage }, testInfo) => {
    await switchActorMode(userPage, "Branch");

    const fullExport = await exportCsv(userPage, testInfo, "toptiering-full.csv");
    expect(dataRowCount(fullExport)).toBe(BRANCH_ACTORS.length);

    await clickChartBar(userPage, "ttc-units-volume-chart", 0);
    await clickChartBar(userPage, "ttc-units-volume-chart", 1);

    await expect(userPage.getByText(/2 branches selected/i)).toBeVisible();
    await expect(
      userPage.getByRole("button", { name: "Focus Dashboard" }),
    ).toBeEnabled();

    await userPage.getByRole("button", { name: "Focus Dashboard" }).click();

    await expect(userPage.locator("h1")).toContainText("TopTiering Comparison");
    await expect(userPage.getByTestId("ttc-focus-panel")).toContainText(
      "Focused on 2 branches",
    );
    await expect(
      userPage.getByRole("button", { name: "Clear Focus" }),
    ).toBeVisible();

    await expectPositiveBars(
      chartBars(userPage, "ttc-revenue-chart"),
      2,
      "Focused revenue chart",
    );
    await expectPositiveBars(
      chartBars(userPage, "ttc-revenue-quality-chart"),
      2,
      "Focused BPS chart",
    );

    const unitsCard = userPage.locator("#ttc-units-volume-chart");
    await unitsCard.getByRole("tab", { name: "Detail" }).click();
    const detailTable = userPage.locator("#ttc-detail-table");
    await expect(detailTable).toBeVisible();
    await expect(detailTable.locator("tbody tr")).toHaveCount(2);

    const focusedExport = await exportCsv(
      userPage,
      testInfo,
      "toptiering-focused.csv",
    );
    expect(dataRowCount(focusedExport)).toBe(2);
    expect(dataRowCount(focusedExport)).toBeLessThan(dataRowCount(fullExport));

    await userPage.getByRole("button", { name: "Clear Focus" }).click();
    await expect(userPage.getByText("Focused on")).not.toBeVisible();
    await expectPositiveBars(
      chartBars(userPage, "ttc-revenue-chart"),
      BRANCH_ACTORS.length,
      "Restored revenue chart",
    );
    },
  );

  test("@critical @COHI-327 focus panel works inside expanded chart modal and scopes the page", async ({
    userPage,
  }) => {
    await switchActorMode(userPage, "Branch");

    const unitsChartCard = userPage.locator("#ttc-units-volume-chart");
    await unitsChartCard.locator("button[title='Expand chart']").click();

    const dialog = userPage.locator("[role='dialog']").last();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId("ttc-focus-panel")).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "Focus Dashboard" }),
    ).toBeDisabled();

    const modalBars = dialog.locator(".recharts-bar-rectangle");
    await expectPositiveBars(
      modalBars,
      BRANCH_ACTORS.length,
      "Expanded units chart",
    );

    await modalBars.nth(0).click();
    await expect(dialog.getByText(/1 branch selected/i)).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "Focus Dashboard" }),
    ).toBeEnabled();

    await dialog.getByRole("button", { name: "Focus Dashboard" }).click();
    await expect(dialog.getByText(/Focused on 1 branch/i)).toBeVisible();
    await expectPositiveBars(modalBars, 1, "Focused units chart in modal");

    await userPage.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await expect(userPage.getByText(/Focused on 1 branch/i)).toBeVisible();
    await expectPositiveBars(
      chartBars(userPage, "ttc-revenue-chart"),
      1,
      "Revenue chart after modal focus",
    );
  });

  test("@critical @COHI-327 switching actor mode clears branch focus and renders loan officer data", async ({
    userPage,
  }) => {
    await switchActorMode(userPage, "Branch");
    await clickChartBar(userPage, "ttc-revenue-chart", 0);
    await userPage.getByRole("button", { name: "Focus Dashboard" }).click();
    await expect(userPage.getByText(/Focused on 1 branch/i)).toBeVisible();

    await switchActorMode(userPage, "Loan Officer");

    await expect(userPage.getByText("Focused on")).not.toBeVisible();
    await expect(
      userPage.getByRole("button", { name: "Focus Dashboard" }),
    ).toBeDisabled();
    await expectChartToRenderData(
      userPage,
      "ttc-revenue-chart",
      LOAN_OFFICER_ACTORS.length,
      "Revenue by Loan Officer",
    );
    await expect(userPage.locator("#ttc-revenue-chart")).toContainText(
      "Avery Stone",
    );
    await expect(userPage.locator("#ttc-revenue-quality-chart")).toContainText(
      "Revenue BPS by Loan Officer",
    );
  });
});
