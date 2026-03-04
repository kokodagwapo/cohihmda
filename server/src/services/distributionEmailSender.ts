/**
 * Distribution Email Sender
 * Resolves recipients, provisions optional canvas-only users, auto-shares canvas links,
 * and sends link-based distribution emails.
 */

import type { Pool } from 'pg';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { pool as managementPool } from '../config/managementDatabase.js';
import { loadEmailTemplate, replacePlaceholders } from './emailTemplateLoader.js';
import {
  sendEmail,
  sendPasswordResetEmail,
} from './emailService.js';
import { logEmailSend } from './emailAuditLogger.js';
import { resolveContent, type ScheduleRow } from './distributionContentResolver.js';

export interface SendDistributionOptions {
  tenantId: string;
  tenantPool: Pool;
  schedule: ScheduleRow;
  userFilter?: string | null;
}

export interface SendDistributionResult {
  status: 'success' | 'partial_failure' | 'failed';
  recipientsCount: number;
  successfulCount: number;
  failedRecipients: Array<{ email: string; error: string }>;
  inviteStatus?: {
    autoInviteEnabled: boolean;
    invitedCount: number;
    inviteFailedCount: number;
    invitedRecipients: string[];
    inviteFailedRecipients: Array<{ email: string; error: string }>;
  };
  durationMs: number;
  errorMessage?: string;
  link?: string;
}

interface ResolvedRecipients {
  emails: string[];
  autoInvite: boolean;
  autoInviteGroupId: string | null;
}

/**
 * Resolve recipient emails for a schedule (from list or inline)
 */
export async function resolveRecipientEmails(
  tenantPool: Pool,
  schedule: ScheduleRow
): Promise<ResolvedRecipients> {
  const emails: string[] = [];
  const inlineEmails = Array.isArray(schedule.recipient_emails)
    ? schedule.recipient_emails.filter((e: string) => e && e.includes('@'))
    : [];
  let autoInvite = inlineEmails.length > 0
    ? (schedule.content_config?.auto_invite_external !== false)
    : false;
  let autoInviteGroupId: string | null = null;

  if (inlineEmails.length > 0) {
    emails.push(...inlineEmails);
  }

  if (schedule.recipient_list_id) {
    const list = await tenantPool.query(
      `SELECT user_ids, external_emails, role_filter, is_dynamic, auto_invite, auto_invite_group_id
       FROM public.distribution_recipient_lists WHERE id = $1`,
      [schedule.recipient_list_id]
    );
    if (list.rows[0]) {
      const row = list.rows[0];
      if (Array.isArray(row.external_emails)) {
        emails.push(...row.external_emails.filter((e: string) => e && e.includes('@')));
      }
      if (Array.isArray(row.user_ids) && row.user_ids.length > 0) {
        const users = await tenantPool.query(
          `SELECT email FROM public.users WHERE id = ANY($1) AND COALESCE(is_active, true) = true`,
          [row.user_ids]
        );
        for (const u of users.rows) {
          if (u.email) emails.push(u.email);
        }
      }
      if (row.is_dynamic && Array.isArray(row.role_filter) && row.role_filter.length > 0) {
        const byRole = await tenantPool.query(
          `SELECT email FROM public.users WHERE role = ANY($1) AND COALESCE(is_active, true) = true`,
          [row.role_filter]
        );
        for (const u of byRole.rows) {
          if (u.email) emails.push(u.email);
        }
      }
      autoInvite = row.auto_invite === true || autoInvite;
      autoInviteGroupId = row.auto_invite_group_id || null;
    }
  }

  return {
    emails: [...new Set(emails)],
    autoInvite,
    autoInviteGroupId,
  };
}

async function ensureRecipientUsers(
  tenantPool: Pool,
  recipientEmails: string[],
  autoInvite: boolean,
  autoInviteGroupId: string | null,
  tenantId: string
): Promise<{
  userIdsByEmail: Map<string, string>;
  deliverableEmails: string[];
  failedRecipients: Array<{ email: string; error: string }>;
  invitedRecipients: string[];
  inviteFailedRecipients: Array<{ email: string; error: string }>;
}> {
  const userIdsByEmail = new Map<string, string>();
  const deliverableEmails: string[] = [];
  const failedRecipients: Array<{ email: string; error: string }> = [];
  const invitedRecipients: string[] = [];
  const inviteFailedRecipients: Array<{ email: string; error: string }> = [];
  if (recipientEmails.length === 0) {
    return { userIdsByEmail, deliverableEmails, failedRecipients, invitedRecipients, inviteFailedRecipients };
  }

  const existingUsers = await tenantPool.query(
    `SELECT id, LOWER(email) AS email FROM public.users WHERE LOWER(email) = ANY($1)`,
    [recipientEmails.map((email) => email.toLowerCase())]
  );
  for (const row of existingUsers.rows) {
    userIdsByEmail.set(row.email, row.id);
    deliverableEmails.push(row.email);
  }

  if (!autoInvite) {
    for (const email of recipientEmails) {
      const lowerEmail = email.toLowerCase();
      if (!userIdsByEmail.has(lowerEmail)) {
        failedRecipients.push({
          email,
          error: 'Recipient is not an existing user and auto-invite is disabled',
        });
      }
    }
    return {
      userIdsByEmail,
      deliverableEmails: [...new Set(deliverableEmails)],
      failedRecipients,
      invitedRecipients,
      inviteFailedRecipients,
    };
  }

  for (const email of recipientEmails) {
    const lowerEmail = email.toLowerCase();
    if (userIdsByEmail.has(lowerEmail)) {
      continue;
    }

    try {
      const rawPassword = crypto.randomBytes(24).toString('hex');
      const hashedPassword = await bcrypt.hash(rawPassword, 10);
      const insertResult = await tenantPool.query(
        `INSERT INTO public.users (email, encrypted_password, full_name, role, is_active, loan_access_mode, access_mode)
         VALUES ($1, $2, $3, $4, true, 'full_access', 'canvas_only')
         ON CONFLICT (email) DO UPDATE SET updated_at = NOW()
         RETURNING id, email`,
        [email, hashedPassword, null, 'viewer']
      );

      const userId = insertResult.rows[0]?.id;
      if (!userId) {
        failedRecipients.push({ email, error: 'User provisioning returned no user id' });
        continue;
      }
      userIdsByEmail.set(lowerEmail, userId);
      deliverableEmails.push(lowerEmail);

      if (autoInviteGroupId) {
        await tenantPool.query(
          `INSERT INTO public.user_group_memberships (group_id, user_id)
           VALUES ($1, $2)
           ON CONFLICT (group_id, user_id) DO NOTHING`,
          [autoInviteGroupId, userId]
        );
      }

      const resetUrl = await createPasswordResetUrlForInvite(email, tenantId);
      await sendPasswordResetEmail(email, resetUrl);
      invitedRecipients.push(email);
    } catch (err: any) {
      const failure = { email, error: err?.message || 'Failed to auto-invite recipient' };
      failedRecipients.push(failure);
      inviteFailedRecipients.push(failure);
    }
  }

  return {
    userIdsByEmail,
    deliverableEmails: [...new Set(deliverableEmails.map((e) => e.toLowerCase()))],
    failedRecipients,
    invitedRecipients: [...new Set(invitedRecipients.map((e) => e.toLowerCase()))],
    inviteFailedRecipients,
  };
}

async function shareCanvasWithRecipients(
  tenantPool: Pool,
  schedule: ScheduleRow,
  userIdsByEmail: Map<string, string>
): Promise<void> {
  if (schedule.content_type !== 'canvas' || !schedule.content_id || userIdsByEmail.size === 0) {
    return;
  }

  const uniqueUserIds = [...new Set(Array.from(userIdsByEmail.values()))];
  for (const userId of uniqueUserIds) {
    await tenantPool.query(
      `INSERT INTO public.canvas_share_entries (canvas_id, user_id, permission, shared_by)
       VALUES ($1, $2, 'viewer', NULL)
       ON CONFLICT (canvas_id, user_id) WHERE user_id IS NOT NULL
       DO UPDATE SET permission = EXCLUDED.permission`,
      [schedule.content_id, userId]
    );
  }

  await tenantPool.query(
    `UPDATE public.workbench_canvases
     SET visibility = CASE WHEN visibility = 'private' THEN 'shared' ELSE visibility END,
         updated_at = NOW()
     WHERE id = $1`,
    [schedule.content_id]
  );
}

/**
 * Send a distribution: resolve content, build email, send to each recipient, log result.
 */
export async function sendDistribution(
  options: SendDistributionOptions
): Promise<SendDistributionResult> {
  const { tenantId, tenantPool, schedule, userFilter } = options;
  const start = Date.now();
  const failedRecipients: Array<{ email: string; error: string }> = [];
  let successfulCount = 0;

  try {
    const resolvedRecipients = await resolveRecipientEmails(tenantPool, schedule);
    if (resolvedRecipients.emails.length === 0) {
      return {
        status: 'failed',
        recipientsCount: 0,
        successfulCount: 0,
        failedRecipients: [],
        durationMs: Date.now() - start,
        errorMessage: 'No recipients',
      };
    }

    const appContent = await resolveContent(tenantPool, schedule, { userFilter });
    const absoluteLink = buildAbsoluteLink(appContent.link);

    const {
      userIdsByEmail,
      deliverableEmails,
      failedRecipients: provisioningFailures,
      invitedRecipients,
      inviteFailedRecipients,
    } = await ensureRecipientUsers(
      tenantPool,
      resolvedRecipients.emails,
      resolvedRecipients.autoInvite,
      resolvedRecipients.autoInviteGroupId,
      tenantId
    );
    failedRecipients.push(...provisioningFailures);

    await shareCanvasWithRecipients(tenantPool, schedule, userIdsByEmail);

    const template = await loadEmailTemplate('distribution.html');
    const dateLabel = new Date().toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    const basePlaceholders: Record<string, string> = {
      DISTRIBUTION_NAME: schedule.name || 'Report',
      DATE_LABEL: dateLabel,
      DESCRIPTION: (schedule as any).description || '',
      BODY_TEXT: appContent.description || 'You have a new shared canvas in Coheus.',
      VIEW_IN_APP_HTML: `<a href="${escapeHtml(absoluteLink)}" class="cta">View in Coheus</a>`,
      CONTENT_HTML: appContent.html || '',
      ATTACHMENT_NOTE: '',
    };

    const subject = `${schedule.name} – Coheus`;

    for (const to of deliverableEmails) {
      try {
        const html = template
          ? replacePlaceholders(template, { ...basePlaceholders })
          : `<p>${basePlaceholders.BODY_TEXT}</p><p><a href="${escapeHtml(absoluteLink)}">View in Coheus</a></p>`;

        await sendEmail({
          to,
          subject,
          html,
          text: `${basePlaceholders.BODY_TEXT} ${absoluteLink}`,
          strict: true,
          emailType: 'distribution',
          containsPii: false,
          tenantId,
        });
        await logEmailSend({
          recipientEmail: to,
          emailType: 'distribution',
          containsPii: false,
          tenantId,
        });
        successfulCount++;
      } catch (err: any) {
        failedRecipients.push({ email: to, error: err.message || String(err) });
      }
    }

    const status =
      successfulCount === 0
        ? 'failed'
        : failedRecipients.length > 0
          ? 'partial_failure'
          : 'success';

    return {
      status,
      recipientsCount: resolvedRecipients.emails.length,
      successfulCount,
      failedRecipients,
      inviteStatus: {
        autoInviteEnabled: resolvedRecipients.autoInvite,
        invitedCount: invitedRecipients.length,
        inviteFailedCount: inviteFailedRecipients.length,
        invitedRecipients,
        inviteFailedRecipients,
      },
      durationMs: Date.now() - start,
      link: absoluteLink,
    };
  } catch (err: any) {
    return {
      status: 'failed',
      recipientsCount: 0,
      successfulCount: 0,
      failedRecipients: [],
      durationMs: Date.now() - start,
      errorMessage: err.message,
    };
  }
}

async function createPasswordResetUrlForInvite(email: string, tenantId: string): Promise<string> {
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  let tenantSlug: string | null = null;
  try {
    const tenantResult = await managementPool.query(
      `SELECT slug FROM coheus_tenants WHERE id = $1 LIMIT 1`,
      [tenantId]
    );
    tenantSlug = tenantResult.rows[0]?.slug ?? null;
  } catch {
    tenantSlug = null;
  }

  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await managementPool.query(
    `INSERT INTO password_reset_tokens (email, token_hash, tenant_slug, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [email, tokenHash, tenantSlug, expiresAt]
  );
  const frontendUrl = (process.env.FRONTEND_URL || 'http://localhost:5173').split(',')[0].trim();
  return `${frontendUrl}/reset-password?token=${token}`;
}

/**
 * Persist send result to distribution_send_log
 */
export async function logDistributionSend(
  tenantPool: Pool,
  scheduleId: string,
  result: SendDistributionResult,
  contentSnapshot: Record<string, any>,
  exportFormat: string
): Promise<void> {
  const mergedSnapshot = {
    ...contentSnapshot,
    invite_status: result.inviteStatus ?? null,
  };
  await tenantPool.query(
    `INSERT INTO public.distribution_send_log
     (schedule_id, status, recipients_count, successful_count, failed_recipients, content_snapshot, export_format, error_message, duration_ms)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      scheduleId,
      result.status,
      result.recipientsCount,
      result.successfulCount,
      JSON.stringify(result.failedRecipients),
      JSON.stringify(mergedSnapshot),
      exportFormat,
      result.errorMessage ?? null,
      result.durationMs,
    ]
  );
}

function buildAbsoluteLink(relativeOrAbsoluteLink: string): string {
  if (!relativeOrAbsoluteLink) return process.env.FRONTEND_URL || 'http://localhost:5173';
  if (/^https?:\/\//i.test(relativeOrAbsoluteLink)) return relativeOrAbsoluteLink;
  const base = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/+$/, '');
  const path = relativeOrAbsoluteLink.startsWith('/') ? relativeOrAbsoluteLink : `/${relativeOrAbsoluteLink}`;
  return `${base}${path}`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
