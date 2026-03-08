import { test, expect } from "./fixtures";
import { openUserMenu } from "./helpers";
import { AuthPage } from "./page-objects/auth.po";

test.describe("Authentication", () => {
  test("@smoke logs in with valid credentials", async ({ page }) => {
    const email = process.env.E2E_TEST_EMAIL;
    const password = process.env.E2E_TEST_PASSWORD;
    test.skip(!email || !password, "Missing E2E_TEST_EMAIL or E2E_TEST_PASSWORD.");

    const authPage = new AuthPage(page);
    await authPage.login(email!, password!);
    await authPage.expectAuthenticated();
  });

  test("@smoke shows error on invalid credentials", async ({ page }) => {
    await page.goto("/login", { waitUntil: "domcontentloaded" });
    await page.getByLabel("Email").fill("invalid@example.com");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByLabel("Password").fill("totally-wrong-password");
    await page.getByRole("button", { name: "Sign In" }).click();
    await expect(page.getByText(/invalid credentials/i)).toBeVisible();
  });

  test("@smoke redirects unauthenticated users from protected route", async ({ page }) => {
    await page.goto("/insights", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/login\?returnTo=%2Finsights/);
  });

  test("@smoke logs out from the user menu", async ({ userPage }) => {
    await userPage.goto("/insights", { waitUntil: "domcontentloaded" });
    await openUserMenu(userPage);
    await userPage.getByRole("menuitem", { name: "Logout" }).click();
    await expect(userPage).toHaveURL(/\/$/);
  });

  test("forgot-password flow accepts email", async ({ page }) => {
    await page.goto("/forgot-password", { waitUntil: "domcontentloaded" });
    await page.getByLabel("Email").fill("qa-check@example.com");
    await page.getByRole("button", { name: "Reset Password" }).click();
    await expect(page.getByText(/check your email/i)).toBeVisible();
  });
});
