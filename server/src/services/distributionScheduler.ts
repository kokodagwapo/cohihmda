/**
 * Distribution Scheduler
 * Polls distribution_schedules across all active tenants and processes due runs.
 * Uses FOR UPDATE SKIP LOCKED to claim rows. Phase 2 will invoke the actual send worker.
 */

import { pool as managementPool } from '../config/managementDatabase.js';
import { tenantDbManager } from '../config/tenantDatabaseManager.js';
import pg from 'pg';
import {
  buildPersistedDtstart,
  computeNextFromRecurrence,
  computeNextNFromRecurrence,
  encodeRRuleBodyFromLegacy,
} from './distributionRecurrence.js';

const POLL_INTERVAL_MS = 60_000; // 60 seconds
const MAX_CONSECUTIVE_FAILURES = 5; // Auto-pause schedule after N failures

let pollTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Normalize monthly day selection from schedule_days array and legacy schedule_day.
 */
export function normalizeMonthlyDays(
  scheduleDays: number[] | null | undefined,
  scheduleDay: number | null
): number[] | null {
  if (Array.isArray(scheduleDays) && scheduleDays.length > 0) {
    const nums = [
      ...new Set(
        scheduleDays
          .map((n) => Number(n))
          .filter((n) => Number.isInteger(n) && n >= 1 && n <= 31)
      ),
    ].sort((a, b) => a - b);
    return nums.length ? nums : null;
  }
  if (scheduleDay != null) {
    return [Math.max(1, Math.min(31, scheduleDay))];
  }
  return null;
}

/** YYYY-MM-DD for a calendar day in `tz` (en-CA locale). */
function formatYmdInTz(d: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

function parseYmd(s: string): { y: number; m: number; d: number } {
  const parts = s.split('-').map((x) => parseInt(x, 10));
  const y = parts[0]!;
  const mo = parts[1]!;
  const d = parts[2]!;
  return { y, m: mo - 1, d };
}

/** Gregorian civil date + delta days (UTC date math matches calendar days). */
function addCalendarDays(y: number, m: number, d: number, delta: number): { y: number; m: number; d: number } {
  const t = new Date(Date.UTC(y, m, d + delta));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth(), d: t.getUTCDate() };
}

/** Find an instant whose calendar date in `tz` is exactly (y, m0+1, d). */
function instantForLocalYmd(y: number, m0: number, d: number, tz: string): Date {
  const pad = (n: number, w: number) => String(n).padStart(w, '0');
  const target = `${pad(y, 4)}-${pad(m0 + 1, 2)}-${pad(d, 2)}`;
  const start = Date.UTC(y, m0, d) - 48 * 3600000;
  for (let h = 0; h < 96; h++) {
    const guess = new Date(start + h * 3600000);
    if (formatYmdInTz(guess, tz) === target) return guess;
  }
  return new Date(Date.UTC(y, m0, d, 12, 0, 0));
}

function weekdayNumberInTz(refUtc: Date, tz: string): number {
  const localFmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' });
  const dayParts = Object.fromEntries(
    localFmt.formatToParts(refUtc).map((p) => [p.type, p.value])
  );
  const dayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return dayMap[dayParts.weekday as string] ?? 0;
}

/**
 * Next run on a chosen weekday (0=Sun..6=Sat) at wall-clock time in `tz`,
 * strictly after `floor`, walking **local calendar days** in `tz` (DST-safe).
 */
export function computeWeeklyNextRun(
  hours: number,
  minutes: number,
  tz: string,
  scheduleDay: number,
  floor: Date
): Date | null {
  const targetDow = Math.max(0, Math.min(6, scheduleDay));
  let cur = parseYmd(formatYmdInTz(floor, tz));
  for (let i = 0; i < 370; i++) {
    const ref = instantForLocalYmd(cur.y, cur.m, cur.d, tz);
    const inst = wallClockToUtc(hours, minutes, tz, ref);
    if (weekdayNumberInTz(ref, tz) === targetDow && inst.getTime() > floor.getTime()) {
      return inst;
    }
    cur = addCalendarDays(cur.y, cur.m, cur.d, 1);
  }
  return null;
}

/**
 * Convert a wall-clock time (HH:MM) in a given IANA timezone to a UTC Date
 * on or after `referenceDate`.
 *
 * Uses Intl.DateTimeFormat to resolve timezone offsets without external
 * dependencies — works in Node 18+.
 */
function wallClockToUtc(
  hours: number,
  minutes: number,
  timezone: string,
  referenceDate: Date
): Date {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const parts = Object.fromEntries(
    fmt.formatToParts(referenceDate).map((p) => [p.type, p.value])
  );

  const year = parseInt(parts.year, 10);
  const month = parseInt(parts.month, 10) - 1;
  const day = parseInt(parts.day, 10);

  const refParts2 = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).formatToParts(referenceDate).map((p) => [p.type, p.value])
  );
  const refUtcMs = Date.UTC(
    parseInt(refParts2.year, 10),
    parseInt(refParts2.month, 10) - 1,
    parseInt(refParts2.day, 10),
    parseInt(refParts2.hour, 10),
    parseInt(refParts2.minute, 10),
    parseInt(refParts2.second, 10)
  );

  const localRefMs = Date.UTC(
    parseInt(parts.year, 10),
    parseInt(parts.month, 10) - 1,
    parseInt(parts.day, 10),
    parseInt(parts.hour, 10),
    parseInt(parts.minute, 10),
    parseInt(parts.second, 10)
  );

  const tzOffsetMs = refUtcMs - localRefMs;

  const localTargetMs = Date.UTC(year, month, day, hours, minutes, 0);
  return new Date(localTargetMs + tzOffsetMs);
}

function computeMonthlyNextRun(
  hours: number,
  minutes: number,
  tz: string,
  scheduleDays: number[],
  afterExclusive: Date
): Date | null {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const nowParts = Object.fromEntries(
    fmt.formatToParts(afterExclusive).map((p) => [p.type, p.value])
  );
  let y = parseInt(nowParts.year, 10);
  let mo = parseInt(nowParts.month, 10) - 1;

  for (let iter = 0; iter < 48; iter++) {
    const maxDay = new Date(y, mo + 1, 0).getDate();
    const candidateTimes: number[] = [];
    const seen = new Set<number>();
    for (const dom of scheduleDays) {
      const clamped = Math.min(Math.max(1, dom), maxDay);
      const ref = new Date(Date.UTC(y, mo, clamped));
      const instant = wallClockToUtc(hours, minutes, tz, ref);
      const t = instant.getTime();
      if (t > afterExclusive.getTime() && !seen.has(t)) {
        seen.add(t);
        candidateTimes.push(t);
      }
    }
    if (candidateTimes.length > 0) {
      return new Date(Math.min(...candidateTimes));
    }
    mo++;
    if (mo > 11) {
      mo = 0;
      y++;
    }
  }
  return null;
}

/**
 * Compute next run time from frequency, schedule_time, schedule_day, schedule_days, timezone.
 * schedule_time is wall-clock time in the given IANA timezone (e.g. "07:35" in "America/New_York").
 * The returned Date is UTC (TIMESTAMPTZ-compatible).
 *
 * Prefer {@link computeNextRunAtFromRow} for persisted schedules: it uses stored `recurrence_rule`
 * / `recurrence_dtstart` when present. This function remains as a fallback for rows not yet
 * backfilled and for monthly preview chaining.
 *
 * @param afterExclusive optional — only instants strictly after this time are considered (for preview chaining).
 * @param _options reserved for backward compatibility (ignored for RRULE-backed frequencies).
 */
export function computeNextRunAt(
  frequency: string,
  scheduleTime: string,
  scheduleDay: number | null,
  timezone: string,
  scheduleDays?: number[] | null,
  afterExclusive?: Date | null,
  _options?: { advancingAfterSend?: boolean }
): Date | null {
  try {
    const [hours, minutes] = scheduleTime.split(':').map((s) => parseInt(s, 10) || 0);
    const tz = timezone || 'America/New_York';
    const floor = afterExclusive ?? new Date();

    if (frequency === 'one_time') {
      return null;
    }

    if (frequency === 'monthly') {
      const domList = normalizeMonthlyDays(scheduleDays ?? null, scheduleDay);
      if (domList != null && domList.length > 0) {
        return computeMonthlyNextRun(hours, minutes, tz, domList, floor);
      }
      const tomorrow = new Date(floor.getTime() + 86_400_000);
      return wallClockToUtc(hours, minutes, tz, tomorrow);
    }

    const rr = encodeRRuleBodyFromLegacy({
      frequency,
      scheduleDay,
      scheduleDays: scheduleDays ?? null,
      scheduleWeekdays: null,
    });
    const dt0 = buildPersistedDtstart(
      frequency,
      scheduleTime,
      tz,
      scheduleDay,
      scheduleDays ?? null,
      null,
      floor
    );
    if (!dt0) return null;
    const next = computeNextFromRecurrence({
      recurrenceRule: rr,
      recurrenceDtstart: dt0,
      afterExclusive: floor,
    });
    if (next) return next;

    const tomorrow = new Date(floor.getTime() + 86_400_000);
    return wallClockToUtc(hours, minutes, tz, tomorrow);
  } catch {
    return null;
  }
}

export type DistributionScheduleRecurrenceRow = {
  frequency: string;
  schedule_time?: string | null;
  schedule_day?: number | null;
  schedule_days?: number[] | null;
  schedule_weekdays?: number[] | null;
  timezone?: string | null;
  recurrence_rule?: string | null;
  recurrence_dtstart?: Date | string | null;
  recurrence_exdates?: unknown;
};

/** Prefer stored RRULE + dtstart; fall back to legacy computeNextRunAt. */
export function computeNextRunAtFromRow(
  row: DistributionScheduleRecurrenceRow,
  afterExclusive?: Date | null,
  _options?: { advancingAfterSend?: boolean }
): Date | null {
  const floor = afterExclusive ?? new Date();
  if (row.frequency === 'one_time') return null;
  const rr = row.recurrence_rule;
  const rd = row.recurrence_dtstart;
  if (typeof rr === 'string' && rr.trim() && rd != null) {
    return computeNextFromRecurrence({
      recurrenceRule: rr,
      recurrenceDtstart: rd,
      recurrenceExdates: row.recurrence_exdates,
      afterExclusive: floor,
    });
  }
  return computeNextRunAt(
    row.frequency,
    row.schedule_time || '08:00',
    row.schedule_day ?? null,
    row.timezone || 'America/New_York',
    row.schedule_days ?? null,
    afterExclusive,
    _options
  );
}

/**
 * Next N scheduled run instants (for preview). Monthly uses legacy chaining; others use RRULE.
 */
export function computeNextScheduleRuns(
  frequency: string,
  scheduleTime: string,
  scheduleDay: number | null,
  timezone: string,
  scheduleDays: number[] | null | undefined,
  count: number,
  scheduleWeekdays?: number[] | null
): Date[] {
  if (frequency === 'monthly') {
    const runs: Date[] = [];
    let ref = new Date();
    for (let i = 0; i < count; i++) {
      const next = computeNextRunAt(
        frequency,
        scheduleTime,
        scheduleDay,
        timezone,
        scheduleDays ?? null,
        ref
      );
      if (!next) break;
      runs.push(next);
      ref = new Date(next.getTime() + 1);
    }
    return runs;
  }

  const tz = timezone || 'America/New_York';
  const anchor = new Date();
  const rr = encodeRRuleBodyFromLegacy({
    frequency,
    scheduleDay,
    scheduleDays: scheduleDays ?? null,
    scheduleWeekdays: scheduleWeekdays ?? null,
  });
  const dt0 = buildPersistedDtstart(
    frequency,
    scheduleTime,
    tz,
    scheduleDay,
    scheduleDays ?? null,
    scheduleWeekdays ?? null,
    anchor
  );
  if (!dt0) return [];
  return computeNextNFromRecurrence({
    recurrenceRule: rr,
    recurrenceDtstart: dt0,
    count,
    afterExclusive: anchor,
  });
}

/**
 * Claim due schedules for a tenant
 */
async function claimDueSchedules(tenantPool: pg.Pool): Promise<any[]> {
  const result = await tenantPool.query(
    `SELECT id, name, description, content_type, content_id, content_config, frequency,
            schedule_time, schedule_day, schedule_days, schedule_weekdays, timezone,
            recurrence_rule, recurrence_dtstart, recurrence_exdates,
            recipient_list_id, recipient_emails,
            failure_count
     FROM public.distribution_schedules
     WHERE is_active = true
       AND next_run_at IS NOT NULL
       AND next_run_at <= NOW()`
  );
  return result.rows;
}

/**
 * Process a single distribution schedule: generate content, send emails, log, update next_run_at
 */
async function processDistributionSchedule(
  tenantId: string,
  tenantPool: pg.Pool,
  schedule: any
): Promise<{ success: boolean; error?: string }> {
  const scheduleId = schedule.id;
  const { sendDistribution, logDistributionSend } = await import(
    './distributionEmailSender.js'
  );

  try {
    const result = await sendDistribution({
      tenantId,
      tenantPool,
      schedule,
      userFilter: null,
    });

    await logDistributionSend(
      tenantPool,
      scheduleId,
      result,
      {
        content_type: schedule.content_type,
        content_id: schedule.content_id,
        name: schedule.name,
        link: result.link ?? null,
      },
      'link'
    );

    const success = result.status === 'success' || result.successfulCount > 0;
    const nextRun = computeNextRunAtFromRow(schedule, new Date());
    if (success) {
      await tenantPool.query(
        `UPDATE public.distribution_schedules
         SET last_sent_at = NOW(),
             next_run_at = $2,
             failure_count = 0,
             updated_at = NOW()
         WHERE id = $1`,
        [scheduleId, nextRun]
      );
      console.log(
        `[DistributionScheduler] Sent schedule ${scheduleId} (tenant ${tenantId}), ${result.successfulCount}/${result.recipientsCount}, next_run_at=${nextRun?.toISOString() ?? 'none'}`
      );
    } else {
      const failureCount = (schedule.failure_count || 0) + 1;
      const isPaused = failureCount >= MAX_CONSECUTIVE_FAILURES;
      await tenantPool.query(
        `UPDATE public.distribution_schedules
         SET failure_count = $2,
             is_active = $3,
             next_run_at = $4,
             updated_at = NOW()
         WHERE id = $1`,
        [scheduleId, failureCount, !isPaused, nextRun]
      );
      console.warn(
        `[DistributionScheduler] Schedule ${scheduleId} failed (tenant ${tenantId}), failures=${failureCount}${isPaused ? ', paused' : ''}:`,
        result.errorMessage
      );
      return { success: false, error: result.errorMessage };
    }
    return { success: true };
  } catch (error: any) {
    const failureCount = (schedule.failure_count || 0) + 1;
    const nextRun = computeNextRunAtFromRow(schedule, new Date());
    const isPaused = failureCount >= MAX_CONSECUTIVE_FAILURES;

    await tenantPool.query(
      `UPDATE public.distribution_schedules
       SET failure_count = $2,
           is_active = $3,
           next_run_at = $4,
           updated_at = NOW()
       WHERE id = $1`,
      [scheduleId, failureCount, !isPaused, isPaused ? null : nextRun]
    );

    console.warn(
      `[DistributionScheduler] Schedule ${scheduleId} failed (tenant ${tenantId}), failures=${failureCount}${isPaused ? ', paused' : ''}:`,
      error.message
    );
    return { success: false, error: error.message };
  }
}

/**
 * One poll cycle: get all tenants, for each tenant claim due schedules, process each
 */
async function poll(): Promise<void> {
  let tenants: Array<{ id: string; slug: string }> = [];
  try {
    tenants = await getActiveTenants();
  } catch (error: any) {
    console.warn('[DistributionScheduler] Failed to get tenants:', error.message);
    return;
  }

  for (const tenant of tenants) {
    let tenantPool: pg.Pool;
    try {
      tenantPool = await tenantDbManager.getTenantPool(tenant.id);
    } catch (error: any) {
      console.warn(
        `[DistributionScheduler] No pool for tenant ${tenant.slug}:`,
        error.message
      );
      continue;
    }

    let due: any[] = [];
    try {
      due = await claimDueSchedules(tenantPool);
    } catch (error: any) {
      if (error.code === '42P01') {
        continue;
      }
      console.warn(
        `[DistributionScheduler] Failed to claim schedules for tenant ${tenant.slug}:`,
        error.message
      );
      continue;
    }

    if (due.length > 0) {
      console.log(`[DistributionScheduler] Found ${due.length} due schedule(s) for tenant ${tenant.slug}`);
    }

    for (const schedule of due) {
      console.log(`[DistributionScheduler] Processing schedule "${schedule.name}" (${schedule.id}) for tenant ${tenant.slug}`);
      await processDistributionSchedule(tenant.id, tenantPool, schedule);
    }
  }
}

export function startDistributionScheduler(): void {
  if (pollTimer) return;

  console.log('[DistributionScheduler] Starting (poll every 60s)');
  poll();

  pollTimer = setInterval(() => {
    void poll();
  }, POLL_INTERVAL_MS);
}

export function stopDistributionScheduler(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
    console.log('[DistributionScheduler] Stopped');
  }
}

/**
 * Get active tenants from management database
 */
async function getActiveTenants(): Promise<Array<{ id: string; slug: string }>> {
  const result = await managementPool.query(
    `SELECT id, slug FROM coheus_tenants WHERE status = 'active'`
  );
  return result.rows;
}
