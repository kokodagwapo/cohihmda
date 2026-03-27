/**
 * LeaderboardEmbed – Widget wrapper that renders the full
 * LeaderBoardSection component inside a WidgetGroup cell.
 */

import React, { useCallback } from 'react';
import { LeaderBoardSection } from '@/components/dashboard/LeaderBoardSection';
import { useTenantStore } from '@/stores/tenantStore';
import { useChannelStore } from '@/stores/channelStore';
import { useCanvasDataStore } from '@/stores/canvasDataStore';
import type { WidgetRenderProps } from '../registry/types';

function LeaderboardEmbedInner({ width, height, config }: WidgetRenderProps) {
  const { selectedTenantId } = useTenantStore();
  const { selectedChannel } = useChannelStore();
  const canvasItemId = config?.canvasItemId as string | undefined;
  const defName = (config?.definitionName as string) || 'Leaderboard';
  const defCategory = (config?.definitionCategory as string) || 'table';
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
      <LeaderBoardSection
        dateFilter="mtd"
        selectedTenantId={selectedTenantId}
        selectedChannel={selectedChannel}
        hideAvatar
        onDataReady={onDataReady}
      />
    </div>
  );
}

export const LeaderboardEmbed = React.memo(LeaderboardEmbedInner);
