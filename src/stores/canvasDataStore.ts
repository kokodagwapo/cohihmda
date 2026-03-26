/**
 * canvasDataStore – Zustand store for collecting rendered widget data.
 *
 * Each widget on the workbench canvas reports its data here after rendering.
 * This allows the Cohi chat to build a rich snapshot of what the user is
 * actually seeing (KPI values, chart data, table rows) rather than just
 * knowing the structural layout.
 */

import { create } from 'zustand';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WidgetDataEntry {
  /** Canvas layout item ID */
  itemId: string;
  /** Human-readable widget name */
  widgetName: string;
  /** Widget category for smart serialization */
  category: 'kpi' | 'chart' | 'table' | 'embed' | 'other';
  /** The actual data the widget is displaying (dataSelector output, chart data, etc.) */
  data: unknown;
  /** Timestamp of last data update */
  updatedAt: number;
}

interface CanvasDataStoreState {
  /** All widget data entries keyed by canvas item ID */
  widgets: Record<string, WidgetDataEntry>;

  /** Monotonically increasing counter bumped on every reportWidgetData call */
  dataVersion: number;

  /** Called by widgets when their data loads/updates */
  reportWidgetData: (
    itemId: string,
    entry: Omit<WidgetDataEntry, 'itemId' | 'updatedAt'>
  ) => void;

  /** Called when a widget is removed from the canvas */
  removeWidget: (itemId: string) => void;

  /** Clear all data (e.g. when switching canvases) */
  clearAll: () => void;

  /** Get a snapshot of all collected widget data */
  getSnapshot: () => WidgetDataEntry[];
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useCanvasDataStore = create<CanvasDataStoreState>((set, get) => ({
  widgets: {},
  dataVersion: 0,

  reportWidgetData: (itemId, entry) => {
    set((state) => ({
      dataVersion: state.dataVersion + 1,
      widgets: {
        ...state.widgets,
        [itemId]: {
          itemId,
          ...entry,
          updatedAt: Date.now(),
        },
      },
    }));
  },

  removeWidget: (itemId) => {
    set((state) => {
      const next = { ...state.widgets };
      delete next[itemId];
      return { widgets: next };
    });
  },

  clearAll: () => {
    set({ widgets: {} });
  },

  getSnapshot: () => {
    return Object.values(get().widgets);
  },
}));
