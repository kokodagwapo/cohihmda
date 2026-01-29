import { create } from 'zustand';
import { persist } from 'zustand/middleware';

type ChannelState = {
  selectedChannel: string | null;
  setSelectedChannel: (channel: string | null) => void;
};

/**
 * Global channel selection store
 * Persists the selected channel in localStorage so it survives page refreshes
 * Used by Navigation (header) and Dashboard components
 */
export const useChannelStore = create<ChannelState>()(
  persist(
    (set) => ({
      selectedChannel: null,
      setSelectedChannel: (channel) => set({ selectedChannel: channel }),
    }),
    {
      name: 'cohi-channel-selection',
    }
  )
);
