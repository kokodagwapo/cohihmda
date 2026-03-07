import { useState, useEffect } from "react";
import { api } from "@/lib/api";

export type OperationsActorType = "processor" | "underwriter" | "closer";
export type DateRangeType = "3-months" | "6-months" | "12-months";
export type TTSTier = "top" | "second" | "bottom";

/**
 * Individual actor data with metrics and TTS score
 */
export interface OperationsActor {
  name: string;
  units: number;
  volume: number;
  avgUnitsPerMonth: number;
  avgDays: number;
  loanComplexityScore: number;
  approvedPercent: number;
  deniedPercent: number;
  governmentPercent: number;
  purchasePercent: number;
  waFico: number;
  waLtv: number;
  ttsScore: number;
  tier: TTSTier;
  // Ratings (for debugging)
  unitRating?: number;
  turnTimeRating?: number;
  complexityRating?: number;
}

/**
 * Tier summary metrics (matches OperationsScorecardView interface)
 */
export interface OperationsTierSummary {
  count: number;
  units: number;
  unitsPercent: number;
  volume: number;
  loanComplexityScore: number;
  avgUnitsPerMonth: number;
  avgDays: number;
  compensation: string;
  costPerFile: string;
  approvedPercent: number;
  deniedPercent: number;
  governmentPercent: number;
  purchasePercent: number;
  waFico: number;
  waLtv: number;
  avgTtsScore: number;
}

/**
 * Company-wide average metrics
 */
export interface CompanyAverages {
  avgUnits: number;
  avgTurnTime: number;
  avgComplexity: number;
}

/**
 * Weight configuration for Operations TTS (70/15/15)
 */
export interface WeightConfig {
  units: number; // 0.70 = 70%
  turnTime: number; // 0.15 = 15%
  complexity: number; // 0.15 = 15%
}

/**
 * Full Operations Scorecard response data
 */
export interface OperationsScorecardData {
  actors: OperationsActor[];
  tierSummary: {
    top: OperationsTierSummary;
    second: OperationsTierSummary;
    bottom: OperationsTierSummary;
  };
  totals: OperationsTierSummary;
  companyAverages: CompanyAverages;
  weightConfig: WeightConfig;
  dateRange: {
    start: string;
    end: string;
    months: number;
  };
}

/**
 * Hook for fetching Operations Scorecard data
 *
 * TTS Formula (Operations):
 * OPS_TTS = (UnitRating × 0.70 + TurnTimeRating × 0.15 + ComplexityRating × 0.15)
 *
 * Tier assignment based on TTS score:
 * - Top Tier: TTS > 120 (20%+ above average)
 * - Second Tier: TTS 100-120 (at or above average)
 * - Bottom Tier: TTS < 100 (below average)
 *
 * @param actorType - 'processor' | 'underwriter' | 'closer'
 * @param dateRange - '3-months' | '6-months' | '12-months'
 * @param selectedTenantId - Optional tenant ID for multi-tenant support
 * @param selectedChannel - Optional channel filter
 */
/** Optional explicit date range override (from DatePeriodPicker custom selection) */
export interface OpsCustomDateRange {
  start: string; // YYYY-MM-DD
  end: string;   // YYYY-MM-DD
}

export const useOperationsScorecardData = (
  actorType: OperationsActorType = "underwriter",
  dateRange: DateRangeType = "3-months",
  selectedTenantId?: string | null,
  selectedChannel?: string | null,
  customDateRange?: OpsCustomDateRange,
  dimensionFilters?: Array<{ column: string; value: string }>,
) => {
  const [data, setData] = useState<OperationsScorecardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchOperationsScorecardData = async () => {
      // Check if user has a valid token before making API call
      if (!api.hasToken()) {
        setData(null);
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        // Build query parameters
        const params = new URLSearchParams();
        params.append("actor_type", actorType);
        params.append("date_range", dateRange);
        // When a custom date range is provided (e.g. from DatePeriodPicker),
        // send start_date / end_date so the API can use them instead of the preset string.
        if (customDateRange) {
          params.append("start_date", customDateRange.start);
          params.append("end_date", customDateRange.end);
        }
        if (selectedTenantId) params.append("tenant_id", selectedTenantId);
        if (selectedChannel && selectedChannel !== "All")
          params.append("channel_group", selectedChannel);
        if (dimensionFilters) {
          for (const df of dimensionFilters) {
            if (df.value && df.value !== 'all') params.append(df.column, df.value);
          }
        }

        const queryString = params.toString();
        // NOTE: Using original endpoint until /api/scorecard/operations is fully tested
        // Using new consolidated endpoint with channel-aware actor support
        const url = `/api/scorecard/operations${
          queryString ? `?${queryString}` : ""
        }`;

        console.log("[OpsScorecard] Fetching data from", url);
        const responseData = await api.request<OperationsScorecardData>(url);
        console.log(
          "[OpsScorecard] API response:",
          JSON.stringify(
            {
              actorCount: responseData.actors?.length,
              totals: responseData.totals,
              tierSummary: {
                top: responseData.tierSummary?.top?.count,
                second: responseData.tierSummary?.second?.count,
                bottom: responseData.tierSummary?.bottom?.count,
              },
            },
            null,
            2
          )
        );

        if (responseData && responseData.actors) {
          setData(responseData);
        } else {
          console.warn(
            "[OpsScorecard] API returned data but it appears empty or invalid:",
            responseData
          );
          setData(null);
        }
      } catch (err: any) {
        // Handle unauthorized errors silently (user not logged in)
        if (
          err.message?.includes("Unauthorized") ||
          err.message?.includes("401")
        ) {
          setData(null);
        } else {
          console.error("[OpsScorecard] Failed to fetch data:", err);
          setError(err.message || "Failed to fetch operations scorecard data");
          setData(null);
        }
      } finally {
        setLoading(false);
      }
    };

    fetchOperationsScorecardData();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actorType, dateRange, selectedTenantId, selectedChannel, customDateRange?.start, customDateRange?.end, JSON.stringify(dimensionFilters)]);

  return { data, loading, error };
};

/**
 * Helper function to get tier badge color classes
 */
export const getTierColorClass = (
  tier: TTSTier,
  isDarkMode: boolean = false
): string => {
  const colors = {
    top: isDarkMode
      ? "bg-tier-top-dark text-blue-300"
      : "bg-tier-top-light text-tier-top",
    second: isDarkMode
      ? "bg-tier-second-dark text-green-300"
      : "bg-tier-second-light text-tier-second",
    bottom: isDarkMode
      ? "bg-tier-bottom-dark text-slate-300"
      : "bg-tier-bottom-light text-slate-600",
  };
  return colors[tier];
};

/**
 * Helper function to get tier display name
 */
export const getTierDisplayName = (tier: TTSTier): string => {
  const names: Record<TTSTier, string> = {
    top: "Top Tier",
    second: "Second Tier",
    bottom: "Bottom Tier",
  };
  return names[tier];
};

/**
 * Helper function to get actor type display name
 */
export const getActorTypeDisplayName = (
  actorType: OperationsActorType
): string => {
  const names: Record<OperationsActorType, string> = {
    processor: "Processor",
    underwriter: "Underwriter",
    closer: "Closer",
  };
  return names[actorType];
};

/**
 * Helper function to format date range for display
 */
export const formatDateRangeDisplay = (dateRange: DateRangeType): string => {
  const labels: Record<DateRangeType, string> = {
    "3-months": "3 Months",
    "6-months": "6 Months",
    "12-months": "12 Months",
  };
  return labels[dateRange];
};

/**
 * Helper function to format currency values
 */
export const formatCurrency = (
  value: number,
  abbreviated: boolean = true
): string => {
  if (abbreviated) {
    if (value >= 1000000000) {
      return `$${(value / 1000000000).toFixed(1)}B`;
    }
    if (value >= 1000000) {
      return `$${(value / 1000000).toFixed(1)}M`;
    }
    if (value >= 1000) {
      return `$${(value / 1000).toFixed(0)}K`;
    }
  }
  return `$${value.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;
};

/**
 * Helper function to format numbers with commas
 */
export const formatNumber = (num: number, decimals: number = 0): string => {
  return num.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
};

/**
 * Helper function to format percentages
 */
export const formatPercent = (value: number, decimals: number = 1): string => {
  return `${value.toFixed(decimals)}%`;
};

/**
 * Convert tier summary to match the mock data interface in OperationsScorecardView
 * This helps bridge the API response to the existing component interface
 */
export const convertToViewFormat = (tierSummary: OperationsTierSummary) => {
  // Provide default values for any potentially undefined fields
  return {
    underwriterCount: tierSummary?.count ?? 0, // Named underwriterCount in the view for historical reasons
    unitsOutput: tierSummary?.units ?? 0,
    unitsPercent: tierSummary?.unitsPercent ?? 0,
    volumeOutput: tierSummary?.volume ?? 0,
    loanComplexityScore: tierSummary?.loanComplexityScore ?? 100,
    avgUnitsPerMonth: tierSummary?.avgUnitsPerMonth ?? 0,
    avgDays: tierSummary?.avgDays ?? 0,
    compensation: tierSummary?.compensation ?? '-',
    costPerFile: tierSummary?.costPerFile ?? '-',
    approvedPercent: tierSummary?.approvedPercent ?? 0,
    deniedPercent: tierSummary?.deniedPercent ?? 0,
    governmentPercent: tierSummary?.governmentPercent ?? 0,
    purchasePercent: tierSummary?.purchasePercent ?? 0,
    waFico: tierSummary?.waFico ?? 0,
    waLtv: tierSummary?.waLtv ?? 0,
  };
};

export default useOperationsScorecardData;
