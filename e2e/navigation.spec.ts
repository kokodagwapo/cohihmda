import { test, expect } from "./fixtures";
import { NavigationPO } from "./page-objects/navigation.po";

test.describe("Global Navigation", () => {
  test("@smoke desktop nav renders top-level items and dropdowns", async ({ userPage }) => {
    const nav = new NavigationPO(userPage);
    await userPage.goto("/insights", { waitUntil: "domcontentloaded" });
    await expect(userPage.getByRole("button", { name: "Insights menu" })).toBeVisible();
    await expect(userPage.getByRole("button", { name: "Dashboards menu" })).toBeVisible();
    await expect(userPage.getByText("My Workbench")).toBeVisible();
    await expect(userPage.getByText("Research Lab")).toBeVisible();

    await nav.openDashboardsMenu();
    await expect(userPage.getByText("Core Analytics")).toBeVisible();
    await expect(userPage.getByText("Sales")).toBeVisible();
  });

  test("@smoke user menu contains settings and logout", async ({ userPage }) => {
    const nav = new NavigationPO(userPage);
    await userPage.goto("/insights", { waitUntil: "domcontentloaded" });
    await nav.openUserMenu();
    await expect(userPage.getByRole("menuitem", { name: "Settings" })).toBeVisible();
    await expect(userPage.getByRole("menuitem", { name: "Logout" })).toBeVisible();
  });

  test("mobile menu toggle works on small viewport", async ({ userPage }) => {
    const nav = new NavigationPO(userPage);
    await userPage.setViewportSize({ width: 390, height: 844 });
    await userPage.goto("/insights", { waitUntil: "domcontentloaded" });
    await nav.openMobileMenu();
    await expect(userPage.getByText("Top Tiering")).toBeVisible();
  });
});
