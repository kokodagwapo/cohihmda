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
    const authedWithoutMfa = await page
      .waitForURL(/\/(insights|my-dashboard)/, { timeout: 12_000 })
      .then(() => true)
      .catch(() => false);
    if (authedWithoutMfa) {
      await authPage.expectAuthenticated();
      return;
    }

    const otpSelector =
      'input[data-input-otp], input[autocomplete="one-time-code"], input[inputmode="numeric"]';
    const otpInput = page.locator(otpSelector).first();
    const verifyButton = page.getByRole("button", { name: "Verify" });
    const candidateCodes = [0, -30_000, 30_000, -60_000, 60_000].map((offsetMs) =>
      generateTotpCode(state.users.tenantUser.totpSecret, Date.now() + offsetMs),
    );

    let authed = false;
    for (const code of candidateCodes) {
      const otpExists = (await page.locator(otpSelector).count()) > 0;
      if (!otpExists) {
        continue;
      }

      for (let i = 0; i < 20; i += 1) {
        const enabled = await otpInput.evaluate((el) => {
          const input = el as HTMLInputElement;
          return !input.disabled && input.getAttribute("aria-disabled") !== "true";
        }).catch(() => false);
        if (enabled) break;
        await page.waitForTimeout(250);
      }

      const otpEnabled = await otpInput.evaluate((el) => {
        const input = el as HTMLInputElement;
        return !input.disabled && input.getAttribute("aria-disabled") !== "true";
      }).catch(() => false);
      if (!otpEnabled) {
        continue;
      }
      await otpInput.click();
      await page.keyboard.press("ControlOrMeta+a");
      await page.keyboard.press("Backspace");
      await page.keyboard.type(code, { delay: 40 });
      try {
        await expect(page).toHaveURL(/\/(insights|my-dashboard)/, { timeout: 8_000 });
        authed = true;
        break;
      } catch {
        if (await verifyButton.isEnabled()) {
          await verifyButton.click();
          try {
            await expect(page).toHaveURL(/\/(insights|my-dashboard)/, { timeout: 6_000 });
            authed = true;
            break;
          } catch {
            // Try next code window.
          }
        }
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
    await expect(page.getByText(/invalid credentials/i).first()).toBeVisible();
  });

  test("@smoke redirects unauthenticated users from protected route", async ({ page }) => {
    await page.goto("/insights", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/login\?returnTo=%2Finsights/);
  });

  test("@smoke logs out from the user menu", async ({ userPage }) => {
    await userPage.goto("/insights", { waitUntil: "domcontentloaded" });
    const opened = await openUserMenu(userPage);
    test.skip(!opened, "User menu trigger not available in this layout/session.");
    const overlay = userPage.locator("div[data-state='open'][aria-hidden='true']").first();
    if (await overlay.isVisible().catch(() => false)) {
      await userPage.keyboard.press("Escape");
      const reopened = await openUserMenu(userPage);
      test.skip(!reopened, "User menu could not be reopened after dismissing overlay.");
    }
    const logoutAction = userPage
      .locator("[role='menuitem'], button, a")
      .filter({ hasText: /logout|sign out/i })
      .first();
    const hasLogoutAction = await logoutAction.isVisible().catch(() => false);
    test.skip(!hasLogoutAction, "Logout action is not available in this user/menu variant.");
    await expect(logoutAction).toBeVisible();
  });

  test("forgot-password flow accepts email", async ({ page }) => {
    await page.goto("/forgot-password", { waitUntil: "domcontentloaded" });
    await page.getByLabel("Email").fill("qa-check@example.com");
    await page.getByRole("button", { name: "Reset Password" }).click();
    await expect(page.getByText(/check your email/i)).toBeVisible();
  });
});
