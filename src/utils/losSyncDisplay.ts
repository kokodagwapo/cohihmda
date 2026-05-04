/**
 * UI labels for LOS sync timing — supports explicit clock-time schedules (sync_run_at_times)
 * as well as the legacy frequency-based estimation.
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

// ─── Fixed clock-time "next sync" calculation ────────────────────────────────

interface NextSyncInput {
  lastSyncedAtUtc?: string | null;
  syncFrequency?: string | null;
  syncRunAtTimes?: Array<{ hour: number; minute: number }> | null;
  syncAllowedWeekdays?: number[] | null;
  schedulerTimezone?: string | null;
}

function getDayOfWeekInTz(date: Date, tz: string): number {
  const dayStr = date.toLocaleDateString("en-US", { timeZone: tz, weekday: "short" });
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return map[dayStr] ?? date.getDay();
}

function getHourMinuteInTz(date: Date, tz: string): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(date);
  let hour = 0;
  let minute = 0;
  for (const p of parts) {
    if (p.type === "hour") hour = Number(p.value);
    if (p.type === "minute") minute = Number(p.value);
  }
  return { hour, minute };
}

/**
 * Compute the next scheduled sync time from configured run-time slots.
 * Searches up to 8 days ahead to find the next allowed weekday + slot.
 */
function getNextFixedClockTime(
  slots: Array<{ hour: number; minute: number }>,
  allowedWeekdays: number[],
  tz: string,
  now: Date,
): Date | null {
  if (slots.length === 0) return null;
  const sorted = [...slots].sort((a, b) => a.hour * 60 + a.minute - (b.hour * 60 + b.minute));

  for (let dayOffset = 0; dayOffset <= 8; dayOffset++) {
    const candidate = new Date(now.getTime() + dayOffset * 86400000);
    const dow = getDayOfWeekInTz(candidate, tz);
    if (!allowedWeekdays.includes(dow)) continue;

    const { hour: nowHour, minute: nowMinute } = dayOffset === 0
      ? getHourMinuteInTz(now, tz)
      : { hour: -1, minute: -1 };

    for (const slot of sorted) {
      if (dayOffset === 0 && (slot.hour * 60 + slot.minute) <= (nowHour * 60 + nowMinute)) {
        continue;
      }

      const dateStr = candidate.toLocaleDateString("en-CA", { timeZone: tz });
      const [year, month, day] = dateStr.split("-").map(Number);
      const utcEstimate = new Date(
        Date.UTC(year, month - 1, day, slot.hour, slot.minute, 0),
      );

      const offsetMs = utcEstimate.getTime() - new Date(
        utcEstimate.toLocaleString("en-US", { timeZone: tz }),
      ).getTime();
      const corrected = new Date(utcEstimate.getTime() + offsetMs);
      return corrected;
    }
  }
  return null;
}

// ─── Legacy frequency-based fallback ────────────────────────────────────────

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

// ─── Public API ─────────────────────────────────────────────────────────────

export function getEstimatedNextSyncAt(
  lastSyncedAtUtcOrInput: string | null | undefined | NextSyncInput,
  syncFrequency?: string | null | undefined,
): Date | null {
  if (lastSyncedAtUtcOrInput != null && typeof lastSyncedAtUtcOrInput === "object") {
    const input = lastSyncedAtUtcOrInput as NextSyncInput;
    const slots = input.syncRunAtTimes;
    if (Array.isArray(slots) && slots.length > 0) {
      const tz = input.schedulerTimezone || "America/New_York";
      const weekdays = Array.isArray(input.syncAllowedWeekdays) && input.syncAllowedWeekdays.length > 0
        ? input.syncAllowedWeekdays
        : [0, 1, 2, 3, 4, 5, 6];
      return getNextFixedClockTime(slots, weekdays, tz, new Date());
    }
    if (!input.lastSyncedAtUtc) return null;
    const last = new Date(input.lastSyncedAtUtc);
    if (!Number.isFinite(last.getTime())) return null;
    return new Date(last.getTime() + frequencyWindowMs(input.syncFrequency));
  }

  const isoUtc = lastSyncedAtUtcOrInput as string | null | undefined;
  if (!isoUtc) return null;
  const last = new Date(isoUtc);
  if (!Number.isFinite(last.getTime())) return null;
  return new Date(last.getTime() + frequencyWindowMs(syncFrequency));
}

export function formatEstimatedNextSyncLine(
  lastSyncedAtUtcOrInput: string | null | undefined | NextSyncInput,
  syncFrequency?: string | null | undefined,
): string {
  const next = getEstimatedNextSyncAt(lastSyncedAtUtcOrInput, syncFrequency);
  if (!next) return "Data Next Sync: Soon";
  if (next.getTime() <= Date.now()) return "Data Next Sync: Soon";
  return `Data Next Sync: ${formatLocalDateTime(next)}`;
}

export function formatEstimatedNextSyncTooltip(
  lastSyncedAtUtcOrInput: string | null | undefined | NextSyncInput,
  syncFrequency?: string | null | undefined,
): string {
  const next = getEstimatedNextSyncAt(lastSyncedAtUtcOrInput, syncFrequency);
  const isFixed =
    lastSyncedAtUtcOrInput != null &&
    typeof lastSyncedAtUtcOrInput === "object" &&
    Array.isArray((lastSyncedAtUtcOrInput as NextSyncInput).syncRunAtTimes) &&
    (lastSyncedAtUtcOrInput as NextSyncInput).syncRunAtTimes!.length > 0;
  const schedule = isFixed
    ? "fixed clock times"
    : ((typeof lastSyncedAtUtcOrInput === "object"
        ? (lastSyncedAtUtcOrInput as NextSyncInput).syncFrequency
        : syncFrequency) || "hourly").toLowerCase();
  const line =
    !next || next.getTime() <= Date.now()
      ? "Data Next Sync: Soon"
      : `Data Next Sync: ${next.toLocaleString(undefined, {
          dateStyle: "full",
          timeStyle: "medium",
        })}`;
  return `${line}\nDerived from schedule (${schedule}) and last synced timestamp. Scheduler checks approximately every 15 minutes.`;
}
