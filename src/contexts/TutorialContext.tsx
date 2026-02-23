import React, { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { api } from '@/lib/api';

export interface TutorialPreferences {
  tours_completed: string[];
  missions_completed: string[];
  whats_new_last_seen: string | null;
  help_dismissed: boolean;
  learning_path_week: number;
  onboarding_complete: boolean;
}

const DEFAULT_TUTORIAL_PREFS: TutorialPreferences = {
  tours_completed: [],
  missions_completed: [],
  whats_new_last_seen: null,
  help_dismissed: false,
  learning_path_week: 0,
  onboarding_complete: false,
};

interface TutorialContextType {
  prefs: TutorialPreferences;
  isLoading: boolean;
  isTourActive: boolean;
  activeTourId: string | null;
  startTour: (tourId: string) => void;
  endTour: (tourId: string) => void;
  completeTour: (tourId: string) => Promise<void>;
  isTourCompleted: (tourId: string) => boolean;
  completeMission: (missionId: string) => Promise<void>;
  isMissionCompleted: (missionId: string) => boolean;
  dismissHelp: () => Promise<void>;
  markWhatsNewSeen: () => Promise<void>;
  resetTours: () => Promise<void>;
  refresh: () => Promise<void>;
}

const TutorialContext = createContext<TutorialContextType | undefined>(undefined);

export function TutorialProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth();
  const [prefs, setPrefs] = useState<TutorialPreferences>(DEFAULT_TUTORIAL_PREFS);
  const [isLoading, setIsLoading] = useState(false);
  const [isTourActive, setIsTourActive] = useState(false);
  const [activeTourId, setActiveTourId] = useState<string | null>(null);

  const fetchPrefs = useCallback(async () => {
    if (!isAuthenticated) return;
    setIsLoading(true);
    try {
      const data = await api.request<{ preferences: Record<string, any> }>('/api/user/preferences');
      const saved = data.preferences?.tutorial;
      if (saved) {
        setPrefs({ ...DEFAULT_TUTORIAL_PREFS, ...saved });
      }
    } catch {
      // defaults are fine
    } finally {
      setIsLoading(false);
    }
  }, [isAuthenticated]);

  const savePrefs = useCallback(async (updated: TutorialPreferences) => {
    setPrefs(updated);
    try {
      await api.request('/api/user/preferences/tutorial', {
        method: 'PUT',
        body: JSON.stringify({ preference_value: updated }),
      });
    } catch {
      // silent fail, local state is still updated
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      fetchPrefs();
    } else {
      setPrefs(DEFAULT_TUTORIAL_PREFS);
    }
  }, [isAuthenticated, fetchPrefs]);

  const startTour = useCallback((tourId: string) => {
    setActiveTourId(tourId);
    setIsTourActive(true);
  }, []);

  const endTour = useCallback((_tourId: string) => {
    setActiveTourId(null);
    setIsTourActive(false);
  }, []);

  const completeTour = useCallback(async (tourId: string) => {
    const updated = {
      ...prefs,
      tours_completed: [...new Set([...prefs.tours_completed, tourId])],
    };
    if (tourId === 'welcome') {
      updated.onboarding_complete = true;
    }
    await savePrefs(updated);
    setActiveTourId(null);
    setIsTourActive(false);
  }, [prefs, savePrefs]);

  const isTourCompleted = useCallback((tourId: string) => {
    return prefs.tours_completed.includes(tourId);
  }, [prefs.tours_completed]);

  const completeMission = useCallback(async (missionId: string) => {
    if (prefs.missions_completed.includes(missionId)) return;
    const updated = {
      ...prefs,
      missions_completed: [...prefs.missions_completed, missionId],
    };
    await savePrefs(updated);
  }, [prefs, savePrefs]);

  const isMissionCompleted = useCallback((missionId: string) => {
    return prefs.missions_completed.includes(missionId);
  }, [prefs.missions_completed]);

  const dismissHelp = useCallback(async () => {
    await savePrefs({ ...prefs, help_dismissed: true });
  }, [prefs, savePrefs]);

  const markWhatsNewSeen = useCallback(async () => {
    await savePrefs({ ...prefs, whats_new_last_seen: new Date().toISOString() });
  }, [prefs, savePrefs]);

  const resetTours = useCallback(async () => {
    await savePrefs(DEFAULT_TUTORIAL_PREFS);
  }, [savePrefs]);

  return (
    <TutorialContext.Provider
      value={{
        prefs,
        isLoading,
        isTourActive,
        activeTourId,
        startTour,
        endTour,
        completeTour,
        isTourCompleted,
        completeMission,
        isMissionCompleted,
        dismissHelp,
        markWhatsNewSeen,
        resetTours,
        refresh: fetchPrefs,
      }}
    >
      {children}
    </TutorialContext.Provider>
  );
}

export function useTutorial(): TutorialContextType {
  const ctx = useContext(TutorialContext);
  if (!ctx) {
    throw new Error('useTutorial must be used within a TutorialProvider');
  }
  return ctx;
}
