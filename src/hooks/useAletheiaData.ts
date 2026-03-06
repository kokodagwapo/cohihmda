import { useState, useEffect, useCallback } from "react";
import { api } from "@/lib/api";
import { CheckCircle2, Info, AlertTriangle, AlertCircle } from "lucide-react";

export interface AletheiaInsight {
  /** DB row id from generated_insights — used for exact drill-down queries */
  insightId?: number;
  type: "success" | "info" | "warning" | "error" | "critical";
  icon: any;
  message: string;
  priority: "critical" | "high" | "medium" | "low" | "standard";
  reasoning?: string;
  source?: string;
  // Enriched categorized fields
  bucket?: "working" | "attention" | "critical" | "context";
  headline?: string;
  understory?: string;
  severity_score?: number;
  bucketPriority?: "BLUE" | "YELLOW" | "RED" | "GRAY";
  impact?: {
    type?: string;
    estimated_dollars?: number | null;
    units_affected?: number | null;
  };
  evidence?: { metrics?: string[]; comparisons?: string[] };
  // ETM Framework fields (Executive Thinking Model)
  what_changed?: string;
  why?: string;
  business_impact?: string;
  risk_if_ignored?: string;
  recommended_action?: string;
  owner?: string;
  generation_method?: "pipeline" | "agent";
  detail_data?: any;
}

export interface InsightsMetadata {
  usedLLM: boolean;
  generatedAt: string;
  summaryForPodcast?: string;
  needsGeneration?: boolean;
}

// Map API insight type to icon
const getIconForType = (type: string) => {
  switch (type) {
    case "success":
      return CheckCircle2;
    case "info":
      return Info;
    case "warning":
      return AlertTriangle;
    case "error":
      return AlertTriangle;
    case "critical":
      return AlertCircle;
    default:
      return Info;
  }
};

export const useAletheiaData = (
  dateFilter: "today" | "mtd" | "ytd" | "custom",
  onDataAvailabilityChange?: (hasData: boolean) => void,
  selectedTenantId?: string | null,
  selectedChannel?: string | null
) => {
  const [allInsights, setAllInsights] = useState<AletheiaInsight[]>([]);
  const [insightsLoading, setInsightsLoading] = useState(true);
  const [insightsError, setInsightsError] = useState<string | null>(null);
  const [funnelData, setFunnelData] = useState<any>(null);
  const [metadata, setMetadata] = useState<InsightsMetadata | null>(null);
  const [needsGeneration, setNeedsGeneration] = useState(false);

  // Map API response insights to component format
  const mapInsights = (data: any): AletheiaInsight[] => {
    if (
      !data.insights ||
      !Array.isArray(data.insights) ||
      data.insights.length === 0
    ) {
      return [];
    }
    return data.insights.map((insight: any) => ({
      insightId: insight.id ?? insight.insightId,
      type: insight.type || "info",
      icon: getIconForType(insight.type || "info"),
      message: insight.headline || insight.message || "",
      priority: insight.priority || "standard",
      reasoning: insight.understory || insight.reasoning || "",
      source: insight.source || "other",
      // Enriched fields
      bucket: insight.bucket,
      headline: insight.headline,
      understory: insight.understory,
      severity_score: insight.severity_score,
      bucketPriority: insight.bucketPriority,
      impact: insight.impact,
      evidence: insight.evidence,
      // ETM fields
      what_changed: insight.what_changed,
      why: insight.why,
      business_impact: insight.business_impact,
      risk_if_ignored: insight.risk_if_ignored,
      recommended_action: insight.recommended_action,
      owner: insight.owner,
      generation_method: insight.generation_method,
      detail_data: insight.detail_data || null,
    }));
  };

  const reloadInsightsFromDb = useCallback(async () => {
    const tenantParam = selectedTenantId
      ? `&tenant_id=${selectedTenantId}`
      : "";
    const channelParam =
      selectedChannel && selectedChannel !== "All"
        ? `&channel_group=${encodeURIComponent(selectedChannel)}`
        : "";

    const data = await api.request<any>(
      `/api/dashboard/insights?dateFilter=${dateFilter}&useLLM=true${tenantParam}${channelParam}&generation_method=pipeline`
    );

    setMetadata({
      usedLLM: data.usedLLM ?? true,
      generatedAt: data.generatedAt || new Date().toISOString(),
      summaryForPodcast: data.summaryForPodcast,
      needsGeneration: false,
    });

    const mapped = mapInsights(data);
    setAllInsights(mapped);
    setInsightsLoading(false);
  }, [dateFilter, selectedTenantId, selectedChannel]);

  // Refresh insights — fires async job, returns jobId for progress tracking
  const refreshInsights = useCallback(async (): Promise<string | null> => {
    setInsightsLoading(true);
    setInsightsError(null);
    setNeedsGeneration(false);

    try {
      const tenantParam = selectedTenantId
        ? `&tenant_id=${selectedTenantId}`
        : "";

      const resp = await api.request<{ jobId: string }>(
        `/api/dashboard/insights/refresh-all-channels?dateFilter=${dateFilter}${tenantParam}`,
        { method: "POST" }
      );

      return resp.jobId;
    } catch (error: any) {
      console.error("Error refreshing insights:", error);
      setInsightsError(error.message || "Failed to refresh insights");
      setInsightsLoading(false);
      return null;
    }
  }, [dateFilter, selectedTenantId, selectedChannel]);

  const loadInsightsByMethod = useCallback(
    async (method: "pipeline" | "agent") => {
      setAllInsights([]);
      setInsightsLoading(true);
      setInsightsError(null);
      try {
        const tenantParam = selectedTenantId
          ? `&tenant_id=${selectedTenantId}`
          : "";
        const channelParam =
          selectedChannel && selectedChannel !== "All"
            ? `&channel_group=${encodeURIComponent(selectedChannel)}`
            : "";

        const data = await api.request<any>(
          `/api/dashboard/insights?dateFilter=${dateFilter}&useLLM=true${tenantParam}${channelParam}&generation_method=${method}`
        );

        const mapped = mapInsights(data);
        setAllInsights(mapped);
        setNeedsGeneration(false);
        setMetadata({
          usedLLM: data.usedLLM ?? true,
          generatedAt: data.generatedAt || new Date().toISOString(),
          summaryForPodcast: data.summaryForPodcast,
          needsGeneration: false,
        });
      } catch (error: any) {
        console.error(`Error loading ${method} insights:`, error);
        setAllInsights([]);
        setInsightsError(error.message || `Failed to load ${method} insights`);
      } finally {
        setInsightsLoading(false);
      }
    },
    [dateFilter, selectedTenantId, selectedChannel]
  );

  const POLL_INTERVAL_MS = 2000;

  /** Refreshes all insights via agent pipeline (legacy refresh-bucket endpoint was archived). */
  const refreshBucket = useCallback(
    async (bucket: string): Promise<string | null> => {
      const tenantParam = selectedTenantId
        ? `&tenant_id=${selectedTenantId}`
        : "";
      const channelParam =
        selectedChannel && selectedChannel !== "All"
          ? `&channel_group=${encodeURIComponent(selectedChannel)}`
          : "";

      const resp = await api.request<{ jobId: string }>(
        `/api/dashboard/insights/refresh?dateFilter=${dateFilter}${tenantParam}${channelParam}`,
        { method: "POST" }
      );

      const jobId = resp.jobId;
      if (!jobId) return null;

      const poll = (): Promise<void> =>
        new Promise((resolve, reject) => {
          const run = async () => {
            try {
              const data = await api.request<{ status: string; error?: string }>(
                `/api/jobs/${jobId}`
              );
              if (data.status === "complete") {
                await loadInsightsByMethod("agent");
                resolve();
                return;
              }
              if (data.status === "failed") {
                reject(new Error(data.error || "Refresh failed"));
                return;
              }
              setTimeout(run, POLL_INTERVAL_MS);
            } catch (err: any) {
              reject(err);
            }
          };
          run();
        });

      await poll();
      return jobId;
    },
    [dateFilter, selectedTenantId, selectedChannel, loadInsightsByMethod]
  );

  const generateMoreInsights = useCallback(
    async (bucket: string): Promise<string | null> => {
      const tenantParam = selectedTenantId
        ? `&tenant_id=${selectedTenantId}`
        : "";
      const channelParam =
        selectedChannel && selectedChannel !== "All"
          ? `&channel_group=${encodeURIComponent(selectedChannel)}`
          : "";

      const resp = await api.request<{ jobId: string }>(
        `/api/dashboard/insights/generate-more?dateFilter=${dateFilter}&bucket=${bucket}${tenantParam}${channelParam}`,
        { method: "POST" }
      );

      const jobId = resp.jobId;
      if (!jobId) return null;

      // Poll until job completes or fails
      const poll = (): Promise<void> =>
        new Promise((resolve, reject) => {
          const run = async () => {
            try {
              const data = await api.request<{ status: string; data?: any; error?: string }>(
                `/api/jobs/${jobId}`
              );
              if (data.status === "complete") {
                await loadInsightsByMethod("agent");
                resolve();
                return;
              }
              if (data.status === "failed") {
                reject(new Error(data.error || "Generate-more failed"));
                return;
              }
              setTimeout(run, POLL_INTERVAL_MS);
            } catch (err: any) {
              reject(err);
            }
          };
          run();
        });

      await poll();
      return jobId;
    },
    [dateFilter, selectedTenantId, selectedChannel, loadInsightsByMethod]
  );

  // Submit feedback (thumbs up/down + optional tags/comment) for a specific insight
  const submitFeedback = useCallback(
    async (
      insightId: number,
      rating: -1 | 1,
      tags?: string[],
      comment?: string
    ) => {
      try {
        const tenantParam = selectedTenantId
          ? `?tenant_id=${selectedTenantId}`
          : "";
        await api.request<any>(
          `/api/dashboard/insights/${insightId}/feedback${tenantParam}`,
          {
            method: "POST",
            body: JSON.stringify({ rating, tags: tags || [], comment: comment || "" }),
          }
        );
        return true;
      } catch (error: any) {
        console.error("Error submitting feedback:", error);
        return false;
      }
    },
    [selectedTenantId]
  );

  // Fetch feedback for a specific insight (used in detail views)
  const getFeedback = useCallback(
    async (insightId: number) => {
      try {
        const tenantParam = selectedTenantId
          ? `?tenant_id=${selectedTenantId}`
          : "";
        const data = await api.request<any>(
          `/api/dashboard/insights/${insightId}/feedback${tenantParam}`
        );
        return data;
      } catch (error: any) {
        console.error("Error fetching feedback:", error);
        return null;
      }
    },
    [selectedTenantId]
  );

  // Delete a single insight by ID (optimistic removal from local state)
  const deleteInsight = useCallback(
    async (insightId: number) => {
      // Optimistic: remove from UI immediately
      setAllInsights((prev) => prev.filter((i) => i.insightId !== insightId));

      try {
        const tenantParam = selectedTenantId
          ? `?tenant_id=${selectedTenantId}`
          : "";
        await api.request<any>(
          `/api/dashboard/insights/${insightId}${tenantParam}`,
          { method: "DELETE" }
        );
      } catch (error: any) {
        console.error("Error deleting insight:", error);
        // If the delete fails, re-fetch to restore state
        throw error;
      }
    },
    [selectedTenantId]
  );

  // Initial load: GET reads from DB (fast, no LLM call)
  // Note: onDataAvailabilityChange is intentionally NOT in the dependency array
  // because it's a callback for reporting state, not for triggering fetches.
  useEffect(() => {
    const fetchInsights = async () => {
      setInsightsLoading(true);
      setInsightsError(null);

      // Check if user has a valid token before making API call
      if (!api.hasToken()) {
        setAllInsights([]);
        setMetadata({ usedLLM: false, generatedAt: new Date().toISOString() });
        setInsightsError("Not authenticated");
        setInsightsLoading(false);
        return;
      }

      try {
        const tenantParam = selectedTenantId
          ? `&tenant_id=${selectedTenantId}`
          : "";
        const channelParam =
          selectedChannel && selectedChannel !== "All"
            ? `&channel_group=${encodeURIComponent(selectedChannel)}`
            : "";

        const data = await api.request<any>(
          `/api/dashboard/insights?dateFilter=${dateFilter}&useLLM=true${tenantParam}${channelParam}&generation_method=agent`
        );

        setMetadata({
          usedLLM: data.usedLLM ?? false,
          generatedAt: data.generatedAt || new Date().toISOString(),
          summaryForPodcast: data.summaryForPodcast,
          needsGeneration: data.needsGeneration ?? false,
        });

        if (data.needsGeneration) {
          setNeedsGeneration(true);
          setAllInsights([]);
        } else {
          setNeedsGeneration(false);
          const mapped = mapInsights(data);
          setAllInsights(mapped);
        }
      } catch (error: any) {
        console.error("Error fetching insights:", error);
        setAllInsights([]);
        setInsightsError(error.message || "Failed to fetch insights");
        setMetadata({
          usedLLM: false,
          generatedAt: new Date().toISOString(),
        });
      } finally {
        setInsightsLoading(false);
      }
    };

    fetchInsights();
  }, [dateFilter, selectedTenantId, selectedChannel]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch funnel data for briefing context
  useEffect(() => {
    const fetchFunnelData = async () => {
      if (!api.hasToken()) return;

      try {
        const tenantParam = selectedTenantId
          ? `&tenant_id=${selectedTenantId}`
          : "";
        const data = await api.request<any>(
          `/api/loans/funnel?dateFilter=${dateFilter}${tenantParam}`
        );
        setFunnelData(data);
      } catch (error: any) {
        if (
          error.message?.includes("Unauthorized") ||
          error.message?.includes("401")
        ) {
          return;
        }
        if (
          error.message?.includes("timed out") ||
          error.message?.includes("timeout")
        ) {
          console.warn(
            "Funnel data request timed out, continuing without it:",
            error.message
          );
        } else {
          console.error("Error fetching funnel data:", error);
        }
      }
    };

    fetchFunnelData();
  }, [dateFilter, selectedTenantId]);

  // No-op: when errors occur we show empty state (no demo data fallback)

  // Notify parent about data availability changes (separate effect to avoid loop)
  useEffect(() => {
    if (!insightsLoading && allInsights.length > 0) {
      onDataAvailabilityChange?.(true);
    }
  }, [allInsights.length, insightsLoading]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    allInsights,
    insightsLoading,
    insightsError,
    funnelData,
    metadata,
    needsGeneration,
    refreshInsights,
    refreshBucket,
    generateMoreInsights,
    reloadInsightsFromDb,
    deleteInsight,
    submitFeedback,
    getFeedback,
    loadInsightsByMethod,
  };
};
