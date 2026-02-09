/**
 * useCohiWidgetData
 *
 * Fetches data for Cohi-generated widgets by executing their SQL query
 * directly against the tenant database via a lightweight execute-sql endpoint.
 * This does NOT go through the LLM/chat pipeline.
 *
 * Supports an optional dateFilter to scope the query to a date range.
 */

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';

export interface DateFilter {
  column: string;   // SQL column name to filter on (e.g. "application_date")
  start: string;    // YYYY-MM-DD
  end: string;      // YYYY-MM-DD
}

export interface CohiWidgetDataState {
  data: any[] | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

// ---------------------------------------------------------------------------
// Tenant resolution helper (same pattern as useWorkbenchCohi / useCohiChat)
// ---------------------------------------------------------------------------
let _cachedTenantId: string | null | undefined = undefined;

async function resolveEffectiveTenantId(
  explicitTenantId?: string | null
): Promise<string | null> {
  if (explicitTenantId) return explicitTenantId;
  if (_cachedTenantId !== undefined) return _cachedTenantId;
  try {
    const response = await api.request<
      { tenants: { id: string }[] } | { id: string }[]
    >('/api/tenants');
    const list = Array.isArray(response)
      ? response
      : (response as any).tenants || [];
    const first = list[0];
    if (first?.id) {
      _cachedTenantId = first.id;
      return _cachedTenantId;
    }
  } catch {
    // ignore
  }
  _cachedTenantId = null;
  return null;
}

/**
 * Execute a SQL query directly via /api/cohi-chat/execute-sql.
 * This is a lightweight endpoint that skips the LLM pipeline entirely,
 * only running the saved SQL against the tenant database.
 *
 * When `dateFilter` is provided, the server wraps the SQL in a CTE
 * that filters to the given date range on the specified column.
 */
export function useCohiWidgetData(
  sql: string | undefined,
  tenantId?: string | null,
  dateFilter?: DateFilter | null,
): CohiWidgetDataState {
  const [data, setData] = useState<any[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [trigger, setTrigger] = useState(0);

  const refetch = useCallback(() => setTrigger((t) => t + 1), []);

  useEffect(() => {
    if (!sql) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const effectiveTid = await resolveEffectiveTenantId(tenantId);

        const endpoint = effectiveTid
          ? `/api/cohi-chat/execute-sql?tenant_id=${encodeURIComponent(effectiveTid)}`
          : '/api/cohi-chat/execute-sql';

        const body: Record<string, unknown> = { sql };
        if (dateFilter) {
          body.dateFilter = dateFilter;
        }

        const response = await api.request<{
          data?: any[];
          error?: string;
          message?: string;
        }>(endpoint, {
          method: 'POST',
          body: JSON.stringify(body),
        });

        if (cancelled) return;

        if (response.error) {
          setError(response.error);
          setData(null);
        } else {
          setData(response.data || []);
          setError(null);
        }
      } catch (err: any) {
        if (cancelled) return;
        setError(err.message || 'Failed to fetch data');
        setData(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [sql, tenantId, dateFilter?.column, dateFilter?.start, dateFilter?.end, trigger]);

  return { data, loading, error, refetch };
}
