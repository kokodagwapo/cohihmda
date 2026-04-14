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

/**
 * A single dimension filter condition to inject into the SQL WHERE clause.
 * E.g. { column: 'branch', value: 'West Coast' } → WHERE branch = 'West Coast'
 */
export interface DimensionFilter {
  column: string;
  value: string;
}

export interface CohiWidgetDataState {
  data: any[] | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
  /** If the server auto-fixed the SQL, this contains the corrected SQL string. */
  fixedSql?: string;
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
 * When `runAsIs` is true (e.g. research-lab widgets), the server runs the SQL
 * exactly as stored with no sanitization or filter injection — same as research lab.
 *
 * When `dateFilter` is provided (and not runAsIs), the server injects date conditions.
 * When `dimensionFilters` are provided (and not runAsIs), the server injects WHERE conditions.
 */
export function useCohiWidgetData(
  sql: string | undefined,
  tenantId?: string | null,
  dateFilter?: DateFilter | null,
  dimensionFilters?: DimensionFilter[] | null,
  runAsIs?: boolean,
  onSqlFixed?: (newSql: string) => void,
): CohiWidgetDataState {
  const [data, setData] = useState<any[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fixedSql, setFixedSql] = useState<string | undefined>(undefined);
  const [trigger, setTrigger] = useState(0);

  const refetch = useCallback(() => setTrigger((t) => t + 1), []);

  // Stable serialized key for dimension filters to use in dependency array
  const dimKey = dimensionFilters?.map((d) => `${d.column}=${d.value}`).join('|') ?? '';

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
        if (runAsIs) {
          body.runAsIs = true;
        }
        if (dateFilter && !runAsIs) {
          body.dateFilter = dateFilter;
        }
        if (dimensionFilters && dimensionFilters.length > 0 && !runAsIs) {
          body.dimensionFilters = dimensionFilters;
        }

        const response = await api.request<{
          data?: any[];
          error?: string;
          message?: string;
          fixedSql?: string;
        }>(endpoint, {
          method: 'POST',
          body: JSON.stringify(body),
        });

        if (cancelled) return;

        if (response.error) {
          if (response.message) {
            console.error('[CohiWidget SQL Error]', response.message);
          }
          setError(response.error);
          setData(null);
        } else {
          setData(response.data || []);
          setError(null);
          // Server auto-fixed the SQL — notify the canvas so it can update the stored query
          if (response.fixedSql) {
            setFixedSql(response.fixedSql);
            onSqlFixed?.(response.fixedSql);
          }
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
  }, [sql, tenantId, dateFilter?.column, dateFilter?.start, dateFilter?.end, dimKey, trigger, runAsIs]);

  return { data, loading, error, refetch, fixedSql };
}
