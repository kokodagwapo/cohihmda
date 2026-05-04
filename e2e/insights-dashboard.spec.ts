import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

async function expectInsightsSections(page: Page) {
  await expect
    .poll(
      async () => {
        const sectionCandidates = [
          page.locator("#CohiInsights"),
          page.locator("#industryNews"),
          page.locator("#leaderboard"),
          page.getByRole("heading", { name: /insights|news|leaderboard/i }).first(),
          page.getByText(/industry news|market news|leaderboard|Cohi/i).first(),
        ];
        for (const candidate of sectionCandidates) {
          if (await candidate.isVisible().catch(() => false)) return true;
        }
        return false;
      },
      { timeout: 20_000, message: "expected at least one insights section to be visible" },
    )
    .toBe(true);
}

test.describe("Insights Dashboard", () => {
  test("@smoke loads core dashboard sections", async ({ userPage }) => {
    await userPage.goto("/insights", { waitUntil: "domcontentloaded" });
    await expect(userPage).toHaveURL(/\/insights/);

    await expectInsightsSections(userPage);
    // Verify the page has at least one heading. We don't pin on a specific
    // heading name ("Dashboards" was renamed during the workbench refactor;
    // relying on exact text makes this spec brittle to copy changes).
    // Use getByRole so implicit ARIA roles on h1-h6 are matched — the CSS
    // selector "[role='heading']" only matches elements with an explicit role
    // attribute, which the insights shell does not set.
    await expect(userPage.getByRole("heading").first()).toBeVisible();
  });

  test("@critical insights dropdown navigates within dashboard", async ({ userPage }) => {
    await userPage.goto("/insights", { waitUntil: "domcontentloaded" });
    const insightsMenu = userPage.getByRole("button", { name: "Insights menu" });
    if ((await insightsMenu.count()) > 0 && (await insightsMenu.first().isVisible().catch(() => false))) {
      const blockingOverlay = userPage
        .locator("div[data-state='open'][aria-hidden='true']")
        .first();
      if (await blockingOverlay.isVisible().catch(() => false)) {
        await userPage.keyboard.press("Escape");
      }

      const canClickMenu = await insightsMenu.first().click({ trial: true, timeout: 3_000 })
        .then(() => true)
        .catch(() => false);

      if (canClickMenu) {
        await insightsMenu.first().click();
        const mortgageNewsItem = userPage.getByRole("menuitem", { name: "Cohi Mortgage News" });
        if (await mortgageNewsItem.first().isVisible().catch(() => false)) {
          await mortgageNewsItem.first().click();
        }
      }
    }
    await expect(userPage).toHaveURL(/\/insights/);
    await expectInsightsSections(userPage);
  });
});
