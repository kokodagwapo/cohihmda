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
  Calendar,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useCanvasDataStore } from '@/stores/canvasDataStore';
import { useCohiWidgetData, type DateFilter } from '@/hooks/useCohiWidgetData';
import {
  computePresetDateRange,
  type PeriodPreset,
  type DateRange,
} from '@/components/ui/DatePeriodPicker';
import type { VisualizationConfig } from '@/hooks/useCohiChat';

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

const CHART_TYPE_OPTIONS: {
  type: VisualizationConfig['type'];
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
}[] = [
  { type: 'bar', label: 'Bar', Icon: BarChart3 },
  { type: 'line', label: 'Line', Icon: Activity },
  { type: 'pie', label: 'Pie', Icon: PieChartIcon },
  { type: 'area', label: 'Area', Icon: BarChart3 },
  { type: 'donut', label: 'Donut', Icon: PieChartIcon },
  { type: 'horizontal_bar', label: 'H-Bar', Icon: BarChart3 },
  { type: 'table', label: 'Table', Icon: LayoutGrid },
];

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
   * When rendered inside a WidgetGroup, the group's dateFilter takes
   * precedence over the widget's own timeframe controls.  When provided,
   * the widget's built-in filter bar is hidden and this filter is used.
   */
  groupDateFilter?: DateFilter | null;
  /** Called when the user changes the visualization type (bar, line, pie, etc.) */
  onVizTypeChange?: (type: VisualizationConfig['type']) => void;
  /** Canvas layout item ID – for reporting data to canvasDataStore */
  canvasItemId?: string;
}

// ---------------------------------------------------------------------------
// Chart renderers
// ---------------------------------------------------------------------------

function renderChart(config: VisualizationConfig, data: any[], w: number, h: number) {
  const chartData = data.length > 0 ? data : config.data || [];
  const colors = config.colors || COLORS;

  switch (config.type) {
    case 'bar':
    case 'horizontal_bar': {
      const isHorizontal = config.type === 'horizontal_bar';
      return (
        <ResponsiveContainer width="100%" height={h - 60}>
          <BarChart
            data={chartData}
            layout={isHorizontal ? 'vertical' : 'horizontal'}
            margin={{ top: 5, right: 20, left: 10, bottom: 5 }}
          >
            <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
            {isHorizontal ? (
              <>
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis dataKey={config.xKey} type="category" tick={{ fontSize: 11 }} width={100} />
              </>
            ) : (
              <>
                <XAxis dataKey={config.xKey} tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
              </>
            )}
            <Tooltip />
            {config.showLegend && <Legend />}
            {config.yKeys ? (
              config.yKeys.map((key, i) => (
                <Bar
                  key={key}
                  dataKey={key}
                  fill={colors[i % colors.length]}
                  stackId={config.stacked ? 'stack' : undefined}
                  radius={[2, 2, 0, 0]}
                />
              ))
            ) : (
              <Bar
                dataKey={config.yKey || 'value'}
                fill={colors[0]}
                radius={[2, 2, 0, 0]}
              />
            )}
          </BarChart>
        </ResponsiveContainer>
      );
    }

    case 'line': {
      return (
        <ResponsiveContainer width="100%" height={h - 60}>
          <LineChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
            <XAxis dataKey={config.xKey} tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip />
            {config.showLegend && <Legend />}
            {config.yKeys ? (
              config.yKeys.map((key, i) => (
                <Line
                  key={key}
                  type="monotone"
                  dataKey={key}
                  stroke={colors[i % colors.length]}
                  strokeWidth={2}
                  dot={false}
                />
              ))
            ) : (
              <Line
                type="monotone"
                dataKey={config.yKey || 'value'}
                stroke={colors[0]}
                strokeWidth={2}
                dot={false}
              />
            )}
          </LineChart>
        </ResponsiveContainer>
      );
    }

    case 'area': {
      return (
        <ResponsiveContainer width="100%" height={h - 60}>
          <AreaChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
            <XAxis dataKey={config.xKey} tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip />
            {config.showLegend && <Legend />}
            <Area
              type="monotone"
              dataKey={config.yKey || 'value'}
              fill={colors[0]}
              stroke={colors[0]}
              fillOpacity={0.3}
            />
          </AreaChart>
        </ResponsiveContainer>
      );
    }

    case 'pie':
    case 'donut': {
      const nameKey = config.nameKey || config.xKey || 'name';
      const valueKey = config.valueKey || config.yKey || 'value';
      const innerRadius = config.type === 'donut' ? '50%' : 0;
      return (
        <ResponsiveContainer width="100%" height={h - 60}>
          <PieChart>
            <Pie
              data={chartData}
              dataKey={valueKey}
              nameKey={nameKey}
              cx="50%"
              cy="50%"
              outerRadius="80%"
              innerRadius={innerRadius}
              paddingAngle={2}
              label={({ name, percent }) =>
                `${name}: ${(percent * 100).toFixed(0)}%`
              }
              labelLine={false}
            >
              {chartData.map((_: any, index: number) => (
                <Cell key={index} fill={colors[index % colors.length]} />
              ))}
            </Pie>
            <Tooltip />
            {config.showLegend && <Legend />}
          </PieChart>
        </ResponsiveContainer>
      );
    }

    case 'table': {
      const cols = config.tableConfig?.columns || Object.keys(chartData[0] || {}).map(k => ({ key: k, label: k }));
      return (
        <div className="overflow-auto max-h-full">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-700">
                {cols.map((col: any) => (
                  <th key={col.key} className="text-left py-1.5 px-2 font-medium text-slate-600 dark:text-slate-400 bg-slate-50 dark:bg-slate-800/50 sticky top-0">
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {chartData.slice(0, 50).map((row: any, i: number) => (
                <tr key={i} className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/30">
                  {cols.map((col: any) => (
                    <td key={col.key} className="py-1 px-2 text-slate-700 dark:text-slate-300">
                      {row[col.key] != null ? String(row[col.key]) : '-'}
                    </td>
                  ))}
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
      return (
        <div className="flex flex-col items-center justify-center h-full">
          <p className="text-3xl font-bold text-slate-800 dark:text-slate-100">
            {kpi?.value ?? chartData[0]?.[config.yKey || 'value'] ?? '-'}
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

    default:
      return <p className="text-xs text-slate-500 p-2">Unsupported chart type: {config.type}</p>;
  }
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
  onVizTypeChange,
  canvasItemId,
}: CohiWidgetRendererProps) {
  // When inside a WidgetGroup the group's filter controls are authoritative
  const isInsideGroup = groupDateFilter !== undefined;
  const reportWidgetData = useCanvasDataStore((s) => s.reportWidgetData);
  const removeWidgetFromStore = useCanvasDataStore((s) => s.removeWidget);

  // ─── Chart type state ───
  const [chartType, setChartTypeLocal] = useState<VisualizationConfig['type']>(vizConfig.type);
  const setChartType = useCallback((type: VisualizationConfig['type']) => {
    setChartTypeLocal(type);
    onVizTypeChange?.(type);
  }, [onVizTypeChange]);

  // ─── Timeframe state (only used when NOT inside a group) ───
  const detectedCols = useMemo(() => detectDateColumns(sql), [sql]);
  const hasDateColumns = !isInsideGroup && detectedCols.length > 0;
  const [dateField, setDateField] = useState<string>(detectedCols[0] || 'application_date');
  const [activePreset, setActivePreset] = useState<PeriodPreset | null>(null);
  const [activeYear, setActiveYear] = useState<number | null>(null);

  // Build the dateFilter for useCohiWidgetData
  // When inside a group, the group's dateFilter wins.
  // When standalone, use the widget's own controls.
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

  const effectiveDateFilter = isInsideGroup ? (groupDateFilter ?? null) : localDateFilter;

  const { data, loading, error, refetch } = useCohiWidgetData(sql, tenantId, effectiveDateFilter);
  const effectiveConfig = { ...vizConfig, type: chartType };

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

  return (
    <div className="h-full w-full flex flex-col bg-white dark:bg-slate-900 rounded-lg overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-200 dark:border-slate-700 shrink-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <Sparkles className="h-3.5 w-3.5 text-indigo-500 shrink-0" />
          <span className="text-xs font-medium text-slate-700 dark:text-slate-300 truncate">
            {title}
          </span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {localDateFilter && !isInsideGroup && (
            <button
              type="button"
              onClick={handleClearFilter}
              className="h-5 px-1.5 rounded text-[9px] font-medium text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors canvas-interactive"
              title="Clear date filter (use original SQL range)"
            >
              Clear filter
            </button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0 text-slate-400 hover:text-slate-600 canvas-interactive"
            onClick={refetch}
            title="Refresh data"
          >
            <RefreshCw className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {/* ─── Timeframe filter bar ─── */}
      {hasDateColumns && (
        <div className="shrink-0 border-b border-slate-200/70 dark:border-slate-700/70 bg-indigo-50/30 dark:bg-indigo-950/10">
          <div className="flex items-center gap-1.5 px-2.5 py-1.5 flex-wrap">
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
          </div>
        </div>
      )}

      {/* Body */}
      <div className="flex-1 min-h-0 overflow-hidden p-2">
        {loading ? (
          <div className="flex items-center justify-center h-full gap-2 text-slate-500">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-sm">Loading data...</span>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-red-500">
            <AlertCircle className="h-5 w-5" />
            <p className="text-xs text-center max-w-[200px]">{error}</p>
            <Button variant="outline" size="sm" onClick={refetch} className="text-xs h-7 canvas-interactive">
              Retry
            </Button>
          </div>
        ) : (
          renderChart(effectiveConfig, data || [], width, height)
        )}
      </div>

      {/* Chart type switcher */}
      <div className="flex flex-wrap items-center gap-1 px-2 py-1.5 border-t border-slate-200/50 dark:border-slate-700/50 bg-slate-50/80 dark:bg-slate-800/40 shrink-0">
        <span className="text-[9px] font-medium text-slate-400 dark:text-slate-500 uppercase tracking-wider mr-0.5">
          Type:
        </span>
        {CHART_TYPE_OPTIONS.map(({ type, label, Icon }) => (
          <Button
            key={type}
            variant="ghost"
            size="sm"
            className={`h-6 px-1.5 text-[10px] rounded-md canvas-interactive ${
              chartType === type
                ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 font-medium'
                : 'text-slate-500 dark:text-slate-400 hover:bg-slate-200/60 dark:hover:bg-slate-700/60'
            }`}
            onClick={() => setChartType(type)}
          >
            <Icon className="w-3 h-3 mr-0.5" />
            {label}
          </Button>
        ))}
      </div>

      {/* Explanation tooltip */}
      {explanation && (
        <div className="px-3 py-1 border-t border-slate-100 dark:border-slate-800">
          <p className="text-[10px] text-slate-400 dark:text-slate-500 line-clamp-1" title={explanation}>
            {explanation}
          </p>
        </div>
      )}
    </div>
  );
}
