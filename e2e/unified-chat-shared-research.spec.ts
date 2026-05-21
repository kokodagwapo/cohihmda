import { test, expect } from "./fixtures";
import {
  expandChatShellForResearch,
  forceUnifiedChat,
  mockResearchSession,
  mockUnifiedChatApis,
  mockV1ConversationsList,
  unifiedChatMessageInput,
} from "./helpers/unifiedChat";

test.describe("Unified shared research (COHI-402)", () => {
  test.beforeEach(async ({ userPage }) => {
    await forceUnifiedChat(userPage);
    await mockUnifiedChatApis(userPage);
  });

  test("@critical @COHI-386 shared research shows pill and read-only composer", async ({
    userPage,
  }) => {
    const sharedConversationId = "550e8400-e29b-41d4-a716-446655440088";
    const researchSessionId = "550e8400-e29b-41d4-a716-446655440077";

    await mockV1ConversationsList(
      userPage,
      [],
      {
        sharedWithMe: [
          {
            id: sharedConversationId,
            title: "Shared investigation",
            chat_type: "research",
            shared_by_email: "owner@example.com",
            legacy_ref: researchSessionId,
          },
        ],
      },
    );

    await mockResearchSession(userPage, {
      id: researchSessionId,
      isOwner: false,
      ownerEmail: "owner@example.com",
      phase: "complete",
    });

    await userPage.route(
      new RegExp(`/api/chat/v1/conversations/${sharedConversationId}(?:\\?.*)?$`),
      async (route) => {
        if (route.request().method() !== "GET") {
          await route.continue();
          return;
        }
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            id: sharedConversationId,
            title: "Shared investigation",
            chat_type: "research",
            legacy_ref: researchSessionId,
            messages: [],
          }),
        });
      },
    );

    await userPage.goto("/insights", { waitUntil: "domcontentloaded" });
    await expect(userPage.getByText("Shared With Me", { exact: true })).toBeVisible({
      timeout: 15_000,
    });
    await userPage.getByText("Shared investigation").click();

    await expandChatShellForResearch(userPage);

    const workspace = userPage.getByTestId("unified-research-workspace");
    await expect(workspace).toBeVisible({ timeout: 20_000 });
    await expect(workspace.getByText(/Shared by owner@example.com/i)).toBeVisible();
    await expect(
      userPage.getByText(/View-only — you cannot send messages/i),
    ).toBeVisible();
    await expect(unifiedChatMessageInput(userPage)).toBeDisabled();
  });
});
