/**
 * WorkflowConversionEmbed – Single workbench widget that renders the full
 * Workflow Conversion view: period, calculation, grouping, reset, and 6-card grid.
 * State is persisted via config.workflowState and onConfigChange so it survives canvas save/reload.
 */

import React, { useCallback } from 'react';
import { WorkflowConversionView } from '@/components/views/WorkflowConversionView';
import type { WorkflowConversionSavedState } from '@/components/views/WorkflowConversionView';
import { useTenantStore } from '@/stores/tenantStore';
import { useChannelStore } from '@/stores/channelStore';
import type { WidgetRenderProps } from '../registry/types';

function WorkflowConversionEmbedInner({ width, height, config, onConfigChange }: WidgetRenderProps) {
  const { selectedTenantId } = useTenantStore();
  const { selectedChannel } = useChannelStore();

  const initialState = config?.workflowState as WorkflowConversionSavedState | undefined;
  const handleStateChange = useCallback(
    (state: WorkflowConversionSavedState) => {
      onConfigChange?.({ workflowState: state });
    },
    [onConfigChange],
  );

  return (
    <div
      className="h-full w-full overflow-auto bg-white dark:bg-slate-900/80 rounded-lg"
      style={{ width, minHeight: height }}
    >
      <WorkflowConversionView
        selectedTenantId={selectedTenantId}
        selectedChannel={selectedChannel}
        embeddedInWorkbench
        initialState={initialState}
        onStateChange={onConfigChange ? handleStateChange : undefined}
      />
    </div>
  );
}

export const WorkflowConversionEmbed = React.memo(WorkflowConversionEmbedInner);
