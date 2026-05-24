import { test, expect } from "./fixtures";
import {
  forceUnifiedChat,
  gotoWithUnifiedChatShell,
  mockUnifiedChatApis,
  mockUnifiedChatTenantApi,
  mockV1Permissions,
  selectUnifiedChatType,
  unifiedChatMessageInput,
} from "./helpers/unifiedChat";

test.describe("Workbench all-time KPI scope", () => {
  test.beforeEach(async ({ userPage }) => {
    await forceUnifiedChat(userPage);
    await mockUnifiedChatTenantApi(userPage);
    await mockV1Permissions(userPage);
  });

  test("@critical all-time widget executes SQL without dateFilter injection", async ({
    userPage,
  }) => {
    const sqlStarts: string[] = [];
    let executesWithoutDateFilter = 0;

    await userPage.route(/\/api\/cohi-chat\/execute-sql(?:\?.*)?$/, async (route) => {
      try {
        const body = route.request().postDataJSON() as {
          dateFilter?: { start?: string };
        };
        if (body?.dateFilter?.start) sqlStarts.push(body.dateFilter.start);
        else executesWithoutDateFilter += 1;
      } catch {
        /* ignore */
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: [{ total_funded: 12_345 }] }),
      });
    });

    await mockUnifiedChatApis(userPage, {
      replyText: "Added an all-time funded loans KPI.",
      actionItems: [
        {
          type: "create_widget",
          sql: "SELECT COUNT(*) AS total_funded FROM public.loans l WHERE l.funding_date IS NOT NULL",
          title: "Total Funded Loans",
          config: { type: "kpi", yKey: "total_funded" },
          filterConfig: { filterable: false, dateColumn: "funding_date", defaultPreset: null },
        },
      ],
    });

    await gotoWithUnifiedChatShell(userPage, "/my-dashboard/new");
    await selectUnifiedChatType(userPage, "Workbench");

    const input = unifiedChatMessageInput(userPage);
    await input.fill("Add one KPI for total funded loans all time");
    await input.press("Enter");

    await expect(
      userPage.getByRole("heading", { name: "Total Funded Loans" }).first(),
    ).toBeVisible({ timeout: 25_000 });

    await expect
      .poll(() => executesWithoutDateFilter, { timeout: 15_000 })
      .toBeGreaterThan(0);

    expect(sqlStarts).toHaveLength(0);
  });
});
