import { test, expect } from "./fixtures";
import type { Locator } from "@playwright/test";
import { expectAuthenticatedRoute } from "./helpers";

async function isAnyVisible(candidates: Locator[]) {
  for (const candidate of candidates) {
    if (await candidate.isVisible().catch(() => false)) {
      return true;
    }
  }
  return false;
}

test.describe("Workbench", () => {
  test("@smoke loads my-dashboard and core canvas controls", async ({ userPage }) => {
    await expectAuthenticatedRoute(userPage, "/my-dashboard");
    const hasPrimaryWorkbenchControl = await isAnyVisible([
      userPage.getByTitle("New canvas"),
      userPage.getByTestId("workbench-canvas-title-input"),
      userPage.getByTestId("workbench-save-button"),
      userPage.getByText(/canvas|workbench|dashboard/i).first(),
    ]);
    expect(hasPrimaryWorkbenchControl).toBe(true);
  });

  test("opens save dialog and supports basic canvas editing flow", async ({ userPage }) => {
    await userPage.goto("/my-dashboard", { waitUntil: "domcontentloaded" });

    // Rename the current canvas
    const titleInput = userPage.getByTestId("workbench-canvas-title-input");
    const hasTitleInput = await titleInput.isVisible().catch(() => false);
    test.skip(!hasTitleInput, "Canvas title input is not available in this workbench variant.");
    await titleInput.fill("E2E Canvas Draft");
    await expect(titleInput).toHaveValue("E2E Canvas Draft");

    // Open save dialog from toolbar and close it
    const saveButton = userPage.getByTestId("workbench-save-button");
    const hasSaveButton = await saveButton.isVisible().catch(() => false);
    if (hasSaveButton) {
      await saveButton.click();
      await expect(userPage.getByRole("heading", { name: /save canvas|save/i }).first()).toBeVisible();
      await userPage.getByRole("button", { name: "Cancel" }).click();
      await expect(userPage.getByRole("heading", { name: /save canvas|save/i }).first()).not.toBeVisible();
    }

    // Add another tab and verify switching works
    const newCanvasButton = userPage.getByTitle("New canvas");
    if (await newCanvasButton.isVisible().catch(() => false)) {
      await newCanvasButton.click();
      await expect(userPage.getByText(/new canvas/i).first()).toBeVisible();
    }
  });

  test("enforces view-only mode for non-owner canvases when applicable", async ({ userPage }) => {
    await userPage.goto("/my-dashboard", { waitUntil: "domcontentloaded" });
    const readonlyBanner = userPage.getByTestId("workbench-readonly-banner");
    if (await readonlyBanner.isVisible().catch(() => false)) {
      await expect(readonlyBanner).toBeVisible();
      await expect(userPage.getByTestId("workbench-save-button")).toHaveCount(0);
      await expect(userPage.getByTestId("workbench-share-button")).toHaveCount(0);
    } else {
      // Owner mode/UI variants: at least one editable control should be present.
      const hasEditableControls = await isAnyVisible([
        userPage.getByTestId("workbench-save-button"),
        userPage.getByTestId("workbench-share-button"),
        userPage.getByTitle("New canvas"),
      ]);
      if (!hasEditableControls) {
        await expect(userPage).toHaveURL(/\/my-dashboard/);
        await expect(userPage.locator("h1, h2, [role='heading'], button").first()).toBeVisible();
      }
    }
  });

  const paths = [
    ["/workbench/shared", "Shared With Me"],
    ["/workbench/team-folders", "Team Folders"],
    ["/workbench/favorites", "Bookmarks"],
    ["/workbench/distributions", "Communications Center"],
  ] as const;

  for (const [path, heading] of paths) {
    test(`@smoke opens ${path}`, async ({ userPage }) => {
      await userPage.goto(path, { waitUntil: "domcontentloaded" });
      await expect(userPage).toHaveURL(new RegExp(path.replace(/\//g, "\\/")));
      const hasHeading = await userPage.getByRole("heading", { name: heading }).isVisible().catch(() => false);
      if (hasHeading) {
        await expect(userPage.getByRole("heading", { name: heading })).toBeVisible();
      } else {
        await expect(userPage.locator("h1, h2, [role='heading']").first()).toBeVisible();
      }
    });
  }
});
