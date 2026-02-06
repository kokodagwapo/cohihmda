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
    | "horizontal_bar";
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
  sources?: {
    dataQuery?: boolean;
    knowledgeBase?: string[];
  };
  /** Structured COHI response (from /api/cohi/query) */
  responsePlan?: import("@/types/cohiResponsePlan").ResponsePlan;
  dataPayloads?: Record<string, unknown[]>;
}

export interface CohiChatResponse {
  message: string;
  visualization?: VisualizationConfig;
  data?: any[];
  suggestedQuestions?: string[];
  error?: string;
  sources?: {
    dataQuery?: boolean;
    knowledgeBase?: string[];
  };
}

export interface UseCohiChatOptions {
  tenantId?: string;
  onError?: (error: Error) => void;
}

// ============================================================================
// Error message helpers (no fake demo – show real status per COHI requirements)
// ============================================================================

function getFriendlyErrorMessage(error: any): string {
  const msg = error?.message ?? String(error);
  const lower = msg.toLowerCase();
  if (
    lower.includes("tenant") ||
    lower.includes("no tenant selected") ||
    lower.includes("select a tenant") ||
    lower.includes("requiresTenantSelection")
  ) {
    return "Please select a tenant from the header to view data in COHI Chat.";
  }
  if (
    lower.includes("fetch") ||
    lower.includes("network") ||
    lower.includes("econnrefused") ||
    lower.includes("socket") ||
    lower.includes("failed to fetch")
  ) {
    return "Unable to connect to the server. Check that the backend is running and try again.";
  }
  if (lower.includes("403") || lower.includes("access denied")) {
    return "You don't have access to COHI Chat for this tenant.";
  }
  if (lower.includes("401") || lower.includes("unauthorized")) {
    return "Session expired or not authorized. Please sign in again.";
  }
  return msg && msg.length < 200 ? msg : "Unable to load data. Please try again.";
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
    "What's total loan volume this month?",
    "Show me TopTiering leaderboard",
    "How did fundings trend last quarter?",
    "Loans by product type",
  ]);

  const messageIdCounter = useRef(0);

  /** Resolve tenant for request. Per COHI requirements data must be synced with SELECTED tenant – no silent fallback to first tenant. */
  const getEffectiveTenantId = useCallback(async (): Promise<string | null> => {
    if (tenantId) return tenantId;
    return null;
  }, [tenantId]);

  // Initialize session on mount (pass tenant_id so backend can scope session to selected tenant)
  useEffect(() => {
    const initSession = async () => {
      try {
        const effectiveTenantId = await getEffectiveTenantId();
        const endpoint = effectiveTenantId
          ? `/api/cohi-chat/new-session?tenant_id=${encodeURIComponent(effectiveTenantId)}`
          : "/api/cohi-chat/new-session";
        const response = await api.request<{ sessionId: string }>(endpoint, {
          method: "POST",
        });
        if (response.sessionId) {
          setSessionId(response.sessionId);
        }
      } catch (error) {
        console.error("[CohiChat] Failed to create session:", error);
      }
    };
    initSession();
  }, [getEffectiveTenantId]);

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

      let effectiveTenantId: string | null = null;

      try {
        effectiveTenantId = await getEffectiveTenantId();

        // Per COHI requirements: data must be synced with selected tenant – require tenant
        if (!effectiveTenantId) {
          const noTenantMessage: ChatMessage = {
            id: assistantMessageId,
            role: "assistant",
            content:
              "Please select a tenant from the header to view data in COHI Chat. Your answers and insights will then come from that tenant's database.",
            timestamp: new Date(),
            error: "NO_TENANT",
          };
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantMessageId ? noTenantMessage : m))
          );
          setIsLoading(false);
          return;
        }

        const endpoint = `/api/cohi-chat/ask?tenant_id=${encodeURIComponent(effectiveTenantId)}`;
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

        // Update assistant message with response (guard empty/malformed response)
        let assistantMessage: ChatMessage = {
          id: assistantMessageId,
          role: "assistant",
          content:
            typeof response.message === "string" && response.message.trim()
              ? response.message
              : "I couldn't generate a response for that. Please try rephrasing or try again.",
          visualization: response.visualization,
          data: response.data,
          timestamp: new Date(),
          error: response.error,
          sources: response.sources,
        };

        setMessages((prev) =>
          prev.map((m) => (m.id === assistantMessageId ? assistantMessage : m))
        );

        if (response.suggestedQuestions) {
          setSuggestedQuestions(response.suggestedQuestions);
        }

        // Enrich with COHI structured insight (responsePlan) from /api/cohi/query so CohiInsightPanel shows below
        try {
          const cohiEndpoint = `/api/cohi/query?tenant_id=${encodeURIComponent(effectiveTenantId)}`;
          const cohiRes = await api.request<{
            responsePlan: import("@/types/cohiResponsePlan").ResponsePlan;
            dataPayloads?: Record<string, unknown[]>;
          }>(cohiEndpoint, {
            method: "POST",
            body: JSON.stringify({ question: question.trim(), context: {} }),
          });
          if (cohiRes?.responsePlan) {
            assistantMessage = {
              ...assistantMessage,
              responsePlan: cohiRes.responsePlan,
              dataPayloads: cohiRes.dataPayloads ?? {},
            };
            setMessages((prev) =>
              prev.map((m) => (m.id === assistantMessageId ? assistantMessage : m))
            );
          }
        } catch (_) {
          // COHI query optional; chat answer already shown
        }
      } catch (error: any) {
        console.error("[CohiChat] Error sending message:", error);

        // Try to get at least structured data from /api/cohi/query when ask fails (per COHI requirements: show insights from pipeline)
        let fallbackMessage: ChatMessage = {
          id: assistantMessageId,
          role: "assistant",
          content: getFriendlyErrorMessage(error),
          timestamp: new Date(),
          error: error?.message,
        };

        if (effectiveTenantId) {
          try {
            const cohiEndpoint = `/api/cohi/query?tenant_id=${encodeURIComponent(effectiveTenantId)}`;
            const cohiRes = await api.request<{
              responsePlan: import("@/types/cohiResponsePlan").ResponsePlan;
              dataPayloads?: Record<string, unknown[]>;
            }>(cohiEndpoint, {
              method: "POST",
              body: JSON.stringify({ question: question.trim(), context: {} }),
            });
            if (cohiRes?.responsePlan) {
              const summary =
                cohiRes.responsePlan?.summary?.trim() ||
                "Here’s the data view for your question.";
              fallbackMessage = {
                ...fallbackMessage,
                content: `${getFriendlyErrorMessage(error)}\n\n**Data view:** ${summary}`,
                responsePlan: cohiRes.responsePlan,
                dataPayloads: cohiRes.dataPayloads ?? {},
              };
            }
          } catch (_) {
            // Keep friendly error message only
          }
        }

        setMessages((prev) =>
          prev.map((m) => (m.id === assistantMessageId ? fallbackMessage : m))
        );
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
   * Save a visualization to custom dashboard
   */
  const saveVisualization = useCallback(
    async (
      visualization: VisualizationConfig,
      question: string,
      title?: string,
      description?: string
    ) => {
      try {
        const effectiveTenantId = await getEffectiveTenantId();
        const endpoint = effectiveTenantId
          ? `/api/cohi-chat/save-visualization?tenant_id=${encodeURIComponent(effectiveTenantId)}`
          : "/api/cohi-chat/save-visualization";
        
        const response = await api.request(endpoint, {
          method: "POST",
          body: JSON.stringify({
            title: title || visualization.title,
            description,
            question,
            visualization,
            queryConfig: {},
          }),
        });
        return response;
      } catch (error: any) {
        console.error("[CohiChat] Error saving visualization:", error);
        throw error;
      }
    },
    [getEffectiveTenantId]
  );

  /**
   * Clear chat history
   */
  const clearMessages = useCallback(() => {
    setMessages([]);
    setSuggestedQuestions([
      "What's total loan volume this month?",
      "Show me TopTiering leaderboard",
      "How did fundings trend last quarter?",
      "Loans by product type",
    ]);
  }, []);

  /**
   * Start a new session (uses current effective tenant so data stays synced with selected tenant)
   */
  const newSession = useCallback(async () => {
    clearMessages();
    try {
      const effectiveTenantId = await getEffectiveTenantId();
      const endpoint = effectiveTenantId
        ? `/api/cohi-chat/new-session?tenant_id=${encodeURIComponent(effectiveTenantId)}`
        : "/api/cohi-chat/new-session";
      const response = await api.request<{ sessionId: string }>(endpoint, {
        method: "POST",
      });
      if (response.sessionId) {
        setSessionId(response.sessionId);
      }
    } catch (error) {
      console.error("[CohiChat] Failed to create new session:", error);
    }
  }, [clearMessages, getEffectiveTenantId]);

  return {
    messages,
    isLoading,
    sessionId,
    suggestedQuestions,
    sendMessage,
    addConversationTurn,
    refineQuery,
    saveVisualization,
    clearMessages,
    newSession,
  };
}

// Export with alias for backwards compatibility
export { useCohiChat as useDataChat };
