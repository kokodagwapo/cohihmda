import { useState, useEffect } from "react";
import { api } from "@/lib/api";

export interface LeaderboardLeader {
  id: string;
  name: string;
  role: string;
  branch: string;
  avatarUrl?: string;
  points: number;
  rank: number;
  delta: number;
  loans: number;
  loansStarted?: number;
  pullThru: number;
  cycleTime: number;
  volume: string; // Total loan amount funded
  revenue: string; // Estimated commission/income (~1% of volume)
  badges: string[];
  streakDays: number;
}

export interface LeaderboardFilters {
  loan_officer_id?: string;
  branch?: string;
  scope?: "all" | "branch" | "team";
  startDate?: string; // ISO date string for custom range
  endDate?: string; // ISO date string for custom range
  /** Channel filter (e.g., 'Retail', 'TPO', or specific channel) */
  channelGroup?: string;
}

// Extended timeframe types including "Last" periods
export type LeaderboardTimeframe =
  | "wtd"
  | "mtd"
  | "qtd"
  | "lm"
  | "lq"
  | "ly"
  | "custom";

export const useLeaderboardData = (
  timeframe: LeaderboardTimeframe,
  selectedTenantId?: string | null,
  additionalFilters?: LeaderboardFilters,
  dimensionFilters?: Array<{ column: string; value: string }>,
) => {
  const [leaderboardData, setLeaderboardData] = useState<LeaderboardLeader[]>(
    []
  );
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchLeaderboard = async () => {
      // Check if user has a valid token before making API call
      if (!api.hasToken()) {
        setLeaderboardData([]);
        setLoading(false);
        return;
      }

      // For custom timeframe, we need start and end dates
      if (
        timeframe === "custom" &&
        (!additionalFilters?.startDate || !additionalFilters?.endDate)
      ) {
        setLeaderboardData([]);
        setLoading(false);
        return;
      }

      try {
        setLoading(true);

        // Build URL with tenant_id and additional filters
        const params = new URLSearchParams();
        params.append("timeframe", timeframe);
        if (selectedTenantId) params.append("tenant_id", selectedTenantId);
        if (additionalFilters?.branch)
          params.append("branch", additionalFilters.branch);
        if (additionalFilters?.scope)
          params.append("scope", additionalFilters.scope);
        // Don't send filter when "All" channels selected
        if (
          additionalFilters?.channelGroup &&
          additionalFilters.channelGroup !== "All"
        )
          params.append("channel_group", additionalFilters.channelGroup);

        // Add custom date range if provided
        if (
          timeframe === "custom" &&
          additionalFilters?.startDate &&
          additionalFilters?.endDate
        ) {
          params.append("startDate", additionalFilters.startDate);
          params.append("endDate", additionalFilters.endDate);
        }

        if (dimensionFilters) {
          for (const df of dimensionFilters) {
            if (df.value && df.value !== 'all') params.append(df.column, df.value);
          }
        }

        console.log("[useLeaderboardData] Fetching leaderboard:", {
          timeframe,
          tenant: selectedTenantId,
          filters: additionalFilters,
        });

        const data = await api.request<{
          leaderboard: any[];
          timeframe: string;
        }>(`/api/dashboard/leaderboard?${params.toString()}`);

        console.log("[useLeaderboardData] Received data:", {
          count: data.leaderboard?.length || 0,
          sample: data.leaderboard?.slice(0, 2),
        });

        if (data.leaderboard && data.leaderboard.length > 0) {
          const transformed: LeaderboardLeader[] = data.leaderboard.map(
            (emp, idx) => ({
              id: emp.employeeId || `emp-${idx}`,
              name: emp.name || "Unknown",
              role: emp.role || "Loan Officer",
              branch: emp.branch || "Unknown",
              avatarUrl: undefined,
              points: Math.round(
                (emp.loansClosed || 0) * 60 +
                  (emp.totalVolume || 0) / 10000 +
                  (emp.pullThroughRate || 0) * 10
              ),
              rank: emp.rank || idx + 1,
              delta: emp.delta !== undefined ? emp.delta : 0,
              loans: emp.loansClosed || 0,
              loansStarted: emp.loansStarted || 0,
              pullThru: Math.round(emp.pullThroughRate || 0),
              cycleTime: Math.round(emp.avgCycleTime || 0),
              // Volume = total loan amount funded
              volume: emp.totalVolume
                ? `$${(emp.totalVolume / 1000000).toFixed(1)}M`
                : "$0M",
              // Revenue = actual revenue from API (Base Buy + Orig Fees - Lender Credits)
              revenue: emp.totalRevenue
                ? emp.totalRevenue >= 1000000
                  ? `$${(emp.totalRevenue / 1000000).toFixed(1)}M`
                  : `$${(emp.totalRevenue / 1000).toFixed(0)}K`
                : "$0K",
              badges: generateBadges(emp),
              streakDays: 0,
            })
          );
          setLeaderboardData(transformed);
        } else {
          setLeaderboardData([]);
        }
      } catch (error: any) {
        if (
          error.message?.includes("Unauthorized") ||
          error.message?.includes("401")
        ) {
          setLeaderboardData([]);
        } else if (
          error.message?.includes("timed out") ||
          error.message?.includes("timeout")
        ) {
          console.warn("Leaderboard request timed out:", error.message);
          setLeaderboardData([]);
        } else {
          console.error("Failed to fetch leaderboard:", error);
          setLeaderboardData([]);
        }
      } finally {
        setLoading(false);
      }
    };
    fetchLeaderboard();
  }, [
    timeframe,
    selectedTenantId,
    additionalFilters?.branch,
    additionalFilters?.scope,
    additionalFilters?.startDate,
    additionalFilters?.endDate,
    additionalFilters?.channelGroup,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    JSON.stringify(dimensionFilters),
  ]);

  return { leaderboardData, loading };
};

function generateBadges(emp: any): string[] {
  const badges: string[] = [];

  if (emp.rank <= 3) {
    badges.push("Top Performer");
  }

  if (emp.pullThroughRate >= 90) {
    badges.push("Pull-Through Pro");
  }

  if (emp.avgCycleTime > 0 && emp.avgCycleTime <= 30) {
    badges.push("Fast Closer");
  }

  if (emp.totalVolume >= 5000000) {
    badges.push("Volume Champion");
  }

  if (emp.delta > 10) {
    badges.push("Rising Star");
  }

  return badges;
}
