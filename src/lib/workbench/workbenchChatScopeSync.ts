/**
 * Workbench chat ↔ active canvas tab scope coupling (COHI-398 follow-up).
 * Feature flag: VITE_WORKBENCH_CHAT_SCOPE_SYNC=true or localStorage/sessionStorage overrides.
 */

import type { WidgetAction } from "@/types/widgetActions";
import { draftScopeIdForCanvasTab } from "@/lib/workbench/workbenchChatHandoff";

const FLAG_ENV_KEY = "VITE_WORKBENCH_CHAT_SCOPE_SYNC";
const FLAG_STORAGE_KEY = "cohi_workbench_chat_scope_sync";
const CONVERSATION_SCOPE_STORAGE_KEY = "cohi_workbench_conversation_scope";

export const COHI_WORKBENCH_ACTIVE_CONTEXT_EVENT =
  "cohi-workbench-active-context";

export const COHI_WORKBENCH_REQUEST_NEW_TAB_EVENT =
  "cohi-workbench-request-new-tab";

export const COHI_WORKBENCH_NEW_TAB_READY_EVENT = "cohi-workbench-new-tab-ready";

export const COHI_WORKBENCH_SCOPE_MISMATCH_ACTIONS_EVENT =
  "cohi-workbench-scope-mismatch-actions";

export interface WorkbenchActiveContext {
  tabId: string;
  canvasId: string | null;
  draftScopeId: string;
  tabTitle: string;
  isSavedCanvas: boolean;
}

export interface WorkbenchChatScopeRef {
  type: "canvas" | "draft";
  id: string;
  label?: string;
}

export interface WorkbenchRequestNewTabDetail {
  requestId: string;
}

export interface WorkbenchNewTabReadyDetail {
  requestId: string;
  context: WorkbenchActiveContext;
}

export interface WorkbenchScopeMismatchActionsDetail {
  actions: WidgetAction[];
  conversationScope: WorkbenchChatScopeRef;
  draftScopeId: string;
  conversationId: string | null;
}

let latestActiveContext: WorkbenchActiveContext | null = null;

function isForceUnifiedChatEnabledInStorage(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return (
      window.sessionStorage?.getItem("cohi_force_unified_chat") === "1" ||
      window.localStorage?.getItem("cohi_force_unified_chat") === "1"
    );
  } catch {
    return false;
  }
}

export function isWorkbenchChatScopeSyncEnabled(): boolean {
  if (typeof window !== "undefined") {
    try {
      if (window.sessionStorage?.getItem(FLAG_STORAGE_KEY) === "0") {
        return false;
      }
      if (isForceUnifiedChatEnabledInStorage()) {
        return true;
      }
      if (
        window.sessionStorage?.getItem(FLAG_STORAGE_KEY) === "1" ||
        window.localStorage?.getItem(FLAG_STORAGE_KEY) === "1"
      ) {
        return true;
      }
    } catch {
      /* ignore */
    }
  }
  try {
    return import.meta.env[FLAG_ENV_KEY] === "true";
  } catch {
    return false;
  }
}

export function getLatestWorkbenchActiveContext(): WorkbenchActiveContext | null {
  return latestActiveContext;
}

export function activeContextToScopeRef(
  ctx: WorkbenchActiveContext,
): WorkbenchChatScopeRef {
  if (ctx.isSavedCanvas && ctx.canvasId) {
    return { type: "canvas", id: ctx.canvasId, label: ctx.tabTitle };
  }
  return { type: "draft", id: ctx.draftScopeId, label: ctx.tabTitle };
}

export function persistWorkbenchConversationScope(
  scope: WorkbenchChatScopeRef | null,
): void {
  if (typeof window === "undefined") return;
  try {
    if (!scope) {
      window.sessionStorage.removeItem(CONVERSATION_SCOPE_STORAGE_KEY);
      return;
    }
    window.sessionStorage.setItem(
      CONVERSATION_SCOPE_STORAGE_KEY,
      JSON.stringify(scope),
    );
  } catch {
    /* ignore */
  }
}

export function readPersistedWorkbenchConversationScope(): WorkbenchChatScopeRef | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(CONVERSATION_SCOPE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as WorkbenchChatScopeRef;
    if (
      parsed &&
      (parsed.type === "canvas" || parsed.type === "draft") &&
      typeof parsed.id === "string"
    ) {
      return parsed;
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function clearPersistedWorkbenchConversationScope(): void {
  persistWorkbenchConversationScope(null);
}

export function scopeRefsEqual(
  a: WorkbenchChatScopeRef | null | undefined,
  b: WorkbenchChatScopeRef | null | undefined,
): boolean {
  if (!a || !b) return false;
  return a.type === b.type && a.id === b.id;
}

export function buildActiveContextFromTab(args: {
  tabId: string;
  tabTitle: string;
  tabDraftScopes: Record<string, string>;
}): WorkbenchActiveContext {
  const { tabId, tabTitle, tabDraftScopes } = args;
  const isSavedCanvas = !tabId.startsWith("new-");
  const canvasId = isSavedCanvas ? tabId : null;
  const draftScopeId = isSavedCanvas
    ? draftScopeIdForCanvasTab(tabId)
    : tabDraftScopes[tabId] ?? draftScopeIdForCanvasTab(tabId);
  return {
    tabId,
    canvasId,
    draftScopeId,
    tabTitle,
    isSavedCanvas,
  };
}

export function dispatchWorkbenchActiveContext(
  context: WorkbenchActiveContext,
): void {
  latestActiveContext = context;
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(COHI_WORKBENCH_ACTIVE_CONTEXT_EVENT, { detail: context }),
  );
}

/** Explicit phrases for confirm-first new canvas flow. */
export function detectNewCanvasIntent(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  if (!normalized) return false;
  const patterns = [
    /\bnew\s+canvas\b/,
    /\bseparate\s+canvas\b/,
    /\bdifferent\s+canvas\b/,
    /\banother\s+canvas\b/,
    /\bon\s+a\s+new\s+(?:dashboard|board)\b/,
    /\bnew\s+(?:dashboard|board)\b/,
  ];
  return patterns.some((re) => re.test(normalized));
}

export function isWorkbenchScopeAlignedWithActiveTab(
  conversationScope: WorkbenchChatScopeRef | null | undefined,
): boolean {
  if (!conversationScope || !latestActiveContext) return true;
  return scopeRefsEqual(
    conversationScope,
    activeContextToScopeRef(latestActiveContext),
  );
}

export function requestWorkbenchNewCanvasTab(): Promise<WorkbenchActiveContext> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined") {
      reject(new Error("requestWorkbenchNewCanvasTab requires window"));
      return;
    }
    const requestId =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}`;
    const timeout = window.setTimeout(() => {
      window.removeEventListener(COHI_WORKBENCH_NEW_TAB_READY_EVENT, onReady);
      reject(new Error("New canvas tab request timed out"));
    }, 15000);

    const onReady = (e: Event) => {
      const detail = (e as CustomEvent<WorkbenchNewTabReadyDetail>).detail;
      if (!detail || detail.requestId !== requestId) return;
      window.clearTimeout(timeout);
      window.removeEventListener(COHI_WORKBENCH_NEW_TAB_READY_EVENT, onReady);
      latestActiveContext = detail.context;
      resolve(detail.context);
    };

    window.addEventListener(COHI_WORKBENCH_NEW_TAB_READY_EVENT, onReady);
    window.dispatchEvent(
      new CustomEvent<WorkbenchRequestNewTabDetail>(
        COHI_WORKBENCH_REQUEST_NEW_TAB_EVENT,
        { detail: { requestId } },
      ),
    );
  });
}

export type WorkbenchScopeSyncTelemetryEvent =
  | "scope_switch_prompt_shown"
  | "scope_switch_confirmed"
  | "scope_switch_cancelled"
  | "new_canvas_intent_prompt_shown"
  | "new_canvas_intent_confirmed"
  | "new_canvas_intent_cancelled"
  | "action_apply_blocked_mismatch"
  | "action_apply_mismatch_resolved_active"
  | "action_apply_mismatch_resolved_conversation";

const telemetryCounts: Record<string, number> = {};

export function trackWorkbenchScopeSyncEvent(
  event: WorkbenchScopeSyncTelemetryEvent,
  props?: Record<string, unknown>,
): void {
  telemetryCounts[event] = (telemetryCounts[event] ?? 0) + 1;
  if (import.meta.env.DEV) {
    console.debug("[WorkbenchScopeSync]", event, props ?? {});
  }
}

export function getWorkbenchScopeSyncTelemetryCounts(): Record<string, number> {
  return { ...telemetryCounts };
}

export function dispatchWorkbenchScopeMismatchActions(
  detail: WorkbenchScopeMismatchActionsDetail,
): void {
  if (typeof window === "undefined") return;
  trackWorkbenchScopeSyncEvent("action_apply_blocked_mismatch", {
    conversationType: detail.conversationScope.type,
  });
  window.dispatchEvent(
    new CustomEvent(COHI_WORKBENCH_SCOPE_MISMATCH_ACTIONS_EVENT, {
      detail,
    }),
  );
}
