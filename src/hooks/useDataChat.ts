/**
 * Data Chat Hook
 * Manages chat state, API calls, and conversation history
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

import type { ResponsePlan } from "@/types/cohiResponsePlan";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** Legacy single-chart response (data-chat/ask) */
  visualization?: VisualizationConfig;
  data?: any[];
  /** COHI structured response (api/cohi/query) */
  responsePlan?: ResponsePlan;
  dataPayloads?: Record<string, unknown[]>;
  timestamp: Date;
  isLoading?: boolean;
  error?: string;
}

export interface DataChatResponse {
  message: string;
  visualization?: VisualizationConfig;
  data?: any[];
  suggestedQuestions?: string[];
  error?: string;
}

export interface UseChatOptions {
  tenantId?: string;
  onError?: (error: Error) => void;
}

// ============================================================================
// Demo Data Generator - Simulated responses with visualizations
// ============================================================================

const generateDemoResponse = (question: string): DataChatResponse => {
  const q = question.toLowerCase();

  // Important info / daily briefing – Top Performers leaderboard (units, volume, pullthrough, turntime, revenue)
  if (
    q.includes("important") ||
    q.includes("today") ||
    q.includes("briefing") ||
    q.includes("know")
  ) {
    return {
      message:
        "Here's your executive briefing for today. Top performers MTD: Sarah Chen leads with 42 units and $18.2M volume (67% pull-through, 28-day turntime, $434K revenue). Mike Torres and Jess Rivera round out the top three. Focus areas: pipeline velocity and reducing fallout in the retail channel.",
      visualization: {
        type: "horizontal_bar",
        title: "Top Performers (MTD)",
        data: [
          {
            name: "Sarah Chen",
            units: 42,
            volume: 18200000,
            pullthrough: 67,
            turntime: 28,
            revenue: 434000,
          },
          {
            name: "Mike Torres",
            units: 38,
            volume: 15600000,
            pullthrough: 64,
            turntime: 31,
            revenue: 411000,
          },
          {
            name: "Jess Rivera",
            units: 35,
            volume: 14200000,
            pullthrough: 62,
            turntime: 30,
            revenue: 406000,
          },
          {
            name: "Alex Kim",
            units: 31,
            volume: 12800000,
            pullthrough: 59,
            turntime: 33,
            revenue: 413000,
          },
          {
            name: "Jordan Lee",
            units: 28,
            volume: 11900000,
            pullthrough: 61,
            turntime: 29,
            revenue: 425000,
          },
        ],
        xKey: "name",
        yKey: "units",
        nameKey: "name",
        valueKey: "units",
        colors: ["#3B82F6", "#10B981", "#8B5CF6", "#F59E0B", "#EC4899"],
      },
      suggestedQuestions: [
        "Show me loans by branch",
        "What is our pull-through rate trend?",
        "Show me volume by loan officer",
        "Show me fallout by reason",
      ],
    };
  }

  // Loans by branch
  if (q.includes("branch")) {
    return {
      message:
        "Here's the loan distribution by branch. The West Region leads with 245 loans ($89M), followed by East Region with 198 loans ($72M). Central and South regions are close behind.",
      visualization: {
        type: "horizontal_bar",
        title: "Loans by Branch",
        data: [
          { branch: "West Region", loans: 245 },
          { branch: "East Region", loans: 198 },
          { branch: "Central Region", loans: 187 },
          { branch: "South Region", loans: 142 },
          { branch: "Northeast", loans: 75 },
        ],
        xKey: "branch",
        yKey: "loans",
        colors: ["#3B82F6", "#10B981", "#F59E0B", "#8B5CF6", "#EC4899"],
      },
      suggestedQuestions: [
        "Show me volume by branch",
        "Which branch has the best pull-through?",
        "Compare branch performance over time",
      ],
    };
  }

  // Loan amount / average / loan type
  if (
    q.includes("average") ||
    q.includes("loan amount") ||
    q.includes("loan type")
  ) {
    return {
      message:
        "Average loan amounts vary significantly by type. Jumbo loans average $1.2M, while FHA loans average $285K. Conventional loans are in the middle at $425K.",
      visualization: {
        type: "bar",
        title: "Average Loan Amount by Type",
        data: [
          { type: "Conventional", amount: 425000 },
          { type: "FHA", amount: 285000 },
          { type: "VA", amount: 365000 },
          { type: "Jumbo", amount: 1200000 },
          { type: "USDA", amount: 225000 },
        ],
        xKey: "type",
        yKey: "amount",
        colors: ["#8B5CF6"],
      },
      suggestedQuestions: [
        "Show me volume by loan type",
        "What is the trend in jumbo loans?",
        "Compare conventional vs FHA performance",
      ],
    };
  }

  // Volume over time / trend
  if ((q.includes("volume") && q.includes("time")) || q.includes("trend")) {
    return {
      message:
        "Loan volume has been trending upward over the past 6 months. January shows strong momentum with $312M in pipeline, up 8% from December.",
      visualization: {
        type: "area",
        title: "Loan Volume Trend (6 Months)",
        data: [
          { month: "Aug", volume: 245000000 },
          { month: "Sep", volume: 268000000 },
          { month: "Oct", volume: 289000000 },
          { month: "Nov", volume: 275000000 },
          { month: "Dec", volume: 289000000 },
          { month: "Jan", volume: 312000000 },
        ],
        xKey: "month",
        yKey: "volume",
        colors: ["#10B981"],
      },
      suggestedQuestions: [
        "Compare this month to last year",
        "Show me weekly volume breakdown",
        "What is driving the growth?",
      ],
    };
  }

  // Top loan officers
  if (
    q.includes("loan officer") ||
    (q.includes("top") && (q.includes("officer") || q.includes("producer")))
  ) {
    return {
      message:
        "Here are your top 10 loan officers by volume this month. Sarah Johnson leads with $18.5M across 42 loans, followed by Michael Chen at $16.2M. The top 10 represent 45% of total pipeline volume.",
      visualization: {
        type: "table",
        title: "Top Loan Officers (MTD)",
        data: [
          {
            rank: 1,
            name: "Sarah Johnson",
            loans: 42,
            volume: 18500000,
            pullThrough: 72,
          },
          {
            rank: 2,
            name: "Michael Chen",
            loans: 38,
            volume: 16200000,
            pullThrough: 68,
          },
          {
            rank: 3,
            name: "Emily Rodriguez",
            loans: 35,
            volume: 14800000,
            pullThrough: 75,
          },
          {
            rank: 4,
            name: "David Kim",
            loans: 32,
            volume: 13500000,
            pullThrough: 65,
          },
          {
            rank: 5,
            name: "Jennifer Lee",
            loans: 30,
            volume: 12900000,
            pullThrough: 70,
          },
          {
            rank: 6,
            name: "Robert Martinez",
            loans: 28,
            volume: 11800000,
            pullThrough: 62,
          },
          {
            rank: 7,
            name: "Amanda Thompson",
            loans: 26,
            volume: 10500000,
            pullThrough: 71,
          },
          {
            rank: 8,
            name: "Chris Williams",
            loans: 24,
            volume: 9800000,
            pullThrough: 67,
          },
          {
            rank: 9,
            name: "Lisa Garcia",
            loans: 22,
            volume: 9200000,
            pullThrough: 69,
          },
          {
            rank: 10,
            name: "James Brown",
            loans: 20,
            volume: 8500000,
            pullThrough: 64,
          },
        ],
        tableConfig: {
          columns: [
            { key: "rank", label: "Rank" },
            { key: "name", label: "Loan Officer" },
            { key: "loans", label: "Loans" },
            { key: "volume", label: "Volume", format: "currency" },
            { key: "pullThrough", label: "Pull-Through %", format: "percent" },
          ],
          sortable: true,
          pageSize: 10,
        },
      },
      suggestedQuestions: [
        "Show me officer performance trends",
        "Who has the best pull-through rate?",
        "Compare by branch",
      ],
    };
  }

  // Pull-through rate
  if (
    q.includes("pull-through") ||
    q.includes("pull through") ||
    q.includes("conversion")
  ) {
    return {
      message:
        "Pull-through rate is currently at 60% MTD, which is slightly below our 65% target. The retail channel shows the strongest conversion at 68%, while wholesale is lagging at 52%.",
      visualization: {
        type: "donut",
        title: "Pull-Through by Channel",
        data: [
          { channel: "Retail", rate: 68 },
          { channel: "Wholesale", rate: 52 },
          { channel: "Correspondent", rate: 58 },
          { channel: "Consumer Direct", rate: 55 },
        ],
        nameKey: "channel",
        valueKey: "rate",
        colors: ["#10B981", "#EF4444", "#F59E0B", "#8B5CF6"],
      },
      suggestedQuestions: [
        "What is causing low wholesale pull-through?",
        "Show me pull-through trend over time",
        "Compare to last month",
      ],
    };
  }

  // Fallout analysis
  if (
    q.includes("fallout") ||
    q.includes("withdraw") ||
    q.includes("decline")
  ) {
    return {
      message:
        "Fallout analysis shows 200 loans at risk this month. The primary drivers are rate shopping (35%), credit issues (25%), and property appraisal problems (20%). Early intervention could recover an estimated $45M.",
      visualization: {
        type: "pie",
        title: "Fallout Reasons",
        data: [
          { reason: "Rate Shopping", count: 70 },
          { reason: "Credit Issues", count: 50 },
          { reason: "Appraisal", count: 40 },
          { reason: "Income Verification", count: 25 },
          { reason: "Other", count: 15 },
        ],
        nameKey: "reason",
        valueKey: "count",
        colors: ["#EF4444", "#F59E0B", "#8B5CF6", "#3B82F6", "#6B7280"],
      },
      suggestedQuestions: [
        "Show me high-risk loans",
        "What can we do to reduce fallout?",
        "Compare fallout by loan officer",
      ],
    };
  }

  // Default response with KPI
  return {
    message:
      "Based on your pipeline data, here's a summary of key metrics. The portfolio shows healthy activity with opportunities to improve pull-through rate and reduce cycle time.",
    visualization: {
      type: "bar",
      title: "Key Performance Indicators",
      data: [
        { metric: "Active Loans", value: 847 },
        { metric: "Locked", value: 707 },
        { metric: "Closed MTD", value: 127 },
        { metric: "At Risk", value: 200 },
      ],
      xKey: "metric",
      yKey: "value",
      colors: ["#3B82F6", "#8B5CF6", "#10B981", "#EF4444"],
    },
    suggestedQuestions: [
      "Show me loan volume by month",
      "Top loan officers by revenue",
      "Loans by branch this year",
      "Average cycle time by loan type",
    ],
  };
};

// ============================================================================
// Hook
// ============================================================================

export function useDataChat(options: UseChatOptions = {}) {
  const { tenantId, onError } = options;

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [suggestedQuestions, setSuggestedQuestions] = useState<string[]>([
    "What important info do I need to know today?",
    "Show me loan volume by month this year",
    "Top 10 loan officers by funded volume",
    "How is our pipeline looking?",
  ]);

  const messageIdCounter = useRef(0);
  const defaultTenantIdRef = useRef<string | null | undefined>(undefined);

  /** Resolve tenant for request: use provided tenantId or fetch first/default tenant once (for platform admin / demo). */
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
      /* /api/tenants may 403 or fail; try default-tenant next */
    }
    try {
      const defaultRes = await api.request<{ tenantId: string | null }>(
        "/api/data-chat/default-tenant"
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
          "/api/data-chat/new-session",
          {
            method: "POST",
          }
        );
        if (response.sessionId) {
          setSessionId(response.sessionId);
        }
      } catch (error) {
        console.error("[DataChat] Failed to create session:", error);
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
        const cohiEndpoint = effectiveTenantId
          ? `/api/cohi/query?tenant_id=${encodeURIComponent(effectiveTenantId)}`
          : "/api/cohi/query";
        const cohiResponse = await api.request<{
          responsePlan: ResponsePlan;
          dataPayloads?: Record<string, unknown[]>;
          audit?: { generatedAt: string; latencyMs?: number };
        }>(cohiEndpoint, {
          method: "POST",
          body: JSON.stringify({
            question: question.trim(),
            context: {},
          }),
        });

        const plan = cohiResponse.responsePlan;
        const dataPayloads = cohiResponse.dataPayloads ?? {};

        const assistantMessage: ChatMessage = {
          id: assistantMessageId,
          role: "assistant",
          content: plan.title && plan.sections?.length ? plan.title : "Here’s what I found.",
          responsePlan: plan,
          dataPayloads,
          timestamp: new Date(),
          error: undefined,
        };

        setMessages((prev) =>
          prev.map((m) => (m.id === assistantMessageId ? assistantMessage : m))
        );

        if (plan.missing_data_requests?.length) {
          setSuggestedQuestions(plan.missing_data_requests.map((r) => r.question));
        } else {
          setSuggestedQuestions([
            "Who are the top performers this month?",
            "Show bottom performers by pull-through last 90 days",
            "What do I need to know today?",
          ]);
        }
      } catch (error: any) {
        console.error("[DataChat] COHI query failed:", error);
        const errorMessage: ChatMessage = {
          id: assistantMessageId,
          role: "assistant",
          content: "I couldn’t process that. Please check your connection and try again.",
          timestamp: new Date(),
          error: error?.message ?? "Request failed",
        };
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantMessageId ? errorMessage : m))
        );
        setSuggestedQuestions([
          "Who are the top performers this month?",
          "What do I need to know today?",
        ]);
      } finally {
        setIsLoading(false);
      }
    },
    [
      generateMessageId,
      getEffectiveTenantId,
      isLoading,
      messages,
      onError,
      sessionId,
      tenantId,
    ]
  );

  /**
   * Add a user/assistant message pair without calling the API (e.g. file analysis result with optional visualization).
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

      // Add refinement as user message
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
          ? `/api/data-chat/refine?tenant_id=${encodeURIComponent(
              effectiveTenantId
            )}`
          : "/api/data-chat/refine";
        const response = await api.request<DataChatResponse>(endpoint, {
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
        };

        setMessages((prev) =>
          prev.map((m) => (m.id === assistantMessageId ? assistantMessage : m))
        );

        if (response.suggestedQuestions) {
          setSuggestedQuestions(response.suggestedQuestions);
        }
      } catch (error: any) {
        console.error("[DataChat] Error refining query:", error);

        const errorMessage: ChatMessage = {
          id: assistantMessageId,
          role: "assistant",
          content:
            "I encountered an error refining your query. Please try again.",
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
    ]
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
          ? `/api/data-chat/save-visualization?tenant_id=${encodeURIComponent(
              effectiveTenantId
            )}`
          : "/api/data-chat/save-visualization";
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
        console.error("[DataChat] Error saving visualization:", error);
        throw error;
      }
    },
    [getEffectiveTenantId, tenantId]
  );

  /**
   * Clear chat history
   */
  const clearMessages = useCallback(() => {
    setMessages([]);
    setSuggestedQuestions([
      "What important info do I need to know today?",
      "Show me loan volume by month this year",
      "Top 10 loan officers by funded volume",
      "How is our pipeline looking?",
    ]);
  }, []);

  /**
   * Start a new session
   */
  const newSession = useCallback(async () => {
    clearMessages();
    try {
      const response = await api.request<{ sessionId: string }>(
        "/api/data-chat/new-session",
        {
          method: "POST",
        }
      );
      if (response.sessionId) {
        setSessionId(response.sessionId);
      }
    } catch (error) {
      console.error("[DataChat] Failed to create new session:", error);
    }
  }, [clearMessages]);

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
