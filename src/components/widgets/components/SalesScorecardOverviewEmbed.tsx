/**
 * SalesScorecardOverviewEmbed – workbench widget that renders the Sales Scorecard Overview
 * view (pipeline stage chart and/or table). Filter state comes from the group.
 * config.variant: 'chart' | 'table' | undefined (full)
 */

import React, { useCallback } from 'react';
import { SalesScorecardOverviewView } from '@/components/views/SalesScorecardOverviewView';
import type { SalesScorecardOverviewMeasure } from '@/hooks/useSalesScorecardOverviewData';
import { useCanvasDataStore } from '@/stores/canvasDataStore';
import type { WidgetRenderProps } from '../registry/types';

function formatScorecard(value: number, measure: SalesScorecardOverviewMeasure): string {
  if (measure === 'volume') {
    if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
    if (value >= 1_000) return `${(value / 1_000).toFixed(2)}K`;
    return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
  }
  return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

const STAGE_COLORS = ['#1e3a5f', '#3b82f6', '#15803d', '#f59e0b', '#ef4444', '#6366f1', '#8b5cf6', '#a855f7'];

function SalesScorecardOverviewEmbedInner({ width, height, config }: WidgetRenderProps) {
  const groupId = config?.groupId as string | undefined;
  const variant = (config?.variant as 'chart' | 'table' | 'full') || 'full';
  const canvasItemId = config?.canvasItemId as string | undefined;
  const defName = (config?.definitionName as string) || 'Sales Scorecard Overview';
  const defCategory = (config?.definitionCategory as string) || 'chart';
  const reportWidgetData = useCanvasDataStore((s) => s.reportWidgetData);

  const onDataReady = useCallback(
    (chartData: Record<string, unknown>[], milestoneLabels: string[], measure: SalesScorecardOverviewMeasure) => {
      if (!canvasItemId || chartData.length === 0) return;
      const xKey = 'period';
      const yKeys = milestoneLabels;

      if (defCategory === 'table') {
        const columns = [
          { key: 'period', label: 'Period', align: 'left' as const },
          ...yKeys.map((k) => ({ key: k, label: k, align: 'right' as const })),
        ];
        const rows = chartData.map((row) => {
          const formatted: Record<string, string | number> = { period: String(row[xKey] ?? '') };
          for (const k of yKeys) {
            const raw = typeof row[k] === 'number' ? (row[k] as number) : 0;
            formatted[k] = formatScorecard(raw, measure);
          }
          return formatted;
        });

        reportWidgetData(canvasItemId, {
          widgetName: defName,
          category: 'table',
          data: { columns, rows, title: defName },
        });
      } else {
        reportWidgetData(canvasItemId, {
          widgetName: defName,
          category: defCategory as 'chart' | 'table' | 'kpi' | 'embed' | 'other',
          data: {
            chartType: 'bar',
            xAxisKey: xKey,
            series: yKeys.map((k, i) => ({ dataKey: k, color: STAGE_COLORS[i % STAGE_COLORS.length] })),
            data: chartData,
            title: defName,
          },
        });
      }
    },
    [canvasItemId, defName, defCategory, reportWidgetData],
  );

  return (
    <div
      className="h-full w-full overflow-auto bg-white dark:bg-slate-900/80 rounded-lg"
      style={{ width, minHeight: height }}
    >
      <SalesScorecardOverviewView
        embeddedInWorkbench
        groupId={groupId ?? null}
        variant={variant}
        onDataReady={onDataReady}
      />
    </div>
  );
}

export const SalesScorecardOverviewEmbed = React.memo(SalesScorecardOverviewEmbedInner);
