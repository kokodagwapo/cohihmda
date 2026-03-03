import { useState, useEffect, useCallback } from "react";
import { api } from "@/lib/api";

export type SalesScorecardOverviewMeasure = "volume" | "units" | "wa-interest-rate";

/** Time granularity when using Period + Time measure filters */
export type SalesScorecardOverviewTimeMeasure = "quarterly" | "monthly" | "weekly" | "daily";

export type SalesScorecardOverviewTimePeriod =
  | "monthly-ytd"
  | "quarterly-ytd"
  | "monthly-last-year"
  | "monthly-rolling-12"
  | "quarterly-last-year"
  | "weekly-mtd"
  | "weekly-last-3"
  | "daily-mtd"
  | "daily-last-month"
  | "weekly-scoped"
  | "daily-scoped";

export interface SalesScorecardOverviewRow {
  periodLabel: string;
  started: number;
  application: number;
  locked: number;
  closed: number;
  funded: number;
}

/** Base time periods shown in the dropdown (excludes drill-only weekly-scoped/daily-scoped) */
export const BASE_TIME_PERIODS: SalesScorecardOverviewTimePeriod[] = [
  "quarterly-ytd",
  "quarterly-last-year",
  "monthly-ytd",
  "monthly-last-year",
  "monthly-rolling-12",
  "weekly-mtd",
  "weekly-last-3",
  "daily-mtd",
  "daily-last-month",
];
export const TIME_PERIOD_LABELS: Record<SalesScorecardOverviewTimePeriod, string> = {
  "quarterly-ytd": "Quarterly YTD",
  "quarterly-last-year": "Quarterly Last Year",
  "monthly-ytd": "Monthly YTD",
  "monthly-last-year": "Monthly Last Year",
  "monthly-rolling-12": "Monthly rolling 12 months",
  "weekly-mtd": "Weekly MTD",
  "weekly-last-3": "Weekly Last 3 months",
  "daily-mtd": "Daily MTD",
  "daily-last-month": "Daily Last Month",
  "weekly-scoped": "Week",
  "daily-scoped": "Day",
};

/** Dimension filter for workbench (e.g. dynamic filters + branch/loan_officer) */
export interface SalesScorecardOverviewDimensionFilter {
  column: string;
  value: string;
}

export interface SalesScorecardOverviewFilters {
  measure: SalesScorecardOverviewMeasure;
  /** When not scoped: date range and granularity (used as start_date, end_date, time_measure) */
  startDate?: string;
  endDate?: string;
  timeMeasure?: SalesScorecardOverviewTimeMeasure;
  /** Legacy: when using old single time-period dropdown (optional if startDate/endDate/timeMeasure set) */
  timePeriod?: SalesScorecardOverviewTimePeriod;
  branch: string;
  loanOfficer: string;
  /** When drilling: weekly-scoped or daily-scoped */
  effectiveTimePeriod?: "weekly-scoped" | "daily-scoped";
  scopeStart?: string;
  scopeEnd?: string;
  /** Extra dimension filters from workbench (dynamic filters); applied as query params */
  dimensionFilters?: SalesScorecardOverviewDimensionFilter[];
}

export interface UseSalesScorecardOverviewDataResult {
  rows: SalesScorecardOverviewRow[];
  loading: boolean;
  error: string | null;
  branches: string[];
  loanOfficers: string[];
  refetch: () => void;
}

export function useSalesScorecardOverviewData(
  filters: SalesScorecardOverviewFilters,
  tenantId: string | null
): UseSalesScorecardOverviewDataResult {
  const [rows, setRows] = useState<SalesScorecardOverviewRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [branches, setBranches] = useState<string[]>([]);
  const [loanOfficers, setLoanOfficers] = useState<string[]>([]);

  const fetchData = useCallback(async () => {
    if (!tenantId) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("measure", filters.measure);
      const isScoped =
        filters.effectiveTimePeriod && filters.scopeStart && filters.scopeEnd;
      if (isScoped) {
        params.set("time_period", filters.effectiveTimePeriod);
        params.set("scope_start", filters.scopeStart);
        params.set("scope_end", filters.scopeEnd);
      } else {
        const start = filters.startDate ?? "";
        const end = filters.endDate ?? "";
        const measure = filters.timeMeasure ?? "monthly";
        params.set("start_date", start);
        params.set("end_date", end);
        params.set("time_measure", measure);
      }
      if (tenantId) params.set("tenant_id", tenantId);
      if (filters.branch) params.set("branch", filters.branch);
      if (filters.loanOfficer) params.set("loan_officer", filters.loanOfficer);
      (filters.dimensionFilters ?? []).forEach((df) => {
        if (df.value && df.value !== "all") params.set(df.column, df.value);
      });

      const url = `/api/scorecard/sales-scorecard-overview?${params.toString()}`;
      const data = await api.request<{ rows: SalesScorecardOverviewRow[] }>(url);
      setRows(data.rows ?? []);
    } catch (err: any) {
      setError(err.message || "Failed to load sales scorecard overview");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [
    tenantId,
    filters.measure,
    filters.startDate,
    filters.endDate,
    filters.timeMeasure,
    filters.effectiveTimePeriod,
    filters.scopeStart,
    filters.scopeEnd,
    filters.branch,
    filters.loanOfficer,
    filters.dimensionFilters,
  ]);

  const fetchFilterOptions = useCallback(async () => {
    if (!tenantId) return;
    try {
      const params = new URLSearchParams();
      params.set("tenant_id", tenantId);
      const url = `/api/scorecard/sales-scorecard-overview/filter-options?${params.toString()}`;
      const data = await api.request<{
        branches: string[];
        loanOfficers: string[];
      }>(url);
      setBranches(data.branches ?? []);
      setLoanOfficers(data.loanOfficers ?? []);
    } catch {
      setBranches([]);
      setLoanOfficers([]);
    }
  }, [tenantId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (tenantId) fetchFilterOptions();
  }, [tenantId, fetchFilterOptions]);

  return {
    rows,
    loading,
    error,
    branches,
    loanOfficers,
    refetch: fetchData,
  };
}
