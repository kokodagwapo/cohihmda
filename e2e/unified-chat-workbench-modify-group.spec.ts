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

const MTD_WIDGETS = [
  {
    type: "create_widget",
    sql: "SELECT COUNT(*) AS funded_units FROM public.loans l WHERE l.funding_date IS NOT NULL",
    title: "Funded Units",
    config: { type: "kpi", yKey: "funded_units" },
    filterConfig: {
      filterable: true,
      dateColumn: "funding_date",
      defaultPreset: "MTD",
    },
  },
  {
    type: "create_widget",
    sql: "SELECT SUM(l.loan_amount) AS funded_volume FROM public.loans l WHERE l.funding_date IS NOT NULL",
    title: "Funded Volume",
    config: { type: "kpi", yKey: "funded_volume", numberFormat: "compact" },
    filterConfig: {
      filterable: true,
      dateColumn: "funding_date",
      defaultPreset: "MTD",
    },
  },
];

test.describe("Unified chat workbench modify_group", () => {
  test.beforeEach(async ({ userPage }) => {
    await forceUnifiedChat(userPage);
    await mockUnifiedChatTenantApi(userPage);
    await mockV1Permissions(userPage);

    await userPage.route(/\/api\/cohi-chat\/execute-sql(?:\?.*)?$/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: [{ funded_units: 42, funded_volume: 1_250_000 }],
        }),
      });
    });

    let streamCount = 0;
    await userPage.route(/\/api\/chat\/v1\/messages:stream(?:\?.*)?$/, async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      streamCount += 1;
      const blocks =
        streamCount === 1
          ? [
              { type: "text", markdown: "Built your dashboard." },
              { type: "actions", items: MTD_WIDGETS },
            ]
          : [
              {
                type: "text",
                markdown: "Removed Funded Units from the group.",
              },
              {
                type: "actions",
                items: [
                  {
                    type: "modify_group",
                    groupId: "executive-dashboard",
                    operations: [{ op: "remove", widgetId: "Funded Units" }],
                    explanation: "Removed Funded Units",
                  },
                ],
              },
            ];

      const body = buildV1StreamSseBody(
        "550e8400-e29b-41d4-a716-446655440001",
        "6ba7b810-9dad-11d1-80b4-00c04fd430c9",
        blocks,
        { chatType: "workbench", route: "workbench" },
      );
      await route.fulfill({
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
        body,
      });
    });
  });

  test("@COHI-398 @critical removes a group widget via modify_group remove", async ({ userPage }) => {
    await gotoWithUnifiedChatShell(userPage, "/my-dashboard/new");
    await selectUnifiedChatType(userPage, "Workbench");

    const input = unifiedChatMessageInput(userPage);
    await input.fill("Build MTD dashboard");
    await input.press("Enter");

    await expect(userPage.getByText("Funded Units", { exact: true })).toBeVisible({
      timeout: 25_000,
    });
    await expect(userPage.getByText("Funded Volume", { exact: true })).toBeVisible();

    await input.fill("Remove the Funded Units widget from the dashboard");
    await input.press("Enter");

    await expect(userPage.getByText("Funded Units", { exact: true })).toBeHidden({
      timeout: 20_000,
    });
    await expect(userPage.getByText("Funded Volume", { exact: true })).toBeVisible();
  });
});


