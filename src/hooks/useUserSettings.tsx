import React, { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface AppearanceSettings {
  theme: 'light' | 'dark' | 'system';
  defaultPage: string;
  sidebarCollapsed: boolean;
}

export interface UserSettings {
  appearance: AppearanceSettings;
}

const DEFAULT_SETTINGS: UserSettings = {
  appearance: {
    theme: 'system',
    defaultPage: '/',
    sidebarCollapsed: false,
  },
};

interface UserSettingsContextType {
  settings: UserSettings;
  isLoading: boolean;
  /** Update a specific settings category and persist to server */
  updateSettings: <K extends keyof UserSettings>(key: K, value: UserSettings[K]) => Promise<void>;
  /** Refresh settings from server */
  refresh: () => Promise<void>;
}

const UserSettingsContext = createContext<UserSettingsContextType | undefined>(undefined);

// ─── Provider ────────────────────────────────────────────────────────────────

export function UserSettingsProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth();
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS);
  const [isLoading, setIsLoading] = useState(false);

  const fetchSettings = useCallback(async () => {
    if (!isAuthenticated) return;

    setIsLoading(true);
    try {
      const data = await api.request<{ preferences: Record<string, any> }>('/api/user/preferences');

      const merged: UserSettings = { ...DEFAULT_SETTINGS };

      if (data.preferences?.appearance) {
        merged.appearance = { ...DEFAULT_SETTINGS.appearance, ...data.preferences.appearance };
      }

      setSettings(merged);
    } catch {
      // Defaults are fine
    } finally {
      setIsLoading(false);
    }
  }, [isAuthenticated]);

  // Load on auth change
  useEffect(() => {
    if (isAuthenticated) {
      fetchSettings();
    } else {
      setSettings(DEFAULT_SETTINGS);
    }
  }, [isAuthenticated, fetchSettings]);

  const updateSettings = useCallback(
    async <K extends keyof UserSettings>(key: K, value: UserSettings[K]) => {
      // Optimistic update
      setSettings((prev) => ({ ...prev, [key]: value }));

      try {
        await api.request(`/api/user/preferences/${key}`, {
          method: 'PUT',
          body: JSON.stringify({ preference_value: value }),
        });
      } catch {
        // Revert on failure -- refetch from server
        await fetchSettings();
        throw new Error('Failed to save settings');
      }
    },
    [fetchSettings],
  );

  const value: UserSettingsContextType = {
    settings,
    isLoading,
    updateSettings,
    refresh: fetchSettings,
  };

  return (
    <UserSettingsContext.Provider value={value}>
      {children}
    </UserSettingsContext.Provider>
  );
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useUserSettings(): UserSettingsContextType {
  const context = useContext(UserSettingsContext);
  if (context === undefined) {
    throw new Error('useUserSettings must be used within a UserSettingsProvider');
  }
  return context;
}

export { DEFAULT_SETTINGS };
