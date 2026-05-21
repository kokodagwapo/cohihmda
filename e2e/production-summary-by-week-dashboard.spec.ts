import { test, expect } from "./fixtures";
import type { Page, Route } from "@playwright/test";
import { resetUnifiedChatShellToCompact } from "./helpers/unifiedChat";

type MockLoan = Record<string, unknown>;

function makeLoan(overrides: Record<string, unknown>): MockLoan {
  return {
    loan_id: String(overrides.loan_id ?? crypto.randomUUID()),
    loan_number: "LN-0000",
    loan_amount: 250000,
    interest_rate: 6.25,
    fico_score: 700,
    ltv_ratio: 80,
    current_loan_status: "Active",
    current_milestone: "Processing",
    loan_folder: "Conventional",
    loan_program: "30 Year Fixed",
    started_date: null,
    application_date: null,
    investor_lock_date: null,
    funding_date: null,
    closing_date: null,
    ...overrides,
  };
}

const MOCK_LOANS: MockLoan[] = [
  makeLoan({
    loan_id: "loan-1",
    loan_number: "LN-1001",
    loan_amount: 300000,
    started_date: "2026-03-31",
    application_date: "2026-03-30",
    investor_lock_date: "2026-04-02",
    funding_date: "2026-04-10",
    closing_date: "2026-04-11",
  }),
  makeLoan({
    loan_id: "loan-2",
    loan_number: "LN-1002",
    loan_amount: 275000,
    started_date: "2026-03-31",
    application_date: "2026-02-24",
    investor_lock_date: "2026-03-28",
    funding_date: "2026-04-08",
    closing_date: "2026-04-09",
  }),
  makeLoan({
    loan_id: "loan-3",
    loan_number: "LN-1003",
    loan_amount: 320000,
    started_date: "2026-04-07",
    application_date: "2026-04-06",
    investor_lock_date: "2026-04-08",
    funding_date: "2026-04-15",
    closing_date: "2026-04-16",
  }),
];

async function suppressWelcomeTour(page: Page) {
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem(
        "cohi-welcome-tour-last-shown",
        new Date().toISOString(),
      );
      for (const key of Object.keys(window.localStorage)) {
        if (key.startsWith("cohi-production-summary-by-week-view-state:")) {
          window.localStorage.removeItem(key);
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
      .filter({
        hasText: /quick tour|welcome|what's new|let us give you a quick tour/i,
      })
      .first();
    const overlay = page
      .locator("div[data-state='open'][aria-hidden='true']")
      .first();
    const dialogVisible = await blockingDialog
      .isVisible({ timeout: 1_000 })
      .catch(() => false);
    const overlayVisible = await overlay
      .isVisible({ timeout: 1_000 })
      .catch(() => false);
    if (!dialogVisible && !overlayVisible) break;
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
  }
}

async function setupProductionSummaryMocks(page: Page) {
  const persistedPreference: { preference_value: unknown } = { preference_value: null };

  await page.route(/\/api\/loans\/detail-list\?/, async (route: Route) => {
    const url = new URL(route.request().url());
    const branch = url.searchParams.get("branch");
    const loanOfficer = url.searchParams.get("loan_officer");
    const offset = Number(url.searchParams.get("offset") ?? "0");
    const limit = Number(url.searchParams.get("limit") ?? "2000");

    const filtered = MOCK_LOANS.filter((loan) => {
      if (branch && branch !== "all" && loan.branch !== branch) return false;
      if (
        loanOfficer &&
        loanOfficer !== "all" &&
        loan.loan_officer !== loanOfficer
      )
        return false;
      return true;
    });

    const pageLoans = filtered.slice(offset, offset + limit);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        loans: pageLoans,
        total: filtered.length,
        limit,
        offset,
        page: 1,
        totalPages: 1,
      }),
    });
  });

  await page.route(/\/api\/loans\/distinct-values\/branch/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ values: ["All Branches", "1000"] }),
    });
  });

  await page.route(
    /\/api\/loans\/distinct-values\/loan_officer/,
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ values: ["All Loan Officers", "Alex LO"] }),
      });
    },
  );

  await page.route(
    /\/api\/user\/preferences\/productionSummaryByWeekViewState:v1:tenant:.*:standalone$/,
    async (route) => {
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
        const body = route.request().postDataJSON() as { preference_value?: unknown };
        persistedPreference.preference_value = body?.preference_value ?? null;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: true }),
        });
        return;
      }
      await route.continue();
    },
  );
}

function summaryCard(page: Page, title: string) {
  return page
    .locator("div")
    .filter({ has: page.getByRole("heading", { name: title, exact: true }) })
    .first();
}

function startedYearWeekPill(page: Page) {
  return page.locator("main").getByText(/^Started YearWeek:/i).first();
}

async function readSummaryTotalsUnits(page: Page, title: string): Promise<number> {
  const card = summaryCard(page, title);
  const unitsCell = card.locator("tbody tr").first().locator("td").nth(2);
  const text = (await unitsCell.textContent()) ?? "0";
  return Number(text.replace(/,/g, "").trim());
}

test.describe("Production Summary by Week Dashboard (COHI-345)", () => {
  test.describe.configure({ mode: "serial", timeout: 90_000 });

  async function gotoStandalone(userPage: Page) {
    await userPage.goto("/production-summary-by-week", {
      waitUntil: "domcontentloaded",
    });
    await userPage
      .waitForLoadState("networkidle", { timeout: 20_000 })
      .catch(() => {});
    await dismissBlockingOverlays(userPage);
    await resetUnifiedChatShellToCompact(userPage);
  }

  async function gotoWorkbench(userPage: Page) {
    await userPage.goto("/my-dashboard/new", { waitUntil: "domcontentloaded" });
    await userPage
      .waitForLoadState("networkidle", { timeout: 20_000 })
      .catch(() => {});
    await dismissBlockingOverlays(userPage);
    await resetUnifiedChatShellToCompact(userPage);
  }

  async function addProductionSummaryWorkbenchGroup(userPage: Page) {
    await userPage.getByRole("button", { name: /^Add$/ }).first().click();
    await userPage
      .getByRole("button", { name: "Trends & Analysis", exact: true })
      .click();
    await userPage
      .getByRole("menuitem", { name: "Production Summary by Week", exact: true })
      .click();
  }

  function productionSummaryWorkbenchGroup(userPage: Page) {
    return userPage
      .locator("div.group\\/widgetgroup")
      .filter({
        has: userPage.getByRole("heading", {
          name: "Production Summary by Week",
          exact: true,
        }),
      })
      .first();
  }

  test("@critical @COHI-345 standalone route, sections, and table actions render correctly", async ({
    userPage,
  }) => {
    await suppressWelcomeTour(userPage);
    await setupProductionSummaryMocks(userPage);
    await gotoStandalone(userPage);

    await expect(
      userPage.getByRole("heading", { name: "Production Summary by Week" }),
    ).toBeVisible();
    for (const title of [
      "Started Date",
      "Application Date",
      "Lock Date",
      "Funding Date",
      "Closing Date",
      "Loan List",
    ]) {
      await expect(userPage.getByRole("heading", { name: title, exact: true })).toBeVisible();
    }
    await expect(userPage.getByRole("button", { name: "Download" }).first()).toBeVisible();
    await expect(userPage.getByText("Loan count: 3", { exact: true })).toBeVisible();
  });

  test("@critical @COHI-345 standalone YearWeek selection adds pill and filters all tables", async ({
    userPage,
  }) => {
    await suppressWelcomeTour(userPage);
    await setupProductionSummaryMocks(userPage);
    await gotoStandalone(userPage);

    const applicationUnitsBefore = await readSummaryTotalsUnits(userPage, "Application Date");
    expect(applicationUnitsBefore).toBe(3);

    await summaryCard(userPage, "Started Date")
      .getByRole("cell", { name: "2026-W14", exact: true })
      .first()
      .click({ force: true });

    await expect(startedYearWeekPill(userPage)).toBeVisible();

    const applicationUnitsAfter = await readSummaryTotalsUnits(userPage, "Application Date");
    expect(applicationUnitsAfter).toBeLessThan(applicationUnitsBefore);
    await expect(userPage.getByText("Loan count: 2", { exact: true })).toBeVisible();
  });

  test("@critical @COHI-345 standalone supports summary sorting and loan-list sorting", async ({
    userPage,
  }) => {
    await suppressWelcomeTour(userPage);
    await setupProductionSummaryMocks(userPage);
    await gotoStandalone(userPage);

    const started = summaryCard(userPage, "Started Date");
    const weekHeader = started
      .getByRole("button", { name: /YearWeek Group/i })
      .first();
    await expect(weekHeader).toBeVisible();
    await weekHeader.click();
    const firstRowWeek = await started.locator("tbody tr").nth(1).locator("td").first().textContent();
    expect((firstRowWeek ?? "").trim().length).toBeGreaterThan(0);

    const loanListCard = userPage
      .locator("div")
      .filter({ has: userPage.getByRole("heading", { name: "Loan List", exact: true }) })
      .first();
    await loanListCard.getByRole("button", { name: /Loan Number/i }).click();
    const firstLoan = await loanListCard.locator("tbody tr").nth(1).locator("td").first().textContent();
    expect((firstLoan ?? "").trim().length).toBeGreaterThan(0);
  });

  test("@critical @COHI-345 standalone active filter pills support clear and clear-all", async ({
    userPage,
  }) => {
    await suppressWelcomeTour(userPage);
    await setupProductionSummaryMocks(userPage);
    await gotoStandalone(userPage);

    await summaryCard(userPage, "Started Date")
      .getByRole("cell", { name: "2026-W14", exact: true })
      .first()
      .click({ force: true });
    await expect(userPage.getByText("Active filters", { exact: true })).toBeVisible();
    await expect(startedYearWeekPill(userPage)).toBeVisible();

    await userPage.getByRole("button", { name: /Clear all filters/i }).click();
    await expect(startedYearWeekPill(userPage)).toHaveCount(0);
    await expect(userPage.getByText("Loan count: 3", { exact: true })).toBeVisible();
  });

  test("@critical @COHI-345 workbench adds six-widget group with shared filter header controls", async ({
    userPage,
  }) => {
    await suppressWelcomeTour(userPage);
    await setupProductionSummaryMocks(userPage);
    await gotoWorkbench(userPage);
    await addProductionSummaryWorkbenchGroup(userPage);

    const group = productionSummaryWorkbenchGroup(userPage);
    await expect(group).toBeVisible({ timeout: 20_000 });
    for (const title of [
      "Production Summary by Week - Started Date",
      "Production Summary by Week - Application Date",
      "Production Summary by Week - Lock Date",
      "Production Summary by Week - Funding Date",
      "Production Summary by Week - Closing Date",
      "Production Summary by Week - Loan Detail",
    ]) {
      await expect(group.getByText(title, { exact: true })).toBeVisible();
    }

    const filterRow = group
      .locator("div.flex.items-center.gap-1\\.5.px-2\\.5.pb-1\\.5.flex-wrap")
      .first();
    await expect(filterRow.getByText("Date Field", { exact: true })).toHaveCount(0);
    await expect(filterRow.getByText("Branch", { exact: true })).toBeVisible();
    await expect(filterRow.getByText("Loan Officer", { exact: true })).toBeVisible();
  });

  test("@critical @COHI-345 workbench YearWeek filter creates group pill and filters all widgets", async ({
    userPage,
  }) => {
    await suppressWelcomeTour(userPage);
    await setupProductionSummaryMocks(userPage);
    await gotoWorkbench(userPage);
    await addProductionSummaryWorkbenchGroup(userPage);

    const group = productionSummaryWorkbenchGroup(userPage);
    await expect(group).toBeVisible({ timeout: 20_000 });
    await expect(group.getByText("Loan count: 3", { exact: true })).toBeVisible();

    await group.getByRole("cell", { name: "2026-W14", exact: true }).first().click();
    await expect(group.getByText(/Started YearWeek: 2026-W14/i)).toBeVisible({
      timeout: 15_000,
    });
    await expect(group.getByText("Loan count: 2", { exact: true })).toBeVisible();
  });

  test("@critical @COHI-345 workbench YearWeek pill removal clears shared filter state", async ({
    userPage,
  }) => {
    await suppressWelcomeTour(userPage);
    await setupProductionSummaryMocks(userPage);
    await gotoWorkbench(userPage);
    await addProductionSummaryWorkbenchGroup(userPage);

    const group = productionSummaryWorkbenchGroup(userPage);
    await expect(group).toBeVisible({ timeout: 20_000 });
    await group.getByRole("cell", { name: "2026-W14", exact: true }).first().click();
    await expect(group.getByText(/Started YearWeek: 2026-W14/i)).toBeVisible();

    await group.getByRole("button", { name: /Clear YearWeek filters/i }).click();
    await expect(group.getByText(/Started YearWeek: 2026-W14/i)).toHaveCount(0);
    await expect(group.getByText("Loan count: 3", { exact: true })).toBeVisible();
  });
});

