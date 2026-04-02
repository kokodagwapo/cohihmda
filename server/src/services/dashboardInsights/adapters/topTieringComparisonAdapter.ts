import type { Pool } from "pg";
import type { DashboardAdapter } from "./baseDashboardAdapter.js";
import type {
  DashboardDimension,
  DashboardPageContext,
  WidgetCatalogEntry,
} from "../types.js";
import {
  buildChannelWhereClause,
  buildFundedFilter,
  getActorColumnForChannel,
  getTenantRevenueExpression,
  getVMaxDate,
} from "../../../utils/scorecard-utils.js";

const INSIGHT_PERIODS = [
  { key: "mtd", apiDateRange: "mtd", label: "Month to Date" },
  { key: "qtd", apiDateRange: "qtd", label: "Quarter to Date" },
  { key: "ytd", apiDateRange: "ytd", label: "Year to Date" },
  { key: "lm", apiDateRange: "last-month", label: "Last Month" },
  { key: "lq", apiDateRange: "last-quarter", label: "Last Quarter" },
  { key: "ly", apiDateRange: "last-year", label: "Last Year" },
  { key: "t12", apiDateRange: "trailing-12", label: "Trailing 12 Months" },
] as const;

const ACTOR_TYPES = ["branch", "loan-officer"] as const;
type ActorType = (typeof ACTOR_TYPES)[number];

type TopTieringActorRow = {
  id: string;
  name: string;
  tier: "top" | "second" | "bottom";
  revenue: number;
  units: number;
  volume: number;
  revenueBPS: number;
  revenuePerLoan: number;
  cumulativeRevenuePercent: number;
  cumulativeUnitsPercent: number;
};

type TopTieringPeriodContext = {
  periodLabel: string;
  dateRange: string;
  actorType: ActorType;
  totals: {
    revenue: number;
    units: number;
    volume: number;
    avgRevenueBPS: number;
    actorCount: number;
    avgRevenuePerActor: number;
    avgUnitsPerActor: number;
  };
  tierSummary: Record<
    "top" | "second" | "bottom",
    {
      count: number;
      revenue: number;
      revenuePercent: number;
      units: number;
      unitsPercent: number;
      avgRevenue: number;
      avgUnits: number;
    }
  >;
  actors: TopTieringActorRow[];
};

const WIDGET_CATALOG: WidgetCatalogEntry[] = [
  { id: "ttc-kpi-total-revenue", type: "kpi", label: "Total Revenue", dimension: "actor_name" },
  { id: "ttc-kpi-total-units", type: "kpi", label: "Total Units", dimension: "actor_name" },
  { id: "ttc-kpi-avg-revenue-bps", type: "kpi", label: "Avg Revenue BPS", dimension: "actor_name" },
  { id: "ttc-kpi-actor-count", type: "kpi", label: "Total Loan Officers/Branches", dimension: "actor_name" },
  { id: "ttc-revenue-chart", type: "chart", label: "Revenue by Actor", dimension: "actor_name" },
  { id: "ttc-units-volume-chart", type: "chart", label: "Units/Volume by Actor", dimension: "actor_name" },
  { id: "ttc-revenue-quality-chart", type: "chart", label: "Revenue BPS/Revenue per Loan by Actor", dimension: "actor_name" },
  { id: "ttc-detail-table", type: "table", label: "TopTiering Detail", dimension: "actor_name" },
  { id: "ttc-story-panel", type: "other", label: "TopTiering Story", dimension: "tier" },
];

function toYmd(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate()
  ).padStart(2, "0")}`;
}

function toDateRangeForApi(dateRange: string, vMaxDate: Date): { start: Date; end: Date; label: string } {
  if (dateRange === "last-year") {
    return {
      start: new Date(vMaxDate.getFullYear() - 1, 0, 1),
      end: new Date(vMaxDate.getFullYear() - 1, 11, 31),
      label: "Last Year",
    };
  }
  if (dateRange === "last-quarter") {
    const currentQuarter = Math.floor(vMaxDate.getMonth() / 3);
    const lastQuarter = currentQuarter - 1;
    if (lastQuarter < 0) {
      return {
        start: new Date(vMaxDate.getFullYear() - 1, 9, 1),
        end: new Date(vMaxDate.getFullYear() - 1, 11, 31),
        label: "Last Quarter",
      };
    }
    return {
      start: new Date(vMaxDate.getFullYear(), lastQuarter * 3, 1),
      end: new Date(vMaxDate.getFullYear(), (lastQuarter + 1) * 3, 0),
      label: "Last Quarter",
    };
  }
  if (dateRange === "last-month") {
    const lastMonth = new Date(vMaxDate);
    lastMonth.setMonth(lastMonth.getMonth() - 1);
    return {
      start: new Date(lastMonth.getFullYear(), lastMonth.getMonth(), 1),
      end: new Date(lastMonth.getFullYear(), lastMonth.getMonth() + 1, 0),
      label: "Last Month",
    };
  }
  if (dateRange === "qtd") {
    const qStart = Math.floor(vMaxDate.getMonth() / 3) * 3;
    return {
      start: new Date(vMaxDate.getFullYear(), qStart, 1),
      end: new Date(vMaxDate),
      label: "Quarter to Date",
    };
  }
  if (dateRange === "mtd") {
    return {
      start: new Date(vMaxDate.getFullYear(), vMaxDate.getMonth(), 1),
      end: new Date(vMaxDate),
      label: "Month to Date",
    };
  }
  if (dateRange === "trailing-12") {
    const start = new Date(vMaxDate);
    start.setFullYear(start.getFullYear() - 1);
    return { start, end: new Date(vMaxDate), label: "Trailing 12 Months" };
  }
  return {
    start: new Date(vMaxDate.getFullYear(), 0, 1),
    end: new Date(vMaxDate),
    label: "Year to Date",
  };
}

export async function fetchTopTieringComparisonPeriod(
  tenantPool: Pool,
  revenueExpression: string,
  actorType: ActorType,
  apiDateRange: string,
  channelGroup?: string,
  accessClause?: string
): Promise<TopTieringPeriodContext> {
  const vMaxDate = await getVMaxDate(tenantPool);
  const resolved = toDateRangeForApi(apiDateRange, vMaxDate);
  const actorColumn =
    actorType === "branch" ? "branch" : getActorColumnForChannel(channelGroup);
  const actorIdColumn =
    actorType === "branch"
      ? "branch"
      : actorColumn === "account_executive"
      ? "account_executive"
      : "loan_officer_id";
  const channelClause = buildChannelWhereClause(channelGroup);
  const fundedFilter = buildFundedFilter(channelGroup);
  const accessFilter = accessClause ? `AND (${accessClause})` : "";

  const actorDataQuery = `
    WITH funded_loans AS (
      SELECT
        ${actorColumn} AS actor_name,
        ${actorIdColumn} AS actor_id,
        loan_id,
        COALESCE(loan_number, loan_id::text) AS loan_number,
        loan_amount,
        (${revenueExpression}) AS revenue
      FROM public.loans
      WHERE ${fundedFilter}
        AND funding_date >= $1
        AND funding_date <= $2
        ${channelClause}
        ${accessFilter}
    ),
    actor_aggregates AS (
      SELECT
        actor_name,
        actor_id,
        COUNT(DISTINCT COALESCE(loan_number, loan_id::text)) AS units,
        SUM(loan_amount) AS volume,
        SUM(revenue) AS revenue,
        CASE WHEN SUM(loan_amount) > 0 THEN (SUM(revenue) / SUM(loan_amount)) * 10000 ELSE 0 END AS revenue_bps,
        CASE
          WHEN COUNT(DISTINCT COALESCE(loan_number, loan_id::text)) > 0
          THEN SUM(revenue) / COUNT(DISTINCT COALESCE(loan_number, loan_id::text))
          ELSE 0
        END AS revenue_per_loan
      FROM funded_loans
      WHERE actor_name IS NOT NULL
        AND actor_name != ''
        AND actor_name NOT ILIKE '99-%'
        AND actor_name NOT ILIKE 'Missing'
        AND actor_name NOT ILIKE 'No LO Found'
        AND actor_name NOT ILIKE 'No Loan Officer'
        AND actor_name NOT ILIKE 'No Branch Found'
        AND actor_name NOT ILIKE 'Unknown'
      GROUP BY actor_name, actor_id
      HAVING SUM(revenue) > 0
    )
    SELECT * FROM actor_aggregates
    ORDER BY revenue DESC
  `;

  const actorDataResult = await tenantPool.query(actorDataQuery, [toYmd(resolved.start), toYmd(resolved.end)]);
  const rows = actorDataResult.rows;
  const totalRevenue = rows.reduce((sum, row) => sum + Number(row.revenue || 0), 0);
  const totalUnits = rows.reduce((sum, row) => sum + Number(row.units || 0), 0);
  const totalVolume = rows.reduce((sum, row) => sum + Number(row.volume || 0), 0);

  let cumulativeRevenue = 0;
  const actors: TopTieringActorRow[] = rows.map((row) => {
    const revenue = Number(row.revenue || 0);
    const units = Number(row.units || 0);
    cumulativeRevenue += revenue;
    const cumulativePercent = totalRevenue > 0 ? (cumulativeRevenue / totalRevenue) * 100 : 0;
    const tier: "top" | "second" | "bottom" =
      cumulativePercent <= 50 ? "top" : cumulativePercent <= 80 ? "second" : "bottom";
    return {
      id: String(row.actor_id || row.actor_name || ""),
      name: String(row.actor_name || ""),
      tier,
      revenue,
      units,
      volume: Number(row.volume || 0),
      revenueBPS: Number(row.revenue_bps || 0),
      revenuePerLoan: Number(row.revenue_per_loan || 0),
      cumulativeRevenuePercent: cumulativePercent,
      cumulativeUnitsPercent: 0,
    };
  });

  let cumulativeUnits = 0;
  actors.forEach((actor) => {
    cumulativeUnits += actor.units;
    actor.cumulativeUnitsPercent = totalUnits > 0 ? (cumulativeUnits / totalUnits) * 100 : 0;
  });

  const tierSummary = {
    top: { count: 0, revenue: 0, revenuePercent: 0, units: 0, unitsPercent: 0, avgRevenue: 0, avgUnits: 0 },
    second: { count: 0, revenue: 0, revenuePercent: 0, units: 0, unitsPercent: 0, avgRevenue: 0, avgUnits: 0 },
    bottom: { count: 0, revenue: 0, revenuePercent: 0, units: 0, unitsPercent: 0, avgRevenue: 0, avgUnits: 0 },
  };
  actors.forEach((actor) => {
    tierSummary[actor.tier].count += 1;
    tierSummary[actor.tier].revenue += actor.revenue;
    tierSummary[actor.tier].units += actor.units;
  });
  (["top", "second", "bottom"] as const).forEach((tier) => {
    const row = tierSummary[tier];
    row.revenuePercent = totalRevenue > 0 ? (row.revenue / totalRevenue) * 100 : 0;
    row.unitsPercent = totalUnits > 0 ? (row.units / totalUnits) * 100 : 0;
    row.avgRevenue = row.count > 0 ? row.revenue / row.count : 0;
    row.avgUnits = row.count > 0 ? row.units / row.count : 0;
  });

  return {
    periodLabel: resolved.label,
    dateRange: `${toYmd(resolved.start)} to ${toYmd(resolved.end)}`,
    actorType,
    totals: {
      revenue: totalRevenue,
      units: totalUnits,
      volume: totalVolume,
      avgRevenueBPS: totalVolume > 0 ? (totalRevenue / totalVolume) * 10000 : 0,
      actorCount: actors.length,
      avgRevenuePerActor: actors.length > 0 ? totalRevenue / actors.length : 0,
      avgUnitsPerActor: actors.length > 0 ? totalUnits / actors.length : 0,
    },
    tierSummary,
    actors,
  };
}

export const topTieringComparisonAdapter: DashboardAdapter = {
  pageId: "top-tiering-comparison",
  pageName: "TopTiering Comparison",
  pageDescription:
    "TopTiering Comparison evaluates funded-loan performance by Branch or Loan Officer using cumulative revenue contribution and period-based Pareto analysis. Actors are ranked by revenue and assigned tiers by cumulative revenue share (Top Tier = first 50%, Second Tier = next 30%, Bottom Tier = remaining 20%), with supporting metrics for Units, Volume, Revenue BPS, and Revenue per Loan. The dashboard supports canonical periods MTD, QTD, YTD, LM, LQ, LY, and T12, and is designed for both same-period tier comparisons (for example, Top Tier versus Second+Bottom combined contribution) and cross-period actor trajectory analysis (tier movement, relative outperformance/underperformance within tier, and stability vs volatility over time). Insights may also connect branch-level tier outcomes to contributing loan-officer performance when evidence is present in the context. Evidence targets are limited to the page's KPI cards, revenue chart, units/volume chart, revenue quality chart (BPS or $/loan), detail table, and TopTiering Story tier summaries.",

  async getFilterCombinations(_tenantPool: Pool): Promise<Record<string, unknown>[]> {
    return [{}];
  },

  getWidgetCatalog(): WidgetCatalogEntry[] {
    return [...WIDGET_CATALOG];
  },

  async buildContext(
    tenantPool: Pool,
    filters: Record<string, unknown>,
    accessClause?: string
  ): Promise<DashboardPageContext> {
    const channelGroup = typeof filters.channelGroup === "string" ? filters.channelGroup : undefined;
    const revenueExpression = await getTenantRevenueExpression(tenantPool);
    const byTimePeriod: Record<string, unknown> = {};
    const actorNames = new Set<string>();
    const branchNames = new Set<string>();

    for (const actorType of ACTOR_TYPES) {
      for (const period of INSIGHT_PERIODS) {
        const data = await fetchTopTieringComparisonPeriod(
          tenantPool,
          revenueExpression,
          actorType,
          period.apiDateRange,
          channelGroup,
          accessClause
        );
        data.actors.forEach((a) => {
          actorNames.add(a.name);
          if (actorType === "branch") branchNames.add(a.name);
        });
        byTimePeriod[`${period.key.toUpperCase()}_${actorType.toUpperCase().replace("-", "_")}`] = data;
      }
    }

    const dimensions: DashboardDimension[] = [
      { id: "time_period", label: "Time period", type: "filter", values: INSIGHT_PERIODS.map((p) => p.key) },
      { id: "actor_type", label: "Actor type", type: "filter", values: [...ACTOR_TYPES] },
      { id: "tier", label: "Tier", type: "structural", values: ["top", "second", "bottom"] },
      { id: "actor_name", label: "Actor", type: "structural", values: [...actorNames] },
      { id: "branch", label: "Branch", type: "structural", values: [...branchNames] },
    ];

    return {
      pageId: "top-tiering-comparison",
      pageName: "TopTiering Comparison",
      pageDescription: topTieringComparisonAdapter.pageDescription,
      pageGuidance: [
        "Prioritize tier-comparison insights in the selected period, especially top tier versus second+bottom combined.",
        "Use only canonical period keys in filter_context.datePeriod: mtd|qtd|ytd|lm|lq|ly|t12.",
        "For actor-focused insights, populate filter_context.actorType as branch or loan-officer and filter_context.actorName with the exact actor label from context.",
        "For branch-specific insights, populate filter_context.branch with the exact branch label; for tier-focused insights include filter_context.tier as top|second|bottom.",
        "Chronology rule: determine earlier/later from period semantics, never object key order.",
        "If describing changes across periods, directional language must go earlier to later.",
        "Use only widget ids in widget_catalog and set evidence_refs.target.label to exact actor or tier labels.",
        "When branch performance is discussed, you may reference loan-officer contribution only when evidence exists in data.",
      ],
      filters: channelGroup ? { channelGroup } : {},
      dimensions,
      data: {
        summary: {
          note: "Contains all canonical periods for both actor types for cross-period and cross-tier insight generation.",
          periodsIncluded: INSIGHT_PERIODS.map((p) => p.key),
          actorTypes: [...ACTOR_TYPES],
        },
        by_dimension: {},
        by_time_period: byTimePeriod,
      },
      widget_catalog: this.getWidgetCatalog(),
    };
  },
};

