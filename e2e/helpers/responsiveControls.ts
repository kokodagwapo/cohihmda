import { expect, type Locator, type Page } from "@playwright/test";

/** Viewports that stress hidden sm:/md: labels and split-pane breakpoints. */
export const STRESS_VIEWPORTS = [
  { id: "phone-se", width: 320, height: 568 },
  { id: "phone", width: 390, height: 844 },
  { id: "phone-landscape", width: 667, height: 375 },
  { id: "tablet", width: 834, height: 1194 },
  { id: "tablet-landscape", width: 1024, height: 768 },
  { id: "compact-split", width: 1050, height: 800 },
  { id: "laptop", width: 1280, height: 800 },
  { id: "desktop", width: 1440, height: 900 },
  { id: "wide", width: 1920, height: 1080 },
] as const;

export async function assertNoPageHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    return doc.scrollWidth > doc.clientWidth + 2;
  });
  expect(overflow, "document should not scroll horizontally").toBe(false);
}

/** Control must be visible and its horizontal center within the viewport. */
/** Scroll the workbench canvas toolbar until the control center is inside the viewport. */
export async function scrollCanvasToolbarToReveal(
  page: Page,
  locator: Locator,
): Promise<void> {
  const vp = page.viewportSize();
  const toolbar = page.locator("#workbench-canvas-root div.overflow-x-auto").first();
  if (await toolbar.isVisible().catch(() => false)) {
    const maxScroll = await toolbar.evaluate(
      (el) => Math.max(0, el.scrollWidth - el.clientWidth),
    );
    const stepSize = Math.max(40, Math.floor(maxScroll / 10) || 40);
    for (let step = 0; step <= maxScroll + stepSize; step += stepSize) {
      await toolbar.evaluate(
        (el, left) => {
          el.scrollLeft = left;
        },
        Math.min(step, maxScroll),
      );
      const box = await locator.boundingBox();
      if (box && vp) {
        const centerX = box.x + box.width / 2;
        if (
          centerX > 4 &&
          centerX < vp.width - 4 &&
          (await locator.isVisible().catch(() => false))
        ) {
          return;
        }
      } else if (await locator.isVisible().catch(() => false)) {
        return;
      }
    }
  }
  await locator.scrollIntoViewIfNeeded({ timeout: 8_000 }).catch(() => {});
}

export async function assertControlReachable(
  page: Page,
  locator: Locator,
  label: string,
  options?: { scrollCanvasToolbar?: boolean },
): Promise<void> {
  if (options?.scrollCanvasToolbar) {
    await scrollCanvasToolbarToReveal(page, locator);
  } else {
    await locator.scrollIntoViewIfNeeded();
  }
  await expect(locator, `${label} should be visible`).toBeVisible({
    timeout: 30_000,
  });
  const box = await locator.boundingBox();
  const vp = page.viewportSize();
  expect(box, `${label} should have layout box`).not.toBeNull();
  if (!box || !vp) return;

  const centerX = box.x + box.width / 2;
  expect(centerX, `${label} center X`).toBeGreaterThan(0);
  expect(centerX, `${label} center X`).toBeLessThan(vp.width);

  const overflow = box.x + box.width > vp.width + 8;
  expect(overflow, `${label} should not sit fully off-screen right`).toBe(false);
}

/** group-hover / opacity-0 controls must become visible after hovering the card. */
export async function assertVisibleAfterHover(
  page: Page,
  hoverTarget: Locator,
  control: Locator,
  label: string,
): Promise<void> {
  await hoverTarget.scrollIntoViewIfNeeded();
  await hoverTarget.hover({ force: true });
  await page.waitForTimeout(150);
  await expect(control, `${label} after hover`).toBeVisible({ timeout: 5_000 });
  const opacity = await control.evaluate((el) => {
    const style = window.getComputedStyle(el);
    return parseFloat(style.opacity || "1");
  });
  expect(opacity, `${label} opacity after hover`).toBeGreaterThan(0.15);
}

export function widgetGroupCollapseToggle(page: Page) {
  return page
    .locator("#workbench-canvas-root .group\\/widgetgroup")
    .first()
    .getByRole("button", { name: /Collapse group|Expand group/, exact: true });
}

export async function clickChatLayoutMode(
  page: Page,
  mode: "Compact" | "Taller" | "Split",
): Promise<void> {
  const btn = page.getByRole("button", { name: mode, exact: true });
  await expect(btn).toBeVisible({ timeout: 15_000 });
  await btn.click({ force: true });
  await page.waitForTimeout(250);
}
