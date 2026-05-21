/**
 * Authenticated chat landing at `/` (fullscreen unified shell).
 */

import { test, expect } from "./fixtures";
import {
  forceUnifiedChat,
  gotoWithUnifiedChatShell,
  mockUnifiedChatApis,
} from "./helpers/unifiedChat";

test.describe("Chat landing at /", () => {
  test.beforeEach(async ({ userPage }) => {
    await forceUnifiedChat(userPage);
    await mockUnifiedChatApis(userPage);
  });

  test("@smoke @COHI-386 guest visiting / redirects to login", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/login(\?|$)/);
    expect(page.url()).toMatch(/returnTo=%2F|returnTo=%252F|returnTo=\//);
  });

  test("@smoke @COHI-386 authenticated user sees chat home at /", async ({ userPage }) => {
    await gotoWithUnifiedChatShell(userPage, "/");
    expect(new URL(userPage.url()).pathname).toBe("/");
  });

  test("@critical @COHI-386 layout view controls hidden on chat home", async ({ userPage }) => {
    await gotoWithUnifiedChatShell(userPage, "/");
    await expect(
      userPage.getByRole("group", { name: "Chat layout" }),
    ).toHaveCount(0);
    await expect(
      userPage.getByRole("button", { name: "Full page" }),
    ).toHaveCount(0);
    await expect(
      userPage.getByRole("button", { name: "Compact" }),
    ).toHaveCount(0);
  });

  test("@critical @COHI-386 layout view controls visible on /insights", async ({ userPage }) => {
    await gotoWithUnifiedChatShell(userPage, "/insights");
    await expect(
      userPage.getByRole("group", { name: "Chat layout" }),
    ).toBeVisible();
  });

  test("@critical @COHI-386 canvas-only user cannot access chat home at /", async ({
    canvasOnlyPage,
  }) => {
    // AccessModeGate sends canvas-only users to /my-dashboard → /workbench (not CohiChatHome).
    await canvasOnlyPage.goto("/", { waitUntil: "domcontentloaded" });
    await expect(canvasOnlyPage).toHaveURL(/\/(my-dashboard|workbench)(\/|$)/, {
      timeout: 15_000,
    });
    await expect(canvasOnlyPage.getByTestId("unified-chat-shell")).toHaveCount(0);
    await expect(canvasOnlyPage.getByText("Cohi Dashboards")).toBeVisible({
      timeout: 15_000,
    });
  });
});
