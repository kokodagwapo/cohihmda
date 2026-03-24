import type { Pool } from "pg";
import {
  queryMetrics,
  queryFicoDistribution,
  queryLtvDistribution,
  queryDtiDistribution,
  queryLoanMix,
  queryCreditRiskStory,
  type DistributionBucket,
  type LoanMixRow,
} from "../../metrics/metricsService.js";
import type { DashboardAdapter } from "./baseDashboardAdapter.js";
import type {
  DashboardPageContext,
  DashboardDimension,
  WidgetCatalogEntry,
} from "../types.js";

const PAGE_ID = "credit-risk-management";

const APPLICATION_TYPES = [
  "Applications Taken",
  "Funded Production",
  "Lost Opportunities",
  "All Loans",
] as const;
type ApplicationType = (typeof APPLICATION_TYPES)[number];

type CreditRiskPeriodKey = "l13m" | "l12m" | "ytd" | `y_${number}`;

const KPI_METRICS = [
  "total_units",
  "total_volume",
  "wac",
  "wa_fico",
  "wa_ltv",
  "wa_dti",
] as const;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function toYmdLocal(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function startOfMonthLocal(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function resolveDateFieldAndFilters(applicationType: ApplicationType): {
  dateField: string;
  additionalFilters: Record<string, unknown>;
} {
  if (applicationType === "Funded Production") {
    return { dateField: "funding_date", additionalFilters: {} };
  }
  if (applicationType === "Lost Opportunities") {
    return { dateField: "any_date", additionalFilters: { withdrawn_filter: true } };
  }
  if (applicationType === "All Loans") {
    return { dateField: "any_date", additionalFilters: {} };
  }
  return { dateField: "application_date", additionalFilters: {} };
}

function computePeriodDateRange(
  period: CreditRiskPeriodKey
): { start: string; end: string; periodLabel: string } {
  const now = new Date();
  const end = toYmdLocal(now);
  const currentYear = now.getFullYear();

  if (period === "l13m") {
    const start = startOfMonthLocal(new Date(now.getFullYear(), now.getMonth() - 13, now.getDate()));
    return { start: toYmdLocal(start), end, periodLabel: "Last 13 Months (L13M)" };
  }
  if (period === "l12m") {
    const start = startOfMonthLocal(new Date(now.getFullYear(), now.getMonth() - 12, now.getDate()));
    return { start: toYmdLocal(start), end, periodLabel: "Last 12 Months (L12M)" };
  }
  if (period === "ytd") {
    return { start: `${currentYear}-01-01`, end, periodLabel: `${currentYear} YTD` };
  }
  const parsedYear = Number(String(period).slice(2));
  if (Number.isFinite(parsedYear) && parsedYear > 1900) {
    return {
      start: `${parsedYear}-01-01`,
      end: `${parsedYear}-12-31`,
      periodLabel: `Full Year ${parsedYear}`,
    };
  }
  return { start: `${currentYear}-01-01`, end, periodLabel: `${currentYear} YTD` };
}

function mapKpisToObject(kpiResults: Record<string, { value: number | string }>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [metricId, result] of Object.entries(kpiResults)) {
    const v = typeof result.value === "number" ? result.value : Number(result.value);
    out[metricId] = Number.isFinite(v) ? v : 0;
  }
  return out;
}

function findLargestByVolume(rows: LoanMixRow[]): { category: string; volumePercent: number } {
  if (!rows.length) return { category: "N/A", volumePercent: 0 };
  const top = [...rows].sort((a, b) => b.volume - a.volume)[0];
  return { category: top.category, volumePercent: top.volumePercent };
}

export const creditRiskManagementAdapter: DashboardAdapter = {
  pageId: PAGE_ID,
  pageName: "Credit Risk Management",
  pageDescription:
    "Credit Risk Management tracks credit quality and pull-through context across FICO/LTV/DTI distributions and loan mix dimensions (loan type, purpose, occupancy) for multiple application types and time periods.",

  async getFilterCombinations(_tenantPool: Pool): Promise<Record<string, unknown>[]> {
    return [{}];
  },

  getWidgetCatalog(): WidgetCatalogEntry[] {
    return [
      {
        id: "credit-risk-story-panel",
        type: "other",
        label: "Credit Risk Story",
      },
      {
        id: "credit-risk-kpi-cards",
        type: "kpi",
        label: "Credit Risk KPIs",
        columns_or_series: ["units", "volume", "wac", "waFico", "waLtv", "waDti"],
      },
      {
        id: "credit-risk-fico-distribution",
        type: "chart",
        label: "FICO Distribution",
        dimension: "credit_risk_fico_bucket",
        columns_or_series: ["range", "units", "percentage", "volume"],
      },
      {
        id: "credit-risk-ltv-distribution",
        type: "chart",
        label: "LTV Distribution",
        dimension: "credit_risk_ltv_bucket",
        columns_or_series: ["range", "units", "percentage", "volume"],
      },
      {
        id: "credit-risk-dti-distribution",
        type: "chart",
        label: "DTI Distribution",
        dimension: "credit_risk_dti_bucket",
        columns_or_series: ["range", "units", "percentage", "volume"],
      },
      {
        id: "credit-risk-loan-mix-table",
        type: "table",
        label: "Loan Mix",
        dimension: "credit_risk_loan_mix_category",
        columns_or_series: ["category", "units", "unitsPercent", "volume", "volumePercent", "wac", "waFico", "waLtv", "waDti"],
      },
    ];
  },

  async buildContext(
    tenantPool: Pool,
    _filters: Record<string, unknown>,
    _accessClause?: string
  ): Promise<DashboardPageContext> {
    const currentYear = new Date().getFullYear();
    const periods: CreditRiskPeriodKey[] = [
      "l13m",
      "l12m",
      "ytd",
      `y_${currentYear - 1}`,
      `y_${currentYear - 2}`,
      `y_${currentYear - 3}`,
    ];

    const byTimePeriod: Record<string, unknown> = {};
    const ficoValues = new Set<string>();
    const ltvValues = new Set<string>();
    const dtiValues = new Set<string>();
    const loanMixValues = new Set<string>();

    for (const period of periods) {
      const date = computePeriodDateRange(period);
      const byApplicationType: Record<string, unknown> = {};

      for (const appType of APPLICATION_TYPES) {
        const { dateField, additionalFilters } = resolveDateFieldAndFilters(appType);
        const options = {
          dateRange: { start: date.start, end: date.end },
          dateField,
          additionalFilters,
        };

        const [
          kpiResults,
          ficoDistribution,
          ltvDistribution,
          dtiDistribution,
          loanMixByType,
          loanMixByPurpose,
          loanMixByOccupancy,
          storyData,
        ] = await Promise.all([
          queryMetrics(tenantPool, [...KPI_METRICS], options),
          queryFicoDistribution(tenantPool, options),
          queryLtvDistribution(tenantPool, options),
          queryDtiDistribution(tenantPool, options),
          queryLoanMix(tenantPool, "loan_type", options),
          queryLoanMix(tenantPool, "loan_purpose", options),
          queryLoanMix(tenantPool, "occupancy_type", options),
          queryCreditRiskStory(tenantPool, options),
        ]);

        const kpis = mapKpisToObject(kpiResults as Record<string, { value: number | string }>);
        ficoDistribution.forEach((x: DistributionBucket) => ficoValues.add(x.range));
        ltvDistribution.forEach((x: DistributionBucket) => ltvValues.add(x.range));
        dtiDistribution.forEach((x: DistributionBucket) => dtiValues.add(x.range));
        [...loanMixByType, ...loanMixByPurpose, ...loanMixByOccupancy].forEach((x: LoanMixRow) =>
          loanMixValues.add(x.category)
        );

        byApplicationType[appType] = {
          kpis: {
            units: kpis.total_units ?? 0,
            volume: kpis.total_volume ?? 0,
            wac: kpis.wac ?? 0,
            waFico: kpis.wa_fico ?? 0,
            waLtv: kpis.wa_ltv ?? 0,
            waDti: kpis.wa_dti ?? 0,
          },
          creditRiskStory: {
            largestLoanType: findLargestByVolume(loanMixByType),
            largestLoanPurpose: findLargestByVolume(loanMixByPurpose),
            largestOccupancy: findLargestByVolume(loanMixByOccupancy),
            conventionalQualifiedPercent: storyData.conventionalQualifiedPercent,
            governmentQualifiedPercent: storyData.governmentQualifiedPercent,
          },
          distributions: {
            fico: ficoDistribution,
            ltv: ltvDistribution,
            dti: dtiDistribution,
          },
          loanMix: {
            byType: loanMixByType,
            byPurpose: loanMixByPurpose,
            byOccupancy: loanMixByOccupancy,
          },
        };
      }

      byTimePeriod[period.toUpperCase()] = {
        periodLabel: date.periodLabel,
        dateRange: `${date.start} to ${date.end}`,
        byApplicationType,
      };
    }

    const dimensions: DashboardDimension[] = [
      {
        id: "credit_risk_application_type",
        label: "Application Type",
        type: "filter",
        values: [...APPLICATION_TYPES],
      },
      {
        id: "time_period",
        label: "Time period",
        type: "filter",
        values: periods.map((p) => p.toUpperCase()),
      },
      {
        id: "credit_risk_fico_bucket",
        label: "FICO bucket",
        type: "structural",
        values: [...ficoValues].slice(0, 300),
      },
      {
        id: "credit_risk_ltv_bucket",
        label: "LTV bucket",
        type: "structural",
        values: [...ltvValues].slice(0, 300),
      },
      {
        id: "credit_risk_dti_bucket",
        label: "DTI bucket",
        type: "structural",
        values: [...dtiValues].slice(0, 300),
      },
      {
        id: "credit_risk_loan_mix_category",
        label: "Loan mix category",
        type: "structural",
        values: [...loanMixValues].slice(0, 500),
      },
    ];

    return {
      pageId: PAGE_ID,
      pageName: "Credit Risk Management",
      pageDescription: creditRiskManagementAdapter.pageDescription,
      pageGuidance: [
        "Credit Risk Management tracks credit quality and pull-through context across FICO/LTV/DTI distributions and loan mix dimensions (loan type, purpose, occupancy) for multiple application types and time periods. Insights should be focused on credit risk story.",
        "Use both filters together for every insight: applicationType (Applications Taken | Funded Production | Lost Opportunities | All Loans) and datePeriod (l13m | l12m | ytd | y_YYYY).",
        "by_time_period keys are uppercase period windows (L13M, L12M, YTD, Y_2025, Y_2024, Y_2023) and each contains byApplicationType objects.",
        "Chronology rule (critical): determine earlier vs later from each period dateRange and semantics, not object key order.",
        "Directional wording must follow earlier->later ordering; if ambiguous, use neutral comparisons.",
        "Risk polarity for this page: treat higher FICO as favorable context, while higher LTV and higher DTI are unfavorable risk signals; keep this interpretation consistent in wording.",
        "Credit Risk Story and KPI metrics are page-level context; distribution buckets and loan mix rows are the primary evidence for risk concentration narratives.",
        "Prioritize insights explaining how FICO/LTV/DTI levels align with outcomes by loan mix groups (loan type, purpose, occupancy), especially groups with weaker pull-through / higher fallout context.",
        "Balance coverage across strengths and weaknesses: include insights that highlight positive patterns (good performance/risk posture) and insights that highlight negative patterns (risk concentration or weaker outcomes).",
        "Also generate at least one insight focused on an individual distribution bucket (specific FICO/LTV/DTI range) and describe how that profile aligns with outcomes and mix.",
        "For loan mix-specific insights, cite credit-risk-loan-mix-table as primary and set evidence_refs.target.label to the exact category name.",
        "For distribution-specific insights, use the matching distribution widget and set target.label to the exact range string.",
        "For story/KPI-level insights, cite credit-risk-story-panel or credit-risk-kpi-cards.",
        "Set filter_context.datePeriod to lowercase canonical keys (l13m|l12m|ytd|y_YYYY).",
        "Set filter_context.applicationType exactly to one of the page's application type labels.",
        "When a loan mix insight references table grouping, set filter_context.loanMixDimension to loan_type | loan_purpose | occupancy and include filter_context.category.",
      ],
      filters: {},
      dimensions,
      data: {
        summary: {
          note: "Credit risk context across application types and periods with KPI/story, FICO/LTV/DTI distributions, and loan mix tables.",
          periodsIncluded: periods.map((p) => p.toUpperCase()),
          applicationTypes: [...APPLICATION_TYPES],
        },
        by_dimension: {},
        by_time_period: byTimePeriod,
      },
      widget_catalog: this.getWidgetCatalog(),
    };
  },
};

