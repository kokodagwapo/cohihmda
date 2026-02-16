/**
 * filterPresetStore – Zustand store for saved filter presets (bookmarks).
 *
 * Presets are stored in localStorage keyed by tenant ID so they persist
 * across sessions without requiring a DB migration. Each preset stores
 * a WidgetFilterState that can be applied to any Cohi widget.
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

interface FilterPresetStore {
  /** Presets keyed by tenant ID (lazily loaded from localStorage on first access) */
  presetsByTenant: Record<string, FilterPreset[]>;

  /** Ensure presets are loaded for a tenant — call in components on mount */
  ensureLoaded: (tenantId: string) => void;

  /** Save a new preset for the given tenant */
  addPreset: (tenantId: string, name: string, filters: WidgetFilterState) => FilterPreset;

  /** Remove a preset by id */
  removePreset: (tenantId: string, id: string) => void;

  /** Rename a preset */
  renamePreset: (tenantId: string, id: string, newName: string) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MAX_PRESETS = 15;

function storageKey(tenantId: string): string {
  return `cohi-filter-presets-${tenantId}`;
}

function readFromStorage(tenantId: string): FilterPreset[] {
  try {
    const raw = localStorage.getItem(storageKey(tenantId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeToStorage(tenantId: string, presets: FilterPreset[]): void {
  try {
    localStorage.setItem(storageKey(tenantId), JSON.stringify(presets));
  } catch {
    // localStorage full or unavailable — silently ignore
  }
}

/** Lazily load presets for a tenant into the store, returning the array */
function ensureLoaded(
  state: FilterPresetStore,
  tenantId: string,
): FilterPreset[] {
  if (state.presetsByTenant[tenantId]) return state.presetsByTenant[tenantId];
  return readFromStorage(tenantId);
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useFilterPresetStore = create<FilterPresetStore>((set, get) => ({
  presetsByTenant: {},

  ensureLoaded: (tenantId: string) => {
    if (get().presetsByTenant[tenantId] !== undefined) return;
    const loaded = readFromStorage(tenantId);
    set((s) => ({
      presetsByTenant: { ...s.presetsByTenant, [tenantId]: loaded },
    }));
  },

  addPreset: (tenantId: string, name: string, filters: WidgetFilterState) => {
    const existing = ensureLoaded(get(), tenantId);
    const preset: FilterPreset = {
      id: `preset-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: name.trim() || 'Untitled preset',
      filters,
      createdAt: new Date().toISOString(),
    };
    const next = [...existing, preset].slice(-MAX_PRESETS);
    set((s) => ({
      presetsByTenant: { ...s.presetsByTenant, [tenantId]: next },
    }));
    writeToStorage(tenantId, next);
    return preset;
  },

  removePreset: (tenantId: string, id: string) => {
    const existing = ensureLoaded(get(), tenantId);
    const next = existing.filter((p) => p.id !== id);
    set((s) => ({
      presetsByTenant: { ...s.presetsByTenant, [tenantId]: next },
    }));
    writeToStorage(tenantId, next);
  },

  renamePreset: (tenantId: string, id: string, newName: string) => {
    const existing = ensureLoaded(get(), tenantId);
    const next = existing.map((p) =>
      p.id === id ? { ...p, name: newName.trim() || p.name } : p,
    );
    set((s) => ({
      presetsByTenant: { ...s.presetsByTenant, [tenantId]: next },
    }));
    writeToStorage(tenantId, next);
  },
}));
