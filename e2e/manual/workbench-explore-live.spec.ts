/**
 * Live human-style exploration — not CI. Logs outcomes, soft failures.
 * Run: npx playwright test e2e/manual/workbench-explore-live.spec.ts --project=chromium --workers=1
 */
import { test, expect } from "../fixtures";
import {
  forceUnifiedChat,
  gotoWithUnifiedChatShell,
  selectUnifiedChatType,
  unifiedChatMessageInput,
} from "../helpers/unifiedChat";

type Probe = {
  name: string;
  prompt: string;
  seedMtd?: boolean;
  seedYtd?: boolean;
};

const PROBES: Probe[] = [
  {
    name: "MTD board-ready (baseline)",
    prompt: "Prepare a board-ready overview of this month's performance",
  },
  {
    name: "YTD switch on populated canvas",
    prompt: "Switch the whole dashboard to year-to-date",
    seedMtd: true,
  },
  {
    name: "Branch breakdown MTD",
    prompt: "Add a bar chart of funded volume by branch for this month",
  },
  {
    name: "Analytical question only",
    prompt: "Why is pull-through at 100% — is that a data issue?",
    seedMtd: true,
  },
  {
    name: "Delete one widget",
    prompt: "Remove the pull-through rate widget from the dashboard",
    seedMtd: true,
  },
  {
    name: "Rename widget in group",
    prompt: 'Rename the funded units widget to "Units Funded"',
    seedMtd: true,
  },
  {
    name: "Presentation from canvas",
    prompt:
      "Create a 4-slide board deck from this canvas with real numbers from the widgets",
    seedMtd: true,
  },
  {
    name: "All-time KPI",
    prompt: "Add one KPI for total funded loans all time, no period in the title",
  },
  {
    name: "L12M trend chart",
    prompt: "Add a weekly funded volume line chart for the last 12 months",
  },
  {
    name: "Minimal 2-widget dashboard",
    prompt: "Build a minimal dashboard: only funded units and funded volume for this month",
  },
  {
    name: "Switch back to MTD",
    prompt: "Change the dashboard period back to month-to-date",
    seedYtd: true,
  },
  {
    name: "Follow-up add KPI",
    prompt: "Add revenue BPS as another KPI on the same dashboard",
    seedMtd: true,
  },
];

type ProbeResult = {
  name: string;
  ok: boolean;
  streamCompleted: boolean;
  createWidgets: number;
  modifyGroup: boolean;
  generateReport: boolean;
  clarifying: boolean;
  canvasEmpty: boolean;
  widgetHints: string[];
  sqlStarts: string[];
  chatTail: string;
  note: string;
};

async function waitForTurn(page: import("@playwright/test").Page): Promise<void> {
  const input = unifiedChatMessageInput(page);
  await expect
    .poll(
      async () => {
        const enabled = await input.isEnabled().catch(() => false);
        const done = await page
          .getByText(
            /Applied \d+ widget|Group updated|NEEDS ATTENTION|ANALYSIS|generate_report|I added|I built|I updated|I removed/i,
          )
          .first()
          .isVisible()
          .catch(() => false);
        return enabled && done ? 1 : 0;
      },
      { timeout: 200_000, intervals: [2500, 4000, 6000] },
    )
    .toBe(1);
  await page.waitForTimeout(2500);
}

async function seedDashboard(
  page: import("@playwright/test").Page,
  prompt: string,
): Promise<void> {
  const input = unifiedChatMessageInput(page);
  await input.fill(prompt);
  await input.press("Enter");
  await waitForTurn(page);
}

function collectHints(text: string): string[] {
  const keys = [
    "Funded Units",
    "Funded Volume",
    "Pull-Through",
    "Revenue BPS",
    "Weekly",
    "branch",
    "Branch",
    "Cycle Time",
    "Outcomes",
  ];
  return keys.filter((k) => text.includes(k));
}

test.describe("Workbench human exploration @explore-live", () => {
  test.setTimeout(2_400_000);

  test("run all probes and print summary", async ({ userPage }) => {
    await forceUnifiedChat(userPage);
    const results: ProbeResult[] = [];
    const mtdStart = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}-01`;

    for (const probe of PROBES) {
      let sqlDateFilters: Array<{ start?: string }> = [];
      let streamCompleted = false;
      let createWidgetCount = 0;
      let modifyGroup = false;
      let generateReport = false;
      let streamText = "";

      const onReq = (req: import("@playwright/test").Request) => {
        if (req.method() !== "POST" || !/\/api\/cohi-chat\/execute-sql/.test(req.url())) return;
        try {
          const body = req.postDataJSON() as { dateFilter?: { start?: string } };
          if (body?.dateFilter?.start) sqlDateFilters.push(body.dateFilter);
        } catch {
          /* ignore */
        }
      };
      const onRes = async (res: import("@playwright/test").Response) => {
        if (!/\/api\/chat\/v1\/messages:stream/.test(res.url())) return;
        if (res.request().method() !== "POST") return;
        try {
          const text = await res.text();
          streamText = text;
          if (text.includes("turn.completed")) streamCompleted = true;
          if (/"type"\s*:\s*"modify_group"/.test(text)) modifyGroup = true;
          if (/"type"\s*:\s*"generate_report"/.test(text)) generateReport = true;
          const m = text.match(/"type"\s*:\s*"create_widget"/g);
          if (m) createWidgetCount = Math.max(createWidgetCount, m.length);
        } catch {
          /* ignore */
        }
      };

      userPage.on("request", onReq);
      userPage.on("response", onRes);

      let note = "";
      let ok = true;
      try {
        await gotoWithUnifiedChatShell(userPage, "/my-dashboard/new", { timeout: 60_000 });
        await selectUnifiedChatType(userPage, "Workbench");

        if (probe.seedMtd) {
          await seedDashboard(userPage, "Prepare a board-ready overview of this month's performance");
        } else if (probe.seedYtd) {
          await seedDashboard(
            userPage,
            "Build a year-to-date executive snapshot: funded units and funded volume",
          );
        }

        const input = unifiedChatMessageInput(userPage);
        await expect(input).toBeEnabled({ timeout: 120_000 });
        await input.fill(probe.prompt);
        await input.press("Enter");
        await waitForTurn(userPage);
      } catch (e) {
        ok = false;
        note = e instanceof Error ? e.message : String(e);
      }

      const mainText = (await userPage.locator("main").textContent()) ?? "";
      const uniqueStarts = [...new Set(sqlDateFilters.map((f) => f.start).filter(Boolean))];
      const clarifying =
        /would you like me to build.*first|switch existing.*or rebuild|dashboard first, or generate/i.test(
          mainText,
        );
      const slug = probe.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase().slice(0, 48);
      await userPage.screenshot({
        path: `test-results/explore-live/${slug}.png`,
        fullPage: true,
      });

      const result: ProbeResult = {
        name: probe.name,
        ok,
        streamCompleted,
        createWidgets: createWidgetCount,
        modifyGroup,
        generateReport,
        clarifying,
        canvasEmpty: mainText.includes("Your canvas is empty"),
        widgetHints: collectHints(mainText),
        sqlStarts: uniqueStarts,
        chatTail: mainText.replace(/\s+/g, " ").slice(-420),
        note,
      };

      if (probe.name.includes("switch") && probe.name.includes("YTD")) {
        if (!modifyGroup && createWidgetCount > 2) note += " | expected modify_group";
        if (!uniqueStarts.includes("2026-01-01")) note += " | missing YTD sql";
      }
      if (probe.name.includes("MTD") && probe.name.includes("baseline") && uniqueStarts.length) {
        if (!uniqueStarts.every((s) => s === mtdStart)) note += " | mixed sql starts";
      }
      if (probe.name.includes("All-time") && uniqueStarts.length > 0) {
        note += " | still has dateFilter";
      }
      if (probe.name.includes("Delete") && !/removed|delete/i.test(mainText)) {
        note += " | no remove confirmation";
      }
      if (probe.name.includes("Presentation") && !generateReport && !/slide|PowerPoint/i.test(mainText)) {
        note += " | no report/deck";
      }

      results.push(result);
      userPage.off("request", onReq);
      userPage.off("response", onRes);

      console.log("\n====", probe.name, "====");
      console.log(JSON.stringify(result, null, 2));
      void streamText;
    }

    console.log("\n\n######## EXPLORE SUMMARY ########");
    for (const r of results) {
      const flags = [
        r.ok ? "ok" : "FAIL",
        r.clarifying ? "CLARIFY" : "-",
        r.canvasEmpty ? "empty" : `w:${r.widgetHints.length}`,
        r.createWidgets ? `cw:${r.createWidgets}` : "-",
        r.modifyGroup ? "mg" : "-",
        r.generateReport ? "ppt" : "-",
        `sql:${r.sqlStarts.join("|") || "none"}`,
        r.note ? `(${r.note})` : "",
      ].join(" ");
      console.log(r.name.padEnd(36), flags);
    }

    expect(results.length).toBe(PROBES.length);
  });
});
