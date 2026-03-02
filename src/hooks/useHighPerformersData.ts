import { useState, useEffect } from "react";
import { api } from "@/lib/api";

export type HighPerformersDateType =
  | "funding_date"
  | "closing_date"
  | "application_date";
export type HighPerformersTimePeriod =
  | "mtd"
  | "lm"
  | "ytd"
  | "ly"
  | "rolling_13";

export interface HighPerformerRow {
  name: string;
  units: number;
  volume: number;
  rank: number;
  pctGovt: number;
  pctConv: number;
  pctRefi: number;
  pctPurch: number;
}

export interface HighPerformersData {
  branchRankings: HighPerformerRow[];
  loanOfficerRankings: HighPerformerRow[];
}

export function useHighPerformersData(
  dateType: HighPerformersDateType,
  timePeriod: HighPerformersTimePeriod,
  options?: { channelGroup?: string | null; tenantId?: string | null; dimensionFilters?: Array<{ column: string; value: string }> }
) {
  const { channelGroup, tenantId, dimensionFilters } = options ?? {};
  const [data, setData] = useState<HighPerformersData>({
    branchRankings: [],
    loanOfficerRankings: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams();
    params.set("dateType", dateType);
    params.set("timePeriod", timePeriod);
    if (tenantId) params.set("tenant_id", tenantId);
    if (channelGroup && channelGroup !== "All")
      params.set("channel_group", channelGroup);
    if (dimensionFilters) {
      for (const df of dimensionFilters) {
        if (df.value && df.value !== 'all') params.set(df.column, df.value);
      }
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .request<HighPerformersData>(`/api/dashboard/high-performers?${params}`)
      .then((res) => {
        if (!cancelled) {
          setData({
            branchRankings: res.branchRankings ?? [],
            loanOfficerRankings: res.loanOfficerRankings ?? [],
          });
        }
      })
      .catch((err: Error) => {
        if (!cancelled) {
          setData({
            branchRankings: [],
            loanOfficerRankings: [],
          });
          setError(err?.message ?? "Failed to load data");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateType, timePeriod, channelGroup, tenantId, JSON.stringify(dimensionFilters)]);

  return { data, loading, error };
}
