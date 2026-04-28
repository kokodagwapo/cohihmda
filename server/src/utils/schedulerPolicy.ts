/**
 * COHI-351: Timezone-aware weekend / business-day policy for automatic scheduler
 * and scheduled-trigger post-sync insight hooks. Manual sync is never blocked here.
 */

import { logWarn } from "../services/logger.js";

export type SyncTrigger = "scheduled" | "manual" | "webhook" | "unknown";

const DEFAULT_TZ = "America/New_York";

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

export function isWeekendInTimeZone(
  date: Date,
  timeZone?: string | null,
): boolean {
  const dow = getDayOfWeekInTimeZone(date, timeZone);
  return dow === 0 || dow === 6;
}

/** Whether the automatic LOS scheduler may start a sync at `now`. */
export function shouldRunScheduledSync(input: {
  businessDaysOnly?: boolean | null;
  timeZone?: string | null;
  now?: Date;
}): boolean {
  if (!input.businessDaysOnly) {
    return true;
  }
  const now = input.now ?? new Date();
  return !isWeekendInTimeZone(now, input.timeZone);
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
