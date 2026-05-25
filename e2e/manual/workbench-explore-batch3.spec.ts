/**
 * Manual UX exploration batch 3 — headed live probes with screenshots + log.
 * Run: npx playwright test e2e/manual/workbench-explore-batch3.spec.ts --project=chromium --workers=1 --headed --trace=on
 */
import fs from "fs";
import path from "path";
import { test, expect } from "../fixtures";
import {
  forceUnifiedChat,
  gotoWithUnifiedChatShell,
  selectUnifiedChatType,
  unifiedChatMessageInput,
} from "../helpers/unifiedChat";

const OUT_DIR = path.join("test-results", "explore-batch3");
const LOG_PATH = path.join(OUT_DIR, "log.ndjson");

type Verdict = "pass" | "fail" | "surprise";

type Probe = {
  id: string;
  class: "A" | "B" | "C" | "E" | "D";
  name: string;
  seed?: string;
  prompt?: string;
  action?: "switch_chat_type" | "click_chart_type";
  chatTypeAfterSwitch?: "Chat" | "Research" | "Workbench";
  evaluate: (ctx: {
    mainText: string;
    canvasText: string;
    inputEnabled: boolean;
  }) => { verdict: Verdict; note: string };
};

const PROBES: Probe[] = [
  {
    id: "A1",
    class: "A",
    name: "Board-ready MTD dashboard",
    prompt: "Build a board-ready dashboard for this month.",
    evaluate: ({ mainText, canvasText }) => {
      const bad = /dashboard or presentation|need the live/i.test(mainText);
      const built = /Funded|Applied \d+ widgets|dashboard/i.test(
        `${mainText} ${canvasText}`,
      );
      return {
        verdict: bad ? "fail" : built ? "pass" : "surprise",
        note: bad ? "Asked clarifying or live values" : built ? "Built dashboard" : "Unclear build",
      };
    },
  },
  {
    id: "A3",
    class: "A",
    name: "Executive overview",
    prompt: "Give me an executive overview.",
    evaluate: ({ mainText, canvasText }) => ({
      verdict: /Funded|widget|dashboard/i.test(`${mainText} ${canvasText}`)
        ? "pass"
        : "surprise",
      note: "Executive overview response",
    }),
  },
  {
    id: "B3",
    class: "B",
    name: "Chat change volume to bar chart",
    seed: "Build a minimal dashboard: funded units and funded volume for this month",
    prompt: "Change the funded volume chart to a bar chart.",
    evaluate: ({ mainText, canvasText }) => ({
      verdict: /bar|Updated|modify/i.test(`${mainText} ${canvasText}`)
        ? "pass"
        : /Wrong widget|No changes applied/i.test(mainText)
          ? "fail"
          : "surprise",
      note: "modify_widget chart type via chat",
    }),
  },
  {
    id: "C1",
    class: "C",
    name: "Board-ready PowerPoint",
    seed: "Build a board-ready dashboard for this month.",
    prompt: "Turn this into a board-ready PowerPoint.",
    evaluate: ({ mainText }) => ({
      verdict: /need the live|share live values/i.test(mainText)
        ? "fail"
        : /presentation|deck|report|download/i.test(mainText)
          ? "pass"
          : "surprise",
      note: "Presentation from populated canvas",
    }),
  },
  {
    id: "E1",
    class: "E",
    name: "Auto-fork Workbench to Chat",
    seed: "Build MTD executive dashboard",
    action: "switch_chat_type",
    chatTypeAfterSwitch: "Chat",
    evaluate: ({ mainText }) => ({
      verdict: /Continued from|Started a new/i.test(mainText) ? "pass" : "surprise",
      note: "Fork chip or toast on type switch",
    }),
  },
];

function appendLog(entry: Record<string, unknown>) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.appendFileSync(LOG_PATH, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`);
}

test.describe("Workbench explore batch 3 @explore-live", () => {
  test.setTimeout(1_800_000);

  test.beforeAll(() => {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.writeFileSync(LOG_PATH, "");
  });

  test("batch 3 UX probes", async ({ userPage }) => {
    await forceUnifiedChat(userPage);

    for (const probe of PROBES) {
      await gotoWithUnifiedChatShell(userPage, "/my-dashboard/new", { timeout: 60_000 });
      await selectUnifiedChatType(userPage, "Workbench");
      const input = unifiedChatMessageInput(userPage);

      if (probe.seed) {
        await input.fill(probe.seed);
        await input.press("Enter");
        await expect
          .poll(() => input.isEnabled().catch(() => false), { timeout: 240_000 })
          .toBe(true);
        await userPage.waitForTimeout(2000);
      }

      if (probe.prompt) {
        await input.fill(probe.prompt);
        await input.press("Enter");
        await expect
          .poll(() => input.isEnabled().catch(() => false), { timeout: 240_000 })
          .toBe(true);
        await userPage.waitForTimeout(2500);
      }

      if (probe.action === "switch_chat_type" && probe.chatTypeAfterSwitch) {
        await selectUnifiedChatType(userPage, probe.chatTypeAfterSwitch);
        await userPage.waitForTimeout(1500);
      }

      const mainText = (await userPage.locator("main").textContent()) ?? "";
      const canvasText =
        (await userPage.locator("#workbench-canvas-root").textContent().catch(() => "")) ??
        "";
      const inputEnabled = await input.isEnabled().catch(() => false);
      const { verdict, note } = probe.evaluate({ mainText, canvasText, inputEnabled });

      const shot = path.join(OUT_DIR, `${probe.id}-${probe.name.replace(/\W+/g, "-").slice(0, 40)}.png`);
      await userPage.screenshot({ path: shot, fullPage: true });

      appendLog({
        id: probe.id,
        class: probe.class,
        name: probe.name,
        verdict,
        note,
        screenshot: shot,
        inputEnabled,
      });

      console.log(`[batch3] ${probe.id} ${probe.name}: ${verdict} — ${note}`);
    }
  });
});
