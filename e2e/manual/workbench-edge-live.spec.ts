/**
 * Edge-case live workbench flows (registry ops, readonly, export).
 * Run: npx playwright test e2e/manual/workbench-edge-live.spec.ts --config=playwright.manual-live.config.ts
 */
import fs from "fs";
import path from "path";
import { test } from "@playwright/test";
import {
  dismissBlockingOverlays,
  unifiedChatMessageInput,
} from "../helpers/unifiedChat";
import {
  openFreshWorkbenchChat,
  seedBoardReadyDashboard,
  waitForChatInputReady,
} from "../helpers/workbenchLive";
import { assertVisibleAfterHover } from "../helpers/responsiveControls";

async function skipIfLoggedOut(page: import("@playwright/test").Page) {
  const login = await page
    .getByText(/Sign in to access your dashboard/i)
    .isVisible()
    .catch(() => false);
  if (login) test.skip(true, "auth expired — npx tsx e2e/manual-auth-setup.ts");
}

async function sendTurn(
  page: import("@playwright/test").Page,
  message: string,
  options?: { maxWaitMs?: number },
) {
  const input = unifiedChatMessageInput(page);
  await dismissBlockingOverlays(page);
  await input.fill(message);
  await input.press("Enter");
  await waitForChatInputReady(page, {
    timeoutMs: options?.maxWaitMs ?? 90_000,
  });
}

const OUT = path.join("test-results", "edge-live");
const REPORT = path.join(OUT, "REPORT.md");

type Status = "works" | "broken" | "rough" | "skipped";
type Row = { id: string; name: string; status: Status; observed: string };
const rows: Row[] = [];

function record(r: Row) {
  fs.mkdirSync(OUT, { recursive: true });
  rows.push(r);
  fs.appendFileSync(
    REPORT,
    `| ${r.id} | ${r.name} | **${r.status}** | ${r.observed.replace(/\|/g, "/")} |\n`,
  );
}

test.describe.configure({ mode: "serial" });

test.beforeAll(() => {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(REPORT, "| ID | Scenario | Status | Observed |\n| --- | --- | --- | --- |\n");
});

test.afterAll(() => {
  const broken = rows.filter((r) => r.status === "broken").length;
  fs.appendFileSync(REPORT, `\n**Summary:** ${rows.length} scenarios, ${broken} broken.\n`);
});

test.describe("Workbench edge live", () => {
  test.beforeEach(async ({ page }) => {
    const { forceUnifiedChat } = await import("../helpers/unifiedChat");
    await forceUnifiedChat(page);
  });

  test("E01 move widget to another group via chat", async ({ page }) => {
    await seedBoardReadyDashboard(page);
    await skipIfLoggedOut(page);
    await sendTurn(
      page,
      "Create a second widget group and move Total Units into the new group.",
    );
    const groups = page.locator("#workbench-canvas-root .group\\/widgetgroup");
    const count = await groups.count();
    record({
      id: "E01",
      name: "Move to another group",
      status: count >= 2 ? "works" : "rough",
      observed: `groups=${count}`,
    });
  });

  test("E02 lock group filters toolbar", async ({ page }) => {
    await seedBoardReadyDashboard(page);
    await skipIfLoggedOut(page);
    const lockBtn = page
      .getByRole("button", { name: /lock filters/i })
      .or(page.getByTitle(/lock filters/i))
      .first();
    const visible = await lockBtn.isVisible({ timeout: 20_000 }).catch(() => false);
    if (!visible) {
      record({
        id: "E02",
        name: "Lock group filters",
        status: "skipped",
        observed: "lockFiltersBtn=false",
      });
      return;
    }
    await lockBtn.click({ timeout: 10_000 }).catch(() => {});
    const locked = await page.getByText(/^Locked$/).first().isVisible().catch(() => false);
    record({
      id: "E02",
      name: "Lock group filters",
      status: locked ? "works" : "rough",
      observed: `lockedLabel=${locked}`,
    });
  });

  test("E03 export menu on cohi viz footer", async ({ page }) => {
    await seedBoardReadyDashboard(page);
    await skipIfLoggedOut(page);
    await sendTurn(
      page,
      'Add a cohi bar chart titled "Edge Chart" for funded volume by month.',
    );
    const footer = page.locator('[data-testid="cohi-viz-footer"]').first();
    const visible = await footer.isVisible({ timeout: 90_000 }).catch(() => false);
    const exportBtn = footer.getByRole("button", { name: /export/i }).first();
    const hasExport =
      visible &&
      (await exportBtn.isVisible({ timeout: 5_000 }).catch(() => false));
    record({
      id: "E03",
      name: "Cohi viz export footer",
      status: hasExport ? "works" : "rough",
      observed: `footer=${visible} export=${hasExport}`,
    });
  });

  test("E04 conversation sidebar overflow menu", async ({ page }) => {
    await openFreshWorkbenchChat(page);
    await skipIfLoggedOut(page);
    await dismissBlockingOverlays(page);
    const row = page.locator('[data-testid="unified-chat-history-row"]').first();
    const hasRow = await row.isVisible({ timeout: 20_000 }).catch(() => false);
    if (!hasRow) {
      record({
        id: "E04",
        name: "History row menu",
        status: "skipped",
        observed: "no history rows",
      });
      return;
    }
    await row.hover();
    const menu = row.getByRole("button", { name: /more|options/i }).first();
    const ok = await menu.isVisible({ timeout: 5_000 }).catch(() => false);
    if (ok) await menu.click();
    record({
      id: "E04",
      name: "History row menu",
      status: ok ? "works" : "rough",
      observed: `menu=${ok}`,
    });
  });

  test("E05 maximize widget then restore", async ({ page }) => {
    await seedBoardReadyDashboard(page);
    await skipIfLoggedOut(page);
    const group = page.locator("#workbench-canvas-root .group\\/widgetgroup").first();
    const maxBtn = page.getByRole("button", { name: "Maximize widget" }).first();
    await assertVisibleAfterHover(page, group, maxBtn, "maximize");
    await maxBtn.click();
    const dialog = page.getByRole("dialog");
    const opened = await dialog.isVisible({ timeout: 5_000 }).catch(() => false);
    if (opened) {
      await page.keyboard.press("Escape");
    }
    record({
      id: "E05",
      name: "Maximize widget dialog",
      status: opened ? "works" : "broken",
      observed: `dialog=${opened}`,
    });
  });
});
