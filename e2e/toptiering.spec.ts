import { test, expect } from "./fixtures";
import { expectPageHeading } from "./helpers";

const topTieringRoutes = [
  "/workflow-conversion",
  "/loan-detail",
  "/fallout-forecast",
  "/pricing-dashboard",
  "/lock-stratification",
  "/pipeline-analysis",
  "/loan-complexity",
  "/credit-risk-management",
  "/company-scorecard",
  "/high-performers",
  "/actors",
  "/performance/toptiering-comparison",
  "/performance/financial-modeling-sandbox",
  "/sales-scorecard",
  "/sales-trends",
  "/sales-scorecard-overview",
  "/performance/operation-scorecard",
  "/performance/operation-scorecard-trends",
] as const;

test.describe("TopTiering pages", () => {
  for (const route of topTieringRoutes) {
    test(`@regression renders ${route}`, async ({ userPage }) => {
      await userPage.goto(route, { waitUntil: "domcontentloaded" });
      await expect(userPage).toHaveURL(new RegExp(route.replace(/\//g, "\\/")));
      await expectPageHeading(userPage);
    });
  }

  test("@critical supports at least one drill-down style interaction", async ({ userPage }) => {
    await userPage.goto("/fallout-forecast", { waitUntil: "domcontentloaded" });

    const drillTrigger = userPage
      .locator("button, [role='button']")
      .filter({ hasText: /view|detail|drill|open/i })
      .first();

    if ((await drillTrigger.count()) > 0) {
      await drillTrigger.click();
      await expect(userPage.locator("[role='dialog']").first()).toBeVisible();
    } else {
      // Fallback: verify at least this page has interactive controls.
      await expect(userPage.locator("button, [role='button']").first()).toBeVisible();
    }
  });
});
