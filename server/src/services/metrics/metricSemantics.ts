/**
 * Snapshot vs windowed metric semantics for composer, Research, and UI guardrails.
 */

import { METRICS_CATALOG } from "./metricsService.js";
import type { MetricSpec } from "./metricSpec.js";

export type MetricScope = "snapshot" | "windowed";

/** Column names that label a timeframe row in multi-period tables. */
export const TIMEFRAME_PERIOD_COLUMNS = new Set([
  "timeframe",
  "period",
  "window",
  "date_range",
  "time_window",
  "comparison_period",
]);

export const SNAPSHOT_METRIC_IDS: readonly string[] = Object.freeze(
  Object.keys(METRICS_CATALOG).filter((id) => METRICS_CATALOG[id]?.ignoreDateFilter),
);

export function isSnapshotMetricId(metricId: string): boolean {
  return Boolean(METRICS_CATALOG[metricId]?.ignoreDateFilter);
}

export function getMetricScope(metricId: string): MetricScope {
  return isSnapshotMetricId(metricId) ? "snapshot" : "windowed";
}

/** Warnings when a MetricSpec applies a date window to snapshot-only metrics. */
export function validateMetricSpecWindows(spec: MetricSpec): string[] {
  const warnings: string[] = [];
  const win = spec.window ?? "all_time";
  if (win === "all_time") return warnings;

  for (const id of spec.metricIds) {
    if (isSnapshotMetricId(id)) {
      warnings.push(
        `Metric "${id}" is a current-snapshot metric; window "${win}" is ignored. ` +
          `Do not repeat snapshot metrics across timeframe rows — show once with label "snapshot (as of today)".`,
      );
    }
  }
  return warnings;
}

/**
 * Detect numeric columns that are identical across distinct period labels
 * (typical snapshot metrics pasted into a multi-timeframe table).
 */
export function detectSnapshotColumnsInTimeframeTable(
  fields: string[],
  rows: Record<string, unknown>[],
): string[] {
  const periodField = fields.find((f) =>
    TIMEFRAME_PERIOD_COLUMNS.has(f.toLowerCase()),
  );
  if (!periodField || rows.length < 2) return [];

  const distinctPeriods = new Set(
    rows.map((r) => String(r[periodField] ?? "").trim()),
  );
  if (distinctPeriods.size < 2) return [];

  const snapshotCols: string[] = [];
  for (const field of fields) {
    if (field === periodField) continue;
    const values = rows.map((r) => r[field]);
    if (values.length < 2) continue;
    const first = values[0];
    if (first == null) continue;
    const allEqual = values.every((v) => v === first);
    if (!allEqual) continue;

    const fl = field.toLowerCase();
    if (
      /active|stale/.test(fl) &&
      (fl.includes("loan") || fl.includes("volume") || fl.includes("rate"))
    ) {
      snapshotCols.push(field);
    }
  }
  return snapshotCols;
}

export function formatMetricDefinitionsForResearch(): string {
  const snapshot: string[] = [];
  const windowed: string[] = [];

  for (const [id, def] of Object.entries(METRICS_CATALOG)) {
    const line =
      `- **${def.name}** (\`${id}\`): ${def.description}` +
      (def.ignoreDateFilter
        ? " **[SNAPSHOT — not comparable across YTD/90D/30D rows]**"
        : " **[WINDOWED — filter by date cohort]**");
    if (def.ignoreDateFilter) snapshot.push(line);
    else windowed.push(line);
  }

  return [
    "## Metric scope (CRITICAL for multi-timeframe tables)",
    "",
    "### Snapshot metrics (current state — show ONCE, not per period row)",
    ...snapshot,
    "",
    "### Windowed metrics (cohort / period comparisons)",
    ...windowed.slice(0, 40),
    windowed.length > 40
      ? `\n_(${windowed.length - 40} additional windowed metrics omitted — use metricSpec or SQL for others.)_`
      : "",
  ].join("\n");
}
