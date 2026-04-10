/**
 * UI label for los_connections.last_synced_at (stored in UTC).
 * Renders date + time in the browser's local timezone.
 */
export function formatDataLastSyncedLine(isoUtc: string | null | undefined): string {
  if (!isoUtc) return "Data Last Synced: —";
  const d = new Date(isoUtc);
  if (!Number.isFinite(d.getTime())) return "Data Last Synced: —";
  const datePart = d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "numeric",
    day: "numeric",
  });
  const timePart = d.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
  return `Data Last Synced: ${datePart} ${timePart}`;
}

function frequencyWindowMs(syncFrequency: string | null | undefined): number {
  switch ((syncFrequency || "").toLowerCase()) {
    case "realtime":
      return 5 * 60 * 1000;
    case "hourly":
      return 60 * 60 * 1000;
    case "daily":
      return 24 * 60 * 60 * 1000;
    case "weekly":
      return 7 * 24 * 60 * 60 * 1000;
    default:
      return 60 * 60 * 1000;
  }
}

function formatLocalDateTime(d: Date): string {
  const datePart = d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "numeric",
    day: "numeric",
  });
  const timePart = d.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
  return `${datePart} ${timePart}`;
}

export function getEstimatedNextSyncAt(
  lastSyncedAtUtc: string | null | undefined,
  syncFrequency: string | null | undefined
): Date | null {
  if (!lastSyncedAtUtc) return null;
  const last = new Date(lastSyncedAtUtc);
  if (!Number.isFinite(last.getTime())) return null;
  return new Date(last.getTime() + frequencyWindowMs(syncFrequency));
}

export function formatEstimatedNextSyncLine(
  lastSyncedAtUtc: string | null | undefined,
  syncFrequency: string | null | undefined
): string {
  const next = getEstimatedNextSyncAt(lastSyncedAtUtc, syncFrequency);
  if (!next) return "Data Next Sync: Soon";
  if (next.getTime() <= Date.now()) return "Data Next Sync: Soon";
  return `Data Next Sync: ${formatLocalDateTime(next)}`;
}

export function formatEstimatedNextSyncTooltip(
  lastSyncedAtUtc: string | null | undefined,
  syncFrequency: string | null | undefined
): string {
  const next = getEstimatedNextSyncAt(lastSyncedAtUtc, syncFrequency);
  const schedule = (syncFrequency || "hourly").toLowerCase();
  const line =
    !next || next.getTime() <= Date.now()
      ? "Data Next Sync: Soon"
      : `Data Next Sync: ${next.toLocaleString(undefined, {
          dateStyle: "full",
          timeStyle: "medium",
        })}`;
  return `${line}\nDerived from schedule (${schedule}) and last synced timestamp. Scheduler checks approximately every 15 minutes.`;
}
