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
  // HMDA (excludes Active loans to match Qlik)
  hmdaVolume: number;             // Volume All Final HMDA Status
  hmdaUnits: number;              // Units All Final HMDA Status
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
  // HMDA (excludes Active loans to match Qlik)
  hmdaVolume: number;             // Volume All Final HMDA Status
  hmdaUnits: number;              // Units All Final HMDA Status
  // Withdrawn Totals
  withdrawnVolume: number;        // Withdrawn $
  withdrawnProformaRevenue: number; // W/D ProForma Revenue
  // Denied Totals
  deniedVolume: number;           // Denied $
}

export interface ScorecardData {
  totals: ScorecardTotals;
  byBranch: BranchData[];
  byLoanOfficer: BranchData[]; // Same shape as BranchData; name = loan officer name
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
  // HMDA metrics (exclude Active loans to match Qlik)
  'hmda_volume',                // Volume All Final HMDA Status (excludes Active)
  'hmda_units',                 // Units All Final HMDA Status (excludes Active)
  // Withdrawn Totals
  'withdrawn_volume',           // Withdrawn $ (sum of loan amounts for withdrawn loans)
  'withdrawn_proforma_revenue', // W/D ProForma Revenue
  // Denied Totals
  'denied_volume'               // Denied $ (sum of loan amounts for denied loans)
];

function transformGroupedToRows(groupedData: MetricsByGroup, sortByVolume = true): BranchData[] {
  const names = new Set<string>();
  Object.values(groupedData).forEach(metricResults => {
    metricResults.forEach(result => {
      if (result.groupKey) names.add(result.groupKey);
    });
  });

  const getMetricValue = (metricId: string, groupKey: string): number => {
    const results = groupedData[metricId] || [];
    const match = results.find(r => r.groupKey === groupKey);
    return match?.value || 0;
  };

  const rows = Array.from(names).map(groupKey => ({
    name: groupKey,
    loansStarted: getMetricValue('loans_started', groupKey),
    totalLoansWithRespa: getMetricValue('scorecard_total_loans', groupKey),
    originatedLoans: getMetricValue('scorecard_originated_loans', groupKey),
    falloutWithdrawn: getMetricValue('fallout_withdrawn', groupKey),
    falloutDenied: getMetricValue('fallout_denied', groupKey),
    volume: getMetricValue('originated_volume', groupKey),
    tieringVolume: getMetricValue('total_volume', groupKey),
    pullThroughRate: getMetricValue('pull_through_rate', groupKey),
    waFico: getMetricValue('wa_fico', groupKey),
    waLtv: getMetricValue('wa_ltv', groupKey),
    waDti: getMetricValue('wa_dti', groupKey),
    wac: getMetricValue('wac', groupKey),
    revenue: getMetricValue('originated_revenue', groupKey),
    govtUnits: getMetricValue('govt_originated_units', groupKey),
    purchaseUnits: getMetricValue('purchase_originated_units', groupKey),
    hmdaVolume: getMetricValue('hmda_volume', groupKey),
    hmdaUnits: getMetricValue('hmda_units', groupKey),
    withdrawnVolume: getMetricValue('withdrawn_volume', groupKey),
    withdrawnProformaRevenue: getMetricValue('withdrawn_proforma_revenue', groupKey),
    deniedVolume: getMetricValue('denied_volume', groupKey),
  }));
  return sortByVolume ? rows.sort((a, b) => b.tieringVolume - a.tieringVolume) : rows;
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
    // HMDA (excludes Active loans)
    hmdaVolume: getValue('hmda_volume'), // Volume All Final HMDA Status
    hmdaUnits: getValue('hmda_units'), // Units All Final HMDA Status
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

      // Build request body - each metric uses its own defaultDateField
      // (matching Qlik where each expression has its own DateType, e.g. Application, Started, Funding)
      const requestBody = {
        metricIds: SCORECARD_METRICS,
        dateRange: { start: dateRangeStart, end: dateRangeEnd },
        ...(Object.keys(additionalFilters).length > 0 && { additionalFilters })
      };

      // Build URL with tenant_id as query param (required by tenant context middleware)
      const tenantQueryParam = filters.tenantId ? `?tenant_id=${encodeURIComponent(filters.tenantId)}` : '';

      // Fetch in parallel: grouped by branch, grouped by loan_officer, totals, and filter options
      const [groupedByBranchResponse, groupedByLOResponse, totalsResponse, branchesResponse, losResponse] = await Promise.all([
        api.request<{ metrics: MetricsByGroup; groupedBy: string }>(`/api/metrics/query${tenantQueryParam}`, {
          method: 'POST',
          body: JSON.stringify({ ...requestBody, groupBy: 'branch' })
        }),
        api.request<{ metrics: MetricsByGroup; groupedBy: string }>(`/api/metrics/query${tenantQueryParam}`, {
          method: 'POST',
          body: JSON.stringify({ ...requestBody, groupBy: 'loan_officer' })
        }),
        api.request<{ metrics: Record<string, MetricResult> }>(`/api/metrics/query${tenantQueryParam}`, {
          method: 'POST',
          body: JSON.stringify(requestBody)
        }),
        api.request<{ values: string[] }>(`/api/loans/distinct-values/branch${tenantQueryParam}`),
        api.request<{ values: string[] }>(`/api/loans/distinct-values/loan_officer${tenantQueryParam}`)
      ]);

      const byBranch = transformGroupedToRows(groupedByBranchResponse.metrics);
      const byLoanOfficer = transformGroupedToRows(groupedByLOResponse.metrics);
      const totals = transformTotalsResponse(totalsResponse.metrics);

      setData({
        totals,
        byBranch,
        byLoanOfficer,
        branches: branchesResponse.values || [],
        loanOfficers: losResponse.values || []
      });

    } catch (err: any) {
      console.error('[useCompanyScorecardData] Error fetching data:', err);
      setError(err.message || 'Failed to load scorecard data');
    } finally {
      setLoading(false);
    }
  }, [filters.year, filters.branch, filters.loanOfficer, filters.channel, filters.dateRange?.start, filters.dateRange?.end, filters.tenantId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { data, loading, error, refetch: fetchData };
}
