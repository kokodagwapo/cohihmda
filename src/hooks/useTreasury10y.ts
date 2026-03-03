/**
 * Hook to fetch 10-Year Treasury (FRED DGS10) for a date range.
 * Used by Pipeline Analysis treasury tab. API uses observation_start = 1/1 start year, observation_end = 12/31 end year.
 */

import { useState, useEffect, useCallback } from "react";
import { api } from "@/lib/api";

export interface Treasury10yObservation {
  date: string;
  yield: number;
}

export function useTreasury10y(
  observationStart: string | null,
  observationEnd: string | null
): {
  data: Treasury10yObservation[] | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
} {
  const [data, setData] = useState<Treasury10yObservation[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!observationStart || !observationEnd) {
      setData(null);
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      setError(null);
      const params = new URLSearchParams({
        observation_start: observationStart,
        observation_end: observationEnd,
      });
      const result = await api.request<{ observations: Treasury10yObservation[] }>(
        `/api/loans/market-rates/treasury-10y?${params.toString()}`
      );
      setData(result.observations ?? []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load 10-Year Treasury data");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [observationStart, observationEnd]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { data, loading, error, refetch: fetchData };
}
