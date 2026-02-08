import { create } from "zustand";
import { persist } from "zustand/middleware";

type ChannelState = {
  selectedChannel: string | null;
  setSelectedChannel: (channel: string | null) => void;
  /** Flag to track if user has ever made a selection (prevents auto-select override) */
  hasUserSelected: boolean;
  setHasUserSelected: (value: boolean) => void;
};

/**
 * Global channel selection store
 * Persists the selected channel in localStorage so it survives page refreshes
 * Used by Navigation (header) and Dashboard components
 *
 * Note: "All" means show all channels (no filter), null means "not yet selected"
 */
export const useChannelStore = create<ChannelState>()(
  persist(
    (set) => ({
      selectedChannel: null,
      setSelectedChannel: (channel) =>
        set({ selectedChannel: channel, hasUserSelected: true }),
      hasUserSelected: false,
      setHasUserSelected: (value) => set({ hasUserSelected: value }),
    }),
    {
      name: "cohi-channel-selection",
    }
  )
);
