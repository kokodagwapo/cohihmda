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
import { useCanvasDataStore } from '@/stores/canvasDataStore';
import type { WidgetRenderProps } from '../registry/types';
import type { PeriodSelection } from '@/components/ui/DatePeriodPicker';

export interface WorkflowConversionState {
  periodSelection?: PeriodSelection;
  calculationType?: 'conversion' | 'turn_time';
  grouping?: 'workflow' | 'individual';
  segments?: { from: string; to: string }[];
}

function WorkflowConversionEmbedInner({ width, height, config, onConfigChange }: WidgetRenderProps) {
  const { selectedTenantId } = useTenantStore();
  const { selectedChannel } = useChannelStore();
  const canvasItemId = config?.canvasItemId as string | undefined;
  const defName = (config?.definitionName as string) || 'Workflow Conversion';
  const defCategory = (config?.definitionCategory as string) || 'chart';
  const reportWidgetData = useCanvasDataStore((s) => s.reportWidgetData);

  const initialState = config?.workflowState as WorkflowConversionSavedState | undefined;
  const handleStateChange = useCallback(
    (state: WorkflowConversionSavedState) => {
      onConfigChange?.({ workflowState: state });
    },
    [onConfigChange],
  );

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
      className="h-full w-full overflow-auto bg-white dark:bg-slate-900/80 rounded-lg"
      style={{ width, minHeight: height }}
    >
      <WorkflowConversionView
        selectedTenantId={selectedTenantId}
        selectedChannel={selectedChannel}
        embeddedInWorkbench
        initialState={initialState}
        onStateChange={onConfigChange ? handleStateChange : undefined}
        groupId={config?.groupId}
        onDataReady={onDataReady}
      />
    </div>
  );
}

export const WorkflowConversionEmbed = React.memo(WorkflowConversionEmbedInner);
