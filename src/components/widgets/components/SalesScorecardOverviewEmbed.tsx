/**
 * SalesScorecardOverviewEmbed – workbench widget that renders the Sales Scorecard Overview
 * view (pipeline stage chart and/or table). Filter state comes from the group.
 * config.variant: 'chart' | 'table' | undefined (full)
 */

import React from 'react';
import { SalesScorecardOverviewView } from '@/components/views/SalesScorecardOverviewView';
import type { WidgetRenderProps } from '../registry/types';

function SalesScorecardOverviewEmbedInner({ width, height, config }: WidgetRenderProps) {
  const groupId = config?.groupId as string | undefined;
  const variant = (config?.variant as 'chart' | 'table' | 'full') || 'full';

  return (
    <div
      className="h-full w-full overflow-auto bg-white dark:bg-slate-900/80 rounded-lg"
      style={{ width, minHeight: height }}
    >
      <SalesScorecardOverviewView
        embeddedInWorkbench
        groupId={groupId ?? null}
        variant={variant}
      />
    </div>
  );
}

export const SalesScorecardOverviewEmbed = React.memo(SalesScorecardOverviewEmbedInner);
