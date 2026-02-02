/**
 * useCompanyScorecardData Hook
 * Fetches scorecard data using the enhanced metrics API with groupBy support
 */
import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';

export interface ScorecardFilters {
  year: number;
  branch: string;
  loanOfficer: string;
  application: string;
  channel?: string | null; // Channel group filter (Retail, TPO, etc.) - matches Qlik [Consolidated Channels]
  dateRange?: { start: string; end: string }; // Optional: explicit date range (overrides year)
  dateField?: string; // Which date field to filter on (application_date, funding_date, started_date, etc.)
  tenantId?: string | null; // Tenant ID for multi-tenant support (admins viewing other tenants)
}

export interface GroupedMetricResult {
  groupKey: string;
  value: number;
  metadata?: {
    count?: number;
  };
}

export interface MetricsByGroup {
  [metricId: string]: GroupedMetricResult[];
}

export interface MetricResult {
  metricId: string;
  value: number;
  metadata?: Record<string, any>;
}

export interface ScorecardTotals {
  loansStarted: number;           // Denominator: all loans started (by started_date)
  totalLoansWithRespa: number;    // Numerator: applications with RESPA (by application_date) - main "Total Loans" KPI
  originatedLoans: number;
  falloutWithdrawn: number;
  falloutDenied: number;
  totalVolume: number;
  originatedVolume: number;       // Volume for originated loans only (matches Qlik CompanyScorecard_Originated Volume $)
  fundedVolume: number;
  avgCycleTime: number;
  pullThroughRate: number;
  creditPulls: number;
  waFico: number;
  waLtv: number;
  waDti: number;
  wac: number;
  totalRevenue: number;
  originatedRevenue: number;      // Revenue for originated loans only (matches Qlik CompanyScorecard_Originated Revenue $)
  govtUnits: number;
  purchaseUnits: number;
  // Withdrawn Totals
  withdrawnVolume: number;        // Withdrawn $ (sum of loan amounts for withdrawn loans)
  withdrawnProformaRevenue: number; // W/D ProForma Revenue
  // Denied Totals
  deniedVolume: number;           // Denied $ (sum of loan amounts for denied loans)
}

export interface BranchData {
  name: string;
  loansStarted: number;           // Denominator: all loans started (by started_date)
  totalLoansWithRespa: number;    // Numerator: applications with RESPA (by application_date)
  originatedLoans: number;
  falloutWithdrawn: number;
  falloutDenied: number;
  volume: number;                 // Originated volume - for display in summary table
  tieringVolume: number;          // Total volume - used for tier calculation (matches Qlik Applications Taken Volume Tiers)
  pullThroughRate: number;
  waFico: number;
  waLtv: number;
  waDti: number;
  wac: number;
  revenue: number;
  govtUnits: number;
  purchaseUnits: number;
  // Withdrawn Totals
  withdrawnVolume: number;        // Withdrawn $
  withdrawnProformaRevenue: number; // W/D ProForma Revenue
  // Denied Totals
  deniedVolume: number;           // Denied $
}

export interface ScorecardData {
  totals: ScorecardTotals;
  byBranch: BranchData[];
  branches: string[];
  loanOfficers: string[];
}

const SCORECARD_METRICS = [
  'loans_started',              // Loans started (filtered by started_date) - the denominator "of X started"
  'scorecard_total_loans',      // Applications with RESPA (filtered by application_date) - the main "Total Loans" KPI
  'scorecard_originated_loans', // Originated loans filtered by application_date (matches Qlik Company Scorecard)
  'fallout_withdrawn',
  'fallout_denied',
  'total_volume',
  'originated_volume',          // Volume for originated loans only (matches Qlik CompanyScorecard_Originated Volume $)
  'funded_volume',
  'avg_cycle_time',
  'pull_through_rate',
  'credit_pulls',
  'wa_fico',
  'wa_ltv',
  'wa_dti',
  'wac',
  'total_revenue',
  'originated_revenue',         // Revenue for originated loans only (matches Qlik CompanyScorecard_Originated Revenue $)
  'govt_originated_units',      // Gov't ORIGINATED units (matches Qlik Company Scorecard - uses Pull Through Originated Flag)
  'purchase_originated_units',  // Purchase ORIGINATED units (matches Qlik Company Scorecard - uses Pull Through Originated Flag)
  // Withdrawn Totals
  'withdrawn_volume',           // Withdrawn $ (sum of loan amounts for withdrawn loans)
  'withdrawn_proforma_revenue', // W/D ProForma Revenue
  // Denied Totals
  'denied_volume'               // Denied $ (sum of loan amounts for denied loans)
];

function transformGroupedToByBranch(groupedData: MetricsByGroup): BranchData[] {
  // Get all unique branch names from any metric
  const branchNames = new Set<string>();
  Object.values(groupedData).forEach(metricResults => {
    metricResults.forEach(result => {
      if (result.groupKey) {
        branchNames.add(result.groupKey);
      }
    });
  });

  // Create a map for quick lookup
  const getMetricValue = (metricId: string, branchName: string): number => {
    const results = groupedData[metricId] || [];
    const match = results.find(r => r.groupKey === branchName);
    return match?.value || 0;
  };

  // Transform to BranchData array
  return Array.from(branchNames).map(branchName => ({
    name: branchName,
    loansStarted: getMetricValue('loans_started', branchName),           // Denominator: by started_date
    totalLoansWithRespa: getMetricValue('scorecard_total_loans', branchName),  // Numerator: by application_date
    originatedLoans: getMetricValue('scorecard_originated_loans', branchName), // Originated filtered by application_date
    falloutWithdrawn: getMetricValue('fallout_withdrawn', branchName),
    falloutDenied: getMetricValue('fallout_denied', branchName),
    volume: getMetricValue('originated_volume', branchName), // Originated volume - for display in summary table
    tieringVolume: getMetricValue('total_volume', branchName), // Total volume - used for tier calculation
    pullThroughRate: getMetricValue('pull_through_rate', branchName),
    waFico: getMetricValue('wa_fico', branchName),
    waLtv: getMetricValue('wa_ltv', branchName),
    waDti: getMetricValue('wa_dti', branchName),
    wac: getMetricValue('wac', branchName),
    revenue: getMetricValue('originated_revenue', branchName), // Originated revenue - for display in summary table
    govtUnits: getMetricValue('govt_originated_units', branchName), // Gov't ORIGINATED units (Qlik Company Scorecard)
    purchaseUnits: getMetricValue('purchase_originated_units', branchName), // Purchase ORIGINATED units (Qlik Company Scorecard)
    // Withdrawn Totals
    withdrawnVolume: getMetricValue('withdrawn_volume', branchName), // Withdrawn $
    withdrawnProformaRevenue: getMetricValue('withdrawn_proforma_revenue', branchName), // W/D ProForma Revenue
    // Denied Totals
    deniedVolume: getMetricValue('denied_volume', branchName) // Denied $
  })).sort((a, b) => b.tieringVolume - a.tieringVolume); // Sort by tiering volume (total volume) descending
}

function transformTotalsResponse(metrics: Record<string, MetricResult>): ScorecardTotals {
  const getValue = (metricId: string): number => {
    const result = metrics[metricId];
    return typeof result?.value === 'number' ? result.value : 0;
  };

  return {
    loansStarted: getValue('loans_started'),              // Denominator: by started_date
    totalLoansWithRespa: getValue('scorecard_total_loans'), // Numerator: by application_date - main "Total Loans" KPI
    originatedLoans: getValue('scorecard_originated_loans'), // Originated filtered by application_date (Company Scorecard)
    falloutWithdrawn: getValue('fallout_withdrawn'),
    falloutDenied: getValue('fallout_denied'),
    totalVolume: getValue('total_volume'),
    originatedVolume: getValue('originated_volume'), // Volume for originated loans only
    fundedVolume: getValue('funded_volume'),
    avgCycleTime: getValue('avg_cycle_time'),
    pullThroughRate: getValue('pull_through_rate'),
    creditPulls: getValue('credit_pulls'),
    waFico: getValue('wa_fico'),
    waLtv: getValue('wa_ltv'),
    waDti: getValue('wa_dti'),
    wac: getValue('wac'),
    totalRevenue: getValue('total_revenue'),
    originatedRevenue: getValue('originated_revenue'), // Revenue for originated loans only
    govtUnits: getValue('govt_originated_units'), // Gov't ORIGINATED units (Qlik Company Scorecard)
    purchaseUnits: getValue('purchase_originated_units'), // Purchase ORIGINATED units (Qlik Company Scorecard)
    // Withdrawn Totals
    withdrawnVolume: getValue('withdrawn_volume'), // Withdrawn $
    withdrawnProformaRevenue: getValue('withdrawn_proforma_revenue'), // W/D ProForma Revenue
    // Denied Totals
    deniedVolume: getValue('denied_volume') // Denied $
  };
}

export function useCompanyScorecardData(filters: ScorecardFilters) {
  const [data, setData] = useState<ScorecardData | null>(null);
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
      if (filters.branch !== 'all') {
        additionalFilters.branch = filters.branch;
      }
      if (filters.loanOfficer !== 'all') {
        additionalFilters.loan_officer = filters.loanOfficer;
      }
      // Channel filter - matches Qlik [Consolidated Channels]={'$(vChannelGroup)'}
      if (filters.channel && filters.channel !== 'All') {
        additionalFilters.consolidated_channel = filters.channel;
      }

      // Build request body with optional dateField override
      // When dateField is specified, all metrics will use this date field instead of their defaults
      const requestBody = {
        metricIds: SCORECARD_METRICS,
        dateRange: { start: dateRangeStart, end: dateRangeEnd },
        ...(filters.dateField && { dateField: filters.dateField }), // Override date field for all metrics
        ...(Object.keys(additionalFilters).length > 0 && { additionalFilters })
      };

      // Build URL with tenant_id as query param (required by tenant context middleware)
      const tenantQueryParam = filters.tenantId ? `?tenant_id=${encodeURIComponent(filters.tenantId)}` : '';

      // Fetch in parallel: grouped by branch, totals, and filter options
      const [groupedResponse, totalsResponse, branchesResponse, losResponse] = await Promise.all([
        // Grouped metrics by branch
        api.request<{ metrics: MetricsByGroup; groupedBy: string }>(`/api/metrics/query${tenantQueryParam}`, {
          method: 'POST',
          body: JSON.stringify({
            ...requestBody,
            groupBy: 'branch'
          })
        }),
        // Total metrics (non-grouped)
        api.request<{ metrics: Record<string, MetricResult> }>(`/api/metrics/query${tenantQueryParam}`, {
          method: 'POST',
          body: JSON.stringify(requestBody)
        }),
        // Branch dropdown values
        api.request<{ values: string[] }>(`/api/loans/distinct-values/branch${tenantQueryParam}`),
        // Loan officer dropdown values
        api.request<{ values: string[] }>(`/api/loans/distinct-values/loan_officer${tenantQueryParam}`)
      ]);

      // Transform responses
      const byBranch = transformGroupedToByBranch(groupedResponse.metrics);
      const totals = transformTotalsResponse(totalsResponse.metrics);

      setData({
        totals,
        byBranch,
        branches: branchesResponse.values || [],
        loanOfficers: losResponse.values || []
      });

    } catch (err: any) {
      console.error('[useCompanyScorecardData] Error fetching data:', err);
      setError(err.message || 'Failed to load scorecard data');
    } finally {
      setLoading(false);
    }
  }, [filters.year, filters.branch, filters.loanOfficer, filters.channel, filters.dateRange?.start, filters.dateRange?.end, filters.dateField, filters.tenantId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { data, loading, error, refetch: fetchData };
}
