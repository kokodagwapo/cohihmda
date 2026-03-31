import { useCallback, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { ColumnFilterState } from "@/utils/loanDetailFilters";
import { normalizeFilterState } from "@/utils/loanDetailFilters";
import type {
  EstimatedClosingsComplexityBucketKey,
  EstimatedClosingsDateRangeType,
  EstimatedClosingsEcdSliceKey,
} from "@/hooks/useEstimatedClosingsRiskData";

const VIEW_STATE_VERSION = 1 as const;
const VIEW_STATE_KEY_PREFIX = "estimatedClosingsRiskViewState:v1";
const LOCAL_STORAGE_PREFIX = "cohi-estimated-closings-risk-view-state:";

const ECD_SLICE_KEYS: EstimatedClosingsEcdSliceKey[] = [
  "empty_ecd",
  "past_ecd",
  "remaining_to_fund",
  "after_this_month",
];
const COMPLEXITY_BUCKET_KEYS: EstimatedClosingsComplexityBucketKey[] = [
  "gte_130",
  "gte_120",
  "gte_110",
  "all_rest",
];

interface PreferenceResponse {
  preference_value: unknown;
}

export interface EstimatedClosingsRiskViewStateV1 {
  version: typeof VIEW_STATE_VERSION;
  dateRangeType: EstimatedClosingsDateRangeType;
  ecdSlice: EstimatedClosingsEcdSliceKey | null;
  complexityBarBucket: EstimatedClosingsComplexityBucketKey | null;
  remainingComplexityGroup: string | null;
  remainingProcessingStage: string | null;
  detailColumnFilters: ColumnFilterState;
  showDetailColumnFilters: boolean;
  detailSort: { key: string; direction: "asc" | "desc" };
  complexitySort: { key: string; direction: "asc" | "desc" };
  stageSort: { key: string; direction: "asc" | "desc" };
}

function toNullableString(value: unknown): string | null {
  const s = typeof value === "string" ? value.trim() : "";
  return s !== "" ? s : null;
}

function normalizeEcdSlice(value: unknown): EstimatedClosingsEcdSliceKey | null {
  return typeof value === "string" && ECD_SLICE_KEYS.includes(value as EstimatedClosingsEcdSliceKey)
    ? (value as EstimatedClosingsEcdSliceKey)
    : null;
}

function normalizeComplexityBucket(value: unknown): EstimatedClosingsComplexityBucketKey | null {
  return typeof value === "string" &&
    COMPLEXITY_BUCKET_KEYS.includes(value as EstimatedClosingsComplexityBucketKey)
    ? (value as EstimatedClosingsComplexityBucketKey)
    : null;
}

function normalizeDateRangeType(value: unknown): EstimatedClosingsDateRangeType {
  return value === "business_days" ? "business_days" : "calendar_days";
}

function normalizeSort(
  value: unknown,
  fallback: { key: string; direction: "asc" | "desc" },
): { key: string; direction: "asc" | "desc" } {
  if (!value || typeof value !== "object") return fallback;
  const rec = value as Record<string, unknown>;
  const key = typeof rec.key === "string" && rec.key.trim() !== "" ? rec.key : fallback.key;
  const direction = rec.direction === "desc" ? "desc" : "asc";
  return { key, direction };
}

export function normalizeEstimatedClosingsRiskViewState(value: unknown): EstimatedClosingsRiskViewStateV1 {
  const rec = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const detailColumnFilters =
    rec.detailColumnFilters && typeof rec.detailColumnFilters === "object"
      ? normalizeFilterState(rec.detailColumnFilters as ColumnFilterState)
      : {};
  return {
    version: VIEW_STATE_VERSION,
    dateRangeType: normalizeDateRangeType(rec.dateRangeType),
    ecdSlice: normalizeEcdSlice(rec.ecdSlice),
    complexityBarBucket: normalizeComplexityBucket(rec.complexityBarBucket),
    remainingComplexityGroup: toNullableString(rec.remainingComplexityGroup),
    remainingProcessingStage: toNullableString(rec.remainingProcessingStage),
    detailColumnFilters,
    showDetailColumnFilters: rec.showDetailColumnFilters === true,
    detailSort: normalizeSort(rec.detailSort, { key: "loanNumber", direction: "asc" }),
    complexitySort: normalizeSort(rec.complexitySort, { key: "sortOrder", direction: "asc" }),
    stageSort: normalizeSort(rec.stageSort, { key: "sortOrder", direction: "asc" }),
  };
}

export function buildEstimatedClosingsRiskViewStatePreferenceKey(args: {
  tenantId: string | null | undefined;
}): string | null {
  const tenantId = typeof args.tenantId === "string" ? args.tenantId.trim() : "";
  if (!tenantId) return null;
  return `${VIEW_STATE_KEY_PREFIX}:tenant:${tenantId}:standalone`;
}

function readLocal(preferenceKey: string): EstimatedClosingsRiskViewStateV1 | null {
  try {
    const raw = localStorage.getItem(`${LOCAL_STORAGE_PREFIX}${preferenceKey}`);
    if (!raw) return null;
    return normalizeEstimatedClosingsRiskViewState(JSON.parse(raw));
  } catch {
    return null;
  }
}

function writeLocal(preferenceKey: string, value: EstimatedClosingsRiskViewStateV1) {
  try {
    localStorage.setItem(`${LOCAL_STORAGE_PREFIX}${preferenceKey}`, JSON.stringify(value));
  } catch {
    // ignore
  }
}

export function useEstimatedClosingsRiskViewState(args: { tenantId: string | null | undefined }) {
  const preferenceKey = useMemo(
    () => buildEstimatedClosingsRiskViewStatePreferenceKey({ tenantId: args.tenantId }),
    [args.tenantId],
  );
  const [isLoading, setIsLoading] = useState(false);
  const lastPersistedJsonRef = useRef<string | null>(null);
  const lastHydratedJsonRef = useRef<string | null>(null);

  const load = useCallback(async (): Promise<EstimatedClosingsRiskViewStateV1 | null> => {
    if (!preferenceKey) return null;
    setIsLoading(true);
    try {
      const response = await api.request<PreferenceResponse>(`/api/user/preferences/${preferenceKey}`);
      const normalized = normalizeEstimatedClosingsRiskViewState(response?.preference_value ?? null);
      const json = JSON.stringify(normalized);
      lastHydratedJsonRef.current = json;
      writeLocal(preferenceKey, normalized);
      return normalized;
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (!message.includes("Unauthorized") && !message.includes("401")) {
        console.warn("Failed to load estimated closings risk view state:", error);
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
    async (nextState: EstimatedClosingsRiskViewStateV1): Promise<void> => {
      if (!preferenceKey) return;
      const normalized = normalizeEstimatedClosingsRiskViewState(nextState);
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
          console.warn("Failed to persist estimated closings risk view state:", error);
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
