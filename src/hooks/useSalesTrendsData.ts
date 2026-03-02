import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';

export type DateRangeOption = '3-months' | '6-months';

/**
 * Loan Officer data for Sales Trends
 */
export interface LoanOfficer {
  id: string;
  name: string;
  initials: string;
  branch: string;
  branchNumber: string;
  tier: 'top' | '2nd' | 'bottom';
  closed: number;
  volume: number;
  marginBPS: number;
  trendPercent: number;
  daysAvg: number;
  ttsScore: number;
}

/**
 * KPI metrics for summary cards
 */
export interface KPIMetrics {
  totalUnits: number;
  totalVolume: number;
  activeLOs: number;
  avgTurnTime: number;
}

/**
 * Fund type breakdown for pie chart
 */
export interface FundTypeData {
  name: string;
  value: number;
  fill: string;
}

/**
 * Monthly performance for bar chart
 */
export interface MonthlyPerformance {
  month: string;
  units: number;
  volume: number;
}

/**
 * Date range information
 */
export interface DateRangeInfo {
  startDate: string;
  endDate: string;
  previousStartDate: string;
  previousEndDate: string;
}

/**
 * Full Sales Trends API response
 */
export interface SalesTrendsData {
  loanOfficers: LoanOfficer[];
  kpiMetrics: KPIMetrics;
  fundTypeBreakdown: FundTypeData[];
  monthlyPerformance: MonthlyPerformance[];
  dateRange: DateRangeInfo;
}

/**
 * Monthly detail for drilldown modal
 */
export interface MonthlyDetail {
  month: string;
  closed: number;
  volume: number;
  margin: number;
  pullThrough: number;
  turnTime: number;
}

/**
 * Performance trend data point
 */
export interface PerformanceTrendPoint {
  month: string;
  closedUnits: number;
  marginBPS: number;
}

/**
 * Contact info for drilldown
 */
export interface ContactInfo {
  email: string;
  phone: string;
  location: string;
}

/**
 * Drilldown data for a specific Loan Officer
 */
export interface DrilldownData {
  totalClosed: number;
  totalVolume: number;
  avgMargin: number;
  turnTime: number;
  branchRank: number;
  branchTotal: number;
  contact: ContactInfo;
  monthlyDetails: MonthlyDetail[];
  performanceTrend: PerformanceTrendPoint[];
}

/**
 * Hook return type
 */
export interface UseSalesTrendsDataReturn {
  data: SalesTrendsData | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
  fetchDrilldown: (loName: string) => Promise<DrilldownData | null>;
}

/**
 * Custom hook for fetching Sales Trends data
 * 
 * @param dateRange - '3-months' or '6-months'
 * @param channelGroup - Channel filter (default: 'Retail')
 * @param tenantId - Tenant ID for multi-tenant support (optional)
 * @returns Sales trends data, loading state, error, and refetch function
 */
/** Optional explicit date range override (from DatePeriodPicker custom selection) */
export interface SalesTrendsCustomDateRange {
  start: string; // YYYY-MM-DD
  end: string;   // YYYY-MM-DD
}

export function useSalesTrendsData(
  dateRange: DateRangeOption = '3-months',
  channelGroup: string = 'Retail',
  tenantId?: string | null,
  customDateRange?: SalesTrendsCustomDateRange,
  dimensionFilters?: Array<{ column: string; value: string }>,
): UseSalesTrendsDataReturn {
  const [data, setData] = useState<SalesTrendsData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      // NOTE: Using original endpoint until /api/scorecard/sales-trends is fully tested
      let url = `/api/loans/sales-trends?date_range=${dateRange}&channel_group=${encodeURIComponent(channelGroup)}`;
      if (tenantId) {
        url += `&tenant_id=${encodeURIComponent(tenantId)}`;
      }
      // When a custom date range is provided (e.g. from DatePeriodPicker),
      // send start_date / end_date so the API can use them instead of the preset string.
      if (customDateRange) {
        url += `&start_date=${encodeURIComponent(customDateRange.start)}&end_date=${encodeURIComponent(customDateRange.end)}`;
      }
      if (dimensionFilters) {
        for (const df of dimensionFilters) {
          if (df.value && df.value !== 'all') url += `&${encodeURIComponent(df.column)}=${encodeURIComponent(df.value)}`;
        }
      }
      console.log('[SalesTrends] Fetching data from', url);
      
      const responseData = await api.request<SalesTrendsData>(url);
      console.log('[SalesTrends] API response:', JSON.stringify({
        loanOfficerCount: responseData.loanOfficers?.length,
        kpiMetrics: responseData.kpiMetrics,
      }, null, 2));

      setData(responseData);
    } catch (err: any) {
      console.error('Error fetching sales trends data:', err);
      setError(err.response?.data?.error || err.message || 'Failed to fetch sales trends data');
      setData(null);
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateRange, channelGroup, tenantId, customDateRange?.start, customDateRange?.end, JSON.stringify(dimensionFilters)]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  /**
   * Fetch drilldown data for a specific Loan Officer
   */
  const fetchDrilldown = useCallback(async (loName: string): Promise<DrilldownData | null> => {
    try {
      // NOTE: Using original endpoint until /api/scorecard/sales-trends is fully tested
      let url = `/api/loans/sales-trends/drilldown/${encodeURIComponent(loName)}?date_range=${dateRange}&channel_group=${encodeURIComponent(channelGroup)}`;
      if (tenantId) {
        url += `&tenant_id=${encodeURIComponent(tenantId)}`;
      }
      console.log('[SalesTrends] Fetching drilldown from', url);
      
      const responseData = await api.request<DrilldownData>(url);
      return responseData;
    } catch (err: any) {
      console.error('Error fetching drilldown data:', err);
      return null;
    }
  }, [dateRange, channelGroup, tenantId]);

  return {
    data,
    loading,
    error,
    refetch: fetchData,
    fetchDrilldown,
  };
}

/**
 * Format currency value for display
 */
export function formatCurrency(value: number): string {
  if (value >= 1000000) {
    return `$${(value / 1000000).toFixed(1)}M`;
  } else if (value >= 1000) {
    return `$${(value / 1000).toFixed(0)}K`;
  }
  return `$${value.toLocaleString()}`;
}

/**
 * Format large numbers with K/M suffix
 */
export function formatNumber(value: number): string {
  if (value >= 1000000) {
    return `${(value / 1000000).toFixed(1)}M`;
  } else if (value >= 1000) {
    return `${(value / 1000).toFixed(0)}K`;
  }
  return value.toLocaleString();
}

/**
 * Get tier badge color classes
 */
export function getTierColors(tier: 'top' | '2nd' | 'bottom'): {
  bg: string;
  text: string;
  darkBg: string;
  darkText: string;
} {
  switch (tier) {
    case 'top':
      return {
        bg: 'bg-blue-100',
        text: 'text-blue-700',
        darkBg: 'dark:bg-blue-900/30',
        darkText: 'dark:text-blue-300',
      };
    case '2nd':
      return {
        bg: 'bg-emerald-100',
        text: 'text-emerald-700',
        darkBg: 'dark:bg-emerald-900/30',
        darkText: 'dark:text-emerald-300',
      };
    case 'bottom':
      return {
        bg: 'bg-rose-100',
        text: 'text-rose-700',
        darkBg: 'dark:bg-rose-900/30',
        darkText: 'dark:text-rose-300',
      };
  }
}

export default useSalesTrendsData;
