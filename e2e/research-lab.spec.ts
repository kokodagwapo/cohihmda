import { test, expect } from "./fixtures";

test.describe("@critical Research Lab", () => {
  test("@smoke research page loads with input and mode toggle", async ({ userPage }) => {
    await userPage.goto("/research", { waitUntil: "domcontentloaded" });
    await expect(userPage.getByRole("heading", { name: "Research Lab" })).toBeVisible();
    await expect(userPage.getByPlaceholder(/e\.g\., What's our YTD pull-through/i)).toBeVisible();
    await expect(userPage.getByRole("button", { name: /Deep Analysis/i })).toBeVisible();
  });

  test("@smoke accepts research question input", async ({ userPage }) => {
    await userPage.goto("/research", { waitUntil: "domcontentloaded" });
    const prompt = userPage.getByPlaceholder(/e\.g\., What's our YTD pull-through/i);
    await prompt.fill("What are the top 5 conversion bottlenecks this month?");
    await expect(prompt).toHaveValue("What are the top 5 conversion bottlenecks this month?");
  });

  test("runs investigation lifecycle and supports follow-up behavior", async ({ userPage }) => {
    await userPage.goto("/research", { waitUntil: "domcontentloaded" });

    const prompt = userPage.getByPlaceholder(/YTD pull-through|comprehensive analysis/i);
    await prompt.fill("What is our pull-through trend by channel this month?");
    await userPage.getByRole("button", { name: /Get answer|Investigate/i }).click();

    // Session starts: timeline tab + guidance input should appear.
    await expect(userPage.getByRole("tab", { name: "Timeline" })).toBeVisible();
    await expect(
      userPage.getByPlaceholder(/Steer the investigation|Ask a follow-up question/i),
    ).toBeVisible();

    // While running, pause and resume controls should be available.
    const pauseBtn = userPage.getByRole("button", { name: "Pause" });
    if (await pauseBtn.isVisible().catch(() => false)) {
      await pauseBtn.click();
      await expect(userPage.getByRole("button", { name: "Resume" })).toBeVisible();
      await userPage.getByRole("button", { name: "Resume" }).click();
    }

    // If synthesis completes in time, validate report/findings and follow-up path.
    const completed = await userPage
      .getByText(/Complete|Continue the conversation/i)
      .first()
      .isVisible({ timeout: 45_000 })
      .catch(() => false);

    if (completed) {
      const reportTab = userPage.getByRole("tab", { name: "Report" });
      if (!(await reportTab.isDisabled())) {
        await reportTab.click();
      }

      const followupInput = userPage.getByPlaceholder(/Ask a follow-up question/i);
      await followupInput.fill("Can you break that down by top 3 loan officers?");
      await followupInput.locator("xpath=following::button[1]").click();
      await expect(userPage.getByRole("tab", { name: "Timeline" })).toBeVisible();
    }
  });
});
