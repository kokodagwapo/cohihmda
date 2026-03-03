/**
 * Actors View – dashboard for exploring productivity relationships between
 * operations team members (Loan Officer, Processor, Underwriter, Closer).
 * Uses same period filter as Workflow Conversion; filters drive base loan set.
 */

import React, { useState, useCallback, useMemo } from "react";
import { format } from "date-fns";
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
import { Button } from "@/components/ui/button";
import { DatePeriodPicker } from "@/components/ui/DatePeriodPicker";
import type { PeriodSelection, PeriodPreset } from "@/components/ui/DatePeriodPicker";
import { useActorsData } from "@/hooks/useActorsData";
import type {
  ActorsCalculation,
  ActorsTurnTimeType,
  ActorsDateRangeType,
  ActorsMeasure,
  ActorDimension,
  ActorRow,
  ActorsTableResult,
} from "@/hooks/useActorsData";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  Cell,
} from "recharts";
import { cn } from "@/lib/utils";
import { exportDataAsExcel } from "@/utils/exportUtils";
import type { ExportTable } from "@/utils/exportUtils";
import { Loader2, Search, X, Maximize2, Download, ArrowUp, ArrowDown } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

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

const DIMENSION_LABELS: Record<ActorDimension, string> = {
  channel: "Channel",
  processor: "Processor",
  closer: "Closer",
  underwriter: "Underwriter",
  loan_officer: "Loan Officer",
  branch: "Branch",
  investor: "Investor",
  warehouse_co_name: "Warehouse Co Name",
};

const DIMENSION_OPTIONS: ActorDimension[] = [
  "channel",
  "processor",
  "closer",
  "underwriter",
  "loan_officer",
  "branch",
  "investor",
  "warehouse_co_name",
];

export interface ActorsViewProps {
  selectedTenantId?: string | null;
  selectedChannel?: string | null;
}

export function ActorsView({
  selectedTenantId,
  selectedChannel,
}: ActorsViewProps) {
  const [periodSelection, setPeriodSelection] = useState<PeriodSelection>(() => {
    const range = getDefaultDateRange();
    return { type: "preset", preset: "mtd", dateRange: range };
  });
  const [calculation, setCalculation] = useState<ActorsCalculation>("average");
  const [turnTimeType, setTurnTimeType] = useState<ActorsTurnTimeType>("app_to_fund_days");
  const [dateRangeType, setDateRangeType] = useState<ActorsDateRangeType>("calendar_days");
  const [measure, setMeasure] = useState<ActorsMeasure>("units");
  const [selectedActor, setSelectedActor] = useState<{
    type: ActorDimension;
    name: string;
  } | null>(null);
  const [selectedStatus, setSelectedStatus] = useState<string | null>(null);
  const [tableDimensions, setTableDimensions] = useState<
    [ActorDimension, ActorDimension, ActorDimension, ActorDimension]
  >(["loan_officer", "processor", "underwriter", "closer"]);
  const [searchQueries, setSearchQueries] = useState<[string, string, string, string]>([
    "",
    "",
    "",
    "",
  ]);

  const dateRange = periodSelection.dateRange;
  const { data, loading, error } = useActorsData({
    startDate: dateRange.start,
    endDate: dateRange.end,
    calculation,
    turnTimeType,
    dateRangeType,
    measure,
    selectedTenantId,
    channelGroup: selectedChannel,
    selectedActor,
    selectedStatus,
    tableDimensions,
  });

  const updateTableDimension = useCallback((index: number, value: ActorDimension) => {
    setTableDimensions((prev) => {
      const next = [...prev] as [ActorDimension, ActorDimension, ActorDimension, ActorDimension];
      next[index] = value;
      return next;
    });
  }, []);

  const setSearchQuery = useCallback((index: number, value: string) => {
    setSearchQueries((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  }, []);

  const clearActorFilter = useCallback(() => setSelectedActor(null), []);
  const clearStatusFilter = useCallback(() => setSelectedStatus(null), []);

  const turnTimeLabel =
    calculation === "median"
      ? turnTimeType === "app_to_fund_days"
        ? "Median App to Fund"
        : "Median App to Closing"
      : turnTimeType === "app_to_fund_days"
        ? "Avg App to Fund"
        : "Avg App to Closing";

  const exportAllTablesToExcel = useCallback(() => {
    const formatVolume = (n: number) => {
      if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
      if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
      return `$${n.toFixed(0)}`;
    };
    const headers: string[] = [
      "Actor",
      "Units",
      "Volume",
      turnTimeLabel,
      "Approval %",
      "Denied %",
      "Withdrawn %",
      "Complexity",
    ];
    const tables: ExportTable[] = (data?.tables ?? []).slice(0, 4).map((tableData, idx) => {
      const dimensionLabel = DIMENSION_LABELS[tableDimensions[idx]];
      const rows: Array<Array<string | number | null | undefined>> = [];
      if (tableData?.totals) {
        const t = tableData.totals;
        rows.push([
          "Totals",
          t.units,
          formatVolume(t.volume),
          t.avgAppToFund != null ? t.avgAppToFund.toFixed(2) : "—",
          t.approvalPct.toFixed(1) + "%",
          t.deniedPct.toFixed(1) + "%",
          t.withdrawnPct.toFixed(1) + "%",
          t.loanComplexity != null ? t.loanComplexity.toFixed(1) : "—",
        ]);
      }
      (tableData?.rows ?? []).forEach((row) => {
        rows.push([
          row.name,
          row.units,
          formatVolume(row.volume),
          row.avgAppToFund != null ? row.avgAppToFund.toFixed(2) : "—",
          row.approvalPct.toFixed(1) + "%",
          row.deniedPct.toFixed(1) + "%",
          row.withdrawnPct.toFixed(1) + "%",
          row.loanComplexity != null ? row.loanComplexity.toFixed(1) : "—",
        ]);
      });
      return { name: dimensionLabel, headers, rows };
    });
    if (tables.length === 0) return;
    exportDataAsExcel(
      { title: "Actors Dashboard", tables },
      `actors-all-tables-${new Date().toISOString().split("T")[0]}`
    );
  }, [data?.tables, tableDimensions, turnTimeLabel]);

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
            defaultPreset="mtd"
            showLabel={false}
            size="sm"
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-slate-600 dark:text-slate-400">
            Calculation
          </span>
          <div className="flex rounded-lg border border-slate-200 dark:border-slate-700 p-0.5 bg-slate-100/50 dark:bg-slate-800/50">
            <Button
              variant="ghost"
              size="sm"
              className={cn(
                "h-8 px-3 text-sm",
                calculation === "average"
                  ? "bg-white dark:bg-slate-900 shadow-sm border border-slate-200 dark:border-slate-600 text-slate-900 dark:text-slate-100"
                  : "text-slate-600 dark:text-slate-400 hover:bg-slate-200/50 dark:hover:bg-slate-700/50"
              )}
              onClick={() => setCalculation("average")}
            >
              Average
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className={cn(
                "h-8 px-3 text-sm",
                calculation === "median"
                  ? "bg-white dark:bg-slate-900 shadow-sm border border-slate-200 dark:border-slate-600 text-slate-900 dark:text-slate-100"
                  : "text-slate-600 dark:text-slate-400 hover:bg-slate-200/50 dark:hover:bg-slate-700/50"
              )}
              onClick={() => setCalculation("median")}
            >
              Median
            </Button>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-slate-600 dark:text-slate-400">
            Turn Time
          </span>
          <div className="flex rounded-lg border border-slate-200 dark:border-slate-700 p-0.5 bg-slate-100/50 dark:bg-slate-800/50">
            <Button
              variant="ghost"
              size="sm"
              className={cn(
                "h-8 px-3 text-sm whitespace-nowrap",
                turnTimeType === "app_to_fund_days"
                  ? "bg-white dark:bg-slate-900 shadow-sm border border-slate-200 dark:border-slate-600 text-slate-900 dark:text-slate-100"
                  : "text-slate-600 dark:text-slate-400 hover:bg-slate-200/50 dark:hover:bg-slate-700/50"
              )}
              onClick={() => setTurnTimeType("app_to_fund_days")}
            >
              App to Fund Days
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className={cn(
                "h-8 px-3 text-sm whitespace-nowrap",
                turnTimeType === "app_to_closing_days"
                  ? "bg-white dark:bg-slate-900 shadow-sm border border-slate-200 dark:border-slate-600 text-slate-900 dark:text-slate-100"
                  : "text-slate-600 dark:text-slate-400 hover:bg-slate-200/50 dark:hover:bg-slate-700/50"
              )}
              onClick={() => setTurnTimeType("app_to_closing_days")}
            >
              App to Closing Days
            </Button>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-slate-600 dark:text-slate-400">
            Date Range
          </span>
          <div className="flex rounded-lg border border-slate-200 dark:border-slate-700 p-0.5 bg-slate-100/50 dark:bg-slate-800/50">
            <Button
              variant="ghost"
              size="sm"
              className={cn(
                "h-8 px-3 text-sm",
                dateRangeType === "calendar_days"
                  ? "bg-white dark:bg-slate-900 shadow-sm border border-slate-200 dark:border-slate-600 text-slate-900 dark:text-slate-100"
                  : "text-slate-600 dark:text-slate-400 hover:bg-slate-200/50 dark:hover:bg-slate-700/50"
              )}
              onClick={() => setDateRangeType("calendar_days")}
            >
              Calendar Days
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className={cn(
                "h-8 px-3 text-sm",
                dateRangeType === "business_days"
                  ? "bg-white dark:bg-slate-900 shadow-sm border border-slate-200 dark:border-slate-600 text-slate-900 dark:text-slate-100"
                  : "text-slate-600 dark:text-slate-400 hover:bg-slate-200/50 dark:hover:bg-slate-700/50"
              )}
              onClick={() => setDateRangeType("business_days")}
            >
              Business Days
            </Button>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-slate-600 dark:text-slate-400">
            Measure
          </span>
          <div className="flex rounded-lg border border-slate-200 dark:border-slate-700 p-0.5 bg-slate-100/50 dark:bg-slate-800/50">
            <Button
              variant="ghost"
              size="sm"
              className={cn(
                "h-8 px-3 text-sm",
                measure === "volume"
                  ? "bg-white dark:bg-slate-900 shadow-sm border border-slate-200 dark:border-slate-600 text-slate-900 dark:text-slate-100"
                  : "text-slate-600 dark:text-slate-400 hover:bg-slate-200/50 dark:hover:bg-slate-700/50"
              )}
              onClick={() => setMeasure("volume")}
            >
              Volume
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className={cn(
                "h-8 px-3 text-sm",
                measure === "units"
                  ? "bg-white dark:bg-slate-900 shadow-sm border border-slate-200 dark:border-slate-600 text-slate-900 dark:text-slate-100"
                  : "text-slate-600 dark:text-slate-400 hover:bg-slate-200/50 dark:hover:bg-slate-700/50"
              )}
              onClick={() => setMeasure("units")}
            >
              Units
            </Button>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-2 border-slate-300 hover:bg-slate-50 dark:border-slate-600 dark:hover:bg-slate-800"
          onClick={exportAllTablesToExcel}
          disabled={!data?.tables?.length || data.tables.every((t) => !t?.rows?.length)}
        >
          <Download className="h-4 w-4" />
          All tables
        </Button>
        {selectedActor && (
          <div className="flex items-center gap-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-800/50 px-3 py-2">
            <div className="flex flex-col">
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                {DIMENSION_LABELS[selectedActor.type]}
              </span>
              <span className="text-sm text-slate-600 dark:text-slate-400">
                {selectedActor.name}
              </span>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0 rounded-full text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
              onClick={clearActorFilter}
              aria-label="Clear actor filter"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        )}
        {selectedStatus != null && (
          <div className="flex items-center gap-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-800/50 px-3 py-2">
            <div className="flex flex-col">
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                Status
              </span>
              <span className="text-sm text-slate-600 dark:text-slate-400">
                {selectedStatus}
              </span>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0 rounded-full text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
              onClick={clearStatusFilter}
              aria-label="Clear status filter"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-amber-200 bg-amber-50/80 px-4 py-2 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
          {error}
        </div>
      )}

      {/* Chart + KPIs row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="border border-slate-200 dark:border-slate-700 lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold">
              Current Loan Status
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-6">
            <div className="h-[280px] w-full flex items-center justify-center">
              {loading ? (
                <div className="flex items-center justify-center h-full">
                  <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
                </div>
              ) : data?.statusCounts?.length ? (
                <ResponsiveContainer width="100%" height="100%" className="min-h-0">
                  <BarChart
                    layout="vertical"
                    data={data.statusCounts.map((s) => ({
                      name: s.status,
                      count: s.count,
                      volume: s.volume,
                      value: measure === "volume" ? s.volume : s.count,
                    }))}
                    margin={{ top: 24, right: 24, left: 8, bottom: 24 }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      className="stroke-slate-200 dark:stroke-slate-700"
                    />
                    <XAxis
                      type="number"
                      dataKey="value"
                      tick={{ fontSize: 12 }}
                      tickFormatter={
                        measure === "volume"
                          ? (v: number) =>
                              v >= 1e6
                                ? `$${(v / 1e6).toFixed(1)}M`
                                : v >= 1e3
                                  ? `$${(v / 1e3).toFixed(0)}K`
                                  : `$${v.toFixed(0)}`
                          : undefined
                      }
                    />
                    <YAxis type="category" dataKey="name" width={140} tick={{ fontSize: 12 }} />
                    <Tooltip
                      formatter={
                        measure === "volume"
                          ? (v: number) => [
                              "$" +
                                (v >= 1e6
                                  ? (v / 1e6).toFixed(2) + "M"
                                  : v >= 1e3
                                    ? (v / 1e3).toFixed(2) + "K"
                                    : v.toLocaleString()),
                              "Volume",
                            ]
                          : undefined
                      }
                    />
                    <Bar
                      dataKey="value"
                      radius={[0, 4, 4, 0]}
                      name={measure === "volume" ? "Volume" : "Units"}
                      stroke="none"
                      onClick={(payload: { name?: string }) => {
                        if (payload?.name != null) {
                          setSelectedStatus((prev) =>
                            prev === payload.name ? null : payload.name
                          );
                        }
                      }}
                      cursor="pointer"
                    >
                      {data.statusCounts.map((_, index) => (
                        <Cell
                          key={index}
                          fill={
                            [
                              "#006980",
                              "#4096A8",
                              "#82C4CC",
                              "#A9DBE0",
                              "#D0ECEF",
                            ][Math.min(index, 4)] ?? "#D0ECEF"
                          }
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-full text-slate-500 text-sm">
                  No status data
                </div>
              )}
            </div>
          </CardContent>
        </Card>
        <Card className="border border-slate-200 dark:border-slate-700">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold">KPIs</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
              </div>
            ) : data?.kpis ? (
              <div className="grid grid-cols-2 gap-3">
                {[
                  {
                    label: "Units",
                    value: data.kpis.units.toLocaleString(),
                  },
                  {
                    label: "Volume",
                    value:
                      "$" +
                      (data.kpis.volume >= 1e9
                        ? (data.kpis.volume / 1e9).toFixed(2) + "B"
                        : data.kpis.volume >= 1e6
                          ? (data.kpis.volume / 1e6).toFixed(2) + "M"
                          : data.kpis.volume >= 1e3
                            ? (data.kpis.volume / 1e3).toFixed(0) + "K"
                            : data.kpis.volume.toFixed(0)),
                  },
                  {
                    label: "Average Balance",
                    value:
                      "$" +
                      (data.kpis.averageBalance >= 1e6
                        ? (data.kpis.averageBalance / 1e6).toFixed(2) + "M"
                        : data.kpis.averageBalance >= 1e3
                          ? (data.kpis.averageBalance / 1e3).toFixed(0) + "K"
                          : data.kpis.averageBalance.toFixed(0)),
                  },
                  {
                    label: "WAC",
                    value:
                      data.kpis.wac != null
                        ? data.kpis.wac.toFixed(3)
                        : "—",
                  },
                  {
                    label: "WAM",
                    value:
                      data.kpis.wam != null ? data.kpis.wam.toFixed(1) : "—",
                  },
                  {
                    label: "WA FICO",
                    value:
                      data.kpis.waFico != null
                        ? data.kpis.waFico.toFixed(1)
                        : "—",
                  },
                  {
                    label: "WA LTV",
                    value:
                      data.kpis.waLtv != null
                        ? data.kpis.waLtv.toFixed(1) + "%"
                        : "—",
                  },
                  {
                    label: "WA DTI",
                    value:
                      data.kpis.waDti != null
                        ? data.kpis.waDti.toFixed(1) + "%"
                        : "—",
                  },
                ].map((item) => (
                  <div
                    key={item.label}
                    className="flex flex-col items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/30 p-3 min-h-[72px] text-center"
                  >
                    <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">
                      {item.label}
                    </p>
                    <p className="text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                      {item.value}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-500">No KPI data</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* 4 Actor tables */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {[0, 1, 2, 3].map((index) => (
          <ActorsTableCard
            key={index}
            index={index}
            dimension={tableDimensions[index]}
            dimensionLabel={DIMENSION_LABELS[tableDimensions[index]]}
            onDimensionChange={(v) => updateTableDimension(index, v)}
            dimensionOptions={DIMENSION_OPTIONS}
            tableData={data?.tables?.[index]}
            loading={loading}
            searchQuery={searchQueries[index]}
            onSearchChange={(v) => setSearchQuery(index, v)}
            onRowClick={(name) =>
              setSelectedActor({ type: tableDimensions[index], name })
            }
            turnTimeLabel={
              calculation === "median"
                ? turnTimeType === "app_to_fund_days"
                  ? "Median App to Fund"
                  : "Median App to Closing"
                : turnTimeType === "app_to_fund_days"
                  ? "Avg App to Fund"
                  : "Avg App to Closing"
            }
          />
        ))}
      </div>
    </div>
  );
}

interface ActorsTableCardProps {
  index: number;
  dimension: ActorDimension;
  dimensionLabel: string;
  onDimensionChange: (v: ActorDimension) => void;
  dimensionOptions: ActorDimension[];
  tableData: ActorsTableResult | undefined;
  loading: boolean;
  searchQuery: string;
  onSearchChange: (v: string) => void;
  onRowClick: (name: string) => void;
  turnTimeLabel: string;
}

type ActorTableSortKey =
  | "name"
  | "units"
  | "volume"
  | "avgAppToFund"
  | "approvalPct"
  | "deniedPct"
  | "withdrawnPct"
  | "loanComplexity";

function getActorSortValue(row: ActorRow, key: ActorTableSortKey): number | string | null {
  switch (key) {
    case "name":
      return row.name?.trim() ?? "";
    case "units":
      return row.units;
    case "volume":
      return row.volume;
    case "avgAppToFund":
      return row.avgAppToFund ?? null;
    case "approvalPct":
      return row.approvalPct;
    case "deniedPct":
      return row.deniedPct;
    case "withdrawnPct":
      return row.withdrawnPct;
    case "loanComplexity":
      return row.loanComplexity ?? null;
    default:
      return null;
  }
}

function sortActorRows(
  rows: ActorRow[],
  key: ActorTableSortKey,
  direction: "asc" | "desc"
): ActorRow[] {
  const mult = direction === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const va = getActorSortValue(a, key);
    const vb = getActorSortValue(b, key);
    const aNull = va === null || va === "";
    const bNull = vb === null || vb === "";
    if (aNull && bNull) return 0;
    if (aNull) return mult * 1;
    if (bNull) return mult * -1;
    if (typeof va === "number" && typeof vb === "number") return mult * (va - vb);
    return mult * String(va).localeCompare(String(vb), undefined, { numeric: true });
  });
}

function ActorsTableCard({
  dimension,
  dimensionLabel,
  onDimensionChange,
  dimensionOptions,
  tableData,
  loading,
  searchQuery,
  onSearchChange,
  onRowClick,
  turnTimeLabel,
}: ActorsTableCardProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const [sortColumnId, setSortColumnId] = useState<ActorTableSortKey>("units");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");

  const filteredRows = useMemo(() => {
    if (!tableData?.rows) return [];
    if (!searchQuery.trim()) return tableData.rows;
    const q = searchQuery.trim().toLowerCase();
    return tableData.rows.filter((r) => r.name.toLowerCase().includes(q));
  }, [tableData?.rows, searchQuery]);

  const sortedRows = useMemo(
    () => sortActorRows(filteredRows, sortColumnId, sortDirection),
    [filteredRows, sortColumnId, sortDirection]
  );

  const handleSort = useCallback((columnId: ActorTableSortKey) => {
    setSortColumnId((prev) => {
      if (prev === columnId) {
        setSortDirection((d) => (d === "asc" ? "desc" : "asc"));
        return prev;
      }
      setSortDirection("desc");
      return columnId;
    });
  }, []);

  const totals = tableData?.totals;
  const avgTurnTime = totals?.avgAppToFund ?? null;
  const avgApproval = totals?.approvalPct ?? 0;
  const avgDenied = totals?.deniedPct ?? 0;
  const avgWithdrawn = totals?.withdrawnPct ?? 0;

  const formatVolume = (n: number) => {
    if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
    if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
    return `$${n.toFixed(0)}`;
  };

  const headerColumns: { id: ActorTableSortKey; label: string; align: "left" | "right" }[] = [
    { id: "name", label: "Actor", align: "left" },
    { id: "units", label: "Units", align: "right" },
    { id: "volume", label: "Volume", align: "right" },
    { id: "avgAppToFund", label: turnTimeLabel, align: "right" },
    { id: "approvalPct", label: "Approval %", align: "right" },
    { id: "deniedPct", label: "Denied %", align: "right" },
    { id: "withdrawnPct", label: "Withdrawn %", align: "right" },
    { id: "loanComplexity", label: "Complexity", align: "right" },
  ];

  const exportToCsv = useCallback(() => {
    const escapeCsv = (v: string | number | null | undefined) => {
      const raw = String(v ?? "");
      const s = raw.replace(/\u2014|\u2013/g, "-"); // Use ASCII hyphen for CSV/Excel compatibility
      if (s.includes(",") || s.includes('"') || s.includes("\n")) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };
    const rows: string[][] = [];
    rows.push(headerColumns.map((c) => escapeCsv(c.label)));
    if (totals) {
      rows.push([
        escapeCsv("Totals"),
        escapeCsv(totals.units),
        escapeCsv(formatVolume(totals.volume)),
        escapeCsv(totals.avgAppToFund != null ? totals.avgAppToFund.toFixed(2) : "-"),
        escapeCsv(totals.approvalPct.toFixed(1) + "%"),
        escapeCsv(totals.deniedPct.toFixed(1) + "%"),
        escapeCsv(totals.withdrawnPct.toFixed(1) + "%"),
        escapeCsv(totals.loanComplexity != null ? totals.loanComplexity.toFixed(1) : "-"),
      ]);
    }
    sortedRows.forEach((row) => {
      rows.push([
        escapeCsv(row.name),
        escapeCsv(row.units),
        escapeCsv(formatVolume(row.volume)),
        escapeCsv(row.avgAppToFund != null ? row.avgAppToFund.toFixed(2) : "-"),
        escapeCsv(row.approvalPct.toFixed(1) + "%"),
        escapeCsv(row.deniedPct.toFixed(1) + "%"),
        escapeCsv(row.withdrawnPct.toFixed(1) + "%"),
        escapeCsv(row.loanComplexity != null ? row.loanComplexity.toFixed(1) : "-"),
      ]);
    });
    const csv = rows.map((row) => row.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    const safeLabel = dimensionLabel.replace(/[^a-z0-9]/gi, "-").toLowerCase();
    link.download = `actors-${safeLabel}-${new Date().toISOString().split("T")[0]}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  }, [totals, sortedRows, dimensionLabel, headerColumns]);

  return (
    <>
    <Card className="border border-slate-200 dark:border-slate-700">
      <CardHeader className="pb-2 flex flex-row items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Select
            value={dimension}
            onValueChange={(v) => onDimensionChange(v as ActorDimension)}
          >
            <SelectTrigger className="w-[180px] h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {dimensionOptions.map((d) => (
                <SelectItem key={d} value={d}>
                  {DIMENSION_LABELS[d]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className="flex items-center w-[160px] rounded-md border border-input bg-background pl-2 pr-2">
            <Search className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
            <input
              type="text"
              placeholder={`Search ${dimensionLabel}...`}
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              className="h-8 flex-1 min-w-0 bg-transparent text-sm border-0 focus:outline-none focus:ring-0"
            />
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0 text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
            onClick={exportToCsv}
            disabled={!tableData?.rows?.length}
            aria-label="Export table to CSV"
          >
            <Download className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0 text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
            onClick={() => setModalOpen(true)}
            aria-label="Open table in full screen"
          >
            <Maximize2 className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="h-[320px] overflow-auto overflow-x-auto border-t border-slate-200 dark:border-slate-700">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="sticky top-0 z-10 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800">
                {headerColumns.map((col) => {
                  const isSorted = sortColumnId === col.id;
                  return (
                    <th
                      key={col.id}
                      className={cn(
                        "py-2 px-3 font-medium cursor-pointer select-none hover:bg-slate-100 dark:hover:bg-slate-700/50 transition-colors",
                        col.align === "right" ? "text-right" : "text-left"
                      )}
                      onClick={() => handleSort(col.id)}
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
              {loading ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-slate-500">
                    <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />
                    Loading...
                  </td>
                </tr>
              ) : sortedRows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-6 text-center text-slate-500">
                    No data
                  </td>
                </tr>
              ) : (
                <>
                  {totals && (
                    <tr className="bg-slate-50 dark:bg-slate-800 font-medium border-b border-slate-200 dark:border-slate-700">
                      <td className="py-2 px-3">Totals</td>
                      <td className="text-right py-2 px-3">{totals.units}</td>
                      <td className="text-right py-2 px-3">
                        {formatVolume(totals.volume)}
                      </td>
                      <td className="text-right py-2 px-3">
                        {totals.avgAppToFund != null
                          ? totals.avgAppToFund.toFixed(2)
                          : "—"}
                      </td>
                      <td className="text-right py-2 px-3">
                        {totals.approvalPct.toFixed(1)}%
                      </td>
                      <td className="text-right py-2 px-3">
                        {totals.deniedPct.toFixed(1)}%
                      </td>
                      <td className="text-right py-2 px-3">
                        {totals.withdrawnPct.toFixed(1)}%
                      </td>
                      <td className="text-right py-2 px-3">
                        {totals.loanComplexity != null
                          ? totals.loanComplexity.toFixed(1)
                          : "—"}
                      </td>
                    </tr>
                  )}
                  {sortedRows.map((row) => (
                    <tr
                      key={row.name}
                      className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50/50 dark:hover:bg-slate-800/30 cursor-pointer"
                      onClick={() => onRowClick(row.name)}
                    >
                      <td className="py-2 px-3 font-medium">{row.name}</td>
                      <td className="text-right py-2 px-3">{row.units}</td>
                      <td className="text-right py-2 px-3">
                        {formatVolume(row.volume)}
                      </td>
                      <td
                        className={cn(
                          "text-right py-2 px-3",
                          row.avgAppToFund != null && avgTurnTime != null && (
                            row.avgAppToFund <= avgTurnTime
                              ? "bg-amber-100 dark:bg-amber-900/30"
                              : "bg-[#ff6900]/25 dark:bg-[#ff6900]/30"
                          )
                        )}
                      >
                        {row.avgAppToFund != null ? (
                          <>
                            {row.avgAppToFund.toFixed(2)}
                            {avgTurnTime != null &&
                              (row.avgAppToFund <= avgTurnTime ? " ★" : " !")}
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td
                        className={cn(
                          "text-right py-2 px-3",
                          row.approvalPct >= avgApproval
                            ? "bg-emerald-100 dark:bg-emerald-900/30"
                            : "bg-red-100 dark:bg-red-900/30"
                        )}
                      >
                        {row.approvalPct.toFixed(1)}%
                      </td>
                      <td
                        className={cn(
                          "text-right py-2 px-3",
                          row.deniedPct <= avgDenied
                            ? "bg-emerald-100 dark:bg-emerald-900/30"
                            : "bg-red-100 dark:bg-red-900/30"
                        )}
                      >
                        {row.deniedPct.toFixed(1)}%
                      </td>
                      <td
                        className={cn(
                          "text-right py-2 px-3",
                          row.withdrawnPct <= avgWithdrawn
                            ? "bg-emerald-100 dark:bg-emerald-900/30"
                            : "bg-red-100 dark:bg-red-900/30"
                        )}
                      >
                        {row.withdrawnPct.toFixed(1)}%
                      </td>
                      <td className="text-right py-2 px-3">
                        {row.loanComplexity != null
                          ? row.loanComplexity.toFixed(1)
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </>
              )}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>

    <Dialog open={modalOpen} onOpenChange={setModalOpen}>
      <DialogContent
        className="max-w-[95vw] w-full max-h-[90vh] flex flex-col gap-0 p-0"
        hideCloseButton={false}
      >
        <DialogHeader className="px-6 pt-6 pb-2">
          <DialogTitle>{dimensionLabel} — Full screen</DialogTitle>
        </DialogHeader>
        <div className="flex-1 min-h-0 overflow-auto px-6 pb-6">
          <div className="overflow-auto border rounded-lg border-slate-200 dark:border-slate-700">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800">
                  {headerColumns.map((col) => {
                    const isSorted = sortColumnId === col.id;
                    return (
                      <th
                        key={col.id}
                        className={cn(
                          "py-2 px-3 font-medium cursor-pointer select-none hover:bg-slate-100 dark:hover:bg-slate-700/50 transition-colors",
                          col.align === "right" ? "text-right" : "text-left"
                        )}
                        onClick={() => handleSort(col.id)}
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
                {loading ? (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-slate-500">
                      <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />
                      Loading...
                    </td>
                  </tr>
                ) : sortedRows.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-6 text-center text-slate-500">
                      No data
                    </td>
                  </tr>
                ) : (
                  <>
                    {totals && (
                      <tr className="bg-slate-50 dark:bg-slate-800 font-medium border-b border-slate-200 dark:border-slate-700">
                        <td className="py-2 px-3">Totals</td>
                        <td className="text-right py-2 px-3">{totals.units}</td>
                        <td className="text-right py-2 px-3">
                          {formatVolume(totals.volume)}
                        </td>
                        <td className="text-right py-2 px-3">
                          {totals.avgAppToFund != null
                            ? totals.avgAppToFund.toFixed(2)
                            : "—"}
                        </td>
                        <td className="text-right py-2 px-3">
                          {totals.approvalPct.toFixed(1)}%
                        </td>
                        <td className="text-right py-2 px-3">
                          {totals.deniedPct.toFixed(1)}%
                        </td>
                        <td className="text-right py-2 px-3">
                          {totals.withdrawnPct.toFixed(1)}%
                        </td>
                        <td className="text-right py-2 px-3">
                          {totals.loanComplexity != null
                            ? totals.loanComplexity.toFixed(1)
                            : "—"}
                        </td>
                      </tr>
                    )}
                    {sortedRows.map((row) => (
                      <tr
                        key={row.name}
                        className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50/50 dark:hover:bg-slate-800/30 cursor-pointer"
                        onClick={() => {
                          onRowClick(row.name);
                          setModalOpen(false);
                        }}
                      >
                        <td className="py-2 px-3 font-medium">{row.name}</td>
                        <td className="text-right py-2 px-3">{row.units}</td>
                        <td className="text-right py-2 px-3">
                          {formatVolume(row.volume)}
                        </td>
                        <td
                        className={cn(
                          "text-right py-2 px-3",
                          row.avgAppToFund != null && avgTurnTime != null && (
                            row.avgAppToFund <= avgTurnTime
                              ? "bg-amber-100 dark:bg-amber-900/30"
                              : "bg-[#ff6900]/25 dark:bg-[#ff6900]/30"
                            )
                          )}
                        >
                          {row.avgAppToFund != null ? (
                            <>
                              {row.avgAppToFund.toFixed(2)}
                              {avgTurnTime != null &&
                                (row.avgAppToFund <= avgTurnTime ? " ★" : " !")}
                            </>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td
                          className={cn(
                            "text-right py-2 px-3",
                            row.approvalPct >= avgApproval
                              ? "bg-emerald-100 dark:bg-emerald-900/30"
                              : "bg-red-100 dark:bg-red-900/30"
                          )}
                        >
                          {row.approvalPct.toFixed(1)}%
                        </td>
                        <td
                          className={cn(
                            "text-right py-2 px-3",
                            row.deniedPct <= avgDenied
                              ? "bg-emerald-100 dark:bg-emerald-900/30"
                              : "bg-red-100 dark:bg-red-900/30"
                          )}
                        >
                          {row.deniedPct.toFixed(1)}%
                        </td>
                        <td
                          className={cn(
                            "text-right py-2 px-3",
                            row.withdrawnPct <= avgWithdrawn
                              ? "bg-emerald-100 dark:bg-emerald-900/30"
                              : "bg-red-100 dark:bg-red-900/30"
                          )}
                        >
                          {row.withdrawnPct.toFixed(1)}%
                        </td>
                        <td className="text-right py-2 px-3">
                          {row.loanComplexity != null
                            ? row.loanComplexity.toFixed(1)
                            : "—"}
                        </td>
                      </tr>
                    ))}
                  </>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  </>
  );
}
