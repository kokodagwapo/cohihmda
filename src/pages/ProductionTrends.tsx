import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { TopTieringLayout } from "@/components/layout/TopTieringLayout";
import { TopTieringTopBar } from "@/components/layout/TopTieringTopBar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { useTenantStore } from "@/stores/tenantStore";
import { useChannelStore } from "@/stores/channelStore";
import { useAuth } from "@/contexts/AuthContext";
import {
  useProductionTrendsData,
  type ProductionDateType,
  type ProductionDimension,
  type ProductionDrilldownRow,
  type ProductionMeasure,
  type ProductionTrendsDrilldownSlice,
  type ProductionTrendsSliceFilters,
} from "@/hooks/useProductionTrendsData";
import {
  normalizeProductionTrendsViewState,
  persistProductionTrendsFiltersLocally,
  useProductionTrendsViewState,
} from "@/hooks/useProductionTrendsViewState";
import { cn } from "@/lib/utils";
import {
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  LineChart,
  Line,
} from "recharts";
import { ChevronDown, ChevronRight, Loader2, X } from "lucide-react";

const dateTypeOptions: Array<{ value: ProductionDateType; label: string }> = [
  { value: "applications", label: "Applications Taken" },
  { value: "closed", label: "Closed Loans" },
  { value: "funded", label: "Funded Loans" },
];

const measureOptions: Array<{ value: ProductionMeasure; label: string }> = [
  { value: "volume", label: "Volume" },
  { value: "units", label: "Units" },
];

const dimensionOptions: Array<{ value: ProductionDimension; label: string }> = [
  { value: "loan_purpose", label: "Loan Purpose" },
  { value: "loan_type", label: "Loan Type" },
  { value: "channel", label: "Channel" },
  { value: "branch", label: "Branch" },
  { value: "broker_lender_name", label: "Broker Lender Name" },
  { value: "investor", label: "Investor" },
  { value: "warehouse_co_name", label: "Warehouse Co Name" },
];

const formatMoney = (n: number) => {
  if (Math.abs(n) >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${Math.round(n).toLocaleString()}`;
};

const formatMeasure = (n: number, measure: ProductionMeasure) =>
  measure === "volume" ? formatMoney(n) : Math.round(n).toLocaleString();

const formatPct = (n: number | null) => (n == null ? "-" : `${n.toFixed(1)}%`);

/** YoY % for titles: positive shows leading + */
const formatSignedYoyPercent = (pct: number | null): string | null => {
  if (pct == null || !Number.isFinite(pct)) return null;
  if (pct > 0) return `+${pct.toFixed(1)}%`;
  return `${pct.toFixed(1)}%`;
};

const metricCell = (value: number, measure: ProductionMeasure) => (
  <span className="font-medium text-slate-800 dark:text-slate-200">{formatMeasure(value, measure)}</span>
);

const rowBg = "border-blue-200/40 bg-white dark:border-slate-700/50 dark:bg-slate-800/70";

const CHART_DEEMPHASIS_FILL = "#cbd5e1";

const formatSliceMonthLabel = (month: number) => {
  if (!Number.isInteger(month) || month < 1 || month > 12) return String(month);
  return new Date(Date.UTC(2020, month - 1, 1)).toLocaleString("en-US", { month: "long", timeZone: "UTC" });
};

function emptyDrilldownSlice(): ProductionTrendsDrilldownSlice {
  return { branches: [], lienPositions: [], productTypes: [], loanPrograms: [] };
}

function isDrilldownSliceEmpty(d: ProductionTrendsDrilldownSlice | null | undefined): boolean {
  if (!d) return true;
  return !d.branches.length && !d.lienPositions.length && !d.productTypes.length && !d.loanPrograms.length;
}

type DrilldownLevelField = "branches" | "lienPositions" | "productTypes" | "loanPrograms";

function onlyDrilldownFieldSet(d: ProductionTrendsDrilldownSlice | null, field: DrilldownLevelField): boolean {
  if (!d) return false;
  const keys: DrilldownLevelField[] = ["branches", "lienPositions", "productTypes", "loanPrograms"];
  const active = keys.filter((k) => d[k].length > 0);
  return active.length === 1 && active[0] === field;
}

function toggleDrilldownRowSelection(
  prev: ProductionTrendsDrilldownSlice | null,
  row: ProductionDrilldownRow,
): ProductionTrendsDrilldownSlice | null {
  const label = row.label;
  const e = emptyDrilldownSlice();
  if (row.depth === 0) {
    if (prev && onlyDrilldownFieldSet(prev, "branches") && prev.branches.length === 1 && prev.branches[0] === label) {
      return null;
    }
    e.branches = [label];
    return e;
  }
  if (row.depth === 1) {
    if (
      prev &&
      onlyDrilldownFieldSet(prev, "lienPositions") &&
      prev.lienPositions.length === 1 &&
      prev.lienPositions[0] === label
    ) {
      return null;
    }
    e.lienPositions = [label];
    return e;
  }
  if (row.depth === 2) {
    if (
      prev &&
      onlyDrilldownFieldSet(prev, "productTypes") &&
      prev.productTypes.length === 1 &&
      prev.productTypes[0] === label
    ) {
      return null;
    }
    e.productTypes = [label];
    return e;
  }
  if (row.depth === 3) {
    if (
      prev &&
      onlyDrilldownFieldSet(prev, "loanPrograms") &&
      prev.loanPrograms.length === 1 &&
      prev.loanPrograms[0] === label
    ) {
      return null;
    }
    e.loanPrograms = [label];
    return e;
  }
  return prev;
}

function rowMatchesDrilldownSlice(row: ProductionDrilldownRow, d: ProductionTrendsDrilldownSlice | null): boolean {
  if (!d) return false;
  if (row.depth === 0) return d.branches.includes(row.label);
  if (row.depth === 1) return d.lienPositions.includes(row.label);
  if (row.depth === 2) return d.productTypes.includes(row.label);
  if (row.depth === 3) return d.loanPrograms.includes(row.label);
  return false;
}

const pillBadgeTriggerClass =
  "inline-flex max-w-[min(340px,calc(100vw-6rem))] cursor-pointer items-center gap-1 rounded-full border border-blue-200/80 bg-white px-2.5 py-0.5 text-left text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700/80";

function ProductionTrendsStringFilterPopover({
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
    return a.localeCompare(b, undefined, { numeric: true });
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
              Select one or more values from the list below.
            </div>
          </div>
          <div className="flex shrink-0 flex-col items-stretch gap-1 sm:flex-row sm:items-center">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => onOpenChange(false)}
            >
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
                <CommandItem
                  key={value}
                  value={value}
                  onSelect={() => onToggleDraftValue(value)}
                  className={cn(
                    "cursor-pointer hover:!bg-transparent hover:!text-foreground data-[selected=true]:!bg-transparent data-[selected=true]:!text-foreground",
                    sel
                      ? "!bg-accent !text-accent-foreground hover:!bg-accent data-[selected=true]:!bg-accent data-[selected=true]:!text-accent-foreground"
                      : "",
                  )}
                >
                  <span className="mr-2">{sel ? "✓" : ""}</span>
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

const CALENDAR_MONTH_ROWS = Array.from({ length: 12 }, (_, i) => {
  const month = i + 1;
  return { month, label: formatSliceMonthLabel(month) };
});

function ProductionTrendsMonthFilterPopover({
  open,
  onOpenChange,
  trigger,
  draftMonths,
  onToggleMonth,
  onApply,
  onClearSelection,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: ReactNode;
  draftMonths: number[];
  onToggleMonth: (month: number) => void;
  onApply: () => void;
  onClearSelection: () => void;
}) {
  const [search, setSearch] = useState("");
  useEffect(() => {
    if (!open) setSearch("");
  }, [open]);
  const q = search.trim().toLowerCase();
  const filteredRows = q
    ? CALENDAR_MONTH_ROWS.filter((r) => r.label.toLowerCase().includes(q) || String(r.month).includes(q))
    : CALENDAR_MONTH_ROWS;
  const ordered = [...filteredRows].sort((a, b) => {
    const asel = draftMonths.includes(a.month) ? 1 : 0;
    const bsel = draftMonths.includes(b.month) ? 1 : 0;
    if (asel !== bsel) return bsel - asel;
    return a.month - b.month;
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
            <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">Calendar month</div>
            <div className="text-[11px] text-slate-400 dark:text-slate-500">
              Select one or more values from the list below.
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
          <CommandInput placeholder="Search months" value={search} onValueChange={setSearch} />
          <CommandList>
            <CommandEmpty>No values found.</CommandEmpty>
            {ordered.map(({ month, label }) => {
              const sel = draftMonths.includes(month);
              return (
                <CommandItem
                  key={month}
                  value={`${month}-${label}`}
                  onSelect={() => onToggleMonth(month)}
                  className={cn(
                    "cursor-pointer hover:!bg-transparent hover:!text-foreground data-[selected=true]:!bg-transparent data-[selected=true]:!text-foreground",
                    sel
                      ? "!bg-accent !text-accent-foreground hover:!bg-accent data-[selected=true]:!bg-accent data-[selected=true]:!text-accent-foreground"
                      : "",
                  )}
                >
                  <span className="mr-2">{sel ? "✓" : ""}</span>
                  {label}
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

function DrilldownRows({
  rows,
  measure,
  turnTimeLabel,
  sliceDrilldown,
  onRowFilterClick,
}: {
  rows: ProductionDrilldownRow[];
  measure: ProductionMeasure;
  turnTimeLabel: string;
  sliceDrilldown: ProductionTrendsDrilldownSlice | null;
  onRowFilterClick: (row: ProductionDrilldownRow) => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const byParent = useMemo(() => {
    const m = new Map<string | null, ProductionDrilldownRow[]>();
    for (const row of rows) {
      const list = m.get(row.parentId) || [];
      list.push(row);
      m.set(row.parentId, list);
    }
    return m;
  }, [rows]);

  useEffect(() => {
    setExpanded(new Set());
  }, [rows]);

  const idsWithChildren = useMemo(
    () => rows.filter((r) => (byParent.get(r.id) || []).length > 0).map((r) => r.id),
    [rows, byParent],
  );

  const visibleRows = useMemo(() => {
    const out: ProductionDrilldownRow[] = [];
    const walk = (parentId: string | null) => {
      const children = byParent.get(parentId) || [];
      children.forEach((child) => {
        out.push(child);
        if (expanded.has(child.id)) walk(child.id);
      });
    };
    walk(null);
    return out;
  }, [byParent, expanded]);

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => setExpanded(new Set(idsWithChildren))}>
          Expand All
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => setExpanded(new Set())}>
          Collapse All
        </Button>
      </div>
      <div className="overflow-x-auto">
      <table className="w-full min-w-[1100px] text-sm">
        <thead>
          <tr className="border-b border-slate-200 dark:border-slate-700">
            <th className="px-3 py-2 text-left">Group</th>
            <th className="px-3 py-2 text-right">Units</th>
            <th className="px-3 py-2 text-right">Volume</th>
            <th className="px-3 py-2 text-right">Avg Loan Amt</th>
            <th className="px-3 py-2 text-right">Avg LTV</th>
            <th className="px-3 py-2 text-right">WAC</th>
            <th className="px-3 py-2 text-right">{turnTimeLabel}</th>
          </tr>
        </thead>
        <tbody>
          {visibleRows.map((row) => {
            const hasChildren = (byParent.get(row.id) || []).length > 0;
            const rowSelected = rowMatchesDrilldownSlice(row, sliceDrilldown);
            return (
              <tr
                key={row.id}
                className={cn(
                  "border-b border-slate-100 dark:border-slate-800",
                  onRowFilterClick && "cursor-pointer hover:bg-slate-50/90 dark:hover:bg-slate-800/50",
                  rowSelected && "bg-blue-50/80 dark:bg-slate-800/80",
                )}
                onClick={(e) => {
                  if ((e.target as HTMLElement).closest("button")) return;
                  onRowFilterClick?.(row);
                }}
              >
                <td className="px-3 py-2">
                  <div className="flex items-center gap-1" style={{ paddingLeft: `${row.depth * 18}px` }}>
                    {hasChildren ? (
                      <button
                        type="button"
                        className="rounded p-0.5 hover:bg-slate-100 dark:hover:bg-slate-700"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggle(row.id);
                        }}
                      >
                        {expanded.has(row.id) ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                      </button>
                    ) : (
                      <span className="inline-block w-4" />
                    )}
                    <span className={row.depth <= 1 ? "font-semibold text-slate-800 dark:text-slate-200" : "text-slate-700 dark:text-slate-300"}>
                      {row.label}
                    </span>
                  </div>
                </td>
                <td className="px-3 py-2 text-right">{metricCell(row.units, "units")}</td>
                <td className="px-3 py-2 text-right">{metricCell(row.volume, "volume")}</td>
                <td className="px-3 py-2 text-right">{metricCell(row.avgLoanAmount, "volume")}</td>
                <td className="px-3 py-2 text-right">{row.avgLtv == null ? "-" : `${row.avgLtv.toFixed(1)}%`}</td>
                <td className="px-3 py-2 text-right">{row.wac == null ? "-" : `${row.wac.toFixed(3)}`}</td>
                <td className="px-3 py-2 text-right">{row.avgTurnTime == null ? "-" : `${row.avgTurnTime.toFixed(1)} days`}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>
    </div>
  );
}

const ProductionTrends = () => {
  const { selectedTenantId } = useTenantStore();
  const { selectedChannel } = useChannelStore();
  const { user } = useAuth();
  const tenantId = selectedTenantId || user?.tenant_id || null;
  const persistedViewState = useProductionTrendsViewState({ tenantId });
  const isPersistenceEnabled = Boolean(tenantId && persistedViewState.preferenceKey);
  const hydratedPreferenceKeyRef = useRef<string | null>(null);

  const [dateType, setDateType] = useState<ProductionDateType>("funded");
  const [measure, setMeasure] = useState<ProductionMeasure>("volume");
  const [dimension, setDimension] = useState<ProductionDimension>("branch");
  const [yearMonths, setYearMonths] = useState<string[]>([]);
  const [yearMonthSearch, setYearMonthSearch] = useState("");
  const [yearMonthPopoverOpen, setYearMonthPopoverOpen] = useState(false);
  const [activeSeries, setActiveSeries] = useState<string>("");

  const [sliceCategories, setSliceCategories] = useState<string[]>([]);
  const [sliceLineMonths, setSliceLineMonths] = useState<number[]>([]);
  const [sliceDrilldown, setSliceDrilldown] = useState<ProductionTrendsDrilldownSlice | null>(null);

  type PillEditorKind =
    | null
    | "dimension"
    | "lineMonth"
    | "drillBranch"
    | "drillLien"
    | "drillProduct"
    | "drillProgram";

  const [pillEditor, setPillEditor] = useState<PillEditorKind>(null);
  const [draftCategories, setDraftCategories] = useState<string[]>([]);
  const [draftLineMonths, setDraftLineMonths] = useState<number[]>([]);
  const [draftDrillStrings, setDraftDrillStrings] = useState<string[]>([]);

  useEffect(() => {
    if (!isPersistenceEnabled || !persistedViewState.preferenceKey) {
      hydratedPreferenceKeyRef.current = null;
      return;
    }
    if (hydratedPreferenceKeyRef.current === persistedViewState.preferenceKey) return;

    setDateType("funded");
    setMeasure("volume");
    setDimension("branch");
    setYearMonths([]);
    setSliceCategories([]);
    setSliceLineMonths([]);
    setSliceDrilldown(null);

    let cancelled = false;
    void persistedViewState
      .load()
      .then((loaded) => {
        if (cancelled) return;
        if (loaded) {
          const normalized = normalizeProductionTrendsViewState(loaded);
          setDateType(normalized.dateType);
          setMeasure(normalized.measure);
          setDimension(normalized.dimension);
          setYearMonths(normalized.yearMonths);
          setSliceCategories(normalized.sliceCategories);
          setSliceLineMonths(normalized.sliceLineMonths);
          setSliceDrilldown(normalized.sliceDrilldown);
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
    const payload = normalizeProductionTrendsViewState({
      version: 1,
      dateType,
      measure,
      dimension,
      yearMonths,
      sliceCategories,
      sliceLineMonths,
      sliceDrilldown,
    });
    await persistedViewState.save(payload);
  }, [
    dateType,
    dimension,
    isPersistenceEnabled,
    measure,
    persistedViewState,
    sliceCategories,
    sliceDrilldown,
    sliceLineMonths,
    yearMonths,
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
    persistedViewState.isLoading,
    persistedViewState.preferenceKey,
    savePersistedViewState,
  ]);

  useEffect(() => {
    if (!persistedViewState.preferenceKey) return;
    const key = persistedViewState.preferenceKey;
    const flush = () => {
      persistProductionTrendsFiltersLocally(
        key,
        normalizeProductionTrendsViewState({
          version: 1,
          dateType,
          measure,
          dimension,
          yearMonths,
          sliceCategories,
          sliceLineMonths,
          sliceDrilldown,
        }),
      );
    };
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, [
    dateType,
    dimension,
    measure,
    persistedViewState.preferenceKey,
    sliceCategories,
    sliceDrilldown,
    sliceLineMonths,
    yearMonths,
  ]);

  const sliceFilters = useMemo((): ProductionTrendsSliceFilters | null => {
    const drillOk = sliceDrilldown && !isDrilldownSliceEmpty(sliceDrilldown) ? sliceDrilldown : null;
    if (sliceCategories.length === 0 && sliceLineMonths.length === 0 && !drillOk) return null;
    return {
      dimensionCategories: sliceCategories,
      lineMonths: sliceLineMonths,
      drilldown: drillOk,
    };
  }, [sliceCategories, sliceDrilldown, sliceLineMonths]);

  const { data, loading, error } = useProductionTrendsData({
    dateType,
    measure,
    dimension,
    yearMonths,
    tenantId,
    channelGroup: selectedChannel,
    sliceFilters,
  });

  const toggleSliceCategory = useCallback((cat: string) => {
    setSliceCategories((prev) => {
      const set = new Set(prev);
      if (set.has(cat)) set.delete(cat);
      else set.add(cat);
      return [...set].sort((a, b) => a.localeCompare(b));
    });
  }, []);

  const toggleLineMonth = useCallback((month: number) => {
    if (!Number.isInteger(month) || month < 1 || month > 12) return;
    setSliceLineMonths((prev) => {
      const set = new Set(prev);
      if (set.has(month)) set.delete(month);
      else set.add(month);
      return [...set].sort((a, b) => a - b);
    });
  }, []);

  const handleDrilldownRowFilter = useCallback((row: ProductionDrilldownRow) => {
    setSliceDrilldown((prev) => toggleDrilldownRowSelection(prev, row));
  }, []);

  const clearAllChartFilters = useCallback(() => {
    setSliceCategories([]);
    setSliceLineMonths([]);
    setSliceDrilldown(null);
    setPillEditor(null);
  }, []);

  const handleBarChartClick = useCallback(
    (state: unknown) => {
      const s = state as { activePayload?: Array<{ payload?: { category?: string } }> } | null;
      const cat = s?.activePayload?.[0]?.payload?.category;
      if (cat) toggleSliceCategory(String(cat));
    },
    [toggleSliceCategory],
  );

  const dimensionLabelForChip = dimensionOptions.find((d) => d.value === dimension)?.label ?? "Dimension";
  const chartCategorySelectionActive = sliceCategories.length > 0;
  const lineMonthSelectionActive = sliceLineMonths.length > 0;
  const hasChartFilters =
    sliceCategories.length > 0 || sliceLineMonths.length > 0 || (sliceDrilldown != null && !isDrilldownSliceEmpty(sliceDrilldown));

  const drilldownPillKind = useMemo((): Exclude<PillEditorKind, "dimension" | "lineMonth"> | null => {
    if (!sliceDrilldown || isDrilldownSliceEmpty(sliceDrilldown)) return null;
    if (sliceDrilldown.branches.length) return "drillBranch";
    if (sliceDrilldown.lienPositions.length) return "drillLien";
    if (sliceDrilldown.productTypes.length) return "drillProduct";
    if (sliceDrilldown.loanPrograms.length) return "drillProgram";
    return null;
  }, [sliceDrilldown]);

  const dimensionFilterOptions = useMemo(() => {
    const fromApi = data?.sliceFilterOptionLists?.dimensionValues ?? [];
    return [...new Set([...fromApi, ...sliceCategories])].sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true }),
    );
  }, [data?.sliceFilterOptionLists?.dimensionValues, sliceCategories]);

  const drilldownOptionsForPill = useMemo(() => {
    const lists = data?.sliceFilterOptionLists;
    if (lists) {
      return {
        drillBranch: lists.drilldownBranches,
        drillLien: lists.drilldownLiens,
        drillProduct: lists.drilldownProducts,
        drillProgram: lists.drilldownPrograms,
      };
    }
    const rows = data?.drilldown.rows ?? [];
    const uniq = (depth: number) =>
      [...new Set(rows.filter((r) => r.depth === depth).map((r) => r.label))].sort((a, b) =>
        a.localeCompare(b, undefined, { numeric: true }),
      );
    return {
      drillBranch: uniq(0),
      drillLien: uniq(1),
      drillProduct: uniq(2),
      drillProgram: uniq(3),
    };
  }, [data?.sliceFilterOptionLists, data?.drilldown.rows]);

  const drilldownPillLabel = useMemo(() => {
    if (!sliceDrilldown || !drilldownPillKind) return "";
    if (drilldownPillKind === "drillBranch") {
      const a = sliceDrilldown.branches;
      return a.length === 1 ? `Branch: ${a[0]}` : `Branch: ${a.length} selected`;
    }
    if (drilldownPillKind === "drillLien") {
      const a = sliceDrilldown.lienPositions;
      return a.length === 1 ? `Lien Position: ${a[0]}` : `Lien Position: ${a.length} selected`;
    }
    if (drilldownPillKind === "drillProduct") {
      const a = sliceDrilldown.productTypes;
      return a.length === 1 ? `Product Type: ${a[0]}` : `Product Type: ${a.length} selected`;
    }
    const a = sliceDrilldown.loanPrograms;
    return a.length === 1 ? `Loan Program: ${a[0]}` : `Loan Program: ${a.length} selected`;
  }, [drilldownPillKind, sliceDrilldown]);

  const dimensionPillLabel =
    sliceCategories.length === 0
      ? ""
      : sliceCategories.length === 1
        ? `${dimensionLabelForChip}: ${sliceCategories[0]}`
        : `${dimensionLabelForChip}: ${sliceCategories.length} selected`;

  const lineMonthPillLabel =
    sliceLineMonths.length === 0
      ? ""
      : sliceLineMonths.length === 1
        ? `Month: ${formatSliceMonthLabel(sliceLineMonths[0])}`
        : (() => {
            const labels = sliceLineMonths.slice(0, 5).map((m) => formatSliceMonthLabel(m));
            const remaining = sliceLineMonths.length - labels.length;
            return remaining > 0 ? `Months: ${labels.join(", ")} +${remaining} more` : `Months: ${labels.join(", ")}`;
          })();

  const applyDrilldownDraft = useCallback(
    (kind: Exclude<PillEditorKind, null | "dimension" | "lineMonth">) => {
      const e = emptyDrilldownSlice();
      if (kind === "drillBranch") e.branches = [...draftDrillStrings];
      else if (kind === "drillLien") e.lienPositions = [...draftDrillStrings];
      else if (kind === "drillProduct") e.productTypes = [...draftDrillStrings];
      else e.loanPrograms = [...draftDrillStrings];
      setSliceDrilldown(isDrilldownSliceEmpty(e) ? null : e);
    },
    [draftDrillStrings],
  );

  const sliceLineDot = useCallback(
    (_year: number, fillColor: string) => (props: Record<string, unknown>) => {
      const cx = props.cx as number | undefined;
      const cy = props.cy as number | undefined;
      const payload = props.payload as { month?: number } | undefined;
      if (cx == null || cy == null || payload?.month == null) return null;
      const month = payload.month;
      const dimmed = lineMonthSelectionActive && !sliceLineMonths.includes(month);
      return (
        <g>
          <circle
            cx={cx}
            cy={cy}
            r={3}
            fill={dimmed ? CHART_DEEMPHASIS_FILL : fillColor}
            stroke={dimmed ? "#94a3b8" : fillColor}
            strokeWidth={1}
            className="pointer-events-none"
          />
          <circle
            cx={cx}
            cy={cy}
            r={12}
            fill="transparent"
            className="cursor-pointer"
            onClick={(e) => {
              e.stopPropagation();
              toggleLineMonth(month);
            }}
          />
        </g>
      );
    },
    [lineMonthSelectionActive, sliceLineMonths, toggleLineMonth],
  );

  const monthButtonLabel = useMemo(() => {
    if (!data?.yearMonthOptions?.length) return "Select months";
    if (yearMonths.length === 0) return "All YearMonths";
    if (yearMonths.length <= 2) {
      return data.yearMonthOptions
        .filter((o) => yearMonths.includes(o.value))
        .map((o) => o.label)
        .join(", ");
    }
    return `${yearMonths.length} YearMonths selected`;
  }, [data?.yearMonthOptions, yearMonths]);

  const filteredYearMonthOptions = useMemo(() => {
    const opts = data?.yearMonthOptions ?? [];
    const q = yearMonthSearch.trim().toLowerCase();
    if (!q) return opts;
    return opts.filter(
      (o) => o.value.toLowerCase().includes(q) || o.label.toLowerCase().includes(q),
    );
  }, [data?.yearMonthOptions, yearMonthSearch]);

  const series = data?.yoySeries || [];
  const selectedSeries = series.find((s) => s.key === activeSeries) || series[0];
  const today = new Date();
  const currentCalendarYear = today.getFullYear();
  const currentCalendarMonth = today.getMonth() + 1;
  const selectedSeriesPoints = useMemo(() => {
    if (!selectedSeries || !data) return [];
    let runningCurrent = 0;
    let runningPrevious = 0;
    return selectedSeries.points.map((p) => {
      runningCurrent += p.currentValue;
      runningPrevious += p.previousValue;
      const isFutureMonthForCurrentYear =
        selectedSeries.currentYear === currentCalendarYear && p.month > currentCalendarMonth;
      return {
        ...p,
        previousValue: runningPrevious,
        currentValueDisplay: isFutureMonthForCurrentYear ? null : runningCurrent,
      };
    });
  }, [selectedSeries, data, currentCalendarMonth, currentCalendarYear]);
  const lineTooltipFormatter = useCallback(
    (v: number, name: string, item: { payload?: { month?: number } }) => {
      const month = item?.payload?.month;
      const isCurrentYearYtdPoint =
        selectedSeries?.currentYear === currentCalendarYear &&
        month === currentCalendarMonth &&
        name === String(selectedSeries.currentYear);
      const displayName = isCurrentYearYtdPoint ? `${name} YTD` : name;
      return [formatMeasure(Number(v), measure), displayName];
    },
    [currentCalendarMonth, currentCalendarYear, measure, selectedSeries],
  );
  const topDimensionLabel = data?.dimensionLabel || "Dimension";
  const topUnitsOrVolume = data?.largestCategory.titleCategory || "-";
  const topShare = data?.largestCategory.titleSharePercent ?? 0;

  const lineChartTitle = useMemo(() => {
    if (!data) return "";
    const ytd = data.yoyComparison.find((r) => r.timeRange === "Year to Date");
    const signed = formatSignedYoyPercent(ytd?.yoyPercent ?? null);
    if (signed) return `${data.dateTypeLabel} ${signed} Year over Year`;
    return `${data.dateTypeLabel} Year over Year`;
  }, [data]);

  return (
    <TopTieringLayout>
      <div className="flex min-h-[calc(100vh-4rem)] flex-col">
        <TopTieringTopBar title="Production Trends" />
        <main className="flex-1 overflow-y-auto px-4 py-3">
          <div className="mx-auto max-w-[1800px] space-y-4">
            <Card className={rowBg}>
              <CardContent className="pt-5">
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <div>
                    <p className="mb-1 text-xs text-slate-500">Date Type</p>
                    <Select value={dateType} onValueChange={(v) => setDateType(v as ProductionDateType)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {dateTypeOptions.map((opt) => <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <p className="mb-1 text-xs text-slate-500">Switch Measure</p>
                    <Select value={measure} onValueChange={(v) => setMeasure(v as ProductionMeasure)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {measureOptions.map((opt) => <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <p className="mb-1 text-xs text-slate-500">Switch Dimension</p>
                    <Select
                      value={dimension}
                      onValueChange={(v) => {
                        setDimension(v as ProductionDimension);
                        setSliceCategories([]);
                      }}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {dimensionOptions.map((opt) => <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <p className="mb-1 text-xs text-slate-500">YearMonth</p>
                    <Popover
                      open={yearMonthPopoverOpen}
                      onOpenChange={(open) => {
                        setYearMonthPopoverOpen(open);
                        if (!open) setYearMonthSearch("");
                      }}
                    >
                      <PopoverTrigger asChild>
                        <Button variant="outline" className="w-full justify-between font-normal">
                          <span className="truncate">{monthButtonLabel}</span>
                          <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-60" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-[min(360px,calc(100vw-2rem))] p-0" align="start">
                        <div className="border-b border-slate-200 p-2 dark:border-slate-700">
                          <Input
                            value={yearMonthSearch}
                            onChange={(e) => setYearMonthSearch(e.target.value)}
                            placeholder="Filter list…"
                            className="h-9"
                            onKeyDown={(e) => e.stopPropagation()}
                          />
                        </div>
                        <div className="max-h-[min(320px,50vh)] overflow-y-auto p-1">
                          {(data?.yearMonthOptions?.length ?? 0) === 0 ? (
                            <p className="px-2 py-6 text-center text-sm text-slate-500">No year-months available</p>
                          ) : filteredYearMonthOptions.length === 0 ? (
                            <p className="px-2 py-6 text-center text-sm text-slate-500">No matches</p>
                          ) : (
                            filteredYearMonthOptions.map((opt) => {
                              const checked = yearMonths.includes(opt.value);
                              return (
                                <label
                                  key={opt.value}
                                  className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-slate-100 dark:hover:bg-slate-800"
                                >
                                  <Checkbox
                                    checked={checked}
                                    onCheckedChange={(c) => {
                                      const on = c === true;
                                      setYearMonths((prev) =>
                                        on
                                          ? prev.includes(opt.value)
                                            ? prev
                                            : [...prev, opt.value].sort()
                                          : prev.filter((v) => v !== opt.value),
                                      );
                                    }}
                                    className="shrink-0"
                                  />
                                  <span className="min-w-0 flex-1 select-none">{opt.label}</span>
                                </label>
                              );
                            })
                          )}
                        </div>
                        <div className="flex items-center justify-between gap-2 border-t border-slate-200 px-3 py-2 dark:border-slate-700">
                          <Button variant="ghost" size="sm" onClick={() => setYearMonths([])}>
                            Clear all
                          </Button>
                          <Button size="sm" onClick={() => setYearMonthPopoverOpen(false)}>
                            Done
                          </Button>
                        </div>
                      </PopoverContent>
                    </Popover>
                  </div>
                </div>
                <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
                  Click a bar, a line-chart month (near the dot), or a drilldown row to add page-wide filters (multi-select where applicable). Click again to remove. YearMonth above still intersects with chart filters. Active filters appear below.
                </p>
              </CardContent>
            </Card>

            {hasChartFilters && (
              <div className="flex flex-wrap items-center gap-2 rounded-xl border border-blue-100/80 bg-blue-50/50 px-3 py-2 dark:border-slate-700/80 dark:bg-slate-900/40">
                <span className="text-sm font-medium text-slate-500 dark:text-slate-400">Active filters</span>
                {sliceCategories.length > 0 && (
                  <div className="flex items-center gap-0.5">
                    <ProductionTrendsStringFilterPopover
                      title={dimensionLabelForChip}
                      open={pillEditor === "dimension"}
                      onOpenChange={(o) => {
                        if (o) {
                          setDraftCategories([...sliceCategories]);
                          setPillEditor("dimension");
                        } else setPillEditor(null);
                      }}
                      options={dimensionFilterOptions}
                      draftSelected={draftCategories}
                      onToggleDraftValue={(v) =>
                        setDraftCategories((prev) => {
                          const s = new Set(prev);
                          if (s.has(v)) s.delete(v);
                          else s.add(v);
                          return [...s].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
                        })
                      }
                      onApply={() => setSliceCategories(draftCategories)}
                      onClearSelection={() => setDraftCategories([])}
                      trigger={
                        <button type="button" className={pillBadgeTriggerClass}>
                          <span className="truncate">{dimensionPillLabel}</span>
                        </button>
                      }
                    />
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSliceCategories([]);
                        setPillEditor(null);
                      }}
                      className="rounded-sm p-0.5 text-slate-500 hover:bg-blue-100/80 hover:text-slate-800 dark:hover:bg-slate-700/80 dark:hover:text-slate-200"
                      aria-label={`Remove ${dimensionLabelForChip} filter`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                )}
                {sliceLineMonths.length > 0 && (
                  <div className="flex items-center gap-0.5">
                    <ProductionTrendsMonthFilterPopover
                      open={pillEditor === "lineMonth"}
                      onOpenChange={(o) => {
                        if (o) {
                          setDraftLineMonths([...sliceLineMonths]);
                          setPillEditor("lineMonth");
                        } else setPillEditor(null);
                      }}
                      draftMonths={draftLineMonths}
                      onToggleMonth={(m) =>
                        setDraftLineMonths((prev) => {
                          const s = new Set(prev);
                          if (s.has(m)) s.delete(m);
                          else s.add(m);
                          return [...s].sort((a, b) => a - b);
                        })
                      }
                      onApply={() => setSliceLineMonths(draftLineMonths)}
                      onClearSelection={() => setDraftLineMonths([])}
                      trigger={
                        <button type="button" className={pillBadgeTriggerClass}>
                          <span className="truncate">{lineMonthPillLabel}</span>
                        </button>
                      }
                    />
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSliceLineMonths([]);
                        setPillEditor(null);
                      }}
                      className="rounded-sm p-0.5 text-slate-500 hover:bg-blue-100/80 hover:text-slate-800 dark:hover:bg-slate-700/80 dark:hover:text-slate-200"
                      aria-label="Remove month filter"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                )}
                {drilldownPillKind && sliceDrilldown && (
                  <div className="flex items-center gap-0.5">
                    <ProductionTrendsStringFilterPopover
                      title={
                        drilldownPillKind === "drillBranch"
                          ? "Branch"
                          : drilldownPillKind === "drillLien"
                            ? "Lien Position"
                            : drilldownPillKind === "drillProduct"
                              ? "Product Type"
                              : "Loan Program"
                      }
                      open={pillEditor === drilldownPillKind}
                      onOpenChange={(o) => {
                        if (o) {
                          const vals =
                            drilldownPillKind === "drillBranch"
                              ? sliceDrilldown.branches
                              : drilldownPillKind === "drillLien"
                                ? sliceDrilldown.lienPositions
                                : drilldownPillKind === "drillProduct"
                                  ? sliceDrilldown.productTypes
                                  : sliceDrilldown.loanPrograms;
                          setDraftDrillStrings([...vals]);
                          setPillEditor(drilldownPillKind);
                        } else setPillEditor(null);
                      }}
                      options={drilldownOptionsForPill[drilldownPillKind]}
                      draftSelected={draftDrillStrings}
                      onToggleDraftValue={(v) =>
                        setDraftDrillStrings((prev) => {
                          const s = new Set(prev);
                          if (s.has(v)) s.delete(v);
                          else s.add(v);
                          return [...s].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
                        })
                      }
                      onApply={() => applyDrilldownDraft(drilldownPillKind)}
                      onClearSelection={() => setDraftDrillStrings([])}
                      trigger={
                        <button type="button" className={pillBadgeTriggerClass}>
                          <span className="truncate">{drilldownPillLabel}</span>
                        </button>
                      }
                    />
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSliceDrilldown(null);
                        setPillEditor(null);
                      }}
                      className="rounded-sm p-0.5 text-slate-500 hover:bg-blue-100/80 hover:text-slate-800 dark:hover:bg-slate-700/80 dark:hover:text-slate-200"
                      aria-label="Remove drilldown filter"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                )}
                <Button type="button" variant="ghost" size="sm" className="h-8 text-xs" onClick={clearAllChartFilters}>
                  Clear all filters
                </Button>
              </div>
            )}

            {loading && (
              <div className="flex min-h-[280px] items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-slate-500" />
              </div>
            )}
            {error && !loading && (
              <Card className={rowBg}>
                <CardContent className="py-12 text-center text-sm text-red-600">{error}</CardContent>
              </Card>
            )}

            {!loading && !error && data && (
              <>
                <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                  <Card className={rowBg}>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base">
                        {data.dateTypeLabel} Year over Year Comparison
                      </CardTitle>
                      <p className="text-xs text-slate-500">{data.measureLabel}</p>
                    </CardHeader>
                    <CardContent>
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-slate-200 dark:border-slate-700">
                            <th className="py-2 text-left">Time Range</th>
                            <th className="py-2 text-right">{data.currentYear}</th>
                            <th className="py-2 text-right">{data.previousYear}</th>
                            <th className="py-2 text-right">YoY %</th>
                          </tr>
                        </thead>
                        <tbody>
                          {data.yoyComparison.map((row) => (
                            <tr key={row.timeRange} className="border-b border-slate-100 dark:border-slate-800">
                              <td className="py-2">{row.timeRange}</td>
                              <td className="py-2 text-right">{metricCell(row.currentYear, measure)}</td>
                              <td className="py-2 text-right">{metricCell(row.previousYear, measure)}</td>
                              <td className="py-2 text-right">{formatPct(row.yoyPercent)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </CardContent>
                  </Card>

                  <Card className={rowBg}>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base">
                        {topUnitsOrVolume} largest {topDimensionLabel} Category with {Math.round(topShare)}% of the share, YTD
                      </CardTitle>
                      <p className="text-xs text-slate-500">{data.measureLabel}</p>
                    </CardHeader>
                    <CardContent>
                      <div className="h-[320px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={data.largestCategory.rows} margin={{ top: 4, right: 8, left: 4, bottom: 4 }} onClick={handleBarChartClick}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey="category" tick={{ fontSize: 11 }} interval={0} angle={-20} textAnchor="end" height={80} />
                            <YAxis tickFormatter={(v) => formatMeasure(v, measure)} />
                            <Tooltip formatter={(v: number) => formatMeasure(Number(v), measure)} />
                            <Bar dataKey={measure} fill="#0ea5e9" className="cursor-pointer" radius={[4, 4, 0, 0]}>
                              {data.largestCategory.rows.map((entry) => {
                                const dimmed = chartCategorySelectionActive && !sliceCategories.includes(entry.category);
                                return <Cell key={entry.category} fill={dimmed ? CHART_DEEMPHASIS_FILL : "#0ea5e9"} />;
                              })}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </CardContent>
                  </Card>
                </div>

                <Card className={rowBg}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">{lineChartTitle}</CardTitle>
                    <p className="text-xs text-slate-500">{data.measureLabel} (Cumulative by month)</p>
                  </CardHeader>
                  <CardContent>
                    {series.length > 0 ? (
                      <>
                        <Tabs value={selectedSeries?.key} onValueChange={setActiveSeries}>
                          <TabsList className="mb-3">
                            {series.map((s) => (
                              <TabsTrigger key={s.key} value={s.key}>
                                {s.currentYear} vs {s.previousYear}
                              </TabsTrigger>
                            ))}
                          </TabsList>
                        </Tabs>
                        {selectedSeries && (
                          <div className="h-[350px]">
                            <ResponsiveContainer width="100%" height="100%">
                              <LineChart data={selectedSeriesPoints}>
                                <CartesianGrid strokeDasharray="3 3" />
                                <XAxis dataKey="monthLabel" />
                                <YAxis tickFormatter={(v) => formatMeasure(v, measure)} />
                                <Tooltip formatter={lineTooltipFormatter} />
                                <Legend />
                                <Line
                                  type="monotone"
                                  dataKey="currentValueDisplay"
                                  name={String(selectedSeries.currentYear)}
                                  stroke="#0ea5e9"
                                  strokeWidth={2}
                                  connectNulls={false}
                                  dot={sliceLineDot(selectedSeries.currentYear, "#0ea5e9")}
                                  isAnimationActive={false}
                                />
                                <Line
                                  type="monotone"
                                  dataKey="previousValue"
                                  name={String(selectedSeries.previousYear)}
                                  stroke="#64748b"
                                  strokeWidth={2}
                                  dot={sliceLineDot(selectedSeries.previousYear, "#64748b")}
                                  isAnimationActive={false}
                                />
                              </LineChart>
                            </ResponsiveContainer>
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="py-8 text-center text-sm text-slate-500">No historical year pairs available.</div>
                    )}
                  </CardContent>
                </Card>

                <Card className={rowBg}>
                  <CardHeader className="pb-2">
                    <div className="flex items-center gap-2">
                      <CardTitle className="text-base">{data.dateTypeLabel} Drilldown</CardTitle>
                      <Badge variant="secondary">Branch → Lien Position → Product Type → Loan Program</Badge>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <DrilldownRows
                      rows={data.drilldown.rows}
                      measure={measure}
                      turnTimeLabel={data.drilldown.turnTimeLabel}
                      sliceDrilldown={sliceDrilldown}
                      onRowFilterClick={handleDrilldownRowFilter}
                    />
                  </CardContent>
                </Card>
              </>
            )}
          </div>
        </main>
      </div>
    </TopTieringLayout>
  );
};

export default ProductionTrends;
