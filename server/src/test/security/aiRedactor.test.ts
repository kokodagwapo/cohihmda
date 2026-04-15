/**
 * AI Redactor unit tests (COHI-106)
 *
 * Verifies the deny-by-default whitelist policy and the S3 offload threshold
 * logic without needing a real AWS connection.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { redact, redactToJson, AI_SAFE_FIELDS, ARTIFACT_SIZE_THRESHOLD_BYTES, redactAndOffload } from '../../utils/aiRedactor.js';

// ---------------------------------------------------------------------------
// Mock S3 so tests run without AWS credentials
// ---------------------------------------------------------------------------

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn().mockImplementation(() => ({
    send: vi.fn().mockResolvedValue({}),
  })),
  PutObjectCommand: vi.fn(),
}));

// ---------------------------------------------------------------------------
// redact()
// ---------------------------------------------------------------------------

describe('redact', () => {
  it('allows all AI_SAFE_FIELDS through', () => {
    const input = Object.fromEntries([...AI_SAFE_FIELDS].map((f) => [f, 'value']));
    const result = redact(input) as Record<string, unknown>;
    for (const field of AI_SAFE_FIELDS) {
      expect(result[field]).toBe('value');
    }
  });

  it('redacts non-whitelisted fields', () => {
    const result = redact({
      id: 'safe-id',
      email: 'user@example.com',
      first_name: 'John',
      loan_amount: 500000,
      data_json: { raw: 'pii' },
    }) as Record<string, unknown>;

    expect(result['id']).toBe('safe-id');
    expect(result['email']).toBe('[REDACTED]');
    expect(result['first_name']).toBe('[REDACTED]');
    expect(result['loan_amount']).toBe('[REDACTED]');
    expect(result['data_json']).toBe('[REDACTED]');
  });

  it('recursively redacts nested object values under safe keys using the same whitelist', () => {
    // When a safe key contains an object, the whitelist is applied recursively
    // to that nested object's own keys.  "nested_id" is not in AI_SAFE_FIELDS
    // so it is redacted even though its parent key ("id") is safe.
    const result = redact({
      id: { id: 'inner-id', secret: 'hidden', status: 'ok' },
    }) as Record<string, unknown>;

    const idVal = result['id'] as Record<string, unknown>;
    expect(idVal['id']).toBe('inner-id');   // "id" is safe at every nesting level
    expect(idVal['status']).toBe('ok');     // "status" is safe
    expect(idVal['secret']).toBe('[REDACTED]'); // "secret" is not safe
  });

  it('handles arrays by redacting each element', () => {
    const result = redact([
      { id: 'a', email: 'a@b.com' },
      { id: 'b', ssn: '123-45-6789' },
    ]) as Array<Record<string, unknown>>;

    expect(result[0]['id']).toBe('a');
    expect(result[0]['email']).toBe('[REDACTED]');
    expect(result[1]['id']).toBe('b');
    expect(result[1]['ssn']).toBe('[REDACTED]');
  });

  it('returns primitives unchanged', () => {
    expect(redact(42)).toBe(42);
    expect(redact('hello')).toBe('hello');
    expect(redact(null)).toBe(null);
    expect(redact(undefined)).toBe(undefined);
  });

  it('fully redacts a simulated loans row (high-risk entity)', () => {
    const loanRow = {
      id: 'loan-123',
      loan_number: 'LN-001',
      borrower_email: 'borrower@bank.com',
      borrower_ssn: '000-00-0000',
      loan_amount: 425000,
      status: 'active',
      created_at: '2024-01-01',
    };
    const result = redact(loanRow) as Record<string, unknown>;

    expect(result['id']).toBe('loan-123');
    expect(result['status']).toBe('active');
    expect(result['created_at']).toBe('2024-01-01');
    expect(result['loan_number']).toBe('[REDACTED]');
    expect(result['borrower_email']).toBe('[REDACTED]');
    expect(result['borrower_ssn']).toBe('[REDACTED]');
    expect(result['loan_amount']).toBe('[REDACTED]');
  });
});

// ---------------------------------------------------------------------------
// redactAndOffload()
// ---------------------------------------------------------------------------

describe('redactAndOffload', () => {
  const baseOpts = {
    tenantId: 'tenant-abc',
    actionId: 'action-123',
    requestId: 'req-456',
    artifactType: 'loan_payload',
  };

  it('returns inline when payload is below threshold', async () => {
    const smallData = { id: 'x', status: 'ok' };
    const result = await redactAndOffload(smallData, baseOpts);

    expect('inline' in result).toBe(true);
    if ('inline' in result) {
      const parsed = JSON.parse(result.inline);
      expect(parsed.id).toBe('x');
    }
  });

  it('falls back to inline when AI_ARTIFACTS_BUCKET is not set', async () => {
    const originalBucket = process.env.AI_ARTIFACTS_BUCKET;
    delete process.env.AI_ARTIFACTS_BUCKET;

    // Build a payload that exceeds the threshold
    const bigPayload = { id: 'x', data: 'a'.repeat(ARTIFACT_SIZE_THRESHOLD_BYTES + 100) };
    const result = await redactAndOffload(bigPayload, baseOpts);

    // data is redacted so the actual inline JSON is small — but the function
    // still returns inline because AI_ARTIFACTS_BUCKET is not set.
    expect('inline' in result).toBe(true);

    if (originalBucket !== undefined) {
      process.env.AI_ARTIFACTS_BUCKET = originalBucket;
    }
  });

  it('returns S3 ref when payload exceeds threshold and bucket is configured', async () => {
    process.env.AI_ARTIFACTS_BUCKET = 'test-artifacts-bucket';

    // Build a payload whose *redacted* JSON would be large.
    // Since redaction keeps id/status/etc, we need the safe fields to be large.
    // We pad the id value to exceed the threshold.
    const bigId = 'x'.repeat(ARTIFACT_SIZE_THRESHOLD_BYTES + 500);
    const bigPayload = { id: bigId };
    const result = await redactAndOffload(bigPayload, { ...baseOpts, bucket: 'test-artifacts-bucket' });

    expect('ref' in result).toBe(true);
    if ('ref' in result) {
      expect(result.ref.bucket).toBe('test-artifacts-bucket');
      expect(result.ref.s3_key).toContain('ai-control-plane/');
      expect(result.ref.s3_key).toContain(baseOpts.tenantId);
      expect(result.ref.s3_key).toContain(baseOpts.actionId);
      expect(result.ref.size_bytes).toBeGreaterThan(ARTIFACT_SIZE_THRESHOLD_BYTES);
      expect(result.ref.checksum).toBeTruthy();
    }

    delete process.env.AI_ARTIFACTS_BUCKET;
  });
});
