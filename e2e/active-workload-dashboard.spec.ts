import { test, expect } from "./fixtures";
import type { Page, Route } from "@playwright/test";

type MockLoan = Record<string, unknown>;

function makeLoan(overrides: Record<string, unknown>): MockLoan {
  return {
    loan_id: String(overrides.loan_id ?? crypto.randomUUID()),
    loan_number: String(overrides.loan_number ?? "LN-0000"),
    channel: "Retail",
    current_milestone: "Processing",
    loan_folder: "Conventional",
    loan_type: "Conventional",
    loan_purpose: "Purchase",
    loan_program: "30 Year Fixed",
    application_date: "2026-04-01",
    loan_estimate_sent_date: "2026-04-02",
    conditional_approval_date: "2026-04-10",
    uw_final_approval_date: "2026-04-14",
    ctc_date: "2026-04-18",
    estimated_closing_date: "2026-04-24",
    closing_date: "2026-04-25",
    funding_date: "2026-04-26",
    current_loan_status: "ACTIVE LOAN",
    is_archived: false,
    investor_lock_date: "2026-04-04",
    lock_expiration_date: "2026-05-04",
    lien_position: "First",
    processor: "Proc One",
    underwriter: "UW One",
    closer: "Closer One",
    broker_lender_name: "Broker A",
    loan_officer: "LO One",
    account_executive: "AE One",
    account_manager: "AM One",
    branch: "Branch A",
    tpo_company_name: "TPO One",
    investor: "Investor A",
    retail_branch_id: "RB-1",
    retail_lo: "Retail LO 1",
    originator_loan_officer_name: "Originator LO 1",
    originator_loan_processor_name: "Originator Proc 1",
    correspondent_sales_rep_ae: "Corr AE 1",
    correspondent_lender_name: "Corr Lender 1",
    sales_rep_ae: "Sales AE 1",
    warehouse_co_name: "Warehouse Co 1",
    warehouse_bank_name: "Warehouse Bank 1",
    ...overrides,
  };
}

const MOCK_ACTIVE_LOANS: MockLoan[] = [
  makeLoan({
    loan_id: "aw-1",
    loan_number: "AW-1001",
    processor: "Proc One",
    loan_type: "Conventional",
    loan_purpose: "Purchase",
    current_milestone: "Processing",
    application_date: "2026-04-01",
  }),
  makeLoan({
    loan_id: "aw-2",
    loan_number: "AW-1002",
    processor: "Proc One",
    loan_type: "FHA",
    loan_purpose: "Refinance",
    current_milestone: "Conditional Approval",
    application_date: "2026-03-25",
  }),
  makeLoan({
    loan_id: "aw-3",
    loan_number: "AW-1003",
    processor: "Proc Two",
    loan_type: "VA",
    loan_purpose: "Purchase",
    current_milestone: "Submitted to Underwriting",
    application_date: "2026-03-20",
  }),
  // Should be excluded by canonical formula if ever returned.
  makeLoan({
    loan_id: "aw-4",
    loan_number: "AW-1004",
    current_loan_status: "CLOSED LOAN",
    current_milestone: "Funding",
    application_date: "2026-02-15",
  }),
];

async function suppressWelcomeTour(page: Page) {
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem("cohi-welcome-tour-last-shown", new Date().toISOString());
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
    await page.waitForTimeout(300);
  }
}

async function setupActiveWorkloadMocks(
  page: Page,
  options: { delayedFirstResponseMs?: number; forceActiveDetailError?: boolean } = {},
): Promise<{
  activeDetailUrls: string[];
  detailListUrls: string[];
}> {
  const activeDetailUrls: string[] = [];
  const detailListUrls: string[] = [];
  let activeDetailCallCount = 0;

  await page.route(/\/api\/loans\/active-detail-list(\?|$)/, async (route: Route) => {
    activeDetailCallCount += 1;
    const url = new URL(route.request().url());
    activeDetailUrls.push(route.request().url());
    if (options.delayedFirstResponseMs && activeDetailCallCount === 1) {
      await page.waitForTimeout(options.delayedFirstResponseMs);
    }
    if (options.forceActiveDetailError) {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "Mock active-detail-list failure" }),
      });
      return;
    }

    const offset = Number(url.searchParams.get("offset") ?? "0");
    const limit = Number(url.searchParams.get("limit") ?? "5000");
    const pageRows = MOCK_ACTIVE_LOANS.slice(offset, offset + limit);

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        loans: pageRows,
        total: MOCK_ACTIVE_LOANS.length,
        limit,
        offset,
        page: Math.floor(offset / Math.max(limit, 1)) + 1,
        totalPages: 1,
      }),
    });
  });

  await page.route(/\/api\/loans\/detail-list(\?|$)/, async (route: Route) => {
    detailListUrls.push(route.request().url());
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        loans: MOCK_ACTIVE_LOANS,
        total: MOCK_ACTIVE_LOANS.length,
        limit: MOCK_ACTIVE_LOANS.length,
        offset: 0,
        page: 1,
        totalPages: 1,
      }),
    });
  });

  return { activeDetailUrls, detailListUrls };
}

function activeWorkloadWorkbenchGroup(page: Page) {
  return page
    .locator("div.group\\/widgetgroup")
    .filter({
      has: page.getByText("Active Workload KPI: Active Files", { exact: true }),
    })
    .first();
}

async function chooseSelectOption(
  page: Page,
  sectionLabel: "Calculation Selector" | "Date Range Calculation Type",
  triggerTextPattern: RegExp,
  optionName: string,
) {
  const section = page
    .locator("div")
    .filter({ has: page.getByText(sectionLabel, { exact: true }) })
    .first();
  await expect(section).toBeVisible({ timeout: 15_000 });

  const trigger = section.locator("button").filter({ hasText: triggerTextPattern }).first();
  await expect(trigger).toBeVisible({ timeout: 15_000 });
  await trigger.click({ force: true });

  const option = page.getByRole("option", { name: optionName, exact: true }).first();
  await expect(option).toBeVisible({ timeout: 10_000 });
  await option.click({ force: true });
}

test.describe("Active Workload Dashboard (COHI-347)", () => {
  test.describe.configure({ mode: "serial", timeout: 120_000 });

  test("@critical @COHI-347 standalone route renders selectors, KPIs, chart, and detail table", async ({
    userPage,
  }) => {
    await suppressWelcomeTour(userPage);
    const { activeDetailUrls } = await setupActiveWorkloadMocks(userPage);

    await userPage.goto("/performance/active-workload", { waitUntil: "domcontentloaded" });
    await userPage.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
    await dismissBlockingOverlays(userPage);

    // Use stable selectors
    await expect(userPage).toHaveURL(/\/performance\/active-workload/);
    await expect(userPage.locator("h1")).toContainText("Active Workload");
    await expect(userPage.getByText("Actor Selector", { exact: true })).toBeVisible();
    await expect(userPage.getByText("Calculation Selector", { exact: true })).toBeVisible();
    await expect(userPage.getByText("Date Range Calculation Type", { exact: true })).toBeVisible();

    await expect(userPage.getByRole("heading", { name: "Active Files", exact: true })).toBeVisible();
    await expect(userPage.getByRole("heading", { name: "Average Days Active", exact: true })).toBeVisible();
    await expect(userPage.getByText("Active Loans by Current Milestone", { exact: true })).toBeVisible();
    await expect(userPage.getByText("Active Loans Detail", { exact: true })).toBeVisible();
    await expect(userPage.getByRole("button", { name: "Expand All" })).toBeVisible();
    await expect(userPage.getByRole("button", { name: "Collapse All" })).toBeVisible();
    await expect(userPage.getByRole("button", { name: "Show Filters" })).toBeVisible();
    const detailTable = userPage.locator("table").last();
    await expect(detailTable).toBeVisible();
    await expect(detailTable.getByRole("cell", { name: "AW-1001", exact: true })).toBeVisible();

    await expect.poll(() => activeDetailUrls.length).toBeGreaterThan(0);
  });

  test("@critical @COHI-347 standalone selectors update KPI labels and canonical active-files count", async ({
    userPage,
  }) => {
    await suppressWelcomeTour(userPage);
    await setupActiveWorkloadMocks(userPage);

    await userPage.goto("/performance/active-workload", { waitUntil: "domcontentloaded" });
    await userPage.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
    await dismissBlockingOverlays(userPage);

    const activeFilesCard = userPage
      .locator("div")
      .filter({ has: userPage.getByRole("heading", { name: "Active Files", exact: true }) })
      .first();
    await expect(activeFilesCard).toContainText("3");

    await chooseSelectOption(userPage, "Calculation Selector", /Average|Median/i, "Median");
    await expect(userPage.getByRole("heading", { name: "Median Days Active", exact: true })).toBeVisible();

    await chooseSelectOption(
      userPage,
      "Date Range Calculation Type",
      /Calendar Days|Business Days/i,
      "Business Days",
    );
    await expect(userPage.getByRole("heading", { name: "Median Days Active", exact: true })).toBeVisible();
  });

  test("@critical @COHI-347 standalone filtering works from chart, drilldown, and detail table with editable pills", async ({
    userPage,
  }) => {
    await suppressWelcomeTour(userPage);
    await setupActiveWorkloadMocks(userPage);

    await userPage.goto("/performance/active-workload", { waitUntil: "domcontentloaded" });
    await userPage.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
    await dismissBlockingOverlays(userPage);

    // Milestone chart bar click -> milestone pill (more reliable than SVG tick text click)
    const milestoneCard = userPage
      .locator("div")
      .filter({ has: userPage.getByText("Active Loans by Current Milestone", { exact: true }) })
      .first();
    await expect(milestoneCard.locator(".recharts-bar-rectangle").first()).toBeVisible({
      timeout: 20_000,
    });
    await milestoneCard.locator(".recharts-bar-rectangle").first().click();
    await expect(userPage.getByText("Active filters", { exact: true })).toBeVisible();
    await expect(userPage.getByRole("button", { name: /^Milestone:\s/i })).toBeVisible();

    // Drilldown row click -> actor/drilldown pill
    await userPage.getByText("Proc One", { exact: true }).first().click();
    await expect(userPage.getByRole("button", { name: /^Processor:\s/i })).toBeVisible();

    // Detail-cell click -> linked pill
    await userPage.getByRole("cell", { name: "Processing", exact: true }).first().click();
    await expect(userPage.getByRole("button", { name: /^Milestone:\s/i })).toBeVisible();

    // Pill popover supports expected controls
    await userPage.getByRole("button", { name: /^Milestone:\s/i }).first().click();
    const popover = userPage
      .locator("[data-radix-popper-content-wrapper]")
      .filter({ has: userPage.getByRole("button", { name: "Apply Filters" }) })
      .last();
    await expect(popover.getByRole("button", { name: "Cancel" })).toBeVisible();
    await expect(popover.getByRole("button", { name: "Apply Filters" })).toBeVisible();
    await expect(popover.getByRole("button", { name: "Clear Selection" })).toBeVisible();
  });

  test("@critical @COHI-347 standalone selection persists after reload", async ({ userPage }) => {
    await suppressWelcomeTour(userPage);
    await setupActiveWorkloadMocks(userPage);

    await userPage.goto("/performance/active-workload", { waitUntil: "domcontentloaded" });
    await userPage.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
    await dismissBlockingOverlays(userPage);

    const milestoneCard = userPage
      .locator("div")
      .filter({ has: userPage.getByText("Active Loans by Current Milestone", { exact: true }) })
      .first();
    await expect(milestoneCard.locator(".recharts-bar-rectangle").first()).toBeVisible({
      timeout: 20_000,
    });
    await milestoneCard.locator(".recharts-bar-rectangle").first().click();
    await expect(userPage.getByRole("button", { name: /^Milestone:\s/i })).toBeVisible();

    await userPage.reload({ waitUntil: "domcontentloaded" });
    await userPage.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
    await expect(userPage.getByRole("button", { name: /^Milestone:\s/i })).toBeVisible();
  });

  test("@critical @COHI-347 standalone detail table filter toggle and column filter popover controls render", async ({
    userPage,
  }) => {
    await suppressWelcomeTour(userPage);
    await setupActiveWorkloadMocks(userPage);

    await userPage.goto("/performance/active-workload", { waitUntil: "domcontentloaded" });
    await userPage.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
    await dismissBlockingOverlays(userPage);

    await userPage.getByRole("button", { name: "Show Filters", exact: true }).click();
    await expect(userPage.getByRole("button", { name: "Hide Filters", exact: true })).toBeVisible();

    const detailTable = userPage.locator("table").last();
    const currentMilestoneHeader = detailTable.getByRole("columnheader", { name: /Current Milestone/i }).first();
    await expect(currentMilestoneHeader).toBeVisible();
    await currentMilestoneHeader.getByRole("button").nth(1).click();

    const popover = userPage
      .locator("[data-radix-popper-content-wrapper]")
      .filter({ has: userPage.getByRole("button", { name: "Apply Filters" }) })
      .last();
    await expect(popover.getByRole("button", { name: "Cancel" })).toBeVisible();
    await expect(popover.getByRole("button", { name: "Apply Filters" })).toBeVisible();
    await expect(popover.getByRole("button", { name: "Clear Selection" })).toBeVisible();
  });

  test("@critical @COHI-347 standalone loading and API error states render safely", async ({ userPage }) => {
    await suppressWelcomeTour(userPage);
    await setupActiveWorkloadMocks(userPage, { delayedFirstResponseMs: 1200 });

    await userPage.goto("/performance/active-workload", { waitUntil: "domcontentloaded" });
    await expect(userPage.getByText("Loading active workload data...", { exact: true })).toBeVisible();
    await userPage.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
    await dismissBlockingOverlays(userPage);
    await expect(userPage.getByRole("heading", { name: "Active Files", exact: true })).toBeVisible();

    await setupActiveWorkloadMocks(userPage, { forceActiveDetailError: true });
    await userPage.reload({ waitUntil: "domcontentloaded" });
    await userPage.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
    await expect(
      userPage.getByText(/mock active-detail-list failure|failed to load active workload data/i),
    ).toBeVisible();
  });

  test("@critical @COHI-347 workbench adds Active Workload widget group with expected widgets and filters", async ({
    userPage,
  }) => {
    await suppressWelcomeTour(userPage);
    await setupActiveWorkloadMocks(userPage);

    await userPage.goto("/my-dashboard/new", { waitUntil: "domcontentloaded" });
    await userPage.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
    await dismissBlockingOverlays(userPage);

    await userPage.getByRole("button", { name: /^Add$/ }).first().click();
    await userPage.getByRole("button", { name: "Trends & Analysis", exact: true }).click();
    await userPage.getByRole("menuitem", { name: "Active Workload", exact: true }).click();

    const group = activeWorkloadWorkbenchGroup(userPage);
    await expect(group).toBeVisible({ timeout: 20_000 });
    await expect(group.getByText("Active Workload KPI: Active Files", { exact: true })).toBeVisible();
    await expect(group.getByText("Active Workload KPI: Days Active", { exact: true })).toBeVisible();
    await expect(group.getByText("Active Workload Drilldown", { exact: true })).toBeVisible();
    await expect(group.getByText("Active Workload Milestone Chart", { exact: true })).toBeVisible();
    await expect(group.getByText("Active Workload Detail Table", { exact: true })).toBeVisible();

    const filterRow = group.locator("div.flex.items-center.gap-1\\.5.px-2\\.5.pb-1\\.5.flex-wrap").first();
    await expect(filterRow.getByText(/ACTOR SELECTOR/i)).toBeVisible();
    await expect(filterRow.getByText(/CALCULATION SELECTOR/i)).toBeVisible();
    await expect(filterRow.locator("select")).toHaveCount(3);
  });

  test("@critical @COHI-347 workbench shared pills open full popover editor and use active-detail-list options", async ({
    userPage,
  }) => {
    await suppressWelcomeTour(userPage);
    const { activeDetailUrls } = await setupActiveWorkloadMocks(userPage);

    await userPage.goto("/my-dashboard/new", { waitUntil: "domcontentloaded" });
    await userPage.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
    await dismissBlockingOverlays(userPage);

    await userPage.getByRole("button", { name: /^Add$/ }).first().click();
    await userPage.getByRole("button", { name: "Trends & Analysis", exact: true }).click();
    await userPage.getByRole("menuitem", { name: "Active Workload", exact: true }).click();

    const group = activeWorkloadWorkbenchGroup(userPage);
    await expect(group).toBeVisible({ timeout: 20_000 });

    // Create a milestone filter via chart bar click.
    await expect(group.locator(".recharts-bar-rectangle").first()).toBeVisible({
      timeout: 20_000,
    });
    await group.locator(".recharts-bar-rectangle").first().click();
    const milestonePill = group.getByRole("button", { name: /^Milestone:\s/i }).first();
    await expect(milestonePill).toBeVisible({ timeout: 15_000 });

    // Open pill editor and validate production-trends style controls.
    await milestonePill.click();
    const popover = userPage
      .locator("[data-radix-popper-content-wrapper]")
      .filter({ has: userPage.getByRole("button", { name: "Apply Filters" }) })
      .last();
    await expect(popover.getByRole("button", { name: "Cancel" })).toBeVisible();
    await expect(popover.getByRole("button", { name: "Apply Filters" })).toBeVisible();
    await expect(popover.getByRole("button", { name: "Clear Selection" })).toBeVisible();

    await expect.poll(() => activeDetailUrls.length).toBeGreaterThan(0);
  });
});

