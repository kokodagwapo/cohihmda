import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";

export type SalesCompanyOverviewAgingBucket =
  | "0-15"
  | "16-30"
  | "31-45"
  | "46-60"
  | "61-90"
  | ">90";

export interface SalesCompanyOverviewSliceFilters {
  loanTypes: string[];
  agingBuckets: SalesCompanyOverviewAgingBucket[];
}

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
    endDate?: string;
    endDateExclusive?: string;
  };
  definitions?: {
    submittedDateField: "submitted_to_processing_date" | "processing_date";
  };
  /** Distinct loan types for filter pills (baseline tenant+channel+access; ignores slice filters). */
  sliceFilterOptionLists?: {
    loanTypes: string[];
  };
}

function buildSalesCompanyOverviewQueryString(
  selectedTenantId?: string | null,
  selectedChannel?: string | null,
  sliceFilters?: SalesCompanyOverviewSliceFilters | null,
): string {
  const params = new URLSearchParams();
  if (selectedTenantId) params.append("tenant_id", selectedTenantId);
  if (selectedChannel && selectedChannel !== "All") {
    params.append("channel_group", selectedChannel);
  }
  const loanTypes = [...new Set((sliceFilters?.loanTypes ?? []).map((s) => s.trim()).filter(Boolean))].sort();
  for (const lt of loanTypes) {
    params.append("loan_type", lt);
  }
  const aging = [...new Set(sliceFilters?.agingBuckets ?? [])].sort();
  for (const ab of aging) {
    params.append("aging_bucket", ab);
  }
  return params.toString();
}

export const useSalesCompanyOverviewData = (
  selectedTenantId?: string | null,
  selectedChannel?: string | null,
  sliceFilters?: SalesCompanyOverviewSliceFilters | null,
) => {
  const [data, setData] = useState<SalesCompanyOverviewData | null>(null);
  const [loading, setLoading] = useState(true);

  const filtersKey = useMemo(
    () =>
      JSON.stringify({
        loanTypes: [...new Set((sliceFilters?.loanTypes ?? []).map((s) => s.trim()).filter(Boolean))].sort(),
        agingBuckets: [...new Set(sliceFilters?.agingBuckets ?? [])].sort(),
      }),
    [sliceFilters?.loanTypes, sliceFilters?.agingBuckets],
  );

  useEffect(() => {
    const fetchData = async () => {
      if (!api.hasToken()) {
        setData(null);
        setLoading(false);
        return;
      }

      try {
        const qs = buildSalesCompanyOverviewQueryString(selectedTenantId, selectedChannel, sliceFilters);
        const url = `/api/loans/sales-company-overview${qs ? `?${qs}` : ""}`;
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
  }, [selectedTenantId, selectedChannel, filtersKey]);

  return { data, loading };
};
