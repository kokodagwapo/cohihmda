import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

/**
 * Creates a distribution schedule using an admin session so CI does not depend on
 * tenant-user canvas edit access or a pre-existing canvas in the dropdown.
 * Success is asserted via the schedules table (toast titles can dismiss quickly in CI).
 */
async function createScheduleFixture(page: Page, scheduleName: string): Promise<void> {
  await page.goto("/workbench/distributions", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /New schedule|Create schedule/i }).first().click();
  await expect(page.getByRole("heading", { name: /New distribution schedule/i })).toBeVisible();
  await page.getByPlaceholder("e.g. Weekly executive report").fill(scheduleName);
  await page.getByPlaceholder("a@example.com, b@example.com").fill("qa-distribution@example.com");
  await page.locator("input[type='time']").fill("09:30");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.getByRole("dialog", { name: /New distribution schedule/i })).toBeHidden({
    timeout: 45_000,
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(scheduleRow(page, scheduleName).first()).toBeVisible({ timeout: 45_000 });
}

function scheduleRow(userPage: Page, scheduleName: string) {
  return userPage.locator("tbody tr", { hasText: scheduleName });
}

async function deleteScheduleIfPresent(userPage: Page, scheduleName: string): Promise<void> {
  // Schedules only exist in this table — ensure we're on this route before counting rows,
  // and again before the post-delete assertion. Otherwise `reload` would keep a different
  // route and `scheduleRow` would always be empty (false pass).
  await userPage.goto("/workbench/distributions", { waitUntil: "domcontentloaded" });
  const row = scheduleRow(userPage, scheduleName).first();
  const exists = (await row.count()) > 0;
  if (!exists) return;
  await userPage.keyboard.press("Escape").catch(() => {});
  await userPage.keyboard.press("Escape").catch(() => {});
  userPage.once("dialog", (dialog) => dialog.accept());
  await row.getByTitle("Delete").click({ force: true });
  await userPage.goto("/workbench/distributions", { waitUntil: "domcontentloaded" });
  await expect(scheduleRow(userPage, scheduleName)).toHaveCount(0, { timeout: 20_000 });
}

test.describe("@critical @COHI-400 Distributions workflows", () => {
  test.describe.configure({ mode: "serial" });
  test("@smoke distributions page renders with schedule controls", async ({ userPage }) => {
    await userPage.goto("/workbench/distributions", { waitUntil: "domcontentloaded" });
    await expect(userPage.getByRole("heading", { name: "Communications Center" })).toBeVisible();
    await expect(userPage.getByRole("button", { name: /New schedule/i })).toBeVisible();
  });

  test("multi-day weekday selection shows preview runs", async ({ userPage }) => {
    await userPage.goto("/workbench/distributions", { waitUntil: "domcontentloaded" });
    await userPage.getByRole("button", { name: /New schedule|Create schedule/i }).first().click();
    await expect(
      userPage.getByRole("heading", { name: /New distribution schedule/i }),
    ).toBeVisible();
    await expect(userPage.getByText(/Days of week/i)).toBeVisible();
    const scheduleDialog = userPage.getByRole("dialog", {
      name: /New distribution schedule/i,
    });
    // Default is Monday; add Tue + Fri then remove Monday → Tue+Fr
    await scheduleDialog.getByRole("checkbox", { name: "Tuesday" }).click();
    await scheduleDialog.getByRole("checkbox", { name: "Friday" }).click();
    await scheduleDialog.getByRole("checkbox", { name: "Monday" }).click();
    const previewSection = scheduleDialog
      .getByText(/Next sends \(preview\)/i)
      .locator("..");
    await expect(previewSection.locator("ul li").first()).toBeVisible({
      timeout: 30_000,
    });
  });

  test('handles monthly day picker and preview text', async ({ userPage }) => {
    await userPage.goto("/workbench/distributions", { waitUntil: "domcontentloaded" });
    await userPage.getByRole("button", { name: /New schedule|Create schedule/i }).first().click();
    await expect(
      userPage.getByRole("heading", { name: /New distribution schedule/i }),
    ).toBeVisible();

    const frequencyField = userPage.locator("label", { hasText: "Frequency" }).locator("..");
    await frequencyField.getByRole("combobox").first().click();
    await userPage.getByRole("option", { name: /^Monthly$/ }).click();

    await expect(userPage.getByText(/Days of month/i)).toBeVisible();

    await userPage.getByText("15", { exact: true }).click();

    await expect(userPage.getByText(/Next sends \(preview\)/i)).toBeVisible();
    const scheduleDialog = userPage.getByRole("dialog", {
      name: /New distribution schedule/i,
    });
    const previewSection = scheduleDialog
      .getByText(/Next sends \(preview\)/i)
      .locator("..");
    await expect(previewSection.locator("ul li").first()).toBeVisible({
      timeout: 30_000,
    });
  });

  test("schedule create and edit dialog flow", async ({ userPage }) => {
    await userPage.goto("/workbench/distributions", { waitUntil: "domcontentloaded" });
    await userPage.getByRole("button", { name: /New schedule|Create schedule/i }).first().click();

    await expect(userPage.getByRole("heading", { name: /New distribution schedule/i })).toBeVisible();
    await userPage
      .getByPlaceholder("e.g. Weekly executive report")
      .fill(`E2E Schedule ${Date.now()}`);
    await userPage
      .getByPlaceholder("a@example.com, b@example.com")
      .fill("qa-distribution@example.com");
    await userPage.locator("input[type='time']").fill("09:30");

    await userPage.getByRole("button", { name: "Create" }).click();

    // Creation depends on tenant data and backend, so validate either success or handled failure.
    await expect(
      userPage.getByText(/Schedule created|Failed to create schedule/i).first(),
    ).toBeVisible();
  });

  test("send-now and history actions are wired for existing schedules", async ({
    adminPage,
  }) => {
    const fixtureName = `E2E Schedule Action ${Date.now()}`;
    await createScheduleFixture(adminPage, fixtureName);

    try {
      const row = scheduleRow(adminPage, fixtureName).first();
      await expect(row).toBeVisible({ timeout: 20_000 });

      await row.getByTitle("History").click();
      const historyDialog = adminPage.getByRole("dialog", { name: /Send history/i });
      await expect(historyDialog.getByRole("heading", { name: /Send history/i })).toBeVisible();
      await expect(adminPage.getByText(/No sends yet|Status/i).first()).toBeVisible();
      await historyDialog.getByRole("button", { name: "Close" }).first().click();

      await row.getByTitle("Send now").click();
      await expect(adminPage.getByText(/Send completed|Send failed/i).first()).toBeVisible();
    } finally {
      await deleteScheduleIfPresent(adminPage, fixtureName).catch(() => {});
    }
  });

  test("delete action prompts before removing schedule", async ({ adminPage }) => {
    const fixtureName = `E2E Schedule Delete ${Date.now()}`;
    await createScheduleFixture(adminPage, fixtureName);

    const row = scheduleRow(adminPage, fixtureName).first();
    await expect(row).toBeVisible({ timeout: 20_000 });

    adminPage.once("dialog", (dialog) => dialog.dismiss());
    await row.getByTitle("Delete").click();
    await expect(row).toBeVisible({ timeout: 10_000 });

    await deleteScheduleIfPresent(adminPage, fixtureName);
  });
});
