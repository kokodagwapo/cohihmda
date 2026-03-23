import { useState, useEffect, useCallback } from "react";
import { api } from "@/lib/api";

export type OperationsActorType = "processor" | "underwriter" | "closer";
export type DateRangeType = "3-months" | "6-months" | "12-months";

export interface OperationsActorLoan {
  loan_id: string;
  loan_number: string | null;
  loan_amount: number | string | null;
  current_loan_status: string | null;
  loan_type: string | null;
  loan_purpose: string | null;
  channel: string | null;
  branch: string | null;
  loan_officer: string | null;
  underwriter: string | null;
  processor: string | null;
  closer: string | null;
  fico_score: number | string | null;
  ltv_ratio: number | string | null;
  be_dti_ratio: number | string | null;
  application_date: string | null;
  lock_date: string | null;
  closing_date: string | null;
  funding_date: string | null;
  turn_time_days: number | null;
}

export interface OperationsActorLoansResponse {
  loans: OperationsActorLoan[];
  total: number;
  limit: number;
  offset: number;
  page: number;
  totalPages: number;
  dateRange: {
    start: string;
    end: string;
    months: number;
  };
}

export interface OpsCustomDateRange {
  start: string;
  end: string;
}

/**
 * Hook to fetch paginated loans for a single operations scorecard actor
 * (e.g. one underwriter) in the same date window and filters as the scorecard.
 * Only fetches when actorName is non-empty.
 */
export function useOperationsScorecardActorLoans(
  actorType: OperationsActorType,
  actorName: string | null,
  dateRange: DateRangeType,
  customDateRange: OpsCustomDateRange | undefined,
  selectedTenantId: string | null | undefined,
  selectedChannel: string | null | undefined,
  limit: number,
  offset: number
) {
  const [data, setData] = useState<OperationsActorLoansResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchActorLoans = useCallback(async () => {
    if (!actorName || actorName.trim() === "" || !api.hasToken()) {
      setData(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      params.append("actor_type", actorType);
      params.append("actor_name", actorName.trim());
      params.append("date_range", dateRange);
      if (customDateRange) {
        params.append("start_date", customDateRange.start);
        params.append("end_date", customDateRange.end);
      }
      if (selectedTenantId) params.append("tenant_id", selectedTenantId);
      if (selectedChannel && selectedChannel !== "All") {
        params.append("channel_group", selectedChannel);
      }
      params.append("limit", String(limit));
      params.append("offset", String(offset));

      const url = `/api/scorecard/operations-actor-loans?${params.toString()}`;
      const responseData = await api.request<OperationsActorLoansResponse>(url);
      setData(responseData);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to fetch actor loans";
      setError(message);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [
    actorType,
    actorName,
    dateRange,
    customDateRange?.start,
    customDateRange?.end,
    selectedTenantId,
    selectedChannel,
    limit,
    offset,
  ]);

  useEffect(() => {
    fetchActorLoans();
  }, [fetchActorLoans]);

  return {
    loans: data?.loans ?? [],
    total: data?.total ?? 0,
    limit: data?.limit ?? limit,
    offset: data?.offset ?? offset,
    page: data?.page ?? 1,
    totalPages: data?.totalPages ?? 0,
    dateRange: data?.dateRange ?? null,
    loading,
    error,
    refetch: fetchActorLoans,
  };
}
