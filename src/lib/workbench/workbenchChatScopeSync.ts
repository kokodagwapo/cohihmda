/**
 * Workbench chat ↔ active canvas tab scope coupling (COHI-398 follow-up).
 * On whenever unified chat is on. Set VITE_WORKBENCH_CHAT_SCOPE_SYNC=false to disable.
 */

import type { WidgetAction } from "@/types/widgetActions";
import { isUnifiedChatClientEnabled } from "@/lib/unifiedChatEnvelope";
import { getWorkbenchCanvasBridge } from "@/lib/workbench/workbenchCanvasBridge";
import {
  draftScopeIdForCanvasTab,
  getConnectedWorkbenchCanvasId,
  getOrCreateActiveWorkbenchDraftScope,
  lookupWorkbenchDraftTab,
} from "@/lib/workbench/workbenchChatHandoff";
import { getWorkbenchCanvasIdForDraft } from "@/lib/workbench/workbenchCanvasBridge";

const FLAG_ENV_KEY = "VITE_WORKBENCH_CHAT_SCOPE_SYNC";
const CONVERSATION_SCOPE_STORAGE_KEY = "cohi_workbench_conversation_scope";

export const COHI_WORKBENCH_ACTIVE_CONTEXT_EVENT =
  "cohi-workbench-active-context";

export const COHI_WORKBENCH_REQUEST_NEW_TAB_EVENT =
  "cohi-workbench-request-new-tab";

export const COHI_WORKBENCH_NEW_TAB_READY_EVENT = "cohi-workbench-new-tab-ready";

export const COHI_WORKBENCH_SCOPE_MISMATCH_ACTIONS_EVENT =
  "cohi-workbench-scope-mismatch-actions";

/** Fired when a canvas is created or updated on the server (auto-save, manual save, research). */
export const WORKBENCH_CANVAS_SAVED_EVENT = "workbench:canvas-saved";

export type WorkbenchCanvasSavedDetail = {
  canvasId: string;
  title?: string;
  /** Greenfield draft scope id before first save (used to promote chat scope). */
  draftScopeId?: string;
};

export interface WorkbenchActiveContext {
  tabId: string;
  canvasId: string | null;
  draftScopeId: string;
  tabTitle: string;
  isSavedCanvas: boolean;
}

export interface SyncWorkbenchContextOptions {
  /** When false, bind scope only — do not load the latest thread (new canvas handoff). */
  loadLatestThread?: boolean;
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

/** Suppress scope-switch prompts (e.g. Edit with Cohi on the active canvas). */
let suppressScopePromptCount = 0;

export function suppressNextWorkbenchScopePrompt(count = 1): void {
  suppressScopePromptCount += Math.max(1, count);
}

export function consumeWorkbenchScopePromptSuppression(): boolean {
  if (suppressScopePromptCount <= 0) return false;
  suppressScopePromptCount -= 1;
  return true;
}

/** While opening a greenfield canvas tab from chat, skip mismatch prompts and align scope. */
let newCanvasHandoffActive = false;

export function beginWorkbenchNewCanvasHandoff(): void {
  newCanvasHandoffActive = true;
}

export function endWorkbenchNewCanvasHandoff(): void {
  newCanvasHandoffActive = false;
}

export function isWorkbenchNewCanvasHandoffActive(): boolean {
  return newCanvasHandoffActive;
}

export function scopeRefKey(scope: WorkbenchChatScopeRef): string {
  return `${scope.type}:${scope.id}`;
}

export function isWorkbenchChatScopeSyncEnabled(): boolean {
  if (!isUnifiedChatClientEnabled()) {
    return false;
  }
  try {
    if (import.meta.env[FLAG_ENV_KEY] === "false") {
      return false;
    }
  } catch {
    /* ignore */
  }
  return true;
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

/**
 * True when a persisted conversation scope belongs to the active canvas tab.
 * Saved canvases may use either `canvas` or `canvas-tab:*` draft scope keys.
 */
/**
 * Resolve API scope for the next workbench turn from the active tab (not a stale mounted canvas).
 */
export function resolveWorkbenchTurnScope(
  workbenchSavedCanvasId: string | null,
): {
  draftScopeId: string;
  scopeRef: WorkbenchChatScopeRef;
} {
  const activeCtx = getLatestWorkbenchActiveContext();
  if (activeCtx) {
    return {
      draftScopeId: activeCtx.draftScopeId,
      scopeRef: activeContextToScopeRef(activeCtx),
    };
  }

  const draftScopeId = getOrCreateActiveWorkbenchDraftScope();
  const bridge = getWorkbenchCanvasBridge();
  const connectedCanvasId = getConnectedWorkbenchCanvasId();
  const canvasId =
    workbenchSavedCanvasId ??
    connectedCanvasId ??
    (bridge?.isActive ? bridge.canvasId : null) ??
    getWorkbenchCanvasIdForDraft(draftScopeId);

  if (canvasId) {
    return {
      draftScopeId: draftScopeIdForCanvasTab(canvasId),
      scopeRef: { type: "canvas", id: canvasId },
    };
  }
  return {
    draftScopeId,
    scopeRef: { type: "draft", id: draftScopeId },
  };
}

/** Unsaved workbench tab (UI "+" new canvas) — chat should follow without a switch dialog. */
export function isGreenfieldWorkbenchTab(ctx: WorkbenchActiveContext): boolean {
  return !ctx.isSavedCanvas;
}

export function workbenchScopeMatchesActiveContext(
  scope: WorkbenchChatScopeRef,
  ctx: WorkbenchActiveContext,
): boolean {
  const active = activeContextToScopeRef(ctx);
  if (scopeRefsEqual(scope, active)) return true;
  if (!ctx.isSavedCanvas || !ctx.canvasId) return false;
  if (scope.type === "canvas" && scope.id === ctx.canvasId) return true;
  if (scope.type === "draft" && scope.id === ctx.draftScopeId) return true;
  // Conversation still on greenfield draft scope after tab promoted to saved canvas.
  if (scope.type === "draft") {
    const tabForDraft = lookupWorkbenchDraftTab(scope.id);
    if (tabForDraft === ctx.tabId) return true;
  }
  return false;
}

/** True when chat should follow the same thread after first save (draft → canvas rebind). */
export function shouldPromoteWorkbenchChatScopeOnCanvasSave(
  detail: WorkbenchCanvasSavedDetail,
  conversationScope: WorkbenchChatScopeRef | null,
): boolean {
  if (!detail.canvasId || !detail.draftScopeId) return false;
  const activeDraft = getOrCreateActiveWorkbenchDraftScope();
  if (detail.draftScopeId === activeDraft) return true;
  if (
    conversationScope?.type === "draft" &&
    conversationScope.id === detail.draftScopeId
  ) {
    return true;
  }
  return false;
}

export function buildWorkbenchChatScopeAfterCanvasSave(
  detail: WorkbenchCanvasSavedDetail,
): WorkbenchChatScopeRef {
  return {
    type: "canvas",
    id: detail.canvasId,
    label: detail.title,
  };
}

export function dispatchWorkbenchCanvasSaved(
  detail: WorkbenchCanvasSavedDetail,
  options?: { suppressScopePrompt?: boolean },
): void {
  if (typeof window === "undefined") return;
  if (options?.suppressScopePrompt !== false) {
    suppressNextWorkbenchScopePrompt(8);
  }
  window.dispatchEvent(
    new CustomEvent(WORKBENCH_CANVAS_SAVED_EVENT, { detail }),
  );
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

/** Greenfield layout prompts (default starters) that should not silently reuse a populated canvas. */
export function detectGreenfieldWorkbenchPrompt(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  if (!normalized) return false;
  const patterns = [
    /\bboard[- ]?ready\b/,
    /\bbuild\s+(?:an?\s+)?(?:executive\s+)?dashboard\b/,
    /\bprepare\s+(?:a\s+)?(?:board|dashboard)\b/,
    /\bcreate\s+(?:a\s+)?(?:new\s+)?(?:dashboard|board)\b/,
    /\bnew\s+canvas\b/,
    /\bseparate\s+canvas\b/,
    /\bdifferent\s+canvas\b/,
    /\banother\s+canvas\b/,
    /\bon\s+a\s+new\s+(?:dashboard|board|canvas)\b/,
    /\bnew\s+(?:dashboard|board|canvas)\b/,
  ];
  return patterns.some((re) => re.test(normalized));
}

/** @deprecated Use detectGreenfieldWorkbenchPrompt — kept as alias. */
export function detectNewCanvasIntent(message: string): boolean {
  return detectGreenfieldWorkbenchPrompt(message);
}

export function isWorkbenchCanvasPopulated(): boolean {
  const bridge = getWorkbenchCanvasBridge();
  if (!bridge?.isActive) return false;
  const snap = bridge.getCanvasSnapshot();
  return (
    (snap.totalItems ?? 0) > 0 ||
    snap.groups.length > 0 ||
    snap.standaloneWidgets.length > 0
  );
}

let pendingFirstSendAfterNewChat = false;

/** Call when user starts a new chat thread in workbench mode (not a new canvas tab). */
export function markWorkbenchNewChatPendingFirstSend(): void {
  pendingFirstSendAfterNewChat = true;
}

export function consumeWorkbenchNewChatPendingFirstSend(): boolean {
  const pending = pendingFirstSendAfterNewChat;
  pendingFirstSendAfterNewChat = false;
  return pending;
}

/** Whether to show confirm-first new canvas dialog before streaming. */
export function shouldConfirmNewCanvasBeforeSend(
  message: string,
  options?: { firstTurnAfterNewChat?: boolean; canvasHasContent?: boolean },
): boolean {
  if (detectGreenfieldWorkbenchPrompt(message)) {
    return true;
  }
  if (options?.firstTurnAfterNewChat && options.canvasHasContent) {
    const normalized = message.trim().toLowerCase();
    const analyticalOnly =
      /\b(summarize|summary|what needs my attention|pipeline health|pull- through|overview of this month)/i.test(
        normalized,
      ) && !/\b(build|board[- ]?ready|dashboard|create)\b/i.test(normalized);
    return !analyticalOnly;
  }
  return false;
}

export function isWorkbenchScopeAlignedWithActiveTab(
  conversationScope: WorkbenchChatScopeRef | null | undefined,
): boolean {
  if (!conversationScope || !latestActiveContext) return true;
  return workbenchScopeMatchesActiveContext(
    conversationScope,
    latestActiveContext,
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
  | "new_canvas_intent_dismissed"
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
