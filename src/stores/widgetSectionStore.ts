/**
 * widgetSectionStore – Zustand store for per-section filter state.
 *
 * Each "section" on the workbench canvas (e.g. Company Scorecard, Credit Risk)
 * gets its own filter state so users can have different timeframes per section.
 *
 * Widgets reference a sectionId to inherit their parent section's filters.
 */

import { create } from 'zustand';
import type { PeriodSelection } from '@/components/ui/DatePeriodPicker';
import type { ColumnFilterState } from '@/utils/loanDetailFilters';
import type { SalesCompanyOverviewAgingBucket } from '@/hooks/useSalesCompanyOverviewData';
import type { InterestRateDrill } from '@/hooks/useLockStratificationData';

export type SectionType =
  | 'company-scorecard'
  | 'credit-risk'
  | 'sales-scorecard'
  | 'operations-scorecard'
  | 'operations-trends'
  | 'sales-trends'
  | 'production-trends'
  | 'production-summary-by-week'
  | 'funnel'
  | 'top-tiering-comparison'
  | 'leaderboard'
  | 'executive-dashboard'
  | 'loan-detail'
  | 'workflow-conversion'
  | 'high-performers'
  | 'actors'
  | 'pricing-dashboard'
  | 'pipeline-analysis'
  | 'sales-scorecard-overview'
  | 'lock-stratification'
  | 'loan-complexity'
  | 'estimated-closings-risk'
  | 'sales-company-overview'
  | 'active-workload';

/**
 * A dynamic (user-added) filter dimension.
 * These are stored per-section and applied to Cohi widgets as SQL WHERE conditions
 * and to registry widgets where the data hook supports them.
 */
export interface DynamicFilterEntry {
  /** DB column name (e.g. 'state', 'channel', 'loan_type') */
  column: string;
  /** Display label (e.g. 'State', 'Channel') */
  label: string;
  /** Selected value — 'all' means no filter applied */
  value: string;
}

export interface SectionFilters {
  /** Which dashboard this section represents – maps to a data source */
  sectionType: SectionType;
  year: number;
  /** Optional explicit date range (overrides year when set by DatePeriodPicker rolling/custom) */
  dateRange?: { start: string; end: string };
  /** Full period selection from DatePeriodPicker (type + preset + computed range) */
  periodSelection?: PeriodSelection;
  branch: string;
  loanOfficer: string;
  application: string;
  dateField: string;
  /** For credit risk: Applications Taken, Funded Production, etc. */
  applicationType: string;
  /** For sales: branch or loan_officer */
  actorType: 'branch' | 'loan_officer';
  /** High Performers: date field (funding_date, closing_date, application_date) */
  highPerformersDateType?: 'funding_date' | 'closing_date' | 'application_date';
  /** High Performers: left column period (mtd, lm, ytd, ly, rolling_13) */
  highPerformersLeftPeriod?: string;
  /** High Performers: right column period */
  highPerformersRightPeriod?: string;
  /** Actors: calculation (average | median) */
  actorsCalculation?: 'average' | 'median';
  /** Actors: turn time type (app_to_fund_days | app_to_closing_days) */
  actorsTurnTimeType?: 'app_to_fund_days' | 'app_to_closing_days';
  /** Actors: date range type (calendar_days | business_days) */
  actorsDateRangeType?: 'calendar_days' | 'business_days';
  /** Actors: measure (units | volume) */
  actorsMeasure?: 'units' | 'volume';
  /** Actors: selected actor filter */
  actorsSelectedActor?: { type: string; name: string } | null;
  /** Actors: selected status filter (from bar chart) */
  actorsSelectedStatus?: string | null;
  /** Actors: which dimension each of the 4 table slots shows */
  actorsTableDimensions?: [string, string, string, string];
  /** Actors: ordered list of column ids to show in workbench actor tables (empty = all default) */
  actorsTableColumnIds?: string[];
  /** Pricing Dashboard: entity type (branch, broker_lender_name, channel, investor) */
  pricingEntityType?: string;
  /** Pricing Dashboard: actor type (loan_officer, account_executive) */
  pricingActorType?: string;
  /** Pricing Dashboard: date range (all, mtd, lm, qtd, ytd, ly) */
  pricingDateRange?: string;
  /** Pricing Dashboard: loan funding (funded, closed) */
  pricingLoanFunding?: string;
  /** Pricing Dashboard: loan status (all, active, funded) */
  pricingLoanStatus?: string;
  /** Pricing Dashboard: lock status (locked, not_locked, total) */
  pricingLockStatus?: string;
  /** Pricing Dashboard: entity value filter */
  pricingEntityValue?: string;
  /** Pricing Dashboard: column to apply entity value filter (e.g. branch when grouping by broker_lender_name) */
  pricingEntityFilterType?: string;
  /** Pricing Dashboard: actor value filter */
  pricingActorValue?: string;
  /** Pricing Dashboard: column to apply actor value filter */
  pricingActorFilterType?: string;
  /** Pricing Dashboard: custom table columns (key = LOS field ID, label = display name). Applies to all four tables. */
  pricingDashboardColumns?: { key: string; label: string }[];
  /** Workflow Conversion: period selection (MTD, QTD, etc.) */
  workflowPeriodSelection?: PeriodSelection;
  /** Workflow Conversion: conversion % vs turn time */
  workflowCalculationType?: 'conversion' | 'turn_time';
  /** Workflow Conversion: workflow vs individual cards */
  workflowGrouping?: 'workflow' | 'individual';
  /** Workflow Conversion: segment cards (from → to milestone ids) */
  workflowSegments?: { from: string; to: string }[];
  /** Pipeline Analysis: year range "YYYY-YYYY" (e.g. "2024-2025") */
  pipelineAnalysisYearRange?: string;
  /** Pipeline Analysis: start date field for pipeline */
  pipelineAnalysisStartDateField?: 'application_date' | 'lock_date' | 'processing_date' | 'credit_pull_date' | 'submitted_to_underwriting_date';
  /** Pipeline Analysis: selected loan types (empty = all) */
  pipelineAnalysisLoanTypes?: string[];
  /** Pipeline Analysis: selected loan purposes (empty = all) */
  pipelineAnalysisLoanPurposes?: string[];
  /** Pipeline Analysis: selected branches (empty = all) */
  pipelineAnalysisBranches?: string[];
  /** Pipeline Analysis: snapshot day of week (1=Mon .. 5=Fri); changing triggers backfill */
  pipelineAnalysisSnapshotDay?: number;
  /** Pipeline Analysis: view mode week vs month */
  pipelineAnalysisViewMode?: 'week' | 'month';
  /** Pipeline Analysis: percent change rows by volume or units */
  pipelineAnalysisPctMetric?: 'volume' | 'units';
  /** Pipeline Analysis: selected week snapshot values (1..53) from table/chart interactions */
  pipelineAnalysisSelectedWeekValues?: number[];
  /** Pipeline Analysis: selected months (1..12) from table/chart interactions */
  pipelineAnalysisSelectedMonths?: number[];
  /** Sales Scorecard Overview: measure (volume, units) */
  salesScorecardOverviewMeasure?: 'volume' | 'units';
  /** Sales Scorecard Overview: time granularity (quarterly, monthly, weekly, daily) */
  salesScorecardOverviewTimeMeasure?: 'quarterly' | 'monthly' | 'weekly' | 'daily';
  /** Production Trends: date type (funded, closed, applications) */
  productionTrendsDateType?: 'funded' | 'closed' | 'applications';
  /** Production Trends: measure (volume, units) */
  productionTrendsMeasure?: 'volume' | 'units';
  /** Production Trends: dimension */
  productionTrendsDimension?:
    | 'loan_purpose'
    | 'loan_type'
    | 'channel'
    | 'branch'
    | 'broker_lender_name'
    | 'investor'
    | 'warehouse_co_name';
  /** Production Trends: selected YearMonth values (YYYY-MM). Empty = all. */
  productionTrendsYearMonths?: string[];
  /** Production Trends: chart-driven largest-category selections */
  productionTrendsSliceCategories?: string[];
  /** Production Trends: chart-driven selected months (1..12) */
  productionTrendsSliceLineMonths?: number[];
  /** Production Trends: drilldown selection (single-level at a time) */
  productionTrendsSliceDrilldown?: {
    branches: string[];
    lienPositions: string[];
    productTypes: string[];
    loanPrograms: string[];
  } | null;
  /** Production Summary by Week: selected YearWeek groups by date field. */
  productionSummaryByWeekYearWeeks?: {
    started_date: string[];
    application_date: string[];
    investor_lock_date: string[];
    funding_date: string[];
    closing_date: string[];
  };
  /** Sales Scorecard Overview: milestone date columns to show (e.g. started_date, application_date). Empty = backend default five. */
  salesScorecardOverviewMilestoneColumns?: string[];
  /** Lock Stratification: locked filter (active_locked, active_not_locked, all_active) */
  lockStratLocked?: 'active_locked' | 'active_not_locked' | 'all_active';
  /** Lock Stratification: measure (volume, units, wac, wa_fico) */
  lockStratMeasure?: 'volume' | 'units' | 'wac' | 'wa_fico';
  /** Lock Stratification: milestone group-by (current_milestone, investor, branch, etc.) */
  lockStratMilestoneGroupBy?: string;
  /** Lock Stratification: pull-through period (30, 60, 90, 120, ytd) */
  lockStratPullThroughPeriod?: string;
  /** Lock Stratification: selected interest-rate drill path for cross-widget filtering. */
  lockStratSelectedInterestRateGroup?: InterestRateDrill;
  /** Loan Complexity: group by (actors = by actor type, branch, current_loan_status) */
  loanComplexityGroupBy?: 'actors' | 'branch' | 'current_loan_status';
  /** Loan Complexity: when groupBy is actors, which actor dimension (loan_officer, processor, etc.) */
  loanComplexityActorType?: 'loan_officer' | 'processor' | 'underwriter' | 'closer';
  /** Loan Complexity: current loan status filter ("All", "Fallout", "Non-active", or specific status) */
  loanComplexityCurrentStatus?: string;
  /** Loan Complexity: selected bar/pivot row names to filter the loan detail table (empty = show all loans in period). Persists across period/group/status changes. */
  loanComplexitySelectedGroupNames?: string[];
  /** Loan Complexity: cross-dimension selection (dimension + groupName). When set, used instead of loanComplexitySelectedGroupNames for the loans API. */
  loanComplexitySelectedGroups?: { dimension: string; groupName: string }[];
  /** Estimated Closings & Risk: Calendar vs Business day mode. */
  estimatedClosingsDateRangeType?: 'calendar_days' | 'business_days';
  /** Estimated Closings & Risk: shared cross-widget interactive filters. */
  estimatedClosingsEcdSlice?: "empty_ecd" | "past_ecd" | "this_months_ecd" | "after_this_month" | null;
  estimatedClosingsComplexityBucket?: 'gte_130' | 'gte_120' | 'gte_110' | 'all_rest' | null;
  estimatedClosingsRemainingComplexityGroup?: string | null;
  estimatedClosingsRemainingProcessingStage?: string | null;
  estimatedClosingsDetailColumnFilters?: ColumnFilterState;
  /** Sales Company Overview: selected loan type slices (multi-select) */
  salesCompanyOverviewLoanTypes?: string[];
  /** Sales Company Overview: selected aging buckets (multi-select) */
  salesCompanyOverviewAgingBuckets?: SalesCompanyOverviewAgingBucket[];
  /** Active Workload: actor dimension */
  activeWorkloadActor?: string;
  /** Active Workload: average vs median */
  activeWorkloadAggregation?: 'average' | 'median';
  /** Active Workload: calendar vs business days */
  activeWorkloadDayCalcType?: 'calendar_days' | 'business_days';
  /** Active Workload: milestone chart slice filter */
  activeWorkloadSliceMilestones?: string[];
  /** Active Workload: drilldown slice filter */
  activeWorkloadSliceDrilldown?: {
    actorValues: string[];
    loanTypes: string[];
    loanPurposes: string[];
  };
  /** Active Workload: detail table column filters */
  activeWorkloadDetailColumnFilters?: ColumnFilterState;
  /** Active Workload: detail table sort */
  activeWorkloadDetailSort?: { key: string; direction: 'asc' | 'desc' };
  /** Active Workload: show/hide detail header filter icons */
  activeWorkloadShowDetailColumnFilters?: boolean;
  /** User-added dynamic filters (column = value conditions) */
  dynamicFilters?: DynamicFilterEntry[];
}

/** Default column ids for actor tables (workbench). Order determines display order. */
export const ACTORS_TABLE_DEFAULT_COLUMN_IDS = [
  'name',
  'units',
  'volume',
  'avgAppToFund',
  'approvalPct',
  'deniedPct',
  'withdrawnPct',
  'loanComplexity',
] as const;

const currentYear = new Date().getFullYear();

export const DEFAULT_SECTION_FILTERS: SectionFilters = {
  sectionType: 'company-scorecard',
  year: currentYear,
  branch: 'all',
  loanOfficer: 'all',
  application: 'applicationsTaken',
  dateField: 'application_date',
  applicationType: 'Applications Taken',
  actorType: 'loan_officer',
};

interface WidgetSectionState {
  /** Map of sectionId -> filters */
  sections: Record<string, SectionFilters>;
  /** Get filters for a section (returns defaults if not yet registered) */
  getFilters: (sectionId: string) => SectionFilters;
  /** Update one or more filter fields for a section */
  updateFilters: (sectionId: string, partial: Partial<SectionFilters>) => void;
  /** Register a new section with its type and default filters */
  registerSection: (sectionId: string, sectionType: SectionType) => void;
  /** Remove a section's filters (when all widgets in that section are removed) */
  removeSection: (sectionId: string) => void;
  /** Find the first section of a given type and return its filters (or null) */
  getFiltersByType: (sectionType: SectionType) => SectionFilters | null;
  /** Add a dynamic filter to a section */
  addDynamicFilter: (sectionId: string, filter: DynamicFilterEntry) => void;
  /** Remove a dynamic filter from a section by column name */
  removeDynamicFilter: (sectionId: string, column: string) => void;
  /** Update a dynamic filter's value */
  updateDynamicFilter: (sectionId: string, column: string, value: string) => void;
}

export const useWidgetSectionStore = create<WidgetSectionState>((set, get) => ({
  sections: {},

  getFilters: (sectionId: string) => {
    return get().sections[sectionId] ?? DEFAULT_SECTION_FILTERS;
  },

  updateFilters: (sectionId: string, partial: Partial<SectionFilters>) => {
    set((state) => {
      const prev = state.sections[sectionId] ?? DEFAULT_SECTION_FILTERS;
      const merged = { ...prev, ...partial };

      // Cascading reset: when branch changes, reset loanOfficer to 'all'
      // (unless loanOfficer is also being explicitly set in the same update)
      if (
        'branch' in partial &&
        partial.branch !== prev.branch &&
        !('loanOfficer' in partial)
      ) {
        merged.loanOfficer = 'all';
      }

      try {
        if (JSON.stringify(prev) === JSON.stringify(merged)) {
          return state;
        }
      } catch {
        // Fall through and update if serialization fails.
      }

      return {
        sections: { ...state.sections, [sectionId]: merged },
      };
    });
  },

  registerSection: (sectionId: string, sectionType: SectionType) => {
    set((state) => {
      if (state.sections[sectionId]) return state; // Already registered
      const base = { ...DEFAULT_SECTION_FILTERS, sectionType };
      // Loan detail defaults to "All" (no date filter) so the table shows all loans
      let filters = base;
      if (sectionType === 'loan-detail') {
        filters = { ...base, periodSelection: undefined, dateRange: undefined };
      } else if (sectionType === 'high-performers') {
        filters = {
          ...base,
          highPerformersDateType: 'funding_date',
          highPerformersLeftPeriod: 'mtd',
          highPerformersRightPeriod: 'ytd',
        };
      } else if (sectionType === 'actors') {
        const now = new Date();
        const start = new Date(now.getFullYear(), now.getMonth(), 1);
        const range = {
          start: start.toISOString().slice(0, 10),
          end: now.toISOString().slice(0, 10),
        };
        filters = {
          ...base,
          periodSelection: { type: 'preset' as const, preset: 'mtd' as const, dateRange: range },
          dateRange: range,
          actorsCalculation: 'average',
          actorsTurnTimeType: 'app_to_fund_days',
          actorsDateRangeType: 'calendar_days',
          actorsMeasure: 'units',
          actorsSelectedActor: null,
          actorsSelectedStatus: null,
          actorsTableDimensions: ['loan_officer', 'processor', 'underwriter', 'closer'],
          actorsTableColumnIds: [...ACTORS_TABLE_DEFAULT_COLUMN_IDS],
        };
      } else if (sectionType === 'pricing-dashboard') {
        filters = {
          ...base,
          pricingEntityType: 'branch',
          pricingActorType: 'loan_officer',
          pricingDateRange: 'mtd',
          pricingLoanFunding: 'funded',
          pricingLoanStatus: 'active',
          pricingLockStatus: 'total',
          pricingEntityValue: '',
          pricingEntityFilterType: undefined,
          pricingActorValue: '',
          pricingActorFilterType: undefined,
        };
      } else if (sectionType === 'pipeline-analysis') {
        filters = {
          ...base,
          pipelineAnalysisStartDateField: 'application_date',
          pipelineAnalysisYearRange: undefined,
          pipelineAnalysisLoanTypes: [],
          pipelineAnalysisLoanPurposes: [],
          pipelineAnalysisBranches: [],
          pipelineAnalysisViewMode: 'week',
          pipelineAnalysisPctMetric: 'volume',
          pipelineAnalysisSelectedWeekValues: [],
          pipelineAnalysisSelectedMonths: [],
        };
      } else if (sectionType === 'sales-scorecard-overview') {
        const now = new Date();
        const start = new Date(now.getFullYear(), 0, 1);
        const range = {
          start: start.toISOString().slice(0, 10),
          end: now.toISOString().slice(0, 10),
        };
        filters = {
          ...base,
          periodSelection: { type: 'preset' as const, preset: 'ytd' as const, dateRange: range },
          dateRange: range,
          salesScorecardOverviewMeasure: 'volume',
          salesScorecardOverviewTimeMeasure: 'monthly',
        };
      } else if (sectionType === 'lock-stratification') {
        filters = {
          ...base,
          lockStratLocked: 'all_active',
          lockStratMeasure: 'volume',
          lockStratMilestoneGroupBy: 'current_milestone',
          lockStratPullThroughPeriod: '60',
          lockStratSelectedInterestRateGroup: { level: 0 },
        };
      } else if (sectionType === 'loan-complexity') {
        const now = new Date();
        const start = new Date(now.getFullYear(), now.getMonth(), 1);
        const range = {
          start: start.toISOString().slice(0, 10),
          end: now.toISOString().slice(0, 10),
        };
        filters = {
          ...base,
          periodSelection: { type: 'preset' as const, preset: 'mtd' as const, dateRange: range },
          dateRange: range,
          loanComplexityGroupBy: 'actors',
          loanComplexityActorType: 'loan_officer',
          loanComplexityCurrentStatus: 'All',
          loanComplexitySelectedGroupNames: [],
        };
      } else if (sectionType === 'estimated-closings-risk') {
        filters = {
          ...base,
          estimatedClosingsDateRangeType: 'calendar_days',
          estimatedClosingsEcdSlice: null,
          estimatedClosingsComplexityBucket: null,
          estimatedClosingsRemainingComplexityGroup: null,
          estimatedClosingsRemainingProcessingStage: null,
          estimatedClosingsDetailColumnFilters: {},
        };
      } else if (sectionType === 'sales-company-overview') {
        filters = {
          ...base,
          salesCompanyOverviewLoanTypes: [],
          salesCompanyOverviewAgingBuckets: [],
        };
      } else if (sectionType === 'active-workload') {
        filters = {
          ...base,
          activeWorkloadActor: 'Processor',
          activeWorkloadAggregation: 'average',
          activeWorkloadDayCalcType: 'calendar_days',
          activeWorkloadSliceMilestones: [],
          activeWorkloadSliceDrilldown: {
            actorValues: [],
            loanTypes: [],
            loanPurposes: [],
          },
          activeWorkloadDetailColumnFilters: {},
          activeWorkloadDetailSort: { key: 'applicationDate', direction: 'asc' },
          activeWorkloadShowDetailColumnFilters: false,
        };
      } else if (sectionType === 'production-summary-by-week') {
        filters = {
          ...base,
          productionSummaryByWeekYearWeeks: {
            started_date: [],
            application_date: [],
            investor_lock_date: [],
            funding_date: [],
            closing_date: [],
          },
        };
      }
      return {
        sections: {
          ...state.sections,
          [sectionId]: filters,
        },
      };
    });
  },

  removeSection: (sectionId: string) => {
    set((state) => {
      const { [sectionId]: _, ...rest } = state.sections;
      return { sections: rest };
    });
  },

  getFiltersByType: (sectionType: SectionType) => {
    const sections = get().sections;
    for (const filters of Object.values(sections)) {
      if (filters.sectionType === sectionType) return filters;
    }
    return null;
  },

  addDynamicFilter: (sectionId: string, filter: DynamicFilterEntry) => {
    set((state) => {
      const prev = state.sections[sectionId];
      if (!prev) return state;
      const existing = prev.dynamicFilters || [];
      // Don't add if already present
      if (existing.some((f) => f.column === filter.column)) return state;
      return {
        sections: {
          ...state.sections,
          [sectionId]: { ...prev, dynamicFilters: [...existing, filter] },
        },
      };
    });
  },

  removeDynamicFilter: (sectionId: string, column: string) => {
    set((state) => {
      const prev = state.sections[sectionId];
      if (!prev || !prev.dynamicFilters) return state;
      return {
        sections: {
          ...state.sections,
          [sectionId]: {
            ...prev,
            dynamicFilters: prev.dynamicFilters.filter((f) => f.column !== column),
          },
        },
      };
    });
  },

  updateDynamicFilter: (sectionId: string, column: string, value: string) => {
    set((state) => {
      const prev = state.sections[sectionId];
      if (!prev || !prev.dynamicFilters) return state;
      return {
        sections: {
          ...state.sections,
          [sectionId]: {
            ...prev,
            dynamicFilters: prev.dynamicFilters.map((f) =>
              f.column === column ? { ...f, value } : f,
            ),
          },
        },
      };
    });
  },
}));
