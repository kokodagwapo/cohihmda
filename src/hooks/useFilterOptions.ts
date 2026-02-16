/**
 * useFilterOptions – Lightweight hook for fetching distinct column values
 * to populate filter dropdowns.
 *
 * Supports cascading/dependent filters: pass `filterBy` + `filterValue`
 * to narrow results (e.g. loan officers for a specific branch).
 *
 * Re-fetches automatically when any parameter changes.
 */
import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';

export interface FilterOptionsParams {
  /** The DB column to fetch distinct values for (e.g. 'branch', 'loan_officer') */
  column: string;
  /** Tenant ID for multi-tenant support */
  tenantId?: string | null;
  /** Optional parent column name for cascading (e.g. 'branch') */
  filterBy?: string;
  /** Optional parent column value for cascading (e.g. 'Downtown'). Ignored when 'all' or empty. */
  filterValue?: string;
  /** Set to false to disable fetching (e.g. when the column is not needed) */
  enabled?: boolean;
}

export interface FilterOptionsResult {
  options: string[];
  loading: boolean;
  error: string | null;
}

export function useFilterOptions({
  column,
  tenantId,
  filterBy,
  filterValue,
  enabled = true,
}: FilterOptionsParams): FilterOptionsResult {
  const [options, setOptions] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchOptions = useCallback(async () => {
    if (!enabled || !column) {
      setOptions([]);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      // Build URL with query params
      const params = new URLSearchParams();
      if (tenantId) params.set('tenant_id', tenantId);
      if (filterBy && filterValue && filterValue !== 'all') {
        params.set('filterBy', filterBy);
        params.set('filterValue', filterValue);
      }

      const qs = params.toString();
      const url = `/api/loans/distinct-values/${encodeURIComponent(column)}${qs ? `?${qs}` : ''}`;

      const result = await api.request<{ values: string[] }>(url);
      setOptions(result.values ?? []);
    } catch (err: any) {
      console.error(`[useFilterOptions] Error fetching ${column}:`, err);
      setError(err.message || `Failed to fetch ${column} options`);
      setOptions([]);
    } finally {
      setLoading(false);
    }
  }, [column, tenantId, filterBy, filterValue, enabled]);

  useEffect(() => {
    fetchOptions();
  }, [fetchOptions]);

  return { options, loading, error };
}
