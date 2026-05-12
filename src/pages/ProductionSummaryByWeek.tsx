import { useCallback, useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { TopTieringLayout } from "@/components/layout/TopTieringLayout";
import { TopTieringTopBar } from "@/components/layout/TopTieringTopBar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { useTenantStore } from "@/stores/tenantStore";
import { useAuth } from "@/contexts/AuthContext";
import { useWidgetSectionStore } from "@/stores/widgetSectionStore";
import { useLoanDetailData, type LoanDetailRow } from "@/hooks/useLoanDetailData";
import {
  normalizeProductionSummaryByWeekViewState,
  persistProductionSummaryByWeekFiltersLocally,
  useProductionSummaryByWeekViewState,
} from "@/hooks/useProductionSummaryByWeekViewState";
import { useDashboardFilterAnalytics } from "@/hooks/useDashboardFilterAnalytics";
import { DASHBOARD_PAGE_KEYS } from "@/lib/dashboardPageKeys";
import { ArrowDown, ArrowUp, Download, Loader2, Maximize2, X } from "lucide-react";
import { endOfWeek, getWeek, startOfWeek } from "date-fns";
import { useVirtualizer } from "@tanstack/react-virtual";

type SummaryDateField = "started_date" | "application_date" | "investor_lock_date" | "funding_date" | "closing_date";

type SummaryRow = {
  yearWeek: string;
  earliestDate: string | null;
  units: number;
  volume: number;
  averageBalance: number;
  wac: number | null;
  waLtv: number | null;
  waFico: number | null;
};

type LoanDetailDisplayRow = {
  loanNumber: string;
  loanVolume: number;
  currentLoanStatus: string;
  lastCompletedMilestone: string;
  loanFolder: string;
  loanProgram: string;
  startedDate: string | null;
  applicationDate: string | null;
  lockDate: string | null;
  fundingDate: string | null;
  closingDate: string | null;
};

type SortDirection = "asc" | "desc";
type SummarySortKey = keyof SummaryRow;
type LoanDetailSortKey = keyof LoanDetailDisplayRow;
type YearWeekFilterState = Record<SummaryDateField, string[]>;

const rowBg = "border-blue-200/40 bg-white dark:border-slate-700/50 dark:bg-slate-800/70";
const TABLE_ROW_HEIGHT_PX = 36;
const TABLE_VISIBLE_ROWS = 20;
const TABLE_SCROLL_HEIGHT_PX = TABLE_ROW_HEIGHT_PX * TABLE_VISIBLE_ROWS;
const TABLE_OVERSCAN_ROWS = 10;
const YEARWEEK_FILTER_LABELS: Record<SummaryDateField, string> = {
  started_date: "Started YearWeek",
  application_date: "Application YearWeek",
  investor_lock_date: "Lock YearWeek",
  funding_date: "Funding YearWeek",
  closing_date: "Closing YearWeek",
};
const EMPTY_YEARWEEK_FILTERS: YearWeekFilterState = {
  started_date: [],
  application_date: [],
  investor_lock_date: [],
  funding_date: [],
  closing_date: [],
};

const SUMMARY_TABLE_CONFIGS: Array<{
  key: SummaryDateField;
  title: string;
  earliestDateLabel: string;
}> = [
  { key: "started_date", title: "Started Date", earliestDateLabel: "Earliest Start Date" },
  { key: "application_date", title: "Application Date", earliestDateLabel: "Earliest Application Date" },
  { key: "investor_lock_date", title: "Lock Date", earliestDateLabel: "Earliest Lock Date" },
  { key: "funding_date", title: "Funding Date", earliestDateLabel: "Earliest Funding Date" },
  { key: "closing_date", title: "Closing Date", earliestDateLabel: "Earliest Closing Date" },
];

function toDateSafe(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatDate(value: string | null | undefined): string {
  const parsed = toDateSafe(value);
  if (!parsed) return "-";
  return parsed.toLocaleDateString("en-US");
}

function formatVolume(value: number): string {
  return `$${Math.round(value).toLocaleString("en-US")}`;
}

function formatMetric(value: number | null, digits: number): string {
  if (value == null || !Number.isFinite(value)) return "-";
  return value.toFixed(digits);
}

function formatUnits(value: number): string {
  return value.toLocaleString("en-US");
}

function normalizeText(value: string | null | undefined): string {
  return value && value.trim().length > 0 ? value : "-";
}

function toNumberSafe(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const cleaned = value.replace(/[$,%\s,]/g, "");
    if (!cleaned) return 0;
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function getYearWeekLabel(date: Date): string {
  const weekStart = startOfWeek(date, { weekStartsOn: 0 });
  const weekEnd = endOfWeek(date, { weekStartsOn: 0 });
  const year = weekStart.getFullYear() === weekEnd.getFullYear() ? weekStart.getFullYear() : weekEnd.getFullYear();
  const week = getWeek(weekStart, { weekStartsOn: 0, firstWeekContainsDate: 1 });
  return `${year}-W${String(week).padStart(2, "0")}`;
}

function getLoanYearWeek(loan: LoanDetailRow, field: SummaryDateField): string | null {
  const dt = toDateSafe(loan[field]);
  if (!dt) return null;
  return getYearWeekLabel(dt);
}

function compareDateStringsAsc(a: string | null | undefined, b: string | null | undefined): number {
  const da = toDateSafe(a);
  const db = toDateSafe(b);
  if (!da && !db) return 0;
  if (!da) return 1;
  if (!db) return -1;
  return da.getTime() - db.getTime();
}

function computeWeightedAverage(
  loans: LoanDetailRow[],
  metricAccessor: (loan: LoanDetailRow) => number | null | undefined,
): number | null {
  let weightedSum = 0;
  let totalWeight = 0;
  for (const loan of loans) {
    const volume = toNumberSafe(loan.loan_amount);
    const metric = toNumberSafe(metricAccessor(loan));
    if (volume > 0 && metric > 0) {
      weightedSum += metric * volume;
      totalWeight += volume;
    }
  }
  if (totalWeight === 0) return null;
  return weightedSum / totalWeight;
}

function buildSummaryRows(loans: LoanDetailRow[], dateField: SummaryDateField): SummaryRow[] {
  const buckets = new Map<string, LoanDetailRow[]>();
  for (const loan of loans) {
    const dateValue = loan[dateField];
    const date = toDateSafe(dateValue);
    if (!date) continue;
    const yearWeek = getYearWeekLabel(date);
    const current = buckets.get(yearWeek) ?? [];
    current.push(loan);
    buckets.set(yearWeek, current);
  }

  const rows: SummaryRow[] = [];
  for (const [yearWeek, groupLoans] of buckets.entries()) {
    const units = groupLoans.length;
    const volume = groupLoans.reduce((sum, loan) => sum + toNumberSafe(loan.loan_amount), 0);
    const earliestLoan = [...groupLoans]
      .map((loan) => loan[dateField])
      .filter((v): v is string => Boolean(v))
      .sort(compareDateStringsAsc)[0] ?? null;
    rows.push({
      yearWeek,
      earliestDate: earliestLoan,
      units,
      volume,
      averageBalance: units > 0 ? volume / units : 0,
      wac: computeWeightedAverage(groupLoans, (loan) => loan.interest_rate),
      waLtv: computeWeightedAverage(groupLoans, (loan) => loan.ltv_ratio),
      waFico: computeWeightedAverage(groupLoans, (loan) => loan.fico_score),
    });
  }

  return rows.sort((a, b) => b.yearWeek.localeCompare(a.yearWeek));
}

function buildSummaryTotals(rows: SummaryRow[]): SummaryRow {
  const units = rows.reduce((sum, row) => sum + row.units, 0);
  const volume = rows.reduce((sum, row) => sum + row.volume, 0);
  let weightedWac = 0;
  let weightedLtv = 0;
  let weightedFico = 0;
  let wacWeight = 0;
  let ltvWeight = 0;
  let ficoWeight = 0;
  for (const row of rows) {
    if (row.wac != null && row.volume > 0) {
      weightedWac += row.wac * row.volume;
      wacWeight += row.volume;
    }
    if (row.waLtv != null && row.volume > 0) {
      weightedLtv += row.waLtv * row.volume;
      ltvWeight += row.volume;
    }
    if (row.waFico != null && row.volume > 0) {
      weightedFico += row.waFico * row.volume;
      ficoWeight += row.volume;
    }
  }
  const earliestDate = rows
    .map((row) => row.earliestDate)
    .filter((v): v is string => Boolean(v))
    .sort(compareDateStringsAsc)[0] ?? null;
  return {
    yearWeek: "Totals",
    earliestDate,
    units,
    volume,
    averageBalance: units > 0 ? volume / units : 0,
    wac: wacWeight > 0 ? weightedWac / wacWeight : null,
    waLtv: ltvWeight > 0 ? weightedLtv / ltvWeight : null,
    waFico: ficoWeight > 0 ? weightedFico / ficoWeight : null,
  };
}

function escapeCsv(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function downloadCsv(filename: string, rows: string[][]): void {
  const csv = rows.map((row) => row.map(escapeCsv).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

function SortButton({
  label,
  isActive,
  direction,
  onClick,
  align = "left",
}: {
  label: string;
  isActive: boolean;
  direction: SortDirection;
  onClick: () => void;
  align?: "left" | "right";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-slate-100 ${
        align === "right" ? "ml-auto" : ""
      }`}
    >
      <span>{label}</span>
      {isActive ? direction === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" /> : null}
    </button>
  );
}

function YearWeekFilterPopover({
  title,
  open,
  onOpenChange,
  trigger,
  options,
  draftSelected,
  onToggleDraftValue,
  onApply,
  onClearSelection,
}: {
  title: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: ReactNode;
  options: string[];
  draftSelected: string[];
  onToggleDraftValue: (value: string) => void;
  onApply: () => void;
  onClearSelection: () => void;
}) {
  const [search, setSearch] = useState("");
  useEffect(() => {
    if (!open) setSearch("");
  }, [open]);
  const q = search.trim().toLowerCase();
  const filtered = q ? options.filter((o) => o.toLowerCase().includes(q)) : options;
  const ordered = [...filtered].sort((a, b) => {
    const asel = draftSelected.includes(a) ? 1 : 0;
    const bsel = draftSelected.includes(b) ? 1 : 0;
    if (asel !== bsel) return bsel - asel;
    return b.localeCompare(a, undefined, { numeric: true });
  });
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-80 p-3"
        onInteractOutside={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="min-w-0 flex-1 pr-2">
            <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">{title}</div>
            <div className="text-[11px] text-slate-400 dark:text-slate-500">
              Select one or more YearWeek values.
            </div>
          </div>
          <div className="flex shrink-0 flex-col items-stretch gap-1 sm:flex-row sm:items-center">
            <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => {
                onApply();
                onOpenChange(false);
              }}
            >
              Apply Filters
            </Button>
          </div>
        </div>
        <Command shouldFilter={false}>
          <CommandInput placeholder={`Search ${title}`} value={search} onValueChange={setSearch} />
          <CommandList>
            <CommandEmpty>No values found.</CommandEmpty>
            {ordered.map((value) => {
              const sel = draftSelected.includes(value);
              return (
                <CommandItem key={value} value={value} onSelect={() => onToggleDraftValue(value)} className="cursor-pointer">
                  <span className="mr-2 inline-block w-4">{sel ? "✓" : ""}</span>
                  {value}
                </CommandItem>
              );
            })}
          </CommandList>
        </Command>
        <Button type="button" size="sm" variant="ghost" className="mt-2 w-full" onClick={onClearSelection}>
          Clear Selection
        </Button>
      </PopoverContent>
    </Popover>
  );
}

function SummaryWeekTable({
  dateField,
  title,
  earliestDateLabel,
  rows,
  selectedYearWeeks,
  onToggleYearWeek,
}: {
  dateField: SummaryDateField;
  title: string;
  earliestDateLabel: string;
  rows: SummaryRow[];
  selectedYearWeeks: string[];
  onToggleYearWeek: (dateField: SummaryDateField, yearWeek: string) => void;
}) {
  const [sortKey, setSortKey] = useState<SummarySortKey>("yearWeek");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [isFullscreenOpen, setIsFullscreenOpen] = useState(false);

  const sortedRows = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (sortKey === "earliestDate") {
        const cmp = compareDateStringsAsc(String(av ?? ""), String(bv ?? ""));
        return sortDirection === "asc" ? cmp : -cmp;
      }
      if (typeof av === "number" && typeof bv === "number") {
        return sortDirection === "asc" ? av - bv : bv - av;
      }
      const cmp = String(av ?? "").localeCompare(String(bv ?? ""), undefined, { numeric: true });
      return sortDirection === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [rows, sortDirection, sortKey]);

  const totals = useMemo(() => buildSummaryTotals(rows), [rows]);

  const setSort = (key: SummarySortKey) => {
    if (sortKey === key) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    setSortDirection(key === "yearWeek" ? "desc" : "asc");
  };

  const handleDownload = () => {
    const csvRows: string[][] = [
      ["YearWeek Group", earliestDateLabel, "Units", "Volume", "Average Balance", "WAC", "WA LTV", "WA FICO"],
      ...sortedRows.map((row) => [
        row.yearWeek,
        formatDate(row.earliestDate),
        String(row.units),
        String(row.volume),
        String(row.averageBalance),
        row.wac == null ? "" : String(row.wac),
        row.waLtv == null ? "" : String(row.waLtv),
        row.waFico == null ? "" : String(row.waFico),
      ]),
      [
        "Totals",
        formatDate(totals.earliestDate),
        String(totals.units),
        String(totals.volume),
        String(totals.averageBalance),
        totals.wac == null ? "" : String(totals.wac),
        totals.waLtv == null ? "" : String(totals.waLtv),
        totals.waFico == null ? "" : String(totals.waFico),
      ],
    ];
    downloadCsv(`${title.toLowerCase().replace(/\s+/g, "-")}.csv`, csvRows);
  };

  const renderTable = (maxHeight: string) => (
    <div className="overflow-auto" style={{ maxHeight }}>
      <table className="w-full min-w-[920px] text-sm">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-700">
                <th className="sticky top-0 z-30 h-9 bg-slate-50 px-3 py-2 text-left dark:bg-slate-900">
                  <SortButton label="YearWeek Group" isActive={sortKey === "yearWeek"} direction={sortDirection} onClick={() => setSort("yearWeek")} />
                </th>
                <th className="sticky top-0 z-30 h-9 bg-slate-50 px-3 py-2 text-left dark:bg-slate-900">
                  <SortButton label={earliestDateLabel} isActive={sortKey === "earliestDate"} direction={sortDirection} onClick={() => setSort("earliestDate")} />
                </th>
                <th className="sticky top-0 z-30 h-9 bg-slate-50 px-3 py-2 text-right dark:bg-slate-900">
                  <SortButton label="Units" isActive={sortKey === "units"} direction={sortDirection} onClick={() => setSort("units")} align="right" />
                </th>
                <th className="sticky top-0 z-30 h-9 bg-slate-50 px-3 py-2 text-right dark:bg-slate-900">
                  <SortButton label="Volume" isActive={sortKey === "volume"} direction={sortDirection} onClick={() => setSort("volume")} align="right" />
                </th>
                <th className="sticky top-0 z-30 h-9 bg-slate-50 px-3 py-2 text-right dark:bg-slate-900">
                  <SortButton label="Average Balance" isActive={sortKey === "averageBalance"} direction={sortDirection} onClick={() => setSort("averageBalance")} align="right" />
                </th>
                <th className="sticky top-0 z-30 h-9 bg-slate-50 px-3 py-2 text-right dark:bg-slate-900">
                  <SortButton label="WAC" isActive={sortKey === "wac"} direction={sortDirection} onClick={() => setSort("wac")} align="right" />
                </th>
                <th className="sticky top-0 z-30 h-9 bg-slate-50 px-3 py-2 text-right dark:bg-slate-900">
                  <SortButton label="WA LTV" isActive={sortKey === "waLtv"} direction={sortDirection} onClick={() => setSort("waLtv")} align="right" />
                </th>
                <th className="sticky top-0 z-30 h-9 bg-slate-50 px-3 py-2 text-right dark:bg-slate-900">
                  <SortButton label="WA FICO" isActive={sortKey === "waFico"} direction={sortDirection} onClick={() => setSort("waFico")} align="right" />
                </th>
              </tr>
            </thead>
            <tbody>
              <tr className="bg-slate-50/95 font-semibold dark:bg-slate-900" style={{ position: "sticky", top: `${TABLE_ROW_HEIGHT_PX}px`, zIndex: 20 }}>
                <td className="h-9 px-3 py-2">Totals</td>
                <td className="h-9 px-3 py-2">{formatDate(totals.earliestDate)}</td>
                <td className="h-9 px-3 py-2 text-right tabular-nums">{formatUnits(totals.units)}</td>
                <td className="h-9 px-3 py-2 text-right tabular-nums">{formatVolume(totals.volume)}</td>
                <td className="h-9 px-3 py-2 text-right tabular-nums">{formatVolume(totals.averageBalance)}</td>
                <td className="h-9 px-3 py-2 text-right tabular-nums">{formatMetric(totals.wac, 3)}</td>
                <td className="h-9 px-3 py-2 text-right tabular-nums">{formatMetric(totals.waLtv, 2)}</td>
                <td className="h-9 px-3 py-2 text-right tabular-nums">{formatMetric(totals.waFico, 0)}</td>
              </tr>
              {sortedRows.map((row) => (
                <tr
                  key={row.yearWeek}
                  className={`border-b border-slate-100 dark:border-slate-800 ${
                    selectedYearWeeks.includes(row.yearWeek)
                      ? "bg-blue-50/80 dark:bg-slate-700/60"
                      : "hover:bg-slate-50/70 dark:hover:bg-slate-800/50"
                  } cursor-pointer`}
                  onClick={() => onToggleYearWeek(dateField, row.yearWeek)}
                >
                  <td className="h-9 px-3 py-2 text-slate-800 dark:text-slate-200">{row.yearWeek}</td>
                  <td className="h-9 px-3 py-2 text-slate-700 dark:text-slate-300">{formatDate(row.earliestDate)}</td>
                  <td className="h-9 px-3 py-2 text-right tabular-nums">{formatUnits(row.units)}</td>
                  <td className="h-9 px-3 py-2 text-right tabular-nums">{formatVolume(row.volume)}</td>
                  <td className="h-9 px-3 py-2 text-right tabular-nums">{formatVolume(row.averageBalance)}</td>
                  <td className="h-9 px-3 py-2 text-right tabular-nums">{formatMetric(row.wac, 3)}</td>
                  <td className="h-9 px-3 py-2 text-right tabular-nums">{formatMetric(row.waLtv, 2)}</td>
                  <td className="h-9 px-3 py-2 text-right tabular-nums">{formatMetric(row.waFico, 0)}</td>
                </tr>
              ))}
            </tbody>
      </table>
    </div>
  );

  return (
    <>
      <Card className={rowBg}>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-base">{title}</CardTitle>
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => setIsFullscreenOpen(true)}>
                <Maximize2 className="h-3.5 w-3.5" />
                Fullscreen
              </Button>
              <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5" onClick={handleDownload}>
                <Download className="h-3.5 w-3.5" />
                Download
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>{renderTable(`${TABLE_SCROLL_HEIGHT_PX}px`)}</CardContent>
      </Card>
      <Dialog open={isFullscreenOpen} onOpenChange={setIsFullscreenOpen}>
        <DialogContent className="max-w-[95vw] w-[95vw] max-h-[92vh] h-[90vh]">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
          {renderTable("calc(90vh - 120px)")}
        </DialogContent>
      </Dialog>
    </>
  );
}

function LoanDetailWeekTable({ rows }: { rows: LoanDetailDisplayRow[] }) {
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const [sortKey, setSortKey] = useState<LoanDetailSortKey>("startedDate");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [isSortingPending, startSortingTransition] = useTransition();
  const [isFullscreenOpen, setIsFullscreenOpen] = useState(false);
  const loanCount = rows.length;

  const sortedRows = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (
        sortKey === "startedDate" ||
        sortKey === "applicationDate" ||
        sortKey === "lockDate" ||
        sortKey === "fundingDate" ||
        sortKey === "closingDate"
      ) {
        const cmp = compareDateStringsAsc(String(av ?? ""), String(bv ?? ""));
        return sortDirection === "asc" ? cmp : -cmp;
      }
      if (sortKey === "loanVolume") {
        return sortDirection === "asc" ? Number(av) - Number(bv) : Number(bv) - Number(av);
      }
      const cmp = String(av ?? "").localeCompare(String(bv ?? ""), undefined, { numeric: true });
      return sortDirection === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [rows, sortDirection, sortKey]);

  const totalVolume = useMemo(() => rows.reduce((sum, row) => sum + row.loanVolume, 0), [rows]);

  const setSort = (key: LoanDetailSortKey) => {
    startSortingTransition(() => {
      if (sortKey === key) {
        setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
        return;
      }
      setSortKey(key);
      setSortDirection(key === "loanVolume" ? "desc" : "asc");
    });
  };

  const rowVirtualizer = useVirtualizer({
    count: sortedRows.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => TABLE_ROW_HEIGHT_PX,
    overscan: TABLE_OVERSCAN_ROWS,
  });
  const virtualItems = rowVirtualizer.getVirtualItems();
  const totalBodyHeight = rowVirtualizer.getTotalSize();
  const paddingTop = virtualItems.length > 0 ? virtualItems[0].start : 0;
  const paddingBottom =
    virtualItems.length > 0 ? totalBodyHeight - virtualItems[virtualItems.length - 1].end : 0;

  const handleDownload = () => {
    const csvRows: string[][] = [
      [
        "Loan Number",
        "Loan Volume",
        "Current Loan Status",
        "Last Completed Milestone",
        "Loan Folder",
        "Loan Program",
        "Started Date",
        "Application Date",
        "Lock Date",
        "Funding Date",
        "Closing Date",
      ],
      ...sortedRows.map((row) => [
        row.loanNumber,
        String(row.loanVolume),
        row.currentLoanStatus,
        row.lastCompletedMilestone,
        row.loanFolder,
        row.loanProgram,
        row.startedDate ?? "",
        row.applicationDate ?? "",
        row.lockDate ?? "",
        row.fundingDate ?? "",
        row.closingDate ?? "",
      ]),
      ["Totals", String(totalVolume), "", "", "", "", "", "", "", "", ""],
    ];
    downloadCsv("production-summary-weekly-loan-detail.csv", csvRows);
  };

  const renderTable = (maxHeight: string, virtualized: boolean) => (
    <div ref={virtualized ? scrollContainerRef : null} className="overflow-auto" style={{ maxHeight }}>
      <table className="w-full min-w-[1400px] text-sm">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-700">
                <th className="sticky top-0 z-30 h-9 bg-slate-50 px-3 py-2 text-left dark:bg-slate-900"><SortButton label="Loan Number" isActive={sortKey === "loanNumber"} direction={sortDirection} onClick={() => setSort("loanNumber")} /></th>
                <th className="sticky top-0 z-30 h-9 bg-slate-50 px-3 py-2 text-right dark:bg-slate-900"><SortButton label="Loan Volume" isActive={sortKey === "loanVolume"} direction={sortDirection} onClick={() => setSort("loanVolume")} align="right" /></th>
                <th className="sticky top-0 z-30 h-9 bg-slate-50 px-3 py-2 text-left dark:bg-slate-900"><SortButton label="Current Loan Status" isActive={sortKey === "currentLoanStatus"} direction={sortDirection} onClick={() => setSort("currentLoanStatus")} /></th>
                <th className="sticky top-0 z-30 h-9 bg-slate-50 px-3 py-2 text-left dark:bg-slate-900"><SortButton label="Last Completed Milestone" isActive={sortKey === "lastCompletedMilestone"} direction={sortDirection} onClick={() => setSort("lastCompletedMilestone")} /></th>
                <th className="sticky top-0 z-30 h-9 bg-slate-50 px-3 py-2 text-left dark:bg-slate-900"><SortButton label="Loan Folder" isActive={sortKey === "loanFolder"} direction={sortDirection} onClick={() => setSort("loanFolder")} /></th>
                <th className="sticky top-0 z-30 h-9 bg-slate-50 px-3 py-2 text-left dark:bg-slate-900"><SortButton label="Loan Program" isActive={sortKey === "loanProgram"} direction={sortDirection} onClick={() => setSort("loanProgram")} /></th>
                <th className="sticky top-0 z-30 h-9 bg-slate-50 px-3 py-2 text-left dark:bg-slate-900"><SortButton label="Started Date" isActive={sortKey === "startedDate"} direction={sortDirection} onClick={() => setSort("startedDate")} /></th>
                <th className="sticky top-0 z-30 h-9 bg-slate-50 px-3 py-2 text-left dark:bg-slate-900"><SortButton label="Application Date" isActive={sortKey === "applicationDate"} direction={sortDirection} onClick={() => setSort("applicationDate")} /></th>
                <th className="sticky top-0 z-30 h-9 bg-slate-50 px-3 py-2 text-left dark:bg-slate-900"><SortButton label="Lock Date" isActive={sortKey === "lockDate"} direction={sortDirection} onClick={() => setSort("lockDate")} /></th>
                <th className="sticky top-0 z-30 h-9 bg-slate-50 px-3 py-2 text-left dark:bg-slate-900"><SortButton label="Funding Date" isActive={sortKey === "fundingDate"} direction={sortDirection} onClick={() => setSort("fundingDate")} /></th>
                <th className="sticky top-0 z-30 h-9 bg-slate-50 px-3 py-2 text-left dark:bg-slate-900"><SortButton label="Closing Date" isActive={sortKey === "closingDate"} direction={sortDirection} onClick={() => setSort("closingDate")} /></th>
              </tr>
            </thead>
        <tbody>
              <tr className="bg-slate-50/95 font-semibold dark:bg-slate-900" style={{ position: "sticky", top: `${TABLE_ROW_HEIGHT_PX}px`, zIndex: 20 }}>
                <td className="h-9 px-3 py-2">Totals</td>
                <td className="h-9 px-3 py-2 text-right tabular-nums">{formatVolume(totalVolume)}</td>
                <td className="h-9 px-3 py-2" colSpan={9} />
              </tr>
              {virtualized && paddingTop > 0 && (
                <tr>
                  <td colSpan={11} style={{ height: `${paddingTop}px` }} />
                </tr>
              )}
              {(virtualized ? virtualItems.map((virtualRow) => sortedRows[virtualRow.index]) : sortedRows).map((row, index) => {
                return (
                  <tr key={`${row.loanNumber}-${row.startedDate}-${row.applicationDate}-${index}`} className="border-b border-slate-100 dark:border-slate-800">
                    <td className="h-9 px-3 py-2">{row.loanNumber}</td>
                    <td className="h-9 px-3 py-2 text-right tabular-nums">{formatVolume(row.loanVolume)}</td>
                    <td className="h-9 px-3 py-2">{row.currentLoanStatus}</td>
                    <td className="h-9 px-3 py-2">{row.lastCompletedMilestone}</td>
                    <td className="h-9 px-3 py-2">{row.loanFolder}</td>
                    <td className="h-9 px-3 py-2">{row.loanProgram}</td>
                    <td className="h-9 px-3 py-2">{formatDate(row.startedDate)}</td>
                    <td className="h-9 px-3 py-2">{formatDate(row.applicationDate)}</td>
                    <td className="h-9 px-3 py-2">{formatDate(row.lockDate)}</td>
                    <td className="h-9 px-3 py-2">{formatDate(row.fundingDate)}</td>
                    <td className="h-9 px-3 py-2">{formatDate(row.closingDate)}</td>
                  </tr>
                );
              })}
              {virtualized && paddingBottom > 0 && (
                <tr>
                  <td colSpan={11} style={{ height: `${paddingBottom}px` }} />
                </tr>
              )}
        </tbody>
      </table>
    </div>
  );

  return (
    <>
      <Card className={rowBg}>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-base">Loan List</CardTitle>
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Loan count: {formatUnits(loanCount)}
              </span>
              <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => setIsFullscreenOpen(true)}>
                <Maximize2 className="h-3.5 w-3.5" />
                Fullscreen
              </Button>
              <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5" onClick={handleDownload}>
                <Download className="h-3.5 w-3.5" />
                Download
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {renderTable(`${TABLE_SCROLL_HEIGHT_PX}px`, true)}
          {isSortingPending && (
            <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">Sorting loans...</div>
          )}
        </CardContent>
      </Card>
      <Dialog open={isFullscreenOpen} onOpenChange={setIsFullscreenOpen}>
        <DialogContent className="max-w-[96vw] w-[96vw] max-h-[92vh] h-[90vh]">
          <DialogHeader>
            <DialogTitle>Loan List</DialogTitle>
          </DialogHeader>
          {renderTable("calc(90vh - 120px)", false)}
        </DialogContent>
      </Dialog>
    </>
  );
}

type ProductionSummaryByWeekViewProps = {
  embeddedInWorkbench?: boolean;
  groupId?: string | null;
  widgetVariant?:
    | "full"
    | "started"
    | "application"
    | "lock"
    | "funding"
    | "closing"
    | "loan-detail";
};

export function ProductionSummaryByWeekView({
  embeddedInWorkbench = false,
  groupId = null,
  widgetVariant = "full",
}: ProductionSummaryByWeekViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [loadingNotice, setLoadingNotice] = useState<string | null>(null);
  const [activePillField, setActivePillField] = useState<SummaryDateField | null>(null);
  const [draftYearWeeks, setDraftYearWeeks] = useState<string[]>([]);
  const [localSelectedYearWeeksByField, setLocalSelectedYearWeeksByField] =
    useState<YearWeekFilterState>(EMPTY_YEARWEEK_FILTERS);
  const hasSeenLoadingRef = useRef(false);
  const completeTimeoutRef = useRef<number | null>(null);
  const { selectedTenantId } = useTenantStore();
  const { user } = useAuth();
  const sectionFilters = useWidgetSectionStore((s) =>
    groupId ? s.sections[groupId] : undefined,
  );
  const updateSectionFilters = useWidgetSectionStore((s) => s.updateFilters);
  const tenantId = selectedTenantId ?? user?.tenant_id ?? null;
  const persistedViewState = useProductionSummaryByWeekViewState({ tenantId });
  const isPersistenceEnabled = Boolean(!embeddedInWorkbench && tenantId && persistedViewState.preferenceKey);
  const hydratedPreferenceKeyRef = useRef<string | null>(null);
  const sectionDateRange = useMemo(
    () => sectionFilters?.periodSelection?.dateRange ?? sectionFilters?.dateRange,
    [sectionFilters?.periodSelection?.dateRange, sectionFilters?.dateRange],
  );
  const sectionDimensionFilters = useMemo(() => {
    if (!sectionFilters?.dynamicFilters?.length) return undefined;
    const list = sectionFilters.dynamicFilters
      .filter(
        (df) =>
          df.value &&
          df.value !== "all" &&
          df.column !== "branch" &&
          df.column !== "loan_officer",
      )
      .map((df) => ({ column: df.column, value: df.value }));
    return list.length > 0 ? list : undefined;
  }, [sectionFilters?.dynamicFilters]);
  const loanFilters = useMemo(
    () =>
      sectionFilters
        ? {
            dateField: sectionFilters.dateField,
            dateRange: sectionDateRange,
            branch: sectionFilters.branch,
            loanOfficer: sectionFilters.loanOfficer,
            dimensionFilters: sectionDimensionFilters,
          }
        : undefined,
    [
      sectionDateRange,
      sectionDimensionFilters,
      sectionFilters?.branch,
      sectionFilters?.dateField,
      sectionFilters?.loanOfficer,
    ],
  );
  const { data, loading, error } = useLoanDetailData(tenantId, loanFilters);
  const selectedYearWeeksByField = useMemo<YearWeekFilterState>(() => {
    if (embeddedInWorkbench && groupId) {
      const fromStore = sectionFilters?.productionSummaryByWeekYearWeeks;
      if (!fromStore) return EMPTY_YEARWEEK_FILTERS;
      return {
        started_date: fromStore.started_date ?? [],
        application_date: fromStore.application_date ?? [],
        investor_lock_date: fromStore.investor_lock_date ?? [],
        funding_date: fromStore.funding_date ?? [],
        closing_date: fromStore.closing_date ?? [],
      };
    }
    return localSelectedYearWeeksByField;
  }, [
    embeddedInWorkbench,
    groupId,
    localSelectedYearWeeksByField,
    sectionFilters?.productionSummaryByWeekYearWeeks,
  ]);

  const productionSummaryByWeekFilterAnalytics = useMemo(() => {
    const yw = selectedYearWeeksByField;
    return {
      widget_variant: widgetVariant,
      started_date_weeks: yw.started_date.length,
      application_date_weeks: yw.application_date.length,
      investor_lock_date_weeks: yw.investor_lock_date.length,
      funding_date_weeks: yw.funding_date.length,
      closing_date_weeks: yw.closing_date.length,
    };
  }, [widgetVariant, selectedYearWeeksByField]);
  useDashboardFilterAnalytics(DASHBOARD_PAGE_KEYS.production_summary_by_week, productionSummaryByWeekFilterAnalytics, {
    enabled: !embeddedInWorkbench,
  });

  const setSelectedYearWeeksByField = (
    updater:
      | YearWeekFilterState
      | ((prev: YearWeekFilterState) => YearWeekFilterState),
  ) => {
    const next =
      typeof updater === "function" ? updater(selectedYearWeeksByField) : updater;
    if (embeddedInWorkbench && groupId) {
      updateSectionFilters(groupId, { productionSummaryByWeekYearWeeks: next });
      return;
    }
    setLocalSelectedYearWeeksByField(next);
  };

  useEffect(() => {
    if (!isPersistenceEnabled || !persistedViewState.preferenceKey) {
      hydratedPreferenceKeyRef.current = null;
      return;
    }
    if (hydratedPreferenceKeyRef.current === persistedViewState.preferenceKey) return;

    setLocalSelectedYearWeeksByField(EMPTY_YEARWEEK_FILTERS);

    let cancelled = false;
    void persistedViewState
      .load()
      .then((loaded) => {
        if (cancelled) return;
        if (loaded) {
          setLocalSelectedYearWeeksByField(loaded.yearWeeksByField);
        }
        hydratedPreferenceKeyRef.current = persistedViewState.preferenceKey;
      })
      .catch(() => {
        if (!cancelled) hydratedPreferenceKeyRef.current = persistedViewState.preferenceKey;
      });

    return () => {
      cancelled = true;
    };
  }, [isPersistenceEnabled, persistedViewState.preferenceKey, persistedViewState.load]);

  const savePersistedViewState = useCallback(async () => {
    if (!isPersistenceEnabled) return;
    await persistedViewState.save(
      normalizeProductionSummaryByWeekViewState({
        version: 1,
        yearWeeksByField: localSelectedYearWeeksByField,
      }),
    );
  }, [isPersistenceEnabled, localSelectedYearWeeksByField, persistedViewState]);

  useEffect(() => {
    if (!isPersistenceEnabled) return;
    if (!persistedViewState.preferenceKey) return;
    if (persistedViewState.isLoading) return;
    if (hydratedPreferenceKeyRef.current !== persistedViewState.preferenceKey) return;
    const t = window.setTimeout(() => {
      void savePersistedViewState();
    }, 400);
    return () => window.clearTimeout(t);
  }, [
    isPersistenceEnabled,
    persistedViewState.preferenceKey,
    persistedViewState.isLoading,
    savePersistedViewState,
  ]);

  useEffect(() => {
    if (!isPersistenceEnabled) return;
    if (!persistedViewState.preferenceKey) return;
    const key = persistedViewState.preferenceKey;
    const flush = () => {
      persistProductionSummaryByWeekFiltersLocally(
        key,
        normalizeProductionSummaryByWeekViewState({
          version: 1,
          yearWeeksByField: localSelectedYearWeeksByField,
        }),
      );
    };
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, [isPersistenceEnabled, persistedViewState.preferenceKey, localSelectedYearWeeksByField]);

  const hasLoadedAllLoans = useMemo(() => {
    if (!data) return false;
    if (data.total <= 0) return true;
    return data.loans.length >= data.total;
  }, [data]);
  const isAllTablesStillLoading = !error && (loading || !hasLoadedAllLoans);

  useEffect(() => {
    if (completeTimeoutRef.current != null) {
      window.clearTimeout(completeTimeoutRef.current);
      completeTimeoutRef.current = null;
    }
    if (isAllTablesStillLoading) {
      hasSeenLoadingRef.current = true;
      setLoadingNotice("Loading Loans...");
      return;
    }
    if (!isAllTablesStillLoading && hasSeenLoadingRef.current) {
      setLoadingNotice("Loading complete");
      completeTimeoutRef.current = window.setTimeout(() => {
        setLoadingNotice(null);
      }, 5000);
    }
    return () => {
      if (completeTimeoutRef.current != null) {
        window.clearTimeout(completeTimeoutRef.current);
        completeTimeoutRef.current = null;
      }
    };
  }, [isAllTablesStillLoading]);

  const sourceLoans = useMemo(
    () => (data?.loans ?? []).filter((loan) => Boolean(toDateSafe(loan.started_date))),
    [data?.loans],
  );

  const yearWeekOptionsByField = useMemo<Record<SummaryDateField, string[]>>(() => {
    const out: Record<SummaryDateField, string[]> = {
      started_date: [],
      application_date: [],
      investor_lock_date: [],
      funding_date: [],
      closing_date: [],
    };
    for (const field of SUMMARY_TABLE_CONFIGS.map((c) => c.key)) {
      const values = new Set<string>();
      for (const loan of sourceLoans) {
        const yw = getLoanYearWeek(loan, field);
        if (yw) values.add(yw);
      }
      out[field] = [...values].sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    }
    return out;
  }, [sourceLoans]);

  const filteredLoans = useMemo(() => {
    return sourceLoans.filter((loan) => {
      for (const field of SUMMARY_TABLE_CONFIGS.map((c) => c.key)) {
        const selected = selectedYearWeeksByField[field];
        if (selected.length === 0) continue;
        const loanYearWeek = getLoanYearWeek(loan, field);
        if (!loanYearWeek || !selected.includes(loanYearWeek)) return false;
      }
      return true;
    });
  }, [selectedYearWeeksByField, sourceLoans]);

  const summaryTables = useMemo(
    () =>
      SUMMARY_TABLE_CONFIGS.map((config) => ({
        ...config,
        rows: buildSummaryRows(filteredLoans, config.key),
      })),
    [filteredLoans],
  );
  const visibleSummaryFields = useMemo<SummaryDateField[]>(() => {
    switch (widgetVariant) {
      case "started":
        return ["started_date"];
      case "application":
        return ["application_date"];
      case "lock":
        return ["investor_lock_date"];
      case "funding":
        return ["funding_date"];
      case "closing":
        return ["closing_date"];
      case "loan-detail":
        return [];
      default:
        return SUMMARY_TABLE_CONFIGS.map((c) => c.key);
    }
  }, [widgetVariant]);
  const visibleSummaryTables = useMemo(
    () => summaryTables.filter((table) => visibleSummaryFields.includes(table.key)),
    [summaryTables, visibleSummaryFields],
  );
  const showLoanDetailTable = widgetVariant === "full" || widgetVariant === "loan-detail";

  const loanDetailRows = useMemo<LoanDetailDisplayRow[]>(
    () =>
      filteredLoans.map((loan) => ({
        loanNumber: normalizeText(loan.loan_number),
        loanVolume: toNumberSafe(loan.loan_amount),
        currentLoanStatus: normalizeText(loan.current_loan_status),
        lastCompletedMilestone: normalizeText(loan.current_milestone),
        loanFolder: normalizeText(loan.loan_folder),
        loanProgram: normalizeText(loan.loan_program),
        startedDate: loan.started_date,
        applicationDate: loan.application_date,
        lockDate: loan.investor_lock_date,
        fundingDate: loan.funding_date,
        closingDate: loan.closing_date,
      })),
    [filteredLoans],
  );

  const toggleYearWeekFilter = (field: SummaryDateField, yearWeek: string) => {
    setSelectedYearWeeksByField((prev) => {
      const set = new Set(prev[field]);
      if (set.has(yearWeek)) set.delete(yearWeek);
      else set.add(yearWeek);
      return {
        ...prev,
        [field]: [...set].sort((a, b) => b.localeCompare(a, undefined, { numeric: true })),
      };
    });
  };

  const clearYearWeekFieldFilter = (field: SummaryDateField) => {
    setSelectedYearWeeksByField((prev) => ({
      ...prev,
      [field]: [],
    }));
    if (activePillField === field) setActivePillField(null);
  };

  const content = (
    <div className="flex min-h-[calc(100vh-4rem)] flex-col">
      {!embeddedInWorkbench && <TopTieringTopBar title="Production Summary by Week" />}
      <main className={embeddedInWorkbench ? "flex-1 overflow-y-auto px-2 py-2" : "flex-1 overflow-y-auto px-2 py-2 sm:px-4 sm:py-3"}>
        <div ref={containerRef} className="mx-auto max-w-[1800px] space-y-4">
          {loadingNotice && (
            <div className="sticky top-2 z-50">
              <div
                className={`w-full rounded-lg border px-4 py-2 text-center text-sm font-semibold shadow-sm ${
                  loadingNotice === "Loading complete"
                    ? "border-green-300 bg-green-50 text-green-800 dark:border-green-700/60 dark:bg-green-900/40 dark:text-green-200"
                    : "border-yellow-300 bg-yellow-50 text-yellow-800 dark:border-yellow-700/60 dark:bg-yellow-900/40 dark:text-yellow-200"
                }`}
              >
                {loadingNotice}
              </div>
            </div>
          )}
          {widgetVariant === "full" &&
            SUMMARY_TABLE_CONFIGS.some((cfg) => selectedYearWeeksByField[cfg.key].length > 0) && (
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-blue-100/80 bg-blue-50/50 px-3 py-2 dark:border-slate-700/80 dark:bg-slate-900/40">
              <span className="text-sm font-medium text-slate-500 dark:text-slate-400">Active filters</span>
              {SUMMARY_TABLE_CONFIGS.map((cfg) => {
                const selected = selectedYearWeeksByField[cfg.key];
                if (selected.length === 0) return null;
                const label =
                  selected.length === 1
                    ? `${YEARWEEK_FILTER_LABELS[cfg.key]}: ${selected[0]}`
                    : `${YEARWEEK_FILTER_LABELS[cfg.key]}: ${selected.length} selected`;
                return (
                  <div key={cfg.key} className="flex items-center gap-0.5">
                    <YearWeekFilterPopover
                      title={YEARWEEK_FILTER_LABELS[cfg.key]}
                      open={activePillField === cfg.key}
                      onOpenChange={(open) => {
                        if (open) {
                          setDraftYearWeeks([...selected]);
                          setActivePillField(cfg.key);
                        } else {
                          setActivePillField(null);
                        }
                      }}
                      options={yearWeekOptionsByField[cfg.key]}
                      draftSelected={draftYearWeeks}
                      onToggleDraftValue={(value) =>
                        setDraftYearWeeks((prev) => {
                          const set = new Set(prev);
                          if (set.has(value)) set.delete(value);
                          else set.add(value);
                          return [...set].sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
                        })
                      }
                      onApply={() =>
                        setSelectedYearWeeksByField((prev) => ({
                          ...prev,
                          [cfg.key]: [...draftYearWeeks].sort((a, b) =>
                            b.localeCompare(a, undefined, { numeric: true }),
                          ),
                        }))
                      }
                      onClearSelection={() => setDraftYearWeeks([])}
                      trigger={
                        <button
                          type="button"
                          className="inline-flex max-w-[min(340px,calc(100vw-6rem))] cursor-pointer items-center gap-1 rounded-full border border-sky-500 bg-sky-500 px-2.5 py-0.5 text-left text-sm font-medium text-white transition-colors hover:bg-sky-600 dark:border-sky-500 dark:bg-sky-500 dark:text-white dark:hover:bg-sky-600"
                        >
                          <span className="truncate">{label}</span>
                        </button>
                      }
                    />
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        clearYearWeekFieldFilter(cfg.key);
                      }}
                      className="rounded-sm p-0.5 text-slate-500 hover:bg-blue-100/80 hover:text-slate-800 dark:hover:bg-slate-700/80 dark:hover:text-slate-200"
                      aria-label={`Remove ${YEARWEEK_FILTER_LABELS[cfg.key]} filter`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                );
              })}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() =>
                  setSelectedYearWeeksByField(EMPTY_YEARWEEK_FILTERS)
                }
              >
                Clear all filters
              </Button>
            </div>
          )}
          {loading && (
            <div className="flex min-h-[280px] items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-slate-500" />
            </div>
          )}
          {!loading && error && (
            <Card className={rowBg}>
              <CardContent className="py-10 text-center text-sm text-red-600">{error}</CardContent>
            </Card>
          )}
          {!loading && !error && (
            <div className={widgetVariant === "full" ? "grid grid-cols-1 gap-4 xl:grid-cols-2" : "space-y-4"}>
              {visibleSummaryTables.map((table) => (
                <SummaryWeekTable
                  key={table.key}
                  dateField={table.key}
                  title={table.title}
                  earliestDateLabel={table.earliestDateLabel}
                  rows={table.rows}
                  selectedYearWeeks={selectedYearWeeksByField[table.key]}
                  onToggleYearWeek={toggleYearWeekFilter}
                />
              ))}
              {showLoanDetailTable && <LoanDetailWeekTable rows={loanDetailRows} />}
            </div>
          )}
        </div>
      </main>
    </div>
  );

  if (embeddedInWorkbench) {
    return content;
  }

  return (
    <TopTieringLayout>
      {content}
    </TopTieringLayout>
  );
}

export default function ProductionSummaryByWeek() {
  return <ProductionSummaryByWeekView />;
}
