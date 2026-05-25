import type { APIRequestContext, Page } from "@playwright/test";

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

/**
 * Fetch last reconcile pipeline entries from the backend (requires WORKBENCH_RECONCILE_DEBUG=1).
 */
function resolveTraceBaseURL(
  request: APIRequestContext,
  options?: { baseURL?: string; page?: Page },
): string {
  if (options?.baseURL) return options.baseURL.replace(/\/$/, "");
  if (options?.page) {
    try {
      const fromContext = options.page.context().baseURL;
      if (fromContext) return fromContext.replace(/\/$/, "");
    } catch {
      /* ignore */
    }
  }
  return (process.env.E2E_BASE_URL ?? "http://localhost:5000").replace(/\/$/, "");
}

export async function captureReconcileTrace(
  request: APIRequestContext,
  prompt: string,
  options?: { baseURL?: string; page?: Page; limit?: number },
): Promise<string> {
  const base = resolveTraceBaseURL(request, options);
  const limit = options?.limit ?? 12;
  const needle = prompt.trim().slice(0, 40).toLowerCase();
  if (!needle) return "";

  try {
    const res = await request.get(
      `${base}/api/cohi-chat/workbench/reconcile-trace?n=${limit}`,
    );
    if (res.status() === 404) {
      console.warn(
        "[reconcile-trace] disabled — set WORKBENCH_RECONCILE_DEBUG=1 on the backend process",
      );
      return "";
    }
    if (!res.ok()) return "";
    const body = (await res.json()) as { entries?: TraceEntry[] };
    const entries = body.entries ?? [];
    const match =
      [...entries].reverse().find((e) =>
        e.question.toLowerCase().includes(needle),
      ) ?? entries[entries.length - 1];
    if (!match) return "";
    return JSON.stringify(match.actions);
  } catch {
    return "";
  }
}
