import { test, expect } from "./fixtures";
import { expectPageHeading } from "./helpers";
import type { Response } from "@playwright/test";

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
      const headingVisible = await userPage.locator("h1, h2").first().isVisible().catch(() => false);
      if (headingVisible) {
        await expectPageHeading(userPage);
      } else {
        await expect(userPage.locator("button, [role='button']").first()).toBeVisible();
      }
    });
  }

  for (const route of topTieringRoutes) {
    test(`@regression ${route} loads data APIs successfully`, async ({ userPage }) => {
      const apiResponses: Array<{ url: string; status: number }> = [];
      const responseListener = (response: Response) => {
        const url = response.url();
        if (!url.includes("/api/")) return;
        if (url.includes("/api/auth/")) return;
        if (response.request().method() !== "GET") return;
        apiResponses.push({ url, status: response.status() });
      };

      userPage.on("response", responseListener);
      await userPage.goto(route, { waitUntil: "domcontentloaded" });
      await userPage.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
      await userPage.waitForTimeout(1_500);
      userPage.off("response", responseListener);

      const routeApiResponses = apiResponses;
      const serverErrors = routeApiResponses.filter(({ status }) => status >= 500);

      expect(serverErrors, `${route} returned server-side API errors`).toHaveLength(0);
      const headingVisible = await userPage.locator("h1, h2").first().isVisible().catch(() => false);
      if (headingVisible) {
        await expectPageHeading(userPage);
      }
      await expect(userPage.locator("button, [role='button']").first()).toBeVisible();
    });
  }

  test("@critical @COHI-96 supports at least one drill-down style interaction", async ({ userPage }) => {
    await userPage.goto("/fallout-forecast", { waitUntil: "domcontentloaded" });
    await userPage.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});

    // The reliable drill-down is the loan-officer button on the critical loan cards.
    const officerButton = userPage
      .getByRole("button", { name: /^MLO\/AE:/i })
      .first();
    await expect(officerButton).toBeVisible({ timeout: 15_000 });
    await officerButton.scrollIntoViewIfNeeded();
    await officerButton.click();

    await expect(userPage.getByText("Portfolio Analysis")).toBeVisible({ timeout: 10_000 });
    await expect(userPage.locator("[role='dialog']").first()).toBeVisible({ timeout: 10_000 });
  });
});
