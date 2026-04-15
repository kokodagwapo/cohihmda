/**
 * AI Security Guard test suite (COHI-106)
 *
 * Verifies that:
 * 1. An AI agent identity is blocked on all mutating methods without an
 *    action ID, even when the base RBAC/persona would otherwise permit access.
 * 2. An unknown or non-approved action ID is rejected.
 * 3. An approved action ID passes the guard.
 * 4. Non-AI identities are not affected by the guard.
 * 5. Read-only AI requests (GET) pass without an action ID.
 *
 * Architecture note: the tests use a lightweight Express harness to avoid
 * bringing up the full application stack.  The AiAgentOrchestrator's DB pool
 * is mocked so tests run without a real Postgres instance.
 */

import request from 'supertest';
import express, { type Request, type Response } from 'express';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { authenticateToken, type AuthRequest } from '../../middleware/auth.js';
import { aiSecurityGuard } from '../../middleware/aiSecurityGuard.js';
import { tokenForAiAgent, tokenForRole } from '../tokenFactory.js';

// ---------------------------------------------------------------------------
// Mock the orchestrator so tests do not need a real DB
// ---------------------------------------------------------------------------

vi.mock('../../services/aiAgentOrchestrator.js', () => ({
  getActionStatus: vi.fn(),
  startAction: vi.fn().mockResolvedValue('mock-action-id'),
  transitionAction: vi.fn().mockResolvedValue(undefined),
  SecurityBoundaryViolation: class SecurityBoundaryViolation extends Error {
    constructor(msg: string) { super(msg); this.name = 'SecurityBoundaryViolation'; }
  },
}));

import * as orchestrator from '../../services/aiAgentOrchestrator.js';
const mockGetActionStatus = orchestrator.getActionStatus as ReturnType<typeof vi.fn>;

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

function buildHarness() {
  const app = express();
  app.use(express.json());

  // Simulate the requestId middleware
  app.use((req: Request, _res: Response, next) => {
    req.id = 'test-request-id';
    next();
  });

  // AI agent writes to a hypothetical data endpoint
  app.post(
    '/api/loans',
    authenticateToken as express.RequestHandler,
    aiSecurityGuard as express.RequestHandler,
    (req: Request, res: Response) => res.status(200).json({ ok: true }),
  );
  app.put(
    '/api/loans/:id',
    authenticateToken as express.RequestHandler,
    aiSecurityGuard as express.RequestHandler,
    (req: Request, res: Response) => res.status(200).json({ ok: true }),
  );
  app.patch(
    '/api/loans/:id',
    authenticateToken as express.RequestHandler,
    aiSecurityGuard as express.RequestHandler,
    (req: Request, res: Response) => res.status(200).json({ ok: true }),
  );
  app.delete(
    '/api/loans/:id',
    authenticateToken as express.RequestHandler,
    aiSecurityGuard as express.RequestHandler,
    (req: Request, res: Response) => res.status(200).json({ ok: true }),
  );
  app.get(
    '/api/loans',
    authenticateToken as express.RequestHandler,
    aiSecurityGuard as express.RequestHandler,
    (req: Request, res: Response) => res.status(200).json({ ok: true }),
  );

  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('aiSecurityGuard', () => {
  const app = buildHarness();
  const aiToken = tokenForAiAgent();
  const humanToken = tokenForRole('user');

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── 1. Missing X-AI-Action-Id ──────────────────────────────────────────

  it.each(['post', 'put', 'patch', 'delete'] as const)(
    'blocks AI %s without X-AI-Action-Id → 403',
    async (method) => {
      const path = method === 'post' ? '/api/loans' : '/api/loans/1';
      const res = await (request(app) as any)[method](path)
        .set('Authorization', `Bearer ${aiToken}`)
        .send({});

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('AI_MISSING_ACTION_ID');
      expect(mockGetActionStatus).not.toHaveBeenCalled();
    },
  );

  // ── 2. Unknown action ID ───────────────────────────────────────────────

  it('blocks AI POST when action_id is not found in ledger → 403', async () => {
    mockGetActionStatus.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/loans')
      .set('Authorization', `Bearer ${aiToken}`)
      .set('X-AI-Action-Id', 'unknown-action-id')
      .send({});

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('AI_ACTION_NOT_APPROVED');
  });

  // ── 3. Non-approved statuses ───────────────────────────────────────────

  it.each(['started', 'pending_approval', 'executed', 'failed'] as const)(
    'blocks AI POST when status is %s → 403',
    async (status) => {
      mockGetActionStatus.mockResolvedValue(status);

      const res = await request(app)
        .post('/api/loans')
        .set('Authorization', `Bearer ${aiToken}`)
        .set('X-AI-Action-Id', 'action-uuid')
        .send({});

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('AI_ACTION_NOT_APPROVED');
    },
  );

  // ── 4. Approved action passes ──────────────────────────────────────────

  it('allows AI POST when action status is approved → 200', async () => {
    mockGetActionStatus.mockResolvedValue('approved');

    const res = await request(app)
      .post('/api/loans')
      .set('Authorization', `Bearer ${aiToken}`)
      .set('X-AI-Action-Id', 'approved-action-id')
      .send({});

    expect(res.status).toBe(200);
    expect(mockGetActionStatus).toHaveBeenCalledWith('approved-action-id');
  });

  // ── 5. Read-only AI requests pass without action ID ────────────────────

  it('allows AI GET without X-AI-Action-Id → 200', async () => {
    const res = await request(app)
      .get('/api/loans')
      .set('Authorization', `Bearer ${aiToken}`)
      .send();

    expect(res.status).toBe(200);
    expect(mockGetActionStatus).not.toHaveBeenCalled();
  });

  // ── 6. Non-AI human identity is never intercepted ─────────────────────

  it('passes human POST without X-AI-Action-Id → 200', async () => {
    const res = await request(app)
      .post('/api/loans')
      .set('Authorization', `Bearer ${humanToken}`)
      .send({});

    expect(res.status).toBe(200);
    expect(mockGetActionStatus).not.toHaveBeenCalled();
  });

  // ── 7. DB error in getActionStatus fails closed ────────────────────────

  it('fails closed (403) when getActionStatus throws → 403', async () => {
    mockGetActionStatus.mockRejectedValue(new Error('DB unavailable'));

    const res = await request(app)
      .post('/api/loans')
      .set('Authorization', `Bearer ${aiToken}`)
      .set('X-AI-Action-Id', 'some-action-id')
      .send({});

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('AI_ACTION_NOT_APPROVED');
  });
});
