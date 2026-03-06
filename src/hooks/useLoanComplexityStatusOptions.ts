/**
 * Fetches distinct current_loan_status values for the loan complexity period (for filter dropdown).
 * Also returns hasFallout when Application Denied/Withdrawn exist.
 */

import { useState, useEffect, useCallback } from "react";
import { api } from "@/lib/api";

export interface UseLoanComplexityStatusOptionsParams {
  startDate: string;
  endDate: string;
  selectedTenantId?: string | null;
  channelGroup?: string | null;
  /** When false, skips fetch (e.g. when not on loan-complexity section). */
  enabled?: boolean;
}

export interface LoanComplexityStatusOptions {
  statuses: string[];
  hasFallout: boolean;
}

export function useLoanComplexityStatusOptions({
  startDate,
  endDate,
  selectedTenantId,
  channelGroup,
  enabled = true,
}: UseLoanComplexityStatusOptionsParams): {
  data: LoanComplexityStatusOptions;
  loading: boolean;
  error: string | null;
  refetch: () => void;
} {
  const [data, setData] = useState<LoanComplexityStatusOptions>({
    statuses: [],
    hasFallout: false,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (enabled === false) {
      setLoading(false);
      setData({ statuses: [], hasFallout: false });
      setError(null);
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
      const res = await api.request<{ statuses: string[]; hasFallout: boolean }>(
        `/api/dashboard/loan-complexity/status-options?${params.toString()}`
      );
      setData({
        statuses: res.statuses ?? [],
        hasFallout: res.hasFallout ?? false,
      });
    } catch (e: unknown) {
      const message =
        e instanceof Error ? e.message : "Failed to load status options";
      setError(message);
      setData({ statuses: [], hasFallout: false });
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate, selectedTenantId, channelGroup, enabled]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { data, loading, error, refetch: fetchData };
}
