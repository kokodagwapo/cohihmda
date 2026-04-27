import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";

export type ProductionDateType = "applications" | "closed" | "funded";
export type ProductionMeasure = "volume" | "units";
export type ProductionDimension =
  | "loan_purpose"
  | "loan_type"
  | "channel"
  | "branch"
  | "broker_lender_name"
  | "investor"
  | "warehouse_co_name";

/** Drilldown filters: at most one level should be non-empty; values OR within that level. */
export interface ProductionTrendsDrilldownSlice {
  branches: string[];
  lienPositions: string[];
  productTypes: string[];
  loanPrograms: string[];
}

/** Chart-driven filters (Sales Company Overview–style); AND with each other and with YearMonth picker. */
export interface ProductionTrendsSliceFilters {
  dimensionCategories: string[];
  lineMonths: number[];
  drilldown: ProductionTrendsDrilldownSlice | null;
}

export interface ProductionTrendsFilters {
  dateType: ProductionDateType;
  measure: ProductionMeasure;
  dimension: ProductionDimension;
  yearMonths: string[];
  tenantId?: string | null;
  channelGroup?: string | null;
  sliceFilters?: ProductionTrendsSliceFilters | null;
}

export interface ProductionYearMonthOption {
  value: string;
  label: string;
}

export interface ProductionYoYRow {
  timeRange: "Month to Date" | "Quarter to Date" | "Year to Date";
  currentYear: number;
  previousYear: number;
  yoyPercent: number | null;
}

export interface ProductionLargestCategoryRow {
  category: string;
  units: number;
  volume: number;
  sharePercent: number;
}

export interface ProductionLargestCategory {
  titleCategory: string;
  titleSharePercent: number;
  rows: ProductionLargestCategoryRow[];
}

export interface ProductionMonthlyPoint {
  month: number;
  monthLabel: string;
  currentValue: number;
  previousValue: number;
}

export interface ProductionYoYSeries {
  key: string;
  currentYear: number;
  previousYear: number;
  points: ProductionMonthlyPoint[];
}

export interface ProductionDrilldownRow {
  id: string;
  parentId: string | null;
  depth: number;
  label: string;
  units: number;
  volume: number;
  avgLoanAmount: number;
  avgLtv: number | null;
  wac: number | null;
  avgTurnTime: number | null;
}

export interface ProductionDrilldown {
  turnTimeLabel: string;
  rows: ProductionDrilldownRow[];
}

/** Distinct values for slice filter popovers (omit the slice being edited so lists stay full). */
export interface ProductionTrendsSliceFilterOptionLists {
  dimensionValues: string[];
  drilldownBranches: string[];
  drilldownLiens: string[];
  drilldownProducts: string[];
  drilldownPrograms: string[];
}

export interface ProductionTrendsData {
  currentYear: number;
  previousYear: number;
  currentMaxYear: number;
  currentMaxMonth: number;
  dateTypeLabel: string;
  measureLabel: string;
  dimensionLabel: string;
  yearMonthOptions: ProductionYearMonthOption[];
  yoyComparison: ProductionYoYRow[];
  largestCategory: ProductionLargestCategory;
  yoySeries: ProductionYoYSeries[];
  drilldown: ProductionDrilldown;
  sliceFilterOptionLists: ProductionTrendsSliceFilterOptionLists;
}

function buildQuery(filters: ProductionTrendsFilters): string {
  const params = new URLSearchParams();
  params.set("date_type", filters.dateType);
  params.set("measure", filters.measure);
  params.set("dimension", filters.dimension);
  if (filters.tenantId) params.set("tenant_id", filters.tenantId);
  if (filters.channelGroup && filters.channelGroup !== "All") {
    params.set("channel_group", filters.channelGroup);
  }
  [...new Set(filters.yearMonths)].sort().forEach((ym) => params.append("year_month", ym));
  const slice = filters.sliceFilters;
  if (slice) {
    const cats = [...new Set(slice.dimensionCategories.map((s) => s.trim()).filter(Boolean))].sort();
    for (const c of cats) {
      params.append("slice_category", c);
    }
    const lineMonths = [...new Set(slice.lineMonths.filter((m) => Number.isInteger(m) && m >= 1 && m <= 12))].sort(
      (a, b) => a - b,
    );
    for (const month of lineMonths) {
      params.append("slice_month", String(month));
    }
    const d = slice.drilldown;
    if (d) {
      const branches = [...new Set(d.branches.map((s) => s.trim()).filter(Boolean))].sort();
      for (const b of branches) params.append("slice_branch", b);
      const liens = [...new Set(d.lienPositions.map((s) => s.trim()).filter(Boolean))].sort();
      for (const x of liens) params.append("slice_lien_position", x);
      const products = [...new Set(d.productTypes.map((s) => s.trim()).filter(Boolean))].sort();
      for (const x of products) params.append("slice_product_type", x);
      const programs = [...new Set(d.loanPrograms.map((s) => s.trim()).filter(Boolean))].sort();
      for (const x of programs) params.append("slice_loan_program", x);
    }
  }
  return params.toString();
}

export function useProductionTrendsData(filters: ProductionTrendsFilters) {
  const [data, setData] = useState<ProductionTrendsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const sliceKey = useMemo(() => {
    const s = filters.sliceFilters;
    if (!s) return "null";
    return JSON.stringify({
      dimensionCategories: [...new Set(s.dimensionCategories.map((x) => x.trim()).filter(Boolean))].sort(),
      lineMonths: [...new Set(s.lineMonths.filter((m) => Number.isInteger(m) && m >= 1 && m <= 12))].sort(
        (a, b) => a - b,
      ),
      drilldown: s.drilldown
        ? {
            branches: [...new Set(s.drilldown.branches.map((x) => x.trim()).filter(Boolean))].sort(),
            liens: [...new Set(s.drilldown.lienPositions.map((x) => x.trim()).filter(Boolean))].sort(),
            products: [...new Set(s.drilldown.productTypes.map((x) => x.trim()).filter(Boolean))].sort(),
            programs: [...new Set(s.drilldown.loanPrograms.map((x) => x.trim()).filter(Boolean))].sort(),
          }
        : null,
    });
  }, [filters.sliceFilters]);

  const queryKey = useMemo(
    () =>
      JSON.stringify({
        dateType: filters.dateType,
        measure: filters.measure,
        dimension: filters.dimension,
        yearMonths: [...new Set(filters.yearMonths)].sort(),
        tenantId: filters.tenantId || null,
        channelGroup: filters.channelGroup || null,
        sliceKey,
      }),
    [
      filters.channelGroup,
      filters.dateType,
      filters.dimension,
      filters.measure,
      filters.tenantId,
      filters.yearMonths,
      sliceKey,
    ],
  );

  useEffect(() => {
    let cancelled = false;
    const fetchData = async () => {
      if (!api.hasToken()) {
        if (!cancelled) {
          setData(null);
          setError(null);
          setLoading(false);
        }
        return;
      }

      try {
        setLoading(true);
        setError(null);
        const response = await api.request<ProductionTrendsData>(
          `/api/loans/production-trends?${buildQuery(filters)}`,
        );
        if (!cancelled) setData(response);
      } catch (err: unknown) {
        const knownError = err as { response?: { data?: { error?: string } }; message?: string };
        if (!cancelled) {
          setError(
            knownError?.response?.data?.error ||
              knownError?.message ||
              "Failed to load production trends",
          );
          setData(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void fetchData();
    return () => {
      cancelled = true;
    };
  // queryKey intentionally captures all filter values in stable serialized form
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryKey]);

  return { data, loading, error };
}
