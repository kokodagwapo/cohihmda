/**
 * SalesScorecardOverviewView – pipeline stage chart and table by period.
 * Can run standalone (local state) or embedded in workbench (reads group filters, supports drill-down via store).
 */

import React, { useMemo, useCallback } from "react";
import {
  useSalesScorecardOverviewData,
  type SalesScorecardOverviewMeasure,
  type SalesScorecardOverviewTimeMeasure,
} from "@/hooks/useSalesScorecardOverviewData";
import type { PeriodSelection, PeriodPreset } from "@/components/ui/DatePeriodPicker";
import { computePresetDateRange } from "@/components/ui/DatePeriodPicker";
import { useTenantStore } from "@/stores/tenantStore";
import { useWidgetSectionStore } from "@/stores/widgetSectionStore";
import { Loader2 } from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

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

const STAGE_COLORS = {
  started: "#1e3a5f",
  application: "#3b82f6",
  locked: "#15803d",
  closed: "#fcd703",
  funded: "#fc5c17",
};

function formatValue(value: number, measure: SalesScorecardOverviewMeasure): string {
  if (measure === "wa-interest-rate") {
    return `${Number(value).toFixed(2)}%`;
  }
  if (measure === "volume") {
    if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
    if (value >= 1_000) return `${(value / 1_000).toFixed(2)}K`;
    return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
  }
  return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
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

export interface SalesScorecardOverviewViewProps {
  embeddedInWorkbench?: boolean;
  groupId?: string | null;
  /** When set, render only the chart, only the table, or both (default). */
  variant?: "full" | "chart" | "table";
}

const defaultPeriodSelection: PeriodSelection = (() => {
  const range = computePresetDateRange("ytd");
  return { type: "preset", preset: "ytd", dateRange: range };
})();

export function SalesScorecardOverviewView({
  embeddedInWorkbench = false,
  groupId = null,
  variant = "full",
}: SalesScorecardOverviewViewProps) {
  const { selectedTenantId } = useTenantStore();
  const getFilters = useWidgetSectionStore((s) => s.getFilters);
  const updateFilters = useWidgetSectionStore((s) => s.updateFilters);

  const groupFilters = groupId ? getFilters(groupId) : null;

  const periodSelection: PeriodSelection =
    groupFilters?.periodSelection && (groupFilters.periodSelection as PeriodSelection).dateRange
      ? (groupFilters.periodSelection as PeriodSelection)
      : defaultPeriodSelection;
  const measure: SalesScorecardOverviewMeasure =
    (groupFilters?.salesScorecardOverviewMeasure as SalesScorecardOverviewMeasure) ?? "volume";
  const timeMeasure: SalesScorecardOverviewTimeMeasure =
    (groupFilters?.salesScorecardOverviewTimeMeasure as SalesScorecardOverviewTimeMeasure) ?? "monthly";
  const branch = groupFilters?.branch ?? "all";
  const loanOfficer = groupFilters?.loanOfficer ?? "all";

  const dimensionFilters = useMemo(() => {
    if (!groupFilters) return undefined;
    const dims: Array<{ column: string; value: string }> = [];
    if (groupFilters.branch && groupFilters.branch !== "all") {
      dims.push({ column: "branch", value: groupFilters.branch });
    }
    if (groupFilters.loanOfficer && groupFilters.loanOfficer !== "all") {
      dims.push({ column: "loan_officer", value: groupFilters.loanOfficer });
    }
    (groupFilters.dynamicFilters ?? []).forEach((df) => {
      if (df.value && df.value !== "all") dims.push({ column: df.column, value: df.value });
    });
    return dims.length > 0 ? dims : undefined;
  }, [
    groupFilters?.branch,
    groupFilters?.loanOfficer,
    groupFilters?.dynamicFilters,
  ]);

  const filters = useMemo(
    () => ({
      measure,
      startDate: periodSelection.dateRange?.start ?? "",
      endDate: periodSelection.dateRange?.end ?? "",
      timeMeasure,
      branch: branch === "all" ? "" : branch,
      loanOfficer: loanOfficer === "all" ? "" : loanOfficer,
      dimensionFilters,
    }),
    [measure, periodSelection.dateRange, timeMeasure, branch, loanOfficer, dimensionFilters]
  );

  const tenantId = selectedTenantId ?? null;
  const {
    rows,
    loading,
    error,
  } = useSalesScorecardOverviewData(filters, tenantId);

  const chartData = useMemo(
    () =>
      rows.map((r) => ({
        period: r.periodLabel,
        Started: r.started,
        Application: r.application,
        Locked: r.locked,
        Closed: r.closed,
        Funded: r.funded,
      })),
    [rows]
  );

  const canDrillToWeek = timeMeasure === "monthly" || timeMeasure === "quarterly";
  const canDrillToDay = timeMeasure === "weekly";

  const handlePeriodClick = useCallback(
    (periodLabel: string) => {
      if (groupId && updateFilters) {
        if (canDrillToWeek && isMonthPeriodLabel(periodLabel)) {
          const dateRange = getMonthStartEnd(periodLabel);
          updateFilters(groupId, {
            periodSelection: { type: "custom" as const, dateRange },
            dateRange,
            salesScorecardOverviewTimeMeasure: "weekly",
          });
          return;
        }
        if (canDrillToWeek && isQuarterPeriodLabel(periodLabel)) {
          const dateRange = getQuarterStartEnd(periodLabel);
          updateFilters(groupId, {
            periodSelection: { type: "custom" as const, dateRange },
            dateRange,
            salesScorecardOverviewTimeMeasure: "weekly",
          });
          return;
        }
        if (canDrillToDay && isWeekPeriodLabel(periodLabel)) {
          const dateRange = getWeekStartEnd(periodLabel);
          updateFilters(groupId, {
            periodSelection: { type: "custom" as const, dateRange },
            dateRange,
            salesScorecardOverviewTimeMeasure: "daily",
          });
        }
      }
    },
    [groupId, updateFilters, canDrillToWeek, canDrillToDay]
  );

  const handleBarClick = useCallback(
    (data: unknown, index?: number) => {
      if (!canDrillToWeek && !canDrillToDay) return;
      const raw = data as Record<string, unknown> | undefined;
      const payload = raw?.payload as Record<string, unknown> | undefined;
      const period =
        (typeof raw?.period === "string" ? raw.period : null) ??
        (typeof payload?.period === "string" ? payload.period : null) ??
        (typeof index === "number" && chartData[index] ? chartData[index].period : null);
      if (period) handlePeriodClick(period);
    },
    [canDrillToWeek, canDrillToDay, handlePeriodClick, chartData]
  );

  const compact = embeddedInWorkbench;
  const showChart = variant === "full" || variant === "chart";
  const showTable = variant === "full" || variant === "table";

  return (
    <div className={compact ? "space-y-3" : "space-y-4"}>
      {error && (
        <div className="rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-200 px-3 py-2 text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
        </div>
      ) : (
        <>
          {showChart && (
          <div
            className={
              compact
                ? "rounded-lg border border-slate-200/70 dark:border-slate-700/50 bg-white dark:bg-slate-900/80 overflow-hidden"
                : "rounded-xl border border-slate-200/70 dark:border-slate-700/50 bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm shadow-sm overflow-hidden"
            }
          >
            <div className={compact ? "px-3 py-2 border-b border-slate-200/70 dark:border-slate-700/50" : "px-4 py-3 border-b border-slate-200/70 dark:border-slate-700/50"}>
              <h2 className={compact ? "text-xs font-semibold text-slate-700 dark:text-slate-300" : "text-sm font-semibold text-slate-700 dark:text-slate-300"}>
                Applications Taken, Closed Loans, Funded Loans by {timeMeasure.charAt(0).toUpperCase() + timeMeasure.slice(1)} ({getPeriodLabel(periodSelection)})
              </h2>
              {chartData.length > 0 && (
                <ul className="flex flex-wrap items-center justify-center gap-4 mt-1.5 text-xs text-slate-600 dark:text-slate-400 list-none p-0 m-0">
                  <li className="flex items-center gap-1.5">
                    <span className="inline-block w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: STAGE_COLORS.started }} aria-hidden />
                    <span>Started</span>
                  </li>
                  <li className="flex items-center gap-1.5">
                    <span className="inline-block w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: STAGE_COLORS.application }} aria-hidden />
                    <span>Application</span>
                  </li>
                  <li className="flex items-center gap-1.5">
                    <span className="inline-block w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: STAGE_COLORS.locked }} aria-hidden />
                    <span>Locked</span>
                  </li>
                  <li className="flex items-center gap-1.5">
                    <span className="inline-block w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: STAGE_COLORS.closed }} aria-hidden />
                    <span>Closed</span>
                  </li>
                  <li className="flex items-center gap-1.5">
                    <span className="inline-block w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: STAGE_COLORS.funded }} aria-hidden />
                    <span>Funded</span>
                  </li>
                </ul>
              )}
            </div>
            <div className={compact ? "p-3" : "p-4"}>
              {chartData.length === 0 ? (
                <p className="text-slate-500 dark:text-slate-400 text-center py-6 text-sm">
                  No data for the selected filters.
                </p>
              ) : (
                <ResponsiveContainer width="100%" height={compact ? 280 : 400}>
                  <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-slate-200 dark:stroke-slate-700" />
                    <XAxis dataKey="period" tick={{ fontSize: 10, fill: "currentColor" }} className="text-slate-600 dark:text-slate-400" />
                    <YAxis tick={{ fontSize: 10, fill: "currentColor" }} className="text-slate-600 dark:text-slate-400" tickFormatter={(v) => formatValue(v, measure)} />
                    <Tooltip
                      formatter={(value: number) => formatValue(value, measure)}
                      contentStyle={{
                        backgroundColor: "#ffffff",
                        border: "1px solid #e2e8f0",
                        borderRadius: "8px",
                        boxShadow: "0 1px 3px 0 rgb(0 0 0 / 0.08)",
                      }}
                    />
                    <Bar dataKey="Started" fill={STAGE_COLORS.started} name="Started" radius={[0, 2, 2, 0]} cursor={canDrillToWeek || canDrillToDay ? "pointer" : undefined} onClick={handleBarClick} />
                    <Bar dataKey="Application" fill={STAGE_COLORS.application} name="Application" radius={[0, 2, 2, 0]} cursor={canDrillToWeek || canDrillToDay ? "pointer" : undefined} onClick={handleBarClick} />
                    <Bar dataKey="Locked" fill={STAGE_COLORS.locked} name="Locked" radius={[0, 2, 2, 0]} cursor={canDrillToWeek || canDrillToDay ? "pointer" : undefined} onClick={handleBarClick} />
                    <Bar dataKey="Closed" fill={STAGE_COLORS.closed} name="Closed" radius={[0, 2, 2, 0]} cursor={canDrillToWeek || canDrillToDay ? "pointer" : undefined} onClick={handleBarClick} />
                    <Bar dataKey="Funded" fill={STAGE_COLORS.funded} name="Funded" radius={[0, 2, 2, 0]} cursor={canDrillToWeek || canDrillToDay ? "pointer" : undefined} onClick={handleBarClick} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
          )}

          {showTable && (
            chartData.length > 0 ? (
            <div className={compact ? "rounded-lg border border-slate-200/70 dark:border-slate-700/50 bg-white dark:bg-slate-900/80 overflow-hidden" : "rounded-xl border border-slate-200/70 dark:border-slate-700/50 bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm shadow-sm overflow-hidden"}>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-800/50">
                      <th className="text-left py-2 px-2 font-medium text-slate-700 dark:text-slate-300 text-xs">Period</th>
                      <th className="text-right py-2 px-2 font-medium text-slate-700 dark:text-slate-300 text-xs">Started</th>
                      <th className="text-right py-2 px-2 font-medium text-slate-700 dark:text-slate-300 text-xs">Application</th>
                      <th className="text-right py-2 px-2 font-medium text-slate-700 dark:text-slate-300 text-xs">Locked</th>
                      <th className="text-right py-2 px-2 font-medium text-slate-700 dark:text-slate-300 text-xs">Closed</th>
                      <th className="text-right py-2 px-2 font-medium text-slate-700 dark:text-slate-300 text-xs">Funded</th>
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
                          className={`border-b border-slate-100 dark:border-slate-800/80 hover:bg-slate-50/50 dark:hover:bg-slate-800/30 text-xs ${isClickable ? "cursor-pointer" : ""}`}
                          onClick={() => isClickable && handlePeriodClick(r.periodLabel)}
                          role={isClickable ? "button" : undefined}
                          tabIndex={isClickable ? 0 : undefined}
                          onKeyDown={(e) => isClickable && (e.key === "Enter" || e.key === " ") && handlePeriodClick(r.periodLabel)}
                        >
                          <td className="py-1.5 px-2 text-slate-700 dark:text-slate-300 font-medium">{r.periodLabel}</td>
                          <td className="text-right py-1.5 px-2 text-slate-600 dark:text-slate-400 tabular-nums">{formatValue(r.started, measure)}</td>
                          <td className="text-right py-1.5 px-2 text-slate-600 dark:text-slate-400 tabular-nums">{formatValue(r.application, measure)}</td>
                          <td className="text-right py-1.5 px-2 text-slate-600 dark:text-slate-400 tabular-nums">{formatValue(r.locked, measure)}</td>
                          <td className="text-right py-1.5 px-2 text-slate-600 dark:text-slate-400 tabular-nums">{formatValue(r.closed, measure)}</td>
                          <td className="text-right py-1.5 px-2 text-slate-600 dark:text-slate-400 tabular-nums">{formatValue(r.funded, measure)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
            ) : (
              <div className={compact ? "rounded-lg border border-slate-200/70 dark:border-slate-700/50 bg-white dark:bg-slate-900/80 overflow-hidden p-4" : "rounded-xl border border-slate-200/70 dark:border-slate-700/50 bg-white/80 dark:bg-slate-900/80 p-4"}>
                <p className="text-slate-500 dark:text-slate-400 text-center py-6 text-sm">
                  No data for the selected filters.
                </p>
              </div>
            )
          )}
        </>
      )}
    </div>
  );
}
