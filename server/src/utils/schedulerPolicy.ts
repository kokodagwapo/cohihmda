/**
 * COHI-351: Timezone-aware weekend / business-day policy for automatic scheduler
 * and scheduled-trigger post-sync insight hooks. Manual sync is never blocked here.
 */

import { logWarn } from "../services/logger.js";

export type SyncTrigger = "scheduled" | "manual" | "webhook" | "unknown";

const DEFAULT_TZ = "America/New_York";
const ALL_WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];
const ALL_HOURS = Array.from({ length: 24 }, (_, hour) => hour);

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

/** Whether the automatic LOS scheduler may start a sync at `now`. */
export function shouldRunScheduledSync(input: {
  businessDaysOnly?: boolean | null;
  timeZone?: string | null;
  allowedWeekdays?: number[] | null;
  allowedHours?: number[] | null;
  now?: Date;
}): boolean {
  const now = input.now ?? new Date();
  const day = getDayOfWeekInTimeZone(now, input.timeZone);
  const hour = getHourInTimeZone(now, input.timeZone);
  const allowedWeekdays = Array.isArray(input.allowedWeekdays) && input.allowedWeekdays.length > 0
    ? normalizeAllowedNumbers(input.allowedWeekdays, ALL_WEEKDAYS)
    : input.businessDaysOnly
      ? [1, 2, 3, 4, 5]
      : ALL_WEEKDAYS;
  const allowedHours = normalizeAllowedNumbers(input.allowedHours, ALL_HOURS);
  return allowedWeekdays.includes(day) && allowedHours.includes(hour);
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
