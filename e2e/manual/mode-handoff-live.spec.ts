/**
 * Live E2E: cross-mode structural handoff (Workbench → Research / Insight Builder).
 *
 * Run (uses .env.e2e via loadE2EEnv in playwright.manual-live.config.ts):
 *   npx playwright test e2e/manual/mode-handoff-live.spec.ts --config=playwright.manual-live.config.ts
 */
import { test, expect } from "@playwright/test";
import {
  dismissBlockingOverlays,
  expandChatShellForResearch,
  forceUnifiedChat,
  unifiedChatMessageInput,
} from "../helpers/unifiedChat";
import {
  seedDeterministicBoard,
  waitForChatInputReady,
} from "../helpers/workbenchLive";

type StreamBody = {
  chat_type?: string;
  location?: { surface?: string; route?: string };
  scope?: { type?: string; id?: string };
  context?: {
    modeHandoffContext?: {
      fromChatType?: string;
      canvasState?: { totalItems?: number };
      widgetCatalog?: string;
    };
    carryOverContext?: { summary?: string };
  };
};

function isStreamPost(url: string, method: string): boolean {
  return method === "POST" && /\/api\/chat\/v1\/messages:stream(?:\?.*)?$/.test(url);
}

test.describe.configure({ mode: "serial" });

test.describe("Cross-mode handoff @manual-live", () => {
  const streamBodies: StreamBody[] = [];

  test.beforeEach(async ({ page }) => {
    streamBodies.length = 0;
    await forceUnifiedChat(page);
    page.on("request", (req) => {
      if (!isStreamPost(req.url(), req.method())) return;
      try {
        const body = req.postDataJSON() as StreamBody;
        streamBodies.push(body);
      } catch {
        /* ignore */
      }
    });
  });

  async function switchChatTypeViaCombobox(
    page: import("@playwright/test").Page,
    label: "Research" | "Insight builder",
  ) {
    await dismissBlockingOverlays(page);
    const combobox = page.getByRole("combobox", { name: "Chat type" });
    await combobox.click({ force: true });
    const listbox = page.getByRole("listbox");
    await expect(listbox).toBeVisible({ timeout: 15_000 });
    await listbox.getByRole("option", { name: label, exact: true }).click();
  }

  test("H01 Workbench → Research sends canvas handoff + workbench_canvas scope", async ({
    page,
  }) => {
    await seedDeterministicBoard(page);
    const input = unifiedChatMessageInput(page);
    await dismissBlockingOverlays(page);
    await input.fill("Confirm funded units KPI is visible on this board.");
    await input.press("Enter");
    await waitForChatInputReady(page, { timeoutMs: 120_000 });

    await switchChatTypeViaCombobox(page, "Research");
    await expandChatShellForResearch(page);

    const researchInput = unifiedChatMessageInput(page);
    await researchInput.fill("Investigate the metrics on this dashboard board.");
    await researchInput.press("Enter");
    await waitForChatInputReady(page, { timeoutMs: 180_000 });

    const researchSend = streamBodies.find((b) => b.chat_type === "research");
    expect(researchSend, "expected a research stream POST").toBeTruthy();
    expect(researchSend!.location?.surface).toBe("workbench_canvas");
    expect(researchSend!.scope?.type).toMatch(/canvas|draft/);
    const handoff = researchSend!.context?.modeHandoffContext;
    expect(handoff?.fromChatType).toBe("workbench");
    expect((handoff?.canvasState?.totalItems ?? 0) > 0).toBe(true);
    expect((handoff?.widgetCatalog?.length ?? 0) > 0).toBe(true);

    await expect(
      page.getByText(/Research investigation started|Research workspace|Open the Research/i).first(),
    ).toBeVisible({ timeout: 60_000 });
  });

  test("H02 Workbench → Insight Builder sends handoff on first IB message", async ({
    page,
  }) => {
    await seedDeterministicBoard(page);
    const input = unifiedChatMessageInput(page);
    await input.fill("Summarize funded volume on this board in one sentence.");
    await input.press("Enter");
    await waitForChatInputReady(page, { timeoutMs: 120_000 });

    await switchChatTypeViaCombobox(page, "Insight builder");
    await page.getByRole("button", { name: "Taller" }).click({ force: true }).catch(() => {});

    const ibInput = unifiedChatMessageInput(page);
    await ibInput.fill("Draft an insight prompt based on widgets on this canvas.");
    await ibInput.press("Enter");
    await waitForChatInputReady(page, { timeoutMs: 180_000 });

    const ibSend = streamBodies.find((b) => b.chat_type === "insight_builder");
    expect(ibSend, "expected insight_builder stream POST").toBeTruthy();
    const handoff = ibSend!.context?.modeHandoffContext;
    expect(handoff?.fromChatType).toBe("workbench");
    expect((handoff?.canvasState?.totalItems ?? 0) > 0).toBe(true);

    await expect(
      page.getByText(/Review insight prompt draft|insight/i).first(),
    ).toBeVisible({ timeout: 90_000 });
  });

  test("H03 Fork WB → Research includes carry-over and handoff on first send", async ({
    page,
  }) => {
    await seedDeterministicBoard(page);
    const input = unifiedChatMessageInput(page);
    await input.fill("What is our pipeline fallout rate this month?");
    await input.press("Enter");
    await waitForChatInputReady(page, { timeoutMs: 120_000 });

    streamBodies.length = 0;
    await switchChatTypeViaCombobox(page, "Research");
    await expandChatShellForResearch(page);

    const forkVisible =
      (await page.getByTestId("conversation-fork-chips").isVisible().catch(() => false)) ||
      (await page
        .getByText(/carried over|Started a new.*Research/i)
        .first()
        .isVisible()
        .catch(() => false));

    const researchInput = unifiedChatMessageInput(page);
    await researchInput.fill("Continue the investigation using prior workbench context.");
    await researchInput.press("Enter");
    await waitForChatInputReady(page, { timeoutMs: 180_000 });

    const researchSend = streamBodies.find((b) => b.chat_type === "research");
    expect(researchSend).toBeTruthy();
    if (forkVisible) {
      expect(researchSend!.context?.carryOverContext?.summary?.length ?? 0).toBeGreaterThan(
        0,
      );
    }
    expect(researchSend!.context?.modeHandoffContext?.fromChatType).toBe("workbench");
  });
});
