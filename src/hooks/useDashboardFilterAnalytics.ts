/**
 * Option B (plan): debounced cohi_dashboard_filters events for My Insights user profile.
 * Skips /admin, /feedback, /research pathnames.
 */

import { useEffect, useMemo, useRef } from "react";
import { useLocation } from "react-router-dom";
import { trackEvent } from "@/services/analyticsService";

export const DASHBOARD_FILTER_ANALYTICS_SCHEMA_VERSION = 1;

const DEFAULT_DEBOUNCE_MS = 550;

function pathnameNoQuery(path: string): string {
  const t = path.trim();
  const q = t.indexOf("?");
  return q >= 0 ? t.slice(0, q) : t;
}

function isExcludedPathname(pathname: string): boolean {
  const p = pathname.toLowerCase();
  return p.startsWith("/admin") || p.startsWith("/feedback") || p.startsWith("/research");
}

function stableSerializeFilters(filters: Record<string, unknown>): string {
  const keys = Object.keys(filters).sort();
  const norm: Record<string, unknown> = {};
  for (const k of keys) {
    const v = filters[k];
    if (v === undefined) continue;
    norm[k] = v;
  }
  return JSON.stringify(norm);
}

/**
 * @param pageKey Stable key for this dashboard (see dashboardPageKeys registry).
 * @param filters Full active filter map (empty object skips sending).
 */
export function useDashboardFilterAnalytics(
  pageKey: string,
  filters: Record<string, unknown>,
  options?: { debounceMs?: number; enabled?: boolean }
): void {
  const location = useLocation();
  const debounceMs = options?.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const enabled = options?.enabled !== false;
  const serialized = useMemo(() => stableSerializeFilters(filters), [filters]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!enabled || !pageKey) return;
    const pn = pathnameNoQuery(location.pathname);
    if (!pn || isExcludedPathname(pn)) return;
    if (serialized === "{}") return;

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      let parsed: Record<string, unknown> = {};
      try {
        parsed = JSON.parse(serialized) as Record<string, unknown>;
      } catch {
        return;
      }
      trackEvent("cohi_dashboard_filters", {
        page_key: pageKey,
        filters: parsed,
        schema_version: DASHBOARD_FILTER_ANALYTICS_SCHEMA_VERSION,
      });
    }, debounceMs);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [pageKey, serialized, enabled, location.pathname, debounceMs]);
}
