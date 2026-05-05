/**
 * Loan Complexity workbench widgets: Pivot, Bar Chart, and Loan Detail Table.
 * Uses data from WidgetDataProvider (loan-complexity source); selection updates section filters.
 */

import React, { useState, useCallback, useEffect } from 'react';
import type { ComponentType } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  Cell,
} from 'recharts';
import { Loader2, ChevronDown, ChevronRight } from 'lucide-react';
import { useTheme } from '@/components/theme-provider';
import { cn } from '@/lib/utils';
import type { WidgetRenderProps } from './types';
import type { WidgetDefinition } from './types';
import type { PivotRowMetrics, PivotDimensionResult, LoanComplexityPivotData } from '@/hooks/useLoanComplexityPivot';
import type { LoanComplexityGroupLoanRow } from '@/hooks/useLoanComplexityGroupLoans';
import type { LoanComplexityGroupBy } from '@/hooks/useLoanComplexityData';

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "number") {
    if (Number.isInteger(value)) return String(value);
    return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  if (typeof value === "string") return value.trim() || "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

function formatVolume(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const n = Number(value);
  if (Number.isNaN(n)) return "—";
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function getComplexityCellStyle(score: number | null): { backgroundColor: string; color: string } | null {
  if (score === null || score === undefined) return null;
  if (score <= 100) return { backgroundColor: "#a8ccf0", color: "#000000" };
  if (score <= 115) return { backgroundColor: "#2f85da", color: "#ffffff" };
  return { backgroundColor: "#174d82", color: "#ffffff" };
}

function formatPct(value: number): string {
  return `${value.toFixed(1)}%`;
}

/** Delay showing the loading spinner to avoid flash on fast loads; reserve space immediately when loading. */
function useDelayedLoading(loading: boolean, delayMs = 140): boolean {
  const [showSpinner, setShowSpinner] = useState(false);
  useEffect(() => {
    if (!loading) {
      setShowSpinner(false);
      return undefined;
    }
    const t = setTimeout(() => setShowSpinner(true), delayMs);
    return () => clearTimeout(t);
  }, [loading, delayMs]);
  return showSpinner;
}

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
  const waStyle = getComplexityCellStyle(row.waComplexity);
  return (
    <>
      <td className={cellClass}>{row.units.toLocaleString()}</td>
      <td className={cellClass} style={waStyle ?? undefined}>
        {row.waComplexity != null ? row.waComplexity.toFixed(1) : "—"}
      </td>
      <td className={cellClass}>
        {row.timeInMotionDays != null ? row.timeInMotionDays.toFixed(1) : "—"}
      </td>
      {loanTypes.map((t) => (
        <td key={t} className={cellClass}>{formatPct(row.pctByType[t] ?? 0)}</td>
      ))}
      {purposes.map((p) => (
        <td key={p} className={cellClass}>{formatPct(row.pctByPurpose[p] ?? 0)}</td>
      ))}
      <td className={cellClass}>{formatPct(row.pctLocked)}</td>
      {showActive && <td className={cellClass}>{formatPct(row.pctActive)}</td>}
      {showOriginated && <td className={cellClass}>{formatPct(row.pctOriginated)}</td>}
      {showDenied && <td className={cellClass}>{formatPct(row.pctDenied)}</td>}
      {showWithdrawn && <td className={cellClass}>{formatPct(row.pctWithdrawn)}</td>}
    </>
  );
}

export type LoanComplexityEmbedVariant = 'pivot' | 'chart' | 'table';

export interface LoanComplexityEmbedConfig {
  variant?: LoanComplexityEmbedVariant;
  groupId?: string;
  /** Effective groupBy dimension (loan_officer, branch, etc.) for bar chart selection. */
  effectiveGroupBy?: LoanComplexityGroupBy;
  /** Called when user selects a group (bar or pivot row) to filter the loan table. */
  onSelectGroup?: (payload: { dimension: LoanComplexityGroupBy; groupName: string } | null) => void;
  /** Current loan status filter value for pivot column visibility (Non-active, Fallout, etc.). */
  currentLoanStatus?: string;
  /** Selected (dimension, groupName) pairs for cross-dimension filter and highlight. */
  selectedGroups?: { dimension: string; groupName: string }[];
  /** Selected group names (legacy single-dimension). Used when selectedGroups is empty. */
  selectedGroupNames?: string[];
  /** @deprecated use selectedGroups or selectedGroupNames */
  selectedGroupName?: string | null;
}

function LoanComplexityPivotWidget({
  data,
  loading,
  error,
  width,
  height,
  config,
}: WidgetRenderProps<LoanComplexityPivotData | null>) {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const showSpinner = useDelayedLoading(loading);
  const onSelectGroup = (config as LoanComplexityEmbedConfig)?.onSelectGroup;
  const currentStatus = ((config as LoanComplexityEmbedConfig)?.currentLoanStatus ?? 'All') as string;
  const selectedGroups = (config as LoanComplexityEmbedConfig)?.selectedGroups ?? [];
  const selectedGroupNamesLegacy = (config as LoanComplexityEmbedConfig)?.selectedGroupNames ?? [];
  const isSelected = (dimension: string, groupName: string) =>
    selectedGroups.some((g) => g.dimension === dimension && g.groupName === groupName) ||
    (selectedGroups.length === 0 && selectedGroupNamesLegacy.includes(groupName));
  const showActive = currentStatus === 'All';
  const showOriginated = currentStatus === 'All' || currentStatus === 'Non-active';
  const showDenied = currentStatus === 'All' || currentStatus === 'Non-active' || currentStatus === 'Fallout';
  const showWithdrawn = showDenied;

  const [expanded, setExpanded] = useState<string | null>(null);

  if (error) {
    return (
      <Card className="border border-slate-200 dark:border-slate-700 h-full">
        <CardContent className="flex items-center justify-center py-8 text-sm text-red-600 dark:text-red-400">
          {error}
        </CardContent>
      </Card>
    );
  }

  const hasData = data != null;
  const showLoadingPlaceholder = !hasData && loading;
  if (showLoadingPlaceholder) {
    const contentHeight = height != null ? Math.max(180, height - 100) : 280;
    return (
      <Card className="border border-slate-200 dark:border-slate-700 h-full flex flex-col min-h-0">
        <CardHeader className="pb-2 shrink-0">
          <CardTitle className="text-base font-semibold text-slate-900 dark:text-white">Loan Complexity Pivot</CardTitle>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Units, WA complexity, time in motion. Click a row to filter the loan table.</p>
        </CardHeader>
        <CardContent className="p-0 flex-1 min-h-0 flex items-center justify-center" style={{ minHeight: contentHeight }}>
          {showSpinner ? <Loader2 className="h-8 w-8 animate-spin text-slate-400" /> : null}
        </CardContent>
      </Card>
    );
  }

  if (!data) return null;

  const { dimensions, loanTypes, purposes } = data;
  if (dimensions.length === 0) {
    return (
      <Card className="border border-slate-200 dark:border-slate-700 h-full">
        <CardContent className="py-8 text-center text-slate-500 text-sm">
          No pivot data for the selected period and filters.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={cn("border overflow-hidden", isDark ? "border-slate-700 bg-slate-800/50" : "border-slate-200/60 bg-white")}>
      <CardHeader className="pb-2">
        <CardTitle className={cn("text-base font-semibold", isDark ? "text-white" : "text-slate-900")}>
          Loan Complexity Pivot
        </CardTitle>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
          Units, WA complexity, time in motion. Click a row to filter the loan table.
        </p>
      </CardHeader>
      <CardContent className="p-0">
        <div style={{ maxHeight: height ? Math.max(200, height - 120) : 400 }} className="overflow-auto border-t border-slate-200 dark:border-slate-700">
          <table className="w-full border-collapse text-sm">
            <thead className={cn("sticky top-0 z-10 border-b border-slate-200 dark:border-slate-700", isDark ? "bg-slate-800" : "bg-slate-50")}>
              <tr>
                <th className="text-left font-medium text-slate-600 dark:text-slate-400 px-3 py-2 whitespace-nowrap min-w-[120px]">Group</th>
                <th className="text-right font-medium text-slate-600 dark:text-slate-400 px-2 py-2 whitespace-nowrap">Units</th>
                <th className="text-right font-medium text-slate-600 dark:text-slate-400 px-2 py-2 whitespace-nowrap">WA Complexity</th>
                <th className="text-right font-medium text-slate-600 dark:text-slate-400 px-2 py-2 whitespace-nowrap">Time in Motion</th>
                {loanTypes.map((t) => (
                  <th key={t} className="text-right font-medium text-slate-600 dark:text-slate-400 px-2 py-2 whitespace-nowrap">% {t}</th>
                ))}
                {purposes.map((p) => (
                  <th key={p} className="text-right font-medium text-slate-600 dark:text-slate-400 px-2 py-2 whitespace-nowrap">% {p}</th>
                ))}
                <th className="text-right font-medium text-slate-600 dark:text-slate-400 px-2 py-2 whitespace-nowrap">% Locked</th>
                {showActive && <th className="text-right font-medium text-slate-600 dark:text-slate-400 px-2 py-2 whitespace-nowrap">% Active</th>}
                {showOriginated && <th className="text-right font-medium text-slate-600 dark:text-slate-400 px-2 py-2 whitespace-nowrap">% Originated</th>}
                {showDenied && (
                  <>
                    <th className="text-right font-medium text-slate-600 dark:text-slate-400 px-2 py-2 whitespace-nowrap">% Denied</th>
                    <th className="text-right font-medium text-slate-600 dark:text-slate-400 px-2 py-2 whitespace-nowrap">% Withdrawn</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {dimensions.map((dim: PivotDimensionResult) => (
                <React.Fragment key={dim.dimension}>
                  <tr
                    className="border-b border-slate-100 dark:border-slate-800 cursor-pointer hover:bg-slate-50/50 dark:hover:bg-slate-800/30"
                    onClick={() => setExpanded((prev) => (prev === dim.label ? null : dim.label))}
                  >
                    <td className="px-3 py-2 font-medium text-slate-700 dark:text-slate-300 whitespace-nowrap">
                      <span className="inline-flex items-center gap-1">
                        {expanded === dim.label ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
                        {dim.label}
                      </span>
                    </td>
                    <PivotCells row={dim.total} loanTypes={loanTypes} purposes={purposes} isDark={isDark} showActive={showActive} showOriginated={showOriginated} showDenied={showDenied} showWithdrawn={showWithdrawn} />
                  </tr>
                  {expanded === dim.label &&
                    dim.rows.map((row) => {
                      const rowSelected = isSelected(dim.dimension, row.groupName);
                      return (
                      <tr
                        key={row.groupName}
                        role="button"
                        tabIndex={0}
                        className={cn(
                          "border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50/50 dark:hover:bg-slate-800/30 cursor-pointer",
                          onSelectGroup && "hover:bg-sky-50/50 dark:hover:bg-sky-900/20",
                          rowSelected && "bg-blue-50/80 dark:bg-slate-700/60"
                        )}
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectGroup?.({ dimension: dim.dimension as LoanComplexityGroupBy, groupName: row.groupName });
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            onSelectGroup?.({ dimension: dim.dimension as LoanComplexityGroupBy, groupName: row.groupName });
                          }
                        }}
                      >
                        <td className={cn("pl-10 pr-3 py-1.5 whitespace-nowrap", rowSelected ? "text-sky-700 dark:text-sky-300 font-medium" : "text-slate-600 dark:text-slate-400")}>{row.groupName}</td>
                        <PivotCells row={row} loanTypes={loanTypes} purposes={purposes} isDark={isDark} showActive={showActive} showOriginated={showOriginated} showDenied={showDenied} showWithdrawn={showWithdrawn} />
                      </tr>
                    ); })}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

interface LoanComplexityBar {
  groupName: string;
  avgComplexity: number;
  loanCount: number;
}

function LoanComplexityChartWidget({
  data,
  loading,
  error,
  width,
  height,
  config,
}: WidgetRenderProps<LoanComplexityBar[]>) {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const showSpinner = useDelayedLoading(loading);
  const onSelectGroup = (config as LoanComplexityEmbedConfig)?.onSelectGroup;
  const effectiveGroupBy = (config as LoanComplexityEmbedConfig)?.effectiveGroupBy ?? 'loan_officer';
  const selectedGroups = (config as LoanComplexityEmbedConfig)?.selectedGroups ?? [];
  const selectedGroupNamesLegacy = (config as LoanComplexityEmbedConfig)?.selectedGroupNames ?? [];
  const isBarSelected = (groupName: string) =>
    selectedGroups.some((g) => g.dimension === effectiveGroupBy && g.groupName === groupName) ||
    (selectedGroups.length === 0 && selectedGroupNamesLegacy.includes(groupName));
  const bars = data ?? [];
  const hasData = bars.length > 0 || (data !== undefined && data !== null);
  const showLoadingPlaceholder = !hasData && loading;

  const colorScale = useCallback((val: number, isSelected: boolean) => {
    if (isSelected) return "#0ea5e9";
    if (val <= 100) return "#a8ccf0";
    if (val <= 115) return "#2f85da";
    return "#174d82";
  }, []);

  if (error) {
    return (
      <Card className="border border-slate-200 dark:border-slate-700 h-full">
        <CardContent className="flex items-center justify-center py-8 text-sm text-red-600 dark:text-red-400">{error}</CardContent>
      </Card>
    );
  }

  const chartAreaHeight = Math.max(280, (height ?? 400) - 140);

  if (showLoadingPlaceholder) {
    return (
      <Card className={cn("border overflow-hidden flex flex-col h-full min-h-0", isDark ? "border-slate-700 bg-slate-800/50" : "border-slate-200/60 bg-white")}>
        <CardHeader className="pb-2 shrink-0">
          <CardTitle className={cn("text-base font-semibold", isDark ? "text-white" : "text-slate-900")}>Average Loan Complexity</CardTitle>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Click a bar to filter the loan table to that group.</p>
        </CardHeader>
        <CardContent className="pb-4 flex-1 min-h-0 flex items-center justify-center" style={{ minHeight: chartAreaHeight }}>
          {showSpinner ? <Loader2 className="h-8 w-8 animate-spin text-sky-500" /> : null}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={cn("border overflow-hidden flex flex-col h-full min-h-0", isDark ? "border-slate-700 bg-slate-800/50" : "border-slate-200/60 bg-white")}>
      <CardHeader className="pb-2 shrink-0">
        <CardTitle className={cn("text-base font-semibold", isDark ? "text-white" : "text-slate-900")}>
          Average Loan Complexity
        </CardTitle>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
          Click a bar to filter the loan table to that group.
        </p>
      </CardHeader>
      <CardContent className="pb-4 flex-1 min-h-0 flex items-center justify-center" style={{ minHeight: chartAreaHeight }}>
        {bars.length === 0 ? (
          <p className="text-sm text-slate-500 py-8 text-center">No data for the selected period and filters.</p>
        ) : (
          <ResponsiveContainer width="100%" height={chartAreaHeight}>
            <BarChart data={bars} margin={{ top: 10, right: 20, left: 10, bottom: 60 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={isDark ? "#334155" : "#e2e8f0"} />
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
                label={{ value: "Avg complexity", angle: -90, position: "insideLeft", style: { fill: isDark ? "#94a3b8" : "#64748b", fontSize: 11 } }}
              />
              <RechartsTooltip
                contentStyle={{ backgroundColor: isDark ? "#1e293b" : "#ffffff", border: `1px solid ${isDark ? "#334155" : "#e2e8f0"}`, borderRadius: "8px", fontSize: 12 }}
                formatter={(value: number) => [value.toFixed(1), "Avg complexity"]}
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
                  const selected = isBarSelected(groupName);
                  const fill = colorScale(avgComplexity ?? 0, selected);
                  const content = (
                    <rect
                      x={x}
                      y={y}
                      width={Math.max(width, 4)}
                      height={Math.max(height ?? 0, 4)}
                      fill={fill}
                      rx={4}
                      ry={4}
                    />
                  );
                  if (!onSelectGroup) return <g>{content}</g>;
                  return (
                    <g
                      onClick={() => onSelectGroup({ dimension: effectiveGroupBy, groupName })}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          onSelectGroup({ dimension: effectiveGroupBy, groupName });
                        }
                      }}
                      role="button"
                      tabIndex={0}
                      style={{ cursor: "pointer" }}
                    >
                      {content}
                    </g>
                  );
                }}
              />
            </BarChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}

function LoanComplexityTableWidget({
  data,
  loading,
  error,
  width,
  height,
  config,
}: WidgetRenderProps<LoanComplexityGroupLoanRow[]>) {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const showSpinner = useDelayedLoading(loading);
  const configCast = config as LoanComplexityEmbedConfig;
  const selectedGroups = configCast?.selectedGroups ?? [];
  const selectedGroupNamesLegacy = configCast?.selectedGroupNames ?? [];
  const fallbackSingle = configCast?.selectedGroupName ?? null;
  const titleCount = selectedGroups.length > 0 ? selectedGroups.length : selectedGroupNamesLegacy.length || (fallbackSingle ? 1 : 0);
  const titleSingleName = selectedGroups.length === 1
    ? selectedGroups[0].groupName
    : selectedGroupNamesLegacy.length === 1
      ? selectedGroupNamesLegacy[0]
      : fallbackSingle ?? null;
  const loans = data ?? [];
  const hasData = data !== undefined && data !== null;
  const showLoadingPlaceholder = !hasData && loading;

  if (error) {
    return (
      <Card className="border border-slate-200 dark:border-slate-700 h-full">
        <CardContent className="flex items-center justify-center py-8 text-sm text-red-600 dark:text-red-400">{error}</CardContent>
      </Card>
    );
  }

  if (showLoadingPlaceholder) {
    const tableHeight = height != null ? Math.max(120, height - 100) : 200;
    return (
      <Card className={cn("border overflow-hidden flex flex-col h-full min-h-0", isDark ? "border-slate-700 bg-slate-800/50" : "border-slate-200/60 bg-white")}>
        <CardHeader className="pb-2 shrink-0">
          <CardTitle className={cn("text-base font-semibold", isDark ? "text-white" : "text-slate-900")}>Loan Details</CardTitle>
        </CardHeader>
        <CardContent className="p-0 flex-1 min-h-0 flex items-center justify-center" style={{ minHeight: tableHeight }}>
          {showSpinner ? <Loader2 className="h-8 w-8 animate-spin text-sky-500" /> : null}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card
      data-loan-details-table
      className={cn("border overflow-hidden flex flex-col h-full min-h-0", isDark ? "border-slate-700 bg-slate-800/50" : "border-slate-200/60 bg-white")}
    >
      <CardHeader className="pb-2 shrink-0">
        <CardTitle className={cn("text-base font-semibold", isDark ? "text-white" : "text-slate-900")}>
          {titleCount > 0
            ? titleCount === 1 && titleSingleName
              ? `Loan details — ${titleSingleName}`
              : `Loan details — ${titleCount} selected`
            : 'Loan Details'}
        </CardTitle>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 min-h-[1.25rem]">
          {loans.length === 0 ? 'No loans' : `${loans.length.toLocaleString()} loan${loans.length === 1 ? '' : 's'}`}
        </p>
      </CardHeader>
      <CardContent className="p-0 flex-1 min-h-0 flex flex-col">
        <div style={{ maxHeight: height ? Math.max(200, height - 100) : 360 }} className="overflow-auto border-t border-slate-200 dark:border-slate-700 flex-1 min-h-0">
            <table className="w-full border-collapse text-sm">
              <thead className={cn("sticky top-0 z-10 border-b border-slate-200 dark:border-slate-700", isDark ? "bg-slate-800" : "bg-slate-50")}>
                <tr>
                  {LOAN_DETAIL_COLUMNS.map((col) => (
                    <th key={col.key} className="text-left font-medium text-slate-600 dark:text-slate-400 px-3 py-2 whitespace-nowrap">
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loans.length === 0 ? (
                  <tr>
                    <td colSpan={LOAN_DETAIL_COLUMNS.length} className="px-3 py-6 text-center text-slate-500 dark:text-slate-400">
                      No loans found
                    </td>
                  </tr>
                ) : (
                  loans.map((row) => (
                    <tr key={row.loan_id} className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                      {LOAN_DETAIL_COLUMNS.map((col) => {
                        const isComplexity = col.key === "complexity_score";
                        const cellStyle = isComplexity ? getComplexityCellStyle(row.complexity_score) : undefined;
                        return (
                          <td key={col.key} className="px-3 py-2 whitespace-nowrap text-slate-700 dark:text-slate-300" style={cellStyle ?? undefined}>
                            {col.key === "loan_amount" ? formatVolume(row.loan_amount) : col.key === "complexity_score" ? (row.complexity_score != null ? row.complexity_score.toFixed(1) : "—") : formatCell(row[col.key])}
                          </td>
                        );
                      })}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
      </CardContent>
    </Card>
  );
}

export function LoanComplexityEmbed(props: WidgetRenderProps<unknown>) {
  const variant = ((props.config as LoanComplexityEmbedConfig)?.variant ?? 'pivot') as LoanComplexityEmbedVariant;
  if (variant === 'pivot') return <LoanComplexityPivotWidget {...(props as WidgetRenderProps<LoanComplexityPivotData | null>)} />;
  if (variant === 'chart') return <LoanComplexityChartWidget {...(props as WidgetRenderProps<LoanComplexityBar[]>)} />;
  return <LoanComplexityTableWidget {...(props as WidgetRenderProps<LoanComplexityGroupLoanRow[]>)} />;
}

// ---------------------------------------------------------------------------
// Widget definitions
// ---------------------------------------------------------------------------

function selectPivot(d: unknown): LoanComplexityPivotData | null {
  const src = d as { pivot?: LoanComplexityPivotData | null } | null;
  return src?.pivot ?? null;
}

function selectBars(d: unknown): LoanComplexityBar[] {
  const src = d as { bars?: LoanComplexityBar[] } | null;
  return src?.bars ?? [];
}

function selectLoans(d: unknown): LoanComplexityGroupLoanRow[] {
  const src = d as { loans?: LoanComplexityGroupLoanRow[] } | null;
  return src?.loans ?? [];
}

export const loanComplexityPivot: WidgetDefinition<LoanComplexityPivotData | null> = {
  id: 'loan-complexity-pivot',
  name: 'Loan Complexity Pivot',
  description: 'Pivot table by dimension with units, WA complexity, time in motion',
  category: 'table',
  group: 'Loan Complexity',
  dataSource: 'loan-complexity',
  dataSelector: selectPivot,
  defaultSize: { w: 24, h: 26 },
  minSize: { w: 18, h: 18 },
  config: { variant: 'pivot' },
  component: LoanComplexityEmbed as ComponentType<WidgetRenderProps<unknown>>,
};

export const loanComplexityChart: WidgetDefinition<LoanComplexityBar[]> = {
  id: 'loan-complexity-chart',
  name: 'Average Loan Complexity',
  description: 'Bar chart of average complexity by group; click to filter loan table',
  category: 'chart',
  group: 'Loan Complexity',
  dataSource: 'loan-complexity',
  dataSelector: selectBars,
  defaultSize: { w: 24, h: 28 },
  minSize: { w: 18, h: 20 },
  config: { variant: 'chart' },
  component: LoanComplexityEmbed as ComponentType<WidgetRenderProps<unknown>>,
};

export const loanComplexityTable: WidgetDefinition<LoanComplexityGroupLoanRow[]> = {
  id: 'loan-complexity-table',
  name: 'Loan Detail Table',
  description: 'Loan-level table; filters when you select a group in the pivot or chart',
  category: 'table',
  group: 'Loan Complexity',
  dataSource: 'loan-complexity',
  dataSelector: selectLoans,
  defaultSize: { w: 24, h: 24 },
  minSize: { w: 18, h: 16 },
  config: { variant: 'table' },
  component: LoanComplexityEmbed as ComponentType<WidgetRenderProps<unknown>>,
};

export const loanComplexityWidgets: WidgetDefinition[] = [
  loanComplexityPivot,
  loanComplexityChart,
  loanComplexityTable,
];
