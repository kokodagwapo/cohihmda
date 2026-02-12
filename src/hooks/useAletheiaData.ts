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

// Demo insights fallback
const getDemoInsights = (): AletheiaInsight[] => [
  {
    type: "info" as const,
    icon: Info,
    message:
      "YTD revenue reached $2.4M, up 18% versus last year — strong momentum continues.",
    priority: "high" as const,
    reasoning:
      "Revenue trajectory shows consistent growth. At current velocity, you're positioned for a strong quarter.",
    source: "business_overview",
  },
  {
    type: "info" as const,
    icon: Info,
    message:
      "Active pipeline: 185 loans, $78.2M in process — strong pipeline depth.",
    priority: "high" as const,
    reasoning:
      "Pipeline volume indicates healthy demand. Monitor conversion rates to optimize throughput.",
    source: "loan_funnel",
  },
  {
    type: "success" as const,
    icon: CheckCircle2,
    message:
      "Pull-through rate: 72.5% (Rolling 90D, excludes active loans) — above industry average.",
    priority: "high" as const,
    reasoning:
      "Pull-through uses rolling 90 days and excludes active loans for accuracy. Industry average is 60-70%.",
    source: "business_overview",
  },
];

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
    }));
  };

  // Refresh insights via POST (triggers fresh LLM generation)
  const refreshInsights = useCallback(async () => {
    setInsightsLoading(true);
    setInsightsError(null);
    setNeedsGeneration(false);

    try {
      const tenantParam = selectedTenantId
        ? `&tenant_id=${selectedTenantId}`
        : "";
      const channelParam =
        selectedChannel && selectedChannel !== "All"
          ? `&channel_group=${encodeURIComponent(selectedChannel)}`
          : "";

      const data = await api.request<any>(
        `/api/dashboard/insights/refresh?dateFilter=${dateFilter}${tenantParam}${channelParam}`,
        { method: "POST" }
      );

      setMetadata({
        usedLLM: data.usedLLM ?? true,
        generatedAt: data.generatedAt || new Date().toISOString(),
        summaryForPodcast: data.summaryForPodcast,
        needsGeneration: false,
      });

      const mapped = mapInsights(data);
      if (mapped.length > 0) {
        setAllInsights(mapped);
      } else {
        setAllInsights(getDemoInsights());
      }
    } catch (error: any) {
      console.error("Error refreshing insights:", error);
      setInsightsError(error.message || "Failed to refresh insights");
    } finally {
      setInsightsLoading(false);
    }
  }, [dateFilter, selectedTenantId, selectedChannel]);

  // Refresh a single bucket (regenerates only that section)
  const refreshBucket = useCallback(
    async (bucket: string) => {
      try {
        const tenantParam = selectedTenantId
          ? `&tenant_id=${selectedTenantId}`
          : "";
        const channelParam =
          selectedChannel && selectedChannel !== "All"
            ? `&channel_group=${encodeURIComponent(selectedChannel)}`
            : "";

        const data = await api.request<any>(
          `/api/dashboard/insights/refresh-bucket?dateFilter=${dateFilter}&bucket=${bucket}${tenantParam}${channelParam}`,
          { method: "POST" }
        );

        const mapped = mapInsights(data);
        if (mapped.length > 0) {
          setAllInsights(mapped);
        }
        return data;
      } catch (error: any) {
        console.error(`Error refreshing bucket "${bucket}":`, error);
        throw error;
      }
    },
    [dateFilter, selectedTenantId, selectedChannel]
  );

  // Generate MORE insights for a bucket (appends, does not replace)
  const generateMoreInsights = useCallback(
    async (bucket: string) => {
      try {
        const tenantParam = selectedTenantId
          ? `&tenant_id=${selectedTenantId}`
          : "";
        const channelParam =
          selectedChannel && selectedChannel !== "All"
            ? `&channel_group=${encodeURIComponent(selectedChannel)}`
            : "";

        const data = await api.request<any>(
          `/api/dashboard/insights/generate-more?dateFilter=${dateFilter}&bucket=${bucket}${tenantParam}${channelParam}`,
          { method: "POST" }
        );

        const mapped = mapInsights(data);
        if (mapped.length > 0) {
          setAllInsights(mapped);
        }
        return data;
      } catch (error: any) {
        console.error(`Error generating more for bucket "${bucket}":`, error);
        throw error;
      }
    },
    [dateFilter, selectedTenantId, selectedChannel]
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
      const token = localStorage.getItem("auth_token");
      if (!token) {
        const demoInsights = getDemoInsights();
        setAllInsights(demoInsights);
        setMetadata({ usedLLM: false, generatedAt: new Date().toISOString() });
        setInsightsError(null);
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
          `/api/dashboard/insights?dateFilter=${dateFilter}&useLLM=true${tenantParam}${channelParam}`
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
          if (mapped.length > 0) {
            setAllInsights(mapped);
          } else {
            const demoInsights = getDemoInsights();
            setAllInsights(demoInsights);
            setInsightsError(null);
          }
        }
      } catch (error: any) {
        if (
          error.message?.includes("Unauthorized") ||
          error.message?.includes("401")
        ) {
          const demoInsights = getDemoInsights();
          setAllInsights(demoInsights);
          setMetadata({
            usedLLM: false,
            generatedAt: new Date().toISOString(),
          });
          setInsightsError(null);
        } else if (
          error.message?.includes("timed out") ||
          error.message?.includes("timeout")
        ) {
          console.warn(
            "Insights request timed out, using demo data fallback:",
            error.message
          );
          const demoInsights = getDemoInsights();
          setAllInsights(demoInsights);
          setMetadata({
            usedLLM: false,
            generatedAt: new Date().toISOString(),
          });
          setInsightsError(null);
        } else {
          console.error("Error fetching insights:", error);
          setInsightsError(error.message || "Failed to fetch insights");
          const demoInsights = getDemoInsights();
          setAllInsights(demoInsights);
          setMetadata({
            usedLLM: false,
            generatedAt: new Date().toISOString(),
          });
        }
      } finally {
        setInsightsLoading(false);
      }
    };

    fetchInsights();
  }, [dateFilter, selectedTenantId, selectedChannel]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch funnel data for briefing context
  useEffect(() => {
    const fetchFunnelData = async () => {
      const token = localStorage.getItem("auth_token");
      if (!token) return;

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

  // Handle error state and set demo insights if needed
  useEffect(() => {
    if (insightsError && allInsights.length === 0 && !insightsLoading) {
      const demoInsights = getDemoInsights();
      setAllInsights(demoInsights);
    }
  }, [insightsError, allInsights.length, insightsLoading]);

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
    deleteInsight,
    submitFeedback,
    getFeedback,
  };
};
