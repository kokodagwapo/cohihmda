/**
 * Unified chat policy (COHI-389).
 * Mode-aware matrix; meeting spec §10 #14 — no extra entitlements vs cohi_chat.
 */

import type { AuthRequest } from "../../middleware/auth.js";
import {
  checkSectionAccess,
  type QueryContext,
} from "../ai/queryBuilderService.js";
import type { UnifiedConversationChatType } from "./unifiedConversationService.js";

export type UnifiedChatSurface =
  | "site"
  | "workbench_canvas"
  | "workbench_hub"
  | "insight_modal"
  | "data_chat_page";

export type UnifiedScopeType =
  | "global_session"
  | "canvas"
  | "draft"
  | "insight"
  | "widget_edit"
  | "workbench_hub";

export interface UnifiedChatPolicyInput {
  surface?: UnifiedChatSurface;
  scopeType?: UnifiedScopeType;
  chatType?: UnifiedConversationChatType;
  deepAnalysis?: boolean;
}

export interface PolicyDecision {
  allowed: boolean;
  code?: string;
  message?: string;
  decisionId: string;
  chatType: UnifiedConversationChatType;
  /** Knowledge retrieval gate (COHI-391). */
  retrieval: "allow" | "deny";
  /** SQL execution posture for this mode (COHI-392). */
  sqlExecution: "allow" | "deny" | "scoped";
  research?: {
    quotasEnforced: boolean;
    deepAnalysisAllowed: boolean;
    /** Numeric caps TBD — structure only in Wave 2. */
    caps?: Record<string, number | null>;
  };
}

/** Allowed first URL path segments for in-app navigation links (see App.tsx routes). */
const ALLOWED_APP_PATH_ROOTS = new Set([
  "insights",
  "research",
  "workbench",
  "my-dashboard",
  "loans",
  "data-chat",
  "help",
  "settings",
  "feedback",
  "admin",
  "subscription",
  "performance",
  "company-scorecard",
  "business-overview",
  "leaderboard",
  "production-trends",
  "workflow-conversion",
  "lock-stratification",
  "pipeline-analysis",
  "loan-detail",
  "fallout-forecast",
  "pricing-dashboard",
  "data-quality",
  "loan-complexity",
  "high-performers",
  "actors",
  "credit-risk-management",
  "sales-scorecard",
  "sales-company-overview",
  "sales-trends",
  "production-summary-by-week",
  "sales-scorecard-overview",
  "capture-analysis",
  "loan-funnel",
  "top-tiering-comparison",
  "landing",
  "login",
  "forgot-password",
  "reset-password",
  "auth",
  "unsubscribe",
]);

const NAV_HINT_PREFIXES = [
  "/insights",
  "/research",
  "/workbench",
  "/dashboard",
  "/data-chat",
  "/help",
];

function firstPathSegment(path: string): string | null {
  const trimmed = path.trim();
  const withoutLeading = trimmed.startsWith("/") ? trimmed.slice(1) : trimmed;
  const seg = withoutLeading.split(/[/?#]/)[0];
  return seg || null;
}

function isAllowedAppNavigationPath(p: string): boolean {
  const seg = firstPathSegment(p);
  if (!seg) return false;
  return ALLOWED_APP_PATH_ROOTS.has(seg);
}

export function sanitizeNavigationHints(
  hints: { label: string; path: string }[] | undefined,
): { label: string; path: string }[] {
  if (!hints?.length) return [];
  const out: { label: string; path: string }[] = [];
  for (const h of hints) {
    if (!h?.path || typeof h.path !== "string") continue;
    const p = h.path.trim();
    if (!p.startsWith("/")) continue;
    if (p.startsWith("//")) continue;
    const legacyOk = NAV_HINT_PREFIXES.some(
      (prefix) =>
        p === prefix ||
        p.startsWith(`${prefix}/`) ||
        p.startsWith(`${prefix}?`),
    );
    if (legacyOk || isAllowedAppNavigationPath(p)) {
      out.push({ label: h.label || "Open", path: p });
    }
  }
  return out;
}

function buildQueryContext(req: AuthRequest): QueryContext {
  const tenantId = req.tenantContext?.tenantId || req.tenantId;
  if (!tenantId) {
    throw new Error("No tenant context available");
  }
  return {
    userId: req.userId!,
    tenantId,
    userRole: req.userRole || "user",
    userEmail: req.userEmail,
  };
}

function normalizeChatType(input?: UnifiedConversationChatType): UnifiedConversationChatType {
  if (
    input === "research" ||
    input === "insight_builder" ||
    input === "workbench" ||
    input === "chat"
  ) {
    return input;
  }
  return "chat";
}

function buildModeDecision(
  chatType: UnifiedConversationChatType,
  deepAnalysis?: boolean,
): Pick<PolicyDecision, "sqlExecution" | "research" | "retrieval"> {
  const research = {
    quotasEnforced: chatType === "research",
    deepAnalysisAllowed: chatType === "research",
    caps: {
      maxConcurrentSessions: null,
      maxTokensPerDay: null,
    } as Record<string, number | null>,
  };
  switch (chatType) {
    case "workbench":
      return { sqlExecution: "scoped", retrieval: "allow", research: undefined };
    case "research":
      return {
        sqlExecution: "scoped",
        retrieval: "allow",
        research: { ...research, deepAnalysisAllowed: !!deepAnalysis || true },
      };
    case "insight_builder":
      return { sqlExecution: "deny", retrieval: "deny", research: undefined };
    default:
      return { sqlExecution: "allow", retrieval: "allow", research: undefined };
  }
}

export async function evaluateUnifiedChatPolicy(
  req: AuthRequest,
  input: UnifiedChatPolicyInput,
): Promise<PolicyDecision> {
  const chatType = normalizeChatType(input.chatType);
  const decisionId = `pol_${chatType}_${Date.now()}`;
  const mode = buildModeDecision(chatType, input.deepAnalysis);

  try {
    const ctx = buildQueryContext(req);
    const allowed = await checkSectionAccess("cohi_chat", ctx);
    if (!allowed) {
      return {
        allowed: false,
        code: "cohi_chat_forbidden",
        message: "You don't have access to Cohi Chat",
        decisionId,
        chatType,
        retrieval: "deny",
        sqlExecution: "deny",
      };
    }

    if (input.deepAnalysis && chatType !== "research") {
      return {
        allowed: false,
        code: "deep_analysis_research_only",
        message: "Deep analysis is only available in Research mode",
        decisionId,
        chatType,
        retrieval: "deny",
        sqlExecution: "deny",
      };
    }

    return {
      allowed: true,
      decisionId,
      chatType,
      ...mode,
    };
  } catch (e: any) {
    return {
      allowed: false,
      code: "policy_error",
      message: e?.message || "Policy check failed",
      decisionId,
      chatType,
      retrieval: "deny",
      sqlExecution: "deny",
    };
  }
}

export async function assertUnifiedChatAllowed(
  req: AuthRequest,
  input: UnifiedChatPolicyInput,
): Promise<{ ok: true; decision: PolicyDecision } | { ok: false; code: string; message: string }> {
  const decision = await evaluateUnifiedChatPolicy(req, input);
  if (!decision.allowed) {
    return {
      ok: false,
      code: decision.code ?? "policy_denied",
      message: decision.message ?? "Policy denied",
    };
  }
  return { ok: true, decision };
}

export interface UnifiedChatPermissionsPayload {
  cohiChat: boolean;
  chatTypes: UnifiedConversationChatType[];
  policy?: {
    modes: Record<
      UnifiedConversationChatType,
      { allowed: boolean; sqlExecution: string; deepAnalysis?: boolean }
    >;
    researchQuotasTbd: boolean;
  };
}

export async function buildUnifiedChatPermissions(
  req: AuthRequest,
): Promise<UnifiedChatPermissionsPayload> {
  const base = await evaluateUnifiedChatPolicy(req, { chatType: "chat" });
  const types: UnifiedConversationChatType[] = base.allowed
    ? ["chat", "research", "insight_builder", "workbench"]
    : [];

  const modes: Record<
    UnifiedConversationChatType,
    { allowed: boolean; sqlExecution: string; deepAnalysis?: boolean }
  > = {
    chat: { allowed: false, sqlExecution: "deny" },
    research: { allowed: false, sqlExecution: "deny" },
    insight_builder: { allowed: false, sqlExecution: "deny" },
    workbench: { allowed: false, sqlExecution: "deny" },
  };
  for (const t of types) {
    const d = await evaluateUnifiedChatPolicy(req, { chatType: t });
    modes[t] = {
      allowed: d.allowed,
      sqlExecution: d.sqlExecution,
      ...(t === "research" ? { deepAnalysis: true } : {}),
    };
  }

  return {
    cohiChat: base.allowed,
    chatTypes: types,
    policy: {
      modes,
      researchQuotasTbd: true,
    },
  };
}

/**
 * Platform tenant_id usage — only platform staff roles (Appendix A.3).
 */
export function assertPlatformTenantScope(
  req: AuthRequest,
  requestedTenantId: string,
): { ok: true } | { ok: false; code: string; message: string } {
  const ctxTenant = req.tenantContext?.tenantId || req.tenantId;
  if (requestedTenantId === ctxTenant) return { ok: true };
  if (req.isSuperAdmin || req.userRole === "admin") {
    return { ok: true };
  }
  return {
    ok: false,
    code: "tenant_scope_forbidden",
    message: "Cross-tenant access denied",
  };
}
