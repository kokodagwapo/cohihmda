/**
 * Dashboard Insight Detail Hydrator
 *
 * Builds a DetailData-shaped snapshot (detail_data) from supporting_data and ETM
 * so the same details API and InsightDetailModal can render dashboard insights.
 * When subjectName and context are provided, builds person-focused rows (that
 * subject's metrics across periods) instead of aggregate top-performer rows.
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
import type { DashboardPageContext } from "./types.js";

/** Primary evidence widget → pivotSlices key (aligned with pipeline adapter) */
const LC_PIVOT_WIDGET_DIM: Record<string, string> = {
  "loan-complexity-pivot-loan-officer": "loan_officer",
  "loan-complexity-pivot-processor": "processor",
  "loan-complexity-pivot-underwriter": "underwriter",
  "loan-complexity-pivot-closer": "closer",
  "loan-complexity-pivot-branch": "branch",
  "loan-complexity-pivot-current-loan-status": "current_loan_status",
};

function getLoanComplexityPivotDimFromInsight(insight: DashboardInsight): string {
  for (const r of insight.evidence_refs ?? []) {
    const dim = LC_PIVOT_WIDGET_DIM[r.widgetId];
    if (dim) return dim;
  }
  return "loan_officer";
}

const COLUMN_DEFS: Record<string, { label: string; format: DashboardDetailSnapshotColumnDef["format"] }> = {
  period: { label: "Period", format: "text" },
  periodLabel: { label: "Period", format: "text" },
  averagePullThrough: { label: "Pull-through", format: "percent" },
  pullThroughRate: { label: "Pull-through", format: "percent" },
  portfolioWaComplexity: { label: "WA complexity", format: "number" },
  portfolioPullThrough: { label: "Pull-through", format: "percent" },
  waComplexity: { label: "WA complexity", format: "number" },
  timeInMotionDays: { label: "Time in motion (days)", format: "days" },
  totalUnits: { label: "Units", format: "number" },
  loansClosed: { label: "Units", format: "number" },
  totalVolume: { label: "Volume", format: "currency" },
  topPerformerName: { label: "Top performer", format: "text" },
  topPerformerUnits: { label: "Top performer units", format: "number" },
  topPerformerVolume: { label: "Top performer volume", format: "currency" },
  name: { label: "Name", format: "text" },
  rank: { label: "Rank", format: "number" },
};

/** Leaderboard entry shape from context.data.by_time_period[period].leaderboard */
interface LeaderboardEntry {
  name?: string;
  branch?: string;
  rank?: number;
  loansClosed?: number;
  loansStarted?: number;
  totalVolume?: number;
  pullThroughRate?: number;
  delta?: unknown;
}

/**
 * Build person-focused rows from context.by_time_period: one row per period with
 * the subject's metrics. Returns null if subject not found in any period.
 */
function buildSubjectRows(
  context: DashboardPageContext,
  subjectName: string
): Array<Record<string, unknown>> | null {
  const byPeriod = context.data?.by_time_period as Record<
    string,
    { periodLabel?: string; leaderboard?: LeaderboardEntry[] }
  > | undefined;
  if (!byPeriod || typeof byPeriod !== "object") return null;

  const normalizedSubject = subjectName.trim();
  const rows: Array<Record<string, unknown>> = [];

  for (const [period, data] of Object.entries(byPeriod)) {
    const leaderboard = data?.leaderboard;
    if (!Array.isArray(leaderboard)) continue;
    const entry = leaderboard.find(
      (e) => e?.name != null && String(e.name).trim() === normalizedSubject
    );
    if (!entry) continue;
    rows.push({
      period,
      periodLabel: data.periodLabel ?? period,
      name: entry.name,
      rank: entry.rank,
      pullThroughRate: entry.pullThroughRate,
      loansClosed: entry.loansClosed,
      totalVolume: entry.totalVolume,
    });
  }
  return rows.length > 0 ? rows : null;
}

type LoanComplexityPivotSliceRow = {
  groupName?: string;
  units?: number;
  waComplexity?: number | null;
  timeInMotionDays?: number | null;
};

/**
 * Subject-focused rows for loan complexity: WA complexity across periods for a pivot slice (e.g. loan_officer, branch).
 */
function buildLoanComplexitySubjectRows(
  context: DashboardPageContext,
  subjectName: string,
  pivotKey: string = "loan_officer"
): Array<Record<string, unknown>> | null {
  const byPeriod = context.data?.by_time_period as
    | Record<
        string,
        {
          periodLabel?: string;
          pivotSlices?: Record<string, LoanComplexityPivotSliceRow[]>;
        }
      >
    | undefined;
  if (!byPeriod || typeof byPeriod !== "object") return null;

  const normalized = subjectName.trim();
  const rows: Array<Record<string, unknown>> = [];

  for (const [period, data] of Object.entries(byPeriod)) {
    const slice = data.pivotSlices?.[pivotKey];
    if (!Array.isArray(slice)) continue;
    const entry = slice.find(
      (e) => e?.groupName != null && String(e.groupName).trim() === normalized
    );
    if (!entry) continue;
    rows.push({
      period,
      periodLabel: data.periodLabel ?? period,
      name: entry.groupName,
      waComplexity: entry.waComplexity ?? null,
      units: entry.units ?? null,
      timeInMotionDays: entry.timeInMotionDays ?? null,
    });
  }
  return rows.length > 0 ? rows : null;
}

const AGGREGATE_COLUMN_ORDER = [
  "period", "periodLabel", "averagePullThrough", "totalUnits", "totalVolume",
  "topPerformerName", "topPerformerUnits", "topPerformerVolume",
];
const AGGREGATE_COMPLEXITY_COLUMN_ORDER = [
  "period",
  "periodLabel",
  "portfolioWaComplexity",
  "averagePullThrough",
  "portfolioPullThrough",
  "totalUnits",
];
const SUBJECT_COLUMN_ORDER = [
  "period", "periodLabel", "name", "rank", "pullThroughRate", "loansClosed", "totalVolume",
];
const SUBJECT_COMPLEXITY_COLUMN_ORDER = [
  "period",
  "periodLabel",
  "name",
  "waComplexity",
  "units",
  "timeInMotionDays",
];

function buildSnapshotFromRows(
  insight: DashboardInsight,
  rows: Array<Record<string, unknown>>,
  options: { generationBatch?: string; dateFilter?: string } | undefined,
  isSubjectRows: boolean,
  variant: "leaderboard" | "loan-complexity-aggregate" | "loan-complexity-subject" = "leaderboard"
): DashboardDetailSnapshot {
  const allKeys = new Set<string>();
  rows.forEach((r) => Object.keys(r).forEach((k) => allKeys.add(k)));
  const columnOrder =
    variant === "loan-complexity-subject"
      ? SUBJECT_COMPLEXITY_COLUMN_ORDER
      : variant === "loan-complexity-aggregate"
        ? AGGREGATE_COMPLEXITY_COLUMN_ORDER
        : isSubjectRows
          ? SUBJECT_COLUMN_ORDER
          : AGGREGATE_COLUMN_ORDER;
  const orderedKeys = columnOrder.filter((k) => allKeys.has(k));
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

  const first = rows[0] as Record<string, unknown>;
  const summaryDefs: DashboardDetailSnapshotSummaryDef[] = [];
  if (variant === "loan-complexity-subject" && isSubjectRows) {
    if (first?.waComplexity != null)
      summaryDefs.push({
        key: "waComplexity",
        label: "WA complexity",
        value: Number(first.waComplexity),
        format: "number",
        color: "blue",
      });
    if (first?.units != null)
      summaryDefs.push({
        key: "units",
        label: "Units",
        value: Number(first.units),
        format: "number",
        color: "blue",
      });
  } else if (isSubjectRows) {
    if (first?.pullThroughRate != null)
      summaryDefs.push({
        key: "pullThroughRate",
        label: "Pull-through",
        value: Number(first.pullThroughRate),
        format: "percent",
        color: "blue",
      });
    if (first?.loansClosed != null)
      summaryDefs.push({
        key: "loansClosed",
        label: "Units",
        value: Number(first.loansClosed),
        format: "number",
        color: "blue",
      });
    if (first?.totalVolume != null)
      summaryDefs.push({
        key: "totalVolume",
        label: "Volume",
        value: Number(first.totalVolume),
        format: "currency",
        color: "blue",
      });
  } else if (variant === "loan-complexity-aggregate") {
    if (first?.portfolioWaComplexity != null)
      summaryDefs.push({
        key: "portfolioWaComplexity",
        label: "WA complexity",
        value: Number(first.portfolioWaComplexity),
        format: "number",
        color: "blue",
      });
    if (first?.averagePullThrough != null)
      summaryDefs.push({
        key: "averagePullThrough",
        label: "Pull-through",
        value: Number(first.averagePullThrough),
        format: "percent",
        color: "blue",
      });
    if (first?.totalUnits != null)
      summaryDefs.push({
        key: "totalUnits",
        label: "Units",
        value: Number(first.totalUnits),
        format: "number",
        color: "blue",
      });
  } else {
    if (first?.averagePullThrough != null)
      summaryDefs.push({
        key: "averagePullThrough",
        label: "Pull-through",
        value: Number(first.averagePullThrough),
        format: "percent",
        color: "blue",
      });
    if (first?.totalUnits != null)
      summaryDefs.push({
        key: "totalUnits",
        label: "Units",
        value: Number(first.totalUnits),
        format: "number",
        color: "blue",
      });
    if (first?.totalVolume != null)
      summaryDefs.push({
        key: "totalVolume",
        label: "Volume",
        value: Number(first.totalVolume),
        format: "currency",
        color: "blue",
      });
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

  const defaultTitle =
    variant === "loan-complexity-aggregate" || variant === "loan-complexity-subject"
      ? "Loan complexity by period"
      : "Leaderboard by period";

  return {
    title: insight.headline || defaultTitle,
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

/**
 * Build detail_data snapshot from an insight and its supporting_data (by-period).
 * When options.subjectName and options.context are provided, builds rows for that
 * subject's metrics across periods; otherwise uses aggregate by-period summary.
 */
export function buildDetailFromSupportingData(
  insight: DashboardInsight,
  supportingData: SupportingData | undefined,
  options?: {
    generationBatch?: string;
    dateFilter?: string;
    subjectName?: string;
    context?: DashboardPageContext;
  }
): DashboardDetailSnapshot | null {
  const subjectName = options?.subjectName;
  const context = options?.context;

  // Person-focused: build rows from context.by_time_period leaderboards for the subject
  if (subjectName && context) {
    if (context.pageId === "loan-complexity") {
      const pivotKey = getLoanComplexityPivotDimFromInsight(insight);
      const cxRows = buildLoanComplexitySubjectRows(context, subjectName, pivotKey);
      if (cxRows && cxRows.length > 0) {
        return buildSnapshotFromRows(insight, cxRows, options, true, "loan-complexity-subject");
      }
    } else {
      const subjectRows = buildSubjectRows(context, subjectName);
      if (subjectRows && subjectRows.length > 0) {
        return buildSnapshotFromRows(insight, subjectRows, options, true, "leaderboard");
      }
    }
  }

  // Aggregate: use supportingData.byPeriod (top performer and period totals per period)
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
    if (row.portfolioWaComplexity != null) out.portfolioWaComplexity = row.portfolioWaComplexity;
    if (row.portfolioPullThrough != null) out.portfolioPullThrough = row.portfolioPullThrough;
    return out;
  });

  const aggVariant =
    options?.context?.pageId === "loan-complexity" ? "loan-complexity-aggregate" : "leaderboard";
  return buildSnapshotFromRows(insight, rows, options, false, aggVariant);
}
