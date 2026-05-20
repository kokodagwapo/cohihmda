/**
 * E2E: COHI-335 prototype — Chat visualizations: prominent export + Edit in PPT Editor.
 *
 * Covers:
 *   - COHI-336: Prominent per-chart PDF/PPT export (split button), persisted
 *               preferred format, chart image is captured (not table-only),
 *               overflow menu still has PDF & PPT, capture scope is chart-only.
 *   - COHI-337: "Edit in PPT Editor" handoff creates a new Workbench canvas
 *               with the single viz and navigates with ?reportBuilder=1.
 *               Header "Save all to Workbench" bulk-exports all chat viz.
 *   - COHI-335: Chat bubble rehydrates a viz from persisted session metadata
 *               and the bubble does not clip the chat panel.
 *
 * Strategy:
 *   - All backend calls the chat panel relies on are mocked via page.route so
 *     the suite is deterministic (no tenant data needed, no LLM latency).
 *   - We drive the real UI: fill the input, click Send, click the export
 *     buttons. This exercises the actual render pipeline including Recharts
 *     SVG → html2canvas capture for the PDF/PPT embed path.
 *   - Downloads are inspected: size floors catch the regression where the PDF
 *     was a table-only fallback instead of an image-embedded chart.
 */

import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";
import { promises as fs } from "node:fs";
import { forceUnifiedChat, mockV1MessageStream } from "./helpers/unifiedChat";

// ---------- Mock fixtures ---------------------------------------------------

const MOCK_TENANT_ID = "11111111-1111-1111-1111-111111111111";
const MOCK_SESSION_ID = "22222222-2222-2222-2222-222222222222";
const MOCK_CANVAS_ID = "33333333-3333-3333-3333-333333333333";

const MOCK_ASK_QUESTION =
  "Top 10 loan officers by revenue over the last 90 days";

/**
 * Shape mirrors `CohiChatResponse` on the server.  The chart is an actual
 * horizontal bar so the split-button export captures a real rendered SVG.
 */
const MOCK_VISUALIZATION = {
  type: "horizontal_bar",
  title: "Top 10 loan officers by revenue — last 90 days (funded)",
  data: [
    { loan_officer: "Stanley Edward Obrecht Jr", total_revenue: 339053.15 },
    { loan_officer: "Alicia Marie Bergfeld", total_revenue: 292052.76 },
    { loan_officer: "Aaron Michael Rist", total_revenue: 247493.8 },
    { loan_officer: "Craig James Nielsen", total_revenue: 242698.31 },
    { loan_officer: "Vance Ryan Wohlert", total_revenue: 198448.88 },
    { loan_officer: "James Ralph Erb", total_revenue: 167764.71 },
    { loan_officer: "Stephen Michael Tiemeyer", total_revenue: 164074.81 },
    { loan_officer: "Jay Bryant Howald", total_revenue: 145991.51 },
    { loan_officer: "Paul Francis Hughes", total_revenue: 137943.99 },
    { loan_officer: "Kyle Christopher Budde", total_revenue: 136017.4 },
  ],
  xKey: "total_revenue",
  yKey: "loan_officer",
  showLegend: false,
  showGrid: true,
  numberFormat: "currency" as const,
};

const MOCK_ASK_RESPONSE = {
  message:
    "Here are your top 10 loan officers by funded revenue over the last 90 days.",
  visualization: MOCK_VISUALIZATION,
  data: MOCK_VISUALIZATION.data,
  sqlQuery:
    "SELECT loan_officer, SUM(total_revenue) AS total_revenue FROM funded_loans WHERE funded_at > NOW() - INTERVAL '90 days' GROUP BY 1 ORDER BY 2 DESC LIMIT 10;",
  suggestedQuestions: [],
  sources: { dataQuery: true },
};

// ---------- Helpers ---------------------------------------------------------

/**
 * Pre-seed the preferred export format to a known value so each test starts
 * in a deterministic state. This runs before page scripts (addInitScript) so
 * the chat panel picks it up on first render.
 */
/** Must match `CHAT_EXPORT_FORMAT_KEY` in CohiChatPanel.tsx. */
const EXPORT_FORMAT_LS_KEY = "cohi-chat-preferred-export-format";

async function seedExportPreference(page: Page, format: "pdf" | "ppt") {
  await page.addInitScript(
    ({ key, fmt }: { key: string; fmt: "pdf" | "ppt" }) => {
      try {
        window.localStorage.setItem(key, fmt);
      } catch {
        /* storage unavailable in some browsers */
      }
    },
    { key: EXPORT_FORMAT_LS_KEY, fmt: format },
  );
}

/**
 * Suppress any global onboarding/tour dialogs that might cover the chat UI.
 */
async function suppressOnboarding(page: Page) {
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem(
        "cohi-welcome-tour-last-shown",
        new Date().toISOString(),
      );
    } catch {
      /* noop */
    }
  });
}

/**
 * Install mocks for every backend endpoint the CohiChatPanel touches when
 * sending a question.  Also captures the most recent /ask body and any
 * /api/workbench/canvases POST body for assertions.
 */
async function mockChatAndWorkbench(page: Page) {
  const captured: {
    askBodies: unknown[];
    canvasBodies: unknown[];
  } = {
    askBodies: [],
    canvasBodies: [],
  };

  // Tenant resolution – keeps useCohiChat happy without needing a real tenant.
  await page.route(/\/api\/tenants(\?|$)/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        tenants: [{ id: MOCK_TENANT_ID, slug: "mock", name: "Mock Tenant" }],
      }),
    });
  });
  await page.route(/\/api\/auth\/tenants(\?|$)/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        tenants: [{ id: MOCK_TENANT_ID, slug: "mock", name: "Mock Tenant" }],
      }),
    });
  });
  await page.route(/\/api\/cohi-chat\/default-tenant(\?|$)/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ tenantId: MOCK_TENANT_ID }),
    });
  });

  // Session lifecycle.
  await page.route(/\/api\/cohi-chat\/new-session(\?|$)/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ sessionId: MOCK_SESSION_ID }),
    });
  });
  // Sessions list only (not /sessions/:id). Use explicit end-of-path or `?`.
  await page.route(/\/api\/cohi-chat\/sessions(\?|$)/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ sessions: [] }),
    });
  });

  // The /ask endpoint – core of the test.
  await page.route(/\/api\/cohi-chat\/ask(\?|$)/, async (route) => {
    try {
      captured.askBodies.push(JSON.parse(route.request().postData() || "{}"));
    } catch {
      captured.askBodies.push(null);
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(MOCK_ASK_RESPONSE),
    });
  });

  // Unified v1 non-stream fallback (legacy clients).
  await page.route(/\/api\/chat\/v1\/messages(?!:stream)(\?|$)/, async (route) => {
    try {
      captured.askBodies.push(JSON.parse(route.request().postData() || "{}"));
    } catch {
      captured.askBodies.push(null);
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        conversationId: "44444444-4444-4444-4444-444444444444",
        turn: {
          id: "55555555-5555-5555-5555-555555555555",
          blocks: [
            { type: "text", markdown: MOCK_ASK_RESPONSE.message },
            {
              type: "visualization",
              artifactId: "66666666-6666-6666-6666-666666666666",
              config: MOCK_VISUALIZATION,
            },
          ],
        },
        metadata: {
          sqlQuery: MOCK_ASK_RESPONSE.sqlQuery,
          sources: MOCK_ASK_RESPONSE.sources,
          suggestedQuestions: MOCK_ASK_RESPONSE.suggestedQuestions,
        },
      }),
    });
  });

  await mockV1MessageStream(page, {
    replyText: MOCK_ASK_RESPONSE.message,
    visualization: MOCK_VISUALIZATION,
    streamMetadata: {
      sqlQuery: MOCK_ASK_RESPONSE.sqlQuery,
      sources: MOCK_ASK_RESPONSE.sources,
      suggestedQuestions: MOCK_ASK_RESPONSE.suggestedQuestions,
    },
  });

  // Workbench canvas creation (Edit in PPT Editor + Save all to Workbench).
  // Match /api/workbench/canvases exactly, not /canvases/:id.
  await page.route(/\/api\/workbench\/canvases(\?|$)/, async (route) => {
    const method = route.request().method();
    if (method === "POST") {
      try {
        captured.canvasBodies.push(
          JSON.parse(route.request().postData() || "{}"),
        );
      } catch {
        captured.canvasBodies.push(null);
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ id: MOCK_CANVAS_ID }),
      });
      return;
    }
    await route.continue();
  });

  // My-dashboard canvas load after navigation – prevent any real backend call
  // from 500'ing and failing the "Edit in PPT Editor" navigation assertion.
  await page.route(
    new RegExp(`/api/workbench/canvases/${MOCK_CANVAS_ID}(\\?|$|/)`),
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: MOCK_CANVAS_ID,
          title: "Chat Export",
          layout: [],
          annotations: [],
          layoutVersion: "freeform-v1",
          background: { type: "color", value: "#ffffff" },
          uploadsMeta: [],
        }),
      });
    },
  );

  return captured;
}

/**
 * Mock `/api/cohi-chat/sessions/:id` so that loading a session from history
 * yields a message whose `metadata.visualization` rehydrates as a chart.
 * This is the regression test for the persistence bug where viz was dropped
 * from history and only text remained after refresh.
 */
async function mockSessionLoad(page: Page, sessionId: string) {
  await page.route(
    new RegExp(`/api/cohi-chat/sessions/${sessionId}(\\?|$)`),
    async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          session: {
            id: sessionId,
            title: "Top 10 loan officers",
            createdAt: "2026-04-22T12:00:00.000Z",
            updatedAt: "2026-04-22T12:00:00.000Z",
          },
          messages: [
            {
              id: "hist-user-1",
              role: "user",
              content: MOCK_ASK_QUESTION,
              metadata: { timestamp: "2026-04-22T12:00:00.000Z" },
              createdAt: "2026-04-22T12:00:00.000Z",
            },
            {
              id: "hist-asst-1",
              role: "assistant",
              content: MOCK_ASK_RESPONSE.message,
              metadata: {
                timestamp: "2026-04-22T12:00:01.000Z",
                hasVisualization: true,
                visualizationType: MOCK_VISUALIZATION.type,
                visualization: MOCK_VISUALIZATION,
                sqlQuery: MOCK_ASK_RESPONSE.sqlQuery,
                rowCount: MOCK_VISUALIZATION.data.length,
                sources: MOCK_ASK_RESPONSE.sources,
              },
              createdAt: "2026-04-22T12:00:01.000Z",
            },
          ],
        }),
      });
    },
  );
}

/**
 * Ask the mocked question via the real input. Resolves once the assistant
 * bubble's chart has rendered (Recharts has drawn at least one bar).
 */
async function askMockQuestion(page: Page, question: string = MOCK_ASK_QUESTION) {
  const chatPanel = page.getByTestId("cohi-chat-panel");
  await expect(chatPanel).toBeVisible();

  const input = chatPanel.getByPlaceholder(
    /What important info do I need to know today/i,
  );
  await expect(input).toBeVisible();
  await input.fill(question);
  await input.press("Enter");

  // The assistant bubble injects the chart wrapper with data-testid=cohi-chat-viz.
  const chartWrapper = chatPanel.getByTestId("cohi-chat-viz").last();
  await expect(chartWrapper).toBeVisible({ timeout: 20_000 });

  // Wait for the SVG chart to actually render some drawable content.
  //
  // Why not assert a specific Recharts selector like `.recharts-bar-rectangle`?
  // CI showed that the exact DOM shape varies during animation / hydration:
  // first the wrapper `<g>` existed but was "hidden", then on the next run
  // there were no `<path d>` children at all yet. The export tests below are
  // the real proof that a chart image made it into the PDF/PPT; this helper
  // just needs to wait for the visualization shell to be genuinely rendered.
  //
  // An SVG with multiple vector/text nodes is a stable cross-browser signal
  // that Recharts finished laying out enough content for html2canvas to capture.
  const chartSvg = chartWrapper.locator("svg").first();
  await expect(chartSvg).toBeVisible({ timeout: 15_000 });
  await expect
    .poll(
      async () => await chartSvg.locator("path[d], rect, text").count(),
      {
        timeout: 15_000,
        message: "waiting for chart SVG content to render",
      },
    )
    .toBeGreaterThan(5);

  // Let the enter animation settle so html2canvas captures finished bars
  // instead of tween frames.
  await page.waitForTimeout(600);
}

/**
 * Download a blob via a button click and return its byte length.
 */
async function clickAndGetDownloadSize(
  page: Page,
  clickTarget: ReturnType<Page["getByTestId"]>,
): Promise<{ size: number; filename: string }> {
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 30_000 }),
    clickTarget.click(),
  ]);
  const path = await download.path();
  const stat = await fs.stat(path ?? "");
  return { size: stat.size, filename: download.suggestedFilename() };
}

// ---------- Suite -----------------------------------------------------------

test.describe("Chat visualizations: prominent export + Edit in PPT Editor (COHI-335)", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(120_000);

  test.beforeEach(async ({ userPage }) => {
    await suppressOnboarding(userPage);
    await forceUnifiedChat(userPage);
  });

  // --------------------------------------------------------------------------
  // COHI-336 — Prominent PDF/PPT export from chat
  // --------------------------------------------------------------------------

  test("@critical @COHI-336 split-button default label reflects preferred format (PPT)", async ({
    userPage,
  }) => {
    await seedExportPreference(userPage, "ppt");
    await mockChatAndWorkbench(userPage);
    await userPage.goto("/data-chat", { waitUntil: "domcontentloaded" });
    await askMockQuestion(userPage);

    const primary = userPage.getByTestId("cohi-chat-export-primary").first();
    await expect(primary).toBeVisible();
    await expect(primary).toHaveText(/PPT/);
    await expect(primary).toHaveAttribute("data-export-format", "ppt");
  });

  test("@critical @COHI-336 split-button default label flips to PDF when preference is pdf", async ({
    userPage,
  }) => {
    await seedExportPreference(userPage, "pdf");
    await mockChatAndWorkbench(userPage);
    await userPage.goto("/data-chat", { waitUntil: "domcontentloaded" });
    await askMockQuestion(userPage);

    const primary = userPage.getByTestId("cohi-chat-export-primary").first();
    await expect(primary).toHaveText(/PDF/);
    await expect(primary).toHaveAttribute("data-export-format", "pdf");
  });

  test("@critical @COHI-336 overflow menu exposes both PDF and PPT options", async ({
    userPage,
  }) => {
    await seedExportPreference(userPage, "ppt");
    await mockChatAndWorkbench(userPage);
    await userPage.goto("/data-chat", { waitUntil: "domcontentloaded" });
    await askMockQuestion(userPage);

    await userPage.getByTestId("cohi-chat-export-menu-trigger").first().click();
    await expect(userPage.getByTestId("cohi-chat-export-pdf")).toBeVisible();
    await expect(userPage.getByTestId("cohi-chat-export-ppt")).toBeVisible();
  });

  test("@critical @COHI-336 primary split-button downloads a PDF containing an embedded chart image", async ({
    userPage,
  }) => {
    // Start with preferred format = pdf so the primary button is PDF.
    await seedExportPreference(userPage, "pdf");
    await mockChatAndWorkbench(userPage);
    await userPage.goto("/data-chat", { waitUntil: "domcontentloaded" });
    await askMockQuestion(userPage);

    const primary = userPage.getByTestId("cohi-chat-export-primary").first();
    const { size, filename } = await clickAndGetDownloadSize(userPage, primary);

    expect(filename).toMatch(/\.pdf$/i);
    // A data-only PDF from handleDownloadPDF without an embedded chart image
    // is typically ~5-8 KB. With a captured Recharts PNG it jumps well over
    // 15 KB. This floor catches the regression we just fixed where the PDF
    // was a table-only export.
    expect(
      size,
      `PDF bytes = ${size}; expected >= 15000 to indicate chart image embedded`,
    ).toBeGreaterThanOrEqual(15_000);
  });

  test("@critical @COHI-336 primary split-button downloads a PPT containing an embedded chart image", async ({
    userPage,
  }) => {
    await seedExportPreference(userPage, "ppt");
    await mockChatAndWorkbench(userPage);
    await userPage.goto("/data-chat", { waitUntil: "domcontentloaded" });
    await askMockQuestion(userPage);

    const primary = userPage.getByTestId("cohi-chat-export-primary").first();
    const { size, filename } = await clickAndGetDownloadSize(userPage, primary);

    expect(filename).toMatch(/\.pptx$/i);
    // An empty PPTX (no media) is ~25 KB. With an embedded chart image and a
    // data table slide we expect noticeably more. 35 KB is conservative.
    expect(
      size,
      `PPTX bytes = ${size}; expected >= 35000 to indicate chart image embedded`,
    ).toBeGreaterThanOrEqual(35_000);
  });

  test("@critical @COHI-336 PDF click persists preferred format across reload", async ({
    userPage,
  }) => {
    // Do NOT seed localStorage – rely on the component's built-in default of
    // "ppt" so the addInitScript seed doesn't fight us after reload. The
    // userPage fixture gives each test a fresh context, so localStorage
    // starts empty.
    await mockChatAndWorkbench(userPage);
    await userPage.goto("/data-chat", { waitUntil: "domcontentloaded" });
    await askMockQuestion(userPage);

    // Sanity: starting state is PPT (component default).
    const primary = userPage.getByTestId("cohi-chat-export-primary").first();
    await expect(primary).toHaveAttribute("data-export-format", "ppt");

    // Pick PDF from the overflow menu; the handler writes "pdf" to
    // localStorage after the download resolves.
    await userPage.getByTestId("cohi-chat-export-menu-trigger").first().click();
    const pdfOption = userPage.getByTestId("cohi-chat-export-pdf").first();
    const [pdfDownload] = await Promise.all([
      userPage.waitForEvent("download", { timeout: 30_000 }),
      pdfOption.click(),
    ]);
    expect(pdfDownload.suggestedFilename()).toMatch(/\.pdf$/i);

    await expect
      .poll(
        async () =>
          await userPage.evaluate(
            (key: string) => window.localStorage.getItem(key),
            EXPORT_FORMAT_LS_KEY,
          ),
        { message: "localStorage preferred format should become 'pdf'" },
      )
      .toBe("pdf");

    // Reload. Route handlers survive reloads on the same page, so we don't
    // need to re-register mocks. localStorage persists across the reload
    // within the same browser context, so the primary button should now
    // default to PDF.
    await userPage.reload({ waitUntil: "domcontentloaded" });
    await askMockQuestion(userPage);
    await expect(
      userPage.getByTestId("cohi-chat-export-primary").first(),
    ).toHaveText(/PDF/);
    await expect(
      userPage.getByTestId("cohi-chat-export-primary").first(),
    ).toHaveAttribute("data-export-format", "pdf");
  });

  test("@critical @COHI-336 capture target excludes Design row, SQL toggle, and action footer", async ({
    userPage,
  }) => {
    // Regression: before the fix, id="cohi-viz-*" wrapped the entire motion
    // container, so PDF/PPT exports contained the Design chips, Show SQL row,
    // and the PDF / PPT / Edit buttons themselves. The capture must now wrap
    // the chart card only.
    await seedExportPreference(userPage, "ppt");
    await mockChatAndWorkbench(userPage);
    await userPage.goto("/data-chat", { waitUntil: "domcontentloaded" });
    await askMockQuestion(userPage);

    const vizWrapper = userPage.getByTestId("cohi-chat-viz").first();
    await expect(vizWrapper).toBeVisible();

    // These must NOT be descendants of the capture target.
    await expect(
      vizWrapper.getByText("Design", { exact: true }),
    ).toHaveCount(0);
    await expect(
      vizWrapper.getByText("Show SQL", { exact: true }),
    ).toHaveCount(0);
    await expect(
      vizWrapper.getByTestId("cohi-chat-export-primary"),
    ).toHaveCount(0);
    await expect(vizWrapper.getByTestId("cohi-chat-edit-in-ppt")).toHaveCount(
      0,
    );
    await expect(vizWrapper.getByTestId("cohi-chat-viz-footer")).toHaveCount(0);

    // Sanity: the chart itself IS inside the capture target. Use the SVG's
    // generic drawable/text nodes instead of a bar-specific selector so this
    // stays stable across Recharts' animation timing and DOM-shape changes.
    await expect(vizWrapper.locator("svg").first()).toBeVisible();
    await expect
      .poll(async () => await vizWrapper.locator("svg").first().locator("path[d], rect, text").count())
      .toBeGreaterThan(5);
  });

  // --------------------------------------------------------------------------
  // COHI-337 — Edit in PPT Editor + Save all to Workbench
  // --------------------------------------------------------------------------

  test("@critical @COHI-337 Edit in PPT Editor creates a canvas with one viz and navigates with ?reportBuilder=1", async ({
    userPage,
  }) => {
    await seedExportPreference(userPage, "ppt");
    const captured = await mockChatAndWorkbench(userPage);
    await userPage.goto("/data-chat", { waitUntil: "domcontentloaded" });
    await askMockQuestion(userPage);

    const editButton = userPage.getByTestId("cohi-chat-edit-in-ppt").first();
    await expect(editButton).toBeVisible();
    await expect(editButton).toHaveText(/Edit in PPT Editor/);

    await editButton.click();

    await expect
      .poll(() => captured.canvasBodies.length, {
        message: "waiting for workbench canvas POST",
        timeout: 15_000,
      })
      .toBeGreaterThan(0);

    await expect(userPage).toHaveURL(
      new RegExp(`/my-dashboard/${MOCK_CANVAS_ID}\\?reportBuilder=1`),
    );

    const body = captured.canvasBodies[0] as {
      layout: unknown[];
      title?: string;
    };
    expect(Array.isArray(body.layout)).toBe(true);
    expect(body.layout.length).toBeGreaterThan(0);
  });

  test("@critical @COHI-337 Save all to Workbench exports every chart from the chat", async ({
    userPage,
  }) => {
    await seedExportPreference(userPage, "ppt");
    const captured = await mockChatAndWorkbench(userPage);
    await userPage.goto("/data-chat", { waitUntil: "domcontentloaded" });
    await askMockQuestion(userPage);

    // Ask again so there are two viz messages to bundle up.
    await askMockQuestion(userPage, "Show me revenue again");
    await expect(userPage.getByTestId("cohi-chat-viz")).toHaveCount(2);

    await userPage.getByTestId("cohi-chat-save-all-to-workbench").click();

    await expect
      .poll(() => captured.canvasBodies.length, {
        message: "waiting for bulk-export canvas POST",
        timeout: 15_000,
      })
      .toBeGreaterThan(0);

    // Bulk-export navigates to /my-dashboard?canvas=<id> which the app route
    // config redirects to /workbench (the canvas hub). Either URL is
    // acceptable for this test — we only assert the user was sent somewhere
    // on the Workbench side of the app, not the editor (?reportBuilder=1).
    await expect(userPage).toHaveURL(
      /\/(my-dashboard|workbench)(\?|$|\/)/,
    );
    await expect(userPage).not.toHaveURL(/reportBuilder=1/);

    const body = captured.canvasBodies.at(-1) as {
      layout: Array<{
        type?: string;
        payload?: { type?: string; items?: unknown[] };
      }>;
    };
    expect(Array.isArray(body.layout)).toBe(true);
    expect(body.layout.length).toBeGreaterThan(0);

    // SQL-backed chat visualizations are intentionally bundled into a single
    // `widget_group` by `convertChatToCanvasItems()` rather than emitted as
    // one top-level layout item per chart. Two asks therefore become one
    // widget_group whose nested `items` array contains both chat charts.
    const widgetGroup = body.layout.find(
      (item) =>
        item?.type === "widget_group" || item?.payload?.type === "widget_group",
    );
    expect(widgetGroup, "expected a widget_group for SQL-backed chat export").toBeTruthy();
    expect(widgetGroup?.payload?.items?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  // --------------------------------------------------------------------------
  // COHI-335 — Persistence + panel-clipping regression
  // --------------------------------------------------------------------------

  test("@critical @COHI-335 assistant bubble rehydrates chart from persisted session metadata", async ({
    userPage,
  }) => {
    await userPage.addInitScript(() => {
      try {
        window.localStorage.setItem("cohi_e2e_legacy_chat_only", "1");
      } catch {
        /* noop */
      }
    });
    // Regression for: chart disappeared on reload because backend only saved
    // `hasVisualization` flag but not the full viz config. The client reads
    // `metadata.visualization` directly on loadSession; this test loads a
    // session whose metadata IS populated and asserts the chart comes back.
    await seedExportPreference(userPage, "ppt");
    await mockChatAndWorkbench(userPage);
    await mockSessionLoad(userPage, MOCK_SESSION_ID);

    // Override the sessions list to include our one pre-existing session.
    await userPage.route(/\/api\/cohi-chat\/sessions(\?|$)/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          sessions: [
            {
              id: MOCK_SESSION_ID,
              title: "Top 10 loan officers",
              messageCount: 2,
              lastMessageAt: "2026-04-22T12:00:01.000Z",
              createdAt: "2026-04-22T12:00:00.000Z",
            },
          ],
        }),
      });
    });

    await userPage.goto("/data-chat", { waitUntil: "domcontentloaded" });
    const chatPanel = userPage.getByTestId("cohi-chat-panel");
    await expect(chatPanel).toBeVisible();

    // Open the history panel and pick our session.
    await chatPanel.locator('[data-chat-history-toggle="true"]').click();
    const sessionItem = chatPanel
      .locator(
        `[data-testid="cohi-chat-history-item"][data-session-id="${MOCK_SESSION_ID}"]`,
      )
      .first();
    await expect(sessionItem).toBeVisible({ timeout: 10_000 });
    await sessionItem.click();

    // The chart must rehydrate from metadata.visualization, not vanish.
    const chart = chatPanel.getByTestId("cohi-chat-viz").first();
    await expect(chart).toBeVisible({ timeout: 15_000 });
    await expect(chart.locator("svg").first()).toBeVisible({ timeout: 15_000 });
    await expect
      .poll(
        async () => await chart.locator("svg").first().locator("path[d], rect, text").count(),
        { timeout: 15_000, message: "waiting for rehydrated chart SVG content" },
      )
      .toBeGreaterThan(5);

    // The export controls must be wired up for the hydrated message too.
    await expect(
      chatPanel.getByTestId("cohi-chat-export-primary").first(),
    ).toBeVisible();
    await expect(
      chatPanel.getByTestId("cohi-chat-edit-in-ppt").first(),
    ).toBeVisible();

    await userPage.evaluate(() => {
      try {
        localStorage.removeItem("cohi_e2e_legacy_chat_only");
      } catch {
        /* noop */
      }
    });
  });

  test("@critical @COHI-335 chart bubble stays within the chat panel (no right-edge clipping)", async ({
    userPage,
  }) => {
    // Regression for: Radix ScrollArea viewport wrapped children in
    // <div style="display:table;min-width:100%">, so intrinsic-width Recharts
    // SVGs stretched the wrapper past the panel's right edge. We replaced
    // ScrollArea with a native overflow div; this test locks that in.
    await seedExportPreference(userPage, "ppt");
    await mockChatAndWorkbench(userPage);
    await userPage.goto("/data-chat", { waitUntil: "domcontentloaded" });
    await askMockQuestion(userPage);

    const chatPanel = userPage.getByTestId("cohi-chat-panel");
    const vizWrapper = userPage.getByTestId("cohi-chat-viz").first();

    const panelBox = await chatPanel.boundingBox();
    const vizBox = await vizWrapper.boundingBox();
    expect(panelBox, "chat panel should have a layout box").not.toBeNull();
    expect(vizBox, "viz wrapper should have a layout box").not.toBeNull();

    // The chart's right edge must sit at or inside the panel's right edge.
    // A 1-pixel rounding tolerance accounts for subpixel box models.
    expect(
      vizBox!.x + vizBox!.width,
      `viz right = ${vizBox!.x + vizBox!.width}, panel right = ${panelBox!.x + panelBox!.width}`,
    ).toBeLessThanOrEqual(panelBox!.x + panelBox!.width + 1);

    // Same check for the action footer – that's where the clipping showed up
    // most visibly before the fix (overflow-menu icon was hidden).
    const footer = userPage.getByTestId("cohi-chat-viz-footer").first();
    const footerBox = await footer.boundingBox();
    expect(footerBox).not.toBeNull();
    expect(footerBox!.x + footerBox!.width).toBeLessThanOrEqual(
      panelBox!.x + panelBox!.width + 1,
    );
  });
});
