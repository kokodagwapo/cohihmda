/**
 * useCohiQuery – call POST /api/cohi/query and get responsePlan + dataPayloads.
 * Use with CohiInsightPanel to render structured COHI answers.
 */

import { useState, useCallback } from "react";
import { api } from "@/lib/api";
import type { CohiQueryResponse } from "@/types/cohiResponsePlan";

export interface CohiQueryContextInput {
  currentPage?: string;
  dashboardId?: string;
  sheetId?: string;
  activeFilters?: Record<string, unknown>;
  selectedDatasetIds?: string[];
  referencedUploadIds?: string[];
}

export interface UseCohiQueryOptions {
  tenantId?: string;
  onError?: (error: Error) => void;
}

export function useCohiQuery(options: UseCohiQueryOptions = {}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [result, setResult] = useState<CohiQueryResponse | null>(null);

  const query = useCallback(
    async (question: string, context?: CohiQueryContextInput) => {
      setLoading(true);
      setError(null);
      setResult(null);
      try {
        const effectiveTenantId = options.tenantId ?? (import.meta.env.DEV ? "homestead" : undefined);
        const url = effectiveTenantId
          ? `/api/cohi/query?tenant_id=${encodeURIComponent(effectiveTenantId)}`
          : "/api/cohi/query";
        const data = await api.request<CohiQueryResponse>(url, {
          method: "POST",
          body: JSON.stringify({ question: question.trim(), context }),
        });
        setResult(data);
        return data;
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        setError(e);
        options.onError?.(e);
        throw e;
      } finally {
        setLoading(false);
      }
    },
    [options.tenantId, options.onError]
  );

  const reset = useCallback(() => {
    setResult(null);
    setError(null);
  }, []);

  return {
    query,
    loading,
    error,
    result,
    responsePlan: result?.responsePlan ?? null,
    dataPayloads: result?.dataPayloads ?? {},
    audit: result?.audit ?? null,
    reset,
  };
}
