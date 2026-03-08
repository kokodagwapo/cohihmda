import { test as base, expect, type Page } from "@playwright/test";
import path from "node:path";

type AppFixtures = {
  userPage: Page;
  adminPage: Page;
};

const userStatePath = path.join(process.cwd(), "e2e", ".auth", "user.json");
const adminStatePath = path.join(process.cwd(), "e2e", ".auth", "admin.json");

export const test = base.extend<AppFixtures>({
  userPage: async ({ browser }, use) => {
    const context = await browser.newContext({ storageState: userStatePath });
    const page = await context.newPage();
    await use(page);
    await context.close();
  },
  adminPage: async ({ browser }, use) => {
    const context = await browser.newContext({ storageState: adminStatePath });
    const page = await context.newPage();
    await use(page);
    await context.close();
  },
});

export { expect };
