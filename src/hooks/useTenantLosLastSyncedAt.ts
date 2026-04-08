import { useState, useEffect, useCallback } from "react";
import { api } from "@/lib/api";

function maxLastSyncedAt(
  connections: Array<{ last_synced_at?: string | Date | null }>
): string | null {
  let best: number | null = null;
  let bestIso: string | null = null;
  for (const c of connections) {
    const v = c.last_synced_at;
    if (v == null) continue;
    const t = new Date(v as string).getTime();
    if (!Number.isFinite(t)) continue;
    if (best === null || t > best) {
      best = t;
      bestIso = typeof v === "string" ? v : new Date(v).toISOString();
    }
  }
  return bestIso;
}

/**
 * Latest LOS data sync time for the tenant (max last_synced_at across connections from GET /api/los/connections).
 */
export function useTenantLosLastSyncedAt(tenantId?: string | null) {
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const param =
        tenantId != null && tenantId !== ""
          ? `?tenant_id=${encodeURIComponent(tenantId)}`
          : "";
      const data = await api.request<{
        connections: Array<{ last_synced_at?: string | null }>;
      }>(`/api/los/connections${param}`);
      setLastSyncedAt(maxLastSyncedAt(data.connections ?? []));
    } catch {
      setLastSyncedAt(null);
    }
  }, [tenantId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { lastSyncedAt, refresh };
}
