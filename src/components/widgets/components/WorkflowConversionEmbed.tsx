/**
 * WorkflowConversionEmbed – Single workbench widget that renders the full
 * Workflow Conversion view: period, calculation, grouping, reset, and 6-card grid.
 * When embedded in workbench, state can be initialized from and persisted to the canvas via config.
 */

import React from 'react';
import { WorkflowConversionView } from '@/components/views/WorkflowConversionView';
import { useTenantStore } from '@/stores/tenantStore';
import { useChannelStore } from '@/stores/channelStore';
import type { WidgetRenderProps } from '../registry/types';
import type { PeriodSelection } from '@/components/ui/DatePeriodPicker';

export interface WorkflowConversionState {
  periodSelection?: PeriodSelection;
  calculationType?: 'conversion' | 'turn_time';
  grouping?: 'workflow' | 'individual';
  segments?: { from: string; to: string }[];
}

function WorkflowConversionEmbedInner({ width, height, config }: WidgetRenderProps) {
  const { selectedTenantId } = useTenantStore();
  const { selectedChannel } = useChannelStore();

  const workflowInitialState = config?.workflowInitialState as WorkflowConversionState | undefined;
  const onWorkflowStateChange = config?.onWorkflowStateChange as
    | ((state: {
        periodSelection: PeriodSelection;
        calculationType: 'conversion' | 'turn_time';
        grouping: 'workflow' | 'individual';
        segments: { from: string; to: string }[];
      }) => void)
    | undefined;
  const groupId = config?.groupId as string | undefined;

  return (
    <div
      className="h-full w-full overflow-auto bg-white dark:bg-slate-900/80 rounded-lg"
      style={{ width, minHeight: height }}
    >
      <WorkflowConversionView
        selectedTenantId={selectedTenantId}
        selectedChannel={selectedChannel}
        embeddedInWorkbench
        groupId={groupId}
        initialWorkflowState={workflowInitialState}
        onWorkflowStateChange={onWorkflowStateChange}
      />
    </div>
  );
}

export const WorkflowConversionEmbed = React.memo(WorkflowConversionEmbedInner);
