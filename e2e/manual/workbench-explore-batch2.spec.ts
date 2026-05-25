/**
 * Live exploration batch 2 — not CI.
 */
import { test, expect } from "../fixtures";
import {
  forceUnifiedChat,
  gotoWithUnifiedChatShell,
  selectUnifiedChatType,
  unifiedChatMessageInput,
} from "../helpers/unifiedChat";

const PROBES = [
  {
    name: "Delete pull-through (retry)",
    seed: "Prepare a board-ready overview of this month's performance",
    prompt: "Remove the pull-through rate widget from the dashboard",
  },
  {
    name: "All-time KPI (retry)",
    prompt: "Add one KPI for total funded loans all time, no period in the title",
  },
  {
    name: "Chart type change",
    seed: "Build a minimal dashboard: funded units and funded volume for this month",
    prompt: "Change funded volume from KPI to a bar chart by week for this month",
  },
  {
    name: "Branch drill question",
    seed: "Prepare a board-ready overview of this month's performance",
    prompt: "Which branches contributed the most funded volume this month?",
  },
  {
    name: "Add vs switch disambiguation",
    seed: "Prepare a board-ready overview of this month's performance",
    prompt: "Switch to YTD and also add a monthly volume trend chart",
  },
];

test.describe("Workbench explore batch 2 @explore-live", () => {
  test.setTimeout(1_200_000);

  test("@COHI-398 batch 2 probes", async ({ userPage }) => {
    await forceUnifiedChat(userPage);
    for (const probe of PROBES) {
      const sqlStarts: string[] = [];
      let noDateFilter = false;
      userPage.on("request", (req) => {
        if (req.method() !== "POST" || !/\/api\/cohi-chat\/execute-sql/.test(req.url())) return;
        try {
          const body = req.postDataJSON() as { dateFilter?: { start?: string } };
          if (body?.dateFilter?.start) sqlStarts.push(body.dateFilter.start);
          else if (!body?.dateFilter) noDateFilter = true;
        } catch {
          /* ignore */
        }
      });

      await gotoWithUnifiedChatShell(userPage, "/my-dashboard/new", { timeout: 60_000 });
      await selectUnifiedChatType(userPage, "Workbench");
      const input = unifiedChatMessageInput(userPage);

      if (probe.seed) {
        await input.fill(probe.seed);
        await input.press("Enter");
        await expect
          .poll(() => input.isEnabled().catch(() => false), { timeout: 200_000 })
          .toBe(true);
        await userPage.waitForTimeout(3000);
      }

      await input.fill(probe.prompt);
      await input.press("Enter");
      await expect
        .poll(() => input.isEnabled().catch(() => false), { timeout: 200_000 })
        .toBe(true);
      await userPage.waitForTimeout(2500);

      const text = (await userPage.locator("main").textContent()) ?? "";
      const canvas = userPage.locator("#workbench-canvas-root");
      const pullVisible = await canvas
        .getByText(/Pull-Through/i)
        .first()
        .isVisible()
        .catch(() => false);
      const slug = probe.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase().slice(0, 40);
      await userPage.screenshot({ path: `test-results/explore-live/b2-${slug}.png`, fullPage: true });

      console.log("\n##", probe.name);
      console.log("sql:", [...new Set(sqlStarts)]);
      console.log("noDateFilterSeen:", noDateFilter);
      console.log("pull-through visible:", pullVisible);
      console.log("tail:", text.replace(/\s+/g, " ").slice(-350));

      userPage.removeAllListeners("request");
    }
    expect(true).toBe(true);
  });
});

