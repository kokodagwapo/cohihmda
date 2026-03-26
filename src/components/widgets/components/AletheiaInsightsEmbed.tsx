/**
 * AletheiaInsightsEmbed – Widget wrapper that renders the full
 * AletheiaPromptsCard component inside a WidgetGroup cell.
 */

import React, { useCallback } from 'react';
import { AletheiaPromptsCard } from '@/components/dashboard/AletheiaPromptsCard';
import { useTenantStore } from '@/stores/tenantStore';
import { useChannelStore } from '@/stores/channelStore';
import { useCanvasDataStore } from '@/stores/canvasDataStore';
import type { WidgetRenderProps } from '../registry/types';

function AletheiaInsightsEmbedInner({ width, height, config }: WidgetRenderProps) {
  const { selectedTenantId } = useTenantStore();
  const { selectedChannel } = useChannelStore();
  const canvasItemId = config?.canvasItemId as string | undefined;
  const defName = (config?.definitionName as string) || 'Cohi Daily Briefings';
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
      <AletheiaPromptsCard
        dateFilter="mtd"
        selectedTenantId={selectedTenantId}
        selectedChannel={selectedChannel}
        onDataReady={onDataReady}
      />
    </div>
  );
}

export const AletheiaInsightsEmbed = React.memo(AletheiaInsightsEmbedInner);
