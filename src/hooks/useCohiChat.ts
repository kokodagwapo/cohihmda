/**
 * Cohi Chat Hook
 * Manages chat state, API calls, and conversation history
 * Uses the hybrid data + knowledge architecture
 */

import { useState, useCallback, useRef, useEffect } from "react";
import { api } from "@/lib/api";

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
  onError?: (error: Error) => void;
}

// ============================================================================
// Hook
// ============================================================================

export function useCohiChat(options: UseCohiChatOptions = {}) {
  const { tenantId, onError } = options;

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [suggestedQuestions, setSuggestedQuestions] = useState<string[]>([
    "What's important to know today?",
    "Show me loan volume by month",
    "What are the FHA requirements?",
    "Top loan officers by revenue",
  ]);
  const [chatSessions, setChatSessions] = useState<ChatSession[]>([]);
  const [isLoadingSessions, setIsLoadingSessions] = useState(false);
  const [isLoadingSession, setIsLoadingSession] = useState(false);

  const messageIdCounter = useRef(0);
  const defaultTenantIdRef = useRef<string | null | undefined>(undefined);

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

  // Initialize session on mount
  useEffect(() => {
    const initSession = async () => {
      try {
        const response = await api.request<{ sessionId: string }>(
          "/api/cohi-chat/new-session",
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
  }, []);

  /**
   * Generate unique message ID
   */
  const generateMessageId = useCallback(() => {
    messageIdCounter.current += 1;
    return `msg-${Date.now()}-${messageIdCounter.current}`;
  }, []);

  /**
   * Send a question and get AI response
   */
  const sendMessage = useCallback(
    async (question: string) => {
      if (!question.trim() || isLoading) return;

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

      setMessages((prev) => [...prev, userMessage, loadingMessage]);
      setIsLoading(true);

      try {
        const effectiveTenantId = await getEffectiveTenantId();
        const endpoint = effectiveTenantId
          ? `/api/cohi-chat/ask?tenant_id=${encodeURIComponent(effectiveTenantId)}`
          : "/api/cohi-chat/ask";
        
        const response = await api.request<CohiChatResponse>(endpoint, {
          method: "POST",
          body: JSON.stringify({
            question: question.trim(),
            sessionId,
            conversationHistory: messages.slice(-6).map((m) => ({
              id: m.id,
              role: m.role,
              content: m.content,
              timestamp: m.timestamp,
            })),
          }),
        });

        // Update assistant message with response
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
        };

        setMessages((prev) =>
          prev.map((m) => (m.id === assistantMessageId ? assistantMessage : m))
        );

        if (response.suggestedQuestions) {
          setSuggestedQuestions(response.suggestedQuestions);
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
    [generateMessageId, getEffectiveTenantId, isLoading, messages, sessionId]
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
        };

        setMessages((prev) =>
          prev.map((m) => (m.id === assistantMessageId ? assistantMessage : m))
        );

        if (response.suggestedQuestions) {
          setSuggestedQuestions(response.suggestedQuestions);
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
    [generateMessageId, getEffectiveTenantId, messages, onError, sessionId]
  );

  /**
   * Clear chat history
   */
  const clearMessages = useCallback(() => {
    setMessages([]);
    setSuggestedQuestions([
      "What's important to know today?",
      "Show me loan volume by month",
      "What are the FHA requirements?",
      "Top loan officers by revenue",
    ]);
  }, []);

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
      const qs = effectiveTenantId
        ? `?tenant_id=${encodeURIComponent(effectiveTenantId)}`
        : "";
      const response = await api.request<{ sessions: ChatSession[] }>(
        `/api/cohi-chat/sessions${qs}`
      );
      setChatSessions(response.sessions || []);
    } catch (error) {
      console.error("[CohiChat] Failed to fetch sessions:", error);
    } finally {
      setIsLoadingSessions(false);
    }
  }, [getEffectiveTenantId]);

  /**
   * Load a specific session's messages into the chat
   */
  const loadSession = useCallback(
    async (targetSessionId: string) => {
      setIsLoadingSession(true);
      try {
        const effectiveTenantId = await getEffectiveTenantId();
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
        setSuggestedQuestions([
          "What's important to know today?",
          "Show me loan volume by month",
          "What are the FHA requirements?",
          "Top loan officers by revenue",
        ]);
      } catch (error) {
        console.error("[CohiChat] Failed to load session:", error);
      } finally {
        setIsLoadingSession(false);
      }
    },
    [getEffectiveTenantId]
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
        const qs = effectiveTenantId
          ? `?tenant_id=${encodeURIComponent(effectiveTenantId)}`
          : "";
        await api.request(`/api/cohi-chat/sessions/${targetSessionId}${qs}`, {
          method: "DELETE",
        });

        if (sessionId === targetSessionId) {
          clearMessages();
          setSessionId(null);
        }
      } catch (error) {
        console.error("[CohiChat] Failed to delete session:", error);
        setChatSessions(previousSessions);
      }
    },
    [chatSessions, clearMessages, getEffectiveTenantId, sessionId]
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
    try {
      const response = await api.request<{ sessionId: string }>(
        "/api/cohi-chat/new-session",
        { method: "POST" }
      );
      if (response.sessionId) {
        setSessionId(response.sessionId);
      }
      fetchSessions();
    } catch (error) {
      console.error("[CohiChat] Failed to create new session:", error);
    }
  }, [clearMessages, fetchSessions]);

  return {
    messages,
    isLoading,
    sessionId,
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
