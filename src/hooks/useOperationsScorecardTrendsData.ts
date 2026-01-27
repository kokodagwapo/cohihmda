import { useState, useEffect } from 'react';
import { api } from '@/lib/api';

export type ScorecardActorType = 'processor' | 'underwriter' | 'closer';
export type ComparisonViewType = 'vs-target' | 'monthly' | 'year-over-year';
export type TTSTier = 'top' | 'second' | 'bottom';

/**
 * Monthly metrics for an actor
 */
export interface MonthlyMetrics {
  unitsOutput: number;
  outputVsTarget: number;
  averageDays: number;
  conversionPercent: number;
  loanComplexityScore: number;
  volumeOutput: number;
}

/**
 * Actor with monthly trend data
 */
export interface ActorTrendsData {
  id: string;
  name: string;
  tier: TTSTier;
  ttsScore: number;
  months: {
    [yearMonth: string]: MonthlyMetrics;
  };
}

/**
 * Monthly totals across all actors
 */
export interface MonthlyTotals {
  unitsOutput: number;
  outputVsTarget: number;
  volumeOutput: number;
}

/**
 * Tier summary for the sidebar
 */
export interface TierSummary {
  tier: TTSTier;
  count: number;
  totalUnits: number;
  percentOfTotal: number;
  avgUnitsPerMonth: number;
  avgDaysPerUnit: number;
}

/**
 * KPI summary for top row cards
 */
export interface KPIData {
  targetUnitsPerMonth: number;
  avgUnitsOutput: number;
  avgVolumeOutput: number;
  avgLoanComplexityScore: number;
  avgDays: number;
}

/**
 * Date range information
 */
export interface DateRangeInfo {
  start: string;
  end: string;
  monthsIncluded: number;
}

/**
 * Full Operations Scorecard Trends response data
 */
export interface OperationsScorecardTrendsData {
  actors: ActorTrendsData[];
  months: string[];  // Ordered list: ['Jan-2026', 'Dec-2025', ...]
  totals: {
    [yearMonth: string]: MonthlyTotals;
  };
  tierSummary: {
    top: TierSummary;
    second: TierSummary;
    bottom: TierSummary;
  };
  kpis: KPIData;
  dateRange: DateRangeInfo;
}

/**
 * Hook for fetching Operations Scorecard Trends data
 * 
 * This hook provides monthly performance trends for operations staff in a pivot table format.
 * Unlike useOperationsScorecardData which summarizes by tier, this returns month-by-month breakdown.
 * 
 * TTS Formula (Operations):
 * OPS_TTS = (UnitRating × 0.70 + TurnTimeRating × 0.15 + ComplexityRating × 0.15)
 * 
 * Tier assignment based on TTS score:
 * - Top Tier: TTS > 120 (20%+ above average)
 * - Second Tier: TTS 100-120 (at or above average)
 * - Bottom Tier: TTS < 100 (below average)
 * 
 * @param actorType - 'processor' | 'underwriter' | 'closer'
 * @param comparisonView - 'vs-target' | 'monthly' | 'year-over-year'
 * @param selectedTenantId - Optional tenant ID for multi-tenant support
 * @param selectedChannel - Optional channel filter
 * @param monthsToShow - Number of months to display (default: 13)
 * @param targetUnits - Monthly target for vs-target calculation (default: 25)
 */
export const useOperationsScorecardTrendsData = (
  actorType: ScorecardActorType = 'underwriter',
  comparisonView: ComparisonViewType = 'vs-target',
  selectedTenantId?: string | null,
  selectedChannel?: string | null,
  monthsToShow: number = 13,
  targetUnits: number = 25
) => {
  const [data, setData] = useState<OperationsScorecardTrendsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchOperationsScorecardTrendsData = async () => {
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
        params.append('months', monthsToShow.toString());
        params.append('target_units', targetUnits.toString());
        if (selectedTenantId) params.append('tenant_id', selectedTenantId);
        if (selectedChannel) params.append('channel_group', selectedChannel);
        
        const queryString = params.toString();
        const url = `/api/loans/operations-scorecard-trends${queryString ? `?${queryString}` : ''}`;
        
        console.log('[OpsScorecardTrends] Fetching data from', url);
        const responseData = await api.request<OperationsScorecardTrendsData>(url);
        console.log('[OpsScorecardTrends] API response:', JSON.stringify({
          actorCount: responseData.actors?.length,
          monthsCount: responseData.months?.length,
          kpis: responseData.kpis,
          tierSummary: {
            top: responseData.tierSummary?.top?.count,
            second: responseData.tierSummary?.second?.count,
            bottom: responseData.tierSummary?.bottom?.count,
          }
        }, null, 2));
        
        if (responseData && responseData.actors) {
          // Apply comparison view transformations if needed
          const transformedData = applyComparisonView(responseData, comparisonView, targetUnits);
          setData(transformedData);
        } else {
          console.warn('[OpsScorecardTrends] API returned data but it appears empty or invalid:', responseData);
          setData(null);
        }
      } catch (err: any) {
        // Handle unauthorized errors silently (user not logged in)
        if (err.message?.includes('Unauthorized') || err.message?.includes('401')) {
          setData(null);
        } else {
          console.error('[OpsScorecardTrends] Failed to fetch data:', err);
          setError(err.message || 'Failed to fetch operations scorecard trends data');
          setData(null);
        }
      } finally {
        setLoading(false);
      }
    };
    
    fetchOperationsScorecardTrendsData();
  }, [actorType, comparisonView, selectedTenantId, selectedChannel, monthsToShow, targetUnits]);

  return { data, loading, error };
};

/**
 * Apply comparison view transformations to the data
 * - vs-target: outputVsTarget = units - target (already calculated by API)
 * - monthly: outputVsTarget = current month - previous month
 * - year-over-year: outputVsTarget = current month - same month last year
 */
function applyComparisonView(
  data: OperationsScorecardTrendsData,
  comparisonView: ComparisonViewType,
  targetUnits: number
): OperationsScorecardTrendsData {
  if (comparisonView === 'vs-target') {
    // Already calculated by API
    return data;
  }
  
  const months = data.months;
  
  // Create transformed actors with recalculated outputVsTarget
  const transformedActors = data.actors.map(actor => {
    const transformedMonths: { [key: string]: MonthlyMetrics } = {};
    
    months.forEach((month, index) => {
      const currentData = actor.months[month];
      if (!currentData) {
        transformedMonths[month] = {
          unitsOutput: 0,
          outputVsTarget: 0,
          averageDays: 0,
          conversionPercent: 0,
          loanComplexityScore: 0,
          volumeOutput: 0
        };
        return;
      }
      
      let outputVsTarget = currentData.outputVsTarget;
      
      if (comparisonView === 'monthly') {
        // Compare to previous month
        const prevMonth = months[index + 1];
        if (prevMonth && actor.months[prevMonth]) {
          outputVsTarget = currentData.unitsOutput - actor.months[prevMonth].unitsOutput;
        } else {
          outputVsTarget = 0;
        }
      } else if (comparisonView === 'year-over-year') {
        // Compare to same month last year (12 months ago)
        const sameMonthLastYear = months[index + 12];
        if (sameMonthLastYear && actor.months[sameMonthLastYear]) {
          outputVsTarget = currentData.unitsOutput - actor.months[sameMonthLastYear].unitsOutput;
        } else {
          outputVsTarget = 0;
        }
      }
      
      transformedMonths[month] = {
        ...currentData,
        outputVsTarget
      };
    });
    
    return {
      ...actor,
      months: transformedMonths
    };
  });
  
  // Recalculate totals
  const transformedTotals: { [key: string]: MonthlyTotals } = {};
  months.forEach((month, index) => {
    const currentTotal = data.totals[month];
    if (!currentTotal) {
      transformedTotals[month] = { unitsOutput: 0, outputVsTarget: 0, volumeOutput: 0 };
      return;
    }
    
    let outputVsTarget = currentTotal.outputVsTarget;
    
    if (comparisonView === 'monthly') {
      const prevMonth = months[index + 1];
      if (prevMonth && data.totals[prevMonth]) {
        outputVsTarget = currentTotal.unitsOutput - data.totals[prevMonth].unitsOutput;
      } else {
        outputVsTarget = 0;
      }
    } else if (comparisonView === 'year-over-year') {
      const sameMonthLastYear = months[index + 12];
      if (sameMonthLastYear && data.totals[sameMonthLastYear]) {
        outputVsTarget = currentTotal.unitsOutput - data.totals[sameMonthLastYear].unitsOutput;
      } else {
        outputVsTarget = 0;
      }
    }
    
    transformedTotals[month] = {
      ...currentTotal,
      outputVsTarget
    };
  });
  
  return {
    ...data,
    actors: transformedActors,
    totals: transformedTotals
  };
}

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
export const getActorTypeDisplayName = (actorType: ScorecardActorType): string => {
  const names: Record<ScorecardActorType, string> = {
    processor: 'Processor',
    underwriter: 'Underwriter',
    closer: 'Closer',
  };
  return names[actorType];
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

/**
 * Convert tier summary to match the view component interface
 */
export const convertTierSummaryToViewFormat = (tierSummary: TierSummary) => {
  return {
    tier: tierSummary.tier,
    count: tierSummary.count,
    totalUnits: tierSummary.totalUnits,
    percentOfTotal: tierSummary.percentOfTotal,
    avgUnitsPerMonth: tierSummary.avgUnitsPerMonth,
    avgDaysPerUnit: tierSummary.avgDaysPerUnit,
  };
};

export default useOperationsScorecardTrendsData;
