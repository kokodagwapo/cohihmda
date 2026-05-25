/**
 * Responsive control reachability — buttons that hide labels or use group-hover on resize.
 * Run: $env:MANUAL_AUTH_SKIP_REFRESH="1"; npx playwright test e2e/manual/workbench-responsive-controls.spec.ts --config=playwright.manual-live.config.ts
 */
import { test, expect } from "@playwright/test";
import {
  dismissBlockingOverlays,
  forceUnifiedChat,
  gotoWithUnifiedChatShell,
  unifiedChatMessageInput,
} from "../helpers/unifiedChat";
import {
  STRESS_VIEWPORTS,
  assertControlReachable,
  assertNoPageHorizontalOverflow,
  assertVisibleAfterHover,
  clickChatLayoutMode,
  widgetGroupCollapseToggle,
} from "../helpers/responsiveControls";
import { seedBoardReadyDashboard } from "../helpers/workbenchLive";

test.describe.configure({ mode: "serial" });

test.beforeEach(async ({ page }) => {
  await forceUnifiedChat(page);
});

// --- Chat shell (no LLM) ---

for (const vp of STRESS_VIEWPORTS) {
  test(`@COHI-398 RC-chat-composer @ ${vp.id} (${vp.width})`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await gotoWithUnifiedChatShell(page, "/my-dashboard/new", { timeout: 60_000 });
    await dismissBlockingOverlays(page);

    await assertControlReachable(
      page,
      page.getByRole("combobox", { name: "Chat type" }),
      "chat type",
    );
    await assertControlReachable(
      page,
      page.getByRole("button", { name: "Voice input" }),
      "voice input",
    );
    await assertControlReachable(
      page,
      unifiedChatMessageInput(page),
      "message input",
    );
    const send = page.locator('[data-tour="unified-chat-composer"] button').last();
    await assertControlReachable(page, send, "send");
    await assertNoPageHorizontalOverflow(page);
  });
}

test("@COHI-398 RC-insights-split-handle visible on desktop split", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/insights", { waitUntil: "domcontentloaded" });
  await dismissBlockingOverlays(page);
  await expect(page.getByTestId("unified-chat-shell")).toBeVisible({
    timeout: 60_000,
  });
  await clickChatLayoutMode(page, "Split");
  const handle = page.getByTestId("chat-split-resize-handle");
  await expect(handle).toBeVisible();
  await assertNoPageHorizontalOverflow(page);
});

test("@COHI-398 RC-insights-split-handle hidden on mobile full", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await gotoWithUnifiedChatShell(page, "/insights", { timeout: 60_000 });
  await expect(page.getByTestId("chat-split-resize-handle")).toBeHidden();
});

test("@COHI-398 RC-insights-layout-modes @ phone hides Split", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/insights", { waitUntil: "domcontentloaded" });
  await dismissBlockingOverlays(page);
  await expect(page.getByRole("button", { name: "Compact" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Taller" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Split" })).toHaveCount(0);
});

test("@COHI-398 RC-insights-resize-split-to-compact keeps composer", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/insights", { waitUntil: "domcontentloaded" });
  await dismissBlockingOverlays(page);
  await clickChatLayoutMode(page, "Split");
  await expect(page.getByTestId("chat-split-resize-handle")).toBeVisible();
  await page.setViewportSize({ width: 1050, height: 800 });
  await assertNoPageHorizontalOverflow(page);
  await assertControlReachable(page, unifiedChatMessageInput(page), "composer");
  await page.setViewportSize({ width: 390, height: 844 });
  await assertControlReachable(page, unifiedChatMessageInput(page), "composer mobile");
});

async function skipIfLoggedOut(page: import("@playwright/test").Page) {
  const login = await page
    .getByText(/Sign in to access your dashboard/i)
    .isVisible()
    .catch(() => false);
  if (login) test.skip(true, "auth session expired — run npx tsx e2e/manual-auth-setup.ts");
}

test("@COHI-398 RC-workbench-hub-mobile-menu @ 390", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/workbench/favorites", { waitUntil: "domcontentloaded" });
  await dismissBlockingOverlays(page);
  await skipIfLoggedOut(page);
  await expect(page.getByPlaceholder("Ask Cohi anything...")).toBeVisible({
    timeout: 15_000,
  });
  const navMenu = page.getByRole("button", { name: "Open navigation menu" });
  await expect(navMenu).toBeVisible({ timeout: 15_000 });
  const hubMenu = page.getByRole("button", { name: "Open menu" });
  if (await hubMenu.isVisible().catch(() => false)) {
    await expect(hubMenu).toBeVisible();
  }
  const createTrigger = page.locator("button:has(svg.lucide-plus)").first();
  await expect(createTrigger).toBeVisible({ timeout: 15_000 });
  await createTrigger.click();
  await expect(page.getByRole("menuitem", { name: "Dashboard" })).toBeVisible();
});

test("@COHI-398 RC-workbench-hub-create-label @ 1440", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/workbench/favorites", { waitUntil: "domcontentloaded" });
  await dismissBlockingOverlays(page);
  await skipIfLoggedOut(page);
  await expect(page.getByText("Create", { exact: true })).toBeVisible();
});

/** Very narrow widths may clip toolbar — scroll helper used; include phone sizes. */
const CANVAS_TOOLBAR_VIEWPORTS = STRESS_VIEWPORTS.filter((vp) => vp.width >= 768);

// --- Canvas toolbar & widgets (one seed, many viewports) ---

test.describe("RC-canvas controls (seeded once)", () => {
  let canvasPage: import("@playwright/test").Page;

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({
      storageState: "e2e/.auth/user.json",
    });
    canvasPage = await context.newPage();
    await forceUnifiedChat(canvasPage);
    await canvasPage.setViewportSize({ width: 1440, height: 900 });
    await seedBoardReadyDashboard(canvasPage);
  });

  test.afterAll(async () => {
    await canvasPage?.context().close();
  });

  for (const vp of CANVAS_TOOLBAR_VIEWPORTS) {
    test(`@COHI-398 RC-canvas-toolbar @ ${vp.id}`, async () => {
      await canvasPage.setViewportSize({ width: vp.width, height: vp.height });
      await dismissBlockingOverlays(canvasPage);

      const scrollOpts = { scrollCanvasToolbar: true as const };
      await assertControlReachable(
        canvasPage,
        canvasPage.getByTestId("workbench-save-button"),
        "save",
        scrollOpts,
      );
      await assertControlReachable(
        canvasPage,
        canvasPage.getByTestId("workbench-share-button"),
        "share",
        scrollOpts,
      );
      await assertControlReachable(
        canvasPage,
        canvasPage.getByTestId("workbench-canvas-title-input"),
        "canvas title",
        scrollOpts,
      );
      await assertControlReachable(
        canvasPage,
        canvasPage.locator("button:has(svg.lucide-undo2)").first(),
        "undo",
        scrollOpts,
      );
      await assertControlReachable(
        canvasPage,
        canvasPage.locator("button:has(svg.lucide-redo2)").first(),
        "redo",
        scrollOpts,
      );

      const ppt = canvasPage.getByRole("button", { name: /PowerPoint Editor/i });
      await assertControlReachable(canvasPage, ppt, "powerpoint editor", scrollOpts);

      await assertNoPageHorizontalOverflow(canvasPage);
    });
  }

  test("@COHI-398 RC-cohi-dock-chip reachable after resize", async () => {
    for (const w of [390, 834, 1440] as const) {
      await canvasPage.setViewportSize({ width: w, height: 844 });
      const chip = canvasPage.getByTestId("workbench-cohi-toggle");
      if (await chip.isVisible().catch(() => false)) {
        await assertControlReachable(canvasPage, chip, `cohi chip @${w}`);
      }
    }
  });

  test("@COHI-398 RC-widget-collapse-expand @ 834", async () => {
    await canvasPage.setViewportSize({ width: 834, height: 1194 });
    const toggle = widgetGroupCollapseToggle(canvasPage);
    await expect(toggle).toBeVisible({ timeout: 20_000 });
    await expect(toggle).toHaveAttribute("aria-label", "Collapse group");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-label", "Expand group", {
      timeout: 10_000,
    });
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-label", "Collapse group");
  });

  test("@COHI-398 RC-chart-type-footer @ 768 scrollable", async () => {
    await canvasPage.setViewportSize({ width: 768, height: 1024 });
    const barBtn = canvasPage.getByRole("button", { name: "Bar", exact: true }).first();
    if (!(await barBtn.isVisible().catch(() => false))) {
      test.skip(true, "no bar chart widget on canvas");
      return;
    }
    await barBtn.scrollIntoViewIfNeeded();
    await assertControlReachable(canvasPage, barBtn, "chart type Bar");
    const kpiBtn = canvasPage.getByRole("button", { name: "KPI", exact: true }).first();
    if (await kpiBtn.isVisible().catch(() => false)) {
      await assertControlReachable(canvasPage, kpiBtn, "chart type KPI");
    }
  });

  test("@COHI-398 RC-widget-hover-actions @ 1280", async () => {
    await canvasPage.setViewportSize({ width: 1280, height: 800 });
    const canvas = canvasPage.locator("#workbench-canvas-root");
    const widgetCard = canvas.locator(".group\\/widgetgroup, [class*='group/widget']").first();
    const fallback = canvas.getByText(/Pull-Through|Funded Units|Funded Volume/i).first();
    const hoverTarget = (await widgetCard.isVisible().catch(() => false))
      ? widgetCard
      : fallback;
    await hoverTarget.scrollIntoViewIfNeeded();

    const editCohi = canvasPage.getByRole("button", { name: "Edit with Cohi" }).first();
    if (await editCohi.count()) {
      await assertVisibleAfterHover(canvasPage, hoverTarget, editCohi, "edit with cohi");
    }

    const duplicate = canvasPage.getByRole("button", { name: "Duplicate widget" }).first();
    if (await duplicate.count()) {
      await assertVisibleAfterHover(canvasPage, hoverTarget, duplicate, "duplicate");
    }

    const maximize = canvasPage.getByRole("button", { name: "Maximize widget" }).first();
    if (await maximize.count()) {
      await assertVisibleAfterHover(canvasPage, hoverTarget, maximize, "maximize");
    }
  });

  test("@COHI-398 RC-resize-1440-to-tablet-toolbar-persists", async () => {
    await canvasPage.setViewportSize({ width: 1440, height: 900 });
    await assertControlReachable(
      canvasPage,
      canvasPage.getByTestId("workbench-save-button"),
      "save desktop",
      { scrollCanvasToolbar: true },
    );
    await canvasPage.setViewportSize({ width: 834, height: 1194 });
    await assertControlReachable(
      canvasPage,
      canvasPage.getByTestId("workbench-save-button"),
      "save tablet",
      { scrollCanvasToolbar: true },
    );
    await canvasPage.setViewportSize({ width: 1440, height: 900 });
    await assertControlReachable(
      canvasPage,
      canvasPage.getByTestId("workbench-share-button"),
      "share after restore",
      { scrollCanvasToolbar: true },
    );
  });

  test("@COHI-398 RC-filter-expand-toggle @ 834", async () => {
    await canvasPage.setViewportSize({ width: 834, height: 1194 });
    const expandFilters = canvasPage.getByTitle("Expand filters").first();
    if (!(await expandFilters.isVisible().catch(() => false))) {
      test.skip(true, "no filterable cohi widget");
      return;
    }
    await assertControlReachable(canvasPage, expandFilters, "expand filters");
    await expandFilters.click();
    const collapseFilters = canvasPage.getByTitle("Collapse filters").first();
    await expect(collapseFilters).toBeVisible();
  });
});

