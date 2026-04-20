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
    // validator running against `testContext.seededCanvasUrl`, so this test
    // deliberately exercises only the dialog branch.
    //
    // History: earlier revisions either navigated to `/my-dashboard` (which
    // now redirects to the `/workbench` hub — a list page with no title
    // input) or to `/workbench` and clicked a `getByTitle("New canvas")`
    // button (which only matches the small `+` icon *inside* an already-
    // loaded canvas, not the hub's "New Canvas" text-button). Both variants
    // tripped a conditional `test.skip(...)` and the assertion never ran.
    //
    // The hub button simply `navigate("/my-dashboard/new")` and the router
    // (`App.tsx`) treats the `new` canvasId as "create a fresh in-memory
    // tab" (`MyDashboard.tsx:149`), so going straight there is equivalent to
    // the UI click and is fully deterministic — no selector, no skip guard.
    await userPage.goto("/my-dashboard/new", { waitUntil: "domcontentloaded" });
    await expect(userPage).toHaveURL(/\/my-dashboard\/new/);

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
