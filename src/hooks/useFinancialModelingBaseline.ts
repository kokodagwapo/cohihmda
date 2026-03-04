import { useState, useEffect } from "react";
import { api } from "@/lib/api";

export type FinancialModelingPeriod =
  | "all"
  | "mtd"
  | "ytd"
  | "last_month"
  | "last_year"
  | "trailing_12"; // Rolling 12 months

export interface StaffingUnitTargets {
  processor: number;
  underwriter: number;
  closer: number;
  other: number;
}

export interface FinancialModelingBaseline {
  totalRevenue: number;
  totalVolume: number;
  fundedUnits: number;
  marginBps: number;
  pullThroughRate: number;
  mloCount: number;
  avgUnitsPerMlo: number;
  avgUnitsPerProcessor: number;
  avgUnitsPerUnderwriter: number;
  avgUnitsPerCloser: number;
  /** Qlik-style actual units per month per FTE (total output / (avg distinct per month * num months)) */
  actualUnitsPerProcessorPerMonthFTE: number;
  actualUnitsPerUnderwriterPerMonthFTE: number;
  actualUnitsPerCloserPerMonthFTE: number;
  /** Unit targets per role (from tenant staffing_unit_targets). */
  targetUnits?: StaffingUnitTargets;
  dateRange: { start: string | null; end: string | null };
}

/**
 * Fetches financial modeling baseline metrics for the sandbox (revenue, volume, margin BPS, pull-through, units by role).
 * Uses tenant_id query param when provided for multi-tenant support.
 *
 * @param selectedTenantId - Optional tenant ID (platform staff can pass to select tenant)
 * @param period - 'all' | 'mtd' | 'ytd' | 'trailing_12' | 'last_month' | 'last_year' (default 'trailing_12')
 */
export function useFinancialModelingBaseline(
  selectedTenantId?: string | null,
  period: FinancialModelingPeriod = "trailing_12"
) {
  const [data, setData] = useState<FinancialModelingBaseline | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchBaseline = async () => {
      if (!api.hasToken()) {
        setData(null);
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams();
        params.append("period", period);
        if (selectedTenantId) params.append("tenant_id", selectedTenantId);

        const url = `/api/dashboard/financial-modeling-baseline?${params.toString()}`;
        const responseData = await api.request<FinancialModelingBaseline>(url);

        if (responseData && typeof responseData.totalRevenue === "number") {
          setData(responseData);
        } else {
          setData(null);
        }
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : "Failed to fetch financial modeling baseline";
        if (
          typeof message === "string" &&
          (message.includes("Unauthorized") || message.includes("401"))
        ) {
          setData(null);
        } else {
          console.error("[FinancialModelingBaseline] Failed to fetch:", err);
          setError(message);
          setData(null);
        }
      } finally {
        setLoading(false);
      }
    };

    fetchBaseline();
  }, [selectedTenantId, period]);

  return { data, loading, error };
}
