import { create } from 'zustand';

export type TopTieringActorType = 'branch' | 'loan-officer';

export type TopTieringSelectionItem = {
  id: string;
  name: string;
  tier: 'top' | 'second' | 'bottom';
  revenue: number;
  units: number;
  volume: number;
  revenueBPS: number;
  revenuePerLoan: number;
};

type TopTieringSelectionState = {
  actorType: TopTieringActorType;
  selectedItems: TopTieringSelectionItem[];
  setSelection: (actorType: TopTieringActorType, items: TopTieringSelectionItem[]) => void;
  clearSelection: () => void;
};

export const useTopTieringSelectionStore = create<TopTieringSelectionState>((set) => ({
  actorType: 'branch',
  selectedItems: [],
  setSelection: (actorType, items) => set({ actorType, selectedItems: items }),
  clearSelection: () => set({ selectedItems: [] }),
}));
