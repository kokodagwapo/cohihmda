/**
 * Wave 4 — soak: repeat critical scenarios to eliminate flakes.
 */
import { test, expect } from "@playwright/test";
import {
  activateDashboardTab,
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
  selectUnifiedChatType,
  chatPanelMessage,
  clickNewChatThread,
  sendDashboardTurn,
  waitForScopedCanvasHistoryFetch,
  triggerTabSwitchScopeDialog,
  unifiedChatMessageInput,
  waitForChatInputReady,
  writeSignoffReport,
} from "../helpers/workbenchRegression";

test.describe.configure({ mode: "serial" });

test.describe("Workbench regression wave 4 soak @manual-live", () => {
  test.beforeAll(() => {
    initRegressionLedger("wave4");
  });

  test.afterAll(() => {
    writeSignoffReport();
  });

  test.beforeEach(async ({ page }) => {
    await forceUnifiedChat(page);
    await forceWorkbenchChatScopeSync(page);
    await resetWorkbenchE2eBrowserState(page);
  });

  async function soak(
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
    await recordRegression(page, { id, wave: "wave4", name, status, observed });
  }

  test("W4-01 soak new chat empty x2", async ({ page }) => {
    await soak(page, "W4-01", "Soak new chat empty", async () => {
      for (let i = 0; i < 2; i++) {
        const marker = `w4-01-${i}-${Date.now()}`;
        await seedDeterministicBoard(page);
        await selectUnifiedChatType(page, "Workbench");
        await sendDashboardTurn(page, marker, { waitForReply: false });
        await clickNewChatThread(page);
        await expect(chatPanelMessage(page, marker)).not.toBeVisible({ timeout: 8_000 });
      }
      return "2x new chat empty pass";
    });
  });

  test("W4-02 soak scoped history x2", async ({ page }) => {
    await soak(page, "W4-02", "Soak scoped history", async () => {
      for (let i = 0; i < 2; i++) {
        await seedDeterministicBoard(page);
        await selectUnifiedChatType(page, "Chat");
        await waitForScopedCanvasHistoryFetch(page);
      }
      return "2x scoped history pass";
    });
  });

  // Run before W4-03 — pinned chat from tab-switch soak breaks new-canvas starter assertions.
  test("W4-04 soak starter dialog x2", async ({ page }) => {
    await soak(page, "W4-04", "Soak starter dialog", async () => {
      const starter = "Build an executive dashboard with key KPIs";
      for (let i = 0; i < 2; i++) {
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
        const intentDialog = page.getByTestId("workbench-new-canvas-intent-dialog");
        const scopeDialog = page.getByTestId("workbench-scope-switch-dialog");
        if (await scopeDialog.isVisible({ timeout: 5_000 }).catch(() => false)) {
          await scopeDialog.getByRole("button", { name: "Switch chat" }).click({ force: true });
          await expect(scopeDialog).toBeHidden({ timeout: 15_000 });
          await input.fill(starter);
          await input.press("Enter");
        }
        await expect(intentDialog).toBeVisible({ timeout: 30_000 });
        await page.getByTestId("workbench-new-canvas-dismiss").click();
      }
      return "2x starter dialog pass";
    });
  });

  test("W4-03 soak tab pin x2", async ({ page }) => {
    await soak(page, "W4-03", "Soak tab pin", async () => {
      for (let i = 0; i < 2; i++) {
        await triggerTabSwitchScopeDialog(page, {
          message: `Pin soak ${i}: summarize this board briefly.`,
        });
        const dialog = page.getByTestId("workbench-scope-switch-dialog");
        await dialog.getByRole("button", { name: "Keep current chat" }).click();
        await expect(page.getByTestId("workbench-chat-scope-pinned-banner")).toBeVisible({
          timeout: 15_000,
        });
      }
      return "2x tab pin pass";
    });
  });
});
