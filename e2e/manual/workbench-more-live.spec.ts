/**
 * Additional live scenarios — UI + LLM flows not covered elsewhere.
 * Run: npx playwright test e2e/manual/workbench-more-live.spec.ts --config=playwright.manual-live.config.ts
 */
import fs from "fs";
import path from "path";
import { test, expect } from "@playwright/test";
import {
  dismissBlockingOverlays,
  forceUnifiedChat,
  forceWorkbenchChatScopeSync,
  gotoWithUnifiedChatShell,
  selectUnifiedChatType,
  unifiedChatMessageInput,
} from "../helpers/unifiedChat";
import {
  openFreshWorkbenchChat,
  seedBoardReadyDashboard,
  seedDeterministicBoard,
  seedAdditionalDeterministicBoard,
  waitForChatInputReady,
  waitForWorkbenchCanvasPopulated,
} from "../helpers/workbenchLive";
import {
  assertVisibleAfterHover,
  widgetGroupCollapseToggle,
} from "../helpers/responsiveControls";
import {
  captureReconcileTrace,
  formatTraceSuffix,
} from "../helpers/reconcileTrace";
import {
  expectCanvasHasWidget,
  expectCanvasMissingWidget,
} from "../helpers/workbenchCanvasState";

const OUT = path.join("test-results", "more-live");
const REPORT = path.join(OUT, "REPORT.md");

type Status = "works" | "broken" | "rough" | "skipped";

type Row = { id: string; name: string; status: Status; observed: string };

const rows: Row[] = [];

async function record(
  page: import("@playwright/test").Page,
  r: Row,
  tracePrompt?: string,
  options?: { allowBroken?: boolean },
) {
  let observed = r.observed.replace(/\|/g, "/");
  if ((r.status === "broken" || r.status === "rough") && tracePrompt) {
    const capture = await captureReconcileTrace(page, tracePrompt);
    observed += formatTraceSuffix(capture);
  }
  fs.mkdirSync(OUT, { recursive: true });
  rows.push({ ...r, observed });
  fs.appendFileSync(
    REPORT,
    `| ${r.id} | ${r.name} | **${r.status}** | ${observed} |\n`,
  );
  console.log(`\n[${r.id}] ${r.name}: ${r.status}\n  → ${observed}`);
  if (r.status === "broken" && !options?.allowBroken) {
    expect.soft(false, `${r.id}: ${observed}`).toBe(true);
  }
}

async function skipIfLoggedOut(page: import("@playwright/test").Page) {
  const login = await page
    .getByText(/Sign in to access your dashboard/i)
    .isVisible()
    .catch(() => false);
  if (login) test.skip(true, "auth expired — npx tsx e2e/manual-auth-setup.ts");
}

async function sendTurn(page: import("@playwright/test").Page, message: string) {
  const input = unifiedChatMessageInput(page);
  const footers = page.locator("p.text-violet-600, p.text-violet-400");
  const before = await footers.count();
  await dismissBlockingOverlays(page);
  await input.fill(message);
  await input.press("Enter");
  await waitForChatInputReady(page);
  const after = await footers.count();
  const actionSummary =
    after > before ? ((await footers.nth(after - 1).textContent()) ?? "") : "";
  return {
    canvas: (await page.locator("#workbench-canvas-root").textContent()) ?? "",
    actionSummary,
  };
}

test.describe.configure({ mode: "serial" });

test.describe("More live workbench @manual-live", () => {
  test.beforeAll(() => {
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(
      REPORT,
      `# More live workbench — ${new Date().toISOString()}\n\n| ID | Case | Status | Observed |\n|----|------|--------|----------|\n`,
    );
  });

  test.beforeEach(async ({ page }) => {
    await forceUnifiedChat(page);
  });

  test("@COHI-398 M01 suggested prompts on fresh workbench", async ({ page }) => {
    await openFreshWorkbenchChat(page);
    await skipIfLoggedOut(page);
    const suggestions = page.getByTestId("unified-chat-suggestions");
    const visible = await suggestions.isVisible({ timeout: 8_000 }).catch(() => false);
    if (!visible) {
      await record(page, {
        id: "M01",
        name: "Suggested prompt cards",
        status: "skipped",
        observed: "cards only on empty landing — not shown after prior turns",
      });
      return;
    }
    const count = await suggestions.locator("button").count();
    await record(page, {
      id: "M01",
      name: "Suggested prompt cards",
      status: count > 0 ? "works" : "broken",
      observed: `buttons=${count}`,
    });
  });

  test("@COHI-398 M02 workbench to Chat fork chip", async ({ page }) => {
    await openFreshWorkbenchChat(page);
    await skipIfLoggedOut(page);
    await sendTurn(page, "Show me one MTD funded units number.");
    await dismissBlockingOverlays(page);
    const combobox = page.getByRole("combobox", { name: "Chat type" });
    await combobox.click();
    const listbox = page.getByRole("listbox");
    await expect(listbox).toBeVisible({ timeout: 10_000 });
    const chatOpt = listbox.getByRole("option", { name: "Chat", exact: true });
    if (!(await chatOpt.isVisible().catch(() => false))) {
      await record(page, {
        id: "M02",
        name: "Workbench → Chat fork",
        status: "skipped",
        observed: "Chat option not in dropdown",
      });
      return;
    }
    await chatOpt.click();
    await page.waitForTimeout(2000);
    const fork = await page.getByTestId("conversation-fork-chips").isVisible().catch(() => false);
    const toast = await page.getByText(/fork|branched|new conversation/i).isVisible().catch(() => false);
    await record(page, {
      id: "M02",
      name: "Workbench → Chat fork",
      status: fork || toast ? "works" : "rough",
      observed: `forkChip=${fork} toast=${toast}`,
    });
  });

  test("@COHI-398 M03 share dialog opens", async ({ page }) => {
    await page.setViewportSize({ width: 834, height: 1194 });
    await seedBoardReadyDashboard(page);
    await skipIfLoggedOut(page);
    await page.getByTestId("workbench-share-button").click();
    const dialog = page.getByRole("dialog");
    const open = await dialog.isVisible({ timeout: 10_000 }).catch(() => false);
    const hasShareCopy = await page
      .getByText(/Share canvas|shareable|copy link/i)
      .first()
      .isVisible()
      .catch(() => false);
    if (open) await page.keyboard.press("Escape");
    await record(page, {
      id: "M03",
      name: "Share canvas dialog",
      status: open && hasShareCopy ? "works" : open ? "rough" : "broken",
      observed: `dialog=${open} copy=${hasShareCopy}`,
    });
  });

  test("@COHI-398 M04 edit widget shows Stop editing", async ({ page }) => {
    await seedBoardReadyDashboard(page);
    await skipIfLoggedOut(page);
    await sendTurn(
      page,
      'Add a cohi KPI titled "Units KPI" showing count of funded loans this month.',
    );
    const canvas = page.locator("#workbench-canvas-root");
    const group = canvas.locator(".group\\/widgetgroup").first();
    const editBtn = page.getByRole("button", { name: "Edit with Cohi" }).first();
    await expect(editBtn).toBeVisible({ timeout: 60_000 });
    await assertVisibleAfterHover(page, group, editBtn, "edit with cohi");
    await editBtn.click();
    const editingBanner = page.getByText(/^Editing:/i);
    await expect(editingBanner).toBeVisible({ timeout: 15_000 });
    const stop = page.getByTitle("Stop editing").or(
      editingBanner.locator("..").getByRole("button", { name: /^Stop$/i }),
    );
    const ok = await stop.first().isVisible({ timeout: 5_000 }).catch(() => false);
    if (ok) await stop.click({ force: true });
    await record(page, {
      id: "M04",
      name: "Edit widget → Stop editing",
      status: ok ? "works" : "broken",
      observed: `banner=${await editingBanner.isVisible().catch(() => false)}`,
    });
  });

  test("@COHI-398 M05 maximize widget modal", async ({ page }) => {
    await seedBoardReadyDashboard(page);
    await skipIfLoggedOut(page);
    const canvas = page.locator("#workbench-canvas-root");
    const group = canvas.locator(".group\\/widgetgroup").first();
    const maxBtn = page.getByRole("button", { name: "Maximize widget" }).first();
    await group.scrollIntoViewIfNeeded();
    await assertVisibleAfterHover(page, group, maxBtn, "maximize");
    await maxBtn.click();
    const dialog = page.getByRole("dialog");
    const open = await dialog.isVisible({ timeout: 10_000 }).catch(() => false);
    if (open) await page.keyboard.press("Escape");
    await record(page, {
      id: "M05",
      name: "Maximize widget dialog",
      status: open ? "works" : "broken",
      observed: `dialog=${open}`,
    });
  });

  test("@COHI-398 M06 remove funded volume via chat", async ({ page }) => {
    await seedDeterministicBoard(page);
    await skipIfLoggedOut(page);
    await sendTurn(page, "Remove the funded volume widget from the dashboard.");
    await waitForChatInputReady(page);
    let status: Status = "works";
    let observed = "removed";
    try {
      await expectCanvasMissingWidget(page, /Total Volume|funded volume/i);
    } catch {
      status = "broken";
      observed = "widget still present";
    }
    await record(
      page,
      {
        id: "M06",
        name: "Remove funded volume",
        status,
        observed,
      },
      "Remove the funded volume widget from the dashboard.",
    );
  });

  test("@COHI-398 M07 period switch prior year", async ({ page }) => {
    await seedBoardReadyDashboard(page);
    await skipIfLoggedOut(page);
    const { actionSummary } = await sendTurn(
      page,
      "Switch the dashboard to prior year (last year).",
    );
    const ok = /period|prior|last year|PY|Updated/i.test(actionSummary);
    await record(page, {
      id: "M07",
      name: "PY period switch",
      status: ok ? "works" : "rough",
      observed: actionSummary.slice(0, 100) || "(no footer)",
    });
  });

  test("@COHI-398 M08 analytical question no spurious widgets", async ({ page }) => {
    await seedBoardReadyDashboard(page);
    await skipIfLoggedOut(page);
    const groupsBefore = (
      (await page.locator("#workbench-canvas-root").textContent()) ?? ""
    ).match(/Cohi Dashboard/gi)?.length ?? 0;
    await sendTurn(
      page,
      "Why is funded volume lower this month than last month?",
    );
    const canvas = (await page.locator("#workbench-canvas-root").textContent()) ?? "";
    const groupsAfter = canvas.match(/Cohi Dashboard/gi)?.length ?? 0;
    const noExtraGroup = groupsAfter <= groupsBefore + 1;
    const answered = /because|driver|lower|volume|month/i.test(
      `${canvas} ${(await page.getByTestId("cohi-chat-panel").textContent()) ?? ""}`,
    );
    await record(page, {
      id: "M08",
      name: "Analytical why — no extra build",
      status: noExtraGroup && answered ? "works" : noExtraGroup ? "rough" : "broken",
      observed: `groups ${groupsBefore}→${groupsAfter} answered=${answered}`,
    });
  });

  test("@COHI-398 M09 rename dashboard group section title", async ({ page }) => {
    await seedBoardReadyDashboard(page);
    await skipIfLoggedOut(page);
    await sendTurn(page, 'Rename the dashboard group title to "Board KPIs".');
    const canvas = (await page.locator("#workbench-canvas-root").textContent()) ?? "";
    const ok = /Board KPIs/i.test(canvas);
    await record(page, {
      id: "M09",
      name: "Rename group title",
      status: ok ? "works" : "rough",
      observed: `boardKpis=${ok}`,
    });
  });

  test("@COHI-398 M10 switch to Research chat type", async ({ page }) => {
    await openFreshWorkbenchChat(page);
    await skipIfLoggedOut(page);
    await selectUnifiedChatType(page, "Research");
    const workspace = await page
      .getByTestId("unified-research-workspace")
      .isVisible()
      .catch(() => false);
    const researchPlaceholder = await page
      .getByPlaceholder(/research|dataset|analyze/i)
      .first()
      .isVisible()
      .catch(() => false);
    const inputOk = await unifiedChatMessageInput(page).isEnabled().catch(() => false);
    await record(page, {
      id: "M10",
      name: "Research chat type",
      status: workspace || researchPlaceholder || inputOk ? "works" : "rough",
      observed: `workspace=${workspace} placeholder=${researchPlaceholder}`,
    });
  });

  test("@COHI-398 M11 PowerPoint editor opens", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await seedBoardReadyDashboard(page);
    await skipIfLoggedOut(page);
    const ppt = page
      .getByRole("button", { name: /PowerPoint Editor/i })
      .or(page.getByTitle(/PowerPoint deck/i));
    const pptVisible = await ppt.first().isVisible({ timeout: 10_000 }).catch(() => false);
    if (!pptVisible) {
      await record(page, {
        id: "M11",
        name: "PowerPoint editor entry",
        status: "skipped",
        observed: "PPT toolbar button not visible",
      });
      return;
    }
    await ppt.first().click();
    const slidePanel = page.getByText(/Slides \(\d+\)/);
    const builder = await slidePanel.isVisible({ timeout: 15_000 }).catch(() => false);
    if (builder) {
      const closeBtn = page.getByRole("button", { name: /Back to Canvas/i });
      await closeBtn.first().click({ timeout: 5_000 }).catch(() => page.keyboard.press("Escape"));
    }
    await record(
      page,
      {
        id: "M11",
        name: "PowerPoint editor entry",
        status: builder ? "works" : "broken",
        observed: `reportBuilder=${builder}`,
      },
      "PowerPoint Editor",
    );
  });

  test("@COHI-398 M12 pull-through remove and re-add regression", async ({ page }) => {
    await seedBoardReadyDashboard(page);
    await skipIfLoggedOut(page);
    await sendTurn(page, "Remove the pull-through rate widget from the dashboard.");
    const afterRemove = (await page.locator("#workbench-canvas-root").textContent()) ?? "";
    const gone = !/pull[- ]?through/i.test(afterRemove);
    await sendTurn(page, "Add pull-through rate back to the dashboard.");
    await waitForWorkbenchCanvasPopulated(page, { timeoutMs: 120_000 }).catch(() => {});
    const afterAdd = (await page.locator("#workbench-canvas-root").textContent()) ?? "";
    const back = /pull[- ]?through/i.test(afterAdd);
    await record(page, {
      id: "M12",
      name: "Pull-through remove + re-add",
      status: gone && back ? "works" : gone ? "rough" : "broken",
      observed: `removed=${gone} readded=${back}`,
    });
  });

  test("@COHI-398 M13 insight builder type switch", async ({ page }) => {
    await openFreshWorkbenchChat(page);
    await skipIfLoggedOut(page);
    await sendTurn(page, "What KPIs matter for pipeline conversion?");
    await dismissBlockingOverlays(page);
    const combobox = page.getByRole("combobox", { name: "Chat type" });
    await combobox.click();
    const listbox = page.getByRole("listbox");
    await expect(listbox).toBeVisible({ timeout: 10_000 });
    const ib = listbox.getByRole("option", { name: "Insight builder", exact: true });
    if (!(await ib.isVisible().catch(() => false))) {
      await record(page, {
        id: "M13",
        name: "Insight builder switch",
        status: "skipped",
        observed: "option not visible",
      });
      return;
    }
    await ib.click();
    await page.waitForTimeout(2500);
    const fork = await page.getByTestId("conversation-fork-chips").isVisible().catch(() => false);
    await record(page, {
      id: "M13",
      name: "Insight builder switch",
      status: fork ? "works" : "rough",
      observed: `fork=${fork}`,
    });
  });

  test("@COHI-398 M14 cohi chat panel in split insights", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoWithUnifiedChatShell(page, "/insights", { timeout: 60_000 });
    await skipIfLoggedOut(page);
    await page.getByRole("button", { name: "Split", exact: true }).click({ force: true });
    await page.waitForTimeout(400);
    const panel = page.getByTestId("cohi-chat-panel");
    const shell = page.getByTestId("unified-chat-shell");
    const ok = (await panel.isVisible().catch(() => false)) || (await shell.isVisible());
    await record(page, {
      id: "M14",
      name: "Chat panel in insights split",
      status: ok ? "works" : "broken",
      observed: `panel=${await panel.isVisible().catch(() => false)} shell=${await shell.isVisible()}`,
    });
  });

  test("@COHI-398 M16 remove funded units registry widget", async ({ page }) => {
    await seedBoardReadyDashboard(page);
    await skipIfLoggedOut(page);
    await sendTurn(page, "Remove the funded units widget from the dashboard.");
    const canvas = (await page.locator("#workbench-canvas-root").textContent()) ?? "";
    const gone = !/Total Units|Funded Units/i.test(canvas);
    await record(page, {
      id: "M16",
      name: "Remove funded units",
      status: gone ? "works" : "broken",
      observed: `gone=${gone}`,
    });
  });

  test("@COHI-398 M17 chart type line via chat", async ({ page }) => {
    await seedDeterministicBoard(page);
    await skipIfLoggedOut(page);
    await sendTurn(page, "Change pull-through by branch chart to a line chart.");
    await waitForChatInputReady(page);
    let status: Status = "works";
    let observed = "line chart";
    try {
      await expect
        .poll(
          async () =>
            page.evaluate(() => {
              const root = document.getElementById("workbench-canvas-root");
              if (!root) return 0;
              const lineAttr = root.querySelectorAll(
                '[data-widget-title*="Pull-Through by Branch" i][data-chart-type="line"]',
              ).length;
              if (lineAttr > 0) return 1;
              return root.querySelectorAll(".recharts-line-curve").length;
            }),
          { timeout: 90_000, intervals: [1000, 2000, 3000] },
        )
        .toBeGreaterThan(0);
    } catch {
      status = "broken";
      observed = "line chart not visible";
    }
    await record(
      page,
      {
        id: "M17",
        name: "Chart type line",
        status,
        observed,
      },
      "Change pull-through by branch chart to a line chart.",
    );
  });

  test("@COHI-398 M18 duplicate widget toolbar", async ({ page }) => {
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
      id: "M18",
      name: "Duplicate widget",
      status: countAfter > countBefore ? "works" : "rough",
      observed: `widgets ${countBefore}→${countAfter}`,
    });
  });

  test("@COHI-398 M19 workbench chat type card visible on landing", async ({ page }) => {
    await openFreshWorkbenchChat(page);
    await skipIfLoggedOut(page);
    const card = page.getByText("Workbench", { exact: true }).first();
    const visible = await card.isVisible().catch(() => false);
    await record(page, {
      id: "M19",
      name: "Workbench prompt card",
      status: visible ? "works" : "rough",
      observed: `card=${visible}`,
    });
  });

  test("@COHI-398 M20 set_widget_title via chat on pull-through", async ({ page }) => {
    await seedBoardReadyDashboard(page);
    await skipIfLoggedOut(page);
    await sendTurn(page, 'Rename pull-through widget title to "PT %".');
    const canvas = (await page.locator("#workbench-canvas-root").textContent()) ?? "";
    const ok = /PT\s*%|PT %/i.test(canvas);
    await record(page, {
      id: "M20",
      name: "Rename pull-through title",
      status: ok ? "works" : "broken",
      observed: `ptTitle=${ok}`,
    });
  });

  test("@COHI-398 M21 all-time KPI period via chat", async ({ page }) => {
    await seedDeterministicBoard(page);
    await skipIfLoggedOut(page);
    await sendTurn(page, "Show funded volume as an all-time KPI.");
    await waitForChatInputReady(page);
    let status: Status = "works";
    let observed = "all-time widget present";
    try {
      await expectCanvasHasWidget(page, /^All-time Funded Volume$/i, {
        timeoutMs: 90_000,
      });
      const allTimeWidget = page.locator('[data-widget-title="All-time Funded Volume"]').first();
      await expect(allTimeWidget).toHaveAttribute("data-filterable", "false", {
        timeout: 15_000,
      });
    } catch {
      status = "broken";
      observed = "missing All-time Funded Volume or filterable not false";
    }
    await record(
      page,
      {
        id: "M21",
        name: "All-time KPI",
        status,
        observed,
      },
      "Show funded volume as an all-time KPI.",
    );
  });

  test("@COHI-398 M22 remove pull-through only", async ({ page }) => {
    await seedDeterministicBoard(page);
    await skipIfLoggedOut(page);
    await sendTurn(page, "Remove the pull-through rate widget from the dashboard.");
    await waitForChatInputReady(page);
    let status: Status = "works";
    let observed = "removed";
    try {
      await expectCanvasMissingWidget(page, /^Pull-Through Rate$/i);
      await expectCanvasHasWidget(page, /Pull-Through by Branch/i, {
        timeoutMs: 15_000,
      });
    } catch {
      status = "broken";
      observed = "pull-through rate still present or branch chart missing";
    }
    await record(
      page,
      {
        id: "M22",
        name: "Remove pull-through",
        status,
        observed,
      },
      "Remove the pull-through rate widget from the dashboard.",
    );
  });

  test("@COHI-398 M23 WAC KPI on board-ready canvas", async ({ page }) => {
    await seedBoardReadyDashboard(page);
    await skipIfLoggedOut(page);
    const { actionSummary } = await sendTurn(
      page,
      "Add weighted average coupon WAC widget to the dashboard.",
    );
    await waitForChatInputReady(page);
    let ok = false;
    try {
      await expect
        .poll(
          async () => {
            const canvas =
              (await page.locator("#workbench-canvas-root").textContent()) ?? "";
            return /\bWAC\b|weighted average coupon|Weighted Avg Coupon/i.test(
              canvas,
            );
          },
          { timeout: 60_000, intervals: [2000, 3000] },
        )
        .toBe(true);
      ok = true;
    } catch {
      ok = /\bWAC\b|weighted average coupon|Weighted Avg Coupon/i.test(actionSummary);
    }
    await record(
      page,
      {
        id: "M23",
        name: "WAC on board-ready",
        status: ok ? "works" : "broken",
        observed: `wac=${ok}`,
      },
      "Add weighted average coupon WAC widget to the dashboard.",
    );
  });

  test("@COHI-398 M24 switch chart to bar via chat", async ({ page }) => {
    await seedDeterministicBoard(page);
    await skipIfLoggedOut(page);
    await sendTurn(page, "Change pull-through by branch chart to a bar chart.");
    await waitForChatInputReady(page);
    let status: Status = "works";
    let observed = "bar chart";
    try {
      await expect
        .poll(
          async () =>
            page.evaluate(() => {
              const root = document.getElementById("workbench-canvas-root");
              if (!root) return 0;
              const barAttr = root.querySelectorAll(
                '[data-widget-title*="Pull-Through by Branch" i][data-chart-type="bar"]',
              ).length;
              if (barAttr > 0) return 1;
              return root.querySelectorAll(".recharts-bar-rectangle").length;
            }),
          { timeout: 90_000, intervals: [1000, 2000, 3000] },
        )
        .toBeGreaterThan(0);
    } catch {
      status = "broken";
      observed = "bar chart not visible";
    }
    await record(
      page,
      {
        id: "M24",
        name: "Chart type bar",
        status,
        observed,
      },
      "Change pull-through by branch chart to a bar chart.",
    );
  });

  test("@COHI-398 M25 readonly share link banner", async ({ page }) => {
    await record(page, {
      id: "M25",
      name: "Share dialog (duplicate)",
      status: "skipped",
      observed: "covered by M03",
    });
  });

  test("@COHI-398 M15 widget group collapse after resize", async ({ page }) => {
    await seedBoardReadyDashboard(page);
    await skipIfLoggedOut(page);
    await page.setViewportSize({ width: 1050, height: 800 });
    await page.waitForTimeout(400);
    await page.setViewportSize({ width: 1280, height: 800 });
    const toggle = widgetGroupCollapseToggle(page);
    await expect(toggle).toBeVisible({ timeout: 20_000 });
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-label", "Expand group");
    await record(page, {
      id: "M15",
      name: "Collapse after mobile→desktop resize",
      status: "works",
      observed: "toggle ok",
    });
  });

  test("@COHI-398 M26 tab switch prompts to switch chat scope", async ({ page }) => {
    await forceWorkbenchChatScopeSync(page);
    await skipIfLoggedOut(page);
    let status: Status = "works";
    let observed = "";
    try {
      const canvasA = await seedDeterministicBoard(page);
      await selectUnifiedChatType(page, "Workbench");
      await sendTurn(page, "Summarize this board in one sentence.");
      await expect(page.getByTestId("workbench-chat-scope-chip")).toBeVisible({
        timeout: 60_000,
      });
      const persistedAfterA = await page.evaluate(() =>
        sessionStorage.getItem("cohi_workbench_conversation_scope"),
      );
      if (!persistedAfterA) {
        throw new Error("conversation scope not persisted after chat on canvas A");
      }
      const canvasB = await seedAdditionalDeterministicBoard(page);
      expect(canvasB).not.toBe(canvasA);
      await selectUnifiedChatType(page, "Workbench");
      const dialog = page.getByTestId("workbench-scope-switch-dialog");
      await expect(dialog).toBeVisible({ timeout: 45_000 });
      await dialog.getByRole("button", { name: "Keep current chat" }).click();
      await expect(page.getByTestId("workbench-chat-scope-pinned-banner")).toBeVisible({
        timeout: 10_000,
      });
      observed = "canvas B load → scope dialog → pinned banner";
    } catch (e) {
      status = "broken";
      observed = e instanceof Error ? e.message : String(e);
    }
    await record(page, {
      id: "M26",
      name: "Tab switch scope prompt",
      status,
      observed,
    });
  });

  test("@COHI-398 M27 new canvas intent confirm dialog", async ({ page }) => {
    await forceWorkbenchChatScopeSync(page);
    await skipIfLoggedOut(page);
    let status: Status = "works";
    let observed = "";
    try {
      await seedDeterministicBoard(page);
      const input = unifiedChatMessageInput(page);
      await input.fill("Add a sales chart on a new canvas");
      await input.press("Enter");
      const dialog = page.getByTestId("workbench-new-canvas-intent-dialog");
      await expect(dialog).toBeVisible({ timeout: 10_000 });
      await dialog.getByRole("button", { name: "Use current canvas" }).click();
      observed = "new-canvas intent dialog shown; continued on current canvas";
    } catch (e) {
      status = "broken";
      observed = e instanceof Error ? e.message : String(e);
    }
    await record(page, {
      id: "M27",
      name: "New canvas intent confirm",
      status,
      observed,
    });
  });

  test("@COHI-398 M28 workbench chat scope chip visible", async ({ page }) => {
    await forceWorkbenchChatScopeSync(page);
    await skipIfLoggedOut(page);
    let status: Status = "works";
    let observed = "";
    try {
      await seedDeterministicBoard(page);
      await sendTurn(page, "What widgets are on this board?");
      const chip = page.getByTestId("workbench-chat-scope-chip");
      await expect(chip).toBeVisible({ timeout: 15_000 });
      observed = (await chip.textContent()) ?? "chip visible";
    } catch (e) {
      status = "broken";
      observed = e instanceof Error ? e.message : String(e);
    }
    await record(page, {
      id: "M28",
      name: "Chat scope chip",
      status,
      observed,
    });
  });
});

