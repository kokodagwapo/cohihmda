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

const MTD_DASHBOARD_ACTIONS = [
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

test.describe("Unified chat workbench period scope (COHI-398)", () => {
  test.beforeEach(async ({ userPage }) => {
    await forceUnifiedChat(userPage);
    await mockUnifiedChatTenantApi(userPage);
    await mockV1Permissions(userPage);
  });

  test("@critical @COHI-398 applies MTD group filters from mocked create_widget actions", async ({
    userPage,
  }) => {
    const sqlDateFilters: Array<{ start?: string; end?: string; column?: string }> = [];

    await userPage.route(/\/api\/cohi-chat\/execute-sql(?:\?.*)?$/, async (route) => {
      try {
        const body = route.request().postDataJSON() as {
          dateFilter?: { start?: string; end?: string; column?: string };
        };
        if (body?.dateFilter) sqlDateFilters.push(body.dateFilter);
      } catch {
        /* ignore */
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: [{ funded_units: 42, funded_volume: 1_250_000 }],
        }),
      });
    });

    await mockUnifiedChatApis(userPage, {
      replyText: "Built an executive dashboard for this month.",
      actionItems: MTD_DASHBOARD_ACTIONS,
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

    await expect
      .poll(() => sqlDateFilters.length, { timeout: 15_000 })
      .toBeGreaterThan(0);

    const now = new Date();
    const expectedStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
    const hasMtdScopedFilter = sqlDateFilters.some(
      (f) =>
        f.column === "funding_date" &&
        f.start === expectedStart &&
        typeof f.end === "string" &&
        f.end.length === 10,
    );
    expect(hasMtdScopedFilter).toBe(true);
  });
});
