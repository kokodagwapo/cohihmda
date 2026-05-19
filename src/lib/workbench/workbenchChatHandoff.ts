/**
 * Centralized workbench chat → My Dashboard canvas handoff (unified chat).
 */

import type { NavigateFunction } from "react-router-dom";
import type { WidgetAction } from "@/types/widgetActions";
import { getWorkbenchCanvasBridge } from "@/lib/workbench/workbenchCanvasBridge";

export const WORKBENCH_CHAT_HANDOFF_STATE_KEY = "workbenchChatHandoff";

export const WORKBENCH_APPLY_ACTIONS_EVENT = "workbench:apply-cohi-actions";

/** Open unified shell and send an edit prompt for a canvas widget. */
export const COHI_WORKBENCH_EDIT_WIDGET_EVENT = "cohi-workbench-edit-widget";

/** Executable workbench action types (parity with useWorkbenchCohi). */
export const EXECUTABLE_WORKBENCH_ACTION_TYPES = new Set<string>([
  "add_existing_widget",
  "create_widget",
  "create_canvas",
  "suggest_dashboard",
  "modify_widget",
  "modify_group",
  "modify_registry_widget",
  "create_dashboard",
  "convert_to_sql_widget",
  "delete_widget",
]);

export interface WorkbenchChatHandoff {
  draftScopeId: string;
  conversationId?: string;
  /** First submit in a new workbench chat session — open one new canvas tab. */
  openNewTab?: boolean;
  /** Follow-up: focus tab bound to this draft scope (no new tab). */
  activateDraftScopeId?: string;
  /** Actions that arrived before the canvas listener mounted. */
  pendingActions?: WidgetAction[];
}

export type WorkbenchChatHandoffLocationState = {
  [WORKBENCH_CHAT_HANDOFF_STATE_KEY]?: WorkbenchChatHandoff;
};

export function filterExecutableWorkbenchActions(
  actions: WidgetAction[] | undefined,
): WidgetAction[] {
  if (!actions?.length) return [];
  return actions.filter((a) => EXECUTABLE_WORKBENCH_ACTION_TYPES.has(a.type));
}

const DRAFT_TAB_STORAGE_KEY = "cohi_workbench_draft_tabs";
const PENDING_ACTIONS_STORAGE_KEY = "cohi_workbench_pending_actions";
const ACTIVE_DRAFT_SCOPE_KEY = "cohi_workbench_active_draft";
const NAV_BOUND_KEY = "cohi_workbench_nav_bound";

/** Active draft scope for the current workbench chat thread (survives provider remounts). */
export function getOrCreateActiveWorkbenchDraftScope(): string {
  if (typeof window === "undefined") return generateWorkbenchDraftScopeId();
  try {
    const existing = window.sessionStorage.getItem(ACTIVE_DRAFT_SCOPE_KEY);
    if (existing) return existing;
    const id = generateWorkbenchDraftScopeId();
    window.sessionStorage.setItem(ACTIVE_DRAFT_SCOPE_KEY, id);
    return id;
  } catch {
    return generateWorkbenchDraftScopeId();
  }
}

export function resetActiveWorkbenchDraftSession(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(ACTIVE_DRAFT_SCOPE_KEY);
    window.sessionStorage.removeItem(NAV_BOUND_KEY);
  } catch {
    /* ignore */
  }
}

export function isWorkbenchCanvasNavBound(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.sessionStorage.getItem(NAV_BOUND_KEY) === "1";
  } catch {
    return false;
  }
}

export function markWorkbenchCanvasNavBound(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(NAV_BOUND_KEY, "1");
  } catch {
    /* ignore */
  }
}

/**
 * Navigate to canvas editor before the workbench API call (shell submit).
 * Call from CohiChatPanel so navigation is not missed by hook closure timing.
 */
export function navigateForWorkbenchChatSubmit(
  navigate: NavigateFunction,
  options?: { forceNewConversation?: boolean },
): string {
  if (options?.forceNewConversation) {
    resetActiveWorkbenchDraftSession();
  }
  const draftScopeId = getOrCreateActiveWorkbenchDraftScope();
  const firstNav = !isWorkbenchCanvasNavBound();
  if (firstNav) {
    markWorkbenchCanvasNavBound();
    navigateToWorkbenchHandoff(navigate, {
      draftScopeId,
      openNewTab: true,
    });
  } else {
    navigateToWorkbenchHandoff(navigate, {
      draftScopeId,
      activateDraftScopeId: draftScopeId,
    });
  }
  return draftScopeId;
}

export function stashPendingWorkbenchActions(
  draftScopeId: string,
  actions: WidgetAction[],
): void {
  if (typeof window === "undefined" || actions.length === 0) return;
  try {
    const raw = window.sessionStorage.getItem(PENDING_ACTIONS_STORAGE_KEY);
    const map = raw ? (JSON.parse(raw) as Record<string, WidgetAction[]>) : {};
    map[draftScopeId] = actions;
    window.sessionStorage.setItem(PENDING_ACTIONS_STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

export function consumePendingWorkbenchActions(
  draftScopeId: string,
): WidgetAction[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.sessionStorage.getItem(PENDING_ACTIONS_STORAGE_KEY);
    const map = raw ? (JSON.parse(raw) as Record<string, WidgetAction[]>) : {};
    const actions = map[draftScopeId] ?? [];
    if (actions.length > 0) {
      delete map[draftScopeId];
      window.sessionStorage.setItem(PENDING_ACTIONS_STORAGE_KEY, JSON.stringify(map));
    }
    return actions;
  } catch {
    return [];
  }
}

export function clearPendingWorkbenchActions(draftScopeId: string): void {
  if (typeof window === "undefined" || !draftScopeId) return;
  try {
    const raw = window.sessionStorage.getItem(PENDING_ACTIONS_STORAGE_KEY);
    const map = raw ? (JSON.parse(raw) as Record<string, WidgetAction[]>) : {};
    if (!map[draftScopeId]) return;
    delete map[draftScopeId];
    window.sessionStorage.setItem(PENDING_ACTIONS_STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

/**
 * Apply widget actions once: dispatch to the live canvas, or stash until it mounts.
 * Never both — stashing + dispatch was causing duplicate charts on the canvas.
 */
export function deliverWorkbenchWidgetActions(
  draftScopeId: string,
  actions: WidgetAction[],
): void {
  if (!actions.length) return;
  const bridge = getWorkbenchCanvasBridge();
  if (bridge?.isActive && bridge.draftScopeId === draftScopeId) {
    dispatchWorkbenchActions(actions, { draftScopeId });
    clearPendingWorkbenchActions(draftScopeId);
    return;
  }
  stashPendingWorkbenchActions(draftScopeId, actions);
}

/** Persist draft scope → ephemeral new-* tab id (survives /workbench hub redirect). */
export function rememberWorkbenchDraftTab(
  draftScopeId: string,
  tabId: string,
): void {
  if (typeof window === "undefined") return;
  try {
    const raw = window.sessionStorage.getItem(DRAFT_TAB_STORAGE_KEY);
    const map = raw ? (JSON.parse(raw) as Record<string, string>) : {};
    map[draftScopeId] = tabId;
    window.sessionStorage.setItem(DRAFT_TAB_STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

export function lookupWorkbenchDraftTab(
  draftScopeId: string,
): string | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const raw = window.sessionStorage.getItem(DRAFT_TAB_STORAGE_KEY);
    const map = raw ? (JSON.parse(raw) as Record<string, string>) : {};
    return map[draftScopeId];
  } catch {
    return undefined;
  }
}

/**
 * Navigate to the canvas editor. Uses `/my-dashboard/new` (not `/my-dashboard`) because
 * the latter redirects to `/workbench` and drops location.state.
 */
export function navigateToWorkbenchHandoff(
  navigate: NavigateFunction,
  handoff: WorkbenchChatHandoff,
): void {
  const state = { [WORKBENCH_CHAT_HANDOFF_STATE_KEY]: handoff };

  if (handoff.openNewTab) {
    navigate("/my-dashboard/new", { state });
    return;
  }

  if (handoff.activateDraftScopeId) {
    const savedCanvasId = handoff.activateDraftScopeId.startsWith("canvas:")
      ? handoff.activateDraftScopeId.slice("canvas:".length)
      : undefined;
    if (savedCanvasId) {
      navigate(`/my-dashboard/${savedCanvasId}`, { state });
      return;
    }
    const tabId = lookupWorkbenchDraftTab(handoff.activateDraftScopeId);
    if (tabId && !tabId.startsWith("new-")) {
      navigate(`/my-dashboard/${tabId}`, { state });
      return;
    }
    navigate("/my-dashboard/new", { state });
    return;
  }

  navigate("/my-dashboard/new", { state });
}

export function dispatchWorkbenchActions(
  actions: WidgetAction[],
  detail?: { draftScopeId?: string },
): void {
  if (typeof window === "undefined" || actions.length === 0) return;
  window.dispatchEvent(
    new CustomEvent(WORKBENCH_APPLY_ACTIONS_EVENT, {
      detail: { actions, ...detail },
    }),
  );
}

export function generateWorkbenchDraftScopeId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
