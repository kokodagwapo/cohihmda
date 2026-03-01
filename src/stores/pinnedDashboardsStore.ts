/**
 * Store for dashboards pinned from the top nav DASHBOARD menu.
 * Pinned items appear in the sidebar under "Dashboard".
 * Sidebar is empty until user pins; pin action is on top nav only.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type SectionId =
  | 'aletheiaInsights'
  | 'industryNews'
  | 'leaderboard'
  | 'executiveDashboard'
  | 'closingFalloutForecast'
  | 'topTiering'
  | 'trends'
  | 'forecasting'
  | 'kpiReports'
  | 'financialModeling'
  | 'myWorkbench';

export type PinnedItem =
  | { type: 'section'; id: SectionId }
  | { type: 'route'; id: string; path: string; label: string };

function isPinnedItem(a: PinnedItem, b: PinnedItem): boolean {
  if (a.type !== b.type || a.id !== b.id) return false;
  if (a.type === 'route' && b.type === 'route') return a.path === b.path;
  return true;
}

function getPinnedItemId(item: PinnedItem): string {
  if (item.type === 'section') return `section-${item.id}`;
  return `route-${item.id}-${item.path}`;
}

type PinnedDashboardsState = {
  pinned: PinnedItem[];
  addPinned: (item: PinnedItem) => void;
  removePinned: (item: PinnedItem) => void;
  togglePinned: (item: PinnedItem) => void;
  reorderPinned: (orderedIds: string[]) => void;
  isPinned: (item: PinnedItem) => boolean;
  getPinnedItemId: (item: PinnedItem) => string;
};

export const usePinnedDashboardsStore = create<PinnedDashboardsState>()(
  persist(
    (set, get) => ({
      pinned: [],
      addPinned: (item) =>
        set((state) => {
          if (state.pinned.some((p) => isPinnedItem(p, item))) return state;
          return { pinned: [...state.pinned, item] };
        }),
      removePinned: (item) =>
        set((state) => ({
          pinned: state.pinned.filter((p) => !isPinnedItem(p, item)),
        })),
      togglePinned: (item) =>
        set((state) => {
          const exists = state.pinned.some((p) => isPinnedItem(p, item));
          if (exists) {
            return { pinned: state.pinned.filter((p) => !isPinnedItem(p, item)) };
          }
          return { pinned: [...state.pinned, item] };
        }),
      reorderPinned: (orderedIds) =>
        set((state) => {
          const idToItem = new Map<string, PinnedItem>();
          state.pinned.forEach((p) => idToItem.set(getPinnedItemId(p), p));
          const reordered = orderedIds
            .map((id) => idToItem.get(id))
            .filter((p): p is PinnedItem => p != null);
          if (reordered.length !== state.pinned.length) return state;
          return { pinned: reordered };
        }),
      isPinned: (item) => get().pinned.some((p) => isPinnedItem(p, item)),
      getPinnedItemId,
    }),
    { name: 'cohi-sidebar-pinned' }
  )
);
