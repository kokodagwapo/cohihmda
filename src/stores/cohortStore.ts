import { create } from 'zustand';
import { TopTieringSelectionItem, TopTieringActorType } from './topTieringSelectionStore';

export type Cohort = {
  id: string;
  name: string;
  description?: string;
  actor_type: TopTieringActorType;
  items: TopTieringSelectionItem[];
  is_adhoc: boolean;
  created_at: string;
  updated_at: string;
};

type CohortState = {
  cohorts: Cohort[];
  selectedCohortIds: Set<string>;
  loadedCohorts: Map<string, Cohort>;
  setCohorts: (cohorts: Cohort[]) => void;
  addCohort: (cohort: Cohort) => void;
  updateCohort: (id: string, cohort: Partial<Cohort>) => void;
  removeCohort: (id: string) => void;
  toggleCohortSelection: (id: string) => void;
  clearCohortSelection: () => void;
  loadCohort: (cohort: Cohort) => void;
  getSelectedCohorts: () => Cohort[];
};

export const useCohortStore = create<CohortState>((set, get) => ({
  cohorts: [],
  selectedCohortIds: new Set(),
  loadedCohorts: new Map(),
  setCohorts: (cohorts) => set({ cohorts }),
  addCohort: (cohort) => set((state) => ({ cohorts: [...state.cohorts, cohort] })),
  updateCohort: (id, updates) =>
    set((state) => ({
      cohorts: state.cohorts.map((c) => (c.id === id ? { ...c, ...updates } : c)),
      loadedCohorts: new Map(state.loadedCohorts).set(id, { ...state.loadedCohorts.get(id)!, ...updates }),
    })),
  removeCohort: (id) =>
    set((state) => {
      const newCohorts = state.cohorts.filter((c) => c.id !== id);
      const newSelected = new Set(state.selectedCohortIds);
      newSelected.delete(id);
      const newLoaded = new Map(state.loadedCohorts);
      newLoaded.delete(id);
      return { cohorts: newCohorts, selectedCohortIds: newSelected, loadedCohorts: newLoaded };
    }),
  toggleCohortSelection: (id) =>
    set((state) => {
      const newSelected = new Set(state.selectedCohortIds);
      if (newSelected.has(id)) {
        newSelected.delete(id);
      } else {
        newSelected.add(id);
      }
      return { selectedCohortIds: newSelected };
    }),
  clearCohortSelection: () => set({ selectedCohortIds: new Set() }),
  loadCohort: (cohort) =>
    set((state) => {
      const newLoaded = new Map(state.loadedCohorts);
      newLoaded.set(cohort.id, cohort);
      return { loadedCohorts: newLoaded };
    }),
  getSelectedCohorts: () => {
    const state = get();
    return state.cohorts.filter((c) => state.selectedCohortIds.has(c.id));
  },
}));
