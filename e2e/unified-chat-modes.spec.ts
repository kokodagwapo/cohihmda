import { test, expect } from "./fixtures";
import {
  dismissBlockingOverlays,
  forceUnifiedChat,
  mockUnifiedChatApis,
  mockUnifiedChatTenantApi,
  mockV1MessageStream,
  mockV1Permissions,
  UNIFIED_CHAT_STUB_TEXT,
  selectUnifiedChatType,
  unifiedChatMessageInput,
} from "./helpers/unifiedChat";

test.describe("Unified chat modes (COHI-406)", () => {
  test.beforeEach(async ({ userPage }) => {
    await forceUnifiedChat(userPage);
    await mockUnifiedChatTenantApi(userPage);
    await mockV1Permissions(userPage);
  });

  test("@critical @COHI-406 AC1 mode selector four options", async ({ userPage }) => {
    await mockUnifiedChatApis(userPage);
    await userPage.goto("/insights", { waitUntil: "domcontentloaded" });
    const selector = userPage.getByRole("combobox", { name: "Chat type" });
    await expect(selector).toBeVisible({ timeout: 15_000 });
    await selector.click();
    const options = userPage.getByRole("option");
    await expect(options).toHaveCount(4, { timeout: 10_000 });
    await expect(options).toContainText([
      "Chat",
      "Research",
      "Insight builder",
      "Workbench",
    ]);
  });

  test("@critical @COHI-406 AC2 deep analysis only in Research", async ({ userPage }) => {
    await mockUnifiedChatApis(userPage);
    await userPage.goto("/insights", { waitUntil: "domcontentloaded" });
    const selector = userPage.getByRole("combobox", { name: "Chat type" });
    await expect(selector).toBeVisible({ timeout: 15_000 });

    await expect(userPage.getByRole("checkbox", { name: /deep analysis/i })).toHaveCount(0);

    await selectUnifiedChatType(userPage, "Research");
    await expect(userPage.getByRole("checkbox", { name: /deep analysis/i })).toBeVisible();
  });

  test("@critical @COHI-406 AC3 insight Approve persists Request changes does not", async ({
    userPage,
  }) => {
    let streamBodies: Array<{ message?: string }> = [];
    await mockV1MessageStream(userPage, { insightBuilderPreview: true });
    await userPage.on("request", (req) => {
      if (
        req.method() === "POST" &&
        /\/api\/chat\/v1\/messages:stream(?:\?.*)?$/.test(req.url())
      ) {
        streamBodies.push(req.postDataJSON() as { message?: string });
      }
    });

    await userPage.goto("/insights", { waitUntil: "domcontentloaded" });
    await dismissBlockingOverlays(userPage);
    await userPage.getByRole("button", { name: "Taller" }).click({ force: true });
    await selectUnifiedChatType(userPage, "Insight builder");

    const input = unifiedChatMessageInput(userPage);
    await input.fill("Draft an insight on branch mix");
    await input.press("Enter");

    await expect(
      userPage.getByText("Review insight prompt draft"),
    ).toBeVisible({ timeout: 20_000 });
    await expect(userPage.getByRole("button", { name: "Approve" })).toBeVisible({
      timeout: 10_000,
    });
    const sendsBeforeApprove = streamBodies.length;
    await userPage.getByRole("button", { name: "Approve" }).click();
    await expect.poll(() => streamBodies.length).toBeGreaterThan(sendsBeforeApprove);
    expect(streamBodies.at(-1)?.message ?? "").toMatch(/^approve$/i);

    await userPage.getByRole("button", { name: "Request changes" }).click();
    expect(streamBodies.at(-1)?.message ?? "").toMatch(/change this draft/i);
  });

  test("@critical @COHI-406 @COHI-393 AC4 workbench sends chat_type workbench", async ({
    userPage,
  }) => {
    await mockUnifiedChatApis(userPage);
    const chatTypes: string[] = [];
    await userPage.on("request", (req) => {
      if (
        req.method() === "POST" &&
        /\/api\/chat\/v1\/messages:stream(?:\?.*)?$/.test(req.url())
      ) {
        const body = req.postDataJSON() as { chat_type?: string } | null;
        if (body?.chat_type) chatTypes.push(body.chat_type);
      }
    });

    await userPage.goto("/my-dashboard/new", { waitUntil: "domcontentloaded" });
    await expect(userPage.getByTestId("unified-chat-shell")).toBeVisible({
      timeout: 15_000,
    });

    await selectUnifiedChatType(userPage, "Workbench");

    const input = unifiedChatMessageInput(userPage);
    await input.fill("Add scorecard widget");
    await input.press("Enter");

    await expect(userPage.getByText(new RegExp(UNIFIED_CHAT_STUB_TEXT, "i"))).toBeVisible({
      timeout: 20_000,
    });
    expect(chatTypes).toContain("workbench");
  });
});
