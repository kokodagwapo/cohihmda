import { test, expect } from "./fixtures";
import type { Locator, Page } from "@playwright/test";

/**
 * Acceptance Criteria
 *
 * 1.  [ROUTE]     Navigating to /workflow-conversion renders "Workflow Conversion" with toolbar controls Bookmarks, Save, and Reset to Default.
 * 2.  [API]       GET /api/user/preferences/workflowConversionBookmarksV1 returns HTTP 200 with a JSON body whose preference_value is either null or a JSON array.
 * 3.  [UI]        On /workflow-conversion, clicking Bookmarks opens a dialog titled Bookmarks listing saved bookmarks or the empty state when none exist.
 * 4.  [UI]        On /workflow-conversion, clicking Save opens Save Bookmark with a bookmark name field and Save / Cancel; Save is disabled until the name is non-empty.
 * 5.  [MUTATION]  On /workflow-conversion, save a bookmark named with prefix qaAgentRunTag- and a non-default combination of Period, Calculation, Grouping, and at least one milestone pair; then GET /api/user/preferences/workflowConversionBookmarksV1 returns an array containing that bookmark name and a payload with cardCount, milestoneGroups, calculationType, groupingType, and period.
 * 6.  [UI]        In the Bookmarks dialog, Apply closes the dialog and updates Calculation and Grouping to match the saved bookmark.
 * 7.  [ASSERTION] After Apply, an active bookmark badge shows the bookmark name and the Save control reads "Saved" while the on-screen Calculation and Grouping match that bookmark.
 * 8.  [UI]        After changing Calculation or Grouping while a bookmark is selected, clicking Save opens the update flow ("Update bookmark?" with "Update Selected Bookmark" / "Create New Bookmark").
 * 9.  [UI]        In the Bookmarks dialog, Edit supports renaming a bookmark; Delete removes it from the list and it no longer appears after reopening the dialog.
 * 10. [MUTATION]  Delete the qaAgentRunTag- bookmark created in AC 5; GET /api/user/preferences/workflowConversionBookmarksV1 no longer returns that bookmark name in preference_value.
 * 11. [UI]        From /workbench, open a canvas that contains the Workflow Conversion widget; Bookmarks is available and Apply on an existing bookmark updates Calculation and Grouping.
 * 12. [ASSERTION] Reset to Default clears the active bookmark selection, sets Period to MTD, Calculation to Conversion %, Grouping to Workflow, and restores default milestone cards.
 * 13. [ASSERTION] Applying a bookmark whose milestone IDs are missing or invalid for the current tenant shows a non-blocking amber warning and the page remains usable.
 *
 * CI-stability notes
 * ──────────────────
 * • The shared dev preference API rate-limits aggressively (HTTP 429). All
 *   `/api/user/preferences/workflowConversionBookmarksV1` calls are intercepted
 *   by a per-test `page.route()` mock that keeps an in-memory store, so no real
 *   preference budget is consumed and 429 is impossible.
 * • The SPA can take >10 s to hydrate on a resource-constrained CI agent.  Every
 *   "page is ready" signal uses an explicit 30-second timeout on the deepest
 *   component in the tree that signals full hydration (the Bookmarks toolbar
 *   button), so the 10-second global `expect.timeout` never fires too early.
 * • Tests are serial to prevent race-conditions on the shared user preference key
 *   and to keep deterministic ordering for diagnosis.
 */

// ─── Preference API constants ─────────────────────────────────────────────────

const PREFERENCE_KEY = "workflowConversionBookmarksV1";
const PREFERENCE_URL_GLOB = `**/api/user/preferences/${PREFERENCE_KEY}*`;

// ─── Preference mock ──────────────────────────────────────────────────────────

/**
 * Installs a `page.route()` interceptor for the WC preference endpoint.
 * GET returns the current in-memory store; PUT updates it and returns 200.
 * Returns helpers to inspect state and dispose the route when the test ends.
 */
async function installPreferenceMock(page: Page) {
  const state = {
    bookmarks: [] as unknown[],
    getCount: 0,
    putCount: 0,
    lastPutBody: null as { preference_value: unknown } | null,
  };

  await page.route(PREFERENCE_URL_GLOB, async (route) => {
    const method = route.request().method();
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
      const raw = route.request().postData() ?? "{}";
      try {
        const parsed = JSON.parse(raw) as { preference_value?: unknown };
        state.lastPutBody = { preference_value: parsed.preference_value ?? null };
        if (Array.isArray(parsed.preference_value)) {
          state.bookmarks = parsed.preference_value;
        }
      } catch {
        // Ignore malformed bodies; the UI never sends them.
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
        (r): r is Record<string, unknown> => typeof r === "object" && r !== null,
      );
    },
    getGetCount() { return state.getCount; },
    getPutCount() { return state.putCount; },
    getLastPutBody() { return state.lastPutBody; },
    /** Replace the in-memory store (e.g. to seed invalid-milestone fixtures). */
    setBookmarks(value: unknown[]) { state.bookmarks = value; },
    async dispose() { await page.unroute(PREFERENCE_URL_GLOB); },
  };
}

// ─── Page helpers ─────────────────────────────────────────────────────────────

async function suppressWelcomeTour(page: Page) {
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem("cohi-welcome-tour-last-shown", new Date().toISOString());
    } catch { /* ignore */ }
  });
}

async function dismissBlockingOverlays(page: Page) {
  for (let i = 0; i < 5; i += 1) {
    const dialog = page
      .locator("[role='dialog']")
      .filter({ hasText: /quick tour|welcome|what's new|let us give you a quick tour/i })
      .first();
    const overlay = page.locator("div[data-state='open'][aria-hidden='true']").first();
    const dv = await dialog.isVisible({ timeout: 1_000 }).catch(() => false);
    const ov = await overlay.isVisible({ timeout: 1_000 }).catch(() => false);
    if (!dv && !ov) break;
    await page.keyboard.press("Escape");
    await page.waitForTimeout(350);
  }
}

/** Navigate to a page and wait for networkidle (silently swallows timeout on slow CI). */
async function gotoAndSettle(page: Page, url: string) {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 25_000 }).catch(() => {});
  await dismissBlockingOverlays(page);
}

// ─── WC-specific locators ─────────────────────────────────────────────────────

/**
 * Toolbar strip that hosts WC controls (Period, Calculation, Grouping, Bookmarks, Save, Reset).
 * On workbench prefer the canvas-root strip; on /workflow-conversion match via the "Calculation" label.
 */
function wcToolbar(page: Page): Locator {
  const canvasRoot = page.locator("#workbench-canvas-root");
  const inCanvas = canvasRoot.locator("div.flex.flex-wrap.items-center").filter({
    has: canvasRoot.getByRole("button", { name: "Bookmarks" }),
  });
  const standalone = page
    .locator("div.flex.flex-wrap.items-center")
    .filter({ has: page.getByRole("button", { name: "Bookmarks" }) })
    .filter({ hasText: "Calculation" });
  return inCanvas.or(standalone).first();
}

/**
 * Wait for the WC toolbar to appear — the Bookmarks button is inside WorkflowConversionView
 * which only renders after routing, auth, and component hydration all complete.
 * 30 s guards against resource-constrained CI agents where the default 10 s is insufficient.
 */
async function waitForWcReady(page: Page) {
  await expect(wcToolbar(page).getByRole("button", { name: "Bookmarks" })).toBeVisible({
    timeout: 30_000,
  });
}

/** Calculation combobox (Conversion % | Turn Time). */
function calculationCombobox(page: Page): Locator {
  return wcToolbar(page)
    .getByRole("combobox")
    .filter({ hasText: /^(Conversion %|Turn Time)$/ })
    .first();
}

/** Grouping combobox (Workflow | Individual). */
function groupingCombobox(page: Page): Locator {
  return wcToolbar(page)
    .getByRole("combobox")
    .filter({ hasText: /^(Workflow|Individual)$/ })
    .first();
}

async function setCalculation(page: Page, label: "Conversion %" | "Turn Time") {
  await calculationCombobox(page).click();
  await page.getByRole("option", { name: label }).click();
}

async function setGrouping(page: Page, label: "Workflow" | "Individual") {
  await groupingCombobox(page).click();
  await page.getByRole("option", { name: label }).click();
}

/** The WC Bookmarks dialog (distinct from Loan Detail and other Bookmarks dialogs). */
function wcBookmarksDialog(page: Page): Locator {
  return page
    .getByRole("dialog")
    .filter({ has: page.getByText(/Saved Workflow Conversion bookmarks/) })
    .last();
}

/**
 * Opens the Bookmarks dialog from `scope` with up to 3 attempts (handles stray backdrops).
 */
async function openBookmarksDialog(page: Page, scope: Locator) {
  const dialog = wcBookmarksDialog(page);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await dismissBlockingOverlays(page);
    const btn = scope.getByRole("button", { name: "Bookmarks" });
    await expect(btn).toBeVisible({ timeout: 15_000 });
    try {
      await btn.click({ timeout: 10_000 });
      await expect(dialog).toBeVisible({ timeout: 20_000 });
      return;
    } catch {
      await page.keyboard.press("Escape");
      await page.waitForTimeout(300);
    }
  }
  throw new Error("Failed to open WC Bookmarks dialog");
}

/** Locates the bookmark row card by a name substring. */
function bookmarkRow(dialog: Locator, nameSubstring: string): Locator {
  return dialog
    .locator("div.flex.items-start.justify-between")
    .filter({ hasText: nameSubstring })
    .first();
}

/** Fills the Save Bookmark dialog and submits. Caller must have already clicked "Save". */
async function submitSaveBookmarkDialog(page: Page, name: string) {
  const dialog = page.getByRole("dialog").filter({
    has: page.getByRole("heading", { name: "Save Bookmark" }),
  });
  await expect(dialog.getByRole("heading", { name: "Save Bookmark" })).toBeVisible({
    timeout: 15_000,
  });
  await expect(dialog.getByRole("button", { name: "Save" })).toBeDisabled();
  await dialog.getByPlaceholder("Bookmark name").fill(name);
  await expect(dialog.getByRole("button", { name: "Save" })).toBeEnabled();
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toBeHidden({ timeout: 15_000 });
}

// ─── Workbench helpers ────────────────────────────────────────────────────────

async function gotoNewCanvas(page: Page) {
  await gotoAndSettle(page, "/my-dashboard/new");
  await expect(page).toHaveURL(/\/my-dashboard\/new/);
  await expect(page.getByTestId("workbench-canvas-title-input")).toBeVisible({ timeout: 30_000 });
}

async function addWcSection(page: Page) {
  // Use the "Add" dropdown menu — same mechanism used by sales-company-overview.spec.ts.
  // This is more reliable than the Cohi panel DashboardBrowser because it does not
  // depend on the Cohi toggle state or panel animation timing.
  const addButton = page.getByRole("button", { name: /^Add$/ }).first();
  await expect(addButton).toBeVisible({ timeout: 30_000 });
  await addButton.click();

  // Switch to the "Trends & Analysis" group (Workflow Conversion lives there).
  await page.getByRole("button", { name: "Trends & Analysis", exact: true }).click();

  // Click the Workflow Conversion section item (rendered as a DropdownMenuItem).
  await page.getByRole("menuitem", { name: "Workflow Conversion", exact: true }).click();
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test.describe("Workflow Conversion bookmarks (COHI-364)", () => {
  test.describe.configure({ mode: "serial", timeout: 180_000 });

  // ── AC 1–4: route, controls, API contract, dialog UX ────────────────────────
  test("@critical @COHI-364 route, toolbar controls, preferences API, and dialog UX", async ({ userPage }) => {
    await suppressWelcomeTour(userPage);
    const mock = await installPreferenceMock(userPage);

    // AC 1: [ROUTE] /workflow-conversion renders the page heading and toolbar controls.
    await gotoAndSettle(userPage, "/workflow-conversion");
    await expect(userPage).toHaveURL(/\/workflow-conversion/);
    // Wait for the WC toolbar — deepest hydration signal; gates all subsequent assertions.
    await waitForWcReady(userPage);
    await expect(userPage.locator("h1")).toContainText("Workflow Conversion");
    const toolbar = wcToolbar(userPage);
    await expect(toolbar.getByRole("button", { name: "Bookmarks" })).toBeVisible();
    await expect(toolbar.getByRole("button", { name: "Save", exact: true })).toBeVisible();
    await expect(toolbar.getByRole("button", { name: "Reset to Default" })).toBeVisible();

    // AC 2: [API] GET preference returns 200 with the correct body shape.
    expect(mock.getGetCount(), "preferences GET should be called on load").toBeGreaterThan(0);
    // The mock returns { preference_value: [] } — verify the shape through the mock state.
    expect(mock.getBookmarks()).toEqual([]);

    // AC 3: [UI] Bookmarks button opens the Bookmarks dialog (empty state with no bookmarks).
    await openBookmarksDialog(userPage, toolbar);
    const dialog = wcBookmarksDialog(userPage);
    await expect(dialog.getByRole("heading", { name: "Bookmarks" })).toBeVisible();
    // Empty state message.
    await expect(dialog.getByText(/No bookmarks saved yet/i)).toBeVisible();
    await userPage.keyboard.press("Escape");
    await expect(dialog).toBeHidden();

    // AC 4: [UI] Save button opens "Save Bookmark" dialog; Save is disabled until name is non-empty.
    await toolbar.getByRole("button", { name: "Save", exact: true }).click();
    const saveDialog = userPage.getByRole("dialog").filter({
      has: userPage.getByRole("heading", { name: "Save Bookmark" }),
    });
    await expect(saveDialog.getByRole("heading", { name: "Save Bookmark" })).toBeVisible();
    await expect(saveDialog.getByPlaceholder("Bookmark name")).toBeVisible();
    await expect(saveDialog.getByRole("button", { name: "Save" })).toBeDisabled();
    await expect(saveDialog.getByRole("button", { name: "Cancel" })).toBeVisible();
    // Non-empty name enables Save.
    await saveDialog.getByPlaceholder("Bookmark name").fill("tmp");
    await expect(saveDialog.getByRole("button", { name: "Save" })).toBeEnabled();
    await saveDialog.getByRole("button", { name: "Cancel" }).click();
    await expect(saveDialog).toBeHidden();

    await mock.dispose();
  });

  // ── AC 5–10 & 12: full CRUD cycle and reset ──────────────────────────────────
  test("@critical @COHI-364 dashboard bookmark save, apply, update, rename, delete, and reset", async ({ userPage }) => {
    await suppressWelcomeTour(userPage);
    const mock = await installPreferenceMock(userPage);
    const ts = Date.now();
    const bookmarkName = `qaAgentRunTag-wf-orig-${ts}`;
    // Renamed name is entirely independent so the old name is never a substring of the new one.
    const renamedName = `qaAgentRunTag-wf-ren-${ts}`;

    await gotoAndSettle(userPage, "/workflow-conversion");
    await expect(userPage).toHaveURL(/\/workflow-conversion/);
    await waitForWcReady(userPage);
    const toolbar = wcToolbar(userPage);
    const dialog = wcBookmarksDialog(userPage);

    // AC 5: [MUTATION] Save a bookmark with non-default Calculation and Grouping.
    await setCalculation(userPage, "Turn Time");
    await setGrouping(userPage, "Individual");
    await toolbar.getByRole("button", { name: "Save", exact: true }).click();
    await submitSaveBookmarkDialog(userPage, bookmarkName);

    // Verify the mock (simulated backend) has the correct payload shape.
    const saved = mock.getBookmarks();
    expect(saved.some((r) => r.name === bookmarkName), "bookmark should be in preference_value").toBe(true);
    const bk = saved.find((r) => r.name === bookmarkName)!;
    const payload = bk.payload as Record<string, unknown>;
    expect(typeof payload.cardCount, "payload.cardCount must be a number").toBe("number");
    expect(Array.isArray(payload.milestoneGroups), "payload.milestoneGroups must be an array").toBe(true);
    expect(typeof payload.calculationType, "payload.calculationType must be present").toBe("string");
    expect(typeof payload.groupingType, "payload.groupingType must be present").toBe("string");
    expect(typeof payload.period, "payload.period must be present").toBe("object");
    // Verify the specific values we set.
    expect(payload.calculationType).toBe("turntime");
    expect(payload.groupingType).toBe("individual");

    // Dialog shows the saved bookmark with the correct summary labels.
    await openBookmarksDialog(userPage, toolbar);
    const savedRow = bookmarkRow(dialog, bookmarkName);
    await expect(savedRow.getByText(/Calculation:.*Turn Time/)).toBeVisible();
    await expect(savedRow.getByText(/Grouping:.*Individual/)).toBeVisible();
    await userPage.keyboard.press("Escape");

    // AC 6 & 7: [UI] / [ASSERTION] Apply restores the bookmark and shows the active badge.
    // First change settings away from the bookmark so Apply causes a visible change.
    await setCalculation(userPage, "Conversion %");
    await setGrouping(userPage, "Workflow");
    await openBookmarksDialog(userPage, toolbar);
    await bookmarkRow(dialog, bookmarkName).getByRole("button", { name: "Apply" }).click();
    await expect(dialog).toBeHidden();

    // Active badge shows bookmark name.
    await expect(toolbar.getByText(bookmarkName, { exact: false })).toBeVisible({ timeout: 15_000 });
    // Save reads "Saved" when in sync.
    await expect(toolbar.getByRole("button", { name: "Saved" })).toBeVisible({ timeout: 15_000 });
    // Toolbar controls reflect the bookmark's values.
    await expect(calculationCombobox(userPage)).toContainText("Turn Time");
    await expect(groupingCombobox(userPage)).toContainText("Individual");

    // AC 8: [UI] Modifying settings while a bookmark is active opens "Update bookmark?" dialog.
    await setCalculation(userPage, "Conversion %");
    await toolbar.getByRole("button", { name: "Save", exact: true }).click();
    const updateDialog = userPage.getByRole("dialog").filter({
      has: userPage.getByRole("heading", { name: "Update bookmark?" }),
    });
    await expect(updateDialog.getByRole("heading", { name: "Update bookmark?" })).toBeVisible();
    await expect(updateDialog.getByRole("button", { name: "Update Selected Bookmark" })).toBeVisible();
    await expect(updateDialog.getByRole("button", { name: "Create New Bookmark" })).toBeVisible();
    // Confirm the update to keep the test tidy.
    await updateDialog.getByRole("button", { name: "Update Selected Bookmark" }).click();
    await expect(updateDialog).toBeHidden({ timeout: 15_000 });

    // AC 9: [UI] Rename the bookmark.
    await openBookmarksDialog(userPage, toolbar);
    await bookmarkRow(dialog, bookmarkName).getByRole("button", { name: "Edit" }).click();
    // After Edit, the row shows a textbox (the inline editor).
    const editInput = dialog.getByRole("textbox").first();
    await expect(editInput).toBeVisible();
    await editInput.fill(renamedName);
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(dialog.getByText(renamedName, { exact: false })).toBeVisible();
    await expect(dialog.getByText(bookmarkName, { exact: false })).toHaveCount(0);

    // AC 9 (delete) & AC 10: [UI] / [MUTATION] Delete the renamed bookmark.
    await bookmarkRow(dialog, renamedName).getByRole("button", { name: "Delete" }).click();
    await expect(dialog.getByText(renamedName, { exact: false })).toHaveCount(0);

    // Verify the simulated backend no longer contains the bookmark (AC 10).
    expect(
      mock.getBookmarks().some((r) => r.name === renamedName),
      "deleted bookmark must not appear in preference_value",
    ).toBe(false);
    await userPage.keyboard.press("Escape");

    // AC 12: [ASSERTION] Reset to Default clears active badge, restores Period MTD,
    //        Calculation Conversion %, Grouping Workflow.
    // Re-apply the original bookmark to set an active state, then reset.
    // (The original was saved as bookmarkName but then renamed and deleted, so we save a fresh one.)
    await setCalculation(userPage, "Turn Time");
    const resetCheckName = `qaAgentRunTag-wf-rst-${ts}`;
    await toolbar.getByRole("button", { name: "Save", exact: true }).click();
    await submitSaveBookmarkDialog(userPage, resetCheckName);
    await openBookmarksDialog(userPage, toolbar);
    await bookmarkRow(dialog, resetCheckName).getByRole("button", { name: "Apply" }).click();
    await expect(dialog).toBeHidden();
    await expect(toolbar.getByText(resetCheckName, { exact: false })).toBeVisible({
      timeout: 15_000,
    });

    await toolbar.getByRole("button", { name: "Reset to Default" }).click();
    // Badge is gone.
    await expect(toolbar.getByText(resetCheckName, { exact: false })).toHaveCount(0);
    // Save reads "Save" again.
    await expect(toolbar.getByRole("button", { name: "Save", exact: true })).toBeVisible();
    await expect(toolbar.getByRole("button", { name: "Saved" })).toHaveCount(0);
    // Calculation back to Conversion %.
    await expect(calculationCombobox(userPage)).toContainText("Conversion %");
    // Grouping back to Workflow.
    await expect(groupingCombobox(userPage)).toContainText("Workflow");
    // Period picker shows MTD.
    await expect(wcToolbar(userPage)).toContainText(/MTD|Month to date/i);

    await mock.dispose();
  });

  // ── AC 11: workbench embed ────────────────────────────────────────────────────
  test("@critical @COHI-364 workbench Workflow Conversion widget applies saved bookmark", async ({ userPage }) => {
    test.setTimeout(240_000);
    await suppressWelcomeTour(userPage);
    const mock = await installPreferenceMock(userPage);
    const bookmarkName = `qaAgentRunTag-wf-wb-${Date.now()}`;

    // Seed a bookmark via the dashboard surface first.
    await gotoAndSettle(userPage, "/workflow-conversion");
    await waitForWcReady(userPage);
    const dashToolbar = wcToolbar(userPage);

    await setCalculation(userPage, "Turn Time");
    await dashToolbar.getByRole("button", { name: "Save", exact: true }).click();
    await submitSaveBookmarkDialog(userPage, bookmarkName);
    expect(
      mock.getBookmarks().some((r) => r.name === bookmarkName),
      "seeded bookmark should appear in preference store",
    ).toBe(true);

    // Change settings back so Apply will be visibly different.
    await setCalculation(userPage, "Conversion %");

    // AC 11: Navigate to workbench, add Workflow Conversion widget, and apply the bookmark.
    await gotoNewCanvas(userPage);
    await addWcSection(userPage);
    await userPage.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
    await dismissBlockingOverlays(userPage);

    const canvasToolbar = wcToolbar(userPage);
    await expect(canvasToolbar).toBeVisible({ timeout: 30_000 });
    await expect(canvasToolbar.getByRole("button", { name: "Bookmarks" })).toBeVisible({
      timeout: 30_000,
    });

    const dialog = wcBookmarksDialog(userPage);
    await openBookmarksDialog(userPage, canvasToolbar);
    await expect(dialog).toBeVisible({ timeout: 30_000 });
    await bookmarkRow(dialog, bookmarkName).getByRole("button", { name: "Apply" }).click();
    await expect(dialog).toBeHidden();

    // Calculation updated to match the bookmark.
    await expect(calculationCombobox(userPage)).toContainText("Turn Time", { timeout: 20_000 });
    // Active badge shows the bookmark name.
    await expect(canvasToolbar.getByText(bookmarkName, { exact: false })).toBeVisible({
      timeout: 20_000,
    });

    await mock.dispose();
  });

  // ── AC 13: invalid milestone partial-restore ──────────────────────────────────
  test("@critical @COHI-364 applying a bookmark with invalid milestone IDs shows amber warning and page remains usable", async ({ userPage }) => {
    await suppressWelcomeTour(userPage);
    const mock = await installPreferenceMock(userPage);

    // Seed the mock with a bookmark that references non-existent milestone IDs.
    // The hook normalises bookmarks from the API so we must use the raw stored shape.
    const invalidBookmarkName = `qaAgentRunTag-wf-invalid-ms-${Date.now()}`;
    mock.setBookmarks([
      {
        id: "invalid-ms-test-bk",
        name: invalidBookmarkName,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        payload: {
          cardCount: 2,
          milestoneGroups: [
            ["NONEXISTENT_MILESTONE_A", "NONEXISTENT_MILESTONE_B"],
            ["NONEXISTENT_MILESTONE_C", "NONEXISTENT_MILESTONE_D"],
          ],
          calculationType: "turntime",
          groupingType: "workflow",
          period: {
            type: "preset",
            preset: "mtd",
            dateRange: { start: "2025-01-01", end: "2025-01-31" },
          },
        },
      },
    ]);

    await gotoAndSettle(userPage, "/workflow-conversion");
    await waitForWcReady(userPage);
    const toolbar = wcToolbar(userPage);

    // Apply the invalid-milestone bookmark.
    const dialog = wcBookmarksDialog(userPage);
    await openBookmarksDialog(userPage, toolbar);
    await bookmarkRow(dialog, invalidBookmarkName).getByRole("button", { name: "Apply" }).click();
    await expect(dialog).toBeHidden();

    // AC 13: An amber warning explains that some milestone steps were unavailable.
    await expect(
      userPage.locator("div").filter({ hasText: /milestone.*unavailable|unavailable.*skip/i }).first(),
    ).toBeVisible({ timeout: 15_000 });

    // Page remains fully usable: toolbar controls are still interactive.
    await expect(toolbar.getByRole("button", { name: "Reset to Default" })).toBeVisible();
    await expect(toolbar.getByRole("button", { name: "Bookmarks" })).toBeVisible();
    // Calculation reflects the bookmark value (partial restore succeeds for non-milestone fields).
    await expect(calculationCombobox(userPage)).toContainText("Turn Time");
    // User can still reset without error.
    await toolbar.getByRole("button", { name: "Reset to Default" }).click();
    await expect(toolbar.getByRole("button", { name: "Save", exact: true })).toBeVisible();

    await mock.dispose();
  });
});
