/**
 * LockStratificationEmbed – workbench widget that renders a single Lock Stratification
 * section (KPIs, Interest Rates, Days to Expiration, Pull Through, Milestone Bar, or Milestone Pivot).
 *
 * Height strategy: we receive exact pixel `width` and `height` from the grid cell
 * and set them via inline styles so the container has a concrete size.
 * CSS percentage-heights (h-full) break inside flex-computed ancestors, so we
 * bypass that by threading the pixel height all the way through.
 */

import React from 'react';
import { LockStratificationView, type LockStratificationVariant } from '@/components/views/LockStratificationView';
import type { WidgetRenderProps } from '../registry/types';
import { useTenantStore } from '@/stores/tenantStore';

function LockStratificationEmbedInner({ width, height, config }: WidgetRenderProps) {
  const groupId = config?.groupId as string | undefined;
  const variant = (config?.variant as LockStratificationVariant) || 'full';
  const { selectedTenantId } = useTenantStore();

  return (
    <div
      style={{ width, height }}
      className="overflow-hidden bg-white dark:bg-slate-900/80 rounded-lg flex flex-col"
    >
      <LockStratificationView
        tenantId={selectedTenantId ?? null}
        selectedChannel={null}
        embeddedInWorkbench
        groupId={groupId ?? null}
        variant={variant}
        embedHeight={height}
        embedWidth={width}
      />
    </div>
  );
}

export const LockStratificationEmbed = React.memo(LockStratificationEmbedInner);
