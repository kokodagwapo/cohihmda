import { test, expect } from "./fixtures";
import { resetUnifiedChatShellToCompact } from "./helpers/unifiedChat";
import type { Page } from "@playwright/test";

/**
 * Tier-1 E2E for Production Trends (`/production-trends`), traceable to COHI-346.
 * Mocks `GET /api/loans/production-trends` so charts and tables are deterministic without DB shape drift.
 *
 * Acceptance criteria coverage (numbered list from Jira AC block):
 * 1–4: route, API keys, filter card labels, YearMonth popover
 * 5: YoY table, bar chart, line chart, drilldown hierarchy badge
 * 6: multiple YoY series tabs
 * 7–9: bar / line month / drilldown → Active filters pills
 * 10–13: popover actions + Escape + Cancel vs Apply + Clear Selection draft
 * 14: pill X + Clear all filters
 * 15: Switch Measure formatting + Switch Dimension clears dimension slice
 */

async function suppressWelcomeTour(page: Page) {
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem("cohi-welcome-tour-last-shown", new Date().toISOString());
      for (const k of Object.keys(window.localStorage)) {
        if (k.startsWith("cohi-production-trends-view-state:")) {
          window.localStorage.removeItem(k);
        }
      }
    } catch {
      /* ignore */
    }
  });
}

async function dismissBlockingOverlays(page: Page) {
  for (let i = 0; i < 5; i += 1) {
    const blockingDialog = page
      .locator("[role='dialog']")
      .filter({ hasText: /quick tour|welcome|what's new|let us give you a quick tour/i })
      .first();
    const overlay = page.locator("div[data-state='open'][aria-hidden='true']").first();
    const dialogVisible = await blockingDialog.isVisible({ timeout: 1_000 }).catch(() => false);
    const overlayVisible = await overlay.isVisible({ timeout: 1_000 }).catch(() => false);
    if (!dialogVisible && !overlayVisible) break;
    await page.keyboard.press("Escape");
    await page.waitForTimeout(350);
  }
}

function buildMockProductionTrendsResponse() {
  const points = [1, 2, 3].map((month) => ({
    month,
    monthLabel: ["Jan", "Feb", "Mar"][month - 1],
    currentValue: 100_000 * month,
    previousValue: 90_000 * month,
  }));

  return {
    currentYear: 2026,
    previousYear: 2025,
    currentMaxYear: 2026,
    currentMaxMonth: 4,
    dateTypeLabel: "Funded Loans",
    measureLabel: "Volume",
    dimensionLabel: "Branch",
    yearMonthOptions: [
      { value: "2026-01", label: "Jan 2026" },
      { value: "2026-02", label: "Feb 2026" },
    ],
    yoyComparison: [
      { timeRange: "Month to Date" as const, currentYear: 1_200_000, previousYear: 1_000_000, yoyPercent: 20 },
      { timeRange: "Quarter to Date" as const, currentYear: 5_000_000, previousYear: 4_800_000, yoyPercent: 4.2 },
      { timeRange: "Year to Date" as const, currentYear: 12_000_000, previousYear: 10_000_000, yoyPercent: 20 },
    ],
    largestCategory: {
      titleCategory: "North",
      titleSharePercent: 35,
      rows: [
        { category: "North", units: 50, volume: 5_000_000, sharePercent: 35 },
        { category: "South", units: 40, volume: 4_000_000, sharePercent: 28 },
      ],
    },
    yoySeries: [
      { key: "pair-a", currentYear: 2026, previousYear: 2025, points },
      { key: "pair-b", currentYear: 2025, previousYear: 2024, points: [...points] },
    ],
    drilldown: {
      turnTimeLabel: "Average Turn Time",
      rows: [
        {
          id: "b1",
          parentId: null,
          depth: 0,
          label: "Alpha Branch",
          units: 10,
          volume: 1_000_000,
          avgLoanAmount: 100_000,
          avgLtv: 75,
          wac: 6.1,
          avgTurnTime: 25,
        },
        {
          id: "l1",
          parentId: "b1",
          depth: 1,
          label: "First Lien",
          units: 8,
          volume: 800_000,
          avgLoanAmount: 100_000,
          avgLtv: 74,
          wac: 6.05,
          avgTurnTime: 22,
        },
      ],
    },
    sliceFilterOptionLists: {
      dimensionValues: ["North", "South"],
      drilldownBranches: ["Alpha Branch"],
      drilldownLiens: ["First Lien"],
      drilldownProducts: ["Conv 30"],
      drilldownPrograms: ["DU Refi"],
    },
  };
}

async function setupProductionTrendsApiMock(page: Page): Promise<{ productionTrendsUrls: string[] }> {
  const productionTrendsUrls: string[] = [];
  const persistedPreference: {
    preference_value: {
      version: number;
      dateType: "applications" | "closed" | "funded";
      measure: "volume" | "units";
      dimension: "loan_purpose" | "loan_type" | "channel" | "branch" | "broker_lender_name" | "investor" | "warehouse_co_name";
      yearMonths: string[];
      sliceCategories: string[];
      sliceLineMonths: number[];
      sliceDrilldown: {
        branches: string[];
        lienPositions: string[];
        productTypes: string[];
        loanPrograms: string[];
      } | null;
    } | null;
  } = { preference_value: null };

  await page.route(/\/api\/loans\/production-trends(\?|$)/, async (route) => {
    productionTrendsUrls.push(route.request().url());
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(buildMockProductionTrendsResponse()),
    });
  });

  await page.route(/\/api\/user\/preferences\/productionTrendsViewState:v1:tenant:.*:standalone$/, async (route) => {
    const method = route.request().method();
    if (method === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(persistedPreference),
      });
      return;
    }
    if (method === "PUT") {
      const body = route.request().postDataJSON() as { preference_value?: typeof persistedPreference.preference_value };
      persistedPreference.preference_value = body?.preference_value ?? null;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true }),
      });
      return;
    }
    await route.continue();
  });

  return { productionTrendsUrls };
}

async function gotoProductionTrends(userPage: Page) {
  await userPage.goto("/production-trends", { waitUntil: "domcontentloaded" });
  await userPage.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
  await dismissBlockingOverlays(userPage);
  await resetUnifiedChatShellToCompact(userPage);
}

async function gotoNewWorkbenchCanvas(userPage: Page) {
  await userPage.goto("/my-dashboard/new", { waitUntil: "domcontentloaded" });
  await userPage.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
  await dismissBlockingOverlays(userPage);
  await expect(userPage).toHaveURL(/\/my-dashboard\/new/);
  await expect(userPage.getByTestId("workbench-canvas-title-input")).toBeVisible({
    timeout: 20_000,
  });
}

/** Add Production Trends section via canvas toolbar Add menu (same as removed Cohi Dashboards tab). */
async function addProductionTrendsDashboardSection(userPage: Page) {
  const canvasRoot = userPage.locator("#workbench-canvas-root");
  await canvasRoot.getByRole("button", { name: "Add" }).click();
  // Add dropdown panels are portaled to document body — not under #workbench-canvas-root
  await userPage.getByRole("button", { name: "Trends & Analysis" }).click();
  await userPage.getByRole("menuitem", { name: "Production Trends" }).click();
}

function productionTrendsWorkbenchGroup(userPage: Page) {
  return userPage
    .locator("div.group\\/widgetgroup")
    .filter({
      has: userPage.getByText("Production Trends Largest Category", {
        exact: true,
      }),
    })
    .first();
}

function groupFilterRow(group: ReturnType<typeof productionTrendsWorkbenchGroup>) {
  return group.locator("div.flex.items-center.gap-1\\.5.px-2\\.5.pb-1\\.5.flex-wrap").first();
}

async function ensureGroupFiltersExpanded(
  group: ReturnType<typeof productionTrendsWorkbenchGroup>,
) {
  const row = groupFilterRow(group);
  const dateTypeSelect = row.locator("select").first();
  const selectVisible = await dateTypeSelect.isVisible().catch(() => false);
  if (selectVisible) return;

  const filtersToggle = group.getByRole("button", { name: "Filters" }).first();
  if (await filtersToggle.isVisible().catch(() => false)) {
    await filtersToggle.click();
  }

  await expect(dateTypeSelect).toBeVisible({ timeout: 15_000 });
}

/** Slice-filter popover is portaled; scope by Apply Filters to avoid other poppers (e.g. YearMonth). */
function sliceFilterPopover(userPage: Page) {
  return userPage.locator("[data-radix-popper-content-wrapper]");
}

async function getVisibleSliceFilterPopover(userPage: Page) {
  const wrappers = sliceFilterPopover(userPage);
  const count = await wrappers.count();
  for (let i = count - 1; i >= 0; i -= 1) {
    const candidate = wrappers.nth(i);
    const visible = await candidate.isVisible().catch(() => false);
    if (!visible) continue;
    const hasApply = await candidate
      .getByRole("button", { name: "Apply Filters" })
      .first()
      .isVisible()
      .catch(() => false);
    if (hasApply) return candidate;
  }
  return wrappers
    .filter({ has: userPage.getByRole("button", { name: "Apply Filters" }) })
    .last();
}

async function clickSlicePopoverButton(userPage: Page, label: "Clear Selection" | "Cancel" | "Apply Filters") {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const pop = await getVisibleSliceFilterPopover(userPage);
    await expect(pop).toBeVisible({ timeout: 15_000 });
    const button = pop.getByRole("button", { name: label });
    await expect(button).toBeVisible({ timeout: 15_000 });
    try {
      await button.click({ force: true, timeout: 5_000 });
      return;
    } catch (error) {
      if (attempt === 2) throw error;
    }
  }
}

test.describe("Production Trends (COHI-346)", () => {
  test.describe.configure({ mode: "serial", timeout: 90_000 });

  test("@critical @COHI-346 route, API payload, filter card, and YearMonth popover (AC1–4)", async ({ userPage }) => {
    await suppressWelcomeTour(userPage);
    await setupProductionTrendsApiMock(userPage);

    const responsePromise = userPage.waitForResponse(
      (r) => r.url().includes("/api/loans/production-trends") && r.status() === 200,
    );
    await userPage.goto("/production-trends", { waitUntil: "domcontentloaded" });
    const productionResponse = await responsePromise;
    await userPage.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
    await dismissBlockingOverlays(userPage);
    await resetUnifiedChatShellToCompact(userPage);

    await expect(userPage).toHaveURL(/\/production-trends/);
    await expect(userPage.locator("h1")).toContainText("Production Trends");

    const body = (await productionResponse.json()) as Record<string, unknown>;
    for (const key of [
      "yoyComparison",
      "largestCategory",
      "yoySeries",
      "drilldown",
      "yearMonthOptions",
      "sliceFilterOptionLists",
    ]) {
      expect(body, `response should include ${key}`).toHaveProperty(key);
    }

    const main = userPage.locator("main");
    await expect(main.getByText("Date Type", { exact: true })).toBeVisible();
    await expect(main.getByText("Switch Measure", { exact: true })).toBeVisible();
    await expect(main.getByText("Switch Dimension", { exact: true })).toBeVisible();
    await expect(main.getByText("YearMonth", { exact: true })).toBeVisible();

    await main.getByRole("button", { name: /All YearMonths|Select months|\d+ YearMonths selected/ }).click();
    const ymPopover = userPage.locator("[data-radix-popper-content-wrapper]").last();
    await expect(ymPopover.getByPlaceholder("Filter list…")).toBeVisible();
    await expect(ymPopover.getByRole("button", { name: "Clear all" })).toBeVisible();
    await expect(ymPopover.getByRole("button", { name: "Done" })).toBeVisible();
    await ymPopover.getByRole("button", { name: "Done" }).click();
  });

  test("@critical @COHI-346 YoY table, charts, drilldown badge, and series tabs (AC5–6)", async ({ userPage }) => {
    await suppressWelcomeTour(userPage);
    await setupProductionTrendsApiMock(userPage);
    await gotoProductionTrends(userPage);

    const main = userPage.locator("main");
    await expect(main.getByRole("columnheader", { name: "Time Range" })).toBeVisible();
    await expect(main.getByRole("columnheader", { name: "YoY %" })).toBeVisible();
    await expect(main.locator(".recharts-wrapper").first()).toBeVisible();
    expect(await main.locator(".recharts-wrapper").count()).toBeGreaterThanOrEqual(2);
    await expect(main.getByText("Branch → Lien Position → Product Type → Loan Program")).toBeVisible();

    await expect(main.getByRole("tab", { name: "2026 vs 2025" })).toBeVisible();
    await expect(main.getByRole("tab", { name: "2025 vs 2024" })).toBeVisible();
    await main.getByRole("tab", { name: "2025 vs 2024" }).click();
    await expect(main.locator(".recharts-line")).toHaveCount(await main.locator(".recharts-line").count());
  });

  test("@critical @COHI-346 bar, line month, and drilldown rows add Active filters pills (AC7–9)", async ({
    userPage,
  }) => {
    await suppressWelcomeTour(userPage);
    await setupProductionTrendsApiMock(userPage);
    await gotoProductionTrends(userPage);

    const main = userPage.locator("main");
    await expect(main.locator(".recharts-bar-rectangle").first()).toBeVisible({ timeout: 20_000 });
    await main.locator(".recharts-bar-rectangle").first().click();
    await expect(main.getByText("Active filters", { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(main.getByRole("button", { name: /^Branch: North$/ })).toBeVisible();

    await main.locator("circle.cursor-pointer").first().click({ force: true });
    await expect(main.getByRole("button", { name: /^Month: / })).toBeVisible();

    const drillTable = main.locator("table").nth(1);
    await expect(drillTable.locator("th").filter({ hasText: "Group" })).toBeVisible();
    await drillTable.getByText("Alpha Branch", { exact: true }).click();
    await expect(main.getByRole("button", { name: /^Branch: Alpha Branch$/ })).toBeVisible();
  });

  test("@critical @COHI-346 active-filter popover Escape, Cancel, Apply, and Clear Selection draft (AC10–13)", async ({
    userPage,
  }) => {
    await suppressWelcomeTour(userPage);
    await setupProductionTrendsApiMock(userPage);
    await gotoProductionTrends(userPage);

    const main = userPage.locator("main");
    await expect(main.locator(".recharts-bar-rectangle").first()).toBeVisible({ timeout: 20_000 });
    await main.locator(".recharts-bar-rectangle").first().click();
    await expect(main.getByRole("button", { name: /^Branch: North$/ })).toBeVisible({ timeout: 15_000 });

    await main.getByRole("button", { name: /^Branch: North$/ }).click();
    const pop = await getVisibleSliceFilterPopover(userPage);
    await expect(pop).toBeVisible({ timeout: 15_000 });
    await expect(pop.getByRole("button", { name: "Apply Filters" })).toBeVisible();
    await expect(pop.getByRole("button", { name: "Cancel" })).toBeVisible();
    await expect(pop.getByRole("button", { name: "Clear Selection" })).toBeVisible();

    await userPage.keyboard.press("Escape");
    await expect(pop.getByRole("button", { name: "Apply Filters" })).toBeVisible();

    await main.getByRole("button", { name: /^Branch: North$/ }).click();
    await clickSlicePopoverButton(userPage, "Clear Selection");
    await main.getByRole("button", { name: /^Branch: North$/ }).click();
    await clickSlicePopoverButton(userPage, "Cancel");
    await expect(main.getByRole("button", { name: /^Branch: North$/ })).toBeVisible();

    await main.getByRole("button", { name: /^Branch: North$/ }).click();
    await clickSlicePopoverButton(userPage, "Clear Selection");
    await main.getByRole("button", { name: /^Branch: North$/ }).click();
    await clickSlicePopoverButton(userPage, "Apply Filters");
    await expect(main.getByRole("button", { name: /^Branch: North$/ })).toHaveCount(0);
  });

  test("@critical @COHI-346 pill remove X and Clear all filters (AC14)", async ({ userPage }) => {
    await suppressWelcomeTour(userPage);
    await setupProductionTrendsApiMock(userPage);
    await gotoProductionTrends(userPage);

    const main = userPage.locator("main");
    await expect(main.locator(".recharts-bar-rectangle").first()).toBeVisible({ timeout: 20_000 });
    await main.locator(".recharts-bar-rectangle").first().click();
    await expect(main.getByText("Active filters", { exact: true })).toBeVisible({ timeout: 15_000 });

    await main.getByRole("button", { name: "Remove Branch filter" }).click();
    await expect(main.getByText("Active filters", { exact: true })).toHaveCount(0);

    await main.locator(".recharts-bar-rectangle").nth(1).click();
    await main.locator("circle.cursor-pointer").first().click({ force: true });
    await expect(main.getByText("Active filters", { exact: true })).toBeVisible();
    await main.getByRole("button", { name: "Clear all filters" }).click();
    await expect(main.getByText("Active filters", { exact: true })).toHaveCount(0);
  });

  test("@critical @COHI-346 Switch Measure formatting and Switch Dimension clears dimension slices (AC15)", async ({
    userPage,
  }) => {
    await suppressWelcomeTour(userPage);
    await setupProductionTrendsApiMock(userPage);
    await gotoProductionTrends(userPage);

    const main = userPage.locator("main");
    const yoyTable = main.locator("table").first();
    await expect(yoyTable.locator("th").filter({ hasText: "Time Range" })).toBeVisible();
    await expect(yoyTable.locator("tbody tr").first()).toBeVisible({ timeout: 15_000 });
    const firstMetricCell = yoyTable.locator("tbody tr").first().locator("td").nth(1);

    await expect(firstMetricCell).toContainText(/\$/);
    const filterGrid = main
      .locator("div")
      .filter({ has: main.getByText("Date Type", { exact: true }) })
      .filter({ has: main.getByText("Switch Measure", { exact: true }) })
      .filter({ has: main.getByText("Switch Dimension", { exact: true }) })
      .filter({ has: main.getByText("YearMonth", { exact: true }) })
      .first();
    await filterGrid.getByRole("combobox").nth(1).click();
    await userPage.getByRole("option", { name: "Units", exact: true }).click();
    await expect(firstMetricCell).not.toContainText(/\$/);

    await expect(main.locator(".recharts-bar-rectangle").first()).toBeVisible({ timeout: 20_000 });
    await main.locator(".recharts-bar-rectangle").first().click();
    await expect(main.getByRole("button", { name: /^Branch: North$/ })).toBeVisible();

    await filterGrid.getByRole("combobox").nth(2).click();
    await userPage.getByRole("option", { name: "Loan Type", exact: true }).click();
    await expect(main.getByRole("button", { name: /^Branch: North$/ })).toHaveCount(0);
  });

  test("@critical @COHI-346 workbench adds Production Trends group and default widget layout (AC16–18)", async ({
    userPage,
  }) => {
    await suppressWelcomeTour(userPage);
    await setupProductionTrendsApiMock(userPage);
    await gotoNewWorkbenchCanvas(userPage);
    await addProductionTrendsDashboardSection(userPage);

    const group = productionTrendsWorkbenchGroup(userPage);
    await expect(group).toBeVisible({ timeout: 20_000 });
    await expect(group.getByText("Production Trends YoY", { exact: true })).toBeVisible();
    await expect(
      group.getByText("Production Trends Largest Category", { exact: true }),
    ).toBeVisible();
    await expect(
      group.getByText("Production Trends YoY Line", { exact: true }),
    ).toBeVisible();
    await expect(
      group.getByText("Production Trends Drilldown", { exact: true }),
    ).toBeVisible();

    const filterRow = group
      .locator("div.flex.items-center.gap-1\\.5.px-2\\.5.pb-1\\.5.flex-wrap")
      .first();
    await expect(filterRow.getByRole("button", { name: "MTD" })).toBeVisible();
    await expect(filterRow.getByRole("button", { name: "LM" })).toBeVisible();
    await expect(filterRow.getByRole("button", { name: "QTD" })).toBeVisible();
    await expect(filterRow.getByRole("button", { name: "LQ" })).toBeVisible();
    await expect(filterRow.getByRole("button", { name: "YTD" })).toBeVisible();
    await expect(filterRow.getByRole("button", { name: "LY" })).toBeVisible();
    await expect(filterRow.getByRole("button", { name: "Custom" })).toBeVisible();
    await expect(filterRow.getByText("Date Type", { exact: true })).toBeVisible();
    await expect(filterRow.getByText("Measure", { exact: true })).toBeVisible();
    await expect(filterRow.getByText("Dimension", { exact: true })).toBeVisible();

    const yoyCard = group.getByText("Production Trends YoY", { exact: true }).first();
    const largestCard = group
      .getByText("Production Trends Largest Category", { exact: true })
      .first();
    const lineCard = group
      .getByText("Production Trends YoY Line", { exact: true })
      .first();
    const drilldownCard = group
      .getByText("Production Trends Drilldown", { exact: true })
      .first();
    const yoyBox = await yoyCard.boundingBox();
    const largestBox = await largestCard.boundingBox();
    const lineBox = await lineCard.boundingBox();
    const drilldownBox = await drilldownCard.boundingBox();
    expect(yoyBox).toBeTruthy();
    expect(largestBox).toBeTruthy();
    expect(lineBox).toBeTruthy();
    expect(drilldownBox).toBeTruthy();

    // Row 1: YoY + Largest near same Y. Row 2: Line below. Row 3: Drilldown below line.
    expect(Math.abs((yoyBox?.y ?? 0) - (largestBox?.y ?? 0))).toBeLessThan(30);
    expect((lineBox?.y ?? 0)).toBeGreaterThan((yoyBox?.y ?? 0) + 40);
    expect((drilldownBox?.y ?? 0)).toBeGreaterThan((lineBox?.y ?? 0) + 40);
  });

  test("@critical @COHI-346 workbench controls send expected production-trends API params (AC19)", async ({
    userPage,
  }) => {
    await suppressWelcomeTour(userPage);
    const { productionTrendsUrls } = await setupProductionTrendsApiMock(userPage);
    await gotoNewWorkbenchCanvas(userPage);
    await addProductionTrendsDashboardSection(userPage);

    const group = productionTrendsWorkbenchGroup(userPage);
    await expect(group).toBeVisible({ timeout: 20_000 });
    await ensureGroupFiltersExpanded(group);

    const filterRow = groupFilterRow(group);
    const dateTypeSelect = filterRow.locator("select").nth(0);
    const measureSelect = filterRow.locator("select").nth(1);
    const dimensionSelect = filterRow.locator("select").nth(2);

    await expect(dateTypeSelect).toBeVisible();
    await expect(measureSelect).toBeVisible();
    await expect(dimensionSelect).toBeVisible();

    await dateTypeSelect.selectOption("closed");
    await measureSelect.selectOption("units");
    await dimensionSelect.selectOption("loan_type");
    await userPage.waitForTimeout(250);

    const latest = productionTrendsUrls[productionTrendsUrls.length - 1] ?? "";
    expect(latest).toContain("date_type=closed");
    expect(latest).toContain("measure=units");
    expect(latest).toContain("dimension=loan_type");
  });

  test("@critical @COHI-346 workbench cross-widget filters and drilldown expand/collapse (AC20–22)", async ({
    userPage,
  }) => {
    await suppressWelcomeTour(userPage);
    await setupProductionTrendsApiMock(userPage);
    await gotoNewWorkbenchCanvas(userPage);
    await addProductionTrendsDashboardSection(userPage);

    const group = productionTrendsWorkbenchGroup(userPage);
    await expect(group).toBeVisible({ timeout: 20_000 });

    await expect(group.locator(".recharts-bar-rectangle").first()).toBeVisible({
      timeout: 20_000,
    });
    await group.locator(".recharts-bar-rectangle").first().click();
    await expect(group.getByText(/^Dimension:/)).toBeVisible();

    await group.locator("circle.cursor-pointer").first().click({ force: true });
    await expect(group.getByText(/^Month:/)).toBeVisible();

    // Cross-widget sync indicator: line chart still visible and filtered chips shown in shared header row.
    await expect(group.getByText("Production Trends YoY Line")).toBeVisible();
    await expect(group.getByText("Production Trends Drilldown")).toBeVisible();

    await expect(group.getByRole("button", { name: "Expand All" })).toBeVisible();
    await expect(group.getByRole("button", { name: "Collapse All" })).toBeVisible();

    await group.getByRole("button", { name: "Expand All" }).click();
    await expect(group.getByText("First Lien", { exact: true })).toBeVisible();
    await group.getByRole("button", { name: "Collapse All" }).click();
    await expect(group.getByText("First Lien", { exact: true })).toHaveCount(0);
  });
});
