/**
 * WorkflowConversionEmbed – Single workbench widget that renders the full
 * Workflow Conversion view: period, calculation, grouping, reset, and 6-card grid.
 * All state and data fetching are self-contained (same as the standalone page).
 */

import React from 'react';
import { WorkflowConversionView } from '@/components/views/WorkflowConversionView';
import { useTenantStore } from '@/stores/tenantStore';
import { useChannelStore } from '@/stores/channelStore';
import type { WidgetRenderProps } from '../registry/types';

function WorkflowConversionEmbedInner({ width, height }: WidgetRenderProps) {
  const { selectedTenantId } = useTenantStore();
  const { selectedChannel } = useChannelStore();

  return (
    <div
      className="h-full w-full overflow-auto bg-white dark:bg-slate-900/80 rounded-lg"
      style={{ width, minHeight: height }}
    >
      <WorkflowConversionView
        selectedTenantId={selectedTenantId}
        selectedChannel={selectedChannel}
        embeddedInWorkbench
      />
    </div>
  );
}

export const WorkflowConversionEmbed = React.memo(WorkflowConversionEmbedInner);
