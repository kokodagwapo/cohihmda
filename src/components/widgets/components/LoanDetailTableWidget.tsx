/**
 * Workbench widget wrapper for Loan Detail table (uses section filters from WidgetDataProvider).
 * Supports custom columns from the column editor (config.customColumns).
 */

import React, { useMemo } from 'react';
import type { WidgetRenderProps } from '../registry/types';
import type { LoanDetailListResponse } from '@/hooks/useLoanDetailData';
import type { ColumnDef } from '@/components/views/LoanDetailView';
import { LoanDetailView } from '@/components/views/LoanDetailView';
import type { ColumnFilterState } from '@/utils/loanDetailFilters';

export function LoanDetailTableWidget({
  data,
  loading,
  error,
  width,
  height,
  config,
  onConfigChange,
}: WidgetRenderProps<LoanDetailListResponse | null>) {
  const periodLabel = config?.periodLabel as string | undefined;
  const filterSummary = config?.filterSummary as string | undefined;
  const columns = config?.customColumns as ColumnDef[] | undefined;
  const persistedFilters = (config?.loanDetailTableFilters ?? {}) as ColumnFilterState;
  const persistedBookmarkId = (config?.loanDetailSelectedBookmarkId ?? null) as string | null;
  const persistedBookmarkTitle = (config?.loanDetailSelectedBookmarkTitle ?? null) as string | null;

  const persistedWorkbenchState = useMemo(() => ({
    appliedFilters: persistedFilters,
    selectedBookmarkId: persistedBookmarkId,
    selectedBookmarkTitle: persistedBookmarkTitle,
  }), [persistedFilters, persistedBookmarkId, persistedBookmarkTitle]);

  const persist = (next: {
    appliedFilters: ColumnFilterState;
    selectedBookmarkId: string | null;
    selectedBookmarkTitle: string | null;
  }) => {
    if (!onConfigChange) return;
    const base = (config ?? {}) as Record<string, unknown>;
    const merged = {
      ...base,
      loanDetailTableFilters: next.appliedFilters,
      loanDetailSelectedBookmarkId: next.selectedBookmarkId,
      loanDetailSelectedBookmarkTitle: next.selectedBookmarkTitle,
    };
    // Avoid noisy re-persist loops if nothing changed (config objects are often recreated).
    const prevJson = JSON.stringify({
      loanDetailTableFilters: base.loanDetailTableFilters ?? {},
      loanDetailSelectedBookmarkId: base.loanDetailSelectedBookmarkId ?? null,
      loanDetailSelectedBookmarkTitle: base.loanDetailSelectedBookmarkTitle ?? null,
    });
    const nextJson = JSON.stringify({
      loanDetailTableFilters: merged.loanDetailTableFilters ?? {},
      loanDetailSelectedBookmarkId: merged.loanDetailSelectedBookmarkId ?? null,
      loanDetailSelectedBookmarkTitle: merged.loanDetailSelectedBookmarkTitle ?? null,
    });
    if (prevJson === nextJson) return;
    onConfigChange(merged);
  };
  return (
    <div className="h-full w-full flex flex-col min-h-0 overflow-hidden">
      <div className="flex-1 min-h-0 min-w-0 flex flex-col overflow-hidden">
        <LoanDetailView
          data={data}
          loading={loading}
          error={error}
          fillHeight
          periodLabel={periodLabel}
          filterSummary={filterSummary}
          columns={columns}
          syncFiltersToUrl={false}
          persistedWorkbenchState={persistedWorkbenchState}
          onPersistedWorkbenchStateChange={persist}
        />
      </div>
    </div>
  );
}
