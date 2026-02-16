/**
 * AletheiaInsightsEmbed – Widget wrapper that renders the full
 * AletheiaPromptsCard component inside a WidgetGroup cell.
 */

import React from 'react';
import { AletheiaPromptsCard } from '@/components/dashboard/AletheiaPromptsCard';
import { useTenantStore } from '@/stores/tenantStore';
import { useChannelStore } from '@/stores/channelStore';
import type { WidgetRenderProps } from '../registry/types';

function AletheiaInsightsEmbedInner({ width, height }: WidgetRenderProps) {
  const { selectedTenantId } = useTenantStore();
  const { selectedChannel } = useChannelStore();

  return (
    <div
      className="h-full w-full overflow-auto bg-white dark:bg-slate-900/80"
      style={{ width, minHeight: height }}
    >
      <AletheiaPromptsCard
        dateFilter="mtd"
        selectedTenantId={selectedTenantId}
        selectedChannel={selectedChannel}
      />
    </div>
  );
}

export const AletheiaInsightsEmbed = React.memo(AletheiaInsightsEmbedInner);
