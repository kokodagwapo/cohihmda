/**
 * Pricing Dashboard View
 * Filters, KPIs, and four tabbed tables (Loan Officer Report/Detail, Entity Report/Detail).
 */

import React, { useState, useMemo, useCallback } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useTheme } from "@/components/theme-provider";
import { usePricingDashboardData } from "@/hooks/usePricingDashboardData";
import type {
  PricingDashboardFilters,
  PricingEntityType,
  PricingActorType,
  PricingDateRange,
  PricingLoanFunding,
  PricingLoanStatus,
  PricingLockStatus,
  PricingReportRow,
  PricingDetailRow,
} from "@/hooks/usePricingDashboardData";
import { Loader2, ArrowUp, ArrowDown, X, SlidersHorizontal, Download } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { usePricingDashboardStandaloneColumnsStore } from "@/stores/pricingDashboardStandaloneColumnsStore";
import { PricingDashboardColumnsModal } from "@/components/widgets/components/PricingDashboardColumnsModal";

const ENTITY_TYPE_OPTIONS: { value: PricingEntityType; label: string }[] = [
  { value: "branch", label: "Branch" },
  { value: "broker_lender_name", label: "Broker Lender Name" },
  { value: "channel", label: "Channel" },
  { value: "investor", label: "Investor" },
];

const ACTOR_TYPE_OPTIONS: { value: PricingActorType; label: string }[] = [
  { value: "loan_officer", label: "Loan Officer" },
  { value: "account_executive", label: "Account Executive" },
];

const DATE_RANGE_OPTIONS: { value: PricingDateRange; label: string }[] = [
  { value: "all", label: "All Time" },
  { value: "mtd", label: "Month to Date" },
  { value: "lm", label: "Last Month" },
  { value: "qtd", label: "Quarter to Date" },
  { value: "ytd", label: "Year to Date" },
  { value: "ly", label: "Last Year" },
];

const LOAN_FUNDING_OPTIONS: { value: PricingLoanFunding; label: string }[] = [
  { value: "funded", label: "Funded Loans" },
  { value: "closed", label: "Closed Loans" },
];

const LOAN_STATUS_OPTIONS: { value: PricingLoanStatus; label: string }[] = [
  { value: "all", label: "All Statuses" },
  { value: "active", label: "Active" },
  { value: "funded", label: "Funded" },
];

const LOCK_STATUS_OPTIONS: { value: PricingLockStatus; label: string }[] = [
  { value: "locked", label: "Active Locked Loans" },
  { value: "not_locked", label: "Active Not Locked Loans" },
  { value: "total", label: "Active Total Loans" },
];

function formatCurrency(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatNum(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

/** Display date-only for datetime strings (e.g. "2026-01-20 00:00:00+00" -> "2026-01-20"). Frontend display only. */
function formatDateOnly(value: string | null | undefined): string {
  if (value == null || typeof value !== "string") return "";
  const s = value.trim();
  if (!s) return "";
  const datePart = s.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(datePart)) return datePart;
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return s;
}

function getEntityLabel(type: PricingEntityType): string {
  return ENTITY_TYPE_OPTIONS.find((o) => o.value === type)?.label ?? type;
}

function getActorLabel(type: PricingActorType): string {
  return ACTOR_TYPE_OPTIONS.find((o) => o.value === type)?.label ?? type;
}

function getReportSortValue(row: PricingReportRow, key: keyof PricingReportRow): number | string | null {
  const v = row[key];
  if (v === undefined || v === null) return null;
  if (typeof v === "number") return v;
  return String(v).trim() || null;
}

function sortReportRows(
  rows: PricingReportRow[],
  key: keyof PricingReportRow,
  direction: "asc" | "desc"
): PricingReportRow[] {
  const mult = direction === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const va = getReportSortValue(a, key);
    const vb = getReportSortValue(b, key);
    const aNull = va === null || va === "";
    const bNull = vb === null || vb === "";
    if (aNull && bNull) return 0;
    if (aNull) return mult * 1;
    if (bNull) return mult * -1;
    if (typeof va === "number" && typeof vb === "number") return mult * (va - vb);
    return mult * String(va).localeCompare(String(vb), undefined, { numeric: true });
  });
}

function getDetailSortValue(row: PricingDetailRow, key: string): number | string | null {
  const v = (row as unknown as Record<string, unknown>)[key];
  if (v === undefined || v === null) return null;
  if (typeof v === "number") return v;
  return String(v).trim() || null;
}

function sortDetailRows(
  rows: PricingDetailRow[],
  key: string,
  direction: "asc" | "desc"
): PricingDetailRow[] {
  const mult = direction === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const va = getDetailSortValue(a, key);
    const vb = getDetailSortValue(b, key);
    const aNull = va === null || va === "";
    const bNull = vb === null || vb === "";
    if (aNull && bNull) return 0;
    if (aNull) return mult * 1;
    if (bNull) return mult * -1;
    if (typeof va === "number" && typeof vb === "number") return mult * (va - vb);
    return mult * String(va).localeCompare(String(vb), undefined, { numeric: true });
  });
}

/** Escape a cell value for CSV (wrap in quotes if contains comma, newline, or quote). */
function csvEscape(val: string): string {
  if (val.includes(",") || val.includes('"') || val.includes("\n") || val.includes("\r")) {
    return `"${val.replace(/"/g, '""')}"`;
  }
  return val;
}

/** Build CSV string from columns and rows, optionally prepend a totals row. */
function buildCsv(
  columns: { key: string; label: string }[],
  rows: Record<string, unknown>[],
  totals?: Record<string, unknown>
): string {
  const header = columns.map((c) => csvEscape(c.label)).join(",");
  const lines: string[] = [header];
  if (totals) {
    const totalRow = columns.map((c) => {
      const v = totals[c.key];
      if (v === undefined || v === null) return "";
      return csvEscape(String(v));
    }).join(",");
    lines.push(totalRow);
  }
  for (const row of rows) {
    const cells = columns.map((c) => {
      const v = row[c.key];
      if (v === undefined || v === null) return "";
      if (typeof v === "number") return String(v);
      return csvEscape(String(v));
    });
    lines.push(cells.join(","));
  }
  return lines.join("\r\n");
}

/** Trigger download of a CSV file. */
function downloadCsv(content: string, filename: string): void {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export interface PricingDashboardViewProps {
  /** Effective tenant for API (selectedTenantId || user?.tenant_id); required for platform staff */
  tenantId?: string | null;
  selectedTenantId?: string | null;
  selectedChannel?: string | null;
}

type TabId = "loan_officer_report" | "loan_officer_detail" | "entity_report" | "entity_detail";

export function PricingDashboardView({
  tenantId,
  selectedTenantId: _selectedTenantId,
  selectedChannel,
}: PricingDashboardViewProps) {
  const { theme } = useTheme();
  const isDark = theme === "dark";

  const [entityType, setEntityType] = useState<PricingEntityType>("branch");
  const [actorType, setActorType] = useState<PricingActorType>("loan_officer");
  const [dateRange, setDateRange] = useState<PricingDateRange>("mtd");
  const [loanFunding, setLoanFunding] = useState<PricingLoanFunding>("funded");
  const [loanStatus, setLoanStatus] = useState<PricingLoanStatus>("active");
  const [lockStatus, setLockStatus] = useState<PricingLockStatus>("total");
  const [activeTab, setActiveTab] = useState<TabId>("loan_officer_report");
  const [reportSortKey, setReportSortKey] = useState<keyof PricingReportRow>("entityName");
  const [reportSortDir, setReportSortDir] = useState<"asc" | "desc">("asc");
  const [detailSortKey, setDetailSortKey] = useState<string>("entityName");
  const [detailSortDir, setDetailSortDir] = useState<"asc" | "desc">("asc");
  const [selectedEntityOrActor, setSelectedEntityOrActor] = useState<
    | { kind: "entity"; entityType: PricingEntityType; value: string; label: string }
    | { kind: "actor"; actorType: PricingActorType; value: string; label: string }
    | null
  >(null);
  const [editColumnsModalOpen, setEditColumnsModalOpen] = useState(false);
  const standaloneColumns = usePricingDashboardStandaloneColumnsStore((s) => s.columns);
  const getStandaloneColumns = usePricingDashboardStandaloneColumnsStore((s) => s.getColumns);

  const filters: PricingDashboardFilters = useMemo(
    () => ({
      channel: selectedChannel ?? undefined,
      entityType,
      entityFilterType: selectedEntityOrActor?.kind === "entity" ? selectedEntityOrActor.entityType : undefined,
      entityValue: selectedEntityOrActor?.kind === "entity" ? selectedEntityOrActor.value : "",
      actorType,
      actorFilterType: selectedEntityOrActor?.kind === "actor" ? selectedEntityOrActor.actorType : undefined,
      actorValue: selectedEntityOrActor?.kind === "actor" ? selectedEntityOrActor.value : "",
      dateRange,
      loanFunding,
      loanStatus,
      lockStatus,
    }),
    [
      selectedChannel,
      entityType,
      actorType,
      dateRange,
      loanFunding,
      loanStatus,
      lockStatus,
      selectedEntityOrActor,
    ]
  );

  const clearEntityOrActorFilter = useCallback(() => setSelectedEntityOrActor(null), []);

  const reportType = activeTab === "entity_report" ? "entity_report" : "loan_officer_report";
  const detailType = activeTab === "entity_detail" ? "entity_detail" : "loan_officer_detail";

  const {
    kpis,
    reportRows,
    reportTotals,
    detailRows,
    detailTotals,
    loading,
    error,
  } = usePricingDashboardData(filters, {
    reportType,
    detailType,
    tenantId,
    selectedChannel,
  });

  const entityLabel = getEntityLabel(entityType);
  const actorLabel = getActorLabel(actorType);
  const subtitleLabel = kpis?.labelPrefix ?? "Active Locked";
  const displayError =
    error != null
      ? error.includes("No tenant selected") || error.includes("Tenant context required")
        ? "Select a tenant to view pricing data."
        : error
      : null;

  const borderTh = isDark ? "border-slate-700" : "border-slate-200";
  const bgTh = isDark ? "bg-slate-800/50 text-slate-300" : "bg-slate-50 text-slate-600";
  const borderRow = isDark ? "border-slate-700" : "border-slate-100";
  const textTd = isDark ? "text-slate-200" : "text-slate-900";

  const reportColumns: { key: keyof PricingReportRow; label: string }[] = useMemo(() => {
    const metricCols = getStandaloneColumns();
    const isBranchReport = activeTab === "entity_report" && entityType === "branch";
    const cols: { key: keyof PricingReportRow; label: string }[] = [
      { key: "entityName", label: `Entity: ${entityLabel}` },
    ];
    if (!isBranchReport) cols.push({ key: "actorName", label: `Actor: ${actorLabel}` });
    metricCols.forEach((m) => cols.push({ key: m.key as keyof PricingReportRow, label: m.label }));
    return cols;
  }, [activeTab, entityType, entityLabel, actorLabel, standaloneColumns, getStandaloneColumns]);

  const detailColumnsEntityDetail = useMemo(
    () => {
      const metricCols = getStandaloneColumns();
      const base = [
        { key: "entityName", label: `Entity: ${entityLabel}` },
        { key: "loanNumber", label: "Loan Number" },
      ] as { key: string; label: string }[];
      if (loanStatus !== "funded") {
        base.push({ key: "applicationDate", label: "Application Date" });
        base.push({ key: "lockExpirationDate", label: "Lock Expiration Date" });
      }
      if (loanStatus === "funded" || loanStatus === "all") {
        base.push(
          loanFunding === "funded"
            ? { key: "fundingDate", label: "Funded Date" }
            : { key: "closingDate", label: "Closing Date" }
        );
      }
      if (loanStatus !== "active") {
        base.push({ key: "currentLoanStatus", label: "Current Loan Status" });
      }
      metricCols.forEach((m) => base.push({ key: m.key, label: m.label }));
      return base;
    },
    [entityLabel, loanFunding, loanStatus, standaloneColumns, getStandaloneColumns]
  );

  const detailColumnsWithActor = [
    { key: "entityName", label: `Entity: ${entityLabel}` },
    { key: "actorName", label: `Actor: ${actorLabel}` },
    ...detailColumnsEntityDetail.slice(1),
  ];

  const isDetailTab = activeTab === "loan_officer_detail" || activeTab === "entity_detail";
  const isEntityDetail = activeTab === "entity_detail";
  const detailCols = isEntityDetail ? detailColumnsEntityDetail : detailColumnsWithActor;

  const sortedReportRows = useMemo(
    () => sortReportRows(reportRows, reportSortKey, reportSortDir),
    [reportRows, reportSortKey, reportSortDir]
  );

  const sortedDetailRows = useMemo(
    () => sortDetailRows(detailRows, detailSortKey, detailSortDir),
    [detailRows, detailSortKey, detailSortDir]
  );

  const handleReportSort = useCallback((key: keyof PricingReportRow) => {
    setReportSortKey((prev) => {
      if (prev === key) {
        setReportSortDir((d) => (d === "asc" ? "desc" : "asc"));
        return prev;
      }
      setReportSortDir("desc");
      return key;
    });
  }, []);

  const handleDetailSort = useCallback((key: string) => {
    setDetailSortKey((prev) => {
      if (prev === key) {
        setDetailSortDir((d) => (d === "asc" ? "desc" : "asc"));
        return prev;
      }
      setDetailSortDir("desc");
      return key;
    });
  }, []);

  const handleExportTable = useCallback(() => {
    const isReport = activeTab === "loan_officer_report" || activeTab === "entity_report";
    const baseName = activeTab.replace(/_/g, "-");
    const filename = `pricing-${baseName}-${new Date().toISOString().slice(0, 10)}.csv`;
    if (isReport) {
      const cols = reportColumns.map((c) => ({ key: c.key as string, label: c.label }));
      const csv = buildCsv(cols, sortedReportRows as Record<string, unknown>[], reportTotals as Record<string, unknown>);
      downloadCsv(csv, filename);
    } else {
      const csv = buildCsv(detailCols, sortedDetailRows as Record<string, unknown>[], detailTotals as Record<string, unknown>);
      downloadCsv(csv, filename);
    }
  }, [
    activeTab,
    reportColumns,
    detailCols,
    sortedReportRows,
    sortedDetailRows,
    reportTotals,
    detailTotals,
  ]);

  const renderReportTable = () => {
    const totals = reportTotals;
    return (
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className={cn("border-b", borderTh, bgTh)}>
              {reportColumns.map((c) => {
                const isSorted = reportSortKey === c.key;
                const isRightAlign = c.key !== "entityName" && c.key !== "actorName";
                return (
                  <th
                    key={c.key}
                    className={cn(
                      "py-2.5 px-4 font-semibold whitespace-nowrap cursor-pointer select-none hover:opacity-80 transition-opacity",
                      isRightAlign ? "text-right" : "text-left"
                    )}
                    onClick={() => handleReportSort(c.key)}
                    role="columnheader"
                    aria-sort={isSorted ? (reportSortDir === "asc" ? "ascending" : "descending") : undefined}
                  >
                    <span className="inline-flex items-center gap-1">
                      {c.label}
                      {isSorted &&
                        (reportSortDir === "asc" ? (
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
            {reportRows.length > 0 && (
              <tr className={cn("border-b", borderRow, isDark ? "bg-slate-800/70" : "bg-slate-100/90")}>
                <td className="py-2 px-4 font-medium">Totals</td>
                {reportColumns.slice(1).map((c) => {
                  if (c.key === "actorName") return <td key={c.key} className="py-2 px-4" />;
                  const val = totals[c.key as keyof typeof totals];
                  if (val === undefined) return <td key={c.key} className="py-2 px-4 text-right" />;
                  if (typeof val === "number") {
                    return (
                      <td key={c.key} className="py-2 px-4 text-right">
                        {c.key === "pricingMargin" ? formatNum(val) : formatCurrency(val)}
                      </td>
                    );
                  }
                  return <td key={c.key} className="py-2 px-4 text-right">{String(val)}</td>;
                })}
              </tr>
            )}
            {sortedReportRows.map((row, i) => (
              <tr key={i} className={cn("border-b", borderRow)}>
                {reportColumns.map((c) => {
                  const val = row[c.key as keyof PricingReportRow];
                  const isNumber = typeof val === "number";
                  const isRightAlign = isNumber || c.key === "units";
                  const isEntityOrActor = c.key === "entityName" || c.key === "actorName";
                  const canSelect = isEntityOrActor && val != null && String(val).trim() !== "";
                  return (
                    <td
                      key={c.key}
                      className={cn(
                        "py-3 px-4",
                        textTd,
                        isRightAlign ? "text-right" : "",
                        canSelect && "cursor-pointer hover:underline hover:opacity-90"
                      )}
                      role={canSelect ? "button" : undefined}
                      onClick={
                        canSelect
                          ? () =>
                              setSelectedEntityOrActor(
                                c.key === "entityName"
                                  ? { kind: "entity", entityType, value: String(val), label: String(val) }
                                  : { kind: "actor", actorType, value: String(val), label: String(val) }
                              )
                          : undefined
                      }
                    >
                      {typeof val === "number"
                        ? c.key === "units" || c.key === "pricingMargin"
                          ? formatNum(val)
                          : formatCurrency(val)
                        : String(val ?? "")}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  const renderDetailTable = () => {
    const totals = detailTotals;
    return (
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className={cn("border-b", borderTh, bgTh)}>
              {detailCols.map((c) => {
                const isSorted = detailSortKey === c.key;
                return (
                  <th
                    key={c.key}
                    className={cn(
                      "py-2.5 px-4 font-semibold whitespace-nowrap cursor-pointer select-none hover:opacity-80 transition-opacity",
                      ["volume", "loanPricingDollars", "pricingMargin", "cdLenderCredits"].includes(c.key)
                        ? "text-right"
                        : "text-left"
                    )}
                    onClick={() => handleDetailSort(c.key)}
                    role="columnheader"
                    aria-sort={isSorted ? (detailSortDir === "asc" ? "ascending" : "descending") : undefined}
                  >
                    <span className="inline-flex items-center gap-1">
                      {c.label}
                      {isSorted &&
                        (detailSortDir === "asc" ? (
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
            {detailRows.length > 0 && (
              <tr className={cn("border-b", borderRow, isDark ? "bg-slate-800/70" : "bg-slate-100/90")}>
                {detailCols.map((c, idx) => {
                  if (idx === 0) return <td key={c.key} className="py-2 px-4 font-medium">Totals</td>;
                  if (["loanNumber", "applicationDate", "lockExpirationDate", "fundingDate", "closingDate", "currentLoanStatus"].includes(c.key))
                    return <td key={c.key} className="py-2 px-4" />;
                  const val = totals[c.key as keyof typeof totals];
                  if (val === undefined) return <td key={c.key} className="py-2 px-4 text-right" />;
                  return (
                    <td key={c.key} className="py-2 px-4 text-right">
                      {typeof val === "number" ? (c.key === "pricingMargin" ? formatNum(val) : formatCurrency(val)) : String(val)}
                    </td>
                  );
                })}
              </tr>
            )}
            {sortedDetailRows.map((row, i) => (
              <tr key={i} className={cn("border-b", borderRow)}>
                {detailCols.map((c) => {
                  const val = row[c.key as keyof PricingDetailRow];
                  const isNum = typeof val === "number";
                  const isRight = isNum || ["loanNumber", "applicationDate", "lockExpirationDate"].includes(c.key);
                  const isDateCol = ["applicationDate", "lockExpirationDate", "fundingDate", "closingDate"].includes(c.key);
                  const isEntityOrActor = c.key === "entityName" || c.key === "actorName";
                  const canSelect = isEntityOrActor && val != null && String(val).trim() !== "";
                  const displayVal =
                    val == null
                      ? ""
                      : isNum
                        ? c.key === "pricingMargin"
                          ? formatNum(val)
                          : formatCurrency(val)
                        : isDateCol
                          ? formatDateOnly(val as string)
                          : String(val);
                  return (
                    <td
                      key={c.key}
                      className={cn(
                        "py-3 px-4",
                        textTd,
                        isRight ? "text-right" : "",
                        canSelect && "cursor-pointer hover:underline hover:opacity-90"
                      )}
                      role={canSelect ? "button" : undefined}
                      onClick={
                        canSelect
                          ? () =>
                              setSelectedEntityOrActor(
                                c.key === "entityName"
                                  ? { kind: "entity", entityType, value: String(val), label: String(val) }
                                  : { kind: "actor", actorType, value: String(val), label: String(val) }
                              )
                          : undefined
                      }
                    >
                      {displayVal}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* Filters */}
      <Card className={cn("rounded-xl border", isDark ? "border-slate-700 bg-slate-800/50" : "border-slate-200/60 bg-white")}>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Filters</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Entity</label>
            <Select value={entityType} onValueChange={(v) => setEntityType(v as PricingEntityType)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ENTITY_TYPE_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Actor</label>
            <Select value={actorType} onValueChange={(v) => setActorType(v as PricingActorType)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ACTOR_TYPE_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Date range</label>
            <Select value={dateRange} onValueChange={(v) => setDateRange(v as PricingDateRange)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DATE_RANGE_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Loan status</label>
            <Select value={loanStatus} onValueChange={(v) => setLoanStatus(v as PricingLoanStatus)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LOAN_STATUS_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {(loanStatus === "funded" || loanStatus === "all") && (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Loan funding</label>
              <Select value={loanFunding} onValueChange={(v) => setLoanFunding(v as PricingLoanFunding)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LOAN_FUNDING_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {loanStatus === "active" && (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Lock status</label>
              <Select value={lockStatus} onValueChange={(v) => setLockStatus(v as PricingLockStatus)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LOCK_STATUS_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {selectedEntityOrActor && (
            <div className="flex items-center gap-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-800/50 px-3 py-2 col-span-full sm:col-span-1">
              <div className="flex flex-col min-w-0">
                <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  {selectedEntityOrActor.kind === "entity"
                    ? getEntityLabel(selectedEntityOrActor.entityType)
                    : getActorLabel(selectedEntityOrActor.actorType)}
                </span>
                <span className="text-sm text-slate-600 dark:text-slate-400 truncate" title={selectedEntityOrActor.label}>
                  {selectedEntityOrActor.label}
                </span>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0 rounded-full text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                onClick={clearEntityOrActorFilter}
                aria-label="Clear filter"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          )}
          <div className="flex items-end">
            <Button
              variant="outline"
              size="sm"
              className="h-9 gap-1.5"
              onClick={() => setEditColumnsModalOpen(true)}
            >
              <SlidersHorizontal className="h-4 w-4" />
              Edit columns
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {loading && !kpis ? (
          [...Array(4)].map((_, i) => (
            <Card key={i} className={cn("rounded-xl border", isDark ? "border-slate-700 bg-slate-800/50" : "border-slate-200/60 bg-white")}>
              <CardContent className="pt-6 flex items-center justify-center h-24">
                <Loader2 className="h-8 w-8 animate-spin text-sky-500" />
              </CardContent>
            </Card>
          ))
        ) : (
          <>
            {/* Pipeline Units - blue */}
            <Card className={cn("rounded-xl backdrop-blur-sm overflow-hidden transition-all duration-300 hover:shadow-lg", isDark ? "border-slate-700/50 bg-gradient-to-br from-blue-900/20 via-slate-800/70 to-slate-800/70 hover:border-blue-600/50" : "border-blue-200/40 bg-gradient-to-br from-blue-50 via-white to-white hover:border-blue-400/50 hover:shadow-blue-200/50")}>
              <CardContent className="pt-4 pb-4 relative">
                <p className={cn("text-[10px] font-semibold mb-1 uppercase tracking-wider", isDark ? "text-slate-400" : "text-slate-600")}>
                  {subtitleLabel} Pipeline Units
                </p>
                <p className={cn("text-3xl font-bold tracking-tight", isDark ? "text-white" : "text-slate-900")}>
                  {kpis ? formatNum(kpis.units) : "—"}
                </p>
                <div className={cn("absolute top-0 right-0 w-20 h-20 rounded-full blur-2xl opacity-20", isDark ? "bg-blue-500" : "bg-blue-300")} />
              </CardContent>
            </Card>
            {/* Pipeline Volume - purple */}
            <Card className={cn("rounded-xl backdrop-blur-sm overflow-hidden transition-all duration-300 hover:shadow-lg", isDark ? "border-slate-700/50 bg-gradient-to-br from-purple-900/20 via-slate-800/70 to-slate-800/70 hover:border-purple-600/50" : "border-purple-200/40 bg-gradient-to-br from-purple-50 via-white to-white hover:border-purple-400/50 hover:shadow-purple-200/50")}>
              <CardContent className="pt-4 pb-4 relative">
                <p className={cn("text-[10px] font-semibold mb-1 uppercase tracking-wider", isDark ? "text-slate-400" : "text-slate-600")}>
                  {subtitleLabel} Pipeline Volume
                </p>
                <p className={cn("text-3xl font-bold tracking-tight", isDark ? "text-white" : "text-slate-900")}>
                  {kpis ? formatCurrency(kpis.volume) : "—"}
                </p>
                <div className={cn("absolute top-0 right-0 w-20 h-20 rounded-full blur-2xl opacity-20", isDark ? "bg-purple-500" : "bg-purple-300")} />
              </CardContent>
            </Card>
            {/* Pipeline Margin - amber */}
            <Card className={cn("rounded-xl backdrop-blur-sm overflow-hidden transition-all duration-300 hover:shadow-lg", isDark ? "border-slate-700/50 bg-gradient-to-br from-amber-900/20 via-slate-800/70 to-slate-800/70 hover:border-amber-600/50" : "border-amber-200/40 bg-gradient-to-br from-amber-50 via-white to-white hover:border-amber-400/50 hover:shadow-amber-200/50")}>
              <CardContent className="pt-4 pb-4 relative">
                <p className={cn("text-[10px] font-semibold mb-1 uppercase tracking-wider", isDark ? "text-slate-400" : "text-slate-600")}>
                  {subtitleLabel} Pipeline Margin
                </p>
                <p className={cn("text-3xl font-bold tracking-tight", isDark ? "text-white" : "text-slate-900")}>
                  {kpis != null ? formatNum(kpis.pipelineMargin) : "—"}
                </p>
                <div className={cn("absolute top-0 right-0 w-20 h-20 rounded-full blur-2xl opacity-20", isDark ? "bg-amber-500" : "bg-amber-300")} />
              </CardContent>
            </Card>
            {/* Pricing $ - emerald */}
            <Card className={cn("rounded-xl backdrop-blur-sm overflow-hidden transition-all duration-300 hover:shadow-lg", isDark ? "border-slate-700/50 bg-gradient-to-br from-emerald-900/20 via-slate-800/70 to-slate-800/70 hover:border-emerald-600/50" : "border-emerald-200/40 bg-gradient-to-br from-emerald-50 via-white to-white hover:border-emerald-400/50 hover:shadow-emerald-200/50")}>
              <CardContent className="pt-4 pb-4 relative">
                <p className={cn("text-[10px] font-semibold mb-1 uppercase tracking-wider", isDark ? "text-slate-400" : "text-slate-600")}>
                  {subtitleLabel} Pricing $
                </p>
                <p className={cn("text-3xl font-bold tracking-tight", isDark ? "text-white" : "text-slate-900")}>
                  {kpis ? formatCurrency(kpis.pricingDollars) : "—"}
                </p>
                <div className={cn("absolute top-0 right-0 w-20 h-20 rounded-full blur-2xl opacity-20", isDark ? "bg-emerald-500" : "bg-emerald-300")} />
              </CardContent>
            </Card>
          </>
        )}
      </div>

      {/* Tabs + Table */}
      <Card className={cn("rounded-xl border overflow-hidden", isDark ? "border-slate-700 bg-slate-800/50" : "border-slate-200/60 bg-white")}>
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabId)}>
          <div className="border-b border-slate-200/60 dark:border-slate-700/60 px-4 pt-4">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <TabsList className={cn("bg-slate-100/80 dark:bg-slate-800/80 p-0.5 rounded-lg")}>
                <TabsTrigger
                  value="loan_officer_report"
                  className="rounded-md data-[state=active]:bg-[#10B981]/10 data-[state=active]:text-emerald-900 data-[state=active]:shadow-sm dark:data-[state=active]:bg-[#10B981]/20 dark:data-[state=active]:text-emerald-100"
                >
                  Loan Officer Report
                </TabsTrigger>
                <TabsTrigger
                  value="loan_officer_detail"
                  className="rounded-md data-[state=active]:bg-[#10B981]/40 data-[state=active]:text-emerald-900 data-[state=active]:shadow-sm dark:data-[state=active]:bg-[#10B981]/50 dark:data-[state=active]:text-emerald-100"
                >
                  Loan Officer Detail
                </TabsTrigger>
                <TabsTrigger
                  value="entity_report"
                  className="rounded-md data-[state=active]:bg-blue-50 data-[state=active]:text-blue-800 data-[state=active]:shadow-sm dark:data-[state=active]:bg-blue-900/30 dark:data-[state=active]:text-blue-200"
                >
                  {entityLabel} Report
                </TabsTrigger>
                <TabsTrigger
                  value="entity_detail"
                  className="rounded-md data-[state=active]:bg-blue-200 data-[state=active]:text-blue-900 data-[state=active]:shadow-sm dark:data-[state=active]:bg-blue-800/50 dark:data-[state=active]:text-blue-100"
                >
                  {entityLabel} Detail
                </TabsTrigger>
              </TabsList>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 shrink-0"
                onClick={handleExportTable}
                disabled={loading || (isDetailTab ? detailRows.length === 0 : reportRows.length === 0)}
              >
                <Download className="h-4 w-4" />
                Export CSV
              </Button>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">
              {activeTab === "loan_officer_report" && "Loan Officer Report"}
              {activeTab === "loan_officer_detail" && "Loan Officer Detail"}
              {activeTab === "entity_report" && `${entityLabel} Report`}
              {activeTab === "entity_detail" && `${entityLabel} Detail`}
              : {subtitleLabel} Loans
            </p>
          </div>
          <TabsContent value="loan_officer_report" className="mt-0 p-4">
            {displayError && <p className="text-sm text-red-600 dark:text-red-400 mb-4">{displayError}</p>}
            {loading ? <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-sky-500" /></div> : renderReportTable()}
          </TabsContent>
          <TabsContent value="loan_officer_detail" className="mt-0 p-4">
            {displayError && <p className="text-sm text-red-600 dark:text-red-400 mb-4">{displayError}</p>}
            {loading ? <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-sky-500" /></div> : renderDetailTable()}
          </TabsContent>
          <TabsContent value="entity_report" className="mt-0 p-4">
            {displayError && <p className="text-sm text-red-600 dark:text-red-400 mb-4">{displayError}</p>}
            {loading ? <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-sky-500" /></div> : renderReportTable()}
          </TabsContent>
          <TabsContent value="entity_detail" className="mt-0 p-4">
            {displayError && <p className="text-sm text-red-600 dark:text-red-400 mb-4">{displayError}</p>}
            {loading ? <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-sky-500" /></div> : renderDetailTable()}
          </TabsContent>
        </Tabs>
      </Card>

      <PricingDashboardColumnsModal
        open={editColumnsModalOpen}
        onClose={() => setEditColumnsModalOpen(false)}
      />
    </div>
  );
}
