/**
 * Fetches Loan Complexity dashboard data: average complexity per group (loan officer, branch, or current_loan_status).
 * Uses same period filter as Actors (startDate/endDate from DatePeriodPicker).
 */

import { useState, useEffect, useCallback } from "react";
import { api } from "@/lib/api";

export type LoanComplexityGroupBy =
  | "loan_officer"
  | "processor"
  | "underwriter"
  | "closer"
  | "branch"
  | "current_loan_status";

export interface LoanComplexityBar {
  groupName: string;
  avgComplexity: number;
  loanCount: number;
}

export interface LoanComplexityDashboardData {
  bars: LoanComplexityBar[];
}

export interface UseLoanComplexityDataParams {
  startDate: string;
  endDate: string;
  groupBy: LoanComplexityGroupBy;
  selectedTenantId?: string | null;
  channelGroup?: string | null;
  /** When set, filter to loans with this current_loan_status (e.g. "Active Loan"). "All" or empty = no filter. */
  currentLoanStatus?: string | null;
  /** When false, skips fetch (e.g. when no loan-complexity section on canvas). */
  enabled?: boolean;
}

export function useLoanComplexityData({
  startDate,
  endDate,
  groupBy,
  selectedTenantId,
  channelGroup,
  currentLoanStatus,
  enabled = true,
}: UseLoanComplexityDataParams): {
  data: LoanComplexityDashboardData | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
} {
  const [data, setData] = useState<LoanComplexityDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (enabled === false) {
      setLoading(false);
      setError(null);
      setData(null);
      return;
    }
    try {
      setLoading(true);
      setError(null);
      const params = new URLSearchParams();
      params.set("startDate", startDate);
      params.set("endDate", endDate);
      params.set("groupBy", groupBy);
      if (selectedTenantId) params.set("tenant_id", selectedTenantId);
      if (channelGroup && channelGroup !== "All") params.set("channel_group", channelGroup);
      if (currentLoanStatus && currentLoanStatus.trim() && currentLoanStatus !== "All") {
        params.set("current_loan_status", currentLoanStatus.trim());
      }
      const res = await api.request<LoanComplexityDashboardData>(
        `/api/dashboard/loan-complexity?${params.toString()}`
      );
      setData(res);
    } catch (e: unknown) {
      const message =
        e instanceof Error ? e.message : "Failed to load loan complexity data";
      setError(message);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate, groupBy, selectedTenantId, channelGroup, currentLoanStatus, enabled]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { data, loading, error, refetch: fetchData };
}
