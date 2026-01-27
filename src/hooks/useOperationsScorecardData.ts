import { useState, useEffect } from 'react';
import { api } from '@/lib/api';

export type OperationsActorType = 'processor' | 'underwriter' | 'closer';
export type DateRangeType = '3-months' | '6-months' | '12-months';
export type TTSTier = 'top' | 'second' | 'bottom';

/**
 * Individual actor data with metrics and TTS score
 */
export interface OperationsActor {
  name: string;
  units: number;
  volume: number;
  avgUnitsPerMonth: number;
  avgDays: number;
  loanComplexityScore: number;
  approvedPercent: number;
  deniedPercent: number;
  governmentPercent: number;
  purchasePercent: number;
  waFico: number;
  waLtv: number;
  ttsScore: number;
  tier: TTSTier;
  // Ratings (for debugging)
  unitRating?: number;
  turnTimeRating?: number;
  complexityRating?: number;
}

/**
 * Tier summary metrics (matches OperationsScorecardView interface)
 */
export interface OperationsTierSummary {
  count: number;
  units: number;
  unitsPercent: number;
  volume: number;
  loanComplexityScore: number;
  avgUnitsPerMonth: number;
  avgDays: number;
  compensation: string;
  costPerFile: string;
  approvedPercent: number;
  deniedPercent: number;
  governmentPercent: number;
  purchasePercent: number;
  waFico: number;
  waLtv: number;
  avgTtsScore: number;
}

/**
 * Company-wide average metrics
 */
export interface CompanyAverages {
  avgUnits: number;
  avgTurnTime: number;
  avgComplexity: number;
}

/**
 * Weight configuration for Operations TTS (70/15/15)
 */
export interface WeightConfig {
  unit: number;      // 0.70 = 70%
  turnTime: number;  // 0.15 = 15%
  complexity: number; // 0.15 = 15%
}

/**
 * Full Operations Scorecard response data
 */
export interface OperationsScorecardData {
  actors: OperationsActor[];
  tierSummary: {
    top: OperationsTierSummary;
    second: OperationsTierSummary;
    bottom: OperationsTierSummary;
  };
  totals: OperationsTierSummary;
  companyAverages: CompanyAverages;
  weightConfig: WeightConfig;
  dateRange: {
    start: string;
    end: string;
    months: number;
  };
}

/**
 * Hook for fetching Operations Scorecard data
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
 * @param dateRange - '3-months' | '6-months' | '12-months'
 * @param selectedTenantId - Optional tenant ID for multi-tenant support
 * @param selectedChannel - Optional channel filter
 */
export const useOperationsScorecardData = (
  actorType: OperationsActorType = 'underwriter',
  dateRange: DateRangeType = '3-months',
  selectedTenantId?: string | null,
  selectedChannel?: string | null
) => {
  const [data, setData] = useState<OperationsScorecardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchOperationsScorecardData = async () => {
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
        params.append('date_range', dateRange);
        if (selectedTenantId) params.append('tenant_id', selectedTenantId);
        if (selectedChannel) params.append('channel_group', selectedChannel);
        
        const queryString = params.toString();
        const url = `/api/loans/operations-scorecard${queryString ? `?${queryString}` : ''}`;
        
        console.log('[OpsScorecard] Fetching data from', url);
        const responseData = await api.request<OperationsScorecardData>(url);
        console.log('[OpsScorecard] API response:', JSON.stringify({
          actorCount: responseData.actors?.length,
          totals: responseData.totals,
          tierSummary: {
            top: responseData.tierSummary?.top?.count,
            second: responseData.tierSummary?.second?.count,
            bottom: responseData.tierSummary?.bottom?.count,
          }
        }, null, 2));
        
        if (responseData && responseData.actors) {
          setData(responseData);
        } else {
          console.warn('[OpsScorecard] API returned data but it appears empty or invalid:', responseData);
          setData(null);
        }
      } catch (err: any) {
        // Handle unauthorized errors silently (user not logged in)
        if (err.message?.includes('Unauthorized') || err.message?.includes('401')) {
          setData(null);
        } else {
          console.error('[OpsScorecard] Failed to fetch data:', err);
          setError(err.message || 'Failed to fetch operations scorecard data');
          setData(null);
        }
      } finally {
        setLoading(false);
      }
    };
    
    fetchOperationsScorecardData();
  }, [actorType, dateRange, selectedTenantId, selectedChannel]);

  return { data, loading, error };
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
export const getActorTypeDisplayName = (actorType: OperationsActorType): string => {
  const names: Record<OperationsActorType, string> = {
    processor: 'Processor',
    underwriter: 'Underwriter',
    closer: 'Closer',
  };
  return names[actorType];
};

/**
 * Helper function to format date range for display
 */
export const formatDateRangeDisplay = (dateRange: DateRangeType): string => {
  const labels: Record<DateRangeType, string> = {
    '3-months': '3 Months',
    '6-months': '6 Months',
    '12-months': '12 Months',
  };
  return labels[dateRange];
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
 * Convert tier summary to match the mock data interface in OperationsScorecardView
 * This helps bridge the API response to the existing component interface
 */
export const convertToViewFormat = (tierSummary: OperationsTierSummary) => {
  return {
    underwriterCount: tierSummary.count, // Named underwriterCount in the view for historical reasons
    unitsOutput: tierSummary.units,
    unitsPercent: tierSummary.unitsPercent,
    volumeOutput: tierSummary.volume,
    loanComplexityScore: tierSummary.loanComplexityScore,
    avgUnitsPerMonth: tierSummary.avgUnitsPerMonth,
    avgDays: tierSummary.avgDays,
    compensation: tierSummary.compensation,
    costPerFile: tierSummary.costPerFile,
    approvedPercent: tierSummary.approvedPercent,
    deniedPercent: tierSummary.deniedPercent,
    governmentPercent: tierSummary.governmentPercent,
    purchasePercent: tierSummary.purchasePercent,
    waFico: tierSummary.waFico,
    waLtv: tierSummary.waLtv,
  };
};

export default useOperationsScorecardData;
