/**
 * AI Agent Orchestrator
 *
 * The fail-closed compliance boundary for all AI-initiated actions.
 *
 * Design constraints (from COHI-106 plan):
 * - Uses a dedicated pg.Pool (max: 5) that is completely separate from the
 *   shared management database wrapper in managementDatabase.ts.
 * - startAction() MUST write a "started" row to ai_control_plane.audit_ledger
 *   before any LLM call or controlled mutation proceeds.  If that write fails,
 *   a SecurityBoundaryViolation is thrown and the caller must abort.
 * - Each lifecycle stage is a discrete write; no single transaction spans an
 *   LLM call, browser action, or route execution.
 * - The existing auditLogger.ts (fail-open, tenant DB) remains supplemental
 *   only.  This service is the authoritative control-plane trail.
 */

import pg from 'pg';
import { randomUUID } from 'crypto';
import { logError, logInfo, logWarn } from './logger.js';

const { Pool } = pg;

// ---------------------------------------------------------------------------
// Error class
// ---------------------------------------------------------------------------

/**
 * Thrown when the orchestrator cannot write its mandatory startup row.
 * Callers must catch this, abort the AI action, and return a 500/503 to the
 * client.  Do not swallow this error.
 */
export class SecurityBoundaryViolation extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'SecurityBoundaryViolation';
  }
}

// ---------------------------------------------------------------------------
// Ledger types
// ---------------------------------------------------------------------------

export type LedgerStatus =
  | 'started'
  | 'pending_approval'
  | 'approved'
  | 'executed'
  | 'failed';

export interface LedgerRow {
  id: string;
  action_id: string;
  request_id: string;
  agent_id: string;
  agent_sub_type: string;
  tenant_id: string | null;
  action_type: string;
  status: LedgerStatus;
  approved_by: string | null;
  approved_at: Date | null;
  approval_note: string | null;
  artifacts: ArtifactRef[] | null;
  metadata: Record<string, unknown> | null;
  error_message: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface ArtifactRef {
  bucket: string;
  s3_key: string;
  size_bytes: number;
  checksum?: string;
  content_type?: string;
}

export interface StartActionParams {
  agentId: string;
  actionType: string;
  tenantId?: string | null;
  requestId: string;
  metadata?: Record<string, unknown>;
}

export interface TransitionParams {
  actionId: string;
  status: LedgerStatus;
  approvedBy?: string;
  approvalNote?: string;
  artifacts?: ArtifactRef[];
  metadata?: Record<string, unknown>;
  errorMessage?: string;
}

// ---------------------------------------------------------------------------
// Dedicated pool
// ---------------------------------------------------------------------------

function buildOrchestratorPool(): pg.Pool {
  const host = (process.env.DB_HOST || 'localhost').trim();
  const rawHost = host === 'localhost' || host === '127.0.0.1' ? '127.0.0.1' : host;
  const isRemote = rawHost !== '127.0.0.1';

  return new Pool({
    host: rawHost,
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.MANAGEMENT_DB_NAME || 'coheus_management',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    ssl: isRemote ? { rejectUnauthorized: false } : false,
    max: 5,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
    allowExitOnIdle: false,
  });
}

// Lazily initialised so the pool is not created during module load in test
// environments that set SKIP_DB=true.
let _pool: pg.Pool | null = null;

function getPool(): pg.Pool {
  if (!_pool) {
    _pool = buildOrchestratorPool();
    _pool.on('error', (err) => {
      logError('[AiOrchestrator] Pool error', err);
    });
  }
  return _pool;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Register the start of an AI-initiated action.
 *
 * This is the ONLY fail-closed call in the system.  If this write fails, the
 * caller MUST throw/propagate SecurityBoundaryViolation and halt the action.
 * Returns the new action_id (UUID) that must be threaded through all
 * subsequent lifecycle writes.
 */
export async function startAction(params: StartActionParams): Promise<string> {
  if (process.env.SKIP_DB === 'true') {
    // In local test mode without a DB, return a stable stub rather than failing
    // the entire test harness.  Guards/tests that need real DB behavior should
    // set up a test DB instead.
    return randomUUID();
  }

  const actionId = randomUUID();
  const pool = getPool();

  try {
    await pool.query(
      `INSERT INTO ai_control_plane.audit_ledger
         (action_id, request_id, agent_id, agent_sub_type, tenant_id, action_type, status, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, 'started', $7)`,
      [
        actionId,
        params.requestId,
        params.agentId,
        'ai_agent',
        params.tenantId ?? null,
        params.actionType,
        params.metadata ? JSON.stringify(params.metadata) : null,
      ],
    );

    logInfo('[AiOrchestrator] Action started', {
      requestId: params.requestId,
      actionId,
      actionType: params.actionType,
    });

    return actionId;
  } catch (err) {
    // Fail closed: surface as SecurityBoundaryViolation so callers cannot
    // accidentally swallow a DB write failure and proceed with the action.
    throw new SecurityBoundaryViolation(
      `Failed to register AI action in audit ledger (action: ${params.actionType}, request: ${params.requestId})`,
      err,
    );
  }
}

/**
 * Append a lifecycle transition to an existing ledger row.
 *
 * Unlike startAction, this is NOT fail-closed — a failed transition write is
 * logged as a warning but does not abort the action mid-flight to avoid
 * leaving partial state.  Callers should treat persistent transition failures
 * as an alert condition.
 */
export async function transitionAction(params: TransitionParams): Promise<void> {
  if (process.env.SKIP_DB === 'true') return;

  const pool = getPool();

  try {
    await pool.query(
      `UPDATE ai_control_plane.audit_ledger
          SET status       = $1,
              approved_by  = COALESCE($2, approved_by),
              approved_at  = CASE WHEN $1 = 'approved' THEN NOW() ELSE approved_at END,
              approval_note = COALESCE($3, approval_note),
              artifacts    = COALESCE($4::jsonb, artifacts),
              metadata     = COALESCE($5::jsonb, metadata),
              error_message = COALESCE($6, error_message)
        WHERE action_id = $7`,
      [
        params.status,
        params.approvedBy ?? null,
        params.approvalNote ?? null,
        params.artifacts ? JSON.stringify(params.artifacts) : null,
        params.metadata ? JSON.stringify(params.metadata) : null,
        params.errorMessage ?? null,
        params.actionId,
      ],
    );
  } catch (err) {
    logWarn('[AiOrchestrator] Failed to transition action status', {
      actionId: params.actionId,
      targetStatus: params.status,
    });
    logError('[AiOrchestrator] Transition error', err);
  }
}

/**
 * Look up the current status of an action by action_id.
 * Returns null if no matching row exists.
 */
export async function getActionStatus(actionId: string): Promise<LedgerStatus | null> {
  if (process.env.SKIP_DB === 'true') return null;

  const pool = getPool();

  try {
    const result = await pool.query<{ status: LedgerStatus }>(
      `SELECT status FROM ai_control_plane.audit_ledger WHERE action_id = $1 LIMIT 1`,
      [actionId],
    );
    return result.rows[0]?.status ?? null;
  } catch (err) {
    logError('[AiOrchestrator] Failed to fetch action status', err, { actionId });
    return null;
  }
}

/**
 * Fetch a full ledger row by action_id.
 * Returns null if no matching row exists or on DB error.
 */
export async function getAction(actionId: string): Promise<LedgerRow | null> {
  if (process.env.SKIP_DB === 'true') return null;

  const pool = getPool();

  try {
    const result = await pool.query<LedgerRow>(
      `SELECT * FROM ai_control_plane.audit_ledger WHERE action_id = $1 LIMIT 1`,
      [actionId],
    );
    return result.rows[0] ?? null;
  } catch (err) {
    logError('[AiOrchestrator] Failed to fetch action', err, { actionId });
    return null;
  }
}

/**
 * Gracefully close the dedicated orchestrator pool.
 * Call during server shutdown to drain open connections.
 */
export async function closeOrchestratorPool(): Promise<void> {
  if (_pool) {
    await _pool.end();
    _pool = null;
  }
}
