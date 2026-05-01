/**
 * Build SectionFilters for embedding a single registry widget in Research Lab
 * (isolated from workbench section store).
 */

import type { PeriodPreset } from "@/components/ui/DatePeriodPicker";
import { computePresetDateRange } from "@/components/ui/DatePeriodPicker";
import type { DataSourceId } from "@/components/widgets/registry/types";
import type { SectionFilters } from "@/stores/widgetSectionStore";
import { DEFAULT_SECTION_FILTERS, ACTORS_TABLE_DEFAULT_COLUMN_IDS } from "@/stores/widgetSectionStore";

export interface ResearchEmbedFilterOpts {
  period?: PeriodPreset;
  branch?: string;
  loanOfficer?: string;
}

function presetSelection(period?: PeriodPreset) {
  const preset = period ?? "rolling-12";
  const dateRange = computePresetDateRange(preset);
  return {
    periodSelection: { type: "preset" as const, preset, dateRange },
    dateRange,
  };
}

/**
 * Minimal filter bundle for each data source — aligned with WidgetDataProvider defaults.
 */
export function buildResearchEmbedSectionFilters(
  dataSourceId: DataSourceId,
  opts?: ResearchEmbedFilterOpts,
): SectionFilters {
  const ps = presetSelection(opts?.period);
  const branch = opts?.branch ?? "all";
  const loanOfficer = opts?.loanOfficer ?? "all";

  switch (dataSourceId) {
    case "company-scorecard":
      return {
        ...DEFAULT_SECTION_FILTERS,
        sectionType: "company-scorecard",
        ...ps,
        branch,
        loanOfficer,
      };
    case "credit-risk":
      return {
        ...DEFAULT_SECTION_FILTERS,
        sectionType: "credit-risk",
        ...ps,
      };
    case "sales-scorecard":
      return {
        ...DEFAULT_SECTION_FILTERS,
        sectionType: "sales-scorecard",
        actorType: "loan_officer",
        ...ps,
      };
    case "operations-scorecard":
      return {
        ...DEFAULT_SECTION_FILTERS,
        sectionType: "operations-scorecard",
        actorType: "underwriter",
        ...ps,
      };
    case "operations-trends":
      return {
        ...DEFAULT_SECTION_FILTERS,
        sectionType: "operations-trends",
        actorType: "underwriter",
        ...ps,
      };
    case "sales-trends":
      return {
        ...DEFAULT_SECTION_FILTERS,
        sectionType: "sales-trends",
        ...ps,
      };
    case "funnel":
      return {
        ...DEFAULT_SECTION_FILTERS,
        sectionType: "funnel",
        year: new Date().getFullYear(),
        ...ps,
      };
    case "top-tiering-comparison":
      return {
        ...DEFAULT_SECTION_FILTERS,
        sectionType: "top-tiering-comparison",
        actorType: "loan_officer",
        ...ps,
      };
    case "dashboard-metrics":
      return {
        ...DEFAULT_SECTION_FILTERS,
        sectionType: "leaderboard",
        ...ps,
      };
    case "loan-detail":
      return {
        ...DEFAULT_SECTION_FILTERS,
        sectionType: "loan-detail",
        branch,
        loanOfficer,
        ...ps,
      };
    case "high-performers":
      return {
        ...DEFAULT_SECTION_FILTERS,
        sectionType: "high-performers",
        highPerformersDateType: "funding_date",
        highPerformersLeftPeriod: "mtd",
        highPerformersRightPeriod: "ytd",
        ...ps,
      };
    case "actors": {
      const now = new Date();
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      const range = opts?.period
        ? ps.dateRange
        : { start: start.toISOString().slice(0, 10), end: now.toISOString().slice(0, 10) };
      return {
        ...DEFAULT_SECTION_FILTERS,
        sectionType: "actors",
        periodSelection: { type: "preset", preset: opts?.period ?? "mtd", dateRange: range },
        dateRange: range,
        actorsCalculation: "average",
        actorsTurnTimeType: "app_to_fund_days",
        actorsDateRangeType: "calendar_days",
        actorsMeasure: "units",
        actorsSelectedActor: null,
        actorsSelectedStatus: null,
        actorsTableDimensions: ["loan_officer", "processor", "underwriter", "closer"],
        actorsTableColumnIds: [...ACTORS_TABLE_DEFAULT_COLUMN_IDS],
      };
    }
    case "pricing-dashboard":
      return {
        ...DEFAULT_SECTION_FILTERS,
        sectionType: "pricing-dashboard",
        pricingEntityType: "branch",
        pricingActorType: "loan_officer",
        pricingDateRange: "mtd",
        pricingLoanFunding: "funded",
        pricingLoanStatus: "active",
        pricingLockStatus: "total",
        ...ps,
      };
    case "pipeline-analysis":
      return {
        ...DEFAULT_SECTION_FILTERS,
        sectionType: "pipeline-analysis",
        pipelineAnalysisYearRange: `${new Date().getFullYear() - 1}-${new Date().getFullYear()}`,
        pipelineAnalysisStartDateField: "application_date",
        pipelineAnalysisViewMode: "week",
        pipelineAnalysisPctMetric: "volume",
        ...ps,
      };
    case "loan-complexity": {
      const range = ps.dateRange;
      return {
        ...DEFAULT_SECTION_FILTERS,
        sectionType: "loan-complexity",
        periodSelection: ps.periodSelection,
        dateRange: range,
        loanComplexityGroupBy: "actors",
        loanComplexityActorType: "loan_officer",
        loanComplexityCurrentStatus: "All",
      };
    }
    case "estimated-closings-risk":
      return {
        ...DEFAULT_SECTION_FILTERS,
        sectionType: "estimated-closings-risk",
        ...ps,
      };
    default:
      return {
        ...DEFAULT_SECTION_FILTERS,
        sectionType: "company-scorecard",
        ...ps,
      };
  }
}
