import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { computePresetDateRange, getPeriodPresetMeta, type PeriodPreset } from "@/components/ui/DatePeriodPicker";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Info, Filter, X, Download } from "lucide-react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import {
  type EstimatedClosingsComplexityBucketKey,
  type EstimatedClosingsDateRangeType,
  type EstimatedClosingsEcdSliceKey,
  fetchAllEstimatedClosingsDetailRows,
  useEstimatedClosingsRiskData,
} from "@/hooks/useEstimatedClosingsRiskData";
import {
  ESTIMATED_CLOSINGS_DETAIL_COLUMNS,
  ESTIMATED_CLOSINGS_DETAIL_COLUMN_BY_ID,
  type EstimatedClosingsDetailColumnDefMini,
} from "@/config/estimatedClosingsDetailColumns";
import { cn } from "@/lib/utils";
import {
  EMPTY_FILTER_TOKEN,
  isFilterActive,
  normalizeFilterState,
  type ColumnFilterState,
  type LoanDetailFilterKind,
  type NumericFilterMode,
  valueMatchesColumnFilter,
} from "@/utils/loanDetailFilters";
import {
  normalizeEstimatedClosingsRiskViewState,
  useEstimatedClosingsRiskViewState,
} from "@/hooks/useEstimatedClosingsRiskViewState";

interface EstimatedClosingsRiskViewProps {
  selectedTenantId?: string | null;
  selectedChannel?: string | null;
}

type SortDirection = "asc" | "desc";
type SortConfig = { key: string; direction: SortDirection };

function sortRowsByConfig<T extends Record<string, unknown>>(rows: T[], sort: SortConfig): T[] {
  const sign = sort.direction === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = a[sort.key];
    const bv = b[sort.key];

    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;

    const an = Number(av);
    const bn = Number(bv);
    if (!Number.isNaN(an) && !Number.isNaN(bn)) {
      return (an - bn) * sign;
    }

    const ad = new Date(String(av)).getTime();
    const bd = new Date(String(bv)).getTime();
    if (!Number.isNaN(ad) && !Number.isNaN(bd)) {
      return (ad - bd) * sign;
    }

    return String(av).localeCompare(String(bv), undefined, { sensitivity: "base" }) * sign;
  });
}

const PIE_COLORS = ["#94a3b8", "#ef4444", "#3b82f6", "#10b981"];
const LOAN_NUMBER_FILTER_MAX_OPTIONS = 200;
/** Fixed row height for virtualized loan detail rows (must match estimateSize). */
const DETAIL_VIRTUAL_ROW_HEIGHT = 44;
const DETAIL_VIRTUAL_OVERSCAN = 10;
const DETAIL_COLUMN_COUNT = ESTIMATED_CLOSINGS_DETAIL_COLUMNS.length;
const KPI_DESCRIPTIONS: Record<string, string> = {
  totalActivePipeline:
    "Count of active loans using the canonical site definition: Active Loan status, application date present, and not archived.",
  ecdEmptyOrAfterThisMonth:
    "Active and unfunded loans where ECD is blank or after month-end.",
  remainingToFund:
    "Active and unfunded loans (canonical active pipeline: status, application date present, not archived), with an estimated closing date on or before the end of the current calendar month (includes overdue ECDs from prior months). Not the same as the pie slice “This Month's ECD,” which counts only ECDs in the current month.",
  fundedThisMonth:
    "Loans with a funding date in the current calendar month.",
  maxPossibleFunding:
    "Funded this month plus remaining to fund.",
  fundingYtdUnits:
    "Loans funded from Jan 1 through today in the current year.",
  unitsLastMonthVsPriorPct:
    "Percent change in funded units: (last month - prior month) / prior month.",
  volumeLastMonthVsPriorPct:
    "Percent change in funded volume: (last month - prior month) / prior month.",
};

function KpiLabel({ label, description }: { label: string; description: string }) {
  return (
    <div className="inline-flex items-center gap-1">
      <span>{label}</span>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="inline-flex items-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
            aria-label={`About ${label}`}
          >
            <Info className="h-3.5 w-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs text-xs leading-relaxed">
          {description}
        </TooltipContent>
      </Tooltip>
    </div>
  );
}

function formatPrevMonthYearMon(reference: Date = new Date()): string {
  const d = new Date(reference.getFullYear(), reference.getMonth() - 1, 1);
  const y = d.getFullYear();
  const mon = d.toLocaleString("en-US", { month: "short" });
  return `${y}-${mon}`;
}

function formatCurrency(value: number | null | undefined) {
  const n = Number(value || 0);
  if (Math.abs(n) >= 1000000) return `$${(n / 1000000).toFixed(2)}M`;
  return `$${n.toLocaleString()}`;
}

function formatPercent(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) return "-";
  return `${value.toFixed(1)}%`;
}

function toCsvCell(value: unknown): string {
  const text = value == null ? "" : String(value);
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, "\"\"")}"`;
  return text;
}

function downloadCsvFile(filename: string, headers: string[], rows: unknown[][]) {
  const csv = [headers.map(toCsvCell).join(","), ...rows.map((r) => r.map(toCsvCell).join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

async function downloadChartAsImage(container: HTMLElement | null, filename: string) {
  if (!container) return;
  const svg = container.querySelector("svg");
  if (!svg) return;
  const svgData = new XMLSerializer().serializeToString(svg);
  const blob = new Blob([svgData], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.src = url;
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("Failed to render chart image."));
  });
  const canvas = document.createElement("canvas");
  const width = img.width || 1200;
  const height = img.height || 700;
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    URL.revokeObjectURL(url);
    return;
  }
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0);
  URL.revokeObjectURL(url);
  const pngUrl = canvas.toDataURL("image/png");
  const link = document.createElement("a");
  link.href = pngUrl;
  link.download = filename;
  link.click();
}

function toNumberOrNull(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isNaN(n) ? null : n;
}

function averageNonZero(rows: Record<string, unknown>[], key: string): number | null {
  let sum = 0;
  let n = 0;
  for (const row of rows) {
    const v = toNumberOrNull(row[key]);
    if (v != null && v !== 0) {
      sum += v;
      n += 1;
    }
  }
  return n > 0 ? sum / n : null;
}

function formatBooleanish(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  const normalized = String(value).trim().toLowerCase();
  if (["true", "t", "1", "y", "yes"].includes(normalized)) return "Yes";
  if (["false", "f", "0", "n", "no"].includes(normalized)) return "No";
  return String(value);
}

function getDetailRaw(row: Record<string, unknown>, columnId: string): unknown {
  return row[columnId];
}

function getCellToken(columnId: string, raw: unknown): string {
  if (raw == null || String(raw).trim() === "" || String(raw) === "-") return EMPTY_FILTER_TOKEN;
  if (columnId === "borrowerSelfEmployed") {
    return formatBooleanish(raw).toLowerCase() === "yes" ? "yes" : "no";
  }
  return String(raw).trim();
}

function cloneFilter(filter: ColumnFilterState[string]): ColumnFilterState[string] | undefined {
  if (!filter) return undefined;
  if (filter.kind === "text") return { kind: "text", selectedValues: [...filter.selectedValues] };
  if (filter.kind === "number") {
    return {
      kind: "number",
      mode: filter.mode,
      selectedValues: [...filter.selectedValues],
      min: filter.min,
      max: filter.max,
      value: filter.value,
    };
  }
  if (filter.kind === "date") return { kind: "date", from: filter.from, to: filter.to, shortcut: filter.shortcut };
  return { kind: "boolean", value: filter.value };
}

export function EstimatedClosingsRiskView({
  selectedTenantId,
  selectedChannel,
}: EstimatedClosingsRiskViewProps) {
  const persistedViewState = useEstimatedClosingsRiskViewState({ tenantId: selectedTenantId });
  const isPersistenceEnabled = Boolean(selectedTenantId && persistedViewState.preferenceKey);
  const hydratedPreferenceKeyRef = useRef<string | null>(null);

  const [dateRangeType, setDateRangeType] = useState<EstimatedClosingsDateRangeType>("calendar_days");
  const [complexitySort, setComplexitySort] = useState<SortConfig>({ key: "sortOrder", direction: "asc" });
  const [stageSort, setStageSort] = useState<SortConfig>({ key: "sortOrder", direction: "asc" });
  const [detailSort, setDetailSort] = useState<SortConfig>({ key: "loanNumber", direction: "asc" });

  const [ecdSlice, setEcdSlice] = useState<EstimatedClosingsEcdSliceKey | null>(null);
  const [complexityBarBucket, setComplexityBarBucket] = useState<EstimatedClosingsComplexityBucketKey | null>(null);
  const [remainingComplexityGroup, setRemainingComplexityGroup] = useState<string | null>(null);
  const [remainingProcessingStage, setRemainingProcessingStage] = useState<string | null>(null);
  const [detailColumnFilters, setDetailColumnFilters] = useState<ColumnFilterState>({});
  const [showDetailColumnFilters, setShowDetailColumnFilters] = useState(false);
  const [draftDetailFilters, setDraftDetailFilters] = useState<ColumnFilterState>({});
  const [openDetailFilterColumnId, setOpenDetailFilterColumnId] = useState<string | null>(null);
  const [detailCsvExporting, setDetailCsvExporting] = useState(false);
  const pieChartContainerRef = useRef<HTMLDivElement | null>(null);
  const barChartContainerRef = useRef<HTMLDivElement | null>(null);
  /** State (not ref) so row virtualizer re-runs after the scroll container mounts — getScrollElement() was null on first paint. */
  const [detailScrollElement, setDetailScrollElement] = useState<HTMLDivElement | null>(null);
  const [filterSearchByColumn, setFilterSearchByColumn] = useState<Record<string, string>>({});
  const [debouncedFilterSearchByColumn, setDebouncedFilterSearchByColumn] = useState<Record<string, string>>({});
  const searchDebounceTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const [detailDistinctCache, setDetailDistinctCache] = useState<
    Record<string, { values: string[]; hasBlank: boolean; version: number }>
  >({});
  const detailDistinctCacheRef = useRef(detailDistinctCache);
  useEffect(() => {
    detailDistinctCacheRef.current = detailDistinctCache;
  }, [detailDistinctCache]);
  const detailRowsVersionRef = useRef(0);

  const draftDetailFiltersRef = useRef(draftDetailFilters);
  draftDetailFiltersRef.current = draftDetailFilters;

  const pageSliceFilters = useMemo(
    () => ({
      ecdSlice,
      complexityBarBucket,
      remainingComplexityGroup,
      remainingProcessingStage,
    }),
    [ecdSlice, complexityBarBucket, remainingComplexityGroup, remainingProcessingStage],
  );

  const { data, loading, error } = useEstimatedClosingsRiskData({
    tenantId: selectedTenantId,
    channelGroup: selectedChannel,
    dateRangeType,
    fetchAllDetailRows: true,
    pageSliceFilters,
    detailColumnFilters,
  });

  useEffect(() => {
    if (!isPersistenceEnabled || !persistedViewState.preferenceKey) {
      hydratedPreferenceKeyRef.current = null;
      return;
    }
    if (hydratedPreferenceKeyRef.current === persistedViewState.preferenceKey) return;

    setDateRangeType("calendar_days");
    setEcdSlice(null);
    setComplexityBarBucket(null);
    setRemainingComplexityGroup(null);
    setRemainingProcessingStage(null);
    setDetailColumnFilters({});
    setDraftDetailFilters({});
    setOpenDetailFilterColumnId(null);
    setShowDetailColumnFilters(false);
    setDetailSort({ key: "loanNumber", direction: "asc" });
    setComplexitySort({ key: "sortOrder", direction: "asc" });
    setStageSort({ key: "sortOrder", direction: "asc" });

    let cancelled = false;
    void persistedViewState
      .load()
      .then((loaded) => {
        if (cancelled) return;
        if (loaded) {
          setDateRangeType(loaded.dateRangeType);
          setEcdSlice(loaded.ecdSlice);
          setComplexityBarBucket(loaded.complexityBarBucket);
          setRemainingComplexityGroup(loaded.remainingComplexityGroup);
          setRemainingProcessingStage(loaded.remainingProcessingStage);
          setDetailColumnFilters(normalizeFilterState(loaded.detailColumnFilters));
          setDraftDetailFilters({});
          setShowDetailColumnFilters(loaded.showDetailColumnFilters);
          setDetailSort(loaded.detailSort);
          setComplexitySort(loaded.complexitySort);
          setStageSort(loaded.stageSort);
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
    const payload = normalizeEstimatedClosingsRiskViewState({
      version: 1,
      dateRangeType,
      ecdSlice,
      complexityBarBucket,
      remainingComplexityGroup,
      remainingProcessingStage,
      detailColumnFilters: normalizeFilterState(detailColumnFilters),
      showDetailColumnFilters,
      detailSort,
      complexitySort,
      stageSort,
    });
    await persistedViewState.save(payload);
  }, [
    isPersistenceEnabled,
    dateRangeType,
    ecdSlice,
    complexityBarBucket,
    remainingComplexityGroup,
    remainingProcessingStage,
    detailColumnFilters,
    showDetailColumnFilters,
    detailSort,
    complexitySort,
    stageSort,
    persistedViewState,
  ]);

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
    detailRowsVersionRef.current += 1;
    setDetailDistinctCache({});
  }, [data?.detail.rows]);

  useEffect(() => {
    if (!openDetailFilterColumnId) return;
    const col = ESTIMATED_CLOSINGS_DETAIL_COLUMN_BY_ID[openDetailFilterColumnId];
    if (!col || col.kind === "boolean" || col.kind === "date") return;

    const version = detailRowsVersionRef.current;
    const cached = detailDistinctCacheRef.current[openDetailFilterColumnId];
    if (cached && cached.version === version) return;

    const rows = (data?.detail.rows ?? []) as Record<string, unknown>[];
    const vals = new Set<string>();
    let hasBlank = false;
    for (const row of rows) {
      const raw = getDetailRaw(row, openDetailFilterColumnId);
      if (raw == null || String(raw).trim() === "" || String(raw) === "-") {
        hasBlank = true;
        continue;
      }
      vals.add(String(raw).trim());
    }
    const sorted = [...vals].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    setDetailDistinctCache((prev) => ({
      ...prev,
      [openDetailFilterColumnId]: { values: sorted, hasBlank, version },
    }));
  }, [openDetailFilterColumnId, data?.detail.rows]);

  useEffect(() => {
    return () => {
      const timers = searchDebounceTimersRef.current;
      for (const t of Object.values(timers)) clearTimeout(t);
    };
  }, []);

  const kpis = data?.kpis;
  const complexityBars = data?.maxPossibleFundingByComplexity ?? [];
  const pieData = data?.activePipelineEcdSlices ?? [];
  const prevMonthYearMon = useMemo(() => formatPrevMonthYearMon(), []);
  const prevMonthUnitsDescription = `Loans funded in ${prevMonthYearMon} (funding date in that calendar month).`;
  const prevMonthVolumeDescription = `Sum of loan amount for loans funded in ${prevMonthYearMon} (funding date in that calendar month).`;

  const toggleEcdSlice = useCallback((key: EstimatedClosingsEcdSliceKey) => {
    setEcdSlice((prev) => (prev === key ? null : key));
  }, []);

  const toggleComplexityBucket = useCallback((key: EstimatedClosingsComplexityBucketKey) => {
    setComplexityBarBucket((prev) => (prev === key ? null : key));
  }, []);

  const toggleRemainingComplexityGroup = useCallback((group: string) => {
    setRemainingComplexityGroup((prev) => (prev === group ? null : group));
  }, []);

  const toggleRemainingProcessingStage = useCallback((stage: string) => {
    setRemainingProcessingStage((prev) => (prev === stage ? null : stage));
  }, []);

  const clearAllPageFilters = useCallback(() => {
    setEcdSlice(null);
    setComplexityBarBucket(null);
    setRemainingComplexityGroup(null);
    setRemainingProcessingStage(null);
    setDetailColumnFilters({});
    setDraftDetailFilters({});
    setOpenDetailFilterColumnId(null);
    const timers = searchDebounceTimersRef.current;
    for (const k of Object.keys(timers)) {
      clearTimeout(timers[k]);
      delete timers[k];
    }
    setFilterSearchByColumn({});
    setDebouncedFilterSearchByColumn({});
  }, []);

  const hasAnyFilter =
    ecdSlice != null ||
    complexityBarBucket != null ||
    remainingComplexityGroup != null ||
    remainingProcessingStage != null ||
    Object.values(detailColumnFilters).some((f) => isFilterActive(f));

  const activeFilterChips = useMemo(() => {
    const chips: Array<{ key: string; label: string; onRemove: () => void }> = [];
    if (ecdSlice) {
      const label = pieData.find((p) => p.key === ecdSlice)?.label ?? ecdSlice;
      chips.push({ key: "ecd", label: `ECD: ${label}`, onRemove: () => setEcdSlice(null) });
    }
    if (complexityBarBucket) {
      const label = complexityBars.find((b) => b.bucketKey === complexityBarBucket)?.bucketLabel ?? complexityBarBucket;
      chips.push({
        key: "bucket",
        label: `Complexity bucket: ${label}`,
        onRemove: () => setComplexityBarBucket(null),
      });
    }
    if (remainingComplexityGroup) {
      chips.push({
        key: "rg",
        label: `Complexity group: ${remainingComplexityGroup}`,
        onRemove: () => setRemainingComplexityGroup(null),
      });
    }
    if (remainingProcessingStage) {
      chips.push({
        key: "stage",
        label: `Processing: ${remainingProcessingStage}`,
        onRemove: () => setRemainingProcessingStage(null),
      });
    }
    for (const col of ESTIMATED_CLOSINGS_DETAIL_COLUMNS) {
      const filter = detailColumnFilters[col.id];
      if (!isFilterActive(filter) || !filter) continue;
      if (filter.kind === "text") {
        for (const v of filter.selectedValues) {
          chips.push({
            key: `${col.id}:t:${v}`,
            label: `${col.label}: ${v === EMPTY_FILTER_TOKEN ? "(Blank)" : v}`,
            onRemove: () => {
              setDetailColumnFilters((prev) => {
                const cur = prev[col.id];
                if (!cur || cur.kind !== "text") return prev;
                const nv = cur.selectedValues.filter((x) => x !== v);
                const next = { ...prev };
                if (nv.length === 0) delete next[col.id];
                else next[col.id] = { ...cur, selectedValues: nv };
                return next;
              });
            },
          });
        }
      } else if (filter.kind === "number" && filter.mode === "all") {
        for (const v of filter.selectedValues) {
          chips.push({
            key: `${col.id}:n:${v}`,
            label: `${col.label}: ${v === EMPTY_FILTER_TOKEN ? "(Blank)" : v}`,
            onRemove: () => {
              setDetailColumnFilters((prev) => {
                const cur = prev[col.id];
                if (!cur || cur.kind !== "number" || cur.mode !== "all") return prev;
                const nv = cur.selectedValues.filter((x) => x !== v);
                const next = { ...prev };
                if (nv.length === 0) delete next[col.id];
                else next[col.id] = { ...cur, selectedValues: nv };
                return next;
              });
            },
          });
        }
      } else if (filter.kind === "number") {
        chips.push({
          key: `${col.id}:nr`,
          label: `${col.label}: ${filter.mode === "range" ? `${filter.min ?? ""}–${filter.max ?? ""}` : filter.value ?? ""}`,
          onRemove: () =>
            setDetailColumnFilters((prev) => {
              const next = { ...prev };
              delete next[col.id];
              return next;
            }),
        });
      } else if (filter.kind === "date") {
        chips.push({
          key: `${col.id}:d`,
          label: `${col.label}: ${filter.shortcut?.trim() ? filter.shortcut : `${filter.from ?? ""} → ${filter.to ?? ""}`}`,
          onRemove: () =>
            setDetailColumnFilters((prev) => {
              const next = { ...prev };
              delete next[col.id];
              return next;
            }),
        });
      } else if (filter.kind === "boolean") {
        chips.push({
          key: `${col.id}:b`,
          label: `${col.label}: ${filter.value}`,
          onRemove: () =>
            setDetailColumnFilters((prev) => {
              const next = { ...prev };
              delete next[col.id];
              return next;
            }),
        });
      }
    }
    return chips;
  }, [
    ecdSlice,
    complexityBarBucket,
    remainingComplexityGroup,
    remainingProcessingStage,
    detailColumnFilters,
    pieData,
    complexityBars,
  ]);

  const complexityTotals = useMemo(() => {
    const rows = data?.remainingToFundByComplexity ?? [];
    const units = rows.reduce((sum, row) => sum + row.unitsRemainingToFund, 0);
    return { pooledFallout: data?.historicalFalloutPooled13Months ?? null, units };
  }, [data?.remainingToFundByComplexity, data?.historicalFalloutPooled13Months]);

  const complexityRowsSorted = useMemo(
    () => sortRowsByConfig((data?.remainingToFundByComplexity ?? []) as Record<string, unknown>[], complexitySort),
    [data?.remainingToFundByComplexity, complexitySort],
  );
  const stageRowsSorted = useMemo(
    () => sortRowsByConfig((data?.remainingToFundByProcessingStage ?? []) as Record<string, unknown>[], stageSort),
    [data?.remainingToFundByProcessingStage, stageSort],
  );
  const daysRemainingInCurrentMonth = useMemo(() => {
    const now = new Date();
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    const msPerDay = 24 * 60 * 60 * 1000;
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfEndDate = new Date(endOfMonth.getFullYear(), endOfMonth.getMonth(), endOfMonth.getDate());
    return Math.max(0, Math.floor((startOfEndDate.getTime() - startOfToday.getTime()) / msPerDay));
  }, []);
  const detailRowsSorted = useMemo(
    () => sortRowsByConfig((data?.detail.rows ?? []) as Record<string, unknown>[], detailSort),
    [data?.detail.rows, detailSort],
  );

  const detailTableTotals = useMemo(() => {
    let units = 0;
    let volume = 0;
    for (const row of detailRowsSorted) {
      units += Number(row.units ?? 1) || 0;
      const v = row.volume;
      if (v != null && !Number.isNaN(Number(v))) volume += Number(v);
    }
    return {
      units,
      volume,
      avgComplexity: averageNonZero(detailRowsSorted, "complexity"),
      avgFico: averageNonZero(detailRowsSorted, "fico"),
      avgLtv: averageNonZero(detailRowsSorted, "ltv"),
      avgBeDti: averageNonZero(detailRowsSorted, "beDti"),
      avgAppToDispositionDays: averageNonZero(detailRowsSorted, "appToDispositionDays"),
    };
  }, [detailRowsSorted]);

  const detailRowVirtualizer = useVirtualizer({
    count: detailRowsSorted.length,
    getScrollElement: () => detailScrollElement,
    estimateSize: () => DETAIL_VIRTUAL_ROW_HEIGHT,
    overscan: DETAIL_VIRTUAL_OVERSCAN,
  });
  const virtualDetailRows = detailRowVirtualizer.getVirtualItems();
  const detailPaddingTop = virtualDetailRows.length > 0 ? virtualDetailRows[0].start : 0;
  const detailPaddingBottom =
    virtualDetailRows.length > 0
      ? detailRowVirtualizer.getTotalSize() - virtualDetailRows[virtualDetailRows.length - 1].end
      : 0;

  useEffect(() => {
    detailScrollElement?.scrollTo({ top: 0 });
  }, [detailRowsSorted, detailScrollElement]);

  const DETAIL_TOTALS_TAIL_COLSPAN = 17;

  const clearFilterSearch = useCallback((columnId: string) => {
    const timers = searchDebounceTimersRef.current;
    if (timers[columnId]) {
      clearTimeout(timers[columnId]);
      delete timers[columnId];
    }
    setFilterSearchByColumn((prev) => {
      if (!(columnId in prev)) return prev;
      const next = { ...prev };
      delete next[columnId];
      return next;
    });
    setDebouncedFilterSearchByColumn((prev) => {
      if (!(columnId in prev)) return prev;
      const next = { ...prev };
      delete next[columnId];
      return next;
    });
  }, []);

  const updateFilterSearch = useCallback((columnId: string, value: string) => {
    setFilterSearchByColumn((prev) => ({ ...prev, [columnId]: value }));
    const timers = searchDebounceTimersRef.current;
    if (timers[columnId]) clearTimeout(timers[columnId]);
    timers[columnId] = setTimeout(() => {
      setDebouncedFilterSearchByColumn((prev) => ({ ...prev, [columnId]: value }));
    }, 200);
  }, []);

  const closePopoverWithoutDiscard = useCallback(
    (columnId: string) => {
      setOpenDetailFilterColumnId((current) => (current === columnId ? null : current));
      clearFilterSearch(columnId);
    },
    [clearFilterSearch],
  );

  const beginDetailDraft = useCallback(
    (columnId: string) => {
      setDraftDetailFilters((prev) => {
        if (prev[columnId] !== undefined) return prev;
        return { ...prev, [columnId]: cloneFilter(detailColumnFilters[columnId]) };
      });
    },
    [detailColumnFilters],
  );

  const setDraftDetailFilter = useCallback((columnId: string, next: NonNullable<ColumnFilterState[string]>) => {
    setDraftDetailFilters((prev) => ({ ...prev, [columnId]: next }));
  }, []);

  const clearDraftDetailFilter = useCallback((columnId: string) => {
    setDraftDetailFilters((prev) => {
      const next = { ...prev };
      delete next[columnId];
      return next;
    });
  }, []);

  const commitDetailDraft = useCallback(
    (columnId: string) => {
      const draft = draftDetailFiltersRef.current[columnId];
      setDetailColumnFilters((prev) => {
        if (!draft || !isFilterActive(draft)) {
          const next = { ...prev };
          delete next[columnId];
          return next;
        }
        const c = cloneFilter(draft);
        return c ? { ...prev, [columnId]: c } : prev;
      });
      setDraftDetailFilters((prev) => {
        const next = { ...prev };
        delete next[columnId];
        return next;
      });
      setOpenDetailFilterColumnId((cur) => (cur === columnId ? null : cur));
      clearFilterSearch(columnId);
    },
    [clearFilterSearch],
  );

  const discardDetailDraft = useCallback(
    (columnId: string) => {
      setDraftDetailFilters((prev) => {
        const next = { ...prev };
        delete next[columnId];
        return next;
      });
      setOpenDetailFilterColumnId((cur) => (cur === columnId ? null : cur));
      clearFilterSearch(columnId);
    },
    [clearFilterSearch],
  );

  const toggleDetailDraftValue = useCallback((columnId: string, value: string, kind: LoanDetailFilterKind) => {
    setDraftDetailFilters((prev) => {
      const current = prev[columnId];
      if (kind === "number") {
        const selected = current?.kind === "number" ? current.selectedValues : [];
        const selectedValues = selected.includes(value) ? selected.filter((item) => item !== value) : [...selected, value];
        return { ...prev, [columnId]: { kind: "number", mode: "all" as const, selectedValues } };
      }
      const selected = current?.kind === "text" ? current.selectedValues : [];
      const selectedValues = selected.includes(value) ? selected.filter((item) => item !== value) : [...selected, value];
      return { ...prev, [columnId]: { kind: "text", selectedValues } };
    });
  }, []);

  const renderEstimatedClosingsDetailFilterContent = useCallback(
    (col: EstimatedClosingsDetailColumnDefMini) => {
      const filterKind = col.kind;
      const cached = detailDistinctCache[col.id];
      const allValues = cached?.values ?? [];
      const hasBlank = cached?.hasBlank ?? false;
      const valuesForList = hasBlank ? [EMPTY_FILTER_TOKEN, ...allValues] : allValues;
      const search = (debouncedFilterSearchByColumn[col.id] ?? "").toLowerCase();
      const isLoanNumberColumn = col.id === "loanNumber";
      const filteredOptions = search
        ? valuesForList.filter((value) => {
            if (value === EMPTY_FILTER_TOKEN) return "(blank)".includes(search);
            const normalized = value.toLowerCase();
            return isLoanNumberColumn ? normalized.startsWith(search) : normalized.includes(search);
          })
        : valuesForList;
      const filter = draftDetailFilters[col.id] ?? cloneFilter(detailColumnFilters[col.id]);
      const selectedValues =
        filter?.kind === "text"
          ? filter.selectedValues
          : filter?.kind === "number" && filter.mode === "all"
            ? filter.selectedValues
            : [];
      const orderedOptions = [...filteredOptions].sort((a, b) => {
        const aSelected = selectedValues.includes(a) ? 1 : 0;
        const bSelected = selectedValues.includes(b) ? 1 : 0;
        if (aSelected !== bSelected) return bSelected - aSelected;
        if (a === EMPTY_FILTER_TOKEN) return -1;
        if (b === EMPTY_FILTER_TOKEN) return 1;
        return a.localeCompare(b, undefined, { numeric: true });
      });
      const displayedOptions = isLoanNumberColumn ? orderedOptions.slice(0, LOAN_NUMBER_FILTER_MAX_OPTIONS) : orderedOptions;

      if (filterKind === "boolean") {
        const value = filter?.kind === "boolean" ? filter.value : "all";
        return (
          <div className="space-y-2">
            {(["all", "yes", "no"] as const).map((option) => (
              <Button
                key={option}
                type="button"
                size="sm"
                variant={value === option ? "default" : "outline"}
                className="w-full justify-start"
                onClick={() => setDraftDetailFilter(col.id, { kind: "boolean", value: option })}
              >
                {option === "all" ? "All" : option === "yes" ? "Yes" : "No"}
              </Button>
            ))}
          </div>
        );
      }

      if (filterKind === "date") {
        const dateFilter = filter?.kind === "date" ? filter : { kind: "date" as const };
        const yearToken = String(new Date().getFullYear());
        const fixedYears = ["2025", "2024", "2023"];
        const dateShortcutOptions: Array<{ token: string; label: string; kind: "preset" | "year" | "ytd" }> = [
          { token: "last-30-days", label: "Last 30 Days", kind: "preset" },
          { token: "mtd", label: "MTD", kind: "preset" },
          { token: "last-month", label: "Last Month", kind: "preset" },
          { token: "ytd", label: `${yearToken} YTD`, kind: "ytd" },
          ...fixedYears.map((y) => ({ token: y, label: y, kind: "year" as const })),
          { token: "rolling-13", label: getPeriodPresetMeta("rolling-13").label, kind: "preset" },
          { token: "rolling-12", label: getPeriodPresetMeta("rolling-12").label, kind: "preset" },
        ];
        return (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <Input
                type="date"
                value={dateFilter.from ?? ""}
                onChange={(e) =>
                  setDraftDetailFilter(col.id, { kind: "date", from: e.target.value, to: dateFilter.to })
                }
              />
              <Input
                type="date"
                value={dateFilter.to ?? ""}
                onChange={(e) =>
                  setDraftDetailFilter(col.id, { kind: "date", from: dateFilter.from, to: e.target.value })
                }
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              {dateShortcutOptions.map((opt) => (
                <Button
                  key={opt.token}
                  type="button"
                  size="sm"
                  variant={dateFilter.shortcut === opt.token ? "default" : "outline"}
                  onClick={() => {
                    if (opt.kind === "year") {
                      const from = `${opt.token}-01-01`;
                      const to = `${opt.token}-12-31`;
                      setDraftDetailFilter(col.id, { kind: "date", shortcut: opt.token, from, to });
                      return;
                    }
                    if (opt.kind === "ytd") {
                      const range = computePresetDateRange("ytd");
                      setDraftDetailFilter(col.id, { kind: "date", shortcut: "ytd", from: range.start, to: range.end });
                      return;
                    }
                    const preset = opt.token as PeriodPreset;
                    const range = computePresetDateRange(preset);
                    setDraftDetailFilter(col.id, { kind: "date", shortcut: opt.token, from: range.start, to: range.end });
                  }}
                >
                  {opt.label}
                </Button>
              ))}
            </div>
            <Button type="button" size="sm" variant="ghost" className="w-full" onClick={() => clearDraftDetailFilter(col.id)}>
              Clear Selection
            </Button>
          </div>
        );
      }

      if (filterKind === "number") {
        const numberFilter =
          filter?.kind === "number"
            ? filter
            : { kind: "number" as const, mode: "all" as NumericFilterMode, selectedValues: [] };
        return (
          <Tabs
            value={numberFilter.mode}
            onValueChange={(mode) =>
              setDraftDetailFilter(col.id, { kind: "number", mode: mode as NumericFilterMode, selectedValues: [] })
            }
          >
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="all">All</TabsTrigger>
              <TabsTrigger value="range">Range</TabsTrigger>
              <TabsTrigger value="min">Greater Than</TabsTrigger>
              <TabsTrigger value="max">Less Than</TabsTrigger>
            </TabsList>
            <TabsContent value="all" className="space-y-2">
              <Command shouldFilter={false}>
                <CommandInput
                  placeholder={`Search ${col.label}`}
                  value={filterSearchByColumn[col.id] ?? ""}
                  onValueChange={(value) => updateFilterSearch(col.id, value)}
                />
                <CommandList>
                  <CommandEmpty>No values found.</CommandEmpty>
                  {displayedOptions.map((value) => {
                    const isDraftSelected = numberFilter.selectedValues.includes(value);
                    return (
                      <CommandItem
                        key={value === EMPTY_FILTER_TOKEN ? "__b" : value}
                        onSelect={() => toggleDetailDraftValue(col.id, value, "number")}
                        className={cn(
                          "cursor-pointer hover:!bg-transparent hover:!text-foreground data-[selected=true]:!bg-transparent data-[selected=true]:!text-foreground",
                          isDraftSelected
                            ? "!bg-accent !text-accent-foreground hover:!bg-accent hover:!text-accent-foreground data-[selected=true]:!bg-accent data-[selected=true]:!text-accent-foreground"
                            : "",
                        )}
                      >
                        <span className="mr-2">{isDraftSelected ? "✓" : ""}</span>
                        {value === EMPTY_FILTER_TOKEN ? "(Blank)" : value}
                      </CommandItem>
                    );
                  })}
                </CommandList>
              </Command>
              {isLoanNumberColumn && orderedOptions.length > displayedOptions.length && (
                <p className="px-1 text-xs text-slate-500 dark:text-slate-400">
                  Showing first {LOAN_NUMBER_FILTER_MAX_OPTIONS} matches. Keep typing to narrow results.
                </p>
              )}
              <Button type="button" size="sm" variant="ghost" className="w-full" onClick={() => clearDraftDetailFilter(col.id)}>
                Clear Selection
              </Button>
            </TabsContent>
            <TabsContent value="range" className="space-y-2">
              <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                <Input
                  type="number"
                  placeholder="Min"
                  value={numberFilter.min ?? ""}
                  onChange={(e) =>
                    setDraftDetailFilter(col.id, {
                      kind: "number",
                      mode: "range",
                      selectedValues: [],
                      min: e.target.value,
                      max: numberFilter.max,
                    })
                  }
                />
                <span>-</span>
                <Input
                  type="number"
                  placeholder="Max"
                  value={numberFilter.max ?? ""}
                  onChange={(e) =>
                    setDraftDetailFilter(col.id, {
                      kind: "number",
                      mode: "range",
                      selectedValues: [],
                      min: numberFilter.min,
                      max: e.target.value,
                    })
                  }
                />
              </div>
              <Button type="button" size="sm" variant="ghost" className="w-full" onClick={() => clearDraftDetailFilter(col.id)}>
                Clear Selection
              </Button>
            </TabsContent>
            <TabsContent value="min" className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-sm">{">="}</span>
                <Input
                  type="number"
                  placeholder="Value"
                  value={numberFilter.value ?? ""}
                  onChange={(e) =>
                    setDraftDetailFilter(col.id, {
                      kind: "number",
                      mode: "min",
                      selectedValues: [],
                      value: e.target.value,
                    })
                  }
                />
              </div>
              <Button type="button" size="sm" variant="ghost" className="w-full" onClick={() => clearDraftDetailFilter(col.id)}>
                Clear Selection
              </Button>
            </TabsContent>
            <TabsContent value="max" className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-sm">{"<="}</span>
                <Input
                  type="number"
                  placeholder="Value"
                  value={numberFilter.value ?? ""}
                  onChange={(e) =>
                    setDraftDetailFilter(col.id, {
                      kind: "number",
                      mode: "max",
                      selectedValues: [],
                      value: e.target.value,
                    })
                  }
                />
              </div>
              <Button type="button" size="sm" variant="ghost" className="w-full" onClick={() => clearDraftDetailFilter(col.id)}>
                Clear Selection
              </Button>
            </TabsContent>
          </Tabs>
        );
      }

      const textFilter = filter?.kind === "text" ? filter : { kind: "text" as const, selectedValues: [] };
      return (
        <div className="space-y-2">
          <Command shouldFilter={false}>
            <CommandInput
              placeholder={`Search ${col.label}`}
              value={filterSearchByColumn[col.id] ?? ""}
              onValueChange={(value) => updateFilterSearch(col.id, value)}
            />
            <CommandList>
              <CommandEmpty>No values found.</CommandEmpty>
              {displayedOptions.map((value) => {
                const isDraftSelected = textFilter.selectedValues.includes(value);
                return (
                  <CommandItem
                    key={value === EMPTY_FILTER_TOKEN ? "__b" : value}
                    onSelect={() => toggleDetailDraftValue(col.id, value, "text")}
                    className={cn(
                      "cursor-pointer hover:!bg-transparent hover:!text-foreground data-[selected=true]:!bg-transparent data-[selected=true]:!text-foreground",
                      isDraftSelected
                        ? "!bg-accent !text-accent-foreground hover:!bg-accent hover:!text-accent-foreground data-[selected=true]:!bg-accent data-[selected=true]:!text-accent-foreground"
                        : "",
                    )}
                  >
                    <span className="mr-2">{isDraftSelected ? "✓" : ""}</span>
                    {value === EMPTY_FILTER_TOKEN ? "(Blank)" : value}
                  </CommandItem>
                );
              })}
            </CommandList>
          </Command>
          {isLoanNumberColumn && orderedOptions.length > displayedOptions.length && (
            <p className="px-1 text-xs text-slate-500 dark:text-slate-400">
              Showing first {LOAN_NUMBER_FILTER_MAX_OPTIONS} matches. Keep typing to narrow results.
            </p>
          )}
          <Button type="button" size="sm" variant="ghost" className="w-full" onClick={() => clearDraftDetailFilter(col.id)}>
            Clear Selection
          </Button>
        </div>
      );
    },
    [
      detailDistinctCache,
      debouncedFilterSearchByColumn,
      draftDetailFilters,
      detailColumnFilters,
      filterSearchByColumn,
      setDraftDetailFilter,
      clearDraftDetailFilter,
      toggleDetailDraftValue,
      updateFilterSearch,
    ],
  );

  const applyDetailCellFilter = useCallback((columnId: string, row: Record<string, unknown>) => {
    const col = ESTIMATED_CLOSINGS_DETAIL_COLUMN_BY_ID[columnId];
    if (!col) return;
    const raw = getDetailRaw(row, columnId);
    const token = getCellToken(columnId, raw);

    setShowDetailColumnFilters(true);
    setDetailColumnFilters((prev) => {
      if (col.kind === "number") {
        const cur = prev[columnId];
        if (cur?.kind === "number" && cur.mode === "all" && cur.selectedValues.length === 1 && cur.selectedValues[0] === token) {
          const next = { ...prev };
          delete next[columnId];
          return next;
        }
        return { ...prev, [columnId]: { kind: "number", mode: "all", selectedValues: [token] } };
      }
      if (col.kind === "text") {
        const cur = prev[columnId];
        if (cur?.kind === "text" && cur.selectedValues.length === 1 && cur.selectedValues[0] === token) {
          const next = { ...prev };
          delete next[columnId];
          return next;
        }
        return { ...prev, [columnId]: { kind: "text", selectedValues: [token] } };
      }
      if (col.kind === "boolean") {
        const option = token === "yes" ? "yes" : "no";
        const cur = prev[columnId];
        const curVal = cur?.kind === "boolean" ? cur.value : "all";
        const next = { ...prev };
        if (curVal === option) delete next[columnId];
        else next[columnId] = { kind: "boolean", value: option };
        return next;
      }
      const dateStr = raw != null && String(raw).trim() !== "" && String(raw) !== "-" ? String(raw).trim() : "";
      if (!dateStr) return prev;
      const cur = prev[columnId];
      if (cur?.kind === "date" && cur.from === dateStr && cur.to === dateStr) {
        const next = { ...prev };
        delete next[columnId];
        return next;
      }
      return { ...prev, [columnId]: { kind: "date", from: dateStr, to: dateStr } };
    });
  }, []);

  const cellHighlight = useCallback(
    (row: Record<string, unknown>, columnId: string) => {
      const f = detailColumnFilters[columnId];
      if (!isFilterActive(f) || !f) return false;
      return valueMatchesColumnFilter(getDetailRaw(row, columnId), f);
    },
    [detailColumnFilters],
  );

  const toggleSort = (key: string, current: SortConfig, setSort: (value: SortConfig) => void) => {
    if (current.key === key) {
      setSort({ key, direction: current.direction === "asc" ? "desc" : "asc" });
      return;
    }
    setSort({ key, direction: "asc" });
  };

  const SortIcon = ({ active, dir }: { active: boolean; dir: SortDirection }) => {
    if (!active) return <ArrowUpDown className="h-3.5 w-3.5 opacity-40" />;
    return dir === "asc" ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />;
  };

  const activeDetailFilterIds = useMemo(
    () => new Set(Object.keys(detailColumnFilters).filter((id) => isFilterActive(detailColumnFilters[id]))),
    [detailColumnFilters],
  );

  const handlePieClick = useCallback(
    (_: unknown, index: number) => {
      const entry = pieData[index];
      if (entry?.key) toggleEcdSlice(entry.key);
    },
    [pieData, toggleEcdSlice],
  );

  const handleBarChartClick = useCallback(
    (state: unknown) => {
      const s = state as { activePayload?: Array<{ payload?: { bucketKey?: string } }> } | null;
      const k = s?.activePayload?.[0]?.payload?.bucketKey as EstimatedClosingsComplexityBucketKey | undefined;
      if (k && ["gte_130", "gte_120", "gte_110", "all_rest"].includes(k)) toggleComplexityBucket(k);
    },
    [toggleComplexityBucket],
  );

  const exportComplexityTable = useCallback(() => {
    const rows = complexityRowsSorted.map((row) => [
      row.complexityGroup,
      row.unitsRemainingToFund,
      toNumberOrNull(row.historicalFalloutLast13Months),
    ]);
    rows.push(["Totals", complexityTotals.units, complexityTotals.pooledFallout]);
    downloadCsvFile(
      "estimated-closings-complexity-table.csv",
      ["Complexity Group", "Units Remaining", "Historical % Fallout (13M)"],
      rows,
    );
  }, [complexityRowsSorted, complexityTotals.units, complexityTotals.pooledFallout]);

  const exportStageTable = useCallback(() => {
    const rows = stageRowsSorted.map((row) => [
      row.processingStage,
      row.unitsRemainingToFund,
      daysRemainingInCurrentMonth,
      toNumberOrNull(row.historicalFallout),
      toNumberOrNull(row.historicalStatusToFundDays),
    ]);
    downloadCsvFile(
      "estimated-closings-stage-table.csv",
      [
        "Processing Stage",
        "Units Remaining",
        "Days Remaining in Current Month",
        "Historical Fallout",
        "Historical Status to Fund Days",
      ],
      rows,
    );
  }, [daysRemainingInCurrentMonth, stageRowsSorted]);

  const exportDetailTable = useCallback(async () => {
    if (detailCsvExporting || !selectedTenantId) return;
    setDetailCsvExporting(true);
    try {
      const { rows } = await fetchAllEstimatedClosingsDetailRows({
        tenantId: selectedTenantId,
        channelGroup: selectedChannel,
        dateRangeType,
        pageSliceFilters,
        detailColumnFilters,
      });
      const sorted = sortRowsByConfig(rows as Record<string, unknown>[], detailSort);
      const headers = ESTIMATED_CLOSINGS_DETAIL_COLUMNS.map((c) => c.label);
      const csvRows = sorted.map((row) =>
        ESTIMATED_CLOSINGS_DETAIL_COLUMNS.map((c) => row[c.id] ?? ""),
      );
      downloadCsvFile("estimated-closings-loan-detail.csv", headers, csvRows);
    } catch (e) {
      console.error("Failed to export loan detail CSV", e);
      window.alert(
        e instanceof Error ? e.message : "Could not download full loan detail CSV. Please try again.",
      );
    } finally {
      setDetailCsvExporting(false);
    }
  }, [
    detailCsvExporting,
    selectedTenantId,
    selectedChannel,
    dateRangeType,
    pageSliceFilters,
    detailColumnFilters,
    detailSort,
  ]);

  const renderDetailHeadCell = (colId: string, sortKey: string, label: string) => {
    const col = ESTIMATED_CLOSINGS_DETAIL_COLUMN_BY_ID[colId];

    return (
      <TableHead key={colId} className="align-top">
        <div className="flex items-center gap-0.5 min-w-0">
          <button
            type="button"
            className={cn(
              "inline-flex items-center gap-1 min-w-0 shrink",
              activeDetailFilterIds.has(colId) && "text-emerald-700 dark:text-emerald-400",
            )}
            onClick={() => toggleSort(sortKey, detailSort, setDetailSort)}
          >
            <span className="truncate">{label}</span>
            <SortIcon active={detailSort.key === sortKey} dir={detailSort.direction} />
          </button>
          {showDetailColumnFilters && col && (
            <Popover
              open={openDetailFilterColumnId === colId}
              onOpenChange={(open) => {
                if (open) {
                  beginDetailDraft(colId);
                  setOpenDetailFilterColumnId(colId);
                } else {
                  closePopoverWithoutDiscard(colId);
                }
              }}
            >
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className={cn(
                    "shrink-0 rounded p-1",
                    activeDetailFilterIds.has(colId)
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100",
                  )}
                  aria-label={`Filter ${label}`}
                >
                  <Filter className="h-3.5 w-3.5" />
                </button>
              </PopoverTrigger>
              <PopoverContent
                align="start"
                className={cn("p-3", col.kind === "number" ? "w-[420px]" : "w-80")}
                onInteractOutside={(event) => event.preventDefault()}
                onPointerDownOutside={(event) => event.preventDefault()}
                onEscapeKeyDown={(event) => event.preventDefault()}
              >
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div>
                    <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">{label}</div>
                    <div className="text-[11px] text-slate-400 dark:text-slate-500">
                      Select one or more values from the list below.
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={() => discardDetailDraft(colId)}
                      aria-label={`Cancel ${label} filter changes`}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={() => commitDetailDraft(colId)}
                      aria-label={`Apply ${label} filter changes`}
                    >
                      Apply Filters
                    </Button>
                  </div>
                </div>
                {renderEstimatedClosingsDetailFilterContent(col)}
              </PopoverContent>
            </Popover>
          )}
        </div>
      </TableHead>
    );
  };

  const clickableCellClass =
    "cursor-pointer rounded px-1 py-0.5 -mx-1 -my-0.5 transition-colors hover:bg-sky-100/80 dark:hover:bg-sky-900/40";

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Estimated Closings and Risk Analysis</h2>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Active pipeline and funding readiness using Estimated Closing Date (ECD).
          </p>
        </div>
        <div className="w-full sm:w-60">
          <Select value={dateRangeType} onValueChange={(v) => setDateRangeType(v as EstimatedClosingsDateRangeType)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="calendar_days">Calendar Days</SelectItem>
              <SelectItem value="business_days">Business Days</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {hasAnyFilter && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200/80 bg-slate-50/80 px-3 py-2 dark:border-slate-700 dark:bg-slate-900/40">
          {activeFilterChips.map((chip) => (
            <Badge key={chip.key} variant="outline" className="gap-1 border-emerald-300/80 bg-emerald-50 text-emerald-800 dark:border-emerald-700/80 dark:bg-emerald-950/40 dark:text-emerald-200">
              <span className="max-w-[280px] truncate">{chip.label}</span>
              <button type="button" onClick={chip.onRemove} className="rounded-sm p-0.5 hover:bg-emerald-200/50 dark:hover:bg-emerald-900/50" aria-label={`Remove ${chip.label}`}>
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
          <Button type="button" variant="ghost" size="sm" className="h-8 text-xs" onClick={clearAllPageFilters}>
            Clear all filters
          </Button>
        </div>
      )}

      {loading && <div className="text-sm text-slate-600 dark:text-slate-300">Loading dashboard data...</div>}
      {error && <div className="text-sm text-red-600 dark:text-red-400">{error}</div>}

      {kpis && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <Card><CardHeader className="pb-1"><CardTitle className="text-xs"><KpiLabel label="Total Active Pipeline" description={KPI_DESCRIPTIONS.totalActivePipeline} /></CardTitle></CardHeader><CardContent className="text-xl font-semibold">{kpis.totalActivePipeline.toLocaleString()}</CardContent></Card>
          <Card><CardHeader className="pb-1"><CardTitle className="text-xs"><KpiLabel label="ECD Empty or After This Month" description={KPI_DESCRIPTIONS.ecdEmptyOrAfterThisMonth} /></CardTitle></CardHeader><CardContent className="text-xl font-semibold">{kpis.ecdEmptyOrAfterThisMonth.toLocaleString()}</CardContent></Card>
          <Card><CardHeader className="pb-1"><CardTitle className="text-xs"><KpiLabel label="Remaining to Fund This Month" description={KPI_DESCRIPTIONS.remainingToFund} /></CardTitle></CardHeader><CardContent className="text-xl font-semibold">{kpis.remainingToFund.toLocaleString()}</CardContent></Card>
          <Card><CardHeader className="pb-1"><CardTitle className="text-xs"><KpiLabel label="Funded This Month" description={KPI_DESCRIPTIONS.fundedThisMonth} /></CardTitle></CardHeader><CardContent className="text-xl font-semibold">{kpis.fundedThisMonth.toLocaleString()}</CardContent></Card>
          <Card><CardHeader className="pb-1"><CardTitle className="text-xs"><KpiLabel label="Max Possible Funding" description={KPI_DESCRIPTIONS.maxPossibleFunding} /></CardTitle></CardHeader><CardContent className="text-xl font-semibold">{kpis.maxPossibleFunding.toLocaleString()}</CardContent></Card>
          <Card><CardHeader className="pb-1"><CardTitle className="text-xs"><KpiLabel label="Funding YTD Units" description={KPI_DESCRIPTIONS.fundingYtdUnits} /></CardTitle></CardHeader><CardContent className="text-xl font-semibold">{kpis.fundingYtdUnits.toLocaleString()}</CardContent></Card>
          <Card><CardHeader className="pb-1"><CardTitle className="text-xs"><KpiLabel label={`${prevMonthYearMon} — Actual (units)`} description={prevMonthUnitsDescription} /></CardTitle></CardHeader><CardContent className="text-xl font-semibold">{kpis.prevMonthActualUnits.toLocaleString()}</CardContent></Card>
          <Card><CardHeader className="pb-1"><CardTitle className="text-xs"><KpiLabel label={`${prevMonthYearMon} — Actual ($)`} description={prevMonthVolumeDescription} /></CardTitle></CardHeader><CardContent className="text-xl font-semibold">{formatCurrency(kpis.prevMonthActualVolume)}</CardContent></Card>
          <Card><CardHeader className="pb-1"><CardTitle className="text-xs"><KpiLabel label="Units Last Month vs Prior" description={KPI_DESCRIPTIONS.unitsLastMonthVsPriorPct} /></CardTitle></CardHeader><CardContent className="text-xl font-semibold">{formatPercent(kpis.unitsLastMonthVsPriorPct)}</CardContent></Card>
          <Card><CardHeader className="pb-1"><CardTitle className="text-xs"><KpiLabel label="Volume Last Month vs Prior" description={KPI_DESCRIPTIONS.volumeLastMonthVsPriorPct} /></CardTitle></CardHeader><CardContent className="text-xl font-semibold">{formatPercent(kpis.volumeLastMonthVsPriorPct)}</CardContent></Card>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-sm">Active Pipeline, Estimated Closing Dates</CardTitle>
            <Button type="button" size="sm" variant="outline" onClick={() => void downloadChartAsImage(pieChartContainerRef.current, "estimated-closings-ecd-pie.png")}>
              <Download className="mr-1 h-4 w-4" />
              Download
            </Button>
          </CardHeader>
          <CardContent className="h-72" ref={pieChartContainerRef}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={pieData}
                  dataKey="count"
                  nameKey="label"
                  outerRadius={95}
                  label={(entry) => `${entry.label}: ${entry.count}`}
                  className="cursor-pointer [&_path]:outline-none"
                  onClick={(d, i) => handlePieClick(d, i ?? 0)}
                >
                  {pieData.map((entry, idx) => (
                    <Cell key={entry.key} fill={PIE_COLORS[idx % PIE_COLORS.length]} opacity={ecdSlice != null && ecdSlice !== entry.key ? 0.35 : 1} />
                  ))}
                </Pie>
                <RechartsTooltip />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-sm">Max Possible Funding, by Complexity</CardTitle>
            <Button type="button" size="sm" variant="outline" onClick={() => void downloadChartAsImage(barChartContainerRef.current, "estimated-closings-max-possible-funding-bar.png")}>
              <Download className="mr-1 h-4 w-4" />
              Download
            </Button>
          </CardHeader>
          <CardContent className="h-72" ref={barChartContainerRef}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={complexityBars} margin={{ top: 8, right: 8, left: 8, bottom: 8 }} onClick={handleBarChartClick}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="bucketLabel" label={{ value: "Complexity", position: "insideBottom", offset: -5 }} />
                <YAxis label={{ value: "Units", angle: -90, position: "insideLeft" }} />
                <RechartsTooltip />
                <Bar dataKey="funded" stackId="a" fill="#3b82f6" name="Funded" className="cursor-pointer" />
                <Bar dataKey="notFunded" stackId="a" fill="#ef4444" name="Not Funded" className="cursor-pointer" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-sm">Remaining to Fund, Experience by Complexity</CardTitle>
            <Button type="button" size="sm" variant="outline" onClick={exportComplexityTable}>
              <Download className="mr-1 h-4 w-4" />
              Download CSV
            </Button>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>
                    <button className="inline-flex items-center gap-1" onClick={() => toggleSort("complexityGroup", complexitySort, setComplexitySort)}>
                      Complexity Group
                      <SortIcon active={complexitySort.key === "complexityGroup"} dir={complexitySort.direction} />
                    </button>
                  </TableHead>
                  <TableHead className="text-right">
                    <button className="ml-auto inline-flex items-center gap-1" onClick={() => toggleSort("unitsRemainingToFund", complexitySort, setComplexitySort)}>
                      Units Remaining
                      <SortIcon active={complexitySort.key === "unitsRemainingToFund"} dir={complexitySort.direction} />
                    </button>
                  </TableHead>
                  <TableHead className="text-right">
                    <button className="ml-auto inline-flex items-center gap-1" onClick={() => toggleSort("historicalFalloutLast13Months", complexitySort, setComplexitySort)}>
                      Historical % Fallout (13M)
                      <SortIcon active={complexitySort.key === "historicalFalloutLast13Months"} dir={complexitySort.direction} />
                    </button>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {complexityRowsSorted.map((row) => {
                  const g = String(row.complexityGroup);
                  const active = remainingComplexityGroup === g;
                  return (
                    <TableRow
                      key={String(row.sortOrder)}
                      className={cn("cursor-pointer", active && "bg-emerald-50/90 dark:bg-emerald-950/30")}
                      onClick={() => toggleRemainingComplexityGroup(g)}
                    >
                      <TableCell>{g}</TableCell>
                      <TableCell className="text-right">{Number(row.unitsRemainingToFund).toLocaleString()}</TableCell>
                      <TableCell className="text-right">{formatPercent(toNumberOrNull(row.historicalFalloutLast13Months))}</TableCell>
                    </TableRow>
                  );
                })}
                <TableRow>
                  <TableCell className="font-semibold">Totals</TableCell>
                  <TableCell className="text-right font-semibold">{complexityTotals.units.toLocaleString()}</TableCell>
                  <TableCell className="text-right font-semibold">{formatPercent(complexityTotals.pooledFallout)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-sm">Remaining to Fund, Experience by Current Processing Stage</CardTitle>
            <Button type="button" size="sm" variant="outline" onClick={exportStageTable}>
              <Download className="mr-1 h-4 w-4" />
              Download CSV
            </Button>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>
                    <button className="inline-flex items-center gap-1" onClick={() => toggleSort("processingStage", stageSort, setStageSort)}>
                      Processing Stage
                      <SortIcon active={stageSort.key === "processingStage"} dir={stageSort.direction} />
                    </button>
                  </TableHead>
                  <TableHead className="text-right">
                    <button className="ml-auto inline-flex items-center gap-1" onClick={() => toggleSort("unitsRemainingToFund", stageSort, setStageSort)}>
                      Units Remaining
                      <SortIcon active={stageSort.key === "unitsRemainingToFund"} dir={stageSort.direction} />
                    </button>
                  </TableHead>
                  <TableHead className="text-right">
                    Days Remaining in Current Month
                  </TableHead>
                  <TableHead className="text-right">
                    <button className="ml-auto inline-flex items-center gap-1" onClick={() => toggleSort("historicalFallout", stageSort, setStageSort)}>
                      Historical Fallout
                      <SortIcon active={stageSort.key === "historicalFallout"} dir={stageSort.direction} />
                    </button>
                  </TableHead>
                  <TableHead className="text-right">
                    <button className="ml-auto inline-flex items-center gap-1" onClick={() => toggleSort("historicalStatusToFundDays", stageSort, setStageSort)}>
                      Historical Status to Fund Days
                      <SortIcon active={stageSort.key === "historicalStatusToFundDays"} dir={stageSort.direction} />
                    </button>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stageRowsSorted.map((row) => {
                  const st = String(row.processingStage);
                  const active = remainingProcessingStage === st;
                  return (
                    <TableRow
                      key={String(row.sortOrder)}
                      className={cn("cursor-pointer", active && "bg-emerald-50/90 dark:bg-emerald-950/30")}
                      onClick={() => toggleRemainingProcessingStage(st)}
                    >
                      <TableCell>{st}</TableCell>
                      <TableCell className="text-right">{Number(row.unitsRemainingToFund).toLocaleString()}</TableCell>
                      <TableCell className="text-right">{daysRemainingInCurrentMonth.toLocaleString()}</TableCell>
                      <TableCell className="text-right">{formatPercent(toNumberOrNull(row.historicalFallout))}</TableCell>
                      <TableCell className="text-right">
                        {row.historicalStatusToFundDays != null ? Number(row.historicalStatusToFundDays).toFixed(1) : "-"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <Card data-loan-details-table className="rounded-xl border overflow-hidden border-slate-200/60 bg-white dark:bg-slate-900/20">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
          <CardTitle className="text-sm">Loan Detail for Max Possible Funding</CardTitle>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-2 shrink-0"
              disabled={detailCsvExporting || !selectedTenantId}
              onClick={() => void exportDetailTable()}
            >
              <Download className="h-4 w-4" />
              {detailCsvExporting ? "Exporting…" : "Download CSV"}
            </Button>
            <Button type="button" variant="outline" size="sm" className="gap-2 shrink-0" onClick={() => setShowDetailColumnFilters((s) => !s)}>
              <Filter className="h-4 w-4" />
              {showDetailColumnFilters ? "Hide filters" : "Show filters"}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div
            ref={setDetailScrollElement}
            className="overflow-auto max-h-[620px] min-h-[200px] border-t border-slate-200 dark:border-slate-700"
          >
            <table className="w-full caption-bottom text-sm">
              <TableHeader className="sticky top-0 z-20 border-b border-slate-200 bg-slate-50 shadow-sm dark:border-slate-700 dark:bg-slate-800 [&_th]:bg-slate-50 [&_th]:shadow-sm dark:[&_th]:bg-slate-800">
                <TableRow className="border-b border-slate-200 dark:border-slate-700 hover:bg-transparent">
                  {renderDetailHeadCell("loanNumber", "loanNumber", "Loan Number")}
                  {renderDetailHeadCell("complexityGroup", "complexityGroup", "Complexity Group")}
                  {renderDetailHeadCell("complexity", "complexity", "Complexity")}
                  {renderDetailHeadCell("closingProjectionGroup", "closingProjectionGroup", "Closing Projection")}
                  {renderDetailHeadCell("units", "units", "Units")}
                  {renderDetailHeadCell("volume", "volume", "Volume")}
                  {renderDetailHeadCell("occupancyType", "occupancyType", "Occupancy Type")}
                  {renderDetailHeadCell("fico", "fico", "FICO")}
                  {renderDetailHeadCell("ltv", "ltv", "LTV")}
                  {renderDetailHeadCell("beDti", "beDti", "BE DTI")}
                  {renderDetailHeadCell("borrowerSelfEmployed", "borrowerSelfEmployed", "Borrower Self Employed")}
                  {renderDetailHeadCell("qmLoanType", "qmLoanType", "QM Loan Type")}
                  {renderDetailHeadCell("propertyType", "propertyType", "Property Type")}
                  {renderDetailHeadCell("loanProgram", "loanProgram", "Loan Program")}
                  {renderDetailHeadCell("appToDispositionDays", "appToDispositionDays", "App to Disposition Days")}
                  {renderDetailHeadCell("currentLoanStatus", "currentLoanStatus", "Current Loan Status")}
                  {renderDetailHeadCell("currentStatusDate", "currentStatusDate", "Current Status Date")}
                  {renderDetailHeadCell("lastCompletedMilestone", "lastCompletedMilestone", "Last Completed Milestone")}
                  {renderDetailHeadCell("loanFolder", "loanFolder", "Loan Folder")}
                  {renderDetailHeadCell("applicationDate", "applicationDate", "Application Date")}
                  {renderDetailHeadCell("fundingDate", "fundingDate", "Funding Date")}
                  {renderDetailHeadCell("lockDate", "lockDate", "Lock Date")}
                  {renderDetailHeadCell("investorLockDate", "investorLockDate", "Investor Lock Date")}
                  {renderDetailHeadCell("estimatedClosingDate", "estimatedClosingDate", "Estimated Closing Date")}
                  {renderDetailHeadCell("ctcDate", "ctcDate", "CTC Date")}
                  {renderDetailHeadCell("uwFinalApprovalDate", "uwFinalApprovalDate", "UW Final Approval Date")}
                  {renderDetailHeadCell("deniedDate", "deniedDate", "Denied Date")}
                  {renderDetailHeadCell("conditionalApprovalDate", "conditionalApprovalDate", "Conditional Approval Date")}
                  {renderDetailHeadCell("branch", "branch", "Branch")}
                  {renderDetailHeadCell("loanOfficer", "loanOfficer", "Loan Officer")}
                  {renderDetailHeadCell("processor", "processor", "Processor")}
                  {renderDetailHeadCell("underwriter", "underwriter", "Underwriter")}
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow className="border-b-2 border-slate-200 bg-slate-50/90 font-semibold dark:border-slate-600 dark:bg-slate-800/80 hover:bg-slate-50 dark:hover:bg-slate-800/80">
                  <TableCell>
                    Totals
                  </TableCell>
                  <TableCell />
                  <TableCell>{detailTableTotals.avgComplexity != null ? detailTableTotals.avgComplexity.toFixed(1) : "-"}</TableCell>
                  <TableCell />
                  <TableCell>{detailTableTotals.units.toLocaleString()}</TableCell>
                  <TableCell>{formatCurrency(detailTableTotals.volume)}</TableCell>
                  <TableCell />
                  <TableCell>{detailTableTotals.avgFico != null ? Math.round(detailTableTotals.avgFico).toLocaleString() : "-"}</TableCell>
                  <TableCell>{detailTableTotals.avgLtv != null ? detailTableTotals.avgLtv.toFixed(1) : "-"}</TableCell>
                  <TableCell>{detailTableTotals.avgBeDti != null ? detailTableTotals.avgBeDti.toFixed(1) : "-"}</TableCell>
                  <TableCell />
                  <TableCell />
                  <TableCell />
                  <TableCell />
                  <TableCell>
                    {detailTableTotals.avgAppToDispositionDays != null
                      ? Math.round(detailTableTotals.avgAppToDispositionDays).toLocaleString()
                      : "-"}
                  </TableCell>
                  <TableCell colSpan={DETAIL_TOTALS_TAIL_COLSPAN} />
                </TableRow>
                {detailPaddingTop > 0 ? (
                  <TableRow className="hover:bg-transparent border-0 pointer-events-none" aria-hidden>
                    <TableCell colSpan={DETAIL_COLUMN_COUNT} className="p-0" style={{ height: detailPaddingTop }} />
                  </TableRow>
                ) : null}
                {virtualDetailRows.map((virtualRow) => {
                  const row = detailRowsSorted[virtualRow.index];
                  if (!row) return null;
                  return (
                    <TableRow
                      key={virtualRow.key}
                      data-index={virtualRow.index}
                      className="[&_td]:whitespace-nowrap [&_td]:align-middle"
                      style={{ height: virtualRow.size }}
                    >
                      <TableCell className="py-1.5">
                        <button type="button" className={cn(clickableCellClass, cellHighlight(row, "loanNumber") && "ring-1 ring-emerald-500")} onClick={() => applyDetailCellFilter("loanNumber", row)}>
                          {String(row.loanNumber ?? "")}
                        </button>
                      </TableCell>
                      <TableCell className="py-1.5">
                        <button type="button" className={cn(clickableCellClass, cellHighlight(row, "complexityGroup") && "ring-1 ring-emerald-500")} onClick={() => applyDetailCellFilter("complexityGroup", row)}>
                          {String(row.complexityGroup ?? "")}
                        </button>
                      </TableCell>
                      <TableCell className="py-1.5">
                        <button type="button" className={cn(clickableCellClass, cellHighlight(row, "complexity") && "ring-1 ring-emerald-500")} onClick={() => applyDetailCellFilter("complexity", row)}>
                          {row.complexity != null ? Number(row.complexity).toFixed(1) : "-"}
                        </button>
                      </TableCell>
                      <TableCell className="py-1.5">
                        <button type="button" className={cn(clickableCellClass, cellHighlight(row, "closingProjectionGroup") && "ring-1 ring-emerald-500")} onClick={() => applyDetailCellFilter("closingProjectionGroup", row)}>
                          {String(row.closingProjectionGroup ?? "")}
                        </button>
                      </TableCell>
                      <TableCell className="py-1.5">
                        <button type="button" className={cn(clickableCellClass, cellHighlight(row, "units") && "ring-1 ring-emerald-500")} onClick={() => applyDetailCellFilter("units", row)}>
                          {Number(row.units ?? 1).toLocaleString()}
                        </button>
                      </TableCell>
                      <TableCell className="py-1.5">
                        <button type="button" className={cn(clickableCellClass, cellHighlight(row, "volume") && "ring-1 ring-emerald-500")} onClick={() => applyDetailCellFilter("volume", row)}>
                          {formatCurrency(Number(row.volume ?? 0))}
                        </button>
                      </TableCell>
                      <TableCell className="py-1.5">
                        <button type="button" className={cn(clickableCellClass, cellHighlight(row, "occupancyType") && "ring-1 ring-emerald-500")} onClick={() => applyDetailCellFilter("occupancyType", row)}>
                          {String(row.occupancyType ?? "")}
                        </button>
                      </TableCell>
                      <TableCell className="py-1.5">
                        <button type="button" className={cn(clickableCellClass, cellHighlight(row, "fico") && "ring-1 ring-emerald-500")} onClick={() => applyDetailCellFilter("fico", row)}>
                          {row.fico != null ? Number(row.fico).toLocaleString() : "-"}
                        </button>
                      </TableCell>
                      <TableCell className="py-1.5">
                        <button type="button" className={cn(clickableCellClass, cellHighlight(row, "ltv") && "ring-1 ring-emerald-500")} onClick={() => applyDetailCellFilter("ltv", row)}>
                          {row.ltv != null ? Number(row.ltv).toFixed(1) : "-"}
                        </button>
                      </TableCell>
                      <TableCell className="py-1.5">
                        <button type="button" className={cn(clickableCellClass, cellHighlight(row, "beDti") && "ring-1 ring-emerald-500")} onClick={() => applyDetailCellFilter("beDti", row)}>
                          {row.beDti != null ? Number(row.beDti).toFixed(1) : "-"}
                        </button>
                      </TableCell>
                      <TableCell className="py-1.5">
                        <button type="button" className={cn(clickableCellClass, cellHighlight(row, "borrowerSelfEmployed") && "ring-1 ring-emerald-500")} onClick={() => applyDetailCellFilter("borrowerSelfEmployed", row)}>
                          {formatBooleanish(row.borrowerSelfEmployed)}
                        </button>
                      </TableCell>
                      <TableCell className="py-1.5">
                        <button type="button" className={cn(clickableCellClass, cellHighlight(row, "qmLoanType") && "ring-1 ring-emerald-500")} onClick={() => applyDetailCellFilter("qmLoanType", row)}>
                          {String(row.qmLoanType ?? "")}
                        </button>
                      </TableCell>
                      <TableCell className="py-1.5">
                        <button type="button" className={cn(clickableCellClass, cellHighlight(row, "propertyType") && "ring-1 ring-emerald-500")} onClick={() => applyDetailCellFilter("propertyType", row)}>
                          {String(row.propertyType ?? "")}
                        </button>
                      </TableCell>
                      <TableCell className="py-1.5">
                        <button type="button" className={cn(clickableCellClass, cellHighlight(row, "loanProgram") && "ring-1 ring-emerald-500")} onClick={() => applyDetailCellFilter("loanProgram", row)}>
                          {String(row.loanProgram ?? "")}
                        </button>
                      </TableCell>
                      <TableCell className="py-1.5">
                        <button type="button" className={cn(clickableCellClass, cellHighlight(row, "appToDispositionDays") && "ring-1 ring-emerald-500")} onClick={() => applyDetailCellFilter("appToDispositionDays", row)}>
                          {row.appToDispositionDays != null ? Number(row.appToDispositionDays).toLocaleString() : "-"}
                        </button>
                      </TableCell>
                      <TableCell className="py-1.5">
                        <button type="button" className={cn(clickableCellClass, cellHighlight(row, "currentLoanStatus") && "ring-1 ring-emerald-500")} onClick={() => applyDetailCellFilter("currentLoanStatus", row)}>
                          {String(row.currentLoanStatus ?? "")}
                        </button>
                      </TableCell>
                      <TableCell className="py-1.5">
                        <button type="button" className={cn(clickableCellClass, cellHighlight(row, "currentStatusDate") && "ring-1 ring-emerald-500")} onClick={() => applyDetailCellFilter("currentStatusDate", row)}>
                          {String(row.currentStatusDate ?? "")}
                        </button>
                      </TableCell>
                      <TableCell className="py-1.5">
                        <button type="button" className={cn(clickableCellClass, cellHighlight(row, "lastCompletedMilestone") && "ring-1 ring-emerald-500")} onClick={() => applyDetailCellFilter("lastCompletedMilestone", row)}>
                          {String(row.lastCompletedMilestone ?? "")}
                        </button>
                      </TableCell>
                      <TableCell className="py-1.5">
                        <button type="button" className={cn(clickableCellClass, cellHighlight(row, "loanFolder") && "ring-1 ring-emerald-500")} onClick={() => applyDetailCellFilter("loanFolder", row)}>
                          {String(row.loanFolder ?? "")}
                        </button>
                      </TableCell>
                      <TableCell className="py-1.5">
                        <button type="button" className={cn(clickableCellClass, cellHighlight(row, "applicationDate") && "ring-1 ring-emerald-500")} onClick={() => applyDetailCellFilter("applicationDate", row)}>
                          {String(row.applicationDate ?? "")}
                        </button>
                      </TableCell>
                      <TableCell className="py-1.5">
                        <button type="button" className={cn(clickableCellClass, cellHighlight(row, "fundingDate") && "ring-1 ring-emerald-500")} onClick={() => applyDetailCellFilter("fundingDate", row)}>
                          {String(row.fundingDate ?? "")}
                        </button>
                      </TableCell>
                      <TableCell className="py-1.5">
                        <button type="button" className={cn(clickableCellClass, cellHighlight(row, "lockDate") && "ring-1 ring-emerald-500")} onClick={() => applyDetailCellFilter("lockDate", row)}>
                          {String(row.lockDate ?? "")}
                        </button>
                      </TableCell>
                      <TableCell className="py-1.5">
                        <button type="button" className={cn(clickableCellClass, cellHighlight(row, "investorLockDate") && "ring-1 ring-emerald-500")} onClick={() => applyDetailCellFilter("investorLockDate", row)}>
                          {String(row.investorLockDate ?? "")}
                        </button>
                      </TableCell>
                      <TableCell className="py-1.5">
                        <button type="button" className={cn(clickableCellClass, cellHighlight(row, "estimatedClosingDate") && "ring-1 ring-emerald-500")} onClick={() => applyDetailCellFilter("estimatedClosingDate", row)}>
                          {String(row.estimatedClosingDate ?? "")}
                        </button>
                      </TableCell>
                      <TableCell className="py-1.5">
                        <button type="button" className={cn(clickableCellClass, cellHighlight(row, "ctcDate") && "ring-1 ring-emerald-500")} onClick={() => applyDetailCellFilter("ctcDate", row)}>
                          {String(row.ctcDate ?? "")}
                        </button>
                      </TableCell>
                      <TableCell className="py-1.5">
                        <button type="button" className={cn(clickableCellClass, cellHighlight(row, "uwFinalApprovalDate") && "ring-1 ring-emerald-500")} onClick={() => applyDetailCellFilter("uwFinalApprovalDate", row)}>
                          {String(row.uwFinalApprovalDate ?? "")}
                        </button>
                      </TableCell>
                      <TableCell className="py-1.5">
                        <button type="button" className={cn(clickableCellClass, cellHighlight(row, "deniedDate") && "ring-1 ring-emerald-500")} onClick={() => applyDetailCellFilter("deniedDate", row)}>
                          {String(row.deniedDate ?? "")}
                        </button>
                      </TableCell>
                      <TableCell className="py-1.5">
                        <button type="button" className={cn(clickableCellClass, cellHighlight(row, "conditionalApprovalDate") && "ring-1 ring-emerald-500")} onClick={() => applyDetailCellFilter("conditionalApprovalDate", row)}>
                          {String(row.conditionalApprovalDate ?? "")}
                        </button>
                      </TableCell>
                      <TableCell className="py-1.5">
                        <button type="button" className={cn(clickableCellClass, cellHighlight(row, "branch") && "ring-1 ring-emerald-500")} onClick={() => applyDetailCellFilter("branch", row)}>
                          {String(row.branch ?? "")}
                        </button>
                      </TableCell>
                      <TableCell className="py-1.5">
                        <button type="button" className={cn(clickableCellClass, cellHighlight(row, "loanOfficer") && "ring-1 ring-emerald-500")} onClick={() => applyDetailCellFilter("loanOfficer", row)}>
                          {String(row.loanOfficer ?? "")}
                        </button>
                      </TableCell>
                      <TableCell className="py-1.5">
                        <button type="button" className={cn(clickableCellClass, cellHighlight(row, "processor") && "ring-1 ring-emerald-500")} onClick={() => applyDetailCellFilter("processor", row)}>
                          {String(row.processor ?? "")}
                        </button>
                      </TableCell>
                      <TableCell className="py-1.5">
                        <button type="button" className={cn(clickableCellClass, cellHighlight(row, "underwriter") && "ring-1 ring-emerald-500")} onClick={() => applyDetailCellFilter("underwriter", row)}>
                          {String(row.underwriter ?? "")}
                        </button>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {detailPaddingBottom > 0 ? (
                  <TableRow className="hover:bg-transparent border-0 pointer-events-none" aria-hidden>
                    <TableCell colSpan={DETAIL_COLUMN_COUNT} className="p-0" style={{ height: detailPaddingBottom }} />
                  </TableRow>
                ) : null}
              </TableBody>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-3 border-t border-slate-200/60 dark:border-slate-700/60 bg-slate-50/50 dark:bg-slate-900/30">
            <span className="text-sm text-slate-700 dark:text-slate-300">
              {(data?.detail.total ?? detailRowsSorted.length).toLocaleString()}{" "}
              {(data?.detail.total ?? detailRowsSorted.length) === 1 ? "loan" : "loans"}
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
