import crypto from "crypto";
import pg from "pg";
import { EncompassEtlService } from "./etl/encompassEtlService.js";
import { logInfo, logWarn, logError } from "./logger.js";

const DEFAULT_PRIORITY_FIELD_IDS = [
  "2",
  "3",
  "4",
  "19",
  "364",
  "748",
  "761",
  "762",
  "1172",
  "1393",
  "2626",
  "3142",
  "353",
  "356",
  "136",
  "317",
  "ORGID",
  "Loan.LastModified",
  "Log.MS.CurrentMilestone",
  "GUID",
];

type WebhookConfig = {
  id: string;
  webhook_enabled: boolean;
  webhook_secret: string | null;
  webhook_mode: "priority_only" | "all_changes";
  webhook_priority_field_ids: string[] | null;
  webhook_priority_field_limit: number | null;
  webhook_reconciliation_enabled: boolean;
  sync_enabled: boolean;
  encompass_selected_folders: string[] | null;
};

function normalizeFieldId(fieldId: string): string {
  return fieldId.startsWith("Fields.") ? fieldId.substring(7) : fieldId;
}

function extractChangedFieldIds(payload: any): string[] {
  const out = new Set<string>();
  const eventPayload = payload?.meta?.payload?.event;
  const candidates = [
    ...(Array.isArray(eventPayload?.changedFields)
      ? eventPayload.changedFields
      : []),
    ...(Array.isArray(eventPayload?.fields) ? eventPayload.fields : []),
  ];
  for (const entry of candidates) {
    if (!entry) continue;
    if (typeof entry === "string") {
      out.add(normalizeFieldId(entry));
      continue;
    }
    const id = entry.fieldId || entry.id || entry.fieldID;
    if (id) out.add(normalizeFieldId(String(id)));
  }
  return [...out];
}

export class EncompassWebhookService {
  constructor(private readonly tenantPool: pg.Pool) {}

  async getConnectionWebhookConfig(
    connectionId: string,
  ): Promise<WebhookConfig | null> {
    const result = await this.tenantPool.query(
      `SELECT id, webhook_enabled, webhook_secret, webhook_mode,
              webhook_priority_field_ids, webhook_priority_field_limit,
              webhook_reconciliation_enabled, sync_enabled, encompass_selected_folders
       FROM public.los_connections
       WHERE id = $1 AND los_type = 'encompass' AND is_active = true`,
      [connectionId],
    );
    if (result.rows.length === 0) return null;
    const row = result.rows[0];
    let selectedFolders: string[] | null = null;
    if (row.encompass_selected_folders) {
      if (Array.isArray(row.encompass_selected_folders)) {
        selectedFolders = row.encompass_selected_folders;
      } else if (typeof row.encompass_selected_folders === "string") {
        try {
          selectedFolders = JSON.parse(row.encompass_selected_folders);
        } catch {
          selectedFolders = null;
        }
      }
    }
    return {
      ...row,
      encompass_selected_folders: selectedFolders,
    } as WebhookConfig;
  }

  verifySignature(rawBody: string, signature: string | undefined, secret: string): boolean {
    if (!signature || !secret) return false;
    const computed = crypto
      .createHmac("sha256", secret)
      .update(rawBody, "utf8")
      .digest("base64");
    try {
      return crypto.timingSafeEqual(
        Buffer.from(signature.trim()),
        Buffer.from(computed),
      );
    } catch {
      return false;
    }
  }

  private getPriorityFields(config: WebhookConfig): Set<string> {
    const configured = Array.isArray(config.webhook_priority_field_ids)
      ? config.webhook_priority_field_ids
      : [];
    const limit = Math.max(1, Math.min(config.webhook_priority_field_limit || 20, 50));
    const source = configured.length > 0 ? configured : DEFAULT_PRIORITY_FIELD_IDS;
    return new Set(source.slice(0, limit).map((f) => normalizeFieldId(String(f))));
  }

  async ingestWebhookEvent(connectionId: string, payload: any): Promise<{
    accepted: boolean;
    ignored: boolean;
    reason?: string;
  }> {
    const config = await this.getConnectionWebhookConfig(connectionId);
    if (!config) return { accepted: false, ignored: true, reason: "Connection not found" };
    if (!config.webhook_enabled || !config.sync_enabled) {
      return { accepted: false, ignored: true, reason: "Webhook disabled" };
    }

    const eventId = payload?.eventId;
    if (!eventId) return { accepted: false, ignored: true, reason: "Missing eventId" };
    const eventType = payload?.eventType || "unknown";
    const resourceType = payload?.meta?.resourceType || null;
    const resourceId = payload?.meta?.resourceId || null;
    const changedFields = extractChangedFieldIds(payload);

    const prioritySet = this.getPriorityFields(config);
    const hasPriorityFieldChange =
      changedFields.length === 0 ||
      changedFields.some((fieldId) => prioritySet.has(normalizeFieldId(fieldId)));

    if (config.webhook_mode === "priority_only" && !hasPriorityFieldChange) {
      await this.tenantPool.query(
        `INSERT INTO public.encompass_webhook_events
           (event_id, los_connection_id, event_type, resource_type, resource_id, payload, status, error_message, received_at)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, 'ignored', $7, NOW())
         ON CONFLICT (event_id) DO NOTHING`,
        [
          eventId,
          connectionId,
          eventType,
          resourceType,
          resourceId,
          JSON.stringify(payload),
          "No configured priority field changes detected",
        ],
      );
      return {
        accepted: false,
        ignored: true,
        reason: "No configured priority field changes detected",
      };
    }

    const eventInsert = await this.tenantPool.query(
      `INSERT INTO public.encompass_webhook_events
         (event_id, los_connection_id, event_type, resource_type, resource_id, payload, status, received_at)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, 'queued', NOW())
       ON CONFLICT (event_id) DO NOTHING
       RETURNING event_id`,
      [eventId, connectionId, eventType, resourceType, resourceId, JSON.stringify(payload)],
    );
    if (eventInsert.rows.length === 0) {
      return { accepted: true, ignored: true, reason: "Duplicate event" };
    }

    await this.tenantPool.query(
      `INSERT INTO public.encompass_webhook_queue (event_id, los_connection_id, loan_guid, status, next_attempt_at)
       VALUES ($1, $2, $3, 'pending', NOW())
       ON CONFLICT (event_id) DO NOTHING`,
      [eventId, connectionId, resourceId],
    );

    return { accepted: true, ignored: false };
  }

  async processPendingQueue(tenantId: string, limit = 10): Promise<void> {
    const result = await this.tenantPool.query(
      `SELECT q.id, q.event_id, q.los_connection_id
       FROM public.encompass_webhook_queue q
       WHERE q.status IN ('pending', 'failed')
         AND q.next_attempt_at <= NOW()
       ORDER BY q.created_at ASC
       LIMIT $1`,
      [limit],
    );
    if (result.rows.length === 0) return;

    for (let i = 0; i < result.rows.length; i++) {
      const row = result.rows[i];

      if (i > 0) {
        await new Promise((r) => setTimeout(r, 2000));
      }

      await this.tenantPool.query(
        `UPDATE public.encompass_webhook_queue
         SET status = 'processing', attempts = attempts + 1, updated_at = NOW()
         WHERE id = $1`,
        [row.id],
      );

      try {
        const cfg = await this.getConnectionWebhookConfig(row.los_connection_id);
        const selectedFolders = cfg?.encompass_selected_folders || undefined;

        const modifiedFrom = new Date(Date.now() - 30 * 60 * 1000);
        const etl = new EncompassEtlService(this.tenantPool);
        await etl.syncLoans(tenantId, row.los_connection_id, {
          fullSync: false,
          modifiedFrom,
          folderNames: selectedFolders,
          limit: 500,
        });

        await this.tenantPool.query(
          `UPDATE public.encompass_webhook_queue
           SET status = 'completed', updated_at = NOW()
           WHERE id = $1`,
          [row.id],
        );
        await this.tenantPool.query(
          `UPDATE public.encompass_webhook_events
           SET status = 'processed', processed_at = NOW()
           WHERE event_id = $1`,
          [row.event_id],
        );
      } catch (error: any) {
        const attemptsResult = await this.tenantPool.query(
          `SELECT attempts FROM public.encompass_webhook_queue WHERE id = $1`,
          [row.id],
        );
        const attempts = attemptsResult.rows[0]?.attempts || 1;
        const delayMinutes = Math.min(60, Math.pow(2, attempts));
        const nextAttempt = new Date(Date.now() + delayMinutes * 60 * 1000);
        await this.tenantPool.query(
          `UPDATE public.encompass_webhook_queue
           SET status = 'failed', last_error = $2, next_attempt_at = $3, updated_at = NOW()
           WHERE id = $1`,
          [row.id, error.message, nextAttempt],
        );
        await this.tenantPool.query(
          `UPDATE public.encompass_webhook_events
           SET status = 'failed', error_message = $2
           WHERE event_id = $1`,
          [row.event_id, error.message],
        );
        logError("[EncompassWebhook] Queue processing failed", error, {
          eventId: row.event_id,
          connectionId: row.los_connection_id,
        });
      }
    }
  }

  async runReconciliation(
    tenantId: string,
    options?: { connectionId?: string; modifiedFrom?: Date },
  ): Promise<void> {
    const conditions: string[] = [
      "los_type = 'encompass'",
      "is_active = true",
      "sync_enabled = true",
      "webhook_reconciliation_enabled = true",
    ];
    const params: any[] = [];
    if (options?.connectionId) {
      params.push(options.connectionId);
      conditions.push(`id = $${params.length}`);
    }

    const connections = await this.tenantPool.query(
      `SELECT id, encompass_selected_folders
       FROM public.los_connections
       WHERE ${conditions.join(" AND ")}`,
      params,
    );
    for (let i = 0; i < connections.rows.length; i++) {
      const row = connections.rows[i];

      if (i > 0) {
        await new Promise((r) => setTimeout(r, 3000));
      }

      try {
        let selectedFolders: string[] | undefined;
        if (Array.isArray(row.encompass_selected_folders)) {
          selectedFolders = row.encompass_selected_folders;
        } else if (typeof row.encompass_selected_folders === "string") {
          try {
            selectedFolders = JSON.parse(row.encompass_selected_folders);
          } catch {
            selectedFolders = undefined;
          }
        }
        const etl = new EncompassEtlService(this.tenantPool);
        await etl.syncLoans(tenantId, row.id, {
          fullSync: false,
          modifiedFrom: options?.modifiedFrom || new Date(Date.now() - 2 * 60 * 60 * 1000),
          folderNames: selectedFolders,
          limit: 2000,
        });
        await this.tenantPool.query(
          `UPDATE public.los_connections
           SET webhook_last_reconciled_at = NOW(), updated_at = NOW()
           WHERE id = $1`,
          [row.id],
        );
      } catch (error: any) {
        logWarn("[EncompassWebhook] Reconciliation failed", {
          tenantId,
          connectionId: row.id,
          error: error.message,
        });
      }
    }
  }
}

export async function processEncompassWebhookPayload(params: {
  tenantPool: pg.Pool;
  tenantId: string;
  connectionId: string;
  rawBody: string;
  signature?: string;
  payload: any;
}): Promise<{ statusCode: number; body: Record<string, any> }> {
  const svc = new EncompassWebhookService(params.tenantPool);
  const cfg = await svc.getConnectionWebhookConfig(params.connectionId);
  if (!cfg || !cfg.webhook_enabled) {
    return { statusCode: 404, body: { error: "Webhook not configured" } };
  }
  if (!cfg.webhook_secret) {
    return { statusCode: 400, body: { error: "Webhook secret missing" } };
  }
  const verified = svc.verifySignature(
    params.rawBody,
    params.signature,
    cfg.webhook_secret,
  );
  if (!verified) {
    logWarn("[EncompassWebhook] Signature verification failed", {
      connectionId: params.connectionId,
    });
    return { statusCode: 401, body: { error: "Invalid signature" } };
  }

  const ingestResult = await svc.ingestWebhookEvent(
    params.connectionId,
    params.payload,
  );
  if (ingestResult.ignored) {
    return { statusCode: 202, body: { accepted: false, reason: ingestResult.reason } };
  }

  try {
    await svc.processPendingQueue(params.tenantId, 5);
  } catch (error: any) {
    logWarn("[EncompassWebhook] Deferred queue processing", {
      connectionId: params.connectionId,
      error: error.message,
    });
  }

  logInfo("[EncompassWebhook] Event accepted", {
    connectionId: params.connectionId,
    eventId: params.payload?.eventId,
  });
  return { statusCode: 202, body: { accepted: true } };
}
