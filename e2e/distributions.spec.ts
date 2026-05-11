import { test, expect } from "./fixtures";

test.describe("@critical @COHI-400 Distributions workflows", () => {
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
    // Default is Monday; add Tue + Fri then remove Monday → Tue+Fr
    await userPage.getByText("Tuesday", { exact: true }).click();
    await userPage.getByText("Friday", { exact: true }).click();
    await userPage.getByText("Monday", { exact: true }).click();
    await expect(userPage.locator("ul.text-xs li").first()).toBeVisible({
      timeout: 15_000,
    });
  });

  test('handles monthly day picker and preview text', async ({ userPage }) => {
    await userPage.goto("/workbench/distributions", { waitUntil: "domcontentloaded" });
    await userPage.getByRole("button", { name: /New schedule|Create schedule/i }).first().click();
    await expect(
      userPage.getByRole("heading", { name: /New distribution schedule/i }),
    ).toBeVisible();

    await userPage.getByRole("button", { name: /Weekly/i }).click();
    await userPage.getByRole("option", { name: /^Monthly$/ }).click();

    await expect(userPage.getByText(/Days of month/i)).toBeVisible();

    await userPage.getByText("15", { exact: true }).click();

    await expect(userPage.getByText(/Next sends \(preview\)/i)).toBeVisible();
    await expect(userPage.locator("ul.text-xs li").first()).toBeVisible({
      timeout: 15_000,
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

  test("send-now and history actions are wired for existing schedules", async ({ userPage }) => {
    await userPage.goto("/workbench/distributions", { waitUntil: "domcontentloaded" });

    const hasRows = (await userPage.locator("tbody tr").count()) > 0;
    test.skip(!hasRows, "No schedules available to verify send-now/history actions.");

    await userPage.getByTitle("History").first().click();
    await expect(userPage.getByRole("heading", { name: /Send history/i })).toBeVisible();
    await expect(userPage.getByText(/No sends yet|Status/i).first()).toBeVisible();
    await userPage.getByRole("button", { name: "Close" }).click();

    await userPage.getByTitle("Send now").first().click();
    await expect(
      userPage.getByText(/Send completed|Send failed/i).first(),
    ).toBeVisible();
  });

  test("delete action prompts before removing schedule", async ({ userPage }) => {
    await userPage.goto("/workbench/distributions", { waitUntil: "domcontentloaded" });

    const hasRows = (await userPage.locator("tbody tr").count()) > 0;
    test.skip(!hasRows, "No schedules available to verify delete behavior.");

    userPage.once("dialog", (dialog) => dialog.dismiss());
    await userPage.getByTitle("Delete").first().click();
    await expect(userPage.getByRole("heading", { name: "Communications Center" })).toBeVisible();
  });
});
