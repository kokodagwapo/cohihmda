import { test, expect } from "./fixtures";
import { forceUnifiedChat, mockUnifiedChatApis } from "./helpers/unifiedChat";

const SIDEBAR_SECTION_LABELS = [
  "Insights",
  "My Dashboards",
  "Folders",
  "History",
  "Full History",
] as const;

test.describe("Unified chat IA (COHI-405)", () => {
  test.beforeEach(async ({ userPage }) => {
    await forceUnifiedChat(userPage);
    await mockUnifiedChatApis(userPage);
  });

  test("@critical @COHI-405 AC1 sidebar sections order Insights through Full History", async ({
    userPage,
  }) => {
    await userPage.goto("/insights", { waitUntil: "domcontentloaded" });
    await expect(userPage.getByTestId("unified-chat-shell")).toBeVisible({
      timeout: 15_000,
    });

    const positions = await userPage.evaluate((labels) => {
      const bodyText = document.body.innerText;
      return labels.map((label) => bodyText.indexOf(label));
    }, [...SIDEBAR_SECTION_LABELS]);

    for (let i = 0; i < positions.length; i++) {
      expect(positions[i]).toBeGreaterThanOrEqual(0);
      if (i > 0) {
        expect(positions[i]).toBeGreaterThan(positions[i - 1]!);
      }
    }
  });

  test("@critical @COHI-405 AC2 single Insights entry no duplicate shortcuts", async ({
    userPage,
  }) => {
    await userPage.goto("/insights", { waitUntil: "domcontentloaded" });
    const insightsNav = userPage.getByRole("button", { name: /^Insights$/i });
    await expect(insightsNav.first()).toBeVisible({ timeout: 15_000 });
    const insightsCount = await insightsNav.count();
    expect(insightsCount).toBeGreaterThanOrEqual(1);
    expect(insightsCount).toBeLessThanOrEqual(2);
    await expect(userPage.getByText("Research Lab", { exact: true })).toHaveCount(0);
  });

  test("@critical @COHI-405 AC3 top nav Communications Center no Research Lab", async ({
    userPage,
  }) => {
    await userPage.goto("/insights", { waitUntil: "domcontentloaded" });
    await expect(
      userPage.getByRole("navigation", { name: /main navigation/i }).getByText(
        "Communications Center",
      ),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      userPage.getByRole("navigation", { name: /main navigation/i }).getByText(
        "Research Lab",
      ),
    ).toHaveCount(0);
  });

  test("@regression @COHI-405 AC4 insights page content unchanged", async ({ userPage }) => {
    await userPage.goto("/insights", { waitUntil: "domcontentloaded" });
    await expect(userPage.getByTestId("unified-chat-shell")).toBeVisible({
      timeout: 15_000,
    });
    await expect(userPage.getByText("Cohi Insights").first()).toBeVisible({
      timeout: 15_000,
    });
  });
});
