import { useState, useEffect, useCallback } from "react";
import { api } from "@/lib/api";

type LosConnectionLike = {
  last_synced_at?: string | Date | null;
  sync_frequency?: string | null;
  sync_enabled?: boolean | null;
  sync_run_at_times?: Array<{ hour: number; minute: number }> | null;
  sync_allowed_weekdays?: number[] | null;
  scheduler_timezone?: string | null;
};

interface LatestConnectionInfo {
  lastSyncedAt: string | null;
  syncFrequency: string | null;
  syncRunAtTimes: Array<{ hour: number; minute: number }> | null;
  syncAllowedWeekdays: number[] | null;
  schedulerTimezone: string | null;
}

function latestConnectionBySync(connections: LosConnectionLike[]): LatestConnectionInfo {
  let best: number | null = null;
  let bestIso: string | null = null;
  let bestFrequency: string | null = null;
  let bestRunAtTimes: Array<{ hour: number; minute: number }> | null = null;
  let bestWeekdays: number[] | null = null;
  let bestTimezone: string | null = null;
  for (const c of connections) {
    const v = c.last_synced_at;
    if (v == null) continue;
    const t = new Date(v as string).getTime();
    if (!Number.isFinite(t)) continue;
    if (best === null || t > best) {
      best = t;
      bestIso = typeof v === "string" ? v : new Date(v).toISOString();
      bestFrequency = c.sync_frequency ?? null;
      bestRunAtTimes = Array.isArray(c.sync_run_at_times) ? c.sync_run_at_times : null;
      bestWeekdays = Array.isArray(c.sync_allowed_weekdays) ? c.sync_allowed_weekdays : null;
      bestTimezone = c.scheduler_timezone ?? null;
    }
  }
  return {
    lastSyncedAt: bestIso,
    syncFrequency: bestFrequency,
    syncRunAtTimes: bestRunAtTimes,
    syncAllowedWeekdays: bestWeekdays,
    schedulerTimezone: bestTimezone,
  };
}

/**
 * Latest LOS data sync time for the tenant (max last_synced_at across connections from GET /api/los/connections).
 */
export function useTenantLosLastSyncedAt(tenantId?: string | null) {
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [syncFrequency, setSyncFrequency] = useState<string | null>(null);
  const [syncRunAtTimes, setSyncRunAtTimes] = useState<Array<{ hour: number; minute: number }> | null>(null);
  const [syncAllowedWeekdays, setSyncAllowedWeekdays] = useState<number[] | null>(null);
  const [schedulerTimezone, setSchedulerTimezone] = useState<string | null>(null);

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
          sync_run_at_times?: Array<{ hour: number; minute: number }> | null;
          sync_allowed_weekdays?: number[] | null;
          scheduler_timezone?: string | null;
        }>;
      }>(`/api/los/connections${param}`);
      const latest = latestConnectionBySync(data.connections ?? []);
      setLastSyncedAt(latest.lastSyncedAt);
      setSyncFrequency(latest.syncFrequency);
      setSyncRunAtTimes(latest.syncRunAtTimes);
      setSyncAllowedWeekdays(latest.syncAllowedWeekdays);
      setSchedulerTimezone(latest.schedulerTimezone);
    } catch {
      setLastSyncedAt(null);
      setSyncFrequency(null);
      setSyncRunAtTimes(null);
      setSyncAllowedWeekdays(null);
      setSchedulerTimezone(null);
    }
  }, [tenantId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { lastSyncedAt, syncFrequency, syncRunAtTimes, syncAllowedWeekdays, schedulerTimezone, refresh };
}
