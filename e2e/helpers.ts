import { expect, type Page } from "@playwright/test";

export async function loginWithCredentials(
  page: Page,
  email: string,
  password: string,
) {
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign In" }).click();
}

export async function expectAuthenticatedRoute(page: Page, path: string) {
  await page.goto(path, { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(new RegExp(path.replace(/\//g, "\\/")));
  await expect(page.getByRole("navigation", { name: /main navigation/i })).toBeVisible();
}

export async function expectPageHeading(page: Page) {
  const headings = page.locator("h1, h2");
  await expect(headings.first()).toBeVisible();
}

export async function openUserMenu(page: Page): Promise<boolean> {
  const overlay = page.locator("div[data-state='open'][aria-hidden='true']").first();
  if (await overlay.isVisible().catch(() => false)) {
    await page.keyboard.press("Escape");
  }

  const trigger = page.getByTestId("user-menu-trigger");
  if ((await trigger.count()) > 0 && (await trigger.first().isVisible().catch(() => false))) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await trigger.first().click({ force: true, timeout: 3_000 });
        return true;
      } catch {
        await page.waitForTimeout(250);
      }
    }
  } else {
    const fallbackTrigger = page.getByRole("button", { name: /user menu|account|profile/i }).first();
    if (await fallbackTrigger.isVisible().catch(() => false)) {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          await fallbackTrigger.click({ force: true, timeout: 3_000 });
          return true;
        } catch {
          await page.waitForTimeout(250);
        }
      }
    }
  }
  return false;
}

export async function gotoAndExpect(page: Page, path: string, title?: RegExp | string) {
  await page.goto(path, { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(new RegExp(path.replace(/\//g, "\\/")));
  if (title) {
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
  }
}
