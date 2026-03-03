/**
 * Pipeline Analysis View
 * Table: columns = Monday 1st, 2nd, …; rows = year (volume), year (units), Weekly/Monthly/Annual Percent Change.
 * All data is computed live from loans; changing filters or dropdowns triggers a fresh calculation.
 */

import React, { useMemo, useState, useCallback, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { usePipelineAnalysisData, usePipelineAnalysisRange, usePipelineAnalysisConfig, usePipelineAnalysisFilterOptions, usePipelineAnalysisLoans, type PipelineSnapshotRow, type PipelineLoanDetailRow } from "@/hooks/usePipelineAnalysisData";
import { useTreasury10y } from "@/hooks/useTreasury10y";
import { Loader2, Table2, BarChart3, TrendingUp, ChevronDown, ArrowUp, ArrowDown, ChevronsUpDown, X, Download } from "lucide-react";
import { format, parseISO } from "date-fns";
import { api } from "@/lib/api";
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  Legend,
  Cell,
} from "recharts";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";

export type PipelineViewMode = "week" | "month";

export type PipelinePctMetric = "volume" | "units";

function formatVolume(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function formatPct(value: number | null): string {
  if (value === null || value === undefined) return "-";
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function formatUnitsPerActor(units: number, count: number): string {
  if (count == null || count <= 0) return "-";
  return (units / count).toFixed(1);
}

/** Returns Tailwind background class for heatmap: bottom 35% red, middle 30% yellow, top 35% green (by percentile). */
function heatmapClass(value: number | null, p35: number, p65: number): string {
  if (value == null || !Number.isFinite(p35) || !Number.isFinite(p65)) return "";
  if (value <= p35) return "bg-red-100 dark:bg-red-950/50";
  if (value >= p65) return "bg-emerald-100 dark:bg-emerald-950/50";
  return "bg-yellow-100 dark:bg-yellow-950/50";
}

/** Ordinal suffix: 1 -> "1st", 2 -> "2nd", 3 -> "3rd", 13 -> "13th", etc. */
function ordinal(n: number): string {
  const s = n % 10;
  const t = n % 100;
  if (s === 1 && t !== 11) return `${n}st`;
  if (s === 2 && t !== 12) return `${n}nd`;
  if (s === 3 && t !== 13) return `${n}rd`;
  return `${n}th`;
}

function escapeCsvCell(val: string | number | null | undefined): string {
  const s = val === null || val === undefined ? "" : String(val);
  if (s.includes('"') || s.includes(",") || s.includes("\n") || s.includes("\r")) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

/** First Monday on or after the 1st of the given month. */
function getFirstMondayOfMonth(year: number, month: number): Date {
  const first = new Date(year, month - 1, 1);
  const day = first.getDay(); // 0=Sun, 1=Mon, ...
  const daysToAdd = day === 0 ? 1 : day === 1 ? 0 : 8 - day;
  first.setDate(first.getDate() + daysToAdd);
  return first;
}

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const SNAPSHOT_DAY_LABELS: Record<number, string> = {
  1: "Monday",
  2: "Tuesday",
  3: "Wednesday",
  4: "Thursday",
  5: "Friday",
};

/**
 * Build map (year, month) -> snapshot row for the first snapshot date in that month.
 * Used for month-by-month table and chart (columns = Jan, Feb, ... Dec; rows = years).
 */
function snapshotsToByYearMonth(
  snapshots: PipelineSnapshotRow[]
): Map<string, PipelineSnapshotRow> {
  const byYearMonth = new Map<string, PipelineSnapshotRow>();
  for (const row of snapshots) {
    const d = typeof row.date === "string" ? parseISO(row.date) : new Date(row.date);
    const y = d.getFullYear();
    const m = d.getMonth() + 1;
    const key = `${y}-${m}`;
    const existing = byYearMonth.get(key);
    const rowStr = typeof row.date === "string" ? row.date.slice(0, 10) : format(new Date(row.date), "yyyy-MM-dd");
    if (!existing || rowStr < (typeof existing.date === "string" ? existing.date.slice(0, 10) : format(new Date(existing.date), "yyyy-MM-dd"))) {
      byYearMonth.set(key, row);
    }
  }
  return byYearMonth;
}

export interface PipelineAnalysisViewProps {
  /** Effective tenant for API (selectedTenantId ?? user?.tenant_id); required for platform staff */
  tenantId?: string | null;
  selectedTenantId?: string | null;
  selectedChannel?: string | null;
}

/** All week numbers 1–53 for two-year view. */
const ALL_WEEK_VALUES = Array.from({ length: 53 }, (_, i) => i + 1);

export function PipelineAnalysisView({
  tenantId,
  selectedTenantId,
  selectedChannel,
}: PipelineAnalysisViewProps) {
  const [viewMode, setViewMode] = useState<PipelineViewMode>("week");
  const [pctMetric, setPctMetric] = useState<PipelinePctMetric>("volume");
  const [dataViewTab, setDataViewTab] = useState<"table" | "chart" | "loCountChart" | "treasury10y">("table");
  const [startDateField, setStartDateField] = useState<"application_date" | "lock_date" | "processing_date" | "credit_pull_date" | "submitted_to_underwriting_date">("application_date");
  /** Selected week values (1–53) in week mode; selection persists when switching tabs. */
  const [selectedWeekValues, setSelectedWeekValues] = useState<number[]>([]);
  /** Selected months (1–12) in month mode; selection persists when switching tabs. */
  const [selectedMonths, setSelectedMonths] = useState<number[]>([]);

  type FilterState = { loanTypes: string[]; loanPurposes: string[]; branches: string[] };
  const emptyFilters: FilterState = { loanTypes: [], loanPurposes: [], branches: [] };
  const [appliedFilters, setAppliedFilters] = useState<FilterState>(emptyFilters);
  const [draftFilters, setDraftFilters] = useState<FilterState>(emptyFilters);

  const { range, loading: rangeLoading, refetch: refetchRange } = usePipelineAnalysisRange(tenantId ?? null);
  const { config, loading: configLoading, refetch: refetchConfig } = usePipelineAnalysisConfig(tenantId ?? null);
  const { options: filterOptions, loading: filterOptionsLoading } = usePipelineAnalysisFilterOptions(tenantId ?? null);

  const yearRangeOptions = useMemo(() => {
    const min = range?.minYear ?? new Date().getFullYear() - 2;
    const max = range?.maxYear ?? new Date().getFullYear();
    const options: string[] = [];
    for (let y = min; y < max; y++) options.push(`${y}-${y + 1}`);
    if (options.length === 0) options.push(`${max - 1}-${max}`);
    return options;
  }, [range?.minYear, range?.maxYear]);

  const defaultYearRange = useMemo(
    () => (yearRangeOptions.length > 0 ? yearRangeOptions[yearRangeOptions.length - 1] : null),
    [yearRangeOptions]
  );

  const [selectedYearRange, setSelectedYearRange] = useState<string | null>(null);
  const effectiveYearRange = selectedYearRange ?? defaultYearRange;

  const { from, to } = useMemo(() => {
    if (!effectiveYearRange) return { from: "", to: "" };
    const [start, end] = effectiveYearRange.split("-").map(Number);
    return {
      from: `${start}-01-01`,
      to: `${end}-12-31`,
    };
  }, [effectiveYearRange]);

  const filtersForApi = useMemo(() => {
    const a = appliedFilters;
    const types = a.loanTypes ?? [];
    const purposes = a.loanPurposes ?? [];
    const branches = a.branches ?? [];
    const typeOpts = filterOptions?.loanTypes ?? [];
    const purposeOpts = filterOptions?.loanPurposes ?? [];
    const branchOpts = filterOptions?.branches ?? [];
    const hasTypeFilter = types.length > 0 && types.length !== typeOpts.length;
    const hasPurposeFilter = purposes.length > 0 && purposes.length !== purposeOpts.length;
    const hasBranchFilter = branches.length > 0 && branches.length !== branchOpts.length;
    if (hasTypeFilter || hasPurposeFilter || hasBranchFilter) {
      return {
        loanTypes: hasTypeFilter ? types : undefined,
        loanPurposes: hasPurposeFilter ? purposes : undefined,
        branches: hasBranchFilter ? branches : undefined,
      };
    }
    return undefined;
  }, [appliedFilters, filterOptions]);

  const { snapshots, loading, error, refetch } = usePipelineAnalysisData({
    from: from || null,
    to: to || null,
    tenantId: tenantId ?? null,
    startDateField,
    filters: filtersForApi,
  });

  const { data: treasury10yData, loading: treasury10yLoading, error: treasury10yError } = useTreasury10y(
    from && to ? from : null,
    from && to ? to : null
  );

  const [startYear, endYear] = useMemo(() => {
    if (!effectiveYearRange) return [null, null] as [number | null, number | null];
    const parts = effectiveYearRange.split("-").map(Number);
    return [parts[0], parts[1]];
  }, [effectiveYearRange]);

  const years = useMemo(() => {
    if (startYear != null && endYear != null) return [startYear, endYear];
    const set = new Set(snapshots.map((s) => s.year));
    return Array.from(set).sort((a, b) => a - b);
  }, [startYear, endYear, snapshots]);

  const selectedSnapshotDates = useMemo(() => {
    const out: string[] = [];
    if (viewMode !== "month" && selectedWeekValues.length > 0) {
      snapshots.forEach((row) => {
        if (years.includes(row.year) && selectedWeekValues.includes(row.week_value) && row.date) {
          const d = typeof row.date === "string" ? row.date.slice(0, 10) : format(new Date(row.date), "yyyy-MM-dd");
          out.push(d);
        }
      });
    } else if (viewMode === "month" && selectedMonths.length > 0) {
      const byYM = snapshotsToByYearMonth(snapshots);
      years.forEach((y) => {
        selectedMonths.forEach((month) => {
          const row = byYM.get(`${y}-${month}`);
          if (row?.date) {
            const d = typeof row.date === "string" ? row.date.slice(0, 10) : format(new Date(row.date), "yyyy-MM-dd");
            out.push(d);
          }
        });
      });
    }
    return out;
  }, [viewMode, selectedWeekValues, selectedMonths, years, snapshots]);

  /** Dates to show on treasury chart: respect view mode. In week mode use week snapshot dates; in month mode use first snapshot of each month (or selected months). */
  const chartDatesForTreasury = useMemo(() => {
    if (viewMode === "month") {
      if (selectedSnapshotDates.length > 0) return selectedSnapshotDates;
      const byYM = snapshotsToByYearMonth(snapshots);
      const set = new Set<string>();
      byYM.forEach((row) => {
        if (!row.date) return;
        const d = typeof row.date === "string" ? row.date.slice(0, 10) : format(new Date(row.date), "yyyy-MM-dd");
        set.add(d);
      });
      return Array.from(set).sort();
    }
    if (selectedSnapshotDates.length > 0) return selectedSnapshotDates;
    const set = new Set<string>();
    snapshots.forEach((row) => {
      if (!row.date) return;
      const d = typeof row.date === "string" ? row.date.slice(0, 10) : format(new Date(row.date), "yyyy-MM-dd");
      set.add(d);
    });
    return Array.from(set).sort();
  }, [viewMode, selectedSnapshotDates, snapshots]);

  /** Treasury chart data: only dates that are snapshot dates; yield from that date or nearest prior FRED date. */
  const treasuryChartData = useMemo(() => {
    if (!treasury10yData || treasury10yData.length === 0 || chartDatesForTreasury.length === 0) return [];
    const sorted = [...treasury10yData].sort((a, b) => a.date.localeCompare(b.date));
    const dateToYield = new Map<string, number>();
    for (const o of sorted) {
      const d = o.date.slice(0, 10);
      dateToYield.set(d, o.yield);
    }
    return chartDatesForTreasury
      .map((date) => {
        let y = dateToYield.get(date);
        if (y === undefined) {
          for (let i = sorted.length - 1; i >= 0; i--) {
            const d = sorted[i].date.slice(0, 10);
            if (d <= date) {
              y = sorted[i].yield;
              break;
            }
          }
        }
        if (y === undefined) return null;
        return { date, dateLabel: format(parseISO(date), "MMM d, yyyy"), yield: y };
      })
      .filter((row): row is { date: string; dateLabel: string; yield: number } => row != null);
  }, [treasury10yData, chartDatesForTreasury]);

  const { loans: pipelineLoans, loading: loansLoading, error: loansError } = usePipelineAnalysisLoans({
    from: from || null,
    to: to || null,
    tenantId: tenantId ?? null,
    startDateField,
    filters: filtersForApi,
    snapshotDates: selectedSnapshotDates.length > 0 ? selectedSnapshotDates : undefined,
  });

  const startDateColumnLabel =
    startDateField === "lock_date"
      ? "Lock date"
      : startDateField === "processing_date"
        ? "Processing date"
        : startDateField === "credit_pull_date"
          ? "Credit pull date"
          : startDateField === "submitted_to_underwriting_date"
            ? "Submitted to UW date"
            : "Application date";

  type LoanDetailSortKey = keyof PipelineLoanDetailRow;
  const [loanDetailSortColumn, setLoanDetailSortColumn] = useState<LoanDetailSortKey | null>(null);
  const [loanDetailSortDirection, setLoanDetailSortDirection] = useState<"asc" | "desc">("asc");

  const sortedPipelineLoans = useMemo(() => {
    if (!loanDetailSortColumn || pipelineLoans.length === 0) return pipelineLoans;
    const key = loanDetailSortColumn;
    const mult = loanDetailSortDirection === "asc" ? 1 : -1;
    const numericKeys: LoanDetailSortKey[] = ["loan_amount", "fico_score", "ltv_ratio", "be_dti_ratio"];
    const dateKeys: LoanDetailSortKey[] = ["start_date", "current_status_date"];
    return [...pipelineLoans].sort((a, b) => {
      const va = a[key];
      const vb = b[key];
      const aNull = va === null || va === undefined || (typeof va === "string" && va.trim() === "");
      const bNull = vb === null || vb === undefined || (typeof vb === "string" && vb.trim() === "");
      if (aNull && bNull) return 0;
      if (aNull) return mult * 1;
      if (bNull) return mult * -1;
      if (numericKeys.includes(key)) {
        const na = Number(va);
        const nb = Number(vb);
        if (!Number.isNaN(na) && !Number.isNaN(nb)) return mult * (na - nb);
      }
      if (dateKeys.includes(key) && typeof va === "string" && typeof vb === "string") {
        return mult * va.localeCompare(vb);
      }
      const sa = String(va).trim();
      const sb = String(vb).trim();
      return mult * sa.localeCompare(sb, undefined, { numeric: true });
    });
  }, [pipelineLoans, loanDetailSortColumn, loanDetailSortDirection]);

  const handleLoanDetailSort = useCallback((column: LoanDetailSortKey) => {
    setLoanDetailSortColumn((prev) => {
      if (prev === column) {
        setLoanDetailSortDirection((d) => (d === "asc" ? "desc" : "asc"));
        return column;
      }
      setLoanDetailSortDirection("asc");
      return column;
    });
  }, []);

  const handleApplyFilters = useCallback(() => {
    setAppliedFilters({ ...draftFilters });
    // Don't call refetch() here: it would use stale options (previous filters). The hook's
    // useEffect will run when filtersForApi changes and fetch with the new filters.
  }, [draftFilters]);

  const handleCancelFilters = useCallback(() => {
    setDraftFilters({ ...appliedFilters });
  }, [appliedFilters]);

  const toggleWeek = useCallback((w: number) => {
    setSelectedWeekValues((prev) =>
      prev.includes(w) ? prev.filter((x) => x !== w) : [...prev, w].sort((a, b) => a - b)
    );
  }, []);
  const toggleMonth = useCallback((month: number) => {
    setSelectedMonths((prev) =>
      prev.includes(month) ? prev.filter((x) => x !== month) : [...prev, month].sort((a, b) => a - b)
    );
  }, []);

  const [backfillLoading, setBackfillLoading] = useState(false);
  const [backfillMessage, setBackfillMessage] = useState<string | null>(null);

  const runBackfill = useCallback(async (newDayOfWeek?: number) => {
    if (!tenantId) return;
    setBackfillLoading(true);
    setBackfillMessage(null);
    try {
      const url = `/api/pipeline-analysis/backfill?tenant_id=${encodeURIComponent(tenantId)}`;
      const options: RequestInit = { method: "POST" };
      if (newDayOfWeek != null) {
        options.headers = { "Content-Type": "application/json" };
        options.body = JSON.stringify({ day_of_week: newDayOfWeek });
      }
      await api.request<{ success: boolean; message: string }>(url, options);
      setBackfillMessage("Recalculating…");
      await refetch();
      await refetchRange();
      await refetchConfig();
      setBackfillMessage(null);
    } catch (e: unknown) {
      setBackfillMessage(e instanceof Error ? e.message : "Backfill failed");
    } finally {
      setBackfillLoading(false);
    }
  }, [tenantId, refetch, refetchRange, refetchConfig]);

  // When range loads, set selected year range to latest if not yet set
  useEffect(() => {
    if (defaultYearRange && selectedYearRange === null) setSelectedYearRange(defaultYearRange);
  }, [defaultYearRange, selectedYearRange]);

  // Week-by-week: fixed columns 1–53 and years = [startYear, endYear] when year range is selected
  const weekValues = useMemo(
    () => (startYear != null && endYear != null ? ALL_WEEK_VALUES : Array.from(new Set(snapshots.map((s) => s.week_value))).sort((a, b) => a - b)),
    [startYear, endYear, snapshots]
  );

  const byYearWeek = useMemo(() => {
    const m = new Map<string, PipelineSnapshotRow>();
    for (const row of snapshots) {
      m.set(`${row.year}-${row.week_value}`, row);
    }
    return m;
  }, [snapshots]);

  /** Day label for column headers: from data (snapshot_weekday) or config dropdown */
  const snapshotDayLabel = useMemo(
    () => snapshots[0]?.snapshot_weekday ?? SNAPSHOT_DAY_LABELS[config?.snapshot_day_of_week ?? 1] ?? "Monday",
    [snapshots, config?.snapshot_day_of_week]
  );

  /** For percent rows: one value per week_value; use only the most recent year in the range (e.g. 2026 for 2025-2026). */
  const byWeekPct = useMemo(() => {
    const result = new Map<
      number,
      {
        weeklyVolume: number | null;
        monthlyVolume: number | null;
        annualVolume: number | null;
        weeklyUnits: number | null;
        monthlyUnits: number | null;
        annualUnits: number | null;
      }
    >();
    const mostRecentYear = endYear ?? (years.length > 0 ? Math.max(...years) : null);
    for (const w of weekValues) {
      let best: PipelineSnapshotRow | null = null;
      for (const row of snapshots) {
        if (row.week_value !== w) continue;
        if (!best || row.year > best.year) best = row;
      }
      if (best && mostRecentYear != null && best.year === mostRecentYear)
        result.set(w, {
          weeklyVolume: best.weekly_pct_change_volume,
          monthlyVolume: best.monthly_pct_change_volume,
          annualVolume: best.annual_pct_change_volume,
          weeklyUnits: best.weekly_pct_change_units,
          monthlyUnits: best.monthly_pct_change_units,
          annualUnits: best.annual_pct_change_units,
        });
    }
    return result;
  }, [snapshots, weekValues, endYear, years]);

  const byYearMonth = useMemo(() => snapshotsToByYearMonth(snapshots), [snapshots]);
  const isMonthMode = viewMode === "month";

  /** Chart data (week mode): one point per week with volume and units per year. */
  const pipelineChartDataWeek = useMemo(() => {
    if (years.length === 0 || weekValues.length === 0) return [];
    return weekValues.map((w) => {
      const point: Record<string, number | string | null> = { week: w, weekLabel: ordinal(w) };
      years.forEach((y) => {
        const row = byYearWeek.get(`${y}-${w}`);
        point[`${y} Volume`] = row?.active_volume ?? null;
        point[`${y} Units`] = row?.active_units ?? null;
      });
      return point;
    });
  }, [weekValues, years, byYearWeek]);

  /** Chart data (month mode): 12 points (Jan–Dec), each with both years' volume and units from first Monday of that month. */
  const pipelineChartDataMonth = useMemo(() => {
    if (years.length === 0) return [];
    return MONTH_LABELS.map((label, i) => {
      const month = i + 1;
      const point: Record<string, number | string | null> = { periodLabel: label, month };
      years.forEach((y) => {
        const row = byYearMonth.get(`${y}-${month}`);
        point[`${y} Volume`] = row?.active_volume ?? null;
        point[`${y} Units`] = row?.active_units ?? null;
      });
      return point;
    });
  }, [years, byYearMonth]);

  const pipelineChartData = isMonthMode ? pipelineChartDataMonth : pipelineChartDataWeek;
  const chartXKey = isMonthMode ? "periodLabel" : "weekLabel";

  /** LO Count chart data: same structure as volume/units chart but with active_lo_count and active_units per year. */
  const pipelineLoCountChartDataWeek = useMemo(() => {
    if (years.length === 0 || weekValues.length === 0) return [];
    return weekValues.map((w) => {
      const point: Record<string, number | string | null> = { week: w, weekLabel: ordinal(w) };
      years.forEach((y) => {
        const row = byYearWeek.get(`${y}-${w}`);
        point[`${y} LO Count`] = row?.active_lo_count ?? null;
        point[`${y} Units`] = row?.active_units ?? null;
      });
      return point;
    });
  }, [weekValues, years, byYearWeek]);

  const pipelineLoCountChartDataMonth = useMemo(() => {
    if (years.length === 0) return [];
    return MONTH_LABELS.map((label, i) => {
      const month = i + 1;
      const point: Record<string, number | string | null> = { periodLabel: label, month };
      years.forEach((y) => {
        const row = byYearMonth.get(`${y}-${month}`);
        point[`${y} LO Count`] = row?.active_lo_count ?? null;
        point[`${y} Units`] = row?.active_units ?? null;
      });
      return point;
    });
  }, [years, byYearMonth]);

  const pipelineLoCountChartData = isMonthMode ? pipelineLoCountChartDataMonth : pipelineLoCountChartDataWeek;

  /** For month table/chart: do we have any first-Monday data for the selected years? */
  const hasMonthData = useMemo(
    () =>
      years.length > 0 &&
      MONTH_LABELS.some((_, i) => years.some((y) => byYearMonth.has(`${y}-${i + 1}`))),
    [years, byYearMonth]
  );

  /** Percent rows for month view: one value per month from the most recent year's first-Monday snapshot. */
  const byMonthPct = useMemo(() => {
    const result = new Map<
      number,
      {
        weeklyVolume: number | null;
        monthlyVolume: number | null;
        annualVolume: number | null;
        weeklyUnits: number | null;
        monthlyUnits: number | null;
        annualUnits: number | null;
      }
    >();
    const mostRecentYear = endYear ?? (years.length > 0 ? Math.max(...years) : null);
    if (mostRecentYear == null) return result;
    for (let month = 1; month <= 12; month++) {
      const row = byYearMonth.get(`${mostRecentYear}-${month}`);
      if (row)
        result.set(month, {
          weeklyVolume: row.weekly_pct_change_volume,
          monthlyVolume: row.monthly_pct_change_volume,
          annualVolume: row.annual_pct_change_volume,
          weeklyUnits: row.weekly_pct_change_units,
          monthlyUnits: row.monthly_pct_change_units,
          annualUnits: row.annual_pct_change_units,
        });
    }
    return result;
  }, [years, endYear, byYearMonth]);

  const monthHeatmapAvgs = useMemo(() => {
    const lo: number[] = [];
    const op: number[] = [];
    years.forEach((y) => {
      for (let m = 1; m <= 12; m++) {
        const row = byYearMonth.get(`${y}-${m}`);
        if (row && row.active_lo_count > 0) lo.push(row.active_units / row.active_lo_count);
        if (row && row.active_ops_count > 0) op.push(row.active_units / row.active_ops_count);
      }
    });
    const sortedLO = [...lo].sort((a, b) => a - b);
    const sortedOP = [...op].sort((a, b) => a - b);
    const nLO = sortedLO.length;
    const nOP = sortedOP.length;
    return {
      p35LO: nLO > 0 ? sortedLO[Math.floor(0.35 * nLO)] : 0,
      p65LO: nLO > 0 ? sortedLO[Math.floor(0.65 * nLO)] : 0,
      p35OPs: nOP > 0 ? sortedOP[Math.floor(0.35 * nOP)] : 0,
      p65OPs: nOP > 0 ? sortedOP[Math.floor(0.65 * nOP)] : 0,
    };
  }, [years, byYearMonth]);

  const weekHeatmapAvgs = useMemo(() => {
    const lo: number[] = [];
    const op: number[] = [];
    years.forEach((y) => {
      weekValues.forEach((w) => {
        const row = byYearWeek.get(`${y}-${w}`);
        if (row && row.active_lo_count > 0) lo.push(row.active_units / row.active_lo_count);
        if (row && row.active_ops_count > 0) op.push(row.active_units / row.active_ops_count);
      });
    });
    const sortedLO = [...lo].sort((a, b) => a - b);
    const sortedOP = [...op].sort((a, b) => a - b);
    const nLO = sortedLO.length;
    const nOP = sortedOP.length;
    return {
      p35LO: nLO > 0 ? sortedLO[Math.floor(0.35 * nLO)] : 0,
      p65LO: nLO > 0 ? sortedLO[Math.floor(0.65 * nLO)] : 0,
      p35OPs: nOP > 0 ? sortedOP[Math.floor(0.35 * nOP)] : 0,
      p65OPs: nOP > 0 ? sortedOP[Math.floor(0.65 * nOP)] : 0,
    };
  }, [years, byYearWeek, weekValues]);

  const exportTableToCsv = useCallback(() => {
    const pctLabel = pctMetric === "volume" ? "Volume" : "Units";
    const rows: string[][] = [];
    if (isMonthMode) {
      const headers = ["Metric", ...MONTH_LABELS];
      rows.push(headers.map(escapeCsvCell));
      years.forEach((y) => {
        rows.push([`${y} Volume`, ...MONTH_LABELS.map((_, i) => (byYearMonth.get(`${y}-${i + 1}`)?.active_volume != null ? formatVolume(byYearMonth.get(`${y}-${i + 1}`)!.active_volume) : "-"))].map(escapeCsvCell));
        rows.push([`${y} Units`, ...MONTH_LABELS.map((_, i) => (byYearMonth.get(`${y}-${i + 1}`)?.active_units != null ? String(byYearMonth.get(`${y}-${i + 1}`)!.active_units) : "-"))].map(escapeCsvCell));
      });
      rows.push(["Weekly Increase/Decrease (" + pctLabel + ")", ...MONTH_LABELS.map((_, i) => formatPct(byMonthPct.get(i + 1)?.[pctMetric === "volume" ? "weeklyVolume" : "weeklyUnits"] ?? null))].map(escapeCsvCell));
      rows.push(["Monthly Increase/Decrease (" + pctLabel + ")", ...MONTH_LABELS.map((_, i) => formatPct(byMonthPct.get(i + 1)?.[pctMetric === "volume" ? "monthlyVolume" : "monthlyUnits"] ?? null))].map(escapeCsvCell));
      rows.push(["Annual Increase/Decrease (" + pctLabel + ")", ...MONTH_LABELS.map((_, i) => formatPct(byMonthPct.get(i + 1)?.[pctMetric === "volume" ? "annualVolume" : "annualUnits"] ?? null))].map(escapeCsvCell));
      years.forEach((y) => {
        rows.push([`${y} LO Count`, ...MONTH_LABELS.map((_, i) => (byYearMonth.get(`${y}-${i + 1}`)?.active_lo_count != null ? String(byYearMonth.get(`${y}-${i + 1}`)!.active_lo_count) : "-"))].map(escapeCsvCell));
        rows.push([`${y} OPs Count`, ...MONTH_LABELS.map((_, i) => (byYearMonth.get(`${y}-${i + 1}`)?.active_ops_count != null ? String(byYearMonth.get(`${y}-${i + 1}`)!.active_ops_count) : "-"))].map(escapeCsvCell));
      });
      years.forEach((y) => {
        const loRow = [`${y} Units per LO`, ...MONTH_LABELS.map((_, i) => {
          const row = byYearMonth.get(`${y}-${i + 1}`);
          return row && row.active_lo_count > 0 ? formatUnitsPerActor(row.active_units, row.active_lo_count) : "-";
        })];
        rows.push(loRow.map(escapeCsvCell));
        const opRow = [`${y} Units per OPs`, ...MONTH_LABELS.map((_, i) => {
          const row = byYearMonth.get(`${y}-${i + 1}`);
          return row && row.active_ops_count > 0 ? formatUnitsPerActor(row.active_units, row.active_ops_count) : "-";
        })];
        rows.push(opRow.map(escapeCsvCell));
      });
    } else {
      const colLabels = weekValues.map((w) => `${ordinal(w)} ${snapshotDayLabel}`);
      const headers = ["Metric", ...colLabels];
      rows.push(headers.map(escapeCsvCell));
      years.forEach((y) => {
        rows.push([`${y} Volume`, ...weekValues.map((w) => (byYearWeek.get(`${y}-${w}`)?.active_volume != null ? formatVolume(byYearWeek.get(`${y}-${w}`)!.active_volume) : "-"))].map(escapeCsvCell));
        rows.push([`${y} Units`, ...weekValues.map((w) => (byYearWeek.get(`${y}-${w}`)?.active_units != null ? String(byYearWeek.get(`${y}-${w}`)!.active_units) : "-"))].map(escapeCsvCell));
      });
      rows.push(["Weekly Increase/Decrease (" + pctLabel + ")", ...weekValues.map((w) => formatPct(byWeekPct.get(w)?.[pctMetric === "volume" ? "weeklyVolume" : "weeklyUnits"] ?? null))].map(escapeCsvCell));
      rows.push(["Monthly Increase/Decrease (" + pctLabel + ")", ...weekValues.map((w) => formatPct(byWeekPct.get(w)?.[pctMetric === "volume" ? "monthlyVolume" : "monthlyUnits"] ?? null))].map(escapeCsvCell));
      rows.push(["Annual Increase/Decrease (" + pctLabel + ")", ...weekValues.map((w) => formatPct(byWeekPct.get(w)?.[pctMetric === "volume" ? "annualVolume" : "annualUnits"] ?? null))].map(escapeCsvCell));
      years.forEach((y) => {
        rows.push([`${y} LO Count`, ...weekValues.map((w) => (byYearWeek.get(`${y}-${w}`)?.active_lo_count != null ? String(byYearWeek.get(`${y}-${w}`)!.active_lo_count) : "-"))].map(escapeCsvCell));
        rows.push([`${y} OPs Count`, ...weekValues.map((w) => (byYearWeek.get(`${y}-${w}`)?.active_ops_count != null ? String(byYearWeek.get(`${y}-${w}`)!.active_ops_count) : "-"))].map(escapeCsvCell));
      });
      years.forEach((y) => {
        const loRow = [`${y} Units per LO`, ...weekValues.map((w) => {
          const row = byYearWeek.get(`${y}-${w}`);
          return row && row.active_lo_count > 0 ? formatUnitsPerActor(row.active_units, row.active_lo_count) : "-";
        })];
        rows.push(loRow.map(escapeCsvCell));
        const opRow = [`${y} Units per OPs`, ...weekValues.map((w) => {
          const row = byYearWeek.get(`${y}-${w}`);
          return row && row.active_ops_count > 0 ? formatUnitsPerActor(row.active_units, row.active_ops_count) : "-";
        })];
        rows.push(opRow.map(escapeCsvCell));
      });
    }
    const csv = rows.map((row) => row.join(",")).join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `pipeline-analysis-table-${new Date().toISOString().split("T")[0]}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  }, [isMonthMode, pctMetric, years, weekValues, byYearWeek, byYearMonth, byWeekPct, byMonthPct, snapshotDayLabel]);

  const exportLoanDetailToCsv = useCallback(() => {
    const headers = [
      "Loan #",
      "Loan amount",
      "Loan type",
      "Loan purpose",
      "Current loan status",
      startDateColumnLabel,
      "Current status date",
      "FICO score",
      "LTV ratio",
      "BE DTI ratio",
      "Loan officer",
      "Processor",
      "Underwriter",
      "Closer",
    ];
    const rows = sortedPipelineLoans.map((loan) => [
      loan.loan_number ?? "",
      loan.loan_amount != null ? formatVolume(loan.loan_amount) : "",
      loan.loan_type ?? "",
      loan.loan_purpose ?? "",
      loan.current_loan_status ?? "",
      loan.start_date ? format(parseISO(loan.start_date), "yyyy-MM-dd") : "",
      loan.current_status_date ? format(parseISO(loan.current_status_date), "yyyy-MM-dd") : "",
      loan.fico_score != null ? String(loan.fico_score) : "",
      loan.ltv_ratio != null ? String(loan.ltv_ratio) : "",
      loan.be_dti_ratio != null ? String(loan.be_dti_ratio) : "",
      loan.loan_officer ?? "",
      loan.processor ?? "",
      loan.underwriter ?? "",
      loan.closer ?? "",
    ]);
    const csv = [headers.map(escapeCsvCell).join(","), ...rows.map((row) => row.map(escapeCsvCell).join(","))].join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `pipeline-loan-detail-${new Date().toISOString().split("T")[0]}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  }, [sortedPipelineLoans, startDateColumnLabel]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">
            {startDateField === "lock_date"
              ? "Locked Pipeline Analysis"
              : startDateField === "processing_date"
                ? "Processing Pipeline Analysis"
                : startDateField === "credit_pull_date"
                  ? "Credit Pull Pipeline Analysis"
                  : startDateField === "submitted_to_underwriting_date"
                    ? "Submitted to UW Pipeline Analysis"
                    : "Active Pipeline Analysis"}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-muted-foreground whitespace-nowrap">
                Snapshot day
              </label>
              <Select
                value={String(config?.snapshot_day_of_week ?? 1)}
                onValueChange={(v) => {
                  const d = parseInt(v, 10);
                  if (tenantId && d >= 1 && d <= 5) runBackfill(d);
                }}
                disabled={configLoading || backfillLoading || !tenantId}
              >
                <SelectTrigger className="w-[140px]">
                  <SelectValue placeholder="Day" />
                </SelectTrigger>
                <SelectContent>
                  {[1, 2, 3, 4, 5].map((d) => (
                    <SelectItem key={d} value={String(d)}>
                      {SNAPSHOT_DAY_LABELS[d]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-muted-foreground whitespace-nowrap">
                Year range
              </label>
              <Select
                value={effectiveYearRange ?? ""}
                onValueChange={(v) => setSelectedYearRange(v || null)}
                disabled={rangeLoading || yearRangeOptions.length === 0}
              >
                <SelectTrigger className="w-[160px]">
                  <SelectValue placeholder="Select range" />
                </SelectTrigger>
                <SelectContent>
                  {yearRangeOptions.map((opt) => (
                    <SelectItem key={opt} value={opt}>
                      {opt}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-muted-foreground whitespace-nowrap">
                Start date
              </label>
              <Select
                value={startDateField}
                onValueChange={(v) => setStartDateField(v as "application_date" | "lock_date" | "processing_date" | "credit_pull_date" | "submitted_to_underwriting_date")}
                disabled={loading || backfillLoading}
              >
                <SelectTrigger className="w-[180px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="application_date">Application date</SelectItem>
                  <SelectItem value="lock_date">Lock date</SelectItem>
                  <SelectItem value="processing_date">Processing date</SelectItem>
                  <SelectItem value="credit_pull_date">Credit pull date</SelectItem>
                  <SelectItem value="submitted_to_underwriting_date">Submitted to underwriting date</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-muted-foreground whitespace-nowrap">View</label>
              <Select value={viewMode} onValueChange={(v) => setViewMode(v as PipelineViewMode)}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="week">Week by week</SelectItem>
                  <SelectItem value="month">Month by month</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-muted-foreground whitespace-nowrap">
                Percent changes by
              </label>
              <Select value={pctMetric} onValueChange={(v) => setPctMetric(v as PipelinePctMetric)}>
                <SelectTrigger className="w-[120px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="volume">Volume</SelectItem>
                  <SelectItem value="units">Units</SelectItem>
                </SelectContent>
              </Select>
              {viewMode === "week" && selectedWeekValues.length > 0 && (
                <span className="inline-flex items-center gap-1 rounded-md bg-sky-100 dark:bg-sky-900/40 px-2 py-0.5 text-xs">
                  {selectedWeekValues.sort((a, b) => a - b).map((w) => ordinal(w)).join(", ")}
                  <button
                    type="button"
                    onClick={() => setSelectedWeekValues([])}
                    className="p-0.5 rounded hover:bg-sky-200 dark:hover:bg-sky-800"
                    aria-label="Clear week filter"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              )}
              {viewMode === "month" && selectedMonths.length > 0 && (
                <span className="inline-flex items-center gap-1 rounded-md bg-sky-100 dark:bg-sky-900/40 px-2 py-0.5 text-xs">
                  {selectedMonths.sort((a, b) => a - b).map((m) => MONTH_LABELS[m - 1]).join(", ")}
                  <button
                    type="button"
                    onClick={() => setSelectedMonths([])}
                    className="p-0.5 rounded hover:bg-sky-200 dark:hover:bg-sky-800"
                    aria-label="Clear month filter"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              )}
            </div>
          </div>

          {/* Filter row: loan type, loan purpose, branch (multi-select with Apply/Cancel) */}
          <div className="flex flex-wrap items-center gap-3 pt-1 border-t border-border/60">
            <span className="text-sm font-medium text-muted-foreground">Filters:</span>
            {loading && (
              <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Applying…
              </span>
            )}
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="min-w-[160px] justify-between"
                  disabled={filterOptionsLoading || !tenantId || loading}
                >
                  <span className="truncate">
                    Loan type{(draftFilters.loanTypes.length === 0 || draftFilters.loanTypes.length === (filterOptions?.loanTypes?.length ?? 0)) ? " (All)" : ` (${draftFilters.loanTypes.length} selected)`}
                  </span>
                  <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-64 p-2" align="start">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setDraftFilters((d) => ({ ...d, loanTypes: [] }))}>
                    Select all
                  </Button>
                  <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setDraftFilters((d) => ({ ...d, loanTypes: filterOptions?.loanTypes ?? [] }))}>
                    Deselect all
                  </Button>
                </div>
                <div className="max-h-48 overflow-y-auto space-y-1.5">
                  {(filterOptions?.loanTypes ?? []).map((opt) => {
                    const allOptions = filterOptions?.loanTypes ?? [];
                    const noneSelected = allOptions.length > 0 && draftFilters.loanTypes.length === allOptions.length;
                    const checked = draftFilters.loanTypes.length === 0 ? true : (noneSelected ? false : draftFilters.loanTypes.includes(opt));
                    return (
                      <label key={opt} className="flex items-center gap-2 cursor-pointer rounded px-1.5 py-1 hover:bg-muted/60 text-sm">
                        <Checkbox
                          checked={checked}
                          onCheckedChange={() => {
                            setDraftFilters((d) => {
                              if (d.loanTypes.length === 0) return { ...d, loanTypes: (filterOptions?.loanTypes ?? []).filter((x) => x !== opt) };
                              if (d.loanTypes.length === allOptions.length) return { ...d, loanTypes: [opt] };
                              if (d.loanTypes.includes(opt)) return { ...d, loanTypes: d.loanTypes.filter((x) => x !== opt) };
                              return { ...d, loanTypes: [...d.loanTypes, opt] };
                            });
                          }}
                        />
                        <span className="truncate">{opt}</span>
                      </label>
                    );
                  })}
                </div>
              </PopoverContent>
            </Popover>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="min-w-[160px] justify-between"
                  disabled={filterOptionsLoading || !tenantId || loading}
                >
                  <span className="truncate">
                    Loan purpose{(draftFilters.loanPurposes.length === 0 || draftFilters.loanPurposes.length === (filterOptions?.loanPurposes?.length ?? 0)) ? " (All)" : ` (${draftFilters.loanPurposes.length} selected)`}
                  </span>
                  <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-64 p-2" align="start">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setDraftFilters((d) => ({ ...d, loanPurposes: [] }))}>
                    Select all
                  </Button>
                  <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setDraftFilters((d) => ({ ...d, loanPurposes: filterOptions?.loanPurposes ?? [] }))}>
                    Deselect all
                  </Button>
                </div>
                <div className="max-h-48 overflow-y-auto space-y-1.5">
                  {(filterOptions?.loanPurposes ?? []).map((opt) => {
                    const allOptions = filterOptions?.loanPurposes ?? [];
                    const noneSelected = allOptions.length > 0 && draftFilters.loanPurposes.length === allOptions.length;
                    const checked = draftFilters.loanPurposes.length === 0 ? true : (noneSelected ? false : draftFilters.loanPurposes.includes(opt));
                    return (
                      <label key={opt} className="flex items-center gap-2 cursor-pointer rounded px-1.5 py-1 hover:bg-muted/60 text-sm">
                        <Checkbox
                          checked={checked}
                          onCheckedChange={() => {
                            setDraftFilters((d) => {
                              if (d.loanPurposes.length === 0) return { ...d, loanPurposes: (filterOptions?.loanPurposes ?? []).filter((x) => x !== opt) };
                              if (d.loanPurposes.length === allOptions.length) return { ...d, loanPurposes: [opt] };
                              if (d.loanPurposes.includes(opt)) return { ...d, loanPurposes: d.loanPurposes.filter((x) => x !== opt) };
                              return { ...d, loanPurposes: [...d.loanPurposes, opt] };
                            });
                          }}
                        />
                        <span className="truncate">{opt}</span>
                      </label>
                    );
                  })}
                </div>
              </PopoverContent>
            </Popover>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="min-w-[160px] justify-between"
                  disabled={filterOptionsLoading || !tenantId || loading}
                >
                  <span className="truncate">
                    Branch{(draftFilters.branches.length === 0 || draftFilters.branches.length === (filterOptions?.branches?.length ?? 0)) ? " (All)" : ` (${draftFilters.branches.length} selected)`}
                  </span>
                  <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-64 p-2" align="start">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setDraftFilters((d) => ({ ...d, branches: [] }))}>
                    Select all
                  </Button>
                  <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setDraftFilters((d) => ({ ...d, branches: filterOptions?.branches ?? [] }))}>
                    Deselect all
                  </Button>
                </div>
                <div className="max-h-48 overflow-y-auto space-y-1.5">
                  {(filterOptions?.branches ?? []).map((opt) => {
                    const allOptions = filterOptions?.branches ?? [];
                    const noneSelected = allOptions.length > 0 && draftFilters.branches.length === allOptions.length;
                    const checked = draftFilters.branches.length === 0 ? true : (noneSelected ? false : draftFilters.branches.includes(opt));
                    return (
                      <label key={opt} className="flex items-center gap-2 cursor-pointer rounded px-1.5 py-1 hover:bg-muted/60 text-sm">
                        <Checkbox
                          checked={checked}
                          onCheckedChange={() => {
                            setDraftFilters((d) => {
                              if (d.branches.length === 0) return { ...d, branches: (filterOptions?.branches ?? []).filter((x) => x !== opt) };
                              if (d.branches.length === allOptions.length) return { ...d, branches: [opt] };
                              if (d.branches.includes(opt)) return { ...d, branches: d.branches.filter((x) => x !== opt) };
                              return { ...d, branches: [...d.branches, opt] };
                            });
                          }}
                        />
                        <span className="truncate">{opt}</span>
                      </label>
                    );
                  })}
                </div>
              </PopoverContent>
            </Popover>
            <div className="flex items-center gap-2 ml-2">
              <Button variant="outline" size="sm" onClick={handleCancelFilters} disabled={loading}>
                Cancel
              </Button>
              <Button size="sm" onClick={handleApplyFilters} disabled={loading}>
                Apply
              </Button>
            </div>
          </div>

          {backfillMessage && (
            <div className="rounded-md bg-muted text-muted-foreground text-sm p-3">
              {backfillMessage}
            </div>
          )}

          {error && (
            <div className="rounded-md bg-destructive/10 text-destructive text-sm p-3">
              {error}
            </div>
          )}

          {(loading || backfillLoading || rangeLoading || configLoading) && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          )}

          {!loading && !backfillLoading && !rangeLoading && !configLoading && !error && (isMonthMode ? !hasMonthData && years.length === 0 : snapshots.length === 0 && years.length === 0) && (
            <div className="text-muted-foreground text-sm py-8 text-center">
              No pipeline snapshot data in the selected range.
              {tenantId && " Backfill will run automatically, or try adjusting the date range."}
            </div>
          )}

          <Tabs value={dataViewTab} onValueChange={(v) => setDataViewTab(v as "table" | "chart" | "loCountChart" | "treasury10y")} className="w-full">
            <div className="flex items-center justify-between gap-4 mt-2">
              <TabsList className={cn("bg-muted p-0.5 rounded-lg")}>
                <TabsTrigger value="table" className="rounded-md gap-1.5">
                  <Table2 className="h-3.5 w-3.5" />
                  Table
                </TabsTrigger>
                <TabsTrigger value="chart" className="rounded-md gap-1.5">
                  <BarChart3 className="h-3.5 w-3.5" />
                  Units & Volume Chart
                </TabsTrigger>
                <TabsTrigger value="loCountChart" className="rounded-md gap-1.5">
                  <BarChart3 className="h-3.5 w-3.5" />
                  LO Count Chart
                </TabsTrigger>
                <TabsTrigger value="treasury10y" className="rounded-md gap-1.5">
                  <TrendingUp className="h-3.5 w-3.5" />
                  10-Yr Treasury
                </TabsTrigger>
              </TabsList>
              {dataViewTab === "table" && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={exportTableToCsv}
                  disabled={loading || (isMonthMode ? !hasMonthData : (snapshots.length === 0 || years.length === 0))}
                  className="gap-1.5 shrink-0"
                >
                  <Download className="h-3.5 w-3.5" />
                  Export
                </Button>
              )}
            </div>

            <TabsContent value="table" className="mt-3">
          {!loading && !backfillLoading && !error && isMonthMode && years.length > 0 && (
            <div className="overflow-x-auto border rounded-md">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[120px] sticky left-0 bg-background z-10 font-semibold" />
                    {MONTH_LABELS.map((label, i) => {
                      const month = i + 1;
                      return (
                        <TableHead
                          key={label}
                          className={cn(
                            "text-right whitespace-nowrap cursor-pointer select-none",
                            selectedMonths.includes(month) && "bg-sky-100 dark:bg-sky-900/40"
                          )}
                          onClick={() => toggleMonth(month)}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => e.key === "Enter" && toggleMonth(month)}
                        >
                          {label}
                        </TableHead>
                      );
                    })}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {years.map((year) => (
                    <TableRow key={`vol-${year}`}>
                      <TableCell className="font-medium sticky left-0 bg-background z-10">{year} Volume</TableCell>
                      {MONTH_LABELS.map((_, i) => {
                        const month = i + 1;
                        const row = byYearMonth.get(`${year}-${month}`);
                        return (
                          <TableCell
                            key={`${year}-${month}`}
                            className={cn(
                              "text-right cursor-pointer",
                              selectedMonths.includes(month) && "bg-sky-100 dark:bg-sky-900/40"
                            )}
                            onClick={() => toggleMonth(month)}
                            role="button"
                            tabIndex={0}
                            onKeyDown={(e) => e.key === "Enter" && toggleMonth(month)}
                          >
                            {row != null ? formatVolume(row.active_volume) : "-"}
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  ))}
                  {years.map((year) => (
                    <TableRow key={`units-${year}`}>
                      <TableCell className="font-medium sticky left-0 bg-background z-10">{year} Units</TableCell>
                      {MONTH_LABELS.map((_, i) => {
                        const month = i + 1;
                        const row = byYearMonth.get(`${year}-${month}`);
                        return (
                          <TableCell
                            key={`${year}-${month}`}
                            className={cn(
                              "text-right cursor-pointer",
                              selectedMonths.includes(month) && "bg-sky-100 dark:bg-sky-900/40"
                            )}
                            onClick={() => toggleMonth(month)}
                            role="button"
                            tabIndex={0}
                            onKeyDown={(e) => e.key === "Enter" && toggleMonth(month)}
                          >
                            {row != null ? row.active_units : "-"}
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  ))}
                  <TableRow>
                    <TableCell className="font-medium sticky left-0 bg-background z-10 text-muted-foreground">
                      Weekly Increase/Decrease ({pctMetric === "volume" ? "Volume" : "Units"})
                    </TableCell>
                    {MONTH_LABELS.map((_, i) => {
                      const month = i + 1;
                      const p = byMonthPct.get(month);
                      const val = pctMetric === "volume" ? p?.weeklyVolume : p?.weeklyUnits;
                      return (
                        <TableCell
                          key={`w-${month}`}
                          className={cn(
                            "text-right cursor-pointer",
                            selectedMonths.includes(month) && "bg-sky-100 dark:bg-sky-900/40"
                          )}
                          onClick={() => toggleMonth(month)}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => e.key === "Enter" && toggleMonth(month)}
                        >
                          {val != null ? formatPct(val) : "-"}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-medium sticky left-0 bg-background z-10 text-muted-foreground">
                      Monthly Increase/Decrease ({pctMetric === "volume" ? "Volume" : "Units"})
                    </TableCell>
                    {MONTH_LABELS.map((_, i) => {
                      const month = i + 1;
                      const p = byMonthPct.get(month);
                      const val = pctMetric === "volume" ? p?.monthlyVolume : p?.monthlyUnits;
                      return (
                        <TableCell
                          key={`m-${month}`}
                          className={cn(
                            "text-right cursor-pointer",
                            selectedMonths.includes(month) && "bg-sky-100 dark:bg-sky-900/40"
                          )}
                          onClick={() => toggleMonth(month)}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => e.key === "Enter" && toggleMonth(month)}
                        >
                          {val != null ? formatPct(val) : "-"}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-medium sticky left-0 bg-background z-10 text-muted-foreground">
                      Annual Increase/Decrease ({pctMetric === "volume" ? "Volume" : "Units"})
                    </TableCell>
                    {MONTH_LABELS.map((_, i) => {
                      const month = i + 1;
                      const p = byMonthPct.get(month);
                      const val = pctMetric === "volume" ? p?.annualVolume : p?.annualUnits;
                      return (
                        <TableCell
                          key={`a-${month}`}
                          className={cn(
                            "text-right cursor-pointer",
                            selectedMonths.includes(month) && "bg-sky-100 dark:bg-sky-900/40"
                          )}
                          onClick={() => toggleMonth(month)}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => e.key === "Enter" && toggleMonth(month)}
                        >
                          {val != null ? formatPct(val) : "-"}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                  {years.map((year) => (
                    <TableRow key={`lo-${year}`}>
                      <TableCell className="font-medium sticky left-0 bg-background z-10">{year} LO Count</TableCell>
                      {MONTH_LABELS.map((_, i) => {
                        const month = i + 1;
                        const row = byYearMonth.get(`${year}-${month}`);
                        return (
                          <TableCell
                            key={`${year}-${month}`}
                            className={cn(
                              "text-right cursor-pointer",
                              selectedMonths.includes(month) && "bg-sky-100 dark:bg-sky-900/40"
                            )}
                            onClick={() => toggleMonth(month)}
                            role="button"
                            tabIndex={0}
                            onKeyDown={(e) => e.key === "Enter" && toggleMonth(month)}
                          >
                            {row != null ? row.active_lo_count : "-"}
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  ))}
                  {years.map((year) => (
                    <TableRow key={`ops-${year}`}>
                      <TableCell className="font-medium sticky left-0 bg-background z-10">{year} OPs Count</TableCell>
                      {MONTH_LABELS.map((_, i) => {
                        const month = i + 1;
                        const row = byYearMonth.get(`${year}-${month}`);
                        return (
                          <TableCell
                            key={`${year}-${month}`}
                            className={cn(
                              "text-right cursor-pointer",
                              selectedMonths.includes(month) && "bg-sky-100 dark:bg-sky-900/40"
                            )}
                            onClick={() => toggleMonth(month)}
                            role="button"
                            tabIndex={0}
                            onKeyDown={(e) => e.key === "Enter" && toggleMonth(month)}
                          >
                            {row != null ? row.active_ops_count : "-"}
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  ))}
                  {years.map((year) => (
                    <TableRow key={`uplo-${year}`}>
                      <TableCell className="font-medium sticky left-0 bg-background z-10 text-muted-foreground">{year} Units per LO</TableCell>
                      {MONTH_LABELS.map((_, i) => {
                        const month = i + 1;
                        const row = byYearMonth.get(`${year}-${month}`);
                        const val = row && row.active_lo_count > 0 ? row.active_units / row.active_lo_count : null;
                        return (
                          <TableCell
                            key={`${year}-${month}`}
                            className={cn(
                              "text-right cursor-pointer",
                              heatmapClass(val, monthHeatmapAvgs.p35LO, monthHeatmapAvgs.p65LO),
                              selectedMonths.includes(month) && "bg-sky-100 dark:bg-sky-900/40"
                            )}
                            onClick={() => toggleMonth(month)}
                            role="button"
                            tabIndex={0}
                            onKeyDown={(e) => e.key === "Enter" && toggleMonth(month)}
                          >
                            {row != null ? formatUnitsPerActor(row.active_units, row.active_lo_count) : "-"}
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  ))}
                  {years.map((year) => (
                    <TableRow key={`upops-${year}`}>
                      <TableCell className="font-medium sticky left-0 bg-background z-10 text-muted-foreground">{year} Units per OPs</TableCell>
                      {MONTH_LABELS.map((_, i) => {
                        const month = i + 1;
                        const row = byYearMonth.get(`${year}-${month}`);
                        const val = row && row.active_ops_count > 0 ? row.active_units / row.active_ops_count : null;
                        return (
                          <TableCell
                            key={`${year}-${month}`}
                            className={cn(
                              "text-right cursor-pointer",
                              heatmapClass(val, monthHeatmapAvgs.p35OPs, monthHeatmapAvgs.p65OPs),
                              selectedMonths.includes(month) && "bg-sky-100 dark:bg-sky-900/40"
                            )}
                            onClick={() => toggleMonth(month)}
                            role="button"
                            tabIndex={0}
                            onKeyDown={(e) => e.key === "Enter" && toggleMonth(month)}
                          >
                            {row != null ? formatUnitsPerActor(row.active_units, row.active_ops_count) : "-"}
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {!loading && !backfillLoading && !rangeLoading && !error && !isMonthMode && weekValues.length > 0 && years.length > 0 && (
            <div className="overflow-x-auto border rounded-md">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[120px] sticky left-0 bg-background z-10 font-semibold" />
                    {weekValues.map((w) => (
                      <TableHead
                        key={w}
                        className={cn(
                          "text-right whitespace-nowrap cursor-pointer select-none",
                          selectedWeekValues.includes(w) && "bg-sky-100 dark:bg-sky-900/40"
                        )}
                        onClick={() => toggleWeek(w)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => e.key === "Enter" && toggleWeek(w)}
                      >
                        {ordinal(w)} {snapshotDayLabel}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {years.map((year) => (
                    <TableRow key={`vol-${year}`}>
                      <TableCell className="font-medium sticky left-0 bg-background z-10">{year} Volume</TableCell>
                      {weekValues.map((w) => {
                        const row = byYearWeek.get(`${year}-${w}`);
                        return (
                          <TableCell
                            key={`${year}-${w}`}
                            className={cn(
                              "text-right cursor-pointer",
                              selectedWeekValues.includes(w) && "bg-sky-100 dark:bg-sky-900/40"
                            )}
                            onClick={() => toggleWeek(w)}
                            role="button"
                            tabIndex={0}
                            onKeyDown={(e) => e.key === "Enter" && toggleWeek(w)}
                          >
                            {row != null ? formatVolume(row.active_volume) : "-"}
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  ))}
                  {years.map((year) => (
                    <TableRow key={`units-${year}`}>
                      <TableCell className="font-medium sticky left-0 bg-background z-10">{year} Units</TableCell>
                      {weekValues.map((w) => {
                        const row = byYearWeek.get(`${year}-${w}`);
                        return (
                          <TableCell
                            key={`${year}-${w}`}
                            className={cn(
                              "text-right cursor-pointer",
                              selectedWeekValues.includes(w) && "bg-sky-100 dark:bg-sky-900/40"
                            )}
                            onClick={() => toggleWeek(w)}
                            role="button"
                            tabIndex={0}
                            onKeyDown={(e) => e.key === "Enter" && toggleWeek(w)}
                          >
                            {row != null ? row.active_units : "-"}
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  ))}
                  <TableRow>
                    <TableCell className="font-medium sticky left-0 bg-background z-10 text-muted-foreground">
                      Weekly Increase/Decrease ({pctMetric === "volume" ? "Volume" : "Units"})
                    </TableCell>
                    {weekValues.map((w) => {
                      const p = byWeekPct.get(w);
                      const val = pctMetric === "volume" ? p?.weeklyVolume : p?.weeklyUnits;
                      return (
                        <TableCell
                          key={`w-${w}`}
                          className={cn(
                            "text-right cursor-pointer",
                            selectedWeekValues.includes(w) && "bg-sky-100 dark:bg-sky-900/40"
                          )}
                          onClick={() => toggleWeek(w)}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => e.key === "Enter" && toggleWeek(w)}
                        >
                          {val != null ? formatPct(val) : "-"}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-medium sticky left-0 bg-background z-10 text-muted-foreground">
                      Monthly Increase/Decrease ({pctMetric === "volume" ? "Volume" : "Units"})
                    </TableCell>
                    {weekValues.map((w) => {
                      const p = byWeekPct.get(w);
                      const val = pctMetric === "volume" ? p?.monthlyVolume : p?.monthlyUnits;
                      return (
                        <TableCell
                          key={`m-${w}`}
                          className={cn(
                            "text-right cursor-pointer",
                            selectedWeekValues.includes(w) && "bg-sky-100 dark:bg-sky-900/40"
                          )}
                          onClick={() => toggleWeek(w)}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => e.key === "Enter" && toggleWeek(w)}
                        >
                          {val != null ? formatPct(val) : "-"}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-medium sticky left-0 bg-background z-10 text-muted-foreground">
                      Annual Increase/Decrease ({pctMetric === "volume" ? "Volume" : "Units"})
                    </TableCell>
                    {weekValues.map((w) => {
                      const p = byWeekPct.get(w);
                      const val = pctMetric === "volume" ? p?.annualVolume : p?.annualUnits;
                      return (
                        <TableCell
                          key={`a-${w}`}
                          className={cn(
                            "text-right cursor-pointer",
                            selectedWeekValues.includes(w) && "bg-sky-100 dark:bg-sky-900/40"
                          )}
                          onClick={() => toggleWeek(w)}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => e.key === "Enter" && toggleWeek(w)}
                        >
                          {val != null ? formatPct(val) : "-"}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                  {years.map((year) => (
                    <TableRow key={`lo-${year}`}>
                      <TableCell className="font-medium sticky left-0 bg-background z-10">{year} LO Count</TableCell>
                      {weekValues.map((w) => {
                        const row = byYearWeek.get(`${year}-${w}`);
                        return (
                          <TableCell
                            key={`${year}-${w}`}
                            className={cn(
                              "text-right cursor-pointer",
                              selectedWeekValues.includes(w) && "bg-sky-100 dark:bg-sky-900/40"
                            )}
                            onClick={() => toggleWeek(w)}
                            role="button"
                            tabIndex={0}
                            onKeyDown={(e) => e.key === "Enter" && toggleWeek(w)}
                          >
                            {row != null ? row.active_lo_count : "-"}
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  ))}
                  {years.map((year) => (
                    <TableRow key={`ops-${year}`}>
                      <TableCell className="font-medium sticky left-0 bg-background z-10">{year} OPs Count</TableCell>
                      {weekValues.map((w) => {
                        const row = byYearWeek.get(`${year}-${w}`);
                        return (
                          <TableCell
                            key={`${year}-${w}`}
                            className={cn(
                              "text-right cursor-pointer",
                              selectedWeekValues.includes(w) && "bg-sky-100 dark:bg-sky-900/40"
                            )}
                            onClick={() => toggleWeek(w)}
                            role="button"
                            tabIndex={0}
                            onKeyDown={(e) => e.key === "Enter" && toggleWeek(w)}
                          >
                            {row != null ? row.active_ops_count : "-"}
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  ))}
                  {years.map((year) => (
                    <TableRow key={`uplo-${year}`}>
                      <TableCell className="font-medium sticky left-0 bg-background z-10 text-muted-foreground">{year} Units per LO</TableCell>
                      {weekValues.map((w) => {
                        const row = byYearWeek.get(`${year}-${w}`);
                        const val = row && row.active_lo_count > 0 ? row.active_units / row.active_lo_count : null;
                        return (
                          <TableCell
                            key={`${year}-${w}`}
                            className={cn(
                              "text-right cursor-pointer",
                              heatmapClass(val, weekHeatmapAvgs.p35LO, weekHeatmapAvgs.p65LO),
                              selectedWeekValues.includes(w) && "bg-sky-100 dark:bg-sky-900/40"
                            )}
                            onClick={() => toggleWeek(w)}
                            role="button"
                            tabIndex={0}
                            onKeyDown={(e) => e.key === "Enter" && toggleWeek(w)}
                          >
                            {row != null ? formatUnitsPerActor(row.active_units, row.active_lo_count) : "-"}
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  ))}
                  {years.map((year) => (
                    <TableRow key={`upops-${year}`}>
                      <TableCell className="font-medium sticky left-0 bg-background z-10 text-muted-foreground">{year} Units per OPs</TableCell>
                      {weekValues.map((w) => {
                        const row = byYearWeek.get(`${year}-${w}`);
                        const val = row && row.active_ops_count > 0 ? row.active_units / row.active_ops_count : null;
                        return (
                          <TableCell
                            key={`${year}-${w}`}
                            className={cn(
                              "text-right cursor-pointer",
                              heatmapClass(val, weekHeatmapAvgs.p35OPs, weekHeatmapAvgs.p65OPs),
                              selectedWeekValues.includes(w) && "bg-sky-100 dark:bg-sky-900/40"
                            )}
                            onClick={() => toggleWeek(w)}
                            role="button"
                            tabIndex={0}
                            onKeyDown={(e) => e.key === "Enter" && toggleWeek(w)}
                          >
                            {row != null ? formatUnitsPerActor(row.active_units, row.active_ops_count) : "-"}
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
            </TabsContent>

            <TabsContent value="chart" className="mt-3">
              {!loading && !backfillLoading && !rangeLoading && !error && pipelineChartData.length > 0 && years.length >= 1 && (
                <div className="rounded-md border bg-card p-4" style={{ minHeight: 440 }}>
                  <p className="text-sm font-medium text-foreground mb-3">Total Pipeline Volume &amp; Units</p>
                  <ResponsiveContainer width="100%" height={420}>
                    <ComposedChart
                      data={pipelineChartData}
                      margin={{ top: 12, right: 12, left: 12, bottom: 12 }}
                      barCategoryGap="20%"
                      barGap={2}
                      onClick={(data: { activeTooltipIndex?: number }) => {
                        const idx = data?.activeTooltipIndex;
                        if (idx != null && pipelineChartData[idx]) {
                          const p = pipelineChartData[idx] as { week?: number; month?: number };
                          if (p.week != null) toggleWeek(p.week);
                          if (p.month != null) toggleMonth(p.month);
                        }
                      }}
                      style={{ cursor: "pointer" }}
                    >
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
                      <XAxis
                        dataKey={chartXKey}
                        tick={{ fontSize: 11 }}
                        label={{ value: isMonthMode ? "Month" : "Week", position: "insideBottom", offset: -8, fontSize: 12 }}
                      />
                      <YAxis
                        yAxisId="units"
                        orientation="left"
                        width={52}
                        tick={{ fontSize: 10 }}
                        label={{ value: "Units", angle: -90, position: "insideLeft", fontSize: 11 }}
                      />
                      <YAxis
                        yAxisId="volume"
                        orientation="right"
                        width={52}
                        tick={{ fontSize: 10 }}
                        tickFormatter={(v) => (v >= 1e6 ? `${(v / 1e6).toFixed(0)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(0)}K` : String(v))}
                        label={{ value: "Volume", angle: 90, position: "insideRight", fontSize: 11 }}
                      />
                      <Tooltip
                        content={({ active, payload }) => {
                          if (!active || !payload?.length) return null;
                          const p = payload[0]?.payload;
                          if (!p) return null;
                          const title = isMonthMode ? p.periodLabel : `${p.weekLabel} ${snapshotDayLabel}`;
                          return (
                            <div className="rounded-lg border border-border bg-background px-3 py-2 shadow-md text-xs">
                              <p className="font-medium text-foreground mb-1.5">{title}</p>
                              {years.map((y) => (
                                <div key={y} className="grid grid-cols-2 gap-x-4 gap-y-0.5">
                                  <span className="text-muted-foreground">{y} Volume</span>
                                  <span className="font-medium tabular-nums">{p[`${y} Volume`] != null ? formatVolume(p[`${y} Volume`] as number) : "-"}</span>
                                  <span className="text-muted-foreground">{y} Units</span>
                                  <span className="font-medium tabular-nums">{p[`${y} Units`] != null ? String(p[`${y} Units`]) : "-"}</span>
                                </div>
                              ))}
                            </div>
                          );
                        }}
                      />
                      <Legend
                        wrapperStyle={{ paddingTop: 8 }}
                        formatter={(value) => value}
                        iconType="rect"
                        iconSize={10}
                      />
                      {years.map((y, i) => (
                        <Bar
                          key={`${y}-units`}
                          yAxisId="units"
                          dataKey={`${y} Units`}
                          name={`${y} Units`}
                          fill={i === 0 ? "#00008f" : "#52b852"}
                          radius={[2, 2, 0, 0]}
                          onClick={(_, index) => {
                            const p = pipelineChartData[index] as { week?: number; month?: number } | undefined;
                            if (p?.week != null) toggleWeek(p.week);
                            if (p?.month != null) toggleMonth(p.month);
                          }}
                        >
                          {pipelineChartData.map((entry, index) => {
                            const selected = isMonthMode
                              ? selectedMonths.includes((entry as { month?: number }).month ?? 0)
                              : selectedWeekValues.includes((entry as { week?: number }).week ?? 0);
                            return (
                              <Cell
                                key={index}
                                fill={selected ? "#7dd3fc" : i === 0 ? "#00008f" : "#52b852"}
                              />
                            );
                          })}
                        </Bar>
                      ))}
                      {years.map((y, i) => (
                        <Line
                          key={`${y}-volume`}
                          yAxisId="volume"
                          type="monotone"
                          dataKey={`${y} Volume`}
                          name={`${y} Volume`}
                          stroke={i === 0 ? "#8080c7" : "#a9dca9"}
                          strokeWidth={2}
                          dot={{ r: 3 }}
                          connectNulls
                        />
                      ))}
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              )}
              {(!loading && !backfillLoading && !rangeLoading && !error) && (pipelineChartData.length === 0 || years.length < 1) && (
                <div className="text-muted-foreground text-sm py-12 text-center rounded-md border">
                  No data to display. Select a year range and ensure pipeline data exists.
                </div>
              )}
            </TabsContent>

            <TabsContent value="loCountChart" className="mt-3">
              {!loading && !backfillLoading && !rangeLoading && !error && pipelineLoCountChartData.length > 0 && years.length >= 1 && (
                <div className="rounded-md border bg-card p-4" style={{ minHeight: 440 }}>
                  <p className="text-sm font-medium text-foreground mb-3">LO Count by {isMonthMode ? "Month" : "Week"}</p>
                  <ResponsiveContainer width="100%" height={420}>
                    <ComposedChart
                      data={pipelineLoCountChartData}
                      margin={{ top: 12, right: 12, left: 12, bottom: 12 }}
                      barCategoryGap="20%"
                      barGap={2}
                      onClick={(data: { activeTooltipIndex?: number }) => {
                        const idx = data?.activeTooltipIndex;
                        if (idx != null && pipelineLoCountChartData[idx]) {
                          const p = pipelineLoCountChartData[idx] as { week?: number; month?: number };
                          if (p.week != null) toggleWeek(p.week);
                          if (p.month != null) toggleMonth(p.month);
                        }
                      }}
                      style={{ cursor: "pointer" }}
                    >
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
                      <XAxis
                        dataKey={chartXKey}
                        tick={{ fontSize: 11 }}
                        label={{ value: isMonthMode ? "Month" : "Week", position: "insideBottom", offset: -8, fontSize: 12 }}
                      />
                      <YAxis
                        yAxisId="loCount"
                        width={40}
                        allowDecimals={false}
                        tick={{ fontSize: 10 }}
                        label={{ value: "LO Count", angle: -90, position: "insideLeft", fontSize: 11 }}
                      />
                      <YAxis
                        yAxisId="units"
                        orientation="right"
                        width={40}
                        allowDecimals={false}
                        tick={{ fontSize: 10 }}
                        label={{ value: "Units", angle: 90, position: "insideRight", fontSize: 11 }}
                      />
                      <Tooltip
                        content={({ active, payload }) => {
                          if (!active || !payload?.length) return null;
                          const p = payload[0]?.payload;
                          if (!p) return null;
                          const title = isMonthMode ? p.periodLabel : `${p.weekLabel} ${snapshotDayLabel}`;
                          return (
                            <div className="rounded-lg border border-border bg-background px-3 py-2 shadow-md text-xs">
                              <p className="font-medium text-foreground mb-1.5">{title}</p>
                              {years.map((y) => (
                                <div key={y} className="space-y-0.5 mb-1">
                                  <div className="flex justify-between gap-4">
                                    <span className="text-muted-foreground">{y} LO Count</span>
                                    <span className="font-medium tabular-nums">{p[`${y} LO Count`] != null ? String(p[`${y} LO Count`]) : "-"}</span>
                                  </div>
                                  <div className="flex justify-between gap-4">
                                    <span className="text-muted-foreground">{y} Units</span>
                                    <span className="font-medium tabular-nums">{p[`${y} Units`] != null ? String(p[`${y} Units`]) : "-"}</span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          );
                        }}
                      />
                      <Legend
                        wrapperStyle={{ paddingTop: 8 }}
                        formatter={(value) => value}
                        iconType="rect"
                        iconSize={10}
                      />
                      {years.map((y, i) => (
                        <Bar
                          key={`${y}-lo`}
                          yAxisId="loCount"
                          dataKey={`${y} LO Count`}
                          name={`${y} LO Count`}
                          fill={i === 0 ? "#00008f" : "#52b852"}
                          radius={[2, 2, 0, 0]}
                          onClick={(_, index) => {
                            const p = pipelineLoCountChartData[index] as { week?: number; month?: number } | undefined;
                            if (p?.week != null) toggleWeek(p.week);
                            if (p?.month != null) toggleMonth(p.month);
                          }}
                        >
                          {pipelineLoCountChartData.map((entry, index) => {
                            const selected = isMonthMode
                              ? selectedMonths.includes((entry as { month?: number }).month ?? 0)
                              : selectedWeekValues.includes((entry as { week?: number }).week ?? 0);
                            return (
                              <Cell
                                key={index}
                                fill={selected ? "#7dd3fc" : i === 0 ? "#00008f" : "#52b852"}
                              />
                            );
                          })}
                        </Bar>
                      ))}
                      {years.map((y, i) => (
                        <Line
                          key={`${y}-units`}
                          yAxisId="units"
                          type="monotone"
                          dataKey={`${y} Units`}
                          name={`${y} Units`}
                          stroke={i === 0 ? "#8080c7" : "#a9dca9"}
                          strokeWidth={2}
                          dot={{ r: 3 }}
                          connectNulls
                        />
                      ))}
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              )}
              {(!loading && !backfillLoading && !rangeLoading && !error) && (pipelineLoCountChartData.length === 0 || years.length < 1) && (
                <div className="text-muted-foreground text-sm py-12 text-center rounded-md border">
                  No data to display. Select a year range and ensure pipeline data exists.
                </div>
              )}
            </TabsContent>

            <TabsContent value="treasury10y" className="mt-3">
              {treasury10yLoading && (
                <div className="flex items-center justify-center py-16">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              )}
              {treasury10yError && (
                <div className="rounded-md bg-destructive/10 text-destructive text-sm p-3">
                  {treasury10yError}
                </div>
              )}
              {!treasury10yLoading && !treasury10yError && treasuryChartData.length > 0 && (
                <div className="rounded-md border bg-card p-4" style={{ minHeight: 440 }}>
                  <p className="text-sm font-medium text-foreground mb-3">
                    {isMonthMode
                      ? "10-Year Treasury Yield (FRED DGS10) — by month (first snapshot per month)"
                      : `10-Year Treasury Yield (FRED DGS10) — by week (${snapshotDayLabel} snapshots)`}
                  </p>
                  <ResponsiveContainer width="100%" height={420}>
                    <ComposedChart
                      data={treasuryChartData}
                      margin={{ top: 12, right: 12, left: 12, bottom: 12 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
                      <XAxis
                        dataKey="dateLabel"
                        tick={{ fontSize: 11 }}
                        label={{ value: "Date", position: "insideBottom", offset: -8, fontSize: 12 }}
                      />
                      <YAxis
                        width={48}
                        tick={{ fontSize: 10 }}
                        tickFormatter={(v) => `${v}%`}
                        label={{ value: "Yield %", angle: -90, position: "insideLeft", fontSize: 11 }}
                      />
                      <Tooltip
                        formatter={(value: number) => [`${value.toFixed(2)}%`, "10-Yr Treasury"]}
                        labelFormatter={(label) => label}
                      />
                      <Line
                        type="monotone"
                        dataKey="yield"
                        name="10-Yr Treasury"
                        stroke="#0ea5e9"
                        strokeWidth={2}
                        dot={{ r: 3 }}
                        connectNulls
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              )}
              {!treasury10yLoading && !treasury10yError && treasuryChartData.length === 0 && (from && to) && (
                <div className="text-muted-foreground text-sm py-12 text-center rounded-md border">
                  No treasury data for the selected year range or no snapshot dates match. Select a year range and ensure pipeline snapshots exist.
                </div>
              )}
              {!treasury10yLoading && !treasury10yError && (!from || !to) && (
                <div className="text-muted-foreground text-sm py-12 text-center rounded-md border">
                  Select a year range to load 10-Year Treasury data.
                </div>
              )}
            </TabsContent>
          </Tabs>

          {/* Loan detail table: visible under all tabs; reloads when filters, year range, or start date change */}
          <div className="mt-6 space-y-2">
            <div className="flex items-center justify-between gap-4">
              <h3 className="text-sm font-semibold text-foreground">Loan detail</h3>
              <Button
                variant="outline"
                size="sm"
                onClick={exportLoanDetailToCsv}
                disabled={loansLoading || pipelineLoans.length === 0}
                className="gap-1.5 shrink-0"
              >
                <Download className="h-3.5 w-3.5" />
                Export
              </Button>
            </div>
            {loansError && (
              <div className="rounded-md bg-destructive/10 text-destructive text-sm p-3">
                {loansError}
              </div>
            )}
            {!loansError && (
              <div className="border rounded-md overflow-x-auto max-h-[800px] overflow-y-auto">
                {loansLoading && pipelineLoans.length === 0 ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : pipelineLoans.length === 0 ? (
                  <div className="text-muted-foreground text-sm py-8 text-center">
                    No loans in the selected date range. Adjust year range or start date.
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow className="sticky top-0 bg-background z-10 shadow-sm">
                        {([
                          { id: "loan_number" as const, label: "Loan #", align: "left" },
                          { id: "loan_amount" as const, label: "Loan amount", align: "right" },
                          { id: "loan_type" as const, label: "Loan type", align: "left" },
                          { id: "loan_purpose" as const, label: "Loan purpose", align: "left" },
                          { id: "current_loan_status" as const, label: "Current loan status", align: "left" },
                          { id: "start_date" as const, label: startDateColumnLabel, align: "left" },
                          { id: "current_status_date" as const, label: "Current status date", align: "left" },
                          { id: "fico_score" as const, label: "FICO score", align: "right" },
                          { id: "ltv_ratio" as const, label: "LTV ratio", align: "right" },
                          { id: "be_dti_ratio" as const, label: "BE DTI ratio", align: "right" },
                          { id: "loan_officer" as const, label: "Loan officer", align: "left" },
                          { id: "processor" as const, label: "Processor", align: "left" },
                          { id: "underwriter" as const, label: "Underwriter", align: "left" },
                          { id: "closer" as const, label: "Closer", align: "left" },
                        ]).map(({ id, label, align }) => {
                          const isSorted = loanDetailSortColumn === id;
                          return (
                            <TableHead
                              key={id}
                              className={cn(
                                "whitespace-nowrap bg-background cursor-pointer select-none hover:bg-muted/60",
                                align === "right" && "text-right"
                              )}
                              onClick={() => handleLoanDetailSort(id)}
                              aria-sort={isSorted ? (loanDetailSortDirection === "asc" ? "ascending" : "descending") : undefined}
                            >
                              <span className="inline-flex items-center gap-1">
                                {label}
                                {isSorted ? (
                                  loanDetailSortDirection === "asc" ? (
                                    <ArrowUp className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
                                  ) : (
                                    <ArrowDown className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
                                  )
                                ) : (
                                  <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-40" aria-hidden />
                                )}
                              </span>
                            </TableHead>
                          );
                        })}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {sortedPipelineLoans.map((loan, idx) => (
                        <TableRow key={loan.loan_id || `loan-${idx}`}>
                          <TableCell className="font-mono text-xs">{loan.loan_number ?? "-"}</TableCell>
                          <TableCell className="text-right">
                            {loan.loan_amount != null ? formatVolume(loan.loan_amount) : "-"}
                          </TableCell>
                          <TableCell>{loan.loan_type ?? "-"}</TableCell>
                          <TableCell>{loan.loan_purpose ?? "-"}</TableCell>
                          <TableCell>{loan.current_loan_status ?? "-"}</TableCell>
                          <TableCell>
                            {loan.start_date ? format(parseISO(loan.start_date), "yyyy-MM-dd") : "-"}
                          </TableCell>
                          <TableCell>
                            {loan.current_status_date ? format(parseISO(loan.current_status_date), "yyyy-MM-dd") : "-"}
                          </TableCell>
                          <TableCell className="text-right">{loan.fico_score != null ? String(loan.fico_score) : "-"}</TableCell>
                          <TableCell className="text-right">{loan.ltv_ratio != null ? String(loan.ltv_ratio) : "-"}</TableCell>
                          <TableCell className="text-right">{loan.be_dti_ratio != null ? String(loan.be_dti_ratio) : "-"}</TableCell>
                          <TableCell>{loan.loan_officer ?? "-"}</TableCell>
                          <TableCell>{loan.processor ?? "-"}</TableCell>
                          <TableCell>{loan.underwriter ?? "-"}</TableCell>
                          <TableCell>{loan.closer ?? "-"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
