/**
 * Per–workbench instance custom columns for the Loan Detail table.
 * Keyed by canvasItemId so each widget can have its own column set.
 */

import { create } from 'zustand';

export interface SavedLoanDetailColumn {
  id: string;
  label: string;
  field: string | null;
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
