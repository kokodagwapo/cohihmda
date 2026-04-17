/**
 * AI Audit Ledger Client (pipeline-aware)
 *
 * Used by the pipeline-side AC validator instead of importing
 * `aiAgentOrchestrator` directly. The orchestrator opens a dedicated pg pool
 * to the management database; that is fine when the caller runs inside the
 * backend process but fails with ECONNREFUSED when the same code is invoked
 * from a Bitbucket runner where there is no local database.
 *
 * Transport resolution:
 *   - If `QA_LEDGER_BACKEND_URL` is set, HMAC-POST to
 *     `${QA_LEDGER_BACKEND_URL}/api/internal/ai-ledger/(start|transition)`
 *     using the same `X-QA-Runner-Key` + `X-QA-Timestamp` + `X-QA-Signature`
 *     contract as `/api/internal/qa-run`.
 *   - Otherwise fall back to calling the in-process orchestrator.
 *
 * The fallback is what server-side tests and local invocations rely on, so
 * this module deliberately does not throw if the HTTP envs are missing — it
 * only switches transports.
 */

import { createHmac } from "crypto";
import {
  startAction as directStartAction,
  transitionAction as directTransitionAction,
  SecurityBoundaryViolation,
  type LedgerStatus,
  type StartActionParams,
  type TransitionParams,
} from "../../../src/services/aiAgentOrchestrator.js";

// Re-exported so callers can keep using the same symbol surface as before.
export { SecurityBoundaryViolation };
export type { LedgerStatus, StartActionParams, TransitionParams };

function getBackendBaseUrl(): string | null {
  const raw = process.env.QA_LEDGER_BACKEND_URL;
  if (!raw || raw.trim().length === 0) return null;
  return raw.replace(/\/$/, "");
}

function getHmacCredentials(): { apiKey: string; hmacSecret: string } | null {
  const apiKey = process.env.QA_RUNNER_API_KEY;
  const hmacSecret = process.env.QA_RUNNER_HMAC_SECRET;
  if (!apiKey || !hmacSecret) return null;
  return { apiKey, hmacSecret };
}

async function signedFetch(url: string, body: unknown): Promise<Response> {
  const creds = getHmacCredentials();
  if (!creds) {
    throw new SecurityBoundaryViolation(
      "QA_LEDGER_BACKEND_URL is set but QA_RUNNER_API_KEY / QA_RUNNER_HMAC_SECRET are not — refusing to call the audit ledger without HMAC credentials",
    );
  }
  const rawBody = JSON.stringify(body);
  const timestamp = String(Date.now());
  const signature = createHmac("sha256", creds.hmacSecret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");

  return fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-QA-Runner-Key": creds.apiKey,
      "X-QA-Timestamp": timestamp,
      "X-QA-Signature": signature,
    },
    body: rawBody,
  });
}

export async function startAction(params: StartActionParams): Promise<string> {
  const baseUrl = getBackendBaseUrl();
  if (!baseUrl) {
    return directStartAction(params);
  }

  const resp = await signedFetch(`${baseUrl}/api/internal/ai-ledger/start`, {
    agentId: params.agentId,
    actionType: params.actionType,
    tenantId: params.tenantId ?? null,
    requestId: params.requestId,
    metadata: params.metadata,
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new SecurityBoundaryViolation(
      `Failed to register AI action via audit ledger proxy (action: ${params.actionType}, request: ${params.requestId}, status: ${resp.status}): ${text.slice(0, 500)}`,
    );
  }

  const json: unknown = await resp.json().catch(() => ({}));
  const actionId =
    json && typeof json === "object" && "actionId" in json
      ? String((json as { actionId?: unknown }).actionId ?? "")
      : "";
  if (!actionId) {
    throw new SecurityBoundaryViolation(
      `Audit ledger proxy returned success but no actionId (action: ${params.actionType}, request: ${params.requestId})`,
    );
  }
  return actionId;
}

export async function transitionAction(params: TransitionParams): Promise<void> {
  const baseUrl = getBackendBaseUrl();
  if (!baseUrl) {
    return directTransitionAction(params);
  }

  const resp = await signedFetch(`${baseUrl}/api/internal/ai-ledger/transition`, {
    actionId: params.actionId,
    status: params.status,
    approvedBy: params.approvedBy,
    approvalNote: params.approvalNote,
    artifacts: params.artifacts,
    metadata: params.metadata,
    errorMessage: params.errorMessage,
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    // Intentionally non-fatal: the in-process orchestrator treats transition
    // failures the same way. We still log via console.warn so the pipeline
    // surfaces the issue without masking it.
    console.warn(
      `[AiLedgerClient] transition ${params.status} for ${params.actionId} failed (${resp.status}): ${text.slice(0, 300)}`,
    );
  }
}
