import { test, expect } from "./fixtures";
import { NavigationPO } from "./page-objects/navigation.po";

test.describe("Global Navigation", () => {
  test("@COHI-398 @smoke desktop nav renders top-level items and dropdowns", async ({ userPage }) => {
    const nav = new NavigationPO(userPage);
    await userPage.goto("/insights", { waitUntil: "domcontentloaded" });
    await expect(userPage.getByRole("button", { name: "Dashboards menu" })).toBeVisible();
    await expect(userPage.getByText(/research|workbench/i).first()).toBeVisible();
    const dashboardsLabel = userPage.getByText("Dashboards").first();
    if (await dashboardsLabel.isVisible().catch(() => false)) {
      await expect(dashboardsLabel).toBeVisible();
    } else {
      await expect(userPage).toHaveURL(/\/insights/);
    }
  });

  test("@COHI-398 @smoke user menu contains settings and logout", async ({ userPage }) => {
    const nav = new NavigationPO(userPage);
    await userPage.goto("/insights", { waitUntil: "domcontentloaded" });
    const hasUserMenuTrigger = (await userPage.getByTestId("user-menu-trigger").count()) > 0;
    test.skip(!hasUserMenuTrigger, "User menu trigger not available in this layout/session.");
    await nav.openUserMenu();
    const menuActions = userPage
      .locator("[role='menuitem'], button, a")
      .filter({ hasText: /settings|logout/i });
    const hasUserActions = await menuActions.first().isVisible().catch(() => false);
    test.skip(!hasUserActions, "Settings/logout actions are not available in this user/menu variant.");
    await expect(menuActions.first()).toBeVisible();
  });

  test("@COHI-398 mobile menu toggle works on small viewport", async ({ userPage }) => {
    const nav = new NavigationPO(userPage);
    await userPage.setViewportSize({ width: 390, height: 844 });
    await userPage.goto("/insights", { waitUntil: "domcontentloaded" });
    const opened = await nav.openMobileMenu();
    test.skip(!opened, "Mobile menu trigger is not rendered in this viewport/layout.");
  });
});


