/**
 * Fast responsive/UI tests — no LLM (or minimal navigation only).
 */
import { test, expect } from "@playwright/test";
import {
  dismissBlockingOverlays,
  forceUnifiedChat,
  gotoWithUnifiedChatShell,
  unifiedChatMessageInput,
} from "../helpers/unifiedChat";
import {
  assertControlReachable,
  assertNoPageHorizontalOverflow,
  assertVisibleAfterHover,
  clickChatLayoutMode,
} from "../helpers/responsiveControls";
import { seedBoardReadyDashboard } from "../helpers/workbenchLive";

async function skipIfLoggedOut(page: import("@playwright/test").Page) {
  const login = await page
    .getByText(/Sign in to access your dashboard/i)
    .isVisible()
    .catch(() => false);
  if (login) test.skip(true, "auth expired — npx tsx e2e/manual-auth-setup.ts");
}

test.beforeEach(async ({ page }) => {
  await forceUnifiedChat(page);
});

test("NR01 split pane drag changes chat column width", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/insights", { waitUntil: "domcontentloaded" });
  await dismissBlockingOverlays(page);
  await skipIfLoggedOut(page);
  await clickChatLayoutMode(page, "Split");
  const handle = page.getByTestId("chat-split-resize-handle");
  await expect(handle).toBeVisible();
  const before = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="chat-split-resize-handle"]')
      ?.parentElement as HTMLElement | null;
    if (!el) return null;
    return window.getComputedStyle(el).gridTemplateColumns;
  });
  const box = await handle.boundingBox();
  if (!box) throw new Error("no handle box");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 120, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="chat-split-resize-handle"]')
      ?.parentElement as HTMLElement | null;
    if (!el) return null;
    return window.getComputedStyle(el).gridTemplateColumns;
  });
  expect(before).toBeTruthy();
  expect(after).toBeTruthy();
  expect(after).not.toBe(before);
});

test("NR02 chat history or Full History @ 1440", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoWithUnifiedChatShell(page, "/insights", { timeout: 60_000 });
  await skipIfLoggedOut(page);
  const fullHistory = page.getByRole("button", { name: "Full History", exact: true });
  const historyTab = page.getByText(/^History$/i).first();
  const visible =
    (await fullHistory.isVisible().catch(() => false)) ||
    (await historyTab.isVisible().catch(() => false));
  expect(visible, "History entry in chat sidebar").toBe(true);
});

test("NR03 chat panel + composer @ 390 insights stacked", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await gotoWithUnifiedChatShell(page, "/insights", { timeout: 60_000 });
  await skipIfLoggedOut(page);
  await assertControlReachable(page, unifiedChatMessageInput(page), "composer");
  await assertNoPageHorizontalOverflow(page);
});

test("NR04 hub Create menu opens @ 1440", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/workbench/favorites", { waitUntil: "domcontentloaded" });
  await dismissBlockingOverlays(page);
  await skipIfLoggedOut(page);
  await expect(page.getByPlaceholder("Ask Cohi anything...")).toBeVisible({
    timeout: 15_000,
  });
  const create = page.getByRole("button", { name: "Create", exact: true });
  await expect(create).toBeVisible({ timeout: 10_000 });
  await create.click();
  const dashboardItem = page.getByRole("menuitem", { name: "Dashboard" });
  const fallback = page
    .locator('[role="menu"]')
    .getByText("Dashboard", { exact: true });
  const opened =
    (await dashboardItem.isVisible({ timeout: 8_000 }).catch(() => false)) ||
    (await fallback.isVisible({ timeout: 3_000 }).catch(() => false));
  expect(opened).toBe(true);
});

test("NR05 workbench readonly banner not shown for owner", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await gotoWithUnifiedChatShell(page, "/my-dashboard/new", { timeout: 60_000 });
  await skipIfLoggedOut(page);
  const input = unifiedChatMessageInput(page);
  await input.fill("Prepare a board-ready overview of this month's performance");
  await input.press("Enter");
  await expect(input).toBeDisabled();
  await expect
    .poll(() => input.isEnabled().catch(() => false), { timeout: 240_000 })
    .toBe(true);
  const readonly = page.getByTestId("workbench-readonly-banner");
  await expect(readonly).toBeHidden();
});

test("NR06 Compact then Taller chat band @ 834", async ({ page }) => {
  await page.setViewportSize({ width: 834, height: 1194 });
  await gotoWithUnifiedChatShell(page, "/my-dashboard/new", { timeout: 60_000 });
  await skipIfLoggedOut(page);
  await clickChatLayoutMode(page, "Compact");
  await clickChatLayoutMode(page, "Taller");
  const shell = page.getByTestId("unified-chat-shell");
  await expect(shell).toBeVisible();
  const box = await shell.boundingBox();
  expect(box?.height ?? 0).toBeGreaterThan(120);
});

test("NR07 navigation menu + create on favorites @ 390", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/workbench/favorites", { waitUntil: "domcontentloaded" });
  await dismissBlockingOverlays(page);
  await skipIfLoggedOut(page);
  await expect(page.getByRole("button", { name: "Open navigation menu" })).toBeVisible();
  await expect(page.locator("button:has(svg.lucide-plus)").first()).toBeVisible();
});

test("NR08 duplicate widget button visible on hover @ 1280", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await seedBoardReadyDashboard(page);
  await skipIfLoggedOut(page);
  const group = page.locator("#workbench-canvas-root .group\\/widgetgroup").first();
  await expect(group).toBeVisible({ timeout: 30_000 });
  const dup = page.getByRole("button", { name: "Duplicate widget" }).first();
  await assertVisibleAfterHover(page, group, dup, "duplicate");
});
