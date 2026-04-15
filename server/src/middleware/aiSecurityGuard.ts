/**
 * AI Security Guard middleware
 *
 * Intercepts mutating requests (POST, PUT, PATCH, DELETE) made by AI agent
 * identities and enforces the approval-gating contract from the AI control
 * plane before the route handler runs.
 *
 * Placement: register this AFTER authenticateToken (which resolves req.isAiAgent
 * and req.aiActionId) but BEFORE mutating route handlers.  Do NOT replace or
 * wrap the existing canvas-only guard in server/src/routes/index.ts — these are
 * independent policy layers.
 *
 * Fail-closed rules for AI-initiated mutations:
 *   1. X-AI-Action-Id header is missing         → 403
 *   2. action_id is not found in audit_ledger   → 403
 *   3. action status is not "approved"          → 403
 *   4. DB lookup error (cannot confirm status)  → 403 (fail closed, not 500)
 *
 * Read-only requests (GET, HEAD, OPTIONS) from AI agents pass through without
 * approval gating because they carry no mutation risk.
 */

import { Response, NextFunction } from 'express';
import { type AuthRequest } from './auth.js';
import { getActionStatus } from '../services/aiAgentOrchestrator.js';
import { logWarn } from '../services/logger.js';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export async function aiSecurityGuard(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  // Only intercept requests from verified AI agent identities on mutating methods.
  if (!req.isAiAgent || !MUTATING_METHODS.has(req.method.toUpperCase())) {
    return next();
  }

  const actionId = req.aiActionId;

  if (!actionId) {
    logWarn('[AiSecurityGuard] Mutating AI request missing X-AI-Action-Id', {
      requestId: req.id,
      method: req.method,
      path: req.path,
    });
    res.status(403).json({
      error: 'Forbidden',
      message: 'AI-initiated mutating requests require X-AI-Action-Id header.',
      code: 'AI_MISSING_ACTION_ID',
    });
    return;
  }

  let status: string | null = null;

  try {
    status = await getActionStatus(actionId);
  } catch {
    // Treat any unexpected error as a fail-closed deny.
  }

  if (status !== 'approved') {
    logWarn('[AiSecurityGuard] AI mutating request blocked — action not approved', {
      requestId: req.id,
      actionId,
      status: status ?? 'not_found',
      method: req.method,
      path: req.path,
    });
    res.status(403).json({
      error: 'Forbidden',
      message: `AI action ${actionId} is not in approved state (current: ${status ?? 'not_found'}).`,
      code: 'AI_ACTION_NOT_APPROVED',
      actionId,
    });
    return;
  }

  return next();
}
