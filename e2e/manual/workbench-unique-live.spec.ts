/**
 * Additional unique live workbench scenarios (non-duplicate of varied-live V01–V15).
 */
import fs from "fs";
import path from "path";
import { test, expect } from "@playwright/test";
import {
  dismissBlockingOverlays,
  forceUnifiedChat,
  unifiedChatMessageInput,
} from "../helpers/unifiedChat";
import {
  openFreshWorkbenchChat,
  seedBoardReadyDashboard,
  waitForChatInputReady,
} from "../helpers/workbenchLive";
import {
  assertVisibleAfterHover,
  widgetGroupCollapseToggle,
} from "../helpers/responsiveControls";
import { captureReconcileTrace } from "../helpers/reconcileTrace";
import { pollCanvasTextGone } from "../helpers/workbenchLiveAssertions";

const OUT = path.join("test-results", "unique-live");
const REPORT = path.join(OUT, "REPORT.md");

type Row = { id: string; name: string; status: string; observed: string };

const rows: Row[] = [];

async function record(
  page: import("@playwright/test").Page,
  r: Row,
  tracePrompt?: string,
) {
  let observed = r.observed.replace(/\|/g, "/");
  if ((r.status === "broken" || r.status === "rough") && tracePrompt) {
    const trace = await captureReconcileTrace(page.request, tracePrompt, { page });
    if (trace) observed += ` | trace=${trace}`;
  }
  rows.push({ ...r, observed });
  fs.appendFileSync(REPORT, `| ${r.id} | ${r.name} | ${r.status} | ${observed} |\n`);
  console.log(`\n[${r.id}] ${r.name}: ${r.status}\n  → ${observed}`);
}

async function sendTurn(page: import("@playwright/test").Page, message: string) {
  const input = unifiedChatMessageInput(page);
  await dismissBlockingOverlays(page);
  await input.fill(message);
  await input.press("Enter");
  await waitForChatInputReady(page);
  return {
    canvas: (await page.locator("#workbench-canvas-root").textContent()) ?? "",
    main: (await page.locator("main").textContent()) ?? "",
  };
}

test.describe.configure({ mode: "serial" });

test.describe("Unique live workbench @manual-live", () => {
  test.beforeAll(() => {
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(
      REPORT,
      `# Unique live workbench — ${new Date().toISOString()}\n\n| ID | Case | Status | Observed |\n|----|------|--------|----------|\n`,
    );
  });

  test.beforeEach(async ({ page }) => {
    await forceUnifiedChat(page);
  });

  async function skipIfLoggedOut(page: import("@playwright/test").Page) {
    const login = await page
      .getByText(/Sign in to access your dashboard/i)
      .isVisible()
      .catch(() => false);
    if (login) test.skip(true, "auth expired — npx tsx e2e/manual-auth-setup.ts");
  }

  test("U01 rename widget title via chat", async ({ page }) => {
    await seedBoardReadyDashboard(page);
    await skipIfLoggedOut(page);
    await sendTurn(page, 'Rename the pull-through rate widget title to "PT Rate".');
    const canvas = (await page.locator("#workbench-canvas-root").textContent()) ?? "";
    const ok = /PT Rate/i.test(canvas);
    await record(page, {
      id: "U01",
      name: "Rename widget title",
      status: ok ? "works" : "rough",
      observed: `ptRateOnCanvas=${ok}`,
    });
  });

  test("U02 switch chart to line via chat", async ({ page }) => {
    await seedBoardReadyDashboard(page);
    await skipIfLoggedOut(page);
    await sendTurn(page, "Change pull-through by branch chart to a line chart.");
    await waitForChatInputReady(page);
    let hasLine = false;
    try {
      await expect
        .poll(
          async () =>
            page
              .locator("#workbench-canvas-root .recharts-line-curve")
              .first()
              .isVisible()
              .catch(() => false),
          { timeout: 25_000, intervals: [1000, 2000] },
        )
        .toBe(true);
      hasLine = true;
    } catch {
      hasLine = false;
    }
    await record(
      page,
      {
        id: "U02",
        name: "Chart type line",
        status: hasLine ? "works" : "rough",
        observed: `lineCurve=${hasLine}`,
      },
      "Change pull-through by branch chart to a line chart.",
    );
  });

  test("U03 collapse group then expand manually", async ({ page }) => {
    await seedBoardReadyDashboard(page);
    const toggle = widgetGroupCollapseToggle(page);
    await expect(toggle).toBeVisible({ timeout: 20_000 });
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-label", "Expand group");
    await toggle.click();
    await record(page, {
      id: "U03",
      name: "Manual collapse/expand",
      status: "works",
      observed: "toggle ok",
    });
  });

  test("U04 duplicate funded units via toolbar", async ({ page }) => {
    await seedBoardReadyDashboard(page);
    await skipIfLoggedOut(page);
    const group = page.locator("#workbench-canvas-root .group\\/widgetgroup").first();
    const widget = group.locator(".group\\/widget").first();
    const dup = widget.getByRole("button", { name: "Duplicate widget" });
    const countBefore = await group.locator(".group\\/widget").count();
    await assertVisibleAfterHover(page, widget, dup, "duplicate");
    await dup.click();
    await page.waitForTimeout(2000);
    const countAfter = await group.locator(".group\\/widget").count();
    await record(page, {
      id: "U04",
      name: "Toolbar duplicate units",
      status: countAfter > countBefore ? "works" : "broken",
      observed: `widgets ${countBefore}→${countAfter}`,
    });
  });

  test("U05 executive vs board-ready wording", async ({ page }) => {
    await openFreshWorkbenchChat(page);
    const { main } = await sendTurn(
      page,
      "Give me an executive summary of pipeline health for leadership.",
    );
    const ok = /pipeline|executive|health|fund/i.test(main);
    await record(page, {
      id: "U05",
      name: "Executive summary ask",
      status: ok ? "works" : "rough",
      observed: `keywords=${ok}`,
    });
  });

  test("U06 resize while waiting — composer stays enabled", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openFreshWorkbenchChat(page);
    const input = unifiedChatMessageInput(page);
    await input.fill("Build a minimal dashboard with funded volume only.");
    await page.setViewportSize({ width: 390, height: 844 });
    await input.press("Enter");
    await expect(input).toBeDisabled();
    await page.setViewportSize({ width: 1280, height: 800 });
    await waitForChatInputReady(page);
    const enabled = await input.isEnabled();
    await record(page, {
      id: "U06",
      name: "Resize during stream",
      status: enabled ? "works" : "broken",
      observed: `inputEnabled=${enabled}`,
    });
  });

  test("U07 period switch L6M", async ({ page }) => {
    await seedBoardReadyDashboard(page);
    await sendTurn(page, "Switch the dashboard to last 6 months.");
    const footers = page.locator("p.text-violet-600, p.text-violet-400");
    const last =
      (await footers.count()) > 0
        ? ((await footers.last().textContent()) ?? "")
        : "";
    const canvas = (await page.locator("#workbench-canvas-root").textContent()) ?? "";
    const periodChip = page.locator('[data-testid="group-period-chip"]').first();
    const chipText = (await periodChip.textContent().catch(() => "")) ?? "";
    const chipAria = (await periodChip.getAttribute("aria-label").catch(() => "")) ?? "";
    const footerOk = /period|L6M|6 month|Updated/i.test(last);
    let chipOk =
      /L6M|last 6 months|6 month/i.test(chipText) ||
      /L6M|last 6 months|6 month/i.test(chipAria);
    if (!chipOk) {
      try {
        await expect
          .poll(
            async () => {
              const text =
                (await periodChip.textContent().catch(() => "")) ?? "";
              const aria =
                (await periodChip.getAttribute("aria-label").catch(() => "")) ??
                "";
              return /last 6 months|6 month/i.test(text) || /last 6 months/i.test(aria);
            },
            { timeout: 15_000, intervals: [500, 1000] },
          )
          .toBe(true);
        chipOk = true;
      } catch {
        chipOk = false;
      }
    }
    const canvasOk =
      /L6M|last 6 months|6 month/i.test(canvas) || chipOk;
    const works = footerOk && canvasOk;
    await record(
      page,
      {
        id: "U07",
        name: "L6M period switch",
        status: works ? "works" : footerOk ? "broken" : "broken",
        observed: works
          ? last.slice(0, 80)
          : footerOk
            ? `footer-only chip=${chipText.slice(0, 30)}`
            : last.slice(0, 80) || "no-footer",
      },
      "Switch the dashboard to last 6 months.",
    );
  });

  test("U08 remove funded volume only", async ({ page }) => {
    await seedBoardReadyDashboard(page);
    await skipIfLoggedOut(page);
    await sendTurn(page, "Remove the funded volume widget from the dashboard.");
    await waitForChatInputReady(page);
    const gone = await pollCanvasTextGone(page, /Total Volume|funded volume/i);
    await record(
      page,
      {
        id: "U08",
        name: "Remove funded volume",
        status: gone ? "works" : "broken",
        observed: `gone=${gone}`,
      },
      "Remove the funded volume widget from the dashboard.",
    );
  });

  test("U09 pull-through remove and re-add", async ({ page }) => {
    await seedBoardReadyDashboard(page);
    await skipIfLoggedOut(page);
    await sendTurn(page, "Remove the pull-through rate widget from the dashboard.");
    const afterRemove = (await page.locator("#workbench-canvas-root").textContent()) ?? "";
    const gone = !/pull[- ]?through/i.test(afterRemove);
    await sendTurn(page, "Add pull-through rate back to the dashboard.");
    const afterAdd = (await page.locator("#workbench-canvas-root").textContent()) ?? "";
    const back = /pull[- ]?through/i.test(afterAdd);
    await record(page, {
      id: "U09",
      name: "Pull-through remove + re-add",
      status: gone && back ? "works" : gone ? "rough" : "broken",
      observed: `removed=${gone} readded=${back}`,
    });
  });

  test("U10 duplicate second widget via toolbar", async ({ page }) => {
    await seedBoardReadyDashboard(page);
    await skipIfLoggedOut(page);
    const group = page.locator("#workbench-canvas-root .group\\/widgetgroup").first();
    const widgets = group.locator(".group\\/widget");
    const before = await widgets.count();
    if (before < 2) {
      await record(page, {
        id: "U10",
        name: "Duplicate non-first widget",
        status: "skipped",
        observed: `need>=2 widgets, had ${before}`,
      });
      return;
    }
    const widget = widgets.nth(1);
    const dup = widget.getByRole("button", { name: "Duplicate widget" });
    await assertVisibleAfterHover(page, widget, dup, "duplicate");
    await dup.click();
    await page.waitForTimeout(2000);
    const after = await widgets.count();
    await record(page, {
      id: "U10",
      name: "Duplicate non-first widget",
      status: after > before ? "works" : "broken",
      observed: `widgets ${before}→${after}`,
    });
  });
});
