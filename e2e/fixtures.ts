import { test as base, expect, type BrowserContext, type Page } from "@playwright/test";
import path from "node:path";

type AppFixtures = {
  userPage: Page;
  adminPage: Page;
  canvasOnlyPage: Page;
};

const userStatePath = path.join(process.cwd(), "e2e", ".auth", "user.json");
const adminStatePath = path.join(process.cwd(), "e2e", ".auth", "admin.json");
const canvasOnlyStatePath = path.join(
  process.cwd(),
  "e2e",
  ".auth",
  "canvas-only.json",
);

async function addE2EBrowserInitScripts(context: BrowserContext) {
  await context.addInitScript(() => {
    try {
      localStorage.setItem(
        "cohi-welcome-tour-last-shown",
        new Date().toISOString(),
      );
    } catch {
      /* ignore */
    }
  });
}

export const test = base.extend<AppFixtures>({
  userPage: async ({ browser }, use) => {
    const context = await browser.newContext({ storageState: userStatePath });
    await addE2EBrowserInitScripts(context);
    const page = await context.newPage();
    await use(page);
    await context.close();
  },
  adminPage: async ({ browser }, use) => {
    const context = await browser.newContext({ storageState: adminStatePath });
    await addE2EBrowserInitScripts(context);
    const page = await context.newPage();
    await use(page);
    await context.close();
  },
  canvasOnlyPage: async ({ browser }, use) => {
    const context = await browser.newContext({ storageState: canvasOnlyStatePath });
    await addE2EBrowserInitScripts(context);
    const page = await context.newPage();
    await use(page);
    await context.close();
  },
});

export { expect };
