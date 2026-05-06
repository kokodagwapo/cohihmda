/**
 * Unified chat policy (COHI-389 baseline).
 * Aligns global + workbench assistant behind checkSectionAccess('cohi_chat').
 */

import type { AuthRequest } from "../../middleware/auth.js";
import {
  checkSectionAccess,
  type QueryContext,
} from "../ai/queryBuilderService.js";

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
}

/** Allowed path prefixes for navigation_hints (Appendix A.2). */
const NAV_HINT_PREFIXES = [
  "/insights",
  "/research",
  "/workbench",
  "/dashboard",
  "/data-chat",
  "/help",
];

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
    const ok = NAV_HINT_PREFIXES.some((prefix) => p === prefix || p.startsWith(`${prefix}/`) || p.startsWith(`${prefix}?`));
    if (ok) out.push({ label: h.label || "Open", path: p });
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

/**
 * Returns false if the user may not use unified chat for this tenant.
 * Workbench surfaces use the same gate as global chat for parity (architecture Appendix A).
 */
export async function assertUnifiedChatAllowed(
  req: AuthRequest,
  _input: UnifiedChatPolicyInput,
): Promise<{ ok: true } | { ok: false; code: string; message: string }> {
  try {
    const ctx = buildQueryContext(req);
    const allowed = await checkSectionAccess("cohi_chat", ctx);
    if (!allowed) {
      return {
        ok: false,
        code: "cohi_chat_forbidden",
        message: "You don't have access to Cohi Chat",
      };
    }
    return { ok: true };
  } catch (e: any) {
    return {
      ok: false,
      code: "policy_error",
      message: e?.message || "Policy check failed",
    };
  }
}
