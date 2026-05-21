import { test, expect } from "./fixtures";
import type { Page, Route } from "@playwright/test";
import { resetUnifiedChatShellToCompact } from "./helpers/unifiedChat";

type OverviewPayload = {
  activeLoans: { count: number; volume: number; avgInterestRate: number };
  submittedMTD: { count: number; volume: number; avgInterestRate: number };
  fundedMTD: { count: number; volume: number; avgInterestRate: number };
  aging: Record<"0-15" | "16-30" | "31-45" | "46-60" | "61-90" | ">90", number>;
  submittedByType: Record<string, number>;
  fundedByType: Record<string, number>;
  window: { startDate: string; endDate: string };
  definitions: { submittedDateField: "submitted_to_processing_date" | "submitted_to_underwriting_date" };
};

type MockOptions = {
  delayedFirstOverviewResponseMs?: number;
  forceOverviewError?: boolean;
  emptyLoanTypeBreakdowns?: boolean;
};

const BASE_OVERVIEW_PAYLOAD: OverviewPayload = {
  activeLoans: { count: 125, volume: 48500000, avgInterestRate: 6.221 },
  submittedMTD: { count: 62, volume: 19800000, avgInterestRate: 6.145 },
  fundedMTD: { count: 44, volume: 15100000, avgInterestRate: 6.088 },
  aging: { "0-15": 30, "16-30": 24, "31-45": 22, "46-60": 21, "61-90": 18, ">90": 10 },
  submittedByType: { Conventional: 25, FHA: 20, VA: 17 },
  fundedByType: { Conventional: 18, FHA: 15, VA: 11 },
  window: { startDate: "2026-04-01", endDate: "2026-04-30" },
  definitions: { submittedDateField: "submitted_to_underwriting_date" },
};

const VIEW_STATE_KEY = "salesCompanyOverviewViewState:v2:tenant:tenant-e2e-344:standalone";

async function suppressWelcomeTour(page: Page) {
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem("cohi-welcome-tour-last-shown", new Date().toISOString());
    } catch {
      /* local storage unavailable */
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
  await resetUnifiedChatShellToCompact(page);
}

function cloneBaseOverviewPayload(): OverviewPayload {
  return JSON.parse(JSON.stringify(BASE_OVERVIEW_PAYLOAD)) as OverviewPayload;
}

async function setupSalesCompanyOverviewMocks(
  page: Page,
  options: MockOptions = {},
): Promise<{
  overviewRequestUrls: string[];
  preferencePuts: Array<{ loanTypes: string[]; agingBuckets: string[] }>;
}> {
  const overviewRequestUrls: string[] = [];
  const preferencePuts: Array<{ loanTypes: string[]; agingBuckets: string[] }> = [];
  let persistedPreference: { version: number; loanTypes: string[]; agingBuckets: string[] } | null = null;
  let overviewCallCount = 0;

  await page.route(/\/api\/auth\/me$/, async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        user: {
          id: "user-e2e-344",
          email: "qa.user@example.com",
          full_name: "QA User",
          role: "tenant_admin",
          is_super_admin: false,
          tenant_id: "tenant-e2e-344",
          tenant_slug: "tenant-e2e-344",
        },
      }),
    });
  });

  // Shield tests from unrelated /api/los/connections regressions (e.g. missing
  // sync_allowed_weekdays column returning 500). The dashboard shell polls this
  // for the "Data Last Synced" indicator; flaky 500s can saturate networkidle.
  await page.route(/\/api\/los\/(connections|types)(\?|$)/, async (route: Route) => {
    const url = route.request().url();
    const body = url.includes("/api/los/types")
      ? { types: {} }
      : { connections: [] };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });

  await page.route(/\/api\/loans\/sales-company-overview(\?|$)/, async (route: Route) => {
    overviewCallCount += 1;
    const reqUrl = route.request().url();
    overviewRequestUrls.push(reqUrl);

    if (options.delayedFirstOverviewResponseMs && overviewCallCount === 1) {
      await page.waitForTimeout(options.delayedFirstOverviewResponseMs);
    }

    if (options.forceOverviewError) {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "overview unavailable" }),
      });
      return;
    }

    const payload = cloneBaseOverviewPayload();
    const url = new URL(reqUrl);
    const hasAgingFilter = url.searchParams.getAll("aging_bucket").length > 0;
    const hasChannelFilter = url.searchParams.get("channel_group");

    if (options.emptyLoanTypeBreakdowns) {
      payload.submittedByType = {};
      payload.fundedByType = {};
    }

    if (hasAgingFilter) {
      payload.activeLoans.count = 30;
      payload.activeLoans.volume = 9200000;
      payload.submittedMTD.count = 14;
      payload.fundedMTD.count = 10;
    }

    if (hasChannelFilter && hasChannelFilter !== "All") {
      payload.activeLoans.count = 56;
      payload.submittedMTD.count = 25;
      payload.fundedMTD.count = 17;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(payload),
    });
  });

  await page.route(new RegExp(`/api/user/preferences/${VIEW_STATE_KEY}$`), async (route: Route) => {
    const method = route.request().method();
    if (method === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ preference_value: persistedPreference }),
      });
      return;
    }

    if (method === "PUT") {
      const body = route.request().postDataJSON() as {
        preference_value?: { version?: number; loanTypes?: string[]; agingBuckets?: string[] };
      };
      const value = body?.preference_value ?? {};
      persistedPreference = {
        version: Number(value.version ?? 2),
        loanTypes: Array.isArray(value.loanTypes) ? value.loanTypes : [],
        agingBuckets: Array.isArray(value.agingBuckets) ? value.agingBuckets : [],
      };
      preferencePuts.push({
        loanTypes: persistedPreference.loanTypes,
        agingBuckets: persistedPreference.agingBuckets,
      });
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true }),
      });
      return;
    }

    await route.continue();
  });

  return { overviewRequestUrls, preferencePuts };
}

async function setupWorkbenchSalesCompanyOverviewMocks(page: Page): Promise<{
  overviewRequestUrls: string[];
}> {
  const overviewRequestUrls: string[] = [];
  // Workbench widgets read the same server preferences as the standalone page.
  // Stub GET to return null so widgets always start from defaults, mirroring
  // what setupSalesCompanyOverviewMocks does for standalone tests.
  let persistedWorkbenchPreference: unknown = null;
  await page.route(new RegExp(`/api/user/preferences/${VIEW_STATE_KEY}$`), async (route: Route) => {
    const method = route.request().method();
    if (method === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ preference_value: persistedWorkbenchPreference }),
      });
      return;
    }
    if (method === "PUT") {
      const body = route.request().postDataJSON() as { preference_value?: unknown };
      persistedWorkbenchPreference = body?.preference_value ?? null;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true }),
      });
      return;
    }
    await route.continue();
  });

  // Match standalone SCO mocks: avoid real /api/auth/me flaking under parallel workers
  // (timeouts/401s clear local auth and strand the test on /login).
  await page.route(/\/api\/auth\/me$/, async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        user: {
          id: "user-e2e-344",
          email: "qa.user@example.com",
          full_name: "QA User",
          role: "tenant_admin",
          is_super_admin: false,
          tenant_id: "tenant-e2e-344",
          tenant_slug: "tenant-e2e-344",
        },
      }),
    });
  });

  // Shield from unrelated LOS backend regressions (see note above).
  await page.route(/\/api\/los\/(connections|types)(\?|$)/, async (route: Route) => {
    const url = route.request().url();
    const body = url.includes("/api/los/types")
      ? { types: {} }
      : { connections: [] };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });

  // MyDashboard waits on GET /api/workbench/canvases before leaving "Loading workbench...".
  // Without a fast stub, CI can sit in hydration until timeout and never mount the Add menu.
  await page.route(/\/api\/workbench\/canvases(\?|$)/, async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ canvases: [] }),
    });
  });

  await page.route(/\/api\/loans\/sales-company-overview(\?|$)/, async (route: Route) => {
    const reqUrl = route.request().url();
    overviewRequestUrls.push(reqUrl);
    const url = new URL(reqUrl);

    const hasLoanTypeFha = url.searchParams.getAll("loan_type").includes("FHA");
    const hasAging0to15 = url.searchParams.getAll("aging_bucket").includes("0-15");

    const payload = cloneBaseOverviewPayload();

    if (hasLoanTypeFha) {
      payload.activeLoans = { count: 40, volume: 12400000, avgInterestRate: 6.032 };
      payload.submittedMTD = { count: 20, volume: 6200000, avgInterestRate: 6.001 };
      payload.fundedMTD = { count: 15, volume: 4800000, avgInterestRate: 5.988 };
      payload.aging = { "0-15": 12, "16-30": 9, "31-45": 8, "46-60": 6, "61-90": 4, ">90": 1 };
      payload.submittedByType = { FHA: 20 };
      payload.fundedByType = { FHA: 15 };
    }

    if (hasAging0to15) {
      payload.activeLoans = { count: 30, volume: 9200000, avgInterestRate: 6.077 };
      payload.submittedMTD = { count: 14, volume: 4600000, avgInterestRate: 6.041 };
      payload.fundedMTD = { count: 10, volume: 3400000, avgInterestRate: 5.997 };
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(payload),
    });
  });

  return { overviewRequestUrls };
}

test.describe("Sales Company Overview (COHI-344)", () => {
  test("@critical @COHI-344 route renders page shell and company overview KPI section", async ({ userPage }) => {
    await suppressWelcomeTour(userPage);
    await setupSalesCompanyOverviewMocks(userPage);

    await userPage.goto("/sales-company-overview", { waitUntil: "domcontentloaded" });
    await userPage.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
    await dismissBlockingOverlays(userPage);

    // Use stable selectors (layout + data can trail `domcontentloaded` in CI)
    await expect(userPage).toHaveURL(/\/sales-company-overview/);
    await expect(userPage.getByRole("heading", { name: "Sales Company Overview" })).toBeVisible({
      timeout: 45_000,
    });
    await expect(userPage.getByRole("heading", { name: "Company Overview", exact: true })).toBeVisible({
      timeout: 45_000,
    });
    await expect(userPage.getByText("Active Loans", { exact: true })).toBeVisible();
    await expect(userPage.getByText("Submitted Loans MTD", { exact: true })).toBeVisible();
    await expect(userPage.getByText("Funded Loans MTD", { exact: true })).toBeVisible();
  });

  test("@critical @COHI-344 API request returns 200 and drives KPI values", async ({ userPage }) => {
    await suppressWelcomeTour(userPage);
    const { overviewRequestUrls } = await setupSalesCompanyOverviewMocks(userPage);

    await userPage.goto("/sales-company-overview", { waitUntil: "domcontentloaded" });
    await userPage.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
    await dismissBlockingOverlays(userPage);

    // Use stable selectors
    await expect(userPage.getByRole("heading", { name: "Company Overview", exact: true })).toBeVisible({
      timeout: 45_000,
    });
    const activeLoansCard = userPage
      .locator("div")
      .filter({ has: userPage.getByText("Active Loans", { exact: true }) })
      .first();
    await expect(activeLoansCard.getByText("125", { exact: true })).toBeVisible();
    await expect(userPage.getByText("$48.5M")).toBeVisible();
    await expect
      .poll(() => overviewRequestUrls.some((url) => url.includes("/api/loans/sales-company-overview")))
      .toBe(true);
  });

  test("@critical @COHI-344 aging and channel filters refresh request context and displayed values", async ({
    userPage,
  }) => {
    await suppressWelcomeTour(userPage);
    const { overviewRequestUrls } = await setupSalesCompanyOverviewMocks(userPage);

    await userPage.goto("/sales-company-overview", { waitUntil: "domcontentloaded" });
    await userPage.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
    await dismissBlockingOverlays(userPage);

    // Use stable selectors
    const firstBar = userPage.locator(".recharts-bar-rectangle").first();
    await expect(firstBar).toBeVisible({ timeout: 45_000 });
    await firstBar.click();
    await expect(userPage.getByText("Aging (active days): 0-15", { exact: true })).toBeVisible();
    const activeLoansCard = userPage
      .locator("div")
      .filter({ has: userPage.getByText("Active Loans", { exact: true }) })
      .first();
    await expect(activeLoansCard.getByText("30", { exact: true })).toBeVisible();
    await expect
      .poll(() => overviewRequestUrls.some((url) => url.includes("aging_bucket=0-15")))
      .toBe(true);

    const channelFilter = userPage.locator("button[data-track='filter_channel']");
    if (await channelFilter.isVisible().catch(() => false)) {
      await channelFilter.click();
      await userPage.getByRole("option", { name: "Retail" }).click();
      await expect
        .poll(() => overviewRequestUrls.some((url) => url.includes("channel_group=Retail")))
        .toBe(true);
    }
  });

  test("@critical @COHI-344 filter state persists across reload for same tenant", async ({
    userPage,
  }) => {
    // Two full page loads + networkidle waits; give headroom under parallel worker load.
    test.setTimeout(120_000);
    await suppressWelcomeTour(userPage);
    const { preferencePuts } = await setupSalesCompanyOverviewMocks(userPage);

    await userPage.goto("/sales-company-overview", { waitUntil: "domcontentloaded" });
    await userPage.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
    await dismissBlockingOverlays(userPage);

    // Use stable selectors
    await userPage.locator(".recharts-bar-rectangle").first().click();
    await expect(userPage.getByText("Aging (active days): 0-15", { exact: true })).toBeVisible();
    await expect
      .poll(() => preferencePuts.some((put) => put.agingBuckets.includes("0-15")), { timeout: 10_000 })
      .toBe(true);

    await userPage.reload({ waitUntil: "domcontentloaded" });
    await userPage.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
    await expect(userPage.getByText("Aging (active days): 0-15", { exact: true })).toBeVisible();
  });

  test("@critical @COHI-344 loading, empty, and error states show non-broken dashboard behavior", async ({
    userPage,
  }) => {
    // Two full page loads + networkidle waits + intentional 1.2s mock delay;
    // give headroom under parallel worker load.
    test.setTimeout(120_000);
    await suppressWelcomeTour(userPage);
    await setupSalesCompanyOverviewMocks(userPage, {
      delayedFirstOverviewResponseMs: 1200,
      emptyLoanTypeBreakdowns: true,
    });

    await userPage.goto("/sales-company-overview", { waitUntil: "domcontentloaded" });

    // Use stable selectors
    await expect(userPage.getByText("Loading metrics", { exact: true })).toBeVisible();
    await userPage.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
    await expect(userPage.getByText("No submitted MTD loan type data", { exact: true })).toBeVisible();
    await expect(userPage.getByText("No funded MTD loan type data", { exact: true })).toBeVisible();

    await setupSalesCompanyOverviewMocks(userPage, { forceOverviewError: true });
    await userPage.reload({ waitUntil: "domcontentloaded" });
    await userPage.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
    await expect(userPage.getByRole("heading", { name: "Company Overview", exact: true })).toBeVisible();
    await expect(userPage.getByText("Active Loans", { exact: true })).toBeVisible();
  });
});

test.describe("Sales Company Overview Workbench (COHI-344)", () => {
  test("@critical @COHI-344 workbench adds Sales Company Overview as widget group with section widgets", async ({
    userPage,
  }) => {
    test.setTimeout(120_000);
    await suppressWelcomeTour(userPage);
    const { overviewRequestUrls } = await setupWorkbenchSalesCompanyOverviewMocks(userPage);

    await userPage.goto("/my-dashboard/new", { waitUntil: "domcontentloaded" });
    await userPage.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
    await dismissBlockingOverlays(userPage);

    await userPage.getByRole("button", { name: /^Add$/ }).first().click();
    await userPage.getByRole("button", { name: "Scorecards", exact: true }).click();
    await userPage.getByRole("menuitem", { name: "Sales Company Overview", exact: true }).click();

    await expect(userPage.getByRole("heading", { name: "Sales Company Overview", exact: true })).toBeVisible();
    await expect(userPage.getByText("Active Loans KPI", { exact: true })).toBeVisible();
    await expect(userPage.getByText("Submitted MTD KPI", { exact: true })).toBeVisible();
    await expect(userPage.getByText("Funded MTD KPI", { exact: true })).toBeVisible();
    await expect(userPage.getByText("Aging of Active Loans", { exact: true }).first()).toBeVisible();
    await expect(userPage.getByText("Loan Type MTD Submitted", { exact: true }).first()).toBeVisible();
    await expect(userPage.getByText("Loan Type MTD Funded", { exact: true }).first()).toBeVisible();
    await expect
      .poll(() => overviewRequestUrls.some((u) => u.includes("/api/loans/sales-company-overview")))
      .toBe(true);
  });

  test("@critical @COHI-344 workbench loan-type selection sends filtered request and updates active filters", async ({
    userPage,
  }) => {
    test.setTimeout(120_000);
    await suppressWelcomeTour(userPage);
    const { overviewRequestUrls } = await setupWorkbenchSalesCompanyOverviewMocks(userPage);

    await userPage.goto("/my-dashboard/new", { waitUntil: "domcontentloaded" });
    await userPage.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
    await dismissBlockingOverlays(userPage);

    await userPage.getByRole("button", { name: /^Add$/ }).first().click();
    await userPage.getByRole("button", { name: "Scorecards", exact: true }).click();
    await userPage.getByRole("menuitem", { name: "Sales Company Overview", exact: true }).click();

    await userPage.getByRole("button", { name: "FHA", exact: true }).first().click();

    await expect(userPage.getByText("Loan type: FHA", { exact: true })).toBeVisible();
    await expect
      .poll(() => overviewRequestUrls.some((u) => u.includes("loan_type=FHA")))
      .toBe(true);

    const activeLoansKpi = userPage
      .locator("div")
      .filter({ has: userPage.getByText("Active Loans KPI", { exact: true }) })
      .first();
    await expect(activeLoansKpi.locator("div.text-3xl.font-bold").first()).toHaveText("40");
  });

  test("@critical @COHI-344 workbench aging-bucket selection updates request context and widget values", async ({
    userPage,
  }) => {
    test.setTimeout(120_000);
    await suppressWelcomeTour(userPage);
    const { overviewRequestUrls } = await setupWorkbenchSalesCompanyOverviewMocks(userPage);

    await userPage.goto("/my-dashboard/new", { waitUntil: "domcontentloaded" });
    await userPage.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
    await dismissBlockingOverlays(userPage);

    await userPage.getByRole("button", { name: /^Add$/ }).first().click();
    await userPage.getByRole("button", { name: "Scorecards", exact: true }).click();
    await userPage.getByRole("menuitem", { name: "Sales Company Overview", exact: true }).click();

    const agingCard = userPage
      .locator("div")
      .filter({ has: userPage.getByText("Aging of Active Loans", { exact: true }) })
      .first();
    await agingCard.locator(".recharts-bar-rectangle").first().click();

    await expect(userPage.getByText("Aging: 0-15", { exact: true })).toBeVisible();
    await expect
      .poll(() => overviewRequestUrls.some((u) => u.includes("aging_bucket=0-15")))
      .toBe(true);

    const activeLoansKpi = userPage
      .locator("div")
      .filter({ has: userPage.getByText("Active Loans KPI", { exact: true }) })
      .first();
    await expect(activeLoansKpi.locator("div.text-3xl.font-bold").first()).toHaveText("30");
  });
});
