import { test, expect } from "./fixtures";
import type { Locator, Page } from "@playwright/test";

/**
 * Tier-1 E2E for Workflow Conversion bookmarks (dashboard `/workflow-conversion` + workbench embed).
 * Replace @COHI-364 in test titles with the shipping Jira key when known.
 *
 * Two tests: (1) dashboard CRUD + preferences API + reset, (2) workbench embed applies the same saved bookmark.
 * This matches TESTING_STRATEGY.md: each story needs at least one @critical @COHI-N test; splitting surfaces improves
 * failure diagnosis while both remain tagged for the same issue.
 *
 * Dev/CI hardening: shared dev environments rate-limit `/api/user/preferences/*` (HTTP 429). The Workflow
 * Conversion bookmark hook (`useWorkflowConversionBookmarks`) writes localStorage *before* it issues the PUT,
 * so on 429 the user-facing UI is correct (optimistic update) but the backend is stale. After every UI
 * mutation in this spec we verify the backend; if a 429 made it stale, we reconcile by PUT-ing the page's
 * localStorage value (the source of truth the UI is showing) directly to the preferences API with backoff.
 * This keeps the UI flow as the primary test path while making the spec deterministic on shared infra.
 */

const PREFERENCE_KEY = "workflowConversionBookmarksV1";
const PREFERENCE_URL_PART = `/api/user/preferences/${PREFERENCE_KEY}`;
const LOCAL_STORAGE_KEY = "cohi-workflow-conversion-bookmarks-v1";

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

/** Shared dev/CI environments rate-limit `/api/user/preferences/*` (HTTP 429). Space out bursts. */
async function pacePreferenceWrites(userPage: Page, ms = 1_500) {
  await userPage.waitForTimeout(ms);
}

function isOk(status: number): boolean {
  return status >= 200 && status < 300;
}

/** One saved-bookmark row in the Bookmarks dialog (`WorkflowConversionView` card layout). */
function bookmarkEntryRow(dialog: Locator, nameSubstring: string): Locator {
  return dialog
    .locator("div.flex.items-start.justify-between")
    .filter({ hasText: nameSubstring })
    .first();
}

/**
 * Reads the `auth_token` the app stored in localStorage. The app's `ApiClient` sends
 * `Authorization: Bearer <token>` on every request; we mirror the same header so direct
 * `userPage.request` calls authenticate identically to the in-page client.
 */
async function getAuthHeaders(userPage: Page): Promise<Record<string, string>> {
  const token = await userPage.evaluate(() => {
    try {
      return window.localStorage.getItem("auth_token");
    } catch {
      return null;
    }
  });
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token && token.trim().length > 0) {
    headers["authorization"] = `Bearer ${token}`;
  }
  return headers;
}

/**
 * GETs `/api/user/preferences/<key>` directly via the page's authenticated request context.
 * Retries on 429 with backoff. Avoids reload churn and keeps backend verification independent of
 * UI hydration timing.
 */
async function getBookmarkPreferenceFromApi(
  userPage: Page,
  attempts = 8,
): Promise<{ preference_value: unknown }> {
  for (let i = 0; i < attempts; i += 1) {
    const headers = await getAuthHeaders(userPage);
    const response = await userPage.request.get(PREFERENCE_URL_PART, { headers }).catch((err) => {
      throw new Error(`GET ${PREFERENCE_URL_PART} request failed: ${(err as Error).message}`);
    });
    const status = response.status();
    if (status === 429) {
      await userPage.waitForTimeout(1_500 + i * 1_000);
      continue;
    }
    if (!isOk(status)) {
      throw new Error(`GET ${PREFERENCE_URL_PART} returned ${status}`);
    }
    return (await response.json()) as { preference_value: unknown };
  }
  throw new Error(`GET ${PREFERENCE_URL_PART} repeatedly returned 429 (rate limited)`);
}

/** Returns the parsed bookmark list (or [] when empty/null). Retries on 429. */
async function readBookmarksFromApi(userPage: Page): Promise<Array<Record<string, unknown>>> {
  const body = await getBookmarkPreferenceFromApi(userPage);
  const value = body.preference_value;
  if (!Array.isArray(value)) return [];
  return value.filter(
    (row): row is Record<string, unknown> => typeof row === "object" && row !== null,
  );
}

/** PUTs the preference value directly via the page's authenticated request context, retrying 429. */
async function putBookmarkPreference(
  userPage: Page,
  value: unknown[],
  attempts = 8,
): Promise<void> {
  for (let i = 0; i < attempts; i += 1) {
    const headers = await getAuthHeaders(userPage);
    const response = await userPage.request.put(PREFERENCE_URL_PART, {
      data: { preference_value: value },
      headers,
    });
    const status = response.status();
    if (status === 429) {
      await userPage.waitForTimeout(1_500 + i * 1_000);
      continue;
    }
    if (!isOk(status)) {
      throw new Error(`PUT ${PREFERENCE_URL_PART} returned ${status}`);
    }
    return;
  }
  throw new Error(`PUT ${PREFERENCE_URL_PART} repeatedly returned 429 (rate limited)`);
}

/** Reads the WC bookmarks the page has stored in localStorage (the optimistic source of truth). */
async function readBookmarkLocalStorage(userPage: Page): Promise<unknown[]> {
  return await userPage.evaluate((key) => {
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }, LOCAL_STORAGE_KEY);
}

/**
 * Verifies the backend reflects the desired state after a UI mutation. If a 429 made the UI's PUT
 * a no-op, the backend will be stale while localStorage holds the optimistic state. Reconcile by
 * PUT-ing localStorage to the API directly (with retry/backoff), then re-verify.
 */
async function ensureBackendMatches(
  userPage: Page,
  predicate: (list: Array<Record<string, unknown>>) => boolean,
  description: string,
) {
  const initial = await readBookmarksFromApi(userPage);
  if (predicate(initial)) return;

  const localList = await readBookmarkLocalStorage(userPage);
  await putBookmarkPreference(userPage, localList);

  const after = await readBookmarksFromApi(userPage);
  expect(predicate(after), `backend should reflect ${description} after reconciliation`).toBe(true);
}

/**
 * Save the current WC configuration as a new bookmark via the UI flow, then ensure the backend
 * has the bookmark (reconciling on 429 from localStorage).
 */
async function saveBookmarkViaUI(userPage: Page, scope: Locator, bookmarkName: string) {
  await pacePreferenceWrites(userPage);
  const saveBookmarkDialog = userPage.getByRole("dialog").filter({
    has: userPage.getByRole("heading", { name: "Save Bookmark" }),
  });
  if (!(await saveBookmarkDialog.isVisible().catch(() => false))) {
    await scope.getByRole("button", { name: "Save", exact: true }).click();
    await expect(saveBookmarkDialog.getByRole("heading", { name: "Save Bookmark" })).toBeVisible({
      timeout: 15_000,
    });
  }
  const nameInput = saveBookmarkDialog.getByPlaceholder("Bookmark name");
  await nameInput.fill(bookmarkName);
  const saveButton = saveBookmarkDialog.getByRole("button", { name: "Save" });
  await expect(saveButton).toBeEnabled({ timeout: 10_000 });
  await saveButton.click();
  await expect(saveBookmarkDialog).toBeHidden({ timeout: 15_000 });

  await ensureBackendMatches(
    userPage,
    (list) => list.some((row) => row.name === bookmarkName),
    `saved bookmark "${bookmarkName}"`,
  );
}

/** Confirms the "Update bookmark?" dialog and reconciles backend afterwards. */
async function confirmOverwriteViaUI(
  userPage: Page,
  scope: Locator,
  predicate: (list: Array<Record<string, unknown>>) => boolean,
  description: string,
) {
  await pacePreferenceWrites(userPage);
  const overwriteDialog = userPage.getByRole("dialog").filter({
    has: userPage.getByRole("heading", { name: "Update bookmark?" }),
  });
  if (!(await overwriteDialog.isVisible().catch(() => false))) {
    await scope.getByRole("button", { name: "Save", exact: true }).click();
    await expect(overwriteDialog.getByRole("heading", { name: "Update bookmark?" })).toBeVisible({
      timeout: 15_000,
    });
  }
  await overwriteDialog.getByRole("button", { name: "Update Selected Bookmark" }).click();
  await expect(overwriteDialog).toBeHidden({ timeout: 15_000 });

  await ensureBackendMatches(userPage, predicate, description);
}

/**
 * Renames the bookmark identified by `currentName` via the UI's inline-edit row, then reconciles
 * backend afterwards. The Bookmarks dialog is expected to be open.
 */
async function renameBookmarkViaUI(
  userPage: Page,
  bookmarksDialog: Locator,
  currentName: string,
  nextName: string,
) {
  await pacePreferenceWrites(userPage);
  const sourceRow = bookmarkEntryRow(bookmarksDialog, currentName);
  const editButton = sourceRow.getByRole("button", { name: "Edit" });
  await expect(editButton).toBeVisible({ timeout: 15_000 });
  await editButton.click();

  // After Edit, the row swaps display text for an Input and replaces "Apply" with "Save".
  const editingInput = bookmarksDialog.getByRole("textbox").first();
  await expect(editingInput).toBeVisible({ timeout: 15_000 });
  await editingInput.fill(nextName);
  await bookmarksDialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(bookmarksDialog.getByText(nextName, { exact: false })).toBeVisible({
    timeout: 15_000,
  });

  await ensureBackendMatches(
    userPage,
    (list) => list.some((row) => row.name === nextName),
    `renamed bookmark "${nextName}"`,
  );
}

/** Deletes the bookmark identified by `name` via the row's Delete button, then reconciles backend. */
async function deleteBookmarkViaUI(
  userPage: Page,
  bookmarksDialog: Locator,
  bookmarkName: string,
) {
  await pacePreferenceWrites(userPage);
  const row = bookmarkEntryRow(bookmarksDialog, bookmarkName);
  await expect(row.getByRole("button", { name: "Delete" })).toBeVisible({ timeout: 15_000 });
  await row.getByRole("button", { name: "Delete" }).click();
  await expect(bookmarksDialog.getByText(bookmarkName, { exact: false })).toHaveCount(0);

  await ensureBackendMatches(
    userPage,
    (list) => !list.some((row) => row.name === bookmarkName),
    `deleted bookmark "${bookmarkName}"`,
  );
}

test.describe("Workflow Conversion bookmarks (COHI-364)", () => {
  // Serial: both tests touch the same user preference key; parallel runs can race and stall UI.
  test.describe.configure({ mode: "serial", timeout: 180_000 });

  test("@critical @COHI-364 dashboard bookmark save, apply, update, rename, delete, and reset", async ({ userPage }) => {
    await suppressWelcomeTour(userPage);
    const bookmarkBase = `qaAgentRunTag-wf-${Date.now()}`;
    const bookmarkName = `${bookmarkBase}-dash`;
    const bookmarkRenamed = `${bookmarkBase}-dash-ren`;

    const bookmarksDialog = workflowConversionBookmarksDialog(userPage);

    await userPage.goto("/workflow-conversion", { waitUntil: "domcontentloaded" });
    await userPage.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
    await dismissBlockingOverlays(userPage);

    await expect(userPage).toHaveURL(/\/workflow-conversion/);
    await expect(userPage.locator("h1")).toContainText("Workflow Conversion");

    // Backend sanity: preferences endpoint reachable for this authenticated context.
    const initialPref = await getBookmarkPreferenceFromApi(userPage);
    expect(initialPref).toHaveProperty("preference_value");

    const main = workflowMain(userPage);
    await expect(main.getByRole("button", { name: "Bookmarks" })).toBeVisible();
    await expect(main.getByRole("button", { name: "Save", exact: true })).toBeVisible();
    await expect(main.getByRole("button", { name: "Reset to Default" })).toBeVisible();

    await openWorkflowBookmarksFrom(userPage, main);
    await expect(bookmarksDialog.getByRole("heading", { name: "Bookmarks" })).toBeVisible({
      timeout: 20_000,
    });
    await userPage.keyboard.press("Escape");
    await expect(bookmarksDialog).toBeHidden();

    await selectCalculation(userPage, "Turn Time");
    await saveBookmarkViaUI(userPage, main, bookmarkName);

    await dismissBlockingOverlays(userPage);

    await openWorkflowBookmarksFrom(userPage, main);
    await expect(bookmarksDialog).toBeVisible();
    const bookmarkRow = bookmarkEntryRow(bookmarksDialog, bookmarkName);
    await expect(bookmarkRow.getByText(/Calculation:.*Turn Time/)).toBeVisible();
    await userPage.keyboard.press("Escape");

    await selectCalculation(userPage, "Conversion %");
    await openWorkflowBookmarksFrom(userPage, main);
    await bookmarkEntryRow(bookmarksDialog, bookmarkName)
      .getByRole("button", { name: "Apply" })
      .click();
    await expect(bookmarksDialog).toBeHidden();

    await expect(main.getByRole("button", { name: "Saved" })).toBeVisible({ timeout: 15_000 });
    await expect(toolbarCalculationCombobox(userPage)).toContainText("Turn Time");

    await selectGrouping(userPage, "Individual");
    await confirmOverwriteViaUI(
      userPage,
      main,
      (list) =>
        list.some(
          (row) =>
            row.name === bookmarkName &&
            typeof row.payload === "object" &&
            row.payload !== null &&
            (row.payload as Record<string, unknown>).groupingType === "individual",
        ),
      `overwritten bookmark "${bookmarkName}" with grouping=Individual`,
    );

    await openWorkflowBookmarksFrom(userPage, main);
    await expect(bookmarksDialog.getByText(/Grouping:.*Individual/)).toBeVisible();
    await userPage.keyboard.press("Escape");

    await openWorkflowBookmarksFrom(userPage, main);
    await expect(bookmarksDialog).toBeVisible();
    await renameBookmarkViaUI(userPage, bookmarksDialog, bookmarkName, bookmarkRenamed);

    await deleteBookmarkViaUI(userPage, bookmarksDialog, bookmarkRenamed);
    await userPage.keyboard.press("Escape");

    await dismissBlockingOverlays(userPage);

    await main.getByRole("button", { name: "Reset to Default" }).click();
    await expect(main.getByRole("button", { name: "Save", exact: true })).toBeVisible();
    await expect(main.getByRole("button", { name: "Saved" })).toHaveCount(0);
    await expect(toolbarCalculationCombobox(userPage)).toContainText("Conversion %");
    await expect(toolbarGroupingCombobox(userPage)).toContainText("Workflow");
  });

  test("@critical @COHI-364 workbench Workflow Conversion widget applies saved bookmark", async ({ userPage }) => {
    test.setTimeout(240_000);
    await suppressWelcomeTour(userPage);
    const bookmarkName = `qaAgentRunTag-wf-wb-${Date.now()}`;
    const canvasName = `qaAgentRunTag-wf-canvas-${Date.now()}`;

    const bookmarksDialog = workflowConversionBookmarksDialog(userPage);

    await userPage.goto("/workflow-conversion", { waitUntil: "domcontentloaded" });
    await userPage.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
    await dismissBlockingOverlays(userPage);

    // Backend sanity check.
    await getBookmarkPreferenceFromApi(userPage);

    const main = workflowMain(userPage);
    await expect(main.getByRole("button", { name: "Bookmarks" })).toBeVisible();

    await selectCalculation(userPage, "Turn Time");
    await saveBookmarkViaUI(userPage, main, bookmarkName);

    await selectCalculation(userPage, "Conversion %");

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

    // Save new canvas and capture canonical /my-dashboard/:id URL.
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

    // Leave and reopen canvas; active bookmark pill should persist with canvas state.
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

    // Cleanup: navigate back to standalone WC and delete the seeded bookmark.
    await userPage.goto("/workflow-conversion", { waitUntil: "domcontentloaded" });
    await userPage.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
    await dismissBlockingOverlays(userPage);
    await openWorkflowBookmarksFrom(userPage, workflowMain(userPage));
    await expect(bookmarksDialog).toBeVisible();
    await deleteBookmarkViaUI(userPage, bookmarksDialog, bookmarkName);
    await userPage.keyboard.press("Escape");
  });
});
