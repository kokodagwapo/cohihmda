/**
 * ExecDashboardEmbed – Widget wrapper that renders the full
 * ExecutiveDashboard component inside a WidgetGroup cell.
 *
 * Preserves all interactive features: per-KPI timeframe selectors,
 * click-to-open drill-down modals, animated values, loan mix breakdowns.
 */

import React from 'react';
import { ExecutiveDashboard } from '@/components/dashboard/ExecutiveDashboard';
import { useTenantStore } from '@/stores/tenantStore';
import { useChannelStore } from '@/stores/channelStore';
import type { WidgetRenderProps } from '../registry/types';

const currentYear = new Date().getFullYear();

function ExecDashboardEmbedInner({ width, height }: WidgetRenderProps) {
  const { selectedTenantId } = useTenantStore();
  const { selectedChannel } = useChannelStore();

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
      />
    </div>
  );
}

export const ExecDashboardEmbed = React.memo(ExecDashboardEmbedInner);
