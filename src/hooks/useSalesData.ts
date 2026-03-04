import { useState, useEffect } from "react";
import { api } from "@/lib/api";

export interface DateRange {
  startDate: string;
  endDate: string;
}

export interface CompanyOverviewData {
  activeLoans?: {
    count: number;
    volume: number;
    avgInterestRate: number;
  };
  submittedMTD?: {
    count: number;
    volume: number;
    avgInterestRate: number;
  };
  fundedMTD?: {
    count: number;
    volume: number;
    avgInterestRate: number;
  };
  aging?: {
    "0-15": number;
    "16-30": number;
    "31-45": number;
    "46-60": number;
    "61-90": number;
    ">90": number;
  };
  submittedByType?: Record<string, number>;
  fundedByType?: Record<string, number>;
}

export const useSalesData = (
  dateRange?: DateRange,
  selectedTenantId?: string | null,
  selectedChannel?: string | null
) => {
  const [companyOverviewData, setCompanyOverviewData] =
    useState<CompanyOverviewData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchCompanyOverview = async () => {
      // Check if user has a valid token before making API call
      if (!api.hasToken()) {
        // No token - set data to null and stop loading
        setCompanyOverviewData(null);
        setLoading(false);
        return;
      }

      try {
        // Build query parameters
        const params = new URLSearchParams();
        if (dateRange?.startDate)
          params.append("startDate", dateRange.startDate);
        if (dateRange?.endDate) params.append("endDate", dateRange.endDate);
        if (selectedTenantId) params.append("tenant_id", selectedTenantId);
        if (selectedChannel && selectedChannel !== "All")
          params.append("channel_group", selectedChannel);

        const queryString = params.toString();
        const url = `/api/loans/company-overview${
          queryString ? `?${queryString}` : ""
        }`;

        console.log("🔍 Fetching company overview from", url);
        const data = await api.request<CompanyOverviewData>(url);
        console.log(
          "📊 Company overview data from API:",
          JSON.stringify(
            {
              activeLoans: data.activeLoans,
              submittedMTD: data.submittedMTD,
              fundedMTD: data.fundedMTD,
              aging: data.aging,
            },
            null,
            2
          )
        );

        if (
          data &&
          (data.activeLoans !== undefined || data.submittedMTD !== undefined)
        ) {
          setCompanyOverviewData(data);
        } else {
          console.warn(
            "⚠️ API returned company overview data but it appears empty or invalid:",
            data
          );
        }
      } catch (error: any) {
        // Handle unauthorized errors silently (user not logged in)
        if (
          error.message?.includes("Unauthorized") ||
          error.message?.includes("401")
        ) {
          // User not authenticated - set data to null without logging error
          setCompanyOverviewData(null);
        } else {
          console.error("❌ Failed to fetch company overview data:", error);
          console.error("Error details:", {
            message: error.message,
            stack: error.stack,
          });
          setCompanyOverviewData(null);
        }
      } finally {
        setLoading(false);
      }
    };
    fetchCompanyOverview();
  }, [
    dateRange?.startDate,
    dateRange?.endDate,
    selectedTenantId,
    selectedChannel,
  ]);

  return { companyOverviewData, loading };
};
