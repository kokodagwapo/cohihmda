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
