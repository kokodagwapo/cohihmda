import { useCallback, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { ColumnFilterState } from "@/utils/loanDetailFilters";
import { normalizeFilterState } from "@/utils/loanDetailFilters";
import type { SavedLoanDetailColumn } from "@/stores/loanDetailColumnsStore";

const VIEW_STATE_VERSION = 1 as const;
const VIEW_STATE_KEY_PREFIX = "loanDetailViewState:v1";
const LOCAL_STORAGE_PREFIX = "cohi-loan-detail-view-state:";

export interface LoanDetailViewStateV1 {
  version: typeof VIEW_STATE_VERSION;
  appliedFilters: ColumnFilterState;
  selectedBookmarkId: string | null;
  selectedBookmarkTitle: string | null;
  columns: SavedLoanDetailColumn[];
  sortColumnId: string | null;
  sortDirection: "asc" | "desc";
  showFilters: boolean;
}

interface PreferenceResponse {
  preference_value: unknown;
}

type ScopeKind = "standalone" | "widget";

function toNullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function normalizeColumns(value: unknown): SavedLoanDetailColumn[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const next: SavedLoanDetailColumn[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const id = typeof rec.id === "string" ? rec.id.trim() : "";
    const label = typeof rec.label === "string" ? rec.label : "";
    const fieldRaw = rec.field;
    const field =
      fieldRaw === null
        ? null
        : typeof fieldRaw === "string"
          ? fieldRaw
          : null;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    next.push({ id, label, field });
  }
  return next;
}

export function normalizeLoanDetailViewState(value: unknown): LoanDetailViewStateV1 {
  const rec = (value && typeof value === "object") ? (value as Record<string, unknown>) : {};
  const sortDirection = rec.sortDirection === "desc" ? "desc" : "asc";
  const showFilters = rec.showFilters === true;
  const appliedFilters =
    rec.appliedFilters && typeof rec.appliedFilters === "object"
      ? normalizeFilterState(rec.appliedFilters as ColumnFilterState)
      : {};
  return {
    version: VIEW_STATE_VERSION,
    appliedFilters,
    selectedBookmarkId: toNullableString(rec.selectedBookmarkId),
    selectedBookmarkTitle: toNullableString(rec.selectedBookmarkTitle),
    columns: normalizeColumns(rec.columns),
    sortColumnId: toNullableString(rec.sortColumnId),
    sortDirection,
    showFilters,
  };
}

export function buildLoanDetailViewStatePreferenceKey(args: {
  tenantId: string | null | undefined;
  scope: ScopeKind;
  scopeId?: string | null;
}): string | null {
  const tenantId = typeof args.tenantId === "string" ? args.tenantId.trim() : "";
  if (!tenantId) return null;
  if (args.scope === "standalone") {
    return `${VIEW_STATE_KEY_PREFIX}:tenant:${tenantId}:standalone`;
  }
  const scopeId = typeof args.scopeId === "string" ? args.scopeId.trim() : "";
  if (!scopeId) return null;
  return `${VIEW_STATE_KEY_PREFIX}:tenant:${tenantId}:widget:${scopeId}`;
}

function readLocal(preferenceKey: string): LoanDetailViewStateV1 | null {
  try {
    const raw = localStorage.getItem(`${LOCAL_STORAGE_PREFIX}${preferenceKey}`);
    if (!raw) return null;
    return normalizeLoanDetailViewState(JSON.parse(raw));
  } catch {
    return null;
  }
}

function writeLocal(preferenceKey: string, value: LoanDetailViewStateV1) {
  try {
    localStorage.setItem(`${LOCAL_STORAGE_PREFIX}${preferenceKey}`, JSON.stringify(value));
  } catch {
    // ignore local storage failures
  }
}

export function useLoanDetailViewState(args: {
  tenantId: string | null | undefined;
  scope: ScopeKind;
  scopeId?: string | null;
}) {
  const preferenceKey = useMemo(
    () => buildLoanDetailViewStatePreferenceKey(args),
    [args.tenantId, args.scope, args.scopeId],
  );
  const [isLoading, setIsLoading] = useState(false);
  const lastPersistedJsonRef = useRef<string | null>(null);
  const lastHydratedJsonRef = useRef<string | null>(null);

  const load = useCallback(async (): Promise<LoanDetailViewStateV1 | null> => {
    if (!preferenceKey) return null;
    setIsLoading(true);
    try {
      const response = await api.request<PreferenceResponse>(`/api/user/preferences/${preferenceKey}`);
      const normalized = normalizeLoanDetailViewState(response?.preference_value ?? null);
      const json = JSON.stringify(normalized);
      lastHydratedJsonRef.current = json;
      writeLocal(preferenceKey, normalized);
      return normalized;
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (!message.includes("Unauthorized") && !message.includes("401")) {
        console.warn("Failed to load loan detail view state:", error);
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
    async (nextState: LoanDetailViewStateV1): Promise<void> => {
      if (!preferenceKey) return;
      const normalized = normalizeLoanDetailViewState(nextState);
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
          console.warn("Failed to persist loan detail view state:", error);
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

