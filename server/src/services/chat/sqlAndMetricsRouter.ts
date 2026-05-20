/**
 * Unified SQL / metrics gate (COHI-392).
 * Central hook before SQL execution on chat, workbench, and research paths.
 */

import type { AuthRequest } from "../../middleware/auth.js";
import type { PolicyDecision } from "./unifiedChatPolicy.js";

export interface SqlExecutionContext {
  source: "unified_chat" | "workbench" | "research_lab";
  chatType?: string;
  tenantId: string;
  userId: string;
}

export interface SqlRouterResult<T> {
  ok: true;
  value: T;
}

export interface SqlRouterError {
  ok: false;
  code: string;
  message: string;
  clientMessage: string;
}

/**
 * Policy gate — execution must not proceed when policy denies.
 */
export function assertSqlAllowedByPolicy(
  decision: PolicyDecision,
): SqlRouterResult<PolicyDecision> | SqlRouterError {
  if (!decision.allowed) {
    return {
      ok: false,
      code: decision.code ?? "sql_forbidden",
      message: decision.message ?? "SQL execution not allowed",
      clientMessage:
        "I can't run that data query with your current permissions. Try rephrasing or ask your admin about Cohi Chat access.",
    };
  }
  if (decision.sqlExecution === "deny") {
    return {
      ok: false,
      code: "sql_mode_denied",
      message: "SQL execution denied for this chat mode",
      clientMessage: "This mode doesn't support direct SQL execution for that request.",
    };
  }
  return { ok: true, value: decision };
}

/**
 * Wrap legacy SQL execution with a consistent error surface for assistants.
 */
export async function runSqlThroughRouter<T>(
  ctx: SqlExecutionContext,
  decision: PolicyDecision,
  execute: () => Promise<T>,
): Promise<T> {
  const gate = assertSqlAllowedByPolicy(decision);
  if (gate.ok === false) {
    const err: any = new Error(gate.clientMessage);
    err.statusCode = 403;
    err.code = gate.code;
    err.metadata = { source: ctx.source, chatType: ctx.chatType };
    throw err;
  }
  try {
    return await execute();
  } catch (e: any) {
    const err: any = new Error(
      "I couldn't complete that data query safely. Try narrowing the question or contact support if this persists.",
    );
    err.statusCode = 500;
    err.code = "sql_execution_error";
    err.internalMessage = e?.message;
    err.metadata = { source: ctx.source };
    throw err;
  }
}

/**
 * Documented bypass list — shrink over time (COHI-392 AC2).
 *
 * Wave 3 lock (#4): match existing research coverage; new DB access introduced
 * in this wave passes through `runSqlThroughRouter`. The per-question SQL run
 * by `dataAnalystAgent` is *existing* coverage and is gated at the pipeline
 * boundary in `unifiedResearchChat.ts` / `unifiedResearchStream.ts` via
 * `assertSqlAllowedByPolicy` before the pipeline is kicked off.
 */
export const SQL_ROUTER_KNOWN_BYPASS_PATHS = [
  "metricsAiService (standalone metrics UI — not unified v1)",
  "onboardingAnalysisAgent (onboarding only)",
] as const;
