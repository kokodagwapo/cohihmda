import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

const BULLET_HEADLINE = "Pipeline bottlenecks are concentrated in underwriting";
const PARAGRAPH_HEADLINE = "Conversion trends improved after targeted coaching";

const MOCK_INSIGHTS_RESPONSE = {
  usedLLM: true,
  generatedAt: "2026-04-22T12:00:00.000Z",
  summaryForPodcast: "",
  insights: [
    {
      id: 32801,
      type: "critical",
      priority: "high",
      source: "pipeline_velocity",
      bucket: "critical",
      headline: BULLET_HEADLINE,
      understory:
        "Three underwriting blockers are driving cycle-time risk this week.",
      understory_bullets: [
        "Average underwriting turn time is 2.4 days above target.",
        "82 files are waiting on the same condition package.",
        "The backlog is concentrated in two branches and one product mix.",
      ],
      functional_category: "operations",
      generation_method: "agent",
    },
    {
      id: 32802,
      type: "info",
      priority: "medium",
      source: "performance",
      bucket: "working",
      headline: PARAGRAPH_HEADLINE,
      understory:
        "Pull-through improved after last month's coaching changes, especially in the top-performing branch.",
      functional_category: "operations",
      generation_method: "agent",
    },
  ],
};

async function dismissBlockingOverlays(page: import("@playwright/test").Page) {
  // The welcome tour / onboarding dialog can appear on first visit and
  // intercept every click on the page. Treat either an open dialog or
  // backdrop as blocking and dismiss it with Escape before assertions.
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

async function suppressWelcomeTour(page: Page) {
  // The welcome tour dialog intercepts pointer events on /insights for newly
  // provisioned users. Pre-seed the localStorage flag it uses so the dialog
  // never renders, instead of relying on post-render Escape dismissal.
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem(
        "cohi-welcome-tour-last-shown",
        new Date().toISOString(),
      );
    } catch {
      /* storage access denied; tour dismissal in beforeEach will still try */
    }
  });
}

async function seedInsightsVisibility(page: Page) {
  // Defense-in-depth for the dashboard-visibility race:
  // - useDashboardVisibility() first tries GET /api/user/preferences/dashboardVisibility
  // - on any failure / timeout it falls back to localStorage('dashboardVisibility')
  //
  // In the critical suite, the shared test user can carry a persisted server
  // preference or localStorage snapshot where CohiInsights is hidden. We
  // already mock the server response below, but if that request errors or is
  // delayed the hook can still briefly hydrate from localStorage and keep the
  // section out of the DOM long enough for the spec to fail at `#CohiInsights`.
  //
  // Seed the same known-good value in localStorage before page scripts run so
  // both the primary path and the fallback path agree that CohiInsights is on.
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem(
        "dashboardVisibility",
        JSON.stringify({
          executiveDashboard: true,
          industryNews: true,
          CohiInsights: true,
          leaderboard: true,
          topTiering: true,
          closingFalloutForecast: true,
          trends: true,
          forecasting: true,
          kpiReports: true,
        }),
      );
    } catch {
      /* storage access denied */
    }
  });
}

async function confirmInsightsVisibilityInputs(page: Page) {
  // Explicitly prove the two inputs that control whether Dashboard mounts
  // `#CohiInsights` are set the way this test expects:
  // 1. localStorage fallback
  // 2. GET /api/user/preferences/dashboardVisibility
  //
  // If both are true and the anchor still doesn't mount, the failure is no
  // longer attributable to the test user's saved preference state.
  await expect
    .poll(
      async () =>
        await page.evaluate(() => {
          try {
            const raw = window.localStorage.getItem("dashboardVisibility");
            const parsed = raw ? JSON.parse(raw) : null;
            return parsed?.CohiInsights ?? null;
          } catch {
            return null;
          }
        }),
      { message: "expected localStorage dashboardVisibility.CohiInsights === true" },
    )
    .toBe(true);

  await expect
    .poll(
      async () =>
        await page.evaluate(async () => {
          try {
            const res = await fetch("/api/user/preferences/dashboardVisibility", {
              credentials: "include",
            });
            const json = await res.json();
            return json?.preference_value?.CohiInsights ?? null;
          } catch {
            return null;
          }
        }),
      { message: "expected dashboardVisibility API to return CohiInsights === true" },
    )
    .toBe(true);
}

async function ensureInsightsSectionVisible(page: Page) {
  // In the full critical suite on dev, `/insights` can intermittently land in
  // a first-load state where the route is correct but the `#CohiInsights`
  // anchor never mounts. The same spec often passes on Playwright retry with
  // no code changes, which strongly suggests a page-hydration race rather than
  // a real product regression.
  //
  // Make that recovery deterministic here: try the load flow, and if the
  // anchor is still absent, reseed the visibility preference and reload once.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (attempt === 0) {
      await page.goto("/insights", { waitUntil: "domcontentloaded" });
    } else {
      await page.evaluate(() => {
        try {
          window.localStorage.setItem(
            "dashboardVisibility",
            JSON.stringify({
              executiveDashboard: true,
              industryNews: true,
              CohiInsights: true,
              leaderboard: true,
              topTiering: true,
              closingFalloutForecast: true,
              trends: true,
              forecasting: true,
              kpiReports: true,
            }),
          );
        } catch {
          /* storage access denied */
        }
      });
      await page.reload({ waitUntil: "domcontentloaded" });
    }

    await expect(page).toHaveURL(/\/insights/);
    // `domcontentloaded` can fire while `ProtectedRoute` is still hydrating auth from
    // storage state (full-screen spinner). Dashboard — and `#CohiInsights` — only mount
    // after that finishes; CI is slower than most laptops, so wait for the shell first.
    await expect(
      page.getByRole("navigation", { name: /main navigation/i }),
    ).toBeVisible({ timeout: 30_000 });
    await confirmInsightsVisibilityInputs(page);
    await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
    await dismissBlockingOverlays(page);
    await page.waitForTimeout(750);
    await dismissBlockingOverlays(page);

    const insightsSection = page.locator("#CohiInsights");
    const visible = await insightsSection
      .isVisible({ timeout: 4_000 })
      .catch(() => false);
    if (visible) {
      return insightsSection;
    }
  }

  // Final strict assertion so failure output still points to the missing anchor.
  await expect(
    page.getByRole("navigation", { name: /main navigation/i }),
  ).toBeVisible({ timeout: 30_000 });
  const insightsSection = page.locator("#CohiInsights");
  await expect(insightsSection).toBeVisible({ timeout: 30_000 });
  return insightsSection;
}

async function mockInsightsApis(page: Page) {
  await page.route("**/api/dashboard/insights?**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(MOCK_INSIGHTS_RESPONSE),
    });
  });

  await page.route("**/api/dashboard/insights/details/**", async (route) => {
    const url = new URL(route.request().url());
    const headline = url.searchParams.get("headline") || BULLET_HEADLINE;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        source: "pipeline_velocity",
        title: headline,
        summary: {},
        rows: [],
      }),
    });
  });

  // The Dashboard renders <div id="CohiInsights"> only if
  // `dashboardVisibility.CohiInsights` is truthy. That state is loaded from
  // /api/user/preferences/dashboardVisibility — if the CI test user has
  // previously saved the section as hidden (or the endpoint stalls in CI),
  // the #CohiInsights anchor never appears in the DOM and every assertion
  // in this file times out on "element not found". Force a known-good
  // default here so this test doesn't depend on dev tenant preference state.
  const defaultVisibilityPreference = {
    preference_value: {
      executiveDashboard: true,
      industryNews: true,
      CohiInsights: true,
      leaderboard: true,
      topTiering: true,
      closingFalloutForecast: true,
      trends: true,
      forecasting: true,
      kpiReports: true,
    },
  };
  await page.route(
    /\/api\/user\/preferences\/dashboardVisibility(\?|$)/,
    async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(defaultVisibilityPreference),
        });
        return;
      }
      // PUT writes from the real code path are harmless to swallow in a mocked
      // environment — ack with the same body so nothing upstream throws.
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(defaultVisibilityPreference),
      });
    },
  );
}

function insightCard(page: Page, headline: string) {
  // Match either the new `data-testid="insight-card"` hook or the stable
  // `group/insight` Tailwind class that predates it, so this spec works
  // against both freshly-deployed builds and dev deployments that are
  // still running the pre-COHI-328 component.
  return page
    .locator(
      '#CohiInsights [data-testid="insight-card"], #CohiInsights div[class*="group/insight"]',
    )
    .filter({ hasText: headline })
    .first();
}

async function expandAllInsights(page: Page) {
  // Expand mode stops the 5s insight carousel auto-rotation and stacks
  // every insight in the DOM simultaneously. That prevents races where a
  // card selector resolves during rotation and Playwright loses the
  // reference before it can interact with it.
  const expandAll = page.getByRole("button", { name: /expand all/i });
  if (await expandAll.isVisible().catch(() => false)) {
    await expandAll.click();
  }
}

test.describe("Insights Understory Readability (COHI-328)", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(90_000);

  test.beforeEach(async ({ userPage }) => {
    await suppressWelcomeTour(userPage);
    await seedInsightsVisibility(userPage);
    await mockInsightsApis(userPage);
    // Wait for the mocked insights to actually render before any test starts
    // querying cards. This helper also recovers once from the intermittent
    // first-load /insights hydration race seen only in the full critical suite.
    const insightsSection = await ensureInsightsSectionVisible(userPage);
    await expect(
      insightsSection.getByText(BULLET_HEADLINE, { exact: true }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      insightsSection.getByText(PARAGRAPH_HEADLINE, { exact: true }),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("@critical @COHI-328 insights section renders with content", async ({
    userPage,
  }) => {
    const insightsSection = userPage.locator("#CohiInsights");
    await expect(insightsSection).toBeVisible({ timeout: 15_000 });
    await expect(insightsSection.getByText(BULLET_HEADLINE, { exact: true })).toBeVisible();
    await expect(insightsSection.getByText(PARAGRAPH_HEADLINE, { exact: true })).toBeVisible();
  });

  test("@critical @COHI-328 multi-line understory renders as bullet items", async ({
    userPage,
  }) => {
    await expandAllInsights(userPage);
    const card = insightCard(userPage, BULLET_HEADLINE);
    await expect(card).toBeVisible();

    await dismissBlockingOverlays(userPage);
    await card.click();
    await expect(card).toHaveAttribute("aria-expanded", "true");

    const bulletList = card.locator('[data-testid="insight-understory-list"]');
    await expect(bulletList).toBeVisible();
    await expect(bulletList.locator("li")).toHaveCount(3);
    await expect(bulletList).toContainText(
      "Average underwriting turn time is 2.4 days above target.",
    );
  });

  test("@critical @COHI-328 single-sentence understory renders as paragraph", async ({
    userPage,
  }) => {
    await expandAllInsights(userPage);
    const card = insightCard(userPage, PARAGRAPH_HEADLINE);
    await expect(card).toBeVisible();

    await dismissBlockingOverlays(userPage);
    await card.click();
    await expect(card).toHaveAttribute("aria-expanded", "true");

    const paragraph = card.locator('[data-testid="insight-understory-paragraph"]');
    await expect(paragraph).toBeVisible();
    await expect(paragraph).toContainText(
      "Pull-through improved after last month's coaching changes",
    );
    await expect(card.locator('[data-testid="insight-understory-list"]')).toHaveCount(0);
  });

  test("@critical @COHI-328 expand all shows grouped understory containers consistently", async ({
    userPage,
  }) => {
    const insightsSection = userPage.locator("#CohiInsights");
    await expect(insightsSection).toBeVisible({ timeout: 15_000 });

    await userPage.getByRole("button", { name: /expand all/i }).click();

    const bulletCard = insightCard(userPage, BULLET_HEADLINE);
    const paragraphCard = insightCard(userPage, PARAGRAPH_HEADLINE);

    await expect(bulletCard.locator('[data-testid="insight-understory"]')).toBeVisible();
    await expect(paragraphCard.locator('[data-testid="insight-understory"]')).toBeVisible();
    await expect(bulletCard.locator('[data-testid="insight-understory-list"]')).toBeVisible();
    await expect(paragraphCard.locator('[data-testid="insight-understory-paragraph"]')).toBeVisible();
  });

  test("@critical @COHI-328 selected drillable insight exposes a View details affordance", async ({
    userPage,
  }) => {
    await expandAllInsights(userPage);
    const card = insightCard(userPage, BULLET_HEADLINE);
    await expect(card).toBeVisible();

    await dismissBlockingOverlays(userPage);
    await card.click();
    await expect(card.locator('[data-testid="insight-understory-list"]')).toBeVisible();
    await expect(card.getByText("View details")).toBeVisible();
  });

  test("@critical @COHI-328 no console errors from insight components", async ({
    userPage,
  }) => {
    const consoleErrors: string[] = [];
    userPage.on("console", (msg) => {
      if (msg.type() === "error") {
        consoleErrors.push(msg.text());
      }
    });

    await dismissBlockingOverlays(userPage);
    await expect(userPage.locator("#CohiInsights")).toBeVisible({ timeout: 15_000 });
    await userPage.waitForTimeout(1_000);

    // Filter for errors originating from insight components
    const insightErrors = consoleErrors.filter(
      (msg) =>
        msg.includes("CohiPromptsCard") ||
        msg.includes("InsightDetail") ||
        msg.includes("DashboardInsight"),
    );
    expect(
      insightErrors,
      `Console errors from insight components: ${insightErrors.join("; ")}`,
    ).toHaveLength(0);
  });
});
