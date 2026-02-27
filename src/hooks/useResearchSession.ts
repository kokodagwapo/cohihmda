/**
 * useResearchSession
 *
 * React hook for managing research analyst sessions.
 * Handles SSE streaming, pause/resume, follow-up questions,
 * session history, and feedback submission.
 */

import { useState, useCallback, useRef, useEffect } from "react";
import { api } from "@/lib/api";

// ============================================================================
// Types (mirrors server-side types)
// ============================================================================

export interface InvestigationQuestion {
  id: number;
  topic: string;
  hypothesis: string;
  approach: string;
  priority: "high" | "medium" | "low";
  category: string;
}

export interface ResearchPlan {
  summary: string;
  questions: InvestigationQuestion[];
}

export interface InsightContext {
  insightId?: number;
  headline: string;
  understory: string;
  keyMetrics?: Record<string, any>;
  evidenceSummary?: string;
  chatHistory?: Array<{ role: string; content: string }>;
}

export interface EvidenceItem {
  sql: string;
  explanation: string;
  rows: Record<string, any>[];
  rowCount: number;
  fields: string[];
  columnFormats?: Record<string, string>;
}

export interface Finding {
  questionId: number;
  title: string;
  summary: string;
  confidence: "high" | "medium" | "low";
  evidence: EvidenceItem[];
  keyMetrics: Record<string, string | number>;
  keyMetricDescriptions?: Record<string, string>;
  keyMetricFormats?: Record<string, string>;
}

export interface ResearchTheme {
  name: string;
  description: string;
  findingIds: number[];
  severity: "critical" | "warning" | "info" | "positive";
}

export interface RankedInsight {
  rank: number;
  headline: string;
  /** One-line actionable takeaway. */
  keyTakeaway?: string;
  detail: string;
  impact: "high" | "medium" | "low";
  supportingFindingIds: number[];
  recommendedAction?: string;
}

export interface FurtherInvestigation {
  question: string;
  rationale: string;
}

export interface ResearchReport {
  /** Optional 1-2 sentence direct answer to the user's original question. */
  directAnswer?: string | null;
  executiveSummary: string;
  themes: ResearchTheme[];
  rankedInsights: RankedInsight[];
  furtherInvestigation: FurtherInvestigation[];
  generatedAt: string;
}

export type SessionPhase =
  | "idle"
  | "creating"
  | "planning"
  | "investigating"
  | "synthesizing"
  | "complete"
  | "followup"
  | "error";

export type ResearchMode = "quick" | "deep";

export interface AgentEvent {
  type: string;
  data: any;
  timestamp: number;
}

export interface SessionListItem {
  id: string;
  topic: string | null;
  phase: string;
  /** From planner (e.g. performance, risk, pipeline) for sidebar badges. */
  primaryCategory?: string | null;
  isOwner?: boolean;
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// Hook
// ============================================================================

export function useResearchSession(tenantId?: string | null) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [phase, setPhase] = useState<SessionPhase>("idle");
  const [plan, setPlan] = useState<ResearchPlan | null>(null);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [report, setReport] = useState<ResearchReport | null>(null);
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [sessions, setSessions] = useState<SessionListItem[]>([]);
  const [sessionVisibility, setSessionVisibility] = useState<string>("private");
  const [sessionSharedWithUserIds, setSessionSharedWithUserIds] = useState<string[]>([]);

  const abortRef = useRef<AbortController | null>(null);
  const sessionIdRef = useRef<string | null>(null);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (abortRef.current) {
        abortRef.current.abort();
        abortRef.current = null;
      }
    };
  }, []);

  const tenantParam = tenantId ? `?tenant_id=${tenantId}` : "";

  // ── SSE stream reader ──
  const readSSEStream = useCallback(
    async (url: string, method: string = "GET", body?: string) => {
      const token = localStorage.getItem("auth_token");
      const baseUrl = import.meta.env.DEV ? "" : (import.meta.env.VITE_API_URL || "");
      const controller = new AbortController();
      abortRef.current = controller;

      const response = await fetch(`${baseUrl}${url}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "text/event-stream",
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body,
        signal: controller.signal,
      });

      if (!response.ok) throw new Error(`SSE connection failed: ${response.status}`);

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
                const event = JSON.parse(line.slice(6)) as AgentEvent;
                processEvent(event);
              } catch {
                // Skip malformed
              }
            }
          }
        }
      } catch (err: any) {
        if (err.name !== "AbortError") {
          console.error("[Research] SSE stream error:", err);
          setPhase("error");
          setError(err.message || "Stream disconnected");
          setIsRunning(false);
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  // Process incoming SSE event
  const processEvent = useCallback((event: AgentEvent) => {
    setEvents((prev) => [...prev, event]);

    switch (event.type) {
      case "phase":
        setPhase(event.data.phase as SessionPhase);
        break;
      case "plan":
        setPlan(event.data as ResearchPlan);
        break;
      case "agent_finding": {
        try {
          const finding = JSON.parse(event.data.content) as Finding;
          setFindings((prev) => [...prev, finding]);
        } catch {
          // not parseable
        }
        break;
      }
      case "quick_result":
        setFindings([event.data as Finding]);
        break;
      case "synthesis":
        setReport(event.data as ResearchReport);
        break;
      case "complete":
        setPhase("complete");
        setIsRunning(false);
        setIsPaused(false);
        break;
      case "error":
        setPhase("error");
        setError(event.data.message || "Unknown error");
        setIsRunning(false);
        setIsPaused(false);
        break;
      case "paused":
        setIsPaused(true);
        break;
      case "resumed":
        setIsPaused(false);
        break;
    }
  }, []);

  // ── Start a new research session ──
  const startSession = useCallback(
    async (topic?: string, initialContext?: InsightContext, mode: ResearchMode = "quick") => {
      setPhase("creating");
      setError(null);
      setPlan(null);
      setFindings([]);
      setReport(null);
      setEvents([]);
      setIsRunning(true);
      setIsPaused(false);

      if (abortRef.current) {
        abortRef.current.abort();
        abortRef.current = null;
      }

      try {
        const body: Record<string, unknown> = {};
        if (topic) body.topic = topic;
        if (initialContext) body.initialContext = initialContext;
        body.mode = mode;

        const result = await api.request<{ sessionId: string }>(
          `/api/research/sessions${tenantParam}`,
          { method: "POST", body: JSON.stringify(body) }
        );

        const newSessionId = result.sessionId;
        setSessionId(newSessionId);
        sessionIdRef.current = newSessionId;

        readSSEStream(`/api/research/sessions/${newSessionId}/stream${tenantParam}`);
      } catch (err: any) {
        console.error("[Research] Failed to start session:", err);
        setPhase("error");
        setError(err.message || "Failed to start session");
        setIsRunning(false);
      }
    },
    [tenantParam, readSSEStream]
  );

  // ── Send steering command ──
  const steer = useCallback(
    async (message: string) => {
      const id = sessionIdRef.current;
      if (!id || !isRunning) return;

      try {
        await api.request(`/api/research/sessions/${id}/steer${tenantParam}`, {
          method: "POST",
          body: JSON.stringify({ message }),
        });

        setEvents((prev) => [
          ...prev,
          { type: "user_steer", data: { message }, timestamp: Date.now() },
        ]);
      } catch (err: any) {
        console.error("[Research] Steering failed:", err);
      }
    },
    [tenantParam, isRunning]
  );

  // ── Pause ──
  const pause = useCallback(async () => {
    const id = sessionIdRef.current;
    if (!id) return;
    try {
      await api.request(`/api/research/sessions/${id}/pause${tenantParam}`, { method: "POST" });
    } catch (err: any) {
      console.error("[Research] Pause failed:", err);
    }
  }, [tenantParam]);

  // ── Resume ──
  const resume = useCallback(async () => {
    const id = sessionIdRef.current;
    if (!id) return;
    try {
      await api.request(`/api/research/sessions/${id}/resume${tenantParam}`, { method: "POST" });
    } catch (err: any) {
      console.error("[Research] Resume failed:", err);
    }
  }, [tenantParam]);

  // ── Follow-up question ──
  const askFollowUp = useCallback(
    async (question: string) => {
      const id = sessionIdRef.current;
      if (!id) return;

      setIsRunning(true);
      setPhase("followup");
      setError(null);

      try {
        readSSEStream(
          `/api/research/sessions/${id}/followup${tenantParam}`,
          "POST",
          JSON.stringify({ question })
        );

        setEvents((prev) => [
          ...prev,
          { type: "user_followup", data: { question }, timestamp: Date.now() },
        ]);
      } catch (err: any) {
        console.error("[Research] Follow-up failed:", err);
        setPhase("error");
        setError(err.message);
        setIsRunning(false);
      }
    },
    [tenantParam, readSSEStream]
  );

  // ── Load a saved session (view only, no stream) ──
  const loadSession = useCallback(
    async (id: string) => {
      if (abortRef.current) {
        abortRef.current.abort();
        abortRef.current = null;
      }

      try {
        const data = await api.request<any>(`/api/research/sessions/${id}${tenantParam}`);

        setSessionId(data.id);
        sessionIdRef.current = data.id;
        setPhase(data.phase === "created" ? "idle" : (data.phase as SessionPhase));
        setPlan(data.plan || null);
        setFindings(data.findings || []);
        setReport(data.report || null);
        setEvents(data.events || []);
        setError(data.error || null);
        setIsRunning(false);
        setIsPaused(false);
        setSessionVisibility(data.visibility ?? "private");
        setSessionSharedWithUserIds(Array.isArray(data.sharedWithUserIds) ? data.sharedWithUserIds : []);
      } catch (err: any) {
        console.error("[Research] Failed to load session:", err);
        setError(err.message);
      }
    },
    [tenantParam]
  );

  // ── Run an existing session (start the SSE stream for a pre-created session) ──
  const runSession = useCallback(
    (id: string) => {
      if (abortRef.current) {
        abortRef.current.abort();
        abortRef.current = null;
      }

      setSessionId(id);
      sessionIdRef.current = id;
      setPhase("creating");
      setError(null);
      setPlan(null);
      setFindings([]);
      setReport(null);
      setEvents([]);
      setIsRunning(true);
      setIsPaused(false);

      readSSEStream(`/api/research/sessions/${id}/stream${tenantParam}`);
    },
    [tenantParam, readSSEStream]
  );

  // ── Fetch session list for sidebar ──
  const fetchSessions = useCallback(async () => {
    try {
      const data = await api.request<SessionListItem[]>(`/api/research/sessions${tenantParam}`);
      setSessions(data);
    } catch (err: any) {
      console.error("[Research] Failed to fetch sessions:", err);
    }
  }, [tenantParam]);

  // ── Delete a session ──
  const deleteSessionById = useCallback(
    async (id: string) => {
      try {
        await api.request(`/api/research/sessions/${id}${tenantParam}`, { method: "DELETE" });
        setSessions((prev) => prev.filter((s) => s.id !== id));
        if (sessionIdRef.current === id) {
          reset();
        }
      } catch (err: any) {
        console.error("[Research] Failed to delete session:", err);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tenantParam]
  );

  // ── Submit feedback ──
  const submitFeedback = useCallback(
    async (targetType: "step" | "finding" | "session", targetId: string | null, rating: -1 | 1 | null, comment: string | null, contextSnapshot?: any) => {
      const id = sessionIdRef.current;
      if (!id) return;

      try {
        const result = await api.request<{ feedbackId: number }>(`/api/research/sessions/${id}/feedback${tenantParam}`, {
          method: "POST",
          body: JSON.stringify({ targetType, targetId, rating, comment, contextSnapshot }),
        });
        return result.feedbackId;
      } catch (err: any) {
        console.error("[Research] Feedback submission failed:", err);
      }
    },
    [tenantParam]
  );

  // ── Update session sharing ──
  const updateSessionSharing = useCallback(
    async (visibility: string, sharedWithUserIds: string[]) => {
      const id = sessionIdRef.current;
      if (!id) return false;
      try {
        await api.request(`/api/research/sessions/${id}/sharing${tenantParam}`, {
          method: "PUT",
          body: JSON.stringify({ visibility, shared_with_user_ids: sharedWithUserIds }),
        });
        setSessionVisibility(["shared", "global"].includes(visibility) ? visibility : "private");
        setSessionSharedWithUserIds(sharedWithUserIds);
        return true;
      } catch (err: any) {
        console.error("[Research] Failed to update sharing:", err);
        return false;
      }
    },
    [tenantParam]
  );

  // ── Reset to initial state ──
  const reset = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setSessionId(null);
    sessionIdRef.current = null;
    setPhase("idle");
    setPlan(null);
    setFindings([]);
    setReport(null);
    setEvents([]);
    setError(null);
    setIsRunning(false);
    setIsPaused(false);
    setSessionVisibility("private");
    setSessionSharedWithUserIds([]);
  }, []);

  return {
    sessionId,
    phase,
    plan,
    findings,
    report,
    events,
    error,
    isRunning,
    isPaused,
    sessions,
    sessionVisibility,
    sessionSharedWithUserIds,
    updateSessionSharing,
    startSession,
    runSession,
    steer,
    pause,
    resume,
    askFollowUp,
    loadSession,
    fetchSessions,
    deleteSession: deleteSessionById,
    submitFeedback,
    reset,
  };
}
