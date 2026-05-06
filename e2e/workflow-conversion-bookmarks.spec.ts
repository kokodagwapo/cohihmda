import { test, expect } from "./fixtures";
import type { Locator, Page } from "@playwright/test";

/**
 * Tier-1 E2E for Workflow Conversion bookmarks (dashboard `/workflow-conversion` + workbench embed).
 * Replace @COHI-364 in test titles with the shipping Jira key when known.
 *
 * Two tests: (1) dashboard CRUD + preferences API + reset, (2) workbench embed applies the same saved bookmark.
 * This matches TESTING_STRATEGY.md: each story needs at least one @critical @COHI-N test; splitting surfaces improves
 * failure diagnosis while both remain tagged for the same issue.
 */

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

/** Add Workflow Conversion section via canvas toolbar Add menu. */
async function addWorkflowConversionSection(userPage: Page) {
  const canvasRoot = userPage.locator("#workbench-canvas-root");
  await canvasRoot.getByRole("button", { name: "Add" }).click();
  await userPage.getByRole("button", { name: "Trends & Analysis" }).click();
  await userPage.getByRole("menuitem", { name: "Workflow Conversion" }).click();
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
  return page.getByRole("dialog").filter({
    has: page.getByText(/Saved Workflow Conversion bookmarks/),
  });
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

/** Shared dev/CI environments sometimes rate-limit `/api/user/preferences/*` (HTTP 429). Space out bursts. */
async function pacePreferenceWrites(userPage: Page, ms = 1_000) {
  await userPage.waitForTimeout(ms);
}

/**
 * Waits for a successful preferences GET. Retries on 429 (Too Many Requests) by backing off and reloading,
 * and recovers from a missed listener window by reloading until `timeout`.
 */
async function waitForPreferenceGet(userPage: Page, key: string, timeout = 45_000) {
  const urlPart = `/api/user/preferences/${key}`;
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const slice = Math.min(20_000, Math.max(5_000, deadline - Date.now()));
    let response;
    try {
      response = await userPage.waitForResponse(
        (r) => r.url().includes(urlPart) && r.request().method() === "GET",
        { timeout: slice },
      );
    } catch {
      if (Date.now() >= deadline) {
        throw new Error(`Timed out waiting for GET ${urlPart}`);
      }
      await userPage.waitForTimeout(800);
      await userPage.reload({ waitUntil: "domcontentloaded" });
      continue;
    }
    if (response.status() === 200) return response;
    if (response.status() === 429) {
      await userPage.waitForTimeout(2_500);
      await userPage.reload({ waitUntil: "domcontentloaded" });
      continue;
    }
    expect(response.status(), `GET ${urlPart}`).toBe(200);
    return response;
  }
  throw new Error(`Timed out waiting for 200 GET ${urlPart}`);
}

/** Clicks delete and waits for bookmark PUT; retries when the server returns 429. */
async function clickBookmarkDeleteAndWaitForPut(userPage: Page, deleteButton: Locator, attempts = 5) {
  for (let i = 0; i < attempts; i += 1) {
    const [, res] = await Promise.all([
      deleteButton.click(),
      userPage.waitForResponse(
        (r) =>
          r.url().includes("/api/user/preferences/workflowConversionBookmarksV1") &&
          r.request().method() === "PUT" &&
          r.status() < 500,
        { timeout: 45_000 },
      ),
    ]);
    if (res.status() !== 429) {
      expect(res.status(), "bookmark delete should persist via PUT").toBeLessThan(300);
      return res;
    }
    await pacePreferenceWrites(userPage, 2_000 + i * 1_500);
  }
  throw new Error("bookmark delete PUT repeatedly returned 429 (rate limited)");
}

/** One saved-bookmark row in the Bookmarks dialog (`WorkflowConversionView` card layout). */
function bookmarkEntryRow(dialog: Locator, nameSubstring: string): Locator {
  return dialog.locator("div.flex.items-start.justify-between").filter({ hasText: nameSubstring }).first();
}

test.describe("Workflow Conversion bookmarks (COHI-364)", () => {
  // Serial: both tests touch the same user preference key; parallel runs can race and stall UI.
  test.describe.configure({ mode: "serial", timeout: 120_000 });

  test("@critical @COHI-364 dashboard bookmark save, apply, update, rename, delete, and reset", async ({ userPage }) => {
    await suppressWelcomeTour(userPage);
    const bookmarkBase = `qaAgentRunTag-wf-${Date.now()}`;
    const bookmarkName = `${bookmarkBase}-dash`;
    const bookmarkRenamed = `${bookmarkBase}-dash-ren`;

    const bookmarksDialog = workflowConversionBookmarksDialog(userPage);

    const initialPrefGet = waitForPreferenceGet(userPage, "workflowConversionBookmarksV1");
    await userPage.goto("/workflow-conversion", { waitUntil: "domcontentloaded" });
    const prefResponse = await initialPrefGet;
    expect(prefResponse.status(), "preferences GET should succeed for authenticated context").toBe(200);
    const prefBody = (await prefResponse.json()) as { preference_value: unknown };
    expect(prefBody).toHaveProperty("preference_value");

    await userPage.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
    await dismissBlockingOverlays(userPage);

    await expect(userPage).toHaveURL(/\/workflow-conversion/);
    await expect(userPage.locator("h1")).toContainText("Workflow Conversion");

    const main = workflowMain(userPage);
    await expect(main.getByRole("button", { name: "Bookmarks" })).toBeVisible();
    await expect(main.getByRole("button", { name: "Save", exact: true })).toBeVisible();
    await expect(main.getByRole("button", { name: "Reset to Default" })).toBeVisible();

    await main.getByRole("button", { name: "Bookmarks" }).click();
    await expect(bookmarksDialog.getByRole("heading", { name: "Bookmarks" })).toBeVisible({
      timeout: 20_000,
    });
    await userPage.keyboard.press("Escape");
    await expect(bookmarksDialog).toBeHidden();

    await selectCalculation(userPage, "Turn Time");

    await main.getByRole("button", { name: "Save", exact: true }).click();
    const saveBookmarkDialog = userPage.getByRole("dialog").filter({
      has: userPage.getByRole("heading", { name: "Save Bookmark" }),
    });
    await expect(saveBookmarkDialog.getByRole("heading", { name: "Save Bookmark" })).toBeVisible();
    await expect(saveBookmarkDialog.getByRole("button", { name: "Save" })).toBeDisabled();
    await saveBookmarkDialog.getByPlaceholder("Bookmark name").fill(bookmarkName);
    await expect(saveBookmarkDialog.getByRole("button", { name: "Save" })).toBeEnabled();
    const afterSavePut = userPage.waitForResponse(
      (response) =>
        response.url().includes("/api/user/preferences/workflowConversionBookmarksV1") &&
        response.request().method() === "PUT" &&
        response.status() < 500,
      { timeout: 30_000 },
    );
    await saveBookmarkDialog.getByRole("button", { name: "Save" }).click();
    const putResponse = await afterSavePut;
    expect(putResponse.status(), "bookmark PUT should succeed").toBeLessThan(300);
    await expect(saveBookmarkDialog).toBeHidden({ timeout: 15_000 });

    const afterSaveGet = waitForPreferenceGet(userPage, "workflowConversionBookmarksV1");
    await userPage.reload({ waitUntil: "domcontentloaded" });
    const afterSaveResponse = await afterSaveGet;
    expect(afterSaveResponse.status()).toBe(200);
    const afterBody = (await afterSaveResponse.json()) as { preference_value: unknown[] | null };
    const list = Array.isArray(afterBody.preference_value) ? afterBody.preference_value : [];
    expect(list.some((row) => typeof row === "object" && row && "name" in row && row.name === bookmarkName)).toBe(
      true,
    );

    await userPage.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
    await dismissBlockingOverlays(userPage);

    await main.getByRole("button", { name: "Bookmarks" }).click();
    await expect(bookmarksDialog).toBeVisible();
    const bookmarkRow = bookmarkEntryRow(bookmarksDialog, bookmarkName);
    await expect(bookmarkRow.getByText(/Calculation:.*Turn Time/)).toBeVisible();
    await userPage.keyboard.press("Escape");

    await selectCalculation(userPage, "Conversion %");
    await main.getByRole("button", { name: "Bookmarks" }).click();
    await bookmarksDialog.getByRole("button", { name: "Apply" }).click();
    await expect(bookmarksDialog).toBeHidden();

    await expect(main.getByRole("button", { name: "Saved" })).toBeVisible({ timeout: 15_000 });
    await expect(toolbarCalculationCombobox(userPage)).toContainText("Turn Time");

    await selectGrouping(userPage, "Individual");
    await main.getByRole("button", { name: "Save", exact: true }).click();
    const overwriteDialog = userPage.getByRole("dialog").filter({
      has: userPage.getByRole("heading", { name: "Update bookmark?" }),
    });
    await expect(overwriteDialog.getByRole("heading", { name: "Update bookmark?" })).toBeVisible();
    await overwriteDialog.getByRole("button", { name: "Update Selected Bookmark" }).click();
    await expect(overwriteDialog).toBeHidden({ timeout: 15_000 });
    await pacePreferenceWrites(userPage);

    await main.getByRole("button", { name: "Bookmarks" }).click();
    await expect(bookmarksDialog.getByText(/Grouping:.*Individual/)).toBeVisible();
    await userPage.keyboard.press("Escape");

    const mainAgain = workflowMain(userPage);
    await mainAgain.getByRole("button", { name: "Bookmarks" }).click();
    await expect(bookmarksDialog).toBeVisible();
    await bookmarksDialog.getByRole("button", { name: "Edit" }).click();
    await bookmarksDialog.getByRole("textbox").fill(bookmarkRenamed);
    await bookmarksDialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(bookmarksDialog.getByText(bookmarkRenamed, { exact: false })).toBeVisible();

    const renamedRow = bookmarkEntryRow(bookmarksDialog, bookmarkRenamed);
    await pacePreferenceWrites(userPage);
    await clickBookmarkDeleteAndWaitForPut(userPage, renamedRow.getByRole("button", { name: "Delete" }));
    await expect(bookmarksDialog.getByText(bookmarkRenamed, { exact: false })).toHaveCount(0);
    await userPage.keyboard.press("Escape");

    const afterDeleteGet = waitForPreferenceGet(userPage, "workflowConversionBookmarksV1");
    await userPage.reload({ waitUntil: "domcontentloaded" });
    const afterDeleteResponse = await afterDeleteGet;
    expect(afterDeleteResponse.status()).toBe(200);
    const afterDeleteBody = (await afterDeleteResponse.json()) as { preference_value: unknown[] | null };
    const listAfter = Array.isArray(afterDeleteBody.preference_value) ? afterDeleteBody.preference_value : [];
    expect(listAfter.some((row) => typeof row === "object" && row && "name" in row && row.name === bookmarkRenamed)).toBe(
      false,
    );

    await userPage.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
    await dismissBlockingOverlays(userPage);

    await mainAgain.getByRole("button", { name: "Reset to Default" }).click();
    await expect(mainAgain.getByRole("button", { name: "Save", exact: true })).toBeVisible();
    await expect(mainAgain.getByRole("button", { name: "Saved" })).toHaveCount(0);
    await expect(toolbarCalculationCombobox(userPage)).toContainText("Conversion %");
    await expect(toolbarGroupingCombobox(userPage)).toContainText("Workflow");
  });

  test("@critical @COHI-364 workbench Workflow Conversion widget applies saved bookmark", async ({ userPage }) => {
    await suppressWelcomeTour(userPage);
    const bookmarkName = `qaAgentRunTag-wf-wb-${Date.now()}`;

    const bookmarksDialog = workflowConversionBookmarksDialog(userPage);

    const initialPrefGet = waitForPreferenceGet(userPage, "workflowConversionBookmarksV1");
    await userPage.goto("/workflow-conversion", { waitUntil: "domcontentloaded" });
    await initialPrefGet;
    await userPage.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
    await dismissBlockingOverlays(userPage);

    const main = workflowMain(userPage);
    await expect(main.getByRole("button", { name: "Bookmarks" })).toBeVisible();

    await selectCalculation(userPage, "Turn Time");
    await main.getByRole("button", { name: "Save", exact: true }).click();
    const saveBookmarkDialog = userPage.getByRole("dialog").filter({
      has: userPage.getByRole("heading", { name: "Save Bookmark" }),
    });
    await expect(saveBookmarkDialog.getByRole("heading", { name: "Save Bookmark" })).toBeVisible();
    await saveBookmarkDialog.getByPlaceholder("Bookmark name").fill(bookmarkName);
    const wbPut = userPage.waitForResponse(
      (response) =>
        response.url().includes("/api/user/preferences/workflowConversionBookmarksV1") &&
        response.request().method() === "PUT" &&
        response.status() < 500,
      { timeout: 30_000 },
    );
    await saveBookmarkDialog.getByRole("button", { name: "Save" }).click();
    expect((await wbPut).status()).toBeLessThan(300);
    await expect(saveBookmarkDialog).toBeHidden({ timeout: 15_000 });

    await selectCalculation(userPage, "Conversion %");

    await gotoNewWorkbenchCanvas(userPage);
    await addWorkflowConversionSection(userPage);
    await userPage.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
    await dismissBlockingOverlays(userPage);

    const toolbar = workflowConversionToolbar(userPage);
    await expect(toolbar).toBeVisible({ timeout: 30_000 });
    await expect(toolbar.getByRole("button", { name: "Bookmarks" })).toBeVisible();
    await toolbar.getByRole("button", { name: "Bookmarks" }).click();
    await expect(bookmarksDialog).toBeVisible({ timeout: 30_000 });
    await bookmarksDialog.getByRole("button", { name: "Apply" }).click();
    await expect(bookmarksDialog).toBeHidden();

    await expect(toolbarCalculationCombobox(userPage)).toContainText("Turn Time", { timeout: 20_000 });

    await userPage.goto("/workflow-conversion", { waitUntil: "domcontentloaded" });
    await userPage.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
    await dismissBlockingOverlays(userPage);
    await workflowMain(userPage).getByRole("button", { name: "Bookmarks" }).click();
    await expect(bookmarksDialog).toBeVisible();
    const row = bookmarkEntryRow(bookmarksDialog, bookmarkName);
    await pacePreferenceWrites(userPage);
    await clickBookmarkDeleteAndWaitForPut(userPage, row.getByRole("button", { name: "Delete" }));
    await userPage.keyboard.press("Escape");
  });
});
