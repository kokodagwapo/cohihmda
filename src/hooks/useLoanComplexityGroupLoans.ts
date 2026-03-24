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
  branch: string | null;
  loan_officer: string | null;
  underwriter: string | null;
  processor: string | null;
  closer: string | null;
}

export interface UseLoanComplexityGroupLoansParams {
  startDate: string;
  endDate: string;
  /** When groupFilters is non-empty, used for cross-dimension (each pair = one groupBy + groupName). When empty, fetches all loans in period. */
  groupFilters: { groupBy: LoanComplexityGroupBy; groupName: string }[];
  /** @deprecated Use groupFilters. When groupFilters is empty, single-dimension multi-select: one groupBy + multiple groupNames. */
  groupBy?: LoanComplexityGroupBy;
  /** @deprecated Use groupFilters. */
  groupNames?: string[];
  selectedTenantId?: string | null;
  channelGroup?: string | null;
  /** When set, filter to loans with this current_loan_status. "All" or empty = no filter. */
  currentLoanStatus?: string | null;
  /** When false, skips fetch. */
  enabled?: boolean;
}

export function useLoanComplexityGroupLoans({
  startDate,
  endDate,
  groupFilters = [],
  groupBy,
  groupNames = [],
  selectedTenantId,
  channelGroup,
  currentLoanStatus,
  enabled = true,
}: UseLoanComplexityGroupLoansParams): {
  loans: LoanComplexityGroupLoanRow[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
} {
  const [loans, setLoans] = useState<LoanComplexityGroupLoanRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Stabilise array dependencies by serialising to JSON — avoids infinite
  // re-render loops when the parent passes a new array reference each render.
  const groupFiltersKey = JSON.stringify(groupFilters);
  const groupNamesKey = JSON.stringify(groupNames);

  const fetchData = useCallback(async () => {
    if (enabled === false) {
      setLoading(false);
      setError(null);
      setLoans([]);
      return;
    }
    try {
      setLoading(true);
      setError(null);
      const parsedGroupFilters: { groupBy: LoanComplexityGroupBy; groupName: string }[] = JSON.parse(groupFiltersKey);
      const parsedGroupNames: string[] = JSON.parse(groupNamesKey);

      const params = new URLSearchParams();
      params.set("startDate", startDate);
      params.set("endDate", endDate);
      if (parsedGroupFilters.length > 0) {
        parsedGroupFilters.forEach((f) => {
          params.append("groupBy", f.groupBy);
          params.append("groupName", f.groupName);
        });
      } else if (groupBy && parsedGroupNames.length > 0) {
        const trimmed = parsedGroupNames.map((n) => n.trim()).filter(Boolean);
        if (trimmed.length > 0) {
          params.set("groupBy", groupBy);
          trimmed.forEach((name) => params.append("groupName", name));
        }
      }
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
  }, [startDate, endDate, groupFiltersKey, groupBy, groupNamesKey, selectedTenantId, channelGroup, currentLoanStatus, enabled]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { loans, loading, error, refetch: fetchData };
}
