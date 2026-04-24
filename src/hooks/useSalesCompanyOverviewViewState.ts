import { useCallback, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { SalesCompanyOverviewAgingBucket } from "@/hooks/useSalesCompanyOverviewData";

const VIEW_STATE_VERSION = 2 as const;
const VIEW_STATE_KEY_PREFIX = "salesCompanyOverviewViewState:v2";
const LOCAL_STORAGE_PREFIX = "cohi-sales-company-overview-view-state:";

const AGING_BUCKET_KEYS = new Set<string>([
  "0-15",
  "16-30",
  "31-45",
  "46-60",
  "61-90",
  ">90",
]);

interface PreferenceResponse {
  preference_value: unknown;
}

export interface SalesCompanyOverviewViewStateV1 {
  version: typeof VIEW_STATE_VERSION;
  loanTypes: string[];
  agingBuckets: SalesCompanyOverviewAgingBucket[];
}

function toNullableLoanType(value: unknown): string | null {
  const s = typeof value === "string" ? value.trim() : "";
  return s !== "" ? s : null;
}

function normalizeAgingBucket(value: unknown): SalesCompanyOverviewAgingBucket | null {
  if (typeof value !== "string") return null;
  return AGING_BUCKET_KEYS.has(value) ? (value as SalesCompanyOverviewAgingBucket) : null;
}

export function normalizeSalesCompanyOverviewViewState(value: unknown): SalesCompanyOverviewViewStateV1 {
  const rec = value && typeof value === "object" ? (value as Record<string, unknown>) : {};

  let loanTypes: string[] = [];
  if (Array.isArray(rec.loanTypes)) {
    loanTypes = [
      ...new Set(
        rec.loanTypes.filter((x): x is string => typeof x === "string").map((s) => s.trim()).filter(Boolean),
      ),
    ];
  }
  let agingBuckets: SalesCompanyOverviewAgingBucket[] = [];
  if (Array.isArray(rec.agingBuckets)) {
    agingBuckets = [
      ...new Set(
        rec.agingBuckets
          .filter((x): x is string => typeof x === "string" && AGING_BUCKET_KEYS.has(x))
          .map((x) => x as SalesCompanyOverviewAgingBucket),
      ),
    ];
  }

  if (loanTypes.length === 0) {
    const legacy = toNullableLoanType(rec.loanType);
    if (legacy) loanTypes = [legacy];
  }
  if (agingBuckets.length === 0) {
    const legacy = normalizeAgingBucket(rec.agingBucket);
    if (legacy) agingBuckets = [legacy];
  }

  return {
    version: VIEW_STATE_VERSION,
    loanTypes: [...loanTypes].sort((a, b) => a.localeCompare(b)),
    agingBuckets: [...agingBuckets].sort((a, b) => a.localeCompare(b)),
  };
}

export function buildSalesCompanyOverviewViewStatePreferenceKey(args: {
  tenantId: string | null | undefined;
}): string | null {
  const tenantId = typeof args.tenantId === "string" ? args.tenantId.trim() : "";
  if (!tenantId) return null;
  return `${VIEW_STATE_KEY_PREFIX}:tenant:${tenantId}:standalone`;
}

function readLocal(preferenceKey: string): SalesCompanyOverviewViewStateV1 | null {
  try {
    const raw = localStorage.getItem(`${LOCAL_STORAGE_PREFIX}${preferenceKey}`);
    if (!raw) return null;
    return normalizeSalesCompanyOverviewViewState(JSON.parse(raw));
  } catch {
    return null;
  }
}

function writeLocal(preferenceKey: string, value: SalesCompanyOverviewViewStateV1) {
  try {
    localStorage.setItem(`${LOCAL_STORAGE_PREFIX}${preferenceKey}`, JSON.stringify(value));
  } catch {
    // ignore
  }
}

export function persistSalesCompanyOverviewFiltersLocally(
  preferenceKey: string,
  loanTypes: string[],
  agingBuckets: SalesCompanyOverviewAgingBucket[],
) {
  const normalized = normalizeSalesCompanyOverviewViewState({
    version: VIEW_STATE_VERSION,
    loanTypes,
    agingBuckets,
  });
  writeLocal(preferenceKey, normalized);
}

export function useSalesCompanyOverviewViewState(args: { tenantId: string | null | undefined }) {
  const preferenceKey = useMemo(
    () => buildSalesCompanyOverviewViewStatePreferenceKey({ tenantId: args.tenantId }),
    [args.tenantId],
  );
  const [isLoading, setIsLoading] = useState(false);
  const lastPersistedJsonRef = useRef<string | null>(null);
  const lastHydratedJsonRef = useRef<string | null>(null);

  const load = useCallback(async (): Promise<SalesCompanyOverviewViewStateV1 | null> => {
    if (!preferenceKey) return null;
    setIsLoading(true);
    try {
      const response = await api.request<PreferenceResponse>(`/api/user/preferences/${preferenceKey}`);
      const normalized = normalizeSalesCompanyOverviewViewState(response?.preference_value ?? null);
      const json = JSON.stringify(normalized);
      lastHydratedJsonRef.current = json;
      writeLocal(preferenceKey, normalized);
      return normalized;
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (!message.includes("Unauthorized") && !message.includes("401")) {
        console.warn("Failed to load sales company overview view state:", error);
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
    async (nextState: SalesCompanyOverviewViewStateV1): Promise<void> => {
      if (!preferenceKey) return;
      const normalized = normalizeSalesCompanyOverviewViewState(nextState);
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
          console.warn("Failed to persist sales company overview view state:", error);
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
