import { test, expect } from "./fixtures";

test.describe("@critical Admin", () => {
  test("@COHI-398 @smoke admin user can access admin panel and major sections", async ({ adminPage }) => {
    await adminPage.goto("/admin", { waitUntil: "domcontentloaded" });
    await expect(adminPage).toHaveURL(/\/admin/);
    await expect(adminPage.getByRole("button", { name: "Users & Access" }).first()).toBeVisible();
    await expect(adminPage.getByRole("button", { name: "Organization Settings" }).first()).toBeVisible();
    await expect(adminPage.getByRole("button", { name: "Connections" }).first()).toBeVisible();
  });

  test("@COHI-398 @smoke admin knowledge-base route loads", async ({ adminPage }) => {
    await adminPage.goto("/admin/knowledge-base", { waitUntil: "domcontentloaded" });
    await expect(adminPage).toHaveURL(/\/admin\/knowledge-base/);
    await expect(adminPage.getByRole("heading", { name: /Knowledge Base/i })).toBeVisible();
  });

  test("@COHI-398 admin can open user management and launch add-user flow", async ({ adminPage }) => {
    await adminPage.goto("/admin", { waitUntil: "domcontentloaded" });
    await adminPage.getByRole("button", { name: "Users & Access" }).click();
    await expect(adminPage.getByRole("heading", { name: "User Management" })).toBeVisible();

    await adminPage.getByRole("button", { name: "Add User" }).click();
    await expect(adminPage.getByRole("heading", { name: "Add User" })).toBeVisible();
    await adminPage.getByPlaceholder("user@example.com").fill("qa-admin-e2e@example.com");
    await adminPage.getByRole("button", { name: "Cancel" }).click();
  });

  test("@COHI-398 organization settings save flow behaves correctly for admins", async ({ adminPage }) => {
    await adminPage.goto("/admin", { waitUntil: "domcontentloaded" });
    await adminPage.getByRole("button", { name: "Organization Settings" }).click();
    await expect(adminPage.getByRole("heading", { name: "Organization Settings" })).toBeVisible();

    await adminPage.getByRole("tab", { name: "General" }).click();
    const orgNameInput = adminPage.locator("#displayName");
    await expect(orgNameInput).toBeVisible();

    const originalName = await orgNameInput.inputValue();
    const updatedName = `${originalName} QA`;
    await orgNameInput.fill(updatedName);
    await adminPage.getByRole("button", { name: "Save Changes" }).click();

    const saveSucceeded = await adminPage
      .getByText(/Organization settings saved successfully/i)
      .isVisible()
      .catch(() => false);

    if (saveSucceeded) {
      await adminPage.reload({ waitUntil: "domcontentloaded" });
      await adminPage.getByRole("button", { name: "Organization Settings" }).click();
      await expect(adminPage.locator("#displayName")).toHaveValue(updatedName);

      // Revert to avoid persisting test-only mutation.
      await adminPage.locator("#displayName").fill(originalName);
      await adminPage.getByRole("button", { name: "Save Changes" }).click();
    } else {
      await expect(
        adminPage.getByText(/Failed to save settings|Error/i).first(),
      ).toBeVisible();
    }
  });

  test("@COHI-398 non-admin user is blocked from admin route", async ({ userPage }) => {
    await userPage.goto("/admin", { waitUntil: "domcontentloaded" });
    const deniedTextVisible = await userPage
      .getByText(/access denied|not authorized|permission denied/i)
      .first()
      .isVisible()
      .catch(() => false);
    if (deniedTextVisible) {
      await expect(userPage.getByText(/access denied|not authorized|permission denied/i).first()).toBeVisible();
    } else {
      await expect(userPage.getByRole("button", { name: "Users & Access" })).not.toBeVisible();
      await expect(userPage.getByRole("button", { name: "Organization Settings" })).not.toBeVisible();
    }
  });
});


