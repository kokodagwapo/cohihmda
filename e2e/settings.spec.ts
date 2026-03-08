import { test, expect } from "./fixtures";

test.describe("Settings", () => {
  test("@smoke settings page loads and sections are available", async ({ userPage }) => {
    await userPage.goto("/settings", { waitUntil: "domcontentloaded" });
    await expect(userPage).toHaveURL(/\/settings/);
    await expect(userPage.getByRole("heading", { name: "Settings" })).toBeVisible();
    await expect(userPage.getByRole("button", { name: /Account/i })).toBeVisible();
    await expect(userPage.getByRole("button", { name: /Appearance/i })).toBeVisible();
    await expect(userPage.getByRole("button", { name: /Notifications/i })).toBeVisible();
  });

  test("@critical appearance and account security controls are interactive", async ({ userPage }) => {
    await userPage.goto("/settings", { waitUntil: "domcontentloaded" });
    await userPage.getByRole("button", { name: /Appearance/i }).click();
    await expect(userPage.getByText(/Theme/i)).toBeVisible();

    await userPage.getByRole("button", { name: /Account/i }).click();
    await expect(userPage.getByText(/MFA|Multi[- ]Factor/i)).toBeVisible();
  });
});
