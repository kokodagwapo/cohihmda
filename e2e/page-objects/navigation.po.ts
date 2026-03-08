import { expect, type Locator, type Page } from "@playwright/test";

export class NavigationPO {
  constructor(private readonly page: Page) {}

  private async dismissOverlayIfPresent() {
    const overlay = this.page.locator("div[data-state='open'][aria-hidden='true']").first();
    if (await overlay.isVisible().catch(() => false)) {
      await this.page.keyboard.press("Escape");
    }
  }

  private async safeClick(locator: Locator) {
    await this.dismissOverlayIfPresent();
    const target = locator.first();
    const canClick = await target.click({ trial: true, timeout: 3_000 }).then(() => true).catch(() => false);
    if (canClick) {
      await target.click({ force: true });
    }
  }

  async openUserMenu() {
    const trigger = this.page.getByTestId("user-menu-trigger");
    if ((await trigger.count()) > 0 && (await trigger.first().isVisible().catch(() => false))) {
      await this.safeClick(trigger);
    } else {
      await this.safeClick(this.page.getByRole("button", { name: /user menu|account|profile/i }));
    }
  }

  async openInsightsMenu() {
    await this.safeClick(this.page.getByRole("button", { name: "Insights menu" }));
  }

  async openDashboardsMenu() {
    await this.safeClick(this.page.getByRole("button", { name: "Dashboards menu" }));
  }

  async openMobileMenu(): Promise<boolean> {
    const mobileTrigger = this.page.getByRole("button", { name: /open navigation menu|menu|navigation/i }).first();
    if (!(await mobileTrigger.isVisible().catch(() => false))) {
      return false;
    }
    await this.safeClick(mobileTrigger);
    return true;
  }
}
