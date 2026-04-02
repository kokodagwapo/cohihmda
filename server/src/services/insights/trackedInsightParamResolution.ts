/**
 * Resolves bound parameters for tracked-insight metric_signature SQL templates
 * when using rolling dashboard windows (datePeriod + page semantics).
 */

import { getDateRangeForTimeframe } from "../dashboard/analyticsService.js";
import { computeCompanyScorecardPeriodDateRange } from "../dashboardInsights/datePeriodRange.js";

export type ParamResolutionKind = "none" | "rolling_dashboard";

export type TrackedInsightParamResolutionInput = {
  source_type?: string;
  metric_signature: {
    sql?: string;
    params?: unknown[];
    param_resolution?: ParamResolutionKind | string;
  };
  display_metadata?: {
    filter_context_snapshot?: Record<string, unknown>;
    source_page_id?: string;
  } | null;
};

function toYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Returns bind-parameter array for `metric_signature.sql`, or `undefined` when
 * the query has no placeholders (static SQL) or uses static `metric_signature.params`.
 */
export function resolveTrackedInsightSqlParams(
  insight: TrackedInsightParamResolutionInput
): unknown[] | undefined {
  const sig = insight.metric_signature;
  const pr = sig.param_resolution;

  if (pr !== "rolling_dashboard") {
    if (sig.params && sig.params.length > 0) return [...sig.params];
    return undefined;
  }

  const fc = insight.display_metadata?.filter_context_snapshot ?? {};
  const pageId = String(insight.display_metadata?.source_page_id ?? "");
  const datePeriodRaw = String(fc.datePeriod ?? "ytd").toLowerCase();

  if (pageId === "company-scorecard") {
    const { start, end } = computeCompanyScorecardPeriodDateRange(datePeriodRaw);
    return [start, end];
  }

  if (pageId === "leaderboard") {
    const allowed = new Set([
      "wtd",
      "mtd",
      "qtd",
      "ytd",
      "lm",
      "lq",
      "ly",
      "rolling_13",
    ]);
    const tf = (allowed.has(datePeriodRaw) ? datePeriodRaw : "ytd") as
      | "wtd"
      | "mtd"
      | "qtd"
      | "ytd"
      | "lm"
      | "lq"
      | "ly"
      | "rolling_13";
    const { start, end } = getDateRangeForTimeframe(tf);
    return [toYmd(start), toYmd(end)];
  }

  return undefined;
}
