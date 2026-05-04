/**
 * WidgetDataProvider – React context that provides data to canvas widgets.
 *
 * Reads per-section filter state (including PeriodSelection) from
 * widgetSectionStore so that DatePeriodPicker changes drive data hooks.
 *
 * Each data source hook is called once with the filters from its
 * corresponding section (or defaults if no section is registered).
 */

import React, { createContext, useContext, useEffect, useMemo } from 'react';
import { useTenantStore } from '@/stores/tenantStore';
import { useChannelStore } from '@/stores/channelStore';
import { useAuth } from '@/contexts/AuthContext';
import {
  useWidgetSectionStore,
  DEFAULT_SECTION_FILTERS,
} from '@/stores/widgetSectionStore';
import type { SectionFilters } from '@/stores/widgetSectionStore';
import type { PeriodPreset } from '@/components/ui/DatePeriodPicker';
import { computePresetDateRange } from '@/components/ui/DatePeriodPicker';
import { useCompanyScorecardData } from '@/hooks/useCompanyScorecardData';
import { useCreditRiskData } from '@/hooks/useCreditRiskData';
import { useSalesScorecardData } from '@/hooks/useSalesScorecardData';
import { useOperationsScorecardData } from '@/hooks/useOperationsScorecardData';
import { useOperationsScorecardTrendsData } from '@/hooks/useOperationsScorecardTrendsData';
import { useSalesTrendsData } from '@/hooks/useSalesTrendsData';
import { useFunnelData } from '@/hooks/useFunnelData';
import { useTopTieringComparisonData } from '@/hooks/useTopTieringComparisonData';
import { useLeaderboardData } from '@/hooks/useLeaderboardData';
import { useLoanDetailData } from '@/hooks/useLoanDetailData';
import {
  useHighPerformersData,
  type HighPerformersDateType,
  type HighPerformersTimePeriod,
} from '@/hooks/useHighPerformersData';
import { useActorsData } from '@/hooks/useActorsData';
import type { ActorDimension } from '@/hooks/useActorsData';
import { usePricingDashboardWorkbenchData } from '@/hooks/usePricingDashboardData';
import type { PricingDashboardFilters as PricingFilters } from '@/hooks/usePricingDashboardData';
import {
  usePipelineAnalysisData,
  usePipelineAnalysisRange,
  usePipelineAnalysisConfig,
} from '@/hooks/usePipelineAnalysisData';
import type { DataSourceId } from '../registry/types';
import { buildPricingReportColumns, buildPricingDetailColumns } from '@/lib/pricingDashboardColumns';
import { useLoanComplexityData } from '@/hooks/useLoanComplexityData';
import type { LoanComplexityGroupBy } from '@/hooks/useLoanComplexityData';
import { useLoanComplexityPivot } from '@/hooks/useLoanComplexityPivot';
import { useLoanComplexityGroupLoans } from '@/hooks/useLoanComplexityGroupLoans';
import { useLoanComplexityStatusOptions } from '@/hooks/useLoanComplexityStatusOptions';
import { useEstimatedClosingsRiskData } from '@/hooks/useEstimatedClosingsRiskData';
import { useSalesCompanyOverviewData } from '@/hooks/useSalesCompanyOverviewData';
import {
  mapToLeaderboardTimeframe,
  mapToOpsDateRange,
  mapToSalesTrendsDateRange,
  mapToTopTieringTimeFilter,
} from '@/components/widgets/data/periodAdapters';

/** Build dimension filter array from section dynamicFilters (for APIs that accept them).
 *  @param exclude – column names already handled natively by the hook (e.g. branch, loan_officer). */
function toDimensionFilters(
  filters: SectionFilters | null,
  exclude?: string[],
): Array<{ column: string; value: string }> | undefined {
  const ex = exclude ? new Set(exclude) : undefined;
  const list = filters?.dynamicFilters
    ?.filter((df) => df.value && df.value !== 'all' && (!ex || !ex.has(df.column)))
    .map((df) => ({ column: df.column, value: df.value }));
  return list && list.length > 0 ? list : undefined;
}

// Columns already handled natively by individual hooks (branch/loan_officer passed as dedicated params)
const NATIVE_BRANCH_LO = ['branch', 'loan_officer'];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SourceResult {
  data: unknown;
  loading: boolean;
  error: string | null;
}

interface WidgetDataContextValue {
  getSourceData: (sourceId: DataSourceId) => SourceResult;
}

export interface WidgetDataProviderProps {
  children: React.ReactNode;
  /**
   * When provided, ALL data-source filter lookups use this specific section's
   * filters instead of the default "find first by sectionType" strategy.
   * Used by WidgetGroup to scope data fetches to the group's own filters.
   */
  sectionId?: string;
}

// ---------------------------------------------------------------------------
// Preset → Hook-param mapping helpers (see periodAdapters.ts)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const WidgetDataContext = createContext<WidgetDataContextValue | null>(null);

export { WidgetDataContext };

const EMPTY_RESULT: SourceResult = { data: null, loading: false, error: null };

// ---------------------------------------------------------------------------
// Helper – find the first section of a given type
// ---------------------------------------------------------------------------

function findSectionFilters(
  sections: Record<string, SectionFilters>,
  type: string,
): SectionFilters {
  for (const f of Object.values(sections)) {
    if (f.sectionType === type) return f;
  }
  return DEFAULT_SECTION_FILTERS;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function WidgetDataProvider({ children, sectionId }: WidgetDataProviderProps) {
  const { selectedTenantId } = useTenantStore();
  const { user } = useAuth();
  const effectiveTenantId = selectedTenantId || user?.tenant_id || null;
  const { selectedChannel } = useChannelStore();

  // Subscribe to the full section map – any filter change triggers re-render
  const sections = useWidgetSectionStore((s) => s.sections);

  // When sectionId is provided (scoped provider inside a WidgetGroup),
  // use that section's filters for ALL data sources so the group's date
  // filter controls actually drive the data hooks.
  const scopedFilters = sectionId ? (sections[sectionId] ?? DEFAULT_SECTION_FILTERS) : null;

  // Find filters for each source type
  const csFilters = useMemo(() => scopedFilters ?? findSectionFilters(sections, 'company-scorecard'), [sections, scopedFilters]);
  const crFilters = useMemo(() => scopedFilters ?? findSectionFilters(sections, 'credit-risk'), [sections, scopedFilters]);
  const ssFilters = useMemo(() => scopedFilters ?? findSectionFilters(sections, 'sales-scorecard'), [sections, scopedFilters]);
  const osFilters = useMemo(() => scopedFilters ?? findSectionFilters(sections, 'operations-scorecard'), [sections, scopedFilters]);
  const otFilters = useMemo(() => scopedFilters ?? findSectionFilters(sections, 'operations-trends'), [sections, scopedFilters]);
  const stFilters = useMemo(() => scopedFilters ?? findSectionFilters(sections, 'sales-trends'), [sections, scopedFilters]);
  const fnFilters = useMemo(() => scopedFilters ?? findSectionFilters(sections, 'funnel'), [sections, scopedFilters]);
  const ttcFilters = useMemo(() => scopedFilters ?? findSectionFilters(sections, 'top-tiering-comparison'), [sections, scopedFilters]);
  const lbFilters = useMemo(() => scopedFilters ?? findSectionFilters(sections, 'leaderboard'), [sections, scopedFilters]);
  const ldFilters = useMemo(() => scopedFilters ?? findSectionFilters(sections, 'loan-detail'), [sections, scopedFilters]);
  const hpFilters = useMemo(() => scopedFilters ?? findSectionFilters(sections, 'high-performers'), [sections, scopedFilters]);
  const actorsFilters = useMemo(() => scopedFilters ?? findSectionFilters(sections, 'actors'), [sections, scopedFilters]);
  const pdFilters = useMemo(() => scopedFilters ?? findSectionFilters(sections, 'pricing-dashboard'), [sections, scopedFilters]);
  const paFilters = useMemo(() => scopedFilters ?? findSectionFilters(sections, 'pipeline-analysis'), [sections, scopedFilters]);
  const lcFilters = useMemo(() => scopedFilters ?? findSectionFilters(sections, 'loan-complexity'), [sections, scopedFilters]);
  const ecrFilters = useMemo(() => scopedFilters ?? findSectionFilters(sections, 'estimated-closings-risk'), [sections, scopedFilters]);
  const scoFilters = useMemo(() => scopedFilters ?? findSectionFilters(sections, 'sales-company-overview'), [sections, scopedFilters]);

  const hasLoanComplexitySection = useMemo(
    () =>
      scopedFilters?.sectionType === 'loan-complexity' ||
      Object.values(sections).some((s) => s.sectionType === 'loan-complexity'),
    [scopedFilters?.sectionType, sections],
  );

  const hasLoanDetailSection = useMemo(
    () =>
      scopedFilters?.sectionType === 'loan-detail' ||
      Object.values(sections).some((s) => s.sectionType === 'loan-detail'),
    [scopedFilters?.sectionType, sections],
  );

  // ---- Hook calls with dynamic filter values ----

  // Effective branch/loanOfficer: prefer dynamic filter value when present (so "Add Filter" Branch works)
  const csEffectiveBranch = useMemo(() => {
    const fromDynamic = csFilters?.dynamicFilters?.find((df) => df.column === 'branch')?.value;
    return fromDynamic && fromDynamic !== 'all' ? fromDynamic : (csFilters?.branch ?? 'all');
  }, [csFilters?.branch, csFilters?.dynamicFilters]);
  const csEffectiveLoanOfficer = useMemo(() => {
    const fromDynamic = csFilters?.dynamicFilters?.find((df) => df.column === 'loan_officer')?.value;
    return fromDynamic && fromDynamic !== 'all' ? fromDynamic : (csFilters?.loanOfficer ?? 'all');
  }, [csFilters?.loanOfficer, csFilters?.dynamicFilters]);

  // Memoize dimension filters to avoid new array references each render (prevents fetch loops)
  const csDimensionFilters = useMemo(
    () => toDimensionFilters(csFilters, NATIVE_BRANCH_LO),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [csFilters?.dynamicFilters],
  );
  const crDimensionFilters = useMemo(
    () => toDimensionFilters(crFilters),
    [crFilters?.dynamicFilters],
  );
  const ssDimensionFilters = useMemo(() => toDimensionFilters(ssFilters), [ssFilters?.dynamicFilters]);
  const osDimensionFilters = useMemo(() => toDimensionFilters(osFilters), [osFilters?.dynamicFilters]);
  const otDimensionFilters = useMemo(() => toDimensionFilters(otFilters), [otFilters?.dynamicFilters]);
  const stDimensionFilters = useMemo(() => toDimensionFilters(stFilters), [stFilters?.dynamicFilters]);
  const fnDimensionFilters = useMemo(() => toDimensionFilters(fnFilters), [fnFilters?.dynamicFilters]);
  const ttcDimensionFilters = useMemo(() => toDimensionFilters(ttcFilters), [ttcFilters?.dynamicFilters]);
  const lbDimensionFilters = useMemo(() => toDimensionFilters(lbFilters), [lbFilters?.dynamicFilters]);
  const hpDimensionFilters = useMemo(() => toDimensionFilters(hpFilters), [hpFilters?.dynamicFilters]);
  const actorsDimensionFilters = useMemo(() => toDimensionFilters(actorsFilters), [actorsFilters?.dynamicFilters]);
  const pdDimensionFilters = useMemo(() => toDimensionFilters(pdFilters), [pdFilters?.dynamicFilters]);
  const paDimensionFilters = useMemo(() => toDimensionFilters(paFilters), [paFilters?.dynamicFilters]);
  const ecrDimensionFilters = useMemo(() => toDimensionFilters(ecrFilters), [ecrFilters?.dynamicFilters]);

  const companyScorecard = useCompanyScorecardData({
    year: csFilters.year,
    branch: csEffectiveBranch,
    loanOfficer: csEffectiveLoanOfficer,
    application: csFilters.application,
    channel: selectedChannel,
    dateField: csFilters.dateField,
    dateRange: csFilters.periodSelection?.dateRange ?? csFilters.dateRange,
    tenantId: effectiveTenantId,
    dimensionFilters: csDimensionFilters,
  });

  const creditRisk = useCreditRiskData({
    applicationType: crFilters.applicationType as any,
    channel: selectedChannel,
    year: crFilters.year,
    dateRange: crFilters.periodSelection?.dateRange ?? crFilters.dateRange,
    tenantId: effectiveTenantId,
    dimensionFilters: crDimensionFilters,
  });

  const ssDateRange = ssFilters.periodSelection?.dateRange ?? ssFilters.dateRange;

  const salesScorecard = useSalesScorecardData(
    ssFilters.actorType,
    ssDateRange,
    effectiveTenantId,
    selectedChannel,
    ssDimensionFilters,
  );

  // Operations Scorecard: map preset → DateRangeType, forward custom range if set
  const osDR = useMemo(() => mapToOpsDateRange(osFilters), [osFilters]);
  const osCustomDR = useMemo(() => {
    const ps = osFilters.periodSelection;
    if (ps?.type === 'custom' && ps.dateRange) {
      return { start: ps.dateRange.start, end: ps.dateRange.end };
    }
    return undefined;
  }, [osFilters.periodSelection]);
  const operationsScorecard = useOperationsScorecardData(
    'underwriter',
    osDR,
    effectiveTenantId,
    selectedChannel,
    osCustomDR,
    osDimensionFilters,
  );

  // Operations Trends: actor type from filters, fixed 13-month window
  const operationsTrends = useOperationsScorecardTrendsData(
    otFilters.actorType === 'branch' ? 'underwriter' : 'underwriter',
    'vs-target',
    effectiveTenantId,
    selectedChannel,
    13,
    otDimensionFilters,
  );

  // Sales Trends: map preset → DateRangeOption, forward custom range if set
  const stDR = useMemo(() => mapToSalesTrendsDateRange(stFilters), [stFilters]);
  const stCustomDR = useMemo(() => {
    const ps = stFilters.periodSelection;
    if (ps?.type === 'custom' && ps.dateRange) {
      return { start: ps.dateRange.start, end: ps.dateRange.end };
    }
    return undefined;
  }, [stFilters.periodSelection]);
  const salesTrends = useSalesTrendsData(
    stDR,
    selectedChannel ?? 'Retail',
    effectiveTenantId,
    stCustomDR,
    stDimensionFilters,
  );

  // Funnel: uses year-based or custom date filter
  const currentYear = new Date().getFullYear();
  const funnelDateFilter = useMemo(() => {
    const ps = fnFilters.periodSelection;
    if (ps?.type === 'custom' || (ps?.type === 'preset' && ps.dateRange)) {
      return { type: 'custom' as const, startDate: ps.dateRange.start, endDate: ps.dateRange.end };
    }
    return { type: 'year' as const, year: fnFilters.year ?? currentYear };
  }, [fnFilters, currentYear]);

  const { funnelData, loading: funnelLoading } = useFunnelData(
    funnelDateFilter,
    effectiveTenantId,
    { channelGroup: selectedChannel },
    fnDimensionFilters,
  );

  // Top Tiering: map preset → TimeFilterType + optional customDateRange
  const ttcMapping = useMemo(() => mapToTopTieringTimeFilter(ttcFilters), [ttcFilters]);
  const topTieringComparison = useTopTieringComparisonData(
    ttcFilters.actorType === 'branch' ? 'branch' : 'loan-officer',
    ttcMapping.timeFilter,
    effectiveTenantId,
    selectedChannel,
    ttcMapping.customDateRange,
    ttcDimensionFilters,
  );

  // Leaderboard: map preset → LeaderboardTimeframe
  const lbMapping = useMemo(() => mapToLeaderboardTimeframe(lbFilters), [lbFilters]);
  const { leaderboardData, loading: leaderboardLoading } = useLeaderboardData(
    lbMapping.timeframe,
    effectiveTenantId,
    {
      channelGroup: selectedChannel,
      ...(lbMapping.startDate ? { startDate: lbMapping.startDate, endDate: lbMapping.endDate } : {}),
    },
    lbDimensionFilters,
  );

  // Loan detail: effective branch/loanOfficer from built-in or dynamic (so "Add Filter" Branch/LO work)
  const ldEffectiveBranch = useMemo(() => {
    const fromDynamic = ldFilters?.dynamicFilters?.find((df) => df.column === 'branch')?.value;
    return fromDynamic && fromDynamic !== 'all' ? fromDynamic : (ldFilters?.branch ?? 'all');
  }, [ldFilters?.branch, ldFilters?.dynamicFilters]);
  const ldEffectiveLoanOfficer = useMemo(() => {
    const fromDynamic = ldFilters?.dynamicFilters?.find((df) => df.column === 'loan_officer')?.value;
    return fromDynamic && fromDynamic !== 'all' ? fromDynamic : (ldFilters?.loanOfficer ?? 'all');
  }, [ldFilters?.loanOfficer, ldFilters?.dynamicFilters]);

  const ldDimensionFilters = useMemo(
    () => toDimensionFilters(ldFilters, NATIVE_BRANCH_LO),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ldFilters?.dynamicFilters],
  );

  // Loan detail: only apply date filter when user has explicitly selected a period (preset/year/custom).
  // When periodSelection is missing, show all loans so the table isn't empty by default.
  // Include dynamic filters (loan purpose, channel, etc.) so ADD FILTER DIMENSION filters are applied.
  const ldDateRange = useMemo(() => {
    if (!ldFilters) return undefined;
    return ldFilters.sectionType === 'loan-detail'
      ? (ldFilters.periodSelection?.dateRange ?? undefined)
      : (ldFilters.periodSelection?.dateRange ?? ldFilters.dateRange);
  }, [ldFilters?.sectionType, ldFilters?.periodSelection?.dateRange, ldFilters?.dateRange]);

  const loanDetailFilters = useMemo(
    () =>
      ldFilters
        ? {
            dateField: ldFilters.dateField,
            dateRange: ldDateRange,
            branch: ldEffectiveBranch,
            loanOfficer: ldEffectiveLoanOfficer,
            dimensionFilters: ldDimensionFilters,
          }
        : undefined,
    [ldFilters?.dateField, ldDateRange, ldEffectiveBranch, ldEffectiveLoanOfficer, ldDimensionFilters],
  );
  const loanDetail = useLoanDetailData(effectiveTenantId, loanDetailFilters ?? undefined, { enabled: hasLoanDetailSection });

  // High Performers: left and right period with shared date type
  const hpDateType = (hpFilters?.highPerformersDateType ?? 'funding_date') as HighPerformersDateType;
  const hpLeftPeriod = (hpFilters?.highPerformersLeftPeriod ?? 'mtd') as HighPerformersTimePeriod;
  const hpRightPeriod = (hpFilters?.highPerformersRightPeriod ?? 'ytd') as HighPerformersTimePeriod;
  const { data: hpLeftData, loading: hpLeftLoading, error: hpLeftError } = useHighPerformersData(
    hpDateType,
    hpLeftPeriod,
    { channelGroup: selectedChannel, tenantId: effectiveTenantId, dimensionFilters: hpDimensionFilters },
  );
  const { data: hpRightData, loading: hpRightLoading, error: hpRightError } = useHighPerformersData(
    hpDateType,
    hpRightPeriod,
    { channelGroup: selectedChannel, tenantId: effectiveTenantId, dimensionFilters: hpDimensionFilters },
  );
  const highPerformersData = useMemo(
    () => ({ left: hpLeftData, right: hpRightData }),
    [hpLeftData, hpRightData],
  );
  const highPerformersLoading = hpLeftLoading || hpRightLoading;
  const highPerformersError = hpLeftError || hpRightError;

  // Actors: period + calculation/turn/measure/actor/status from section filters
  const actorsDateRange = useMemo(() => {
    const range = actorsFilters?.periodSelection?.dateRange ?? actorsFilters?.dateRange;
    if (range?.start && range?.end) return { start: range.start, end: range.end };
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    return { start: start.toISOString().slice(0, 10), end: now.toISOString().slice(0, 10) };
  }, [actorsFilters?.periodSelection?.dateRange, actorsFilters?.dateRange]);
  const actorsTableDims = useMemo((): [ActorDimension, ActorDimension, ActorDimension, ActorDimension] => {
    const d = actorsFilters?.actorsTableDimensions;
    if (Array.isArray(d) && d.length === 4) return d as [ActorDimension, ActorDimension, ActorDimension, ActorDimension];
    return ['loan_officer', 'processor', 'underwriter', 'closer'];
  }, [actorsFilters?.actorsTableDimensions]);
  const { data: actorsData, loading: actorsLoading, error: actorsError } = useActorsData({
    startDate: actorsDateRange.start,
    endDate: actorsDateRange.end,
    calculation: (actorsFilters?.actorsCalculation as 'average' | 'median') ?? 'average',
    turnTimeType: (actorsFilters?.actorsTurnTimeType as 'app_to_fund_days' | 'app_to_closing_days') ?? 'app_to_fund_days',
    dateRangeType: (actorsFilters?.actorsDateRangeType as 'calendar_days' | 'business_days') ?? 'calendar_days',
    measure: (actorsFilters?.actorsMeasure as 'units' | 'volume') ?? 'units',
    selectedTenantId: effectiveTenantId,
    channelGroup: selectedChannel,
    selectedActor: (actorsFilters?.actorsSelectedActor ?? null) as { type: ActorDimension; name: string } | null,
    selectedStatus: actorsFilters?.actorsSelectedStatus ?? null,
    tableDimensions: actorsTableDims,
    dimensionFilters: actorsDimensionFilters,
  });

  // Pricing Dashboard: build filters from section and fetch all 4 tables + KPIs
  const pricingFilters = useMemo((): PricingFilters => ({
    channel: selectedChannel ?? undefined,
    entityType: (pdFilters?.pricingEntityType ?? 'branch') as PricingFilters['entityType'],
    entityFilterType: pdFilters?.pricingEntityFilterType as PricingFilters['entityFilterType'] | undefined,
    entityValue: pdFilters?.pricingEntityValue ?? '',
    actorType: (pdFilters?.pricingActorType ?? 'loan_officer') as PricingFilters['actorType'],
    actorFilterType: pdFilters?.pricingActorFilterType as PricingFilters['actorFilterType'] | undefined,
    actorValue: pdFilters?.pricingActorValue ?? '',
    dateRange: (pdFilters?.pricingDateRange ?? 'mtd') as PricingFilters['dateRange'],
    loanFunding: (pdFilters?.pricingLoanFunding ?? 'funded') as PricingFilters['loanFunding'],
    loanStatus: (pdFilters?.pricingLoanStatus ?? 'active') as PricingFilters['loanStatus'],
    lockStatus: (pdFilters?.pricingLockStatus ?? 'total') as PricingFilters['lockStatus'],
  }), [selectedChannel, pdFilters?.pricingEntityType, pdFilters?.pricingEntityFilterType, pdFilters?.pricingEntityValue, pdFilters?.pricingActorType, pdFilters?.pricingActorFilterType, pdFilters?.pricingActorValue, pdFilters?.pricingDateRange, pdFilters?.pricingLoanFunding, pdFilters?.pricingLoanStatus, pdFilters?.pricingLockStatus]);
  const pricingDashboard = usePricingDashboardWorkbenchData(pricingFilters, {
    tenantId: effectiveTenantId,
    selectedChannel,
    dimensionFilters: pdDimensionFilters,
    metricColumns: pdFilters?.pricingDashboardColumns?.map((c) => c.key),
  });

  // Pipeline Analysis (workbench: use section filters when present)
  const pipelineRange = usePipelineAnalysisRange(effectiveTenantId ?? null);
  const pipelineConfig = usePipelineAnalysisConfig(effectiveTenantId ?? null);
  const pipelineFromTo = useMemo(() => {
    if (paFilters?.pipelineAnalysisYearRange) {
      const [start, end] = paFilters.pipelineAnalysisYearRange.split('-').map(Number);
      if (!Number.isNaN(start) && !Number.isNaN(end))
        return { from: `${start}-01-01`, to: `${end}-12-31` };
    }
    const r = pipelineRange.range;
    const max = r?.maxYear ?? new Date().getFullYear();
    const startYear = Math.max((r?.minYear ?? max - 2), max - 1);
    const endYear = max;
    return { from: `${startYear}-01-01`, to: `${endYear}-12-31` };
  }, [paFilters?.pipelineAnalysisYearRange, pipelineRange.range]);
  const pipelineFiltersForApi = useMemo(() => {
    const types = paFilters?.pipelineAnalysisLoanTypes ?? [];
    const purposes = paFilters?.pipelineAnalysisLoanPurposes ?? [];
    const branches = paFilters?.pipelineAnalysisBranches ?? [];
    if (types.length > 0 || purposes.length > 0 || branches.length > 0)
      return { loanTypes: types.length ? types : undefined, loanPurposes: purposes.length ? purposes : undefined, branches: branches.length ? branches : undefined };
    return undefined;
  }, [paFilters?.pipelineAnalysisLoanTypes, paFilters?.pipelineAnalysisLoanPurposes, paFilters?.pipelineAnalysisBranches]);
  const pipelineSnapshots = usePipelineAnalysisData({
    from: pipelineFromTo.from,
    to: pipelineFromTo.to,
    tenantId: effectiveTenantId ?? null,
    startDateField: (paFilters?.pipelineAnalysisStartDateField ?? 'application_date') as 'application_date' | 'lock_date' | 'processing_date' | 'credit_pull_date' | 'submitted_to_underwriting_date',
    filters: pipelineFiltersForApi,
    dimensionFilters: paDimensionFilters,
  });

  // Refetch pipeline snapshots after user changes snapshot day (and triggers backfill)
  useEffect(() => {
    if (paFilters?.pipelineAnalysisSnapshotDay != null) {
      pipelineSnapshots.refetch();
    }
  }, [paFilters?.pipelineAnalysisSnapshotDay]);

  const pipelineAnalysisSource = useMemo(() => ({
    snapshots: pipelineSnapshots.snapshots,
    range: pipelineRange.range,
    config: pipelineConfig.config,
    yearRange: paFilters?.pipelineAnalysisYearRange ?? null,
    viewMode: (paFilters?.pipelineAnalysisViewMode ?? 'week') as 'week' | 'month',
    pctMetric: (paFilters?.pipelineAnalysisPctMetric ?? 'volume') as 'volume' | 'units',
    loading: pipelineRange.loading || pipelineConfig.loading || pipelineSnapshots.loading,
    error: pipelineRange.error || pipelineConfig.error || pipelineSnapshots.error,
  }), [
    pipelineSnapshots.snapshots,
    pipelineRange.range,
    pipelineRange.loading,
    pipelineRange.error,
    pipelineConfig.config,
    pipelineConfig.loading,
    pipelineConfig.error,
    pipelineSnapshots.loading,
    pipelineSnapshots.error,
    paFilters?.pipelineAnalysisYearRange,
    paFilters?.pipelineAnalysisViewMode,
    paFilters?.pipelineAnalysisPctMetric,
  ]);

  // Loan Complexity: date range, effective groupBy (actors -> actorType), current status, selected group
  const lcDateRange = useMemo(() => {
    const range = lcFilters?.periodSelection?.dateRange ?? lcFilters?.dateRange;
    if (range?.start && range?.end) return { start: range.start, end: range.end };
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    return { start: start.toISOString().slice(0, 10), end: now.toISOString().slice(0, 10) };
  }, [lcFilters?.periodSelection?.dateRange, lcFilters?.dateRange]);
  const lcEffectiveGroupBy = useMemo((): LoanComplexityGroupBy => {
    const groupBy = lcFilters?.loanComplexityGroupBy ?? 'actors';
    const actorType = (lcFilters?.loanComplexityActorType ?? 'loan_officer') as LoanComplexityGroupBy;
    return groupBy === 'actors' ? actorType : (groupBy as LoanComplexityGroupBy);
  }, [lcFilters?.loanComplexityGroupBy, lcFilters?.loanComplexityActorType]);
  const lcCurrentStatus = useMemo(() => {
    const s = lcFilters?.loanComplexityCurrentStatus ?? 'All';
    return s === 'All' || !s?.trim() ? null : s.trim();
  }, [lcFilters?.loanComplexityCurrentStatus]);
  const lcGroupFilters = useMemo((): { groupBy: LoanComplexityGroupBy; groupName: string }[] => {
    const groups = lcFilters?.loanComplexitySelectedGroups;
    if (groups && groups.length > 0) {
      return groups.map((g) => ({ groupBy: g.dimension as LoanComplexityGroupBy, groupName: g.groupName }));
    }
    const names = lcFilters?.loanComplexitySelectedGroupNames ?? [];
    if (names.length === 0) return [];
    const groupBy = lcEffectiveGroupBy;
    return names.map((groupName) => ({ groupBy, groupName }));
  }, [lcFilters?.loanComplexitySelectedGroups, lcFilters?.loanComplexitySelectedGroupNames, lcEffectiveGroupBy]);

  const lcBars = useLoanComplexityData({
    startDate: lcDateRange.start,
    endDate: lcDateRange.end,
    groupBy: lcEffectiveGroupBy,
    selectedTenantId: effectiveTenantId,
    channelGroup: selectedChannel,
    currentLoanStatus: lcCurrentStatus,
    enabled: hasLoanComplexitySection,
  });
  const lcPivot = useLoanComplexityPivot({
    startDate: lcDateRange.start,
    endDate: lcDateRange.end,
    selectedTenantId: effectiveTenantId,
    channelGroup: selectedChannel,
    currentLoanStatus: lcCurrentStatus,
    enabled: hasLoanComplexitySection,
  });
  const lcLoans = useLoanComplexityGroupLoans({
    startDate: lcDateRange.start,
    endDate: lcDateRange.end,
    groupFilters: lcGroupFilters,
    selectedTenantId: effectiveTenantId,
    channelGroup: selectedChannel,
    currentLoanStatus: lcCurrentStatus,
    enabled: hasLoanComplexitySection,
  });
  const lcStatusOptions = useLoanComplexityStatusOptions({
    startDate: lcDateRange.start,
    endDate: lcDateRange.end,
    selectedTenantId: effectiveTenantId,
    channelGroup: selectedChannel,
    enabled: hasLoanComplexitySection,
  });

  const loanComplexitySource = useMemo(() => ({
    data: {
      pivot: lcPivot.data,
      bars: lcBars.data?.bars ?? [],
      loans: lcLoans.loans,
      statusOptions: lcStatusOptions.data,
    },
    loading: lcBars.loading || lcPivot.loading || lcLoans.loading || lcStatusOptions.loading,
    error: lcBars.error || lcPivot.error || lcLoans.error || lcStatusOptions.error,
  }), [
    lcPivot.data,
    lcBars.data?.bars,
    lcLoans.loans,
    lcStatusOptions.data,
    lcBars.loading,
    lcPivot.loading,
    lcLoans.loading,
    lcStatusOptions.loading,
    lcBars.error,
    lcPivot.error,
    lcLoans.error,
    lcStatusOptions.error,
  ]);

  const estimatedClosingsRisk = useEstimatedClosingsRiskData({
    tenantId: effectiveTenantId,
    channelGroup: selectedChannel,
    dateRangeType: (ecrFilters?.estimatedClosingsDateRangeType ?? 'calendar_days') as 'calendar_days' | 'business_days',
    fetchAllDetailRows: true,
    dimensionFilters: ecrDimensionFilters,
    pageSliceFilters: {
      ecdSlice: ecrFilters?.estimatedClosingsEcdSlice ?? null,
      complexityBarBucket: ecrFilters?.estimatedClosingsComplexityBucket ?? null,
      remainingComplexityGroup: ecrFilters?.estimatedClosingsRemainingComplexityGroup ?? null,
      remainingProcessingStage: ecrFilters?.estimatedClosingsRemainingProcessingStage ?? null,
    },
    detailColumnFilters: ecrFilters?.estimatedClosingsDetailColumnFilters,
  });

  const salesCompanyOverview = useSalesCompanyOverviewData(
    effectiveTenantId,
    selectedChannel,
    {
      loanTypes: scoFilters?.salesCompanyOverviewLoanTypes ?? [],
      agingBuckets: scoFilters?.salesCompanyOverviewAgingBuckets ?? [],
    },
  );

  // Build lookup
  const sourceMap = useMemo<Record<string, SourceResult>>(() => ({
    'company-scorecard': {
      data: companyScorecard.data,
      loading: companyScorecard.loading,
      error: companyScorecard.error,
    },
    'credit-risk': {
      data: creditRisk.data,
      loading: creditRisk.loading,
      error: creditRisk.error,
    },
    'sales-scorecard': {
      data: salesScorecard.data,
      loading: salesScorecard.loading,
      error: salesScorecard.error,
    },
    'operations-scorecard': {
      data: operationsScorecard.data,
      loading: operationsScorecard.loading,
      error: operationsScorecard.error,
    },
    'operations-trends': {
      data: operationsTrends.data,
      loading: operationsTrends.loading,
      error: operationsTrends.error,
    },
    'sales-trends': {
      data: salesTrends.data,
      loading: salesTrends.loading,
      error: salesTrends.error,
    },
    'funnel': {
      data: funnelData,
      loading: funnelLoading,
      error: null,
    },
    'top-tiering-comparison': {
      data: topTieringComparison.data
        ? { ...topTieringComparison.data, _actorType: ttcFilters?.actorType ?? 'loan_officer' }
        : null,
      loading: topTieringComparison.loading,
      error: topTieringComparison.error,
    },
    'dashboard-metrics': {
      data: leaderboardData,
      loading: leaderboardLoading,
      error: null,
    },
    // Self-managed embed components fetch their own data.
    // Provide static placeholders so useWidgetData resolves.
    'executive-dashboard': {
      data: { ready: true },
      loading: false,
      error: null,
    },
    'closing-forecast': {
      data: { ready: true },
      loading: false,
      error: null,
    },
    'financial-modeling': {
      data: { ready: true },
      loading: false,
      error: null,
    },
    'Cohi-insights': {
      data: { ready: true },
      loading: false,
      error: null,
    },
    'industry-news': {
      data: { ready: true },
      loading: false,
      error: null,
    },
    'loan-detail': {
      data: loanDetail.data,
      loading: loanDetail.loading,
      error: loanDetail.error,
    },
    'workflow-conversion': {
      data: { ready: true },
      loading: false,
      error: null,
    },
    'sales-scorecard-overview': {
      data: { ready: true },
      loading: false,
      error: null,
    },
    'high-performers': {
      data: highPerformersData,
      loading: highPerformersLoading,
      error: highPerformersError,
    },
    'actors': {
      data: actorsData,
      loading: actorsLoading,
      error: actorsError,
    },
    'pricing-dashboard': {
      data: {
        ...pricingDashboard,
        reportColumns: buildPricingReportColumns(pdFilters?.pricingDashboardColumns),
        detailColumns: buildPricingDetailColumns(pdFilters?.pricingDashboardColumns),
      },
      loading: pricingDashboard.loading,
      error: pricingDashboard.error,
    },
    'pipeline-analysis': {
      data: {
        snapshots: pipelineSnapshots.snapshots,
        range: pipelineRange.range,
        config: pipelineConfig.config,
        yearRange: paFilters?.pipelineAnalysisYearRange ?? null,
        viewMode: (paFilters?.pipelineAnalysisViewMode ?? 'week') as 'week' | 'month',
        pctMetric: (paFilters?.pipelineAnalysisPctMetric ?? 'volume') as 'volume' | 'units',
      },
      loading: pipelineAnalysisSource.loading,
      error: pipelineAnalysisSource.error,
    },
    'loan-complexity': {
      data: loanComplexitySource.data,
      loading: loanComplexitySource.loading,
      error: loanComplexitySource.error,
    },
    'estimated-closings-risk': {
      data: estimatedClosingsRisk.data,
      loading: estimatedClosingsRisk.loading,
      error: estimatedClosingsRisk.error,
    },
    'sales-company-overview': {
      data: salesCompanyOverview.data,
      loading: salesCompanyOverview.loading,
      error: null,
    },
  }), [
    companyScorecard.data, companyScorecard.loading, companyScorecard.error,
    creditRisk.data, creditRisk.loading, creditRisk.error,
    salesScorecard.data, salesScorecard.loading, salesScorecard.error,
    operationsScorecard.data, operationsScorecard.loading, operationsScorecard.error,
    operationsTrends.data, operationsTrends.loading, operationsTrends.error,
    salesTrends.data, salesTrends.loading, salesTrends.error,
    funnelData, funnelLoading,
    topTieringComparison.data, topTieringComparison.loading, topTieringComparison.error,
    ttcFilters?.actorType,
    leaderboardData, leaderboardLoading,
    loanDetail.data, loanDetail.loading, loanDetail.error,
    highPerformersData, highPerformersLoading, highPerformersError,
    actorsData, actorsLoading, actorsError,
    pricingDashboard,
    pdFilters?.pricingDashboardColumns,
    pipelineAnalysisSource,
    paFilters?.pipelineAnalysisYearRange,
    paFilters?.pipelineAnalysisViewMode,
    paFilters?.pipelineAnalysisPctMetric,
    loanComplexitySource,
    estimatedClosingsRisk.data,
    estimatedClosingsRisk.loading,
    estimatedClosingsRisk.error,
    salesCompanyOverview.data,
    salesCompanyOverview.loading,
  ]);

  const contextValue = useMemo<WidgetDataContextValue>(
    () => ({
      getSourceData: (sourceId: DataSourceId) => {
        return sourceMap[sourceId] ?? EMPTY_RESULT;
      },
    }),
    [sourceMap],
  );

  return (
    <WidgetDataContext.Provider value={contextValue}>
      {children}
    </WidgetDataContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Consumer hook
// ---------------------------------------------------------------------------

/**
 * useWidgetData – used by widget components to access their data source.
 */
export function useWidgetData<T>(
  sourceId: DataSourceId,
  selector: (sourceData: unknown) => T,
  _sectionId?: string,
): { data: T | null; loading: boolean; error: string | null } {
  const ctx = useContext(WidgetDataContext);

  if (!ctx) {
    return { data: null, loading: false, error: 'No WidgetDataProvider found' };
  }

  const source = ctx.getSourceData(sourceId);

  return useMemo(
    () => ({
      data: source.data ? selector(source.data) : null,
      loading: source.loading,
      error: source.error,
    }),
    [source.data, source.loading, source.error, selector],
  );
}
