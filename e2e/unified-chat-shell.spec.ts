import { test, expect } from "./fixtures";
import {
  forceUnifiedChat,
  mockUnifiedChatApis,
  mockV1MessageStream,
  expandChatShellForResearch,
  selectUnifiedChatType,
  unifiedChatMessageInput,
} from "./helpers/unifiedChat";

test.describe("Unified chat shell (COHI-404)", () => {
  test.beforeEach(async ({ userPage }) => {
    await forceUnifiedChat(userPage);
    await mockUnifiedChatApis(userPage);
  });

  test("@critical @COHI-386 @COHI-404 AC2 default chat band height near 500px", async ({
    userPage,
  }) => {
    await userPage.goto("/insights", { waitUntil: "domcontentloaded" });
    const shell = userPage.getByTestId("unified-chat-shell");
    await expect(shell).toBeVisible({ timeout: 15_000 });

    await userPage.getByRole("button", { name: "Taller" }).click();
    await expect(shell).toBeVisible();

    const height = await shell.evaluate((el) => el.getBoundingClientRect().height);
    expect(height).toBeGreaterThanOrEqual(400);
    expect(height).toBeLessThanOrEqual(520);
  });

  test("@critical @COHI-386 @COHI-404 AC3 route navigation resets expand state", async ({
    userPage,
  }) => {
    await userPage.goto("/insights", { waitUntil: "domcontentloaded" });
    await expect(userPage.getByTestId("unified-chat-shell")).toBeVisible({
      timeout: 15_000,
    });

    await userPage.getByRole("button", { name: "Full page" }).click();
    await userPage.goto("/actors", { waitUntil: "domcontentloaded" });
    await expect(userPage.getByTestId("unified-chat-shell")).toBeVisible({
      timeout: 15_000,
    });

    const stacked = await userPage
      .getByTestId("unified-chat-shell")
      .getAttribute("data-stacked-inset");
    expect(stacked).not.toBeNull();
  });

  test("@critical @COHI-386 @COHI-404 @COHI-402 AC4 research submit auto-expands full page", async ({
    userPage,
  }) => {
    await mockV1MessageStream(userPage, {
      replyText: "Research findings ready.",
      researchShellExpand: true,
      researchSessionId: "e2e-research-session-1",
    });
    await userPage.goto("/insights?mode=research", { waitUntil: "domcontentloaded" });
    await expect(userPage.getByTestId("unified-chat-shell")).toBeVisible({
      timeout: 15_000,
    });
    await expandChatShellForResearch(userPage);
    await selectUnifiedChatType(userPage, "Research");

    const input = unifiedChatMessageInput(userPage);
    await expect(input).toBeVisible({ timeout: 15_000 });
    await input.fill("Run research smoke");
    await input.press("Enter");

    await expect(userPage.getByText(/Research findings ready/i)).toBeVisible({
      timeout: 20_000,
    });

    const stacked = await userPage
      .getByTestId("unified-chat-shell")
      .getAttribute("data-stacked-inset");
    expect(stacked).toBeNull();
  });
});
