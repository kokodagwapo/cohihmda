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

test.describe("Unified chat running history (Cursor-style)", () => {
  test.beforeEach(async ({ userPage }) => {
    await forceUnifiedChat(userPage);
    await mockUnifiedChatTenantApi(userPage);
    await mockV1Permissions(userPage);
  });

  test("@COHI-398 @critical shows spinner on in-flight conversation in history", async ({
    userPage,
  }) => {
    let streamCount = 0;

    await userPage.route(/\/api\/chat\/v1\/messages:stream(?:\?.*)?$/, async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      streamCount += 1;
      if (streamCount === 1) {
        await new Promise((r) => setTimeout(r, 3_000));
      }
      const conversationId =
        streamCount === 1
          ? "11111111-1111-4111-8111-111111111111"
          : "22222222-2222-4222-8222-222222222222";
      const body = buildV1StreamSseBody(
        conversationId,
        "6ba7b810-9dad-11d1-80b4-00c04fd430c9",
        [
          {
            type: "text",
            markdown:
              streamCount === 1 ? "Still working on the first chat." : "Second chat reply.",
          },
        ],
        { chatType: "workbench", route: "workbench" },
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
    await input.fill("Build MTD executive dashboard");
    await input.press("Enter");

    const historyToggle = userPage.getByTitle("Chat history");
    if (await historyToggle.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await historyToggle.click();
    }

    await userPage.getByTitle("New conversation").click({ timeout: 10_000 });

    await input.fill("Quick follow-up question");
    await input.press("Enter");

    const firstTitle = userPage.getByText("Build MTD executive dashboard").first();
    await expect(firstTitle).toBeVisible({ timeout: 10_000 });

    const row = firstTitle.locator(
      "xpath=ancestor::button[1] | ancestor::a[1] | ancestor::li[1]",
    );
    await expect(row.getByTestId("conversation-running-spinner")).toBeVisible({
      timeout: 8_000,
    });
  });

  test("@COHI-398 @critical composer stays enabled for new chat while another streams", async ({
    userPage,
  }) => {
    let streamCount = 0;

    await userPage.route(/\/api\/chat\/v1\/messages:stream(?:\?.*)?$/, async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      streamCount += 1;
      if (streamCount === 1) {
        await new Promise((r) => setTimeout(r, 4_000));
      }
      const conversationId =
        streamCount === 1
          ? "11111111-1111-4111-8111-111111111111"
          : "22222222-2222-4222-8222-222222222222";
      const body = buildV1StreamSseBody(
        conversationId,
        "6ba7b810-9dad-11d1-80b4-00c04fd430c9",
        [{ type: "text", markdown: streamCount === 1 ? "First still running." : "Second done." }],
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
    await input.fill("First long-running question");
    await input.press("Enter");

    await userPage.getByTitle("New conversation").click({ timeout: 10_000 });

    await expect(input).toBeEnabled({ timeout: 5_000 });

    await input.fill("Second question while first runs");
    await input.press("Enter");

    await expect(
      userPage.getByText(/other chat is still generating/i).first(),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("@COHI-398 @critical clears history spinner and background badge after run completes", async ({
    userPage,
  }) => {
    let streamCount = 0;

    await userPage.route(/\/api\/chat\/v1\/messages:stream(?:\?.*)?$/, async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      streamCount += 1;
      if (streamCount === 1) {
        await new Promise((r) => setTimeout(r, 2_500));
      }
      const conversationId =
        streamCount === 1
          ? "11111111-1111-4111-8111-111111111111"
          : "22222222-2222-4222-8222-222222222222";
      const body = buildV1StreamSseBody(
        conversationId,
        "6ba7b810-9dad-11d1-80b4-00c04fd430c9",
        [
          {
            type: "text",
            markdown: streamCount === 1 ? "First chat finished." : "Second chat finished.",
          },
        ],
        { chatType: "workbench", route: "workbench" },
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
    await input.fill("First long-running question");
    await input.press("Enter");

    const historyToggle = userPage.getByTitle("Chat history");
    if (await historyToggle.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await historyToggle.click();
    }

    const firstTitle = userPage.getByText("First long-running question").first();
    const firstRow = firstTitle.locator(
      "xpath=ancestor::button[1] | ancestor::a[1] | ancestor::li[1]",
    );
    await expect(firstRow.getByTestId("conversation-running-spinner")).toBeVisible({
      timeout: 8_000,
    });

    await userPage.getByTitle("New conversation").click({ timeout: 10_000 });
    await input.fill("Second quick question");
    await input.press("Enter");

    await expect(
      userPage.getByText(/other chat is still generating/i).first(),
    ).toBeVisible({ timeout: 10_000 });

    await expect(firstRow.getByTestId("conversation-running-spinner")).toHaveCount(0, {
      timeout: 12_000,
    });
    await expect(userPage.getByText(/other chat is still generating/i)).toHaveCount(0, {
      timeout: 12_000,
    });
  });
});


