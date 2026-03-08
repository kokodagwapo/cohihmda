import { test, expect } from "./fixtures";

test.describe("Help Center", () => {
  test("@smoke help home and learning paths load", async ({ userPage }) => {
    await userPage.goto("/help", { waitUntil: "domcontentloaded" });
    await expect(userPage.getByRole("heading", { name: "Help Center" })).toBeVisible();
    await userPage.getByTestId("help-learning-paths-card").click();
    await expect(userPage).toHaveURL(/\/help\/learning-paths/);
  });

  test("@critical category and article navigation works with breadcrumbs", async ({ userPage }) => {
    await userPage.goto("/help", { waitUntil: "domcontentloaded" });
    await userPage.getByTestId("help-category-workbench").click();
    await expect(userPage.getByRole("heading", { name: /Workbench/i })).toBeVisible();
    await userPage.getByTestId("help-article-first-canvas").click();
    await expect(userPage.getByRole("button", { name: "Help Center" })).toBeVisible();
  });
});
