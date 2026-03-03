/**
 * Standalone Pricing Dashboard (non-workbench) column config.
 * When viewing the Pricing Dashboard as a standalone page, column edits are stored here.
 */

import { create } from 'zustand';
import type { PricingDashboardColumnDef } from '@/lib/pricingDashboardColumns';
import { DEFAULT_PRICING_DASHBOARD_COLUMNS } from '@/lib/pricingDashboardColumns';

interface PricingDashboardStandaloneState {
  columns: PricingDashboardColumnDef[] | null;
  setColumns: (columns: PricingDashboardColumnDef[] | null) => void;
  getColumns: () => PricingDashboardColumnDef[];
}

export const usePricingDashboardStandaloneColumnsStore = create<PricingDashboardStandaloneState>((set, get) => ({
  columns: null,
  setColumns: (columns) => set({ columns }),
  getColumns: () => get().columns ?? DEFAULT_PRICING_DASHBOARD_COLUMNS,
}));
