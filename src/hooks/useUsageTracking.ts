import { useCallback } from 'react';

export const useUsageTracking = () => {
  const trackUsage = useCallback(async (
    _metricType: string,
    _value: number = 1,
    _metadata?: Record<string, unknown>
  ) => {
    // Usage tracking stub - will be implemented when subscription tables are added
    console.log('Usage tracking not yet implemented');
  }, []);

  const checkLimit = useCallback(async (
    _metricType: string
  ): Promise<{ allowed: boolean; current: number; limit: number }> => {
    // Always allow - no limits on free plan
    return { allowed: true, current: 0, limit: -1 };
  }, []);

  const getUsage = useCallback(async (
    _metricType: string
  ): Promise<number> => {
    // Return 0 - no usage tracking yet
    return 0;
  }, []);

  return { trackUsage, checkLimit, getUsage };
};
