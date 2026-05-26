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
import { serializeWidgetCatalog } from "@/utils/widgetCatalogSerializer";
import type { WidgetAction, CanvasStateSnapshot } from "@/types/widgetActions";
import {
  deliverWorkbenchWidgetActions,
  dispatchWorkbenchBindCanvas,
  filterExecutableWorkbenchActions,
  gateWorkbenchActionsForUserQuestion,
  COHI_WORKBENCH_BIND_CANVAS_EVENT,
  draftScopeIdForCanvasTab,
  getConnectedWorkbenchCanvasId,
  getMyDashboardCanvasIdFromPath,
  getOrCreateActiveWorkbenchDraftScope,
  rememberWorkbenchDraftTab,
  markWorkbenchCanvasNavBound,
  resetActiveWorkbenchDraftSession,
  setActiveWorkbenchDraftScope,
} from "@/lib/workbench/workbenchChatHandoff";
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
  type WorkbenchActiveContext,
  type WorkbenchChatScopeRef,
  type WorkbenchScopeMismatchActionsDetail,
  type SyncWorkbenchContextOptions,
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
} from "@/lib/unifiedChatSuggestedPrompts";
import {
  sendUnifiedGlobalStream,
  sendUnifiedWorkbenchStream,
} from "@/lib/unifiedChatSend";
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
  parentConversationId?: string | null;
  parentTitle?: string | null;
  forkedToConversationId?: string | null;
  forkedToTitle?: string | null;
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

export interface UseCohiChatOptions {
  tenantId?: string;
  enabled?: boolean;
  onError?: (error: Error) => void;
  /** Unified v1 chat_type (default `chat`; use `research` when mode selector lands in COHI-406). */
  chatType?: UnifiedChatType;
  /** Research-only: deep analysis toggle (§4.2). */
  researchDeepAnalysis?: boolean;
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
  const viewingSessionRef = useRef<string | null>(null);
  const loadSessionGenerationRef = useRef(0);
  const pendingCarryOverRef = useRef<CarryOverContext | null>(null);
  const forkUndoRef = useRef<ChatTypeForkUndoState | null>(null);
  const workbenchSessionsInflightRef = useRef<Promise<void> | null>(null);
  const workbenchSessionsLastAtRef = useRef(0);
  const [conversationForkLinks, setConversationForkLinks] =
    useState<ConversationForkLinks | null>(null);

  const WORKBENCH_SESSIONS_MIN_INTERVAL_MS = 2_000;

  useEffect(() => {
    viewingSessionRef.current = sessionId;
  }, [sessionId]);

  const applyMessagesForStream = useCallback(
    (
      streamConversationId: string,
      updater: (prev: ChatMessage[]) => ChatMessage[],
    ) => {
      if (viewingSessionRef.current !== streamConversationId) return;
      setMessages(updater);
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
    if (chatType !== "workbench") return;
    const onSaved = (e: Event) => {
      const detail = (e as CustomEvent<{ canvasId?: string; draftScopeId?: string }>)
        .detail;
      if (detail?.canvasId && detail.draftScopeId) {
        const activeDraft = getOrCreateActiveWorkbenchDraftScope();
        if (detail.draftScopeId === activeDraft) {
          setWorkbenchSavedCanvasId(detail.canvasId);
        }
      }
    };
    const onBind = (e: Event) => {
      const canvasId = (e as CustomEvent<{ canvasId?: string }>).detail?.canvasId;
      if (canvasId) setWorkbenchSavedCanvasId(canvasId);
    };
    window.addEventListener("workbench:canvas-saved", onSaved);
    window.addEventListener(COHI_WORKBENCH_BIND_CANVAS_EVENT, onBind);
    return () => {
      window.removeEventListener("workbench:canvas-saved", onSaved);
      window.removeEventListener(COHI_WORKBENCH_BIND_CANVAS_EVENT, onBind);
    };
  }, [chatType]);

  useEffect(() => {
    setSuggestedQuestions(CHAT_TYPE_DEFAULT_SUGGESTIONS[chatType]);
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
      if (chatType === "research" && ev.metadata) {
        const researchSessionId = ev.metadata.researchSessionId;
        if (typeof researchSessionId === "string" && researchSessionId) {
          setLegacyRef(researchSessionId);
        }
      }
    },
    [chatType],
  );

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

      if (chatType === "workbench") {
        workbenchFreshThreadScopeKeyRef.current = null;
      }

      const forceNew = options?.forceNewConversation ?? false;
      const carryOver =
        options?.carryOverContext ?? pendingCarryOverRef.current ?? undefined;
      if (carryOver) {
        pendingCarryOverRef.current = null;
      }
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
            useUnifiedChatRunStore.getState().startRun({
              conversationId,
              title: effectiveQuestion.slice(0, 120),
              chatType,
              startedAt: Date.now(),
            });
            setLoadingForStream(conversationId, true);
          };

          const endStreamRun = (conversationId: string) => {
            useUnifiedChatRunStore.getState().endRun(conversationId);
            setLoadingForStream(conversationId, false);
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

            const { conversationId, parsed } = await sendUnifiedWorkbenchStream({
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
            setSessionId(conversationId);
            if (viewingSessionRef.current === conversationId) {
              viewingSessionRef.current = conversationId;
            }

            const autoActions = gateWorkbenchActionsForUserQuestion(
              parsed.actions,
              effectiveQuestion,
            );
            const appliedCount =
              autoActions.length > 0
                ? tryDeliverWorkbenchWidgetActions(
                    draftScopeId,
                    autoActions,
                    scopeRef,
                    conversationId,
                  )
                : 0;

            const assistantMessage: ChatMessage = {
              id: assistantMessageId,
              role: "assistant",
              content: parsed.error
                ? `${parsed.message}\n${parsed.error}`
                : parsed.message,
              timestamp: new Date(),
              workbenchActions:
                autoActions.length > 0 ? autoActions : undefined,
              workbenchActionsAppliedCount: appliedCount,
            };
            applyMessagesForStream(streamConversationId, (prev) =>
              prev.map((m) =>
                m.id === assistantMessageId ? assistantMessage : m,
              ),
            );
            if (parsed.suggestedQuestions?.length) {
              setSuggestedQuestions(parsed.suggestedQuestions);
            }
            endStreamRun(streamConversationId);
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
            const { conversationId, parsed } = await sendUnifiedGlobalStream({
              client,
              message: effectiveQuestion,
              chatType,
              conversationId: streamConversationId,
              clientMessageId: approveClientMessageId,
              history,
              deepAnalysis: researchDeepAnalysis,
              uploadIds: researchUploadIds,
              datasetUploadIds: datasetUploadIdsForSend,
              context: {
                ...(chatType === "research" && priorLegacyRef
                  ? { legacyResearchSessionId: priorLegacyRef }
                  : ibDraft && chatType === "insight_builder"
                    ? { insightBuilderDraft: ibDraft }
                    : {}),
                ...(carryOver ? { carryOverContext: carryOver } : {}),
              },
              insightBuilder:
                chatType === "insight_builder" && ibOpts?.action
                  ? { action: ibOpts.action }
                  : chatType === "insight_builder" && ibDraft
                    ? { action: "revise" }
                    : undefined,
              onStreamEvent: applyUnifiedStreamEvent,
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
            setSessionId(conversationId);
            const assistantMessage: ChatMessage = {
              id: assistantMessageId,
              role: "assistant",
              content: parsed.message,
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
            applyMessagesForStream(streamConversationId, (prev) =>
              prev.map((m) => (m.id === assistantMessageId ? assistantMessage : m)),
            );
            if (parsed.suggestedQuestions?.length) {
              setSuggestedQuestions(parsed.suggestedQuestions);
            }
            if (chatType === "research") {
              void client.getConversation(conversationId).then((row) => {
                if (row.legacy_ref) setLegacyRef(row.legacy_ref);
              });
            }
            endStreamRun(streamConversationId);
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
        console.error("[CohiChat] Error sending message:", error);

        const errorMessage: ChatMessage = {
          id: assistantMessageId,
          role: "assistant",
          content: "I encountered an error processing your request. Please try again.",
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
            const autoActions = gateWorkbenchActionsForUserQuestion(
              parsed.actions,
              refinement,
            );
            const appliedCount =
              autoActions.length > 0
                ? tryDeliverWorkbenchWidgetActions(
                    draftScopeId,
                    autoActions,
                    scopeRef,
                    conversationId,
                  )
                : 0;
            const assistantMessage: ChatMessage = {
              id: assistantMessageId,
              role: "assistant",
              content: parsed.error
                ? `${parsed.message}\n${parsed.error}`
                : parsed.message,
              timestamp: new Date(),
              workbenchActions:
                autoActions.length > 0 ? autoActions : undefined,
              workbenchActionsAppliedCount: appliedCount,
            };
            const applyFinal = (updater: (prev: ChatMessage[]) => ChatMessage[]) => {
              if (streamConversationId) {
                applyMessagesForStream(streamConversationId, updater);
              } else {
                setMessages(updater);
              }
            };
            applyFinal((prev) =>
              prev.map((m) =>
                m.id === assistantMessageId ? assistantMessage : m,
              ),
            );
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
            const { conversationId, parsed } = await sendUnifiedGlobalStream({
              client,
              message: composed,
              chatType,
              conversationId: sessionId,
              history,
              deepAnalysis: researchDeepAnalysis,
              uploadIds: composedUploadIds,
              context:
                chatType === "research" && legacyRef
                  ? { legacyResearchSessionId: legacyRef }
                  : undefined,
              onStreamEvent: applyUnifiedStreamEvent,
              onStreamText,
            });
            setSessionId(conversationId);
            const assistantMessage: ChatMessage = {
              id: assistantMessageId,
              role: "assistant",
              content: parsed.message,
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
            const applyFinal = (updater: (prev: ChatMessage[]) => ChatMessage[]) => {
              if (streamConversationId) {
                applyMessagesForStream(streamConversationId, updater);
              } else {
                setMessages(updater);
              }
            };
            applyFinal((prev) =>
              prev.map((m) =>
                m.id === assistantMessageId ? assistantMessage : m,
              ),
            );
            if (parsed.suggestedQuestions?.length) {
              setSuggestedQuestions(parsed.suggestedQuestions);
            }
            if (streamConversationId) endRefineRun(streamConversationId);
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
        console.error("[CohiChat] Error refining query:", error);

        const errorMessage: ChatMessage = {
          id: assistantMessageId,
          role: "assistant",
          content: "I encountered an error refining your query. Please try again.",
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
    ]
  );
  const clearMessages = useCallback(() => {
    setMessages([]);
    viewingSessionRef.current = null;
    setSessionId(null);
    setLegacyRef(null);
    setConversationForkLinks(null);
    pendingCarryOverRef.current = null;
    forkUndoRef.current = null;
    resetWorkbenchChatSession();
    setSuggestedQuestions(CHAT_TYPE_DEFAULT_SUGGESTIONS[chatType]);
  }, [resetWorkbenchChatSession, chatType]);

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
    },
    [sessionId, messages, legacyRef, conversationForkLinks],
  );

  const undoChatTypeFork = useCallback((): ChatTypeForkUndoState | null => {
    const undo = forkUndoRef.current;
    if (!undo) return null;
    forkUndoRef.current = null;
    pendingCarryOverRef.current = null;
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
            listQueries.push(
              { scope_type: "canvas", scope_key: activeCtx.canvasId },
              { scope_type: "draft", scope_key: activeCtx.draftScopeId },
            );
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
              listQueries.push(
                { scope_type: "canvas", scope_key: scopeRef.id },
                { scope_type: "draft", scope_key: draftScopeId },
              );
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
      if (sessionId !== targetSessionId) {
        setMessages([]);
      }
      setLoadingSessionId(targetSessionId);
      try {
        const effectiveTenantId = await getEffectiveTenantId();
        if (typeof window !== "undefined" && isUnifiedChatClientEnabled()) {
          const client = createUnifiedChatClient(tenantId ?? effectiveTenantId);
          const row = await client.getConversation(targetSessionId);
          if (generation !== loadSessionGenerationRef.current) {
            return { datasetUploadIds: [] };
          }
          const loadedChatType = (row.chat_type ?? chatType) as UnifiedChatType;
          setConversationForkLinks({
            parentConversationId: row.parent_conversation_id ?? null,
            forkedToConversationId: row.forked_to_conversation_id ?? null,
          });
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
          const loadedMessages: ChatMessage[] = raw
            .filter((m) => m.role === "user" || m.role === "assistant")
            .map((m, i) => {
              if (m.role === "user") {
                return {
                  id: `loaded-${i}`,
                  role: "user" as const,
                  content: m.content ?? "",
                  timestamp: new Date(m.at ?? Date.now()),
                };
              }
              const blocks = Array.isArray(m.blocks) ? m.blocks : [];
              if (loadedChatType === "workbench") {
                const wb = parseWorkbenchUnifiedEnvelope({
                  conversationId: targetSessionId,
                  turn: { id: `loaded-${i}`, blocks },
                  metadata: m.metadata,
                });
                return {
                  id: `loaded-${i}`,
                  role: "assistant" as const,
                  content: wb.message,
                  timestamp: new Date(m.at ?? Date.now()),
                  workbenchActions: wb.actions,
                };
              }
              const parsed = parseGlobalFromBlocks(blocks, m.metadata);
              return {
                id: `loaded-${i}`,
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
          if (generation !== loadSessionGenerationRef.current) {
            return { datasetUploadIds: [] };
          }
          setMessages(loadedMessages);
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

        const loadedMessages: ChatMessage[] = response.messages.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          timestamp: new Date(m.createdAt),
          visualization: m.metadata?.visualization,
          sqlQuery: m.metadata?.sqlQuery,
          sources: m.metadata?.sources,
        }));

        setMessages(loadedMessages);
        setSessionId(targetSessionId);
        setSuggestedQuestions(CHAT_TYPE_DEFAULT_SUGGESTIONS[chatType]);
        return { datasetUploadIds: [], chatType };
      } catch (error) {
        console.error("[CohiChat] Failed to load session:", error);
        return { datasetUploadIds: [] };
      } finally {
        if (generation === loadSessionGenerationRef.current) {
          setLoadingSessionId(null);
        }
      }
    },
    [getEffectiveTenantId, tenantId, chatType, sessionId, setWorkbenchChatScopeRef],
  );

  const syncWorkbenchChatToActiveContext = useCallback(
    async (
      ctx: WorkbenchActiveContext,
      options?: SyncWorkbenchContextOptions,
    ) => {
      const scopeRef = activeContextToScopeRef(ctx);
      const scopeKey = `${scopeRef.type}:${scopeRef.id}`;
      const loadLatestThread = options?.loadLatestThread !== false;
      if (
        workbenchFreshThreadScopeKeyRef.current &&
        workbenchFreshThreadScopeKeyRef.current !== scopeKey
      ) {
        workbenchFreshThreadScopeKeyRef.current = null;
      }
      if (
        lastSyncedWorkbenchScopeKeyRef.current === scopeKey &&
        sessionId &&
        workbenchChatScope &&
        workbenchScopeMatchesActiveContext(workbenchChatScope, ctx)
      ) {
        return;
      }
      const skipAutoLoad =
        !loadLatestThread ||
        workbenchFreshThreadScopeKeyRef.current === scopeKey;
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
        viewingSessionRef.current = null;
        setSessionId(null);
        setConversationForkLinks(null);
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
          listQueries.push(
            { scope_type: "canvas", scope_key: ctx.canvasId },
            { scope_type: "draft", scope_key: ctx.draftScopeId },
          );
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
        if (rows[0]?.id) {
          await loadSession(rows[0].id);
        } else {
          viewingSessionRef.current = null;
          setSessionId(null);
          setMessages([]);
          setConversationForkLinks(null);
        }
        void fetchSessions();
      } catch (err) {
        console.warn("[useCohiChat] syncWorkbenchChatToActiveContext:", err);
        viewingSessionRef.current = null;
        setSessionId(null);
        setMessages([]);
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
    await syncWorkbenchChatToActiveContext(target);
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

  const isSessionRunning = useUnifiedChatRunStore((s) =>
    sessionId ? !!s.runs[sessionId] : false,
  );

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
    beginChatTypeFork,
    undoChatTypeFork,
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
  };
}
