import { useState, useEffect, useCallback } from "react";
import { api } from "@/lib/api";

type LosConnectionLike = {
  last_synced_at?: string | Date | null;
  sync_frequency?: string | null;
  sync_enabled?: boolean | null;
};

function latestConnectionBySync(
  connections: LosConnectionLike[]
): { lastSyncedAt: string | null; syncFrequency: string | null } {
  let best: number | null = null;
  let bestIso: string | null = null;
  let bestFrequency: string | null = null;
  for (const c of connections) {
    const v = c.last_synced_at;
    if (v == null) continue;
    const t = new Date(v as string).getTime();
    if (!Number.isFinite(t)) continue;
    if (best === null || t > best) {
      best = t;
      bestIso = typeof v === "string" ? v : new Date(v).toISOString();
      bestFrequency = c.sync_frequency ?? null;
    }
  }
  return { lastSyncedAt: bestIso, syncFrequency: bestFrequency };
}

/**
 * Latest LOS data sync time for the tenant (max last_synced_at across connections from GET /api/los/connections).
 */
export function useTenantLosLastSyncedAt(tenantId?: string | null) {
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [syncFrequency, setSyncFrequency] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const param =
        tenantId != null && tenantId !== ""
          ? `?tenant_id=${encodeURIComponent(tenantId)}`
          : "";
      const data = await api.request<{
        connections: Array<{
          last_synced_at?: string | null;
          sync_frequency?: string | null;
          sync_enabled?: boolean | null;
        }>;
      }>(`/api/los/connections${param}`);
      const latest = latestConnectionBySync(data.connections ?? []);
      setLastSyncedAt(latest.lastSyncedAt);
      setSyncFrequency(latest.syncFrequency);
    } catch {
      setLastSyncedAt(null);
      setSyncFrequency(null);
    }
  }, [tenantId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { lastSyncedAt, syncFrequency, refresh };
}
