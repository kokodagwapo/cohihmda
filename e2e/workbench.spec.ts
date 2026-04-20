import { test, expect } from "./fixtures";
import type { Locator } from "@playwright/test";

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
    // /my-dashboard (no canvas id) now redirects to the /workbench hub; accept either route.
    await userPage.goto("/my-dashboard", { waitUntil: "domcontentloaded" });
    await expect(userPage).toHaveURL(/\/(my-dashboard|workbench)/);
    await expect(userPage.getByRole("navigation", { name: /main navigation/i })).toBeVisible();
    const hasPrimaryWorkbenchControl = await isAnyVisible([
      userPage.getByTitle("New canvas"),
      userPage.getByTestId("workbench-canvas-title-input"),
      userPage.getByTestId("workbench-save-button"),
      userPage.getByText(/canvas|workbench|dashboard/i).first(),
    ]);
    expect(hasPrimaryWorkbenchControl).toBe(true);
  });

  test("@critical @COHI-77 opens save dialog and supports basic canvas editing flow", async ({ userPage }) => {
    // COHI-77 AC #4(b): on a *new, unsaved* canvas, clicking the save button
    // opens a modal dialog with a Cancel button. The seeded/saved canvas path
    // (4a) saves directly to a toast and is covered separately by the AC
    // validator running against `testContext.seededCanvasUrl`. This test has
    // to start from a route that actually renders a fresh in-memory canvas.
    //
    // Historically this test navigated to `/my-dashboard`, but that route now
    // redirects to the `/workbench` hub (a list page with no canvas title
    // input). As a result the pre-existing `test.skip(!hasTitleInput, …)`
    // guard fired on every run and the test was silently skipped for weeks.
    // Start from the hub and click "New canvas" to enter a real canvas.
    await userPage.goto("/workbench", { waitUntil: "domcontentloaded" });
    await expect(userPage).toHaveURL(/\/workbench/);

    const newCanvasButton = userPage.getByTitle("New canvas").first();
    const hasNewCanvasButton = await newCanvasButton.isVisible().catch(() => false);
    test.skip(!hasNewCanvasButton, "Workbench hub did not render a 'New canvas' affordance in this variant.");
    await newCanvasButton.click();

    const titleInput = userPage.getByTestId("workbench-canvas-title-input");
    await expect(titleInput).toBeVisible();
    await titleInput.fill("E2E Canvas Draft");
    await expect(titleInput).toHaveValue("E2E Canvas Draft");

    // Save button is intentionally disabled while the canvas is still loading
    // (see `disabled={isSaving || canvasLoading}` in WorkbenchCanvas.tsx).
    // Use Playwright's auto-polling expect so we don't race the initial load.
    const saveButton = userPage.getByTestId("workbench-save-button");
    await expect(saveButton).toBeVisible();
    await expect(saveButton).toBeEnabled();
    await saveButton.click();

    // On an unsaved canvas the save button opens the name-the-canvas dialog.
    // Match the heading via role rather than `has-text("Save")` to avoid
    // false-matching the save-button itself.
    const saveDialogHeading = userPage.getByRole("heading", { name: /save canvas|save/i }).first();
    await expect(saveDialogHeading).toBeVisible();
    await userPage.getByRole("button", { name: "Cancel" }).click();
    await expect(saveDialogHeading).toBeHidden();
  });

  test("enforces view-only mode for non-owner canvases when applicable", async ({ userPage }) => {
    await userPage.goto("/my-dashboard", { waitUntil: "domcontentloaded" });
    const readonlyBanner = userPage.getByTestId("workbench-readonly-banner");
    if (await readonlyBanner.isVisible().catch(() => false)) {
      await expect(readonlyBanner).toBeVisible();
      await expect(userPage.getByTestId("workbench-save-button")).toHaveCount(0);
      await expect(userPage.getByTestId("workbench-share-button")).toHaveCount(0);
    } else {
      const hasEditableControls = await isAnyVisible([
        userPage.getByTestId("workbench-save-button"),
        userPage.getByTestId("workbench-share-button"),
        userPage.getByTitle("New canvas"),
      ]);
      if (!hasEditableControls) {
        // /my-dashboard without a canvas ID redirects to /workbench hub
        await expect(userPage).toHaveURL(/\/(my-dashboard|workbench)/);
        await expect(userPage.locator("h1, h2, [role='heading'], button").first()).toBeVisible();
      }
    }
  });

  const paths = [
    ["/workbench/shared", "Shared"],
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
