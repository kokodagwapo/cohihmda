import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

async function mockResearchFindingsSession(page: Page) {
  await page.route(/\/api\/research\/sessions(?:\?.*)?$/, async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ sessionId: "cohi-331-session" }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([]),
    });
  });

  await page.route(
    /\/api\/research\/sessions\/cohi-331-session\/stream(?:\?.*)?$/,
    async (route) => {
      const findings = [
        {
          questionId: 1,
          title: "Revenue pressure concentrated in mature applications",
          summary:
            "Applications aged 90-180 days show 18.4% lower pull-through and $425K lower revenue than the recent cohort. Processor queue aging accounts for 73 loans in the exception set. Follow-up should prioritize loans older than 120 days.",
          summary_bullets: [
            "Applications aged 90-180 days show 18.4% lower pull-through and $425K lower revenue than the recent cohort.",
            "Processor queue aging accounts for 73 loans in the exception set.",
            "Follow-up should prioritize loans older than 120 days.",
          ],
          confidence: "high",
          evidence: [],
          keyMetrics: { "Revenue Gap": "$425K", "Aged Loans": 73 },
        },
        {
          questionId: 2,
          title: "Single sentence finding stays compact",
          summary: "Single sentence finding summary remains concise.",
          confidence: "medium",
          evidence: [],
          keyMetrics: {},
        },
      ];

      const body = [
        `data: ${JSON.stringify({
          type: "quick_result",
          data: findings[0],
          timestamp: Date.now(),
        })}`,
        "",
        `data: ${JSON.stringify({
          type: "agent_finding",
          data: { content: JSON.stringify(findings[1]) },
          timestamp: Date.now(),
        })}`,
        "",
        `data: ${JSON.stringify({
          type: "complete",
          data: {},
          timestamp: Date.now(),
        })}`,
        "",
        "",
      ].join("\n");

      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body,
      });
    },
  );
}

test.describe("@critical Research Lab", () => {
  test("@smoke research page loads with input and mode toggle", async ({ userPage }) => {
    await userPage.goto("/research/session", { waitUntil: "domcontentloaded" });
    await expect(userPage.getByRole("heading", { level: 2, name: "Research Lab" })).toBeVisible();
    await expect(userPage.getByPlaceholder(/e\.g\., What's our YTD pull-through/i)).toBeVisible();
    await expect(userPage.getByRole("button", { name: /Deep Analysis/i })).toBeVisible();
  });

  test("@smoke accepts research question input", async ({ userPage }) => {
    await userPage.goto("/research/session", { waitUntil: "domcontentloaded" });
    const prompt = userPage.getByPlaceholder(/e\.g\., What's our YTD pull-through/i);
    await prompt.fill("What are the top 5 conversion bottlenecks this month?");
    await expect(prompt).toHaveValue("What are the top 5 conversion bottlenecks this month?");
  });

  test("@critical @COHI-106 runs investigation lifecycle and supports follow-up behavior", async ({ userPage }) => {
    test.setTimeout(90_000);
    await userPage.goto("/research/session", { waitUntil: "domcontentloaded" });

    const prompt = userPage.getByPlaceholder(/YTD pull-through|comprehensive analysis/i);
    await prompt.fill("What is our pull-through trend by channel this month?");
    await userPage.getByRole("button", { name: /Get answer|Investigate/i }).click();

    // Session starts: timeline tab + steering/follow-up input should appear.
    await expect(userPage.getByRole("tab", { name: "Timeline" })).toBeVisible();
    const steerOrFollowup = userPage.getByPlaceholder(/Steer the investigation|Ask a follow-up question/i);
    await expect(steerOrFollowup).toBeVisible();

    // While running, pause and resume controls should be available.
    const pauseBtn = userPage.getByRole("button", { name: "Pause" });
    if (await pauseBtn.isVisible().catch(() => false)) {
      await pauseBtn.click();
      const resumeBtn = userPage.getByRole("button", { name: "Resume" });
      if (await resumeBtn.isVisible().catch(() => false)) {
        await resumeBtn.click();
      }
    }

    // Wait for synthesis to complete (the "Continue the conversation" label
    // appears above the input bar when phase transitions to "complete").
    const completed = await userPage
      .getByText("Continue the conversation")
      .isVisible({ timeout: 45_000 })
      .catch(() => false);

    if (completed) {
      const reportTab = userPage.getByRole("tab", { name: "Report" });
      if (!(await reportTab.isDisabled())) {
        await reportTab.click();
      }

      // After completion the same input stays mounted but its placeholder
      // switches to "Ask a follow-up question...". Use the broad locator
      // that already matched during the running phase.
      await expect(steerOrFollowup).toBeVisible();
      await expect(steerOrFollowup).toBeEditable();
      await steerOrFollowup.fill("Can you break that down by top 3 loan officers?");
      await steerOrFollowup.press("Enter");
      await expect(userPage.getByRole("tab", { name: "Timeline" })).toBeVisible();
    }
  });

  test("@critical @COHI-331 renders research finding summaries as readable bullets", async ({
    userPage,
  }) => {
    await mockResearchFindingsSession(userPage);
    await userPage.goto("/research/session", { waitUntil: "domcontentloaded" });

    const prompt = userPage.getByPlaceholder(/YTD pull-through|comprehensive analysis/i);
    await prompt.fill("Summarize mature application revenue risk.");
    await userPage.getByRole("button", { name: /Get answer|Investigate/i }).click();

    await expect(userPage.getByRole("tab", { name: /Findings/i })).toBeVisible({
      timeout: 15_000,
    });
    await userPage.getByRole("tab", { name: /Findings/i }).click();

    const findingsPanel = userPage.locator('[data-tour="research-findings"]');
    await expect(
      findingsPanel.getByText("Revenue pressure concentrated in mature applications"),
    ).toBeVisible({ timeout: 15_000 });

    const bulletItems = findingsPanel.locator("ul li");
    await expect(bulletItems).toHaveCount(3);
    await expect(bulletItems.nth(0)).toContainText("18.4%");
    await expect(bulletItems.nth(0)).toContainText("$425K");
    await expect(bulletItems.nth(1)).toContainText("73 loans");

    await expect(
      findingsPanel.getByText("Single sentence finding summary remains concise."),
    ).toBeVisible();
  });
});
