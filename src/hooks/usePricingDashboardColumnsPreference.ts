/**
 * Pricing Dashboard custom columns preference (cross-device).
 * Loads from API with localStorage fallback; persists to both on save.
 */

import { useState, useEffect, useCallback } from "react";
import { api } from "@/lib/api";
import { usePricingDashboardStandaloneColumnsStore } from "@/stores/pricingDashboardStandaloneColumnsStore";
import {
  DEFAULT_PRICING_DASHBOARD_COLUMNS,
  type PricingDashboardColumnDef,
} from "@/lib/pricingDashboardColumns";

const STORAGE_KEY = "cohi-pricing-dashboard-columns";
const PREFERENCE_KEY = "pricingDashboardColumns";

export function usePricingDashboardColumnsPreference(): {
  persistColumns: (columns: PricingDashboardColumnDef[]) => void;
  isLoading: boolean;
} {
  const [isLoading, setIsLoading] = useState(true);
  const setColumns = usePricingDashboardStandaloneColumnsStore((s) => s.setColumns);

  const load = useCallback(async () => {
    try {
      const preference = await api.request<{
        preference_value: PricingDashboardColumnDef[] | null;
      }>(`/api/user/preferences/${PREFERENCE_KEY}`);
      if (
        preference?.preference_value &&
        Array.isArray(preference.preference_value) &&
        preference.preference_value.length > 0
      ) {
        const cols = preference.preference_value;
        setColumns(cols);
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(cols));
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
        // not logged in — fall through to localStorage
      } else {
        console.warn("Failed to load pricing dashboard columns preference:", e);
      }
    }
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setColumns(parsed as PricingDashboardColumnDef[]);
          return;
        }
      }
    } catch {
      // ignore
    }
    setColumns(DEFAULT_PRICING_DASHBOARD_COLUMNS.map((c) => ({ ...c })));
  }, [setColumns]);

  useEffect(() => {
    load().finally(() => setIsLoading(false));
  }, [load]);

  const persistColumns = useCallback(
    (columns: PricingDashboardColumnDef[]) => {
      setColumns(columns);
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
            console.warn("Failed to persist pricing dashboard columns:", e);
          }
        });
    },
    [setColumns]
  );

  return { persistColumns, isLoading };
}
