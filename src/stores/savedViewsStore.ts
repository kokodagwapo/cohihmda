import { create } from 'zustand';
import { SavedView, SavedViewsTab, SavedViewApplyResult } from '@/types/savedViews';

type SavedViewsState = {
  menuOpen: boolean;
  activeTab: SavedViewsTab;
  selectedView: SavedView | null;
  editingViewId: string | null;
  sharingViewId: string | null;
  pendingApplyView: SavedView | null;
  lastApplyResult: SavedViewApplyResult | null;
  warningBanner: string | null;
  setMenuOpen: (open: boolean) => void;
  setActiveTab: (tab: SavedViewsTab) => void;
  setSelectedView: (view: SavedView | null) => void;
  setEditingViewId: (id: string | null) => void;
  setSharingViewId: (id: string | null) => void;
  setPendingApplyView: (view: SavedView | null) => void;
  setLastApplyResult: (result: SavedViewApplyResult | null) => void;
  setWarningBanner: (message: string | null) => void;
  resetPanels: () => void;
};

export const useSavedViewsStore = create<SavedViewsState>((set) => ({
  menuOpen: false,
  activeTab: 'my',
  selectedView: null,
  editingViewId: null,
  sharingViewId: null,
  pendingApplyView: null,
  lastApplyResult: null,
  warningBanner: null,
  setMenuOpen: (menuOpen) => set({ menuOpen }),
  setActiveTab: (activeTab) => set({ activeTab }),
  setSelectedView: (selectedView) => set({ selectedView }),
  setEditingViewId: (editingViewId) => set({ editingViewId }),
  setSharingViewId: (sharingViewId) => set({ sharingViewId }),
  setPendingApplyView: (pendingApplyView) => set({ pendingApplyView }),
  setLastApplyResult: (lastApplyResult) => set({ lastApplyResult }),
  setWarningBanner: (warningBanner) => set({ warningBanner }),
  resetPanels: () => set({ editingViewId: null, sharingViewId: null }),
}));
