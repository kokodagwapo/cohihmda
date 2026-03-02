/**
 * Workbench widget: Actors KPIs (Units, Volume, Average Balance, WAC, WAM, WA FICO, WA LTV, WA DTI).
 * Always 2 columns × 4 rows. KPI box width follows widget width. Font size and box height scale with widget height so content fits.
 */

import React, { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { WidgetRenderProps } from '../registry/types';
import type { ActorsDashboardData } from '@/hooks/useActorsData';

const HEADER_HEIGHT = 52;
/** Content height at which scale is 1 (default size). */
const REF_CONTENT_HEIGHT = 260;
const MIN_FONT_SCALE = 0.5;
const BOX_MIN_HEIGHT_BASE = 72;

export function ActorsKPIsWidget({
  data,
  loading,
  error,
  config,
  width,
  height,
}: WidgetRenderProps<ActorsDashboardData | null>) {
  const kpis = data?.kpis;

  const contentHeight = Math.max(0, height - HEADER_HEIGHT);

  const fontScale = useMemo(
    () => Math.max(MIN_FONT_SCALE, Math.min(1, contentHeight / REF_CONTENT_HEIGHT)),
    [contentHeight],
  );

  if (error) {
    return (
      <Card className="border border-slate-200 dark:border-slate-700 h-full">
        <CardContent className="flex items-center justify-center py-8 text-sm text-red-600 dark:text-red-400">
          {error}
        </CardContent>
      </Card>
    );
  }

  const items = kpis
    ? [
        { label: 'Units', value: kpis.units.toLocaleString() },
        {
          label: 'Volume',
          value:
            '$' +
            (kpis.volume >= 1e9
              ? (kpis.volume / 1e9).toFixed(2) + 'B'
              : kpis.volume >= 1e6
                ? (kpis.volume / 1e6).toFixed(2) + 'M'
                : kpis.volume >= 1e3
                  ? (kpis.volume / 1e3).toFixed(0) + 'K'
                  : kpis.volume.toFixed(0)),
        },
        {
          label: 'Average Balance',
          value:
            '$' +
            (kpis.averageBalance >= 1e6
              ? (kpis.averageBalance / 1e6).toFixed(2) + 'M'
              : kpis.averageBalance >= 1e3
                ? (kpis.averageBalance / 1e3).toFixed(0) + 'K'
                : kpis.averageBalance.toFixed(0)),
        },
        { label: 'WAC', value: kpis.wac != null ? kpis.wac.toFixed(3) : '—' },
        { label: 'WAM', value: kpis.wam != null ? kpis.wam.toFixed(1) : '—' },
        { label: 'WA FICO', value: kpis.waFico != null ? kpis.waFico.toFixed(1) : '—' },
        {
          label: 'WA LTV',
          value: kpis.waLtv != null ? kpis.waLtv.toFixed(1) + '%' : '—',
        },
        {
          label: 'WA DTI',
          value: kpis.waDti != null ? kpis.waDti.toFixed(1) + '%' : '—',
        },
      ]
    : [];

  const gridEl = items.length ? (
    <div
      className="grid w-full min-w-0 grid-cols-2 gap-3"
      style={{ ['--kpi-font-scale' as string]: fontScale }}
    >
      {items.map((item) => (
        <div
          key={item.label}
          className="flex min-w-0 flex-col items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/30 p-3 text-center"
          style={{ minHeight: `calc(${BOX_MIN_HEIGHT_BASE}px * var(--kpi-font-scale))` }}
        >
          <p
            className="mb-1 text-slate-500 dark:text-slate-400"
            style={{ fontSize: 'calc(0.75rem * var(--kpi-font-scale))' }}
          >
            {item.label}
          </p>
          <p
            className="font-semibold tabular-nums text-slate-900 dark:text-slate-100"
            style={{ fontSize: 'calc(1.125rem * var(--kpi-font-scale))' }}
          >
            {item.value}
          </p>
        </div>
      ))}
    </div>
  ) : null;

  return (
    <Card className="border border-slate-200 dark:border-slate-700 h-full flex flex-col">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-semibold">KPIs</CardTitle>
      </CardHeader>
      <CardContent className="pt-0 flex-1 min-h-0 min-w-0 flex items-start overflow-x-hidden overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-8 w-full">
            <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
          </div>
        ) : gridEl ? (
          <div className="w-full min-w-0">{gridEl}</div>
        ) : (
          <p className="text-sm text-slate-500">No KPI data</p>
        )}
      </CardContent>
    </Card>
  );
}
