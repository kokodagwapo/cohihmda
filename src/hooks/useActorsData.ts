/**
 * Fetches Actors dashboard data: status counts, KPIs, and four actor tables.
 * Uses same period filter as Workflow Conversion (startDate/endDate from DatePeriodPicker).
 */

import { useState, useEffect, useCallback } from "react";
import { api } from "@/lib/api";

export type ActorsCalculation = "average" | "median";
export type ActorsTurnTimeType = "app_to_fund_days" | "app_to_closing_days";
export type ActorsDateRangeType = "calendar_days" | "business_days";
export type ActorsMeasure = "volume" | "units";

export type ActorDimension =
  | "channel"
  | "processor"
  | "closer"
  | "underwriter"
  | "loan_officer"
  | "branch"
  | "investor"
  | "warehouse_co_name";

export interface StatusCount {
  status: string;
  count: number;
  volume: number;
}

export interface ActorsKPIs {
  units: number;
  volume: number;
  averageBalance: number;
  wac: number | null;
  wam: number | null;
  waFico: number | null;
  waLtv: number | null;
  waDti: number | null;
}

export interface ActorRow {
  name: string;
  units: number;
  volume: number;
  avgAppToFund: number | null;
  approvalPct: number;
  deniedPct: number;
  withdrawnPct: number;
  loanComplexity: number | null;
}

export interface ActorsTableResult {
  rows: ActorRow[];
  totals: Omit<ActorRow, "name"> & { name: "Totals" };
}

export interface ActorsDashboardData {
  statusCounts: StatusCount[];
  kpis: ActorsKPIs;
  tables: [ActorsTableResult, ActorsTableResult, ActorsTableResult, ActorsTableResult];
}

export interface UseActorsDataParams {
  startDate: string;
  endDate: string;
  calculation: ActorsCalculation;
  turnTimeType: ActorsTurnTimeType;
  dateRangeType: ActorsDateRangeType;
  measure: ActorsMeasure;
  selectedTenantId?: string | null;
  channelGroup?: string | null;
  selectedActor?: { type: ActorDimension; name: string } | null;
  /** When set, filter to loans with this current_loan_status (raw value; use 'Unknown' for null/empty) */
  selectedStatus?: string | null;
  tableDimensions?: [ActorDimension, ActorDimension, ActorDimension, ActorDimension];
}

const DEFAULT_TABLE_DIMENSIONS: [ActorDimension, ActorDimension, ActorDimension, ActorDimension] = [
  "loan_officer",
  "processor",
  "underwriter",
  "closer",
];

export function useActorsData({
  startDate,
  endDate,
  calculation,
  turnTimeType,
  dateRangeType,
  measure,
  selectedTenantId,
  channelGroup,
  selectedActor,
  selectedStatus,
  tableDimensions = DEFAULT_TABLE_DIMENSIONS,
}: UseActorsDataParams): {
  data: ActorsDashboardData | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
} {
  const [data, setData] = useState<ActorsDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const params = new URLSearchParams();
      params.set("startDate", startDate);
      params.set("endDate", endDate);
      params.set("calculation", calculation);
      params.set("turnTimeType", turnTimeType);
      params.set("dateRangeType", dateRangeType);
      params.set("measure", measure);
      if (selectedTenantId) params.set("tenant_id", selectedTenantId);
      if (channelGroup && channelGroup !== "All") params.set("channel_group", channelGroup);
      if (selectedActor?.type && selectedActor?.name) {
        params.set("actor_type", selectedActor.type);
        params.set("actor_name", selectedActor.name);
      }
      if (selectedStatus != null && selectedStatus !== "") {
        params.set("status_filter", selectedStatus);
      }
      params.set("tableDimensions", JSON.stringify(tableDimensions));
      const res = await api.request<ActorsDashboardData>(
        `/api/dashboard/actors?${params.toString()}`
      );
      setData(res);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Failed to load actors dashboard data";
      setError(message);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [
    startDate,
    endDate,
    calculation,
    turnTimeType,
    dateRangeType,
    measure,
    selectedTenantId,
    channelGroup,
    selectedActor?.type,
    selectedActor?.name,
    selectedStatus,
    tableDimensions,
  ]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { data, loading, error, refetch: fetchData };
}
