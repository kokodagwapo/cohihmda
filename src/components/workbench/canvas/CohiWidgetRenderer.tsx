/**
 * CohiWidgetRenderer
 *
 * Renders a Cohi-generated widget on the canvas.
 * These widgets are backed by SQL queries that the LLM generated,
 * and use the standard Recharts-based visualization components.
 *
 * Includes a compact timeframe / date-field filter bar so the user
 * can re-scope the data range without re-prompting the LLM.
 */

import React, { useState, useMemo, useCallback, useEffect } from 'react';
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Treemap as RechartsTreemap,
} from 'recharts';
import {
  Loader2,
  AlertCircle,
  RefreshCw,
  Sparkles,
  BarChart3,
  Activity,
  PieChart as PieChartIcon,
  LayoutGrid,
  ChevronDown,
  ChevronRight,
  Calendar,
  Bookmark,
  BookmarkCheck,
  Trash2,
  SlidersHorizontal,
  X,
  Layers,
  GitBranch,
  TreePine,
  Table2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useCanvasDataStore } from '@/stores/canvasDataStore';
import { useCohiWidgetData, type DateFilter, type DimensionFilter } from '@/hooks/useCohiWidgetData';
import {
  computePresetDateRange,
  type PeriodPreset,
  type DateRange,
} from '@/components/ui/DatePeriodPicker';
import type { VisualizationConfig } from '@/hooks/useCohiChat';
import type { WidgetFilterState } from '@/components/workbench/canvas/types';
import { useFilterPresetStore, type FilterPreset } from '@/stores/filterPresetStore';
import { useTenantStore } from '@/stores/tenantStore';

// ---------------------------------------------------------------------------
// Stable empty array to avoid Zustand selector re-render loops
// ---------------------------------------------------------------------------

const EMPTY_FILTER_PRESETS: FilterPreset[] = [];

// ---------------------------------------------------------------------------
// Default colors
// ---------------------------------------------------------------------------

const COLORS = [
  '#6366f1', '#8b5cf6', '#a855f7', '#ec4899', '#f43f5e',
  '#f97316', '#eab308', '#22c55e', '#14b8a6', '#06b6d4',
  '#3b82f6', '#2563eb',
];

// ---------------------------------------------------------------------------
// Chart type options for switching
// ---------------------------------------------------------------------------

interface ChartTypeOption {
  type: VisualizationConfig['type'];
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
  /** Minimum requirements to show this option */
  needsMultiNumeric?: boolean;  // needs ≥2 numeric columns (stacked/grouped)
  needsNumeric?: boolean;       // needs ≥1 numeric column (all charts)
  needs3Cols?: boolean;         // needs ≥3 columns (pivot)
  maxRows?: number;             // max row count for sensible display (pie/treemap)
}

const ALL_CHART_TYPE_OPTIONS: ChartTypeOption[] = [
  { type: 'bar', label: 'Bar', Icon: BarChart3, needsNumeric: true },
  { type: 'stacked_bar', label: 'Stacked', Icon: Layers, needsMultiNumeric: true },
  { type: 'grouped_bar', label: 'Grouped', Icon: GitBranch, needsMultiNumeric: true },
  { type: 'line', label: 'Line', Icon: Activity, needsNumeric: true },
  { type: 'area', label: 'Area', Icon: BarChart3, needsNumeric: true },
  { type: 'horizontal_bar', label: 'H-Bar', Icon: BarChart3, needsNumeric: true },
  { type: 'pie', label: 'Pie', Icon: PieChartIcon, needsNumeric: true, maxRows: 20 },
  { type: 'donut', label: 'Donut', Icon: PieChartIcon, needsNumeric: true, maxRows: 20 },
  { type: 'treemap', label: 'Treemap', Icon: TreePine, needsNumeric: true, maxRows: 50 },
  { type: 'pivot', label: 'Pivot', Icon: Table2, needs3Cols: true },
  { type: 'kpi', label: 'KPI', Icon: BarChart3, needsNumeric: true },
  { type: 'table', label: 'Table', Icon: LayoutGrid },
];

/** Given actual data, return only the viz types that make sense. */
function getCompatibleChartTypes(chartData: any[]): ChartTypeOption[] {
  if (!chartData.length) return ALL_CHART_TYPE_OPTIONS; // no data yet, show all

  const cols = Object.keys(chartData[0]);
  const sampleRows = chartData.slice(0, Math.min(5, chartData.length));
  const numericCols = cols.filter((c) =>
    sampleRows.some((row) => typeof row[c] === 'number' && !isNaN(row[c])),
  );
  const numCols = cols.length;
  const numRows = chartData.length;

  return ALL_CHART_TYPE_OPTIONS.filter((opt) => {
    if (opt.needsMultiNumeric && numericCols.length < 2) return false;
    if (opt.needsNumeric && numericCols.length < 1) return false;
    if (opt.needs3Cols && numCols < 3) return false;
    if (opt.maxRows && numRows > opt.maxRows) return false;
    return true;
  });
}

// ---------------------------------------------------------------------------
// Timeframe presets – same set shown by WidgetGroup / DatePeriodPicker
// ---------------------------------------------------------------------------

const PERIOD_PRESETS: { preset: PeriodPreset; label: string; title: string }[] = [
  { preset: 'rolling-13', label: 'L13M', title: 'Rolling 13 months' },
  { preset: 'rolling-12', label: 'L12M', title: 'Rolling 12 months' },
  { preset: 'ytd', label: 'YTD', title: 'Year to date' },
  { preset: 'mtd', label: 'MTD', title: 'Month to date' },
  { preset: 'qtd', label: 'QTD', title: 'Quarter to date' },
  { preset: 'last-month', label: 'LM', title: 'Last month' },
  { preset: 'last-quarter', label: 'LQ', title: 'Last quarter' },
  { preset: 'last-year', label: 'LY', title: 'Last year' },
];

// Year buttons (current year backwards)
const YEAR_BUTTONS: number[] = (() => {
  const cur = new Date().getFullYear();
  return [cur, cur - 1, cur - 2, cur - 3];
})();

// Date field options – matches the WidgetGroup's set
const DATE_FIELD_OPTIONS = [
  { value: 'application_date', label: 'Application Date' },
  { value: 'funding_date', label: 'Funding Date' },
  { value: 'started_date', label: 'Started Date' },
  { value: 'closing_date', label: 'Closing Date' },
  { value: 'lock_date', label: 'Lock Date' },
];

// ---------------------------------------------------------------------------
// Detect plausible date columns from the SQL text
// ---------------------------------------------------------------------------

const KNOWN_DATE_COLS = [
  'application_date',
  'funding_date',
  'started_date',
  'closing_date',
  'lock_date',
  'created_at',
  'updated_at',
];

/**
 * Scan the SQL for known date column references and return them
 * in the order they appear.  The first match is the "best guess" default.
 */
function detectDateColumns(sql: string): string[] {
  const lowerSql = sql.toLowerCase();
  return KNOWN_DATE_COLS.filter((col) => lowerSql.includes(col));
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface CohiWidgetRendererProps {
  sql: string;
  vizConfig: VisualizationConfig;
  title: string;
  explanation?: string;
  tenantId?: string | null;
  width?: number;
  height?: number;
  /**
   * When the parent group has filterSync enabled, the group's date
   * filter is passed here.  The widget still shows its own filter bar
   * but reflects the synced state.
   */
  groupDateFilter?: DateFilter | null;
  /**
   * Dimension filters from the parent WidgetGroup (branch, loan officer, etc.).
   * Injected into the SQL WHERE clause on the server side.
   */
  groupDimensionFilters?: DimensionFilter[] | null;
  /**
   * Whether the parent group has filter sync enabled.
   * When true, the group's dateFilter takes precedence over local controls.
   * When false (or undefined), the widget uses its own independent filters.
   */
  filterSyncEnabled?: boolean;
  /**
   * Initial filter state to restore from persisted data.
   * Used when the widget has its own saved filter state.
   */
  initialFilters?: WidgetFilterState;
  /**
   * Called when the user changes filter state in this widget.
   * The parent should persist this in the widget's savedFilters field.
   */
  onFilterChange?: (filters: WidgetFilterState) => void;
  /** Called when the user changes the visualization type (bar, line, pie, etc.) */
  onVizTypeChange?: (type: VisualizationConfig['type']) => void;
  /** Canvas layout item ID – for reporting data to canvasDataStore */
  canvasItemId?: string;
  /**
   * When true, the title is hidden (because the parent GridCellWidget
   * already shows it in the drag handle).  Standalone widgets keep
   * the title visible.
   */
  hideTitle?: boolean;
}

// ---------------------------------------------------------------------------
// Smart key resolution – fixes empty charts when xKey/yKey don't match data
// ---------------------------------------------------------------------------

interface ResolvedKeys {
  xKey?: string;
  yKey?: string;
  yKeys?: string[];
  nameKey?: string;
  valueKey?: string;
}

/**
 * Recharts silently renders empty charts when `dataKey` doesn't match any
 * property in the data objects.  This function detects mismatches and
 * resolves keys via fuzzy matching + intelligent fallbacks.
 */
function resolveChartKeys(config: VisualizationConfig, chartData: any[]): ResolvedKeys {
  if (!chartData.length) {
    return {
      xKey: config.xKey,
      yKey: config.yKey,
      yKeys: config.yKeys,
      nameKey: config.nameKey,
      valueKey: config.valueKey,
    };
  }

  const cols = Object.keys(chartData[0]);
  const hasKey = (key?: string) => key != null && cols.includes(key);

  /** Case-insensitive, underscore/space-normalized fuzzy match */
  const fuzzyMatch = (key?: string): string | undefined => {
    if (!key) return undefined;
    const normalized = key.toLowerCase().replace(/[_\s]/g, '');
    return cols.find((c) => c.toLowerCase().replace(/[_\s]/g, '') === normalized);
  };

  // Classify columns by data type (sample first few rows for robustness)
  const sampleRows = chartData.slice(0, Math.min(5, chartData.length));
  const numericCols = cols.filter((c) =>
    sampleRows.some((row) => typeof row[c] === 'number' && !isNaN(row[c])),
  );
  const nonNumericCols = cols.filter((c) => !numericCols.includes(c));

  // Resolve xKey
  const xKey = hasKey(config.xKey)
    ? config.xKey!
    : fuzzyMatch(config.xKey) || nonNumericCols[0] || cols[0];

  // Resolve yKey (prefer the first numeric column that isn't the xKey)
  const yKey = hasKey(config.yKey)
    ? config.yKey!
    : fuzzyMatch(config.yKey) ||
      numericCols.find((c) => c !== xKey) ||
      cols.find((c) => c !== xKey);

  // Resolve yKeys (multi-series)
  let yKeys = config.yKeys
    ?.map((k) => (hasKey(k) ? k : fuzzyMatch(k)))
    .filter((k): k is string => k != null);
  if (yKeys && yKeys.length === 0) yKeys = undefined;

  // Resolve pie/donut keys
  const nameKey = hasKey(config.nameKey)
    ? config.nameKey!
    : fuzzyMatch(config.nameKey) || nonNumericCols[0] || cols[0];
  const valueKey = hasKey(config.valueKey)
    ? config.valueKey!
    : fuzzyMatch(config.valueKey) || numericCols[0] || cols[1];

  // Log when resolution was needed (helps debugging in dev)
  if (
    (config.xKey && config.xKey !== xKey) ||
    (config.yKey && config.yKey !== yKey)
  ) {
    console.warn(
      `[CohiWidget] Key resolution: xKey ${config.xKey} → ${xKey}, yKey ${config.yKey} → ${yKey}. Columns: [${cols.join(', ')}]`,
    );
  }

  return { xKey, yKey, yKeys, nameKey, valueKey };
}

// ---------------------------------------------------------------------------
// Number formatting helpers
// ---------------------------------------------------------------------------

/**
 * Format a number for display on chart axes and tooltips.
 * Supports compact notation (1.5M), currency ($1.5M), and percent (45.2%).
 */
function formatNumber(
  value: number,
  format?: 'number' | 'currency' | 'percent' | 'compact',
): string {
  if (value == null || isNaN(value)) return '-';

  if (format === 'percent') {
    return `${(value * (Math.abs(value) <= 1 ? 100 : 1)).toFixed(1)}%`;
  }

  const abs = Math.abs(value);
  const compact = (v: number): string => {
    if (abs >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(1)}B`;
    if (abs >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
    if (abs >= 10_000) return `${(v / 1_000).toFixed(1)}K`;
    if (Number.isInteger(v)) return v.toLocaleString();
    return v.toFixed(2);
  };

  if (format === 'currency') return `$${compact(value)}`;
  if (format === 'compact') return compact(value);

  // Default: auto-compact for large numbers
  if (abs >= 10_000) return compact(value);
  if (Number.isInteger(value)) return value.toLocaleString();
  return value.toFixed(2);
}

// ---------------------------------------------------------------------------
// Chart renderers
// ---------------------------------------------------------------------------

function renderChart(config: VisualizationConfig, data: any[], w: number, h: number) {
  const chartData = data.length > 0 ? data : config.data || [];
  const colors = config.colors || COLORS;

  // Resolve keys before rendering – fixes empty charts from key mismatches
  const resolved = resolveChartKeys(config, chartData);

  // For stacked/grouped bar: auto-expand to all numeric columns when only 1 yKey
  if (
    (config.type === 'stacked_bar' || config.type === 'grouped_bar') &&
    chartData.length > 0 &&
    (!resolved.yKeys || resolved.yKeys.length <= 1)
  ) {
    const cols = Object.keys(chartData[0]);
    const sampleRows = chartData.slice(0, Math.min(5, chartData.length));
    const numericCols = cols.filter(
      (c) => c !== resolved.xKey && sampleRows.some((row) => typeof row[c] === 'number'),
    );
    if (numericCols.length >= 2) {
      resolved.yKeys = numericCols;
      resolved.yKey = numericCols[0];
    }
  }

  const nf = config.numberFormat;
  const fmtTick = (v: any) =>
    typeof v === 'number' ? formatNumber(v, nf) : String(v ?? '');
  const fmtTooltip = (v: any) =>
    typeof v === 'number' ? formatNumber(v, nf) : v;

  // Diagnostic: detect when data exists but resolved yKey has no usable values
  if (
    chartData.length > 0 &&
    config.type !== 'table' &&
    config.type !== 'kpi' &&
    config.type !== 'pivot'
  ) {
    const yKeysToCheck = resolved.yKeys ?? (resolved.yKey ? [resolved.yKey] : []);
    const hasAnyNumericValue = yKeysToCheck.some((k) =>
      chartData.some((row) => row[k] != null && typeof row[k] === 'number'),
    );
    if (!hasAnyNumericValue && yKeysToCheck.length > 0) {
      const cols = Object.keys(chartData[0]);
      return (
        <div className="flex flex-col items-center justify-center h-full gap-2 px-4 text-center">
          <div className="w-10 h-10 rounded-full bg-amber-50 dark:bg-amber-900/30 flex items-center justify-center">
            <BarChart3 className="w-5 h-5 text-amber-500" />
          </div>
          <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
            No numeric data found for charting
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400 max-w-[280px]">
            Columns: {cols.join(', ')}
            <br />
            Expected y-axis: {yKeysToCheck.join(', ')}
          </p>
          <p className="text-xs text-indigo-600 dark:text-indigo-400 font-medium">
            Try switching to Table view for a complete data view
          </p>
        </div>
      );
    }
  }

  switch (config.type) {
    case 'bar':
    case 'horizontal_bar': {
      const isHorizontal = config.type === 'horizontal_bar';
      const barYKeys = resolved.yKeys ?? (resolved.yKey ? [resolved.yKey] : []);
      const showBarLegend = barYKeys.length > 1;
      return (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={chartData}
            layout={isHorizontal ? 'vertical' : 'horizontal'}
            margin={{ top: 4, right: 8, left: 0, bottom: 2 }}
          >
            <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
            {isHorizontal ? (
              <>
                <XAxis type="number" tick={{ fontSize: 9 }} tickFormatter={fmtTick} />
                <YAxis dataKey={resolved.xKey} type="category" tick={{ fontSize: 9 }} width={80} />
              </>
            ) : (
              <>
                <XAxis dataKey={resolved.xKey} tick={{ fontSize: 9 }} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 9 }} tickFormatter={fmtTick} width={48} />
              </>
            )}
            <Tooltip contentStyle={{ fontSize: 11, padding: '4px 8px' }} formatter={fmtTooltip} />
            {showBarLegend && <Legend wrapperStyle={{ fontSize: 9, paddingTop: 0 }} iconSize={8} />}
            {barYKeys.map((key, i) => (
              <Bar
                key={key}
                dataKey={key}
                fill={colors[i % colors.length]}
                stackId={config.stacked ? 'stack' : undefined}
                radius={[2, 2, 0, 0]}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      );
    }

    case 'line': {
      const lineYKeys = resolved.yKeys ?? (resolved.yKey ? [resolved.yKey] : []);
      const showLineLegend = lineYKeys.length > 1;
      return (
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 2 }}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
            <XAxis dataKey={resolved.xKey} tick={{ fontSize: 9 }} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 9 }} tickFormatter={fmtTick} width={48} />
            <Tooltip contentStyle={{ fontSize: 11, padding: '4px 8px' }} formatter={fmtTooltip} />
            {showLineLegend && <Legend wrapperStyle={{ fontSize: 9, paddingTop: 0 }} iconSize={8} />}
            {lineYKeys.map((key, i) => (
              <Line
                key={key}
                type="monotone"
                dataKey={key}
                stroke={colors[i % colors.length]}
                strokeWidth={1.5}
                dot={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      );
    }

    case 'area': {
      const areaYKeys = resolved.yKeys ?? (resolved.yKey ? [resolved.yKey] : []);
      const showAreaLegend = areaYKeys.length > 1;
      return (
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 2 }}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
            <XAxis dataKey={resolved.xKey} tick={{ fontSize: 9 }} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 9 }} tickFormatter={fmtTick} width={48} />
            <Tooltip contentStyle={{ fontSize: 11, padding: '4px 8px' }} formatter={fmtTooltip} />
            {showAreaLegend && <Legend wrapperStyle={{ fontSize: 9, paddingTop: 0 }} iconSize={8} />}
            {areaYKeys.map((key, i) => (
              <Area
                key={key}
                type="monotone"
                dataKey={key}
                fill={colors[i % colors.length]}
                stroke={colors[i % colors.length]}
                fillOpacity={0.3}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      );
    }

    case 'pie':
    case 'donut': {
      const pieNameKey = resolved.nameKey || resolved.xKey || 'name';
      const pieValueKey = resolved.valueKey || resolved.yKey || 'value';
      const innerRadius = config.type === 'donut' ? '40%' : 0;
      return (
        <ResponsiveContainer width="100%" height="100%">
          <PieChart margin={{ top: 2, right: 2, left: 2, bottom: 2 }}>
            <Pie
              data={chartData}
              dataKey={pieValueKey}
              nameKey={pieNameKey}
              cx="50%"
              cy="50%"
              outerRadius="75%"
              innerRadius={innerRadius}
              paddingAngle={2}
              label={({ name, percent }) => {
                const n = String(name);
                return `${n.length > 12 ? n.slice(0, 10) + '…' : n} ${(percent * 100).toFixed(0)}%`;
              }}
              labelLine={false}
              style={{ fontSize: 9 }}
            >
              {chartData.map((_: any, index: number) => (
                <Cell key={index} fill={colors[index % colors.length]} />
              ))}
            </Pie>
            <Tooltip contentStyle={{ fontSize: 11, padding: '4px 8px' }} formatter={fmtTooltip} />
            {chartData.length <= 8 && (
              <Legend wrapperStyle={{ fontSize: 9, paddingTop: 0 }} iconSize={8} />
            )}
          </PieChart>
        </ResponsiveContainer>
      );
    }

    case 'table': {
      const tableCols = config.tableConfig?.columns || Object.keys(chartData[0] || {}).map(k => ({ key: k, label: k }));
      return (
        <div className="overflow-auto max-h-full">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-700">
                {tableCols.map((col: any) => (
                  <th key={col.key} className="text-left py-1.5 px-2 font-medium text-slate-600 dark:text-slate-400 bg-slate-50 dark:bg-slate-800/50 sticky top-0">
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {chartData.slice(0, 50).map((row: any, i: number) => (
                <tr key={i} className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/30">
                  {tableCols.map((col: any) => {
                    const val = row[col.key];
                    const formatted = val == null ? '-' : typeof val === 'number' ? formatNumber(val) : String(val);
                    return (
                      <td key={col.key} className="py-1 px-2 text-slate-700 dark:text-slate-300">
                        {formatted}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          {chartData.length > 50 && (
            <p className="text-xs text-slate-500 px-2 py-1">Showing 50 of {chartData.length} rows</p>
          )}
        </div>
      );
    }

    case 'kpi': {
      const kpi = config.kpiConfig;
      const kpiRawValue = kpi?.value ?? chartData[0]?.[resolved.yKey || 'value'];
      const kpiFormatted =
        kpiRawValue == null
          ? '-'
          : typeof kpiRawValue === 'number'
            ? formatNumber(kpiRawValue, kpi?.format)
            : String(kpiRawValue);
      return (
        <div className="flex flex-col items-center justify-center h-full">
          <p className="text-3xl font-bold text-slate-800 dark:text-slate-100">
            {kpiFormatted}
          </p>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            {kpi?.label || config.title}
          </p>
          {kpi?.change != null && (
            <p className={`text-xs mt-0.5 ${kpi.change >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
              {kpi.change >= 0 ? '+' : ''}{kpi.change}%{kpi.changeLabel ? ` ${kpi.changeLabel}` : ''}
            </p>
          )}
        </div>
      );
    }

    case 'stacked_bar': {
      const stackedYKeys =
        resolved.yKeys ??
        (resolved.yKey ? [resolved.yKey] : []);
      return (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 2 }}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
            <XAxis dataKey={resolved.xKey} tick={{ fontSize: 9 }} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 9 }} tickFormatter={fmtTick} width={48} />
            <Tooltip contentStyle={{ fontSize: 11, padding: '4px 8px' }} formatter={fmtTooltip} />
            {stackedYKeys.length > 1 && <Legend wrapperStyle={{ fontSize: 9, paddingTop: 0 }} iconSize={8} />}
            {stackedYKeys.map((key, i) => (
              <Bar
                key={key}
                dataKey={key}
                fill={colors[i % colors.length]}
                stackId="stack"
                radius={i === stackedYKeys.length - 1 ? [2, 2, 0, 0] : undefined}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      );
    }

    case 'grouped_bar': {
      const groupedYKeys =
        resolved.yKeys ??
        (resolved.yKey ? [resolved.yKey] : []);
      return (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 2 }}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
            <XAxis dataKey={resolved.xKey} tick={{ fontSize: 9 }} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 9 }} tickFormatter={fmtTick} width={48} />
            <Tooltip contentStyle={{ fontSize: 11, padding: '4px 8px' }} formatter={fmtTooltip} />
            {groupedYKeys.length > 1 && <Legend wrapperStyle={{ fontSize: 9, paddingTop: 0 }} iconSize={8} />}
            {groupedYKeys.map((key, i) => (
              <Bar key={key} dataKey={key} fill={colors[i % colors.length]} radius={[2, 2, 0, 0]} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      );
    }

    case 'treemap': {
      // Treemap: uses nameKey for label, valueKey/yKey for size
      const tmNameKey = resolved.nameKey || resolved.xKey || 'name';
      const tmValueKey = resolved.valueKey || resolved.yKey || 'value';
      const treemapData = chartData.map((row: any, i: number) => ({
        name: row[tmNameKey] ?? `Item ${i + 1}`,
        size: typeof row[tmValueKey] === 'number' ? row[tmValueKey] : 0,
        fill: colors[i % colors.length],
      }));
      return (
        <ResponsiveContainer width="100%" height="100%">
          <RechartsTreemap
            data={treemapData}
            dataKey="size"
            aspectRatio={4 / 3}
            stroke="#fff"
            content={({ x, y, width: rw, height: rh, name, value, fill }: any) => {
              if (!rw || !rh || rw < 4 || rh < 4) return null;
              return (
                <g>
                  <rect
                    x={x}
                    y={y}
                    width={rw}
                    height={rh}
                    fill={fill}
                    stroke="#fff"
                    strokeWidth={2}
                    rx={3}
                  />
                  {rw > 40 && rh > 24 && (
                    <>
                      <text
                        x={x + rw / 2}
                        y={y + rh / 2 - 6}
                        textAnchor="middle"
                        fill="#fff"
                        fontSize={11}
                        fontWeight={600}
                      >
                        {String(name).length > rw / 7
                          ? String(name).slice(0, Math.floor(rw / 7)) + '…'
                          : name}
                      </text>
                      <text
                        x={x + rw / 2}
                        y={y + rh / 2 + 10}
                        textAnchor="middle"
                        fill="rgba(255,255,255,0.8)"
                        fontSize={10}
                      >
                        {typeof value === 'number' ? formatNumber(value) : value}
                      </text>
                    </>
                  )}
                </g>
              );
            }}
          />
        </ResponsiveContainer>
      );
    }

    case 'pivot': {
      // Pivot table: cross-tabulate data by rowKey x columnKey → value
      const pc = config.pivotConfig;
      if (!pc || !chartData.length) {
        return (
          <div className="flex items-center justify-center h-full text-xs text-slate-500 dark:text-slate-400 p-4">
            No pivot configuration available. Switch to Table view.
          </div>
        );
      }
      const { rowKey, columnKey, valueKey, aggregation = 'sum' } = pc;

      // Build pivot map: { rowVal -> { colVal -> aggregated value } }
      const rowValues = new Set<string>();
      const colValues = new Set<string>();
      const pivotMap: Record<string, Record<string, number[]>> = {};
      for (const row of chartData) {
        const rv = String(row[rowKey] ?? '');
        const cv = String(row[columnKey] ?? '');
        const val = typeof row[valueKey] === 'number' ? row[valueKey] : parseFloat(row[valueKey]) || 0;
        rowValues.add(rv);
        colValues.add(cv);
        if (!pivotMap[rv]) pivotMap[rv] = {};
        if (!pivotMap[rv][cv]) pivotMap[rv][cv] = [];
        pivotMap[rv][cv].push(val);
      }
      const sortedRows = Array.from(rowValues);
      const sortedCols = Array.from(colValues);

      const aggregate = (nums: number[]): number => {
        if (!nums || nums.length === 0) return 0;
        switch (aggregation) {
          case 'sum': return nums.reduce((a, b) => a + b, 0);
          case 'count': return nums.length;
          case 'avg': return nums.reduce((a, b) => a + b, 0) / nums.length;
          case 'min': return Math.min(...nums);
          case 'max': return Math.max(...nums);
          default: return nums.reduce((a, b) => a + b, 0);
        }
      };

      return (
        <div className="overflow-auto max-h-full">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-700">
                <th className="text-left py-1.5 px-2 font-medium text-slate-600 dark:text-slate-400 bg-slate-50 dark:bg-slate-800/50 sticky top-0 left-0 z-10">
                  {rowKey}
                </th>
                {sortedCols.map((col) => (
                  <th key={col} className="text-right py-1.5 px-2 font-medium text-slate-600 dark:text-slate-400 bg-slate-50 dark:bg-slate-800/50 sticky top-0 whitespace-nowrap">
                    {col}
                  </th>
                ))}
                <th className="text-right py-1.5 px-2 font-bold text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-700/50 sticky top-0">
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((rv) => {
                let rowTotal = 0;
                return (
                  <tr key={rv} className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/30">
                    <td className="py-1 px-2 font-medium text-slate-700 dark:text-slate-300 sticky left-0 bg-white dark:bg-slate-900 whitespace-nowrap">
                      {rv}
                    </td>
                    {sortedCols.map((cv) => {
                      const val = aggregate(pivotMap[rv]?.[cv] ?? []);
                      rowTotal += val;
                      return (
                        <td key={cv} className="py-1 px-2 text-right text-slate-700 dark:text-slate-300 tabular-nums">
                          {val ? formatNumber(val) : '-'}
                        </td>
                      );
                    })}
                    <td className="py-1 px-2 text-right font-semibold text-slate-800 dark:text-slate-200 bg-slate-50/50 dark:bg-slate-800/30 tabular-nums">
                      {formatNumber(rowTotal)}
                    </td>
                  </tr>
                );
              })}
              {/* Grand total row */}
              <tr className="border-t-2 border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-800/50 font-semibold">
                <td className="py-1.5 px-2 text-slate-700 dark:text-slate-300 sticky left-0 bg-slate-50 dark:bg-slate-800/50">
                  Total
                </td>
                {sortedCols.map((cv) => {
                  const colTotal = sortedRows.reduce(
                    (sum, rv) => sum + aggregate(pivotMap[rv]?.[cv] ?? []),
                    0,
                  );
                  return (
                    <td key={cv} className="py-1.5 px-2 text-right text-slate-800 dark:text-slate-200 tabular-nums">
                      {colTotal ? formatNumber(colTotal) : '-'}
                    </td>
                  );
                })}
                <td className="py-1.5 px-2 text-right text-slate-900 dark:text-slate-100 tabular-nums">
                  {formatNumber(
                    sortedRows.reduce(
                      (sum, rv) =>
                        sum + sortedCols.reduce((s, cv) => s + aggregate(pivotMap[rv]?.[cv] ?? []), 0),
                      0,
                    ),
                  )}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      );
    }

    default:
      return <p className="text-xs text-slate-500 p-2">Unsupported chart type: {config.type}</p>;
  }
}

// ---------------------------------------------------------------------------
// Filter bookmark button – save/load filter presets
// ---------------------------------------------------------------------------

function FilterBookmarkButton({
  currentFilters,
  onApplyPreset,
}: {
  currentFilters: WidgetFilterState;
  onApplyPreset: (preset: FilterPreset) => void;
}) {
  const { selectedTenantId } = useTenantStore();
  const tenantId = selectedTenantId || 'default';
  const ensureLoaded = useFilterPresetStore((s) => s.ensureLoaded);
  const presets = useFilterPresetStore((s) => s.presetsByTenant[tenantId]) ?? EMPTY_FILTER_PRESETS;
  const addPreset = useFilterPresetStore((s) => s.addPreset);
  const removePreset = useFilterPresetStore((s) => s.removePreset);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [presetName, setPresetName] = useState('');
  const menuRef = React.useRef<HTMLDivElement>(null);

  // Lazily load presets from localStorage on first render
  useEffect(() => { ensureLoaded(tenantId); }, [tenantId, ensureLoaded]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSaving(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const hasActiveFilter = Object.keys(currentFilters).length > 0;

  const handleSave = () => {
    if (!presetName.trim()) return;
    addPreset(tenantId, presetName.trim(), currentFilters);
    setPresetName('');
    setSaving(false);
  };

  /** Format a preset's filters into a short human-readable label */
  const describePreset = (p: FilterPreset): string => {
    const parts: string[] = [];
    if (p.filters.preset) parts.push(p.filters.preset);
    if (p.filters.year) parts.push(String(p.filters.year));
    if (p.filters.dateField && p.filters.dateField !== 'application_date') parts.push(p.filters.dateField);
    if (p.filters.dimensionFilters?.length) parts.push(`+${p.filters.dimensionFilters.length} filters`);
    return parts.join(' · ') || 'No filter';
  };

  return (
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        onClick={() => { setOpen((v) => !v); setSaving(false); }}
        className={cn(
          'h-5 w-5 flex items-center justify-center rounded transition-colors canvas-interactive',
          open
            ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-400'
            : 'text-slate-400 hover:text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-900/20',
        )}
        title="Filter bookmarks"
      >
        {presets.length > 0 ? <BookmarkCheck className="h-3 w-3" /> : <Bookmark className="h-3 w-3" />}
      </button>

      {open && (
        <div className="absolute right-0 top-6 z-50 w-56 bg-white dark:bg-slate-900 rounded-lg shadow-xl border border-slate-200 dark:border-slate-700 py-1 text-[11px]">
          {/* Header */}
          <div className="px-3 py-1.5 text-[10px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
            Filter Presets
          </div>

          {/* Existing presets */}
          {presets.length === 0 && !saving && (
            <div className="px-3 py-2 text-slate-400 dark:text-slate-500 italic">
              No saved presets
            </div>
          )}
          {presets.map((p) => (
            <div
              key={p.id}
              className="flex items-center gap-1.5 px-3 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-800/60 group/preset"
            >
              <button
                type="button"
                className="flex-1 text-left text-slate-700 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-400 truncate"
                onClick={() => {
                  onApplyPreset(p);
                  setOpen(false);
                }}
                title={describePreset(p)}
              >
                <span className="font-medium">{p.name}</span>
                <span className="ml-1.5 text-[9px] text-slate-400">{describePreset(p)}</span>
              </button>
              <button
                type="button"
                onClick={() => removePreset(tenantId, p.id)}
                className="p-0.5 rounded text-slate-300 dark:text-slate-600 hover:text-red-500 dark:hover:text-red-400 opacity-0 group-hover/preset:opacity-100 transition-opacity canvas-interactive"
                title="Delete preset"
              >
                <Trash2 className="h-2.5 w-2.5" />
              </button>
            </div>
          ))}

          {/* Divider */}
          <div className="border-t border-slate-100 dark:border-slate-800 my-1" />

          {/* Save current */}
          {saving ? (
            <div className="px-3 py-1.5 flex items-center gap-1.5">
              <input
                type="text"
                placeholder="Preset name..."
                value={presetName}
                onChange={(e) => setPresetName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSave();
                  if (e.key === 'Escape') setSaving(false);
                }}
                className="flex-1 h-5 px-1.5 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-[10px] focus:outline-none focus:ring-1 focus:ring-indigo-500/50 canvas-interactive"
                autoFocus
              />
              <button
                type="button"
                onClick={handleSave}
                disabled={!presetName.trim()}
                className="h-5 px-2 rounded bg-indigo-500 text-white text-[10px] font-medium hover:bg-indigo-600 disabled:opacity-50 canvas-interactive"
              >
                Save
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setSaving(true)}
              disabled={!hasActiveFilter}
              className="w-full text-left px-3 py-1.5 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/60 disabled:opacity-40 disabled:cursor-not-allowed"
              title={hasActiveFilter ? 'Save current filters as a preset' : 'Set a filter first'}
            >
              <Bookmark className="h-2.5 w-2.5 inline-block mr-1.5" />
              Save current as preset...
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CohiWidgetRenderer({
  sql,
  vizConfig,
  title,
  explanation,
  tenantId,
  width = 500,
  height = 350,
  groupDateFilter,
  groupDimensionFilters,
  filterSyncEnabled,
  initialFilters,
  onFilterChange,
  onVizTypeChange,
  canvasItemId,
  hideTitle,
}: CohiWidgetRendererProps) {
  const reportWidgetData = useCanvasDataStore((s) => s.reportWidgetData);
  const removeWidgetFromStore = useCanvasDataStore((s) => s.removeWidget);

  // ─── Chart type state ───
  // Normalize invalid types the LLM may generate (e.g. "chart" → "bar")
  const normalizeVizType = (t: string): VisualizationConfig['type'] => {
    const valid = new Set(['bar','line','pie','area','table','kpi','donut','horizontal_bar','stacked_bar','grouped_bar','treemap','pivot']);
    if (valid.has(t)) return t as VisualizationConfig['type'];
    // Map common LLM mistakes
    if (t === 'chart') return 'bar';
    if (t === 'number' || t === 'metric' || t === 'metric-card') return 'kpi';
    if (t === 'hbar' || t === 'h_bar') return 'horizontal_bar';
    console.warn(`[CohiWidget] Normalized invalid viz type "${t}" → "bar"`);
    return 'bar';
  };

  const [chartType, setChartTypeLocal] = useState<VisualizationConfig['type']>(normalizeVizType(vizConfig.type));
  const setChartType = useCallback((type: VisualizationConfig['type']) => {
    setChartTypeLocal(normalizeVizType(type));
    onVizTypeChange?.(normalizeVizType(type));
  }, [onVizTypeChange]);

  // ─── Timeframe state ───
  // Each widget always has its own filter controls.
  // When filterSyncEnabled, the group filter takes precedence for data fetching
  // but the local controls still reflect synced state.
  const detectedCols = useMemo(() => detectDateColumns(sql), [sql]);
  const hasDateColumns = detectedCols.length > 0;
  const [dateField, setDateFieldLocal] = useState<string>(
    initialFilters?.dateField || detectedCols[0] || 'application_date',
  );
  const [activePreset, setActivePresetLocal] = useState<PeriodPreset | null>(
    (initialFilters?.preset as PeriodPreset) || null,
  );
  const [activeYear, setActiveYearLocal] = useState<number | null>(
    initialFilters?.year ?? null,
  );

  // Wrapped setters that also report changes upward for persistence
  const setDateField = useCallback((v: string) => {
    setDateFieldLocal(v);
  }, []);
  const setActivePreset = useCallback((v: PeriodPreset | null) => {
    setActivePresetLocal(v);
  }, []);
  const setActiveYear = useCallback((v: number | null) => {
    setActiveYearLocal(v);
  }, []);

  // Report filter changes for persistence (skip initial mount to avoid dirtying the canvas)
  const filterChangeSerialRef = React.useRef(0);
  useEffect(() => {
    filterChangeSerialRef.current += 1;
    if (filterChangeSerialRef.current <= 1) return; // skip mount
    if (!onFilterChange) return;
    const state: WidgetFilterState = {};
    if (dateField && dateField !== 'application_date') state.dateField = dateField;
    if (activePreset) state.preset = activePreset;
    if (activeYear) state.year = activeYear;
    if (activePreset) {
      const range = computePresetDateRange(activePreset);
      state.dateRange = range;
    } else if (activeYear) {
      state.dateRange = { start: `${activeYear}-01-01`, end: `${activeYear}-12-31` };
    }
    onFilterChange(Object.keys(state).length > 0 ? state : {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateField, activePreset, activeYear]);

  // Build the local dateFilter from the widget's own controls
  const localDateFilter = useMemo<DateFilter | null>(() => {
    if (activePreset) {
      const range = computePresetDateRange(activePreset);
      return { column: dateField, start: range.start, end: range.end };
    }
    if (activeYear) {
      return {
        column: dateField,
        start: `${activeYear}-01-01`,
        end: `${activeYear}-12-31`,
      };
    }
    return null; // no filter → original SQL range
  }, [activePreset, activeYear, dateField]);

  // When sync is enabled, group filter wins. Otherwise, use the widget's own controls.
  const effectiveDateFilter = filterSyncEnabled ? (groupDateFilter ?? null) : localDateFilter;
  const effectiveDimFilters = filterSyncEnabled ? (groupDimensionFilters ?? null) : null;

  const { data, loading, error, refetch } = useCohiWidgetData(sql, tenantId, effectiveDateFilter, effectiveDimFilters);
  const effectiveConfig = { ...vizConfig, type: chartType };

  // Compute compatible viz types based on actual data shape
  const compatibleTypes = useMemo(() => getCompatibleChartTypes(data || []), [data]);

  // Report data to canvasDataStore for Cohi chat context
  useEffect(() => {
    if (!canvasItemId) return;
    if (!loading && data != null && !error) {
      const vizType = vizConfig.type;
      const category: 'kpi' | 'chart' | 'table' | 'other' =
        vizType === 'kpi' ? 'kpi' : vizType === 'table' ? 'table' : 'chart';
      reportWidgetData(canvasItemId, {
        widgetName: title,
        category,
        data: { vizType, data, xKey: vizConfig.xKey, yKey: vizConfig.yKey },
      });
    }
    return () => {
      if (canvasItemId) removeWidgetFromStore(canvasItemId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, loading, error, canvasItemId]);

  // ─── Handlers ───
  const handlePresetClick = useCallback((preset: PeriodPreset) => {
    if (activePreset === preset) {
      // deselect → back to original SQL range
      setActivePreset(null);
    } else {
      setActivePreset(preset);
      setActiveYear(null);
    }
  }, [activePreset]);

  const handleYearClick = useCallback((year: number) => {
    if (activeYear === year) {
      setActiveYear(null);
    } else {
      setActiveYear(year);
      setActivePreset(null);
    }
  }, [activeYear]);

  const handleClearFilter = useCallback(() => {
    setActivePreset(null);
    setActiveYear(null);
  }, []);

  // Build current filter state for bookmark saving
  const currentFilterState = useMemo<WidgetFilterState>(() => {
    const state: WidgetFilterState = {};
    if (dateField && dateField !== 'application_date') state.dateField = dateField;
    if (activePreset) state.preset = activePreset;
    if (activeYear) state.year = activeYear;
    return state;
  }, [dateField, activePreset, activeYear]);

  // Apply a saved preset
  const handleApplyPreset = useCallback((preset: FilterPreset) => {
    const f = preset.filters;
    if (f.dateField) setDateField(f.dateField);
    if (f.preset) {
      setActivePreset(f.preset as PeriodPreset);
      setActiveYear(null);
    } else if (f.year) {
      setActiveYear(f.year);
      setActivePreset(null);
    } else {
      setActivePreset(null);
      setActiveYear(null);
    }
  }, []);

  // ─── Collapsible filter bar state ───
  const [filtersExpanded, setFiltersExpanded] = useState(false);

  // Summary label for collapsed state
  const filterSummary = activePreset
    ? PERIOD_PRESETS.find((p) => p.preset === activePreset)?.label || activePreset
    : activeYear
      ? String(activeYear)
      : null;

  return (
    <div className="h-full w-full flex flex-col bg-white dark:bg-slate-900 rounded-lg overflow-hidden">
      {/* ─── Compact title bar for standalone widgets (not inside a group) ─── */}
      {!hideTitle && (
        <div className="flex items-center gap-1.5 px-2.5 h-7 min-h-[28px] shrink-0 border-b border-slate-200/70 dark:border-slate-700/70 bg-slate-50/60 dark:bg-slate-800/40">
          <Sparkles className="h-3 w-3 text-indigo-500 shrink-0" />
          <span className="text-[11px] font-semibold text-slate-700 dark:text-slate-300 truncate flex-1 min-w-0">
            {title}
          </span>
          <button
            type="button"
            onClick={refetch}
            className="h-4 w-4 flex items-center justify-center rounded text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 canvas-interactive transition-colors shrink-0"
            title="Refresh data"
          >
            <RefreshCw className="h-2.5 w-2.5" />
          </button>
        </div>
      )}

      {/* ─── Compact filter toolbar ─── */}
      {!filterSyncEnabled && (
        <div className="shrink-0 border-b border-slate-200/70 dark:border-slate-700/70 bg-slate-50/60 dark:bg-slate-800/40">
          {/* Collapsed: single compact row with toggle + summary + actions */}
          <div className="flex items-center gap-1 px-1.5 h-6 min-h-[24px]">
            {/* Expand/collapse toggle */}
            <button
              type="button"
              onClick={() => setFiltersExpanded((v) => !v)}
              className={cn(
                'flex items-center gap-0.5 h-5 px-1 rounded text-[9px] font-medium canvas-interactive transition-colors shrink-0',
                filtersExpanded
                  ? 'text-indigo-500 dark:text-indigo-400 bg-indigo-50/80 dark:bg-indigo-950/30'
                  : 'text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800',
              )}
              title={filtersExpanded ? 'Collapse filters' : 'Expand filters'}
            >
              <SlidersHorizontal className="h-2.5 w-2.5" />
              {filtersExpanded ? <ChevronDown className="h-2 w-2" /> : <ChevronRight className="h-2 w-2" />}
            </button>

            {/* Filter summary badge (when collapsed, show active filter) */}
            {!filtersExpanded && filterSummary && (
              <span className="text-[9px] font-semibold text-indigo-600 dark:text-indigo-400 bg-indigo-100/70 dark:bg-indigo-900/30 px-1.5 rounded-full whitespace-nowrap">
                {filterSummary}
              </span>
            )}
            {!filtersExpanded && !filterSummary && (
              <span className="text-[9px] text-slate-400 dark:text-slate-500 italic">No filter</span>
            )}

            {/* Spacer */}
            <div className="flex-1" />

            {/* Clear filter */}
            {localDateFilter && (
              <button
                type="button"
                onClick={handleClearFilter}
                className="h-4 w-4 flex items-center justify-center rounded text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 canvas-interactive transition-colors"
                title="Clear date filter"
              >
                <X className="h-2.5 w-2.5" />
              </button>
            )}

            {/* Refresh */}
            <button
              type="button"
              onClick={refetch}
              className="h-4 w-4 flex items-center justify-center rounded text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 canvas-interactive transition-colors"
              title="Refresh data"
            >
              <RefreshCw className="h-2.5 w-2.5" />
            </button>
          </div>

          {/* Expanded filter controls */}
          {filtersExpanded && (
            <div className="flex items-center gap-1.5 px-2 pb-1.5 flex-wrap">
              {/* Period presets */}
              {PERIOD_PRESETS.map(({ preset, label, title: presetTitle }) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => handlePresetClick(preset)}
                  className={cn(
                    'h-5 px-1.5 rounded text-[10px] font-medium transition-colors canvas-interactive',
                    activePreset === preset
                      ? 'bg-indigo-500 text-white shadow-sm'
                      : 'text-slate-500 dark:text-slate-400 hover:bg-indigo-100 dark:hover:bg-indigo-900/30 hover:text-indigo-700 dark:hover:text-indigo-300',
                  )}
                  title={presetTitle}
                >
                  {label}
                </button>
              ))}

              {/* Divider */}
              <div className="w-px h-3.5 bg-slate-200 dark:bg-slate-700 mx-0.5" />

              {/* Year buttons */}
              {YEAR_BUTTONS.map((year) => (
                <button
                  key={year}
                  type="button"
                  onClick={() => handleYearClick(year)}
                  className={cn(
                    'h-5 px-1.5 rounded text-[10px] font-medium transition-colors canvas-interactive',
                    activeYear === year
                      ? 'bg-indigo-500 text-white shadow-sm'
                      : 'text-slate-500 dark:text-slate-400 hover:bg-indigo-100 dark:hover:bg-indigo-900/30 hover:text-indigo-700 dark:hover:text-indigo-300',
                  )}
                  title={`Full year ${year}`}
                >
                  {year}
                </button>
              ))}

              {/* Divider */}
              <div className="w-px h-3.5 bg-slate-200 dark:bg-slate-700 mx-0.5" />

              {/* Date field selector */}
              <div className="flex items-center gap-1">
                <Calendar className="h-3 w-3 text-slate-400" />
                <div className="relative">
                  <select
                    value={dateField}
                    onChange={(e) => setDateField(e.target.value)}
                    className="appearance-none h-5 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 pl-1.5 pr-4 text-[10px] font-medium text-slate-600 dark:text-slate-300 cursor-pointer hover:border-slate-300 dark:hover:border-slate-600 focus:outline-none focus:ring-1 focus:ring-indigo-500/50 canvas-interactive"
                    title="Date field to filter on"
                  >
                    {DATE_FIELD_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-0.5 top-1/2 -translate-y-1/2 h-2.5 w-2.5 text-slate-400 pointer-events-none" />
                </div>
              </div>

              {/* Divider before bookmarks */}
              <div className="w-px h-3.5 bg-slate-200 dark:bg-slate-700 mx-0.5" />

              {/* Filter preset bookmarks */}
              <FilterBookmarkButton
                currentFilters={currentFilterState}
                onApplyPreset={handleApplyPreset}
              />
            </div>
          )}
        </div>
      )}

      {/* Body – minimal padding so charts fill available space */}
      <div className="flex-1 min-h-0 overflow-hidden px-1 py-0.5">
        {loading ? (
          <div className="flex items-center justify-center h-full gap-1.5 text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-xs">Loading...</span>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center h-full gap-1.5 text-red-500">
            <AlertCircle className="h-4 w-4" />
            <p className="text-[10px] text-center max-w-[200px]">{error}</p>
            <Button variant="outline" size="sm" onClick={refetch} className="text-[10px] h-6 canvas-interactive">
              Retry
            </Button>
          </div>
        ) : (
          renderChart(effectiveConfig, data || [], width, height)
        )}
      </div>

      {/* Chart type switcher – compact row, only shows compatible types */}
      <div className="flex items-center gap-px px-1.5 py-1 border-t border-slate-200/50 dark:border-slate-700/50 bg-slate-50/80 dark:bg-slate-800/40 shrink-0 overflow-x-auto">
        {compatibleTypes.map(({ type, label, Icon }) => (
          <button
            key={type}
            type="button"
            className={cn(
              'h-5 px-1.5 rounded text-[9px] font-medium whitespace-nowrap canvas-interactive transition-colors flex items-center gap-0.5 shrink-0',
              chartType === type
                ? 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300'
                : 'text-slate-400 dark:text-slate-500 hover:bg-slate-200/60 dark:hover:bg-slate-700/60 hover:text-slate-600 dark:hover:text-slate-300',
            )}
            onClick={() => setChartType(type)}
            title={label}
          >
            <Icon className="w-2.5 h-2.5" />
            {label}
          </button>
        ))}
      </div>

      {/* Explanation tooltip – only on hover to save space */}
      {explanation && (
        <div className="px-2 py-0.5 border-t border-slate-100 dark:border-slate-800 opacity-0 group-hover:opacity-100 transition-opacity">
          <p className="text-[9px] text-slate-400 dark:text-slate-500 line-clamp-1 leading-tight" title={explanation}>
            {explanation}
          </p>
        </div>
      )}
    </div>
  );
}
