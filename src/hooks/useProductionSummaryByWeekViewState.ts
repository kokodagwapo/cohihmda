import { useCallback, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";

const VIEW_STATE_VERSION = 1 as const;
const VIEW_STATE_KEY_PREFIX = "productionSummaryByWeekViewState:v1";
const LOCAL_STORAGE_PREFIX = "cohi-production-summary-by-week-view-state:";

const SUMMARY_DATE_FIELDS = [
  "started_date",
  "application_date",
  "investor_lock_date",
  "funding_date",
  "closing_date",
] as const;

type SummaryDateField = (typeof SUMMARY_DATE_FIELDS)[number];

interface PreferenceResponse {
  preference_value: unknown;
}

export interface ProductionSummaryByWeekViewStateV1 {
  version: typeof VIEW_STATE_VERSION;
  yearWeeksByField: Record<SummaryDateField, string[]>;
}

function asYearWeekList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .filter((x): x is string => typeof x === "string")
        .map((s) => s.trim())
        .filter((s) => /^\d{4}-W\d{2}$/.test(s)),
    ),
  ].sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
}

export function normalizeProductionSummaryByWeekViewState(value: unknown): ProductionSummaryByWeekViewStateV1 {
  const rec = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const fromRecord =
    rec.yearWeeksByField && typeof rec.yearWeeksByField === "object"
      ? (rec.yearWeeksByField as Record<string, unknown>)
      : {};

  const yearWeeksByField = {
    started_date: asYearWeekList(fromRecord.started_date),
    application_date: asYearWeekList(fromRecord.application_date),
    investor_lock_date: asYearWeekList(fromRecord.investor_lock_date),
    funding_date: asYearWeekList(fromRecord.funding_date),
    closing_date: asYearWeekList(fromRecord.closing_date),
  };

  // Backwards compatibility if top-level keys were persisted directly.
  for (const field of SUMMARY_DATE_FIELDS) {
    if (yearWeeksByField[field].length > 0) continue;
    yearWeeksByField[field] = asYearWeekList(rec[field]);
  }

  return {
    version: VIEW_STATE_VERSION,
    yearWeeksByField,
  };
}

export function buildProductionSummaryByWeekViewStatePreferenceKey(args: {
  tenantId: string | null | undefined;
}): string | null {
  const tenantId = typeof args.tenantId === "string" ? args.tenantId.trim() : "";
  if (!tenantId) return null;
  return `${VIEW_STATE_KEY_PREFIX}:tenant:${tenantId}:standalone`;
}

function readLocal(preferenceKey: string): ProductionSummaryByWeekViewStateV1 | null {
  try {
    const raw = localStorage.getItem(`${LOCAL_STORAGE_PREFIX}${preferenceKey}`);
    if (!raw) return null;
    return normalizeProductionSummaryByWeekViewState(JSON.parse(raw));
  } catch {
    return null;
  }
}

function writeLocal(preferenceKey: string, value: ProductionSummaryByWeekViewStateV1) {
  try {
    localStorage.setItem(`${LOCAL_STORAGE_PREFIX}${preferenceKey}`, JSON.stringify(value));
  } catch {
    // ignore localStorage write failures
  }
}

export function persistProductionSummaryByWeekFiltersLocally(
  preferenceKey: string,
  value: ProductionSummaryByWeekViewStateV1,
) {
  writeLocal(preferenceKey, normalizeProductionSummaryByWeekViewState(value));
}

export function useProductionSummaryByWeekViewState(args: {
  tenantId: string | null | undefined;
}) {
  const preferenceKey = useMemo(
    () => buildProductionSummaryByWeekViewStatePreferenceKey({ tenantId: args.tenantId }),
    [args.tenantId],
  );
  const [isLoading, setIsLoading] = useState(false);
  const lastPersistedJsonRef = useRef<string | null>(null);
  const lastHydratedJsonRef = useRef<string | null>(null);

  const load = useCallback(async (): Promise<ProductionSummaryByWeekViewStateV1 | null> => {
    if (!preferenceKey) return null;
    setIsLoading(true);
    try {
      const response = await api.request<PreferenceResponse>(`/api/user/preferences/${preferenceKey}`);
      const normalized = normalizeProductionSummaryByWeekViewState(response?.preference_value ?? null);
      const json = JSON.stringify(normalized);
      lastHydratedJsonRef.current = json;
      writeLocal(preferenceKey, normalized);
      return normalized;
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (!message.includes("Unauthorized") && !message.includes("401")) {
        console.warn("Failed to load production summary by week view state:", error);
      }
      const local = readLocal(preferenceKey);
      if (!local) return null;
      lastHydratedJsonRef.current = JSON.stringify(local);
      return local;
    } finally {
      setIsLoading(false);
    }
  }, [preferenceKey]);

  const save = useCallback(
    async (nextState: ProductionSummaryByWeekViewStateV1): Promise<void> => {
      if (!preferenceKey) return;
      const normalized = normalizeProductionSummaryByWeekViewState(nextState);
      const json = JSON.stringify(normalized);
      if (json === lastPersistedJsonRef.current) return;
      lastPersistedJsonRef.current = json;
      writeLocal(preferenceKey, normalized);
      try {
        await api.request(`/api/user/preferences/${preferenceKey}`, {
          method: "PUT",
          body: JSON.stringify({ preference_value: normalized }),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        if (!message.includes("Unauthorized") && !message.includes("401")) {
          console.warn("Failed to persist production summary by week view state:", error);
        }
      }
    },
    [preferenceKey],
  );

  return useMemo(
    () => ({
      preferenceKey,
      isLoading,
      load,
      save,
      lastPersistedJsonRef,
      lastHydratedJsonRef,
    }),
    [preferenceKey, isLoading, load, save],
  );
}
