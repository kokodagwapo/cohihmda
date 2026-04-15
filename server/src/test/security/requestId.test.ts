/**
 * Request ID middleware tests (COHI-106)
 *
 * Verifies that every request receives a correlation ID, that it appears in
 * the X-Request-Id response header, and that inbound IDs from trusted headers
 * are preserved rather than replaced.
 */

import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { requestIdMiddleware } from '../../middleware/requestId.js';

function buildApp() {
  const app = express();
  app.use(requestIdMiddleware);
  app.get('/ping', (req, res) => {
    res.json({ requestId: req.id });
  });
  return app;
}

describe('requestIdMiddleware', () => {
  const app = buildApp();

  it('attaches req.id and echoes it in X-Request-Id header', async () => {
    const res = await request(app).get('/ping');
    expect(res.status).toBe(200);
    expect(res.body.requestId).toBeTruthy();
    expect(res.headers['x-request-id']).toBe(res.body.requestId);
  });

  it('generates a UUID v4 format ID when none is provided', async () => {
    const res = await request(app).get('/ping');
    const uuidV4Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    expect(uuidV4Pattern.test(res.body.requestId)).toBe(true);
  });

  it('reuses an inbound X-Request-Id header rather than generating a new one', async () => {
    const inboundId = '11111111-1111-4111-8111-111111111111';
    const res = await request(app).get('/ping').set('X-Request-Id', inboundId);
    expect(res.body.requestId).toBe(inboundId);
    expect(res.headers['x-request-id']).toBe(inboundId);
  });

  it('generates unique IDs across concurrent requests', async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, () => request(app).get('/ping')),
    );
    const ids = results.map((r) => r.body.requestId);
    const unique = new Set(ids);
    expect(unique.size).toBe(10);
  });
});
