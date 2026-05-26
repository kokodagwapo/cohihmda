/**
 * Wave 3 — edge and failure-state permutations (live).
 */
import { test, expect } from "@playwright/test";
import {
  dismissWorkbenchScopeSwitchDialogIfOpen,
  forceUnifiedChat,
  forceWorkbenchChatScopeSync,
  resetWorkbenchE2eBrowserState,
} from "../helpers/unifiedChat";
import {
  initRegressionLedger,
  recordRegression,
  skipIfLoggedOut,
  seedDeterministicBoard,
  seedAdditionalDeterministicBoard,
  triggerTabSwitchScopeDialog,
  selectUnifiedChatType,
  clickNewChatThread,
  sendDashboardTurn,
  waitForChatInputReady,
  closeCanvasHistoryIfOpen,
  openCanvasHistory,
  openCanvasThreadsButton,
  unifiedChatMessageInput,
  watchConversationListRequests,
  assertCanvasScopedHistoryFetch,
} from "../helpers/workbenchRegression";

test.describe.configure({ mode: "serial" });

test.describe("Workbench regression wave 3 @manual-live", () => {
  test.beforeAll(() => {
    initRegressionLedger("wave3");
  });

  test.beforeEach(async ({ page }) => {
    await forceUnifiedChat(page);
    await forceWorkbenchChatScopeSync(page);
    await resetWorkbenchE2eBrowserState(page);
  });

  async function runCase(
    page: import("@playwright/test").Page,
    id: string,
    name: string,
    fn: () => Promise<string>,
  ) {
    let status: "works" | "broken" = "works";
    let observed = "";
    try {
      await skipIfLoggedOut(page);
      observed = await fn();
    } catch (e) {
      status = "broken";
      observed = e instanceof Error ? e.message : String(e);
    }
    await recordRegression(page, { id, wave: "wave3", name, status, observed });
  }

  test("W3-01 new chat then greenfield typed", async ({ page }) => {
    await runCase(page, "W3-01", "New chat + greenfield", async () => {
      await seedDeterministicBoard(page);
      await selectUnifiedChatType(page, "Workbench");
      await dismissWorkbenchScopeSwitchDialogIfOpen(page, "switch");
      await page
        .getByRole("button", { name: /New chat thread on this canvas/i })
        .click({ timeout: 30_000 });
      await waitForChatInputReady(page);
      const input = unifiedChatMessageInput(page);
      await input.fill("Build an executive dashboard with key KPIs");
      await input.press("Enter");
      await expect(page.getByTestId("workbench-new-canvas-intent-dialog")).toBeVisible({
        timeout: 20_000,
      });
      return "dialog after new chat + starter";
    });
  });

  test("W3-02 new canvas cancel no stream", async ({ page }) => {
    await runCase(page, "W3-02", "Cancel new canvas", async () => {
      await seedDeterministicBoard(page);
      await selectUnifiedChatType(page, "Workbench");
      const input = unifiedChatMessageInput(page);
      await input.fill("Build an executive dashboard with key KPIs");
      await input.press("Enter");
      const dialog = page.getByTestId("workbench-new-canvas-intent-dialog");
      await expect(dialog).toBeVisible({ timeout: 15_000 });
      await page.getByTestId("workbench-new-canvas-dismiss").click();
      await expect(dialog).not.toBeVisible();
      const footers = page.locator("p.text-violet-600, p.text-violet-400");
      const count = await footers.count();
      return `dismissed; footers=${count}`;
    });
  });

  test("W3-03 rapid tab switch", async ({ page }) => {
    await runCase(page, "W3-03", "Rapid tab A→B→A", async () => {
      const a = await seedDeterministicBoard(page);
      const b = await seedAdditionalDeterministicBoard(page);
      await page.goto(`/my-dashboard/${a}`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(800);
      await page.goto(`/my-dashboard/${b}`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(800);
      await page.goto(`/my-dashboard/${a}`, { waitUntil: "domcontentloaded" });
      await selectUnifiedChatType(page, "Workbench");
      await expect(page.getByTestId("unified-chat-shell")).toBeVisible({
        timeout: 20_000,
      });
      return "rapid switch no hang";
    });
  });

  test("W3-04 history open twice", async ({ page }) => {
    await runCase(page, "W3-04", "History open twice", async () => {
      await seedDeterministicBoard(page);
      await openCanvasHistory(page);
      const item = page.getByTestId("cohi-chat-history-item").first();
      if (await item.isVisible({ timeout: 8_000 }).catch(() => false)) {
        await item.click({ force: true });
      }
      await closeCanvasHistoryIfOpen(page);
      await openCanvasHistory(page);
      return "history reopened";
    });
  });

  test("W3-05 new chat on fresh seed", async ({ page }) => {
    await runCase(page, "W3-05", "New chat fresh seed", async () => {
      await seedDeterministicBoard(page);
      await clickNewChatThread(page);
      await expect(unifiedChatMessageInput(page)).toBeEnabled();
      return "new chat on seeded canvas";
    });
  });

  test("W3-06 pinned switch button", async ({ page }) => {
    await runCase(page, "W3-06", "Pinned switch button", async () => {
      await triggerTabSwitchScopeDialog(page, { message: "Pin scenario A." });
      const dialog = page.getByTestId("workbench-scope-switch-dialog");
      await dialog.getByRole("button", { name: "Keep current chat" }).click();
      await expect(page.getByTestId("workbench-chat-scope-pinned-banner")).toBeVisible({
        timeout: 15_000,
      });
      return "pinned banner with switch affordance";
    });
  });

  test("W3-07 threads after chat mode", async ({ page }) => {
    await runCase(page, "W3-07", "Threads after Chat mode", async () => {
      await seedDeterministicBoard(page);
      await selectUnifiedChatType(page, "Chat");
      await selectUnifiedChatType(page, "Workbench");
      await openCanvasThreadsButton(page);
      return "threads button after mode return";
    });
  });

  test("W3-08 double history fetch scoped", async ({ page }) => {
    await runCase(page, "W3-08", "Double fetch scoped", async () => {
      await seedDeterministicBoard(page);
      await selectUnifiedChatType(page, "Workbench");
      const watcher = watchConversationListRequests(page);
      try {
        const before = watcher.urls.length;
        await openCanvasHistory(page);
        await closeCanvasHistoryIfOpen(page);
        await openCanvasHistory(page);
        await expect
          .poll(() => watcher.urls.length, { timeout: 20_000 })
          .toBeGreaterThan(before);
        const recent = watcher.urls.slice(before);
        assertCanvasScopedHistoryFetch(recent);
        const global = recent.filter((u) => u.includes("scope_type=global_session"));
        expect(global.length).toBe(0);
        return `fetches=${recent.length} all canvas-scoped`;
      } finally {
        watcher.detach();
        await closeCanvasHistoryIfOpen(page);
      }
    });
  });
});
