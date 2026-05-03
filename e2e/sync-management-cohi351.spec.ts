import { test as base, expect, type Page } from "@playwright/test";
import path from "node:path";

const platformAdminStatePath = path.join(process.cwd(), "e2e", ".auth", "platform-admin.json");

const test = base.extend<{ platformAdminPage: Page }>({
  platformAdminPage: async ({ browser }, use) => {
    const context = await browser.newContext({ storageState: platformAdminStatePath });
    const page = await context.newPage();
    await use(page);
    await context.close();
  },
});

const syncManagementPayload = {
  connections: [
    {
      id: "los-conn-351",
      name: "Production Encompass",
      los_type: "encompass",
      connection_method: "api",
      sync_enabled: true,
      sync_frequency: "hourly",
      last_synced_at: null,
      last_sync_status: null,
      last_sync_error: null,
      last_loan_modified_at: null,
      is_active: true,
      insights_auto_enabled: true,
      podcast_auto_enabled: true,
      encompass_users_sync_enabled: true,
      sync_business_days_only: false,
      insights_business_days_only: false,
      scheduler_timezone: "America/New_York",
      sync_allowed_weekdays: [1, 2, 3, 4, 5],
      sync_run_at_times: [],
      last_encompass_users_sync_at: null,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
      tenant_id: "tenant-cohi-351",
      tenant_name: "Cohi Test Tenant",
      tenant_slug: "cohi-test",
      loan_count: 42,
    },
  ],
  scheduler: {
    interval_minutes: 15,
    next_run_estimate: "2026-01-01T00:15:00.000Z",
  },
  total_tenants: 1,
  tenants: [{ id: "tenant-cohi-351", name: "Cohi Test Tenant", slug: "cohi-test" }],
  podcast: { nightly_enabled: false, nightly_last_run_at: null },
};

test.describe("@COHI-351 @soc2 Sync Management scheduling controls", () => {
  test.skip(
    !process.env.E2E_PLATFORM_ADMIN_EMAIL,
    "Requires E2E_PLATFORM_ADMIN_* credentials because Sync Management is platform-admin only",
  );

  test("@COHI-351 platform admin can view and update explicit sync run times", async ({ platformAdminPage }) => {
    const adminPage = platformAdminPage;
    let updateBody: Record<string, unknown> | undefined;

    await adminPage.route("**/api/admin/sync-management", async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({ json: syncManagementPayload });
        return;
      }
      await route.continue();
    });
    await adminPage.route("**/api/admin/sync-management/los-conn-351", async (route) => {
      updateBody = JSON.parse(route.request().postData() || "{}");
      await route.fulfill({
        json: {
          connection: {
            ...syncManagementPayload.connections[0],
            ...updateBody,
          },
        },
      });
    });
    await adminPage.route("**/api/admin/sync-management/los-conn-351/history**", async (route) => {
      await route.fulfill({ json: { history: [] } });
    });
    await adminPage.route("**/api/admin/sync-management/los-conn-351/hook-status**", async (route) => {
      await route.fulfill({ json: { hookRuns: [] } });
    });

    await adminPage.goto("/admin", { waitUntil: "domcontentloaded" });
    await adminPage.getByRole("button", { name: "Sync Management" }).click();
    await expect(adminPage.getByText("Production Encompass")).toBeVisible();

    await adminPage.getByTitle("Edit schedule (timezone, days, run times)").click();
    await expect(adminPage.getByText("Run at specific times")).toBeVisible();
    await expect(adminPage.getByText("Timezone")).toBeVisible();
    await expect(adminPage.getByText("Allowed days")).toBeVisible();
    await expect(adminPage.getByText(/legacy/i)).toHaveCount(0);

    await adminPage.getByRole("button", { name: "Save schedule" }).click();

    expect(updateBody).toEqual({
      tenant_id: "tenant-cohi-351",
      scheduler_timezone: "America/New_York",
      sync_allowed_weekdays: [1, 2, 3, 4, 5],
      sync_business_days_only: true,
      sync_run_at_times: [
        { hour: 8, minute: 0 },
        { hour: 18, minute: 0 },
      ],
    });
  });
});
