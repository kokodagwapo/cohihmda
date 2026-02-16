/**
 * ClosingForecastEmbed – Widget wrapper that renders the full
 * ClosingFalloutForecast component inside a WidgetGroup cell.
 */

import React from 'react';
import { ClosingFalloutForecast } from '@/components/dashboard/ClosingFalloutForecast';
import { useTenantStore } from '@/stores/tenantStore';
import { useChannelStore } from '@/stores/channelStore';
import type { WidgetRenderProps } from '../registry/types';

function ClosingForecastEmbedInner({ width, height }: WidgetRenderProps) {
  const { selectedTenantId } = useTenantStore();
  const { selectedChannel } = useChannelStore();

  return (
    <div
      className="h-full w-full overflow-auto bg-white dark:bg-slate-900/80"
      style={{ width, minHeight: height }}
    >
      <ClosingFalloutForecast
        dateFilter="mtd"
        selectedTenantId={selectedTenantId}
        selectedChannel={selectedChannel}
      />
    </div>
  );
}

export const ClosingForecastEmbed = React.memo(ClosingForecastEmbedInner);
