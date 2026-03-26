/**
 * IndustryNewsEmbed – Widget wrapper that renders the full
 * IndustryNewsCard component inside a WidgetGroup cell.
 */

import React, { useCallback } from 'react';
import { IndustryNewsCard } from '@/components/dashboard/IndustryNewsCard';
import { useCanvasDataStore } from '@/stores/canvasDataStore';
import type { WidgetRenderProps } from '../registry/types';

function IndustryNewsEmbedInner({ width, height, config }: WidgetRenderProps) {
  const canvasItemId = config?.canvasItemId as string | undefined;
  const defName = (config?.definitionName as string) || 'Mortgage Industry News';
  const defCategory = (config?.definitionCategory as string) || 'other';
  const reportWidgetData = useCanvasDataStore((s) => s.reportWidgetData);

  const onDataReady = useCallback((payload: unknown) => {
    if (!canvasItemId) return;
    reportWidgetData(canvasItemId, {
      widgetName: defName,
      category: defCategory as 'chart' | 'table' | 'kpi' | 'embed' | 'other',
      data: payload,
    });
  }, [canvasItemId, defName, defCategory, reportWidgetData]);

  return (
    <div
      className="h-full w-full overflow-auto bg-white dark:bg-slate-900/80"
      style={{ width, minHeight: height }}
    >
      <IndustryNewsCard onDataReady={onDataReady} />
    </div>
  );
}

export const IndustryNewsEmbed = React.memo(IndustryNewsEmbedInner);
