/**
 * IndustryNewsEmbed – Widget wrapper that renders the full
 * IndustryNewsCard component inside a WidgetGroup cell.
 */

import React from 'react';
import { IndustryNewsCard } from '@/components/dashboard/IndustryNewsCard';
import type { WidgetRenderProps } from '../registry/types';

function IndustryNewsEmbedInner({ width, height }: WidgetRenderProps) {
  return (
    <div
      className="h-full w-full overflow-auto bg-white dark:bg-slate-900/80"
      style={{ width, minHeight: height }}
    >
      <IndustryNewsCard />
    </div>
  );
}

export const IndustryNewsEmbed = React.memo(IndustryNewsEmbedInner);
