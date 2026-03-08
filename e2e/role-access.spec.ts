import { test, expect } from "./fixtures";

test.describe("@critical Consolidated role access matrix", () => {
  test("tenant_admin can access admin area", async ({ adminPage }) => {
    await adminPage.goto("/admin", { waitUntil: "domcontentloaded" });
    await expect(adminPage).toHaveURL(/\/admin/);
    await expect(
      adminPage.getByRole("button", { name: "Users & Access" }),
    ).toBeVisible();
  });

  test("tenant_user can access insights but is blocked from admin", async ({
    userPage,
  }) => {
    await userPage.goto("/insights", { waitUntil: "domcontentloaded" });
    await expect(userPage).toHaveURL(/\/insights/);
    await expect(userPage.getByRole("navigation", { name: /main navigation/i })).toBeVisible();

    await userPage.goto("/admin", { waitUntil: "domcontentloaded" });
    await expect(userPage.getByText(/Access Denied/i)).toBeVisible();
  });

  test("tenant_canvas_only_user is constrained to canvas-only experience", async ({
    canvasOnlyPage,
  }) => {
    // Canvas-only users should be redirected away from non-canvas routes.
    await canvasOnlyPage.goto("/insights", { waitUntil: "domcontentloaded" });
    await expect(canvasOnlyPage).toHaveURL(/\/my-dashboard/);

    // Canvas-only layout should render and hide full-app nav.
    await expect(canvasOnlyPage.getByText("Cohi Dashboards")).toBeVisible();
    await expect(canvasOnlyPage.getByText("Shared with you")).toBeVisible();
    await expect(
      canvasOnlyPage.getByRole("navigation", { name: /main navigation/i }),
    ).toHaveCount(0);

    await canvasOnlyPage.goto("/admin", { waitUntil: "domcontentloaded" });
    await expect(canvasOnlyPage).toHaveURL(/\/my-dashboard/);
  });
});
