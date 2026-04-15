/**
 * AI Redactor — Deny-by-Default whitelist redaction for AI control-plane payloads
 *
 * Policy (COHI-106):
 * - Every field in an object is redacted UNLESS it appears in the explicit
 *   AI_SAFE_FIELDS whitelist.
 * - Arrays are recursively walked and redacted element-by-element.
 * - Primitive values (strings, numbers, booleans) passed directly are returned
 *   as-is; callers should pass structured objects, not raw PII strings.
 * - High-risk entities identified in INTERNAL_DISCOVERY.md (loans,
 *   research_uploads, prompt payloads, error dumps) receive the strictest
 *   treatment: every non-whitelisted field becomes "[REDACTED]".
 *
 * Artifact offload (S3):
 * - Sanitized JSON payloads above ARTIFACT_SIZE_THRESHOLD_BYTES are not stored
 *   in Postgres.  Instead they are uploaded to S3 and the caller receives a
 *   structured reference ({ bucket, s3_key, size_bytes, checksum?, content_type? })
 *   that can be persisted in the ai_control_plane.audit_ledger artifacts column.
 *
 * S3 key convention (from COHI-106 plan):
 *   ai-control-plane/{environment}/{yyyy}/{mm}/{dd}/{tenantId}/{actionId}/{artifactType}/{requestId}-{sequence}.json
 *
 * A service-level S3 client is initialised once and reused across calls so
 * upload latency stays predictable under AI-driven test execution.
 */

import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { createHash } from 'crypto';
import { logError, logWarn } from '../services/logger.js';

// ---------------------------------------------------------------------------
// Safe-field whitelist
// ---------------------------------------------------------------------------

/**
 * Only these field names are permitted to pass through to LLM prompts,
 * ledger metadata, or approval previews without redaction.
 * Add new entries deliberately and only for non-sensitive operational metadata.
 */
export const AI_SAFE_FIELDS = new Set([
  'id',
  'uuid',
  'status',
  'created_at',
  'updated_at',
  'tenant_id',
  'request_id',
  'action_id',
  'action_type',
  'agent_id',
]);

const REDACTED = '[REDACTED]';

// ---------------------------------------------------------------------------
// Redaction
// ---------------------------------------------------------------------------

/**
 * Recursively redact an object using the AI_SAFE_FIELDS whitelist.
 * Returns a new object; the input is never mutated.
 */
export function redact(data: unknown): unknown {
  if (data === null || data === undefined) return data;
  if (typeof data !== 'object') return data;

  if (Array.isArray(data)) {
    return data.map(redact);
  }

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    if (AI_SAFE_FIELDS.has(key)) {
      // Safe field — recurse into objects but allow primitives through.
      out[key] = typeof value === 'object' && value !== null ? redact(value) : value;
    } else {
      out[key] = REDACTED;
    }
  }
  return out;
}

/**
 * Redact a payload and serialise it to a JSON string.
 * Useful for building ledger metadata or approval-preview output.
 */
export function redactToJson(data: unknown): string {
  return JSON.stringify(redact(data));
}

// ---------------------------------------------------------------------------
// S3 artifact offload
// ---------------------------------------------------------------------------

export const ARTIFACT_SIZE_THRESHOLD_BYTES = 10 * 1024; // 10 KB

export interface ArtifactRef {
  bucket: string;
  s3_key: string;
  size_bytes: number;
  checksum: string;
  content_type: string;
}

export interface OffloadOptions {
  /** Which S3 bucket to write to. Falls back to AI_ARTIFACTS_BUCKET env var. */
  bucket?: string;
  tenantId: string;
  actionId: string;
  requestId: string;
  artifactType: string;
  /** Sequence counter when multiple artifacts belong to the same action. */
  sequence?: number;
  contentType?: string;
}

// Service-level S3 client — constructed once to avoid per-request cold starts.
let _s3Client: S3Client | null = null;

function getS3Client(): S3Client {
  if (!_s3Client) {
    _s3Client = new S3Client({
      region: process.env.AWS_REGION || 'us-east-2',
    });
  }
  return _s3Client;
}

function buildS3Key(opts: OffloadOptions): string {
  const env = process.env.NODE_ENV || 'development';
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(now.getUTCDate()).padStart(2, '0');
  const seq = opts.sequence ?? 0;

  return [
    'ai-control-plane',
    env,
    yyyy,
    mm,
    dd,
    opts.tenantId,
    opts.actionId,
    opts.artifactType,
    `${opts.requestId}-${seq}.json`,
  ].join('/');
}

/**
 * Redact a payload, check whether it exceeds the size threshold, and if so
 * upload it to S3.  Returns either:
 *   - { inline: string }  when the payload is small enough to keep in Postgres
 *   - { ref: ArtifactRef } when the payload was offloaded to S3
 *
 * On S3 upload failure the function falls back to returning the inline
 * representation and logs a warning so the action is not silently dropped.
 */
export async function redactAndOffload(
  data: unknown,
  opts: OffloadOptions,
): Promise<{ inline: string } | { ref: ArtifactRef }> {
  const redacted = redactToJson(data);
  const bytes = Buffer.byteLength(redacted, 'utf8');

  if (bytes <= ARTIFACT_SIZE_THRESHOLD_BYTES) {
    return { inline: redacted };
  }

  const bucket = opts.bucket || process.env.AI_ARTIFACTS_BUCKET || '';
  if (!bucket) {
    logWarn('[AiRedactor] AI_ARTIFACTS_BUCKET not configured; falling back to inline storage', {
      requestId: opts.requestId,
      actionId: opts.actionId,
      size_bytes: bytes,
    });
    return { inline: redacted };
  }

  const s3Key = buildS3Key(opts);
  const contentType = opts.contentType || 'application/json';
  const checksum = createHash('sha256').update(redacted).digest('hex');

  try {
    const client = getS3Client();
    await client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: s3Key,
      Body: redacted,
      ContentType: contentType,
      Metadata: {
        'x-request-id': opts.requestId,
        'x-action-id': opts.actionId,
        'x-tenant-id': opts.tenantId,
        'x-artifact-type': opts.artifactType,
        'x-checksum': checksum,
      },
    }));

    return {
      ref: {
        bucket,
        s3_key: s3Key,
        size_bytes: bytes,
        checksum,
        content_type: contentType,
      },
    };
  } catch (err) {
    logError('[AiRedactor] S3 upload failed; falling back to inline storage', err, {
      requestId: opts.requestId,
      actionId: opts.actionId,
      s3Key,
    });
    return { inline: redacted };
  }
}
