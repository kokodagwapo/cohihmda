/**
 * Store for "Pin to canvas" actions from Cohi Chat and Industry News.
 * WorkbenchCanvas consumes pending pins and adds them as widgets.
 */

import { create } from 'zustand';

export type PinnedInsightPayload = {
  title: string;
  content: string;
  visualization?: {
    type: string;
    title: string;
    data: any[];
    [key: string]: any;
  };
};

export type NewsCardPayload = {
  title: string;
  summary: string;
  link?: string;
};

export type PendingPin =
  | { id: string; type: 'pinned_insight'; payload: PinnedInsightPayload }
  | { id: string; type: 'news_card'; payload: NewsCardPayload };

type CanvasPinState = {
  pendingPins: PendingPin[];
  addPinnedInsight: (payload: PinnedInsightPayload) => void;
  addNewsCard: (payload: NewsCardPayload) => void;
  consumePendingPins: () => PendingPin[];
};

export const useCanvasPinStore = create<CanvasPinState>((set) => ({
  pendingPins: [],
  addPinnedInsight: (payload) =>
    set((state) => ({
      pendingPins: [
        ...state.pendingPins,
        { id: `pin-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`, type: 'pinned_insight', payload },
      ],
    })),
  addNewsCard: (payload) =>
    set((state) => ({
      pendingPins: [
        ...state.pendingPins,
        { id: `pin-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`, type: 'news_card', payload },
      ],
    })),
  consumePendingPins: () => {
    let consumed: PendingPin[] = [];
    set((state) => {
      consumed = [...state.pendingPins];
      return { pendingPins: [] };
    });
    return consumed;
  },
}));
