/**
 * Workbench widget: Actors Current Loan Status bar chart.
 * Uses section filters (measure) from WidgetGroup config; supports status click to filter.
 */

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  Cell,
} from 'recharts';
import { Loader2 } from 'lucide-react';
import type { WidgetRenderProps } from '../registry/types';
import type { ActorsDashboardData } from '@/hooks/useActorsData';

const BAR_COLORS = ['#006980', '#4096A8', '#82C4CC', '#A9DBE0', '#D0ECEF'];

export function ActorsStatusChartWidget({
  data,
  loading,
  error,
  width,
  height,
  config,
}: WidgetRenderProps<ActorsDashboardData | null>) {
  const measure = (config?.measure as 'units' | 'volume') ?? 'units';
  const onStatusClick = config?.onStatusClick as ((status: string) => void) | undefined;

  const chartData =
    data?.statusCounts?.map((s) => ({
      name: s.status,
      count: s.count,
      volume: s.volume,
      value: measure === 'volume' ? s.volume : s.count,
    })) ?? [];

  if (error) {
    return (
      <Card className="border border-slate-200 dark:border-slate-700 h-full">
        <CardContent className="flex items-center justify-center py-8 text-sm text-red-600 dark:text-red-400">
          {error}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border border-slate-200 dark:border-slate-700 h-full flex flex-col">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-semibold">Current Loan Status</CardTitle>
      </CardHeader>
      <CardContent className="pt-0 flex-1 min-h-0 overflow-hidden">
        <div className="h-full min-h-[200px] w-full flex items-center justify-center">
          {loading ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
            </div>
          ) : chartData.length ? (
            <ResponsiveContainer width="100%" height="100%" className="min-h-0">
              <BarChart
                layout="vertical"
                data={chartData}
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
                    measure === 'volume'
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
                    measure === 'volume'
                      ? (v: number) => [
                          '$' +
                            (v >= 1e6
                              ? (v / 1e6).toFixed(2) + 'M'
                              : v >= 1e3
                                ? (v / 1e3).toFixed(2) + 'K'
                                : v.toLocaleString()),
                          'Volume',
                        ]
                      : undefined
                  }
                />
                <Bar
                  dataKey="value"
                  radius={[0, 4, 4, 0]}
                  name={measure === 'volume' ? 'Volume' : 'Units'}
                  stroke="none"
                  onClick={
                    onStatusClick
                      ? (payload: { name?: string }) => {
                          if (payload?.name != null) {
                            onStatusClick(payload.name);
                          }
                        }
                      : undefined
                  }
                  cursor={onStatusClick ? 'pointer' : undefined}
                >
                  {chartData.map((_, index) => (
                    <Cell
                      key={index}
                      fill={BAR_COLORS[Math.min(index, BAR_COLORS.length - 1)] ?? '#D0ECEF'}
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
  );
}
