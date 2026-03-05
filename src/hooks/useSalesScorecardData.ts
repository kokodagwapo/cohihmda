import { useState, useEffect } from "react";
import { api } from "@/lib/api";

export interface DateRange {
  start: string;
  end: string;
}

export type ActorType = "branch" | "loan_officer";
export type TTSTier = "top" | "second" | "bottom";

/**
 * TTS (Top Tier Score) Actor data
 * Includes metrics and composite TTS score
 */
export interface TTSActor {
  name: string;
  // Core metrics
  units: number;
  volume: number;
  revenue: number;
  revenueBps: number;
  pullThrough: number;
  avgTurnTime: number;
  // Weighted averages
  waFico: number;
  waLtv: number;
  waDti: number;
  // Lost opportunity metrics
  lostOpportunityUnits: number;
  lostOpportunityRevenue: number;
  deniedUnits: number;
  // Composite score and tier
  ttsScore: number;
  tier: TTSTier;
}

/**
 * Company-wide average metrics used as baseline for ratings
 */
export interface CompanyAverages {
  avgUnitsPerActor: number; // For Unit Rating calculation
  avgLoanAmount: number;
  avgRevenue: number;
  avgConcession: number; // For Concession Rating calculation
  avgPullThrough: number;
  avgTurnTime: number;
}

/**
 * Weight configuration for TTS calculation (from Qlik TTS Formula Documentation)
 * 6 components totaling 100%
 */
export interface WeightConfig {
  unit: number; // Default: 20 - Unit Rating weight
  volume: number; // Default: 20 - Volume Rating weight
  margin: number; // Default: 20 - Margin Rating weight
  concession: number; // Default: 20 - Concession Rating weight
  pullThrough: number; // Default: 15 - Pull-Through Rating weight
  turnTime: number; // Default: 5  - Turn Time Rating weight
}

/**
 * Summary statistics for each tier (matches Qlik's 28 metrics)
 */
export interface TTSTierSummary {
  count: number;
  units: number;
  unitsPercent: number;
  volume: number;
  volumePercent: number;
  revenue: number;
  revenueBps: number;
  avgTurnTime: number;
  pullThrough: number;
  waFico: number;
  waLtv: number;
  waDti: number;
  waWhDays: number;
  avgConditions: number;
  lostOpportunityUnits: number;
  lostOpportunityUnitsPercent: number;
  lostOpportunityRevenue: number;
  deniedUnits: number;
  deniedUnitsPercent: number;
  deniedRevenue: number;
  lostOpportunityAndDeniedRevenue: number;
  lostOpportunityAndDeniedRevenueBps: number;
  avgLoRevenue: number;
  avgLoUnits: number;
  avgLoUnitsPerMonth: number;
  avgLoVolume: number;
  avgLoVolumePerMonth: number;
  avgTtsScore: number;
  loanComplexityScore: number;
}

/**
 * Company totals (matching Qlik's 28 metrics)
 */
export interface TotalsData {
  actorCount: number;
  units: number;
  volume: number;
  revenue: number;
  revenueBps: number;
  avgTurnTime: number;
  pullThrough: number;
  waFico: number;
  waLtv: number;
  waDti: number;
  waWhDays: number;
  avgConditions: number;
  lostOpportunityUnits: number;
  lostOpportunityUnitsPercent: number;
  lostOpportunityRevenue: number;
  deniedUnits: number;
  deniedUnitsPercent: number;
  deniedRevenue: number;
  lostOpportunityAndDeniedRevenue: number;
  lostOpportunityAndDeniedRevenueBps: number;
  avgLoRevenue: number;
  avgLoUnits: number;
  avgLoUnitsPerMonth: number;
  avgLoVolume: number;
  avgLoVolumePerMonth: number;
  avgTtsScore: number;
  loanComplexityScore: number;
}

/**
 * Full TTS Sales Scorecard response data
 */
export interface SalesScorecardData {
  actors: TTSActor[];
  companyAverages: CompanyAverages;
  weightConfig: WeightConfig;
  tierSummary: {
    top: TTSTierSummary;
    second: TTSTierSummary;
    bottom: TTSTierSummary;
  };
  totals: TotalsData;
  dateRange: {
    startDate: string;
    endDate: string;
  };
}

/**
 * Hook for fetching TTS Sales Scorecard data
 *
 * TTS (Top Tier Score) is a weighted composite score that measures performance
 * relative to company averages using 6 components (weights from tenant config):
 * - Unit Rating, Volume Rating, Margin Rating
 * - Concession Rating, Pull-Through Rating, Turn Time Rating
 *
 * Tier assignment is based on PERCENTILE DISTRIBUTION (Pareto 20/30/50):
 * - Top Tier: 80th+ percentile (top 20% of actors by TTS score rank)
 * - Second Tier: 50th-80th percentile (middle 30%)
 * - Bottom Tier: Below 50th percentile (bottom 50%)
 *
 * Default time frame: Rolling 13 months (per Qlik eCCA_TVI_Score_13_Months)
 *
 * @param actorType - 'branch' or 'loan_officer'
 * @param dateRange - Optional date range filter (defaults to rolling 13 months)
 * @param selectedTenantId - Optional tenant ID for multi-tenant support
 * @param selectedChannel - Optional channel filter
 */
export const useSalesScorecardData = (
  actorType: ActorType = "loan_officer",
  dateRange?: DateRange,
  selectedTenantId?: string | null,
  selectedChannel?: string | null,
  dimensionFilters?: Array<{ column: string; value: string }>,
) => {
  const [data, setData] = useState<SalesScorecardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchSalesScorecardData = async () => {
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
        params.append("actor", actorType);
        if (dateRange?.start) params.append("startDate", dateRange.start);
        if (dateRange?.end) params.append("endDate", dateRange.end);
        if (selectedTenantId) params.append("tenant_id", selectedTenantId);
        if (selectedChannel && selectedChannel !== "All")
          params.append("channel_group", selectedChannel);
        if (dimensionFilters) {
          for (const df of dimensionFilters) {
            if (df.value && df.value !== 'all') params.append(df.column, df.value);
          }
        }

        const queryString = params.toString();
        // NOTE: Using original endpoint until /api/scorecard/sales is fully tested
        // Using new consolidated endpoint with channel-aware actor support
        const url = `/api/scorecard/sales${
          queryString ? `?${queryString}` : ""
        }`;

        console.log("[SalesScorecard] Fetching data from", url);
        const responseData = await api.request<SalesScorecardData>(url);
        console.log(
          "[SalesScorecard] API response:",
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
            "[SalesScorecard] API returned data but it appears empty or invalid:",
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
          console.error("[SalesScorecard] Failed to fetch data:", err);
          setError(err.message || "Failed to fetch sales scorecard data");
          setData(null);
        }
      } finally {
        setLoading(false);
      }
    };

    fetchSalesScorecardData();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    actorType,
    dateRange?.start,
    dateRange?.end,
    selectedTenantId,
    selectedChannel,
    JSON.stringify(dimensionFilters),
  ]);

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
 * Helper function to format rating as percentage above/below average
 */
export const formatRatingDelta = (rating: number): string => {
  const delta = rating - 100;
  if (delta >= 0) {
    return `+${delta.toFixed(1)}%`;
  }
  return `${delta.toFixed(1)}%`;
};

/**
 * Helper function to calculate date ranges for common periods
 */
export const getDateRangeForPeriod = (period: string): DateRange => {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();
  const currentQuarter = Math.floor(currentMonth / 3);

  switch (period) {
    case "MTD": {
      const startOfMonth = new Date(currentYear, currentMonth, 1);
      return {
        start: startOfMonth.toISOString().split("T")[0],
        end: now.toISOString().split("T")[0],
      };
    }
    case "QTD": {
      const startOfQuarter = new Date(currentYear, currentQuarter * 3, 1);
      return {
        start: startOfQuarter.toISOString().split("T")[0],
        end: now.toISOString().split("T")[0],
      };
    }
    case "YTD": {
      const startOfYear = new Date(currentYear, 0, 1);
      return {
        start: startOfYear.toISOString().split("T")[0],
        end: now.toISOString().split("T")[0],
      };
    }
    case "Last Month": {
      const startOfLastMonth = new Date(currentYear, currentMonth - 1, 1);
      const endOfLastMonth = new Date(currentYear, currentMonth, 0);
      return {
        start: startOfLastMonth.toISOString().split("T")[0],
        end: endOfLastMonth.toISOString().split("T")[0],
      };
    }
    case "Last Quarter": {
      const lastQuarter = currentQuarter - 1;
      const lastQuarterYear = lastQuarter < 0 ? currentYear - 1 : currentYear;
      const adjustedLastQuarter = lastQuarter < 0 ? 3 : lastQuarter;
      const startOfLastQuarter = new Date(
        lastQuarterYear,
        adjustedLastQuarter * 3,
        1
      );
      const endOfLastQuarter = new Date(
        lastQuarterYear,
        (adjustedLastQuarter + 1) * 3,
        0
      );
      return {
        start: startOfLastQuarter.toISOString().split("T")[0],
        end: endOfLastQuarter.toISOString().split("T")[0],
      };
    }
    case "3-months":
    case "3 Months": {
      const threeMonthsAgo = new Date(now);
      threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
      return {
        start: threeMonthsAgo.toISOString().split("T")[0],
        end: now.toISOString().split("T")[0],
      };
    }
    case "6-months":
    case "6 Months": {
      const sixMonthsAgo = new Date(now);
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
      return {
        start: sixMonthsAgo.toISOString().split("T")[0],
        end: now.toISOString().split("T")[0],
      };
    }
    case "12-months":
    case "12 Months":
    case "Rolling 12M": {
      const twelveMonthsAgo = new Date(now);
      twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);
      return {
        start: twelveMonthsAgo.toISOString().split("T")[0],
        end: now.toISOString().split("T")[0],
      };
    }
    case "13-months":
    case "13 Months":
    case "Rolling 13M":
    default: {
      // Default: Rolling 13 months (Qlik standard for TTS scorecards)
      const thirteenMonthsAgo = new Date(now);
      thirteenMonthsAgo.setMonth(thirteenMonthsAgo.getMonth() - 13);
      return {
        start: thirteenMonthsAgo.toISOString().split("T")[0],
        end: now.toISOString().split("T")[0],
      };
    }
  }
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

export default useSalesScorecardData;
