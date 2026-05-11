/**
 * Report Distribution API Routes
 * CRUD for distribution_schedules and distribution_recipient_lists (tenant DB).
 * Authorization: tenant_admin, super_admin, platform_admin.
 */
import { Router } from 'express';
import { authenticateToken, AuthRequest } from '../middleware/auth.js';
import {
  attachTenantContext,
  getTenantContext,
} from '../middleware/tenantContext.js';
import { requireRole } from '../middleware/rbac.js';
import {
  computeNextRunAtFromRow,
  computeNextScheduleRuns,
  normalizeMonthlyDays,
} from '../services/distributionScheduler.js';
import {
  buildPersistedDtstart,
  buildRecurrenceDtstart,
  encodeRRuleBodyFromLegacy,
  validateRecurrenceRuleBody,
  computeNextNFromRecurrence,
} from '../services/distributionRecurrence.js';

const router = Router();

/** Parse and dedupe schedule_days (1–31) from client JSON */
function parseScheduleDaysInput(input: unknown): number[] | null {
  if (!Array.isArray(input)) return null;
  const nums = input
    .map((x) => Number(x))
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= 31);
  const uniq = [...new Set(nums)].sort((a, b) => a - b);
  return uniq.length ? uniq : null;
}

/** Parse and dedupe schedule_weekdays (0–6) from client JSON */
function parseScheduleWeekdaysInput(input: unknown): number[] | null {
  if (!Array.isArray(input)) return null;
  const nums = input
    .map((x) => Number(x))
    .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
  const uniq = [...new Set(nums)].sort((a, b) => a - b);
  return uniq.length ? uniq : null;
}

function parseRecurrenceExdatesInput(input: unknown): Date[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((x) => new Date(String(x)))
    .filter((d) => !Number.isNaN(d.getTime()));
}

function buildRecurrenceFieldsForApi(
  frequency: string,
  scheduleTime: string,
  tz: string,
  scheduleDayOut: number | null,
  scheduleDaysOut: number[] | null,
  scheduleWeekdaysOut: number[] | null,
  body: Record<string, unknown>,
  anchor: Date
): {
  recurrence_rule: string | null;
  recurrence_dtstart: Date | null;
  recurrence_exdates: Date[];
  schedule_weekdays: number[] | null;
} {
  if (frequency === 'one_time') {
    return {
      recurrence_rule: null,
      recurrence_dtstart: null,
      recurrence_exdates: [],
      schedule_weekdays: null,
    };
  }
  if (frequency === 'custom') {
    const rule = typeof body.recurrence_rule === 'string' ? body.recurrence_rule : '';
    validateRecurrenceRuleBody(rule);
    const dtRaw = body.recurrence_dtstart;
    const dt =
      dtRaw != null && dtRaw !== ''
        ? new Date(String(dtRaw))
        : buildRecurrenceDtstart(tz, scheduleTime, anchor);
    return {
      recurrence_rule: rule.trim(),
      recurrence_dtstart: dt,
      recurrence_exdates: parseRecurrenceExdatesInput(body.recurrence_exdates),
      schedule_weekdays: null,
    };
  }
  const rr = encodeRRuleBodyFromLegacy({
    frequency,
    scheduleDay: scheduleDayOut,
    scheduleDays: scheduleDaysOut,
    scheduleWeekdays: scheduleWeekdaysOut,
  });
  const dt = buildPersistedDtstart(
    frequency,
    scheduleTime,
    tz,
    scheduleDayOut,
    scheduleDaysOut,
    scheduleWeekdaysOut,
    anchor
  );
  return {
    recurrence_rule: rr,
    recurrence_dtstart: dt,
    recurrence_exdates: [],
    schedule_weekdays: scheduleWeekdaysOut,
  };
}
const requireDistributionsAdmin = requireRole(
  'tenant_admin',
  'super_admin',
  'platform_admin'
);

// ---------------------------------------------------------------------------
// Recipient lists (must be before /:id to avoid "recipient-lists" as id)
// ---------------------------------------------------------------------------

/** GET /recipient-lists — List recipient lists for current tenant */
router.get(
  '/recipient-lists',
  authenticateToken,
  attachTenantContext,
  requireDistributionsAdmin,
  async (req: AuthRequest, res) => {
    try {
      const { tenantPool } = getTenantContext(req);
      const result = await tenantPool.query(
        `SELECT id, name, description, created_by, user_ids, external_emails,
                role_filter, is_dynamic, auto_invite, auto_invite_group_id, created_at, updated_at
         FROM public.distribution_recipient_lists
         ORDER BY name ASC`
      );
      res.json({ lists: result.rows });
    } catch (error: any) {
      console.error('[Distributions] Error listing recipient lists:', error.message);
      res.status(500).json({
        error: 'Failed to list recipient lists',
        message: error.message,
      });
    }
  }
);

/** POST /recipient-lists — Create recipient list */
router.post(
  '/recipient-lists',
  authenticateToken,
  attachTenantContext,
  requireDistributionsAdmin,
  async (req: AuthRequest, res) => {
    try {
      const { tenantPool } = getTenantContext(req);
      const {
        name,
        description,
        user_ids = [],
        external_emails = [],
        role_filter = [],
        is_dynamic = false,
        auto_invite = false,
        auto_invite_group_id = null,
      } = req.body ?? {};
      if (!name || typeof name !== 'string') {
        return res.status(400).json({ error: 'name is required' });
      }
      const result = await tenantPool.query(
        `INSERT INTO public.distribution_recipient_lists
         (name, description, created_by, user_ids, external_emails, role_filter, is_dynamic, auto_invite, auto_invite_group_id, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
         RETURNING id, name, description, created_by, user_ids, external_emails, role_filter, is_dynamic, auto_invite, auto_invite_group_id, created_at, updated_at`,
        [
          name.trim(),
          description?.trim() ?? null,
          req.userId,
          Array.isArray(user_ids) ? user_ids : [],
          Array.isArray(external_emails) ? external_emails : [],
          Array.isArray(role_filter) ? role_filter : [],
          Boolean(is_dynamic),
          Boolean(auto_invite),
          auto_invite_group_id ?? null,
        ]
      );
      res.status(201).json(result.rows[0]);
    } catch (error: any) {
      console.error('[Distributions] Error creating recipient list:', error.message);
      res.status(500).json({
        error: 'Failed to create recipient list',
        message: error.message,
      });
    }
  }
);

/** PUT /recipient-lists/:id — Update recipient list */
router.put(
  '/recipient-lists/:id',
  authenticateToken,
  attachTenantContext,
  requireDistributionsAdmin,
  async (req: AuthRequest, res) => {
    try {
      const { tenantPool } = getTenantContext(req);
      const { id } = req.params;
      const {
        name,
        description,
        user_ids,
        external_emails,
        role_filter,
        is_dynamic,
        auto_invite,
        auto_invite_group_id,
      } = req.body ?? {};
      const result = await tenantPool.query(
        `UPDATE public.distribution_recipient_lists
         SET name = COALESCE($2, name),
             description = COALESCE($3, description),
             user_ids = COALESCE($4, user_ids),
             external_emails = COALESCE($5, external_emails),
             role_filter = COALESCE($6, role_filter),
             is_dynamic = COALESCE($7, is_dynamic),
             auto_invite = COALESCE($8, auto_invite),
             auto_invite_group_id = COALESCE($9, auto_invite_group_id),
             updated_at = NOW()
         WHERE id = $1
         RETURNING id, name, description, created_by, user_ids, external_emails, role_filter, is_dynamic, auto_invite, auto_invite_group_id, created_at, updated_at`,
        [
          id,
          name !== undefined ? (typeof name === 'string' ? name.trim() : null) : null,
          description !== undefined ? (typeof description === 'string' ? description.trim() : null) : null,
          user_ids !== undefined && Array.isArray(user_ids) ? user_ids : undefined,
          external_emails !== undefined && Array.isArray(external_emails) ? external_emails : undefined,
          role_filter !== undefined && Array.isArray(role_filter) ? role_filter : undefined,
          is_dynamic !== undefined ? Boolean(is_dynamic) : undefined,
          auto_invite !== undefined ? Boolean(auto_invite) : undefined,
          auto_invite_group_id !== undefined ? (auto_invite_group_id ?? null) : undefined,
        ]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Recipient list not found' });
      }
      res.json(result.rows[0]);
    } catch (error: any) {
      console.error('[Distributions] Error updating recipient list:', error.message);
      res.status(500).json({
        error: 'Failed to update recipient list',
        message: error.message,
      });
    }
  }
);

/** DELETE /recipient-lists/:id — Delete recipient list */
router.delete(
  '/recipient-lists/:id',
  authenticateToken,
  attachTenantContext,
  requireDistributionsAdmin,
  async (req: AuthRequest, res) => {
    try {
      const { tenantPool } = getTenantContext(req);
      const { id } = req.params;
      const result = await tenantPool.query(
        `DELETE FROM public.distribution_recipient_lists WHERE id = $1 RETURNING id`,
        [id]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Recipient list not found' });
      }
      res.status(204).send();
    } catch (error: any) {
      console.error('[Distributions] Error deleting recipient list:', error.message);
      res.status(500).json({
        error: 'Failed to delete recipient list',
        message: error.message,
      });
    }
  }
);

// ---------------------------------------------------------------------------
// Schedules — list and create
// ---------------------------------------------------------------------------

/** GET / — List distribution schedules (paginated) */
router.get(
  '/',
  authenticateToken,
  attachTenantContext,
  requireDistributionsAdmin,
  async (req: AuthRequest, res) => {
    try {
      const { tenantPool } = getTenantContext(req);
      const limit = Math.min(parseInt(req.query.limit as string, 10) || 50, 100);
      const offset = Math.max(0, parseInt(req.query.offset as string, 10) || 0);
      const isActive = req.query.is_active;
      let listWhere = '';
      let countWhere = '';
      const listParams: any[] = [limit, offset];
      const countParams: any[] = [];
      if (isActive === 'true' || isActive === 'false') {
        listWhere = ' WHERE d.is_active = $3';
        countWhere = ' WHERE d.is_active = $1';
        listParams.push(isActive === 'true');
        countParams.push(isActive === 'true');
      }
      const result = await tenantPool.query(
        `SELECT d.id, d.name, d.description, d.created_by, d.content_type, d.content_id, d.content_config,
                d.frequency, d.schedule_time, d.schedule_day, d.schedule_days, d.schedule_weekdays,
                d.recurrence_rule, d.recurrence_dtstart, d.recurrence_exdates, d.timezone,
                d.recipient_list_id, d.recipient_emails,
                d.is_active, d.last_sent_at, d.next_run_at, d.failure_count, d.created_at, d.updated_at,
                r.name AS recipient_list_name
         FROM public.distribution_schedules d
         LEFT JOIN public.distribution_recipient_lists r ON r.id = d.recipient_list_id
         ${listWhere}
         ORDER BY d.created_at DESC
         LIMIT $1 OFFSET $2`,
        listParams
      );
      const countResult = await tenantPool.query(
        `SELECT COUNT(*)::int AS total FROM public.distribution_schedules d ${countWhere}`,
        countParams
      );
      const total = countResult.rows[0]?.total ?? 0;
      res.json({ schedules: result.rows, total, limit, offset });
    } catch (error: any) {
      console.error('[Distributions] Error listing schedules:', error.message);
      res.status(500).json({
        error: 'Failed to list distribution schedules',
        message: error.message,
      });
    }
  }
);

/** POST / — Create distribution schedule */
router.post(
  '/',
  authenticateToken,
  attachTenantContext,
  requireDistributionsAdmin,
  async (req: AuthRequest, res) => {
    try {
      const { tenantPool } = getTenantContext(req);
      const {
        name,
        description,
        content_type,
        content_id,
        content_config = {},
        frequency,
        schedule_time = '08:00',
        schedule_day,
        schedule_days,
        schedule_weekdays,
        recurrence_rule,
        recurrence_dtstart,
        recurrence_exdates,
        timezone = 'America/New_York',
        recipient_list_id,
        recipient_emails = [],
      } = req.body ?? {};
      const sanitizedContentConfig =
        typeof content_config === 'object' && content_config != null ? { ...content_config } : {};
      if ('exportFormat' in sanitizedContentConfig) {
        delete (sanitizedContentConfig as Record<string, unknown>).exportFormat;
      }
      if (!name || typeof name !== 'string') {
        return res.status(400).json({ error: 'name is required' });
      }
      if (!content_type || !['report', 'dashboard', 'canvas', 'insight_digest'].includes(content_type)) {
        return res.status(400).json({ error: 'content_type must be report, dashboard, canvas, or insight_digest' });
      }
      if (!frequency || !['daily', 'weekly', 'biweekly', 'monthly', 'one_time', 'custom'].includes(frequency)) {
        return res.status(400).json({
          error: 'frequency must be daily, weekly, biweekly, monthly, one_time, or custom',
        });
      }
      const scheduleTime = typeof schedule_time === 'string' ? schedule_time : '08:00';
      const tz = typeof timezone === 'string' ? timezone : 'America/New_York';
      const parsedDays = parseScheduleDaysInput(schedule_days);
      const parsedWeekdays = parseScheduleWeekdaysInput(schedule_weekdays);
      let scheduleDayOut =
        schedule_day != null && schedule_day !== '' ? Number(schedule_day) : null;
      let scheduleDaysOut: number[] | null = parsedDays;
      let scheduleWeekdaysOut: number[] | null = parsedWeekdays;

      if (frequency === 'monthly') {
        const normalized = normalizeMonthlyDays(scheduleDaysOut, scheduleDayOut);
        if (!normalized || normalized.length === 0) {
          return res.status(400).json({
            error: 'Monthly schedules require at least one day (schedule_days 1–31 or legacy schedule_day)',
          });
        }
        scheduleDaysOut = normalized;
        scheduleDayOut = normalized[0];
      } else {
        scheduleDaysOut = null;
        if (frequency === 'weekly' || frequency === 'biweekly') {
          if (scheduleWeekdaysOut?.length) {
            scheduleDayOut = scheduleWeekdaysOut[0]!;
          } else {
            const dow =
              scheduleDayOut != null && !Number.isNaN(Number(scheduleDayOut))
                ? Number(scheduleDayOut)
                : NaN;
            if (Number.isNaN(dow) || dow < 0 || dow > 6) {
              return res.status(400).json({
                error:
                  'Weekly and biweekly schedules require schedule_day (0–6) or schedule_weekdays (array of 0–6).',
              });
            }
          }
        }
      }

      const anchor = new Date();
      const rec = buildRecurrenceFieldsForApi(
        frequency,
        scheduleTime,
        tz,
        scheduleDayOut,
        scheduleDaysOut,
        scheduleWeekdaysOut,
        req.body ?? {},
        anchor
      );

      const syntheticRow = {
        frequency,
        schedule_time: scheduleTime,
        schedule_day: scheduleDayOut,
        schedule_days: scheduleDaysOut,
        schedule_weekdays: rec.schedule_weekdays,
        timezone: tz,
        recurrence_rule: rec.recurrence_rule,
        recurrence_dtstart: rec.recurrence_dtstart,
        recurrence_exdates: rec.recurrence_exdates,
      };

      const nextRunAt =
        frequency !== 'one_time' ? computeNextRunAtFromRow(syntheticRow, new Date()) : null;
      const result = await tenantPool.query(
        `INSERT INTO public.distribution_schedules
         (name, description, created_by, content_type, content_id, content_config,
          frequency, schedule_time, schedule_day, schedule_days, schedule_weekdays,
          recurrence_rule, recurrence_dtstart, recurrence_exdates,
          timezone, recipient_list_id, recipient_emails, next_run_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, NOW())
         RETURNING id, name, description, created_by, content_type, content_id, content_config,
                   frequency, schedule_time, schedule_day, schedule_days, schedule_weekdays,
                   recurrence_rule, recurrence_dtstart, recurrence_exdates,
                   timezone, recipient_list_id, recipient_emails,
                   is_active, last_sent_at, next_run_at, failure_count, created_at, updated_at`,
        [
          name.trim(),
          description?.trim() ?? null,
          req.userId,
          content_type,
          content_id ?? null,
          sanitizedContentConfig,
          frequency,
          scheduleTime,
          scheduleDayOut,
          scheduleDaysOut,
          scheduleWeekdaysOut,
          rec.recurrence_rule,
          rec.recurrence_dtstart,
          rec.recurrence_exdates,
          tz,
          recipient_list_id ?? null,
          Array.isArray(recipient_emails) ? recipient_emails : [],
          nextRunAt,
        ]
      );
      res.status(201).json(result.rows[0]);
    } catch (error: any) {
      console.error('[Distributions] Error creating schedule:', error.message);
      res.status(500).json({
        error: 'Failed to create distribution schedule',
        message: error.message,
      });
    }
  }
);

// ---------------------------------------------------------------------------
// Schedule by id — get, update, delete, send-now, history, preview
// ---------------------------------------------------------------------------

/** POST /preview-schedule — Next N run instants (same logic as scheduler; no persistence) */
router.post(
  '/preview-schedule',
  authenticateToken,
  attachTenantContext,
  requireDistributionsAdmin,
  async (req: AuthRequest, res) => {
    try {
      const {
        frequency,
        schedule_time = '08:00',
        schedule_day,
        schedule_days,
        schedule_weekdays,
        recurrence_rule,
        recurrence_dtstart,
        recurrence_exdates,
        timezone = 'America/New_York',
        count = 3,
      } = req.body ?? {};
      if (
        !frequency ||
        !['daily', 'weekly', 'biweekly', 'monthly', 'one_time', 'custom'].includes(frequency)
      ) {
        return res.status(400).json({
          error:
            'frequency must be daily, weekly, biweekly, monthly, one_time, or custom',
        });
      }
      if (frequency === 'one_time') {
        return res.json({ runs: [] });
      }
      const scheduleTime = typeof schedule_time === 'string' ? schedule_time : '08:00';
      const tz = typeof timezone === 'string' ? timezone : 'America/New_York';
      const c = Math.min(10, Math.max(1, parseInt(String(count), 10) || 3));
      const parsedDays = parseScheduleDaysInput(schedule_days);
      const parsedWk = parseScheduleWeekdaysInput(schedule_weekdays);
      const dayNum =
        schedule_day != null && schedule_day !== '' ? Number(schedule_day) : null;

      if (frequency === 'custom') {
        const rule = typeof recurrence_rule === 'string' ? recurrence_rule : '';
        validateRecurrenceRuleBody(rule);
        const dt =
          recurrence_dtstart != null && recurrence_dtstart !== ''
            ? new Date(String(recurrence_dtstart))
            : buildRecurrenceDtstart(tz, scheduleTime, new Date());
        const runs = computeNextNFromRecurrence({
          recurrenceRule: rule.trim(),
          recurrenceDtstart: dt,
          recurrenceExdates: recurrence_exdates,
          count: c,
          afterExclusive: new Date(),
        });
        return res.json({ runs: runs.map((d) => d.toISOString()) });
      }

      if (frequency === 'monthly') {
        const normalized = normalizeMonthlyDays(parsedDays, dayNum);
        if (!normalized?.length) {
          return res.status(400).json({
            error:
              'Monthly schedules require at least one day (schedule_days 1–31 or legacy schedule_day)',
          });
        }
      } else if (frequency === 'weekly' || frequency === 'biweekly') {
        if (!parsedWk?.length) {
          const dow = dayNum != null && !Number.isNaN(dayNum) ? dayNum : NaN;
          if (Number.isNaN(dow) || dow < 0 || dow > 6) {
            return res.status(400).json({
              error:
                'Weekly and biweekly schedules require schedule_day (0–6) or schedule_weekdays (array of 0–6).',
            });
          }
        }
      }

      const runs = computeNextScheduleRuns(
        frequency,
        scheduleTime,
        dayNum != null && !Number.isNaN(dayNum) ? dayNum : null,
        tz,
        parsedDays,
        c,
        parsedWk
      );
      res.json({ runs: runs.map((d) => d.toISOString()) });
    } catch (error: any) {
      console.error('[Distributions] Error preview-schedule:', error.message);
      res.status(500).json({
        error: 'Failed to preview schedule',
        message: error.message,
      });
    }
  }
);

/** GET /:id — Get a single schedule */
router.get(
  '/:id',
  authenticateToken,
  attachTenantContext,
  requireDistributionsAdmin,
  async (req: AuthRequest, res) => {
    try {
      const { tenantPool } = getTenantContext(req);
      const result = await tenantPool.query(
        `SELECT d.*, r.name AS recipient_list_name
         FROM public.distribution_schedules d
         LEFT JOIN public.distribution_recipient_lists r ON r.id = d.recipient_list_id
         WHERE d.id = $1`,
        [req.params.id]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Distribution schedule not found' });
      }
      res.json(result.rows[0]);
    } catch (error: any) {
      console.error('[Distributions] Error getting schedule:', error.message);
      res.status(500).json({
        error: 'Failed to get distribution schedule',
        message: error.message,
      });
    }
  }
);

/** PUT /:id — Update schedule */
router.put(
  '/:id',
  authenticateToken,
  attachTenantContext,
  requireDistributionsAdmin,
  async (req: AuthRequest, res) => {
    try {
      const { tenantPool } = getTenantContext(req);
      const { id } = req.params;
      const body = req.body ?? {};
      const existing = await tenantPool.query(
        'SELECT * FROM public.distribution_schedules WHERE id = $1',
        [id]
      );
      if (existing.rows.length === 0) {
        return res.status(404).json({ error: 'Distribution schedule not found' });
      }
      const baseline = existing.rows[0];
      const currentFrequency = baseline.frequency as string;

      if (body.frequency !== undefined) {
        const ff = String(body.frequency);
        if (!['daily', 'weekly', 'biweekly', 'monthly', 'one_time', 'custom'].includes(ff)) {
          return res.status(400).json({
            error: 'frequency must be daily, weekly, biweekly, monthly, one_time, or custom',
          });
        }
      }

      const fields = [
        'name', 'description', 'content_type', 'content_id', 'content_config',
        'frequency', 'schedule_time', 'schedule_day', 'schedule_days', 'timezone',
        'recipient_list_id', 'recipient_emails', 'is_active',
      ];
      const setClause: string[] = [];
      const values: any[] = [id];
      let idx = 2;
      for (const f of fields) {
        if (body[f] !== undefined) {
          if (f === 'recipient_emails' && Array.isArray(body[f])) {
            setClause.push(`recipient_emails = $${idx}`);
            values.push(body[f]);
            idx++;
          } else if (f === 'content_config' && typeof body[f] === 'object') {
            const sanitizedContentConfig = body[f] && typeof body[f] === 'object' ? { ...body[f] } : {};
            if ('exportFormat' in sanitizedContentConfig) {
              delete (sanitizedContentConfig as Record<string, unknown>).exportFormat;
            }
            setClause.push(`content_config = $${idx}`);
            values.push(sanitizedContentConfig);
            idx++;
          } else if (f === 'schedule_days') {
            const effectiveFreq = (body.frequency as string | undefined) ?? currentFrequency;
            if (effectiveFreq !== 'monthly') {
              continue;
            }
            if (body[f] === null) {
              setClause.push(`schedule_days = $${idx}`);
              values.push(null);
              idx++;
            } else if (Array.isArray(body[f])) {
              setClause.push(`schedule_days = $${idx}`);
              values.push(parseScheduleDaysInput(body[f]));
              idx++;
            }
          } else if (['content_id', 'recipient_list_id', 'schedule_day'].includes(f)) {
            setClause.push(`${f} = $${idx}`);
            values.push(body[f] == null ? null : body[f]);
            idx++;
          } else if (typeof body[f] === 'string' || typeof body[f] === 'boolean') {
            setClause.push(`${f} = $${idx}`);
            values.push(body[f]);
            idx++;
          }
        }
      }
      const scheduleFieldsChanged = [
        'frequency',
        'schedule_time',
        'schedule_day',
        'schedule_days',
        'timezone',
        'schedule_weekdays',
        'recurrence_rule',
        'recurrence_dtstart',
        'recurrence_exdates',
      ].some((f) => body[f] !== undefined);

      if (setClause.length === 0 && !scheduleFieldsChanged) {
        return res.json(baseline);
      }

      if (scheduleFieldsChanged) {
        const row = baseline;
        const freq = (body.frequency as string | undefined) ?? row.frequency;
        const time = body.schedule_time ?? row.schedule_time ?? '08:00';
        const day = body.schedule_day !== undefined ? body.schedule_day : row.schedule_day;
        const tz = body.timezone ?? row.timezone ?? 'America/New_York';
        let daysMerged: number[] | null =
          body.schedule_days !== undefined
            ? parseScheduleDaysInput(body.schedule_days)
            : row.schedule_days != null && Array.isArray(row.schedule_days)
              ? [...row.schedule_days.map((n: unknown) => Number(n))]
              : null;
        let wkMerged: number[] | null =
          body.schedule_weekdays !== undefined
            ? parseScheduleWeekdaysInput(body.schedule_weekdays)
            : row.schedule_weekdays != null && Array.isArray(row.schedule_weekdays)
              ? [...row.schedule_weekdays.map((n: unknown) => Number(n))]
              : null;

        if (freq === 'monthly') {
          const normalized = normalizeMonthlyDays(
            daysMerged,
            day != null ? Number(day) : null
          );
          if (!normalized?.length) {
            return res.status(400).json({
              error:
                'Monthly schedules require at least one day (schedule_days 1–31 or legacy schedule_day)',
            });
          }
          daysMerged = normalized;
          wkMerged = null;
          if (body.schedule_days === undefined) {
            setClause.push(`schedule_days = $${idx}`);
            values.push(normalized);
            idx++;
          }
          if (body.schedule_day === undefined) {
            setClause.push(`schedule_day = $${idx}`);
            values.push(normalized[0]);
            idx++;
          }
        } else if (freq === 'custom') {
          daysMerged = null;
          wkMerged = null;
          if (!setClause.some((c) => c.startsWith('schedule_days'))) {
            setClause.push(`schedule_days = $${idx}`);
            values.push(null);
            idx++;
          }
        } else {
          daysMerged = null;
          if (freq === 'daily' || freq === 'one_time') {
            wkMerged = null;
          }
          if (freq === 'weekly' || freq === 'biweekly') {
            if (wkMerged?.length) {
              if (body.schedule_day === undefined) {
                setClause.push(`schedule_day = $${idx}`);
                values.push(wkMerged[0]);
                idx++;
              }
            } else {
              const dow = day != null ? Number(day) : NaN;
              if (Number.isNaN(dow) || dow < 0 || dow > 6) {
                return res.status(400).json({
                  error:
                    'Weekly and biweekly schedules require schedule_day (0–6) or schedule_weekdays (array of 0–6).',
                });
              }
            }
          }
          if (!setClause.some((c) => c.startsWith('schedule_days'))) {
            setClause.push(`schedule_days = $${idx}`);
            values.push(null);
            idx++;
          }
        }

        const scheduleDayOut =
          freq === 'weekly' || freq === 'biweekly'
            ? wkMerged?.length
              ? wkMerged[0]!
              : day != null && !Number.isNaN(Number(day))
                ? Number(day)
                : null
            : freq === 'monthly'
              ? daysMerged?.[0] ?? null
              : day != null && !Number.isNaN(Number(day))
                ? Number(day)
                : null;

        const bodyForRec: Record<string, unknown> = { ...body };
        if (freq === 'custom') {
          if (bodyForRec.recurrence_rule === undefined && row.recurrence_rule) {
            bodyForRec.recurrence_rule = row.recurrence_rule;
          }
          if (bodyForRec.recurrence_dtstart === undefined && row.recurrence_dtstart) {
            bodyForRec.recurrence_dtstart = row.recurrence_dtstart;
          }
        }

        let rec = buildRecurrenceFieldsForApi(
          freq,
          typeof time === 'string' ? time : '08:00',
          tz,
          scheduleDayOut,
          freq === 'monthly' ? daysMerged : null,
          freq === 'weekly' || freq === 'biweekly' ? wkMerged : null,
          bodyForRec,
          new Date(row.created_at as string | Date)
        );
        if (body.recurrence_exdates !== undefined) {
          rec = {
            ...rec,
            recurrence_exdates: parseRecurrenceExdatesInput(body.recurrence_exdates),
          };
        } else if (row.recurrence_exdates != null) {
          rec = {
            ...rec,
            recurrence_exdates: parseRecurrenceExdatesInput(row.recurrence_exdates),
          };
        }

        setClause.push(`recurrence_rule = $${idx}`);
        values.push(rec.recurrence_rule);
        idx++;
        setClause.push(`recurrence_dtstart = $${idx}`);
        values.push(rec.recurrence_dtstart);
        idx++;
        setClause.push(`recurrence_exdates = $${idx}`);
        values.push(rec.recurrence_exdates);
        idx++;
        setClause.push(`schedule_weekdays = $${idx}`);
        values.push(rec.schedule_weekdays);
        idx++;

        const nextRow = {
          frequency: freq,
          schedule_time: typeof time === 'string' ? time : '08:00',
          schedule_day: scheduleDayOut,
          schedule_days: freq === 'monthly' ? daysMerged : null,
          schedule_weekdays: rec.schedule_weekdays,
          timezone: tz,
          recurrence_rule: rec.recurrence_rule,
          recurrence_dtstart: rec.recurrence_dtstart,
          recurrence_exdates: rec.recurrence_exdates,
        };
        const nextRunAt =
          freq !== 'one_time' ? computeNextRunAtFromRow(nextRow, new Date()) : null;
        setClause.push(`next_run_at = $${idx}`);
        values.push(nextRunAt);
        idx++;
      }

      setClause.push('updated_at = NOW()');
      const result = await tenantPool.query(
        `UPDATE public.distribution_schedules SET ${setClause.join(', ')}
         WHERE id = $1
         RETURNING *`,
        values
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Distribution schedule not found' });
      }
      res.json(result.rows[0]);
    } catch (error: any) {
      console.error('[Distributions] Error updating schedule:', error.message);
      res.status(500).json({
        error: 'Failed to update distribution schedule',
        message: error.message,
      });
    }
  }
);

/** DELETE /:id — Permanently delete schedule and its send history */
router.delete(
  '/:id',
  authenticateToken,
  attachTenantContext,
  requireDistributionsAdmin,
  async (req: AuthRequest, res) => {
    try {
      const { tenantPool } = getTenantContext(req);
      const { id } = req.params;
      await tenantPool.query(
        `DELETE FROM public.distribution_send_log WHERE schedule_id = $1`,
        [id]
      );
      const result = await tenantPool.query(
        `DELETE FROM public.distribution_schedules WHERE id = $1 RETURNING id`,
        [id]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Distribution schedule not found' });
      }
      res.status(204).send();
    } catch (error: any) {
      console.error('[Distributions] Error deleting schedule:', error.message);
      res.status(500).json({
        error: 'Failed to delete distribution schedule',
        message: error.message,
      });
    }
  }
);

/** GET /:id/history — Get send history for a schedule */
router.get(
  '/:id/history',
  authenticateToken,
  attachTenantContext,
  requireDistributionsAdmin,
  async (req: AuthRequest, res) => {
    try {
      const { tenantPool } = getTenantContext(req);
      const { id } = req.params;
      const limit = Math.min(parseInt(req.query.limit as string, 10) || 20, 100);
      const result = await tenantPool.query(
        `SELECT id, schedule_id, sent_at, status, recipients_count, successful_count,
                failed_recipients, content_snapshot, export_format, error_message, duration_ms
         FROM public.distribution_send_log
         WHERE schedule_id = $1
         ORDER BY sent_at DESC
         LIMIT $2`,
        [id, limit]
      );
      const schedule = await tenantPool.query(
        'SELECT id FROM public.distribution_schedules WHERE id = $1',
        [id]
      );
      if (schedule.rows.length === 0) {
        return res.status(404).json({ error: 'Distribution schedule not found' });
      }
      res.json({ history: result.rows });
    } catch (error: any) {
      console.error('[Distributions] Error getting history:', error.message);
      res.status(500).json({
        error: 'Failed to get send history',
        message: error.message,
      });
    }
  }
);

/** POST /:id/send-now — Trigger immediate send */
router.post(
  '/:id/send-now',
  authenticateToken,
  attachTenantContext,
  requireDistributionsAdmin,
  async (req: AuthRequest, res) => {
    try {
      const ctx = getTenantContext(req);
      const { tenantPool } = ctx;
      const tenantId = ctx.tenantId ?? '';
      const rawId = req.params.id;
      const id = typeof rawId === 'string' ? rawId : Array.isArray(rawId) ? rawId[0] ?? '' : '';
      const scheduleResult = await tenantPool.query(
        'SELECT id, name, description, content_type, content_id, content_config, recipient_list_id, recipient_emails FROM public.distribution_schedules WHERE id = $1 AND is_active = true',
        [id]
      );
      if (scheduleResult.rows.length === 0) {
        return res.status(404).json({
          error: 'Distribution schedule not found or inactive',
        });
      }
      const schedule = scheduleResult.rows[0];
      const { sendDistribution, logDistributionSend } = await import(
        '../services/distributionEmailSender.js'
      );
      const result = await sendDistribution({
        tenantId,
        tenantPool,
        schedule,
        userFilter: null,
      });
      await logDistributionSend(
        tenantPool,
        id,
        result,
        { content_type: schedule.content_type, content_id: schedule.content_id, name: schedule.name, link: result.link ?? null },
        'link'
      );

      // After a manual send, recalculate next_run_at so the scheduler
      // doesn't double-fire for the same period.
      const fullSchedule = await tenantPool.query(
        `SELECT frequency, schedule_time, schedule_day, schedule_days, schedule_weekdays,
                timezone, recurrence_rule, recurrence_dtstart, recurrence_exdates
         FROM public.distribution_schedules WHERE id = $1`,
        [id]
      );
      if (fullSchedule.rows.length > 0) {
        const s = fullSchedule.rows[0];
        const nextRunAt =
          s.frequency !== 'one_time' ? computeNextRunAtFromRow(s, new Date()) : null;
        await tenantPool.query(
          `UPDATE public.distribution_schedules
           SET last_sent_at = NOW(), next_run_at = $2, updated_at = NOW()
           WHERE id = $1`,
          [id, nextRunAt]
        );
      }

      res.json({
        message: 'Send completed',
        schedule_id: id,
        status: result.status,
        recipients_count: result.recipientsCount,
        successful_count: result.successfulCount,
        failed_recipients: result.failedRecipients,
        invite_status: result.inviteStatus ?? null,
        duration_ms: result.durationMs,
        link: result.link ?? null,
      });
    } catch (error: any) {
      console.error('[Distributions] Error triggering send:', error.message);
      res.status(500).json({
        error: 'Failed to trigger send',
        message: error.message,
      });
    }
  }
);

/** POST /:id/preview — Generate preview (no send); implementation in Phase 2 */
router.post(
  '/:id/preview',
  authenticateToken,
  attachTenantContext,
  requireDistributionsAdmin,
  async (req: AuthRequest, res) => {
    try {
      const { tenantPool } = getTenantContext(req);
      const { id } = req.params;
      const scheduleResult = await tenantPool.query(
        'SELECT * FROM public.distribution_schedules WHERE id = $1',
        [id]
      );
      if (scheduleResult.rows.length === 0) {
        return res.status(404).json({ error: 'Distribution schedule not found' });
      }
      // Phase 2 will generate content and return it; for now return placeholder
      res.json({
        message: 'Preview not yet implemented',
        schedule_id: id,
        content_type: scheduleResult.rows[0].content_type,
      });
    } catch (error: any) {
      console.error('[Distributions] Error generating preview:', error.message);
      res.status(500).json({
        error: 'Failed to generate preview',
        message: error.message,
      });
    }
  }
);

export default router;
