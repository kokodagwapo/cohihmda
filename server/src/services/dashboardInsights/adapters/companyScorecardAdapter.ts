/**
 * Dashboard Insights — Company Scorecard page adapter
 *
 * Builds DashboardPageContext for the Company Scorecard dashboard insights.
 *
 * Key outputs:
 * - by_time_period: per-period tier aggregates (Top/Second/Bottom) plus tier assignments
 *   for branches and loan officers (used for "tier mover" entity insights).
 * - widget_catalog: evidence targets that map cleanly to UI DOM ids on the CompanyScorecard page.
 *
 * Note: Insight generation is intentionally independent of branch/loan filters.
 * "Show on dashboard" will apply entity focus via insight.filter_context.
 */

import type { Pool } from "pg";
import { queryMetricsGroupedBy } from "../../metrics/metricsService.js";
import type { DashboardAdapter } from "./baseDashboardAdapter.js";
import type {
  DashboardPageContext,
  DashboardDimension,
  WidgetCatalogEntry,
} from "../types.js";

const PAGE_ID = "company-scorecard";

const SCORECARD_METRICS = [
  "loans_started",
  "scorecard_total_loans",
  "scorecard_originated_loans",
  "fallout_withdrawn",
  "fallout_denied",
  "total_volume",
  "originated_volume",
  "originated_revenue",
  "pull_through_rate",
  "credit_pulls",
  "wa_fico",
  "wa_ltv",
  "wa_dti",
  "wac",
  "govt_originated_units",
  "purchase_originated_units",
  "hmda_volume",
  "hmda_units",
  "withdrawn_volume",
  "withdrawn_proforma_revenue",
  "denied_volume",
] as const;

type TierLabel = "Top Tier" | "Second Tier" | "Bottom Tier";
const TIER_LABELS: TierLabel[] = ["Top Tier", "Second Tier", "Bottom Tier"];

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function toYmdLocal(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function startOfMonthLocal(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function computePeriodDateRange(datePeriod: string): { start: string; end: string; periodLabel: string } {
  const now = new Date();
  const end = toYmdLocal(now);
  const currentYear = now.getFullYear();

  if (datePeriod === "l13m") {
    const start = startOfMonthLocal(new Date(now.getFullYear(), now.getMonth() - 13, now.getDate()));
    return { start: toYmdLocal(start), end, periodLabel: "Last 13 Months" };
  }
  if (datePeriod === "l12m") {
    const start = startOfMonthLocal(new Date(now.getFullYear(), now.getMonth() - 12, now.getDate()));
    return { start: toYmdLocal(start), end, periodLabel: "Last 12 Months" };
  }
  if (datePeriod === "ytd") {
    return { start: `${currentYear}-01-01`, end, periodLabel: `Current Year YTD (${currentYear})` };
  }

  // Full-year period: y_YYYY
  if (datePeriod.startsWith("y_")) {
    const yr = Number(datePeriod.slice(2));
    if (Number.isFinite(yr) && yr > 1900) {
      return {
        start: `${yr}-01-01`,
        end: `${yr}-12-31`,
        periodLabel: `Full Year ${yr}`,
      };
    }
  }

  // Fallback: current year YTD
  return { start: `${currentYear}-01-01`, end, periodLabel: `Current Year YTD (${currentYear})` };
}

function safeDiv(n: number, d: number): number {
  return d === 0 ? 0 : n / d;
}

type GroupedMetricResult = {
  groupKey: string;
  value: number | string;
  metadata?: { count?: number };
};

type MetricsByGroup = Record<string, GroupedMetricResult[]>;

type ScorecardEntityRow = {
  name: string;
  // Units/volume
  totalLoansWithRespa: number; // Applications with RESPA (units)
  originatedLoans: number; // Originated units
  tieringVolume: number; // Total volume used for tier assignment
  volume: number; // Originated volume used in summary/detail tables
  // Performance
  wac: number;
  waFico: number;
  waLtv: number;
  waDti: number;
  pullThroughRate: number;
  // Originated mix
  originatedRevenue: number;
  govtUnits: number;
  purchaseUnits: number;
  // Fallout / denied
  falloutWithdrawn: number;
  falloutDenied: number;
  withdrawnVolume: number;
  withdrawnProformaRevenue: number;
  deniedVolume: number;
};

function transformGroupedToEntities(groupedData: MetricsByGroup): ScorecardEntityRow[] {
  const names = new Set<string>();
  Object.values(groupedData).forEach((metricResults) => {
    metricResults.forEach((r) => {
      if (r.groupKey) names.add(String(r.groupKey));
    });
  });

  const getMetricValue = (metricId: string, name: string): number => {
    const results = groupedData[metricId] || [];
    const match = results.find((r) => String(r.groupKey) === name);
    const v = match?.value;
    const num = typeof v === "number" ? v : typeof v === "string" ? Number(v) : 0;
    return Number.isFinite(num) ? num : 0;
  };

  return Array.from(names).map((name) => ({
    name,
    totalLoansWithRespa: getMetricValue("scorecard_total_loans", name),
    originatedLoans: getMetricValue("scorecard_originated_loans", name),
    falloutWithdrawn: getMetricValue("fallout_withdrawn", name),
    falloutDenied: getMetricValue("fallout_denied", name),
    tieringVolume: getMetricValue("total_volume", name),
    volume: getMetricValue("originated_volume", name),
    originatedRevenue: getMetricValue("originated_revenue", name),
    govtUnits: getMetricValue("govt_originated_units", name),
    purchaseUnits: getMetricValue("purchase_originated_units", name),
    // KPIs
    pullThroughRate: getMetricValue("pull_through_rate", name),
    wac: getMetricValue("wac", name),
    waFico: getMetricValue("wa_fico", name),
    waLtv: getMetricValue("wa_ltv", name),
    waDti: getMetricValue("wa_dti", name),
    // Fallout amounts (not all are surfaced in insights, but keep for detail modal parity)
    withdrawnVolume: getMetricValue("withdrawn_volume", name),
    withdrawnProformaRevenue: getMetricValue("withdrawn_proforma_revenue", name),
    deniedVolume: getMetricValue("denied_volume", name),
  }));
}

function assignTiersByTieringVolume(entities: ScorecardEntityRow[]): Array<ScorecardEntityRow & { tier: TierLabel }> {
  const active = entities.filter(
    (e) => e.totalLoansWithRespa > 0 || e.originatedLoans > 0 || e.tieringVolume > 0
  );

  const sorted = [...active].sort((a, b) => b.tieringVolume - a.tieringVolume);
  const total = sorted.reduce((s, e) => s + (e.tieringVolume || 0), 0);

  let cumulativeBefore = 0;
  return sorted.map((e) => {
    const cumulativePercentBefore = total > 0 ? cumulativeBefore / total : 0;
    const tier: TierLabel =
      cumulativePercentBefore <= 0.5
        ? "Top Tier"
        : cumulativePercentBefore <= 0.8
          ? "Second Tier"
          : "Bottom Tier";
    cumulativeBefore += e.tieringVolume || 0;
    return { ...e, tier };
  });
}

function avgByCount(rows: ScorecardEntityRow[], getter: (r: ScorecardEntityRow) => number): number {
  if (rows.length === 0) return 0;
  return rows.reduce((s, r) => s + (getter(r) || 0), 0) / rows.length;
}

type TierAggregateMetrics = {
  tier: TierLabel;
  applicationsTakenUnits: number;
  applicationsTakenDollar: number;
  wac: number;
  originatedUnits: number;
  originatedUnitsPct: number;
  originatedRevenue: number;
  waFico: number;
  waLtv: number;
  waDti: number;
  withdrawnUnits: number;
  withdrawnUnitsPct: number;
  deniedUnits: number;
  deniedUnitsPct: number;
};

function aggregateTierMetrics(entities: Array<ScorecardEntityRow & { tier: TierLabel }>, tier: TierLabel): TierAggregateMetrics {
  const inTier = entities.filter((e) => e.tier === tier);
  const applicationsTakenUnits = inTier.reduce((s, e) => s + (e.totalLoansWithRespa || 0), 0);
  const applicationsTakenDollar = inTier.reduce((s, e) => s + (e.tieringVolume || 0), 0);
  const originatedUnits = inTier.reduce((s, e) => s + (e.originatedLoans || 0), 0);
  const originatedRevenue = inTier.reduce((s, e) => s + (e.originatedRevenue || 0), 0);
  const withdrawnUnits = inTier.reduce((s, e) => s + (e.falloutWithdrawn || 0), 0);
  const deniedUnits = inTier.reduce((s, e) => s + (e.falloutDenied || 0), 0);

  // Summary table uses tier-wise sums for mix percentages.
  const originatedUnitsPct = safeDiv(originatedUnits, applicationsTakenUnits) * 100;
  const withdrawnUnitsPct = safeDiv(withdrawnUnits, applicationsTakenUnits) * 100;
  const deniedUnitsPct = safeDiv(deniedUnits, applicationsTakenUnits) * 100;

  return {
    tier,
    applicationsTakenUnits,
    applicationsTakenDollar,
    wac: avgByCount(inTier, (r) => r.wac || 0),
    originatedUnits,
    originatedUnitsPct,
    originatedRevenue,
    waFico: avgByCount(inTier, (r) => r.waFico || 0),
    waLtv: avgByCount(inTier, (r) => r.waLtv || 0),
    waDti: avgByCount(inTier, (r) => r.waDti || 0),
    withdrawnUnits,
    withdrawnUnitsPct,
    deniedUnits,
    deniedUnitsPct,
  };
}

function pickMovers(entitiesWithTier: Array<ScorecardEntityRow & { tier: TierLabel }>, limit: number) {
  return [...entitiesWithTier]
    .sort((a, b) => b.tieringVolume - a.tieringVolume)
    .slice(0, limit);
}

export const companyScorecardAdapter: DashboardAdapter = {
  pageId: PAGE_ID,
  pageName: "Company Scorecard",
  pageDescription: "Tier-based performance view across branches and loan officers.",

  async getFilterCombinations(_tenantPool: Pool): Promise<Record<string, unknown>[]> {
    // Insight generation is page-level; branch/loan filters are applied only when the user clicks "Show on dashboard".
    return [{}];
  },

  getWidgetCatalog(): WidgetCatalogEntry[] {
    return [
      {
        id: "company-scorecard-summary-tier-table",
        type: "table",
        label: "Tier Summary (Top/Second/Bottom)",
        dimension: "company_scorecard_tier",
        columns_or_series: [
          "applicationsTakenUnits",
          "applicationsTakenDollar",
          "wac",
          "originatedUnits",
          "originatedUnitsPct",
        ],
      },
      {
        id: "company-scorecard-detail-branch-table",
        type: "table",
        label: "Detail by Branch (tiered)",
        dimension: "company_scorecard_branch",
        columns_or_series: ["name", "tier", "applicationsTakenDollar", "wac", "originatedUnitsPct"],
      },
      {
        id: "company-scorecard-detail-loan-officer-table",
        type: "table",
        label: "Detail by Loan Officer (tiered)",
        dimension: "company_scorecard_loan_officer",
        columns_or_series: ["name", "tier", "applicationsTakenDollar", "wac", "originatedUnitsPct"],
      },
    ];
  },

  async buildContext(
    tenantPool: Pool,
    _filters: Record<string, unknown>,
    _accessClause?: string
  ): Promise<DashboardPageContext> {
    const now = new Date();
    const currentYear = now.getFullYear();

    // User-facing time filter list (matches UI year picker and your requested options).
    // - rolling-13 => l13m
    // - rolling-12 => l12m
    // - current year => ytd
    // - previous years => full-year keys y_<year>
    const insightDatePeriods = [
      "l13m",
      "l12m",
      "ytd",
      `y_${currentYear - 1}`,
      `y_${currentYear - 2}`,
      `y_${currentYear - 3}`,
    ];

    const byTimePeriod: Record<string, unknown> = {};

    // Dimension values for fact-checking/evidence target validation:
    const tierValues: TierLabel[] = [...TIER_LABELS];
    const allBranchValues = new Set<string>();
    const allLoanOfficerValues = new Set<string>();

    const TOP_N_MOVERS_PER_PERIOD = 20;
    const TOP_N_ENTITIES_PER_PERIOD = 60;

    for (const datePeriod of insightDatePeriods) {
      const { start, end, periodLabel } = computePeriodDateRange(datePeriod);
      const dateRange = { start, end };

      // Branches
      const [groupedBranches, groupedLOs] = await Promise.all([
        queryMetricsGroupedBy(tenantPool, [...SCORECARD_METRICS], "branch", { dateRange }),
        queryMetricsGroupedBy(tenantPool, [...SCORECARD_METRICS], "loan_officer", { dateRange }),
      ]);

      const branchEntities = transformGroupedToEntities(groupedBranches as unknown as MetricsByGroup);
      const loEntities = transformGroupedToEntities(groupedLOs as unknown as MetricsByGroup);

      const branchesWithTier = assignTiersByTieringVolume(branchEntities);
      const loWithTier = assignTiersByTieringVolume(loEntities);

      const trimmedBranchesWithTier = pickMovers(branchesWithTier, TOP_N_ENTITIES_PER_PERIOD);
      const trimmedLOWithTier = pickMovers(loWithTier, TOP_N_ENTITIES_PER_PERIOD);

      trimmedBranchesWithTier.forEach((e) => allBranchValues.add(e.name));
      trimmedLOWithTier.forEach((e) => allLoanOfficerValues.add(e.name));

      const tierAggregates: Record<TierLabel, TierAggregateMetrics> = {
        "Top Tier": aggregateTierMetrics(trimmedBranchesWithTier, "Top Tier"),
        "Second Tier": aggregateTierMetrics(trimmedBranchesWithTier, "Second Tier"),
        "Bottom Tier": aggregateTierMetrics(trimmedBranchesWithTier, "Bottom Tier"),
      };

      // Build entity snapshots for detail modal / entity-specific evidence refs.
      const branchesWithTierForContext = trimmedBranchesWithTier.map((e) => {
        const originatedUnitsPct = safeDiv(e.originatedLoans, e.totalLoansWithRespa) * 100;
        const withdrawnUnitsPct = safeDiv(e.falloutWithdrawn, e.totalLoansWithRespa) * 100;
        const deniedUnitsPct = safeDiv(e.falloutDenied, e.totalLoansWithRespa) * 100;
        return {
          name: e.name,
          tier: e.tier,
          applicationsTakenUnits: e.totalLoansWithRespa,
          applicationsTakenDollar: e.tieringVolume,
          wac: e.wac,
          originatedUnits: e.originatedLoans,
          originatedUnitsPct,
          withdrawnUnits: e.falloutWithdrawn,
          withdrawnUnitsPct,
          deniedUnits: e.falloutDenied,
          deniedUnitsPct,
          waFico: e.waFico,
          waLtv: e.waLtv,
          waDti: e.waDti,
          originatedRevenue: e.originatedRevenue,
          govtUnits: e.govtUnits,
          purchaseUnits: e.purchaseUnits,
        };
      });

      const loWithTierForContext = trimmedLOWithTier.map((e) => {
        const originatedUnitsPct = safeDiv(e.originatedLoans, e.totalLoansWithRespa) * 100;
        const withdrawnUnitsPct = safeDiv(e.falloutWithdrawn, e.totalLoansWithRespa) * 100;
        const deniedUnitsPct = safeDiv(e.falloutDenied, e.totalLoansWithRespa) * 100;
        return {
          name: e.name,
          tier: e.tier,
          applicationsTakenUnits: e.totalLoansWithRespa,
          applicationsTakenDollar: e.tieringVolume,
          wac: e.wac,
          originatedUnits: e.originatedLoans,
          originatedUnitsPct,
          withdrawnUnits: e.falloutWithdrawn,
          withdrawnUnitsPct,
          deniedUnits: e.falloutDenied,
          deniedUnitsPct,
          waFico: e.waFico,
          waLtv: e.waLtv,
          waDti: e.waDti,
          originatedRevenue: e.originatedRevenue,
          govtUnits: e.govtUnits,
          purchaseUnits: e.purchaseUnits,
        };
      });

      const branchByName = new Map(branchesWithTierForContext.map((e) => [e.name, e]));
      const loByName = new Map(loWithTierForContext.map((e) => [e.name, e]));

      // Overall supporting metrics (used for Evidence modal).
      // Weighted pull-through by applications taken units (approximation) to be stable.
      const totalAppsUnits = trimmedBranchesWithTier.reduce((s, e) => s + (e.totalLoansWithRespa || 0), 0);
      const overallPullThrough =
        totalAppsUnits > 0
          ? (trimmedBranchesWithTier.reduce((s, e) => s + (e.pullThroughRate || 0) * (e.totalLoansWithRespa || 0), 0) /
              totalAppsUnits) * 1
          : 0;

      const overallWac = trimmedBranchesWithTier.length > 0 ? avgByCount(trimmedBranchesWithTier, (e) => e.wac) : 0;

      const overallOriginatedUnits = trimmedBranchesWithTier.reduce((s, e) => s + (e.originatedLoans || 0), 0);
      const overallOriginatedUnitsPct = safeDiv(overallOriginatedUnits, totalAppsUnits) * 100;

      const overallWithdrawnUnits = trimmedBranchesWithTier.reduce((s, e) => s + (e.falloutWithdrawn || 0), 0);
      const overallWithdrawnUnitsPct = safeDiv(overallWithdrawnUnits, totalAppsUnits) * 100;

      const overallDeniedUnits = trimmedBranchesWithTier.reduce((s, e) => s + (e.falloutDenied || 0), 0);
      const overallDeniedUnitsPct = safeDiv(overallDeniedUnits, totalAppsUnits) * 100;

      byTimePeriod[datePeriod.toUpperCase()] = {
        periodLabel,
        // Used by enrichEvidenceRefsWithValues for tier-based evidence.
        tierAggregates,
        // Used by detail snapshot builders.
        branchesWithTier: branchesWithTierForContext,
        loanOfficersWithTier: loWithTierForContext,
        // Used by Evidence modal evidence table.
        summary: {
          totalUnits: totalAppsUnits,
          totalVolume: branchesWithTier.reduce((s, e) => s + (e.tieringVolume || 0), 0),
          wac: overallWac,
          averagePullThrough: overallPullThrough,
          originatedUnits: overallOriginatedUnits,
          originatedUnitsPct: overallOriginatedUnitsPct,
          withdrawnUnits: overallWithdrawnUnits,
          withdrawnUnitsPct: overallWithdrawnUnitsPct,
          deniedUnits: overallDeniedUnits,
          deniedUnitsPct: overallDeniedUnitsPct,
        },
      };
    }

    const dimensions: DashboardDimension[] = [
      {
        id: "company_scorecard_tier",
        label: "Tier",
        type: "structural",
        values: tierValues,
      },
      {
        id: "company_scorecard_branch",
        label: "Branch",
        type: "structural",
        values: [...allBranchValues].slice(0, 500),
      },
      {
        id: "company_scorecard_loan_officer",
        label: "Loan officer",
        type: "structural",
        values: [...allLoanOfficerValues].slice(0, 500),
      },
    ];

    const widget_catalog = this.getWidgetCatalog();

    return {
      pageId: PAGE_ID,
      pageName: "Company Scorecard",
      pageDescription: companyScorecardAdapter.pageDescription,
      pageGuidance: [
        "by_time_period keys are uppercase windows from the adapter: L13M, L12M, YTD, and full-year keys like Y_2025 / Y_2024 / Y_2023.",
        "Chronology rule (critical): determine earlier vs later using each period's dateRange (and period semantics), not JSON/object key order.",
        "Period semantics: L13M/L12M and YTD are running windows ending near today; Y_YYYY windows are full historical years with fixed start/end dates.",
        "Directional wording rule: use 'increased/decreased from A to B' only when A is earlier and B is later. If ambiguous, use neutral wording ('X is lower in L13M than Y_2025').",
        "Widget evidence ids are fixed: company-scorecard-summary-tier-table (tier rows Top Tier|Second Tier|Bottom Tier), company-scorecard-detail-branch-table (exact branch label), company-scorecard-detail-loan-officer-table (exact loan officer label).",
        "Focus on tier performance and how tiers differ: analyze Top vs Second vs Bottom based on the summary table metrics (Units, Volume/Apps $, WAC, originated units, originated %).",
        "Good vs bad must be defined using those tier and overall metrics from the summary table first; pull-through and outcome mix (withdrawn/denied/originated) may be used as supporting context but not as the only basis.",
        "Every insight MUST reference tier context: when an entity (branch/loan officer) is named, state which tier that entity belongs to and compare the entity's performance to other actors in the same tier using the tier summary + the entity detail metrics.",
        "Analyze tier differences explicitly (what metric levels are higher/lower in each tier, and whether tier composition shifts across periods).",
        "Entity tier movers (branches or loan officers): select the mover whose story is strongest per the generator’s findings (typically the largest tier shift + the clearest improvement/deterioration in the summary/detail metrics).",
        "Do NOT pre-fix mover selection to pull-through/outcome mix; choose whichever tier-metric movement is strongest in data.",
        "Always state the time window in the headline (e.g., Last 13 Months (L13M), Last 12 Months (L12M), Current Year YTD (YTD), Full Year 2025/2024/2023).",
        "When generating entity-specific insights, set evidence_refs.target.label to the exact branch/loan officer name and cite the correct detail widget.",
        "When generating tier-specific insights, set evidence_refs.target.label to one of: Top Tier, Second Tier, Bottom Tier and cite the tier summary widget.",
        "Set filter_context.datePeriod to lowercase adapter keys: l13m | l12m | ytd | y_YYYY.",
        "For entity-focused insights, set filter_context.entityType to branch or loan_officer and set filter_context.branch or filter_context.loanOfficer to the exact name; also set filter_context.tier to the entity tier when derivable.",
        "For tier-focused insights, set filter_context.tier to Top Tier | Second Tier | Bottom Tier.",
      ],
      filters: {},
      dimensions,
      data: {
        summary: {
          note: "Multi-period company scorecard. Each period includes tierAggregates plus entity tier assignments for branches and loan officers.",
          periodsIncluded: Object.keys(byTimePeriod),
        },
        by_dimension: {},
        by_time_period: byTimePeriod,
      },
      widget_catalog,
    };
  },
};

