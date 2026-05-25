import { expect, type Page } from "@playwright/test";
import {
  gotoWithUnifiedChatShell,
  selectUnifiedChatType,
  unifiedChatMessageInput,
} from "./unifiedChat";

export const BOARD_READY_PROMPT =
  "Prepare a board-ready overview of this month's performance";

export async function openFreshWorkbenchChat(page: Page): Promise<void> {
  await gotoWithUnifiedChatShell(page, "/my-dashboard/new", { timeout: 60_000 });
  await selectUnifiedChatType(page, "Workbench");
}

/** Wait until the canvas has widgets (not the empty state). */
export async function waitForWorkbenchCanvasPopulated(
  page: Page,
  options?: { timeoutMs?: number },
): Promise<void> {
  const timeout = options?.timeoutMs ?? 240_000;
  const canvas = page.locator("#workbench-canvas-root");

  await expect
    .poll(
      async () => {
        const empty = await page
          .getByText("Your canvas is empty")
          .isVisible()
          .catch(() => false);
        if (empty) return 0;

        const headingOnCanvas = await canvas
          .getByRole("heading")
          .first()
          .isVisible()
          .catch(() => false);
        const kpiOnCanvas = await canvas
          .getByText(/Funded Units|Funded Volume|Pull-Through|Margin/i)
          .first()
          .isVisible()
          .catch(() => false);
        const groupOnCanvas = await canvas
          .getByText(/Cohi Dashboard|Executive/i)
          .first()
          .isVisible()
          .catch(() => false);

        return headingOnCanvas || kpiOnCanvas || groupOnCanvas ? 2 : 1;
      },
      { timeout, intervals: [2000, 3000, 5000] },
    )
    .toBeGreaterThan(0);
}

export async function waitForChatInputReady(
  page: Page,
  options?: { timeoutMs?: number },
): Promise<void> {
  const input = unifiedChatMessageInput(page);
  await expect(input).toBeEnabled({ timeout: options?.timeoutMs ?? 120_000 });
}

export async function sendWorkbenchChatTurn(
  page: Page,
  message: string,
): Promise<void> {
  const input = unifiedChatMessageInput(page);
  await input.fill(message);
  await input.press("Enter");
  await expect
    .poll(() => input.isEnabled().catch(() => false), {
      timeout: 240_000,
      intervals: [2000, 3000, 5000],
    })
    .toBe(true);
}

export async function seedBoardReadyDashboard(page: Page): Promise<void> {
  await openFreshWorkbenchChat(page);
  const input = unifiedChatMessageInput(page);
  await input.fill(BOARD_READY_PROMPT);
  await input.press("Enter");
  await waitForWorkbenchCanvasPopulated(page);
  await waitForChatInputReady(page);
}

/** Deterministic canvas via test-only API (requires WORKBENCH_TEST_SEED_ENABLED=1 on server). */
export async function seedDeterministicBoard(
  page: Page,
  fixture: "board-ready-min" = "board-ready-min",
): Promise<string> {
  const base = (page.context().baseURL ?? process.env.E2E_BASE_URL ?? "http://localhost:5000").replace(
    /\/$/,
    "",
  );
  const res = await page.request.post(`${base}/api/cohi-chat/workbench/test-seed`, {
    data: { fixture },
  });
  if (!res.ok()) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `test-seed failed (${res.status()}): ${body.slice(0, 400)} — set WORKBENCH_TEST_SEED_ENABLED=1`,
    );
  }
  const { canvasId } = (await res.json()) as { canvasId: string };
  await gotoWithUnifiedChatShell(page, `/my-dashboard/${canvasId}`, {
    timeout: 60_000,
  });
  await selectUnifiedChatType(page, "Workbench");
  await expect(page.locator('[data-testid^="canvas-item-"]').first()).toBeVisible({
    timeout: 60_000,
  });
  await waitForChatInputReady(page);
  return canvasId;
}

export function attachPresentationStreamWatcher(page: Page): {
  sawGenerateReport: () => boolean;
  sawReportGenerateApi: () => boolean;
  detach: () => void;
} {
  let generateReport = false;
  let reportApi = false;

  const onResponse = async (res: import("@playwright/test").Response) => {
    const url = res.url();
    if (/\/api\/chat\/v1\/messages:stream/.test(url) && res.request().method() === "POST") {
      try {
        const text = await res.text();
        if (/generate_report|"type"\s*:\s*"generate_report"/i.test(text)) {
          generateReport = true;
        }
      } catch {
        /* ignore */
      }
    }
    if (/\/api\/workbench\/reports\/generate/.test(url)) {
      reportApi = true;
    }
  };

  const onRequest = (req: import("@playwright/test").Request) => {
    if (
      req.method() === "POST" &&
      /\/api\/workbench\/reports\/generate/.test(req.url())
    ) {
      reportApi = true;
    }
  };

  page.on("response", onResponse);
  page.on("request", onRequest);

  return {
    sawGenerateReport: () => generateReport,
    sawReportGenerateApi: () => reportApi,
    detach: () => {
      page.off("response", onResponse);
      page.off("request", onRequest);
    },
  };
}
