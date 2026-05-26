/**
 * Wave 2 — cross-surface and cross-mode permutations (live).
 */
import { test, expect } from "@playwright/test";
import {
  forceUnifiedChat,
  forceWorkbenchChatScopeSync,
  resetWorkbenchE2eBrowserState,
} from "../helpers/unifiedChat";
import {
  initRegressionLedger,
  recordRegression,
  skipIfLoggedOut,
  gotoRegressionSurface,
  selectUnifiedChatType,
  seedDeterministicBoard,
  seedAdditionalDeterministicBoard,
  waitForScopedCanvasHistoryFetch,
  waitForChatInputReady,
  unifiedChatMessageInput,
} from "../helpers/workbenchRegression";

test.describe.configure({ mode: "serial" });

test.describe("Workbench regression wave 2 @manual-live", () => {
  test.beforeAll(() => {
    initRegressionLedger("wave2");
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
    await recordRegression(page, { id, wave: "wave2", name, status, observed });
  }

  test("W2-01 chat_home workbench mode", async ({ page }) => {
    await runCase(page, "W2-01", "Chat home → Workbench", async () => {
      await gotoRegressionSurface(page, "chat_home");
      await selectUnifiedChatType(page, "Workbench");
      await expect(page.getByTestId("unified-chat-shell")).toBeVisible();
      return "workbench mode on /";
    });
  });

  test("W2-02 chat_home chat mode input", async ({ page }) => {
    await runCase(page, "W2-02", "Chat home → Chat input", async () => {
      await gotoRegressionSurface(page, "chat_home");
      await selectUnifiedChatType(page, "Chat");
      await expect(unifiedChatMessageInput(page)).toBeEnabled({ timeout: 20_000 });
      return "chat mode input ready on /";
    });
  });

  test("W2-03 data_chat shell", async ({ page }) => {
    await runCase(page, "W2-03", "Data chat shell", async () => {
      await gotoRegressionSurface(page, "data_chat");
      await expect(unifiedChatMessageInput(page)).toBeVisible({
        timeout: 20_000,
      });
      return "data-chat chat input visible";
    });
  });

  test("W2-04 workbench hub", async ({ page }) => {
    await runCase(page, "W2-04", "Workbench hub favorites", async () => {
      await gotoRegressionSurface(page, "workbench_hub");
      await expect(
        page.getByPlaceholder("Ask Cohi anything..."),
      ).toBeVisible({ timeout: 20_000 });
      return "hub ask visible";
    });
  });

  test("W2-05 dashboard mode switch workbench chat", async ({ page }) => {
    await runCase(page, "W2-05", "Dashboard WB→Chat", async () => {
      await seedDeterministicBoard(page);
      await selectUnifiedChatType(page, "Workbench");
      await selectUnifiedChatType(page, "Chat");
      await expect(page.getByTestId("cohi-chat-history-toggle")).toBeVisible({
        timeout: 15_000,
      });
      return "mode switch ok";
    });
  });

  test("W2-06 dashboard chat history scoped", async ({ page }) => {
    await runCase(page, "W2-06", "Dashboard Chat history scoped", async () => {
      await seedDeterministicBoard(page);
      await selectUnifiedChatType(page, "Chat");
      await waitForScopedCanvasHistoryFetch(page);
      return "scoped on dashboard in Chat mode";
    });
  });

  test("W2-07 dashboard_new workbench", async ({ page }) => {
    await runCase(page, "W2-07", "Dashboard new canvas", async () => {
      await gotoRegressionSurface(page, "dashboard_new");
      await waitForChatInputReady(page);
      return "new canvas shell ready";
    });
  });

  test("W2-08 second tab scope chip", async ({ page }) => {
    await runCase(page, "W2-08", "Second tab scope chip", async () => {
      const a = await seedDeterministicBoard(page);
      await selectUnifiedChatType(page, "Workbench");
      const b = await seedAdditionalDeterministicBoard(page);
      expect(b).not.toBe(a);
      await selectUnifiedChatType(page, "Workbench");
      const dialog = page.getByTestId("workbench-scope-switch-dialog");
      await expect(dialog).toBeVisible({ timeout: 45_000 });
      await dialog.getByRole("button", { name: "Switch chat" }).click();
      await expect(page.getByTestId("workbench-chat-scope-chip")).toBeVisible({
        timeout: 30_000,
      });
      return "chip visible on canvas B";
    });
  });

  test("W2-09 dashboard research mode", async ({ page }) => {
    await runCase(page, "W2-09", "Dashboard → Research", async () => {
      await seedDeterministicBoard(page);
      await selectUnifiedChatType(page, "Research");
      await expect(unifiedChatMessageInput(page)).toBeVisible({ timeout: 20_000 });
      return "research mode mounted";
    });
  });

  test("W2-10 dashboard insight builder", async ({ page }) => {
    await runCase(page, "W2-10", "Dashboard → Insight builder", async () => {
      await seedDeterministicBoard(page);
      await selectUnifiedChatType(page, "Insight builder");
      await expect(unifiedChatMessageInput(page)).toBeVisible({ timeout: 20_000 });
      return "insight builder mounted";
    });
  });

  test("W2-11 chat_home wb then chat", async ({ page }) => {
    await runCase(page, "W2-11", "Chat home WB↔Chat", async () => {
      await gotoRegressionSurface(page, "chat_home");
      await selectUnifiedChatType(page, "Workbench");
      await selectUnifiedChatType(page, "Chat");
      return "round-trip modes on /";
    });
  });

  test("W2-12 data_chat workbench mode", async ({ page }) => {
    await runCase(page, "W2-12", "Data chat → Workbench", async () => {
      await gotoRegressionSurface(page, "data_chat");
      await selectUnifiedChatType(page, "Workbench");
      await waitForChatInputReady(page);
      return "workbench on data-chat";
    });
  });
});
