import { test, expect } from "./fixtures";
import {
  buildV1StreamSseBody,
  expandChatShellForResearch,
  forceUnifiedChat,
  gotoWithUnifiedChatShell,
  mockUnifiedChatApis,
  mockUnifiedChatTenantApi,
  mockV1MessageStream,
  mockV1Messages,
  mockV1Permissions,
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

    await gotoWithUnifiedChatShell(userPage, "/insights?mode=research");
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

  test("@critical research stream accepts uploadIds on new session", async ({
    userPage,
  }) => {
    await mockUnifiedChatTenantApi(userPage);
    await mockV1Permissions(userPage);
    await mockV1Messages(userPage);

    const uploadIds = ["550e8400-e29b-41d4-a716-446655440099"];
    let streamBody: Record<string, unknown> | null = null;
    const conversationId = "550e8400-e29b-41d4-a716-446655440001";
    const turnId = "6ba7b810-9dad-11d1-80b4-00c04fd430c9";

    await userPage.route(/\/api\/research\/uploads(?:\?.*)?$/, async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ uploads: [] }),
        });
        return;
      }
      if (route.request().method() === "POST") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            id: uploadIds[0],
            originalFileName: "qa.csv",
            rowCount: 10,
            status: "ready",
          }),
        });
        return;
      }
      await route.continue();
    });

    await userPage.route(/\/api\/chat\/v1\/messages:stream(?:\?.*)?$/, async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      streamBody = route.request().postDataJSON() as Record<string, unknown>;
      const sse = buildV1StreamSseBody(
        conversationId,
        turnId,
        [{ type: "text", markdown: UNIFIED_CHAT_STUB_TEXT }],
        {
          researchSessionId: "e2e-research-session-1",
          researchShellExpand: true,
        },
      );
      await route.fulfill({
        status: 200,
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
        },
        body: sse,
      });
    });

    await gotoWithUnifiedChatShell(userPage, "/insights?mode=research");
    await expandChatShellForResearch(userPage);
    await selectUnifiedChatType(userPage, "Research");

    await userPage.getByRole("button", { name: /Upload CSV/i }).click();
    const fileInput = userPage.locator('input[type="file"]').last();
    await fileInput.setInputFiles({
      name: "qa.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("a,b\n1,2\n"),
    });
    await expect(userPage.getByText(/1 CSV attached/i)).toBeVisible({
      timeout: 10_000,
    });

    const input = unifiedChatMessageInput(userPage);
    await input.fill("Analyze attached CSV");
    await input.press("Enter");

    await expect(userPage.getByTestId("unified-research-workspace")).toBeVisible({
      timeout: 25_000,
    });

    expect(streamBody).not.toBeNull();
    const options = (streamBody as { options?: { research?: { uploadIds?: string[] } } })
      ?.options;
    expect(options?.research?.uploadIds).toEqual(uploadIds);
  });

  test("@critical @COHI-386 @COHI-402 @COHI-397 AC4 research-in-chat workspace visible", async ({
    userPage,
  }) => {
    await mockV1MessageStream(userPage, {
      researchShellExpand: true,
      researchSessionId: "e2e-research-session-1",
    });
    await gotoWithUnifiedChatShell(userPage, "/insights?mode=research");
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
