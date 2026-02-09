/**
 * ChartCard – config-driven recharts wrapper.
 *
 * Supports bar, line, area, pie, and composed chart types via a single
 * declarative config object. Uses the existing ChartContainer from chart.tsx
 * for theme-aware styling.
 */

import React, { useMemo } from 'react';
import {
  BarChart, Bar, LineChart, Line, AreaChart, Area,
  PieChart, Pie, Cell, ComposedChart,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { cn } from '@/lib/utils';
import type { WidgetRenderProps, ChartData, ChartSeries } from '../registry/types';
import { WidgetShell } from './WidgetShell';

// Default color palette
const COLORS = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
  '#06b6d4', '#ec4899', '#84cc16', '#f97316', '#6366f1',
];

function getColor(series: ChartSeries, index: number): string {
  return series.color ?? COLORS[index % COLORS.length];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface ChartCardProps extends WidgetRenderProps<ChartData> {
  showActions?: boolean;
  onRemove?: () => void;
  onDuplicate?: () => void;
}

export function ChartCard({
  data,
  loading,
  error,
  width,
  height,
  showActions,
  onRemove,
  onDuplicate,
}: ChartCardProps) {
  const chartHeight = Math.max((height ?? 200) - 56, 100); // subtract header

  const renderChart = useMemo(() => {
    if (!data) return null;
    const { chartType, data: chartData, series, xAxisKey, stacked } = data;

    const commonAxisProps = {
      tick: { fontSize: 11, fill: 'currentColor' },
      tickLine: false,
      axisLine: false,
    };

    switch (chartType) {
      case 'bar':
        return (
          <ResponsiveContainer width="100%" height={chartHeight}>
            <BarChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-slate-200/50 dark:stroke-slate-700/50" />
              <XAxis dataKey={xAxisKey} {...commonAxisProps} />
              <YAxis {...commonAxisProps} />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'var(--tooltip-bg, #fff)',
                  border: '1px solid var(--tooltip-border, #e2e8f0)',
                  borderRadius: '8px',
                  fontSize: '12px',
                }}
              />
              {series.length > 1 && <Legend wrapperStyle={{ fontSize: '11px' }} />}
              {series.map((s, i) => (
                <Bar
                  key={s.dataKey}
                  dataKey={s.dataKey}
                  name={s.name}
                  fill={getColor(s, i)}
                  radius={[4, 4, 0, 0]}
                  stackId={stacked ? 'stack' : undefined}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        );

      case 'line':
        return (
          <ResponsiveContainer width="100%" height={chartHeight}>
            <LineChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-slate-200/50 dark:stroke-slate-700/50" />
              <XAxis dataKey={xAxisKey} {...commonAxisProps} />
              <YAxis {...commonAxisProps} />
              <Tooltip />
              {series.length > 1 && <Legend wrapperStyle={{ fontSize: '11px' }} />}
              {series.map((s, i) => (
                <Line
                  key={s.dataKey}
                  dataKey={s.dataKey}
                  name={s.name}
                  stroke={getColor(s, i)}
                  strokeWidth={2}
                  dot={{ r: 3 }}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        );

      case 'area':
        return (
          <ResponsiveContainer width="100%" height={chartHeight}>
            <AreaChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-slate-200/50 dark:stroke-slate-700/50" />
              <XAxis dataKey={xAxisKey} {...commonAxisProps} />
              <YAxis {...commonAxisProps} />
              <Tooltip />
              {series.map((s, i) => (
                <Area
                  key={s.dataKey}
                  dataKey={s.dataKey}
                  name={s.name}
                  stroke={getColor(s, i)}
                  fill={getColor(s, i)}
                  fillOpacity={0.15}
                  strokeWidth={2}
                />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        );

      case 'pie':
        return (
          <ResponsiveContainer width="100%" height={chartHeight}>
            <PieChart>
              <Pie
                data={chartData}
                dataKey={series[0]?.dataKey ?? 'value'}
                nameKey={xAxisKey}
                cx="50%"
                cy="50%"
                outerRadius={Math.min(chartHeight, (width ?? 300)) / 3}
                label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                labelLine={false}
              >
                {chartData.map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        );

      case 'composed':
        return (
          <ResponsiveContainer width="100%" height={chartHeight}>
            <ComposedChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-slate-200/50 dark:stroke-slate-700/50" />
              <XAxis dataKey={xAxisKey} {...commonAxisProps} />
              <YAxis {...commonAxisProps} />
              <Tooltip />
              <Legend wrapperStyle={{ fontSize: '11px' }} />
              {series.map((s, i) => {
                const color = getColor(s, i);
                if (s.type === 'line') return <Line key={s.dataKey} dataKey={s.dataKey} name={s.name} stroke={color} strokeWidth={2} />;
                if (s.type === 'area') return <Area key={s.dataKey} dataKey={s.dataKey} name={s.name} stroke={color} fill={color} fillOpacity={0.15} />;
                return <Bar key={s.dataKey} dataKey={s.dataKey} name={s.name} fill={color} radius={[4, 4, 0, 0]} />;
              })}
            </ComposedChart>
          </ResponsiveContainer>
        );

      default:
        return null;
    }
  }, [data, chartHeight, width]);

  return (
    <WidgetShell
      title={data?.title}
      loading={loading}
      error={error}
      showActions={showActions}
      onRemove={onRemove}
      onDuplicate={onDuplicate}
    >
      <div className="p-2 h-full w-full text-slate-700 dark:text-slate-300">
        {renderChart}
      </div>
    </WidgetShell>
  );
}
