/**
 * FinancialModelingEmbed – Widget wrapper that renders the full
 * FinancialModelingSandboxView component inside a WidgetGroup cell.
 */

import React from 'react';
import { FinancialModelingSandboxView } from '@/components/views/FinancialModelingSandboxView';
import { useTenantStore } from '@/stores/tenantStore';
import type { WidgetRenderProps } from '../registry/types';

function FinancialModelingEmbedInner({ width, height }: WidgetRenderProps) {
  const { selectedTenantId } = useTenantStore();

  return (
    <div
      className="h-full w-full overflow-auto bg-white dark:bg-slate-900/80"
      style={{ width, minHeight: height }}
    >
      <FinancialModelingSandboxView selectedTenantId={selectedTenantId} />
    </div>
  );
}

export const FinancialModelingEmbed = React.memo(FinancialModelingEmbedInner);
