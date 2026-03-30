import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";

export type EstimatedClosingsDateRangeType = "calendar_days" | "business_days";

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
    key: "empty_ecd" | "past_ecd" | "remaining_to_fund" | "after_this_month";
    label: string;
    count: number;
  }>;
  maxPossibleFundingByComplexity: Array<{
    bucketKey: "gte_130" | "gte_120" | "gte_110" | "all_rest";
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
}) {
  const { tenantId, channelGroup, dateRangeType, limit, offset } = params;
  const [data, setData] = useState<EstimatedClosingsRiskResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const query = useMemo(() => {
    const sp = new URLSearchParams();
    sp.set("dateRangeType", dateRangeType);
    if (limit != null) sp.set("limit", String(limit));
    if (offset != null) sp.set("offset", String(offset));
    if (tenantId) sp.set("tenant_id", tenantId);
    if (channelGroup && channelGroup !== "All") sp.set("channel_group", channelGroup);
    return sp.toString();
  }, [dateRangeType, limit, offset, tenantId, channelGroup]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .request<EstimatedClosingsRiskResponse>(`/api/dashboard/estimated-closings-risk?${query}`)
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load Estimated Closings and Risk data.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [query]);

  return { data, loading, error };
}

