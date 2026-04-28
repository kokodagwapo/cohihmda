import { useCallback, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import type {
  ProductionDateType,
  ProductionDimension,
  ProductionMeasure,
  ProductionTrendsDrilldownSlice,
} from "@/hooks/useProductionTrendsData";

const VIEW_STATE_VERSION = 1 as const;
const VIEW_STATE_KEY_PREFIX = "productionTrendsViewState:v1";
const LOCAL_STORAGE_PREFIX = "cohi-production-trends-view-state:";

const DATE_TYPES = new Set<ProductionDateType>(["applications", "closed", "funded"]);
const MEASURES = new Set<ProductionMeasure>(["volume", "units"]);
const DIMENSIONS = new Set<ProductionDimension>([
  "loan_purpose",
  "loan_type",
  "channel",
  "branch",
  "broker_lender_name",
  "investor",
  "warehouse_co_name",
]);

interface PreferenceResponse {
  preference_value: unknown;
}

export interface ProductionTrendsViewStateV1 {
  version: typeof VIEW_STATE_VERSION;
  dateType: ProductionDateType;
  measure: ProductionMeasure;
  dimension: ProductionDimension;
  yearMonths: string[];
  sliceCategories: string[];
  sliceLineMonths: number[];
  sliceDrilldown: ProductionTrendsDrilldownSlice | null;
}

const asStringList = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .filter((x): x is string => typeof x === "string")
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
};

const asYearMonthList = (value: unknown): string[] =>
  asStringList(value).filter((s) => /^\d{4}-\d{2}$/.test(s)).sort();

const asMonthList = (value: unknown): number[] => {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .map((x) => (typeof x === "number" ? x : Number.parseInt(String(x), 10)))
        .filter((n) => Number.isInteger(n) && n >= 1 && n <= 12),
    ),
  ].sort((a, b) => a - b);
};

const asDrilldownSlice = (value: unknown): ProductionTrendsDrilldownSlice | null => {
  const rec = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const branches = asStringList(rec.branches);
  const lienPositions = asStringList(rec.lienPositions);
  const productTypes = asStringList(rec.productTypes);
  const loanPrograms = asStringList(rec.loanPrograms);
  if (!branches.length && !lienPositions.length && !productTypes.length && !loanPrograms.length) return null;
  return { branches, lienPositions, productTypes, loanPrograms };
};

export function normalizeProductionTrendsViewState(value: unknown): ProductionTrendsViewStateV1 {
  const rec = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const dateType = DATE_TYPES.has(rec.dateType as ProductionDateType)
    ? (rec.dateType as ProductionDateType)
    : "funded";
  const measure = MEASURES.has(rec.measure as ProductionMeasure)
    ? (rec.measure as ProductionMeasure)
    : "volume";
  const dimension = DIMENSIONS.has(rec.dimension as ProductionDimension)
    ? (rec.dimension as ProductionDimension)
    : "branch";
  return {
    version: VIEW_STATE_VERSION,
    dateType,
    measure,
    dimension,
    yearMonths: asYearMonthList(rec.yearMonths),
    sliceCategories: asStringList(rec.sliceCategories),
    sliceLineMonths: asMonthList(rec.sliceLineMonths),
    sliceDrilldown: asDrilldownSlice(rec.sliceDrilldown),
  };
}

export function buildProductionTrendsViewStatePreferenceKey(args: {
  tenantId: string | null | undefined;
}): string | null {
  const tenantId = typeof args.tenantId === "string" ? args.tenantId.trim() : "";
  if (!tenantId) return null;
  return `${VIEW_STATE_KEY_PREFIX}:tenant:${tenantId}:standalone`;
}

function readLocal(preferenceKey: string): ProductionTrendsViewStateV1 | null {
  try {
    const raw = localStorage.getItem(`${LOCAL_STORAGE_PREFIX}${preferenceKey}`);
    if (!raw) return null;
    return normalizeProductionTrendsViewState(JSON.parse(raw));
  } catch {
    return null;
  }
}

function writeLocal(preferenceKey: string, value: ProductionTrendsViewStateV1) {
  try {
    localStorage.setItem(`${LOCAL_STORAGE_PREFIX}${preferenceKey}`, JSON.stringify(value));
  } catch {
    // ignore
  }
}

export function persistProductionTrendsFiltersLocally(
  preferenceKey: string,
  value: ProductionTrendsViewStateV1,
) {
  writeLocal(preferenceKey, normalizeProductionTrendsViewState(value));
}

export function useProductionTrendsViewState(args: { tenantId: string | null | undefined }) {
  const preferenceKey = useMemo(
    () => buildProductionTrendsViewStatePreferenceKey({ tenantId: args.tenantId }),
    [args.tenantId],
  );
  const [isLoading, setIsLoading] = useState(false);
  const lastPersistedJsonRef = useRef<string | null>(null);
  const lastHydratedJsonRef = useRef<string | null>(null);

  const load = useCallback(async (): Promise<ProductionTrendsViewStateV1 | null> => {
    if (!preferenceKey) return null;
    setIsLoading(true);
    try {
      const response = await api.request<PreferenceResponse>(`/api/user/preferences/${preferenceKey}`);
      const normalized = normalizeProductionTrendsViewState(response?.preference_value ?? null);
      const json = JSON.stringify(normalized);
      lastHydratedJsonRef.current = json;
      writeLocal(preferenceKey, normalized);
      return normalized;
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (!message.includes("Unauthorized") && !message.includes("401")) {
        console.warn("Failed to load production trends view state:", error);
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
    async (nextState: ProductionTrendsViewStateV1): Promise<void> => {
      if (!preferenceKey) return;
      const normalized = normalizeProductionTrendsViewState(nextState);
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
          console.warn("Failed to persist production trends view state:", error);
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
