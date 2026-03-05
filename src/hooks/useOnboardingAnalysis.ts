/**
 * useOnboardingAnalysis Hook
 *
 * Manages SSE streams for the two-phase onboarding flow:
 *  Phase 1 — startAnalysis(connectionId): automated schema analysis
 *  Phase 2 — sendMessage(message): interactive chat with the onboarding agent
 */

import { useState, useCallback, useRef } from "react";
import { api } from "@/lib/api";

// ============================================================================
// Types
// ============================================================================

export interface FieldSwapRecommendation {
  coheusAlias: string;
  recommendedFieldId: string;
  confidence: number;
  reasoning: string;
  currentPopulation: number;
  sampleValues: string[];
}

export interface RevenueFieldCandidate {
  fieldId: string;
  fieldDescription: string;
  detectedRole: "base_price" | "fee" | "credit" | "other";
  populationRate: number;
}

export interface SuggestedAdditionalField {
  fieldId: string;
  description: string;
  populationRate: number;
  reason: string;
}

export interface DataQualityFlag {
  field: string;
  issue: string;
  severity: "critical" | "warning" | "info";
  recommendation: string;
}

export interface RdbMissingField {
  fieldId: string;
  coheusAlias?: string;
  description: string;
  fieldReaderPopulation?: number;
  canonicalName?: string;
}

export interface OnboardingAnalysis {
  fieldSwapRecommendations: FieldSwapRecommendation[];
  revenueFieldCandidates: RevenueFieldCandidate[];
  suggestedAdditionalFields: SuggestedAdditionalField[];
  dataQualityFlags: DataQualityFlag[];
  rdbMissingFields: RdbMissingField[];
  summary: string;
}

export type AnalysisPhase =
  | "idle"
  | "discovery"
  | "sampling"
  | "analyzing"
  | "matching"
  | "quality_check"
  | "complete"
  | "error";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  actionCard?: ActionCard;
  toolResult?: { sql?: string; result?: string };
  timestamp: number;
}

export interface ActionCard {
  id: string;
  tool: string;
  description: string;
  params: Record<string, any>;
  status: "proposed" | "applied" | "rejected";
}

export type OnboardingPhase = "idle" | "analyzing" | "chat" | "error";

// ============================================================================
// SSE Reader
// ============================================================================

async function readSSEStream(
  url: string,
  method: string,
  body: string | undefined,
  onEvent: (event: any) => void,
  signal: AbortSignal
): Promise<void> {
  const response = await api.fetchWithAuth(url, {
    method,
    headers: {
      Accept: "text/event-stream",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body,
    signal,
  });

  if (!response.ok) {
    throw new Error(`SSE connection failed: ${response.status}`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error("No response body");

  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          try {
            const event = JSON.parse(line.slice(6));
            onEvent(event);
          } catch {
            // skip malformed
          }
        }
      }
    }
  } catch (err: any) {
    if (err.name !== "AbortError") throw err;
  }
}

// ============================================================================
// Hook
// ============================================================================

export function useOnboardingAnalysis(connectionId: string | null, tenantId?: string | null) {
  // Phase 1 state
  const [analysis, setAnalysis] = useState<OnboardingAnalysis | null>(null);
  const [analysisPhase, setAnalysisPhase] = useState<AnalysisPhase>("idle");
  const [analysisMessage, setAnalysisMessage] = useState<string>("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  // Phase 2 state
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [isChatLoading, setIsChatLoading] = useState(false);

  // Overall phase
  const [phase, setPhase] = useState<OnboardingPhase>("idle");
  const [error, setError] = useState<string | null>(null);

  // Applied actions tracking
  const [appliedActions, setAppliedActions] = useState<ActionCard[]>([]);

  // Abort controllers
  const analysisAbortRef = useRef<AbortController | null>(null);
  const chatAbortRef = useRef<AbortController | null>(null);

  // ── Phase 1: Start Analysis ──
  const startAnalysis = useCallback(async (strategy?: "hybrid" | "pipeline" | "fullLoan") => {
    if (!connectionId) return;

    // Reset state
    setAnalysis(null);
    setAnalysisPhase("discovery");
    setAnalysisMessage("Starting analysis...");
    setIsAnalyzing(true);
    setPhase("analyzing");
    setError(null);
    setChatMessages([]);
    setAppliedActions([]);

    // Cancel any running stream
    analysisAbortRef.current?.abort();
    const controller = new AbortController();
    analysisAbortRef.current = controller;

    const params = new URLSearchParams();
    if (tenantId) params.set("tenant_id", tenantId);
    if (strategy) params.set("strategy", strategy);
    const queryString = params.toString() ? `?${params.toString()}` : "";

    try {
      await readSSEStream(
        `/api/onboarding/analyze/${connectionId}${queryString}`,
        "POST",
        undefined,
        (event) => {
          if (event.type === "phase" && event.phase) {
            setAnalysisPhase(event.phase as AnalysisPhase);
            if (event.message) setAnalysisMessage(event.message);
          } else if (event.type === "progress" && event.message) {
            setAnalysisMessage(event.message);
          } else if (event.type === "result" && event.data) {
            setAnalysis(event.data);
            setPhase("chat");
          } else if (event.type === "error") {
            setError(event.message || "Analysis failed");
            setAnalysisPhase("error");
            setPhase("error");
          }
        },
        controller.signal
      );
    } catch (err: any) {
      if (err.name !== "AbortError") {
        setError(err.message || "Analysis failed");
        setAnalysisPhase("error");
        setPhase("error");
      }
    } finally {
      setIsAnalyzing(false);
    }
  }, [connectionId, tenantId]);

  // ── Phase 2: Send Chat Message ──
  const sendMessage = useCallback(
    async (message: string) => {
      if (!connectionId || !message.trim()) return;

      const userMsg: ChatMessage = {
        id: `user-${Date.now()}`,
        role: "user",
        content: message,
        timestamp: Date.now(),
      };

      setChatMessages((prev) => [...prev, userMsg]);
      setIsChatLoading(true);
      setError(null);

      chatAbortRef.current?.abort();
      const controller = new AbortController();
      chatAbortRef.current = controller;

      // Build plain history for backend
      const history = chatMessages.map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      }));

      let assistantContent = "";

      try {
        const chatTenantParam = tenantId ? `?tenant_id=${encodeURIComponent(tenantId)}` : "";
        await readSSEStream(
          `/api/onboarding/chat/${connectionId}${chatTenantParam}`,
          "POST",
          JSON.stringify({ message, chatHistory: history }),
          (event) => {
            switch (event.type) {
              case "thinking":
                // Optional: show thinking indicator
                break;

              case "response":
                assistantContent = event.message || "";
                setChatMessages((prev) => [
                  ...prev,
                  {
                    id: `assistant-${Date.now()}`,
                    role: "assistant",
                    content: assistantContent,
                    timestamp: Date.now(),
                  },
                ]);
                break;

              case "action_card":
                if (event.data) {
                  const card = event.data as ActionCard;
                  setAppliedActions((prev) => [...prev, card]);
                  setChatMessages((prev) => [
                    ...prev,
                    {
                      id: `action-${Date.now()}`,
                      role: "system",
                      content: event.message || card.description,
                      actionCard: card,
                      timestamp: Date.now(),
                    },
                  ]);
                }
                break;

              case "tool_result":
                if (event.data) {
                  setChatMessages((prev) => [
                    ...prev,
                    {
                      id: `tool-${Date.now()}`,
                      role: "system",
                      content: event.message || "Query executed",
                      toolResult: event.data,
                      timestamp: Date.now(),
                    },
                  ]);
                }
                break;

              case "error":
                setError(event.message || "Chat failed");
                break;
            }
          },
          controller.signal
        );
      } catch (err: any) {
        if (err.name !== "AbortError") {
          setError(err.message || "Chat failed");
        }
      } finally {
        setIsChatLoading(false);
      }
    },
    [connectionId, chatMessages, tenantId]
  );

  // ── Cancel ──
  const cancel = useCallback(() => {
    analysisAbortRef.current?.abort();
    chatAbortRef.current?.abort();
    setIsAnalyzing(false);
    setIsChatLoading(false);
  }, []);

  // ── Reset ──
  const reset = useCallback(() => {
    cancel();
    setAnalysis(null);
    setAnalysisPhase("idle");
    setAnalysisMessage("");
    setChatMessages([]);
    setAppliedActions([]);
    setPhase("idle");
    setError(null);
  }, [cancel]);

  return {
    // Phase 1
    analysis,
    analysisPhase,
    analysisMessage,
    isAnalyzing,
    startAnalysis,

    // Phase 2
    chatMessages,
    isChatLoading,
    sendMessage,

    // Shared
    phase,
    error,
    appliedActions,
    cancel,
    reset,
  };
}
