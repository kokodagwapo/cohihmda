/**
 * 15 live workbench/chat scenarios using existing e2e/.auth/user.json.
 * Run: npx playwright test --config=playwright.manual-live.config.ts
 */
import fs from "fs";
import path from "path";
import { test, expect } from "@playwright/test";
import {
  dismissBlockingOverlays,
  forceUnifiedChat,
  gotoWithUnifiedChatShell,
  selectUnifiedChatType,
  unifiedChatMessageInput,
} from "../helpers/unifiedChat";
import {
  BOARD_READY_PROMPT,
  openFreshWorkbenchChat,
  seedBoardReadyDashboard,
  waitForChatInputReady,
  waitForWorkbenchCanvasPopulated,
} from "../helpers/workbenchLive";

const OUT = path.join("test-results", "manual-15");
const REPORT = path.join(OUT, "REPORT.md");

type Status = "works" | "broken" | "rough";

type ScenarioResult = {
  n: number;
  name: string;
  status: Status;
  observed: string;
  improvements: string[];
};

const results: ScenarioResult[] = [];

function record(r: ScenarioResult) {
  results.push(r);
  const line = `| ${r.n} | ${r.name} | **${r.status}** | ${r.observed.replace(/\|/g, "/")} | ${r.improvements.join("; ") || "—"} |`;
  fs.appendFileSync(REPORT, `${line}\n`);
  console.log(`\n[${r.n}] ${r.name}: ${r.status}\n  → ${r.observed}`);
  if (r.improvements.length) console.log(`  ↑ ${r.improvements.join("; ")}`);
}

test.describe.configure({ mode: "serial" });

test.describe("15 live UX scenarios @manual-live", () => {
  test.beforeAll(() => {
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(
      REPORT,
      `# Manual live UX — 15 scenarios\n\nRun: ${new Date().toISOString()}\n\n| # | Scenario | Status | Observed | Improvements |\n|---|----------|--------|----------|-------------|\n`,
    );
  });

  test.beforeEach(async ({ page }) => {
    await forceUnifiedChat(page);
  });

  test("@COHI-398 01 board-ready MTD on empty canvas", async ({ page }) => {
    await openFreshWorkbenchChat(page);
    const input = unifiedChatMessageInput(page);
    await input.fill("Build a board-ready dashboard for this month.");
    await input.press("Enter");
    await waitForWorkbenchCanvasPopulated(page, { timeoutMs: 240_000 });
    await waitForChatInputReady(page);

    const main = (await page.locator("main").textContent()) ?? "";
    const canvas = (await page.locator("#workbench-canvas-root").textContent()) ?? "";
    const askedClarify = /dashboard or presentation|which would you prefer/i.test(main);
    const hasWidgets = /Funded|Pull-Through|Executive|Applied \d+ widget/i.test(
      `${main} ${canvas}`,
    );

    record({
      n: 1,
      name: "Board-ready MTD (empty canvas)",
      status: askedClarify ? "rough" : hasWidgets ? "works" : "broken",
      observed: askedClarify
        ? "Asked dashboard vs presentation instead of building"
        : hasWidgets
          ? "Canvas populated with executive-style widgets"
          : "No clear widgets after long wait",
      improvements: askedClarify
        ? ["Default intent should auto-build MTD dashboard without clarifying question"]
        : !hasWidgets
          ? ["Empty canvas → board-ready should always emit create_widget/create_dashboard"]
          : [],
    });
    await page.screenshot({ path: path.join(OUT, "01-board-ready.png"), fullPage: true });
  });

  test("@COHI-398 02 loose phrasing this month", async ({ page }) => {
    await openFreshWorkbenchChat(page);
    const input = unifiedChatMessageInput(page);
    await input.fill("Show me how we are doing this month.");
    await input.press("Enter");
    await waitForChatInputReady(page);

    const text = `${await page.locator("main").textContent()} ${await page.locator("#workbench-canvas-root").textContent()}`;
    const built = /Funded|widget|dashboard|Applied/i.test(text);

    record({
      n: 2,
      name: "Loose phrasing — this month",
      status: built ? "works" : "rough",
      observed: built ? "Responded with dashboard/widgets" : "Answered without clear canvas build",
      improvements: built ? [] : ["Treat informal month phrasing same as board-ready MTD"],
    });
    await page.screenshot({ path: path.join(OUT, "02-this-month.png"), fullPage: true });
  });

  test("@COHI-398 03 executive overview", async ({ page }) => {
    await openFreshWorkbenchChat(page);
    const input = unifiedChatMessageInput(page);
    await input.fill("Give me an executive overview.");
    await input.press("Enter");
    await waitForChatInputReady(page);

    const text = `${await page.locator("main").textContent()} ${await page.locator("#workbench-canvas-root").textContent()}`;
    const built = /Funded|Executive|widget|Applied/i.test(text);

    record({
      n: 3,
      name: "Executive overview",
      status: built ? "works" : "rough",
      observed: built ? "Built or summarized executive view" : "Text-only or unclear build",
      improvements: built ? [] : ["Map 'executive overview' to same empty-canvas build path as board-ready"],
    });
    await page.screenshot({ path: path.join(OUT, "03-executive.png"), fullPage: true });
  });

  test("@COHI-398 04 period switch to YTD", async ({ page }) => {
    await seedBoardReadyDashboard(page);
    const input = unifiedChatMessageInput(page);
    await input.fill("Switch the whole dashboard to year-to-date.");
    await input.press("Enter");
    await waitForChatInputReady(page);

    const main = (await page.locator("main").textContent()) ?? "";
    const periodCopy = /Updated dashboard period|YTD|year-to-date/i.test(main);
    const recreated = /Applied \d+ widgets/i.test(main);
    const periodOnly = /Updated dashboard period/i.test(main);

    record({
      n: 4,
      name: "Period switch YTD",
      status: periodOnly && !recreated ? "works" : recreated ? "rough" : periodCopy ? "rough" : "broken",
      observed: periodCopy
        ? "Period-update messaging in chat"
        : recreated
          ? "Recreated widgets instead of modify_group set_period"
          : "No clear period change signal",
      improvements: recreated
        ? ["Period-only requests should use modify_group, not recreate widgets"]
        : !periodCopy
          ? ["Show visible YTD on group filter bar when period changes"]
          : [],
    });
    await page.screenshot({ path: path.join(OUT, "04-ytd.png"), fullPage: true });
  });

  test("@COHI-398 05 chat change chart to bar", async ({ page }) => {
    await seedBoardReadyDashboard(page);
    const input = unifiedChatMessageInput(page);
    await input.fill("Change the funded volume widget to a bar chart.");
    await input.press("Enter");
    await waitForChatInputReady(page);

    const main = (await page.locator("main").textContent()) ?? "";
    const wrong = /Wrong widget|No changes applied/i.test(main);
    const ok = /bar|Updated|modify|chart/i.test(main) && !wrong;

    record({
      n: 5,
      name: "Chat — chart type to bar",
      status: wrong ? "broken" : ok ? "works" : "rough",
      observed: wrong
        ? "Wrong widget or no changes toast"
        : ok
          ? "Acknowledged chart change"
          : "Unclear if canvas chart type changed",
      improvements: wrong
        ? ["Relax edit-ring guard when target widget exists on canvas", "Better widget id matching"]
        : !ok
          ? ["Surface viz-type change in canvas immediately; confirm in chat footer"]
          : [],
    });
    await page.screenshot({ path: path.join(OUT, "05-bar-chart.png"), fullPage: true });
  });

  test("@COHI-398 06 footer chart-type buttons", async ({ page }) => {
    await seedBoardReadyDashboard(page);
    const barBtn = page
      .locator("#workbench-canvas-root")
      .getByRole("button", { name: /^Bar$/i })
      .first();
    const visible = await barBtn.isVisible({ timeout: 15_000 }).catch(() => false);
    if (visible) {
      await barBtn.click({ force: true });
      await page.waitForTimeout(1500);
    }

    record({
      n: 6,
      name: "Footer chart-type buttons",
      status: visible ? "works" : "rough",
      observed: visible
        ? "Bar/Line controls visible on chart widget"
        : "No chart-type footer found (may be KPI-only dashboard)",
      improvements: visible
        ? ["Persist type across page reload; tooltip when research-locked"]
        : ["Ensure at least one chart widget in default board-ready seed for this test"],
    });
    await page.screenshot({ path: path.join(OUT, "06-footer-type.png"), fullPage: true });
  });

  test("@COHI-398 07 remove widget by phrase", async ({ page }) => {
    await seedBoardReadyDashboard(page);
    const input = unifiedChatMessageInput(page);
    await input.fill("Remove the pull-through rate widget from the dashboard.");
    await input.press("Enter");
    await waitForChatInputReady(page);

    const canvas = (await page.locator("#workbench-canvas-root").textContent()) ?? "";
    const main = (await page.locator("main").textContent()) ?? "";
    const stillThere = /pull[- ]?through/i.test(canvas);
    const removedMsg = /Removed|Updated dashboard|delete/i.test(main);

    record({
      n: 7,
      name: "Remove widget in group",
      status: !stillThere && removedMsg ? "works" : stillThere ? "broken" : "rough",
      observed: stillThere
        ? "Pull-through still visible on canvas"
        : removedMsg
          ? "Chat indicated removal"
          : "Widget gone but no clear confirmation",
      improvements: stillThere
        ? ["Fuzzy match pull-through in modify_group remove; canvas-scoped verification"]
        : ["Toast when remove misses target"],
    });
    await page.screenshot({ path: path.join(OUT, "07-remove.png"), fullPage: true });
  });

  test("@COHI-398 08 board-ready PowerPoint", async ({ page }) => {
    await seedBoardReadyDashboard(page);
    const input = unifiedChatMessageInput(page);
    await input.fill("Turn this into a board-ready PowerPoint.");
    await input.press("Enter");
    await waitForChatInputReady(page);

    const main = (await page.locator("main").textContent()) ?? "";
    const bad = /need the live|share live values/i.test(main);
    const good = /presentation|deck|report|download|slide/i.test(main) && !bad;

    record({
      n: 8,
      name: "Presentation export",
      status: bad ? "broken" : good ? "works" : "rough",
      observed: bad
        ? "Asked for live values instead of using canvas data"
        : good
          ? "Presentation/deck language in response"
          : "No clear deck outcome",
      improvements: bad
        ? ["Always use canvas widgetData + generate_report fallback"]
        : ["Clear download affordance in chat when PPT ready"],
    });
    await page.screenshot({ path: path.join(OUT, "08-ppt.png"), fullPage: true });
  });

  test("@COHI-398 09 auto-fork Workbench to Chat", async ({ page }) => {
    await openFreshWorkbenchChat(page);
    const input = unifiedChatMessageInput(page);
    await input.fill("Build a quick MTD KPI summary.");
    await input.press("Enter");
    await waitForChatInputReady(page);
    await dismissBlockingOverlays(page);

    let target: "Chat" | "Research" | null = null;
    try {
      await selectUnifiedChatType(page, "Chat");
      target = "Chat";
    } catch {
      try {
        await selectUnifiedChatType(page, "Research");
        target = "Research";
      } catch {
        target = null;
      }
    }
    await page.waitForTimeout(2000);

    const forkChip = await page
      .getByTestId("conversation-fork-chips")
      .isVisible()
      .catch(() => false);
    const toast = await page
      .getByText(/Started a new.*chat|carried over/i)
      .first()
      .isVisible()
      .catch(() => false);
    const emptyComposer = (await input.inputValue()) === "";

    record({
      n: 9,
      name: "Auto-fork on type switch",
      status: forkChip || toast ? "works" : !target ? "broken" : "rough",
      observed: forkChip
        ? `Continued-from chip (→ ${target ?? "Chat"})`
        : toast
          ? `Fork toast + Undo (→ ${target ?? "Chat"})`
          : !target
            ? "Could not open type selector"
            : `Switched to ${target}; composer empty=${emptyComposer}`,
      improvements: !target
        ? ["Stabilize scenario 9: dismiss overlays after stream, then selectUnifiedChatType"]
        : !forkChip && !toast
          ? ["Always show fork chip + toast when switching type mid-conversation"]
          : ["Link parent title in chip after first message in forked thread"],
    });
    await page.screenshot({ path: path.join(OUT, "09-fork.png"), fullPage: true });
  });

  test("@COHI-398 10 follow-up same conversation", async ({ page }) => {
    await openFreshWorkbenchChat(page);
    const input = unifiedChatMessageInput(page);
    const streamPosts: string[] = [];

    await page.route(/\/api\/chat\/v1\/messages:stream/, async (route) => {
      if (route.request().method() === "POST") {
        try {
          const b = route.request().postDataJSON() as { conversationId?: string };
          if (b?.conversationId) streamPosts.push(b.conversationId);
        } catch {
          /* ignore */
        }
      }
      await route.continue();
    });

    await input.fill("Build funded units MTD only — one KPI.");
    await input.press("Enter");
    await waitForChatInputReady(page);

    const convAfterFirst = streamPosts.at(-1);
    await input.fill("Now add funded volume next to it.");
    await input.press("Enter");
    await waitForChatInputReady(page);

    const sameConv =
      streamPosts.length >= 2 && convAfterFirst && streamPosts.every((id) => id === convAfterFirst);

    record({
      n: 10,
      name: "Follow-up same conversation",
      status: sameConv ? "works" : "broken",
      observed: sameConv
        ? `Same conversationId across turns (${streamPosts.length} posts)`
        : `Different conversation ids: ${[...new Set(streamPosts)].join(" → ")}`,
      improvements: sameConv
        ? []
        : ["Second turn must not forceNew on split shell; keep sessionId"],
    });
    await page.screenshot({ path: path.join(OUT, "10-followup.png"), fullPage: true });
  });

  test("@COHI-398 11 all-time KPI", async ({ page }) => {
    await seedBoardReadyDashboard(page);
    const input = unifiedChatMessageInput(page);
    let noDateFilter = false;
    page.on("request", (req) => {
      if (req.method() === "POST" && /execute-sql/.test(req.url())) {
        try {
          const body = req.postDataJSON() as { dateFilter?: unknown };
          if (!body?.dateFilter) noDateFilter = true;
        } catch {
          /* ignore */
        }
      }
    });
    await input.fill("Add one KPI for total funded loans all time, no period in the title.");
    await input.press("Enter");
    await waitForChatInputReady(page);

    const canvas = (await page.locator("#workbench-canvas-root").textContent()) ?? "";
    const titleHasMtd = /\bMTD\b/i.test(canvas);
    await page.waitForTimeout(2000);

    record({
      n: 11,
      name: "All-time KPI",
      status: noDateFilter && !titleHasMtd ? "works" : "rough",
      observed: `SQL without date filter=${noDateFilter}; MTD in canvas text=${titleHasMtd}`,
      improvements: [
        ...(titleHasMtd ? ["Strip period tokens from all-time widget titles"] : []),
        ...(!noDateFilter ? ["All-time should set filterable:false on widget"] : []),
      ],
    });
    await page.screenshot({ path: path.join(OUT, "11-all-time.png"), fullPage: true });
  });

  test("@COHI-398 12 export as deck phrasing", async ({ page }) => {
    await seedBoardReadyDashboard(page);
    const input = unifiedChatMessageInput(page);
    await input.fill("Export this dashboard as a deck for leadership.");
    await input.press("Enter");
    await waitForChatInputReady(page);

    const main = (await page.locator("main").textContent()) ?? "";
    const ok = /deck|presentation|report|slide/i.test(main);

    record({
      n: 12,
      name: "Presentation phrasing variant",
      status: ok ? "works" : "rough",
      observed: ok ? "Recognized deck/export intent" : "Did not clearly handle export",
      improvements: ok ? [] : ["Synonym map for deck/slides/leadership meeting → generate_report"],
    });
    await page.screenshot({ path: path.join(OUT, "12-deck.png"), fullPage: true });
  });

  test("@COHI-398 13 new conversation while streaming", async ({ page }) => {
    await openFreshWorkbenchChat(page);
    const input = unifiedChatMessageInput(page);
    await input.fill("Build a full MTD executive dashboard with many widgets.");
    await input.press("Enter");
    await page.waitForTimeout(3000);

    const newBtn = page.getByTitle("New conversation");
    if (await newBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await newBtn.click();
    }

    const enabled = await input.isEnabled().catch(() => false);
    const badge = await page
      .getByText(/other chat is still generating/i)
      .first()
      .isVisible()
      .catch(() => false);

    record({
      n: 13,
      name: "Multi-chat while streaming",
      status: enabled ? "works" : "broken",
      observed: `Composer enabled=${enabled}; background badge=${badge}`,
      improvements: enabled ? [] : ["Enable composer after New conversation when another run is active"],
    });
    await page.screenshot({ path: path.join(OUT, "13-multi-chat.png"), fullPage: true });
  });

  test("@COHI-398 14 suggest not build on empty", async ({ page }) => {
    await openFreshWorkbenchChat(page);
    const input = unifiedChatMessageInput(page);
    await input.fill("What should I look at first?");
    await input.press("Enter");
    await waitForChatInputReady(page);

    const main = (await page.locator("main").textContent()) ?? "";
    const canvasEmpty = await page.getByText("Your canvas is empty").isVisible().catch(() => false);
    const silentBuild = /Applied \d+ widgets/i.test(main) && canvasEmpty;

    record({
      n: 14,
      name: "Advisory question on empty canvas",
      status: silentBuild ? "rough" : "works",
      observed: silentBuild
        ? "Built widgets for advisory question"
        : "Answered with suggestions/explanation",
      improvements: silentBuild
        ? ["Use suggest_dashboard or text-only for 'what should I look at' without build verbs"]
        : [],
    });
    await page.screenshot({ path: path.join(OUT, "14-advisory.png"), fullPage: true });
  });

  test("@COHI-398 15 YTD plus add chart one turn", async ({ page }) => {
    await seedBoardReadyDashboard(page);
    const input = unifiedChatMessageInput(page);
    await input.fill("Switch to YTD and add a monthly funded volume trend chart.");
    await input.press("Enter");
    await waitForChatInputReady(page);

    const main = (await page.locator("main").textContent()) ?? "";
    const canvas = (await page.locator("#workbench-canvas-root").textContent()) ?? "";
    const both = /YTD|year|period|volume|chart|Applied/i.test(`@COHI-398 ${main} ${canvas}`);

    record({
      n: 15,
      name: "Combined period + add chart",
      status: both ? "works" : "rough",
      observed: both ? "Handled combined intent in one turn" : "Partial or unclear combined apply",
      improvements: both ? [] : ["Single turn should apply set_period + create_widget without duplicate groups"],
    });
    await page.screenshot({ path: path.join(OUT, "15-combo.png"), fullPage: true });
  });

  test.afterAll(() => {
    const broken = results.filter((r) => r.status === "broken").length;
    const rough = results.filter((r) => r.status === "rough").length;
    const works = results.filter((r) => r.status === "works").length;
    fs.appendFileSync(
      REPORT,
      `\n## Summary\n\n- **Works:** ${works}/15\n- **Rough:** ${rough}/15\n- **Broken:** ${broken}/15\n`,
    );
  });
});

