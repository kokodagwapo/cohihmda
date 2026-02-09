/**
 * CohiWidgetRenderer
 *
 * Renders a Cohi-generated widget on the canvas.
 * These widgets are backed by SQL queries that the LLM generated,
 * and use the standard Recharts-based visualization components.
 */

import React from 'react';
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
import { Loader2, AlertCircle, RefreshCw, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useCohiWidgetData } from '@/hooks/useCohiWidgetData';
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
}: CohiWidgetRendererProps) {
  const { data, loading, error, refetch } = useCohiWidgetData(sql, tenantId);

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
        <Button
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0 text-slate-400 hover:text-slate-600"
          onClick={refetch}
          title="Refresh data"
        >
          <RefreshCw className="h-3 w-3" />
        </Button>
      </div>

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
            <Button variant="outline" size="sm" onClick={refetch} className="text-xs h-7">
              Retry
            </Button>
          </div>
        ) : (
          renderChart(vizConfig, data || [], width, height)
        )}
      </div>

      {/* Explanation tooltip */}
      {explanation && (
        <div className="px-3 py-1.5 border-t border-slate-100 dark:border-slate-800">
          <p className="text-[10px] text-slate-400 dark:text-slate-500 line-clamp-1" title={explanation}>
            {explanation}
          </p>
        </div>
      )}
    </div>
  );
}
