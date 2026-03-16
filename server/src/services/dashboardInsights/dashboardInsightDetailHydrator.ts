/**
 * Dashboard Insight Detail Hydrator
 *
 * Builds a DetailData-shaped snapshot (detail_data) from supporting_data and ETM
 * so the same details API and InsightDetailModal can render dashboard insights.
 */

import type {
  DashboardInsight,
  SupportingData,
  SupportingDataByPeriodRow,
  DashboardDetailSnapshot,
  DashboardDetailSnapshotColumnDef,
  DashboardDetailSnapshotSummaryDef,
  DashboardDetailSnapshotAudit,
} from "./types.js";

const COLUMN_DEFS: Record<string, { label: string; format: DashboardDetailSnapshotColumnDef["format"] }> = {
  period: { label: "Period", format: "text" },
  periodLabel: { label: "Period", format: "text" },
  averagePullThrough: { label: "Pull-through", format: "percent" },
  totalUnits: { label: "Units", format: "number" },
  totalVolume: { label: "Volume", format: "currency" },
  topPerformerName: { label: "Top performer", format: "text" },
  topPerformerUnits: { label: "Top performer units", format: "number" },
  topPerformerVolume: { label: "Top performer volume", format: "currency" },
};

/**
 * Build detail_data snapshot from an insight and its supporting_data (by-period).
 * No SQL; rows and summary come from existing context.
 */
export function buildDetailFromSupportingData(
  insight: DashboardInsight,
  supportingData: SupportingData | undefined,
  options?: { generationBatch?: string; dateFilter?: string }
): DashboardDetailSnapshot | null {
  const byPeriod = supportingData?.byPeriod;
  if (!byPeriod || byPeriod.length === 0) return null;

  const rows: Array<Record<string, unknown>> = byPeriod.map((row: SupportingDataByPeriodRow) => {
    const out: Record<string, unknown> = {
      period: row.period,
      periodLabel: row.periodLabel ?? row.period,
    };
    if (row.averagePullThrough != null) out.averagePullThrough = row.averagePullThrough;
    if (row.totalUnits != null) out.totalUnits = row.totalUnits;
    if (row.totalVolume != null) out.totalVolume = row.totalVolume;
    if (row.topPerformerName != null) out.topPerformerName = row.topPerformerName;
    if (row.topPerformerUnits != null) out.topPerformerUnits = row.topPerformerUnits;
    if (row.topPerformerVolume != null) out.topPerformerVolume = row.topPerformerVolume;
    return out;
  });

  const allKeys = new Set<string>();
  rows.forEach((r) => Object.keys(r).forEach((k) => allKeys.add(k)));
  const columnKeys = ["period", "periodLabel", "averagePullThrough", "totalUnits", "totalVolume", "topPerformerName", "topPerformerUnits", "topPerformerVolume"];
  const orderedKeys = columnKeys.filter((k) => allKeys.has(k));
  if (orderedKeys.length === 0) orderedKeys.push(...Array.from(allKeys));

  const column_defs: DashboardDetailSnapshotColumnDef[] = orderedKeys.map((key) => {
    const def = COLUMN_DEFS[key] ?? { label: key, format: "text" as const };
    return {
      key,
      label: def.label,
      format: def.format,
      align: def.format === "text" ? "left" : "right",
    };
  });

  const first = byPeriod[0];
  const summaryDefs: DashboardDetailSnapshotSummaryDef[] = [];
  if (first?.averagePullThrough != null) {
    summaryDefs.push({ key: "averagePullThrough", label: "Pull-through", value: first.averagePullThrough, format: "percent", color: "blue" });
  }
  if (first?.totalUnits != null) {
    summaryDefs.push({ key: "totalUnits", label: "Units", value: first.totalUnits, format: "number", color: "blue" });
  }
  if (first?.totalVolume != null) {
    summaryDefs.push({ key: "totalVolume", label: "Volume", value: first.totalVolume, format: "currency", color: "blue" });
  }
  const summary: Record<string, unknown> = {};
  summaryDefs.forEach((s) => {
    summary[s.key] = s.value;
  });

  const etm =
    insight.what_changed || insight.why || insight.business_impact
      ? {
          what_changed: insight.what_changed,
          why: insight.why,
          business_impact: insight.business_impact,
          risk_if_ignored: insight.risk_if_ignored,
          recommended_action: insight.recommended_action,
          owner: insight.owner,
        }
      : undefined;

  const audit: DashboardDetailSnapshotAudit = {
    generatedSql: "",
    rowCount: rows.length,
    rawSummary: summaryDefs,
    resolvedSummary: summaryDefs,
    finalSummary: summaryDefs,
    corrections: [],
    pipelineContext: options
      ? {
          generationBatch: options.generationBatch,
          dateFilter: options.dateFilter,
          stepTimings: { evidence: 0, total: 0 },
        }
      : undefined,
  };

  return {
    title: insight.headline || "Leaderboard by period",
    summary,
    rows,
    displayConfig: {
      columns: orderedKeys,
      summaryMetrics: summaryDefs.map((s) => s.key),
      column_defs,
      summary_defs: summaryDefs,
    },
    etm,
    audit,
  };
}
