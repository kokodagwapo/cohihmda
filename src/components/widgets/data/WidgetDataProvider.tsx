/**
 * WidgetDataProvider – React context that provides data to canvas widgets.
 *
 * Reads per-section filter state (including PeriodSelection) from
 * widgetSectionStore so that DatePeriodPicker changes drive data hooks.
 *
 * Each data source hook is called once with the filters from its
 * corresponding section (or defaults if no section is registered).
 */

import React, { createContext, useContext, useMemo } from 'react';
import { useTenantStore } from '@/stores/tenantStore';
import { useChannelStore } from '@/stores/channelStore';
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
import type { DataSourceId } from '../registry/types';

/** Build dimension filter array from section dynamicFilters (for APIs that accept them). */
function toDimensionFilters(filters: SectionFilters | null): Array<{ column: string; value: string }> | undefined {
  const list = filters?.dynamicFilters?.filter((df) => df.value && df.value !== 'all').map((df) => ({ column: df.column, value: df.value }));
  return list && list.length > 0 ? list : undefined;
}

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
// Preset → Hook-param mapping helpers
// ---------------------------------------------------------------------------

/** Map PeriodPreset to Operations Scorecard DateRangeType ('3-months'|'6-months'|'12-months') */
function mapToOpsDateRange(filters: SectionFilters): '3-months' | '6-months' | '12-months' {
  const preset = filters.periodSelection?.preset;
  if (preset === 'rolling-6') return '6-months';
  if (preset === 'rolling-12') return '12-months';
  return '3-months'; // default
}

/** Map PeriodPreset to Sales Trends DateRangeOption ('3-months'|'6-months') */
function mapToSalesTrendsDateRange(filters: SectionFilters): '3-months' | '6-months' {
  const preset = filters.periodSelection?.preset;
  if (preset === 'rolling-6') return '6-months';
  return '3-months'; // default
}

/** Map PeriodPreset to TopTiering TimeFilterType */
type TimeFilterType = 'last-year' | 'last-quarter' | 'last-month' | 'ytd' | 'qtd' | 'mtd' | 'trailing-12' | 'custom';
function mapToTopTieringTimeFilter(filters: SectionFilters): {
  timeFilter: TimeFilterType;
  customDateRange?: { start: string; end: string };
} {
  const ps = filters.periodSelection;
  if (!ps) return { timeFilter: 'last-year' };

  if (ps.type === 'custom') {
    return { timeFilter: 'custom', customDateRange: ps.dateRange };
  }

  // Direct preset mapping – these presets match the hook's TimeFilterType exactly
  const directMap: Record<string, TimeFilterType> = {
    'mtd': 'mtd',
    'qtd': 'qtd',
    'ytd': 'ytd',
    'last-month': 'last-month',
    'last-quarter': 'last-quarter',
    'last-year': 'last-year',
    'trailing-12': 'trailing-12',
  };
  const preset = ps.preset;
  if (preset && directMap[preset]) {
    return { timeFilter: directMap[preset] };
  }

  // For rolling presets that don't map, fall back to custom with the computed range
  if (ps.dateRange) {
    return { timeFilter: 'custom', customDateRange: ps.dateRange };
  }

  return { timeFilter: 'last-year' };
}

/** Map PeriodPreset to LeaderboardTimeframe */
type LeaderboardTimeframe = 'wtd' | 'mtd' | 'qtd' | 'lm' | 'lq' | 'ly' | 'custom';
function mapToLeaderboardTimeframe(filters: SectionFilters): {
  timeframe: LeaderboardTimeframe;
  startDate?: string;
  endDate?: string;
} {
  const ps = filters.periodSelection;
  if (!ps) return { timeframe: 'mtd' };

  if (ps.type === 'custom') {
    return { timeframe: 'custom', startDate: ps.dateRange.start, endDate: ps.dateRange.end };
  }

  const presetMap: Record<string, LeaderboardTimeframe> = {
    'mtd': 'mtd',
    'qtd': 'qtd',
    'last-month': 'lm',
    'last-quarter': 'lq',
    'last-year': 'ly',
  };
  const preset = ps.preset;
  if (preset && presetMap[preset]) {
    return { timeframe: presetMap[preset] };
  }

  // For presets like 'ytd' or rolling that don't map directly, use custom with computed range
  if (ps.dateRange) {
    return { timeframe: 'custom', startDate: ps.dateRange.start, endDate: ps.dateRange.end };
  }

  return { timeframe: 'mtd' };
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const WidgetDataContext = createContext<WidgetDataContextValue | null>(null);

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

  // ---- Hook calls with dynamic filter values ----

  const companyScorecard = useCompanyScorecardData({
    year: csFilters.year,
    branch: csFilters.branch,
    loanOfficer: csFilters.loanOfficer,
    application: csFilters.application,
    channel: selectedChannel,
    dateField: csFilters.dateField,
    dateRange: csFilters.periodSelection?.dateRange ?? csFilters.dateRange,
    tenantId: selectedTenantId,
  });

  const creditRisk = useCreditRiskData({
    applicationType: crFilters.applicationType as any,
    channel: selectedChannel,
    year: crFilters.year,
    dateRange: crFilters.periodSelection?.dateRange ?? crFilters.dateRange,
    tenantId: selectedTenantId,
  });

  const ssDateRange = ssFilters.periodSelection?.dateRange ?? ssFilters.dateRange;

  const salesScorecard = useSalesScorecardData(
    ssFilters.actorType,
    ssDateRange,
    selectedTenantId,
    selectedChannel,
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
    selectedTenantId,
    selectedChannel,
    osCustomDR,
  );

  // Operations Trends: actor type from filters, fixed 13-month window
  const operationsTrends = useOperationsScorecardTrendsData(
    otFilters.actorType === 'branch' ? 'underwriter' : 'underwriter',
    'vs-target',
    selectedTenantId,
    selectedChannel,
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
    selectedTenantId,
    stCustomDR,
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
    selectedTenantId,
    { channelGroup: selectedChannel },
  );

  // Top Tiering: map preset → TimeFilterType + optional customDateRange
  const ttcMapping = useMemo(() => mapToTopTieringTimeFilter(ttcFilters), [ttcFilters]);
  const topTieringComparison = useTopTieringComparisonData(
    ttcFilters.actorType === 'branch' ? 'branch' : 'loan-officer',
    ttcMapping.timeFilter,
    selectedTenantId,
    selectedChannel,
    ttcMapping.customDateRange,
  );

  // Leaderboard: map preset → LeaderboardTimeframe
  const lbMapping = useMemo(() => mapToLeaderboardTimeframe(lbFilters), [lbFilters]);
  const { leaderboardData, loading: leaderboardLoading } = useLeaderboardData(
    lbMapping.timeframe,
    selectedTenantId,
    {
      channelGroup: selectedChannel,
      ...(lbMapping.startDate ? { startDate: lbMapping.startDate, endDate: lbMapping.endDate } : {}),
    },
  );

  // Loan detail: only apply date filter when user has explicitly selected a period (preset/year/custom).
  // When periodSelection is missing, show all loans so the table isn't empty by default.
  // Include dynamic filters (loan purpose, channel, etc.) so ADD FILTER DIMENSION filters are applied.
  const loanDetailFilters = useMemo(
    () =>
      ldFilters
        ? {
            dateField: ldFilters.dateField,
            dateRange:
              ldFilters.sectionType === 'loan-detail'
                ? (ldFilters.periodSelection?.dateRange ?? undefined)
                : (ldFilters.periodSelection?.dateRange ?? ldFilters.dateRange),
            branch: ldFilters.branch,
            loanOfficer: ldFilters.loanOfficer,
            dimensionFilters: toDimensionFilters(ldFilters),
          }
        : undefined,
    [ldFilters],
  );
  const loanDetail = useLoanDetailData(selectedTenantId, loanDetailFilters ?? undefined);

  // High Performers: left and right period with shared date type
  const hpDateType = (hpFilters?.highPerformersDateType ?? 'funding_date') as HighPerformersDateType;
  const hpLeftPeriod = (hpFilters?.highPerformersLeftPeriod ?? 'mtd') as HighPerformersTimePeriod;
  const hpRightPeriod = (hpFilters?.highPerformersRightPeriod ?? 'ytd') as HighPerformersTimePeriod;
  const { data: hpLeftData, loading: hpLeftLoading, error: hpLeftError } = useHighPerformersData(
    hpDateType,
    hpLeftPeriod,
    { channelGroup: selectedChannel, tenantId: selectedTenantId },
  );
  const { data: hpRightData, loading: hpRightLoading, error: hpRightError } = useHighPerformersData(
    hpDateType,
    hpRightPeriod,
    { channelGroup: selectedChannel, tenantId: selectedTenantId },
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
    selectedTenantId,
    channelGroup: selectedChannel,
    selectedActor: (actorsFilters?.actorsSelectedActor ?? null) as { type: ActorDimension; name: string } | null,
    selectedStatus: actorsFilters?.actorsSelectedStatus ?? null,
    tableDimensions: actorsTableDims,
  });

  // Pricing Dashboard: build filters from section and fetch all 4 tables + KPIs
  const pricingFilters = useMemo((): PricingFilters => ({
    channel: selectedChannel ?? undefined,
    entityType: (pdFilters?.pricingEntityType ?? 'branch') as PricingFilters['entityType'],
    entityValue: pdFilters?.pricingEntityValue ?? '',
    actorType: (pdFilters?.pricingActorType ?? 'loan_officer') as PricingFilters['actorType'],
    actorValue: pdFilters?.pricingActorValue ?? '',
    dateRange: (pdFilters?.pricingDateRange ?? 'mtd') as PricingFilters['dateRange'],
    loanFunding: (pdFilters?.pricingLoanFunding ?? 'funded') as PricingFilters['loanFunding'],
    loanStatus: (pdFilters?.pricingLoanStatus ?? 'active') as PricingFilters['loanStatus'],
    lockStatus: (pdFilters?.pricingLockStatus ?? 'total') as PricingFilters['lockStatus'],
  }), [selectedChannel, pdFilters?.pricingEntityType, pdFilters?.pricingEntityValue, pdFilters?.pricingActorType, pdFilters?.pricingActorValue, pdFilters?.pricingDateRange, pdFilters?.pricingLoanFunding, pdFilters?.pricingLoanStatus, pdFilters?.pricingLockStatus]);
  const pricingDashboard = usePricingDashboardWorkbenchData(pricingFilters, {
    tenantId: selectedTenantId,
    selectedChannel,
  });

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
      data: topTieringComparison.data,
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
    'aletheia-insights': {
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
      data: pricingDashboard,
      loading: pricingDashboard.loading,
      error: pricingDashboard.error,
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
    leaderboardData, leaderboardLoading,
    loanDetail.data, loanDetail.loading, loanDetail.error,
    highPerformersData, highPerformersLoading, highPerformersError,
    actorsData, actorsLoading, actorsError,
    pricingDashboard,
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
