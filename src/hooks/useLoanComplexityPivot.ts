/**
 * Fetches Loan Complexity pivot table data: dimensions (Loan Officer, Branch, Underwriter, Processor, Closer)
 * with units, WA complexity, time in motion, % by type/purpose, % locked, % originated/denied/withdrawn.
 * Uses same period and filters as loan complexity dashboard.
 */

import { useState, useEffect, useCallback } from "react";
import { api } from "@/lib/api";

export interface PivotRowMetrics {
  groupName: string;
  units: number;
  waComplexity: number | null;
  timeInMotionDays: number | null;
  pctByType: Record<string, number>;
  pctByPurpose: Record<string, number>;
  pctLocked: number;
  pctActive: number;
  pctOriginated: number;
  pctDenied: number;
  pctWithdrawn: number;
}

export interface PivotDimensionResult {
  dimension: string;
  label: string;
  total: PivotRowMetrics;
  rows: PivotRowMetrics[];
}

export interface LoanComplexityPivotData {
  dimensions: PivotDimensionResult[];
  loanTypes: string[];
  purposes: string[];
}

export interface UseLoanComplexityPivotParams {
  startDate: string;
  endDate: string;
  selectedTenantId?: string | null;
  channelGroup?: string | null;
  currentLoanStatus?: string | null;
  /** When false, skips fetch. */
  enabled?: boolean;
}

export function useLoanComplexityPivot({
  startDate,
  endDate,
  selectedTenantId,
  channelGroup,
  currentLoanStatus,
  enabled = true,
}: UseLoanComplexityPivotParams): {
  data: LoanComplexityPivotData | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
} {
  const [data, setData] = useState<LoanComplexityPivotData | null>(null);
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
      if (selectedTenantId) params.set("tenant_id", selectedTenantId);
      if (channelGroup && channelGroup !== "All") params.set("channel_group", channelGroup);
      if (currentLoanStatus && currentLoanStatus.trim() && currentLoanStatus !== "All") {
        params.set("current_loan_status", currentLoanStatus.trim());
      }
      const res = await api.request<LoanComplexityPivotData>(
        `/api/dashboard/loan-complexity/pivot?${params.toString()}`
      );
      setData(res);
    } catch (e: unknown) {
      const message =
        e instanceof Error ? e.message : "Failed to load pivot data";
      setError(message);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate, selectedTenantId, channelGroup, currentLoanStatus, enabled]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { data, loading, error, refetch: fetchData };
}
