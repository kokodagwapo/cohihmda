import { test, expect } from "./fixtures";
import {
  forceUnifiedChat,
  gotoWithUnifiedChatShell,
  gotoWorkbenchHubWithUnifiedShell,
  mockUnifiedChatApis,
  mockUnifiedChatTenantApi,
  mockV1Messages,
  mockV1Permissions,
  UNIFIED_CHAT_STUB_TEXT,
  submitWorkbenchHubAsk,
} from "./helpers/unifiedChat";

test.describe("Unified Cohi Chat (v1 API)", () => {
  test("@critical @COHI-386 @COHI-397 AC2 data-chat POST messages renders reply blocks", async ({
    userPage,
  }) => {
    await forceUnifiedChat(userPage);
    let sawMessagesPost = false;
    await mockUnifiedChatTenantApi(userPage);
    await mockV1Permissions(userPage);
    await mockV1Messages(userPage);
    await userPage.route(/\/api\/chat\/v1\/messages(?!:stream)(?:\?.*)?$/, async (route) => {
      if (route.request().method() === "POST") sawMessagesPost = true;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          conversationId: "550e8400-e29b-41d4-a716-446655440001",
          turn: {
            id: "6ba7b810-9dad-11d1-80b4-00c04fd430c9",
            blocks: [{ type: "text", markdown: UNIFIED_CHAT_STUB_TEXT }],
          },
          metadata: { promptHash: "e2e-stub-prompt-hash" },
        }),
      });
    });

    await gotoWorkbenchHubWithUnifiedShell(userPage, "/workbench/favorites");
    await submitWorkbenchHubAsk(userPage, "AC2 structural POST /messages smoke");

    await expect.poll(() => sawMessagesPost).toBeTruthy();
    await expect(userPage.getByText(new RegExp(UNIFIED_CHAT_STUB_TEXT, "i"))).toBeVisible({
      timeout: 15_000,
    });
  });

  test("@critical @COHI-386 @COHI-396 AC1 data-chat POST messages stream when unified", async ({
    userPage,
  }) => {
    await forceUnifiedChat(userPage);
    await mockUnifiedChatApis(userPage);
    await gotoWithUnifiedChatShell(userPage, "/insights");

    const streamRequest = userPage.waitForRequest(
      (req) =>
        req.method() === "POST" &&
        /\/api\/chat\/v1\/messages:stream(?:\?.*)?$/.test(req.url()),
    );
    const input = unifiedChatMessageInput(userPage);
    await expect(input).toBeVisible({ timeout: 15_000 });
    await input.fill("Stream path smoke");
    await input.press("Enter");

    await streamRequest;
    await expect(userPage.getByText(new RegExp(UNIFIED_CHAT_STUB_TEXT, "i"))).toBeVisible({
      timeout: 15_000,
    });
  });

  test("@critical @COHI-404 @COHI-386 AC1 insights horizontal shell without right rail", async ({
    userPage,
  }) => {
    await forceUnifiedChat(userPage);
    await mockUnifiedChatApis(userPage);
    await gotoWithUnifiedChatShell(userPage, "/insights");
    await expect(
      userPage.getByRole("button", { name: /Open Cohi Insights/i }),
    ).toHaveCount(0);
  });
});
