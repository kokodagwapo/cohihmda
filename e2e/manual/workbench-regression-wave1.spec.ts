/**
 * Wave 1 — baseline workbench/chat regression (live).
 */
import fs from "fs";
import { test, expect } from "@playwright/test";
import {
  activateDashboardTab,
  dismissWorkbenchScopeSwitchDialogIfOpen,
  forceUnifiedChat,
  forceWorkbenchChatScopeSync,
  gotoWithUnifiedChatShell,
  resetWorkbenchE2eBrowserState,
} from "../helpers/unifiedChat";
import {
  REGRESSION_LEDGER,
  REGRESSION_OUT,
  chatPanelMessage,
  clickNewChatThread,
  initRegressionLedger,
  closeCanvasHistoryIfOpen,
  openCanvasHistory,
  openCanvasThreadsButton,
  recordRegression,
  seedAdditionalDeterministicBoard,
  seedDeterministicBoard,
  selectUnifiedChatType,
  sendDashboardTurn,
  skipIfLoggedOut,
  unifiedChatMessageInput,
  waitForChatInputReady,
  watchConversationListRequests,
  assertCanvasScopedHistoryFetch,
  writeSignoffReport,
} from "../helpers/workbenchRegression";

test.describe.configure({ mode: "serial" });

test.describe("Workbench regression wave 1 @manual-live", () => {
  test.beforeAll(() => {
    fs.mkdirSync(REGRESSION_OUT, { recursive: true });
    fs.writeFileSync(
      REGRESSION_LEDGER,
      `# Workbench maximal regression\n\nStarted: ${new Date().toISOString()}\n\n`,
    );
    initRegressionLedger("wave1");
  });

  test.beforeEach(async ({ page }) => {
    await forceUnifiedChat(page);
    await forceWorkbenchChatScopeSync(page);
    await resetWorkbenchE2eBrowserState(page);
  });

  test("W1-01 history + threads visible on canvas open", async ({ page }) => {
    const wave = "wave1";
    let status: "works" | "broken" = "works";
    let observed = "";
    try {
      await skipIfLoggedOut(page);
      await seedDeterministicBoard(page);
      await selectUnifiedChatType(page, "Workbench");
      await expect(page.getByTestId("cohi-chat-history-toggle")).toBeVisible({
        timeout: 20_000,
      });
      await expect(page.getByTestId("workbench-chat-scope-chip")).toBeVisible({
        timeout: 20_000,
      });
      observed = "history toggle + threads control visible";
    } catch (e) {
      status = "broken";
      observed = e instanceof Error ? e.message : String(e);
    }
    await recordRegression(page, {
      id: "W1-01",
      wave,
      name: "History + threads on canvas open",
      status,
      observed,
    });
  });

  test("W1-02 canvas history API scoped", async ({ page }) => {
    const wave = "wave1";
    const watcher = watchConversationListRequests(page);
    let status: "works" | "broken" = "works";
    let observed = "";
    try {
      await skipIfLoggedOut(page);
      await seedDeterministicBoard(page);
      await selectUnifiedChatType(page, "Workbench");
      const marker = watcher.urls.length;
      const hasScopedRecent = (): boolean => {
        const recent = watcher.urls.slice(marker);
        if (!recent.length) return false;
        try {
          assertCanvasScopedHistoryFetch(recent);
          return true;
        } catch {
          return false;
        }
      };
      const waitScopedRecent = async (): Promise<void> => {
        await expect.poll(hasScopedRecent, { timeout: 20_000 }).toBe(true);
      };
      await openCanvasHistory(page);
      await expect(page.getByTestId("chat-history-sidebar")).toBeVisible({
        timeout: 20_000,
      });
      try {
        await waitScopedRecent();
      } catch {
        const historyToggle = page.getByTestId("cohi-chat-history-toggle");
        await historyToggle.click();
        await expect(page.getByTestId("chat-history-sidebar")).toBeHidden({
          timeout: 10_000,
        });
        await historyToggle.click();
        await expect(page.getByTestId("chat-history-sidebar")).toBeVisible({
          timeout: 20_000,
        });
        await waitScopedRecent();
      }
      assertCanvasScopedHistoryFetch(watcher.urls.slice(marker));
      observed = "scoped draft/canvas fetch; no global_session";
    } catch (e) {
      status = "broken";
      observed = e instanceof Error ? e.message : String(e);
    } finally {
      watcher.detach();
      const sidebar = page.getByTestId("chat-history-sidebar");
      if (await sidebar.isVisible({ timeout: 500 }).catch(() => false)) {
        await page.getByTestId("cohi-chat-history-toggle").click();
      }
    }
    await recordRegression(page, {
      id: "W1-02",
      wave,
      name: "Canvas-scoped history API",
      status,
      observed,
    });
  });

  test("W1-03 scope chip after turn", async ({ page }) => {
    const wave = "wave1";
    let status: "works" | "broken" = "works";
    let observed = "";
    try {
      await skipIfLoggedOut(page);
      await seedDeterministicBoard(page);
      await sendDashboardTurn(page, "List widgets on this board briefly.", {
        waitForReply: false,
      });
      const chip = page.getByTestId("workbench-chat-scope-chip");
      await expect(chip).toBeVisible({ timeout: 60_000 });
      await expect(chip).toContainText(/Board Ready|E2E/i, { timeout: 15_000 });
      observed = (await chip.textContent()) ?? "chip visible";
    } catch (e) {
      status = "broken";
      observed = e instanceof Error ? e.message : String(e);
    }
    await recordRegression(page, {
      id: "W1-03",
      wave,
      name: "Scope chip after turn",
      status,
      observed,
    });
  });

  test("W1-04 new chat stays empty", async ({ page }) => {
    const wave = "wave1";
    const marker = `w1-04-${Date.now()}`;
    let status: "works" | "broken" = "works";
    let observed = "";
    try {
      await skipIfLoggedOut(page);
      await seedDeterministicBoard(page);
      await selectUnifiedChatType(page, "Workbench");
      await dismissWorkbenchScopeSwitchDialogIfOpen(page, "switch");
      const input = unifiedChatMessageInput(page);
      await input.fill(marker);
      await input.press("Enter");
      await expect(input).toHaveValue("", { timeout: 15_000 });
      await dismissWorkbenchScopeSwitchDialogIfOpen(page, "switch");
      await page
        .getByRole("button", { name: /New chat thread on this canvas/i })
        .click({ timeout: 30_000 });
      await waitForChatInputReady(page);
      await page.waitForTimeout(2000);
      await expect(chatPanelMessage(page, marker)).not.toBeVisible({ timeout: 8_000 });
      observed = "new chat cleared marker";
    } catch (e) {
      status = "broken";
      observed = e instanceof Error ? e.message : String(e);
    }
    await recordRegression(page, {
      id: "W1-04",
      wave,
      name: "New chat empty",
      status,
      observed,
    });
  });

  test("W1-05 tab switch pin", async ({ page }) => {
    const wave = "wave1";
    let status: "works" | "broken" = "works";
    let observed = "";
    try {
      await skipIfLoggedOut(page);
      const canvasA = await seedDeterministicBoard(page);
      await selectUnifiedChatType(page, "Workbench");
      await sendDashboardTurn(page, "Summarize this board in one sentence.", {
        waitForReply: false,
      });
      await expect(page.getByTestId("workbench-chat-scope-chip")).toBeVisible({
        timeout: 60_000,
      });
      await expect
        .poll(
          () =>
            page.evaluate(() =>
              sessionStorage.getItem("cohi_workbench_conversation_scope"),
            ),
          { timeout: 30_000 },
        )
        .not.toBeNull();
      const persistedAfterA = await page.evaluate(() =>
        sessionStorage.getItem("cohi_workbench_conversation_scope"),
      );
      if (!persistedAfterA) {
        throw new Error("conversation scope not persisted after chat on canvas A");
      }
      const canvasB = await seedAdditionalDeterministicBoard(page);
      expect(canvasB).not.toBe(canvasA);
      await selectUnifiedChatType(page, "Workbench");
      const dialog = page.getByTestId("workbench-scope-switch-dialog");
      await expect(dialog).toBeVisible({ timeout: 45_000 });
      await dialog.getByRole("button", { name: "Keep current chat" }).click();
      await expect(page.getByTestId("workbench-chat-scope-pinned-banner")).toBeVisible({
        timeout: 15_000,
      });
      observed = "tab B → scope dialog → pin";
    } catch (e) {
      status = "broken";
      observed = e instanceof Error ? e.message : String(e);
    }
    await recordRegression(page, {
      id: "W1-05",
      wave,
      name: "Tab switch pin",
      status,
      observed,
    });
  });

  test("W1-06 new canvas intent explicit phrase", async ({ page }) => {
    const wave = "wave1";
    let status: "works" | "broken" = "works";
    let observed = "";
    try {
      await skipIfLoggedOut(page);
      await seedDeterministicBoard(page);
      await selectUnifiedChatType(page, "Workbench");
      const input = unifiedChatMessageInput(page);
      await input.fill("Add charts on a new canvas");
      await input.press("Enter");
      const dialog = page.getByTestId("workbench-new-canvas-intent-dialog");
      await expect(dialog).toBeVisible({ timeout: 15_000 });
      await dialog.getByRole("button", { name: "Use current canvas" }).click();
      observed = "new-canvas dialog shown";
    } catch (e) {
      status = "broken";
      observed = e instanceof Error ? e.message : String(e);
    }
    await recordRegression(page, {
      id: "W1-06",
      wave,
      name: "New canvas intent explicit",
      status,
      observed,
    });
  });

  test("W1-07 new chat + starter new canvas", async ({ page }) => {
    const wave = "wave1";
    const starter = "Build an executive dashboard with key KPIs";
    let status: "works" | "broken" = "works";
    let observed = "";
    try {
      await skipIfLoggedOut(page);
      await seedDeterministicBoard(page);
      await selectUnifiedChatType(page, "Workbench");
      await dismissWorkbenchScopeSwitchDialogIfOpen(page, "switch");
      await activateDashboardTab(page, /E2E Board Ready Min/i);
      await page
        .getByRole("button", { name: /New chat thread on this canvas/i })
        .click({ timeout: 30_000 });
      await waitForChatInputReady(page);
      const input = unifiedChatMessageInput(page);
      await input.fill(starter);
      await input.press("Enter");
      const dialog = page.getByTestId("workbench-new-canvas-intent-dialog");
      await expect(dialog).toBeVisible({ timeout: 20_000 });
      await expect(page.getByTestId("workbench-new-canvas-dismiss")).toBeVisible();
      await dialog.getByRole("button", { name: "Use current canvas" }).click();
      observed = "starter → new-canvas dialog";
    } catch (e) {
      status = "broken";
      observed = e instanceof Error ? e.message : String(e);
    }
    await recordRegression(page, {
      id: "W1-07",
      wave,
      name: "New chat + starter",
      status,
      observed,
    });
  });

  test("W1-08 scoped history survives canvas reopen", async ({ page }) => {
    const wave = "wave1";
    let status: "works" | "broken" = "works";
    let observed = "";
    try {
      await skipIfLoggedOut(page);
      const canvasId = await seedDeterministicBoard(page);
      await openCanvasHistory(page);
      const subtitle = page.getByTestId("chat-history-scope-subtitle");
      await expect(subtitle).toContainText(/Board Ready|E2E/i, { timeout: 20_000 });
      await closeCanvasHistoryIfOpen(page);
      await gotoWithUnifiedChatShell(page, `/my-dashboard/${canvasId}`, {
        timeout: 60_000,
      });
      await dismissWorkbenchScopeSwitchDialogIfOpen(page, "switch");
      await selectUnifiedChatType(page, "Workbench");
      await openCanvasHistory(page);
      await expect(subtitle).toContainText(/Board Ready|E2E/i, { timeout: 20_000 });
      observed = "canvas reopen keeps canvas-scoped history subtitle";
    } catch (e) {
      status = "broken";
      observed = e instanceof Error ? e.message : String(e);
    }
    await recordRegression(page, {
      id: "W1-08",
      wave,
      name: "Scoped history on canvas reopen",
      status,
      observed,
    });
  });

  test("W1-09 switch chat to canvas B", async ({ page }) => {
    const wave = "wave1";
    const markerB = `w1-09-b-${Date.now()}`;
    let status: "works" | "broken" = "works";
    let observed = "";
    try {
      await skipIfLoggedOut(page);
      const canvasA = await seedDeterministicBoard(page);
      await sendDashboardTurn(page, "Marker A only.", { waitForReply: false });
      const canvasB = await seedAdditionalDeterministicBoard(page);
      expect(canvasB).not.toBe(canvasA);
      await selectUnifiedChatType(page, "Workbench");
      const dialog = page.getByTestId("workbench-scope-switch-dialog");
      await expect(dialog).toBeVisible({ timeout: 45_000 });
      await dialog.getByRole("button", { name: "Switch chat" }).click();
      await expect(dialog).toBeHidden({ timeout: 15_000 });
      const chip = page.getByTestId("workbench-chat-scope-chip");
      await expect(chip).toBeVisible({ timeout: 15_000 });
      await expect(chip).toContainText(/Board Ready|E2E/i);
      observed = "canvas B → scope dialog → Switch chat updates scope";
    } catch (e) {
      status = "broken";
      observed = e instanceof Error ? e.message : String(e);
    }
    await recordRegression(page, {
      id: "W1-09",
      wave,
      name: "Switch chat to canvas B",
      status,
      observed,
    });
  });

  test("W1-10 new canvas dismiss", async ({ page }) => {
    const wave = "wave1";
    let status: "works" | "broken" = "works";
    let observed = "";
    try {
      await skipIfLoggedOut(page);
      await seedDeterministicBoard(page);
      await selectUnifiedChatType(page, "Workbench");
      const input = unifiedChatMessageInput(page);
      const msg = "Prepare a board-ready overview";
      await input.fill(msg);
      await input.press("Enter");
      const dialog = page.getByTestId("workbench-new-canvas-intent-dialog");
      await expect(dialog).toBeVisible({ timeout: 15_000 });
      await page.getByTestId("workbench-new-canvas-dismiss").click();
      await expect(dialog).not.toBeVisible();
      await expect(input).toHaveValue(msg);
      observed = "dismiss restored input";
    } catch (e) {
      status = "broken";
      observed = e instanceof Error ? e.message : String(e);
    }
    await recordRegression(page, {
      id: "W1-10",
      wave,
      name: "New canvas dismiss",
      status,
      observed,
    });
  });

  test("W1-11 threads button opens sidebar", async ({ page }) => {
    const wave = "wave1";
    let status: "works" | "broken" = "works";
    let observed = "";
    try {
      await skipIfLoggedOut(page);
      await seedDeterministicBoard(page);
      await openCanvasThreadsButton(page);
      observed = "threads button opened sidebar";
    } catch (e) {
      status = "broken";
      observed = e instanceof Error ? e.message : String(e);
    }
    await recordRegression(page, {
      id: "W1-11",
      wave,
      name: "Threads button sidebar",
      status,
      observed,
    });
  });

  test("W1-12 dashboard new shell workbench", async ({ page }) => {
    const wave = "wave1";
    let status: "works" | "broken" = "works";
    let observed = "";
    try {
      await skipIfLoggedOut(page);
      const { gotoRegressionSurface } = await import("../helpers/workbenchRegression");
      await gotoRegressionSurface(page, "dashboard_new");
      await expect(page.getByTestId("unified-chat-shell")).toBeVisible({
        timeout: 20_000,
      });
      await waitForChatInputReady(page);
      observed = "dashboard new + workbench shell ready";
    } catch (e) {
      status = "broken";
      observed = e instanceof Error ? e.message : String(e);
    }
    await recordRegression(page, {
      id: "W1-12",
      wave,
      name: "Dashboard new workbench shell",
      status,
      observed,
    });
  });
});
