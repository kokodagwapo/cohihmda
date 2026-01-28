import { useState, useEffect } from 'react';
import { api } from '@/lib/api';

export type TopTieringActorType = 'branch' | 'loan-officer';
export type TimeFilterType = 'last-year' | 'last-quarter' | 'last-month' | 'ytd' | 'qtd' | 'mtd' | 'custom';
export type TTSTier = 'top' | 'second' | 'bottom';

/**
 * Individual actor data with revenue metrics and tier assignment
 */
export interface TopTieringActor {
  id: string;
  name: string;
  tier: TTSTier;
  revenue: number;
  units: number;
  volume: number;
  revenueBPS: number;
  revenuePerLoan: number;
  cumulativeRevenuePercent?: number;
  cumulativeUnitsPercent?: number;
}

/**
 * Tier summary with counts and percentages
 */
export interface TopTieringTierSummary {
  count: number;
  revenue: number;
  revenuePercent: number;
  units: number;
  unitsPercent: number;
  avgRevenue: number;
  avgUnits: number;
}

/**
 * Totals for all actors
 */
export interface TopTieringTotals {
  revenue: number;
  units: number;
  volume: number;
  avgRevenueBPS: number;
  actorCount: number;
  avgRevenuePerActor: number;
  avgUnitsPerActor: number;
}

/**
 * Date range information
 */
export interface TopTieringDateRange {
  start: string;
  end: string;
  label: string;
  periodType: string;
}

/**
 * Full TopTiering Comparison response data
 */
export interface TopTieringComparisonData {
  actors: TopTieringActor[];
  totals: TopTieringTotals;
  tierSummary: {
    top: TopTieringTierSummary;
    second: TopTieringTierSummary;
    bottom: TopTieringTierSummary;
  };
  dateRange: TopTieringDateRange;
  yoyGrowth?: number;
}

/**
 * Custom date range for 'custom' time filter
 */
export interface CustomDateRange {
  start: string;
  end: string;
}

/**
 * Hook for fetching TopTiering Comparison data
 * 
 * Unlike Sales Scorecard (which uses TTS weighted composite score), 
 * TopTiering Comparison uses CUMULATIVE REVENUE PERCENTAGE for tier assignment:
 * - Top Tier: Actors contributing to top 50% of total revenue
 * - Second Tier: Actors contributing to next 30% (50-80%)
 * - Bottom Tier: Actors contributing to remaining 20% (80-100%)
 * 
 * @param actorType - 'branch' or 'loan-officer'
 * @param timeFilter - Time period filter
 * @param selectedTenantId - Optional tenant ID for multi-tenant support
 * @param selectedChannel - Optional channel filter (Retail, TPO, specific channel)
 * @param customDateRange - Custom start/end dates when timeFilter='custom'
 */
export const useTopTieringComparisonData = (
  actorType: TopTieringActorType = 'loan-officer',
  timeFilter: TimeFilterType = 'last-year',
  selectedTenantId?: string | null,
  selectedChannel?: string | null,
  customDateRange?: CustomDateRange
) => {
  const [data, setData] = useState<TopTieringComparisonData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchTopTieringData = async () => {
      // Check if user has a valid token before making API call
      const token = localStorage.getItem('auth_token');
      if (!token) {
        setData(null);
        setLoading(false);
        return;
      }
      
      setLoading(true);
      setError(null);
      
      try {
        // Build query parameters
        const params = new URLSearchParams();
        params.append('actor_type', actorType);
        params.append('date_range', timeFilter);
        
        if (timeFilter === 'custom' && customDateRange) {
          params.append('start_date', customDateRange.start);
          params.append('end_date', customDateRange.end);
        }
        
        if (selectedTenantId) params.append('tenant_id', selectedTenantId);
        if (selectedChannel) params.append('channel_group', selectedChannel);
        
        const queryString = params.toString();
        const url = `/api/loans/toptiering-comparison${queryString ? `?${queryString}` : ''}`;
        
        console.log('[TopTieringComparison] Fetching data from', url);
        const responseData = await api.request<TopTieringComparisonData>(url);
        console.log('[TopTieringComparison] API response:', JSON.stringify({
          actorCount: responseData.actors?.length,
          totals: responseData.totals,
          tierSummary: {
            top: responseData.tierSummary?.top?.count,
            second: responseData.tierSummary?.second?.count,
            bottom: responseData.tierSummary?.bottom?.count,
          },
          dateRange: responseData.dateRange,
          yoyGrowth: responseData.yoyGrowth
        }, null, 2));
        
        if (responseData && responseData.actors) {
          setData(responseData);
        } else {
          console.warn('[TopTieringComparison] API returned data but it appears empty or invalid:', responseData);
          setData(null);
        }
      } catch (err: any) {
        // Handle unauthorized errors silently (user not logged in)
        if (err.message?.includes('Unauthorized') || err.message?.includes('401')) {
          setData(null);
        } else {
          console.error('[TopTieringComparison] Failed to fetch data:', err);
          setError(err.message || 'Failed to fetch toptiering comparison data');
          setData(null);
        }
      } finally {
        setLoading(false);
      }
    };
    
    fetchTopTieringData();
  }, [actorType, timeFilter, selectedTenantId, selectedChannel, customDateRange?.start, customDateRange?.end]);

  return { data, loading, error };
};

/**
 * Helper function to get tier color (teal/emerald/lime theme)
 */
export const getTierColor = (tier: TTSTier, isDarkMode: boolean = false): string => {
  switch (tier) {
    case 'top':
      return isDarkMode ? '#14b8a6' : '#0d9488'; // teal-500/teal-600
    case 'second':
      return isDarkMode ? '#10b981' : '#059669'; // emerald-500/emerald-600
    case 'bottom':
      return isDarkMode ? '#84cc16' : '#65a30d'; // lime-500/lime-600
  }
};

/**
 * Helper function to get tier badge color classes
 */
export const getTierColorClass = (tier: TTSTier, isDarkMode: boolean = false): string => {
  const colors = {
    top: isDarkMode ? 'bg-teal-900/30 text-teal-300' : 'bg-teal-100 text-teal-700',
    second: isDarkMode ? 'bg-emerald-900/30 text-emerald-300' : 'bg-emerald-100 text-emerald-700',
    bottom: isDarkMode ? 'bg-lime-900/30 text-lime-300' : 'bg-lime-100 text-lime-700',
  };
  return colors[tier];
};

/**
 * Helper function to get tier display name
 */
export const getTierDisplayName = (tier: TTSTier): string => {
  const names: Record<TTSTier, string> = {
    top: 'Top Tier',
    second: 'Second Tier',
    bottom: 'Bottom Tier',
  };
  return names[tier];
};

/**
 * Helper function to get actor type display name
 */
export const getActorTypeDisplayName = (actorType: TopTieringActorType): string => {
  return actorType === 'branch' ? 'Branch' : 'Loan Officer';
};

/**
 * Helper function to get time filter display label
 */
export const getTimeFilterLabel = (timeFilter: TimeFilterType): string => {
  const labels: Record<TimeFilterType, string> = {
    'last-year': 'Last Year',
    'last-quarter': 'Last Quarter',
    'last-month': 'Last Month',
    'ytd': 'Year to Date',
    'qtd': 'Quarter to Date',
    'mtd': 'Month to Date',
    'custom': 'Custom Range',
  };
  return labels[timeFilter];
};

/**
 * Convert internal time filter to API date_range parameter
 */
export const timeFilterToDateRange = (timeFilter: 'last-year' | 'last-quarter' | 'last-month' | 'custom'): TimeFilterType => {
  // Direct mapping - our internal types match the API
  return timeFilter;
};

/**
 * Helper function to format currency values
 */
export const formatCurrency = (value: number, abbreviated: boolean = true): string => {
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
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
};

/**
 * Helper function to format numbers with commas
 */
export const formatNumber = (num: number, decimals: number = 0): string => {
  return num.toLocaleString('en-US', { 
    minimumFractionDigits: decimals, 
    maximumFractionDigits: decimals 
  });
};

/**
 * Helper function to format percentages
 */
export const formatPercent = (value: number, decimals: number = 1): string => {
  return `${value.toFixed(decimals)}%`;
};

export default useTopTieringComparisonData;
