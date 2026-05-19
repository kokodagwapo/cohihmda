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
  type UnifiedChatBlock,
} from "@/lib/unifiedChatEnvelope";
import { serializeWidgetCatalog } from "@/utils/widgetCatalogSerializer";
import type { WidgetAction, CanvasStateSnapshot } from "@/types/widgetActions";
import {
  deliverWorkbenchWidgetActions,
  filterExecutableWorkbenchActions,
  getOrCreateActiveWorkbenchDraftScope,
  resetActiveWorkbenchDraftSession,
} from "@/lib/workbench/workbenchChatHandoff";
import {
  getWorkbenchCanvasIdForDraft,
  getWorkbenchCanvasSnapshotForDraft,
} from "@/lib/workbench/workbenchCanvasBridge";
import {
  createUnifiedChatClient,
  type UnifiedChatType,
} from "@/lib/unifiedChatClient";
import {
  CHAT_TYPE_DEFAULT_SUGGESTIONS,
  DEFAULT_CHAT_SUGGESTIONS,
} from "@/lib/unifiedChatSuggestedPrompts";
import {
  sendUnifiedGlobalStream,
  sendUnifiedWorkbenchStream,
} from "@/lib/unifiedChatSend";

export interface SendMessageOptions {
  /** Start a new server conversation (e.g. compact shell send). */
  forceNewConversation?: boolean;
}

// ============================================================================
// Types
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

function buildWorkbenchRequestContext(draftScopeId: string): Record<string, unknown> {
  const canvasState =
    getWorkbenchCanvasSnapshotForDraft(draftScopeId) ?? emptyWorkbenchCanvasState();
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
  const [isLoadingSession, setIsLoadingSession] = useState(false);

  const messageIdCounter = useRef(0);
  const defaultTenantIdRef = useRef<string | null | undefined>(undefined);

  const [workbenchSavedCanvasId, setWorkbenchSavedCanvasId] = useState<
    string | null
  >(null);

  const resetWorkbenchChatSession = useCallback(() => {
    resetActiveWorkbenchDraftSession();
    setWorkbenchSavedCanvasId(null);
  }, []);

  useEffect(() => {
    if (chatType !== "workbench") return;
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ canvasId?: string; draftScopeId?: string }>)
        .detail;
      if (detail?.canvasId && detail.draftScopeId) {
        const activeDraft = getOrCreateActiveWorkbenchDraftScope();
        if (detail.draftScopeId === activeDraft) {
          setWorkbenchSavedCanvasId(detail.canvasId);
        }
      }
    };
    window.addEventListener("workbench:canvas-saved", handler);
    return () => window.removeEventListener("workbench:canvas-saved", handler);
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
      if (!question.trim() || isLoading) return;

      const forceNew = options?.forceNewConversation ?? false;
      const priorMessages = forceNew ? [] : messages;
      const activeSessionId = forceNew ? null : sessionId;

      const userMessageId = generateMessageId();
      const assistantMessageId = generateMessageId();

      // Add user message
      const userMessage: ChatMessage = {
        id: userMessageId,
        role: "user",
        content: question.trim(),
        timestamp: new Date(),
      };

      // Add loading assistant message
      const loadingMessage: ChatMessage = {
        id: assistantMessageId,
        role: "assistant",
        content: "",
        timestamp: new Date(),
        isLoading: true,
      };

      if (forceNew) {
        setSuggestedQuestions([]);
        setLegacyRef(null);
        setSessionId(null);
        // Draft scope + canvas nav are owned by navigateForWorkbenchChatSubmit (panel);
        // only clear saved-canvas binding when starting a new conversation.
        if (chatType === "workbench") {
          setWorkbenchSavedCanvasId(null);
        }
        setMessages([userMessage, loadingMessage]);
      } else {
        setMessages((prev) => [...prev, userMessage, loadingMessage]);
      }
      setIsLoading(true);

      try {
        const effectiveTenantId = await getEffectiveTenantId();

        if (typeof window !== "undefined" && isUnifiedChatClientEnabled()) {
          const client = createUnifiedChatClient(tenantId ?? effectiveTenantId);
          const history = priorMessages.slice(-6).map((m) => ({
            role: m.role,
            content: m.content,
          }));

          if (chatType === "workbench") {
            const draftScopeId = getOrCreateActiveWorkbenchDraftScope();

            const savedCanvasId =
              workbenchSavedCanvasId ??
              getWorkbenchCanvasIdForDraft(draftScopeId);
            if (savedCanvasId && savedCanvasId !== workbenchSavedCanvasId) {
              setWorkbenchSavedCanvasId(savedCanvasId);
            }

            const scopeId = savedCanvasId ?? draftScopeId;
            const scopeType = savedCanvasId ? ("canvas" as const) : ("draft" as const);

            const { conversationId, parsed } = await sendUnifiedWorkbenchStream({
              client,
              message: question.trim(),
              conversationId: activeSessionId,
              scope: { type: scopeType, id: scopeId },
              context: buildWorkbenchRequestContext(draftScopeId),
              history,
              onStreamText: (text) => {
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantMessageId
                      ? { ...m, content: text, isLoading: true }
                      : m,
                  ),
                );
              },
            });
            setSessionId(conversationId);

            const autoActions = filterExecutableWorkbenchActions(parsed.actions);
            if (autoActions.length > 0) {
              deliverWorkbenchWidgetActions(draftScopeId, autoActions);
            }

            const assistantMessage: ChatMessage = {
              id: assistantMessageId,
              role: "assistant",
              content: parsed.error
                ? `${parsed.message}\n${parsed.error}`
                : parsed.message,
              timestamp: new Date(),
              workbenchActions: parsed.actions,
              workbenchActionsAppliedCount: autoActions.length,
            };
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMessageId ? assistantMessage : m,
              ),
            );
            if (parsed.suggestedQuestions?.length) {
              setSuggestedQuestions(parsed.suggestedQuestions);
            }
          } else {
            const { conversationId, parsed } = await sendUnifiedGlobalStream({
              client,
              message: question.trim(),
              chatType,
              conversationId: activeSessionId,
              history,
              deepAnalysis: researchDeepAnalysis,
              onStreamEvent: applyUnifiedStreamEvent,
              onStreamText: (text) => {
                setMessages((prev) =>
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
              visualizationArtifactId: parsed.visualizationArtifactId,
            };
            setMessages((prev) =>
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
          }
        } else {
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

        setMessages((prev) =>
          prev.map((m) => (m.id === assistantMessageId ? errorMessage : m))
        );

        if (onError) {
          onError(error);
        }
      } finally {
        setIsLoading(false);
      }
    },
    [
      generateMessageId,
      getEffectiveTenantId,
      isLoading,
      messages,
      sessionId,
      tenantId,
      onError,
      chatType,
      researchDeepAnalysis,
      applyUnifiedStreamEvent,
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
      setIsLoading(true);

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
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMessageId
                  ? { ...m, content: text, isLoading: true }
                  : m,
              ),
            );
          };

          if (chatType === "workbench") {
            const draftScopeId = getOrCreateActiveWorkbenchDraftScope();
            const savedCanvasId =
              workbenchSavedCanvasId ??
              getWorkbenchCanvasIdForDraft(draftScopeId);
            const scopeId = savedCanvasId ?? draftScopeId;
            const scopeType = savedCanvasId ? ("canvas" as const) : ("draft" as const);

            const { conversationId, parsed } = await sendUnifiedWorkbenchStream({
              client,
              message: composed,
              conversationId: sessionId,
              scope: { type: scopeType, id: scopeId },
              context: buildWorkbenchRequestContext(draftScopeId),
              history,
              onStreamText,
            });
            setSessionId(conversationId);
            const autoActions = filterExecutableWorkbenchActions(parsed.actions);
            if (autoActions.length > 0) {
              deliverWorkbenchWidgetActions(draftScopeId, autoActions);
            }
            const assistantMessage: ChatMessage = {
              id: assistantMessageId,
              role: "assistant",
              content: parsed.error
                ? `${parsed.message}\n${parsed.error}`
                : parsed.message,
              timestamp: new Date(),
              workbenchActions: parsed.actions,
              workbenchActionsAppliedCount: autoActions.length,
            };
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMessageId ? assistantMessage : m,
              ),
            );
            if (parsed.suggestedQuestions?.length) {
              setSuggestedQuestions(parsed.suggestedQuestions);
            }
          } else {
            const { conversationId, parsed } = await sendUnifiedGlobalStream({
              client,
              message: composed,
              chatType,
              conversationId: sessionId,
              history,
              deepAnalysis: researchDeepAnalysis,
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
              visualizationArtifactId: parsed.visualizationArtifactId,
            };
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMessageId ? assistantMessage : m,
              ),
            );
            if (parsed.suggestedQuestions?.length) {
              setSuggestedQuestions(parsed.suggestedQuestions);
            }
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

        setMessages((prev) =>
          prev.map((m) => (m.id === assistantMessageId ? errorMessage : m))
        );

        if (onError) {
          onError(error);
        }
      } finally {
        setIsLoading(false);
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
      workbenchSavedCanvasId,
    ]
  );
  const clearMessages = useCallback(() => {
    setMessages([]);
    setSessionId(null);
    setLegacyRef(null);
    resetWorkbenchChatSession();
    setSuggestedQuestions(CHAT_TYPE_DEFAULT_SUGGESTIONS[chatType]);
  }, [resetWorkbenchChatSession, chatType]);

  // ===========================================================================
  // Session management
  // ===========================================================================

  /**
   * Fetch the list of saved chat sessions
   */
  const fetchSessions = useCallback(async () => {
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
  }, [getEffectiveTenantId, tenantId]);

  /**
   * Load a specific session's messages into the chat
   */
  const loadSession = useCallback(
    async (targetSessionId: string) => {
      setIsLoadingSession(true);
      try {
        const effectiveTenantId = await getEffectiveTenantId();
        if (typeof window !== "undefined" && isUnifiedChatClientEnabled()) {
          const client = createUnifiedChatClient(tenantId ?? effectiveTenantId);
          const row = await client.getConversation(targetSessionId);
          const raw = (row.messages ?? []) as Array<{
            role?: string;
            content?: string;
            blocks?: UnifiedChatBlock[];
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
              const parsed = parseGlobalFromBlocks(blocks);
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
                visualizationArtifactId: parsed.visualizationArtifactId,
              };
            });
          setMessages(loadedMessages);
          setSessionId(targetSessionId);
          setLegacyRef(row.legacy_ref ?? null);
          return;
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
      } catch (error) {
        console.error("[CohiChat] Failed to load session:", error);
      } finally {
        setIsLoadingSession(false);
      }
    },
    [getEffectiveTenantId, tenantId],
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

  /**
   * Start a new session
   */
  const newSession = useCallback(async () => {
    clearMessages();
    setSessionId(null);
    setIsLoading(false);
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
  }, [clearMessages, fetchSessions, getEffectiveTenantId, resetWorkbenchChatSession]);

  return {
    messages,
    isLoading,
    sessionId,
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
    fetchSessions,
    loadSession,
    deleteSession,
    renameSession,
  };
}
