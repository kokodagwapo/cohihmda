/**
 * Audit logging for outbound email sends.
 * Writes to management DB email_send_log for SOC 2 / compliance.
 */

import { pool as managementPool } from "../config/managementDatabase.js";

export async function logEmailSend(params: {
  recipientEmail: string;
  emailType: string;
  containsPii?: boolean;
  userId?: string | null;
  tenantId?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    await managementPool.query(
      `INSERT INTO email_send_log (recipient_email, email_type, contains_pii, user_id, tenant_id, metadata)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
      [
        params.recipientEmail,
        params.emailType,
        params.containsPii ?? false,
        params.userId ?? null,
        params.tenantId ?? null,
        params.metadata ? JSON.stringify(params.metadata) : "{}",
      ]
    );
  } catch (err) {
    console.error("[EmailAudit] Failed to log email send:", err);
  }
}
