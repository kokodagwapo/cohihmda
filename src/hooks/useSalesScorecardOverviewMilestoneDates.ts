/**
 * Sales Scorecard Overview milestone dates preference (cross-device).
 * Loads from API with localStorage fallback; persists to both on save.
 */

import { useState, useEffect, useCallback } from "react";
import { api } from "@/lib/api";
import { DEFAULT_SALES_SCORECARD_MILESTONE_COLUMNS } from "@/components/widgets/components/SalesScorecardMilestoneDatesModal";

const STORAGE_KEY = "cohi-sales-scorecard-overview-milestone-dates";
const PREFERENCE_KEY = "salesScorecardOverviewMilestoneDates";

export function useSalesScorecardOverviewMilestoneDates(): {
  milestoneColumns: string[];
  setMilestoneColumns: (columns: string[]) => void;
  persistMilestoneColumns: (columns: string[]) => void;
  isLoading: boolean;
} {
  const [milestoneColumns, setMilestoneColumnsState] = useState<string[]>(() => [
    ...DEFAULT_SALES_SCORECARD_MILESTONE_COLUMNS,
  ]);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const preference = await api.request<{
        preference_value: string[] | null;
      }>(`/api/user/preferences/${PREFERENCE_KEY}`);
      if (
        preference?.preference_value &&
        Array.isArray(preference.preference_value) &&
        preference.preference_value.length > 0
      ) {
        setMilestoneColumnsState(preference.preference_value);
        try {
          localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify(preference.preference_value)
          );
        } catch {
          // ignore
        }
        return;
      }
    } catch (e: unknown) {
      if (
        e instanceof Error &&
        (e.message?.includes("Unauthorized") || e.message?.includes("401"))
      ) {
        // not logged in
      } else {
        console.warn(
          "Failed to load sales scorecard overview milestone dates:",
          e
        );
      }
    }
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setMilestoneColumnsState(parsed);
          return;
        }
      }
    } catch {
      // ignore
    }
    setMilestoneColumnsState([...DEFAULT_SALES_SCORECARD_MILESTONE_COLUMNS]);
  }, []);

  useEffect(() => {
    load().finally(() => setIsLoading(false));
  }, [load]);

  const persistMilestoneColumns = useCallback((columns: string[]) => {
    setMilestoneColumnsState(columns);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(columns));
    } catch {
      // ignore
    }
    api
      .request(`/api/user/preferences/${PREFERENCE_KEY}`, {
        method: "PUT",
        body: JSON.stringify({ preference_value: columns }),
      })
      .catch((e: unknown) => {
        if (
          e instanceof Error &&
          !e.message?.includes("Unauthorized") &&
          !e.message?.includes("401")
        ) {
          console.warn(
            "Failed to persist sales scorecard overview milestone dates:",
            e
          );
        }
      });
  }, []);

  return {
    milestoneColumns,
    setMilestoneColumns: setMilestoneColumnsState,
    persistMilestoneColumns,
    isLoading,
  };
}
