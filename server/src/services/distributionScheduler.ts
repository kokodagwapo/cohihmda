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
 * Compute next run time from frequency, schedule_time, schedule_day, timezone.
 * Exported for use when creating/updating schedules (set initial next_run_at).
 */
export function computeNextRunAt(
  frequency: string,
  scheduleTime: string,
  scheduleDay: number | null,
  timezone: string
): Date | null {
  try {
    const [hours, minutes] = scheduleTime.split(':').map((s) => parseInt(s, 10) || 0);
    const now = new Date();

    if (frequency === 'one_time') {
      return null;
    }

    const next = new Date(now);

    if (frequency === 'daily') {
      next.setUTCHours(hours, minutes, 0, 0);
      if (next.getTime() <= now.getTime()) {
        next.setUTCDate(next.getUTCDate() + 1);
      }
      return next;
    }

    if (frequency === 'weekly' && scheduleDay != null) {
      const targetDow = Math.max(0, Math.min(6, scheduleDay));
      next.setUTCHours(hours, minutes, 0, 0);
      const currentDow = next.getUTCDay();
      let daysToAdd = targetDow - currentDow;
      if (daysToAdd < 0) daysToAdd += 7;
      if (daysToAdd === 0 && next.getTime() <= now.getTime()) daysToAdd = 7;
      next.setUTCDate(next.getUTCDate() + daysToAdd);
      return next;
    }

    if (frequency === 'biweekly') {
      next.setUTCHours(hours, minutes, 0, 0);
      next.setUTCDate(next.getUTCDate() + 14);
      return next;
    }

    if (frequency === 'monthly' && scheduleDay != null) {
      const dayOfMonth = Math.max(1, Math.min(31, scheduleDay));
      next.setUTCDate(1);
      next.setUTCMonth(next.getUTCMonth() + 1);
      const maxDay = new Date(next.getUTCFullYear(), next.getUTCMonth(), 0).getDate();
      next.setUTCDate(Math.min(dayOfMonth, maxDay));
      next.setUTCHours(hours, minutes, 0, 0);
      if (next.getTime() <= now.getTime()) {
        next.setUTCMonth(next.getUTCMonth() + 1);
        const maxDay2 = new Date(next.getUTCFullYear(), next.getUTCMonth(), 0).getDate();
        next.setUTCDate(Math.min(dayOfMonth, maxDay2));
      }
      return next;
    }

    return next;
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
      },
      result.exportFormat || 'unknown'
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
