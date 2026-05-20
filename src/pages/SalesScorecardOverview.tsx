import React, { useState, useMemo, useCallback, useEffect } from "react";
import { TopTieringLayout } from "@/components/layout/TopTieringLayout";
import { TopTieringPageFrame } from "@/components/layout/TopTieringPageFrame";
import { TopTieringTopBar } from "@/components/layout/TopTieringTopBar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import {
  useSalesScorecardOverviewData,
  type SalesScorecardOverviewMeasure,
  type SalesScorecardOverviewTimeMeasure,
} from "@/hooks/useSalesScorecardOverviewData";
import { DatePeriodPicker } from "@/components/ui/DatePeriodPicker";
import type { PeriodSelection, PeriodPreset } from "@/components/ui/DatePeriodPicker";
import { computePresetDateRange } from "@/components/ui/DatePeriodPicker";
import { useTenantStore } from "@/stores/tenantStore";
import { useAuth } from "@/contexts/AuthContext";
import { Loader2, CalendarDays } from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { useWorkflowMilestones } from "@/hooks/useWorkflowMilestones";
import {
  SalesScorecardMilestoneDatesModal,
  DEFAULT_SALES_SCORECARD_MILESTONE_COLUMNS,
  MAX_MILESTONE_DATES,
} from "@/components/widgets/components/SalesScorecardMilestoneDatesModal";
import { useSalesScorecardOverviewMilestoneDates } from "@/hooks/useSalesScorecardOverviewMilestoneDates";

const MEASURE_OPTIONS: { value: SalesScorecardOverviewMeasure; label: string }[] = [
  { value: "volume", label: "Volume" },
  { value: "units", label: "Units" },
];

const TIME_MEASURE_OPTIONS: { value: SalesScorecardOverviewTimeMeasure; label: string }[] = [
  { value: "quarterly", label: "Quarterly" },
  { value: "monthly", label: "Monthly" },
  { value: "weekly", label: "Weekly" },
  { value: "daily", label: "Daily" },
];

const PERIOD_PRESETS: PeriodPreset[] = [
  "mtd",
  "last-month",
  "qtd",
  "last-quarter",
  "ytd",
  "last-year",
];

const PERIOD_LABELS: Record<string, string> = {
  mtd: "MTD",
  "last-month": "LM",
  qtd: "QTD",
  "last-quarter": "LQ",
  ytd: "YTD",
  "last-year": "LY",
};

function getPeriodLabel(selection: PeriodSelection): string {
  if (selection.type === "custom") return "Custom";
  return selection.preset ? PERIOD_LABELS[selection.preset] ?? "Custom" : "Custom";
}

const STAGE_COLORS: Record<string, string> = {
  started_date: "#1e3a5f",
  application_date: "#3b82f6",
  lock_date: "#15803d",
  closing_date: "#fcd703",
  funding_date: "#fc5c17",
};
const FALLBACK_COLORS = ["#6366f1", "#8b5cf6", "#a855f7", "#d946ef", "#ec4899", "#f43f5e", "#14b8a6", "#0ea5e9"];
function getColorForColumn(column: string, index: number): string {
  return STAGE_COLORS[column] ?? FALLBACK_COLORS[index % FALLBACK_COLORS.length];
}

function formatValue(value: number | undefined | null, measure: SalesScorecardOverviewMeasure): string {
  const n = value != null && typeof value === "number" ? value : 0;
  if (measure === "volume") {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(2)}K`;
    return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  }
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function getMonthStartEnd(monthStr: string): { start: string; end: string } {
  const [y, m] = monthStr.split("-").map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    start: `${y}-${pad(m)}-01`,
    end: `${y}-${pad(m)}-${pad(lastDay)}`,
  };
}

function getQuarterStartEnd(quarterStr: string): { start: string; end: string } {
  const match = quarterStr.match(/^(\d{4})-Q([1-4])$/);
  if (!match) return { start: "", end: "" };
  const y = Number(match[1]);
  const q = Number(match[2]);
  const startMonth = (q - 1) * 3 + 1;
  const endMonth = q * 3;
  const lastDay = new Date(y, endMonth, 0).getDate();
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    start: `${y}-${pad(startMonth)}-01`,
    end: `${y}-${pad(endMonth)}-${pad(lastDay)}`,
  };
}

function getWeekStartEnd(weekStartStr: string): { start: string; end: string } {
  const d = new Date(weekStartStr + "T00:00:00");
  const end = new Date(d);
  end.setDate(end.getDate() + 6);
  const pad = (n: number) => String(n).padStart(2, "0");
  const fmt = (x: Date) => `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
  return { start: weekStartStr, end: fmt(end) };
}

function isMonthPeriodLabel(s: string): boolean {
  return /^\d{4}-\d{2}$/.test(s);
}
function isQuarterPeriodLabel(s: string): boolean {
  return /^\d{4}-Q[1-4]$/.test(s);
}
function isWeekPeriodLabel(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

const SalesScorecardOverview = () => {
  const { selectedTenantId } = useTenantStore();
  const { user } = useAuth();
  const tenantId = selectedTenantId || user?.tenant_id || null;

  const {
    milestoneColumns: selectedMilestoneColumns,
    setMilestoneColumns: setSelectedMilestoneColumns,
    persistMilestoneColumns,
    isLoading: milestoneColumnsLoading,
  } = useSalesScorecardOverviewMilestoneDates();

  const FILTERS_KEY = "cohi-sales-scorecard-overview-filters";
  const loadFilters = (): Partial<{
    measure: SalesScorecardOverviewMeasure;
    timeMeasure: SalesScorecardOverviewTimeMeasure;
    branch: string;
    loanOfficer: string;
    periodSelection: PeriodSelection;
  }> => {
    try {
      const raw = localStorage.getItem(FILTERS_KEY);
      if (!raw) return {};
      return JSON.parse(raw) as Partial<{
        measure: SalesScorecardOverviewMeasure;
        timeMeasure: SalesScorecardOverviewTimeMeasure;
        branch: string;
        loanOfficer: string;
        periodSelection: PeriodSelection;
      }>;
    } catch {
      return {};
    }
  };
  const savedFilters = loadFilters();
  const initialMeasure: SalesScorecardOverviewMeasure =
    savedFilters.measure === "volume" || savedFilters.measure === "units"
      ? savedFilters.measure
      : "volume";

  const [measure, setMeasure] = useState<SalesScorecardOverviewMeasure>(initialMeasure);
  const defaultPeriodSelection: PeriodSelection = useMemo(
    () => ({ type: "preset", preset: "ytd", dateRange: computePresetDateRange("ytd") }),
    []
  );
  const [periodSelection, setPeriodSelection] = useState<PeriodSelection>(
    savedFilters.periodSelection ?? defaultPeriodSelection
  );
  const [timeMeasure, setTimeMeasure] = useState<SalesScorecardOverviewTimeMeasure>(
    savedFilters.timeMeasure ?? "monthly"
  );
  const [branch, setBranch] = useState(savedFilters.branch ?? "");
  const [loanOfficer, setLoanOfficer] = useState(savedFilters.loanOfficer ?? "");
  const [milestoneDatesModalOpen, setMilestoneDatesModalOpen] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(
        FILTERS_KEY,
        JSON.stringify({
          measure,
          timeMeasure,
          branch,
          loanOfficer,
          periodSelection,
        })
      );
    } catch {
      // ignore
    }
  }, [measure, timeMeasure, branch, loanOfficer, periodSelection]);

  const filters = useMemo(
    () => ({
      measure,
      startDate: periodSelection.dateRange.start,
      endDate: periodSelection.dateRange.end,
      timeMeasure,
      branch,
      loanOfficer,
      milestoneColumns: selectedMilestoneColumns,
    }),
    [measure, periodSelection.dateRange, timeMeasure, branch, loanOfficer, selectedMilestoneColumns]
  );

  const { milestones } = useWorkflowMilestones(tenantId);
  const columnToLabel = useMemo(() => {
    const map: Record<string, string> = {};
    for (const m of milestones) map[m.column] = m.label;
    if (!map.started_date) map.started_date = "Started";
    if (!map.application_date) map.application_date = "Application";
    if (!map.lock_date) map.lock_date = "Locked";
    if (!map.closing_date) map.closing_date = "Closed";
    if (!map.funding_date) map.funding_date = "Funded";
    return map;
  }, [milestones]);

  const {
    rows,
    loading,
    error,
    branches,
    loanOfficers,
  } = useSalesScorecardOverviewData(filters, tenantId);

  const chartData = useMemo(
    () =>
      rows.map((r) => {
        const item: Record<string, string | number> = { period: r.periodLabel };
        for (const col of selectedMilestoneColumns.slice(0, MAX_MILESTONE_DATES)) {
          const label = columnToLabel[col] ?? col;
          item[label] = typeof r[col] === "number" ? r[col] : 0;
        }
        return item;
      }),
    [rows, selectedMilestoneColumns, columnToLabel]
  );

  const canDrillToWeek = timeMeasure === "monthly" || timeMeasure === "quarterly";
  const canDrillToDay = timeMeasure === "weekly";
  const handlePeriodClick = useCallback(
    (periodLabel: string) => {
      if (canDrillToWeek && isMonthPeriodLabel(periodLabel)) {
        const dateRange = getMonthStartEnd(periodLabel);
        setPeriodSelection({ type: "custom", dateRange });
        setTimeMeasure("weekly");
        return;
      }
      if (canDrillToWeek && isQuarterPeriodLabel(periodLabel)) {
        const dateRange = getQuarterStartEnd(periodLabel);
        setPeriodSelection({ type: "custom", dateRange });
        setTimeMeasure("weekly");
        return;
      }
      if (canDrillToDay && isWeekPeriodLabel(periodLabel)) {
        const dateRange = getWeekStartEnd(periodLabel);
        setPeriodSelection({ type: "custom", dateRange });
        setTimeMeasure("daily");
      }
    },
    [canDrillToWeek, canDrillToDay]
  );

  const handleBarClick = useCallback(
    (data: unknown, index?: number) => {
      if (!canDrillToWeek && !canDrillToDay) return;
      const raw = data as Record<string, unknown> | undefined;
      const payload = raw?.payload as Record<string, unknown> | undefined;
      const period =
        (typeof raw?.period === "string" ? raw.period : null) ??
        (typeof payload?.period === "string" ? payload.period : null) ??
        (typeof index === "number" && chartData[index]
          ? String(chartData[index].period)
          : null);
      if (period) handlePeriodClick(period);
    },
    [canDrillToWeek, canDrillToDay, handlePeriodClick, chartData]
  );

  return (
    <TopTieringLayout>
      <TopTieringPageFrame
        className="bg-gradient-to-br from-blue-50/30 via-white to-blue-50/20 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950/50 relative"
        topBar={
          <>
            <div
              className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(59,130,246,0.03),transparent_50%),radial-gradient(circle_at_80%_80%,rgba(168,85,247,0.02),transparent_50%)] pointer-events-none"
              aria-hidden
            />
            <TopTieringTopBar title="Sales Scorecard Overview" />
          </>
        }
      >
        <main className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 relative">
          <div className="max-w-[1400px] mx-auto space-y-4">
              {/* Filters */}
              <div className="flex flex-wrap items-end gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Measure</label>
                  <Select
                    value={measure}
                    onValueChange={(v) => setMeasure(v as SalesScorecardOverviewMeasure)}
                  >
                    <SelectTrigger className="w-[120px] bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700">
                      <SelectValue placeholder="Measure" />
                    </SelectTrigger>
                    <SelectContent>
                      {MEASURE_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Period</label>
                  <DatePeriodPicker
                    year={new Date().getFullYear()}
                    onYearChange={() => {}}
                    presets={PERIOD_PRESETS}
                    showYears={false}
                    onPeriodChange={setPeriodSelection}
                    periodSelectionFromStore={periodSelection}
                    defaultPreset="ytd"
                    showLabel={false}
                    size="sm"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Time measure</label>
                  <Select
                    value={timeMeasure}
                    onValueChange={(v) => setTimeMeasure(v as SalesScorecardOverviewTimeMeasure)}
                  >
                    <SelectTrigger className="w-[140px] bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700">
                      <SelectValue placeholder="Time measure" />
                    </SelectTrigger>
                    <SelectContent>
                      {TIME_MEASURE_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Branch</label>
                  <Select value={branch || "all"} onValueChange={(v) => setBranch(v === "all" ? "" : v)}>
                    <SelectTrigger className="w-[180px] bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700">
                      <SelectValue placeholder="Branch" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All branches</SelectItem>
                      {branches.map((b) => (
                        <SelectItem key={b} value={b}>
                          {b}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Loan Officer</label>
                  <Select
                    value={loanOfficer || "all"}
                    onValueChange={(v) => setLoanOfficer(v === "all" ? "" : v)}
                  >
                    <SelectTrigger className="w-[220px] bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700">
                      <SelectValue placeholder="Loan Officer" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All loan officers</SelectItem>
                      {loanOfficers.map((lo) => (
                        <SelectItem key={lo} value={lo}>
                          {lo}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex flex-col gap-1.5">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-9 gap-1.5"
                    onClick={() => setMilestoneDatesModalOpen(true)}
                  >
                    <CalendarDays className="h-4 w-4" />
                    Milestone Dates
                  </Button>
                </div>
              </div>

              {error && (
                <div className="rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-200 px-4 py-3 text-sm">
                  {error}
                </div>
              )}

              {loading ? (
                <div className="flex items-center justify-center py-16">
                  <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
                </div>
              ) : (
                <>
                  <div className="rounded-xl border border-slate-200/70 dark:border-slate-700/50 bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm shadow-sm overflow-hidden">
                    <div className="px-4 py-3 border-b border-slate-200/70 dark:border-slate-700/50">
                      <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                        Applications Taken, Closed Loans, Funded Loans by{" "}
                        {timeMeasure.charAt(0).toUpperCase() + timeMeasure.slice(1)} ({getPeriodLabel(periodSelection)})
                      </h2>
                      {chartData.length > 0 && (
                        <ul className="flex flex-wrap items-center justify-center gap-6 mt-2 text-xs text-slate-600 dark:text-slate-400 list-none p-0 m-0">
                          {selectedMilestoneColumns.slice(0, MAX_MILESTONE_DATES).map((col, idx) => (
                            <li key={col} className="flex items-center gap-1.5">
                              <span
                                className="inline-block w-3 h-3 rounded-sm shrink-0"
                                style={{ backgroundColor: getColorForColumn(col, idx) }}
                                aria-hidden
                              />
                              <span>{columnToLabel[col] ?? col}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                    <div className="p-4">
                      {chartData.length === 0 ? (
                        <p className="text-slate-500 dark:text-slate-400 text-center py-8">
                          No data for the selected filters.
                        </p>
                      ) : (
                        <ResponsiveContainer width="100%" height={400}>
                          <BarChart
                            data={chartData}
                            margin={{ top: 12, right: 12, left: 0, bottom: 8 }}
                          >
                            <CartesianGrid
                              strokeDasharray="3 3"
                              className="stroke-slate-200 dark:stroke-slate-700"
                            />
                            <XAxis
                              dataKey="period"
                              tick={{ fontSize: 11, fill: "currentColor" }}
                              className="text-slate-600 dark:text-slate-400"
                            />
                            <YAxis
                              tick={{ fontSize: 11, fill: "currentColor" }}
                              className="text-slate-600 dark:text-slate-400"
                              tickFormatter={(v) => formatValue(v, measure)}
                            />
                            <Tooltip
                              formatter={(value: number) => formatValue(value, measure)}
                              contentStyle={{
                                backgroundColor: "#ffffff",
                                border: "1px solid #e2e8f0",
                                borderRadius: "8px",
                                boxShadow: "0 1px 3px 0 rgb(0 0 0 / 0.08)",
                              }}
                            />
                            {selectedMilestoneColumns.slice(0, MAX_MILESTONE_DATES).map((col, idx) => {
                              const label = columnToLabel[col] ?? col;
                              return (
                                <Bar
                                  key={col}
                                  dataKey={label}
                                  fill={getColorForColumn(col, idx)}
                                  name={label}
                                  radius={[0, 2, 2, 0]}
                                  cursor={canDrillToWeek || canDrillToDay ? "pointer" : undefined}
                                  onClick={handleBarClick}
                                />
                              );
                            })}
                          </BarChart>
                        </ResponsiveContainer>
                      )}
                    </div>
                  </div>

                  {chartData.length > 0 && (
                    <div className="rounded-xl border border-slate-200/70 dark:border-slate-700/50 bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm shadow-sm overflow-hidden">
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-800/50">
                              <th className="text-left py-2.5 px-3 font-medium text-slate-700 dark:text-slate-300">
                                Period
                              </th>
                              {selectedMilestoneColumns.slice(0, MAX_MILESTONE_DATES).map((col) => (
                                <th
                                  key={col}
                                  className="text-right py-2.5 px-3 font-medium text-slate-700 dark:text-slate-300"
                                >
                                  {columnToLabel[col] ?? col}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {rows.map((r) => {
                              const isClickable =
                                (canDrillToWeek && (isMonthPeriodLabel(r.periodLabel) || isQuarterPeriodLabel(r.periodLabel))) ||
                                (canDrillToDay && isWeekPeriodLabel(r.periodLabel));
                              return (
                                <tr
                                  key={r.periodLabel}
                                  className={`border-b border-slate-100 dark:border-slate-800/80 hover:bg-slate-50/50 dark:hover:bg-slate-800/30 ${isClickable ? "cursor-pointer" : ""}`}
                                  onClick={() => isClickable && handlePeriodClick(r.periodLabel)}
                                  role={isClickable ? "button" : undefined}
                                  tabIndex={isClickable ? 0 : undefined}
                                  onKeyDown={(e) => isClickable && (e.key === "Enter" || e.key === " ") && handlePeriodClick(r.periodLabel)}
                                >
                                  <td className="py-2 px-3 text-slate-700 dark:text-slate-300 font-medium">
                                    {r.periodLabel}
                                  </td>
                                  {selectedMilestoneColumns.slice(0, MAX_MILESTONE_DATES).map((col) => (
                                    <td
                                      key={col}
                                      className="text-right py-2 px-3 text-slate-600 dark:text-slate-400 tabular-nums"
                                    >
                                      {formatValue(
                                        typeof r[col] === "number" ? r[col] : 0,
                                        measure
                                      )}
                                    </td>
                                  ))}
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </main>
      </TopTieringPageFrame>

      <SalesScorecardMilestoneDatesModal
        open={milestoneDatesModalOpen}
        onClose={() => setMilestoneDatesModalOpen(false)}
        selectedColumns={selectedMilestoneColumns}
        onSave={(cols) => {
          setSelectedMilestoneColumns(cols);
          persistMilestoneColumns(cols);
        }}
        tenantId={tenantId}
      />
    </TopTieringLayout>
  );
};

export default SalesScorecardOverview;
