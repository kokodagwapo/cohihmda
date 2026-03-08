import { expect, type Page } from "@playwright/test";

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
    await expect(this.page).toHaveURL(/\/(insights|my-dashboard)/);
    await expect(this.page.getByRole("navigation", { name: /main navigation/i })).toBeVisible();
  }
}
