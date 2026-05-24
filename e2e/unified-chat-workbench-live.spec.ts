/**
 * Live local integration: real unified chat stream + LLM (no SSE mock).
 * Run: npx playwright test e2e/unified-chat-workbench-live.spec.ts --project=chromium
 */
import { test, expect } from "./fixtures";
import {
  forceUnifiedChat,
  gotoWithUnifiedChatShell,
  selectUnifiedChatType,
  unifiedChatMessageInput,
} from "./helpers/unifiedChat";
import {
  attachPresentationStreamWatcher,
  BOARD_READY_PROMPT,
  openFreshWorkbenchChat,
  seedBoardReadyDashboard,
  sendWorkbenchChatTurn,
  waitForChatInputReady,
  waitForWorkbenchCanvasPopulated,
} from "./helpers/workbenchLive";

test.describe.configure({ mode: "serial" });

test.describe("Live workbench board-ready prompt @live", () => {
  test.setTimeout(300_000);

  test.beforeEach(async ({ userPage }) => {
    await forceUnifiedChat(userPage);
  });

  test("builds MTD dashboard in one turn on empty canvas", async ({ userPage }) => {
    const sqlDateFilters: Array<{ start?: string; end?: string; column?: string }> = [];
    let streamCompleted = false;
    let actionCount = 0;

    userPage.on("request", (req) => {
      if (req.method() === "POST" && /\/api\/cohi-chat\/execute-sql/.test(req.url())) {
        try {
          const body = req.postDataJSON() as {
            dateFilter?: { start?: string; end?: string; column?: string };
          };
          if (body?.dateFilter) sqlDateFilters.push(body.dateFilter);
        } catch {
          /* ignore */
        }
      }
    });

    userPage.on("response", async (res) => {
      if (!/\/api\/chat\/v1\/messages:stream/.test(res.url())) return;
      if (res.request().method() !== "POST") return;
      try {
        const text = await res.text();
        if (text.includes("turn.completed")) streamCompleted = true;
        const actionMatches = text.match(/"type"\s*:\s*"create_widget"/g);
        if (actionMatches) actionCount = Math.max(actionCount, actionMatches.length);
      } catch {
        /* ignore */
      }
    });

    await openFreshWorkbenchChat(userPage);
    await sendWorkbenchChatTurn(userPage, BOARD_READY_PROMPT);
    await waitForWorkbenchCanvasPopulated(userPage);

    const chatReply = userPage
      .getByText(
        /Applied \d+ widgets to canvas|board-ready month-to-date|Updated dashboard|widgets to canvas/i,
      )
      .first();
    await expect(chatReply).toBeVisible({ timeout: 30_000 });

    const messageBody =
      (await userPage.locator("main").textContent({ timeout: 5_000 }).catch(() => "")) ?? "";

    expect(messageBody).not.toMatch(
      /would you like me to build.*first|dashboard first, or generate a presentation/i,
    );

    console.log("[live-test] streamCompleted:", streamCompleted);
    console.log("[live-test] create_widget hints in stream:", actionCount);
    const uniqueStarts = [...new Set(sqlDateFilters.map((f) => f.start).filter(Boolean))];
    console.log("[live-test] sqlDateFilter starts:", uniqueStarts);

    expect(streamCompleted).toBe(true);

    const now = new Date();
    const expectedStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
    expect(sqlDateFilters.length).toBeGreaterThan(0);
    const nonMtd = sqlDateFilters.filter((f) => f.start && f.start !== expectedStart);
    expect(nonMtd, `expected all execute-sql dateFilter.start=${expectedStart}`).toHaveLength(0);

    await expect(userPage.getByText(/Funded Units MTD|Funded Volume MTD/i)).toHaveCount(0);
  });

  test("switches populated dashboard to YTD without recreating widgets", async ({ userPage }) => {
    const sqlDateFilters: Array<{ start?: string; end?: string }> = [];

    userPage.on("request", (req) => {
      if (req.method() !== "POST" || !/\/api\/cohi-chat\/execute-sql/.test(req.url())) return;
      try {
        const body = req.postDataJSON() as { dateFilter?: { start?: string; end?: string } };
        if (body?.dateFilter) sqlDateFilters.push(body.dateFilter);
      } catch {
        /* ignore */
      }
    });

    await seedBoardReadyDashboard(userPage);
    sqlDateFilters.length = 0;

    await sendWorkbenchChatTurn(userPage, "Switch the whole dashboard to year-to-date");

    await expect
      .poll(
        async () => {
          const mainText = (await userPage.locator("main").textContent()) ?? "";
          const replied = /year-to-date|YTD|Updated dashboard period|Group updated/i.test(
            mainText,
          );
          return replied ? 1 : 0;
        },
        { timeout: 180_000, intervals: [3000, 5000] },
      )
      .toBe(1);

    const mainText = (await userPage.locator("main").textContent()) ?? "";
    const uniqueStarts = [...new Set(sqlDateFilters.map((f) => f.start).filter(Boolean))];
    console.log("[live-test YTD switch] sql starts:", uniqueStarts);
    console.log("[live-test YTD switch] chat tail:", mainText.replace(/\s+/g, " ").slice(-400));

    expect(mainText).not.toMatch(
      /would you like me to build.*first|switch existing.*or rebuild/i,
    );
    expect(uniqueStarts).toContain("2026-01-01");
    const createWidgetFlood = (mainText.match(/Applied \d+ widgets/g) ?? []).length;
    expect(createWidgetFlood).toBeLessThanOrEqual(1);
  });

  test("generates presentation from populated canvas without asking for live values", async ({
    userPage,
  }) => {
    const watcher = attachPresentationStreamWatcher(userPage);

    try {
      await seedBoardReadyDashboard(userPage);

      await sendWorkbenchChatTurn(
        userPage,
        "Turn this dashboard into a board-ready PowerPoint presentation",
      );

      const mainText = (await userPage.locator("main").textContent()) ?? "";
      const pptUi = await userPage
        .getByText(
          /PPT Editor|PowerPoint Editor|Generating report|Report downloaded|slides were built|Export PPTX/i,
        )
        .first()
        .isVisible()
        .catch(() => false);

      const streamHit = watcher.sawGenerateReport();
      const apiHit = watcher.sawReportGenerateApi();

      console.log("[live-test presentation] generate_report in stream:", streamHit);
      console.log("[live-test presentation] reports/generate API:", apiHit);
      console.log("[live-test presentation] PPT UI visible:", pptUi);
      console.log(
        "[live-test presentation] tail:",
        mainText.replace(/\s+/g, " ").slice(-500),
      );

      await userPage.screenshot({
        path: "test-results/live-workbench-presentation.png",
        fullPage: true,
      });

      expect(mainText).not.toMatch(
        /share live values|refresh.*canvas|need the numbers from you|need the live/i,
      );
      expect(streamHit || apiHit || pptUi).toBe(true);
      expect(streamHit || apiHit).toBe(true);
    } finally {
      watcher.detach();
    }
  });

  test("all-time KPI runs without date filter injection", async ({ userPage }) => {
    const sqlDateFilters: Array<{ start?: string }> = [];
    let noDateFilterCount = 0;

    userPage.on("request", (req) => {
      if (req.method() !== "POST" || !/\/api\/cohi-chat\/execute-sql/.test(req.url())) return;
      try {
        const body = req.postDataJSON() as { dateFilter?: { start?: string } };
        if (body?.dateFilter?.start) sqlDateFilters.push(body.dateFilter);
        else noDateFilterCount += 1;
      } catch {
        /* ignore */
      }
    });

    await openFreshWorkbenchChat(userPage);
    await sendWorkbenchChatTurn(
      userPage,
      "Add one KPI for total funded loans all time, no period in the title",
    );

    await waitForWorkbenchCanvasPopulated(userPage, { timeoutMs: 120_000 }).catch(() => {
      /* single widget may not match group headings */
    });

    const canvas = userPage.locator("#workbench-canvas-root");
    const titleVisible = await canvas
      .getByText(/total funded|funded loans/i)
      .first()
      .isVisible()
      .catch(() => false);

    console.log("[live-test all-time] sql starts:", [...new Set(sqlDateFilters.map((f) => f.start))]);
    console.log("[live-test all-time] noDateFilter executes:", noDateFilterCount);
    console.log("[live-test all-time] widget visible:", titleVisible);

    expect(sqlDateFilters).toHaveLength(0);
    expect(noDateFilterCount).toBeGreaterThan(0);
  });
});
