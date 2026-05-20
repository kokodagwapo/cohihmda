import { expect, type Page } from "@playwright/test";
import { isPostLoginUrl } from "../helpers/postLoginUrl";

export class AuthPage {
  constructor(private readonly page: Page) {}

  async gotoLogin() {
    await this.page.goto("/login", { waitUntil: "domcontentloaded" });
  }

  async login(email: string, password: string) {
    await this.gotoLogin();
    await this.page.getByLabel("Email").fill(email);
    await this.page.getByRole("button", { name: "Continue" }).click();
    await this.page.getByLabel("Password").fill(password);
    await this.page.getByRole("button", { name: "Sign In" }).click();
  }

  async expectAuthenticated() {
    await expect(this.page).toHaveURL(isPostLoginUrl);

    // Freshly-provisioned E2E users (`e2e.auto.tenant-user.*` created by
    // global-setup) land with `onboarding_complete === false`, so about 1s
    // after the post-login redirect the WelcomeTourTrigger fires a Radix
    // modal Dialog. Radix's modal mode applies `aria-hidden="true"` to the
    // dialog's siblings — including the `<nav aria-label="Main navigation">`
    // we want to assert on — which removes it from the accessibility tree
    // and breaks `getByRole("navigation", …)`. We dismiss the tour here
    // (mirrors a real first-time user's choice) before checking the nav.
    const skipTour = this.page.getByRole("button", { name: /skip for now/i });
    if (await skipTour.isVisible().catch(() => false)) {
      await skipTour.click().catch(() => {});
      await expect(skipTour).toBeHidden({ timeout: 5_000 }).catch(() => {});
    }

    // Use a CSS-based locator instead of `getByRole` so the assertion does
    // not depend on the accessibility tree being clean — if any other modal
    // (e.g. WhatsNew) is still in the process of opening/closing it may
    // briefly re-apply aria-hidden to the nav's ancestor, which would fail
    // a `getByRole` lookup even though the element is plainly rendered.
    await expect(this.page.locator('nav[aria-label="Main navigation"]')).toBeVisible();
  }
}
