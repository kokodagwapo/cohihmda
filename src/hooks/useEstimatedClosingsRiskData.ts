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

/** Must stay in sync with GET /api/dashboard/estimated-closings-risk max(1).max(10000). */
const ESTIMATED_CLOSINGS_DETAIL_EXPORT_CHUNK = 10_000;

export interface EstimatedClosingsRiskQueryParams {
  tenantId?: string | null;
  channelGroup?: string | null;
  dateRangeType: EstimatedClosingsDateRangeType;
  limit?: number;
  offset?: number;
  dimensionFilters?: Array<{ column: string; value: string }>;
  pageSliceFilters?: EstimatedClosingsPageSliceFilters;
  /** Precomputed JSON from `normalizeFilterState(detailColumnFilters)` (same as hook memo). */
  detailFiltersJson?: string | null;
}

export function buildEstimatedClosingsRiskQueryString(params: EstimatedClosingsRiskQueryParams): string {
  const sp = new URLSearchParams();
  sp.set("dateRangeType", params.dateRangeType);
  if (params.limit != null) sp.set("limit", String(params.limit));
  if (params.offset != null) sp.set("offset", String(params.offset));
  if (params.tenantId) sp.set("tenant_id", params.tenantId);
  if (params.channelGroup && params.channelGroup !== "All") sp.set("channel_group", params.channelGroup);
  for (const df of params.dimensionFilters ?? []) {
    if (!df?.column || !df?.value || df.value === "all") continue;
    sp.append(df.column, df.value);
  }

  const pf = params.pageSliceFilters;
  if (pf?.ecdSlice) sp.set("ecd_slice", pf.ecdSlice);
  if (pf?.complexityBarBucket) sp.set("complexity_bucket", pf.complexityBarBucket);
  if (pf?.remainingComplexityGroup?.trim()) sp.set("remaining_complexity_group", pf.remainingComplexityGroup.trim());
  if (pf?.remainingProcessingStage?.trim())
    sp.set("remaining_processing_stage", pf.remainingProcessingStage.trim());
  if (params.detailFiltersJson) sp.set("detail_filters", params.detailFiltersJson);

  return sp.toString();
}

/**
 * Fetch every detail row for the current Estimated Closings filters (same query as the table, without UI pagination).
 * Uses chunked requests capped at the API limit (10k per request).
 */
export async function fetchAllEstimatedClosingsDetailRows(params: {
  tenantId?: string | null;
  channelGroup?: string | null;
  dateRangeType: EstimatedClosingsDateRangeType;
  dimensionFilters?: Array<{ column: string; value: string }>;
  pageSliceFilters?: EstimatedClosingsPageSliceFilters;
  detailColumnFilters?: ColumnFilterState;
  signal?: AbortSignal;
}): Promise<{ rows: Array<Record<string, unknown>>; total: number }> {
  const normalized = params.detailColumnFilters ? normalizeFilterState(params.detailColumnFilters) : {};
  const detailFiltersJson =
    Object.keys(normalized).length > 0 ? JSON.stringify(normalized) : null;

  const all: Array<Record<string, unknown>> = [];
  let total = 0;
  let offset = 0;

  for (;;) {
    const query = buildEstimatedClosingsRiskQueryString({
      tenantId: params.tenantId,
      channelGroup: params.channelGroup,
      dateRangeType: params.dateRangeType,
      limit: ESTIMATED_CLOSINGS_DETAIL_EXPORT_CHUNK,
      offset,
      dimensionFilters: params.dimensionFilters,
      pageSliceFilters: params.pageSliceFilters,
      detailFiltersJson,
    });
    const res = await api.request<EstimatedClosingsRiskResponse>(
      `/api/dashboard/estimated-closings-risk?${query}`,
      {
        signal: params.signal,
        headers: { "Cache-Control": "no-cache" },
      },
    );
    total = res.detail.total;
    all.push(...res.detail.rows);
    offset += ESTIMATED_CLOSINGS_DETAIL_EXPORT_CHUNK;
    if (all.length >= total || res.detail.rows.length === 0) break;
  }

  return { rows: all, total };
}

export function useEstimatedClosingsRiskData(params: {
  tenantId?: string | null;
  channelGroup?: string | null;
  dateRangeType: EstimatedClosingsDateRangeType;
  limit?: number;
  offset?: number;
  dimensionFilters?: Array<{ column: string; value: string }>;
  pageSliceFilters?: EstimatedClosingsPageSliceFilters;
  detailColumnFilters?: ColumnFilterState;
}) {
  const { tenantId, channelGroup, dateRangeType, limit, offset, dimensionFilters, pageSliceFilters, detailColumnFilters } =
    params;
  const [data, setData] = useState<EstimatedClosingsRiskResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const normalizedDetailFilters = useMemo(
    () => (detailColumnFilters ? normalizeFilterState(detailColumnFilters) : {}),
    [detailColumnFilters],
  );
  const detailFiltersJson =
    Object.keys(normalizedDetailFilters).length > 0 ? JSON.stringify(normalizedDetailFilters) : null;

  const query = useMemo(
    () =>
      buildEstimatedClosingsRiskQueryString({
        tenantId,
        channelGroup,
        dateRangeType,
        limit,
        offset,
        dimensionFilters,
        pageSliceFilters,
        detailFiltersJson,
      }),
    [
      dateRangeType,
      limit,
      offset,
      tenantId,
      channelGroup,
      dimensionFilters,
      pageSliceFilters?.ecdSlice,
      pageSliceFilters?.complexityBarBucket,
      pageSliceFilters?.remainingComplexityGroup,
      pageSliceFilters?.remainingProcessingStage,
      detailFiltersJson,
    ],
  );

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
