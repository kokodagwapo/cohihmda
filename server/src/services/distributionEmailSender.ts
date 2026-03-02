/**
 * Distribution Email Sender
 * Resolves content, builds email from template, sends to recipients, logs to distribution_send_log.
 */

import type { Pool } from 'pg';
import { loadEmailTemplate, replacePlaceholders } from './emailTemplateLoader.js';
import {
  sendEmailWithAttachment,
  sendEmail,
} from './emailService.js';
import { logEmailSend } from './emailAuditLogger.js';
import { resolveContent, type ScheduleRow, type ResolveContentResult } from './distributionContentResolver.js';

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
  durationMs: number;
  errorMessage?: string;
  exportFormat?: string;
}

/**
 * Resolve recipient emails for a schedule (from list or inline)
 */
export async function resolveRecipientEmails(
  tenantPool: Pool,
  schedule: ScheduleRow
): Promise<string[]> {
  const emails: string[] = [];

  if (schedule.recipient_emails?.length) {
    emails.push(...schedule.recipient_emails.filter((e: string) => e && e.includes('@')));
  }

  if (schedule.recipient_list_id) {
    const list = await tenantPool.query(
      `SELECT user_ids, external_emails, role_filter, is_dynamic
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
    }
  }

  return [...new Set(emails)];
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
    const recipients = await resolveRecipientEmails(tenantPool, schedule);
    if (recipients.length === 0) {
      return {
        status: 'failed',
        recipientsCount: 0,
        successfulCount: 0,
        failedRecipients: [],
        durationMs: Date.now() - start,
        errorMessage: 'No recipients',
      };
    }

    let content: ResolveContentResult;
    try {
      content = await resolveContent(tenantPool, schedule, { userFilter });
    } catch (err: any) {
      return {
        status: 'failed',
        recipientsCount: recipients.length,
        successfulCount: 0,
        failedRecipients: recipients.map((e) => ({ email: e, error: err.message })),
        durationMs: Date.now() - start,
        errorMessage: err.message,
      };
    }

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
      BODY_TEXT: content.attachment
        ? 'Your scheduled report is attached.'
        : (content.html ? 'Please see the insight digest below.' : 'Your scheduled content is attached.'),
      VIEW_IN_APP_HTML: '',
      CONTENT_HTML: content.html || '',
      ATTACHMENT_NOTE: content.attachment ? 'An attachment is included with this email.' : '',
    };

    const subject = `${schedule.name} – Coheus`;

    for (const to of recipients) {
      try {
        const html = template
          ? replacePlaceholders(template, { ...basePlaceholders })
          : (content.html || `<p>${basePlaceholders.BODY_TEXT}</p><p>${basePlaceholders.ATTACHMENT_NOTE}</p>`);

        if (content.attachment) {
          await sendEmailWithAttachment({
            to,
            subject,
            html,
            text: `${basePlaceholders.BODY_TEXT} ${basePlaceholders.ATTACHMENT_NOTE}`,
            attachment: {
              buffer: content.attachment.buffer,
              filename: content.attachment.filename,
              mimeType: content.attachment.mime,
            },
            emailType: 'distribution',
            containsPii: false,
            tenantId,
          });
        } else if (content.html) {
          await sendEmail({
            to,
            subject,
            html: content.html,
            text: 'View the insight digest in the HTML version of this email.',
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
        } else {
          throw new Error('No content to send');
        }
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
      recipientsCount: recipients.length,
      successfulCount,
      failedRecipients,
      durationMs: Date.now() - start,
      exportFormat: content.exportFormat,
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
      JSON.stringify(contentSnapshot),
      exportFormat,
      result.errorMessage ?? null,
      result.durationMs,
    ]
  );
}
