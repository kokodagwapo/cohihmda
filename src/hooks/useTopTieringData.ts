import { useState, useEffect } from "react";
import { api } from "@/lib/api";

export interface DateRange {
  startDate: string;
  endDate: string;
}

export type ActorType = "branch" | "loan_officer";
export type TierType = "top" | "second" | "bottom";

export interface TopTieringActor {
  name: string;
  revenue: number;
  volume: number;
  units: number;
  revenueBps: number;
  revenuePerLoan: number;
  cumulativePercent: number;
  tier: TierType;
  avgTurnTime: number;
  waFico: number;
  waLtv: number;
  waDti: number;
}

export interface TierSummary {
  count: number;
  revenue: number;
  volume: number;
  units: number;
  percent: number;
  avgTurnTime: number;
  waFico: number;
  waLtv: number;
  waDti: number;
  // Additional metrics
  lostOpportunityUnits: number;
  lostOpportunityRevenue: number;
  deniedUnits: number;
  pullThrough: number;
}

export interface TopTieringData {
  actors: TopTieringActor[];
  totals: {
    revenue: number;
    volume: number;
    units: number;
    avgTurnTime: number;
    waFico: number;
    waLtv: number;
    waDti: number;
    // Additional metrics
    lostOpportunityUnits: number;
    lostOpportunityRevenue: number;
    deniedUnits: number;
    pullThrough: number;
  };
  tierSummary: {
    topTier: TierSummary;
    secondTier: TierSummary;
    bottomTier: TierSummary;
  };
  dateRange: {
    startDate: string;
    endDate: string;
  };
}

export const useTopTieringData = (
  actorType: ActorType = "branch",
  dateRange?: DateRange,
  selectedTenantId?: string | null,
  selectedChannel?: string | null
) => {
  const [data, setData] = useState<TopTieringData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchTopTieringData = async () => {
      // Check if user has a valid token before making API call
      const token = localStorage.getItem("auth_token");
      if (!token) {
        // No token - set data to null and stop loading
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
        if (dateRange?.startDate)
          params.append("startDate", dateRange.startDate);
        if (dateRange?.endDate) params.append("endDate", dateRange.endDate);
        if (selectedTenantId) params.append("tenant_id", selectedTenantId);
        if (selectedChannel && selectedChannel !== "All")
          params.append("channel_group", selectedChannel);

        const queryString = params.toString();
        // Using new consolidated endpoint with channel-aware actor support
        const url = `/api/toptiering${queryString ? `?${queryString}` : ""}`;

        console.log("🔍 Fetching toptiering data from", url);
        const responseData = await api.request<TopTieringData>(url);
        console.log(
          "📊 TopTiering data from API:",
          JSON.stringify(
            {
              actorCount: responseData.actors?.length,
              totals: responseData.totals,
              tierSummary: {
                top: responseData.tierSummary?.topTier?.count,
                second: responseData.tierSummary?.secondTier?.count,
                bottom: responseData.tierSummary?.bottomTier?.count,
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
            "⚠️ API returned toptiering data but it appears empty or invalid:",
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
          // User not authenticated - set data to null without logging error
          setData(null);
        } else {
          console.error("❌ Failed to fetch toptiering data:", err);
          console.error("Error details:", {
            message: err.message,
            stack: err.stack,
          });
          setError(err.message || "Failed to fetch toptiering data");
          setData(null);
        }
      } finally {
        setLoading(false);
      }
    };

    fetchTopTieringData();
  }, [
    actorType,
    dateRange?.startDate,
    dateRange?.endDate,
    selectedTenantId,
    selectedChannel,
  ]);

  return { data, loading, error };
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
      // Month to date
      const startOfMonth = new Date(currentYear, currentMonth, 1);
      return {
        startDate: startOfMonth.toISOString().split("T")[0],
        endDate: now.toISOString().split("T")[0],
      };
    }
    case "QTD": {
      // Quarter to date
      const startOfQuarter = new Date(currentYear, currentQuarter * 3, 1);
      return {
        startDate: startOfQuarter.toISOString().split("T")[0],
        endDate: now.toISOString().split("T")[0],
      };
    }
    case "YTD": {
      // Year to date
      const startOfYear = new Date(currentYear, 0, 1);
      return {
        startDate: startOfYear.toISOString().split("T")[0],
        endDate: now.toISOString().split("T")[0],
      };
    }
    case "Last Month": {
      const startOfLastMonth = new Date(currentYear, currentMonth - 1, 1);
      const endOfLastMonth = new Date(currentYear, currentMonth, 0);
      return {
        startDate: startOfLastMonth.toISOString().split("T")[0],
        endDate: endOfLastMonth.toISOString().split("T")[0],
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
        startDate: startOfLastQuarter.toISOString().split("T")[0],
        endDate: endOfLastQuarter.toISOString().split("T")[0],
      };
    }
    case "Last Year": {
      const startOfLastYear = new Date(currentYear - 1, 0, 1);
      const endOfLastYear = new Date(currentYear - 1, 11, 31);
      return {
        startDate: startOfLastYear.toISOString().split("T")[0],
        endDate: endOfLastYear.toISOString().split("T")[0],
      };
    }
    case "3 Months": {
      const threeMonthsAgo = new Date(now);
      threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
      return {
        startDate: threeMonthsAgo.toISOString().split("T")[0],
        endDate: now.toISOString().split("T")[0],
      };
    }
    case "6 Months": {
      const sixMonthsAgo = new Date(now);
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
      return {
        startDate: sixMonthsAgo.toISOString().split("T")[0],
        endDate: now.toISOString().split("T")[0],
      };
    }
    case "12 Months": {
      const twelveMonthsAgo = new Date(now);
      twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);
      return {
        startDate: twelveMonthsAgo.toISOString().split("T")[0],
        endDate: now.toISOString().split("T")[0],
      };
    }
    default:
      // Default to YTD
      return getDateRangeForPeriod("YTD");
  }
};

export default useTopTieringData;
