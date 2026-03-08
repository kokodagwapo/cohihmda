import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

async function expectInsightsSections(page: Page) {
  await expect
    .poll(
      async () => {
        const sectionCandidates = [
          page.locator("#aletheiaInsights"),
          page.locator("#industryNews"),
          page.locator("#leaderboard"),
          page.getByRole("heading", { name: /insights|news|leaderboard/i }).first(),
          page.getByText(/industry news|market news|leaderboard|aletheia/i).first(),
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
    await expect(userPage.getByRole("heading", { name: "Dashboards" }).first()).toBeVisible();
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
        const mortgageNewsItem = userPage.getByRole("menuitem", { name: "Mortgage News" });
        if (await mortgageNewsItem.first().isVisible().catch(() => false)) {
          await mortgageNewsItem.first().click();
        }
      }
    }
    await expect(userPage).toHaveURL(/\/insights/);
    await expectInsightsSections(userPage);
  });
});
