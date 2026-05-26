/**
 * Maximal workbench/chat regression ledger + shared actions (COHI-398).
 */
import fs from "fs";
import path from "path";
import { expect, type Page } from "@playwright/test";
import {
  captureReconcileTrace,
  formatTraceSuffix,
} from "./reconcileTrace";
import { e2eAuthHeaders } from "./e2eAuth";
import {
  dismissBlockingOverlays,
  dismissWorkbenchScopeSwitchDialogIfOpen,
  ensureWorkbenchChatReady,
  gotoWithUnifiedChatShell,
  gotoWorkbenchHubWithUnifiedShell,
  selectUnifiedChatType,
  unifiedChatMessageInput,
} from "./unifiedChat";
import {
  seedDeterministicBoard,
  seedAdditionalDeterministicBoard,
  waitForChatInputReady,
  sendWorkbenchChatTurn,
} from "./workbenchLive";

export type RegressionStatus = "works" | "broken" | "rough" | "skipped";

export type RegressionRow = {
  id: string;
  wave: string;
  name: string;
  status: RegressionStatus;
  observed: string;
};

export type RegressionSurface =
  | "dashboard_canvas"
  | "dashboard_new"
  | "chat_home"
  | "data_chat"
  | "workbench_hub";

export const REGRESSION_OUT = path.join("test-results", "workbench-regression");
export const REGRESSION_LEDGER = path.join(REGRESSION_OUT, "LEDGER.md");
export const REGRESSION_SIGNOFF = path.join(REGRESSION_OUT, "SIGNOFF.md");

const ledgerRows: RegressionRow[] = [];

export function initRegressionLedger(wave: string): void {
  fs.mkdirSync(REGRESSION_OUT, { recursive: true });
  const header = `# Workbench regression ledger — ${wave}\n\n| ID | Wave | Case | Status | Observed |\n|----|------|------|--------|----------|\n`;
  if (!fs.existsSync(REGRESSION_LEDGER)) {
    fs.writeFileSync(REGRESSION_LEDGER, `# Workbench maximal regression\n\n`);
  }
  fs.appendFileSync(REGRESSION_LEDGER, `\n## ${wave}\n\n${header}`);
}

export async function recordRegression(
  page: Page,
  row: Omit<RegressionRow, "observed"> & { observed: string },
  tracePrompt?: string,
): Promise<void> {
  let observed = row.observed.replace(/\|/g, "/");
  if ((row.status === "broken" || row.status === "rough") && tracePrompt) {
    const capture = await captureReconcileTrace(page, tracePrompt);
    observed += formatTraceSuffix(capture);
  }
  const full: RegressionRow = { ...row, observed };
  ledgerRows.push(full);
  fs.appendFileSync(
    REGRESSION_LEDGER,
    `| ${full.id} | ${full.wave} | ${full.name} | **${full.status}** | ${observed} |\n`,
  );
  console.log(`\n[${full.id}] ${full.name}: ${full.status}\n  → ${observed}`);
  if (full.status === "broken") {
    expect.soft(false, `${full.id}: ${observed}`).toBe(true);
  }
}

export function writeSignoffReport(): void {
  const broken = ledgerRows.filter((r) => r.status === "broken");
  const rough = ledgerRows.filter((r) => r.status === "rough");
  const skipped = ledgerRows.filter((r) => r.status === "skipped");
  const works = ledgerRows.filter((r) => r.status === "works");
  const allGreen = broken.length === 0 && rough.length === 0;
  const body = [
    `# Workbench regression sign-off`,
    ``,
    `Generated: ${new Date().toISOString()}`,
    ``,
    `- Total: ${ledgerRows.length}`,
    `- Works: ${works.length}`,
    `- Broken: ${broken.length}`,
    `- Rough: ${rough.length}`,
    `- Skipped: ${skipped.length}`,
    ``,
    allGreen ? `## ALL GREEN` : `## NOT READY`,
    ``,
    broken.length
      ? `### Broken\n${broken.map((r) => `- ${r.id}: ${r.observed}`).join("\n")}\n`
      : "",
  ].join("\n");
  fs.writeFileSync(REGRESSION_SIGNOFF, body);
}

export async function skipIfLoggedOut(page: Page): Promise<void> {
  const login = await page
    .getByText(/Sign in to access your dashboard/i)
    .isVisible()
    .catch(() => false);
  if (login) {
    throw new Error("E2E auth expired — run: npx tsx e2e/manual-auth-setup.ts");
  }
}

export function watchConversationListRequests(page: Page): {
  urls: string[];
  detach: () => void;
} {
  const urls: string[] = [];
  const handler = (req: { url: () => string }) => {
    if (req.url().includes("/api/chat/v1/conversations")) {
      urls.push(req.url());
    }
  };
  page.on("request", handler);
  return {
    urls,
    detach: () => page.off("request", handler),
  };
}

export async function waitForCanvasScopedConversation(
  page: Page,
  canvasId: string,
  titleSnippet?: string,
): Promise<void> {
  const base = (
    page.context().baseURL ??
    process.env.E2E_BASE_URL ??
    "http://localhost:5000"
  ).replace(/\/$/, "");
  const headers = await e2eAuthHeaders(page);
  const draftScopeId = `canvas-tab:${canvasId}`;
  await expect
    .poll(
      async () => {
        const scopes: Array<{ type: string; key: string }> = [
          { type: "canvas", key: canvasId },
          { type: "draft", key: draftScopeId },
        ];
        for (const { type, key } of scopes) {
          const res = await page.request.get(
            `${base}/api/chat/v1/conversations?scope_type=${type}&scope_key=${encodeURIComponent(key)}&chat_type=workbench&limit=25`,
            { headers },
          );
          if (!res.ok()) continue;
          const rows = (await res.json()) as Array<{ title?: string }>;
          if (!Array.isArray(rows) || rows.length === 0) continue;
          if (!titleSnippet) return true;
          if (rows.some((r) => (r.title ?? "").includes(titleSnippet))) return true;
        }
        return false;
      },
      { timeout: 120_000 },
    )
    .toBe(true);
}

export function assertCanvasScopedHistoryFetch(recentUrls: string[]): void {
  const hasScoped = recentUrls.some(
    (u) =>
      (u.includes("scope_type=draft") || u.includes("scope_type=canvas")) &&
      u.includes("chat_type=workbench"),
  );
  const hasGlobal = recentUrls.some((u) => u.includes("scope_type=global_session"));
  expect(hasScoped).toBe(true);
  expect(hasGlobal).toBe(false);
}

/**
 * Wait for canvas-scoped conversation list fetches after opening history.
 * Attaches the request watcher after setup so seed/workbench prefetch (often cached)
 * does not consume the marker before the history panel opens.
 */
export async function waitForScopedCanvasHistoryFetch(
  page: Page,
  options?: { timeoutMs?: number },
): Promise<string[]> {
  const timeout = options?.timeoutMs ?? 20_000;
  const watcher = watchConversationListRequests(page);
  try {
    const marker = watcher.urls.length;
    const openAndPoll = async (): Promise<string[]> => {
      await openCanvasHistory(page);
      await expect(page.getByTestId("chat-history-sidebar")).toBeVisible({
        timeout: 20_000,
      });
      let recent: string[] = [];
      await expect
        .poll(
          () => {
            recent = watcher.urls.slice(marker);
            if (!recent.length) return false;
            try {
              assertCanvasScopedHistoryFetch(recent);
              return true;
            } catch {
              return false;
            }
          },
          { timeout },
        )
        .toBe(true);
      return recent;
    };

    try {
      return await openAndPoll();
    } catch {
      await closeCanvasHistoryIfOpen(page);
      return await openAndPoll();
    }
  } finally {
    watcher.detach();
    await closeCanvasHistoryIfOpen(page);
  }
}

export async function gotoRegressionSurface(
  page: Page,
  surface: RegressionSurface,
  canvasId?: string,
): Promise<void> {
  switch (surface) {
    case "dashboard_canvas":
      if (!canvasId) {
        await seedDeterministicBoard(page);
      } else {
        await gotoWithUnifiedChatShell(page, `/my-dashboard/${canvasId}`, {
          timeout: 60_000,
        });
        await selectUnifiedChatType(page, "Workbench");
        await waitForChatInputReady(page);
      }
      break;
    case "dashboard_new":
      await gotoWithUnifiedChatShell(page, "/my-dashboard/new", { timeout: 60_000 });
      await selectUnifiedChatType(page, "Workbench");
      break;
    case "chat_home":
      await gotoWithUnifiedChatShell(page, "/", { timeout: 60_000 });
      break;
    case "data_chat":
      await page.goto("/data-chat", { waitUntil: "domcontentloaded" });
      break;
    case "workbench_hub":
      await gotoWorkbenchHubWithUnifiedShell(page, "/workbench/favorites", {
        timeout: 60_000,
      });
      break;
    default:
      break;
  }
  await dismissBlockingOverlays(page);
}

export async function clickNewChatThread(page: Page): Promise<void> {
  await dismissWorkbenchScopeSwitchDialogIfOpen(page, "switch");
  await ensureWorkbenchChatReady(page);
  await page
    .getByRole("button", { name: /New chat thread on this canvas/i })
    .click({ timeout: 30_000 });
  await waitForChatInputReady(page);
}

export async function openCanvasHistory(page: Page): Promise<void> {
  await dismissWorkbenchScopeSwitchDialogIfOpen(page, "switch");
  await dismissBlockingOverlays(page);
  const toggle = page.getByTestId("cohi-chat-history-toggle");
  await expect(toggle).toBeVisible({ timeout: 20_000 });
  await toggle.click({ force: true });
  await expect(page.getByTestId("chat-history-sidebar")).toBeVisible({
    timeout: 20_000,
  });
}

export async function closeCanvasHistoryIfOpen(page: Page): Promise<void> {
  const sidebar = page.getByTestId("chat-history-sidebar");
  if (await sidebar.isVisible({ timeout: 500 }).catch(() => false)) {
    await page.keyboard.press("Escape");
    await expect(sidebar).toBeHidden({ timeout: 10_000 });
  }
}

export async function openCanvasThreadsButton(page: Page): Promise<void> {
  const btn = page.getByTestId("workbench-chat-scope-chip");
  await expect(btn).toBeVisible({ timeout: 20_000 });
  await btn.click();
  await expect(page.getByTestId("chat-history-sidebar")).toBeVisible({
    timeout: 20_000,
  });
}

export function chatPanelMessage(page: Page, text: string) {
  return page.getByTestId("cohi-chat-panel").filter({ hasText: text });
}

/** Send on canvas A, wait for scope persistence, open canvas B, expect tab-switch dialog. */
export async function triggerTabSwitchScopeDialog(
  page: Page,
  options?: { message?: string; canvasA?: string },
): Promise<{ canvasA: string; canvasB: string }> {
  const message =
    options?.message ?? "Summarize this board in one sentence.";
  const canvasA = options?.canvasA ?? (await seedDeterministicBoard(page));
  await selectUnifiedChatType(page, "Workbench");
  await sendDashboardTurn(page, message, { waitForReply: false });
  await expect
    .poll(
      async () => {
        const persisted = await page.evaluate(() =>
          sessionStorage.getItem("cohi_workbench_conversation_scope"),
        );
        if (persisted) return true;
        return page
          .getByTestId("workbench-chat-scope-chip")
          .isVisible()
          .catch(() => false);
      },
      { timeout: 90_000 },
    )
    .toBe(true);
  const canvasB = await seedAdditionalDeterministicBoard(page);
  expect(canvasB).not.toBe(canvasA);
  await selectUnifiedChatType(page, "Workbench");
  const dialog = page.getByTestId("workbench-scope-switch-dialog");
  await expect(dialog).toBeVisible({ timeout: 45_000 });
  return { canvasA, canvasB };
}

export async function sendDashboardTurn(
  page: Page,
  message: string,
  options?: {
    waitForReply?: boolean;
    waitForStream?: boolean;
  },
): Promise<void> {
  await dismissBlockingOverlays(page);
  await sendWorkbenchChatTurn(page, message, options);
}

export {
  seedDeterministicBoard,
  seedAdditionalDeterministicBoard,
  selectUnifiedChatType,
  unifiedChatMessageInput,
  waitForChatInputReady,
};
