import { test, expect } from "./fixtures";
import { expectAuthenticatedRoute } from "./helpers";

test.describe("Workbench", () => {
  test("@smoke loads my-dashboard and core canvas controls", async ({ userPage }) => {
    await expectAuthenticatedRoute(userPage, "/my-dashboard");
    await expect(userPage.getByTitle("New canvas")).toBeVisible();
    await expect(userPage.getByTestId("workbench-canvas-title-input")).toBeVisible();
  });

  test("opens save dialog and supports basic canvas editing flow", async ({ userPage }) => {
    await userPage.goto("/my-dashboard", { waitUntil: "domcontentloaded" });

    // Rename the current canvas
    const titleInput = userPage.getByTestId("workbench-canvas-title-input");
    await titleInput.fill("E2E Canvas Draft");
    await expect(titleInput).toHaveValue("E2E Canvas Draft");

    // Open save dialog from toolbar and close it
    await userPage.getByTestId("workbench-save-button").click();
    await expect(userPage.getByRole("heading", { name: "Save canvas" })).toBeVisible();
    await userPage.getByRole("button", { name: "Cancel" }).click();
    await expect(userPage.getByRole("heading", { name: "Save canvas" })).not.toBeVisible();

    // Add another tab and verify switching works
    await userPage.getByTitle("New canvas").click();
    await expect(userPage.getByText("New Canvas").first()).toBeVisible();
  });

  test("enforces view-only mode for non-owner canvases when applicable", async ({ userPage }) => {
    await userPage.goto("/my-dashboard", { waitUntil: "domcontentloaded" });
    const readonlyBanner = userPage.getByTestId("workbench-readonly-banner");
    if (await readonlyBanner.isVisible().catch(() => false)) {
      await expect(readonlyBanner).toBeVisible();
      await expect(userPage.getByTestId("workbench-save-button")).toHaveCount(0);
      await expect(userPage.getByTestId("workbench-share-button")).toHaveCount(0);
    } else {
      // Owner mode: save/share controls should exist.
      await expect(userPage.getByTestId("workbench-save-button")).toBeVisible();
      await expect(userPage.getByTestId("workbench-share-button")).toBeVisible();
    }
  });

  const paths = [
    ["/workbench/shared", "Shared With Me"],
    ["/workbench/team-folders", "Team Folders"],
    ["/workbench/favorites", "Bookmarks"],
    ["/workbench/distributions", "Content distribution"],
  ] as const;

  for (const [path, heading] of paths) {
    test(`@smoke opens ${path}`, async ({ userPage }) => {
      await userPage.goto(path, { waitUntil: "domcontentloaded" });
      await expect(userPage).toHaveURL(new RegExp(path.replace(/\//g, "\\/")));
      await expect(userPage.getByRole("heading", { name: heading })).toBeVisible();
    });
  }
});
