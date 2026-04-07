import React, { useMemo } from "react";
import type { ComponentType } from "react";
import type {
  WidgetDefinition,
  WidgetRenderProps,
  KPIData,
  TableData,
  ChartData,
  TableColumn,
} from "./types";
import { KPICard } from "../components/KPICard";
import { DataTable } from "../components/DataTable";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { Filter, X } from "lucide-react";
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid } from "recharts";
import type { EstimatedClosingsRiskResponse } from "@/hooks/useEstimatedClosingsRiskData";
import { ESTIMATED_CLOSINGS_DETAIL_COLUMNS } from "@/config/estimatedClosingsDetailColumns";
import {
  DATE_FILTER_BLANK_LABEL,
  DATE_FILTER_BLANK_SHORTCUT,
  type ColumnFilterState,
  type ColumnFilter,
  type NumericFilterMode,
  normalizeFilterState,
  isFilterActive,
  isDateFilterBlankOnlyShortcut,
} from "@/utils/loanDetailFilters";

type Source = EstimatedClosingsRiskResponse | null;

type RiskConfig = {
  selectedEcdSlice?: string | null;
  selectedComplexityBucket?: string | null;
  selectedRemainingComplexityGroup?: string | null;
  selectedRemainingProcessingStage?: string | null;
  onSelectEcdSlice?: (
    key: "empty_ecd" | "past_ecd" | "this_months_ecd" | "after_this_month" | null,
  ) => void;
  onSelectComplexityBucket?: (
    key: "gte_130" | "gte_120" | "gte_110" | "all_rest" | null,
  ) => void;
  onSelectRemainingComplexityGroup?: (group: string | null) => void;
  onSelectRemainingProcessingStage?: (stage: string | null) => void;
  detailColumnFilters?: ColumnFilterState;
  onUpdateDetailColumnFilters?: (next: ColumnFilterState) => void;
  onClearDetailColumnFilter?: (columnId: string) => void;
};

const ECD_SLICE_LABELS: Record<string, string> = {
  empty_ecd: "No ECD",
  past_ecd: "Past ECD",
  this_months_ecd: "This Month's ECD",
  after_this_month: "After This Month",
};

/** Same order as `EstimatedClosingsRiskView` pie (API slice order × index). */
const ECD_PIE_COLORS = ["#94a3b8", "#ef4444", "#3b82f6", "#10b981"];

const COMPLEXITY_BUCKET_LABELS: Record<string, string> = {
  gte_130: "Complexity >=130",
  gte_120: "Complexity >=120",
  gte_110: "Complexity >=110",
  all_rest: "All Other Complexity",
};

function getStringField(row: unknown, key: string): string | null {
  if (!row || typeof row !== "object") return null;
  const value = (row as Record<string, unknown>)[key];
  return typeof value === "string" ? value : null;
}

function toEcdKey(value: string | null) {
  if (value === "remaining_to_fund") return "this_months_ecd";
  if (
    value === "empty_ecd" ||
    value === "past_ecd" ||
    value === "this_months_ecd" ||
    value === "after_this_month"
  )
    return value;
  return null;
}

function toComplexityBucketKey(value: string | null) {
  if (
    value === "gte_130" ||
    value === "gte_120" ||
    value === "gte_110" ||
    value === "all_rest"
  )
    return value;
  return null;
}

function toSource(raw: unknown): Source {
  return raw as Source;
}

/** ChartData for canvas store / PowerPoint — same canonical shape as Company Scorecard charts. */
function selectEcdPieChartData(raw: unknown): ChartData {
  const src = toSource(raw);
  const slices = src?.activePipelineEcdSlices ?? [];
  return {
    title: "Active Pipeline by ECD",
    chartType: "pie",
    data: slices.map((s) => ({
      key: s.key,
      label: s.label,
      count: s.count,
    })) as Record<string, unknown>[],
    series: [{ dataKey: "count", name: "Loans", color: "#3b82f6" }],
    xAxisKey: "label",
  };
}

function selectComplexityBarChartData(raw: unknown): ChartData {
  const src = toSource(raw);
  const rows = src?.maxPossibleFundingByComplexity ?? [];
  return {
    title: "Max Possible Funding by Complexity",
    chartType: "bar",
    stacked: true,
    data: rows.map((r) => ({
      bucketLabel: r.bucketLabel,
      bucketKey: r.bucketKey,
      funded: r.funded,
      notFunded: r.notFunded,
    })) as Record<string, unknown>[],
    series: [
      { dataKey: "funded", name: "Funded", color: "#3b82f6" },
      { dataKey: "notFunded", name: "Not Funded", color: "#ef4444" },
    ],
    xAxisKey: "bucketLabel",
  };
}

function selectLoanDetailTableData(raw: unknown): TableData {
  const src = toSource(raw);
  const sliceCols = ESTIMATED_CLOSINGS_DETAIL_COLUMNS.slice(0, 10);
  const columns: TableColumn[] = sliceCols.map((c) => ({
    key: c.id,
    label: c.label,
    sortable: false,
    align: c.kind === "number" ? "right" : "left",
    format: c.kind === "number" ? "number" : undefined,
  }));
  return {
    title: "Loan Detail",
    columns,
    rows: (src?.detail?.rows ?? []) as Record<string, unknown>[],
  };
}

/** Same calendar logic as EstimatedClosingsRiskView stage table. */
function daysRemainingInCurrentMonth(): number {
  const now = new Date();
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const msPerDay = 24 * 60 * 60 * 1000;
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfEndDate = new Date(
    endOfMonth.getFullYear(),
    endOfMonth.getMonth(),
    endOfMonth.getDate(),
  );
  return Math.max(0, Math.floor((startOfEndDate.getTime() - startOfToday.getTime()) / msPerDay));
}

function getActiveFilterLabels(cfg: RiskConfig): string[] {
  const labels: string[] = [];
  if (cfg.selectedComplexityBucket) {
    labels.push(
      COMPLEXITY_BUCKET_LABELS[cfg.selectedComplexityBucket] ??
        cfg.selectedComplexityBucket,
    );
  }
  if (cfg.selectedEcdSlice) {
    labels.push(ECD_SLICE_LABELS[cfg.selectedEcdSlice] ?? cfg.selectedEcdSlice);
  }
  if (cfg.selectedRemainingComplexityGroup) {
    labels.push(`Complexity Group: ${cfg.selectedRemainingComplexityGroup}`);
  }
  if (cfg.selectedRemainingProcessingStage) {
    labels.push(`Stage: ${cfg.selectedRemainingProcessingStage}`);
  }
  return labels;
}

function getActiveFilterItems(cfg: RiskConfig): Array<{ key: string; label: string; clear: () => void }> {
  const items: Array<{ key: string; label: string; clear: () => void }> = [];
  if (cfg.selectedComplexityBucket) {
    const key = cfg.selectedComplexityBucket;
    items.push({
      key: `complexity:${key}`,
      label: COMPLEXITY_BUCKET_LABELS[key] ?? key,
      clear: () => cfg.onSelectComplexityBucket?.(toComplexityBucketKey(key)),
    });
  }
  if (cfg.selectedEcdSlice) {
    const key = cfg.selectedEcdSlice;
    items.push({
      key: `ecd:${key}`,
      label: ECD_SLICE_LABELS[key] ?? key,
      clear: () => cfg.onSelectEcdSlice?.(toEcdKey(key)),
    });
  }
  if (cfg.selectedRemainingComplexityGroup) {
    const value = cfg.selectedRemainingComplexityGroup;
    items.push({
      key: `remaining-complexity:${value}`,
      label: `Complexity Group: ${value}`,
      clear: () => cfg.onSelectRemainingComplexityGroup?.(value),
    });
  }
  if (cfg.selectedRemainingProcessingStage) {
    const value = cfg.selectedRemainingProcessingStage;
    items.push({
      key: `remaining-stage:${value}`,
      label: `Stage: ${value}`,
      clear: () => cfg.onSelectRemainingProcessingStage?.(value),
    });
  }
  for (const col of ESTIMATED_CLOSINGS_DETAIL_COLUMNS) {
    const filter = cfg.detailColumnFilters?.[col.id];
    if (!isFilterActive(filter)) continue;
    items.push({
      key: `detail:${col.id}`,
      label: `Detail - ${col.label}`,
      clear: () => cfg.onClearDetailColumnFilter?.(col.id),
    });
  }
  return items;
}

function riskKpi(
  id: string,
  name: string,
  selector: (k: NonNullable<Source>["kpis"]) => number | null,
  format: KPIData["format"] = "number",
): WidgetDefinition<KPIData> {
  return {
    id,
    name,
    description: name,
    category: "kpi",
    group: "Estimated Closings & Risk",
    dataSource: "estimated-closings-risk",
    dataSelector: (raw) => {
      const kpis = toSource(raw)?.kpis;
      const value = kpis ? selector(kpis) : 0;
      return { value: Number(value ?? 0), label: name, format };
    },
    defaultSize: { w: 100, h: 48 },
    minSize: { w: 50, h: 28 },
    component: KPICard,
  };
}

type EcdPieRow = { key: string; label: string; count: number };

function ecdPieRowsFromChartData(data: ChartData | null): EcdPieRow[] {
  if (!data?.data?.length) return [];
  return data.data.map((row) => {
    const r = row as Record<string, unknown>;
    return {
      key: String(r.key ?? ""),
      label: String(r.label ?? ""),
      count: Number(r.count ?? 0),
    };
  });
}

function EcdPieWidget({ data, loading, error, config }: WidgetRenderProps<ChartData>) {
  const cfg = (config ?? {}) as RiskConfig;
  const rows = ecdPieRowsFromChartData(data);
  const active = getActiveFilterLabels(cfg);
  return (
    <Card className="h-full border border-slate-200/70 dark:border-slate-700/70">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Active Pipeline by ECD</CardTitle>
      </CardHeader>
      <CardContent className="h-[calc(100%-48px)]">
        {active.length > 0 ? (
          <div className="mb-2 text-[11px] text-slate-600 dark:text-slate-300">
            Active filters: {active.join(" | ")}
          </div>
        ) : null}
        {error ? <div className="text-xs text-red-600">{error}</div> : null}
        {!error && (
          <ResponsiveContainer width="100%" height="100%">
            <PieChart margin={{ top: 16, right: 20, bottom: 16, left: 20 }}>
              <Pie
                data={rows}
                dataKey="count"
                nameKey="label"
                outerRadius={90}
                label={(entry: { label?: string; count?: number }) =>
                  `${entry.label ?? ""}: ${Number(entry.count ?? 0).toLocaleString()}`
                }
                className="cursor-pointer [&_path]:outline-none"
                onClick={(entry: unknown) => {
                  const key = getStringField(entry, "key");
                  cfg.onSelectEcdSlice?.(toEcdKey(key));
                }}
              >
                {rows.map((r, i) => (
                  <Cell
                    key={r.key}
                    fill={ECD_PIE_COLORS[i % ECD_PIE_COLORS.length]}
                    opacity={
                      cfg.selectedEcdSlice != null && cfg.selectedEcdSlice !== r.key ? 0.35 : 1
                    }
                  />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        )}
        {loading && rows.length === 0 ? <div className="text-xs text-slate-500">Loading...</div> : null}
      </CardContent>
    </Card>
  );
}

type ComplexityBarRow = {
  bucketKey: string;
  bucketLabel: string;
  funded: number;
  notFunded: number;
};

function complexityBarRowsFromChartData(data: ChartData | null): ComplexityBarRow[] {
  if (!data?.data?.length) return [];
  return data.data.map((row) => {
    const r = row as Record<string, unknown>;
    return {
      bucketKey: String(r.bucketKey ?? ""),
      bucketLabel: String(r.bucketLabel ?? ""),
      funded: Number(r.funded ?? 0),
      notFunded: Number(r.notFunded ?? 0),
    };
  });
}

function ComplexityBarWidget({ data, loading, error, config }: WidgetRenderProps<ChartData>) {
  const cfg = (config ?? {}) as RiskConfig;
  const rows = complexityBarRowsFromChartData(data);
  const active = getActiveFilterLabels(cfg);
  return (
    <Card className="h-full border border-slate-200/70 dark:border-slate-700/70">
      <CardHeader className="pb-2"><CardTitle className="text-sm">Max Possible Funding by Complexity</CardTitle></CardHeader>
      <CardContent className="h-[calc(100%-48px)]">
        {active.length > 0 ? (
          <div className="mb-2 text-[11px] text-slate-600 dark:text-slate-300">
            Active filters: {active.join(" | ")}
          </div>
        ) : null}
        {error ? <div className="text-xs text-red-600">{error}</div> : null}
        {!error && (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="bucketLabel" />
              <YAxis />
              <Tooltip />
              <Bar
                dataKey="funded"
                stackId="funding"
                fill="#3b82f6"
                name="Funded"
                className="cursor-pointer"
                onClick={(entry: unknown) =>
                  cfg.onSelectComplexityBucket?.(
                    toComplexityBucketKey(getStringField(entry, "bucketKey")),
                  )
                }
              />
              <Bar
                dataKey="notFunded"
                stackId="funding"
                fill="#ef4444"
                name="Not Funded"
                className="cursor-pointer"
                onClick={(entry: unknown) =>
                  cfg.onSelectComplexityBucket?.(
                    toComplexityBucketKey(getStringField(entry, "bucketKey")),
                  )
                }
              />
            </BarChart>
          </ResponsiveContainer>
        )}
        {loading && rows.length === 0 ? <div className="text-xs text-slate-500">Loading...</div> : null}
      </CardContent>
    </Card>
  );
}

function cloneColumnFilter(filter: ColumnFilter | undefined): ColumnFilter | undefined {
  if (!filter) return undefined;
  if (filter.kind === "text") return { kind: "text", selectedValues: [...filter.selectedValues] };
  if (filter.kind === "number") {
    return {
      kind: "number",
      mode: filter.mode as NumericFilterMode,
      selectedValues: [...filter.selectedValues],
      min: filter.min,
      max: filter.max,
      value: filter.value,
    };
  }
  if (filter.kind === "date") return { kind: "date", from: filter.from, to: filter.to, shortcut: filter.shortcut };
  return { kind: "boolean", value: filter.value };
}

const remainingByComplexityTable: WidgetDefinition<TableData> = {
  id: "estimated-closings-remaining-complexity-table",
  name: "Remaining to Fund by Complexity",
  description: "Remaining to Fund with historical fallout by complexity group",
  category: "table",
  group: "Estimated Closings & Risk",
  dataSource: "estimated-closings-risk",
  dataSelector: (raw) => ({
    title: "Remaining to Fund, Experience by Complexity",
    columns: [
      { key: "complexityGroup", label: "Complexity Group", sortable: true },
      { key: "unitsRemainingToFund", label: "Units Remaining", align: "right", sortable: true, format: "number" },
      {
        key: "historicalFalloutLast13Months",
        label: "Historical % Fallout (13M)",
        align: "right",
        sortable: true,
        format: "percent",
      },
    ],
    rows: (toSource(raw)?.remainingToFundByComplexity ?? []).map((r) => ({
      complexityGroup: r.complexityGroup,
      unitsRemainingToFund: r.unitsRemainingToFund,
      historicalFalloutLast13Months:
        r.historicalFalloutLast13Months == null ? null : r.historicalFalloutLast13Months,
    })),
  }),
  defaultSize: { w: 24, h: 22 },
  minSize: { w: 16, h: 14 },
  component: DataTable as ComponentType<WidgetRenderProps<TableData>>,
};

const remainingByStageTable: WidgetDefinition<TableData> = {
  id: "estimated-closings-remaining-stage-table",
  name: "Remaining to Fund by Processing Stage",
  description: "Remaining to Fund with historical fallout by processing stage",
  category: "table",
  group: "Estimated Closings & Risk",
  dataSource: "estimated-closings-risk",
  dataSelector: (raw) => {
    const daysLeft = daysRemainingInCurrentMonth();
    return {
      title: "Remaining to Fund, Experience by Current Processing Stage",
      columns: [
        { key: "processingStage", label: "Processing Stage", sortable: true },
        { key: "unitsRemainingToFund", label: "Units Remaining", align: "right", sortable: true, format: "number" },
        {
          key: "daysRemainingInCurrentMonth",
          label: "Days Remaining in Current Month",
          align: "right",
          sortable: false,
          format: "number",
        },
        {
          key: "historicalFallout",
          label: "Historical Fallout",
          align: "right",
          sortable: true,
          format: "percent",
        },
        {
          key: "historicalStatusToFundDays",
          label: "Historical Status to Fund Days",
          align: "right",
          sortable: true,
          format: "number",
        },
      ],
      rows: (toSource(raw)?.remainingToFundByProcessingStage ?? []).map((r) => ({
        processingStage: r.processingStage,
        unitsRemainingToFund: r.unitsRemainingToFund,
        daysRemainingInCurrentMonth: daysLeft,
        historicalFallout: r.historicalFallout == null ? null : r.historicalFallout,
        historicalStatusToFundDays:
          r.historicalStatusToFundDays == null
            ? null
            : Math.round(Number(r.historicalStatusToFundDays) * 10) / 10,
      })),
    };
  },
  defaultSize: { w: 24, h: 22 },
  minSize: { w: 16, h: 14 },
  component: DataTable as ComponentType<WidgetRenderProps<TableData>>,
};

function EstimatedClosingsDetailTableWidget({
  data,
  loading,
  error,
  config,
}: WidgetRenderProps<TableData>) {
  const cfg = (config ?? {}) as RiskConfig;
  const rows = useMemo(() => (data?.rows ?? []) as Record<string, unknown>[], [data?.rows]);
  const columns = ESTIMATED_CLOSINGS_DETAIL_COLUMNS.slice(0, 10);
  const [openColumn, setOpenColumn] = React.useState<string | null>(null);
  const [searchByColumn, setSearchByColumn] = React.useState<Record<string, string>>({});
  const [draftFilter, setDraftFilter] = React.useState<ColumnFilterState>({});
  const optionsByColumn = useMemo(() => {
    const out: Record<string, string[]> = {};
    for (const c of columns) {
      const set = new Set<string>();
      for (const row of rows) {
        const v = row[c.id];
        if (v == null || String(v).trim() === "") continue;
        set.add(String(v));
      }
      out[c.id] = [...set].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    }
    return out;
  }, [columns, rows]);

  const applyDraft = (columnId: string) => {
    if (!cfg.onUpdateDetailColumnFilters) return;
    const next = { ...(cfg.detailColumnFilters ?? {}) };
    const current = draftFilter[columnId];
    if (!current || !isFilterActive(current)) delete next[columnId];
    else next[columnId] = current;
    cfg.onUpdateDetailColumnFilters(normalizeFilterState(next));
    setOpenColumn(null);
  };

  const clearColumn = (columnId: string) => {
    cfg.onClearDetailColumnFilter?.(columnId);
    setOpenColumn(null);
  };

  return (
    <div className="h-full flex flex-col min-h-0">
      <Card className="h-full border border-slate-200/70 dark:border-slate-700/70">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">{data?.title ?? "Loan Detail"}</CardTitle>
        </CardHeader>
        <CardContent className="min-h-0 h-[calc(100%-48px)] overflow-auto p-0">
          {error ? <div className="p-4 text-xs text-red-600">{error}</div> : null}
          {loading && rows.length === 0 ? <div className="p-4 text-xs text-slate-500">Loading...</div> : null}
          {!error ? (
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700">
                <tr>
                  {columns.map((c) => {
                    const active = isFilterActive(cfg.detailColumnFilters?.[c.id]);
                    const filter = draftFilter[c.id] ?? cloneColumnFilter(cfg.detailColumnFilters?.[c.id]);
                    const search = searchByColumn[c.id] ?? "";
                    const textOptions = (optionsByColumn[c.id] ?? []).filter((v) =>
                      v.toLowerCase().includes(search.toLowerCase()),
                    );
                    return (
                      <th key={c.id} className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                        <div className="flex items-center gap-1">
                          <span>{c.label}</span>
                          <Popover
                            open={openColumn === c.id}
                            onOpenChange={(open) => {
                              setOpenColumn(open ? c.id : null);
                              if (open) setDraftFilter((prev) => ({ ...prev, [c.id]: cloneColumnFilter(cfg.detailColumnFilters?.[c.id]) }));
                            }}
                          >
                            <PopoverTrigger asChild>
                              <button className={cn("rounded p-1 hover:bg-slate-200 dark:hover:bg-slate-700", active && "text-blue-600")}>
                                <Filter className="h-3 w-3" />
                              </button>
                            </PopoverTrigger>
                            <PopoverContent className="w-72 p-3" align="start">
                              <div className="mb-2 text-xs font-medium">{c.label}</div>
                              {c.kind === "text" && (
                                <div className="space-y-2">
                                  <Input
                                    value={search}
                                    onChange={(e) => setSearchByColumn((p) => ({ ...p, [c.id]: e.target.value }))}
                                    placeholder="Search values..."
                                    className="h-8 text-xs"
                                  />
                                  <div className="max-h-40 overflow-auto space-y-1">
                                    {textOptions.map((v) => {
                                      const selected = filter?.kind === "text" ? filter.selectedValues.includes(v) : false;
                                      return (
                                        <label key={v} className="flex items-center gap-2 text-xs">
                                          <Checkbox
                                            checked={selected}
                                            onCheckedChange={(checked) => {
                                              const current = filter?.kind === "text" ? [...filter.selectedValues] : [];
                                              const next = checked ? [...current, v] : current.filter((x) => x !== v);
                                              setDraftFilter((p) => ({ ...p, [c.id]: { kind: "text", selectedValues: next } }));
                                            }}
                                          />
                                          <span>{v}</span>
                                        </label>
                                      );
                                    })}
                                  </div>
                                </div>
                              )}
                              {c.kind === "number" && (
                                <div className="flex gap-2">
                                  <Input
                                    type="number"
                                    placeholder="Min"
                                    value={filter?.kind === "number" ? filter.min ?? "" : ""}
                                    onChange={(e) =>
                                      setDraftFilter((p) => ({
                                        ...p,
                                        [c.id]: {
                                          kind: "number",
                                          mode: "range",
                                          selectedValues: [],
                                          min: e.target.value,
                                          max: filter?.kind === "number" ? filter.max : "",
                                        },
                                      }))
                                    }
                                  />
                                  <Input
                                    type="number"
                                    placeholder="Max"
                                    value={filter?.kind === "number" ? filter.max ?? "" : ""}
                                    onChange={(e) =>
                                      setDraftFilter((p) => ({
                                        ...p,
                                        [c.id]: {
                                          kind: "number",
                                          mode: "range",
                                          selectedValues: [],
                                          min: filter?.kind === "number" ? filter.min : "",
                                          max: e.target.value,
                                        },
                                      }))
                                    }
                                  />
                                </div>
                              )}
                              {c.kind === "date" && (
                                <div className="space-y-2">
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant={
                                      filter?.kind === "date" && isDateFilterBlankOnlyShortcut(filter.shortcut)
                                        ? "default"
                                        : "outline"
                                    }
                                    className="w-full justify-start h-8 text-xs"
                                    onClick={() =>
                                      setDraftFilter((p) => ({
                                        ...p,
                                        [c.id]: {
                                          kind: "date",
                                          shortcut: DATE_FILTER_BLANK_SHORTCUT,
                                          from: "",
                                          to: "",
                                        },
                                      }))
                                    }
                                  >
                                    {DATE_FILTER_BLANK_LABEL}
                                  </Button>
                                  <div className="flex gap-2">
                                    <Input
                                      type="date"
                                      value={filter?.kind === "date" ? filter.from ?? "" : ""}
                                      onChange={(e) =>
                                        setDraftFilter((p) => ({
                                          ...p,
                                          [c.id]: {
                                            kind: "date",
                                            from: e.target.value,
                                            to: filter?.kind === "date" ? filter.to ?? "" : "",
                                            shortcut: undefined,
                                          },
                                        }))
                                      }
                                    />
                                    <Input
                                      type="date"
                                      value={filter?.kind === "date" ? filter.to ?? "" : ""}
                                      onChange={(e) =>
                                        setDraftFilter((p) => ({
                                          ...p,
                                          [c.id]: {
                                            kind: "date",
                                            from: filter?.kind === "date" ? filter.from ?? "" : "",
                                            to: e.target.value,
                                            shortcut: undefined,
                                          },
                                        }))
                                      }
                                    />
                                  </div>
                                </div>
                              )}
                              {c.kind === "boolean" && (
                                <div className="flex gap-2">
                                  {(["all", "yes", "no"] as const).map((v) => (
                                    <Button
                                      key={v}
                                      size="sm"
                                      variant={filter?.kind === "boolean" && filter.value === v ? "default" : "outline"}
                                      onClick={() => setDraftFilter((p) => ({ ...p, [c.id]: v === "all" ? undefined : { kind: "boolean", value: v } }))}
                                    >
                                      {v === "all" ? "All" : v === "yes" ? "Yes" : "No"}
                                    </Button>
                                  ))}
                                </div>
                              )}
                              <div className="mt-3 flex justify-between">
                                <Button size="sm" variant="outline" onClick={() => clearColumn(c.id)}>Clear</Button>
                                <Button size="sm" onClick={() => applyDraft(c.id)}>Apply</Button>
                              </div>
                            </PopoverContent>
                          </Popover>
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-b border-slate-100 dark:border-slate-800">
                    {columns.map((c) => (
                      <td key={c.id} className="px-3 py-2 text-xs text-slate-800 dark:text-slate-200">
                        {String(r[c.id] ?? "")}
                      </td>
                    ))}
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={columns.length} className="px-3 py-4 text-center text-xs text-slate-500">
                      No rows
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
function ActiveFiltersWidget({ config }: WidgetRenderProps<Source>) {
  const cfg = (config ?? {}) as RiskConfig;
  const active = getActiveFilterItems(cfg);
  return (
    <Card className="h-full border border-slate-200/70 dark:border-slate-700/70 flex flex-col min-h-0">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Active Filters</CardTitle>
      </CardHeader>
      <CardContent className="flex-1 min-h-0 overflow-auto">
        {active.length === 0 ? (
          <div className="text-xs text-slate-500">No filters applied</div>
        ) : (
          <div className="flex flex-wrap gap-1">
            {active.map((a) => (
              <button
                key={a.key}
                onClick={a.clear}
                className="inline-flex items-center gap-1 rounded-full border border-slate-200 px-2 py-1 text-xs dark:border-slate-700"
              >
                {a.label}
                <X className="h-3 w-3" />
              </button>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

const detailTable: WidgetDefinition<TableData> = {
  id: "estimated-closings-detail-table",
  name: "Estimated Closings Detail",
  description: "Loan-level detail table",
  category: "table",
  group: "Estimated Closings & Risk",
  dataSource: "estimated-closings-risk",
  dataSelector: (raw) => selectLoanDetailTableData(raw),
  defaultSize: { w: 36, h: 24 },
  minSize: { w: 24, h: 14 },
  component: EstimatedClosingsDetailTableWidget as ComponentType<
    WidgetRenderProps<TableData>
  >,
};

export const estimatedClosingsRiskWidgets: WidgetDefinition[] = [
  riskKpi("estimated-closings-kpi-total-active-pipeline", "Total Active Pipeline", (k) => k.totalActivePipeline),
  riskKpi("estimated-closings-kpi-ecd-empty-or-after", "ECD Empty or After This Month", (k) => k.ecdEmptyOrAfterThisMonth),
  riskKpi("estimated-closings-kpi-remaining-to-fund", "Remaining to Fund This Month", (k) => k.remainingToFund),
  riskKpi("estimated-closings-kpi-funded-this-month", "Funded This Month", (k) => k.fundedThisMonth),
  riskKpi("estimated-closings-kpi-max-possible-funding", "Max Possible Funding", (k) => k.maxPossibleFunding),
  riskKpi("estimated-closings-kpi-funding-ytd-units", "Funding YTD Units", (k) => k.fundingYtdUnits),
  riskKpi("estimated-closings-kpi-prev-month-actual-units", "Prev Month Actual Units", (k) => k.prevMonthActualUnits),
  riskKpi("estimated-closings-kpi-prev-month-actual-volume", "Prev Month Actual Volume", (k) => k.prevMonthActualVolume, "currency"),
  riskKpi("estimated-closings-kpi-units-last-month-vs-prior", "Units Last Month vs Prior", (k) => k.unitsLastMonthVsPriorPct ?? 0, "percent"),
  riskKpi("estimated-closings-kpi-volume-last-month-vs-prior", "Volume Last Month vs Prior", (k) => k.volumeLastMonthVsPriorPct ?? 0, "percent"),
  {
    id: "estimated-closings-active-filters",
    name: "Active Filters",
    description: "Current section filters with one-click clear",
    category: "insight",
    group: "Estimated Closings & Risk",
    dataSource: "estimated-closings-risk",
    dataSelector: (raw) => toSource(raw),
    defaultSize: { w: 500, h: 64 },
    minSize: { w: 320, h: 40 },
    component: ActiveFiltersWidget as ComponentType<WidgetRenderProps<unknown>>,
  },
  {
    id: "estimated-closings-ecd-pie",
    name: "Active Pipeline by ECD",
    description: "Distribution of active pipeline by ECD slice",
    category: "chart",
    group: "Estimated Closings & Risk",
    dataSource: "estimated-closings-risk",
    dataSelector: (raw) => selectEcdPieChartData(raw),
    defaultSize: { w: 18, h: 20 },
    minSize: { w: 12, h: 12 },
    component: EcdPieWidget as ComponentType<WidgetRenderProps<ChartData>>,
  },
  {
    id: "estimated-closings-complexity-bar",
    name: "Max Possible Funding by Complexity",
    description: "Bar chart of complexity buckets",
    category: "chart",
    group: "Estimated Closings & Risk",
    dataSource: "estimated-closings-risk",
    dataSelector: (raw) => selectComplexityBarChartData(raw),
    defaultSize: { w: 18, h: 20 },
    minSize: { w: 12, h: 12 },
    component: ComplexityBarWidget as ComponentType<WidgetRenderProps<ChartData>>,
  },
  remainingByComplexityTable,
  remainingByStageTable,
  detailTable,
];
