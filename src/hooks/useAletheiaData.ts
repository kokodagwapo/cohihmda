import { useState, useEffect, useCallback } from "react";
import { api } from "@/lib/api";
import { CheckCircle2, Info, AlertTriangle, AlertCircle } from "lucide-react";

export interface AletheiaInsight {
  type: "success" | "info" | "warning" | "error" | "critical";
  icon: any;
  message: string;
  priority: "critical" | "high" | "medium" | "low" | "standard";
  reasoning?: string;
  source?: string;
}

export interface InsightsMetadata {
  usedLLM: boolean;
  generatedAt: string;
  summaryForPodcast?: string;
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
  const [refreshCounter, setRefreshCounter] = useState(0);

  // Function to force refresh insights (bypasses cache)
  const refreshInsights = useCallback(() => {
    setRefreshCounter((prev) => prev + 1);
  }, []);

  // Fetch dynamic insights from API (with LLM support)
  // Note: onDataAvailabilityChange is intentionally NOT in the dependency array
  // because it's a callback for reporting state, not for triggering fetches.
  // Including it would cause infinite re-renders if the parent doesn't memoize it.
  useEffect(() => {
    const fetchInsights = async () => {
      setInsightsLoading(true);
      setInsightsError(null);

      // Check if user has a valid token before making API call
      const token = localStorage.getItem("auth_token");
      if (!token) {
        // No token - use demo data directly without making API call
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
        const forceRefreshParam =
          refreshCounter > 0 ? "&forceRefresh=true" : "";
        // Don't send channel filter when "All" is selected
        const channelParam =
          selectedChannel && selectedChannel !== "All"
            ? `&channel_group=${encodeURIComponent(selectedChannel)}`
            : "";
        // Using useLLM=false to use rule-based insights (faster, no API key required)
        const data = await api.request<any>(
          `/api/dashboard/insights?dateFilter=${dateFilter}&useLLM=false${tenantParam}${forceRefreshParam}${channelParam}`
        );

        // Store metadata about the response
        setMetadata({
          usedLLM: data.usedLLM ?? false,
          generatedAt: data.generatedAt || new Date().toISOString(),
          summaryForPodcast: data.summaryForPodcast,
        });

        if (
          data.insights &&
          Array.isArray(data.insights) &&
          data.insights.length > 0
        ) {
          // Map API insights to component format with icons, preserving source information
          const mappedInsights: AletheiaInsight[] = data.insights.map(
            (insight: any) => ({
              type: insight.type || "info",
              icon: getIconForType(insight.type || "info"),
              message: insight.message || "",
              priority: insight.priority || "standard",
              reasoning: insight.reasoning || "",
              source: insight.source || "other", // Preserve source for grouping
            })
          );
          setAllInsights(mappedInsights);
        } else {
          // If API returns empty or no insights, use demo data
          const demoInsights = getDemoInsights();
          setAllInsights(demoInsights);
          setInsightsError(null);
        }
      } catch (error: any) {
        // Handle unauthorized errors silently (user not logged in)
        if (
          error.message?.includes("Unauthorized") ||
          error.message?.includes("401")
        ) {
          // User not authenticated - use demo data without logging error
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
          // For timeout errors, log as warning since we have demo data fallback
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
          // Other errors - log but still use demo data
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
  }, [dateFilter, selectedTenantId, selectedChannel, refreshCounter]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch funnel data for briefing context
  useEffect(() => {
    const fetchFunnelData = async () => {
      // Check if user has a valid token before making API call
      const token = localStorage.getItem("auth_token");
      if (!token) {
        // No token - skip API call, briefing will work without funnel data
        return;
      }

      try {
        const tenantParam = selectedTenantId
          ? `&tenant_id=${selectedTenantId}`
          : "";
        const data = await api.request<any>(
          `/api/loans/funnel?dateFilter=${dateFilter}${tenantParam}`
        );
        setFunnelData(data);
      } catch (error: any) {
        // Handle unauthorized errors silently (user not logged in)
        if (
          error.message?.includes("Unauthorized") ||
          error.message?.includes("401")
        ) {
          // User not authenticated - continue without funnel data
          return;
        }
        // For timeout errors, log as warning since briefing works without funnel data
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
        // Continue without funnel data - briefing will work without it
      }
    };

    fetchFunnelData();
  }, [dateFilter, selectedTenantId]);

  // Handle error state and set demo insights if needed
  useEffect(() => {
    if (insightsError && allInsights.length === 0 && !insightsLoading) {
      // Fallback to demo insights if API fails
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
    refreshInsights,
  };
};
