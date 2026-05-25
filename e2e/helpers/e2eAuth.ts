import type { Page } from "@playwright/test";

/** Bearer header from Playwright storageState localStorage (auth is not cookie-based). */
export async function e2eAuthHeaders(page: Page): Promise<Record<string, string>> {
  const token = await page.evaluate(() => localStorage.getItem("auth_token"));
  if (!token) {
    throw new Error(
      "No auth_token in localStorage — run: npx tsx e2e/manual-auth-setup.ts",
    );
  }
  return { Authorization: `Bearer ${token}` };
}
