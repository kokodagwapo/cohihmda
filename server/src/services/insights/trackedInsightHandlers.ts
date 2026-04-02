/**
 * Registry for tracked insights that refresh via TypeScript (Proposal 2) when
 * SQL replay is not available. Handlers return row-shaped results for extractMetricValues.
 */

import type pg from "pg";
import { queryMetrics } from "../metrics/metricsService.js";
import {
  getDateRangeForTimeframe,
  getLeaderboardData,
} from "../dashboard/analyticsService.js";
import {
  getLoanComplexityPivotData,
  getLoanComplexityPortfolioPullThrough,
} from "../dashboard/loanComplexityDashboardService.js";
import {
  getWorkflowConversionData,
  getWorkflowConversionMilestones,
  type WorkflowMilestoneOption,
} from "../dashboard/workflowConversionService.js";
import { getTenantRevenueExpression } from "../../utils/scorecard-utils.js";
import { loadCompanyScorecardPeriodEntry } from "../dashboardInsights/adapters/companyScorecardAdapter.js";
import {
  computeCreditRiskPeriodDateRange,
  resolveCreditRiskDateFieldAndFilters,
} from "../dashboardInsights/adapters/creditRiskManagementAdapter.js";
import { fetchTopTieringComparisonPeriod } from "../dashboardInsights/adapters/topTieringComparisonAdapter.js";
import { fetchCreditRiskCohortSubjectSnapshotForTracking } from "../dashboardInsights/creditRiskEvidence.js";

export const TRACKED_DASHBOARD_HANDLER_LEADERBOARD_AGGREGATE =
  "dashboard:leaderboard:aggregate_summary";

/** Person-focused leaderboard detail (`pullThroughRate`, `loansClosed`, `totalVolume`). */
export const TRACKED_DASHBOARD_HANDLER_LEADERBOARD_SUBJECT =
  "dashboard:leaderboard:subject_summary";

export const TRACKED_DASHBOARD_HANDLER_LOAN_COMPLEXITY_AGGREGATE =
  "dashboard:loan-complexity:aggregate_summary";

export const TRACKED_DASHBOARD_HANDLER_LOAN_COMPLEXITY_SUBJECT =
  "dashboard:loan-complexity:subject_summary";

export const TRACKED_DASHBOARD_HANDLER_WORKFLOW_AGGREGATE =
  "dashboard:workflow-conversion:aggregate_summary";

export const TRACKED_DASHBOARD_HANDLER_WORKFLOW_SEGMENT =
  "dashboard:workflow-conversion:segment_summary";

export const TRACKED_DASHBOARD_HANDLER_COMPANY_SCORECARD_AGGREGATE =
  "dashboard:company-scorecard:aggregate_summary";

export const TRACKED_DASHBOARD_HANDLER_COMPANY_SCORECARD_SUBJECT =
  "dashboard:company-scorecard:subject_summary";

export const TRACKED_DASHBOARD_HANDLER_CREDIT_RISK_AGGREGATE =
  "dashboard:credit-risk:aggregate_summary";

export const TRACKED_DASHBOARD_HANDLER_CREDIT_RISK_COHORT_SUBJECT =
  "dashboard:credit-risk:cohort_subject_summary";

export const TRACKED_DASHBOARD_HANDLER_TOP_TIERING_AGGREGATE =
  "dashboard:top-tiering:aggregate_summary";

export const TRACKED_DASHBOARD_HANDLER_TOP_TIERING_SUBJECT =
  "dashboard:top-tiering:subject_summary";

export type TrackedDashboardDetailVariant =
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
  | "top-tiering-subject";

/** Maps dashboard detail hydrator variants to handler ids (subject vs aggregate). */
export function trackedDashboardHandlerAuditForVariant(
  variant: TrackedDashboardDetailVariant,
  isSubjectRows: boolean
): { trackedRefreshKind: "handler"; handlerId: string } | Record<string, never> {
  if (variant === "credit-risk-cohort-trend" && isSubjectRows) {
    return {
      trackedRefreshKind: "handler",
      handlerId: TRACKED_DASHBOARD_HANDLER_CREDIT_RISK_COHORT_SUBJECT,
    };
  }

  const pairs: Partial<
    Record<
      TrackedDashboardDetailVariant,
      { subject: string; aggregate: string }
    >
  > = {
    leaderboard: {
      subject: TRACKED_DASHBOARD_HANDLER_LEADERBOARD_SUBJECT,
      aggregate: TRACKED_DASHBOARD_HANDLER_LEADERBOARD_AGGREGATE,
    },
    "loan-complexity-subject": {
      subject: TRACKED_DASHBOARD_HANDLER_LOAN_COMPLEXITY_SUBJECT,
      aggregate: TRACKED_DASHBOARD_HANDLER_LOAN_COMPLEXITY_AGGREGATE,
    },
    "loan-complexity-aggregate": {
      subject: TRACKED_DASHBOARD_HANDLER_LOAN_COMPLEXITY_SUBJECT,
      aggregate: TRACKED_DASHBOARD_HANDLER_LOAN_COMPLEXITY_AGGREGATE,
    },
    "workflow-conversion-segment": {
      subject: TRACKED_DASHBOARD_HANDLER_WORKFLOW_SEGMENT,
      aggregate: TRACKED_DASHBOARD_HANDLER_WORKFLOW_AGGREGATE,
    },
    "workflow-conversion-aggregate": {
      subject: TRACKED_DASHBOARD_HANDLER_WORKFLOW_SEGMENT,
      aggregate: TRACKED_DASHBOARD_HANDLER_WORKFLOW_AGGREGATE,
    },
    "company-scorecard-subject": {
      subject: TRACKED_DASHBOARD_HANDLER_COMPANY_SCORECARD_SUBJECT,
      aggregate: TRACKED_DASHBOARD_HANDLER_COMPANY_SCORECARD_AGGREGATE,
    },
    "company-scorecard-aggregate": {
      subject: TRACKED_DASHBOARD_HANDLER_COMPANY_SCORECARD_SUBJECT,
      aggregate: TRACKED_DASHBOARD_HANDLER_COMPANY_SCORECARD_AGGREGATE,
    },
    "credit-risk-aggregate": {
      subject: TRACKED_DASHBOARD_HANDLER_CREDIT_RISK_AGGREGATE,
      aggregate: TRACKED_DASHBOARD_HANDLER_CREDIT_RISK_AGGREGATE,
    },
    "top-tiering-subject": {
      subject: TRACKED_DASHBOARD_HANDLER_TOP_TIERING_SUBJECT,
      aggregate: TRACKED_DASHBOARD_HANDLER_TOP_TIERING_AGGREGATE,
    },
    "top-tiering-aggregate": {
      subject: TRACKED_DASHBOARD_HANDLER_TOP_TIERING_SUBJECT,
      aggregate: TRACKED_DASHBOARD_HANDLER_TOP_TIERING_AGGREGATE,
    },
  };

  const entry = pairs[variant];
  if (!entry) return {};
  return {
    trackedRefreshKind: "handler",
    handlerId: isSubjectRows ? entry.subject : entry.aggregate,
  };
}

type HandlerFn = (
  tenantPool: pg.Pool,
  displayMetadata: unknown
) => Promise<Record<string, unknown>[]>;

function normalizeLeaderTimeframe(raw: string):
  | "wtd"
  | "mtd"
  | "qtd"
  | "ytd"
  | "lm"
  | "lq"
  | "ly"
  | "rolling_13" {
  const r = raw.toLowerCase();
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
  return (allowed.has(r) ? r : "ytd") as
    | "wtd"
    | "mtd"
    | "qtd"
    | "ytd"
    | "lm"
    | "lq"
    | "ly"
    | "rolling_13";
}

function normalizeLcTimeframe(raw: string) {
  return normalizeLeaderTimeframe(raw);
}

function toYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const REGISTRY: Record<string, HandlerFn> = {
  [TRACKED_DASHBOARD_HANDLER_LEADERBOARD_AGGREGATE]:
    handlerLeaderboardAggregateSummary,
  [TRACKED_DASHBOARD_HANDLER_LEADERBOARD_SUBJECT]:
    handlerLeaderboardSubjectSummary,
  [TRACKED_DASHBOARD_HANDLER_LOAN_COMPLEXITY_AGGREGATE]:
    handlerLoanComplexityAggregateSummary,
  [TRACKED_DASHBOARD_HANDLER_LOAN_COMPLEXITY_SUBJECT]:
    handlerLoanComplexitySubjectSummary,
  [TRACKED_DASHBOARD_HANDLER_WORKFLOW_AGGREGATE]:
    handlerWorkflowAggregateSummary,
  [TRACKED_DASHBOARD_HANDLER_WORKFLOW_SEGMENT]: handlerWorkflowSegmentSummary,
  [TRACKED_DASHBOARD_HANDLER_COMPANY_SCORECARD_AGGREGATE]:
    handlerCompanyScorecardAggregateSummary,
  [TRACKED_DASHBOARD_HANDLER_COMPANY_SCORECARD_SUBJECT]:
    handlerCompanyScorecardSubjectSummary,
  [TRACKED_DASHBOARD_HANDLER_CREDIT_RISK_AGGREGATE]:
    handlerCreditRiskAggregateSummary,
  [TRACKED_DASHBOARD_HANDLER_TOP_TIERING_AGGREGATE]:
    handlerTopTieringAggregateSummary,
  [TRACKED_DASHBOARD_HANDLER_TOP_TIERING_SUBJECT]:
    handlerTopTieringSubjectSummary,
};

const DEFAULT_WORKFLOW_SEGMENTS: { from: string; to: string }[] = [
  { from: "started_date", to: "application_date" },
  { from: "application_date", to: "processing_date" },
  { from: "processing_date", to: "submitted_to_underwriting_date" },
  { from: "submitted_to_underwriting_date", to: "uw_final_approval_date" },
  { from: "uw_final_approval_date", to: "ctc_date" },
  { from: "ctc_date", to: "funding_date" },
];

function buildWorkflowSegmentLabel(
  fromId: string,
  toId: string,
  milestones: WorkflowMilestoneOption[]
): string {
  const fromM = milestones.find((m) => m.id === fromId || m.column === fromId);
  const toM = milestones.find((m) => m.id === toId || m.column === toId);
  const a = fromM?.label ?? fromId;
  const b = toM?.label ?? toId;
  return `${a} → ${b}`;
}

function normName(s: string): string {
  return s.trim().toLowerCase();
}

function normalizeTopTieringActorName(name: string): string {
  return String(name ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function normalizeWorkflowSegmentLabel(label: string): string {
  return String(label ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

async function handlerLeaderboardAggregateSummary(
  tenantPool: pg.Pool,
  displayMetadata: unknown
): Promise<Record<string, unknown>[]> {
  const dm = displayMetadata as Record<string, unknown> | null | undefined;
  const fc = (dm?.filter_context_snapshot ?? {}) as Record<string, unknown>;
  const tf = normalizeLeaderTimeframe(String(fc.datePeriod ?? "ytd"));
  const { start, end } = getDateRangeForTimeframe(tf);
  const dateRange = { start: toYmd(start), end: toYmd(end) };

  const results = await queryMetrics(
    tenantPool,
    ["pull_through_rate", "total_units", "total_volume"],
    { dateRange }
  );

  return [
    {
      averagePullThrough: Number(results.pull_through_rate?.value ?? 0),
      totalUnits: Number(results.total_units?.value ?? 0),
      totalVolume: Number(results.total_volume?.value ?? 0),
    },
  ];
}

async function handlerLeaderboardSubjectSummary(
  tenantPool: pg.Pool,
  displayMetadata: unknown
): Promise<Record<string, unknown>[]> {
  const dm = displayMetadata as Record<string, unknown> | null | undefined;
  const fc = (dm?.filter_context_snapshot ?? {}) as Record<string, unknown>;
  const tf = normalizeLeaderTimeframe(String(fc.datePeriod ?? "ytd"));
  const leaderName = String(fc.leaderName ?? fc.leader ?? "").trim();
  const channelGroup =
    typeof fc.channelGroup === "string" ? fc.channelGroup : undefined;

  if (!leaderName) {
    return [{ pullThroughRate: 0, loansClosed: 0, totalVolume: 0 }];
  }

  const { leaderboard } = await getLeaderboardData(tenantPool, tf, {
    channelGroup,
  });

  const target = normName(leaderName);
  const entry = leaderboard.find((e) => normName(String(e.name ?? "")) === target);

  if (!entry) {
    return [{ pullThroughRate: 0, loansClosed: 0, totalVolume: 0 }];
  }

  return [
    {
      pullThroughRate: Number(entry.pullThroughRate ?? 0),
      loansClosed: Number(entry.loansClosed ?? 0),
      totalVolume: Number(entry.totalVolume ?? 0),
    },
  ];
}

async function handlerLoanComplexityAggregateSummary(
  tenantPool: pg.Pool,
  displayMetadata: unknown
): Promise<Record<string, unknown>[]> {
  const dm = displayMetadata as Record<string, unknown> | null | undefined;
  const fc = (dm?.filter_context_snapshot ?? {}) as Record<string, unknown>;
  const tf = normalizeLcTimeframe(String(fc.datePeriod ?? "ytd"));
  const { start, end } = getDateRangeForTimeframe(tf);
  const startDate = toYmd(start);
  const endDate = toYmd(end);
  const channelGroup =
    typeof fc.channelGroup === "string" ? fc.channelGroup : undefined;

  const pivotOpts = { startDate, endDate, channelGroup };
  const [pivot, pullThrough] = await Promise.all([
    getLoanComplexityPivotData(tenantPool, pivotOpts),
    getLoanComplexityPortfolioPullThrough(tenantPool, pivotOpts),
  ]);

  const portfolioTotal = pivot.dimensions[0]?.total;
  return [
    {
      portfolioWaComplexity: Number(portfolioTotal?.waComplexity ?? 0),
      averagePullThrough: Number(pullThrough.pullThroughRate ?? 0),
      totalUnits: Number(
        portfolioTotal?.units ?? pullThrough.unitsInCohort ?? 0
      ),
    },
  ];
}

async function handlerLoanComplexitySubjectSummary(
  tenantPool: pg.Pool,
  displayMetadata: unknown
): Promise<Record<string, unknown>[]> {
  const dm = displayMetadata as Record<string, unknown> | null | undefined;
  const fc = (dm?.filter_context_snapshot ?? {}) as Record<string, unknown>;
  const tf = normalizeLcTimeframe(String(fc.datePeriod ?? "ytd"));
  const { start, end } = getDateRangeForTimeframe(tf);
  const startDate = toYmd(start);
  const endDate = toYmd(end);
  const channelGroup =
    typeof fc.channelGroup === "string" ? fc.channelGroup : undefined;

  const pivotDim = String(
    fc.complexityPivotDimension ?? "loan_officer"
  ).trim() as
    | "loan_officer"
    | "processor"
    | "underwriter"
    | "closer"
    | "branch"
    | "current_loan_status";

  const subject =
    String(fc.actor ?? fc.leaderName ?? fc.leader ?? "").trim() || "";
  if (!subject) {
    return [{ waComplexity: 0, units: 0 }];
  }

  const pivot = await getLoanComplexityPivotData(tenantPool, {
    startDate,
    endDate,
    channelGroup,
  });

  const dim = pivot.dimensions.find((d) => d.dimension === pivotDim);
  const slice = dim?.rows ?? [];
  const target = normName(subject);
  const entry = slice.find((r) => normName(String(r.groupName ?? "")) === target);

  if (!entry) {
    return [{ waComplexity: 0, units: 0 }];
  }

  return [
    {
      waComplexity: Number(entry.waComplexity ?? 0),
      units: Number(entry.units ?? 0),
    },
  ];
}

async function handlerWorkflowAggregateSummary(
  tenantPool: pg.Pool,
  displayMetadata: unknown
): Promise<Record<string, unknown>[]> {
  const dm = displayMetadata as Record<string, unknown> | null | undefined;
  const fc = (dm?.filter_context_snapshot ?? {}) as Record<string, unknown>;
  const tf = normalizeLcTimeframe(String(fc.datePeriod ?? "ytd"));
  const { start, end } = getDateRangeForTimeframe(tf);
  const channelGroup =
    typeof fc.channelGroup === "string" ? fc.channelGroup : undefined;

  const result = await getWorkflowConversionData(tenantPool, {
    startDate: toYmd(start),
    endDate: toYmd(end),
    segments: DEFAULT_WORKFLOW_SEGMENTS,
    metric: "conversion",
    grouping: "workflow",
    channelGroup,
  });

  const convs = (result.segments ?? [])
    .map((s) => s.conversionPercent)
    .filter((v): v is number => v != null && !Number.isNaN(Number(v)));
  const turns = (result.segments ?? [])
    .map((s) => s.avgTurnTimeDays)
    .filter((v): v is number => v != null && !Number.isNaN(Number(v)));

  const meanConversionPercent =
    convs.length > 0
      ? convs.reduce((a, b) => a + b, 0) / convs.length
      : 0;
  const meanAvgTurnTimeDays =
    turns.length > 0 ? turns.reduce((a, b) => a + b, 0) / turns.length : 0;

  return [
    {
      meanConversionPercent,
      meanAvgTurnTimeDays,
    },
  ];
}

async function handlerWorkflowSegmentSummary(
  tenantPool: pg.Pool,
  displayMetadata: unknown
): Promise<Record<string, unknown>[]> {
  const dm = displayMetadata as Record<string, unknown> | null | undefined;
  const fc = (dm?.filter_context_snapshot ?? {}) as Record<string, unknown>;
  const tf = normalizeLcTimeframe(String(fc.datePeriod ?? "ytd"));
  const { start, end } = getDateRangeForTimeframe(tf);
  const channelGroup =
    typeof fc.channelGroup === "string" ? fc.channelGroup : undefined;

  const segmentLabel = String(fc.segmentLabel ?? "").trim();
  const milestones = await getWorkflowConversionMilestones(tenantPool);
  const segmentLabels = DEFAULT_WORKFLOW_SEGMENTS.map((s) =>
    buildWorkflowSegmentLabel(s.from, s.to, milestones)
  );

  let segmentIndex =
    typeof fc.segmentIndex === "number" ? fc.segmentIndex : undefined;
  if (segmentIndex == null && segmentLabel) {
    const idx = segmentLabels.findIndex(
      (l) => normalizeWorkflowSegmentLabel(l) === normalizeWorkflowSegmentLabel(segmentLabel)
    );
    if (idx >= 0) segmentIndex = idx;
  }

  const result = await getWorkflowConversionData(tenantPool, {
    startDate: toYmd(start),
    endDate: toYmd(end),
    segments: DEFAULT_WORKFLOW_SEGMENTS,
    metric: "conversion",
    grouping: "workflow",
    channelGroup,
  });

  const seg =
    segmentIndex != null && segmentIndex >= 0
      ? result.segments?.[segmentIndex]
      : result.segments?.find((s, i) => {
          const lab =
            segmentLabels[i] ??
            buildWorkflowSegmentLabel(s.from, s.to, milestones);
          return (
            normalizeWorkflowSegmentLabel(lab) ===
            normalizeWorkflowSegmentLabel(segmentLabel)
          );
        });

  if (!seg) {
    return [{ conversionPercent: 0, avgTurnTimeDays: 0 }];
  }

  return [
    {
      conversionPercent: Number(seg.conversionPercent ?? 0),
      avgTurnTimeDays: Number(seg.avgTurnTimeDays ?? 0),
    },
  ];
}

function normalizeScorecardPeriodKey(raw: string): string {
  const r = raw.trim().toLowerCase();
  if (!r) return "ytd";
  if (r.startsWith("y_")) return r;
  if (["l13m", "l12m", "ytd"].includes(r)) return r;
  return "ytd";
}

async function handlerCompanyScorecardAggregateSummary(
  tenantPool: pg.Pool,
  displayMetadata: unknown
): Promise<Record<string, unknown>[]> {
  const dm = displayMetadata as Record<string, unknown> | null | undefined;
  const fc = (dm?.filter_context_snapshot ?? {}) as Record<string, unknown>;
  const period = normalizeScorecardPeriodKey(String(fc.datePeriod ?? "ytd"));
  const block = await loadCompanyScorecardPeriodEntry(tenantPool, period);

  const top = block.tierAggregates["Top Tier"];
  return [
    {
      applicationsTakenUnits: top.applicationsTakenUnits,
      applicationsTakenDollar: top.applicationsTakenDollar,
      wac: top.wac,
      originatedUnits: top.originatedUnits,
      originatedUnitsPct: top.originatedUnitsPct,
      withdrawnUnits: top.withdrawnUnits,
      withdrawnUnitsPct: top.withdrawnUnitsPct,
      deniedUnits: top.deniedUnits,
      deniedUnitsPct: top.deniedUnitsPct,
      waFico: top.waFico,
      waLtv: top.waLtv,
      waDti: top.waDti,
    },
  ];
}

async function handlerCompanyScorecardSubjectSummary(
  tenantPool: pg.Pool,
  displayMetadata: unknown
): Promise<Record<string, unknown>[]> {
  const dm = displayMetadata as Record<string, unknown> | null | undefined;
  const fc = (dm?.filter_context_snapshot ?? {}) as Record<string, unknown>;
  const period = normalizeScorecardPeriodKey(String(fc.datePeriod ?? "ytd"));
  const entityType = String(fc.scorecardEntityType ?? "branch").toLowerCase();
  const name =
    String(
      entityType === "loan_officer"
        ? fc.loanOfficer ?? fc.loan_officer ?? ""
        : fc.branch ?? ""
    ).trim() || String(fc.actor ?? "").trim();

  if (!name) {
    return [
      {
        applicationsTakenUnits: 0,
        wac: 0,
        originatedUnitsPct: 0,
      },
    ];
  }

  const block = await loadCompanyScorecardPeriodEntry(tenantPool, period);
  const list =
    entityType === "loan_officer"
      ? block.loanOfficersWithTierForContext
      : block.branchesWithTierForContext;
  const target = normName(name);
  const found = list.find((e) => normName(String(e.name ?? "")) === target);

  if (!found) {
    return [
      {
        applicationsTakenUnits: 0,
        wac: 0,
        originatedUnitsPct: 0,
      },
    ];
  }

  return [
    {
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
    },
  ];
}

const CREDIT_RISK_KPI_METRICS = [
  "total_units",
  "total_volume",
  "wac",
  "wa_fico",
  "wa_ltv",
  "wa_dti",
] as const;

function normalizeCreditRiskPeriod(raw: string): string {
  const r = raw.trim().toLowerCase();
  if (!r) return "ytd";
  if (r === "l13m" || r === "l12m" || r === "ytd") return r;
  if (/^y_\d{4}$/.test(r)) return r;
  const now = new Date();
  return `y_${now.getFullYear()}`;
}

async function handlerCreditRiskCohortSubjectSummary(
  tenantPool: pg.Pool,
  displayMetadata: unknown
): Promise<Record<string, unknown>[]> {
  const dm = displayMetadata as Record<string, unknown> | null | undefined;
  const fc = (dm?.filter_context_snapshot ?? {}) as Record<string, unknown>;
  const row = await fetchCreditRiskCohortSubjectSnapshotForTracking(tenantPool, fc);
  if (!row) {
    return [
      {
        totalUnits: 0,
        unitsPercent: 0,
        totalVolume: 0,
        waFico: 0,
        waLtv: 0,
        waDti: 0,
      },
    ];
  }
  return [row];
}

async function handlerCreditRiskAggregateSummary(
  tenantPool: pg.Pool,
  displayMetadata: unknown
): Promise<Record<string, unknown>[]> {
  const dm = displayMetadata as Record<string, unknown> | null | undefined;
  const fc = (dm?.filter_context_snapshot ?? {}) as Record<string, unknown>;
  const period = normalizeCreditRiskPeriod(String(fc.datePeriod ?? "ytd"));
  const { start, end } = computeCreditRiskPeriodDateRange(period);
  const appType = String(fc.applicationType ?? "Applications Taken");
  const { dateField, additionalFilters } =
    resolveCreditRiskDateFieldAndFilters(appType);

  const results = await queryMetrics(tenantPool, [...CREDIT_RISK_KPI_METRICS], {
    dateRange: { start, end },
    dateField,
    additionalFilters,
  });

  return [
    {
      totalUnits: Number(results.total_units?.value ?? 0),
      totalVolume: Number(results.total_volume?.value ?? 0),
      wac: Number(results.wac?.value ?? 0),
      waFico: Number(results.wa_fico?.value ?? 0),
      waLtv: Number(results.wa_ltv?.value ?? 0),
      waDti: Number(results.wa_dti?.value ?? 0),
    },
  ];
}

function topTieringApiDateRange(periodKey: string): string {
  const k = periodKey.toLowerCase();
  const map: Record<string, string> = {
    mtd: "mtd",
    qtd: "qtd",
    ytd: "ytd",
    lm: "last-month",
    lq: "last-quarter",
    ly: "last-year",
    t12: "trailing-12",
  };
  return map[k] ?? "ytd";
}

async function handlerTopTieringAggregateSummary(
  tenantPool: pg.Pool,
  displayMetadata: unknown
): Promise<Record<string, unknown>[]> {
  const dm = displayMetadata as Record<string, unknown> | null | undefined;
  const fc = (dm?.filter_context_snapshot ?? {}) as Record<string, unknown>;
  const periodKey = String(fc.datePeriod ?? "ytd").toLowerCase();
  const apiRange = topTieringApiDateRange(periodKey);
  const actorType =
    String(fc.actorType ?? "loan-officer").toLowerCase() === "branch"
      ? "branch"
      : "loan-officer";
  const channelGroup =
    typeof fc.channelGroup === "string" ? fc.channelGroup : undefined;

  const revenueExpression = await getTenantRevenueExpression(tenantPool);
  const data = await fetchTopTieringComparisonPeriod(
    tenantPool,
    revenueExpression,
    actorType,
    apiRange,
    channelGroup,
    undefined
  );

  const t = data.totals;
  return [
    {
      revenue: Number(t.revenue ?? 0),
      totalUnits: Number(t.units ?? 0),
      totalVolume: Number(t.volume ?? 0),
      avgRevenueBPS: Number(t.avgRevenueBPS ?? 0),
    },
  ];
}

async function handlerTopTieringSubjectSummary(
  tenantPool: pg.Pool,
  displayMetadata: unknown
): Promise<Record<string, unknown>[]> {
  const dm = displayMetadata as Record<string, unknown> | null | undefined;
  const fc = (dm?.filter_context_snapshot ?? {}) as Record<string, unknown>;
  const periodKey = String(fc.datePeriod ?? "ytd").toLowerCase();
  const apiRange = topTieringApiDateRange(periodKey);
  const actorType =
    String(fc.actorType ?? "loan-officer").toLowerCase() === "branch"
      ? "branch"
      : "loan-officer";
  const channelGroup =
    typeof fc.channelGroup === "string" ? fc.channelGroup : undefined;

  const subject = String(fc.actorName ?? fc.branch ?? "").trim();
  if (!subject) {
    return [{ revenue: 0, units: 0, revenueBPS: 0 }];
  }

  const revenueExpression = await getTenantRevenueExpression(tenantPool);
  const data = await fetchTopTieringComparisonPeriod(
    tenantPool,
    revenueExpression,
    actorType,
    apiRange,
    channelGroup,
    undefined
  );

  const target = normalizeTopTieringActorName(subject);
  const actor = data.actors.find(
    (a) => normalizeTopTieringActorName(String(a.name ?? "")) === target
  );

  if (!actor) {
    return [{ revenue: 0, units: 0, revenueBPS: 0 }];
  }

  return [
    {
      revenue: Number(actor.revenue ?? 0),
      units: Number(actor.units ?? 0),
      volume: Number(actor.volume ?? 0),
      revenueBPS: Number(actor.revenueBPS ?? 0),
      revenuePerLoan: Number(actor.revenuePerLoan ?? 0),
    },
  ];
}

export async function runTrackedInsightHandler(
  handlerId: string,
  tenantPool: pg.Pool,
  displayMetadata: unknown
): Promise<Record<string, unknown>[]> {
  const fn = REGISTRY[handlerId];
  if (!fn) {
    throw new Error(`Unknown tracked insight handler: ${handlerId}`);
  }
  return fn(tenantPool, displayMetadata);
}

export function isRegisteredTrackedInsightHandler(handlerId: string): boolean {
  return handlerId in REGISTRY;
}
