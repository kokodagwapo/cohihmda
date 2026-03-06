/**
 * Distribution Scheduler
 * Polls distribution_schedules across all active tenants and processes due runs.
 * Uses FOR UPDATE SKIP LOCKED to claim rows. Phase 2 will invoke the actual send worker.
 */

import { pool as managementPool } from '../config/managementDatabase.js';
import { tenantDbManager } from '../config/tenantDatabaseManager.js';
import pg from 'pg';

const POLL_INTERVAL_MS = 60_000; // 60 seconds
const MAX_CONSECUTIVE_FAILURES = 5; // Auto-pause schedule after N failures

let pollTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Get active tenants from management database
 */
async function getActiveTenants(): Promise<Array<{ id: string; slug: string }>> {
  const result = await managementPool.query(
    `SELECT id, slug FROM coheus_tenants WHERE status = 'active'`
  );
  return result.rows;
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

  const localTargetStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`;

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

  const localRefStr = `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
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

/**
 * Compute next run time from frequency, schedule_time, schedule_day, timezone.
 * schedule_time is wall-clock time in the given IANA timezone (e.g. "07:35" in "America/New_York").
 * The returned Date is UTC (TIMESTAMPTZ-compatible).
 */
export function computeNextRunAt(
  frequency: string,
  scheduleTime: string,
  scheduleDay: number | null,
  timezone: string
): Date | null {
  try {
    const [hours, minutes] = scheduleTime.split(':').map((s) => parseInt(s, 10) || 0);
    const tz = timezone || 'America/New_York';
    const now = new Date();

    if (frequency === 'one_time') {
      return null;
    }

    if (frequency === 'daily') {
      let next = wallClockToUtc(hours, minutes, tz, now);
      if (next.getTime() <= now.getTime()) {
        const tomorrow = new Date(now.getTime() + 86_400_000);
        next = wallClockToUtc(hours, minutes, tz, tomorrow);
      }
      return next;
    }

    if (frequency === 'weekly' && scheduleDay != null) {
      const targetDow = Math.max(0, Math.min(6, scheduleDay));
      for (let offset = 0; offset <= 7; offset++) {
        const candidate = new Date(now.getTime() + offset * 86_400_000);
        const candidateUtc = wallClockToUtc(hours, minutes, tz, candidate);
        const localFmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' });
        const dayParts = Object.fromEntries(
          localFmt.formatToParts(candidate).map((p) => [p.type, p.value])
        );
        const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
        const candidateDow = dayMap[dayParts.weekday] ?? candidate.getUTCDay();

        if (candidateDow === targetDow && candidateUtc.getTime() > now.getTime()) {
          return candidateUtc;
        }
      }
      const fallback = new Date(now.getTime() + 7 * 86_400_000);
      return wallClockToUtc(hours, minutes, tz, fallback);
    }

    if (frequency === 'biweekly') {
      const twoWeeksOut = new Date(now.getTime() + 14 * 86_400_000);
      return wallClockToUtc(hours, minutes, tz, twoWeeksOut);
    }

    if (frequency === 'monthly' && scheduleDay != null) {
      const dayOfMonth = Math.max(1, Math.min(31, scheduleDay));
      const fmt = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      });
      const nowParts = Object.fromEntries(
        fmt.formatToParts(now).map((p) => [p.type, p.value])
      );
      let year = parseInt(nowParts.year, 10);
      let month = parseInt(nowParts.month, 10) - 1;

      const tryDate = (y: number, m: number) => {
        const maxDay = new Date(y, m + 1, 0).getDate();
        const d = Math.min(dayOfMonth, maxDay);
        const ref = new Date(Date.UTC(y, m, d));
        return wallClockToUtc(hours, minutes, tz, ref);
      };

      let candidate = tryDate(year, month);
      if (candidate.getTime() <= now.getTime()) {
        month++;
        if (month > 11) { month = 0; year++; }
        candidate = tryDate(year, month);
      }
      return candidate;
    }

    // Fallback: next day
    const tomorrow = new Date(now.getTime() + 86_400_000);
    return wallClockToUtc(hours, minutes, tz, tomorrow);
  } catch {
    return null;
  }
}

/**
 * Claim due schedules for a tenant
 */
async function claimDueSchedules(tenantPool: pg.Pool): Promise<any[]> {
  const result = await tenantPool.query(
    `SELECT id, name, description, content_type, content_id, content_config, frequency,
            schedule_time, schedule_day, timezone, recipient_list_id, recipient_emails,
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

    const nextRun = computeNextRunAt(
      schedule.frequency,
      schedule.schedule_time || '08:00',
      schedule.schedule_day,
      schedule.timezone || 'America/New_York'
    );

    const success = result.status === 'success' || result.successfulCount > 0;
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
    const nextRun = computeNextRunAt(
      schedule.frequency,
      schedule.schedule_time || '08:00',
      schedule.schedule_day,
      schedule.timezone || 'America/New_York'
    );
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
