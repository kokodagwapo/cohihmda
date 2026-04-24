import { useEffect, useState } from "react";
import { api } from "@/lib/api";

export interface SalesCompanyOverviewData {
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
  window?: {
    startDate: string;
    endDateExclusive: string;
  };
}

export const useSalesCompanyOverviewData = (
  selectedTenantId?: string | null,
  selectedChannel?: string | null,
) => {
  const [data, setData] = useState<SalesCompanyOverviewData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      if (!api.hasToken()) {
        setData(null);
        setLoading(false);
        return;
      }

      try {
        const params = new URLSearchParams();
        if (selectedTenantId) params.append("tenant_id", selectedTenantId);
        if (selectedChannel && selectedChannel !== "All") {
          params.append("channel_group", selectedChannel);
        }
        const queryString = params.toString();
        const url = `/api/loans/sales-company-overview${queryString ? `?${queryString}` : ""}`;
        const response = await api.request<SalesCompanyOverviewData>(url);
        setData(response);
      } catch (error: any) {
        if (error.message?.includes("Unauthorized") || error.message?.includes("401")) {
          setData(null);
        } else {
          console.error("Failed to fetch sales company overview data:", error);
          setData(null);
        }
      } finally {
        setLoading(false);
      }
    };

    setLoading(true);
    fetchData();
  }, [selectedTenantId, selectedChannel]);

  return { data, loading };
};
