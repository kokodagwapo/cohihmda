/**
 * Fetches additional field definitions for the Loan Detail table.
 * Returns column definitions for fields where column_created is true, so the table
 * can append them after the default columns. Refetches when tenant changes.
 */

import { useState, useEffect, useCallback } from "react";
import { api } from "@/lib/api";
import type { ColumnDef } from "@/components/views/LoanDetailView";

interface AdditionalFieldApi {
  columnName: string;
  displayName: string;
  columnCreated: boolean;
}

interface AdditionalFieldsResponse {
  fields: AdditionalFieldApi[];
}

function toColumnDef(f: AdditionalFieldApi): ColumnDef {
  return {
    id: f.columnName,
    label: f.displayName,
    field: f.columnName,
  };
}

export function useAdditionalFieldColumns(tenantId: string | null | undefined): {
  columns: ColumnDef[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
} {
  const [columns, setColumns] = useState<ColumnDef[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchFields = useCallback(async () => {
    if (!tenantId) {
      setColumns([]);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const url = `/api/tenant-config/additional-fields?tenant_id=${encodeURIComponent(tenantId)}`;
      const data = await api.request<AdditionalFieldsResponse>(url);
      const created = (data.fields ?? []).filter((f) => f.columnCreated === true);
      setColumns(created.map(toColumnDef));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load additional fields";
      setError(message);
      setColumns([]);
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    fetchFields();
  }, [fetchFields]);

  return { columns, loading, error, refetch: fetchFields };
}
