/**
 * Per–workbench instance custom columns for the Loan Detail table.
 * Keyed by canvasItemId so each widget can have its own column set.
 */

import { create } from 'zustand';

/** Store key for the standalone Loan Detail dashboard page (never overlaps workbench widget ids). */
export const LOAN_DETAIL_STANDALONE_COLUMNS_STORE_ID = '__standalone_loan_detail_page__';

/** Sentinel used in SavedLoanDetailColumn.field when the user has not picked a field yet (matches modal). */
const BLANK_FIELD_SENTINEL = '__blank__';

export interface SavedLoanDetailColumn {
  id: string;
  label: string;
  field: string | null;
}

/** ColumnDef-compatible shape for table wiring (avoids importing LoanDetailView into this module). */
export type SavedLoanDetailColumnDef = {
  id: string;
  label: string;
  field: string | null;
};

/** Maps persisted columns to table defs; same rules as WidgetGroup loan-detail wiring. */
export function savedColumnsToColumnDefs(
  saved: SavedLoanDetailColumn[] | undefined,
): SavedLoanDetailColumnDef[] | undefined {
  if (!saved?.length) return undefined;
  const mapped = saved
    .filter((c) => c.field !== BLANK_FIELD_SENTINEL)
    .map((c) => ({ id: c.id, label: c.label, field: c.field }));
  return mapped.length ? mapped : undefined;
}

interface LoanDetailColumnsState {
  /** canvasItemId -> list of column definitions */
  byItem: Record<string, SavedLoanDetailColumn[]>;
  getColumns: (canvasItemId: string) => SavedLoanDetailColumn[] | undefined;
  setColumns: (canvasItemId: string, columns: SavedLoanDetailColumn[]) => void;
  clearColumns: (canvasItemId: string) => void;
}

export const useLoanDetailColumnsStore = create<LoanDetailColumnsState>((set, get) => ({
  byItem: {},
  getColumns: (canvasItemId: string) => get().byItem[canvasItemId],
  setColumns: (canvasItemId: string, columns: SavedLoanDetailColumn[]) =>
    set((state) => ({
      byItem: { ...state.byItem, [canvasItemId]: columns },
    })),
  clearColumns: (canvasItemId: string) =>
    set((state) => {
      const next = { ...state.byItem };
      delete next[canvasItemId];
      return { byItem: next };
    }),
}));
