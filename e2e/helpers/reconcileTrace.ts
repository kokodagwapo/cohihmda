import type { Page } from "@playwright/test";

type TraceEntry = {
  ts: string;
  question: string;
  actions: Array<{
    type?: string;
    groupId?: string;
    widgetId?: string;
    chartType?: string;
    op?: string;
  }>;
};

export type ReconcileTraceCapture =
  | { status: "ok"; trace: string }
  | { status: "auth_failed" | "disabled" | "empty"; trace: "" };

/**
 * Fetch last reconcile pipeline entries from the backend (requires WORKBENCH_RECONCILE_DEBUG=1).
 * Uses page.request so BrowserContext auth cookies are included.
 */
export async function captureReconcileTrace(
  page: Page,
  prompt: string,
  options?: { limit?: number },
): Promise<ReconcileTraceCapture> {
  const base = (page.context().baseURL ?? process.env.E2E_BASE_URL ?? "http://localhost:5000").replace(
    /\/$/,
    "",
  );
  const limit = options?.limit ?? 12;
  const needle = prompt.trim().slice(0, 40).toLowerCase();
  if (!needle) return { status: "empty", trace: "" };

  try {
    const res = await page.request.get(
      `${base}/api/cohi-chat/workbench/reconcile-trace?n=${limit}`,
    );
    if (res.status() === 404) {
      console.warn(
        "[reconcile-trace] disabled — set WORKBENCH_RECONCILE_DEBUG=1 on the backend process",
      );
      return { status: "disabled", trace: "" };
    }
    if (res.status() === 401 || res.status() === 403) {
      console.warn(
        `[reconcile-trace] auth failed (${res.status}) — Playwright page.request lacks session cookies`,
      );
      return { status: "auth_failed", trace: "" };
    }
    if (!res.ok()) return { status: "empty", trace: "" };
    const body = (await res.json()) as { entries?: TraceEntry[] };
    const entries = body.entries ?? [];
    const match =
      [...entries].reverse().find((e) =>
        e.question.toLowerCase().includes(needle),
      ) ?? entries[entries.length - 1];
    if (!match) return { status: "empty", trace: "" };
    return { status: "ok", trace: JSON.stringify(match.actions) };
  } catch {
    return { status: "empty", trace: "" };
  }
}

/** Append trace suffix for REPORT rows (broken/rough). */
export function formatTraceSuffix(capture: ReconcileTraceCapture): string {
  if (capture.status === "ok" && capture.trace) {
    return ` | trace=${capture.trace}`;
  }
  if (capture.status === "auth_failed") return " | trace=AUTH_FAILED";
  if (capture.status === "disabled") return " | trace=DISABLED";
  return "";
}
