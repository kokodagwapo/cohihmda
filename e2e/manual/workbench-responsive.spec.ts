import { test, expect } from "@playwright/test";
import {
  gotoWithUnifiedChatShell,
  unifiedChatMessageInput,
} from "../helpers/unifiedChat";
import { seedBoardReadyDashboard } from "../helpers/workbenchLive";

const VIEWPORTS = [
  { name: "mobile", width: 390, height: 844 },
  { name: "tablet", width: 834, height: 1194 },
  { name: "desktop", width: 1440, height: 900 },
] as const;

async function assertNoHorizontalOverflow(page: import("@playwright/test").Page) {
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    return doc.scrollWidth > doc.clientWidth + 2;
  });
  expect(overflow, "page should not scroll horizontally").toBe(false);
}

for (const vp of VIEWPORTS) {
  test(`responsive shell @ ${vp.name} (${vp.width}x${vp.height})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await gotoWithUnifiedChatShell(page, "/my-dashboard/new", {
      timeout: 60_000,
    });

    const input = unifiedChatMessageInput(page);
    await expect(input).toBeVisible({ timeout: 60_000 });

    const chatType = page.getByRole("combobox", { name: "Chat type" });
    if (vp.width < 640) {
      await expect(chatType).toBeVisible();
    } else {
      await expect(chatType).toBeVisible();
    }

    await assertNoHorizontalOverflow(page);

    await seedBoardReadyDashboard(page);
    const canvas = page.locator("#workbench-canvas-root");
    await expect(canvas).toBeVisible({ timeout: 120_000 });

    const canvasOverflow = await canvas.evaluate((el) => {
      return el.scrollWidth > el.clientWidth + 4;
    });
    expect(canvasOverflow, "workbench canvas should not overflow horizontally").toBe(
      false,
    );

    await assertNoHorizontalOverflow(page);
  });
}

test("split resize handle hidden on narrow mobile full layout", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await gotoWithUnifiedChatShell(page, "/insights", { timeout: 60_000 });
  const handle = page.getByTestId("chat-split-resize-handle");
  await expect(handle).toBeHidden();
});
