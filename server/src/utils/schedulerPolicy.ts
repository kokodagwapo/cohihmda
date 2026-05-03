/**
 * COHI-351: Timezone-aware weekend / business-day policy for automatic scheduler
 * and scheduled-trigger post-sync insight hooks. Manual sync is never blocked here.
 */

import { logWarn } from "../services/logger.js";

export type SyncTrigger = "scheduled" | "manual" | "webhook" | "unknown";

const DEFAULT_TZ = "America/New_York";
const ALL_WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];

const WEEKDAY_TO_NUM: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/** Validate IANA timezone; fall back to America/New_York. */
export function normalizeSchedulerTimezone(value: unknown): string {
  const s =
    typeof value === "string" && value.trim().length > 0
      ? value.trim()
      : DEFAULT_TZ;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: s }).format(new Date());
    return s;
  } catch {
    logWarn("[schedulerPolicy] Invalid scheduler timezone; using default", {
      value: s,
    });
    return DEFAULT_TZ;
  }
}

/**
 * Day-of-week in the given IANA timezone: 0 = Sunday … 6 = Saturday.
 */
export function getDayOfWeekInTimeZone(
  date: Date,
  timeZone?: string | null,
): number {
  const tz = normalizeSchedulerTimezone(timeZone);
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      weekday: "short",
    });
    const weekday = formatter.formatToParts(date).find((p) => p.type === "weekday")
      ?.value;
    if (weekday && WEEKDAY_TO_NUM[weekday] !== undefined) {
      return WEEKDAY_TO_NUM[weekday];
    }
  } catch {
    // fall through to default TZ
  }
  const fallback = new Intl.DateTimeFormat("en-US", {
    timeZone: DEFAULT_TZ,
    weekday: "short",
  });
  const w = fallback.formatToParts(date).find((p) => p.type === "weekday")?.value;
  return w && WEEKDAY_TO_NUM[w] !== undefined ? WEEKDAY_TO_NUM[w] : 1;
}

export function getHourInTimeZone(date: Date, timeZone?: string | null): number {
  const tz = normalizeSchedulerTimezone(timeZone);
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "numeric",
      hour12: false,
    });
    const hourToken = formatter.formatToParts(date).find((p) => p.type === "hour")
      ?.value;
    const hour = hourToken ? Number(hourToken) : NaN;
    if (hour === 24) return 0;
    if (Number.isInteger(hour) && hour >= 0 && hour <= 23) {
      return hour;
    }
  } catch {
    // fall through to default TZ
  }
  const fallback = new Intl.DateTimeFormat("en-US", {
    timeZone: DEFAULT_TZ,
    hour: "numeric",
    hour12: false,
  });
  const h = fallback.formatToParts(date).find((p) => p.type === "hour")?.value;
  const hour = h ? Number(h) : 0;
  return hour === 24 ? 0 : hour;
}

export function isWeekendInTimeZone(
  date: Date,
  timeZone?: string | null,
): boolean {
  const dow = getDayOfWeekInTimeZone(date, timeZone);
  return dow === 0 || dow === 6;
}

function normalizeAllowedNumbers(values: unknown, fallback: number[]): number[] {
  if (!Array.isArray(values) || values.length === 0) {
    return fallback;
  }
  return [...new Set(values.map(Number))].sort((a, b) => a - b);
}

/** Weekdays (0=Sun–6=Sat) when automatic sync may run, based on explicit weekdays or business-days fallback. */
export function resolveSchedulerAllowedWeekdays(input: {
  allowedWeekdays?: number[] | null;
  businessDaysOnly?: boolean | null;
}): number[] {
  if (Array.isArray(input.allowedWeekdays) && input.allowedWeekdays.length > 0) {
    return normalizeAllowedNumbers(input.allowedWeekdays, ALL_WEEKDAYS);
  }
  return input.businessDaysOnly ? [1, 2, 3, 4, 5] : ALL_WEEKDAYS;
}

export function getCalendarDateKeyInTimeZone(date: Date, timeZone?: string | null): string {
  const tz = normalizeSchedulerTimezone(timeZone);
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date);
  } catch {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: DEFAULT_TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date);
  }
}

export function isSameLocalCalendarDay(
  a: Date,
  b: Date,
  timeZone?: string | null,
): boolean {
  return getCalendarDateKeyInTimeZone(a, timeZone) === getCalendarDateKeyInTimeZone(b, timeZone);
}

/** Hour (0–23) and minute (0–59) in `timeZone` for `date`. */
export function getHourMinuteInTimeZone(
  date: Date,
  timeZone?: string | null,
): { hour: number; minute: number } {
  const tz = normalizeSchedulerTimezone(timeZone);
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "numeric",
      minute: "numeric",
      hour12: false,
    });
    const parts = formatter.formatToParts(date);
    const hourRaw = parts.find((p) => p.type === "hour")?.value;
    const minuteRaw = parts.find((p) => p.type === "minute")?.value;
    let hour = hourRaw ? Number(hourRaw) : 0;
    const minute = minuteRaw ? Number(minuteRaw) : 0;
    if (hour === 24) hour = 0;
    return {
      hour: Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : 0,
      minute: Number.isInteger(minute) && minute >= 0 && minute <= 59 ? minute : 0,
    };
  } catch {
    const fallback = new Intl.DateTimeFormat("en-US", {
      timeZone: DEFAULT_TZ,
      hour: "numeric",
      minute: "numeric",
      hour12: false,
    });
    const parts = fallback.formatToParts(date);
    let hour = Number(parts.find((p) => p.type === "hour")?.value || "0");
    const minute = Number(parts.find((p) => p.type === "minute")?.value || "0");
    if (hour === 24) hour = 0;
    return { hour, minute };
  }
}

export function getMinutesSinceMidnightInTimeZone(
  date: Date,
  timeZone?: string | null,
): number {
  const { hour, minute } = getHourMinuteInTimeZone(date, timeZone);
  return hour * 60 + minute;
}

export type SyncRunAtTime = { hour: number; minute: number; runInsights?: boolean };

export function normalizeSyncRunAtTimes(
  value: unknown,
):
  | { valid: true; value: SyncRunAtTime[] }
  | { valid: false; error: string } {
  if (value === undefined || value === null) {
    return { valid: true, value: [] };
  }
  if (!Array.isArray(value)) {
    return { valid: false, error: "sync_run_at_times must be an array" };
  }
  if (value.length > 24) {
    return { valid: false, error: "sync_run_at_times may include at most 24 entries" };
  }
  const out: SyncRunAtTime[] = [];
  const seen = new Set<number>();
  for (const item of value) {
    if (!item || typeof item !== "object") {
      return { valid: false, error: "sync_run_at_times entries must be objects" };
    }
    const rec = item as Record<string, unknown>;
    const hour = Number(rec.hour);
    const minute = Number(rec.minute);
    const runInsights = rec.runInsights === true || rec.run_insights === true;
    if (!Number.isInteger(hour) || !Number.isInteger(minute)) {
      return { valid: false, error: "sync_run_at_times entries must have integer hour and minute" };
    }
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
      return {
        valid: false,
        error: "sync_run_at_times hour must be 0–23 and minute 0–59",
      };
    }
    const key = hour * 60 + minute;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push({ hour, minute, runInsights });
  }
  out.sort((a, b) => a.hour * 60 + a.minute - (b.hour * 60 + b.minute));
  return { valid: true, value: out };
}

/** Align with losSyncScheduler tick interval (every 15 minutes). */
export const SCHEDULER_TICK_WINDOW_MINUTES = 15;

/**
 * When `sync_run_at_times` is non-empty, automatic sync runs at these local clock times
 * (per scheduler_timezone), one run per slot per calendar day in that timezone.
 * The scheduler wakes every ~15 minutes; a slot at 08:30 fires in [08:30, 08:45).
 */
export function getDueFixedClockTime(input: {
  runAtTimes: SyncRunAtTime[];
  timeZone?: string | null;
  allowedWeekdays?: number[] | null;
  businessDaysOnly?: boolean | null;
  lastSyncedAt?: Date | null;
  now?: Date;
  tickWindowMinutes?: number;
}): SyncRunAtTime | null {
  const slots = input.runAtTimes?.filter(Boolean) ?? [];
  if (slots.length === 0) {
    return null;
  }

  const now = input.now ?? new Date();
  const tz = input.timeZone;
  const allowedWeekdays = resolveSchedulerAllowedWeekdays({
    allowedWeekdays: input.allowedWeekdays,
    businessDaysOnly: input.businessDaysOnly,
  });

  const day = getDayOfWeekInTimeZone(now, tz);
  if (!allowedWeekdays.includes(day)) {
    return null;
  }

  const nowMinutes = getMinutesSinceMidnightInTimeZone(now, tz);
  const W = input.tickWindowMinutes ?? SCHEDULER_TICK_WINDOW_MINUTES;

  const lastSyncedAt = input.lastSyncedAt ? new Date(input.lastSyncedAt) : null;

  for (const slot of slots) {
    const slotMinutes = slot.hour * 60 + slot.minute;
    if (nowMinutes < slotMinutes || nowMinutes >= slotMinutes + W) {
      continue;
    }

    if (!lastSyncedAt) {
      return slot;
    }

    if (!isSameLocalCalendarDay(lastSyncedAt, now, tz)) {
      return slot;
    }

    const lastMinutes = getMinutesSinceMidnightInTimeZone(lastSyncedAt, tz);
    if (lastMinutes >= slotMinutes && lastMinutes < slotMinutes + W) {
      return null;
    }
    return slot;
  }

  return null;
}

export function shouldRunFixedClockTimes(input: {
  runAtTimes: SyncRunAtTime[];
  timeZone?: string | null;
  allowedWeekdays?: number[] | null;
  businessDaysOnly?: boolean | null;
  lastSyncedAt?: Date | null;
  now?: Date;
  tickWindowMinutes?: number;
}): boolean {
  return getDueFixedClockTime(input) !== null;
}

/**
 * Whether automatic post-sync insight hooks (prediction / agent / tracked) may run.
 * Non-scheduled triggers always return true so manual sync is unrestricted.
 */
export function shouldRunScheduledPostSyncInsights(input: {
  trigger?: SyncTrigger;
  businessDaysOnly?: boolean | null;
  timeZone?: string | null;
  now?: Date;
}): boolean {
  if (input.trigger !== "scheduled") {
    return true;
  }
  if (!input.businessDaysOnly) {
    return true;
  }
  const now = input.now ?? new Date();
  return !isWeekendInTimeZone(now, input.timeZone);
}
