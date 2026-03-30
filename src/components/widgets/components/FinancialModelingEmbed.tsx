/**
 * FinancialModelingEmbed – Widget wrapper that renders the full
 * FinancialModelingSandboxView component inside a WidgetGroup cell.
 */

import React, { useCallback } from 'react';
import { FinancialModelingSandboxView } from '@/components/views/FinancialModelingSandboxView';
import { useTenantStore } from '@/stores/tenantStore';
import { useCanvasDataStore } from '@/stores/canvasDataStore';
import type { WidgetRenderProps } from '../registry/types';

function FinancialModelingEmbedInner({ width, height, config }: WidgetRenderProps) {
  const { selectedTenantId } = useTenantStore();
  const canvasItemId = config?.canvasItemId as string | undefined;
  const defName = (config?.definitionName as string) || 'Financial Modeling Sandbox';
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
      <FinancialModelingSandboxView
        selectedTenantId={selectedTenantId}
        onDataReady={onDataReady}
      />
    </div>
  );
}

export const FinancialModelingEmbed = React.memo(FinancialModelingEmbedInner);
