/**
 * Centralized workbench chat → My Dashboard canvas handoff (unified chat).
 */

import type { NavigateFunction } from "react-router-dom";
import type { ReportDefinition } from "@/types/reportTypes";
import type { WidgetAction } from "@/types/widgetActions";
import { suppressNextWorkbenchScopePrompt } from "@/lib/workbench/workbenchChatScopeSync";
import type { UnifiedChatType } from "@/lib/unifiedChatClient";
import { getWorkbenchCanvasBridge } from "@/lib/workbench/workbenchCanvasBridge";
import { normalizeWidgetActionsForExecution } from "@/lib/workbench/normalizeModifyWidgetAction";

export const WORKBENCH_CHAT_HANDOFF_STATE_KEY = "workbenchChatHandoff";

export const WORKBENCH_APPLY_ACTIONS_EVENT = "workbench:apply-cohi-actions";

/** Open unified shell and send an edit prompt for a canvas widget. */
export const COHI_WORKBENCH_EDIT_WIDGET_EVENT = "cohi-workbench-edit-widget";

/** Clear widget edit mode on the active canvas (from unified chat "Stop editing"). */
export const COHI_WORKBENCH_STOP_EDITING_EVENT = "cohi-workbench-stop-editing";

/** Active canvas reports which widget is being edited (for unified chat banner). */
export const COHI_WORKBENCH_EDITING_WIDGET_STATE_EVENT =
  "cohi-workbench-editing-widget-state";

/** My Dashboard must focus this saved canvas tab before unified chat sends (avoids empty "New Canvas"). */
export const COHI_WORKBENCH_FOCUS_CANVAS_EVENT = "cohi-workbench-focus-canvas";

/** useCohiChat binds workbench stream scope to a saved canvas id. */
export const COHI_WORKBENCH_BIND_CANVAS_EVENT = "cohi-workbench-bind-canvas";

export interface WorkbenchEditWidgetEventDetail {
  /** When omitted, chat opens in edit mode without auto-sending to the LLM. */
  message?: string;
  widgetId: string;
  widgetTitle: string;
  widgetType: string;
  draftScopeId: string;
  canvasId: string | null;
}

export interface WorkbenchEditingWidgetStateDetail {
  widgetId: string | null;
  widgetTitle: string | null;
}

export interface WorkbenchConversationResumeDetail {
  conversationId: string;
  scopeType: "canvas" | "draft";
  scopeId: string;
}

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
  /** Resume historical workbench chat on the linked canvas (no new tab). */
  resumeConversationId?: string;
}

export type WorkbenchChatHandoffLocationState = {
  [WORKBENCH_CHAT_HANDOFF_STATE_KEY]?: WorkbenchChatHandoff;
};

export function filterExecutableWorkbenchActions(
  actions: WidgetAction[] | undefined,
): WidgetAction[] {
  if (!actions?.length) return [];
  const filtered = actions.filter((a) =>
    EXECUTABLE_WORKBENCH_ACTION_TYPES.has(a.type),
  );
  return normalizeWidgetActionsForExecution(filtered);
}

/** Action types that add or replace canvas content (held when a dashboard is only suggested). */
export const WORKBENCH_CANVAS_ADD_ACTION_TYPES = new Set<string>([
  "suggest_dashboard",
  "add_existing_widget",
  "create_widget",
  "create_dashboard",
  "create_canvas",
]);

/** Auto-apply on canvas; suggest_dashboard waits for user confirmation. */
export function partitionWorkbenchActionsForAutoApply(actions: WidgetAction[]): {
  autoApply: WidgetAction[];
  pendingConfirmation: WidgetAction[];
} {
  const executable = filterExecutableWorkbenchActions(actions);
  const pendingConfirmation = executable.filter(
    (a) => a.type === "suggest_dashboard",
  );
  if (pendingConfirmation.length === 0) {
    return { autoApply: executable, pendingConfirmation: [] };
  }
  const autoApply = executable.filter(
    (a) => !WORKBENCH_CANVAS_ADD_ACTION_TYPES.has(a.type),
  );
  return { autoApply, pendingConfirmation };
}

export type DeliverWorkbenchWidgetActionsOptions = {
  /** When true, suggest_dashboard and companion add actions may be applied (user confirmed). */
  allowDashboardSuggestions?: boolean;
};

/** Human-readable label for a suggest_dashboard sectionKey. */
export function formatWorkbenchSectionKey(sectionKey: string): string {
  return sectionKey
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (s) => s.toUpperCase())
    .trim();
}

import {
  isAnalyticalWorkbenchQuestion,
  isRemoveWidgetOnlyQuestion,
} from "./workbenchPromptIntent";

export {
  isAnalyticalWorkbenchQuestion,
  isRemoveWidgetOnlyQuestion,
} from "./workbenchPromptIntent";

/** Drop spurious create_* actions when the user asked an analytical question only. */
export function gateWorkbenchActionsForUserQuestion(
  actions: WidgetAction[] | undefined,
  userQuestion: string,
): WidgetAction[] {
  let filtered = filterExecutableWorkbenchActions(actions);
  if (isRemoveWidgetOnlyQuestion(userQuestion)) {
    filtered = filtered.filter(
      (a) =>
        a.type !== "create_widget" &&
        a.type !== "create_dashboard" &&
        a.type !== "create_canvas",
    );
  }
  filtered = gateIncrementalCanvasAddActions(filtered, userQuestion);
  if (!isAnalyticalWorkbenchQuestion(userQuestion)) return filtered;
  return filtered.filter(
    (a) => a.type !== "create_widget" && a.type !== "create_dashboard",
  );
}

/** User is adding another section to a non-empty canvas — avoid rebuild actions. */
export function isIncrementalCanvasAddRequest(userQuestion: string): boolean {
  return /(already added|just add|also add|add (?:the )?\w+ (?:too|as well)|another (?:one|dashboard|section))/i.test(
    userQuestion,
  );
}

export function gateIncrementalCanvasAddActions(
  actions: WidgetAction[],
  userQuestion: string,
): WidgetAction[] {
  if (!isIncrementalCanvasAddRequest(userQuestion)) return actions;
  return actions.filter(
    (a) => a.type !== "create_canvas" && a.type !== "create_dashboard",
  );
}

/**
 * Workbench compact-shell submit: only the first turn starts a new conversation tab.
 * Follow-ups must reuse sessionId so canvas/chat stay in sync.
 */
export function shouldForceNewWorkbenchConversation(options: {
  isShellCompact: boolean;
  currentSessionId: string | null;
  userTurnCount: number;
}): boolean {
  return (
    options.isShellCompact &&
    !options.currentSessionId &&
    options.userTurnCount === 0
  );
}

export type {
  CarryOverContext,
  ChatMessageForCarryOver,
  BuildCarryOverOptions,
} from "@/lib/carryOverContext";

export function shouldForkOnChatTypeChange(options: {
  previousChatType: UnifiedChatType;
  nextChatType: UnifiedChatType;
  currentSessionId: string | null;
  messageCount: number;
}): boolean {
  if (options.previousChatType === options.nextChatType) return false;
  if (options.messageCount === 0) return false;
  return !!options.currentSessionId;
}

/** User-facing summary for applied workbench actions (chat bubble footer). */
export function describeWorkbenchActionsApplied(
  actions: WidgetAction[] | undefined,
): string | null {
  const applied = partitionWorkbenchActionsForAutoApply(actions ?? []).autoApply;
  if (!applied.length) return null;

  const creates = applied.filter((a) => a.type === "create_widget").length;
  const groupMods = applied.filter((a) => a.type === "modify_group");
  const widgetMods = applied.filter((a) => a.type === "modify_widget").length;

  if (groupMods.length > 0 && creates === 0 && widgetMods === 0) {
    const ops = groupMods.flatMap((a) =>
      a.type === "modify_group" ? a.operations ?? [] : [],
    );
    const hasPeriod = ops.some((o) => o.op === "set_period");
    const hasRemove = ops.some((o) => o.op === "remove");
    const hasRename = ops.some((o) => o.op === "set_widget_title");
    if (hasPeriod) return "Updated dashboard period";
    if (hasRemove) return "Updated dashboard widgets";
    if (hasRename) return "Renamed dashboard widget";
    return "Updated dashboard group";
  }

  if (widgetMods > 0 && creates === 0) {
    return widgetMods === 1
      ? "Updated dashboard widget"
      : `Updated ${widgetMods} dashboard widgets`;
  }

  if (creates > 0) {
    return creates === 1
      ? "Applied 1 widget to canvas"
      : `Applied ${creates} widgets to canvas`;
  }

  return "Updated dashboard";
}

const DRAFT_TAB_STORAGE_KEY = "cohi_workbench_draft_tabs";
const PENDING_ACTIONS_STORAGE_KEY = "cohi_workbench_pending_actions";
const CHAT_PPT_SEED_STORAGE_KEY = "cohi_chat_ppt_seed";
const ACTIVE_DRAFT_SCOPE_KEY = "cohi_workbench_active_draft";
const NAV_BOUND_KEY = "cohi_workbench_nav_bound";
/** One-shot: open unified shell in split (side) layout after workbench chat submit. */
const CHAT_SPLIT_LAYOUT_KEY = "cohi_workbench_chat_split";

export function isMyDashboardCanvasPath(pathname: string): boolean {
  const normalized = pathname.replace(/\/+$/, "") || "/";
  return (
    normalized === "/my-dashboard" || normalized.startsWith("/my-dashboard/")
  );
}

/** Saved canvas id from `/my-dashboard/:id` (not `new`). */
export function getMyDashboardCanvasIdFromPath(pathname?: string): string | null {
  if (typeof window === "undefined" && pathname == null) return null;
  const path = (pathname ?? window.location.pathname).replace(/\/+$/, "") || "/";
  const match = path.match(/^\/my-dashboard\/([^/]+)$/);
  if (!match || match[1] === "new") return null;
  return match[1];
}

/** Stable draft scope for a saved canvas tab (survives remounts and chat handoff). */
export function draftScopeIdForCanvasTab(canvasId: string): string {
  return `canvas-tab:${canvasId}`;
}

/** Normalize draft scope from an Edit-with-Cohi event (always canvas-tab when canvasId known). */
export function resolveWorkbenchEditDraftScope(
  detail: Pick<WorkbenchEditWidgetEventDetail, "draftScopeId" | "canvasId">,
): string {
  if (detail.canvasId) return draftScopeIdForCanvasTab(detail.canvasId);
  return detail.draftScopeId;
}

/** Bind session + tab map for edit-with-Cohi without changing dashboard route/tabs. */
export function bindWorkbenchEditDraftScope(
  detail: Pick<WorkbenchEditWidgetEventDetail, "draftScopeId" | "canvasId">,
): string {
  suppressNextWorkbenchScopePrompt(3);
  const draftScopeId = resolveWorkbenchEditDraftScope(detail);
  if (detail.canvasId) {
    dispatchWorkbenchFocusCanvas(detail.canvasId);
    dispatchWorkbenchBindCanvas(detail.canvasId);
  }
  setActiveWorkbenchDraftScope(draftScopeId);
  markWorkbenchCanvasNavBound();
  if (detail.canvasId) {
    rememberWorkbenchDraftTab(draftScopeId, detail.canvasId);
  }
  return draftScopeId;
}

/** Saved canvas id from URL or the mounted WorkbenchCanvas bridge (not "new" route). */
export function getConnectedWorkbenchCanvasId(): string | null {
  if (typeof window === "undefined") return null;
  const fromUrl = getMyDashboardCanvasIdFromPath();
  if (fromUrl) return fromUrl;
  const bridge = getWorkbenchCanvasBridge();
  return bridge?.canvasId ?? null;
}

export function dispatchWorkbenchFocusCanvas(canvasId: string): void {
  if (typeof window === "undefined" || !canvasId) return;
  window.dispatchEvent(
    new CustomEvent(COHI_WORKBENCH_FOCUS_CANVAS_EVENT, {
      detail: { canvasId },
    }),
  );
}

export function dispatchWorkbenchBindCanvas(canvasId: string): void {
  if (typeof window === "undefined" || !canvasId) return;
  window.dispatchEvent(
    new CustomEvent(COHI_WORKBENCH_BIND_CANVAS_EVENT, {
      detail: { canvasId },
    }),
  );
}

function syncWorkbenchDraftScopeFromActiveCanvas(): string | null {
  const bridge = getWorkbenchCanvasBridge();
  if (!bridge?.draftScopeId) return null;
  setActiveWorkbenchDraftScope(bridge.draftScopeId);
  markWorkbenchCanvasNavBound();
  const tabId = bridge.canvasId ?? getMyDashboardCanvasIdFromPath();
  if (tabId) rememberWorkbenchDraftTab(bridge.draftScopeId, tabId);
  return bridge.draftScopeId;
}

export function markWorkbenchChatSplitLayout(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(CHAT_SPLIT_LAYOUT_KEY, "1");
  } catch {
    /* ignore */
  }
}

export function consumeWorkbenchChatSplitLayout(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const pending = window.sessionStorage.getItem(CHAT_SPLIT_LAYOUT_KEY) === "1";
    if (pending) window.sessionStorage.removeItem(CHAT_SPLIT_LAYOUT_KEY);
    return pending;
  } catch {
    return false;
  }
}

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

/** Bind unified chat to a specific canvas/draft scope (e.g. Edit with Cohi). */
export function setActiveWorkbenchDraftScope(draftScopeId: string): void {
  if (typeof window === "undefined" || !draftScopeId) return;
  try {
    window.sessionStorage.setItem(ACTIVE_DRAFT_SCOPE_KEY, draftScopeId);
    markWorkbenchCanvasNavBound();
  } catch {
    /* ignore */
  }
}

export function dispatchWorkbenchEditingWidgetState(
  detail: WorkbenchEditingWidgetStateDetail,
): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(COHI_WORKBENCH_EDITING_WIDGET_STATE_EVENT, { detail }),
  );
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
  const onDashboard =
    typeof window !== "undefined" &&
    isMyDashboardCanvasPath(window.location.pathname);
  const connectedCanvasId = getConnectedWorkbenchCanvasId();

  if (options?.forceNewConversation) {
    const preserved = syncWorkbenchDraftScopeFromActiveCanvas();
    if (!preserved && !connectedCanvasId) {
      resetActiveWorkbenchDraftSession();
    }
  }

  markWorkbenchChatSplitLayout();

  const syncedFromBridge = syncWorkbenchDraftScopeFromActiveCanvas();
  if (syncedFromBridge) {
    return syncedFromBridge;
  }

  if (onDashboard) {
    const draftScopeId = connectedCanvasId
      ? draftScopeIdForCanvasTab(connectedCanvasId)
      : getOrCreateActiveWorkbenchDraftScope();
    setActiveWorkbenchDraftScope(draftScopeId);
    markWorkbenchCanvasNavBound();
    if (connectedCanvasId) {
      rememberWorkbenchDraftTab(draftScopeId, connectedCanvasId);
      dispatchWorkbenchFocusCanvas(connectedCanvasId);
    }
    return draftScopeId;
  }

  const draftScopeId = connectedCanvasId
    ? draftScopeIdForCanvasTab(connectedCanvasId)
    : getOrCreateActiveWorkbenchDraftScope();
  setActiveWorkbenchDraftScope(draftScopeId);

  const firstNav = !isWorkbenchCanvasNavBound();
  if (firstNav) {
    markWorkbenchCanvasNavBound();
    if (connectedCanvasId) {
      navigate(`/my-dashboard/${connectedCanvasId}`);
    } else {
      navigateToWorkbenchHandoff(navigate, {
        draftScopeId,
        openNewTab: true,
      });
    }
  } else if (connectedCanvasId) {
    navigate(`/my-dashboard/${connectedCanvasId}`);
  } else {
    navigateToWorkbenchHandoff(navigate, {
      draftScopeId,
      activateDraftScopeId: draftScopeId,
    });
  }
  return draftScopeId;
}

/**
 * Canvas-first handoff for "Edit with Cohi" — never opens a blank new tab.
 */
export function navigateForWorkbenchWidgetEdit(
  navigate: NavigateFunction,
  detail: WorkbenchEditWidgetEventDetail,
): void {
  const draftScopeId = bindWorkbenchEditDraftScope(detail);
  markWorkbenchChatSplitLayout();

  const onDashboard =
    typeof window !== "undefined" &&
    isMyDashboardCanvasPath(window.location.pathname);

  if (onDashboard) {
    return;
  }

  if (detail.canvasId) {
    navigate(`/my-dashboard/${detail.canvasId}`);
    return;
  }

  navigateToWorkbenchHandoff(navigate, {
    draftScopeId,
    activateDraftScopeId: draftScopeId,
  });
}

/** Load a conversation into the unified chat shell (listened to by CohiChatPanel). */
export function dispatchCohiChatResume(
  conversationId: string,
  chatType: UnifiedChatType = "workbench",
): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("cohi-chat-resume", {
      detail: { conversationId, chatType },
    }),
  );
}

/**
 * After dashboard navigation, load the resumed conversation even when the URL
 * does not change (e.g. another chat is already open on the same canvas).
 */
export function scheduleWorkbenchConversationResume(conversationId: string): void {
  if (typeof window === "undefined") return;
  queueMicrotask(() => dispatchCohiChatResume(conversationId, "workbench"));
}

/**
 * Resume a historical workbench conversation on its linked canvas with split chat.
 */
export function navigateForWorkbenchConversationResume(
  navigate: NavigateFunction,
  args: WorkbenchConversationResumeDetail,
): boolean {
  const { conversationId, scopeType, scopeId } = args;
  if (!scopeId) return false;

  markWorkbenchChatSplitLayout();
  markWorkbenchCanvasNavBound();

  if (scopeType === "canvas") {
    navigate(`/my-dashboard/${scopeId}`, {
      state: {
        [WORKBENCH_CHAT_HANDOFF_STATE_KEY]: {
          draftScopeId: scopeId,
          resumeConversationId: conversationId,
        },
      },
    });
    scheduleWorkbenchConversationResume(conversationId);
    return true;
  }

  if (scopeType === "draft") {
    setActiveWorkbenchDraftScope(scopeId);
    navigateToWorkbenchHandoff(navigate, {
      draftScopeId: scopeId,
      activateDraftScopeId: scopeId,
      resumeConversationId: conversationId,
    });
    scheduleWorkbenchConversationResume(conversationId);
    return true;
  }

  return false;
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

type ChatPptSeedEntry = {
  definition: ReportDefinition;
  createdAt: number;
};

function readChatPptSeedMap(): Record<string, ChatPptSeedEntry> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.sessionStorage.getItem(CHAT_PPT_SEED_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, ChatPptSeedEntry>) : {};
  } catch {
    return {};
  }
}

function writeChatPptSeedMap(map: Record<string, ChatPptSeedEntry>): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(CHAT_PPT_SEED_STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

/** Stash a Report Builder definition for a canvas opened from chat "Edit in PPT Editor". */
export function stashChatPptSeed(
  canvasId: string,
  definition: ReportDefinition,
): void {
  if (typeof window === "undefined" || !canvasId) return;
  const map = readChatPptSeedMap();
  map[canvasId] = { definition, createdAt: Date.now() };
  writeChatPptSeedMap(map);
}

/** Consume and remove a chat-origin PPT seed for the given canvas (one-shot). */
export function consumeChatPptSeed(canvasId: string): ReportDefinition | null {
  if (typeof window === "undefined" || !canvasId) return null;
  try {
    const map = readChatPptSeedMap();
    const entry = map[canvasId];
    if (!entry?.definition) return null;
    delete map[canvasId];
    writeChatPptSeedMap(map);
    return entry.definition;
  } catch {
    return null;
  }
}

/**
 * Apply widget actions once: dispatch to the live canvas, or stash until it mounts.
 * Never both — stashing + dispatch was causing duplicate charts on the canvas.
 */
export function deliverWorkbenchWidgetActions(
  draftScopeId: string,
  actions: WidgetAction[],
  options?: DeliverWorkbenchWidgetActionsOptions,
): void {
  const toDeliver = options?.allowDashboardSuggestions
    ? filterExecutableWorkbenchActions(actions)
    : partitionWorkbenchActionsForAutoApply(actions).autoApply;
  if (!toDeliver.length) return;
  const bridge = getWorkbenchCanvasBridge();
  const targetScopeId =
    bridge?.isActive ? bridge.draftScopeId : draftScopeId;
  if (bridge?.isActive) {
    dispatchWorkbenchActions(toDeliver, { draftScopeId: targetScopeId });
    clearPendingWorkbenchActions(targetScopeId);
    if (targetScopeId !== draftScopeId) {
      clearPendingWorkbenchActions(draftScopeId);
    }
    return;
  }
  stashPendingWorkbenchActions(draftScopeId, toDeliver);
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

export const COHI_RESEARCH_PPT_EXPORT_EVENT = "cohi-research-ppt-export";

export const COHI_OPEN_WORKBENCH_PPT_EDITOR_EVENT = "cohi-open-workbench-ppt-editor";

/** Ask unified research workspace to run full report PPT export (same as Export PPT button). */
export function dispatchResearchPptExport(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(COHI_RESEARCH_PPT_EXPORT_EVENT));
}

export function dispatchOpenWorkbenchPptEditor(
  detail: Omit<OpenWorkbenchPowerPointEditorOptions, "navigate">,
): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(COHI_OPEN_WORKBENCH_PPT_EDITOR_EVENT, { detail }),
  );
}

export type OpenWorkbenchPowerPointEditorOptions = {
  navigate: NavigateFunction;
  messages: Array<{
    id: string;
    role: string;
    visualization?: import("@/hooks/useCohiChat").VisualizationConfig;
  }>;
  mode?: import("@/lib/presentationExportIntent").PresentationExportMode;
  latestAssistantId?: string;
  userQuestion?: string;
};

/**
 * NL workbench path: open Report Builder on the current canvas (optional viz seed).
 */
export async function openWorkbenchPowerPointEditorFromChat(
  options: OpenWorkbenchPowerPointEditorOptions,
): Promise<void> {
  const { navigate, messages, mode = "create", latestAssistantId } = options;
  markWorkbenchChatSplitLayout();

  const canvasId = getConnectedWorkbenchCanvasId();
  const draftScopeId = canvasId
    ? draftScopeIdForCanvasTab(canvasId)
    : getOrCreateActiveWorkbenchDraftScope();

  setActiveWorkbenchDraftScope(draftScopeId);
  markWorkbenchCanvasNavBound();

  const { resolvePresentationExportTargetMessage } =
    await import("@/lib/pptMessageResolver");
  const target = resolvePresentationExportTargetMessage(
    messages as import("@/hooks/useCohiChat").ChatMessage[],
    mode,
    latestAssistantId,
  );

  if (target?.visualization && canvasId) {
    const { buildChatVizExportContent } = await import(
      "@/lib/chatVisualizationPptContent"
    );
    const { buildChatVisualizationReportDefinition } = await import(
      "@/lib/chatVisualizationPptSeed"
    );
    const { captureChartAsBlob, blobToDataUrl } = await import(
      "@/lib/captureChartForExport"
    );

    let chartImageDataUrl: string | undefined;
    try {
      const blob = await captureChartAsBlob(target.id);
      if (blob) chartImageDataUrl = await blobToDataUrl(blob);
    } catch {
      /* optional capture */
    }

    const exportContent = buildChatVizExportContent({
      viz: target.visualization,
      title: target.visualization.title,
      chartImageDataUrl,
    });
    stashChatPptSeed(
      canvasId,
      buildChatVisualizationReportDefinition(exportContent),
    );
  }

  if (canvasId) {
    dispatchWorkbenchFocusCanvas(canvasId);
    navigate(`/my-dashboard/${canvasId}?reportBuilder=1`);
    return;
  }

  navigateForWorkbenchChatSubmit(navigate, {
    draftScopeId,
    activateDraftScopeId: draftScopeId,
  });
  queueMicrotask(() => {
    if (typeof window !== "undefined") {
      const path = window.location.pathname;
      if (!path.includes("reportBuilder=1")) {
        navigate(`${path.split("?")[0]}?reportBuilder=1`, { replace: true });
      }
    }
  });
}
