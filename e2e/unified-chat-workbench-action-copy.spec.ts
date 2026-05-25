import { test, expect } from "./fixtures";
import {
  buildV1StreamSseBody,
  forceUnifiedChat,
  gotoWithUnifiedChatShell,
  mockUnifiedChatTenantApi,
  mockV1Permissions,
  selectUnifiedChatType,
  unifiedChatMessageInput,
} from "./helpers/unifiedChat";

test.describe("Workbench chat action summaries", () => {
  test.beforeEach(async ({ userPage }) => {
    await forceUnifiedChat(userPage);
    await mockUnifiedChatTenantApi(userPage);
    await mockV1Permissions(userPage);
  });

  test("@COHI-398 @critical shows period-update copy for modify_group not widget-create copy", async ({
    userPage,
  }) => {
    await userPage.route(/\/api\/chat\/v1\/messages:stream(?:\?.*)?$/, async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      const body = buildV1StreamSseBody(
        "550e8400-e29b-41d4-a716-446655440001",
        "6ba7b810-9dad-11d1-80b4-00c04fd430c9",
        [
          { type: "text", markdown: "Switched the dashboard to YTD." },
          {
            type: "actions",
            items: [
              {
                type: "modify_group",
                groupId: "grp-1",
                operations: [{ op: "set_period", preset: "YTD" }],
              },
            ],
          },
        ],
        { chatType: "workbench" },
      );
      await route.fulfill({
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
        body,
      });
    });

    await gotoWithUnifiedChatShell(userPage, "/my-dashboard/new");
    await selectUnifiedChatType(userPage, "Workbench");

    const input = unifiedChatMessageInput(userPage);
    await input.fill("Switch to YTD");
    await input.press("Enter");

    await expect(userPage.getByText("Updated dashboard period")).toBeVisible({
      timeout: 20_000,
    });
    await expect(userPage.getByText(/Applied \d+ widgets to canvas/i)).toHaveCount(0);
  });
});


