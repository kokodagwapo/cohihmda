import { test, expect } from "./fixtures";
import type { Page, Route } from "@playwright/test";

/**
 * My Insights — Phase 1 (COHI-367)
 *
 * Acceptance Criteria (mirrors the Jira ticket)
 * ─────────────────────────────────────────────
 *  1. [ROUTE]     Navigating to /insights renders CohiPromptsCard with tab buttons "Insights" and "My Insights".
 *  2. [UI]        Clicking My Insights activates the tab; super admins see a "Regenerate for all users" control and
 *                 non-super-admin users see no per-user regenerate controls (insights run automatically post-sync).
 *  3. [API]       GET /api/dashboard/insights/my returns 200 with cards carrying insight_origin + bucket + optional profile_relevance.
 *  4. [ASSERTION] Tenant briefing survives a My Insights GET failure (failure isolation between hooks).
 *  5. [UI]        My Prompts section lists prompts with schedule suffix, On toggle, Run/Edit/Delete; empty state reads "No saved prompts yet.".
 *  6. [UI]        "Add Prompt" opens dialog titled "Add prompt" with Title, Schedule (Batch / On demand), Prompt text, Specifiers; clicking Create with either field empty does not POST.
 *  7. [MUTATION]  Self-scoped prompt prefixed qaAgentRunTag- is created via POST /api/dashboard/insights/my/prompts, visible in the list, then removed via DELETE.
 *  8. [API]       POST /api/dashboard/insights/my/prompts/:promptId/run for an enabled on-demand prompt produces a custom_prompt user_generated_insights row.
 *  9. [UI]        custom_prompt cards show the "Custom Insight" badge; behavior cards show "Why you're seeing this — <profile_relevance>".
 * 10. [UI]        My Insights tab renders a "Tracked insights" section using TrackedInsightsWatchlist (no standalone /watchlist route).
 * 11. [API]       /my/refresh-all-users is hidden for non-super-admin users; super-admin path covered by separate suite.
 * 12. [ASSERTION] Create-prompt request body persists `specifiers` as a JSON object (not a stringified WHERE clause).
 * 13. [ASSERTION] Personalized cards are placed under bucket lane labels "Immediate Action Required", "Monitor Closely", "Strategic Review", "Informational".
 *
 * CI-stability notes
 * ──────────────────
 * • All My-Insights-specific REST endpoints are intercepted with `page.route()` mocks and an
 *   in-memory store, so the test is hermetic and does not depend on the tenant having a
 *   computed interest profile, persisted custom prompts, or active loan-data ingest.
 * • Per `docs/TESTING_STRATEGY.md` §6 the LLM output text is non-deterministic, so this
 *   spec asserts the *container* (route, tabs, cards, badges, dialogs, fired endpoints)
 *   and never asserts on the wording of an LLM-produced insight.
 * • Job polling (`/api/jobs/:id`) is short-circuited to `status: "complete"` immediately so
 *   the on-demand prompt run-job settles inside the default 60s test timeout.
 * • The dashboardVisibility preference is forced to a known-good state so the
 *   `#CohiInsights` anchor mounts deterministically, matching the pattern used by
 *   `insights-understory.spec.ts` and `insights-refresh-schedule.spec.ts`.
 */

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const MOCK_BEHAVIOR_INSIGHT_CRITICAL = {
  id: 4001,
  type: "critical",
  priority: "high",
  bucket: "critical",
  source: "behavior",
  insight_origin: "behavior",
  headline: "QA: Underwriting backlog needs attention",
  understory: "Three branches are above target turn time this week.",
  profile_relevance:
    "You visit the Operations Scorecard daily and pinned underwriting metrics.",
  functional_category: "operations",
  generation_method: "user_agent",
};

const MOCK_CUSTOM_PROMPT_INSIGHT = {
  id: 4002,
  type: "info",
  priority: "medium",
  bucket: "context",
  source: "custom_prompt",
  insight_origin: "custom_prompt",
  user_insight_prompt_id: "qa-prompt-7",
  headline: "QA: Branch 204 weekly health summary",
  understory: "Pull-through improved 4 points week-over-week.",
  functional_category: "operations",
  generation_method: "user_agent",
};

const MOCK_BEHAVIOR_INSIGHT_ATTENTION = {
  id: 4003,
  type: "info",
  priority: "standard",
  bucket: "attention",
  source: "behavior",
  insight_origin: "behavior",
  headline: "QA: Cycle time trending up in West region",
  understory: "Average increased to 26 days from 22.",
  profile_relevance: "You filter dashboards by the West region.",
  functional_category: "operations",
};

const MOCK_BEHAVIOR_INSIGHT_WORKING = {
  id: 4004,
  type: "info",
  priority: "standard",
  bucket: "working",
  source: "behavior",
  insight_origin: "behavior",
  headline: "QA: Conventional purchase activity holding steady",
  understory: "Volume tracking with seasonal pattern.",
  functional_category: "operations",
};

const TENANT_AGENT_INSIGHT = {
  id: 9001,
  type: "info",
  priority: "standard",
  bucket: "context",
  source: "qa-tenant",
  headline: "QA: tenant briefing remains visible",
  understory: "Tenant-wide briefing rendered from the Insights tab.",
};

// ─── Page helpers ─────────────────────────────────────────────────────────────

async function suppressWelcomeTour(page: Page) {
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem(
        "cohi-welcome-tour-last-shown",
        new Date().toISOString(),
      );
    } catch {
      /* storage access denied */
    }
  });
}

async function seedInsightsVisibility(page: Page) {
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

// ─── Mock layer ───────────────────────────────────────────────────────────────

type SeedPrompt = {
  id: string;
  title: string;
  prompt_text: string;
  specifiers: Record<string, unknown>;
  schedule: "batch" | "on_demand";
  enabled: boolean;
  scope: "user";
  created_at: string;
  updated_at: string;
};

interface RecordedRequest {
  method: string;
  url: string;
  body: unknown;
}

interface InstallOptions {
  myInsights?: Array<Record<string, unknown>>;
  prompts?: SeedPrompt[];
  failMyEndpoints?: boolean;
}

async function installMyInsightsMocks(page: Page, init: InstallOptions = {}) {
  const state = {
    myInsights: init.myInsights ?? [],
    prompts: init.prompts ?? [],
    requests: [] as RecordedRequest[],
    jobs: new Map<string, { status: "complete" | "failed"; data?: unknown; error?: string }>(),
    failMyEndpoints: init.failMyEndpoints ?? false,
  };

  const recordRequest = (route: Route) => {
    const req = route.request();
    let body: unknown = null;
    const raw = req.postData();
    if (raw) {
      try {
        body = JSON.parse(raw);
      } catch {
        body = raw;
      }
    }
    state.requests.push({ method: req.method(), url: req.url(), body });
  };

  // ── Visibility preference (forces #CohiInsights to mount) ──
  await page.route(/\/api\/user\/preferences\/dashboardVisibility(\?|$)/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
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
      }),
    });
  });

  // ── Tenant agent insights (Insights tab) ──
  await page.route(/\/api\/dashboard\/insights(\?[^/]*)?$/, async (route) => {
    recordRequest(route);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        insights: [TENANT_AGENT_INSIGHT],
        usedLLM: true,
        generatedAt: new Date().toISOString(),
      }),
    });
  });

  // ── My Insights list ──
  await page.route(/\/api\/dashboard\/insights\/my(\?[^/]*)?$/, async (route) => {
    recordRequest(route);
    if (state.failMyEndpoints) {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "QA-induced failure" }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        insights: state.myInsights,
        generatedAt: new Date().toISOString(),
        dateFilter: "ytd",
        usedLLM: true,
        needsGeneration: state.myInsights.length === 0,
      }),
    });
  });

  // ── My Prompts CRUD (collection) ──
  await page.route(/\/api\/dashboard\/insights\/my\/prompts(\?[^/]*)?$/, async (route) => {
    recordRequest(route);
    const method = route.request().method();
    if (method === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ prompts: state.prompts }),
      });
      return;
    }
    if (method === "POST") {
      const body = (state.requests[state.requests.length - 1]?.body as Record<string, unknown>) ?? {};
      const id = `qa-prompt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const now = new Date().toISOString();
      const created: SeedPrompt = {
        id,
        title: String(body.title ?? ""),
        prompt_text: String(body.prompt_text ?? ""),
        specifiers:
          body.specifiers && typeof body.specifiers === "object"
            ? (body.specifiers as Record<string, unknown>)
            : {},
        schedule: (body.schedule as "batch" | "on_demand") ?? "batch",
        enabled: typeof body.enabled === "boolean" ? body.enabled : true,
        scope: "user",
        created_at: now,
        updated_at: now,
      };
      state.prompts = [created, ...state.prompts];
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify(created),
      });
      return;
    }
    await route.continue();
  });

  // ── My Prompts: per-prompt run (on-demand) ── must register BEFORE the per-id PATCH/DELETE
  //   route so the more specific `/run` path wins in playwright's reverse-order matching.
  await page.route(
    /\/api\/dashboard\/insights\/my\/prompts\/[^/?]+\/run(\?[^/]*)?$/,
    async (route) => {
      recordRequest(route);
      const url = new URL(route.request().url());
      const parts = url.pathname.split("/");
      const promptId = parts[parts.indexOf("prompts") + 1] ?? "unknown";
      const jobId = `qa-job-run-${promptId}-${Date.now()}`;
      // Simulate a custom_prompt insight being persisted.
      state.myInsights = [
        {
          ...MOCK_CUSTOM_PROMPT_INSIGHT,
          id: 5000 + state.myInsights.length,
          user_insight_prompt_id: promptId,
        },
        ...state.myInsights,
      ];
      state.jobs.set(jobId, { status: "complete", data: { ok: true } });
      await route.fulfill({
        status: 202,
        contentType: "application/json",
        body: JSON.stringify({ jobId, status: "processing" }),
      });
    },
  );

  // ── My Prompts: per-prompt PATCH / DELETE ──
  await page.route(
    /\/api\/dashboard\/insights\/my\/prompts\/[^/?]+(\?[^/]*)?$/,
    async (route) => {
      recordRequest(route);
      const method = route.request().method();
      const url = new URL(route.request().url());
      const id = url.pathname.split("/").filter(Boolean).pop() ?? "";
      if (method === "DELETE") {
        state.prompts = state.prompts.filter((p) => p.id !== id);
        await route.fulfill({ status: 204, body: "" });
        return;
      }
      if (method === "PATCH") {
        const last = state.requests[state.requests.length - 1]?.body as Record<string, unknown> | undefined;
        const existing = state.prompts.find((p) => p.id === id);
        if (!existing) {
          await route.fulfill({
            status: 404,
            contentType: "application/json",
            body: JSON.stringify({ error: "Prompt not found" }),
          });
          return;
        }
        Object.assign(existing, last ?? {}, { updated_at: new Date().toISOString() });
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(existing),
        });
        return;
      }
      await route.continue();
    },
  );

  // ── Tenant briefing refresh ──
  await page.route(/\/api\/dashboard\/insights\/refresh(\?[^/]*)?$/, async (route) => {
    recordRequest(route);
    const jobId = `qa-job-tenant-refresh-${Date.now()}`;
    state.jobs.set(jobId, { status: "complete", data: { ok: true } });
    await route.fulfill({
      status: 202,
      contentType: "application/json",
      body: JSON.stringify({ jobId, status: "processing" }),
    });
  });

  // ── Job polling — return completion immediately so any in-flight job spinner settles ──
  await page.route(/\/api\/jobs\/[^/?]+(\?[^/]*)?$/, async (route) => {
    const url = new URL(route.request().url());
    const id = url.pathname.split("/").filter(Boolean).pop() ?? "";
    const record = state.jobs.get(id);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(record ?? { status: "complete", data: {} }),
    });
  });

  // ── Tracked-insights watchlist API (embedded in the My Insights tab) ──
  // NOTE: server returns a bare array of rows (`result.rows`) — *not* an object
  // envelope. Wrapping it in `{ items: [] }` causes `TrackedInsightsWatchlist`
  // to call `insights.filter(...)` on a non-array and the global error handler
  // in Dashboard.tsx swallows the crash, replacing the dashboard with the
  // "Something went wrong" boundary.
  await page.route(/\/api\/insights\/tracked(\?[^/]*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([]),
    });
  });

  // ── Specifier picker support endpoints ──
  await page.route(/\/api\/loans\/schema(\?[^/]*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ columns: [] }),
    });
  });
  await page.route(/\/api\/loans\/distinct-values\/[^/?]+(\?[^/]*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ values: [] }),
    });
  });

  return {
    requests: () => state.requests.slice(),
    requestsMatching(pattern: RegExp, method?: string) {
      return state.requests.filter(
        (r) => pattern.test(r.url) && (!method || r.method === method),
      );
    },
    prompts: () => state.prompts.slice(),
    setFailMyEndpoints(v: boolean) {
      state.failMyEndpoints = v;
    },
    setMyInsights(next: Array<Record<string, unknown>>) {
      state.myInsights = next;
    },
  };
}

// ─── Page locators ────────────────────────────────────────────────────────────

function cohiInsights(page: Page) {
  return page.locator("#CohiInsights");
}

function myInsightsTabButton(page: Page) {
  return cohiInsights(page).getByRole("button", { name: "My Insights", exact: true });
}

async function openInsightsPage(page: Page) {
  await page.goto("/insights", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("navigation", { name: /main navigation/i })).toBeVisible({
    timeout: 30_000,
  });
  await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
  await dismissBlockingOverlays(page);
  await expect(cohiInsights(page)).toBeVisible({ timeout: 30_000 });
}

async function activateMyInsightsTab(page: Page) {
  const tab = myInsightsTabButton(page);
  await expect(tab).toBeVisible({ timeout: 15_000 });
  await tab.click();
  // Wait for the "Tracked insights" section header — it is always rendered on the My Insights
  // tab (regardless of admin role) and so makes a reliable "tab is active" signal for the
  // non-super-admin user fixture used by this spec.
  await expect(
    cohiInsights(page).getByRole("heading", { name: "Tracked insights" }),
  ).toBeVisible({ timeout: 15_000 });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test.describe("My Insights — Phase 1 (COHI-367)", () => {
  test.describe.configure({ timeout: 120_000 });

  test.beforeEach(async ({ userPage }) => {
    await suppressWelcomeTour(userPage);
    await seedInsightsVisibility(userPage);
  });

  // ── AC 1, 2, 10, 11 (non-super-admin path) ──────────────────────────────────
  test("@critical @COHI-367 tabs render, regenerate controls are hidden for regular users, Tracked insights section is absorbed", async ({
    userPage,
  }) => {
    await installMyInsightsMocks(userPage);
    await openInsightsPage(userPage);

    const insights = cohiInsights(userPage);

    // AC 1: both tab buttons present.
    await expect(insights.getByRole("button", { name: "Insights", exact: true })).toBeVisible();
    await expect(insights.getByRole("button", { name: "My Insights", exact: true })).toBeVisible();

    // AC 2 + AC 11 (negative): regular users see no regenerate controls. The
    // super-admin "Regenerate for all users" button must be absent under the
    // `userPage` fixture; the positive path is covered by a separate platform-
    // admin suite.
    await activateMyInsightsTab(userPage);
    await expect(insights.getByRole("button", { name: "Regenerate for all users" })).toHaveCount(0);
    // Defensive: the previously-existing per-user buttons must not regress.
    await expect(insights.getByRole("button", { name: "Regenerate my user profile" })).toHaveCount(0);
    await expect(insights.getByRole("button", { name: "Regenerate my insights" })).toHaveCount(0);

    // AC 10: the watchlist UI is folded inline as a "Tracked insights" section
    // and there is no standalone /watchlist route declared in the SPA router.
    await expect(insights.getByRole("heading", { name: "Tracked insights" })).toBeVisible({
      timeout: 15_000,
    });
  });

  // ── AC 3, 9, 13 — bucket lane labels, Custom Insight badge, profile relevance ──
  test("@critical @COHI-367 personalized cards render with bucket lanes, Custom Insight badge, and profile_relevance line", async ({
    userPage,
  }) => {
    const mocks = await installMyInsightsMocks(userPage, {
      myInsights: [
        MOCK_BEHAVIOR_INSIGHT_CRITICAL,
        MOCK_CUSTOM_PROMPT_INSIGHT,
        MOCK_BEHAVIOR_INSIGHT_ATTENTION,
        MOCK_BEHAVIOR_INSIGHT_WORKING,
      ],
    });

    await openInsightsPage(userPage);
    await activateMyInsightsTab(userPage);

    // AC 3: GET /api/dashboard/insights/my was called on tab activation.
    await expect
      .poll(
        () => mocks.requestsMatching(/\/api\/dashboard\/insights\/my(\?|$)/, "GET").length,
        {
          message: "GET /api/dashboard/insights/my should fire when the My Insights tab opens",
          timeout: 15_000,
        },
      )
      .toBeGreaterThan(0);

    const insights = cohiInsights(userPage);

    // AC 13: each bucket lane heading uses the canonical Phase 1 label.
    await expect(
      insights.getByRole("heading", { name: "Immediate Action Required", level: 4 }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      insights.getByRole("heading", { name: "Monitor Closely", level: 4 }),
    ).toBeVisible();
    await expect(
      insights.getByRole("heading", { name: "Strategic Review", level: 4 }),
    ).toBeVisible();
    await expect(
      insights.getByRole("heading", { name: "Informational", level: 4 }),
    ).toBeVisible();

    // AC 9: custom-prompt card carries the "Custom Insight" badge. The badge
    // is the canonical visual marker the spec calls out — the implementation
    // intentionally keeps the primary category chip (functional_category) for
    // these cards rather than swapping it for a "Your prompt" chip, so this
    // assertion deliberately limits itself to the badge.
    await expect(insights.getByText("Custom Insight", { exact: true })).toHaveCount(1, {
      timeout: 10_000,
    });

    // AC 9: behavior cards expose the profile_relevance line as
    // "Why you're seeing this — <text>" (apostrophe rendered from &apos;).
    // Both behavior insights in the fixture carry profile_relevance, so the
    // label appears twice — assert at least one rendering plus the unique
    // critical-insight phrase as a positive-presence check.
    await expect(insights.getByText(/Why you[’']re seeing this/).first()).toBeVisible();
    await expect(
      insights.getByText(MOCK_BEHAVIOR_INSIGHT_CRITICAL.profile_relevance, { exact: false }),
    ).toBeVisible();
  });

  // ── AC 4 — failure isolation between tenant and My Insights flows ───────────
  test("@critical @COHI-367 tenant briefing remains visible when My Insights endpoint fails", async ({
    userPage,
  }) => {
    const mocks = await installMyInsightsMocks(userPage, { failMyEndpoints: true });
    await openInsightsPage(userPage);
    const insights = cohiInsights(userPage);

    // AC 4: tenant Insights tab still renders even though /api/dashboard/insights/my fails.
    await expect(insights.getByText(TENANT_AGENT_INSIGHT.headline)).toBeVisible({
      timeout: 15_000,
    });

    // Switching to My Insights with the endpoint failing must show the documented
    // empty state — never a hard crash or a stack trace.
    await activateMyInsightsTab(userPage);
    await expect(
      insights.getByText(/No personalized insights yet for your account/),
    ).toBeVisible({ timeout: 15_000 });

    // Sanity: the failing endpoint was actually exercised.
    expect(
      mocks.requestsMatching(/\/api\/dashboard\/insights\/my(\?|$)/, "GET").length,
    ).toBeGreaterThan(0);
  });

  // ── AC 5, 6, 7, 8, 12 — My Prompts list, dialog UX, create, run, delete ─────
  test("@critical @COHI-367 My Prompts list renders, Add Prompt creates a record, on-demand prompt runs, then deletes", async ({
    userPage,
  }) => {
    const now = new Date().toISOString();
    const seededPrompts: SeedPrompt[] = [
      {
        id: "seed-batch",
        title: "Seed: branch health (batch)",
        prompt_text: "Summarize branch performance.",
        specifiers: {},
        schedule: "batch",
        enabled: true,
        scope: "user",
        created_at: now,
        updated_at: now,
      },
      {
        id: "seed-on-demand",
        title: "Seed: FHA denials (on demand)",
        prompt_text: "Examine recent FHA denials.",
        specifiers: { loan_type: ["FHA"] },
        schedule: "on_demand",
        enabled: true,
        scope: "user",
        created_at: now,
        updated_at: now,
      },
    ];

    const mocks = await installMyInsightsMocks(userPage, {
      myInsights: [MOCK_BEHAVIOR_INSIGHT_CRITICAL],
      prompts: seededPrompts,
    });

    // Auto-accept the window.confirm() prompted by handleDeleteMyPrompt.
    userPage.on("dialog", async (dlg) => {
      await dlg.accept();
    });

    await openInsightsPage(userPage);
    await activateMyInsightsTab(userPage);
    const insights = cohiInsights(userPage);

    // AC 5: list rendering — schedule suffix, On toggle, both seeded prompts visible.
    await expect(insights.getByRole("heading", { name: "My Prompts", exact: true })).toBeVisible({
      timeout: 15_000,
    });

    const batchRow = insights.locator("li").filter({ hasText: "Seed: branch health" }).first();
    const onDemandRow = insights.locator("li").filter({ hasText: "Seed: FHA denials" }).first();
    await expect(batchRow).toBeVisible();
    await expect(batchRow.getByText("(batch)")).toBeVisible();
    await expect(batchRow.locator("input[type='checkbox']")).toBeChecked();
    await expect(onDemandRow).toBeVisible();
    await expect(onDemandRow.getByText("(on demand)")).toBeVisible();

    // AC 6: Add Prompt dialog with required fields and schedule options.
    await insights.getByRole("button", { name: "Add Prompt", exact: true }).click();
    const dialog = userPage.getByRole("dialog").filter({
      has: userPage.getByRole("heading", { name: "Add prompt" }),
    });
    await expect(dialog.getByRole("heading", { name: "Add prompt" })).toBeVisible({
      timeout: 15_000,
    });
    await expect(dialog.getByText(/Batch prompts run when My Insights syncs/)).toBeVisible();

    const titleInput = dialog.locator("input[type='text']").first();
    const promptTextArea = dialog.locator("textarea").first();
    const scheduleSelect = dialog.locator("select").first();
    const createBtn = dialog.getByRole("button", { name: "Create prompt", exact: true });
    const cancelBtn = dialog.getByRole("button", { name: "Cancel", exact: true });

    await expect(titleInput).toBeVisible();
    await expect(promptTextArea).toBeVisible();
    await expect(scheduleSelect.locator("option")).toContainText([
      "Batch (with My Insights sync)",
      "On demand",
    ]);
    await expect(createBtn).toBeVisible();
    await expect(cancelBtn).toBeVisible();
    // Specifier scaffolding is present (helper text + Add specifier action).
    await expect(dialog.getByRole("button", { name: "Add specifier" })).toBeVisible();
    await expect(
      dialog.getByText(/No specifiers — prompt applies to your full loan scope/),
    ).toBeVisible();

    // AC 6 (negative): clicking Create with prompt_text empty must NOT issue a POST.
    const postsBefore = mocks.requestsMatching(
      /\/api\/dashboard\/insights\/my\/prompts(\?|$)/,
      "POST",
    ).length;
    await titleInput.fill("qaAgentRunTag-only-title-no-text");
    await createBtn.click();
    // Give any in-flight network request a tick.
    await userPage.waitForTimeout(500);
    expect(
      mocks.requestsMatching(/\/api\/dashboard\/insights\/my\/prompts(\?|$)/, "POST").length,
      "POST must not fire when Prompt text is empty",
    ).toBe(postsBefore);
    // Dialog stays open so the user can fill in the missing field.
    await expect(dialog).toBeVisible();

    // AC 7 + AC 12: fill all fields, set on_demand, submit.
    const createdTitle = `qaAgentRunTag-cohi-367-${Date.now()}`;
    await titleInput.fill(createdTitle);
    await promptTextArea.fill("QA test prompt — please ignore.");
    await scheduleSelect.selectOption("on_demand");
    await createBtn.click();
    await expect(dialog).toBeHidden({ timeout: 15_000 });

    const creates = mocks.requestsMatching(
      /\/api\/dashboard\/insights\/my\/prompts(\?|$)/,
      "POST",
    );
    expect(creates.length, "exactly one new POST after a successful submit").toBe(postsBefore + 1);
    const createdBody = creates[creates.length - 1].body as Record<string, unknown>;
    expect(createdBody.title).toBe(createdTitle);
    expect(createdBody.prompt_text).toBe("QA test prompt — please ignore.");
    expect(createdBody.schedule).toBe("on_demand");
    expect(
      typeof createdBody.specifiers === "object" && createdBody.specifiers !== null,
      "AC 12: specifiers must be a JSON object, not a stringified WHERE clause",
    ).toBe(true);

    // AC 7: the created prompt appears in the list with the on-demand suffix.
    const createdRow = insights.locator("li").filter({ hasText: createdTitle }).first();
    await expect(createdRow).toBeVisible({ timeout: 15_000 });
    await expect(createdRow.getByText("(on demand)")).toBeVisible();

    // AC 8: clicking Run for the created on-demand prompt fires POST /run.
    const runBtn = createdRow.locator("button[title='Run this prompt now']").first();
    await expect(runBtn).toBeEnabled();
    await runBtn.click();
    await expect
      .poll(
        () =>
          mocks.requestsMatching(
            /\/api\/dashboard\/insights\/my\/prompts\/[^/]+\/run/,
            "POST",
          ).length,
        {
          message: "POST /api/dashboard/insights/my/prompts/:id/run should fire",
          timeout: 15_000,
        },
      )
      .toBeGreaterThan(0);

    // AC 7 (delete half): remove the prompt and verify it disappears from both
    // the rendered list AND the simulated backend store.
    const deleteBtn = createdRow.locator("button[title='Delete']").first();
    await deleteBtn.click();
    await expect(createdRow).toHaveCount(0, { timeout: 15_000 });
    expect(
      mocks.prompts().some((p) => p.title === createdTitle),
      "deleted prompt must be gone from the mock store",
    ).toBe(false);
  });
});
