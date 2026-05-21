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

    await userPage.goto("/admin", { waitUntil: "domcontentloaded" });
    await expect(userPage.getByText(/Access Denied/i)).toBeVisible();
  });

  test("tenant_canvas_only_user is constrained to canvas-only experience", async ({
    canvasOnlyPage,
  }) => {
    // Canvas-only users are redirected off full-app routes into the allowed shell:
    // `/workbench`, `/my-dashboard`, or `/my-dashboard/:canvasId` (AccessModeGate).
    await canvasOnlyPage.goto("/insights", { waitUntil: "domcontentloaded" });
    await expect(canvasOnlyPage).toHaveURL(/\/(workbench|my-dashboard)/);

    // Canvas-only layout should render and hide full-app nav.
    await expect(canvasOnlyPage.getByText("Cohi Dashboards")).toBeVisible();
    await expect(canvasOnlyPage.getByText("Shared with you").first()).toBeVisible();
    await expect(
      canvasOnlyPage.getByRole("navigation", { name: /main navigation/i }),
    ).toHaveCount(0);

    // /admin is mounted outside AccessModeGate and uses adminOnly — non-admins see Access Denied in-place.
    await canvasOnlyPage.goto("/admin", { waitUntil: "domcontentloaded" });
    await expect(canvasOnlyPage).toHaveURL(/\/admin/);
    await expect(canvasOnlyPage.getByRole("heading", { name: /Access Denied/i })).toBeVisible();
  });
});
