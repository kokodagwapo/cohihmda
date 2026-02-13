/**
 * filterPresetStore – Zustand store for named filter presets (bookmarks).
 *
 * Filter presets let users save a combination of date range, date field,
 * and dimension filters under a name, then apply them to any Cohi widget
 * or widget group with one click.
 *
 * MVP: persisted in localStorage keyed by tenant ID.
 */

import { create } from 'zustand';
import type { WidgetFilterState } from '@/components/workbench/canvas/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FilterPreset {
  id: string;
  name: string;
  filters: WidgetFilterState;
  createdAt: string;
}

interface FilterPresetState {
  /** All presets keyed by tenant ID → presets array */
  presetsByTenant: Record<string, FilterPreset[]>;

  /** Get presets for a specific tenant */
  getPresets: (tenantId: string) => FilterPreset[];

  /** Add a new preset */
  addPreset: (tenantId: string, name: string, filters: WidgetFilterState) => void;

  /** Remove a preset by ID */
  removePreset: (tenantId: string, presetId: string) => void;

  /** Rename a preset */
  renamePreset: (tenantId: string, presetId: string, newName: string) => void;

  /** Load presets from localStorage */
  loadFromStorage: () => void;
}

// ---------------------------------------------------------------------------
// localStorage helpers
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'cohi_filter_presets';

function readStorage(): Record<string, FilterPreset[]> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function writeStorage(data: Record<string, FilterPreset[]>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // storage full or unavailable — fail silently
  }
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

/** Stable empty array to avoid Zustand selector infinite re-render loops */
const EMPTY_PRESETS: FilterPreset[] = [];

export const useFilterPresetStore = create<FilterPresetState>((set, get) => ({
  presetsByTenant: readStorage(),

  getPresets: (tenantId: string) => {
    return get().presetsByTenant[tenantId] ?? EMPTY_PRESETS;
  },

  addPreset: (tenantId: string, name: string, filters: WidgetFilterState) => {
    const id = `preset-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const preset: FilterPreset = {
      id,
      name,
      filters,
      createdAt: new Date().toISOString(),
    };
    set((state) => {
      const existing = state.presetsByTenant[tenantId] || [];
      // Cap at 20 presets per tenant
      const updated = [...existing, preset].slice(-20);
      const next = { ...state.presetsByTenant, [tenantId]: updated };
      writeStorage(next);
      return { presetsByTenant: next };
    });
  },

  removePreset: (tenantId: string, presetId: string) => {
    set((state) => {
      const existing = state.presetsByTenant[tenantId] || [];
      const updated = existing.filter((p) => p.id !== presetId);
      const next = { ...state.presetsByTenant, [tenantId]: updated };
      writeStorage(next);
      return { presetsByTenant: next };
    });
  },

  renamePreset: (tenantId: string, presetId: string, newName: string) => {
    set((state) => {
      const existing = state.presetsByTenant[tenantId] || [];
      const updated = existing.map((p) =>
        p.id === presetId ? { ...p, name: newName } : p,
      );
      const next = { ...state.presetsByTenant, [tenantId]: updated };
      writeStorage(next);
      return { presetsByTenant: next };
    });
  },

  loadFromStorage: () => {
    set({ presetsByTenant: readStorage() });
  },
}));
