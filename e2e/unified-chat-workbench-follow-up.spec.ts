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

const CONVERSATION_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const MTD_WIDGETS = [
  {
    type: "create_widget",
    sql: "SELECT COUNT(*) AS funded_units FROM public.loans l WHERE l.funding_date IS NOT NULL",
    title: "Funded Units",
    config: { type: "kpi", yKey: "funded_units" },
    filterConfig: { filterable: true, dateColumn: "funding_date", defaultPreset: "MTD" },
  },
];

test.describe("Workbench chat follow-up in same conversation", () => {
  test.beforeEach(async ({ userPage }) => {
    await forceUnifiedChat(userPage);
    await mockUnifiedChatTenantApi(userPage);
    await mockV1Permissions(userPage);

    await userPage.route(/\/api\/cohi-chat\/execute-sql(?:\?.*)?$/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: [{ funded_units: 10 }] }),
      });
    });
  });

  test("@COHI-398 @critical reuses conversationId on second workbench turn after split", async ({
    userPage,
  }) => {
    const streamPosts: Array<{ conversationId?: string; message?: string }> = [];
    let streamCount = 0;

    await userPage.route(/\/api\/chat\/v1\/messages:stream(?:\?.*)?$/, async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      streamCount += 1;
      const body = route.request().postDataJSON() as {
        conversationId?: string;
        message?: string;
      };
      streamPosts.push(body);

      const blocks =
        streamCount === 1
          ? [
              { type: "text", markdown: "Built your dashboard." },
              { type: "actions", items: MTD_WIDGETS },
            ]
          : [
              { type: "text", markdown: "Switched to year-to-date." },
              {
                type: "actions",
                items: [
                  {
                    type: "modify_group",
                    groupId: "executive-dashboard",
                    operations: [{ op: "set_period", preset: "YTD" }],
                  },
                ],
              },
            ];

      const body_sse = buildV1StreamSseBody(
        CONVERSATION_ID,
        "6ba7b810-9dad-11d1-80b4-00c04fd430c9",
        blocks,
        { chatType: "workbench", route: "workbench" },
      );
      await route.fulfill({
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
        body: body_sse,
      });
    });

    await gotoWithUnifiedChatShell(userPage, "/my-dashboard/new");
    await selectUnifiedChatType(userPage, "Workbench");

    const input = unifiedChatMessageInput(userPage);
    await input.fill("Build MTD dashboard");
    await input.press("Enter");

    await expect(userPage.getByText("Funded Units", { exact: true }).first()).toBeVisible({
      timeout: 25_000,
    });
    await expect(input).toBeEnabled({ timeout: 90_000 });

    await input.fill("Switch the whole dashboard to year-to-date");
    await input.press("Enter");

    await expect
      .poll(() => streamPosts.length, { timeout: 30_000 })
      .toBeGreaterThanOrEqual(2);

    expect(streamPosts[1]?.conversationId).toBe(CONVERSATION_ID);
    await expect(
      userPage.getByText(/Updated dashboard period|Switched to year-to-date/i).first(),
    ).toBeVisible({ timeout: 20_000 });
  });
});


