import { useState, useEffect, useCallback } from 'react';
import { detectUserTimezone, getUserTimezone, setUserTimezone } from '@/utils/timezone';

/**
 * Hook to manage user timezone
 * Detects timezone and stores it in localStorage
 */
export function useUserTimezone() {
  const [timezone, setTimezoneState] = useState<string>(getUserTimezone());
  const [isLoading, setIsLoading] = useState(true);

  // Load timezone from localStorage or detect it
  const loadTimezone = useCallback(() => {
    const stored = getUserTimezone();
    if (stored) {
      setTimezoneState(stored);
    } else {
      const detected = detectUserTimezone();
      setUserTimezone(detected);
      setTimezoneState(detected);
    }
    setIsLoading(false);
  }, []);

  // Save timezone to localStorage
  const saveTimezone = useCallback((tz: string) => {
    setUserTimezone(tz);
    setTimezoneState(tz);
  }, []);

  // Detect and save timezone
  const detectAndSaveTimezone = useCallback(() => {
    const detected = detectUserTimezone();
    saveTimezone(detected);
  }, [saveTimezone]);

  // Load timezone on mount
  useEffect(() => {
    loadTimezone();
  }, [loadTimezone]);

  return {
    timezone,
    setTimezone: saveTimezone,
    detectAndSaveTimezone,
    isLoading
  };
}
