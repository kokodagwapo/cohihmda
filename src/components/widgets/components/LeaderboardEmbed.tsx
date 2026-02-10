/**
 * LeaderboardEmbed – Widget wrapper that renders the full
 * LeaderBoardSection component inside a WidgetGroup cell.
 *
 * Preserves all interactive features: top-5 cards with rank badges,
 * collapsible ranks 6-10 table, scope/period/metric filters,
 * drill-down modals with per-metric rankings, badges, and streaks.
 */

import React from 'react';
import { LeaderBoardSection } from '@/components/dashboard/LeaderBoardSection';
import { useTenantStore } from '@/stores/tenantStore';
import { useChannelStore } from '@/stores/channelStore';
import type { WidgetRenderProps } from '../registry/types';

function LeaderboardEmbedInner({ width, height }: WidgetRenderProps) {
  const { selectedTenantId } = useTenantStore();
  const { selectedChannel } = useChannelStore();

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
      />
    </div>
  );
}

export const LeaderboardEmbed = React.memo(LeaderboardEmbedInner);
