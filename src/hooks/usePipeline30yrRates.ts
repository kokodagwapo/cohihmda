/**
 * Hook to fetch 30-year fixed weighted average interest rate per snapshot date for Pipeline Analysis treasury chart.
 * GET /api/pipeline-analysis/treasury-30yr-rate
 */

import { useState, useEffect, useCallback } from "react";
import { api } from "@/lib/api";

export interface Pipeline30yrRatePoint {
  date: string;
  weighted_avg_rate: number | null;
}

export interface UsePipeline30yrRatesOptions {
  from: string | null;
  to: string | null;
  tenantId?: string | null;
  startDateField?: "application_date" | "lock_date" | "processing_date" | "credit_pull_date" | "submitted_to_underwriting_date";
  filters?: {
    loanTypes?: string[];
    loanPurposes?: string[];
    branches?: string[];
  } | null;
  /** When provided, only these snapshot dates are requested (e.g. chart dates for treasury tab). */
  snapshotDates?: string[] | null;
}

export function usePipeline30yrRates(options: UsePipeline30yrRatesOptions): {
  rates: Pipeline30yrRatePoint[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
} {
  const { from, to, tenantId, startDateField, filters, snapshotDates } = options;
  const [rates, setRates] = useState<Pipeline30yrRatePoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!from || !to) {
      setRates([]);
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      setError(null);
      const params = new URLSearchParams({ from, to });
      if (tenantId) params.set("tenant_id", tenantId);
      if (startDateField && startDateField !== "application_date") params.set("start_date_field", startDateField);
      if (filters?.loanTypes?.length) filters.loanTypes.forEach((v) => params.append("loan_type", v));
      if (filters?.loanPurposes?.length) filters.loanPurposes.forEach((v) => params.append("loan_purpose", v));
      if (filters?.branches?.length) filters.branches.forEach((v) => params.append("branch", v));
      if (snapshotDates?.length) snapshotDates.forEach((d) => params.append("snapshot_dates", d));
      const result = await api.request<{ rates: Pipeline30yrRatePoint[] }>(
        `/api/pipeline-analysis/treasury-30yr-rate?${params.toString()}`,
        { headers: { "Cache-Control": "no-cache" } }
      );
      setRates(result.rates ?? []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load 30-year fixed rates");
      setRates([]);
    } finally {
      setLoading(false);
    }
  }, [from, to, tenantId, startDateField, filters?.loanTypes, filters?.loanPurposes, filters?.branches, snapshotDates?.length, snapshotDates?.join(",")]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { rates, loading, error, refetch: fetchData };
}
