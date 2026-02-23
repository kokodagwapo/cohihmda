import { useState, useEffect, useCallback } from "react";
import { api } from "@/lib/api";

export type WorkflowSegmentLoanFilter = "initial" | "fallout" | "pull-through";

export interface WorkflowSegmentLoanRow {
  loan_id: string;
  loan_number: string | null;
  loan_amount: number | null;
  fico_score: number | null;
  ltv_ratio: number | null;
  be_dti_ratio: number | null;
  branch: string | null;
  loan_officer: string | null;
  loan_type: string | null;
  loan_purpose: string | null;
  occupancy_type: string | null;
  channel: string | null;
  current_loan_status: string | null;
  from_date: string | null;
  to_date: string | null;
}

export interface UseWorkflowConversionSegmentLoansParams {
  startDate: string;
  endDate: string;
  segments: { from: string; to: string }[];
  grouping?: "workflow" | "individual";
  segmentIndex: number;
  filter: WorkflowSegmentLoanFilter | null;
  selectedTenantId?: string | null;
  channelGroup?: string | null;
}

export function useWorkflowConversionSegmentLoans({
  startDate,
  endDate,
  segments,
  grouping = "workflow",
  segmentIndex,
  filter,
  selectedTenantId,
  channelGroup,
}: UseWorkflowConversionSegmentLoansParams): {
  loans: WorkflowSegmentLoanRow[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
} {
  const [loans, setLoans] = useState<WorkflowSegmentLoanRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (
      !startDate ||
      !endDate ||
      segments.length === 0 ||
      segmentIndex < 0 ||
      segmentIndex >= segments.length ||
      !filter
    ) {
      setLoans([]);
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      setError(null);
      const params = new URLSearchParams();
      params.set("startDate", startDate);
      params.set("endDate", endDate);
      params.set("segments", JSON.stringify(segments));
      params.set("grouping", grouping);
      params.set("segmentIndex", String(segmentIndex));
      params.set("filter", filter);
      if (selectedTenantId) params.set("tenant_id", selectedTenantId);
      if (channelGroup && channelGroup !== "All") params.set("channel_group", channelGroup);
      const res = await api.request<{ loans: WorkflowSegmentLoanRow[] }>(
        `/api/dashboard/workflow-conversion/loans?${params.toString()}`
      );
      setLoans(res.loans ?? []);
    } catch (e: unknown) {
      const message =
        e instanceof Error ? e.message : "Failed to load workflow segment loans";
      setError(message);
      setLoans([]);
    } finally {
      setLoading(false);
    }
  }, [
    startDate,
    endDate,
    segments,
    grouping,
    segmentIndex,
    filter,
    selectedTenantId,
    channelGroup,
  ]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { loans, loading, error, refetch: fetchData };
}
