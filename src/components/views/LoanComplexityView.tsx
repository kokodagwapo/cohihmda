/**
 * Loan Complexity View – dashboard for average loan complexity by loan officer, branch, or current loan status.
 * Uses same period filter as Actors (MTD, LM, QTD, LQ, YTD, LY, Custom); complexity from admin scoring weights.
 * Click a bar to show loan details for that group in an inline table (sortable, downloadable).
 */

import React, { useState, useMemo, useCallback, useEffect } from "react";
import { format } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DatePeriodPicker, computePresetDateRange } from "@/components/ui/DatePeriodPicker";
import type { PeriodSelection, PeriodPreset } from "@/components/ui/DatePeriodPicker";
import { useLoanComplexityData } from "@/hooks/useLoanComplexityData";
import type { LoanComplexityGroupBy } from "@/hooks/useLoanComplexityData";
import { useLoanComplexityPivot } from "@/hooks/useLoanComplexityPivot";
import type { PivotRowMetrics } from "@/hooks/useLoanComplexityPivot";
import {
  useLoanComplexityGroupLoans,
  type LoanComplexityGroupLoanRow,
} from "@/hooks/useLoanComplexityGroupLoans";
import { api } from "@/lib/api";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  Cell,
} from "recharts";
import { cn } from "@/lib/utils";
import { useTheme } from "@/components/theme-provider";
import { Loader2, Download, ChevronDown, ArrowUp, ArrowDown, ChevronRight, X } from "lucide-react";
import {
  useDashboardInsights,
  type DashboardInsightItem,
} from "@/hooks/useDashboardInsights";
import { DashboardInsightsStrip } from "@/components/dashboard/DashboardInsightsStrip";

const PERIOD_PRESETS: PeriodPreset[] = [
  "mtd",
  "last-month",
  "qtd",
  "last-quarter",
  "ytd",
  "last-year",
];

function getDefaultDateRange(): { start: string; end: string } {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  return {
    start: format(start, "yyyy-MM-dd"),
    end: format(now, "yyyy-MM-dd"),
  };
}

const GROUP_BY_OPTIONS: { value: "actors" | "branch" | "current_loan_status"; label: string }[] = [
  { value: "actors", label: "Actors" },
  { value: "branch", label: "Branch" },
  { value: "current_loan_status", label: "Current Loan Status" },
];

const ACTOR_TYPE_OPTIONS: { value: LoanComplexityGroupBy; label: string }[] = [
  { value: "loan_officer", label: "Loan Officer" },
  { value: "processor", label: "Processor" },
  { value: "underwriter", label: "Underwriter" },
  { value: "closer", label: "Closer" },
];

/** DOM ids for dashboard insights evidence targets (must match server widget_catalog). */
const LOAN_COMPLEXITY_PIVOT_SECTION_DOM_ID: Record<LoanComplexityGroupBy, string> = {
  loan_officer: "loan-complexity-pivot-loan-officer",
  processor: "loan-complexity-pivot-processor",
  underwriter: "loan-complexity-pivot-underwriter",
  closer: "loan-complexity-pivot-closer",
  branch: "loan-complexity-pivot-branch",
  current_loan_status: "loan-complexity-pivot-current-loan-status",
};

/** Expand pivot section by header label when scrolling to a pivot widget id. */
const WIDGET_ID_TO_PIVOT_SECTION_LABEL: Record<string, string> = {
  "loan-complexity-pivot-loan-officer": "Loan Officer",
  "loan-complexity-pivot-processor": "Processor",
  "loan-complexity-pivot-underwriter": "Underwriter",
  "loan-complexity-pivot-closer": "Closer",
  "loan-complexity-pivot-branch": "Branch",
  "loan-complexity-pivot-current-loan-status": "Current Loan Status",
};

const WIDGET_ID_TO_ACTOR_TYPE: Record<string, LoanComplexityGroupBy | undefined> = {
  "loan-complexity-pivot-loan-officer": "loan_officer",
  "loan-complexity-pivot-processor": "processor",
  "loan-complexity-pivot-underwriter": "underwriter",
  "loan-complexity-pivot-closer": "closer",
  "loan-complexity-bar-chart": "loan_officer",
};

const LOAN_DETAIL_COLUMNS: { key: keyof LoanComplexityGroupLoanRow; label: string }[] = [
  { key: "loan_number", label: "Loan number" },
  { key: "loan_amount", label: "Volume" },
  { key: "complexity_score", label: "Complexity" },
  { key: "loan_type", label: "Loan Type" },
  { key: "loan_purpose", label: "Loan Purpose" },
  { key: "application_date", label: "Application date" },
  { key: "current_loan_status", label: "Current Loan Status" },
  { key: "current_milestone", label: "Current Milestone" },
  { key: "ltv_ratio", label: "LTV" },
  { key: "be_dti_ratio", label: "BE DTI" },
  { key: "fico_score", label: "FICO" },
  { key: "occupancy_type", label: "Occupancy Type" },
  { key: "borr_self_employed", label: "Self-employed" },
  { key: "branch", label: "Branch" },
  { key: "loan_officer", label: "Loan Officer" },
  { key: "underwriter", label: "Underwriter" },
  { key: "processor", label: "Processor" },
  { key: "closer", label: "Closer" },
];

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "number") {
    if (Number.isInteger(value)) return String(value);
    return value.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }
  if (typeof value === "string") return value.trim() || "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

function formatVolume(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const n = Number(value);
  if (Number.isNaN(n)) return "—";
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function getCellValueForExport(row: LoanComplexityGroupLoanRow, colKey: keyof LoanComplexityGroupLoanRow): string {
  if (colKey === "loan_amount") return formatVolume(row.loan_amount);
  if (colKey === "complexity_score") return row.complexity_score != null ? String(row.complexity_score) : "—";
  return formatCell(row[colKey]);
}

function escapeCsv(value: string): string {
  const s = String(value ?? "");
  if (s.includes(",") || s.includes('"') || s.includes("\n")) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toSafeFileName(s: string): string {
  return s.replace(/[\s\\/*?:\[\]]/g, "_").slice(0, 50) || "export";
}

function formatPct(value: number): string {
  return `${value.toFixed(1)}%`;
}

function PivotCells({
  row,
  loanTypes,
  purposes,
  isDark,
  showActive,
  showOriginated,
  showDenied,
  showWithdrawn,
}: {
  row: PivotRowMetrics;
  loanTypes: string[];
  purposes: string[];
  isDark: boolean;
  showActive: boolean;
  showOriginated: boolean;
  showDenied: boolean;
  showWithdrawn: boolean;
}) {
  const cellClass = "px-2 py-2 text-right whitespace-nowrap text-slate-700 dark:text-slate-300";
  const waComplexityStyle = getComplexityCellStyle(row.waComplexity);
  return (
    <>
      <td className={cellClass}>{row.units.toLocaleString()}</td>
      <td
        className={cellClass}
        style={waComplexityStyle ?? undefined}
      >
        {row.waComplexity != null ? row.waComplexity.toFixed(1) : "—"}
      </td>
      <td className={cellClass}>
        {row.timeInMotionDays != null ? row.timeInMotionDays.toFixed(1) : "—"}
      </td>
      {loanTypes.map((t) => (
        <td key={t} className={cellClass}>
          {formatPct(row.pctByType[t] ?? 0)}
        </td>
      ))}
      {purposes.map((p) => (
        <td key={p} className={cellClass}>
          {formatPct(row.pctByPurpose[p] ?? 0)}
        </td>
      ))}
      <td className={cellClass}>{formatPct(row.pctLocked)}</td>
      {showActive && <td className={cellClass}>{formatPct(row.pctActive)}</td>}
      {showOriginated && <td className={cellClass}>{formatPct(row.pctOriginated)}</td>}
      {showDenied && <td className={cellClass}>{formatPct(row.pctDenied)}</td>}
      {showWithdrawn && <td className={cellClass}>{formatPct(row.pctWithdrawn)}</td>}
    </>
  );
}

function compareCell(a: unknown, b: unknown, dir: "asc" | "desc"): number {
  const na = a === null || a === undefined;
  const nb = b === null || b === undefined;
  if (na && nb) return 0;
  if (na) return dir === "asc" ? 1 : -1;
  if (nb) return dir === "asc" ? -1 : 1;
  if (typeof a === "number" && typeof b === "number") {
    const v = a - b;
    return dir === "asc" ? v : -v;
  }
  const sa = String(a).trim().toLowerCase();
  const sb = String(b).trim().toLowerCase();
  const v = sa.localeCompare(sb, undefined, { sensitivity: "base" });
  return dir === "asc" ? v : -v;
}

function sortLoanRows(
  rows: LoanComplexityGroupLoanRow[],
  sortKey: keyof LoanComplexityGroupLoanRow,
  direction: "asc" | "desc"
): LoanComplexityGroupLoanRow[] {
  return [...rows].sort((ra, rb) => {
    const a = ra[sortKey];
    const b = rb[sortKey];
    if (sortKey === "loan_amount") return compareCell(ra.loan_amount, rb.loan_amount, direction);
    return compareCell(a, b, direction);
  });
}

/** Complexity score cell: same bar colors; light = black text, medium/dark = white text. */
function getComplexityCellStyle(score: number | null): { backgroundColor: string; color: string } | null {
  if (score === null || score === undefined) return null;
  if (score <= 100) return { backgroundColor: "#a8ccf0", color: "#000000" };
  if (score <= 115) return { backgroundColor: "#2f85da", color: "#ffffff" };
  return { backgroundColor: "#174d82", color: "#ffffff" };
}

export interface LoanComplexityViewProps {
  selectedTenantId?: string | null;
  selectedChannel?: string | null;
}

export function LoanComplexityView({
  selectedTenantId,
  selectedChannel,
}: LoanComplexityViewProps) {
  const { theme } = useTheme();
  const isDark = theme === "dark";

  const [periodSelection, setPeriodSelection] = useState<PeriodSelection>(() => {
    const range = getDefaultDateRange();
    return { type: "preset", preset: "mtd", dateRange: range };
  });
  const [groupBy, setGroupBy] = useState<"actors" | "branch" | "current_loan_status">("actors");
  const [actorType, setActorType] = useState<LoanComplexityGroupBy>("loan_officer");
  const [selectedGroups, setSelectedGroups] = useState<{ dimension: LoanComplexityGroupBy; groupName: string }[]>([]);
  const [currentLoanStatusFilter, setCurrentLoanStatusFilter] = useState<string>("All");
  const [statusOptions, setStatusOptions] = useState<{ statuses: string[]; hasFallout: boolean }>({
    statuses: [],
    hasFallout: false,
  });
  const [sortColumnId, setSortColumnId] = useState<keyof LoanComplexityGroupLoanRow | null>(null);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [pivotExpanded, setPivotExpanded] = useState<string | null>(null);
  const [generateLoading, setGenerateLoading] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [pendingInsightWidgetId, setPendingInsightWidgetId] = useState<string | null>(null);

  const INSIGHT_DATE_PERIOD_TO_PRESET: Record<string, PeriodPreset> = {
    mtd: "mtd",
    qtd: "qtd",
    ytd: "ytd",
    lm: "last-month",
    lq: "last-quarter",
    ly: "last-year",
  };

  const dashboardInsightFilters = useMemo(() => ({}), []);
  const {
    insights: dashboardInsights,
    generatedAt: dashboardInsightsGeneratedAt,
    loading: dashboardInsightsLoading,
    refresh: refreshDashboardInsights,
  } = useDashboardInsights("loan-complexity", dashboardInsightFilters, {
    tenantId: selectedTenantId,
  });

  const handleGenerateInsights = useCallback(async () => {
    setGenerateLoading(true);
    setGenerateError(null);
    try {
      const tenantParam = selectedTenantId ? `?tenant_id=${encodeURIComponent(selectedTenantId)}` : "";
      await api.request<{
        insights: DashboardInsightItem[];
        count: number;
        pageId: string;
        pageName: string;
        generationBatch: string;
      }>(`/api/dashboard-insights/generate${tenantParam}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pageId: "loan-complexity",
          filters: {},
        }),
      });
      await refreshDashboardInsights();
    } catch (err: unknown) {
      setGenerateError(
        err instanceof Error ? err.message : "We couldn't generate insights right now. Please try again later."
      );
    } finally {
      setGenerateLoading(false);
    }
  }, [refreshDashboardInsights, selectedTenantId]);

  const handleShowInsight = useCallback((insight: DashboardInsightItem) => {
    const firstRef = insight.evidence_refs?.[0];
    const wid = firstRef?.widgetId;
    const datePeriod =
      typeof insight.filter_context?.datePeriod === "string"
        ? insight.filter_context.datePeriod.toLowerCase()
        : null;
    const preset = datePeriod ? INSIGHT_DATE_PERIOD_TO_PRESET[datePeriod] : undefined;

    if (preset) {
      setPeriodSelection({
        type: "preset",
        preset,
        dateRange: computePresetDateRange(preset),
      });
    }

    // Sync actor type filter to the referenced actor dimension when present.
    const rawActorType = insight.filter_context?.actorType;
    const normalizedActorType =
      typeof rawActorType === "string" ? rawActorType.trim().toLowerCase() : "";
    const actorTypeFromFilterContext: LoanComplexityGroupBy | null =
      normalizedActorType === "loan_officer" || normalizedActorType === "loan officer"
        ? "loan_officer"
        : normalizedActorType === "processor"
          ? "processor"
          : normalizedActorType === "underwriter"
            ? "underwriter"
            : normalizedActorType === "closer"
              ? "closer"
              : null;

    let actorTypeFromEvidence: LoanComplexityGroupBy | null = null;
    for (const ref of insight.evidence_refs ?? []) {
      const inferred = WIDGET_ID_TO_ACTOR_TYPE[ref.widgetId];
      if (!inferred) continue;
      // Prefer explicit non-LO actor dimensions over generic LO defaults.
      if (inferred !== "loan_officer") {
        actorTypeFromEvidence = inferred;
        break;
      }
      if (!actorTypeFromEvidence) actorTypeFromEvidence = inferred;
    }
    const actorTypeToApply = actorTypeFromFilterContext ?? actorTypeFromEvidence;
    if (actorTypeToApply) setActorType(actorTypeToApply);

    if (wid && WIDGET_ID_TO_PIVOT_SECTION_LABEL[wid]) {
      setPivotExpanded(WIDGET_ID_TO_PIVOT_SECTION_LABEL[wid]);
    }
    setPendingInsightWidgetId(wid ?? null);
  }, []);

  const handleDashboardInsightFeedback = useCallback(
    async (insightId: number, rating: 1 | -1, tags?: string[], comment?: string) => {
      try {
        await api.submitDashboardInsightFeedback(insightId, rating, tags, comment, selectedTenantId);
        return true;
      } catch {
        return false;
      }
    },
    [selectedTenantId]
  );

  const dateRange = periodSelection.dateRange;

  const effectiveGroupBy: LoanComplexityGroupBy =
    groupBy === "actors" ? actorType : groupBy;

  // Fetch status options for the selected period (milestones that exist in that period)
  useEffect(() => {
    if (!selectedTenantId || !dateRange.start || !dateRange.end) {
      setStatusOptions({ statuses: [], hasFallout: false });
      return;
    }
    let cancelled = false;
    const params = new URLSearchParams();
    params.set("startDate", dateRange.start);
    params.set("endDate", dateRange.end);
    if (selectedTenantId) params.set("tenant_id", selectedTenantId);
    if (selectedChannel && selectedChannel !== "All") params.set("channel_group", selectedChannel);
    api
      .request<{ statuses: string[]; hasFallout: boolean }>(
        `/api/dashboard/loan-complexity/status-options?${params.toString()}`
      )
      .then((res) => {
        if (!cancelled)
          setStatusOptions({
            statuses: res.statuses ?? [],
            hasFallout: res.hasFallout ?? false,
          });
      })
      .catch(() => {
        if (!cancelled) setStatusOptions({ statuses: [], hasFallout: false });
      });
    return () => {
      cancelled = true;
    };
  }, [selectedTenantId, selectedChannel, dateRange.start, dateRange.end]);

  // When options change, reset filter to All if current selection is no longer in the list
  useEffect(() => {
    if (currentLoanStatusFilter === "All") return;
    const validOptions = [
      "All",
      "Active Loan",
      "Non-active",
      ...statusOptions.statuses,
      ...(statusOptions.hasFallout ? ["Fallout"] : []),
    ];
    if (!validOptions.includes(currentLoanStatusFilter)) {
      setCurrentLoanStatusFilter("All");
    }
  }, [statusOptions.statuses, statusOptions.hasFallout, currentLoanStatusFilter]);

  const { data, loading, error } = useLoanComplexityData({
    startDate: dateRange.start,
    endDate: dateRange.end,
    groupBy: effectiveGroupBy,
    selectedTenantId,
    channelGroup: selectedChannel,
    currentLoanStatus: currentLoanStatusFilter === "All" ? null : currentLoanStatusFilter,
  });

  const { data: pivotData, loading: pivotLoading, error: pivotError } = useLoanComplexityPivot({
    startDate: dateRange.start,
    endDate: dateRange.end,
    selectedTenantId,
    channelGroup: selectedChannel,
    currentLoanStatus: currentLoanStatusFilter === "All" ? null : currentLoanStatusFilter,
  });

  const { loans, loading: loansLoading, error: loansError } = useLoanComplexityGroupLoans({
    startDate: dateRange.start,
    endDate: dateRange.end,
    groupFilters: selectedGroups.map((g) => ({ groupBy: g.dimension, groupName: g.groupName })),
    selectedTenantId,
    channelGroup: selectedChannel,
    currentLoanStatus: currentLoanStatusFilter === "All" ? null : currentLoanStatusFilter,
  });

  const sortedLoans = useMemo(
    () =>
      sortColumnId
        ? sortLoanRows(loans, sortColumnId, sortDirection)
        : loans,
    [loans, sortColumnId, sortDirection]
  );

  useEffect(() => {
    if (!pendingInsightWidgetId || loading || pivotLoading || typeof document === "undefined") return;
    const el = document.getElementById(pendingInsightWidgetId);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("ring-2", "ring-amber-400", "ring-offset-2");
    setTimeout(() => el.classList.remove("ring-2", "ring-amber-400", "ring-offset-2"), 3000);
    setPendingInsightWidgetId(null);
  }, [pendingInsightWidgetId, loading, pivotLoading]);

  const handleSort = useCallback((columnId: keyof LoanComplexityGroupLoanRow) => {
    setSortColumnId((prev) => {
      if (prev === columnId) {
        setSortDirection((d) => (d === "asc" ? "desc" : "asc"));
        return columnId;
      }
      setSortDirection("asc");
      return columnId;
    });
  }, []);

  const groupByLabel =
    groupBy === "actors"
      ? ACTOR_TYPE_OPTIONS.find((o) => o.value === actorType)?.label ?? "Actor"
      : GROUP_BY_OPTIONS.find((o) => o.value === groupBy)?.label ?? "group";

  /** Toggle pivot row or bar selection (multi-select, cross-dimension). */
  const handleSelectGroup = useCallback((dimension: LoanComplexityGroupBy, groupName: string) => {
    const key = `${dimension}:${groupName}`;
    setSelectedGroups((prev) =>
      prev.some((g) => `${g.dimension}:${g.groupName}` === key)
        ? prev.filter((g) => `${g.dimension}:${g.groupName}` !== key)
        : [...prev, { dimension, groupName }]
    );
  }, []);

  const dateStr = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const fileBase = useMemo(
    () =>
      selectedGroups.length > 0
        ? `loan-complexity-${selectedGroups.map((g) => toSafeFileName(g.groupName)).join("-")}-${dateStr}`.slice(0, 80)
        : "loan-complexity-details",
    [selectedGroups, dateStr]
  );

  const exportCsv = useCallback(() => {
    const headerRow = LOAN_DETAIL_COLUMNS.map((col) => escapeCsv(col.label));
    const dataRows = sortedLoans.map((row) =>
      LOAN_DETAIL_COLUMNS.map((col) => escapeCsv(getCellValueForExport(row, col.key)))
    );
    const csv = [headerRow, ...dataRows].map((row) => row.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${fileBase}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  }, [sortedLoans, fileBase]);

  const exportExcel = useCallback(async () => {
    const XLSX = await import("xlsx");
    const headerRow = LOAN_DETAIL_COLUMNS.map((col) => col.label);
    const dataRows = sortedLoans.map((row) =>
      LOAN_DETAIL_COLUMNS.map((col) => getCellValueForExport(row, col.key))
    );
    const aoa = [headerRow, ...dataRows];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Loans");
    const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    const blob = new Blob([out], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${fileBase}.xlsx`;
    link.click();
    URL.revokeObjectURL(link.href);
  }, [sortedLoans, fileBase]);

  const bars = useMemo(() => data?.bars ?? [], [data?.bars]);
  const displayError =
    error != null
      ? error.includes("No tenant selected") || error.includes("Tenant context required")
        ? "Select a tenant to view data."
        : error
      : null;

  // Bar chart: 3 static colors by complexity (≤100 #a8ccf0, 101–115 #2f85da, ≥116 #174d82)
  const complexityColorScale = useMemo(() => {
    return (val: number) => {
      if (val <= 100) return "#a8ccf0";
      if (val <= 115) return "#2f85da";
      return "#174d82";
    };
  }, []);

  return (
    <div className="space-y-4">
      {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-slate-600 dark:text-slate-400">
            Period
          </span>
          <DatePeriodPicker
            year={new Date().getFullYear()}
            onYearChange={() => {}}
            presets={PERIOD_PRESETS}
            showYears={false}
            onPeriodChange={setPeriodSelection}
            periodSelectionFromStore={periodSelection}
            defaultPreset="mtd"
            showLabel={false}
            size="sm"
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-slate-600 dark:text-slate-400">
            Group by
          </span>
          <div className="flex rounded-lg border border-slate-200 dark:border-slate-700 p-0.5 bg-slate-100/50 dark:bg-slate-800/50">
            {GROUP_BY_OPTIONS.map((opt) => (
              <Button
                key={opt.value}
                variant="ghost"
                size="sm"
                className={cn(
                  "h-8 px-3 text-sm whitespace-nowrap",
                  groupBy === opt.value
                    ? "bg-white dark:bg-slate-900 shadow-sm border border-slate-200 dark:border-slate-600 text-slate-900 dark:text-slate-100"
                    : "text-slate-600 dark:text-slate-400 hover:bg-slate-200/50 dark:hover:bg-slate-700/50"
                )}
                onClick={() => setGroupBy(opt.value)}
              >
                {opt.label}
              </Button>
            ))}
          </div>
        </div>
        {groupBy === "actors" && (
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-slate-600 dark:text-slate-400">
              Actor type
            </span>
            <Select value={actorType} onValueChange={(v) => setActorType(v as LoanComplexityGroupBy)}>
              <SelectTrigger className="w-[160px] h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ACTOR_TYPE_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-slate-600 dark:text-slate-400">
            Current loan status
          </span>
          <Select
            value={currentLoanStatusFilter}
            onValueChange={setCurrentLoanStatusFilter}
          >
            <SelectTrigger className="w-[200px] h-8 text-sm">
              <SelectValue placeholder="All" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="All">All</SelectItem>
              <SelectItem value="Active Loan">Active Loan</SelectItem>
              <SelectItem value="Non-active">Non-active</SelectItem>
              {statusOptions.statuses
                .filter((s) => s !== "Active Loan")
                .map((status) => (
                  <SelectItem key={status} value={status}>
                    {status}
                  </SelectItem>
                ))}
              {statusOptions.hasFallout && (
                <SelectItem value="Fallout">Fallout</SelectItem>
              )}
            </SelectContent>
          </Select>
        </div>
      </div>
      {selectedGroups.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 w-full min-w-0">
          <span
            className="inline-flex flex-wrap items-center gap-x-1 gap-y-1 px-2 py-1.5 rounded text-xs font-medium text-white max-w-full min-w-0 break-words whitespace-normal"
            style={{ backgroundColor: "#52b852" }}
          >
            {(() => {
              const dimLabel = (d: string) =>
                ACTOR_TYPE_OPTIONS.find((o) => o.value === d)?.label ??
                GROUP_BY_OPTIONS.find((o) => o.value === d)?.label ??
                d;
              const byDim = selectedGroups.reduce<Record<string, string[]>>((acc, g) => {
                if (!acc[g.dimension]) acc[g.dimension] = [];
                acc[g.dimension].push(g.groupName);
                return acc;
              }, {});
              return Object.entries(byDim)
                .map(([dim, names]) => `${dimLabel(dim)}: ${names.join(" and ")}`)
                .join(", ");
            })()}
            <button
              type="button"
              className="ml-0.5 rounded hover:bg-white/20 p-0.5 shrink-0"
              onClick={() => setSelectedGroups([])}
              aria-label="Clear selection"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        </div>
      )}

      {displayError && (
        <p className="text-sm text-red-600 dark:text-red-400">{displayError}</p>
      )}

      <DashboardInsightsStrip
        insights={dashboardInsights}
        generatedAt={dashboardInsightsGeneratedAt}
        loading={dashboardInsightsLoading}
        generating={generateLoading}
        generateError={generateError}
        onClearGenerateError={() => setGenerateError(null)}
        onShowInsight={handleShowInsight}
        onGenerate={handleGenerateInsights}
        onRefreshInsights={refreshDashboardInsights}
        showGenerateButton
        showFeedback
        onSubmitFeedback={handleDashboardInsightFeedback}
        dateFilter="ytd"
        selectedTenantId={selectedTenantId}
      />

      {/* Pivot table */}
      <Card
        className={cn(
          "rounded-xl border overflow-hidden",
          isDark ? "border-slate-700 bg-slate-800/50" : "border-slate-200/60 bg-white"
        )}
      >
        <CardHeader className="pb-2">
          <CardTitle
            className={cn(
              "text-base font-semibold",
              isDark ? "text-white" : "text-slate-900"
            )}
          >
            Loan Complexity Pivot
          </CardTitle>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Units, weighted average complexity, time in motion, and outcome mix by dimension. Expand a row to see individuals.
          </p>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mt-2 text-xs text-slate-600 dark:text-slate-400">
            <span className="font-medium">WA Complexity:</span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: "#a8ccf0" }} aria-hidden />
              &lt; 101
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: "#2f85da" }} aria-hidden />
              101–115
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: "#174d82" }} aria-hidden />
              &gt; 115
            </span>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {pivotLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-sky-500" />
            </div>
          ) : pivotError ? (
            <p className="text-sm text-amber-600 dark:text-amber-400 px-4 py-4">
              {pivotError}
            </p>
          ) : !pivotData || pivotData.dimensions.length === 0 ? (
            <p className="text-sm text-slate-500 py-8 text-center px-4">
              No pivot data for the selected period and filters.
            </p>
          ) : (
            <div className="overflow-auto border-t border-slate-200 dark:border-slate-700">
              <table className="w-full border-collapse text-sm">
                <thead className={cn("sticky top-0 z-10 border-b border-slate-200 dark:border-slate-700", isDark ? "bg-slate-800" : "bg-slate-50")}>
                  <tr>
                    <th className="text-left font-medium text-slate-600 dark:text-slate-400 px-3 py-2 whitespace-nowrap min-w-[140px]">
                      Group
                    </th>
                    <th className="text-right font-medium text-slate-600 dark:text-slate-400 px-2 py-2 whitespace-nowrap">
                      Units
                    </th>
                    <th className="text-right font-medium text-slate-600 dark:text-slate-400 px-2 py-2 whitespace-nowrap">
                      WA Complexity
                    </th>
                    <th className="text-right font-medium text-slate-600 dark:text-slate-400 px-2 py-2 whitespace-nowrap">
                      Time in Motion
                    </th>
                    {pivotData.loanTypes.map((t) => (
                      <th key={t} className="text-right font-medium text-slate-600 dark:text-slate-400 px-2 py-2 whitespace-nowrap">
                        % {t.charAt(0).toUpperCase() + t.slice(1)}
                      </th>
                    ))}
                    {pivotData.purposes.map((p) => (
                      <th key={p} className="text-right font-medium text-slate-600 dark:text-slate-400 px-2 py-2 whitespace-nowrap">
                        % {p.charAt(0).toUpperCase() + p.slice(1)}
                      </th>
                    ))}
                    <th className="text-right font-medium text-slate-600 dark:text-slate-400 px-2 py-2 whitespace-nowrap">
                      % Locked
                    </th>
                    {currentLoanStatusFilter === "All" && (
                      <th className="text-right font-medium text-slate-600 dark:text-slate-400 px-2 py-2 whitespace-nowrap">
                        % Active
                      </th>
                    )}
                    {(currentLoanStatusFilter === "All" || currentLoanStatusFilter === "Non-active") && (
                      <th className="text-right font-medium text-slate-600 dark:text-slate-400 px-2 py-2 whitespace-nowrap">
                        % Originated
                      </th>
                    )}
                    {(currentLoanStatusFilter === "All" || currentLoanStatusFilter === "Non-active" || currentLoanStatusFilter === "Fallout") && (
                      <>
                        <th className="text-right font-medium text-slate-600 dark:text-slate-400 px-2 py-2 whitespace-nowrap">
                          % Denied
                        </th>
                        <th className="text-right font-medium text-slate-600 dark:text-slate-400 px-2 py-2 whitespace-nowrap">
                          % Withdrawn
                        </th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {pivotData.dimensions.map((dim) => (
                    <React.Fragment key={dim.dimension}>
                      <tr
                        id={LOAN_COMPLEXITY_PIVOT_SECTION_DOM_ID[dim.dimension as LoanComplexityGroupBy]}
                        className={cn(
                          "border-b border-slate-100 dark:border-slate-800 cursor-pointer hover:bg-slate-50/50 dark:hover:bg-slate-800/30 scroll-mt-24",
                          isDark ? "" : ""
                        )}
                        onClick={() => setPivotExpanded((prev) => (prev === dim.label ? null : dim.label))}
                      >
                        <td className="px-3 py-2 font-medium text-slate-700 dark:text-slate-300 whitespace-nowrap">
                          <span className="inline-flex items-center gap-1">
                            {pivotExpanded === dim.label ? (
                              <ChevronDown className="h-4 w-4 shrink-0" aria-hidden />
                            ) : (
                              <ChevronRight className="h-4 w-4 shrink-0" aria-hidden />
                            )}
                            {dim.label}
                          </span>
                        </td>
                        <PivotCells
                          row={dim.total}
                          loanTypes={pivotData.loanTypes}
                          purposes={pivotData.purposes}
                          isDark={isDark}
                          showActive={currentLoanStatusFilter === "All"}
                          showOriginated={currentLoanStatusFilter === "All" || currentLoanStatusFilter === "Non-active"}
                          showDenied={currentLoanStatusFilter === "All" || currentLoanStatusFilter === "Non-active" || currentLoanStatusFilter === "Fallout"}
                          showWithdrawn={currentLoanStatusFilter === "All" || currentLoanStatusFilter === "Non-active" || currentLoanStatusFilter === "Fallout"}
                        />
                      </tr>
                      {pivotExpanded === dim.label &&
                        dim.rows.map((row) => {
                          const isSelected = selectedGroups.some(
                            (g) => g.dimension === dim.dimension && g.groupName === row.groupName
                          );
                          return (
                          <tr
                            key={row.groupName}
                            role="button"
                            tabIndex={0}
                            className={cn(
                              "border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50/50 dark:hover:bg-slate-800/30 cursor-pointer",
                              isSelected && "bg-[#52b852]/20 dark:bg-[#52b852]/25"
                            )}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleSelectGroup(dim.dimension as LoanComplexityGroupBy, row.groupName);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                e.stopPropagation();
                                handleSelectGroup(dim.dimension as LoanComplexityGroupBy, row.groupName);
                              }
                            }}
                          >
                            <td className={cn("pl-10 pr-3 py-1.5 whitespace-nowrap", isSelected ? "text-[#2d7a2d] dark:text-[#6bcf6b] font-medium" : "text-slate-600 dark:text-slate-400")}>
                              {row.groupName}
                            </td>
                            <PivotCells
                              row={row}
                              loanTypes={pivotData.loanTypes}
                              purposes={pivotData.purposes}
                              isDark={isDark}
                              showActive={currentLoanStatusFilter === "All"}
                              showOriginated={currentLoanStatusFilter === "All" || currentLoanStatusFilter === "Non-active"}
                              showDenied={currentLoanStatusFilter === "All" || currentLoanStatusFilter === "Non-active" || currentLoanStatusFilter === "Fallout"}
                              showWithdrawn={currentLoanStatusFilter === "All" || currentLoanStatusFilter === "Non-active" || currentLoanStatusFilter === "Fallout"}
                            />
                          </tr>
                          );
                        })}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Bar chart */}
      <Card
        id="loan-complexity-bar-chart"
        className={cn(
          "rounded-xl border overflow-hidden scroll-mt-24",
          isDark ? "border-slate-700 bg-slate-800/50" : "border-slate-200/60 bg-white"
        )}
      >
        <CardHeader className="pb-2">
          <CardTitle
            className={cn(
              "text-base font-semibold",
              isDark ? "text-white" : "text-slate-900"
            )}
          >
            Average Loan Complexity by {GROUP_BY_OPTIONS.find((o) => o.value === groupBy)?.label}
          </CardTitle>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Loans with application date in selected period. Complexity uses admin scoring weights (baseline 100).
            {" "}
            Click a bar or pivot row to select or deselect; the loan table filters to selected individuals.
          </p>
        </CardHeader>
        <CardContent className="pb-4">
          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-sky-500" />
            </div>
          ) : bars.length === 0 ? (
            <p className="text-sm text-slate-500 py-8 text-center">
              No data available for the selected period and filters.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mb-3 text-xs text-slate-600 dark:text-slate-400">
                <span className="font-medium">Color key:</span>
                <span className="flex items-center gap-1.5">
                  <span
                    className="inline-block w-3 h-3 rounded-sm shrink-0"
                    style={{ backgroundColor: "#a8ccf0" }}
                    aria-hidden
                  />
                  Complexity score &lt; 101
                </span>
                <span className="flex items-center gap-1.5">
                  <span
                    className="inline-block w-3 h-3 rounded-sm shrink-0"
                    style={{ backgroundColor: "#2f85da" }}
                    aria-hidden
                  />
                  Complexity scores 101–115
                </span>
                <span className="flex items-center gap-1.5">
                  <span
                    className="inline-block w-3 h-3 rounded-sm shrink-0"
                    style={{ backgroundColor: "#174d82" }}
                    aria-hidden
                  />
                  Complexity score &gt; 115
                </span>
              </div>
            <ResponsiveContainer width="100%" height={400}>
              <BarChart
                data={bars}
                margin={{ top: 10, right: 20, left: 10, bottom: 60 }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke={isDark ? "#334155" : "#e2e8f0"}
                />
                <XAxis
                  dataKey="groupName"
                  type="category"
                  tick={{ fontSize: 11, fill: isDark ? "#94a3b8" : "#64748b" }}
                  angle={-45}
                  textAnchor="end"
                  height={60}
                  interval={0}
                />
                <YAxis
                  type="number"
                  tick={{ fontSize: 11, fill: isDark ? "#94a3b8" : "#64748b" }}
                  label={{
                    value: "Avg complexity",
                    angle: -90,
                    position: "insideLeft",
                    style: { fill: isDark ? "#94a3b8" : "#64748b", fontSize: 11 },
                  }}
                />
                <RechartsTooltip
                  contentStyle={{
                    backgroundColor: isDark ? "#1e293b" : "#ffffff",
                    border: `1px solid ${isDark ? "#334155" : "#e2e8f0"}`,
                    borderRadius: "8px",
                    fontSize: 12,
                  }}
                  formatter={(value: number) => [
                    value.toFixed(1),
                    "Avg complexity",
                  ]}
                  labelFormatter={(label) => {
                    const payload = bars.find((b) => b.groupName === label);
                    const count = payload?.loanCount ?? 0;
                    return `${label} — ${count} loan${count !== 1 ? "s" : ""}`;
                  }}
                />
                <Bar
                  dataKey="avgComplexity"
                  radius={[4, 4, 0, 0]}
                  isAnimationActive={false}
                  minPointSize={8}
                  shape={(props: { x?: number; y?: number; width?: number; height?: number; payload?: { groupName?: string; avgComplexity?: number }; groupName?: string; avgComplexity?: number; [key: string]: unknown }) => {
                    const { x = 0, y = 0, width = 0, height = 0, payload, groupName: gn, avgComplexity: ac } = props;
                    const groupName = payload?.groupName ?? gn;
                    const avgComplexity = payload?.avgComplexity ?? ac;
                    if (groupName == null) return null;
                    const isSelected = selectedGroups.some(
                      (g) => g.dimension === effectiveGroupBy && g.groupName === groupName
                    );
                    const fill = isSelected ? "#52b852" : complexityColorScale(avgComplexity ?? 0);
                    return (
                      <g
                        onClick={() => handleSelectGroup(effectiveGroupBy, groupName)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            handleSelectGroup(effectiveGroupBy, groupName);
                          }
                        }}
                        role="button"
                        tabIndex={0}
                        style={{ cursor: "pointer" }}
                      >
                        <rect
                          x={x}
                          y={y}
                          width={Math.max(width, 4)}
                          height={Math.max(height ?? 0, 4)}
                          fill={fill}
                          rx={4}
                          ry={4}
                        />
                      </g>
                    );
                  }}
                />
              </BarChart>
            </ResponsiveContainer>
            </>
          )}
        </CardContent>
      </Card>

      {/* Loan detail table – always visible; shows all loans in period or filtered by selected individuals */}
      <Card
        data-loan-details-table
        className={cn(
            "rounded-xl border overflow-hidden",
            isDark ? "border-slate-700 bg-slate-800/50" : "border-slate-200/60 bg-white"
          )}
        >
          <CardHeader className="pb-2">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <CardTitle
                  className={cn(
                    "text-base font-semibold",
                    isDark ? "text-white" : "text-slate-900"
                  )}
                >
                  {selectedGroups.length > 0
                    ? selectedGroups.length === 1
                      ? `Loan details — ${selectedGroups[0].groupName}`
                      : `Loan details — ${selectedGroups.length} selected`
                    : "Loan Details"}
                </CardTitle>
                {!loansLoading && !loansError && (
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                    {sortedLoans.length === 0
                      ? "No loans"
                      : `${sortedLoans.length.toLocaleString()} loan${sortedLoans.length === 1 ? "" : "s"}`}
                  </p>
                )}
              </div>
              {!loansLoading && !loansError && sortedLoans.length > 0 && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" className="gap-1.5 shrink-0">
                      <Download className="h-4 w-4" />
                      Download
                      <ChevronDown className="h-3.5 w-3.5 opacity-70" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={exportExcel}>
                      Excel (.xlsx)
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={exportCsv}>
                      CSV (.csv)
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {loansLoading ? (
              <div className="flex justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-sky-500" />
              </div>
            ) : loansError ? (
              <div className="px-4 py-6 text-sm text-amber-700 dark:text-amber-300 bg-amber-50/80 dark:bg-amber-950/30 rounded-lg mx-4 mb-4">
                {loansError}
              </div>
            ) : (
              <div className="overflow-auto max-h-[400px] border-t border-slate-200 dark:border-slate-700">
                <table className="w-full border-collapse text-sm">
                  <thead className="sticky top-0 bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 z-10">
                    <tr>
                      {LOAN_DETAIL_COLUMNS.map((col) => {
                        const isSorted = sortColumnId === col.key;
                        return (
                          <th
                            key={col.key}
                            className={cn(
                              "text-left font-medium text-slate-600 dark:text-slate-400 px-3 py-2 whitespace-nowrap cursor-pointer select-none hover:bg-slate-100 dark:hover:bg-slate-700/50 transition-colors",
                              isDark ? "bg-slate-800" : "bg-slate-50"
                            )}
                            onClick={() => handleSort(col.key)}
                            role="columnheader"
                            aria-sort={
                              isSorted
                                ? sortDirection === "asc"
                                  ? "ascending"
                                  : "descending"
                                : undefined
                            }
                          >
                            <span className="inline-flex items-center gap-1">
                              {col.label}
                              {isSorted &&
                                (sortDirection === "asc" ? (
                                  <ArrowUp className="h-3.5 w-3.5 shrink-0" aria-hidden />
                                ) : (
                                  <ArrowDown className="h-3.5 w-3.5 shrink-0" aria-hidden />
                                ))}
                            </span>
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {sortedLoans.length === 0 ? (
                      <tr>
                        <td
                          colSpan={LOAN_DETAIL_COLUMNS.length}
                          className="px-3 py-6 text-center text-slate-500 dark:text-slate-400"
                        >
                          No loans found
                        </td>
                      </tr>
                    ) : (
                      sortedLoans.map((row) => (
                        <tr
                          key={row.loan_id}
                          className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50/50 dark:hover:bg-slate-800/30"
                        >
                          {LOAN_DETAIL_COLUMNS.map((col) => {
                            const isComplexityCell = col.key === "complexity_score";
                            const cellStyle = isComplexityCell
                              ? getComplexityCellStyle(row.complexity_score)
                              : undefined;
                            return (
                              <td
                                key={col.key}
                                className="px-3 py-2 whitespace-nowrap text-slate-700 dark:text-slate-300"
                                style={cellStyle ?? undefined}
                              >
                                {col.key === "loan_amount"
                                  ? formatVolume(row.loan_amount)
                                  : col.key === "complexity_score"
                                    ? row.complexity_score != null
                                      ? row.complexity_score.toFixed(1)
                                      : "—"
                                    : formatCell(row[col.key])}
                              </td>
                            );
                          })}
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

    </div>
  );
}
