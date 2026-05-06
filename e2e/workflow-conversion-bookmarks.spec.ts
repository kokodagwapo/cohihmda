import { test, expect } from "./fixtures";
import type { Locator, Page } from "@playwright/test";

/**
 * Tier-1 E2E for Workflow Conversion bookmarks (dashboard `/workflow-conversion` + workbench embed).
 * Replace @COHI-364 in test titles with the shipping Jira key when known.
 *
 * Two tests: (1) dashboard CRUD + reset, (2) workbench embed applies the same saved bookmark and the
 * active-bookmark pill survives canvas save / reopen. Splitting surfaces improves failure diagnosis
 * while both remain tagged for the same issue (TESTING_STRATEGY.md).
 *
 * CI-stability strategy: shared dev environments aggressively rate-limit `/api/user/preferences/*`
 * (HTTP 429), and the suite has many @critical tests that all touch user preferences in parallel.
 * To keep this spec deterministic without competing for rate-limit budget against other tests, we
 * intercept the Workflow Conversion preference key (`workflowConversionBookmarksV1`) at the network
 * layer and serve it from an in-memory store for the page. The mock keeps the same request/response
 * shape the real backend uses, so the UI exercises its full save/apply/edit/delete code paths
 * exactly as it would against production. Real backend persistence for the workbench reopen flow is
 * still validated, because the canvas itself is saved through the un-mocked workbench canvas API.
 */

const PREFERENCE_KEY = "workflowConversionBookmarksV1";
const PREFERENCE_URL_GLOB = `**/api/user/preferences/${PREFERENCE_KEY}*`;

/**
 * Per-page mock state for the Workflow Conversion preference. We register a network route that
 * answers GET with the current `bookmarks` value and accepts PUT bodies of the form
 * `{ preference_value: <unknown[]> }` (the contract `useWorkflowConversionBookmarks.saveAll` uses).
 *
 * Returned helpers let tests:
 *  - inspect/seed the simulated backend state directly,
 *  - assert about the latest PUT body if a check needs request-shape coverage,
 *  - dispose the route when the test is done so the page is left in a clean state.
 */
async function installPreferenceMock(userPage: Page) {
  const state = {
    bookmarks: [] as unknown[],
    lastPutBody: null as { preference_value: unknown } | null,
    putCount: 0,
    getCount: 0,
  };

  await userPage.route(PREFERENCE_URL_GLOB, async (route) => {
    const request = route.request();
    const method = request.method();
    if (method === "GET") {
      state.getCount += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ preference_value: state.bookmarks }),
      });
      return;
    }
    if (method === "PUT") {
      state.putCount += 1;
      const raw = request.postData() ?? "{}";
      try {
        const parsed = JSON.parse(raw) as { preference_value?: unknown };
        state.lastPutBody = { preference_value: parsed.preference_value ?? null };
        if (Array.isArray(parsed.preference_value)) {
          state.bookmarks = parsed.preference_value;
        }
      } catch {
        // Ignore malformed bodies; the UI never sends them. The 200 below still simulates success.
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true }),
      });
      return;
    }
    await route.continue();
  });

  return {
    getBookmarks(): Array<Record<string, unknown>> {
      return state.bookmarks.filter(
        (row): row is Record<string, unknown> => typeof row === "object" && row !== null,
      );
    },
    getPutCount() {
      return state.putCount;
    },
    getGetCount() {
      return state.getCount;
    },
    getLastPutBody() {
      return state.lastPutBody;
    },
    async dispose() {
      await userPage.unroute(PREFERENCE_URL_GLOB);
    },
  };
}

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
    await page.waitForTimeout(350);
  }
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

async function addWorkflowConversionSection(userPage: Page) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const dashboardsTab = userPage.getByTestId("workbench-cohi-tab-dashboards");
    const tabVisible = await dashboardsTab.isVisible().catch(() => false);
    if (!tabVisible) {
      await userPage.getByTestId("workbench-cohi-toggle").click();
      await expect(dashboardsTab).toBeVisible({ timeout: 20_000 });
    }

    await dashboardsTab.click();
    await dismissBlockingOverlays(userPage);
    const sectionButton = userPage.getByRole("button", { name: /Workflow Conversion/i }).first();
    await expect(sectionButton).toBeVisible({ timeout: 20_000 });
    await sectionButton.click();

    const addEntireButton = userPage.getByRole("button", { name: "Add entire Workflow Conversion" });
    try {
      await expect(addEntireButton).toBeVisible({ timeout: 15_000 });
      await addEntireButton.click();
      return;
    } catch {
      await userPage.keyboard.press("Escape");
      await userPage.waitForTimeout(350);
    }
  }
  throw new Error("Failed to add Workflow Conversion section to workbench canvas");
}

function workflowMain(userPage: Page) {
  return userPage.locator("main").first();
}

/**
 * Toolbar strip that contains the Workflow Conversion "Bookmarks" control.
 * On workbench, prefer a match under `#workbench-canvas-root` so we never click an off-canvas strip.
 * Elsewhere (e.g. `/workflow-conversion`), match the WC strip via the "Calculation" label (unique vs other Bookmarks UIs).
 */
function workflowConversionToolbar(page: Page) {
  const canvasRoot = page.locator("#workbench-canvas-root");
  const toolbarInCanvas = canvasRoot.locator("div.flex.flex-wrap.items-center").filter({
    has: canvasRoot.getByRole("button", { name: "Bookmarks" }),
  });
  const toolbarByCalculationRow = page
    .locator("div.flex.flex-wrap.items-center")
    .filter({ has: page.getByRole("button", { name: "Bookmarks" }) })
    .filter({ hasText: "Calculation" });
  return toolbarInCanvas.or(toolbarByCalculationRow).first();
}

/** WC bookmarks modal (distinct from Loan Detail and other "Bookmarks" dialogs). */
function workflowConversionBookmarksDialog(page: Page): Locator {
  return page
    .getByRole("dialog")
    .filter({ has: page.getByText(/Saved Workflow Conversion bookmarks/) })
    .last();
}

async function openWorkflowBookmarksFrom(page: Page, scope: Locator) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await dismissBlockingOverlays(page);
    const button = scope.getByRole("button", { name: "Bookmarks" });
    await expect(button).toBeVisible({ timeout: 15_000 });
    try {
      await button.click({ timeout: 10_000 });
      await expect(workflowConversionBookmarksDialog(page)).toBeVisible({ timeout: 20_000 });
      return;
    } catch {
      // Recover from stray modal/backdrop capture and retry.
      await page.keyboard.press("Escape");
      await page.waitForTimeout(300);
    }
  }
  throw new Error("Failed to open Workflow Conversion Bookmarks dialog");
}

/** Calculation select (Conversion % | Turn Time) — only one in the WC toolbar. */
function toolbarCalculationCombobox(page: Page) {
  return workflowConversionToolbar(page)
    .getByRole("combobox")
    .filter({ hasText: /^(Conversion %|Turn Time)$/ })
    .first();
}

/** Grouping select (Workflow | Individual) — only one in the WC toolbar. */
function toolbarGroupingCombobox(page: Page) {
  return workflowConversionToolbar(page)
    .getByRole("combobox")
    .filter({ hasText: /^(Workflow|Individual)$/ })
    .first();
}

async function selectCalculation(page: Page, optionLabel: "Conversion %" | "Turn Time") {
  await expect(workflowConversionToolbar(page)).toBeVisible({ timeout: 30_000 });
  await toolbarCalculationCombobox(page).click();
  await page.getByRole("option", { name: optionLabel }).click();
}

async function selectGrouping(page: Page, optionLabel: "Workflow" | "Individual") {
  await expect(workflowConversionToolbar(page)).toBeVisible({ timeout: 30_000 });
  await toolbarGroupingCombobox(page).click();
  await page.getByRole("option", { name: optionLabel }).click();
}

/** One saved-bookmark row in the Bookmarks dialog (`WorkflowConversionView` card layout). */
function bookmarkEntryRow(dialog: Locator, nameSubstring: string): Locator {
  return dialog
    .locator("div.flex.items-start.justify-between")
    .filter({ hasText: nameSubstring })
    .first();
}

/** Fills the "Save Bookmark" dialog and clicks Save. Assumes the trigger button has been clicked. */
async function fillAndSubmitSaveBookmarkDialog(userPage: Page, bookmarkName: string) {
  const saveBookmarkDialog = userPage.getByRole("dialog").filter({
    has: userPage.getByRole("heading", { name: "Save Bookmark" }),
  });
  await expect(saveBookmarkDialog.getByRole("heading", { name: "Save Bookmark" })).toBeVisible({
    timeout: 15_000,
  });
  await expect(saveBookmarkDialog.getByRole("button", { name: "Save" })).toBeDisabled();
  await saveBookmarkDialog.getByPlaceholder("Bookmark name").fill(bookmarkName);
  await expect(saveBookmarkDialog.getByRole("button", { name: "Save" })).toBeEnabled();
  await saveBookmarkDialog.getByRole("button", { name: "Save" }).click();
  await expect(saveBookmarkDialog).toBeHidden({ timeout: 15_000 });
}

test.describe("Workflow Conversion bookmarks (COHI-364)", () => {
  // Serial: each test installs its own preference mock; serial order keeps logs predictable.
  test.describe.configure({ mode: "serial", timeout: 180_000 });

  test("@critical @COHI-364 dashboard bookmark save, apply, update, rename, delete, and reset", async ({ userPage }) => {
    await suppressWelcomeTour(userPage);
    const mock = await installPreferenceMock(userPage);
    const bookmarkBase = `qaAgentRunTag-wf-${Date.now()}`;
    const bookmarkName = `${bookmarkBase}-dash`;
    const bookmarkRenamed = `${bookmarkBase}-dash-ren`;

    const bookmarksDialog = workflowConversionBookmarksDialog(userPage);

    await userPage.goto("/workflow-conversion", { waitUntil: "domcontentloaded" });
    await userPage.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
    await dismissBlockingOverlays(userPage);

    await expect(userPage).toHaveURL(/\/workflow-conversion/);
    await expect(userPage.locator("h1")).toContainText("Workflow Conversion");
    expect(mock.getGetCount(), "preferences endpoint should be reached on initial load").toBeGreaterThan(0);

    const main = workflowMain(userPage);
    await expect(main.getByRole("button", { name: "Bookmarks" })).toBeVisible();
    await expect(main.getByRole("button", { name: "Save", exact: true })).toBeVisible();
    await expect(main.getByRole("button", { name: "Reset to Default" })).toBeVisible();

    // Empty state: open the bookmarks dialog without any bookmarks saved yet.
    await openWorkflowBookmarksFrom(userPage, main);
    await expect(bookmarksDialog.getByRole("heading", { name: "Bookmarks" })).toBeVisible({
      timeout: 20_000,
    });
    await userPage.keyboard.press("Escape");
    await expect(bookmarksDialog).toBeHidden();

    // Save: change calculation to Turn Time and save as a new bookmark.
    await selectCalculation(userPage, "Turn Time");
    await main.getByRole("button", { name: "Save", exact: true }).click();
    await fillAndSubmitSaveBookmarkDialog(userPage, bookmarkName);
    expect(
      mock.getBookmarks().some((row) => row.name === bookmarkName),
      "saved bookmark should be persisted via PUT to preferences API",
    ).toBe(true);

    // Verify the saved bookmark renders with the chosen calculation.
    await openWorkflowBookmarksFrom(userPage, main);
    const bookmarkRow = bookmarkEntryRow(bookmarksDialog, bookmarkName);
    await expect(bookmarkRow.getByText(/Calculation:.*Turn Time/)).toBeVisible();
    await userPage.keyboard.press("Escape");

    // Apply: switch toolbar to Conversion %, then re-apply the saved bookmark.
    await selectCalculation(userPage, "Conversion %");
    await openWorkflowBookmarksFrom(userPage, main);
    await bookmarkEntryRow(bookmarksDialog, bookmarkName)
      .getByRole("button", { name: "Apply" })
      .click();
    await expect(bookmarksDialog).toBeHidden();
    await expect(main.getByRole("button", { name: "Saved" })).toBeVisible({ timeout: 15_000 });
    await expect(toolbarCalculationCombobox(userPage)).toContainText("Turn Time");

    // Update: change grouping and confirm the overwrite ("Update bookmark?") prompt.
    await selectGrouping(userPage, "Individual");
    await main.getByRole("button", { name: "Save", exact: true }).click();
    const overwriteDialog = userPage.getByRole("dialog").filter({
      has: userPage.getByRole("heading", { name: "Update bookmark?" }),
    });
    await expect(overwriteDialog.getByRole("heading", { name: "Update bookmark?" })).toBeVisible();
    await overwriteDialog.getByRole("button", { name: "Update Selected Bookmark" }).click();
    await expect(overwriteDialog).toBeHidden({ timeout: 15_000 });
    expect(
      mock.getBookmarks().some(
        (row) =>
          row.name === bookmarkName &&
          typeof row.payload === "object" &&
          row.payload !== null &&
          (row.payload as Record<string, unknown>).groupingType === "individual",
      ),
      "overwritten bookmark should record the new grouping in its payload",
    ).toBe(true);

    await openWorkflowBookmarksFrom(userPage, main);
    await expect(bookmarksDialog.getByText(/Grouping:.*Individual/)).toBeVisible();
    await userPage.keyboard.press("Escape");

    // Rename: edit the name in-line and save.
    await openWorkflowBookmarksFrom(userPage, main);
    await bookmarkEntryRow(bookmarksDialog, bookmarkName)
      .getByRole("button", { name: "Edit" })
      .click();
    const editingInput = bookmarksDialog.getByRole("textbox").first();
    await expect(editingInput).toBeVisible();
    await editingInput.fill(bookmarkRenamed);
    await bookmarksDialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(bookmarksDialog.getByText(bookmarkRenamed, { exact: false })).toBeVisible();
    expect(
      mock.getBookmarks().some((row) => row.name === bookmarkRenamed),
      "renamed bookmark should be persisted via PUT to preferences API",
    ).toBe(true);

    // Delete: remove the renamed bookmark and confirm it is gone from the dialog and the mock.
    const renamedRow = bookmarkEntryRow(bookmarksDialog, bookmarkRenamed);
    await renamedRow.getByRole("button", { name: "Delete" }).click();
    await expect(bookmarksDialog.getByText(bookmarkRenamed, { exact: false })).toHaveCount(0);
    expect(
      mock.getBookmarks().some((row) => row.name === bookmarkRenamed),
      "deleted bookmark should be removed via PUT to preferences API",
    ).toBe(false);
    await userPage.keyboard.press("Escape");

    // Reset: restoring defaults should clear the active bookmark pill and reset the toolbar.
    await dismissBlockingOverlays(userPage);
    await main.getByRole("button", { name: "Reset to Default" }).click();
    await expect(main.getByRole("button", { name: "Save", exact: true })).toBeVisible();
    await expect(main.getByRole("button", { name: "Saved" })).toHaveCount(0);
    await expect(toolbarCalculationCombobox(userPage)).toContainText("Conversion %");
    await expect(toolbarGroupingCombobox(userPage)).toContainText("Workflow");

    await mock.dispose();
  });

  test("@critical @COHI-364 workbench Workflow Conversion widget applies saved bookmark", async ({ userPage }) => {
    test.setTimeout(240_000);
    await suppressWelcomeTour(userPage);
    const mock = await installPreferenceMock(userPage);
    const bookmarkName = `qaAgentRunTag-wf-wb-${Date.now()}`;
    const canvasName = `qaAgentRunTag-wf-canvas-${Date.now()}`;

    const bookmarksDialog = workflowConversionBookmarksDialog(userPage);

    await userPage.goto("/workflow-conversion", { waitUntil: "domcontentloaded" });
    await userPage.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
    await dismissBlockingOverlays(userPage);

    const main = workflowMain(userPage);
    await expect(main.getByRole("button", { name: "Bookmarks" })).toBeVisible();

    // Seed the bookmark from the dashboard surface.
    await selectCalculation(userPage, "Turn Time");
    await main.getByRole("button", { name: "Save", exact: true }).click();
    await fillAndSubmitSaveBookmarkDialog(userPage, bookmarkName);
    expect(
      mock.getBookmarks().some((row) => row.name === bookmarkName),
      "seeded bookmark should be persisted via PUT to preferences API",
    ).toBe(true);

    // Reset the in-page calculation back so applying the bookmark causes a visible change.
    await selectCalculation(userPage, "Conversion %");

    // Add a Workflow Conversion section to a new canvas and apply the saved bookmark from there.
    await gotoNewWorkbenchCanvas(userPage);
    await addWorkflowConversionSection(userPage);
    await userPage.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
    await dismissBlockingOverlays(userPage);

    const toolbar = workflowConversionToolbar(userPage);
    await expect(toolbar).toBeVisible({ timeout: 30_000 });
    await expect(toolbar.getByRole("button", { name: "Bookmarks" })).toBeVisible();
    await openWorkflowBookmarksFrom(userPage, toolbar);
    await expect(bookmarksDialog).toBeVisible({ timeout: 30_000 });
    await bookmarkEntryRow(bookmarksDialog, bookmarkName)
      .getByRole("button", { name: "Apply" })
      .click();
    await expect(bookmarksDialog).toBeHidden();

    await expect(toolbarCalculationCombobox(userPage)).toContainText("Turn Time", {
      timeout: 20_000,
    });
    await expect(toolbar.getByText(bookmarkName, { exact: false })).toBeVisible({
      timeout: 20_000,
    });

    // Save the canvas (real /api/workbench/canvases/* endpoint — not mocked) and capture canonical URL.
    const saveButton = userPage.getByTestId("workbench-save-button");
    await expect(saveButton).toBeVisible({ timeout: 20_000 });
    await expect(saveButton).toBeEnabled({ timeout: 20_000 });
    await saveButton.click();
    const saveCanvasDialog = userPage.getByRole("dialog").filter({
      has: userPage.getByRole("heading", { name: /save canvas/i }),
    });
    const saveCanvasVisible = await saveCanvasDialog.isVisible().catch(() => false);
    if (saveCanvasVisible) {
      const titleInput = saveCanvasDialog.getByPlaceholder("Untitled canvas");
      await titleInput.fill(canvasName);
      await saveCanvasDialog.getByRole("button", { name: "Save" }).click();
      await expect(saveCanvasDialog).toBeHidden({ timeout: 20_000 });
    }
    await userPage.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
    const savedCanvasUrl = userPage.url();
    expect(savedCanvasUrl).toMatch(/\/my-dashboard\/(?!new\b)[^/?#]+/);

    // Leave and reopen the canvas; the active bookmark pill should persist with canvas state.
    await userPage.goto("/workflow-conversion", { waitUntil: "domcontentloaded" });
    await userPage.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
    await userPage.goto(savedCanvasUrl, { waitUntil: "domcontentloaded" });
    await userPage.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
    await dismissBlockingOverlays(userPage);

    const reopenedToolbar = workflowConversionToolbar(userPage);
    await expect(reopenedToolbar).toBeVisible({ timeout: 30_000 });
    await expect(reopenedToolbar.getByText(bookmarkName, { exact: false })).toBeVisible({
      timeout: 20_000,
    });
    await expect(toolbarCalculationCombobox(userPage)).toContainText("Turn Time", {
      timeout: 20_000,
    });

    await mock.dispose();
  });
});
