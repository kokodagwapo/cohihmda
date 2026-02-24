/**
 * KPICard – atomic KPI widget component.
 *
 * Renders a single metric with:
 * - Large formatted value
 * - Label and optional subtitle
 * - Trend indicator (up/down/flat arrow + change text)
 * - Responsive sizing, dark mode support
 * - Optional click handler for drilldown
 *
 * Extracted from common patterns in CompanyScorecard, CreditRiskManagement,
 * and ExecutiveDashboard KPI cards.
 */

import React, { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import type { WidgetRenderProps, KPIData, KPIFormat } from '../registry/types';
import { WidgetShell } from './WidgetShell';

// ---------------------------------------------------------------------------
// Formatting utilities
// ---------------------------------------------------------------------------

export function formatKPIValue(value: number, format: KPIFormat): string {
  switch (format) {
    case 'currency':
      if (Math.abs(value) >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}B`;
      if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
      if (Math.abs(value) >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
      return `$${value.toLocaleString('en-US')}`;
    case 'percent':
      return `${value.toFixed(1)}%`;
    case 'days':
      return `${Math.round(value)}d`;
    case 'ratio':
      return value.toFixed(2);
    case 'number':
    default:
      return value.toLocaleString('en-US');
  }
}

function computeTrend(data: KPIData): { direction: 'up' | 'down' | 'flat'; label: string } | null {
  if (data.trend && data.change) {
    return { direction: data.trend, label: data.change };
  }
  if (data.previousValue !== undefined && data.previousValue !== 0) {
    const pctChange = ((data.value - data.previousValue) / Math.abs(data.previousValue)) * 100;
    if (Math.abs(pctChange) < 0.5) return { direction: 'flat', label: '0%' };
    return {
      direction: pctChange > 0 ? 'up' : 'down',
      label: `${pctChange > 0 ? '+' : ''}${pctChange.toFixed(1)}%`,
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface KPICardProps extends WidgetRenderProps<KPIData> {
  onClick?: () => void;
  showActions?: boolean;
  onRemove?: () => void;
  onDuplicate?: () => void;
}

export function KPICard({
  data,
  loading,
  error,
  width,
  height,
  config,
  onClick,
  showActions,
  onRemove,
  onDuplicate,
}: KPICardProps) {
  const trend = useMemo(() => (data ? computeTrend(data) : null), [data]);
  const isCompact = height < 120 || width < 180;

  const colorAccent = (config?.color as string) ?? 'blue';
  const accentClasses: Record<string, string> = {
    blue: 'from-blue-500/10 to-blue-600/5 dark:from-blue-500/15 dark:to-blue-600/10',
    emerald: 'from-emerald-500/10 to-emerald-600/5 dark:from-emerald-500/15 dark:to-emerald-600/10',
    amber: 'from-amber-500/10 to-amber-600/5 dark:from-amber-500/15 dark:to-amber-600/10',
    rose: 'from-rose-500/10 to-rose-600/5 dark:from-rose-500/15 dark:to-rose-600/10',
    indigo: 'from-indigo-500/10 to-indigo-600/5 dark:from-indigo-500/15 dark:to-indigo-600/10',
    violet: 'from-violet-500/10 to-violet-600/5 dark:from-violet-500/15 dark:to-violet-600/10',
    sky: 'from-sky-500/10 to-sky-600/5 dark:from-sky-500/15 dark:to-sky-600/10',
  };

  return (
    <WidgetShell
      loading={loading}
      error={error}
      showActions={showActions}
      onRemove={onRemove}
      onDuplicate={onDuplicate}
      compact
    >
      <button
        type="button"
        className={cn(
          'w-full h-full flex flex-col items-center justify-center text-center',
          'bg-gradient-to-br',
          accentClasses[colorAccent] ?? accentClasses.blue,
          'transition-all duration-200',
          onClick && 'cursor-pointer hover:shadow-md hover:scale-[1.01]',
          !onClick && 'cursor-default',
          isCompact ? 'gap-0.5 p-2' : 'gap-1 p-4',
        )}
        onClick={onClick}
        tabIndex={onClick ? 0 : -1}
        disabled={!onClick}
      >
        {/* Label */}
        <p
          className={cn(
            'uppercase tracking-wider text-slate-500 dark:text-slate-400 font-medium',
            isCompact ? 'text-[10px]' : 'text-xs',
          )}
        >
          {data?.label ?? '\u00A0'}
        </p>

        {/* Value */}
        <p
          className={cn(
            'font-bold text-slate-900 dark:text-slate-100 tabular-nums',
            isCompact ? 'text-lg' : 'text-2xl',
          )}
        >
          {data ? formatKPIValue(data.value, (config?.format as KPIFormat) ?? data.format) : '\u2014'}
        </p>

        {/* Trend */}
        {trend && (
          <div
            className={cn(
              'flex items-center gap-1',
              trend.direction === 'up' && 'text-emerald-600 dark:text-emerald-400',
              trend.direction === 'down' && 'text-rose-600 dark:text-rose-400',
              trend.direction === 'flat' && 'text-slate-400 dark:text-slate-500',
            )}
          >
            {trend.direction === 'up' && <TrendingUp className="h-3 w-3" />}
            {trend.direction === 'down' && <TrendingDown className="h-3 w-3" />}
            {trend.direction === 'flat' && <Minus className="h-3 w-3" />}
            <span className="text-[10px] font-medium">{trend.label}</span>
          </div>
        )}

        {/* Subtitle */}
        {data?.subtitle && (
          <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5 truncate max-w-full">
            {data.subtitle}
          </p>
        )}
      </button>
    </WidgetShell>
  );
}
