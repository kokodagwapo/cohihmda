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

export async function openUserMenu(page: Page) {
  await page.getByTestId("user-menu-trigger").click();
  await expect(page.getByRole("menuitem", { name: "Logout" })).toBeVisible();
}

export async function gotoAndExpect(page: Page, path: string, title?: RegExp | string) {
  await page.goto(path, { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(new RegExp(path.replace(/\//g, "\\/")));
  if (title) {
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
  }
}
