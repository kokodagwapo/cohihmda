import { test, expect } from "./fixtures";

test.describe("Insights Dashboard", () => {
  test("@smoke loads core dashboard sections", async ({ userPage }) => {
    await userPage.goto("/insights", { waitUntil: "domcontentloaded" });
    await expect(userPage).toHaveURL(/\/insights/);

    await expect(userPage.locator("#aletheiaInsights")).toBeVisible();
    await expect(userPage.locator("#industryNews")).toBeVisible();
    await expect(userPage.locator("#leaderboard")).toBeVisible();
    await expect(userPage.getByText("Dashboards")).toBeVisible();
  });

  test("@critical insights dropdown navigates within dashboard", async ({ userPage }) => {
    await userPage.goto("/insights", { waitUntil: "domcontentloaded" });
    await userPage.getByRole("button", { name: "Insights menu" }).click();
    await userPage.getByRole("menuitem", { name: "Mortgage News" }).click();
    await expect(userPage).toHaveURL(/\/insights/);
    await expect(userPage.locator("#industryNews")).toBeVisible();
  });
});
