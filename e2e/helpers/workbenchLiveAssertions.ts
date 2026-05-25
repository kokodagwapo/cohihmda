import { expect, type Page } from "@playwright/test";

/** Poll until canvas root text no longer matches the given pattern. */
export async function pollCanvasTextGone(
  page: Page,
  stillPresentPattern: RegExp,
  options?: { timeoutMs?: number },
): Promise<boolean> {
  try {
    await expect
      .poll(
        async () => {
          const text =
            (await page.locator("#workbench-canvas-root").textContent()) ?? "";
          return !stillPresentPattern.test(text);
        },
        {
          timeout: options?.timeoutMs ?? 30_000,
          intervals: [1000, 2000],
        },
      )
      .toBe(true);
    return true;
  } catch {
    return false;
  }
}
