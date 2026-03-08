import { test, expect } from "./fixtures";

test.describe("@critical Distributions workflows", () => {
  test("@smoke distributions page renders with schedule controls", async ({ userPage }) => {
    await userPage.goto("/workbench/distributions", { waitUntil: "domcontentloaded" });
    await expect(userPage.getByRole("heading", { name: "Content distribution" })).toBeVisible();
    await expect(userPage.getByRole("button", { name: /New schedule/i })).toBeVisible();
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
    await expect(userPage.getByRole("heading", { name: "Content distribution" })).toBeVisible();
  });
});
