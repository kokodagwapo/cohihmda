/**
 * Tracks in-flight unified chat streams per conversation (Cursor-style history spinners).
 */
import { create } from "zustand";

export type UnifiedChatRunMeta = {
  conversationId: string;
  title: string;
  chatType?: string;
  startedAt: number;
};

type UnifiedChatRunState = {
  runs: Record<string, UnifiedChatRunMeta>;
  startRun: (meta: UnifiedChatRunMeta) => void;
  endRun: (conversationId: string) => void;
  isRunning: (conversationId: string | null | undefined) => boolean;
  runningIds: () => string[];
};

export const useUnifiedChatRunStore = create<UnifiedChatRunState>((set, get) => ({
  runs: {},
  startRun: (meta) =>
    set((state) => ({
      runs: { ...state.runs, [meta.conversationId]: meta },
    })),
  endRun: (conversationId) =>
    set((state) => {
      if (!state.runs[conversationId]) return state;
      const next = { ...state.runs };
      delete next[conversationId];
      return { runs: next };
    }),
  isRunning: (conversationId) =>
    !!conversationId && !!get().runs[conversationId],
  runningIds: () => Object.keys(get().runs),
}));
