/**
 * Cohi Chat Hook
 * Manages chat state, API calls, and conversation history
 * Uses the hybrid data + knowledge architecture
 */

import { useState, useCallback, useRef, useEffect } from "react";
import { api } from "@/lib/api";
import {
  isUnifiedChatClientEnabled,
  parseGlobalFromBlocks,
  parseWorkbenchUnifiedEnvelope,
  type UnifiedChatBlock,
} from "@/lib/unifiedChatEnvelope";
import {
  enrichVizPresentationExportsOnLoad,
  hydratePresentationExportsOnLoad,
  type LoadedTurnPresentationMeta,
} from "@/lib/hydratePresentationExportOnLoad";
import { serializeWidgetCatalog } from "@/utils/widgetCatalogSerializer";
import type { WidgetAction, CanvasStateSnapshot } from "@/types/widgetActions";
import {
  deliverWorkbenchWidgetActions,
  dispatchWorkbenchBindCanvas,
  filterExecutableWorkbenchActions,
  gateWorkbenchActionsForUserQuestion,
  partitionWorkbenchActionsForAutoApply,
  COHI_WORKBENCH_BIND_CANVAS_EVENT,
  draftScopeIdForCanvasTab,
  getConnectedWorkbenchCanvasId,
  getMyDashboardCanvasIdFromPath,
  getOrCreateActiveWorkbenchDraftScope,
  rememberWorkbenchDraftTab,
  markWorkbenchCanvasNavBound,
  resetActiveWorkbenchDraftSession,
  setActiveWorkbenchDraftScope,
  isWorkbenchPresentationChatRequest,
  requestOpenWorkbenchReportBuilderFromChat,
  scheduleWorkbenchTranscriptRefresh,
  isGenericWorkbenchAck,
  resolveWorkbenchAssistantContent,
} from "@/lib/workbench/workbenchChatHandoff";
import { parsePresentationExportMetadata } from "@/lib/presentationExportTypes";
import {
  activeContextToScopeRef,
  scopeRefsEqual,
  workbenchScopeMatchesActiveContext,
  resolveWorkbenchTurnScope,
  isWorkbenchNewCanvasHandoffActive,
  dispatchWorkbenchScopeMismatchActions,
  getLatestWorkbenchActiveContext,
  isWorkbenchChatScopeSyncEnabled,
  isWorkbenchScopeAlignedWithActiveTab,
  trackWorkbenchScopeSyncEvent,
  clearPersistedWorkbenchConversationScope,
  persistWorkbenchConversationScope,
  readPersistedWorkbenchConversationScope,
  shouldPromoteWorkbenchChatScopeOnCanvasSave,
  buildWorkbenchChatScopeAfterCanvasSave,
  suppressNextWorkbenchScopePrompt,
  WORKBENCH_CANVAS_SAVED_EVENT,
  type WorkbenchActiveContext,
  type WorkbenchCanvasSavedDetail,
  type WorkbenchChatScopeRef,
  type WorkbenchScopeMismatchActionsDetail,
  type SyncWorkbenchContextOptions,
  buildWorkbenchCanvasScopeQueries,
} from "@/lib/workbench/workbenchChatScopeSync";
import {
  getWorkbenchCanvasBridge,
  getWorkbenchCanvasIdForDraft,
  getWorkbenchCanvasSnapshotForDraft,
} from "@/lib/workbench/workbenchCanvasBridge";
import {
  createUnifiedChatClient,
  type UnifiedChatType,
  type UnifiedConversationSummary,
} from "@/lib/unifiedChatClient";
import {
  CHAT_TYPE_DEFAULT_SUGGESTIONS,
  DEFAULT_CHAT_SUGGESTIONS,
  resolveWorkbenchTopicSuggestions,
} from "@/lib/unifiedChatSuggestedPrompts";
import { isWorkbenchCanvasPopulated } from "@/lib/workbench/workbenchChatScopeSync";

function defaultSuggestionsForChatType(type: UnifiedChatType): string[] {
  if (type === "workbench") {
    return resolveWorkbenchTopicSuggestions(isWorkbenchCanvasPopulated());
  }
  return CHAT_TYPE_DEFAULT_SUGGESTIONS[type];
}
import {
  sendUnifiedGlobalStream,
  sendUnifiedWorkbenchStream,
} from "@/lib/unifiedChatSend";
import {
  resolveGlobalStreamRouting,
  type ModeHandoffContext,
} from "@/lib/chat/modeHandoff";
import { buildDashboardGroundingContext } from "@/lib/chat/dashboardGrounding";
import { insightBuilderApproveClientMessageId } from "@/lib/insightBuilderApproveIdempotency";
import {
  notifyOptimisticUnifiedChatConversation,
  refreshUnifiedChatHistoryList,
  UNIFIED_CHAT_HISTORY_SYNC_EVENT,
  type UnifiedChatHistorySyncDetail,
} from "@/lib/unifiedChatFolderUtils";
import { useUnifiedChatRunStore } from "@/stores/unifiedChatRunStore";

import type { CarryOverContext } from "@/lib/workbench/workbenchChatHandoff";

export interface SendMessageOptions {
  /** Start a new server conversation (e.g. compact shell send). */
  forceNewConversation?: boolean;
  /** When forking after a chat-type switch, compact context from the prior thread. */
  carryOverContext?: CarryOverContext;
  /** CSV dataset upload IDs (chat, workbench, research). */
  datasetUploadIds?: string[];
  /** Research: dataset upload IDs for a new investigation only. */
  researchUploadIds?: string[];
  /** Insight builder: pass edited draft and/or approve action. */
  insightBuilder?: {
    action?: "approve" | "revise";
    draft?: import("@/lib/unifiedChatEnvelope").InsightBuilderDraftPreview;
  };
}

// ============================================================================
// Helpers
// ============================================================================

function buildOptimisticUnifiedConversation(args: {
  id: string;
  title: string;
  chatType: UnifiedChatType;
  scope: UnifiedConversationSummary["scope"];
  parentConversationId?: string | null;
}): UnifiedConversationSummary {
  const now = new Date().toISOString();
  return {
    id: args.id,
    title: args.title.slice(0, 80) || "New conversation",
    scope: args.scope,
    chat_type: args.chatType,
    updated_at: now,
    created_at: now,
    ...(args.parentConversationId
      ? { parent_conversation_id: args.parentConversationId }
      : {}),
  };
}

export interface ChatTypeForkUndoState {
  sessionId: string;
  messages: ChatMessage[];
  chatType: UnifiedChatType;
  legacyRef: string | null;
  conversationForkLinks: ConversationForkLinks | null;
}

export interface ConversationForkLinks {
  /** Explicit DB parent_conversation_id (not history list order). */
  parentConversationId?: string | null;
  parentTitle?: string | null;
  /** Explicit DB forked_to_conversation_id on the parent row. */
  forkedToConversationId?: string | null;
  forkedToTitle?: string | null;
}

function forkLinksFromConversationRow(row: {
  parent_conversation_id?: string | null;
  forked_to_conversation_id?: string | null;
  parent_conversation_title?: string | null;
  forked_to_conversation_title?: string | null;
}): ConversationForkLinks | null {
  const parentConversationId = row.parent_conversation_id ?? null;
  const forkedToConversationId = row.forked_to_conversation_id ?? null;
  if (!parentConversationId && !forkedToConversationId) return null;
  return {
    parentConversationId,
    parentTitle: row.parent_conversation_title ?? null,
    forkedToConversationId,
    forkedToTitle: row.forked_to_conversation_title ?? null,
  };
}

// ============================================================================
// Hook
// ============================================================================

export interface VisualizationConfig {
  type:
    | "bar"
    | "line"
    | "pie"
    | "area"
    | "table"
    | "kpi"
    | "donut"
    | "horizontal_bar"
    | "stacked_bar"
    | "grouped_bar"
    | "treemap"
    | "pivot";
  title: string;
  data: any[];
  xKey?: string;
  yKey?: string;
  yKeys?: string[];
  nameKey?: string;
  valueKey?: string;
  colors?: string[];
  showLegend?: boolean;
  showGrid?: boolean;
  stacked?: boolean;
  /** Number format hint for axes / tooltips / KPI display */
  numberFormat?: "number" | "currency" | "percent" | "compact";
  kpiConfig?: {
    value: number | string;
    label: string;
    change?: number;
    changeLabel?: string;
    format?: "number" | "currency" | "percent";
  };
  tableConfig?: {
    columns: { key: string; label: string; format?: string }[];
    sortable?: boolean;
    pageSize?: number;
  };
  /** Pivot table configuration */
  pivotConfig?: {
    rowKey: string;
    columnKey: string;
    valueKey: string;
    aggregation?: "sum" | "count" | "avg" | "min" | "max";
  };
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  visualization?: VisualizationConfig;
  data?: any[];
  timestamp: Date;
  isLoading?: boolean;
  error?: string;
  /** The SQL query that was generated (for "Show SQL" feature) */
  sqlQuery?: string;
  sources?: {
    dataQuery?: boolean;
    knowledgeBase?: string[];
  };
  /** In-app links suggested by Cohi (from unified envelope or legacy API) */
  navigationHints?: { label: string; path: string }[];
  insightBuilderDraft?: import("@/lib/unifiedChatEnvelope").InsightBuilderDraftPreview;
  insightBuilderPhase?: import("@/lib/unifiedChatEnvelope").InsightBuilderPhase;
  visualizationArtifactId?: string;
  /** Workbench mode: actions returned for this turn */
  workbenchActions?: WidgetAction[];
  workbenchActionsAppliedCount?: number;
  /** suggest_dashboard actions awaiting user choice (add pre-built vs custom). */
  workbenchPendingActions?: WidgetAction[];
  /** NL presentation export card (global / research). */
  pptExport?: import("@/lib/presentationExportTypes").ChatMessagePptExport;
}

export interface CohiChatResponse {
  message: string;
  visualization?: VisualizationConfig;
  data?: any[];
  suggestedQuestions?: string[];
  error?: string;
  sqlQuery?: string;
  sources?: {
    dataQuery?: boolean;
    knowledgeBase?: string[];
  };
  navigationHints?: { label: string; path: string }[];
}

export interface ChatSession {
  id: string;
  title: string;
  messageCount: number;
  lastMessageAt: string;
  createdAt: string;
}

export interface PresentationExportHandlers {
  onOpenWorkbenchEditor?: () => void | Promise<void>;
}

export interface UseCohiChatOptions {
  tenantId?: string;
  enabled?: boolean;
  onError?: (error: Error) => void;
  /** Unified v1 chat_type (default `chat`; use `research` when mode selector lands in COHI-406). */
  chatType?: UnifiedChatType;
  /** Research-only: deep analysis toggle (§4.2). */
  researchDeepAnalysis?: boolean;
  /** NL PowerPoint / slides export (workbench editor, research report, viz deck). */
  presentationExportHandlers?: PresentationExportHandlers;
}

function emptyWorkbenchCanvasState(): CanvasStateSnapshot {
  return { groups: [], standaloneWidgets: [], totalItems: 0 };
}

function resolveWorkbenchDraftScopeId(): string {
  const bridge = getWorkbenchCanvasBridge();
  if (bridge?.isActive) return bridge.draftScopeId;
  return getOrCreateActiveWorkbenchDraftScope();
}

function buildWorkbenchRequestContext(draftScopeId?: string): Record<string, unknown> {
  const bridge = getWorkbenchCanvasBridge();
  if (bridge?.isActive) {
    return {
      canvasState: bridge.getCanvasSnapshot(),
      widgetCatalog: serializeWidgetCatalog(),
    };
  }
  const scopeId = draftScopeId ?? resolveWorkbenchDraftScopeId();
  const canvasState =
    getWorkbenchCanvasSnapshotForDraft(scopeId) ?? emptyWorkbenchCanvasState();
  return {
    canvasState,
    widgetCatalog: serializeWidgetCatalog(),
  };
}

/** Pre-unified workbench threads stored in `cohi_conversations`. */
async function loadLegacyWorkbenchConversationMessages(
  conversationId: string,
  tenantId: string | null,
): Promise<ChatMessage[] | null> {
  const qs = tenantId ? `?tenant_id=${encodeURIComponent(tenantId)}` : "";
  try {
    const conv = await api.request<{
      messages: Array<{
        id?: string;
        role: string;
        content: string;
        actions?: WidgetAction[];
        timestamp?: string | Date;
      }>;
    }>(`/api/cohi-chat/workbench/conversations/${conversationId}${qs}`);
    if (!conv?.messages?.length) return null;
    return conv.messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m, i) => ({
        id: m.id ?? `legacy-wb-${i}`,
        role: m.role as "user" | "assistant",
        content: m.content ?? "",
        timestamp: new Date(m.timestamp ?? Date.now()),
        ...(m.role === "assistant" && m.actions?.length
          ? { workbenchActions: m.actions }
          : {}),
      }));
  } catch {
    return null;
  }
}

// ============================================================================
// Hook
// ============================================================================

export function useCohiChat(options: UseCohiChatOptions = {}) {
  const {
    tenantId,
    enabled = true,
    onError,
    chatType = "chat",
    researchDeepAnalysis = false,
    presentationExportHandlers,
  } = options;

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [legacyRef, setLegacyRef] = useState<string | null>(null);
  const [suggestedQuestions, setSuggestedQuestions] = useState<string[]>(
    DEFAULT_CHAT_SUGGESTIONS,
  );
  const [chatSessions, setChatSessions] = useState<ChatSession[]>([]);
  const [isLoadingSessions, setIsLoadingSessions] = useState(false);
  const [loadingSessionId, setLoadingSessionId] = useState<string | null>(null);
  const isLoadingSession = loadingSessionId !== null;

  const messageIdCounter = useRef(0);
  const messagesRef = useRef<ChatMessage[]>([]);
  const sessionIdRef = useRef<string | null>(null);
  const viewingSessionRef = useRef<string | null>(null);
  /** Conversation id for the in-flight unified stream (may differ from sessionId until React commits). */
  const activeStreamConversationRef = useRef<string | null>(null);
  /** After first canvas save, block scope sync from swapping away the active transcript. */
  const workbenchCanvasSavePreserveRef = useRef<{
    conversationId: string;
    until: number;
  } | null>(null);
  /** Last non-empty workbench transcript — restored if scope sync clears the pane. */
  const workbenchPinnedTranscriptRef = useRef<{
    conversationId: string;
    messages: ChatMessage[];
    until: number;
  } | null>(null);
  /** Chat / research / insight_builder — survive loadSession races on slow envs. */
  const globalPinnedTranscriptRef = useRef<{
    conversationId: string;
    messages: ChatMessage[];
    until: number;
  } | null>(null);
  /** Client optimistic id → server conversation id while a turn is in flight. */
  const conversationIdAliasRef = useRef<Map<string, string>>(new Map());
  const loadSessionGenerationRef = useRef(0);
  /** Set from research stream metadata before poll-mode stream closes. */
  const activeResearchSessionIdRef = useRef<string | null>(null);
  const pendingCarryOverRef = useRef<CarryOverContext | null>(null);
  const pendingModeHandoffRef = useRef<ModeHandoffContext | null>(null);
  const dismissedForkCarryOverRef = useRef<CarryOverContext | null>(null);
  const forkUndoRef = useRef<ChatTypeForkUndoState | null>(null);
  const workbenchSessionsInflightRef = useRef<Promise<void> | null>(null);
  const workbenchSessionsLastAtRef = useRef(0);
  const [conversationForkLinks, setConversationForkLinks] =
    useState<ConversationForkLinks | null>(null);
  /** True after chat-type fork until the first message is sent (carry-over not persisted). */
  const [hasPendingForkCarryOver, setHasPendingForkCarryOver] = useState(false);

  const WORKBENCH_SESSIONS_MIN_INTERVAL_MS = 2_000;

  useEffect(() => {
    viewingSessionRef.current = sessionId;
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const stripWorkbenchLoadingFlags = useCallback(
    (msgs: ChatMessage[]): ChatMessage[] =>
      msgs.map((m) => {
        if (m.role !== "assistant") return m;
        let next = m;
        if (m.isLoading) {
          next = { ...next, isLoading: false };
        }
        if (isGenericWorkbenchAck(next.content)) {
          next = { ...next, content: "" };
        }
        return next;
      }),
    [],
  );

  const pinWorkbenchTranscript = useCallback(
    (conversationId: string, transcript: ChatMessage[]) => {
      if (!conversationId || transcript.length === 0) return;
      workbenchPinnedTranscriptRef.current = {
        conversationId,
        messages: stripWorkbenchLoadingFlags(transcript),
        until: Date.now() + 120_000,
      };
    },
    [stripWorkbenchLoadingFlags],
  );

  const pinGlobalTranscript = useCallback(
    (conversationId: string, transcript: ChatMessage[]) => {
      if (!conversationId || transcript.length === 0) return;
      const cleaned = transcript.map((m) => {
        if (m.role !== "assistant" || !m.isLoading) return m;
        return { ...m, isLoading: false };
      });
      globalPinnedTranscriptRef.current = {
        conversationId,
        messages: cleaned,
        until: Date.now() + 120_000,
      };
    },
    [],
  );

  const conversationIdsForActiveThread = useCallback(
    (targetSessionId: string): Set<string> => {
      const ids = new Set<string>();
      if (targetSessionId) ids.add(targetSessionId);
      for (const id of [
        sessionIdRef.current,
        viewingSessionRef.current,
        activeStreamConversationRef.current,
      ]) {
        if (id) ids.add(id);
      }
      for (const [clientId, serverId] of conversationIdAliasRef.current) {
        if (ids.has(clientId)) ids.add(serverId);
        if (ids.has(serverId)) ids.add(clientId);
      }
      return ids;
    },
    [],
  );

  const isConversationActive = useCallback(
    (targetSessionId: string) =>
      conversationIdsForActiveThread(targetSessionId).has(targetSessionId),
    [conversationIdsForActiveThread],
  );

  /** Recover transcript if scope sync cleared messages while the thread is still active. */
  useEffect(() => {
    if (chatType !== "workbench" || messages.length > 0) return;
    const pinned = workbenchPinnedTranscriptRef.current;
    if (!pinned || Date.now() > pinned.until || pinned.messages.length === 0) {
      return;
    }
    const activeId =
      sessionIdRef.current ??
      viewingSessionRef.current ??
      activeStreamConversationRef.current;
    if (activeId && activeId !== pinned.conversationId) return;
    setMessages(pinned.messages);
    setSessionId(pinned.conversationId);
    viewingSessionRef.current = pinned.conversationId;
    sessionIdRef.current = pinned.conversationId;
  }, [messages.length, chatType]);

  /** Recover global chat transcript if loadSession cleared the pane mid-turn. */
  useEffect(() => {
    if (chatType === "workbench" || messages.length > 0) return;
    const pinned = globalPinnedTranscriptRef.current;
    if (!pinned || Date.now() > pinned.until || pinned.messages.length === 0) {
      return;
    }
    const activeId =
      sessionIdRef.current ??
      viewingSessionRef.current ??
      activeStreamConversationRef.current;
    if (activeId && activeId !== pinned.conversationId) {
      const aliases = conversationIdAliasRef.current;
      const matchesAlias =
        aliases.get(activeId) === pinned.conversationId ||
        aliases.get(pinned.conversationId) === activeId;
      if (!matchesAlias) return;
    }
    setMessages(pinned.messages);
    setSessionId(pinned.conversationId);
    viewingSessionRef.current = pinned.conversationId;
    sessionIdRef.current = pinned.conversationId;
  }, [messages.length, chatType]);

  const applyMessagesForStream = useCallback(
    (
      streamConversationId: string,
      updater: (prev: ChatMessage[]) => ChatMessage[],
    ) => {
      const viewing = viewingSessionRef.current;
      const session = sessionIdRef.current;
      const activeStream = activeStreamConversationRef.current;
      const isActiveStream =
        activeStream === streamConversationId ||
        viewing === streamConversationId ||
        session === streamConversationId;
      if (!isActiveStream) return;
      setMessages(updater);
    },
    [],
  );

  /**
   * Replace the streaming placeholder with the final assistant turn.
   * Always uses setMessages so the UI clears "Analyzing…" even when stream
   * scope refs were cleared by canvas-save scope sync mid-flight.
   */
  const finalizeWorkbenchAssistantMessage = useCallback(
    (
      conversationId: string,
      assistantMessageId: string,
      patch: Omit<ChatMessage, "id" | "role"> & Partial<Pick<ChatMessage, "role">>,
    ): ChatMessage[] => {
      const updater = (prev: ChatMessage[]) => {
        const existing = prev.find((m) => m.id === assistantMessageId);
        const appliedCount = patch.workbenchActionsAppliedCount ?? 0;
        const content = resolveWorkbenchAssistantContent({
          parsedContent: patch.content,
          streamedContent: existing?.content,
          appliedCount,
        });
        const finalized: ChatMessage = {
          ...existing,
          ...patch,
          id: assistantMessageId,
          role: "assistant",
          content,
          isLoading: false,
          timestamp: patch.timestamp ?? existing?.timestamp ?? new Date(),
          workbenchActions:
            patch.workbenchActions ?? existing?.workbenchActions,
          workbenchActionsAppliedCount:
            patch.workbenchActionsAppliedCount ??
            existing?.workbenchActionsAppliedCount,
          workbenchPendingActions:
            patch.workbenchPendingActions ?? existing?.workbenchPendingActions,
        };
        return prev.map((m) => (m.id === assistantMessageId ? finalized : m));
      };
      applyMessagesForStream(conversationId, updater);
      let next: ChatMessage[] = [];
      setMessages((prev) => {
        next = updater(prev);
        return next;
      });
      return next;
    },
    [applyMessagesForStream],
  );

  /**
   * Replace the streaming placeholder with the final assistant turn (global chat types).
   * Uses setMessages as well as applyMessagesForStream so the UI clears "Analyzing…"
   * even when stream scope refs were cleared by a concurrent loadSession.
   */
  const finalizeGlobalAssistantMessage = useCallback(
    (
      conversationId: string,
      assistantMessageId: string,
      assistantMessage: ChatMessage,
    ): ChatMessage[] => {
      const updater = (prev: ChatMessage[]) =>
        prev.map((m) => (m.id === assistantMessageId ? assistantMessage : m));
      applyMessagesForStream(conversationId, updater);
      let next: ChatMessage[] = [];
      setMessages((prev) => {
        next = updater(prev);
        return next;
      });
      return next;
    },
    [applyMessagesForStream],
  );

  /** Align client stream id with server conversation id when they diverge (legacy resume). */
  const reconcileStreamConversationId = useCallback(
    (clientStreamId: string, serverConversationId: string) => {
      const resolved = serverConversationId || clientStreamId;
      if (!resolved || resolved === clientStreamId) {
        viewingSessionRef.current = resolved;
        sessionIdRef.current = resolved;
        return resolved;
      }
      conversationIdAliasRef.current.set(clientStreamId, resolved);
      conversationIdAliasRef.current.set(resolved, clientStreamId);
      activeStreamConversationRef.current = resolved;
      viewingSessionRef.current = resolved;
      sessionIdRef.current = resolved;
      setSessionId(resolved);
      const runStore = useUnifiedChatRunStore.getState();
      if (runStore.isRunning(clientStreamId)) {
        const meta = runStore.runs[clientStreamId];
        runStore.endRun(clientStreamId);
        if (meta) {
          runStore.startRun({ ...meta, conversationId: resolved });
        }
      }
      return resolved;
    },
    [],
  );

  /** When deferred research PPT completes, show the download card (status building → ready). */
  const fulfillDeferredResearchPptExport = useCallback(
    (opts?: { title?: string; slideCount?: number }) => {
      setMessages((prev) => {
        const target = [...prev]
          .reverse()
          .find(
            (m) =>
              m.role === "assistant" &&
              m.pptExport?.exportKind === "research_report" &&
              m.pptExport.status === "building",
          );
        if (!target?.pptExport) return prev;
        return prev.map((m) =>
          m.id === target.id
            ? {
                ...m,
                pptExport: {
                  ...m.pptExport!,
                  status: "ready" as const,
                  title: opts?.title ?? m.pptExport!.title,
                  slideCount: opts?.slideCount ?? m.pptExport!.slideCount,
                },
              }
            : m,
        );
      });
    },
    [],
  );

  const setLoadingForStream = useCallback(
    (streamConversationId: string, loading: boolean) => {
      if (viewingSessionRef.current === streamConversationId) {
        setIsLoading(loading);
      }
    },
    [],
  );
  const defaultTenantIdRef = useRef<string | null | undefined>(undefined);

  const [workbenchSavedCanvasId, setWorkbenchSavedCanvasId] = useState<
    string | null
  >(null);
  const [workbenchChatScope, setWorkbenchChatScope] = useState<
    WorkbenchChatScopeRef | null
  >(() =>
    typeof window !== "undefined"
      ? readPersistedWorkbenchConversationScope()
      : null,
  );
  const [workbenchScopePinned, setWorkbenchScopePinned] = useState(false);
  const [workbenchPinnedScopeLabel, setWorkbenchPinnedScopeLabel] = useState<
    string | null
  >(null);
  const [pendingScopeSwitchTarget, setPendingScopeSwitchTarget] =
    useState<WorkbenchActiveContext | null>(null);
  const [scopeMismatchActions, setScopeMismatchActions] =
    useState<WorkbenchScopeMismatchActionsDetail | null>(null);
  const lastSyncedWorkbenchScopeKeyRef = useRef<string | null>(null);
  /** When set, sync must not auto-load the latest thread for this scope (user chose New chat). */
  const workbenchFreshThreadScopeKeyRef = useRef<string | null>(null);

  const setWorkbenchChatScopeRef = useCallback((scope: WorkbenchChatScopeRef | null) => {
    setWorkbenchChatScope(scope);
    persistWorkbenchConversationScope(scope);
    if (scope?.label) {
      setWorkbenchPinnedScopeLabel(scope.label);
    }
  }, []);

  const tryDeliverWorkbenchWidgetActions = useCallback(
    (
      draftScopeId: string,
      actions: WidgetAction[],
      conversationScope: WorkbenchChatScopeRef,
      conversationId: string | null,
    ): number => {
      if (!actions.length) return 0;
      if (
        isWorkbenchChatScopeSyncEnabled() &&
        !isWorkbenchScopeAlignedWithActiveTab(conversationScope)
      ) {
        const active = getLatestWorkbenchActiveContext();
        if (
          isWorkbenchNewCanvasHandoffActive() ||
          (active && !active.isSavedCanvas)
        ) {
          const targetDraft = active?.draftScopeId ?? draftScopeId;
          deliverWorkbenchWidgetActions(targetDraft, actions);
          return actions.length;
        }
        dispatchWorkbenchScopeMismatchActions({
          actions,
          conversationScope,
          draftScopeId,
          conversationId,
        });
        setScopeMismatchActions({
          actions,
          conversationScope,
          draftScopeId,
          conversationId,
        });
        return 0;
      }
      deliverWorkbenchWidgetActions(draftScopeId, actions);
      return actions.length;
    },
    [],
  );

  const applyWorkbenchDashboardSuggestion = useCallback(
    (action: WidgetAction) => {
      if (action.type !== "suggest_dashboard") return;
      const draftScopeId = getOrCreateActiveWorkbenchDraftScope();
      deliverWorkbenchWidgetActions(draftScopeId, [action], {
        allowDashboardSuggestions: true,
      });
    },
    [],
  );

  const resetWorkbenchChatSession = useCallback(() => {
    const urlCanvasId =
      typeof window !== "undefined" ? getMyDashboardCanvasIdFromPath() : null;
    const bridge = getWorkbenchCanvasBridge();
    const canvasId = bridge?.canvasId ?? urlCanvasId ?? null;

    if (canvasId) {
      const scopeId = draftScopeIdForCanvasTab(canvasId);
      setActiveWorkbenchDraftScope(scopeId);
      rememberWorkbenchDraftTab(scopeId, canvasId);
      markWorkbenchCanvasNavBound();
      setWorkbenchSavedCanvasId(canvasId);
      return;
    }

    resetActiveWorkbenchDraftSession();
    setWorkbenchSavedCanvasId(null);
    setWorkbenchChatScope(null);
    clearPersistedWorkbenchConversationScope();
    setWorkbenchScopePinned(false);
    setWorkbenchPinnedScopeLabel(null);
    setPendingScopeSwitchTarget(null);
    setScopeMismatchActions(null);
  }, []);

  useEffect(() => {
    setSuggestedQuestions(defaultSuggestionsForChatType(chatType));
  }, [chatType]);

  /** Resolve tenant for request */
  const getEffectiveTenantId = useCallback(async (): Promise<string | null> => {
    if (tenantId) return tenantId;
    if (defaultTenantIdRef.current !== undefined)
      return defaultTenantIdRef.current;
    try {
      const response = await api.request<
        { tenants: { id: string }[] } | { id: string }[]
      >("/api/tenants");
      const list = Array.isArray(response)
        ? response
        : (response as any).tenants || [];
      const first = list[0];
      if (first?.id) {
        defaultTenantIdRef.current = first.id;
        return defaultTenantIdRef.current;
      }
    } catch {
      /* ignore */
    }
    try {
      const defaultRes = await api.request<{ tenantId: string | null }>(
        "/api/cohi-chat/default-tenant"
      );
      defaultTenantIdRef.current = defaultRes?.tenantId ?? null;
      return defaultTenantIdRef.current;
    } catch {
      defaultTenantIdRef.current = null;
      return null;
    }
  }, [tenantId]);

  useEffect(() => {
    if (chatType !== "workbench") return;
    const onSaved = (e: Event) => {
      const detail = (e as CustomEvent<WorkbenchCanvasSavedDetail>).detail;
      if (!detail?.canvasId) return;

      const activeConversationId =
        sessionIdRef.current ??
        activeStreamConversationRef.current ??
        viewingSessionRef.current;

      const promoteScopeAfterCanvasSave = () => {
        suppressNextWorkbenchScopePrompt(8);
        const scopeRef = buildWorkbenchChatScopeAfterCanvasSave(detail);
        setWorkbenchChatScopeRef(scopeRef);
        setWorkbenchSavedCanvasId(detail.canvasId);
        setWorkbenchScopePinned(false);
        setPendingScopeSwitchTarget(null);
        setScopeMismatchActions(null);
        const canvasDraftScope = draftScopeIdForCanvasTab(detail.canvasId);
        setActiveWorkbenchDraftScope(canvasDraftScope);
        rememberWorkbenchDraftTab(canvasDraftScope, detail.canvasId);
        if (detail.draftScopeId) {
          rememberWorkbenchDraftTab(detail.draftScopeId, detail.canvasId);
        }
        const canvasScopeKey = `canvas:${detail.canvasId}`;
        workbenchFreshThreadScopeKeyRef.current = canvasScopeKey;
        lastSyncedWorkbenchScopeKeyRef.current = canvasScopeKey;
        if (activeConversationId) {
          workbenchCanvasSavePreserveRef.current = {
            conversationId: activeConversationId,
            until: Date.now() + 120_000,
          };
          viewingSessionRef.current = activeConversationId;
          sessionIdRef.current = activeConversationId;
          setSessionId(activeConversationId);
          if (messagesRef.current.length > 0) {
            pinWorkbenchTranscript(activeConversationId, messagesRef.current);
          }
          scheduleWorkbenchTranscriptRefresh(activeConversationId);
        }
        dispatchWorkbenchBindCanvas(detail.canvasId);
      };

      const conversationScope =
        readPersistedWorkbenchConversationScope();
      const shouldPromote =
        shouldPromoteWorkbenchChatScopeOnCanvasSave(detail, conversationScope) ||
        (!!activeConversationId &&
          messagesRef.current.length > 0 &&
          !!detail.draftScopeId);

      if (shouldPromote) {
        promoteScopeAfterCanvasSave();
        if (activeConversationId && typeof window !== "undefined") {
          void (async () => {
            try {
              const effectiveTenantId = await getEffectiveTenantId();
              if (!effectiveTenantId) return;
              const client = createUnifiedChatClient(
                tenantId ?? effectiveTenantId,
              );
              await client.rebindConversation(activeConversationId, {
                scope: { type: "canvas", id: detail.canvasId },
                chat_type: "workbench",
              });
            } catch (err) {
              console.warn(
                "[useCohiChat] rebind conversation after canvas save:",
                err,
              );
            }
          })();
        }
        return;
      }

      if (detail.draftScopeId) {
        const activeDraft = getOrCreateActiveWorkbenchDraftScope();
        if (detail.draftScopeId === activeDraft) {
          setWorkbenchSavedCanvasId(detail.canvasId);
          const canvasScopeKey = `canvas:${detail.canvasId}`;
          workbenchFreshThreadScopeKeyRef.current = canvasScopeKey;
          lastSyncedWorkbenchScopeKeyRef.current = canvasScopeKey;
          if (activeConversationId) {
            workbenchCanvasSavePreserveRef.current = {
              conversationId: activeConversationId,
              until: Date.now() + 120_000,
            };
            if (messagesRef.current.length > 0) {
              pinWorkbenchTranscript(activeConversationId, messagesRef.current);
            }
            scheduleWorkbenchTranscriptRefresh(activeConversationId);
          }
        }
      }
    };
    const onBind = (e: Event) => {
      const canvasId = (e as CustomEvent<{ canvasId?: string }>).detail?.canvasId;
      if (canvasId) setWorkbenchSavedCanvasId(canvasId);
    };
    window.addEventListener(WORKBENCH_CANVAS_SAVED_EVENT, onSaved);
    window.addEventListener(COHI_WORKBENCH_BIND_CANVAS_EVENT, onBind);
    return () => {
      window.removeEventListener(WORKBENCH_CANVAS_SAVED_EVENT, onSaved);
      window.removeEventListener(COHI_WORKBENCH_BIND_CANVAS_EVENT, onBind);
    };
  }, [
    chatType,
    setWorkbenchChatScopeRef,
    getEffectiveTenantId,
    tenantId,
    pinWorkbenchTranscript,
  ]);

  // Resolve linked conversation titles when we only have fork UUIDs (e.g. mid-fork UI).
  useEffect(() => {
    if (!enabled || typeof window === "undefined" || !isUnifiedChatClientEnabled()) {
      return;
    }
    const links = conversationForkLinks;
    if (!links) return;
    const parentId = links.parentConversationId;
    const childId = links.forkedToConversationId;
    if (
      (!parentId || links.parentTitle) &&
      (!childId || links.forkedToTitle)
    ) {
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const effectiveTenantId = await getEffectiveTenantId();
        const client = createUnifiedChatClient(tenantId ?? effectiveTenantId);
        const [parentRow, childRow] = await Promise.all([
          parentId && !links.parentTitle
            ? client.getConversation(parentId).catch(() => null)
            : null,
          childId && !links.forkedToTitle
            ? client.getConversation(childId).catch(() => null)
            : null,
        ]);
        if (cancelled) return;
        setConversationForkLinks((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            ...(parentRow?.title ? { parentTitle: parentRow.title } : {}),
            ...(childRow?.title ? { forkedToTitle: childRow.title } : {}),
          };
        });
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    enabled,
    conversationForkLinks?.parentConversationId,
    conversationForkLinks?.forkedToConversationId,
    conversationForkLinks?.parentTitle,
    conversationForkLinks?.forkedToTitle,
    getEffectiveTenantId,
    tenantId,
  ]);

  // Initialize session when chat is active and tenant context is available.
  useEffect(() => {
    if (!enabled || sessionId) return;
    if (typeof window !== "undefined" && isUnifiedChatClientEnabled()) return;

    const initSession = async () => {
      try {
        const effectiveTenantId = await getEffectiveTenantId();
        if (!effectiveTenantId) {
          return;
        }

        const response = await api.request<{ sessionId: string }>(
          `/api/cohi-chat/new-session?tenant_id=${encodeURIComponent(effectiveTenantId)}`,
          { method: "POST" }
        );
        if (response.sessionId) {
          setSessionId(response.sessionId);
        }
      } catch (error) {
        console.error("[CohiChat] Failed to create session:", error);
      }
    };
    initSession();
  }, [enabled, getEffectiveTenantId, sessionId]);

  /**
   * Generate unique message ID
   */
  const generateMessageId = useCallback(() => {
    messageIdCounter.current += 1;
    return `msg-${Date.now()}-${messageIdCounter.current}`;
  }, []);

  const applyUnifiedStreamEvent = useCallback(
    (ev: import("@/lib/unifiedChatClient").ChatStreamEvent) => {
      if (ev.conversationId) {
        setSessionId(ev.conversationId);
      }
      const researchSessionId = ev.metadata?.researchSessionId;
      if (typeof researchSessionId === "string" && researchSessionId) {
        activeResearchSessionIdRef.current = researchSessionId;
        setLegacyRef(researchSessionId);
      }
    },
    [],
  );

  const runPresentationExportAfterTurn = useCallback(
    async (
      conversationId: string,
      assistantMessageId: string,
      metadata: Record<string, unknown> | undefined,
      userQuestion: string,
      activeChatType: UnifiedChatType,
      messagesOverride?: ChatMessage[],
    ) => {
      let snapshot: ChatMessage[] = messagesOverride ?? [];
      if (!messagesOverride) {
        applyMessagesForStream(conversationId, (prev) => {
          snapshot = prev;
          return prev;
        });
      }
      const updated = await import("@/lib/applyPresentationExportAfterTurn").then(
        (m) =>
          m.applyPresentationExportAfterTurn({
            messages: snapshot,
            assistantMessageId,
            chatType: activeChatType,
            metadata,
            userQuestion,
            onOpenWorkbenchEditor:
              presentationExportHandlers?.onOpenWorkbenchEditor,
          }),
      );
      if (messagesOverride || viewingSessionRef.current === conversationId) {
        applyMessagesForStream(conversationId, () => updated);
      }
    },
    [applyMessagesForStream, presentationExportHandlers],
  );

  const bindResearchSessionAfterStream = useCallback(
    async (
      client: ReturnType<typeof createUnifiedChatClient>,
      conversationId: string,
      researchSessionId?: string | null,
    ) => {
      const bound =
        researchSessionId ?? activeResearchSessionIdRef.current ?? null;
      if (bound) {
        activeResearchSessionIdRef.current = bound;
        setLegacyRef(bound);
      }
      const loadForkLinks = async (attempt = 0): Promise<void> => {
        try {
          const row = await client.getConversation(conversationId);
          if (row.legacy_ref) {
            activeResearchSessionIdRef.current = row.legacy_ref;
            setLegacyRef(row.legacy_ref);
          }
          const links = forkLinksFromConversationRow(row);
          if (links) setConversationForkLinks(links);
        } catch (err) {
          if (attempt < 4) {
            await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
            return loadForkLinks(attempt + 1);
          }
          console.warn("[CohiChat] Failed to bind research session:", err);
        }
      };
      void loadForkLinks();
    },
    [],
  );

  /** Drop unified conversation binding when leaving workbench mode (e.g. switch to research on canvas). */
  const clearConversationBinding = useCallback(() => {
    viewingSessionRef.current = null;
    setSessionId(null);
    setLegacyRef(null);
    activeResearchSessionIdRef.current = null;
  }, []);

  const stageModeHandoff = useCallback((handoff: ModeHandoffContext | null) => {
    pendingModeHandoffRef.current = handoff;
  }, []);

  const consumeModeHandoff = useCallback((): ModeHandoffContext | null => {
    const handoff = pendingModeHandoffRef.current;
    pendingModeHandoffRef.current = null;
    return handoff;
  }, []);

  /**
   * Send a question and get AI response
   */
  const sendMessage = useCallback(
    async (question: string, options?: SendMessageOptions) => {
      const datasetIds =
        options?.datasetUploadIds && options.datasetUploadIds.length > 0
          ? options.datasetUploadIds
          : undefined;
      const hasDatasetOnly = !!datasetIds && !question.trim();
      if (!question.trim() && !hasDatasetOnly) return;

      if (chatType === "workbench" && !options?.forceNewConversation) {
        const ctx = getLatestWorkbenchActiveContext();
        if (ctx) {
          const scopeRef = activeContextToScopeRef(ctx);
          workbenchFreshThreadScopeKeyRef.current = `${scopeRef.type}:${scopeRef.id}`;
        }
      }

      const forceNew = options?.forceNewConversation ?? false;
      const carryOver =
        options?.carryOverContext ?? pendingCarryOverRef.current ?? undefined;
      if (carryOver) {
        pendingCarryOverRef.current = null;
        dismissedForkCarryOverRef.current = null;
        setHasPendingForkCarryOver(false);
      }
      const modeHandoff = consumeModeHandoff();
      const dashboardGrounding =
        !modeHandoff &&
        (chatType === "research" || chatType === "insight_builder")
          ? buildDashboardGroundingContext()
          : null;
      const priorMessages = forceNew ? [] : messages;
      const activeSessionId = forceNew ? null : sessionId;

      if (
        !forceNew &&
        activeSessionId &&
        useUnifiedChatRunStore.getState().isRunning(activeSessionId)
      ) {
        return;
      }
      if (!forceNew && isLoading) return;
      const priorLegacyRef = forceNew ? null : legacyRef;
      const effectiveQuestion =
        question.trim() ||
        (datasetIds ? "Analyze the attached dataset." : "");
      const researchUploadIds =
        chatType === "research" &&
        (forceNew || (!activeSessionId && !priorLegacyRef)) &&
        (options?.researchUploadIds?.length || datasetIds?.length)
          ? [...new Set([...(options?.researchUploadIds ?? []), ...(datasetIds ?? [])])]
          : undefined;
      const datasetUploadIdsForSend =
        chatType === "chat" || chatType === "workbench" ? datasetIds : datasetIds;
      const isNewConversation = forceNew || !activeSessionId;
      let pendingHistoryRefresh = false;

      const userMessageId = generateMessageId();
      const assistantMessageId = generateMessageId();

      // Add user message
      const userMessage: ChatMessage = {
        id: userMessageId,
        role: "user",
        content: effectiveQuestion,
        timestamp: new Date(),
      };

      const loadingMessage: ChatMessage = {
        id: assistantMessageId,
        role: "assistant",
        content: "",
        timestamp: new Date(),
        isLoading: true,
      };

      if (chatType === "research" && isNewConversation) {
        activeResearchSessionIdRef.current = null;
        setLegacyRef(null);
      }

      if (forceNew) {
        viewingSessionRef.current = null;
        setSuggestedQuestions([]);
        setLegacyRef(null);
        setSessionId(null);
        // Draft scope + canvas nav are owned by navigateForWorkbenchChatSubmit (panel);
        // only clear saved-canvas binding when starting a new conversation.
        if (chatType === "workbench") {
          const activeCtx = getLatestWorkbenchActiveContext();
          if (!activeCtx?.isSavedCanvas) {
            setWorkbenchSavedCanvasId(null);
          }
        }
        const prelude: ChatMessage[] = [];
        if (carryOver?.summary?.trim()) {
          prelude.push({
            id: generateMessageId(),
            role: "assistant",
            content: `Continuing from **${carryOver.fromTitle ?? "previous canvas"}**:\n\n${carryOver.summary}`,
            timestamp: new Date(),
          });
        }
        setMessages([...prelude, userMessage, loadingMessage]);
      } else {
        setMessages((prev) => [...prev, userMessage, loadingMessage]);
      }

      let streamConversationIdForRun = activeSessionId;

      try {
        const effectiveTenantId = await getEffectiveTenantId();

        if (typeof window !== "undefined" && isUnifiedChatClientEnabled()) {
          const client = createUnifiedChatClient(tenantId ?? effectiveTenantId);
          const history = priorMessages.slice(-6).map((m) => ({
            role: m.role,
            content: m.content,
          }));

          const registerNewUnifiedConversation = (
            scope: UnifiedConversationSummary["scope"],
          ) => {
            const id = crypto.randomUUID();
            setSessionId(id);
            viewingSessionRef.current = id;
            if (carryOver) {
              setConversationForkLinks({
                parentConversationId: carryOver.fromConversationId,
                parentTitle: carryOver.fromTitle ?? "Previous chat",
              });
            }
            notifyOptimisticUnifiedChatConversation(
              buildOptimisticUnifiedConversation({
                id,
                title: effectiveQuestion,
                chatType,
                scope,
                parentConversationId: carryOver?.fromConversationId,
              }),
            );
            pendingHistoryRefresh = true;
            return id;
          };

          const beginStreamRun = (conversationId: string) => {
            streamConversationIdForRun = conversationId;
            activeStreamConversationRef.current = conversationId;
            viewingSessionRef.current = conversationId;
            sessionIdRef.current = conversationId;
            useUnifiedChatRunStore.getState().startRun({
              conversationId,
              title: effectiveQuestion.slice(0, 120),
              chatType,
              startedAt: Date.now(),
            });
            setLoadingForStream(conversationId, true);
            setIsLoading(true);
          };

          const endStreamRun = (conversationId: string) => {
            useUnifiedChatRunStore.getState().endRun(conversationId);
            setLoadingForStream(conversationId, false);
            if (activeStreamConversationRef.current === conversationId) {
              activeStreamConversationRef.current = null;
            }
          };

          if (chatType === "workbench") {
            const { draftScopeId, scopeRef } = resolveWorkbenchTurnScope(
              workbenchSavedCanvasId,
            );
            if (scopeRef.type === "canvas") {
              setWorkbenchSavedCanvasId(scopeRef.id);
            } else {
              setWorkbenchSavedCanvasId(null);
            }
            setActiveWorkbenchDraftScope(draftScopeId);
            setWorkbenchChatScopeRef(scopeRef);
            setWorkbenchScopePinned(false);
            const streamConversationId = isNewConversation
              ? registerNewUnifiedConversation({
                  type: scopeRef.type,
                  id: scopeRef.id,
                })
              : activeSessionId!;
            beginStreamRun(streamConversationId);

            const { conversationId, parsed, streamMetadata } =
              await sendUnifiedWorkbenchStream({
              client,
              message: effectiveQuestion,
              conversationId: streamConversationId,
              scope: { type: scopeRef.type, id: scopeRef.id },
              context: {
                ...buildWorkbenchRequestContext(draftScopeId),
                ...(carryOver ? { carryOverContext: carryOver } : {}),
              },
              history,
              datasetUploadIds: datasetUploadIdsForSend,
              onStreamText: (text) => {
                applyMessagesForStream(streamConversationId, (prev) =>
                  prev.map((m) =>
                    m.id === assistantMessageId
                      ? { ...m, content: text, isLoading: true }
                      : m,
                  ),
                );
              },
            });
            const resolvedConversationId = reconcileStreamConversationId(
              streamConversationId,
              conversationId,
            );

            const gatedActions = gateWorkbenchActionsForUserQuestion(
              parsed.actions,
              effectiveQuestion,
            );
            const { autoApply, pendingConfirmation } =
              partitionWorkbenchActionsForAutoApply(gatedActions);
            const appliedCount =
              autoApply.length > 0
                ? tryDeliverWorkbenchWidgetActions(
                    draftScopeId,
                    autoApply,
                    scopeRef,
                    resolvedConversationId,
                  )
                : 0;

            const messagesAfterTurn = finalizeWorkbenchAssistantMessage(
              resolvedConversationId,
              assistantMessageId,
              {
                content: parsed.error
                  ? `${parsed.message}\n${parsed.error}`
                  : parsed.message,
                timestamp: new Date(),
                workbenchActions:
                  gatedActions.length > 0 ? gatedActions : undefined,
                workbenchActionsAppliedCount: appliedCount,
                workbenchPendingActions:
                  pendingConfirmation.length > 0
                    ? pendingConfirmation
                    : undefined,
              },
            );
            if (parsed.suggestedQuestions?.length) {
              setSuggestedQuestions(parsed.suggestedQuestions);
            }
            const pptMeta = parsePresentationExportMetadata(streamMetadata);
            const wantsWorkbenchPpt =
              isWorkbenchPresentationChatRequest(effectiveQuestion) ||
              pptMeta?.wantsPresentationExport === true ||
              streamMetadata?.openReportBuilder === true ||
              autoApply.some((a) => a.type === "generate_report");
            if (wantsWorkbenchPpt) {
              requestOpenWorkbenchReportBuilderFromChat({
                messages: messagesAfterTurn,
                assistantMessageId,
                userQuestion: effectiveQuestion,
                mode: pptMeta?.mode ?? "create",
              });
            }
            void client.getConversation(resolvedConversationId).then((row) => {
              const links = forkLinksFromConversationRow(row);
              if (links) setConversationForkLinks(links);
            });
            endStreamRun(resolvedConversationId);
            workbenchCanvasSavePreserveRef.current = {
              conversationId: resolvedConversationId,
              until: Date.now() + 120_000,
            };
            if (messagesAfterTurn.length > 0) {
              pinWorkbenchTranscript(resolvedConversationId, messagesAfterTurn);
            }
            workbenchFreshThreadScopeKeyRef.current = `${scopeRef.type}:${scopeRef.id}`;
            lastSyncedWorkbenchScopeKeyRef.current =
              workbenchFreshThreadScopeKeyRef.current;
            void runPresentationExportAfterTurn(
              resolvedConversationId,
              assistantMessageId,
              streamMetadata,
              effectiveQuestion,
              "workbench",
              messagesAfterTurn,
            );
          } else {
            const ibOpts = options?.insightBuilder;
            let ibDraft = ibOpts?.draft;
            if (chatType === "insight_builder" && !ibDraft) {
              const lastWithDraft = [...priorMessages]
                .reverse()
                .find((m) => m.role === "assistant" && m.insightBuilderDraft);
              ibDraft = lastWithDraft?.insightBuilderDraft;
            }
            const approveClientMessageId =
              chatType === "insight_builder" &&
              ibOpts?.action === "approve" &&
              ibOpts.draft
                ? await insightBuilderApproveClientMessageId(ibOpts.draft)
                : undefined;
            const streamConversationId = isNewConversation
              ? registerNewUnifiedConversation({ type: "global_session" })
              : activeSessionId!;
            beginStreamRun(streamConversationId);
            const streamRouting = resolveGlobalStreamRouting({
              chatType,
              workbenchCanvasId: workbenchSavedCanvasId,
            });
            const {
              conversationId,
              parsed,
              researchPollMode,
              researchSessionId,
              streamMetadata,
            } = await sendUnifiedGlobalStream({
              client,
              message: effectiveQuestion,
              chatType,
              conversationId: streamConversationId,
              clientMessageId: approveClientMessageId,
              history,
              deepAnalysis: researchDeepAnalysis,
              uploadIds: researchUploadIds,
              datasetUploadIds: datasetUploadIdsForSend,
              location: streamRouting.location,
              scope: streamRouting.scope,
              context: {
                ...(chatType === "research" && priorLegacyRef
                  ? { legacyResearchSessionId: priorLegacyRef }
                  : ibDraft && chatType === "insight_builder"
                    ? { insightBuilderDraft: ibDraft }
                    : {}),
                ...(carryOver ? { carryOverContext: carryOver } : {}),
                ...(modeHandoff ? { modeHandoffContext: modeHandoff } : {}),
                ...(dashboardGrounding
                  ? { dashboardGrounding }
                  : {}),
              },
              insightBuilder:
                chatType === "insight_builder" && ibOpts?.action
                  ? { action: ibOpts.action }
                  : chatType === "insight_builder" && ibDraft
                    ? { action: "revise" }
                    : undefined,
              onStreamEvent: applyUnifiedStreamEvent,
              onStreamText: (text) => {
                if (chatType === "research") return;
                applyMessagesForStream(streamConversationId, (prev) =>
                  prev.map((m) =>
                    m.id === assistantMessageId
                      ? { ...m, content: text, isLoading: true }
                      : m,
                  ),
                );
              },
            });
            const resolvedConversationId = reconcileStreamConversationId(
              streamConversationId,
              conversationId,
            );
            const researchHandoffMessage =
              researchPollMode && parsed.message
                ? parsed.message
                : researchPollMode
                  ? "Research is running. View progress and findings in the Research workspace."
                  : parsed.message;
            const assistantMessage: ChatMessage = {
              id: assistantMessageId,
              role: "assistant",
              content: researchHandoffMessage,
              visualization: parsed.visualization as VisualizationConfig | undefined,
              data: undefined,
              timestamp: new Date(),
              sqlQuery: parsed.sqlQuery,
              sources: parsed.sources,
              navigationHints: parsed.navigationHints,
              insightBuilderDraft: parsed.insightBuilderDraft,
              insightBuilderPhase: parsed.insightBuilderPhase,
              visualizationArtifactId: parsed.visualizationArtifactId,
            };
            const messagesAfterTurn = finalizeGlobalAssistantMessage(
              resolvedConversationId,
              assistantMessageId,
              assistantMessage,
            );
            if (messagesAfterTurn.length > 0) {
              pinGlobalTranscript(resolvedConversationId, messagesAfterTurn);
            }
            if (parsed.suggestedQuestions?.length) {
              setSuggestedQuestions(parsed.suggestedQuestions);
            }
            if (chatType === "research") {
              await bindResearchSessionAfterStream(
                client,
                resolvedConversationId,
                researchSessionId,
              );
            } else {
              void client.getConversation(resolvedConversationId).then((row) => {
                const links = forkLinksFromConversationRow(row);
                if (links) setConversationForkLinks(links);
              });
            }
            endStreamRun(resolvedConversationId);
            void runPresentationExportAfterTurn(
              resolvedConversationId,
              assistantMessageId,
              streamMetadata,
              effectiveQuestion,
              chatType,
            );
          }
        } else {
          setIsLoading(true);
          const endpoint = effectiveTenantId
            ? `/api/cohi-chat/ask?tenant_id=${encodeURIComponent(effectiveTenantId)}`
            : "/api/cohi-chat/ask";

          const response = await api.request<CohiChatResponse>(endpoint, {
            method: "POST",
            body: JSON.stringify({
              question: question.trim(),
              sessionId: activeSessionId,
              conversationHistory: priorMessages.slice(-6).map((m) => ({
                id: m.id,
                role: m.role,
                content: m.content,
                timestamp: m.timestamp,
              })),
            }),
          });

          const assistantMessage: ChatMessage = {
            id: assistantMessageId,
            role: "assistant",
            content: response.message,
            visualization: response.visualization,
            data: response.data,
            timestamp: new Date(),
            error: response.error,
            sqlQuery: response.sqlQuery,
            sources: response.sources,
            navigationHints: response.navigationHints,
          };

          setMessages((prev) =>
            prev.map((m) => (m.id === assistantMessageId ? assistantMessage : m)),
          );

          if (response.suggestedQuestions) {
            setSuggestedQuestions(response.suggestedQuestions);
          }
          setIsLoading(false);
        }
      } catch (error: any) {
        const researchSessionId = activeResearchSessionIdRef.current;
        const researchStreamHandoff =
          chatType === "research" && !!researchSessionId;

        if (researchStreamHandoff) {
          console.warn(
            "[CohiChat] Research stream connection ended; session polling continues:",
            error?.message ?? error,
          );
          const handoffMessage: ChatMessage = {
            id: assistantMessageId,
            role: "assistant",
            content:
              "Research is running. View progress and findings in the Research workspace.",
            timestamp: new Date(),
          };
          if (streamConversationIdForRun) {
            applyMessagesForStream(streamConversationIdForRun, (prev) =>
              prev.map((m) =>
                m.id === assistantMessageId ? handoffMessage : m,
              ),
            );
            useUnifiedChatRunStore.getState().endRun(streamConversationIdForRun);
            setLoadingForStream(streamConversationIdForRun, false);
          } else {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMessageId ? handoffMessage : m,
              ),
            );
            setIsLoading(false);
          }
        } else {
          console.error("[CohiChat] Error sending message:", error);

          const errorMessage: ChatMessage = {
            id: assistantMessageId,
            role: "assistant",
            content:
              "I encountered an error processing your request. Please try again.",
            timestamp: new Date(),
            error: error.message,
          };

          if (streamConversationIdForRun) {
            applyMessagesForStream(streamConversationIdForRun, (prev) =>
              prev.map((m) => (m.id === assistantMessageId ? errorMessage : m)),
            );
            useUnifiedChatRunStore.getState().endRun(streamConversationIdForRun);
            setLoadingForStream(streamConversationIdForRun, false);
          } else {
            setMessages((prev) =>
              prev.map((m) => (m.id === assistantMessageId ? errorMessage : m)),
            );
            setIsLoading(false);
          }

          if (onError) {
            onError(error);
          }
        }
      } finally {
        if (pendingHistoryRefresh) {
          refreshUnifiedChatHistoryList();
        }
      }
    },
    [
      generateMessageId,
      getEffectiveTenantId,
      isLoading,
      messages,
      sessionId,
      legacyRef,
      tenantId,
      onError,
      chatType,
      researchDeepAnalysis,
      applyUnifiedStreamEvent,
      applyMessagesForStream,
      setLoadingForStream,
      workbenchSavedCanvasId,
      resetWorkbenchChatSession,
      finalizeGlobalAssistantMessage,
      pinGlobalTranscript,
      reconcileStreamConversationId,
      bindResearchSessionAfterStream,
      finalizeWorkbenchAssistantMessage,
      tryDeliverWorkbenchWidgetActions,
      setWorkbenchChatScopeRef,
      pinWorkbenchTranscript,
      runPresentationExportAfterTurn,
    ]
  );

  /**
   * Add a conversation turn without API call
   */
  const addConversationTurn = useCallback(
    (
      userContent: string,
      assistantContent: string,
      assistantVisualization?: VisualizationConfig,
      suggested?: string[]
    ) => {
      const userMessageId = generateMessageId();
      const assistantMessageId = generateMessageId();
      setMessages((prev) => [
        ...prev,
        {
          id: userMessageId,
          role: "user",
          content: userContent,
          timestamp: new Date(),
        },
        {
          id: assistantMessageId,
          role: "assistant",
          content: assistantContent,
          visualization: assistantVisualization,
          timestamp: new Date(),
        },
      ]);
      if (suggested?.length) setSuggestedQuestions(suggested);
    },
    [generateMessageId]
  );

  /**
   * Refine the last query
   */
  const refineQuery = useCallback(
    async (refinement: string) => {
      const lastUserMessage = [...messages]
        .reverse()
        .find((m) => m.role === "user");
      const lastAssistantMessage = [...messages]
        .reverse()
        .find((m) => m.role === "assistant");

      if (!lastUserMessage || !lastAssistantMessage) return;

      if (sessionId && useUnifiedChatRunStore.getState().isRunning(sessionId)) {
        return;
      }

      const userMessageId = generateMessageId();
      const assistantMessageId = generateMessageId();

      const userMessage: ChatMessage = {
        id: userMessageId,
        role: "user",
        content: refinement,
        timestamp: new Date(),
      };

      const loadingMessage: ChatMessage = {
        id: assistantMessageId,
        role: "assistant",
        content: "",
        timestamp: new Date(),
        isLoading: true,
      };

      setMessages((prev) => [...prev, userMessage, loadingMessage]);

      const streamConversationId = sessionId;
      const startRefineRun = (conversationId: string) => {
        useUnifiedChatRunStore.getState().startRun({
          conversationId,
          title: refinement.slice(0, 120),
          chatType,
          startedAt: Date.now(),
        });
        setLoadingForStream(conversationId, true);
      };
      const endRefineRun = (conversationId: string) => {
        useUnifiedChatRunStore.getState().endRun(conversationId);
        setLoadingForStream(conversationId, false);
      };

      if (streamConversationId) startRefineRun(streamConversationId);
      else setIsLoading(true);

      try {
        const effectiveTenantId = await getEffectiveTenantId();

        if (typeof window !== "undefined" && isUnifiedChatClientEnabled()) {
          const composed = `Refinement: ${refinement}\n\nPrevious question: ${lastUserMessage.content}\nPrevious answer (excerpt): ${lastAssistantMessage.content.slice(0, 4000)}`;
          const client = createUnifiedChatClient(tenantId ?? effectiveTenantId);
          const history = messages.slice(-6).map((m) => ({
            role: m.role,
            content: m.content,
          }));
          const onStreamText = (text: string) => {
            if (chatType === "research") return;
            const apply = (updater: (prev: ChatMessage[]) => ChatMessage[]) => {
              if (streamConversationId) {
                applyMessagesForStream(streamConversationId, updater);
              } else {
                setMessages(updater);
              }
            };
            apply((prev) =>
              prev.map((m) =>
                m.id === assistantMessageId
                  ? { ...m, content: text, isLoading: true }
                  : m,
              ),
            );
          };

          if (chatType === "workbench") {
            const { draftScopeId, scopeRef } = resolveWorkbenchTurnScope(
              workbenchSavedCanvasId,
            );
            setWorkbenchChatScopeRef(scopeRef);

            const { conversationId, parsed } = await sendUnifiedWorkbenchStream({
              client,
              message: composed,
              conversationId: sessionId,
              scope: { type: scopeRef.type, id: scopeRef.id },
              context: {
                ...buildWorkbenchRequestContext(draftScopeId),
                ...(carryOver ? { carryOverContext: carryOver } : {}),
              },
              history,
              onStreamText,
            });
            setSessionId(conversationId);
            const gatedActions = gateWorkbenchActionsForUserQuestion(
              parsed.actions,
              refinement,
            );
            const { autoApply, pendingConfirmation } =
              partitionWorkbenchActionsForAutoApply(gatedActions);
            const appliedCount =
              autoApply.length > 0
                ? tryDeliverWorkbenchWidgetActions(
                    draftScopeId,
                    autoApply,
                    scopeRef,
                    conversationId,
                  )
                : 0;
            if (streamConversationId) {
              finalizeWorkbenchAssistantMessage(
                streamConversationId,
                assistantMessageId,
                {
                  content: parsed.error
                    ? `${parsed.message}\n${parsed.error}`
                    : parsed.message,
                  timestamp: new Date(),
                  workbenchActions:
                    gatedActions.length > 0 ? gatedActions : undefined,
                  workbenchActionsAppliedCount: appliedCount,
                  workbenchPendingActions:
                    pendingConfirmation.length > 0
                      ? pendingConfirmation
                      : undefined,
                },
              );
            } else {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantMessageId
                    ? {
                        id: assistantMessageId,
                        role: "assistant",
                        content: parsed.error
                          ? `${parsed.message}\n${parsed.error}`
                          : parsed.message,
                        timestamp: new Date(),
                        isLoading: false,
                        workbenchActions:
                          gatedActions.length > 0 ? gatedActions : undefined,
                        workbenchActionsAppliedCount: appliedCount,
                        workbenchPendingActions:
                          pendingConfirmation.length > 0
                            ? pendingConfirmation
                            : undefined,
                      }
                    : m,
                ),
              );
            }
            if (parsed.suggestedQuestions?.length) {
              setSuggestedQuestions(parsed.suggestedQuestions);
            }
            if (streamConversationId) endRefineRun(streamConversationId);
          } else {
            const composedUploadIds =
              chatType === "research" &&
              !sessionId &&
              !legacyRef &&
              options?.researchUploadIds &&
              options.researchUploadIds.length > 0
                ? options.researchUploadIds
                : undefined;
            const refineRouting = resolveGlobalStreamRouting({
              chatType,
              workbenchCanvasId: workbenchSavedCanvasId,
            });
            const refineHandoff = consumeModeHandoff();
            const { conversationId, parsed, researchPollMode, researchSessionId } =
              await sendUnifiedGlobalStream({
              client,
              message: composed,
              chatType,
              conversationId: sessionId,
              history,
              deepAnalysis: researchDeepAnalysis,
              uploadIds: composedUploadIds,
              location: refineRouting.location,
              scope: refineRouting.scope,
              context: {
                ...(chatType === "research" && legacyRef
                  ? { legacyResearchSessionId: legacyRef }
                  : {}),
                ...(refineHandoff ? { modeHandoffContext: refineHandoff } : {}),
              },
              onStreamEvent: applyUnifiedStreamEvent,
              onStreamText,
            });
            if (chatType === "research") {
              await bindResearchSessionAfterStream(
                client,
                conversationId,
                researchSessionId,
              );
            }
            setSessionId(conversationId);
            const researchHandoffMessage =
              researchPollMode && parsed.message
                ? parsed.message
                : researchPollMode
                  ? "Research is running. View progress and findings in the Research workspace."
                  : parsed.message;
            const assistantMessage: ChatMessage = {
              id: assistantMessageId,
              role: "assistant",
              content: researchHandoffMessage,
              visualization: parsed.visualization as VisualizationConfig | undefined,
              data: undefined,
              timestamp: new Date(),
              sqlQuery: parsed.sqlQuery,
              sources: parsed.sources,
              navigationHints: parsed.navigationHints,
              insightBuilderDraft: parsed.insightBuilderDraft,
              insightBuilderPhase: parsed.insightBuilderPhase,
              visualizationArtifactId: parsed.visualizationArtifactId,
            };
            const resolvedRefineId = reconcileStreamConversationId(
              streamConversationId ?? conversationId,
              conversationId,
            );
            const messagesAfterRefine = finalizeGlobalAssistantMessage(
              resolvedRefineId,
              assistantMessageId,
              assistantMessage,
            );
            if (messagesAfterRefine.length > 0) {
              pinGlobalTranscript(resolvedRefineId, messagesAfterRefine);
            }
            if (parsed.suggestedQuestions?.length) {
              setSuggestedQuestions(parsed.suggestedQuestions);
            }
            if (chatType === "research") {
              bindResearchSessionAfterStream(
                client,
                conversationId,
                researchSessionId,
              );
            }
            if (resolvedRefineId) endRefineRun(resolvedRefineId);
          }
        } else {
          const endpoint = effectiveTenantId
            ? `/api/cohi-chat/refine?tenant_id=${encodeURIComponent(effectiveTenantId)}`
            : "/api/cohi-chat/refine";

          const response = await api.request<CohiChatResponse>(endpoint, {
            method: "POST",
            body: JSON.stringify({
              originalQuestion: lastUserMessage.content,
              refinement,
              previousResult: {
                message: lastAssistantMessage.content,
                visualization: lastAssistantMessage.visualization,
              },
              sessionId,
            }),
          });

          const assistantMessage: ChatMessage = {
            id: assistantMessageId,
            role: "assistant",
            content: response.message,
            visualization: response.visualization,
            data: response.data,
            timestamp: new Date(),
            error: response.error,
            sqlQuery: response.sqlQuery,
            sources: response.sources,
            navigationHints: response.navigationHints,
          };

          setMessages((prev) =>
            prev.map((m) => (m.id === assistantMessageId ? assistantMessage : m)),
          );

          if (response.suggestedQuestions) {
            setSuggestedQuestions(response.suggestedQuestions);
          }
          if (!streamConversationId) setIsLoading(false);
        }
      } catch (error: any) {
        const researchSessionId = activeResearchSessionIdRef.current;
        const researchStreamHandoff =
          chatType === "research" && !!researchSessionId;

        if (researchStreamHandoff) {
          console.warn(
            "[CohiChat] Research refine stream ended; session polling continues:",
            error?.message ?? error,
          );
          const handoffMessage: ChatMessage = {
            id: assistantMessageId,
            role: "assistant",
            content:
              "Research is running. View progress and findings in the Research workspace.",
            timestamp: new Date(),
          };
          if (streamConversationId) {
            applyMessagesForStream(streamConversationId, (prev) =>
              prev.map((m) =>
                m.id === assistantMessageId ? handoffMessage : m,
              ),
            );
            endRefineRun(streamConversationId);
          } else {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMessageId ? handoffMessage : m,
              ),
            );
            setIsLoading(false);
          }
        } else {
          console.error("[CohiChat] Error refining query:", error);

          const errorMessage: ChatMessage = {
            id: assistantMessageId,
            role: "assistant",
            content:
              "I encountered an error refining your query. Please try again.",
            timestamp: new Date(),
            error: error.message,
          };

          if (streamConversationId) {
            applyMessagesForStream(streamConversationId, (prev) =>
              prev.map((m) => (m.id === assistantMessageId ? errorMessage : m)),
            );
            endRefineRun(streamConversationId);
          } else {
            setMessages((prev) =>
              prev.map((m) => (m.id === assistantMessageId ? errorMessage : m)),
            );
            setIsLoading(false);
          }

          if (onError) {
            onError(error);
          }
        }
      }
    },
    [
      generateMessageId,
      getEffectiveTenantId,
      messages,
      onError,
      sessionId,
      tenantId,
      chatType,
      researchDeepAnalysis,
      applyUnifiedStreamEvent,
      applyMessagesForStream,
      setLoadingForStream,
      workbenchSavedCanvasId,
      tryDeliverWorkbenchWidgetActions,
      setWorkbenchChatScopeRef,
      pinWorkbenchTranscript,
      finalizeWorkbenchAssistantMessage,
      finalizeGlobalAssistantMessage,
      pinGlobalTranscript,
      reconcileStreamConversationId,
      bindResearchSessionAfterStream,
    ]
  );
  const clearMessages = useCallback(() => {
    setMessages([]);
    viewingSessionRef.current = null;
    globalPinnedTranscriptRef.current = null;
    conversationIdAliasRef.current.clear();
    setSessionId(null);
    setLegacyRef(null);
    setConversationForkLinks(null);
    pendingCarryOverRef.current = null;
    dismissedForkCarryOverRef.current = null;
    setHasPendingForkCarryOver(false);
    forkUndoRef.current = null;
    resetWorkbenchChatSession();
    setSuggestedQuestions(defaultSuggestionsForChatType(chatType));
  }, [resetWorkbenchChatSession, chatType]);

  const dismissPendingForkLink = useCallback(() => {
    dismissedForkCarryOverRef.current = pendingCarryOverRef.current;
    pendingCarryOverRef.current = null;
    setConversationForkLinks(null);
    setHasPendingForkCarryOver(false);
  }, []);

  const restoreDismissedForkLink = useCallback((): boolean => {
    const carryOver = dismissedForkCarryOverRef.current;
    if (!carryOver) return false;
    dismissedForkCarryOverRef.current = null;
    pendingCarryOverRef.current = carryOver;
    setConversationForkLinks({
      parentConversationId: carryOver.fromConversationId,
      parentTitle: carryOver.fromTitle ?? "Previous chat",
    });
    setHasPendingForkCarryOver(true);
    return true;
  }, []);

  const beginChatTypeFork = useCallback(
    (carryOver: CarryOverContext, previousChatType: UnifiedChatType) => {
      if (!sessionId) return;
      forkUndoRef.current = {
        sessionId,
        messages: [...messages],
        chatType: previousChatType,
        legacyRef,
        conversationForkLinks,
      };
      pendingCarryOverRef.current = carryOver;
      viewingSessionRef.current = null;
      setSessionId(null);
      setLegacyRef(null);
      setMessages([]);
      setConversationForkLinks({
        parentConversationId: carryOver.fromConversationId,
        parentTitle: carryOver.fromTitle ?? "Previous chat",
      });
      setHasPendingForkCarryOver(true);
      dismissedForkCarryOverRef.current = null;
    },
    [sessionId, messages, legacyRef, conversationForkLinks],
  );

  const undoChatTypeFork = useCallback((): ChatTypeForkUndoState | null => {
    const undo = forkUndoRef.current;
    if (!undo) return null;
    forkUndoRef.current = null;
    pendingCarryOverRef.current = null;
    dismissedForkCarryOverRef.current = null;
    setHasPendingForkCarryOver(false);
    setSessionId(undo.sessionId);
    viewingSessionRef.current = undo.sessionId;
    setMessages(undo.messages);
    setLegacyRef(undo.legacyRef);
    setConversationForkLinks(undo.conversationForkLinks);
    return undo;
  }, []);

  // ===========================================================================
  // Session management
  // ===========================================================================

  /**
   * Fetch workbench sessions linked to the active canvas scope.
   */
  const fetchWorkbenchCanvasSessions = useCallback(async () => {
    if (workbenchSessionsInflightRef.current) {
      return workbenchSessionsInflightRef.current;
    }
    const now = Date.now();
    if (
      now - workbenchSessionsLastAtRef.current <
      WORKBENCH_SESSIONS_MIN_INTERVAL_MS
    ) {
      return;
    }

    const run = (async () => {
      setIsLoadingSessions(true);
      try {
        const effectiveTenantId = await getEffectiveTenantId();
        if (typeof window !== "undefined" && isUnifiedChatClientEnabled()) {
          const client = createUnifiedChatClient(tenantId ?? effectiveTenantId);
          const activeCtx = getLatestWorkbenchActiveContext();
          const listQueries: Array<{
            scope_type: "canvas" | "draft";
            scope_key: string;
          }> = [];
          if (activeCtx?.isSavedCanvas && activeCtx.canvasId) {
            listQueries.push(...buildWorkbenchCanvasScopeQueries(activeCtx.canvasId));
          } else if (activeCtx) {
            listQueries.push({
              scope_type: "draft",
              scope_key: activeCtx.draftScopeId,
            });
          } else {
            const { draftScopeId, scopeRef } = resolveWorkbenchTurnScope(
              workbenchSavedCanvasId,
            );
            if (scopeRef.type === "canvas") {
              listQueries.push(...buildWorkbenchCanvasScopeQueries(scopeRef.id));
            } else {
              listQueries.push({
                scope_type: "draft",
                scope_key: draftScopeId,
              });
            }
          }
          const lists = await Promise.all(
            listQueries.map((q) =>
              client.listConversations({
                ...q,
                chat_type: "workbench",
                limit: 50,
              }),
            ),
          );
          const byId = new Map<string, UnifiedConversationSummary>();
          for (const r of lists.flat()) byId.set(r.id, r);
          const rows = [...byId.values()].sort(
            (a, b) =>
              new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
          );
          setChatSessions(
            rows.map((r) => ({
              id: r.id,
              title: r.title,
              messageCount: 0,
              lastMessageAt: r.updated_at,
              createdAt: r.created_at ?? r.updated_at,
            })),
          );
          workbenchSessionsLastAtRef.current = Date.now();
          return;
        }
        setChatSessions([]);
        workbenchSessionsLastAtRef.current = Date.now();
      } catch (error) {
        console.error("[CohiChat] Failed to fetch workbench sessions:", error);
      } finally {
        setIsLoadingSessions(false);
      }
    })();

    workbenchSessionsInflightRef.current = run;
    try {
      await run;
    } finally {
      if (workbenchSessionsInflightRef.current === run) {
        workbenchSessionsInflightRef.current = null;
      }
    }
  }, [getEffectiveTenantId, tenantId, workbenchSavedCanvasId]);

  /**
   * Fetch the list of saved chat sessions
   */
  const fetchSessions = useCallback(async () => {
    if (chatType === "workbench") {
      await fetchWorkbenchCanvasSessions();
      return;
    }

    setIsLoadingSessions(true);
    try {
      const effectiveTenantId = await getEffectiveTenantId();
      if (typeof window !== "undefined" && isUnifiedChatClientEnabled()) {
        const client = createUnifiedChatClient(tenantId ?? effectiveTenantId);
        const rows = await client.listConversations({
          scope_type: "global_session",
          limit: 50,
        });
        setChatSessions(
          rows.map((r) => ({
            id: r.id,
            title: r.title,
            messageCount: 0,
            lastMessageAt: r.updated_at,
            createdAt: r.created_at ?? r.updated_at,
          })),
        );
        return;
      }
      const qs = effectiveTenantId
        ? `?tenant_id=${encodeURIComponent(effectiveTenantId)}`
        : "";
      const response = await api.request<{ sessions: ChatSession[] }>(
        `/api/cohi-chat/sessions${qs}`,
      );
      setChatSessions(response.sessions || []);
    } catch (error) {
      console.error("[CohiChat] Failed to fetch sessions:", error);
    } finally {
      setIsLoadingSessions(false);
    }
  }, [chatType, fetchWorkbenchCanvasSessions, getEffectiveTenantId, tenantId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onHistorySync = (event: Event) => {
      const detail = (event as CustomEvent<UnifiedChatHistorySyncDetail>).detail;
      if (detail?.conversation) {
        const c = detail.conversation;
        setChatSessions((prev) => {
          if (prev.some((s) => s.id === c.id)) return prev;
          return [
            {
              id: c.id,
              title: c.title,
              messageCount: 0,
              lastMessageAt: c.updated_at,
              createdAt: c.created_at ?? c.updated_at,
            },
            ...prev,
          ];
        });
      }
      if (detail?.refresh) {
        void fetchSessions();
      }
    };
    window.addEventListener(UNIFIED_CHAT_HISTORY_SYNC_EVENT, onHistorySync);
    return () =>
      window.removeEventListener(UNIFIED_CHAT_HISTORY_SYNC_EVENT, onHistorySync);
  }, [fetchSessions]);

  /**
   * Load a specific session's messages into the chat
   */
  const loadSession = useCallback(
    async (
      targetSessionId: string,
    ): Promise<{
      datasetUploadIds: string[];
      chatType?: UnifiedChatType;
      scope?: { type: string; id?: string };
    }> => {
      const generation = ++loadSessionGenerationRef.current;
      const isActiveThread = isConversationActive(targetSessionId);
      const inMemoryMessages = messagesRef.current;
      const pinnedTranscript =
        workbenchPinnedTranscriptRef.current &&
        Date.now() < workbenchPinnedTranscriptRef.current.until &&
        (workbenchPinnedTranscriptRef.current.conversationId === targetSessionId ||
          isActiveThread)
          ? workbenchPinnedTranscriptRef.current
          : null;
      const globalPinned =
        globalPinnedTranscriptRef.current &&
        Date.now() < globalPinnedTranscriptRef.current.until &&
        (globalPinnedTranscriptRef.current.conversationId === targetSessionId ||
          isActiveThread)
          ? globalPinnedTranscriptRef.current
          : null;
      const preserveInMemoryOnFailure =
        (isActiveThread && inMemoryMessages.length > 0) ||
        (!!pinnedTranscript && pinnedTranscript.messages.length > 0) ||
        (!!globalPinned && globalPinned.messages.length > 0);
      const canvasSavePreserve =
        workbenchCanvasSavePreserveRef.current &&
        Date.now() < workbenchCanvasSavePreserveRef.current.until &&
        workbenchCanvasSavePreserveRef.current.conversationId ===
          targetSessionId;
      if (
        !preserveInMemoryOnFailure &&
        !canvasSavePreserve &&
        !pinnedTranscript &&
        !globalPinned &&
        !isActiveThread
      ) {
        setMessages([]);
      }
      setLoadingSessionId(targetSessionId);
      try {
        const effectiveTenantId = await getEffectiveTenantId();
        if (typeof window !== "undefined" && isUnifiedChatClientEnabled()) {
          const client = createUnifiedChatClient(tenantId ?? effectiveTenantId);
          const row = await client.getConversation(targetSessionId, {
            bustCache: preserveInMemoryOnFailure || isActiveThread,
          });
          if (generation !== loadSessionGenerationRef.current) {
            return { datasetUploadIds: [] };
          }
          const loadedChatType = (row.chat_type ?? chatType) as UnifiedChatType;
          setConversationForkLinks(forkLinksFromConversationRow(row) ?? null);
          setHasPendingForkCarryOver(false);
          const rowScope = row.scope;

          if (loadedChatType === "workbench" && rowScope?.id) {
            if (rowScope.type === "canvas") {
              setWorkbenchSavedCanvasId(rowScope.id);
              setWorkbenchChatScopeRef({
                type: "canvas",
                id: rowScope.id,
              });
            } else if (rowScope.type === "draft") {
              setActiveWorkbenchDraftScope(rowScope.id);
              setWorkbenchSavedCanvasId(null);
              setWorkbenchChatScopeRef({
                type: "draft",
                id: rowScope.id,
              });
            }
            setWorkbenchScopePinned(false);
            setPendingScopeSwitchTarget(null);
          }

          const raw = (row.messages ?? []) as Array<{
            role?: string;
            content?: string;
            blocks?: UnifiedChatBlock[];
            metadata?: Record<string, unknown>;
            at?: string;
          }>;
          const presentationMetaTurns: LoadedTurnPresentationMeta[] = [];
          const loadedMessages: ChatMessage[] = raw
            .filter((m) => m.role === "user" || m.role === "assistant")
            .map((m, i) => {
              const messageId = `loaded-${i}`;
              if (m.role === "user") {
                return {
                  id: messageId,
                  role: "user" as const,
                  content: m.content ?? "",
                  timestamp: new Date(m.at ?? Date.now()),
                };
              }
              const blocks = Array.isArray(m.blocks) ? m.blocks : [];
              if (loadedChatType === "workbench") {
                const wb = parseWorkbenchUnifiedEnvelope({
                  conversationId: targetSessionId,
                  turn: { id: messageId, blocks },
                  metadata: m.metadata,
                });
                const legacyContent =
                  typeof m.content === "string" ? m.content.trim() : "";
                let content = wb.message?.trim() ?? "";
                if (isGenericWorkbenchAck(content) && legacyContent) {
                  content = legacyContent;
                }
                return {
                  id: messageId,
                  role: "assistant" as const,
                  content,
                  timestamp: new Date(m.at ?? Date.now()),
                  workbenchActions: wb.actions,
                };
              }
              if (m.metadata) {
                presentationMetaTurns.push({
                  assistantMessageId: messageId,
                  metadata: m.metadata,
                });
              }
              const parsed = parseGlobalFromBlocks(blocks, m.metadata);
              return {
                id: messageId,
                role: "assistant" as const,
                content: parsed.message,
                visualization: parsed.visualization as
                  | VisualizationConfig
                  | undefined,
                timestamp: new Date(m.at ?? Date.now()),
                sqlQuery: parsed.sqlQuery,
                sources: parsed.sources,
                navigationHints: parsed.navigationHints,
                insightBuilderDraft: parsed.insightBuilderDraft,
                insightBuilderPhase: parsed.insightBuilderPhase,
                visualizationArtifactId: parsed.visualizationArtifactId,
              };
            });
          const hydratedMessages = hydratePresentationExportsOnLoad(
            loadedMessages,
            presentationMetaTurns,
          );
          if (generation !== loadSessionGenerationRef.current) {
            return { datasetUploadIds: [] };
          }
          let messagesToApply = hydratedMessages;
          if (
            loadedChatType === "workbench" &&
            (preserveInMemoryOnFailure || canvasSavePreserve || pinnedTranscript)
          ) {
            const memAssistant = [...inMemoryMessages]
              .reverse()
              .find((m) => m.role === "assistant");
            if (memAssistant?.content?.trim()) {
              const lastAssistantIdx = messagesToApply.reduce(
                (acc, m, i) => (m.role === "assistant" ? i : acc),
                -1,
              );
              if (lastAssistantIdx >= 0) {
                const hyd = messagesToApply[lastAssistantIdx];
                if (!hyd.content?.trim()) {
                  messagesToApply = messagesToApply.map((m, i) =>
                    i === lastAssistantIdx
                      ? {
                          ...hyd,
                          content: memAssistant.content,
                          workbenchActions:
                            hyd.workbenchActions ?? memAssistant.workbenchActions,
                          workbenchActionsAppliedCount:
                            hyd.workbenchActionsAppliedCount ??
                            memAssistant.workbenchActionsAppliedCount,
                          workbenchPendingActions:
                            hyd.workbenchPendingActions ??
                            memAssistant.workbenchPendingActions,
                        }
                      : m,
                  );
                }
              } else if (messagesToApply.length === 0) {
                messagesToApply = inMemoryMessages;
              }
            }
          }
          if (
            messagesToApply.length === 0 &&
            (preserveInMemoryOnFailure || canvasSavePreserve || pinnedTranscript || globalPinned)
          ) {
            if (inMemoryMessages.length > 0) {
              setMessages(inMemoryMessages);
            } else if (pinnedTranscript) {
              setMessages(pinnedTranscript.messages);
            } else if (globalPinned) {
              setMessages(globalPinned.messages);
            }
            setSessionId(targetSessionId);
            viewingSessionRef.current = targetSessionId;
            sessionIdRef.current = targetSessionId;
            return {
              datasetUploadIds: row.dataset_upload_ids ?? [],
              chatType: loadedChatType,
              scope: rowScope,
            };
          }
          if (
            messagesToApply.length > 0 ||
            !preserveInMemoryOnFailure
          ) {
            setMessages(messagesToApply);
          }
          if (loadedChatType === "workbench" && messagesToApply.length > 0) {
            pinWorkbenchTranscript(targetSessionId, messagesToApply);
          }
          if (presentationMetaTurns.length > 0 && loadedChatType !== "workbench") {
            void enrichVizPresentationExportsOnLoad(
              hydratedMessages,
              presentationMetaTurns,
              loadedChatType,
            ).then((enriched) => {
              if (generation !== loadSessionGenerationRef.current) return;
              setMessages(enriched);
            });
          }
          setSessionId(targetSessionId);
          viewingSessionRef.current = targetSessionId;
          setLegacyRef(row.legacy_ref ?? null);
          return {
            datasetUploadIds: row.dataset_upload_ids ?? [],
            chatType: loadedChatType,
            scope: rowScope,
          };
        }
        const qs = effectiveTenantId
          ? `?tenant_id=${encodeURIComponent(effectiveTenantId)}`
          : "";
        const response = await api.request<{
          session: { id: string; title: string };
          messages: {
            id: string;
            role: "user" | "assistant";
            content: string;
            metadata: any;
            createdAt: string;
          }[];
        }>(`/api/cohi-chat/sessions/${targetSessionId}${qs}`);

        if (generation !== loadSessionGenerationRef.current) {
          return { datasetUploadIds: [] };
        }

        const presentationMetaTurns: LoadedTurnPresentationMeta[] = [];
        const baseMessages: ChatMessage[] = response.messages.map((m) => {
          if (m.role === "assistant" && m.metadata) {
            presentationMetaTurns.push({
              assistantMessageId: m.id,
              metadata: m.metadata,
            });
          }
          return {
            id: m.id,
            role: m.role,
            content: m.content,
            timestamp: new Date(m.createdAt),
            visualization: m.metadata?.visualization,
            sqlQuery: m.metadata?.sqlQuery,
            sources: m.metadata?.sources,
          };
        });
        const loadedMessages = hydratePresentationExportsOnLoad(
          baseMessages,
          presentationMetaTurns,
        );

        setMessages(loadedMessages);
        if (presentationMetaTurns.length > 0) {
          void enrichVizPresentationExportsOnLoad(
            loadedMessages,
            presentationMetaTurns,
            chatType,
          ).then((enriched) => {
            if (generation !== loadSessionGenerationRef.current) return;
            setMessages(enriched);
          });
        }
        setSessionId(targetSessionId);
        setSuggestedQuestions(defaultSuggestionsForChatType(chatType));
        return { datasetUploadIds: [], chatType };
      } catch (error) {
        console.error("[CohiChat] Failed to load session:", error);
        if (
          preserveInMemoryOnFailure ||
          canvasSavePreserve ||
          pinnedTranscript ||
          globalPinned
        ) {
          if (inMemoryMessages.length > 0) {
            setMessages(inMemoryMessages);
          } else if (pinnedTranscript) {
            setMessages(pinnedTranscript.messages);
          } else if (globalPinned) {
            setMessages(globalPinned.messages);
          }
          viewingSessionRef.current = targetSessionId;
          sessionIdRef.current = targetSessionId;
          setSessionId(targetSessionId);
        }
        return { datasetUploadIds: [] };
      } finally {
        if (generation === loadSessionGenerationRef.current) {
          setLoadingSessionId(null);
        }
      }
    },
    [
      getEffectiveTenantId,
      tenantId,
      chatType,
      setWorkbenchChatScopeRef,
      pinWorkbenchTranscript,
      isConversationActive,
    ],
  );

  const syncWorkbenchChatToActiveContext = useCallback(
    async (
      ctx: WorkbenchActiveContext,
      options?: SyncWorkbenchContextOptions,
    ) => {
      const scopeRef = activeContextToScopeRef(ctx);
      const scopeKey = `${scopeRef.type}:${scopeRef.id}`;
      const loadLatestThread = options?.loadLatestThread !== false;
      const activeConversationId =
        sessionIdRef.current ??
        activeStreamConversationRef.current ??
        viewingSessionRef.current;
      const hasActiveInMemoryThread =
        messagesRef.current.length > 0 && !!activeConversationId;
      const canvasSavePreserve =
        workbenchCanvasSavePreserveRef.current &&
        Date.now() < workbenchCanvasSavePreserveRef.current.until &&
        !!activeConversationId &&
        workbenchCanvasSavePreserveRef.current.conversationId ===
          activeConversationId;
      if (
        workbenchFreshThreadScopeKeyRef.current &&
        workbenchFreshThreadScopeKeyRef.current !== scopeKey
      ) {
        if (hasActiveInMemoryThread) {
          workbenchFreshThreadScopeKeyRef.current = scopeKey;
        } else {
          workbenchFreshThreadScopeKeyRef.current = null;
        }
      }
      if (
        !options?.forceReload &&
        lastSyncedWorkbenchScopeKeyRef.current === scopeKey &&
        sessionId &&
        workbenchChatScope &&
        workbenchScopeMatchesActiveContext(workbenchChatScope, ctx)
      ) {
        return;
      }
      const skipAutoLoad =
        !loadLatestThread ||
        workbenchFreshThreadScopeKeyRef.current === scopeKey ||
        hasActiveInMemoryThread ||
        canvasSavePreserve;
      if (!loadLatestThread) {
        workbenchFreshThreadScopeKeyRef.current = scopeKey;
      }
      lastSyncedWorkbenchScopeKeyRef.current = scopeKey;
      setWorkbenchChatScopeRef(scopeRef);
      setWorkbenchScopePinned(false);
      setPendingScopeSwitchTarget(null);
      setScopeMismatchActions(null);
      setActiveWorkbenchDraftScope(ctx.draftScopeId);
      markWorkbenchCanvasNavBound();
      if (ctx.isSavedCanvas && ctx.canvasId) {
        rememberWorkbenchDraftTab(ctx.draftScopeId, ctx.tabId);
        setWorkbenchSavedCanvasId(ctx.canvasId);
        dispatchWorkbenchBindCanvas(ctx.canvasId);
      } else {
        setWorkbenchSavedCanvasId(null);
      }

      if (!isUnifiedChatClientEnabled()) {
        viewingSessionRef.current = null;
        setSessionId(null);
        setMessages([]);
        return;
      }

      if (skipAutoLoad) {
        if (activeConversationId && messagesRef.current.length > 0) {
          viewingSessionRef.current = activeConversationId;
          sessionIdRef.current = activeConversationId;
          setSessionId(activeConversationId);
          pinWorkbenchTranscript(activeConversationId, messagesRef.current);
        } else if (
          activeConversationId &&
          (canvasSavePreserve || workbenchPinnedTranscriptRef.current)
        ) {
          viewingSessionRef.current = activeConversationId;
          sessionIdRef.current = activeConversationId;
          setSessionId(activeConversationId);
          const pinned =
            workbenchPinnedTranscriptRef.current?.conversationId ===
            activeConversationId
              ? workbenchPinnedTranscriptRef.current.messages
              : null;
          if (pinned && pinned.length > 0) {
            setMessages(pinned);
          }
        }
        void fetchSessions();
        return;
      }

      try {
        const effectiveTenantId = await getEffectiveTenantId();
        const client = createUnifiedChatClient(tenantId ?? effectiveTenantId);
        const listQueries: Array<{
          scope_type: "canvas" | "draft";
          scope_key: string;
        }> = [];
        if (ctx.isSavedCanvas && ctx.canvasId) {
          listQueries.push(...buildWorkbenchCanvasScopeQueries(ctx.canvasId));
        } else {
          listQueries.push({
            scope_type: "draft",
            scope_key: ctx.draftScopeId,
          });
        }
        const listResults = await Promise.all(
          listQueries.map((q) =>
            client.listConversations({
              ...q,
              chat_type: "workbench",
              limit: 5,
            }),
          ),
        );
        const rows = listResults
          .flat()
          .sort(
            (a, b) =>
              new Date(b.updated_at).getTime() -
              new Date(a.updated_at).getTime(),
          );
        const currentConversationId =
          sessionIdRef.current ??
          activeStreamConversationRef.current ??
          viewingSessionRef.current;
        if (rows[0]?.id) {
          if (
            currentConversationId &&
            rows[0].id === currentConversationId
          ) {
            void fetchSessions();
            return;
          }
          if (
            (hasActiveInMemoryThread || canvasSavePreserve) &&
            !options?.forceReload
          ) {
            void fetchSessions();
            return;
          }
          if (
            canvasSavePreserve &&
            currentConversationId &&
            rows[0].id !== currentConversationId
          ) {
            void fetchSessions();
            return;
          }
          await loadSession(rows[0].id);
        }
        void fetchSessions();
      } catch (err) {
        console.warn("[useCohiChat] syncWorkbenchChatToActiveContext:", err);
      }
    },
    [
      getEffectiveTenantId,
      tenantId,
      loadSession,
      setWorkbenchChatScopeRef,
      fetchSessions,
      sessionId,
      workbenchChatScope,
      pinWorkbenchTranscript,
    ],
  );

  const pinWorkbenchChatScope = useCallback(() => {
    if (workbenchChatScope) {
      setWorkbenchScopePinned(true);
      setWorkbenchPinnedScopeLabel(
        workbenchChatScope.label ?? workbenchPinnedScopeLabel,
      );
    }
  }, [workbenchChatScope, workbenchPinnedScopeLabel]);

  const acceptPendingWorkbenchScopeSwitch = useCallback(async () => {
    const target = pendingScopeSwitchTarget;
    if (!target) return;
    trackWorkbenchScopeSyncEvent("scope_switch_confirmed");
    await syncWorkbenchChatToActiveContext(target, { forceReload: true });
  }, [pendingScopeSwitchTarget, syncWorkbenchChatToActiveContext]);

  const cancelPendingWorkbenchScopeSwitch = useCallback(() => {
    if (pendingScopeSwitchTarget) {
      trackWorkbenchScopeSyncEvent("scope_switch_cancelled");
      pinWorkbenchChatScope();
    }
    setPendingScopeSwitchTarget(null);
  }, [pendingScopeSwitchTarget, pinWorkbenchChatScope]);

  const resolveScopeMismatchActions = useCallback(
    (mode: "active" | "conversation") => {
      const pending = scopeMismatchActions;
      if (!pending) return;
      if (mode === "active") {
        const active = getLatestWorkbenchActiveContext();
        const draftScopeId =
          active?.draftScopeId ?? resolveWorkbenchDraftScopeId();
        deliverWorkbenchWidgetActions(draftScopeId, pending.actions);
        trackWorkbenchScopeSyncEvent("action_apply_mismatch_resolved_active");
      } else {
        deliverWorkbenchWidgetActions(
          pending.draftScopeId,
          pending.actions,
        );
        trackWorkbenchScopeSyncEvent(
          "action_apply_mismatch_resolved_conversation",
        );
      }
      setScopeMismatchActions(null);
    },
    [scopeMismatchActions],
  );

  /**
   * Delete a chat session
   */
  const deleteSession = useCallback(
    async (targetSessionId: string) => {
      const previousSessions = chatSessions;
      setChatSessions((prev) => prev.filter((s) => s.id !== targetSessionId));

      try {
        const effectiveTenantId = await getEffectiveTenantId();
        if (typeof window !== "undefined" && isUnifiedChatClientEnabled()) {
          const client = createUnifiedChatClient(tenantId ?? effectiveTenantId);
          await client.deleteConversation(targetSessionId);
        } else {
          const qs = effectiveTenantId
            ? `?tenant_id=${encodeURIComponent(effectiveTenantId)}`
            : "";
          await api.request(`/api/cohi-chat/sessions/${targetSessionId}${qs}`, {
            method: "DELETE",
          });
        }

        if (sessionId === targetSessionId) {
          clearMessages();
          setSessionId(null);
        }
      } catch (error) {
        console.error("[CohiChat] Failed to delete session:", error);
        setChatSessions(previousSessions);
      }
    },
    [chatSessions, clearMessages, getEffectiveTenantId, sessionId, tenantId],
  );

  /**
   * Rename a chat session
   */
  const renameSession = useCallback(
    async (targetSessionId: string, title: string) => {
      const previousSessions = chatSessions;
      setChatSessions((prev) =>
        prev.map((s) => (s.id === targetSessionId ? { ...s, title } : s))
      );

      try {
        const effectiveTenantId = await getEffectiveTenantId();
        const qs = effectiveTenantId
          ? `?tenant_id=${encodeURIComponent(effectiveTenantId)}`
          : "";
        await api.request(`/api/cohi-chat/sessions/${targetSessionId}${qs}`, {
          method: "PUT",
          body: JSON.stringify({ title }),
        });
      } catch (error) {
        console.error("[CohiChat] Failed to rename session:", error);
        setChatSessions(previousSessions);
      }
    },
    [chatSessions, getEffectiveTenantId]
  );

  /** Clear in-flight stream UI before greenfield new-canvas handoff. */
  const resetWorkbenchStreamUiForHandoff = useCallback(() => {
    for (const id of useUnifiedChatRunStore.getState().runningIds()) {
      useUnifiedChatRunStore.getState().endRun(id);
    }
    setIsLoading(false);
  }, []);

  /**
   * Start a new session
   */
  const newSession = useCallback(async () => {
    workbenchCanvasSavePreserveRef.current = null;
    workbenchPinnedTranscriptRef.current = null;
    globalPinnedTranscriptRef.current = null;
    conversationIdAliasRef.current.clear();
    clearMessages();
    viewingSessionRef.current = null;
    setSessionId(null);
    setIsLoading(false);
    lastSyncedWorkbenchScopeKeyRef.current = null;
    if (chatType === "workbench") {
      const ctx = getLatestWorkbenchActiveContext();
      if (ctx) {
        const scopeRef = activeContextToScopeRef(ctx);
        workbenchFreshThreadScopeKeyRef.current = `${scopeRef.type}:${scopeRef.id}`;
        lastSyncedWorkbenchScopeKeyRef.current =
          workbenchFreshThreadScopeKeyRef.current;
      } else {
        workbenchFreshThreadScopeKeyRef.current = null;
      }
    } else {
      workbenchFreshThreadScopeKeyRef.current = null;
    }
    resetWorkbenchChatSession();
    if (typeof window !== "undefined" && isUnifiedChatClientEnabled()) {
      return;
    }
    try {
      const effectiveTenantId = await getEffectiveTenantId();
      if (!effectiveTenantId) {
        return;
      }

      const response = await api.request<{ sessionId: string }>(
        `/api/cohi-chat/new-session?tenant_id=${encodeURIComponent(effectiveTenantId)}`,
        { method: "POST" }
      );
      if (response.sessionId) {
        setSessionId(response.sessionId);
      }
      fetchSessions();
    } catch (error) {
      console.error("[CohiChat] Failed to create new session:", error);
    }
  }, [
    clearMessages,
    fetchSessions,
    getEffectiveTenantId,
    resetWorkbenchChatSession,
    chatType,
  ]);

  /** Any in-flight stream (sessionId may lag behind startRun for new conversations). */
  const isSessionRunning = useUnifiedChatRunStore(
    (s) =>
      s.runningIds().length > 0 ||
      (!!sessionId && !!s.runs[sessionId]),
  );

  /** After stream ends: clear stuck loading flag or backfill text (never generic ack). */
  useEffect(() => {
    if (chatType !== "workbench") return;
    if (useUnifiedChatRunStore.getState().runningIds().length > 0) return;
    if (isLoading) return;

    const needsFix = messages.some((m) => {
      if (m.role !== "assistant") return false;
      const applied = m.workbenchActionsAppliedCount ?? 0;
      return applied > 0 && !m.content?.trim();
    });
    if (!needsFix) return;

    setMessages((prev) =>
      prev.map((m) => {
        if (m.role !== "assistant") return m;
        const applied = m.workbenchActionsAppliedCount ?? 0;
        if (!m.content?.trim() && applied > 0) {
          return {
            ...m,
            isLoading: false,
            content: resolveWorkbenchAssistantContent({
              appliedCount: applied,
            }),
          };
        }
        return m;
      }),
    );
  }, [chatType, isLoading, messages]);

  return {
    messages,
    isLoading: isLoading || isSessionRunning,
    sessionId,
    isSessionRunning,
    legacyRef,
    suggestedQuestions,
    sendMessage,
    addConversationTurn,
    refineQuery,
    clearMessages,
    newSession,
    chatSessions,
    isLoadingSessions,
    isLoadingSession,
    loadingSessionId,
    fetchSessions,
    fetchWorkbenchCanvasSessions,
    loadSession,
    deleteSession,
    renameSession,
    conversationForkLinks,
    hasPendingForkCarryOver,
    dismissPendingForkLink,
    restoreDismissedForkLink,
    beginChatTypeFork,
    undoChatTypeFork,
    clearConversationBinding,
    stageModeHandoff,
    workbenchSavedCanvasId,
    workbenchChatScope,
    workbenchScopePinned,
    workbenchPinnedScopeLabel,
    pendingScopeSwitchTarget,
    setPendingScopeSwitchTarget,
    scopeMismatchActions,
    syncWorkbenchChatToActiveContext,
    resetWorkbenchStreamUiForHandoff,
    acceptPendingWorkbenchScopeSwitch,
    cancelPendingWorkbenchScopeSwitch,
    resolveScopeMismatchActions,
    pinWorkbenchChatScope,
    applyWorkbenchDashboardSuggestion,
    fulfillDeferredResearchPptExport,
  };
}
