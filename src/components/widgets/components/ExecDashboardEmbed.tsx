/**
 * ExecDashboardEmbed – Widget wrapper that renders the full
 * ExecutiveDashboard component inside a WidgetGroup cell.
 */

import React, { useCallback } from 'react';
import { ExecutiveDashboard } from '@/components/dashboard/ExecutiveDashboard';
import { useTenantStore } from '@/stores/tenantStore';
import { useChannelStore } from '@/stores/channelStore';
import { useCanvasDataStore } from '@/stores/canvasDataStore';
import type { WidgetRenderProps } from '../registry/types';

const currentYear = new Date().getFullYear();

function ExecDashboardEmbedInner({ width, height, config }: WidgetRenderProps) {
  const { selectedTenantId } = useTenantStore();
  const { selectedChannel } = useChannelStore();
  const canvasItemId = config?.canvasItemId as string | undefined;
  const defName = (config?.definitionName as string) || 'Business Overview';
  const defCategory = (config?.definitionCategory as string) || 'kpi';
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
      <ExecutiveDashboard
        dateFilter="mtd"
        year={currentYear}
        selectedTenantId={selectedTenantId}
        selectedChannel={selectedChannel}
        onDataReady={onDataReady}
      />
    </div>
  );
}

export const ExecDashboardEmbed = React.memo(ExecDashboardEmbedInner);
