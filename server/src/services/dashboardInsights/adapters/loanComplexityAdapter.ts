/**
 * Dashboard Insights — Loan Complexity page adapter
 *
 * Builds DashboardPageContext from loan complexity pivot + bar APIs across standard periods (incl. LY)
 * so insights can compare periods, actors, status, and portfolio pull-through (application-date cohort).
 */

import type { Pool } from "pg";
import { getDateRangeForTimeframe } from "../../dashboard/analyticsService.js";
import {
  getLoanComplexityPivotData,
  getLoanComplexityDashboardData,
  getLoanComplexityPortfolioPullThrough,
  getLoanComplexityStatusOptions,
  type LoanComplexityGroupBy,
  type PivotRowMetrics,
} from "../../dashboard/loanComplexityDashboardService.js";
import type { DashboardAdapter } from "./baseDashboardAdapter.js";
import type {
  DashboardPageContext,
  DashboardDimension,
  WidgetCatalogEntry,
} from "../types.js";

const INSIGHT_TIMEFRAMES = ["mtd", "qtd", "ytd", "lq", "lm", "ly"] as const;
type InsightTimeframe = (typeof INSIGHT_TIMEFRAMES)[number];

const TOP_N_PIVOT = 25;
const TOP_N_BAR = 25;

const WIDGET_CATALOG: WidgetCatalogEntry[] = [
  {
    id: "loan-complexity-bar-chart",
    type: "chart",
    label: "Average complexity by group (bar chart)",
    description: "Mean complexity score by group for the canonical loan officer view",
    dimension: "complexity_loan_officer",
    columns_or_series: ["groupName", "avgComplexity", "loanCount"],
  },
  {
    id: "loan-complexity-pivot-loan-officer",
    type: "table",
    label: "Pivot — Loan Officer",
    dimension: "complexity_loan_officer",
    columns_or_series: ["groupName", "units", "waComplexity", "timeInMotionDays"],
  },
  {
    id: "loan-complexity-pivot-processor",
    type: "table",
    label: "Pivot — Processor",
    dimension: "complexity_processor",
    columns_or_series: ["groupName", "units", "waComplexity", "timeInMotionDays"],
  },
  {
    id: "loan-complexity-pivot-underwriter",
    type: "table",
    label: "Pivot — Underwriter",
    dimension: "complexity_underwriter",
    columns_or_series: ["groupName", "units", "waComplexity", "timeInMotionDays"],
  },
  {
    id: "loan-complexity-pivot-closer",
    type: "table",
    label: "Pivot — Closer",
    dimension: "complexity_closer",
    columns_or_series: ["groupName", "units", "waComplexity", "timeInMotionDays"],
  },
  {
    id: "loan-complexity-pivot-branch",
    type: "table",
    label: "Pivot — Branch",
    dimension: "complexity_branch",
    columns_or_series: ["groupName", "units", "waComplexity", "timeInMotionDays"],
  },
  {
    id: "loan-complexity-pivot-current-loan-status",
    type: "table",
    label: "Pivot — Current Loan Status",
    dimension: "complexity_current_loan_status",
    columns_or_series: ["groupName", "units", "waComplexity", "timeInMotionDays"],
  },
];

const PERIOD_LABELS: Record<string, string> = {
  mtd: "Month-to-Date",
  qtd: "Quarter-to-Date",
  ytd: "Year-to-Date",
  lq: "Last Quarter",
  lm: "Last Month",
  ly: "Last Calendar Year",
};

function formatDateRange(start: Date, end: Date): string {
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return `${fmt(start)} to ${fmt(end)}`;
}

function toYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function trimPivotRows(rows: PivotRowMetrics[], n: number): Array<Record<string, unknown>> {
  const sorted = [...rows].sort((a, b) => (b.units ?? 0) - (a.units ?? 0));
  return sorted.slice(0, n).map((r) => ({
    groupName: r.groupName,
    units: r.units,
    waComplexity: r.waComplexity,
    timeInMotionDays: r.timeInMotionDays,
    pctActive: r.pctActive,
    pctOriginated: r.pctOriginated,
    pctDenied: r.pctDenied,
    pctWithdrawn: r.pctWithdrawn,
  }));
}

const DIMENSION_ID: Record<LoanComplexityGroupBy, string> = {
  loan_officer: "complexity_loan_officer",
  processor: "complexity_processor",
  underwriter: "complexity_underwriter",
  closer: "complexity_closer",
  branch: "complexity_branch",
  current_loan_status: "complexity_current_loan_status",
};

const PAGE_DESCRIPTION =
  "Loan Complexity compares complexity scores across loan officers, processors, underwriters, closers, branches, and current loan status. " +
  "The dashboard cohort is loans with application_date in each period window. " +
  "Bar chart values are mean complexity (simple average of per-loan scores) by group. " +
  "Pivot values are volume-weighted average complexity (WA complexity) plus operational mix (time in motion, % active/denied/withdrawn/originated among non-active where shown). " +
  "Portfolio pull-through is computed on the same application-date cohort as complexity (not a funding-date cohort): originated-or-purchased status share over completed non-active pipeline statuses, aligned with leaderboard’s pull-through formula but anchored on application_date only. " +
  "Data is provided for MTD, QTD, YTD, Last Quarter, Last Month, and Last Calendar Year so insights can compare periods.";

export const loanComplexityAdapter: DashboardAdapter = {
  pageId: "loan-complexity",
  pageName: "Loan Complexity",

  pageDescription: PAGE_DESCRIPTION,

  async getFilterCombinations(_tenantPool: Pool): Promise<Record<string, unknown>[]> {
    return [{}];
  },

  getWidgetCatalog(): WidgetCatalogEntry[] {
    return [...WIDGET_CATALOG];
  },

  async buildContext(
    tenantPool: Pool,
    filters: Record<string, unknown>,
    _accessClause?: string
  ): Promise<DashboardPageContext> {
    const channelGroup = filters.channelGroup as string | undefined;
    const pivotBase = {
      channelGroup: channelGroup || undefined,
      accessClause: _accessClause || "",
      accessParams: [] as unknown[],
    };

    const byTimePeriod: Record<string, unknown> = {};
    const valueSets: Record<LoanComplexityGroupBy, Set<string>> = {
      loan_officer: new Set(),
      processor: new Set(),
      underwriter: new Set(),
      closer: new Set(),
      branch: new Set(),
      current_loan_status: new Set(),
    };

    for (const tf of INSIGHT_TIMEFRAMES) {
      const range = getDateRangeForTimeframe(tf as InsightTimeframe);
      const startDate = toYmd(range.start);
      const endDate = toYmd(range.end);

      const pivotOpts = { ...pivotBase, startDate, endDate };
      const [pivot, pullThrough, barsResult] = await Promise.all([
        getLoanComplexityPivotData(tenantPool, pivotOpts),
        getLoanComplexityPortfolioPullThrough(tenantPool, pivotOpts),
        getLoanComplexityDashboardData(tenantPool, {
          startDate,
          endDate,
          groupBy: "loan_officer",
          channelGroup: pivotBase.channelGroup,
          accessClause: pivotBase.accessClause,
          accessParams: pivotBase.accessParams,
        }),
      ]);

      const portfolioTotal = pivot.dimensions[0]?.total;
      const pivotSlices: Record<string, Array<Record<string, unknown>>> = {};
      for (const dim of pivot.dimensions) {
        pivotSlices[dim.dimension] = trimPivotRows(dim.rows, TOP_N_PIVOT);
        for (const row of dim.rows) {
          if (row.groupName) valueSets[dim.dimension].add(row.groupName);
        }
      }

      const barLoanOfficer = [...barsResult.bars]
        .sort((a, b) => b.loanCount - a.loanCount)
        .slice(0, TOP_N_BAR)
        .map((b) => ({
          groupName: b.groupName,
          avgComplexity: b.avgComplexity,
          loanCount: b.loanCount,
        }));
      for (const b of barLoanOfficer) {
        if (b.groupName) valueSets.loan_officer.add(b.groupName);
      }

      const statusRows = pivot.dimensions.find((d) => d.dimension === "current_loan_status")?.rows ?? [];
      const byCurrentLoanStatus = trimPivotRows(statusRows, 60);

      byTimePeriod[tf.toUpperCase()] = {
        periodLabel: PERIOD_LABELS[tf] || tf.toUpperCase(),
        dateRange: formatDateRange(range.start, range.end),
        summary: {
          portfolioWaComplexity: portfolioTotal?.waComplexity ?? null,
          totalUnits: portfolioTotal?.units ?? pullThrough.unitsInCohort,
          portfolioPullThrough: pullThrough.pullThroughRate,
          pctActive: portfolioTotal?.pctActive ?? null,
          pctOriginated: portfolioTotal?.pctOriginated ?? null,
          pctDenied: portfolioTotal?.pctDenied ?? null,
          pctWithdrawn: portfolioTotal?.pctWithdrawn ?? null,
        },
        barLoanOfficer,
        pivotSlices,
        by_current_loan_status: byCurrentLoanStatus,
      };
    }

    const ytdRange = getDateRangeForTimeframe("ytd");
    const statusOpts = await getLoanComplexityStatusOptions(tenantPool, {
      startDate: toYmd(ytdRange.start),
      endDate: toYmd(ytdRange.end),
      channelGroup: pivotBase.channelGroup,
      accessClause: pivotBase.accessClause,
      accessParams: pivotBase.accessParams,
    });
    const statusCatalog: string[] = [
      "All",
      "Active Loan",
      "Non-active",
      ...(statusOpts.hasFallout ? ["Fallout"] : []),
      ...statusOpts.statuses,
    ];

    const dimensions: DashboardDimension[] = [
      {
        id: "time_period",
        label: "Time period",
        type: "filter",
        values: INSIGHT_TIMEFRAMES.map((p) => p.toUpperCase()),
      },
      ...(["loan_officer", "processor", "underwriter", "closer", "branch", "current_loan_status"] as const).map(
        (k) => ({
          id: DIMENSION_ID[k],
          label:
            k === "loan_officer"
              ? "Loan officer"
              : k === "current_loan_status"
                ? "Current loan status"
                : k.charAt(0).toUpperCase() + k.slice(1),
          type: "structural" as const,
          values: [...valueSets[k]].slice(0, 500),
        })
      ),
    ];

    return {
      pageId: "loan-complexity",
      pageName: "Loan Complexity",
      pageDescription: PAGE_DESCRIPTION,
      pageGuidance: [
        "Compare complexity (WA in pivot, mean in bar) across periods (e.g. QTD vs LQ, YTD vs LY, MTD vs LM) and relate moves to portfolio pull-through and denial/withdrawn/originated mix when those fields support the story.",
        "Use actor-type and branch pivot slices to explain which groups drive portfolio changes; use current loan status slice for outcome mix language.",
        "When citing pull-through, remember it uses the same application_date cohort as complexity—not funding-date volume.",
        "Avoid causal claims; describe co-movement and operational context. Populate filter_context.datePeriod (mtd|qtd|ytd|lq|lm|ly) and optional channelGroup when relevant for this page; do not add Leaderboard-specific keys (e.g. leaderName)—navigation stays on Loan Complexity.",
      ],
      filters: channelGroup ? { channelGroup } : {},
      dimensions,
      data: {
        summary: {
          note: "Multi-period loan complexity. Each period includes summary, pivotSlices, barLoanOfficer, and by_current_loan_status.",
          periodsIncluded: INSIGHT_TIMEFRAMES.map((p) => p.toUpperCase()),
          status_catalog: statusCatalog,
          has_fallout: statusOpts.hasFallout,
        },
        by_dimension: {},
        by_time_period: byTimePeriod,
      },
      widget_catalog: [...WIDGET_CATALOG],
    };
  },
};
