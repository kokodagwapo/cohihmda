/**
 * Maps MetricSpec → deterministic catalog SQL + metadata.
 */

import type { MetricSpec } from "./metricSpec.js";
import type { LoanAccessFilter } from "../userLoanAccessService.js";
import type { DateRange, MetricQueryOptions } from "./metricsService.js";
import {
  METRICS_CATALOG,
  composeCatalogMetricGroupedSql,
  composeCatalogMetricSnapshotSql,
  type GroupByField,
} from "./metricsService.js";
import {
  buildSegmentedPullThroughQuery,
  type PullThroughSegment,
  type PullThroughWindow,
} from "./canonicalMetrics.js";
import {
  isSnapshotMetricId,
  validateMetricSpecWindows,
} from "./metricSemantics.js";

export interface ComposerResult {
  sql: string;
  params: unknown[];
  resolvedMetricIds: string[];
  resolvedDimensions: string[];
  windowLabel: string;
  warnings: string[];
  estimatedComplexity: "low" | "medium" | "high";
}

function windowToDateRange(
  window: MetricSpec["window"],
  custom?: { start: string; end: string }
): DateRange | undefined {
  if (!window || window === "all_time") return undefined;
  if (window === "custom" && custom?.start && custom?.end) {
    return { start: custom.start, end: custom.end };
  }
  const now = new Date();
  const iso = (d: Date) => d.toISOString().split("T")[0];
  const DAY = 86400000;

  switch (window) {
    case "this_quarter": {
      const q = Math.floor(now.getMonth() / 3);
      const start = new Date(now.getFullYear(), q * 3, 1);
      const end = new Date(now.getFullYear(), q * 3 + 3, 0);
      return { start: iso(start), end: iso(end) };
    }
    case "last_quarter": {
      let q = Math.floor(now.getMonth() / 3) - 1;
      let y = now.getFullYear();
      if (q < 0) {
        q += 4;
        y -= 1;
      }
      const start = new Date(y, q * 3, 1);
      const end = new Date(y, q * 3 + 3, 0);
      return { start: iso(start), end: iso(end) };
    }
    case "ytd":
      return {
        start: iso(new Date(now.getFullYear(), 0, 1)),
        end: iso(now),
      };
    case "last_90_days":
      return {
        start: iso(new Date(now.getTime() - 90 * DAY)),
        end: iso(now),
      };
    case "this_month":
      return {
        start: iso(new Date(now.getFullYear(), now.getMonth(), 1)),
        end: iso(now),
      };
    case "last_month": {
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const end = new Date(now.getFullYear(), now.getMonth(), 0);
      return { start: iso(start), end: iso(end) };
    }
    default:
      return undefined;
  }
}

function mapPullThroughWindow(w: MetricSpec["window"]): PullThroughWindow {
  switch (w) {
    case "this_quarter":
      return "this_quarter";
    case "last_quarter":
      return "last_quarter";
    case "ytd":
      return "ytd";
    case "last_90_days":
      return "last_90_days";
    case "this_month":
      return "this_month";
    case "last_month":
      return "this_month";
    case "custom":
    case "all_time":
    default:
      return "all_time";
  }
}

/**
 * Compose deterministic SQL from a validated MetricSpec.
 */
export function composeMetricSql(
  spec: MetricSpec,
  accessFilter?: LoanAccessFilter | null
): ComposerResult {
  const warnings: string[] = [...validateMetricSpecWindows(spec)];
  if (spec.unsupported) {
    throw new Error(spec.unsupportedReason || "unsupported_spec");
  }

  const resolvedMetricIds = [...spec.metricIds];
  const resolvedDimensions = spec.dimensions ?? [];

  const dateRange = windowToDateRange(
    spec.window ?? "all_time",
    spec.window === "custom" &&
      spec.customRange?.start &&
      spec.customRange?.end
      ? { start: spec.customRange.start, end: spec.customRange.end }
      : undefined
  );
  const snapshotOnly =
    resolvedMetricIds.length > 0 &&
    resolvedMetricIds.every((id) => isSnapshotMetricId(id));
  const windowLabel = snapshotOnly
    ? "snapshot (as of today)"
    : spec.window === "custom" && spec.customRange
      ? `${spec.customRange.start}–${spec.customRange.end}`
      : spec.window ?? "all_time";

  const baseOptions: MetricQueryOptions = {
    dateRange,
    additionalFilters: spec.filters as Record<string, unknown> | undefined,
    userAccessFilter: accessFilter ?? undefined,
  };

  if (spec.pullThroughSegment && spec.metricIds.includes("pull_through_rate")) {
    const pt = buildSegmentedPullThroughQuery({
      segment: spec.pullThroughSegment as PullThroughSegment,
      window: mapPullThroughWindow(spec.window ?? "all_time"),
      topN: spec.topN ?? null,
      minCompleted: 5,
      accessFilter: accessFilter ?? undefined,
    });
    return {
      sql: pt.sql,
      params: pt.params,
      resolvedMetricIds: ["pull_through_rate"],
      resolvedDimensions: [spec.pullThroughSegment],
      windowLabel: pt.windowLabel,
      warnings,
      estimatedComplexity: "medium",
    };
  }

  if (resolvedMetricIds.length !== 1) {
    warnings.push(
      "Multiple metricIds — using first only for snapshot/grouped compose."
    );
  }

  const metricId = resolvedMetricIds[0];
  if (!METRICS_CATALOG[metricId]) {
    throw new Error(`Unknown metric id: ${metricId}`);
  }

  if (resolvedDimensions.length >= 1) {
    const dim = resolvedDimensions[0] as GroupByField;
    const { sql, params, effectiveGroupBy } = composeCatalogMetricGroupedSql(
      metricId,
      dim,
      baseOptions
    );
    return {
      sql,
      params,
      resolvedMetricIds: [metricId],
      resolvedDimensions: [effectiveGroupBy],
      windowLabel: String(windowLabel),
      warnings,
      estimatedComplexity: "medium",
    };
  }

  const { sql, params } = composeCatalogMetricSnapshotSql(metricId, baseOptions);
  return {
    sql,
    params,
    resolvedMetricIds: [metricId],
    resolvedDimensions: [],
    windowLabel: String(windowLabel),
    warnings,
    estimatedComplexity: "low",
  };
}
