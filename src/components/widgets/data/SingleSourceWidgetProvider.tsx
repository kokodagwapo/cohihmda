/**
 * Fetches data for exactly one registry `DataSourceId` for Research Lab embeds,
 * without mounting the full WidgetDataProvider hook matrix.
 */

import React, { useMemo } from "react";
import { useTenantStore } from "@/stores/tenantStore";
import { useChannelStore } from "@/stores/channelStore";
import { useAuth } from "@/contexts/AuthContext";
import type { SectionFilters } from "@/stores/widgetSectionStore";
import type { DataSourceId } from "@/components/widgets/registry/types";
import { buildResearchEmbedSectionFilters } from "@/lib/researchEmbedSectionFilters";
import type { PeriodPreset } from "@/components/ui/DatePeriodPicker";
import {
  WidgetDataContext,
  type SourceResult,
} from "@/components/widgets/data/WidgetDataProvider";
import { useCompanyScorecardData } from "@/hooks/useCompanyScorecardData";
import { useCreditRiskData } from "@/hooks/useCreditRiskData";
import { useSalesScorecardData } from "@/hooks/useSalesScorecardData";
import { useOperationsScorecardData } from "@/hooks/useOperationsScorecardData";
import { useOperationsScorecardTrendsData } from "@/hooks/useOperationsScorecardTrendsData";
import { useSalesTrendsData } from "@/hooks/useSalesTrendsData";
import { useFunnelData } from "@/hooks/useFunnelData";
import { useTopTieringComparisonData } from "@/hooks/useTopTieringComparisonData";
import { useLeaderboardData } from "@/hooks/useLeaderboardData";
import { useLoanDetailData } from "@/hooks/useLoanDetailData";
import {
  useHighPerformersData,
  type HighPerformersDateType,
  type HighPerformersTimePeriod,
} from "@/hooks/useHighPerformersData";
import { useActorsData } from "@/hooks/useActorsData";
import type { ActorDimension } from "@/hooks/useActorsData";
import { usePricingDashboardWorkbenchData } from "@/hooks/usePricingDashboardData";
import type { PricingDashboardFilters as PricingFilters } from "@/hooks/usePricingDashboardData";
import {
  usePipelineAnalysisData,
  usePipelineAnalysisRange,
  usePipelineAnalysisConfig,
} from "@/hooks/usePipelineAnalysisData";
import { useLoanComplexityData } from "@/hooks/useLoanComplexityData";
import type { LoanComplexityGroupBy } from "@/hooks/useLoanComplexityData";
import { useLoanComplexityPivot } from "@/hooks/useLoanComplexityPivot";
import { useLoanComplexityGroupLoans } from "@/hooks/useLoanComplexityGroupLoans";
import { useLoanComplexityStatusOptions } from "@/hooks/useLoanComplexityStatusOptions";
import { useEstimatedClosingsRiskData } from "@/hooks/useEstimatedClosingsRiskData";
import { buildPricingReportColumns, buildPricingDetailColumns } from "@/lib/pricingDashboardColumns";
import {
  mapToLeaderboardTimeframe,
  mapToOpsDateRange,
  mapToSalesTrendsDateRange,
  mapToTopTieringTimeFilter,
} from "@/components/widgets/data/periodAdapters";

const EMPTY_RESULT: SourceResult = { data: null, loading: false, error: null };

function toDimensionFilters(
  filters: SectionFilters | null,
  exclude?: string[],
): Array<{ column: string; value: string }> | undefined {
  const ex = exclude ? new Set(exclude) : undefined;
  const list = filters?.dynamicFilters
    ?.filter((df) => df.value && df.value !== "all" && (!ex || !ex.has(df.column)))
    .map((df) => ({ column: df.column, value: df.value }));
  return list && list.length > 0 ? list : undefined;
}

const NATIVE_BRANCH_LO = ["branch", "loan_officer"];

export interface SingleSourceWidgetProviderProps {
  dataSourceId: DataSourceId;
  period?: PeriodPreset;
  branch?: string;
  loanOfficer?: string;
  children: React.ReactNode;
}

export function SingleSourceWidgetProvider({
  dataSourceId,
  period,
  branch,
  loanOfficer,
  children,
}: SingleSourceWidgetProviderProps) {
  const filters = useMemo(
    () => buildResearchEmbedSectionFilters(dataSourceId, { period, branch, loanOfficer }),
    [dataSourceId, period, branch, loanOfficer],
  );

  switch (dataSourceId) {
    case "company-scorecard":
      return <ProviderCompanyScorecard filters={filters}>{children}</ProviderCompanyScorecard>;
    case "credit-risk":
      return <ProviderCreditRisk filters={filters}>{children}</ProviderCreditRisk>;
    case "sales-scorecard":
      return <ProviderSalesScorecard filters={filters}>{children}</ProviderSalesScorecard>;
    case "operations-scorecard":
      return <ProviderOperationsScorecard filters={filters}>{children}</ProviderOperationsScorecard>;
    case "operations-trends":
      return <ProviderOperationsTrends filters={filters}>{children}</ProviderOperationsTrends>;
    case "sales-trends":
      return <ProviderSalesTrends filters={filters}>{children}</ProviderSalesTrends>;
    case "funnel":
      return <ProviderFunnel filters={filters}>{children}</ProviderFunnel>;
    case "top-tiering-comparison":
      return <ProviderTopTiering filters={filters}>{children}</ProviderTopTiering>;
    case "dashboard-metrics":
      return <ProviderLeaderboard filters={filters}>{children}</ProviderLeaderboard>;
    case "loan-detail":
      return <ProviderLoanDetail filters={filters}>{children}</ProviderLoanDetail>;
    case "high-performers":
      return <ProviderHighPerformers filters={filters}>{children}</ProviderHighPerformers>;
    case "actors":
      return <ProviderActors filters={filters}>{children}</ProviderActors>;
    case "pricing-dashboard":
      return <ProviderPricing filters={filters}>{children}</ProviderPricing>;
    case "pipeline-analysis":
      return <ProviderPipeline filters={filters}>{children}</ProviderPipeline>;
    case "loan-complexity":
      return <ProviderLoanComplexity filters={filters}>{children}</ProviderLoanComplexity>;
    case "estimated-closings-risk":
      return <ProviderEstimatedClosings filters={filters}>{children}</ProviderEstimatedClosings>;
    default:
      return (
        <WidgetDataContext.Provider
          value={{
            getSourceData: () => EMPTY_RESULT,
          }}
        >
          {children}
        </WidgetDataContext.Provider>
      );
  }
}

function useTenantChannel() {
  const { selectedTenantId } = useTenantStore();
  const { user } = useAuth();
  const { selectedChannel } = useChannelStore();
  const effectiveTenantId = selectedTenantId || user?.tenant_id || null;
  return { effectiveTenantId, selectedChannel };
}

function ProviderShell({
  sourceMap,
  children,
}: {
  sourceMap: Record<string, SourceResult>;
  children: React.ReactNode;
}) {
  const value = useMemo(
    () => ({
      getSourceData: (id: DataSourceId) => sourceMap[id] ?? EMPTY_RESULT,
    }),
    [sourceMap],
  );
  return <WidgetDataContext.Provider value={value}>{children}</WidgetDataContext.Provider>;
}

function ProviderCompanyScorecard({ filters, children }: { filters: SectionFilters; children: React.ReactNode }) {
  const { effectiveTenantId, selectedChannel } = useTenantChannel();
  const fromDynamic = (col: string) => filters.dynamicFilters?.find((df) => df.column === col)?.value;
  const csEffectiveBranch =
    fromDynamic("branch") && fromDynamic("branch") !== "all" ? fromDynamic("branch")! : (filters.branch ?? "all");
  const csEffectiveLoanOfficer =
    fromDynamic("loan_officer") && fromDynamic("loan_officer") !== "all"
      ? fromDynamic("loan_officer")!
      : (filters.loanOfficer ?? "all");
  const csDimensionFilters = useMemo(() => toDimensionFilters(filters, NATIVE_BRANCH_LO), [filters.dynamicFilters]);
  const companyScorecard = useCompanyScorecardData({
    year: filters.year,
    branch: csEffectiveBranch,
    loanOfficer: csEffectiveLoanOfficer,
    application: filters.application,
    channel: selectedChannel,
    dateField: filters.dateField,
    dateRange: filters.periodSelection?.dateRange ?? filters.dateRange,
    tenantId: effectiveTenantId,
    dimensionFilters: csDimensionFilters,
  });
  const sourceMap = useMemo(
    () => ({
      "company-scorecard": {
        data: companyScorecard.data,
        loading: companyScorecard.loading,
        error: companyScorecard.error,
      },
    }),
    [companyScorecard.data, companyScorecard.loading, companyScorecard.error],
  );
  return (
    <ProviderShell sourceMap={sourceMap}>
      {children}
    </ProviderShell>
  );
}

function ProviderCreditRisk({ filters, children }: { filters: SectionFilters; children: React.ReactNode }) {
  const { effectiveTenantId, selectedChannel } = useTenantChannel();
  const crDimensionFilters = useMemo(() => toDimensionFilters(filters), [filters.dynamicFilters]);
  const creditRisk = useCreditRiskData({
    applicationType: filters.applicationType as "Applications Taken",
    channel: selectedChannel,
    year: filters.year,
    dateRange: filters.periodSelection?.dateRange ?? filters.dateRange,
    tenantId: effectiveTenantId,
    dimensionFilters: crDimensionFilters,
  });
  const sourceMap = useMemo(
    () => ({
      "credit-risk": {
        data: creditRisk.data,
        loading: creditRisk.loading,
        error: creditRisk.error,
      },
    }),
    [creditRisk.data, creditRisk.loading, creditRisk.error],
  );
  return (
    <ProviderShell sourceMap={sourceMap}>
      {children}
    </ProviderShell>
  );
}

function ProviderSalesScorecard({ filters, children }: { filters: SectionFilters; children: React.ReactNode }) {
  const { effectiveTenantId, selectedChannel } = useTenantChannel();
  const ssDimensionFilters = useMemo(() => toDimensionFilters(filters), [filters.dynamicFilters]);
  const ssDateRange = filters.periodSelection?.dateRange ?? filters.dateRange;
  const salesScorecard = useSalesScorecardData(
    filters.actorType,
    ssDateRange,
    effectiveTenantId,
    selectedChannel,
    ssDimensionFilters,
  );
  const sourceMap = useMemo(
    () => ({
      "sales-scorecard": {
        data: salesScorecard.data,
        loading: salesScorecard.loading,
        error: salesScorecard.error,
      },
    }),
    [salesScorecard.data, salesScorecard.loading, salesScorecard.error],
  );
  return (
    <ProviderShell sourceMap={sourceMap}>
      {children}
    </ProviderShell>
  );
}

function ProviderOperationsScorecard({ filters, children }: { filters: SectionFilters; children: React.ReactNode }) {
  const { effectiveTenantId, selectedChannel } = useTenantChannel();
  const osDimensionFilters = useMemo(() => toDimensionFilters(filters), [filters.dynamicFilters]);
  const osDR = useMemo(() => mapToOpsDateRange(filters), [filters]);
  const osCustomDR = useMemo(() => {
    const ps = filters.periodSelection;
    if (ps?.type === "custom" && ps.dateRange) {
      return { start: ps.dateRange.start, end: ps.dateRange.end };
    }
    return undefined;
  }, [filters.periodSelection]);
  const operationsScorecard = useOperationsScorecardData(
    "underwriter",
    osDR,
    effectiveTenantId,
    selectedChannel,
    osCustomDR,
    osDimensionFilters,
  );
  const sourceMap = useMemo(
    () => ({
      "operations-scorecard": {
        data: operationsScorecard.data,
        loading: operationsScorecard.loading,
        error: operationsScorecard.error,
      },
    }),
    [operationsScorecard.data, operationsScorecard.loading, operationsScorecard.error],
  );
  return (
    <ProviderShell sourceMap={sourceMap}>
      {children}
    </ProviderShell>
  );
}

function ProviderOperationsTrends({ filters, children }: { filters: SectionFilters; children: React.ReactNode }) {
  const { effectiveTenantId, selectedChannel } = useTenantChannel();
  const otDimensionFilters = useMemo(() => toDimensionFilters(filters), [filters.dynamicFilters]);
  const operationsTrends = useOperationsScorecardTrendsData(
    filters.actorType === "branch" ? "underwriter" : "underwriter",
    "vs-target",
    effectiveTenantId,
    selectedChannel,
    13,
    otDimensionFilters,
  );
  const sourceMap = useMemo(
    () => ({
      "operations-trends": {
        data: operationsTrends.data,
        loading: operationsTrends.loading,
        error: operationsTrends.error,
      },
    }),
    [operationsTrends.data, operationsTrends.loading, operationsTrends.error],
  );
  return (
    <ProviderShell sourceMap={sourceMap}>
      {children}
    </ProviderShell>
  );
}

function ProviderSalesTrends({ filters, children }: { filters: SectionFilters; children: React.ReactNode }) {
  const { effectiveTenantId, selectedChannel } = useTenantChannel();
  const stDimensionFilters = useMemo(() => toDimensionFilters(filters), [filters.dynamicFilters]);
  const stDR = useMemo(() => mapToSalesTrendsDateRange(filters), [filters]);
  const stCustomDR = useMemo(() => {
    const ps = filters.periodSelection;
    if (ps?.type === "custom" && ps.dateRange) {
      return { start: ps.dateRange.start, end: ps.dateRange.end };
    }
    return undefined;
  }, [filters.periodSelection]);
  const salesTrends = useSalesTrendsData(
    stDR,
    selectedChannel ?? "Retail",
    effectiveTenantId,
    stCustomDR,
    stDimensionFilters,
  );
  const sourceMap = useMemo(
    () => ({
      "sales-trends": {
        data: salesTrends.data,
        loading: salesTrends.loading,
        error: salesTrends.error,
      },
    }),
    [salesTrends.data, salesTrends.loading, salesTrends.error],
  );
  return (
    <ProviderShell sourceMap={sourceMap}>
      {children}
    </ProviderShell>
  );
}

function ProviderFunnel({ filters, children }: { filters: SectionFilters; children: React.ReactNode }) {
  const { effectiveTenantId, selectedChannel } = useTenantChannel();
  const fnDimensionFilters = useMemo(() => toDimensionFilters(filters), [filters.dynamicFilters]);
  const currentYear = new Date().getFullYear();
  const funnelDateFilter = useMemo(() => {
    const ps = filters.periodSelection;
    if (ps?.type === "custom" || (ps?.type === "preset" && ps.dateRange)) {
      return { type: "custom" as const, startDate: ps.dateRange.start, endDate: ps.dateRange.end };
    }
    return { type: "year" as const, year: filters.year ?? currentYear };
  }, [filters, currentYear]);
  const { funnelData, loading: funnelLoading } = useFunnelData(
    funnelDateFilter,
    effectiveTenantId,
    { channelGroup: selectedChannel },
    fnDimensionFilters,
  );
  const sourceMap = useMemo(
    () => ({
      funnel: { data: funnelData, loading: funnelLoading, error: null },
    }),
    [funnelData, funnelLoading],
  );
  return (
    <ProviderShell sourceMap={sourceMap}>
      {children}
    </ProviderShell>
  );
}

function ProviderTopTiering({ filters, children }: { filters: SectionFilters; children: React.ReactNode }) {
  const { effectiveTenantId, selectedChannel } = useTenantChannel();
  const ttcDimensionFilters = useMemo(() => toDimensionFilters(filters), [filters.dynamicFilters]);
  const ttcMapping = useMemo(() => mapToTopTieringTimeFilter(filters), [filters]);
  const topTieringComparison = useTopTieringComparisonData(
    filters.actorType === "branch" ? "branch" : "loan-officer",
    ttcMapping.timeFilter,
    effectiveTenantId,
    selectedChannel,
    ttcMapping.customDateRange,
    ttcDimensionFilters,
  );
  const sourceMap = useMemo(
    () => ({
      "top-tiering-comparison": {
        data: topTieringComparison.data
          ? { ...topTieringComparison.data, _actorType: filters?.actorType ?? "loan_officer" }
          : null,
        loading: topTieringComparison.loading,
        error: topTieringComparison.error,
      },
    }),
    [topTieringComparison.data, topTieringComparison.loading, topTieringComparison.error, filters?.actorType],
  );
  return (
    <ProviderShell sourceMap={sourceMap}>
      {children}
    </ProviderShell>
  );
}

function ProviderLeaderboard({ filters, children }: { filters: SectionFilters; children: React.ReactNode }) {
  const { effectiveTenantId, selectedChannel } = useTenantChannel();
  const lbDimensionFilters = useMemo(() => toDimensionFilters(filters), [filters.dynamicFilters]);
  const lbMapping = useMemo(() => mapToLeaderboardTimeframe(filters), [filters]);
  const { leaderboardData, loading: leaderboardLoading } = useLeaderboardData(
    lbMapping.timeframe,
    effectiveTenantId,
    {
      channelGroup: selectedChannel,
      ...(lbMapping.startDate ? { startDate: lbMapping.startDate, endDate: lbMapping.endDate } : {}),
    },
    lbDimensionFilters,
  );
  const sourceMap = useMemo(
    () => ({
      "dashboard-metrics": {
        data: leaderboardData,
        loading: leaderboardLoading,
        error: null,
      },
    }),
    [leaderboardData, leaderboardLoading],
  );
  return (
    <ProviderShell sourceMap={sourceMap}>
      {children}
    </ProviderShell>
  );
}

function ProviderLoanDetail({ filters, children }: { filters: SectionFilters; children: React.ReactNode }) {
  const { effectiveTenantId } = useTenantChannel();
  const fromDynamic = (col: string) => filters.dynamicFilters?.find((df) => df.column === col)?.value;
  const ldEffectiveBranch =
    fromDynamic("branch") && fromDynamic("branch") !== "all" ? fromDynamic("branch")! : (filters.branch ?? "all");
  const ldEffectiveLoanOfficer =
    fromDynamic("loan_officer") && fromDynamic("loan_officer") !== "all"
      ? fromDynamic("loan_officer")!
      : (filters.loanOfficer ?? "all");
  const ldDimensionFilters = useMemo(() => toDimensionFilters(filters, NATIVE_BRANCH_LO), [filters.dynamicFilters]);
  const ldDateRange = useMemo(
    () =>
      filters.sectionType === "loan-detail"
        ? (filters.periodSelection?.dateRange ?? undefined)
        : (filters.periodSelection?.dateRange ?? filters.dateRange),
    [filters.sectionType, filters.periodSelection?.dateRange, filters.dateRange],
  );
  const loanDetailFilters = useMemo(
    () => ({
      dateField: filters.dateField,
      dateRange: ldDateRange,
      branch: ldEffectiveBranch,
      loanOfficer: ldEffectiveLoanOfficer,
      dimensionFilters: ldDimensionFilters,
    }),
    [filters.dateField, ldDateRange, ldEffectiveBranch, ldEffectiveLoanOfficer, ldDimensionFilters],
  );
  const loanDetail = useLoanDetailData(effectiveTenantId, loanDetailFilters, { enabled: true });
  const sourceMap = useMemo(
    () => ({
      "loan-detail": {
        data: loanDetail.data,
        loading: loanDetail.loading,
        error: loanDetail.error,
      },
    }),
    [loanDetail.data, loanDetail.loading, loanDetail.error],
  );
  return (
    <ProviderShell sourceMap={sourceMap}>
      {children}
    </ProviderShell>
  );
}

function ProviderHighPerformers({ filters, children }: { filters: SectionFilters; children: React.ReactNode }) {
  const { effectiveTenantId, selectedChannel } = useTenantChannel();
  const hpDimensionFilters = useMemo(() => toDimensionFilters(filters), [filters.dynamicFilters]);
  const hpDateType = (filters?.highPerformersDateType ?? "funding_date") as HighPerformersDateType;
  const hpLeftPeriod = (filters?.highPerformersLeftPeriod ?? "mtd") as HighPerformersTimePeriod;
  const hpRightPeriod = (filters?.highPerformersRightPeriod ?? "ytd") as HighPerformersTimePeriod;
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
  const highPerformersData = useMemo(() => ({ left: hpLeftData, right: hpRightData }), [hpLeftData, hpRightData]);
  const highPerformersLoading = hpLeftLoading || hpRightLoading;
  const highPerformersError = hpLeftError || hpRightError;
  const sourceMap = useMemo(
    () => ({
      "high-performers": {
        data: highPerformersData,
        loading: highPerformersLoading,
        error: highPerformersError,
      },
    }),
    [highPerformersData, highPerformersLoading, highPerformersError],
  );
  return (
    <ProviderShell sourceMap={sourceMap}>
      {children}
    </ProviderShell>
  );
}

function ProviderActors({ filters, children }: { filters: SectionFilters; children: React.ReactNode }) {
  const { effectiveTenantId, selectedChannel } = useTenantChannel();
  const actorsDimensionFilters = useMemo(() => toDimensionFilters(filters), [filters.dynamicFilters]);
  const actorsDateRange = useMemo(() => {
    const range = filters?.periodSelection?.dateRange ?? filters?.dateRange;
    if (range?.start && range?.end) return { start: range.start, end: range.end };
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    return { start: start.toISOString().slice(0, 10), end: now.toISOString().slice(0, 10) };
  }, [filters?.periodSelection?.dateRange, filters?.dateRange]);
  const actorsTableDims = useMemo((): [ActorDimension, ActorDimension, ActorDimension, ActorDimension] => {
    const d = filters?.actorsTableDimensions;
    if (Array.isArray(d) && d.length === 4) return d as [ActorDimension, ActorDimension, ActorDimension, ActorDimension];
    return ["loan_officer", "processor", "underwriter", "closer"];
  }, [filters?.actorsTableDimensions]);
  const { data: actorsData, loading: actorsLoading, error: actorsError } = useActorsData({
    startDate: actorsDateRange.start,
    endDate: actorsDateRange.end,
    calculation: (filters?.actorsCalculation as "average" | "median") ?? "average",
    turnTimeType: (filters?.actorsTurnTimeType as "app_to_fund_days" | "app_to_closing_days") ?? "app_to_fund_days",
    dateRangeType: (filters?.actorsDateRangeType as "calendar_days" | "business_days") ?? "calendar_days",
    measure: (filters?.actorsMeasure as "units" | "volume") ?? "units",
    selectedTenantId: effectiveTenantId,
    channelGroup: selectedChannel,
    selectedActor: (filters?.actorsSelectedActor ?? null) as { type: ActorDimension; name: string } | null,
    selectedStatus: filters?.actorsSelectedStatus ?? null,
    tableDimensions: actorsTableDims,
    dimensionFilters: actorsDimensionFilters,
  });
  const sourceMap = useMemo(
    () => ({
      actors: { data: actorsData, loading: actorsLoading, error: actorsError },
    }),
    [actorsData, actorsLoading, actorsError],
  );
  return (
    <ProviderShell sourceMap={sourceMap}>
      {children}
    </ProviderShell>
  );
}

function ProviderPricing({ filters, children }: { filters: SectionFilters; children: React.ReactNode }) {
  const { effectiveTenantId, selectedChannel } = useTenantChannel();
  const pdDimensionFilters = useMemo(() => toDimensionFilters(filters), [filters.dynamicFilters]);
  const pricingFilters = useMemo((): PricingFilters => ({
    channel: selectedChannel ?? undefined,
    entityType: (filters?.pricingEntityType ?? "branch") as PricingFilters["entityType"],
    entityFilterType: filters?.pricingEntityFilterType as PricingFilters["entityFilterType"] | undefined,
    entityValue: filters?.pricingEntityValue ?? "",
    actorType: (filters?.pricingActorType ?? "loan_officer") as PricingFilters["actorType"],
    actorFilterType: filters?.pricingActorFilterType as PricingFilters["actorFilterType"] | undefined,
    actorValue: filters?.pricingActorValue ?? "",
    dateRange: (filters?.pricingDateRange ?? "mtd") as PricingFilters["dateRange"],
    loanFunding: (filters?.pricingLoanFunding ?? "funded") as PricingFilters["loanFunding"],
    loanStatus: (filters?.pricingLoanStatus ?? "active") as PricingFilters["loanStatus"],
    lockStatus: (filters?.pricingLockStatus ?? "total") as PricingFilters["lockStatus"],
  }), [selectedChannel, filters]);
  const pricingDashboard = usePricingDashboardWorkbenchData(pricingFilters, {
    tenantId: effectiveTenantId,
    selectedChannel,
    dimensionFilters: pdDimensionFilters,
    metricColumns: filters?.pricingDashboardColumns?.map((c) => c.key),
  });
  const sourceMap = useMemo(
    () => ({
      "pricing-dashboard": {
        data: {
          ...pricingDashboard,
          reportColumns: buildPricingReportColumns(filters?.pricingDashboardColumns),
          detailColumns: buildPricingDetailColumns(filters?.pricingDashboardColumns),
        },
        loading: pricingDashboard.loading,
        error: pricingDashboard.error,
      },
    }),
    [pricingDashboard, filters?.pricingDashboardColumns],
  );
  return (
    <ProviderShell sourceMap={sourceMap}>
      {children}
    </ProviderShell>
  );
}

function ProviderPipeline({ filters, children }: { filters: SectionFilters; children: React.ReactNode }) {
  const { effectiveTenantId, selectedChannel } = useTenantChannel();
  const paDimensionFilters = useMemo(() => toDimensionFilters(filters), [filters.dynamicFilters]);
  const pipelineRange = usePipelineAnalysisRange(effectiveTenantId ?? null);
  const pipelineConfig = usePipelineAnalysisConfig(effectiveTenantId ?? null);
  const pipelineFromTo = useMemo(() => {
    if (filters?.pipelineAnalysisYearRange) {
      const [start, end] = filters.pipelineAnalysisYearRange.split("-").map(Number);
      if (!Number.isNaN(start) && !Number.isNaN(end))
        return { from: `${start}-01-01`, to: `${end}-12-31` };
    }
    const r = pipelineRange.range;
    const max = r?.maxYear ?? new Date().getFullYear();
    const startYear = Math.max(r?.minYear ?? max - 2, max - 1);
    const endYear = max;
    return { from: `${startYear}-01-01`, to: `${endYear}-12-31` };
  }, [filters?.pipelineAnalysisYearRange, pipelineRange.range]);
  const pipelineFiltersForApi = useMemo(() => {
    const types = filters?.pipelineAnalysisLoanTypes ?? [];
    const purposes = filters?.pipelineAnalysisLoanPurposes ?? [];
    const branches = filters?.pipelineAnalysisBranches ?? [];
    if (types.length > 0 || purposes.length > 0 || branches.length > 0)
      return {
        loanTypes: types.length ? types : undefined,
        loanPurposes: purposes.length ? purposes : undefined,
        branches: branches.length ? branches : undefined,
      };
    return undefined;
  }, [filters?.pipelineAnalysisLoanTypes, filters?.pipelineAnalysisLoanPurposes, filters?.pipelineAnalysisBranches]);
  const pipelineSnapshots = usePipelineAnalysisData({
    from: pipelineFromTo.from,
    to: pipelineFromTo.to,
    tenantId: effectiveTenantId ?? null,
    startDateField: (filters?.pipelineAnalysisStartDateField ?? "application_date") as
      | "application_date"
      | "lock_date"
      | "processing_date"
      | "credit_pull_date"
      | "submitted_to_underwriting_date",
    filters: pipelineFiltersForApi,
    dimensionFilters: paDimensionFilters,
  });
  const pipelineAnalysisSource = useMemo(
    () => ({
      snapshots: pipelineSnapshots.snapshots,
      range: pipelineRange.range,
      config: pipelineConfig.config,
      yearRange: filters?.pipelineAnalysisYearRange ?? null,
      viewMode: (filters?.pipelineAnalysisViewMode ?? "week") as "week" | "month",
      pctMetric: (filters?.pipelineAnalysisPctMetric ?? "volume") as "volume" | "units",
      loading: pipelineRange.loading || pipelineConfig.loading || pipelineSnapshots.loading,
      error: pipelineRange.error || pipelineConfig.error || pipelineSnapshots.error,
    }),
    [
      pipelineSnapshots.snapshots,
      pipelineRange.range,
      pipelineRange.loading,
      pipelineRange.error,
      pipelineConfig.config,
      pipelineConfig.loading,
      pipelineConfig.error,
      pipelineSnapshots.loading,
      pipelineSnapshots.error,
      filters?.pipelineAnalysisYearRange,
      filters?.pipelineAnalysisViewMode,
      filters?.pipelineAnalysisPctMetric,
    ],
  );

  const sourceMap = useMemo(
    () => ({
      "pipeline-analysis": {
        data: {
          snapshots: pipelineSnapshots.snapshots,
          range: pipelineRange.range,
          config: pipelineConfig.config,
          yearRange: filters?.pipelineAnalysisYearRange ?? null,
          viewMode: (filters?.pipelineAnalysisViewMode ?? "week") as "week" | "month",
          pctMetric: (filters?.pipelineAnalysisPctMetric ?? "volume") as "volume" | "units",
        },
        loading: pipelineAnalysisSource.loading,
        error: pipelineAnalysisSource.error,
      },
    }),
    [
      pipelineSnapshots.snapshots,
      pipelineRange.range,
      pipelineConfig.config,
      filters?.pipelineAnalysisYearRange,
      filters?.pipelineAnalysisViewMode,
      filters?.pipelineAnalysisPctMetric,
      pipelineAnalysisSource.loading,
      pipelineAnalysisSource.error,
    ],
  );
  return (
    <ProviderShell sourceMap={sourceMap}>
      {children}
    </ProviderShell>
  );
}

function ProviderLoanComplexity({ filters, children }: { filters: SectionFilters; children: React.ReactNode }) {
  const { effectiveTenantId, selectedChannel } = useTenantChannel();
  const lcDateRange = useMemo(() => {
    const range = filters?.periodSelection?.dateRange ?? filters?.dateRange;
    if (range?.start && range?.end) return { start: range.start, end: range.end };
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    return { start: start.toISOString().slice(0, 10), end: now.toISOString().slice(0, 10) };
  }, [filters?.periodSelection?.dateRange, filters?.dateRange]);
  const lcEffectiveGroupBy = useMemo((): LoanComplexityGroupBy => {
    const groupBy = filters?.loanComplexityGroupBy ?? "actors";
    const actorType = (filters?.loanComplexityActorType ?? "loan_officer") as LoanComplexityGroupBy;
    return groupBy === "actors" ? actorType : (groupBy as LoanComplexityGroupBy);
  }, [filters?.loanComplexityGroupBy, filters?.loanComplexityActorType]);
  const lcCurrentStatus = useMemo(() => {
    const s = filters?.loanComplexityCurrentStatus ?? "All";
    return s === "All" || !s?.trim() ? null : s.trim();
  }, [filters?.loanComplexityCurrentStatus]);
  const lcGroupFilters = useMemo((): { groupBy: LoanComplexityGroupBy; groupName: string }[] => {
    const groups = filters?.loanComplexitySelectedGroups;
    if (groups && groups.length > 0) {
      return groups.map((g) => ({ groupBy: g.dimension as LoanComplexityGroupBy, groupName: g.groupName }));
    }
    const names = filters?.loanComplexitySelectedGroupNames ?? [];
    if (names.length === 0) return [];
    const groupBy = lcEffectiveGroupBy;
    return names.map((groupName) => ({ groupBy, groupName }));
  }, [filters?.loanComplexitySelectedGroups, filters?.loanComplexitySelectedGroupNames, lcEffectiveGroupBy]);

  const lcBars = useLoanComplexityData({
    startDate: lcDateRange.start,
    endDate: lcDateRange.end,
    groupBy: lcEffectiveGroupBy,
    selectedTenantId: effectiveTenantId,
    channelGroup: selectedChannel,
    currentLoanStatus: lcCurrentStatus,
    enabled: true,
  });
  const lcPivot = useLoanComplexityPivot({
    startDate: lcDateRange.start,
    endDate: lcDateRange.end,
    selectedTenantId: effectiveTenantId,
    channelGroup: selectedChannel,
    currentLoanStatus: lcCurrentStatus,
    enabled: true,
  });
  const lcLoans = useLoanComplexityGroupLoans({
    startDate: lcDateRange.start,
    endDate: lcDateRange.end,
    groupFilters: lcGroupFilters,
    selectedTenantId: effectiveTenantId,
    channelGroup: selectedChannel,
    currentLoanStatus: lcCurrentStatus,
    enabled: true,
  });
  const lcStatusOptions = useLoanComplexityStatusOptions({
    startDate: lcDateRange.start,
    endDate: lcDateRange.end,
    selectedTenantId: effectiveTenantId,
    channelGroup: selectedChannel,
    enabled: true,
  });

  const loanComplexityInner = useMemo(
    () => ({
      pivot: lcPivot.data,
      bars: lcBars.data?.bars ?? [],
      loans: lcLoans.loans,
      statusOptions: lcStatusOptions.data,
    }),
    [lcPivot.data, lcBars.data?.bars, lcLoans.loans, lcStatusOptions.data],
  );

  const loading = lcBars.loading || lcPivot.loading || lcLoans.loading || lcStatusOptions.loading;
  const err = lcBars.error || lcPivot.error || lcLoans.error || lcStatusOptions.error;

  const sourceMap = useMemo(
    () => ({
      "loan-complexity": {
        data: loanComplexityInner,
        loading,
        error: err,
      },
    }),
    [loanComplexityInner, loading, err],
  );
  return (
    <ProviderShell sourceMap={sourceMap}>
      {children}
    </ProviderShell>
  );
}

function ProviderEstimatedClosings({ filters, children }: { filters: SectionFilters; children: React.ReactNode }) {
  const { effectiveTenantId, selectedChannel } = useTenantChannel();
  const ecrDimensionFilters = useMemo(() => toDimensionFilters(filters), [filters.dynamicFilters]);
  const estimatedClosingsRisk = useEstimatedClosingsRiskData({
    tenantId: effectiveTenantId,
    channelGroup: selectedChannel,
    dateRangeType: (filters.estimatedClosingsDateRangeType ?? "calendar_days") as
      | "calendar_days"
      | "business_days",
    fetchAllDetailRows: true,
    dimensionFilters: ecrDimensionFilters,
    pageSliceFilters: {
      ecdSlice: filters.estimatedClosingsEcdSlice ?? null,
      complexityBarBucket: filters.estimatedClosingsComplexityBucket ?? null,
      remainingComplexityGroup: filters.estimatedClosingsRemainingComplexityGroup ?? null,
      remainingProcessingStage: filters.estimatedClosingsRemainingProcessingStage ?? null,
    },
    detailColumnFilters: filters.estimatedClosingsDetailColumnFilters,
  });
  const sourceMap = useMemo(
    () => ({
      "estimated-closings-risk": {
        data: estimatedClosingsRisk.data,
        loading: estimatedClosingsRisk.loading,
        error: estimatedClosingsRisk.error,
      },
    }),
    [estimatedClosingsRisk.data, estimatedClosingsRisk.loading, estimatedClosingsRisk.error],
  );
  return (
    <ProviderShell sourceMap={sourceMap}>
      {children}
    </ProviderShell>
  );
}
