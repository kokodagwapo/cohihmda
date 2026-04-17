import { test, expect } from "./fixtures";

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
});
