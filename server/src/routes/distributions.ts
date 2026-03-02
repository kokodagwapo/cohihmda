/**
 * Report Distribution API Routes
 * CRUD for distribution_schedules and distribution_recipient_lists (tenant DB).
 * Authorization: tenant_admin, super_admin, platform_admin, admin.
 */
import { Router } from 'express';
import { authenticateToken, AuthRequest } from '../middleware/auth.js';
import {
  attachTenantContext,
  getTenantContext,
} from '../middleware/tenantContext.js';
import { requireRole } from '../middleware/rbac.js';
import { computeNextRunAt } from '../services/distributionScheduler.js';

const router = Router();
const requireDistributionsAdmin = requireRole(
  'tenant_admin',
  'super_admin',
  'platform_admin',
  'admin'
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
                role_filter, is_dynamic, created_at, updated_at
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
      } = req.body ?? {};
      if (!name || typeof name !== 'string') {
        return res.status(400).json({ error: 'name is required' });
      }
      const result = await tenantPool.query(
        `INSERT INTO public.distribution_recipient_lists
         (name, description, created_by, user_ids, external_emails, role_filter, is_dynamic, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
         RETURNING id, name, description, created_by, user_ids, external_emails, role_filter, is_dynamic, created_at, updated_at`,
        [
          name.trim(),
          description?.trim() ?? null,
          req.userId,
          Array.isArray(user_ids) ? user_ids : [],
          Array.isArray(external_emails) ? external_emails : [],
          Array.isArray(role_filter) ? role_filter : [],
          Boolean(is_dynamic),
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
      } = req.body ?? {};
      const result = await tenantPool.query(
        `UPDATE public.distribution_recipient_lists
         SET name = COALESCE($2, name),
             description = COALESCE($3, description),
             user_ids = COALESCE($4, user_ids),
             external_emails = COALESCE($5, external_emails),
             role_filter = COALESCE($6, role_filter),
             is_dynamic = COALESCE($7, is_dynamic),
             updated_at = NOW()
         WHERE id = $1
         RETURNING id, name, description, created_by, user_ids, external_emails, role_filter, is_dynamic, created_at, updated_at`,
        [
          id,
          name !== undefined ? (typeof name === 'string' ? name.trim() : null) : null,
          description !== undefined ? (typeof description === 'string' ? description.trim() : null) : null,
          user_ids !== undefined && Array.isArray(user_ids) ? user_ids : undefined,
          external_emails !== undefined && Array.isArray(external_emails) ? external_emails : undefined,
          role_filter !== undefined && Array.isArray(role_filter) ? role_filter : undefined,
          is_dynamic !== undefined ? Boolean(is_dynamic) : undefined,
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
                d.frequency, d.schedule_time, d.schedule_day, d.timezone,
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
        timezone = 'America/New_York',
        recipient_list_id,
        recipient_emails = [],
      } = req.body ?? {};
      if (!name || typeof name !== 'string') {
        return res.status(400).json({ error: 'name is required' });
      }
      if (!content_type || !['report', 'dashboard', 'canvas', 'insight_digest'].includes(content_type)) {
        return res.status(400).json({ error: 'content_type must be report, dashboard, canvas, or insight_digest' });
      }
      if (!frequency || !['daily', 'weekly', 'biweekly', 'monthly', 'one_time'].includes(frequency)) {
        return res.status(400).json({ error: 'frequency must be daily, weekly, biweekly, monthly, or one_time' });
      }
      const scheduleTime = typeof schedule_time === 'string' ? schedule_time : '08:00';
      const tz = typeof timezone === 'string' ? timezone : 'America/New_York';
      const nextRunAt =
        frequency !== 'one_time'
          ? computeNextRunAt(frequency, scheduleTime, schedule_day != null ? schedule_day : null, tz)
          : null;
      const result = await tenantPool.query(
        `INSERT INTO public.distribution_schedules
         (name, description, created_by, content_type, content_id, content_config,
          frequency, schedule_time, schedule_day, timezone, recipient_list_id, recipient_emails, next_run_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW())
         RETURNING id, name, description, created_by, content_type, content_id, content_config,
                   frequency, schedule_time, schedule_day, timezone, recipient_list_id, recipient_emails,
                   is_active, last_sent_at, next_run_at, failure_count, created_at, updated_at`,
        [
          name.trim(),
          description?.trim() ?? null,
          req.userId,
          content_type,
          content_id ?? null,
          typeof content_config === 'object' ? content_config : {},
          frequency,
          scheduleTime,
          schedule_day != null ? schedule_day : null,
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
      const fields = [
        'name', 'description', 'content_type', 'content_id', 'content_config',
        'frequency', 'schedule_time', 'schedule_day', 'timezone',
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
            setClause.push(`content_config = $${idx}`);
            values.push(body[f]);
            idx++;
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
      if (setClause.length === 0) {
        const existing = await tenantPool.query(
          'SELECT * FROM public.distribution_schedules WHERE id = $1',
          [id]
        );
        if (existing.rows.length === 0) {
          return res.status(404).json({ error: 'Distribution schedule not found' });
        }
        return res.json(existing.rows[0]);
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

/** DELETE /:id — Deactivate schedule (soft delete: set is_active = false) */
router.delete(
  '/:id',
  authenticateToken,
  attachTenantContext,
  requireDistributionsAdmin,
  async (req: AuthRequest, res) => {
    try {
      const { tenantPool } = getTenantContext(req);
      const { id } = req.params;
      const result = await tenantPool.query(
        `UPDATE public.distribution_schedules SET is_active = false, updated_at = NOW()
         WHERE id = $1 RETURNING id`,
        [id]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Distribution schedule not found' });
      }
      res.status(204).send();
    } catch (error: any) {
      console.error('[Distributions] Error deactivating schedule:', error.message);
      res.status(500).json({
        error: 'Failed to deactivate distribution schedule',
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
        { content_type: schedule.content_type, content_id: schedule.content_id, name: schedule.name },
        result.exportFormat ?? 'unknown'
      );
      res.json({
        message: 'Send completed',
        schedule_id: id,
        status: result.status,
        recipients_count: result.recipientsCount,
        successful_count: result.successfulCount,
        failed_recipients: result.failedRecipients,
        duration_ms: result.durationMs,
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
