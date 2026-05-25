/**
 * Varied live workbench use cases — real account, real LLM.
 * Run: $env:MANUAL_AUTH_SKIP_REFRESH="1"; npx playwright test e2e/manual/workbench-varied-live.spec.ts --config=playwright.manual-live.config.ts
 */
import fs from "fs";
import path from "path";
import { test, expect } from "@playwright/test";
import {
  dismissBlockingOverlays,
  forceUnifiedChat,
  selectUnifiedChatType,
  unifiedChatMessageInput,
} from "../helpers/unifiedChat";
import {
  openFreshWorkbenchChat,
  seedBoardReadyDashboard,
  waitForChatInputReady,
  waitForWorkbenchCanvasPopulated,
} from "../helpers/workbenchLive";

const OUT = path.join("test-results", "varied-live");
const REPORT = path.join(OUT, "REPORT.md");

type Status = "works" | "broken" | "rough";

type Row = {
  id: string;
  name: string;
  status: Status;
  observed: string;
  improvements: string[];
};

const rows: Row[] = [];

function record(r: Row) {
  rows.push(r);
  fs.appendFileSync(
    REPORT,
    `| ${r.id} | ${r.name} | **${r.status}** | ${r.observed.replace(/\|/g, "/")} | ${r.improvements.join("; ") || "—"} |\n`,
  );
  console.log(`\n[${r.id}] ${r.name}: ${r.status}\n  → ${r.observed}`);
}

async function sendWorkbenchTurn(page: import("@playwright/test").Page, message: string) {
  const input = unifiedChatMessageInput(page);
  const footers = page.locator("p.text-violet-600, p.text-violet-400");
  const footersBefore = await footers.count();
  await dismissBlockingOverlays(page);
  await input.fill(message);
  await input.press("Enter");
  await waitForChatInputReady(page);
  const footersAfter = await footers.count();
  const actionSummary =
    footersAfter > footersBefore
      ? ((await footers.nth(footersAfter - 1).textContent()) ?? "")
      : "";
  return {
    main: (await page.locator("main").textContent()) ?? "",
    canvas: (await page.locator("#workbench-canvas-root").textContent()) ?? "",
    actionSummary,
  };
}

function countDashboardGroups(canvas: string): number {
  return (canvas.match(/Cohi Dashboard|Executive Dashboard/gi) ?? []).length;
}

test.describe.configure({ mode: "serial" });

test.describe("Varied live workbench @manual-live", () => {
  test.beforeAll(() => {
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(
      REPORT,
      `# Varied live workbench — ${new Date().toISOString()}\n\n| ID | Case | Status | Observed | Improvements |\n|----|------|--------|----------|-------------|\n`,
    );
  });

  test.beforeEach(async ({ page }) => {
    await forceUnifiedChat(page);
  });

  // --- Gap fixes (must pass after server reconcile) ---
  test("@COHI-398 V01 period YTD no widget recreate", async ({ page }) => {
    await seedBoardReadyDashboard(page);
    const { actionSummary } = await sendWorkbenchTurn(
      page,
      "Switch the whole dashboard to year-to-date.",
    );
    const periodOnly = /Updated dashboard period/i.test(actionSummary);
    const recreated = /Applied \d+ widgets/i.test(actionSummary);
    record({
      id: "V01",
      name: "Period → YTD (no recreate)",
      status: periodOnly && !recreated ? "works" : recreated ? "broken" : "rough",
      observed: `summary="${actionSummary.trim()}"`,
      improvements: recreated
        ? ["Server augmentPeriodSwitchActions must strip create_widget"]
        : !periodOnly
          ? ["Chat should say Updated dashboard period"]
          : [],
    });
    await page.screenshot({ path: path.join(OUT, "V01-ytd.png"), fullPage: true });
  });

  test("@COHI-398 V02 period back to MTD", async ({ page }) => {
    await seedBoardReadyDashboard(page);
    await sendWorkbenchTurn(page, "Switch the whole dashboard to year-to-date.");
    const { actionSummary } = await sendWorkbenchTurn(
      page,
      "Now switch the whole dashboard back to month-to-date.",
    );
    const ok =
      /Updated dashboard period/i.test(actionSummary) &&
      !/Applied \d+ widgets/i.test(actionSummary);
    record({
      id: "V02",
      name: "Period YTD then MTD",
      status: ok ? "works" : "rough",
      observed: `summary="${actionSummary.trim()}"`,
      improvements: ok ? [] : ["Round-trip period switches should stay modify_group only"],
    });
  });

  test("@COHI-398 V03 all-time KPI no date filter", async ({ page }) => {
    await seedBoardReadyDashboard(page);
    const sqlWithFilter: string[] = [];
    const sqlWithoutFilter: string[] = [];
    page.on("request", (req) => {
      if (req.method() !== "POST" || !/\/api\/cohi-chat\/execute-sql/.test(req.url())) return;
      try {
        const body = req.postDataJSON() as { dateFilter?: { start?: string } };
        if (body?.dateFilter?.start) sqlWithFilter.push(body.dateFilter.start);
        else sqlWithoutFilter.push("none");
      } catch {
        /* ignore */
      }
    });
    const { main, canvas } = await sendWorkbenchTurn(
      page,
      "Add one KPI for total funded loans all time, no period in the title.",
    );
    await page.waitForTimeout(3000);
    const titleBad = /\bMTD\b/i.test(canvas) && /total funded/i.test(canvas);
    record({
      id: "V03",
      name: "All-time KPI SQL scope",
      status:
        sqlWithoutFilter.length > 0 && !titleBad ? "works" : sqlWithFilter.length > 0 ? "broken" : "rough",
      observed: `noFilterExec=${sqlWithoutFilter.length} withFilter=${sqlWithFilter.length} titleMTD=${titleBad}`,
      improvements:
        sqlWithFilter.length > 0
          ? ["filterable:false on all-time widget"]
          : titleBad
            ? ["Strip period from all-time titles"]
            : [],
    });
    await page.screenshot({ path: path.join(OUT, "V03-alltime.png"), fullPage: true });
  });

  test("@COHI-398 V04 all-time KPI in same group", async ({ page }) => {
    await seedBoardReadyDashboard(page);
    const before = countDashboardGroups(
      (await page.locator("#workbench-canvas-root").textContent()) ?? "",
    );
    await sendWorkbenchTurn(
      page,
      "Add one KPI for total funded loans all time, no period in the title.",
    );
    await page.waitForTimeout(2000);
    const canvas = (await page.locator("#workbench-canvas-root").textContent()) ?? "";
    const after = countDashboardGroups(canvas);
    const hasAllTime = /total funded|all[- ]?time/i.test(canvas);
    record({
      id: "V04",
      name: "All-time in existing group",
      status: hasAllTime && after <= before + 1 ? "works" : "rough",
      observed: `groups before=${before} after=${after} hasAllTime=${hasAllTime}`,
      improvements:
        after > before + 1
          ? ["Prefer modify_group add_cohi over new standalone group"]
          : !hasAllTime
            ? ["Widget label should mention total funded"]
            : [],
    });
  });

  // --- Varied product use cases ---
  test("@COHI-398 V05 last six months build", async ({ page }) => {
    await openFreshWorkbenchChat(page);
    const { main, canvas } = await sendWorkbenchTurn(
      page,
      "Show me funded volume for the last six months as a line chart.",
    );
    const built = /Funded|volume|Applied|widget/i.test(`@COHI-398 ${main} ${canvas}`);
    record({
      id: "V05",
      name: "L6M line chart build",
      status: built ? "works" : "rough",
      observed: built ? "Built chart or widgets for L6M" : "No clear build",
      improvements: [],
    });
  });

  test("@COHI-398 V06 rename widget in group", async ({ page }) => {
    await seedBoardReadyDashboard(page);
    const { main } = await sendWorkbenchTurn(
      page,
      'Rename the funded units widget to "Closed Units MTD".',
    );
    const ok = /Renamed|Updated|title/i.test(main);
    const canvas = (await page.locator("#workbench-canvas-root").textContent()) ?? "";
    const onCanvas = /Closed Units/i.test(canvas);
    record({
      id: "V06",
      name: "Rename widget in group",
      status: ok && onCanvas ? "works" : ok ? "rough" : "broken",
      observed: `chatAck=${ok} canvas=${onCanvas}`,
      improvements: !onCanvas ? ["set_widget_title should reflect on canvas immediately"] : [],
    });
  });

  test("@COHI-398 V07 analytical question no spurious build", async ({ page }) => {
    await seedBoardReadyDashboard(page);
    const widgetsBefore = await page
      .locator("#workbench-canvas-root")
      .getByRole("heading")
      .count()
      .catch(() => 0);
    const { actionSummary, main } = await sendWorkbenchTurn(
      page,
      "Why is pull-through lower this month than last month?",
    );
    await page.waitForTimeout(1500);
    const widgetsAfter = await page
      .locator("#workbench-canvas-root")
      .getByRole("heading")
      .count()
      .catch(() => 0);
    const footerBuild = /Applied \d+ widgets/i.test(actionSummary);
    const canvasGrew = widgetsAfter > widgetsBefore + 1;
    const ok = !footerBuild && !canvasGrew;
    record({
      id: "V07",
      name: "Analytical Q on populated canvas",
      status: ok ? "works" : "rough",
      observed: `footerBuild=${footerBuild} canvasGrew=${canvasGrew} headings ${widgetsBefore}→${widgetsAfter}`,
      improvements: canvasGrew
        ? ["Do not deliver create_widget on analytical-only turns"]
        : footerBuild
          ? ["Action footer should reflect gated actions only"]
          : [],
    });
  });

  test("@COHI-398 V08 stacked bar chart request", async ({ page }) => {
    await seedBoardReadyDashboard(page);
    const { main } = await sendWorkbenchTurn(
      page,
      "Change the funded volume widget to a stacked bar chart by loan type.",
    );
    const bad = /Wrong widget|No changes applied/i.test(main);
    const ok = /stacked|bar|Updated|modify/i.test(main) && !bad;
    record({
      id: "V08",
      name: "Stacked bar via chat",
      status: bad ? "broken" : ok ? "works" : "rough",
      observed: bad ? "Wrong widget / no changes" : main.slice(0, 100),
      improvements: [],
    });
  });

  test("@COHI-398 V09 fork to Research mid-thread", async ({ page }) => {
    await openFreshWorkbenchChat(page);
    await sendWorkbenchTurn(page, "Build funded units MTD only — one KPI.");
    await dismissBlockingOverlays(page);
    const combobox = page.getByRole("combobox", { name: "Chat type" });
    await combobox.click();
    const listbox = page.getByRole("listbox");
    await expect(listbox).toBeVisible({ timeout: 10_000 });
    const research = listbox.getByRole("option", { name: "Research", exact: true });
    const hasResearch = await research.isVisible().catch(() => false);
    if (hasResearch) await research.click();
    await page.waitForTimeout(2500);
    const fork =
      (await page.getByTestId("conversation-fork-chips").isVisible().catch(() => false)) ||
      (await page
        .getByText(/Started a new.*Research|carried over/i)
        .first()
        .isVisible()
        .catch(() => false));
    record({
      id: "V09",
      name: "Fork Workbench → Research",
      status: hasResearch && fork ? "works" : !hasResearch ? "broken" : "rough",
      observed: `researchOpt=${hasResearch} fork=${fork}`,
      improvements: !fork ? ["Fork toast/chip on Research switch"] : [],
    });
  });

  test("@COHI-398 V10 deck after period change", async ({ page }) => {
    await seedBoardReadyDashboard(page);
    await sendWorkbenchTurn(page, "Switch the whole dashboard to year-to-date.");
    const { main } = await sendWorkbenchTurn(
      page,
      "Export this dashboard as a deck for the board meeting.",
    );
    const bad = /need the live|share live values/i.test(main);
    const ok = /deck|presentation|report|slide/i.test(main) && !bad;
    record({
      id: "V10",
      name: "Deck after YTD switch",
      status: bad ? "broken" : ok ? "works" : "rough",
      observed: bad ? "Asked for live values" : ok ? "Deck intent recognized" : main.slice(0, 80),
      improvements: [],
    });
  });

  test("@COHI-398 V11 add branch table to group", async ({ page }) => {
    await seedBoardReadyDashboard(page);
    const { main, canvas } = await sendWorkbenchTurn(
      page,
      "Add a table showing funded volume by branch for the current dashboard period.",
    );
    const added = /table|branch|Added|Applied|modify_group/i.test(`@COHI-398 ${main} ${canvas}`);
    record({
      id: "V11",
      name: "Add branch table in group",
      status: added ? "works" : "rough",
      observed: added ? "Table/branch mentioned in response or canvas" : "Unclear add",
      improvements: [],
    });
  });

  test("@COHI-398 V12 empty canvas last quarter", async ({ page }) => {
    await openFreshWorkbenchChat(page);
    const { main, canvas } = await sendWorkbenchTurn(
      page,
      "Build a dashboard for last quarter performance.",
    );
    const built = /widget|Applied|Funded|dashboard/i.test(`@COHI-398 ${main} ${canvas}`);
    const clarify = /which period|clarif/i.test(main);
    record({
      id: "V12",
      name: "Empty canvas last quarter",
      status: built && !clarify ? "works" : clarify ? "rough" : "broken",
      observed: built ? "Built for last quarter" : clarify ? "Asked clarify" : "No build",
      improvements: clarify ? ["Map last quarter to L3M or calendar Q without asking"] : [],
    });
  });

  test("@COHI-398 V13 triple turn build YTD all-time", async ({ page }) => {
    await openFreshWorkbenchChat(page);
    await sendWorkbenchTurn(page, "Build a small MTD dashboard: funded units and funded volume only.");
    await waitForWorkbenchCanvasPopulated(page, { timeoutMs: 180_000 }).catch(() => {});
    await sendWorkbenchTurn(page, "Switch the whole dashboard to year-to-date.");
    const { actionSummary, main } = await sendWorkbenchTurn(
      page,
      "Add one all-time total funded loans KPI to this dashboard.",
    );
    const ytdOk = !/Applied \d+ widgets/i.test(actionSummary);
    const allTime = /all[- ]?time|total funded/i.test(`@COHI-398 ${actionSummary} ${main}`);
    record({
      id: "V13",
      name: "Build → YTD → all-time KPI",
      status: ytdOk && allTime ? "works" : "rough",
      observed: `noRecreate=${ytdOk} allTimeAck=${allTime}`,
      improvements: [],
    });
  });

  test("@COHI-398 V14 remove then undo via chat add", async ({ page }) => {
    await seedBoardReadyDashboard(page);
    await sendWorkbenchTurn(page, "Remove the pull-through rate widget from the dashboard.");
    const canvasAfterRemove = (await page.locator("#workbench-canvas-root").textContent()) ?? "";
    const gone = !/pull[- ]?through/i.test(canvasAfterRemove);
    const { main } = await sendWorkbenchTurn(
      page,
      "Add pull-through rate back to the dashboard.",
    );
    const back = /pull[- ]?through|Added|Applied/i.test(`@COHI-398 ${main} ${await page.locator("#workbench-canvas-root").textContent()}`);
    record({
      id: "V14",
      name: "Remove then re-add widget",
      status: gone && back ? "works" : gone ? "rough" : "broken",
      observed: `removed=${gone} readded=${back}`,
      improvements: !back ? ["add_registry or add_cohi for pull-through restore"] : [],
    });
  });

  test("@COHI-398 V15 insight builder switch", async ({ page }) => {
    await openFreshWorkbenchChat(page);
    await sendWorkbenchTurn(page, "What KPIs should I track for pipeline health?");
    await dismissBlockingOverlays(page);
    const combobox = page.getByRole("combobox", { name: "Chat type" });
    await combobox.click();
    const listbox = page.getByRole("listbox");
    await expect(listbox).toBeVisible({ timeout: 10_000 });
    const ib = listbox.getByRole("option", { name: "Insight builder", exact: true });
    const visible = await ib.isVisible().catch(() => false);
    if (visible) await ib.click();
    await page.waitForTimeout(2000);
    const fork = await page
      .getByText(/Started a new|carried over/i)
      .first()
      .isVisible()
      .catch(() => false);
    record({
      id: "V15",
      name: "Fork Workbench → Insight builder",
      status: visible && fork ? "works" : visible ? "rough" : "broken",
      observed: `ibVisible=${visible} fork=${fork}`,
      improvements: [],
    });
  });

  test.afterAll(() => {
    const works = rows.filter((r) => r.status === "works").length;
    const rough = rows.filter((r) => r.status === "rough").length;
    const broken = rows.filter((r) => r.status === "broken").length;
    fs.appendFileSync(
      REPORT,
      `\n## Summary\n\n- **Works:** ${works}/${rows.length}\n- **Rough:** ${rough}/${rows.length}\n- **Broken:** ${broken}/${rows.length}\n`,
    );
  });
});

