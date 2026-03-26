/**
 * Dashboard Insights — Leaderboard page adapter
 *
 * Builds DashboardPageContext by calling getLeaderboardData from analyticsService.
 * Insights are generated for the dashboard as a whole across all time periods (MTD, QTD, YTD, LQ, LM)
 * so that insights can compare periods and are not tied to a single selected period.
 */

import type { Pool } from "pg";
import {
  getLeaderboardData,
  getDateRangeForTimeframe,
} from "../../dashboard/analyticsService.js";
import type { DashboardAdapter } from "./baseDashboardAdapter.js";
import type {
  DashboardPageContext,
  DashboardDimension,
  WidgetCatalogEntry,
} from "../types.js";

/** Time periods used for page-level insights (all periods in one context) */
const INSIGHT_TIMEFRAMES = ["mtd", "qtd", "ytd", "lq", "lm"] as const;
type InsightTimeframe = (typeof INSIGHT_TIMEFRAMES)[number];

const WIDGET_CATALOG: WidgetCatalogEntry[] = [
  {
    id: "leaderboard-main-table",
    type: "table",
    label: "Leaderboard",
    description: "Ranks loan officers by funded units and volume",
    dimension: "leader",
    columns_or_series: ["name", "branch", "loansClosed", "totalVolume", "pullThroughRate", "delta"],
  },
  {
    id: "kpi-top-performer-units",
    type: "kpi",
    label: "Top performer (units)",
    dimension: "leader",
  },
  {
    id: "kpi-top-performer-volume",
    type: "kpi",
    label: "Top performer (volume)",
    dimension: "leader",
  },
];

const PERIOD_LABELS: Record<string, string> = {
  mtd: "Month-to-Date",
  qtd: "Quarter-to-Date",
  ytd: "Year-to-Date",
  lq: "Last Quarter",
  lm: "Last Month",
};

function formatDateRange(start: Date, end: Date): string {
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return `${fmt(start)} to ${fmt(end)}`;
}

export const leaderboardAdapter: DashboardAdapter = {
  pageId: "leaderboard",
  pageName: "Leaderboard",
  pageDescription:
    "Ranks loan officers and branches by funded units, volume, and pull-through. Units and volume reflect loans that FUNDED within each time period. Pull-through and turn time are cohort metrics based on loans whose application/started date falls within each period, even if those loans fund later. Data is provided for multiple time periods (MTD, QTD, YTD, Last Quarter, Last Month) so insights can compare periods.",

  /**
   * Single combination: insights are for the whole dashboard, not per time period.
   */
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
    const opts = {
      channelGroup: channelGroup || undefined,
      dimensionFilterClause: _accessClause,
    };

    // Build context across all time periods so the generator can compare MTD vs LQ, etc.
    const byTimePeriod: Record<string, unknown> = {};
    const allLeaderValues = new Set<string>();
    const allBranchValues = new Set<string>();

    for (const tf of INSIGHT_TIMEFRAMES) {
      const { leaderboard, timeframe: usedTf } = await getLeaderboardData(
        tenantPool,
        tf as "mtd" | "qtd" | "ytd" | "lq" | "lm",
        opts
      );
      const range = getDateRangeForTimeframe(tf as "mtd" | "qtd" | "ytd" | "lq" | "lm");
      const topLo = leaderboard[0];
      const avgPullThrough =
        leaderboard.length > 0
          ? leaderboard.reduce((s, e) => s + (e.pullThroughRate ?? 0), 0) / leaderboard.length
          : 0;
      leaderboard.forEach((e) => {
        allLeaderValues.add(e.name);
        if (e.branch) allBranchValues.add(e.branch);
      });
      byTimePeriod[tf.toUpperCase()] = {
        periodLabel: PERIOD_LABELS[tf] || tf.toUpperCase(),
        dateRange: formatDateRange(range.start, range.end),
        summary: {
          topPerformerName: topLo?.name,
          topPerformerUnits: topLo?.loansClosed,
          topPerformerVolume: topLo?.totalVolume,
          averagePullThrough: Math.round(avgPullThrough),
          totalVolume: leaderboard.reduce((s, e) => s + (e.totalVolume ?? 0), 0),
          totalUnits: leaderboard.reduce((s, e) => s + (e.loansClosed ?? 0), 0),
          loanOfficerCount: leaderboard.length,
        },
        leaderboard: leaderboard.map((e) => ({
          name: e.name,
          branch: e.branch,
          rank: e.rank,
          loansClosed: e.loansClosed,
          loansStarted: e.loansStarted,
          totalVolume: e.totalVolume,
          pullThroughRate: e.pullThroughRate,
          delta: e.delta,
        })),
      };
    }

    const dimensions: DashboardDimension[] = [
      {
        id: "time_period",
        label: "Time period",
        type: "filter",
        values: INSIGHT_TIMEFRAMES.map((p) => p.toUpperCase()),
      },
      {
        id: "leader",
        label: "Loan officer",
        type: "structural",
        values: [...allLeaderValues],
      },
      {
        id: "branch",
        label: "Branch",
        type: "structural",
        values: [...allBranchValues],
      },
    ];

    return {
      pageId: "leaderboard",
      pageName: "Leaderboard",
      pageDescription: leaderboardAdapter.pageDescription,
      pageGuidance: [
        "Prioritize insights that compare the current period to the immediately prior comparable period (MTD vs LM, QTD vs LQ, YTD vs last year when available).",
        "Chronology rule (critical): use period semantics/dateRange to determine earlier vs later; do not rely on key order in by_time_period.",
        "Directional wording rule: any 'increased/decreased from A to B' claim must use earlier->later ordering.",
        "Highlight high performers whose metrics have changed significantly over time, including pull-through, units, and volume.",
        "Call out any significant (+/- 20% or more) improvements and declines for any Loan Officer across periods.",
        "Populate filter_context.datePeriod as lowercase mtd|qtd|ytd|lq|lm|ly for every insight.",
        "For any person-specific insight, populate filter_context.leaderName with the exact loan officer name (and optionally filter_context.leader for compatibility) matching evidence_refs.target.label.",
        "For branch-specific insights, populate filter_context.branch with the exact branch name from data.",
      ],
      filters: channelGroup ? { channelGroup } : {},
      dimensions,
      data: {
        summary: {
          note: "Multi-period view. Each period has its own summary and leaderboard in by_time_period.",
          periodsIncluded: INSIGHT_TIMEFRAMES.map((p) => p.toUpperCase()),
        },
        by_dimension: {},
        by_time_period: byTimePeriod,
      },
      widget_catalog: this.getWidgetCatalog(),
    };
  },
};
