import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { normalizeFilterState, type ColumnFilterState } from "@/utils/loanDetailFilters";

export type EstimatedClosingsDateRangeType = "calendar_days" | "business_days";

export type EstimatedClosingsEcdSliceKey =
  | "empty_ecd"
  | "past_ecd"
  | "remaining_to_fund"
  | "after_this_month";

export type EstimatedClosingsComplexityBucketKey = "gte_130" | "gte_120" | "gte_110" | "all_rest";

export interface EstimatedClosingsPageSliceFilters {
  ecdSlice?: EstimatedClosingsEcdSliceKey | null;
  complexityBarBucket?: EstimatedClosingsComplexityBucketKey | null;
  remainingComplexityGroup?: string | null;
  remainingProcessingStage?: string | null;
}

export interface EstimatedClosingsRiskResponse {
  kpis: {
    totalActivePipeline: number;
    ecdEmptyOrAfterThisMonth: number;
    remainingToFund: number;
    fundedThisMonth: number;
    maxPossibleFunding: number;
    fundingYtdUnits: number;
    prevMonthActualUnits: number;
    prevMonthActualVolume: number;
    unitsLastMonthVsPriorPct: number | null;
    volumeLastMonthVsPriorPct: number | null;
  };
  activePipelineEcdSlices: Array<{
    key: EstimatedClosingsEcdSliceKey;
    label: string;
    count: number;
  }>;
  maxPossibleFundingByComplexity: Array<{
    bucketKey: EstimatedClosingsComplexityBucketKey;
    bucketLabel: string;
    funded: number;
    notFunded: number;
    total: number;
  }>;
  remainingToFundByComplexity: Array<{
    complexityGroup: string;
    sortOrder: number;
    unitsRemainingToFund: number;
    historicalFalloutLast13Months: number | null;
  }>;
  historicalFalloutPooled13Months: number | null;
  remainingToFundByProcessingStage: Array<{
    processingStage: string;
    sortOrder: number;
    unitsRemainingToFund: number;
    historicalFallout: number | null;
    historicalStatusToFundDays: number | null;
  }>;
  detail: {
    total: number;
    limit: number;
    offset: number;
    rows: Array<Record<string, unknown>>;
  };
}

export function useEstimatedClosingsRiskData(params: {
  tenantId?: string | null;
  channelGroup?: string | null;
  dateRangeType: EstimatedClosingsDateRangeType;
  limit?: number;
  offset?: number;
  pageSliceFilters?: EstimatedClosingsPageSliceFilters;
  detailColumnFilters?: ColumnFilterState;
}) {
  const { tenantId, channelGroup, dateRangeType, limit, offset, pageSliceFilters, detailColumnFilters } = params;
  const [data, setData] = useState<EstimatedClosingsRiskResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const normalizedDetailFilters = useMemo(
    () => (detailColumnFilters ? normalizeFilterState(detailColumnFilters) : {}),
    [detailColumnFilters],
  );
  const detailFiltersJson =
    Object.keys(normalizedDetailFilters).length > 0 ? JSON.stringify(normalizedDetailFilters) : null;

  const query = useMemo(() => {
    const sp = new URLSearchParams();
    sp.set("dateRangeType", dateRangeType);
    if (limit != null) sp.set("limit", String(limit));
    if (offset != null) sp.set("offset", String(offset));
    if (tenantId) sp.set("tenant_id", tenantId);
    if (channelGroup && channelGroup !== "All") sp.set("channel_group", channelGroup);

    const pf = pageSliceFilters;
    if (pf?.ecdSlice) sp.set("ecd_slice", pf.ecdSlice);
    if (pf?.complexityBarBucket) sp.set("complexity_bucket", pf.complexityBarBucket);
    if (pf?.remainingComplexityGroup?.trim()) sp.set("remaining_complexity_group", pf.remainingComplexityGroup.trim());
    if (pf?.remainingProcessingStage?.trim())
      sp.set("remaining_processing_stage", pf.remainingProcessingStage.trim());
    if (detailFiltersJson) sp.set("detail_filters", detailFiltersJson);

    return sp.toString();
  }, [
    dateRangeType,
    limit,
    offset,
    tenantId,
    channelGroup,
    pageSliceFilters?.ecdSlice,
    pageSliceFilters?.complexityBarBucket,
    pageSliceFilters?.remainingComplexityGroup,
    pageSliceFilters?.remainingProcessingStage,
    detailFiltersJson,
  ]);

  useEffect(() => {
    const ac = new AbortController();
    setLoading(true);
    setError(null);
    api
      .request<EstimatedClosingsRiskResponse>(`/api/dashboard/estimated-closings-risk?${query}`, {
        signal: ac.signal,
        headers: { "Cache-Control": "no-cache" },
      })
      .then((res) => {
        setData(res);
      })
      .catch((err: unknown) => {
        if (ac.signal.aborted) return;
        setError(err instanceof Error ? err.message : "Failed to load Estimated Closings and Risk data.");
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false);
      });
    return () => {
      ac.abort();
    };
  }, [query]);

  return { data, loading, error };
}
