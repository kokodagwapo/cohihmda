/**
 * Fetches loan rows for a single loan complexity group (one bar click).
 * Same filters as the dashboard: startDate, endDate, groupBy, groupName, tenant, channel.
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

export interface LoanComplexityGroupLoanRow {
  loan_id: string;
  loan_number: string | null;
  loan_amount: number | null;
  loan_type: string | null;
  loan_program: string | null;
  loan_purpose: string | null;
  application_date: string | null;
  current_loan_status: string | null;
  current_milestone: string | null;
  ltv_ratio: number | null;
  be_dti_ratio: number | null;
  fico_score: number | null;
  occupancy_type: string | null;
  borr_self_employed: boolean | string | null;
  complexity_score: number | null;
}

export interface UseLoanComplexityGroupLoansParams {
  startDate: string;
  endDate: string;
  groupBy: LoanComplexityGroupBy;
  groupName: string | null;
  selectedTenantId?: string | null;
  channelGroup?: string | null;
  /** When set, filter to loans with this current_loan_status. "All" or empty = no filter. */
  currentLoanStatus?: string | null;
}

export function useLoanComplexityGroupLoans({
  startDate,
  endDate,
  groupBy,
  groupName,
  selectedTenantId,
  channelGroup,
  currentLoanStatus,
}: UseLoanComplexityGroupLoansParams): {
  loans: LoanComplexityGroupLoanRow[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
} {
  const [loans, setLoans] = useState<LoanComplexityGroupLoanRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!groupName || !groupName.trim()) {
      setLoans([]);
      setLoading(false);
      setError(null);
      return;
    }
    try {
      setLoading(true);
      setError(null);
      const params = new URLSearchParams();
      params.set("startDate", startDate);
      params.set("endDate", endDate);
      params.set("groupBy", groupBy);
      params.set("groupName", groupName.trim());
      if (selectedTenantId) params.set("tenant_id", selectedTenantId);
      if (channelGroup && channelGroup !== "All") params.set("channel_group", channelGroup);
      if (currentLoanStatus && currentLoanStatus.trim() && currentLoanStatus !== "All") {
        params.set("current_loan_status", currentLoanStatus.trim());
      }
      const res = await api.request<{ loans: LoanComplexityGroupLoanRow[] }>(
        `/api/dashboard/loan-complexity/loans?${params.toString()}`
      );
      setLoans(res.loans ?? []);
    } catch (e: unknown) {
      const message =
        e instanceof Error ? e.message : "Failed to load loan details";
      setError(message);
      setLoans([]);
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate, groupBy, groupName, selectedTenantId, channelGroup, currentLoanStatus]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { loans, loading, error, refetch: fetchData };
}
