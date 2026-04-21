import { test, expect } from "./fixtures";

test.describe("TopTiering Comparison — Actor Focus (COHI-327)", () => {
  test.beforeEach(async ({ userPage }) => {
    await userPage.goto("/performance/toptiering-comparison", {
      waitUntil: "domcontentloaded",
    });
    await userPage.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
  });

  test("@critical @COHI-327 page renders with title, charts, and focus panel", async ({
    userPage,
  }) => {
    await expect(userPage.locator("h1")).toContainText("TopTiering Comparison");

    // At least one recharts chart rendered
    await expect(
      userPage.locator(".recharts-wrapper").first(),
    ).toBeVisible({ timeout: 15_000 });

    // Focus panel visible with instructional state (no selection yet)
    await expect(
      userPage.getByRole("button", { name: "Focus Dashboard" }),
    ).toBeVisible();
    await expect(
      userPage.getByRole("button", { name: "Focus Dashboard" }),
    ).toBeDisabled();
    await expect(
      userPage.getByRole("button", { name: "Clear Selection" }),
    ).toBeDisabled();
  });

  test("@critical @COHI-327 clicking a bar selects an actor and enables focus", async ({
    userPage,
  }) => {
    await expect(
      userPage.locator(".recharts-wrapper").first(),
    ).toBeVisible({ timeout: 15_000 });

    // Click first bar in the revenue chart
    const firstBar = userPage
      .locator(".recharts-bar-rectangle")
      .first();
    await expect(firstBar).toBeVisible({ timeout: 10_000 });
    await firstBar.click();

    // Focus Dashboard button should now be enabled
    await expect(
      userPage.getByRole("button", { name: "Focus Dashboard" }),
    ).toBeEnabled({ timeout: 5_000 });

    // Selection count should show "1"
    await expect(userPage.getByText(/1\s+(loan officer|branch)/i)).toBeVisible();
  });

  test("@critical @COHI-327 focus scopes dashboard and clear restores it", async ({
    userPage,
  }) => {
    await expect(
      userPage.locator(".recharts-wrapper").first(),
    ).toBeVisible({ timeout: 15_000 });

    // Count bars before focus
    const barsBefore = await userPage
      .locator(".recharts-bar-rectangle")
      .count();

    // Select two bars
    const bars = userPage.locator(".recharts-bar-rectangle");
    await bars.nth(0).click();
    await bars.nth(1).click();

    // Apply focus
    await userPage.getByRole("button", { name: "Focus Dashboard" }).click();

    // Focus banner should appear
    await expect(userPage.getByText("Focused on")).toBeVisible({ timeout: 5_000 });
    await expect(
      userPage.getByRole("button", { name: "Clear Focus" }),
    ).toBeVisible();

    // Bars should be fewer than before
    const barsAfter = await userPage
      .locator(".recharts-bar-rectangle")
      .count();
    expect(barsAfter).toBeLessThan(barsBefore);

    // Clear focus
    await userPage.getByRole("button", { name: "Clear Focus" }).click();
    await expect(userPage.getByText("Focused on")).not.toBeVisible();

    // Bars should be restored
    const barsRestored = await userPage
      .locator(".recharts-bar-rectangle")
      .count();
    expect(barsRestored).toBe(barsBefore);
  });

  test("@critical @COHI-327 focus panel appears inside expanded chart modal", async ({
    userPage,
  }) => {
    await expect(
      userPage.locator(".recharts-wrapper").first(),
    ).toBeVisible({ timeout: 15_000 });

    // Open the maximize modal on the first chart card
    const maximizeButton = userPage
      .locator("button[title='Expand chart']")
      .first();
    await expect(maximizeButton).toBeVisible({ timeout: 5_000 });
    await maximizeButton.click();

    // Modal should open
    const dialog = userPage.locator("[role='dialog']").first();
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    // Focus panel should be present inside the modal
    await expect(
      dialog.getByRole("button", { name: "Focus Dashboard" }),
    ).toBeVisible();
  });

  test("@critical @COHI-327 switching actor mode clears focus and selection", async ({
    userPage,
  }) => {
    await expect(
      userPage.locator(".recharts-wrapper").first(),
    ).toBeVisible({ timeout: 15_000 });

    // Select and focus
    await userPage.locator(".recharts-bar-rectangle").first().click();
    await userPage.getByRole("button", { name: "Focus Dashboard" }).click();
    await expect(userPage.getByText("Focused on")).toBeVisible({ timeout: 5_000 });

    // Switch to Branch mode
    const branchTab = userPage.getByRole("tab", { name: "Branch" });
    await expect(branchTab).toBeVisible();
    await branchTab.click();

    // Focus should be cleared
    await expect(userPage.getByText("Focused on")).not.toBeVisible({ timeout: 5_000 });
    await expect(
      userPage.getByRole("button", { name: "Focus Dashboard" }),
    ).toBeDisabled();
  });

  test("@critical @COHI-327 Avg Revenue BPS KPI displays a non-zero value", async ({
    userPage,
  }) => {
    await expect(
      userPage.locator(".recharts-wrapper").first(),
    ).toBeVisible({ timeout: 15_000 });

    const bpsCard = userPage.locator("#ttc-kpi-avg-revenue-bps");
    await expect(bpsCard).toBeVisible();

    const bpsText = await bpsCard.locator("p.text-lg").textContent();
    const bpsValue = Number(bpsText?.replace(/[^0-9.-]/g, ""));
    expect(bpsValue).toBeGreaterThan(0);
  });

  test("@critical @COHI-327 pluralization uses Branches not Branchs", async ({
    userPage,
  }) => {
    // Switch to Branch mode
    await expect(
      userPage.locator(".recharts-wrapper").first(),
    ).toBeVisible({ timeout: 15_000 });

    await userPage.getByRole("tab", { name: "Branch" }).click();
    await userPage.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});

    // Check the tier story cards for correct pluralization
    const pageText = await userPage.locator("body").textContent();
    expect(pageText).not.toContain("Branchs");
  });
});
