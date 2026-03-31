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

const CS_ENTITY_WIDGET_DIM: Record<string, "branch" | "loan_officer"> = {
  "company-scorecard-detail-branch-table": "branch",
  "company-scorecard-detail-loan-officer-table": "loan_officer",
};

function getCompanyScorecardEntityTypeFromInsight(
  insight: DashboardInsight
): "branch" | "loan_officer" {
  for (const r of insight.evidence_refs ?? []) {
    const dim = CS_ENTITY_WIDGET_DIM[r.widgetId];
    if (dim) return dim;
  }
  return "branch";
}

type CompanyScorecardTierAggregate = {
  applicationsTakenUnits: number;
  applicationsTakenDollar: number;
  wac: number;
  originatedUnits: number;
  originatedUnitsPct: number;
  withdrawnUnits: number;
  withdrawnUnitsPct: number;
  deniedUnits: number;
  deniedUnitsPct: number;
  waFico: number;
  waLtv: number;
  waDti: number;
};

type CompanyScorecardEntityRow = {
  name: string;
  tier: string;
  applicationsTakenUnits: number;
  applicationsTakenDollar: number;
  wac: number;
  originatedUnits: number;
  originatedUnitsPct: number;
  withdrawnUnits: number;
  withdrawnUnitsPct: number;
  deniedUnits: number;
  deniedUnitsPct: number;
  waFico: number;
  waLtv: number;
  waDti: number;
};

type CompanyScorecardPeriodData = {
  periodLabel?: string;
  tierAggregates?: Record<string, CompanyScorecardTierAggregate>;
  branchesWithTier?: CompanyScorecardEntityRow[];
  loanOfficersWithTier?: CompanyScorecardEntityRow[];
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
  segmentLabel: { label: "Segment", format: "text" },
  leftCount: { label: "From milestone files", format: "number" },
  rightCount: { label: "To milestone files", format: "number" },
  conversionPercent: { label: "Conversion %", format: "percent" },
  avgTurnTimeDays: { label: "Avg turn (days)", format: "days" },
  workflowBrief: { label: "All segments (conv % / avg days)", format: "text" },
  name: { label: "Name", format: "text" },
  rank: { label: "Rank", format: "number" },

  // Company Scorecard
  tier: { label: "Tier", format: "text" },
  applicationsTakenUnits: { label: "Apps Units", format: "number" },
  applicationsTakenDollar: { label: "Apps $", format: "currency" },
  wac: { label: "WAC", format: "number" },
  originatedUnits: { label: "Originated Units", format: "number" },
  originatedUnitsPct: { label: "Originated %", format: "percent" },
  withdrawnUnits: { label: "Withdrawn Units", format: "number" },
  withdrawnUnitsPct: { label: "Withdrawn %", format: "percent" },
  deniedUnits: { label: "Denied Units", format: "number" },
  deniedUnitsPct: { label: "Denied %", format: "percent" },
  waFico: { label: "WA FICO", format: "number" },
  waLtv: { label: "WA LTV", format: "percent" },
  waDti: { label: "WA DTI", format: "percent" },
  conventionalQualifiedPercent: { label: "Conventional Qualified %", format: "percent" },
  governmentQualifiedPercent: { label: "Government Qualified %", format: "percent" },
  originatedRevenue: { label: "Originated Revenue", format: "currency" },
  bucketLabel: { label: "Cohort", format: "text" },
  cohortDimension: { label: "Dimension", format: "text" },
  applicationType: { label: "Application Type", format: "text" },
  unitsPercent: { label: "Units %", format: "percent" },
  volumePercent: { label: "Volume %", format: "percent" },
  originatedPercent: { label: "Originated %", format: "percent" },
  deniedPercent: { label: "Denied %", format: "percent" },
  withdrawnPercent: { label: "Withdrawn %", format: "percent" },
  activePercent: { label: "Active %", format: "percent" },
  revenue: { label: "Revenue", format: "currency" },
  avgRevenueBPS: { label: "Avg Revenue BPS", format: "bps" },
  actorCount: { label: "Actor Count", format: "number" },
  units: { label: "Units", format: "number" },
  volume: { label: "Volume", format: "currency" },
  revenueBPS: { label: "Revenue BPS", format: "bps" },
  revenuePerLoan: { label: "Revenue / Loan", format: "currency" },
  loanNumber: { label: "Loan #", format: "text" },
  borrower: { label: "Borrower", format: "text" },
  officer: { label: "Officer", format: "text" },
  loanAmount: { label: "Loan Amount", format: "currency" },
  currentLoanStatus: { label: "Status", format: "text" },
  currentMilestone: { label: "Milestone", format: "text" },
  ficoScore: { label: "FICO", format: "number" },
  ltvRatio: { label: "LTV", format: "percent" },
  dtiRatio: { label: "DTI", format: "percent" },
  applicationDate: { label: "Application Date", format: "date" },
  closingDate: { label: "Closing Date", format: "date" },
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

function buildCompanyScorecardAggregateRows(
  context: DashboardPageContext
): Array<Record<string, unknown>> | null {
  const byPeriod = context.data?.by_time_period as Record<string, CompanyScorecardPeriodData> | undefined;
  if (!byPeriod || typeof byPeriod !== "object") return null;

  const TIER_ORDER = ["Top Tier", "Second Tier", "Bottom Tier"];
  const rows: Array<Record<string, unknown>> = [];

  for (const [period, data] of Object.entries(byPeriod)) {
    const tierAggs = data?.tierAggregates;
    if (!tierAggs || typeof tierAggs !== "object") continue;

    for (const tier of TIER_ORDER) {
      const agg = tierAggs[tier];
      if (!agg) continue;
      rows.push({
        period,
        periodLabel: data.periodLabel ?? period,
        tier,
        applicationsTakenUnits: agg.applicationsTakenUnits,
        applicationsTakenDollar: agg.applicationsTakenDollar,
        wac: agg.wac,
        originatedUnits: agg.originatedUnits,
        originatedUnitsPct: agg.originatedUnitsPct,
        withdrawnUnits: agg.withdrawnUnits,
        withdrawnUnitsPct: agg.withdrawnUnitsPct,
        deniedUnits: agg.deniedUnits,
        deniedUnitsPct: agg.deniedUnitsPct,
        waFico: agg.waFico,
        waLtv: agg.waLtv,
        waDti: agg.waDti,
      });
    }
  }

  return rows.length > 0 ? rows : null;
}

function buildCompanyScorecardSubjectRows(
  context: DashboardPageContext,
  subjectName: string,
  entityType: "branch" | "loan_officer"
): Array<Record<string, unknown>> | null {
  const byPeriod = context.data?.by_time_period as Record<string, CompanyScorecardPeriodData> | undefined;
  if (!byPeriod || typeof byPeriod !== "object") return null;

  const normalized = subjectName.trim();
  const rows: Array<Record<string, unknown>> = [];

  for (const [period, data] of Object.entries(byPeriod)) {
    const list = entityType === "branch" ? data.branchesWithTier : data.loanOfficersWithTier;
    const found = list?.find((e) => String(e.name).trim() === normalized);
    if (!found) continue;

    rows.push({
      period,
      periodLabel: data.periodLabel ?? period,
      tier: found.tier,
      name: found.name,
      applicationsTakenUnits: found.applicationsTakenUnits,
      applicationsTakenDollar: found.applicationsTakenDollar,
      wac: found.wac,
      originatedUnits: found.originatedUnits,
      originatedUnitsPct: found.originatedUnitsPct,
      withdrawnUnits: found.withdrawnUnits,
      withdrawnUnitsPct: found.withdrawnUnitsPct,
      deniedUnits: found.deniedUnits,
      deniedUnitsPct: found.deniedUnitsPct,
      waFico: found.waFico,
      waLtv: found.waLtv,
      waDti: found.waDti,
    });
  }

  return rows.length > 0 ? rows : null;
}

type WorkflowConversionPeriodHydrate = {
  periodLabel?: string;
  summary?: {
    defaultSegments?: Array<{
      label?: string;
      leftCount?: number;
      rightCount?: number;
      conversionPercent?: number | null;
      avgTurnTimeDays?: number | null;
    }>;
  };
};

function buildWorkflowConversionSegmentRows(
  context: DashboardPageContext,
  segmentLabel: string
): Array<Record<string, unknown>> | null {
  const byPeriod = context.data?.by_time_period as Record<string, WorkflowConversionPeriodHydrate> | undefined;
  if (!byPeriod || typeof byPeriod !== "object") return null;

  const normalized = segmentLabel.trim();
  const rows: Array<Record<string, unknown>> = [];

  for (const [period, data] of Object.entries(byPeriod)) {
    const segs = data.summary?.defaultSegments;
    if (!Array.isArray(segs)) continue;
    const seg = segs.find((s) => s.label != null && String(s.label).trim() === normalized);
    if (!seg) continue;
    rows.push({
      period,
      periodLabel: data.periodLabel ?? period,
      segmentLabel: seg.label,
      leftCount: seg.leftCount ?? null,
      rightCount: seg.rightCount ?? null,
      conversionPercent: seg.conversionPercent ?? null,
      avgTurnTimeDays: seg.avgTurnTimeDays ?? null,
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
const WORKFLOW_SEGMENT_SUBJECT_COLUMN_ORDER = [
  "period",
  "periodLabel",
  "segmentLabel",
  "leftCount",
  "rightCount",
  "conversionPercent",
  "avgTurnTimeDays",
];
const WORKFLOW_AGG_COLUMN_ORDER = ["period", "periodLabel", "workflowBrief"];

const CS_AGG_COLUMN_ORDER = [
  "period",
  "periodLabel",
  "tier",
  "applicationsTakenUnits",
  "applicationsTakenDollar",
  "wac",
  "originatedUnits",
  "originatedUnitsPct",
  "withdrawnUnits",
  "withdrawnUnitsPct",
  "deniedUnits",
  "deniedUnitsPct",
  "waFico",
  "waLtv",
  "waDti",
];

const CS_SUBJECT_COLUMN_ORDER = [
  "period",
  "periodLabel",
  "tier",
  "name",
  "applicationsTakenUnits",
  "applicationsTakenDollar",
  "wac",
  "originatedUnits",
  "originatedUnitsPct",
  "withdrawnUnits",
  "withdrawnUnitsPct",
  "deniedUnits",
  "deniedUnitsPct",
  "waFico",
  "waLtv",
  "waDti",
];

const CREDIT_RISK_AGG_COLUMN_ORDER = [
  "period",
  "periodLabel",
  "totalUnits",
  "totalVolume",
  "wac",
  "waFico",
  "waLtv",
  "waDti",
  "conventionalQualifiedPercent",
  "governmentQualifiedPercent",
];
const CREDIT_RISK_COHORT_TREND_COLUMN_ORDER = [
  "period",
  "periodLabel",
  "applicationType",
  "cohortDimension",
  "bucketLabel",
  "totalUnits",
  "unitsPercent",
  "totalVolume",
  "volumePercent",
  "waFico",
  "waLtv",
  "waDti",
  "originatedPercent",
  "deniedPercent",
  "withdrawnPercent",
  "activePercent",
];
const CREDIT_RISK_COHORT_DETAIL_COLUMN_ORDER = [
  "loanNumber",
  "borrower",
  "officer",
  "loanAmount",
  "currentLoanStatus",
  "currentMilestone",
  "ficoScore",
  "ltvRatio",
  "dtiRatio",
  "applicationDate",
  "closingDate",
];
const TTC_AGG_COLUMN_ORDER = [
  "period",
  "periodLabel",
  "revenue",
  "totalUnits",
  "totalVolume",
  "avgRevenueBPS",
  "actorCount",
];
const TTC_SUBJECT_COLUMN_ORDER = [
  "period",
  "periodLabel",
  "name",
  "tier",
  "units",
  "volume",
  "revenue",
  "revenueBPS",
  "revenuePerLoan",
];

type TopTieringPeriodHydrate = {
  periodLabel?: string;
  actors?: Array<{
    name?: string;
    tier?: string;
    units?: number;
    volume?: number;
    revenue?: number;
    revenueBPS?: number;
    revenuePerLoan?: number;
  }>;
};

function buildTopTieringSubjectRows(
  context: DashboardPageContext,
  subjectName: string
): Array<Record<string, unknown>> | null {
  const byPeriod = context.data?.by_time_period as Record<string, TopTieringPeriodHydrate> | undefined;
  if (!byPeriod || typeof byPeriod !== "object") return null;
  const normalized = subjectName.trim();
  const rows: Array<Record<string, unknown>> = [];
  for (const [period, data] of Object.entries(byPeriod)) {
    const actor = data.actors?.find((a) => String(a.name ?? "").trim() === normalized);
    if (!actor) continue;
    rows.push({
      period,
      periodLabel: data.periodLabel ?? period,
      name: actor.name,
      tier: actor.tier,
      units: actor.units ?? null,
      volume: actor.volume ?? null,
      revenue: actor.revenue ?? null,
      revenueBPS: actor.revenueBPS ?? null,
      revenuePerLoan: actor.revenuePerLoan ?? null,
    });
  }
  return rows.length > 0 ? rows : null;
}

function buildSnapshotFromRows(
  insight: DashboardInsight,
  rows: Array<Record<string, unknown>>,
  options: { generationBatch?: string; dateFilter?: string } | undefined,
  isSubjectRows: boolean,
  variant:
    | "leaderboard"
    | "loan-complexity-aggregate"
    | "loan-complexity-subject"
    | "workflow-conversion-aggregate"
    | "workflow-conversion-segment"
    | "company-scorecard-aggregate"
    | "company-scorecard-subject"
    | "credit-risk-aggregate"
    | "credit-risk-cohort-trend"
    | "credit-risk-cohort-kpis"
    | "credit-risk-cohort-detail"
    | "top-tiering-aggregate"
    | "top-tiering-subject" = "leaderboard"
): DashboardDetailSnapshot {
  const allKeys = new Set<string>();
  rows.forEach((r) => Object.keys(r).forEach((k) => allKeys.add(k)));
  const columnOrder =
    variant === "loan-complexity-subject"
      ? SUBJECT_COMPLEXITY_COLUMN_ORDER
      : variant === "loan-complexity-aggregate"
        ? AGGREGATE_COMPLEXITY_COLUMN_ORDER
        : variant === "workflow-conversion-segment"
          ? WORKFLOW_SEGMENT_SUBJECT_COLUMN_ORDER
          : variant === "workflow-conversion-aggregate"
            ? WORKFLOW_AGG_COLUMN_ORDER
          : variant === "company-scorecard-subject"
            ? CS_SUBJECT_COLUMN_ORDER
            : variant === "company-scorecard-aggregate"
              ? CS_AGG_COLUMN_ORDER
              : variant === "credit-risk-aggregate"
                ? CREDIT_RISK_AGG_COLUMN_ORDER
                : variant === "credit-risk-cohort-trend" || variant === "credit-risk-cohort-kpis"
                  ? CREDIT_RISK_COHORT_TREND_COLUMN_ORDER
                  : variant === "credit-risk-cohort-detail"
                    ? CREDIT_RISK_COHORT_DETAIL_COLUMN_ORDER
                    : variant === "top-tiering-subject"
                      ? TTC_SUBJECT_COLUMN_ORDER
                      : variant === "top-tiering-aggregate"
                        ? TTC_AGG_COLUMN_ORDER
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
  } else if (variant === "workflow-conversion-segment" && isSubjectRows) {
    if (first?.conversionPercent != null)
      summaryDefs.push({
        key: "conversionPercent",
        label: "Conversion %",
        value: Number(first.conversionPercent),
        format: "percent",
        color: "blue",
      });
    if (first?.avgTurnTimeDays != null)
      summaryDefs.push({
        key: "avgTurnTimeDays",
        label: "Avg turn (days)",
        value: Number(first.avgTurnTimeDays),
        format: "days",
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
  } else if (variant === "credit-risk-aggregate") {
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
    if (first?.wac != null)
      summaryDefs.push({
        key: "wac",
        label: "WAC",
        value: Number(first.wac),
        format: "number",
        color: "blue",
      });
  } else if (variant === "credit-risk-cohort-trend" || variant === "credit-risk-cohort-kpis") {
    if (first?.totalUnits != null)
      summaryDefs.push({
        key: "totalUnits",
        label: "Units",
        value: Number(first.totalUnits),
        format: "number",
        color: "blue",
      });
    if (first?.unitsPercent != null)
      summaryDefs.push({
        key: "unitsPercent",
        label: "Units %",
        value: Number(first.unitsPercent),
        format: "percent",
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
    if (first?.waFico != null)
      summaryDefs.push({
        key: "waFico",
        label: "WA FICO",
        value: Number(first.waFico),
        format: "number",
        color: "blue",
      });
    if (first?.waLtv != null)
      summaryDefs.push({
        key: "waLtv",
        label: "WA LTV",
        value: Number(first.waLtv),
        format: "percent",
        color: "blue",
      });
    if (first?.waDti != null)
      summaryDefs.push({
        key: "waDti",
        label: "WA DTI",
        value: Number(first.waDti),
        format: "percent",
        color: "blue",
      });
  } else if (variant === "credit-risk-cohort-detail") {
    summaryDefs.push({
      key: "totalUnits",
      label: "Loans",
      value: rows.length,
      format: "number",
      color: "blue",
    });
    if (rows.some((r) => r.loanAmount != null)) {
      summaryDefs.push({
        key: "totalVolume",
        label: "Volume",
        value: rows.reduce((sum, r) => sum + (Number(r.loanAmount) || 0), 0),
        format: "currency",
        color: "blue",
      });
    }
  } else if (variant === "top-tiering-subject") {
    if (first?.revenue != null)
      summaryDefs.push({
        key: "revenue",
        label: "Revenue",
        value: Number(first.revenue),
        format: "currency",
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
    if (first?.revenueBPS != null)
      summaryDefs.push({
        key: "revenueBPS",
        label: "Revenue BPS",
        value: Number(first.revenueBPS),
        format: "bps",
        color: "blue",
      });
  } else if (variant === "top-tiering-aggregate") {
    if (first?.revenue != null)
      summaryDefs.push({
        key: "revenue",
        label: "Revenue",
        value: Number(first.revenue),
        format: "currency",
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
    if (first?.avgRevenueBPS != null)
      summaryDefs.push({
        key: "avgRevenueBPS",
        label: "Avg Revenue BPS",
        value: Number(first.avgRevenueBPS),
        format: "bps",
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
      : variant === "workflow-conversion-segment" || variant === "workflow-conversion-aggregate"
        ? "Workflow conversion by period"
        : variant === "company-scorecard-aggregate" || variant === "company-scorecard-subject"
          ? "Company scorecard tier evolution"
          : variant === "credit-risk-aggregate"
            ? "Credit risk trend by period"
            : variant === "credit-risk-cohort-detail"
              ? "Credit risk cohort loan details"
              : variant === "credit-risk-cohort-trend" || variant === "credit-risk-cohort-kpis"
                ? "Credit risk cohort evidence"
                : variant === "top-tiering-aggregate" || variant === "top-tiering-subject"
                  ? "TopTiering by period"
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
    if (context.pageId === "company-scorecard") {
      const entityType = getCompanyScorecardEntityTypeFromInsight(insight);
      const csRows = buildCompanyScorecardSubjectRows(context, subjectName, entityType);
      if (csRows && csRows.length > 0) {
        return buildSnapshotFromRows(insight, csRows, options, true, "company-scorecard-subject");
      }
    }
    if (context.pageId === "loan-complexity") {
      const pivotKey = getLoanComplexityPivotDimFromInsight(insight);
      const cxRows = buildLoanComplexitySubjectRows(context, subjectName, pivotKey);
      if (cxRows && cxRows.length > 0) {
        return buildSnapshotFromRows(insight, cxRows, options, true, "loan-complexity-subject");
      }
    } else if (context.pageId === "workflow-conversion") {
      const wfRows = buildWorkflowConversionSegmentRows(context, subjectName);
      if (wfRows && wfRows.length > 0) {
        return buildSnapshotFromRows(insight, wfRows, options, true, "workflow-conversion-segment");
      }
    } else if (context.pageId === "top-tiering-comparison") {
      const ttcRows = buildTopTieringSubjectRows(context, subjectName);
      if (ttcRows && ttcRows.length > 0) {
        return buildSnapshotFromRows(insight, ttcRows, options, true, "top-tiering-subject");
      }
    } else {
      const subjectRows = buildSubjectRows(context, subjectName);
      if (subjectRows && subjectRows.length > 0) {
        return buildSnapshotFromRows(insight, subjectRows, options, true, "leaderboard");
      }
    }
  }

  // Aggregate: Company Scorecard tier evolution across periods.
  if (context?.pageId === "company-scorecard") {
    const csAggRows = buildCompanyScorecardAggregateRows(context);
    if (csAggRows && csAggRows.length > 0) {
      return buildSnapshotFromRows(insight, csAggRows, options, false, "company-scorecard-aggregate");
    }
  }

  if (context?.pageId === "credit-risk-management") {
    if (Array.isArray(supportingData?.detailRows) && supportingData.detailRows.length > 0) {
      const profile = supportingData.profile;
      const variant =
        profile === "cohort_detail"
          ? "credit-risk-cohort-detail"
          : profile === "cohort_kpis"
            ? "credit-risk-cohort-kpis"
            : "credit-risk-cohort-trend";
      return buildSnapshotFromRows(
        insight,
        supportingData.detailRows as Array<Record<string, unknown>>,
        options,
        false,
        variant
      );
    }

    const byPeriod = supportingData?.byPeriod;
    if (byPeriod && byPeriod.length > 0) {
      const rows: Array<Record<string, unknown>> = byPeriod.map((row) => {
        const out: Record<string, unknown> = {
          period: row.period,
          periodLabel: row.periodLabel ?? row.period,
        };
        if (row.applicationType != null) out.applicationType = row.applicationType;
        if (row.cohortDimension != null) out.cohortDimension = row.cohortDimension;
        if (row.bucketLabel != null) out.bucketLabel = row.bucketLabel;
        if (row.totalUnits != null) out.totalUnits = row.totalUnits;
        if (row.unitsPercent != null) out.unitsPercent = row.unitsPercent;
        if (row.totalVolume != null) out.totalVolume = row.totalVolume;
        if (row.volumePercent != null) out.volumePercent = row.volumePercent;
        if (row.wac != null) out.wac = row.wac;
        if (row.waFico != null) out.waFico = row.waFico;
        if (row.waLtv != null) out.waLtv = row.waLtv;
        if (row.waDti != null) out.waDti = row.waDti;
        if (row.originatedPercent != null) out.originatedPercent = row.originatedPercent;
        if (row.deniedPercent != null) out.deniedPercent = row.deniedPercent;
        if (row.withdrawnPercent != null) out.withdrawnPercent = row.withdrawnPercent;
        if (row.activePercent != null) out.activePercent = row.activePercent;
        if (row.conventionalQualifiedPercent != null) {
          out.conventionalQualifiedPercent = row.conventionalQualifiedPercent;
        }
        if (row.governmentQualifiedPercent != null) {
          out.governmentQualifiedPercent = row.governmentQualifiedPercent;
        }
        return out;
      });
      const variant =
        supportingData.profile === "cohort_period_trend" || supportingData.profile === "cohort_kpis"
          ? (supportingData.profile === "cohort_kpis" ? "credit-risk-cohort-kpis" : "credit-risk-cohort-trend")
          : "credit-risk-aggregate";
      return buildSnapshotFromRows(insight, rows, options, false, variant);
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
    if (row.wac != null) out.wac = row.wac;
    if (row.waFico != null) out.waFico = row.waFico;
    if (row.waLtv != null) out.waLtv = row.waLtv;
    if (row.waDti != null) out.waDti = row.waDti;
    if ((row as Record<string, unknown>).revenue != null) out.revenue = (row as Record<string, unknown>).revenue;
    if ((row as Record<string, unknown>).avgRevenueBPS != null) out.avgRevenueBPS = (row as Record<string, unknown>).avgRevenueBPS;
    if ((row as Record<string, unknown>).actorCount != null) out.actorCount = (row as Record<string, unknown>).actorCount;
    if (row.conventionalQualifiedPercent != null) out.conventionalQualifiedPercent = row.conventionalQualifiedPercent;
    if (row.governmentQualifiedPercent != null) out.governmentQualifiedPercent = row.governmentQualifiedPercent;
    if (row.workflowBrief != null) out.workflowBrief = row.workflowBrief;
    return out;
  });

  const aggVariant =
    options?.context?.pageId === "loan-complexity"
      ? "loan-complexity-aggregate"
      : options?.context?.pageId === "workflow-conversion"
        ? "workflow-conversion-aggregate"
        : options?.context?.pageId === "top-tiering-comparison"
          ? "top-tiering-aggregate"
        : "leaderboard";
  return buildSnapshotFromRows(insight, rows, options, false, aggVariant);
}
