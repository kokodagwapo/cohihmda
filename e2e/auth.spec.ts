import { test, expect } from "./fixtures";
import { openUserMenu } from "./helpers";
import { AuthPage } from "./page-objects/auth.po";
import { readProvisionedState } from "./provision-state";
import { generateTotpCode } from "./totp";

test.describe("Authentication", () => {
  test("@smoke logs in with valid credentials", async ({ page }) => {
    const state = readProvisionedState();
    test.skip(!state, "Missing E2E provisioned users state.");
    if (!state) return;

    const authPage = new AuthPage(page);
    await authPage.login(state.users.tenantUser.email, state.users.tenantUser.password);
    const otpInput = page
      .locator('input[data-input-otp], input[autocomplete="one-time-code"], input[inputmode="numeric"]')
      .first();
    const verifyButton = page.getByRole("button", { name: "Verify" });
    const candidateCodes = [0, -30_000, 30_000].map((offsetMs) =>
      generateTotpCode(state.users.tenantUser.totpSecret, Date.now() + offsetMs),
    );

    let authed = false;
    for (const code of candidateCodes) {
      await otpInput.fill(code);
      await verifyButton.click();
      try {
        await expect(page).toHaveURL(/\/(insights|my-dashboard)/, { timeout: 8_000 });
        authed = true;
        break;
      } catch {
        // Try next code window.
      }
    }
    expect(authed).toBe(true);
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
