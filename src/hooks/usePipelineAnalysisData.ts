/**
 * Hook for Pipeline Analysis snapshots.
 * GET /api/pipeline-analysis/snapshots?from=YYYY-MM-DD&to=YYYY-MM-DD
 */

import { useState, useEffect, useCallback } from "react";
import { api } from "@/lib/api";

export interface PipelineSnapshotRow {
  date: string;
  index: number;
  snapshot_weekday: string;
  year: number;
  week_value: number;
  active_units: number;
  active_volume: number;
  active_lo_count: number;
  weekly_pct_change_volume: number | null;
  monthly_pct_change_volume: number | null;
  annual_pct_change_volume: number | null;
  weekly_pct_change_units: number | null;
  monthly_pct_change_units: number | null;
  annual_pct_change_units: number | null;
  calculated_at: string | null;
}

export interface UsePipelineAnalysisDataOptions {
  from?: string | null;
  to?: string | null;
  /** Tenant ID for API (required for platform staff; use selectedTenantId ?? user?.tenant_id) */
  tenantId?: string | null;
  /** Which date to use as the pipeline start: application_date (default), lock_date, or processing_date. Changing triggers refetch. */
  startDateField?: "application_date" | "lock_date" | "processing_date";
  /** Filters applied before counting. Empty/undefined = no filter (all). When any array has items, only those are included. */
  filters?: {
    loanTypes?: string[];
    loanPurposes?: string[];
    branches?: string[];
  } | null;
  dimensionFilters?: Array<{ column: string; value: string }>;
}

export interface UsePipelineAnalysisDataResult {
  snapshots: PipelineSnapshotRow[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function usePipelineAnalysisData(
  options: UsePipelineAnalysisDataOptions
): UsePipelineAnalysisDataResult {
  const [snapshots, setSnapshots] = useState<PipelineSnapshotRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSnapshots = useCallback(async () => {
    const params = new URLSearchParams();
    if (options.tenantId) params.set("tenant_id", options.tenantId);
    if (options.from) params.set("from", options.from);
    if (options.to) params.set("to", options.to);
    if (options.startDateField === "lock_date") params.set("start_date_field", "lock_date");
    if (options.startDateField === "processing_date") params.set("start_date_field", "processing_date");
    const f = options.filters;
    if (f?.loanTypes?.length) f.loanTypes.forEach((v) => params.append("loan_type", v));
    if (f?.loanPurposes?.length) f.loanPurposes.forEach((v) => params.append("loan_purpose", v));
    if (f?.branches?.length) f.branches.forEach((v) => params.append("branch", v));
    if (options.dimensionFilters) {
      for (const df of options.dimensionFilters) {
        if (df.value && df.value !== 'all') params.append(df.column, df.value);
      }
    }
    const qs = params.toString();
    try {
      setLoading(true);
      setError(null);
      const data = await api.request<{ snapshots: PipelineSnapshotRow[] }>(
        `/api/pipeline-analysis/snapshots${qs ? `?${qs}` : ""}`,
        { headers: { "Cache-Control": "no-cache" } }
      );
      setSnapshots(data.snapshots ?? []);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to load pipeline analysis data";
      setError(msg);
      setSnapshots([]);
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.tenantId, options.from, options.to, options.startDateField, options.filters, JSON.stringify(options.dimensionFilters)]);

  useEffect(() => {
    fetchSnapshots();
  }, [fetchSnapshots]);

  return { snapshots, loading, error, refetch: fetchSnapshots };
}

export interface PipelineYearRange {
  minYear: number | null;
  maxYear: number | null;
}

export interface PipelineConfig {
  snapshot_day_of_week: number;
}

export function usePipelineAnalysisConfig(tenantId: string | null): {
  config: PipelineConfig | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
} {
  const [config, setConfig] = useState<PipelineConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchConfig = useCallback(async () => {
    if (!tenantId) {
      setConfig(null);
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      setError(null);
      const data = await api.request<{ snapshot_day_of_week: number }>(
        `/api/pipeline-analysis/config?tenant_id=${encodeURIComponent(tenantId)}`,
        { headers: { "Cache-Control": "no-cache" } }
      );
      setConfig({ snapshot_day_of_week: data.snapshot_day_of_week ?? 1 });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load pipeline config");
      setConfig({ snapshot_day_of_week: 1 });
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  return { config, loading, error, refetch: fetchConfig };
}

export function usePipelineAnalysisRange(tenantId: string | null): {
  range: PipelineYearRange | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
} {
  const [range, setRange] = useState<PipelineYearRange | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchRange = useCallback(async () => {
    if (!tenantId) {
      setRange(null);
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      setError(null);
      const data = await api.request<{ minYear: number | null; maxYear: number | null }>(
        `/api/pipeline-analysis/range?tenant_id=${encodeURIComponent(tenantId)}`
      );
      setRange({ minYear: data.minYear ?? null, maxYear: data.maxYear ?? null });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load year range");
      setRange(null);
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    fetchRange();
  }, [fetchRange]);

  return { range, loading, error, refetch: fetchRange };
}

export interface PipelineFilterOptions {
  loanTypes: string[];
  loanPurposes: string[];
  branches: string[];
}

export function usePipelineAnalysisFilterOptions(tenantId: string | null): {
  options: PipelineFilterOptions | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
} {
  const [options, setOptions] = useState<PipelineFilterOptions | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchOptions = useCallback(async () => {
    if (!tenantId) {
      setOptions(null);
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      setError(null);
      const data = await api.request<PipelineFilterOptions>(
        `/api/pipeline-analysis/filter-options?tenant_id=${encodeURIComponent(tenantId)}`,
        { headers: { "Cache-Control": "no-cache" } }
      );
      setOptions({
        loanTypes: data.loanTypes ?? [],
        loanPurposes: data.loanPurposes ?? [],
        branches: data.branches ?? [],
      });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load filter options");
      setOptions({ loanTypes: [], loanPurposes: [], branches: [] });
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    fetchOptions();
  }, [fetchOptions]);

  return { options, loading, error, refetch: fetchOptions };
}
