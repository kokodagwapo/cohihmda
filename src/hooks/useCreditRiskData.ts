/**
 * useCreditRiskData Hook
 * Fetches Credit Risk Management data using the enhanced metrics API
 * Matches Qlik Performance app Credit Risk Management sheet logic
 */
import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';

// Application Type maps to Qlik's vDateTypeSet variable
export type ApplicationType = 'Applications Taken' | 'Funded Production' | 'Lost Opportunities' | 'All Loans';

export interface CreditRiskFilters {
  applicationType: ApplicationType;
  channel?: string | null; // Channel group filter (Retail, TPO, etc.) - matches Qlik [Consolidated Channels]
  year: number;
  dateRange?: { start: string; end: string }; // Optional: explicit date range
  tenantId?: string | null; // Tenant ID for multi-tenant support (admins viewing other tenants)
}

// Distribution bucket interface - matches backend DistributionBucket
export interface DistributionBucket {
  range: string;
  rangeLabel: string;
  units: number;
  volume: number;
  percentage: number;
  sortOrder: number;
}

// Loan Mix row interface - matches backend LoanMixRow
export interface LoanMixRow {
  category: string;
  units: number;
  unitsPercent: number;
  volume: number;
  volumePercent: number;
  wac: number;
  waFico: number;
  waLtv: number;
  waDti: number;
}

// KPIs interface
export interface CreditRiskKpis {
  units: number;
  volume: number;
  wac: number;
  waFico: number;
  waLtv: number;
  waDti: number;
}

// Credit Risk Story interface - matches backend CreditRiskStoryData
// ⚠️ Uses volumePercent NOT unitsPercent - Qlik uses Sum([Loan Amount]) for story items
export interface CreditRiskStory {
  largestLoanType: { category: string; volumePercent: number };
  largestLoanPurpose: { category: string; volumePercent: number };
  largestOccupancy: { category: string; volumePercent: number };
  conventionalQualifiedPercent: number;
  governmentQualifiedPercent: number;
}

// Complete Credit Risk data interface
export interface CreditRiskData {
  kpis: CreditRiskKpis;
  ficoDistribution: DistributionBucket[];
  ltvDistribution: DistributionBucket[];
  dtiDistribution: DistributionBucket[];
  loanMixByType: LoanMixRow[];
  loanMixByPurpose: LoanMixRow[];
  loanMixByOccupancy: LoanMixRow[];
  creditRiskStory: CreditRiskStory;
}

// API response interface
interface CreditRiskApiResponse {
  kpis: Record<string, number>;
  ficoDistribution: DistributionBucket[];
  ltvDistribution: DistributionBucket[];
  dtiDistribution: DistributionBucket[];
  loanMixByType: LoanMixRow[];
  loanMixByPurpose: LoanMixRow[];
  loanMixByOccupancy: LoanMixRow[];
  creditRiskStory?: {
    largestLoanType: { category: string; volumePercent: number };
    largestLoanPurpose: { category: string; volumePercent: number };
    largestOccupancy: { category: string; volumePercent: number };
    conventionalQualifiedPercent: number;
    governmentQualifiedPercent: number;
  };
  filters: {
    dateRange: { start: string | null; end: string | null } | null;
    dateField: string;
    applicationType: string;
  };
}

/**
 * Transform API response to typed CreditRiskData
 */
function transformApiResponse(response: CreditRiskApiResponse): CreditRiskData {
  // Default story data if not provided from backend
  const defaultStory: CreditRiskStory = {
    largestLoanType: { category: 'N/A', volumePercent: 0 },
    largestLoanPurpose: { category: 'N/A', volumePercent: 0 },
    largestOccupancy: { category: 'N/A', volumePercent: 0 },
    conventionalQualifiedPercent: 0,
    governmentQualifiedPercent: 0
  };

  return {
    kpis: {
      units: response.kpis.total_units || 0,
      volume: response.kpis.total_volume || 0,
      wac: response.kpis.wac || 0,
      waFico: response.kpis.wa_fico || 0,
      waLtv: response.kpis.wa_ltv || 0,
      waDti: response.kpis.wa_dti || 0
    },
    ficoDistribution: response.ficoDistribution || [],
    ltvDistribution: response.ltvDistribution || [],
    dtiDistribution: response.dtiDistribution || [],
    loanMixByType: response.loanMixByType || [],
    loanMixByPurpose: response.loanMixByPurpose || [],
    loanMixByOccupancy: response.loanMixByOccupancy || [],
    creditRiskStory: response.creditRiskStory || defaultStory
  };
}

/**
 * Hook to fetch Credit Risk Management data
 */
export function useCreditRiskData(filters: CreditRiskFilters) {
  const [data, setData] = useState<CreditRiskData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      // Use explicit dateRange if provided, otherwise fall back to full year
      const dateRangeStart = filters.dateRange?.start || `${filters.year}-01-01`;
      const dateRangeEnd = filters.dateRange?.end || `${filters.year}-12-31`;

      // Build additional filters
      const additionalFilters: Record<string, any> = {};
      
      // Channel filter - matches Qlik [Consolidated Channels]={'$(vChannelGroup)'}
      if (filters.channel && filters.channel !== 'All') {
        additionalFilters.consolidated_channel = filters.channel;
      }

      // Build request body
      const requestBody = {
        dateRange: { start: dateRangeStart, end: dateRangeEnd },
        applicationType: filters.applicationType,
        ...(Object.keys(additionalFilters).length > 0 && { additionalFilters })
      };

      console.log('[useCreditRiskData] Fetching data with filters:', requestBody);

      // Build URL with tenant_id as query param (required by tenant context middleware)
      let url = '/api/metrics/credit-risk';
      if (filters.tenantId) {
        url += `?tenant_id=${encodeURIComponent(filters.tenantId)}`;
      }

      // Call the combined credit-risk endpoint
      const response = await api.request<CreditRiskApiResponse>(url, {
        method: 'POST',
        body: JSON.stringify(requestBody)
      });

      // Transform and set data
      const transformedData = transformApiResponse(response);
      setData(transformedData);

      console.log('[useCreditRiskData] Data loaded successfully:', {
        kpis: transformedData.kpis,
        ficoDistribution: transformedData.ficoDistribution.length,
        ltvDistribution: transformedData.ltvDistribution.length,
        dtiDistribution: transformedData.dtiDistribution.length,
        loanMixByType: transformedData.loanMixByType.length,
        loanMixByPurpose: transformedData.loanMixByPurpose.length,
        loanMixByOccupancy: transformedData.loanMixByOccupancy.length
      });

    } catch (err: any) {
      console.error('[useCreditRiskData] Error fetching data:', err);
      setError(err.message || 'Failed to load credit risk data');
    } finally {
      setLoading(false);
    }
  }, [
    filters.applicationType, 
    filters.channel, 
    filters.year, 
    filters.dateRange?.start, 
    filters.dateRange?.end,
    filters.tenantId
  ]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { data, loading, error, refetch: fetchData };
}

/**
 * Calculate totals for Loan Mix rows
 */
export function calculateLoanMixTotals(rows: LoanMixRow[]): {
  totalUnits: number;
  totalVolume: number;
  avgWac: number;
  avgFico: number;
  avgLtv: number;
  avgDti: number;
} {
  if (rows.length === 0) {
    return {
      totalUnits: 0,
      totalVolume: 0,
      avgWac: 0,
      avgFico: 0,
      avgLtv: 0,
      avgDti: 0
    };
  }

  const totalUnits = rows.reduce((sum, row) => sum + row.units, 0);
  const totalVolume = rows.reduce((sum, row) => sum + row.volume, 0);

  // Weighted averages
  const weightedWac = rows.reduce((sum, row) => sum + (row.wac * row.units), 0);
  const weightedFico = rows.reduce((sum, row) => sum + (row.waFico * row.units), 0);
  const weightedLtv = rows.reduce((sum, row) => sum + (row.waLtv * row.units), 0);
  const weightedDti = rows.reduce((sum, row) => sum + (row.waDti * row.units), 0);

  return {
    totalUnits,
    totalVolume,
    avgWac: totalUnits > 0 ? weightedWac / totalUnits : 0,
    avgFico: totalUnits > 0 ? weightedFico / totalUnits : 0,
    avgLtv: totalUnits > 0 ? weightedLtv / totalUnits : 0,
    avgDti: totalUnits > 0 ? weightedDti / totalUnits : 0
  };
}
