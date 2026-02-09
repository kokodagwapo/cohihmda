/**
 * DistributionBars – horizontal bar distribution visualization.
 *
 * Extracted from the FICO/LTV/DTI distribution charts in CreditRiskManagement.
 * Renders a list of labeled horizontal bars with value + percentage.
 */

import React from 'react';
import { cn } from '@/lib/utils';
import type { WidgetRenderProps, DistributionData } from '../registry/types';
import { WidgetShell } from './WidgetShell';

const DEFAULT_COLORS = [
  'bg-blue-500', 'bg-emerald-500', 'bg-amber-500', 'bg-rose-500',
  'bg-indigo-500', 'bg-sky-500', 'bg-violet-500', 'bg-orange-500',
];

export interface DistributionBarsProps extends WidgetRenderProps<DistributionData> {
  showActions?: boolean;
  onRemove?: () => void;
  onDuplicate?: () => void;
}

export function DistributionBars({
  data,
  loading,
  error,
  showActions,
  onRemove,
  onDuplicate,
}: DistributionBarsProps) {
  const maxValue = data ? Math.max(...data.bars.map((b) => b.value), 1) : 1;

  return (
    <WidgetShell
      title={data?.title}
      loading={loading}
      error={error}
      showActions={showActions}
      onRemove={onRemove}
      onDuplicate={onDuplicate}
    >
      <div className="p-3 flex flex-col gap-2">
        {data?.bars.map((bar, i) => {
          const pct = bar.total > 0 ? (bar.value / bar.total) * 100 : 0;
          const widthPct = maxValue > 0 ? (bar.value / maxValue) * 100 : 0;
          const colorClass = bar.color ?? DEFAULT_COLORS[i % DEFAULT_COLORS.length];

          return (
            <div key={bar.label} className="flex items-center gap-2">
              {/* Label */}
              <span className="w-20 shrink-0 text-xs text-slate-600 dark:text-slate-400 text-right truncate font-medium">
                {bar.label}
              </span>

              {/* Bar track */}
              <div className="flex-1 h-5 bg-slate-100 dark:bg-slate-800 rounded-md overflow-hidden relative">
                <div
                  className={cn('h-full rounded-md transition-all duration-500', colorClass)}
                  style={{ width: `${widthPct}%` }}
                />
              </div>

              {/* Value + percentage */}
              <span className="w-20 shrink-0 text-xs tabular-nums text-slate-700 dark:text-slate-300 font-medium">
                {bar.value.toLocaleString('en-US')}
                <span className="text-slate-400 dark:text-slate-500 ml-1">
                  ({pct.toFixed(1)}%)
                </span>
              </span>
            </div>
          );
        })}
      </div>
    </WidgetShell>
  );
}
