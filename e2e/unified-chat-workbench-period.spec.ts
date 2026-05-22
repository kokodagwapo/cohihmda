import { test, expect } from "./fixtures";
import {
  forceUnifiedChat,
  gotoWithUnifiedChatShell,
  mockUnifiedChatTenantApi,
  mockV1Permissions,
  selectUnifiedChatType,
  unifiedChatMessageInput,
} from "./helpers/unifiedChat";

test.describe("Unified chat workbench period scope (COHI-398)", () => {
  test.beforeEach(async ({ userPage }) => {
    await forceUnifiedChat(userPage);
    await mockUnifiedChatTenantApi(userPage);
    await mockV1Permissions(userPage);
  });

  test("@critical @COHI-398 applies MTD group filters from mocked create_widget actions", async ({
    userPage,
  }) => {
    await userPage.route(/\/api\/chat\/v1\/messages:stream(?:\?.*)?$/, async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      const conversationId = "550e8400-e29b-41d4-a716-446655440099";
      const turnId = "6ba7b810-9dad-11d1-80b4-00c04fd43099";
      const blocks = [
        {
          type: "text",
          markdown: "Built an executive dashboard for this month.",
        },
        {
          type: "actions",
          items: [
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
          ],
        },
      ];
      const events = [
        { event: "turn.started", conversationId, turnId },
        { event: "block.delta", conversationId, turnId, blocks },
        {
          event: "turn.completed",
          conversationId,
          turnId,
          metadata: { route: "workbench", suggestedQuestions: [] },
        },
      ];
      const body = events.map((ev) => `data: ${JSON.stringify(ev)}\n\n`).join("");
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        headers: { "Cache-Control": "no-cache" },
        body,
      });
    });

    await gotoWithUnifiedChatShell(userPage, "/my-dashboard/new");
    await selectUnifiedChatType(userPage, "Workbench");

    const input = unifiedChatMessageInput(userPage);
    await input.fill("fresh dashboard for this month");
    await input.press("Enter");

    await expect(userPage.getByText("Funded Units", { exact: true })).toBeVisible({
      timeout: 25_000,
    });
    await expect(userPage.getByText("Funded Volume", { exact: true })).toBeVisible({
      timeout: 10_000,
    });
    await expect(userPage.getByText(/Funded Units MTD/i)).toHaveCount(0);
    await expect(
      userPage.locator("button").filter({ hasText: /^MTD$/ }).first(),
    ).toBeVisible({ timeout: 15_000 });
  });
});
