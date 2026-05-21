import { test, expect } from "./fixtures";
import {
  forceUnifiedChat,
  gotoWithUnifiedChatShell,
  mockUnifiedChatApis,
  mockV1Messages,
  mockV1MessageStream,
  UNIFIED_CHAT_STUB_TEXT,
  selectUnifiedChatType,
  unifiedChatMessageInput,
} from "./helpers/unifiedChat";

test.describe("Unified chat surfaces (COHI-396 / COHI-397)", () => {
  test.beforeEach(async ({ userPage }) => {
    await forceUnifiedChat(userPage);
    await mockUnifiedChatApis(userPage);
  });

  test("@critical @COHI-386 @COHI-396 AC1 workbench canvas uses messages stream", async ({
    userPage,
  }) => {
    await gotoWithUnifiedChatShell(userPage, "/my-dashboard/new");

    const streamRequest = userPage.waitForRequest(
      (req) =>
        req.method() === "POST" &&
        /\/api\/chat\/v1\/messages:stream(?:\?.*)?$/.test(req.url()),
    );

    const input = unifiedChatMessageInput(userPage);
    await input.fill("Workbench stream smoke");
    await input.press("Enter");
    await streamRequest;
    await expect(userPage.getByText(new RegExp(UNIFIED_CHAT_STUB_TEXT, "i"))).toBeVisible({
      timeout: 20_000,
    });
  });

  test("@critical @COHI-386 @COHI-396 AC1 hub ask uses messages POST", async ({ userPage }) => {
    let sawMessagesPost = false;
    await mockV1Messages(userPage);
    await userPage.route(/\/api\/chat\/v1\/messages(?!:stream)(?:\?.*)?$/, async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      sawMessagesPost = true;
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

    await userPage.goto("/workbench/favorites", { waitUntil: "domcontentloaded" });
    await userPage.getByRole("button", { name: "Open Ask Cohi" }).click();
    const input = userPage.getByPlaceholder("Ask a follow-up…");
    await input.fill("What can I do in the workbench?");
    await input.press("Enter");

    await expect.poll(() => sawMessagesPost).toBeTruthy();
    await expect(userPage.getByText(new RegExp(UNIFIED_CHAT_STUB_TEXT, "i"))).toBeVisible({
      timeout: 15_000,
    });
  });

  test("@critical @COHI-386 @COHI-397 AC4 hub resume loads conversation", async ({ userPage }) => {
    await mockV1MessageStream(userPage);
    await gotoWithUnifiedChatShell(userPage, "/insights");

    await userPage.evaluate(() => {
      window.dispatchEvent(
        new CustomEvent("cohi-chat-resume", {
          detail: { conversationId: "550e8400-e29b-41d4-a716-446655440001", chatType: "chat" },
        }),
      );
    });

    await expect(userPage.getByTestId("unified-chat-shell")).toBeVisible();
  });

  test("@critical @COHI-386 @COHI-397 @COHI-393 AC4 workbench action smoke", async ({ userPage }) => {
    await mockV1MessageStream(userPage, { actionsBlock: true });
    await gotoWithUnifiedChatShell(userPage, "/my-dashboard/new");

    await selectUnifiedChatType(userPage, "Workbench");

    const input = unifiedChatMessageInput(userPage);
    await input.fill("Add the volume chart");
    await input.press("Enter");

    await expect(userPage.getByText(new RegExp(UNIFIED_CHAT_STUB_TEXT, "i"))).toBeVisible({
      timeout: 20_000,
    });
  });
});
