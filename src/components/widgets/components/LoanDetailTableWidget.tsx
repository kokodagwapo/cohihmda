/**
 * Workbench widget wrapper for Loan Detail table (uses section filters from WidgetDataProvider).
 */

import React from 'react';
import type { WidgetRenderProps } from '../registry/types';
import type { LoanDetailListResponse } from '@/hooks/useLoanDetailData';
import { LoanDetailView } from '@/components/views/LoanDetailView';

export function LoanDetailTableWidget({
  data,
  loading,
  error,
  width,
  height,
  config,
}: WidgetRenderProps<LoanDetailListResponse | null>) {
  const periodLabel = config?.periodLabel as string | undefined;
  return (
    <div className="h-full w-full flex flex-col min-h-0 overflow-hidden">
      <div className="flex-1 min-h-0 min-w-0 flex flex-col overflow-hidden">
        <LoanDetailView
          data={data}
          loading={loading}
          error={error}
          fillHeight
          periodLabel={periodLabel}
        />
      </div>
    </div>
  );
}
