import { test, expect } from "./fixtures";
import {
  expandChatShellForResearch,
  forceUnifiedChat,
  mockUnifiedChatApis,
  mockV1MessageStream,
  selectUnifiedChatType,
  UNIFIED_CHAT_STUB_TEXT,
  unifiedChatMessageInput,
} from "./helpers/unifiedChat";

test.describe("Unified research in chat (COHI-402 / COHI-397)", () => {
  test.beforeEach(async ({ userPage }) => {
    await forceUnifiedChat(userPage);
    await mockUnifiedChatApis(userPage);
  });

  test("@critical @COHI-386 @COHI-402 @COHI-397 AC4 research stream returns schema blocks", async ({
    userPage,
  }) => {
    await mockV1MessageStream(userPage, {
      researchSessionId: "e2e-research-session-1",
      replyText: UNIFIED_CHAT_STUB_TEXT,
    });

    await userPage.goto("/insights?mode=research", { waitUntil: "domcontentloaded" });
    await userPage.waitForTimeout(500);
    await expandChatShellForResearch(userPage);
    await selectUnifiedChatType(userPage, "Research");
    const input = unifiedChatMessageInput(userPage);
    await input.fill("Research schema blocks smoke");
    await input.press("Enter");

    const workspace = userPage.getByTestId("unified-research-workspace");
    await expect(workspace).toBeVisible({ timeout: 20_000 });
    await expect(workspace).toContainText(new RegExp(UNIFIED_CHAT_STUB_TEXT, "i"), {
      timeout: 20_000,
    });
  });

  test("@critical @COHI-386 @COHI-402 @COHI-397 AC4 research-in-chat workspace visible", async ({
    userPage,
  }) => {
    await mockV1MessageStream(userPage, {
      researchShellExpand: true,
      researchSessionId: "e2e-research-session-1",
    });
    await userPage.goto("/insights?mode=research", { waitUntil: "domcontentloaded" });
    await userPage.waitForTimeout(500);
    await expandChatShellForResearch(userPage);
    await selectUnifiedChatType(userPage, "Research");

    const input = unifiedChatMessageInput(userPage);
    await input.fill("Open research workspace");
    await input.press("Enter");

    await expect(userPage.getByTestId("unified-research-workspace")).toBeVisible({
      timeout: 25_000,
    });
  });
});
