import { expect, type Page } from "@playwright/test";

export class NavigationPO {
  constructor(private readonly page: Page) {}

  async openUserMenu() {
    await this.page.getByTestId("user-menu-trigger").click();
    await expect(this.page.getByRole("menuitem", { name: "Logout" })).toBeVisible();
  }

  async openInsightsMenu() {
    await this.page.getByRole("button", { name: "Insights menu" }).click();
  }

  async openDashboardsMenu() {
    await this.page.getByRole("button", { name: "Dashboards menu" }).click();
  }

  async openMobileMenu() {
    await this.page.getByRole("button", { name: "Open navigation menu" }).click();
    await expect(this.page.getByText("Navigation")).toBeVisible();
  }
}
