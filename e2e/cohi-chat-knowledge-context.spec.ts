import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

async function mockCohiChatKnowledgeApis(page: Page) {
  await page.route(/\/api\/tenants(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ tenants: [{ id: "tenant-cohi-78", name: "QA Tenant" }] }),
    });
  });

  await page.route(/\/api\/cohi-chat\/default-tenant(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ tenantId: "tenant-cohi-78" }),
    });
  });

  await page.route(/\/api\/cohi-chat\/new-session(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ sessionId: "cohi-78-session" }),
    });
  });

  await page.route(/\/api\/cohi-chat\/sessions(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ sessions: [] }),
    });
  });

  await page.route(/\/api\/cohi-chat\/ask(?:\?.*)?$/, async (route) => {
    const request = route.request().postDataJSON() as { question?: string } | null;
    expect(request?.question ?? "").toMatch(/pull-through|fallout|pipeline/i);

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        message:
          "Current platform metric context: pull-through uses a rolling 90-day funded-loan denominator, fallout is categorized from Withdrawn and Denied statuses, and pipeline aging is measured from active loan milestone dates. These definitions come from the current dashboard metric knowledge base.",
        sources: {
          dataQuery: false,
          knowledgeBase: ["Platform Metrics - Current Dashboard Definitions"],
        },
        suggestedQuestions: [
          "How is pull-through trending by channel?",
          "Where is fallout concentrated in the pipeline?",
          "Which active loans are aging past expected milestones?",
        ],
      }),
    });
  });
}

test.describe("Cohi Chat knowledge context", () => {
  test("@critical @COHI-78 answers platform metric questions with current knowledge context", async ({
    userPage,
  }) => {
    await mockCohiChatKnowledgeApis(userPage);
    await userPage.goto("/data-chat", { waitUntil: "domcontentloaded" });

    await expect(
      userPage.getByPlaceholder("What important info do I need to know today?"),
    ).toBeVisible({ timeout: 15_000 });

    const input = userPage.getByPlaceholder("What important info do I need to know today?");
    await input.fill("What is the current pull-through and fallout definition for pipeline reporting?");
    await input.press("Enter");

    await expect(userPage.getByText(/rolling 90-day funded-loan denominator/i)).toBeVisible({
      timeout: 15_000,
    });
    await expect(userPage.getByText(/Withdrawn and Denied statuses/i)).toBeVisible();
    await expect(userPage.getByText(/active loan milestone dates/i)).toBeVisible();
    await expect(userPage.getByText(/current dashboard metric knowledge base/i)).toBeVisible();
    await expect(userPage.getByText(/pull-through trending by channel/i)).toBeVisible();
    await expect(userPage.getByText(/fallout concentrated in the pipeline/i)).toBeVisible();
  });
});
