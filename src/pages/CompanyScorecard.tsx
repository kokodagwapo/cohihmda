import React, { useState, useMemo, useRef } from 'react';
import { Navigation } from '@/components/layout/Navigation';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useTheme } from '@/components/theme-provider';
import { TrendingUp, TrendingDown, BarChart3, Building2, FileText, Users, Trophy, AlertTriangle, Loader2, Maximize2 } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { useCompanyScorecardData, ScorecardFilters } from '@/hooks/useCompanyScorecardData';
import { DatePeriodPicker, useDatePeriodState, DateRange } from '@/components/ui/DatePeriodPicker';
import { useChannelStore } from '@/stores/channelStore';
import { useTenantStore } from '@/stores/tenantStore';
import { useAuth } from '@/contexts/AuthContext';
import { TopTieringSidebar } from '@/components/toptiering/TopTieringSidebar';
import { TopTieringTopBar } from '@/components/toptiering/TopTieringTopBar';
import { ExportShareMenu } from '@/components/common/ExportShareMenu';
import { CompanyScorecardDetailTable, SortKey } from '@/components/scorecard/CompanyScorecardDetailTable';
import type { ExportData } from '@/utils/exportUtils';

const CompanyScorecard = () => {
  const pageRef = useRef<HTMLDivElement>(null);
  const { theme } = useTheme();
  const isDarkMode = theme === 'dark';

  // Use the reusable date period state hook
  const { year: selectedYear, setYear: setSelectedYear, dateRange, setDateRange } = useDatePeriodState();
  
  const [selectedBranch, setSelectedBranch] = useState<string>('all');
  const [selectedApplication, setSelectedApplication] = useState<string>('all');
  const [selectedLoanOfficer, setSelectedLoanOfficer] = useState<string>('all');
  const [activeTab, setActiveTab] = useState<'summary' | 'detail'>('summary');
  const [detailActor, setDetailActor] = useState<'branch' | 'loan_officer'>('branch');
  const [detailFullscreenOpen, setDetailFullscreenOpen] = useState(false);
  const [detailPage, setDetailPage] = useState(1);
  const [detailPageSize, setDetailPageSize] = useState(10);
  const [drilldownTitle, setDrilldownTitle] = useState<string | null>(null);
  const [drilldownSortKey, setDrilldownSortKey] = useState<SortKey | undefined>(undefined);
  // Date field selector - which date to filter all metrics on
  // Default to 'application_date' to match Qlik Company Scorecard behavior (DateType={'Application'})
  const [selectedDateField, setSelectedDateField] = useState<string>('application_date');
  // Channel filter from global store (synced with header)
  const { selectedChannel } = useChannelStore();
  
  // Tenant selection from global store (persists across pages)
  const { selectedTenantId } = useTenantStore();
  const { user } = useAuth();
  
  // Get tenant_id - prefer global selection (for admins), fall back to user's tenant
  const tenantId = selectedTenantId || user?.tenant_id || null;
  
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // Date field options matching Qlik DateType values
  const dateFieldOptions = [
    { value: 'application_date', label: 'Application Date' },
    { value: 'funding_date', label: 'Funding Date' },
    { value: 'started_date', label: 'Started Date' },
    { value: 'closing_date', label: 'Closing Date' },
    { value: 'lock_date', label: 'Lock Date' },
  ];

  // Fetch data using the hook with calculated date range
  const filters: ScorecardFilters = {
    year: selectedYear,
    branch: selectedBranch,
    loanOfficer: selectedLoanOfficer,
    application: selectedApplication,
    channel: selectedChannel, // Channel filter - matches Qlik [Consolidated Channels]
    dateRange: dateRange, // Pass the calculated date range from the hook
    dateField: selectedDateField, // All metrics will filter on this date field
    tenantId: tenantId // Tenant context (admins viewing other tenants, or user's own tenant)
  };
  const { data, loading, error } = useCompanyScorecardData(filters);

  // Get display label for date period
  const getDatePeriodLabel = () => {
    const today = new Date();
    const currentYear = today.getFullYear();
    const isYTD = dateRange.end === today.toISOString().split('T')[0];
    
    if (isYTD && selectedYear === currentYear) {
      return 'Year-to-Date';
    }
    return 'Full Year';
  };

  // Transform branch data for charts
  const branchVolumeData = useMemo(() => {
    if (!data?.byBranch) return [];
    return data.byBranch.slice(0, 10).map(branch => ({
      name: branch.name.length > 10 ? branch.name.substring(0, 10) + '...' : branch.name,
      fullName: branch.name,
      volume: Math.round(branch.volume / 1000000) // Convert to millions
    }));
  }, [data?.byBranch]);

  const branchPullThroughData = useMemo(() => {
    if (!data?.byBranch) return [];
    return data.byBranch.slice(0, 10).map(branch => ({
      name: branch.name.length > 10 ? branch.name.substring(0, 10) + '...' : branch.name,
      fullName: branch.name,
      pullThrough: branch.pullThroughRate
    }));
  }, [data?.byBranch]);

  // Compute top/bottom performers
  const insights = useMemo(() => {
    if (!data?.byBranch || data.byBranch.length === 0) {
      return { topPerformer: null, needsAttention: null, fastestGrowth: null };
    }
    
    const sorted = [...data.byBranch].sort((a, b) => b.pullThroughRate - a.pullThroughRate);
    const topPerformer = sorted[0];
    const needsAttention = sorted[sorted.length - 1];
    const fastestGrowth = [...data.byBranch].sort((a, b) => b.revenue - a.revenue)[0];
    
    return { topPerformer, needsAttention, fastestGrowth };
  }, [data?.byBranch]);

  const detailRows = useMemo(() => {
    if (!data) return [];
    return detailActor === 'branch' ? (data.byBranch ?? []) : (data.byLoanOfficer ?? []);
  }, [data, detailActor]);

  const detailPageCount = Math.max(1, Math.ceil(detailRows.length / detailPageSize));
  const detailPageSafe = Math.min(detailPage, detailPageCount);
  const detailStartIndex = (detailPageSafe - 1) * detailPageSize;
  const detailEndIndex = Math.min(detailStartIndex + detailPageSize, detailRows.length);
  const detailPagedRows = detailRows.slice(detailStartIndex, detailEndIndex);

  const openDrilldown = (title: string, sortKey: SortKey, actorOverride?: 'branch' | 'loan_officer') => {
    if (actorOverride) {
      setDetailActor(actorOverride);
      setDetailPage(1);
    }
    setDrilldownTitle(title);
    setDrilldownSortKey(sortKey);
    setDetailFullscreenOpen(true);
  };

  // Compute summary table data from branch metrics
  const summaryData = useMemo(() => {
    if (!data?.totals || !data?.byBranch) {
      return null;
    }

    const t = data.totals;
    const branches = data.byBranch;
    
    // Filter out branches with no production (0 loans or 0 volume)
    // This matches Qlik behavior which only shows branches with actual activity
    const activeBranches = branches.filter(b => 
      b.totalLoansWithRespa > 0 || b.originatedLoans > 0 || b.tieringVolume > 0
    );
    
    // Sort branches by TOTAL volume for tier assignment (descending)
    // Note: Qlik uses total application volume (not originated volume) for tiering
    const sortedBranches = [...activeBranches].sort((a, b) => b.tieringVolume - a.tieringVolume);
    
    // Calculate total volume for cumulative percentage calculation (using tieringVolume = total_volume)
    const totalVolume = sortedBranches.reduce((sum, b) => sum + b.tieringVolume, 0);
    
    // Qlik Tier Calculation (from Dimensions.csv, Lines 2-72):
    // Uses RangeSum(Above(..., 1, RowNo())) which calculates cumulative % of rows ABOVE current row
    // This means tier is assigned based on cumulative volume BEFORE the current branch:
    // - Top Tier: cumulative volume of rows ABOVE <= 50% (first branch always qualifies since nothing above)
    // - Second Tier: cumulative volume of rows ABOVE > 50% and <= 80%
    // - Bottom Tier: cumulative volume of rows ABOVE > 80%
    const topTierBranches: typeof sortedBranches = [];
    const secondTierBranches: typeof sortedBranches = [];
    const bottomTierBranches: typeof sortedBranches = [];
    
    let cumulativeVolumeBefore = 0; // Cumulative volume of all branches ABOVE current
    for (const branch of sortedBranches) {
      // Calculate cumulative percentage BEFORE this branch (matches Qlik's Above() function)
      const cumulativePercentBefore = totalVolume > 0 ? cumulativeVolumeBefore / totalVolume : 0;
      
      if (cumulativePercentBefore <= 0.5) {
        topTierBranches.push(branch);
      } else if (cumulativePercentBefore <= 0.8) {
        secondTierBranches.push(branch);
      } else {
        bottomTierBranches.push(branch);
      }
      
      // Add current branch's tieringVolume AFTER tier assignment (for next iteration)
      cumulativeVolumeBefore += branch.tieringVolume;
    }

    // Helper to sum metrics for a tier
    const sumTier = (branches: typeof sortedBranches, key: keyof typeof branches[0]) => 
      branches.reduce((sum, b) => sum + (typeof b[key] === 'number' ? b[key] as number : 0), 0);

    const avgTier = (branches: typeof sortedBranches, key: keyof typeof branches[0]) => {
      if (branches.length === 0) return 0;
      return sumTier(branches, key) / branches.length;
    };

    return {
      branchCount: { 
        totals: sortedBranches.length,  // Only count active branches (with production)
        topTier: topTierBranches.length, 
        secondTier: secondTierBranches.length, 
        bottomTier: bottomTierBranches.length 
      },
      applicationsTaken: {
        units: { 
          totals: t.totalLoansWithRespa,  // Applications with RESPA (by application_date)
          topTier: sumTier(topTierBranches, 'totalLoansWithRespa'),
          secondTier: sumTier(secondTierBranches, 'totalLoansWithRespa'),
          bottomTier: sumTier(bottomTierBranches, 'totalLoansWithRespa')
        },
        volume: { 
          totals: t.totalVolume, 
          topTier: sumTier(topTierBranches, 'volume'),
          secondTier: sumTier(secondTierBranches, 'volume'),
          bottomTier: sumTier(bottomTierBranches, 'volume')
        },
        wac: { 
          totals: t.wac || 0, 
          topTier: avgTier(topTierBranches, 'wac'),
          secondTier: avgTier(secondTierBranches, 'wac'),
          bottomTier: avgTier(bottomTierBranches, 'wac')
        },
      },
      originatedTotals: {
        units: { 
          totals: t.originatedLoans, 
          topTier: sumTier(topTierBranches, 'originatedLoans'),
          secondTier: sumTier(secondTierBranches, 'originatedLoans'),
          bottomTier: sumTier(bottomTierBranches, 'originatedLoans')
        },
        unitsPercent: { 
          totals: t.totalLoansWithRespa > 0 ? (t.originatedLoans / t.totalLoansWithRespa) * 100 : 0, 
          topTier: sumTier(topTierBranches, 'totalLoansWithRespa') > 0 ? (sumTier(topTierBranches, 'originatedLoans') / sumTier(topTierBranches, 'totalLoansWithRespa')) * 100 : 0,
          secondTier: sumTier(secondTierBranches, 'totalLoansWithRespa') > 0 ? (sumTier(secondTierBranches, 'originatedLoans') / sumTier(secondTierBranches, 'totalLoansWithRespa')) * 100 : 0,
          bottomTier: sumTier(bottomTierBranches, 'totalLoansWithRespa') > 0 ? (sumTier(bottomTierBranches, 'originatedLoans') / sumTier(bottomTierBranches, 'totalLoansWithRespa')) * 100 : 0
        },
        volume: { 
          totals: t.originatedVolume, // Originated volume - matches Qlik CompanyScorecard_Originated Volume $
          topTier: sumTier(topTierBranches, 'volume'),
          secondTier: sumTier(secondTierBranches, 'volume'),
          bottomTier: sumTier(bottomTierBranches, 'volume')
        },
        revenue: { 
          totals: t.originatedRevenue, // Originated revenue - matches Qlik CompanyScorecard_Originated Revenue $
          topTier: sumTier(topTierBranches, 'revenue'),
          secondTier: sumTier(secondTierBranches, 'revenue'),
          bottomTier: sumTier(bottomTierBranches, 'revenue')
        },
        govtUnits: { 
          totals: t.govtUnits, 
          topTier: sumTier(topTierBranches, 'govtUnits'),
          secondTier: sumTier(secondTierBranches, 'govtUnits'),
          bottomTier: sumTier(bottomTierBranches, 'govtUnits')
        },
        govtUnitsPercent: { 
          totals: t.originatedLoans > 0 ? (t.govtUnits / t.originatedLoans) * 100 : 0, 
          topTier: sumTier(topTierBranches, 'originatedLoans') > 0 ? (sumTier(topTierBranches, 'govtUnits') / sumTier(topTierBranches, 'originatedLoans')) * 100 : 0,
          secondTier: sumTier(secondTierBranches, 'originatedLoans') > 0 ? (sumTier(secondTierBranches, 'govtUnits') / sumTier(secondTierBranches, 'originatedLoans')) * 100 : 0,
          bottomTier: sumTier(bottomTierBranches, 'originatedLoans') > 0 ? (sumTier(bottomTierBranches, 'govtUnits') / sumTier(bottomTierBranches, 'originatedLoans')) * 100 : 0
        },
        purchaseUnits: { 
          totals: t.purchaseUnits, 
          topTier: sumTier(topTierBranches, 'purchaseUnits'),
          secondTier: sumTier(secondTierBranches, 'purchaseUnits'),
          bottomTier: sumTier(bottomTierBranches, 'purchaseUnits')
        },
        purchaseUnitsPercent: { 
          totals: t.originatedLoans > 0 ? (t.purchaseUnits / t.originatedLoans) * 100 : 0, 
          topTier: sumTier(topTierBranches, 'originatedLoans') > 0 ? (sumTier(topTierBranches, 'purchaseUnits') / sumTier(topTierBranches, 'originatedLoans')) * 100 : 0,
          secondTier: sumTier(secondTierBranches, 'originatedLoans') > 0 ? (sumTier(secondTierBranches, 'purchaseUnits') / sumTier(secondTierBranches, 'originatedLoans')) * 100 : 0,
          bottomTier: sumTier(bottomTierBranches, 'originatedLoans') > 0 ? (sumTier(bottomTierBranches, 'purchaseUnits') / sumTier(bottomTierBranches, 'originatedLoans')) * 100 : 0
        },
        wac: { 
          totals: t.wac || 0, 
          topTier: avgTier(topTierBranches, 'wac'),
          secondTier: avgTier(secondTierBranches, 'wac'),
          bottomTier: avgTier(bottomTierBranches, 'wac')
        },
        waFico: { 
          totals: t.waFico || 0, 
          topTier: avgTier(topTierBranches, 'waFico'),
          secondTier: avgTier(secondTierBranches, 'waFico'),
          bottomTier: avgTier(bottomTierBranches, 'waFico')
        },
        waLtv: { 
          totals: t.waLtv || 0, 
          topTier: avgTier(topTierBranches, 'waLtv'),
          secondTier: avgTier(secondTierBranches, 'waLtv'),
          bottomTier: avgTier(bottomTierBranches, 'waLtv')
        },
        waDti: { 
          totals: t.waDti || 0, 
          topTier: avgTier(topTierBranches, 'waDti'),
          secondTier: avgTier(secondTierBranches, 'waDti'),
          bottomTier: avgTier(bottomTierBranches, 'waDti')
        },
      },
      withdrawnTotals: {
        units: { 
          totals: t.falloutWithdrawn, 
          topTier: sumTier(topTierBranches, 'falloutWithdrawn'),
          secondTier: sumTier(secondTierBranches, 'falloutWithdrawn'),
          bottomTier: sumTier(bottomTierBranches, 'falloutWithdrawn')
        },
        unitsPercent: { 
          totals: t.totalLoansWithRespa > 0 ? (t.falloutWithdrawn / t.totalLoansWithRespa) * 100 : 0, 
          topTier: sumTier(topTierBranches, 'totalLoansWithRespa') > 0 ? (sumTier(topTierBranches, 'falloutWithdrawn') / sumTier(topTierBranches, 'totalLoansWithRespa')) * 100 : 0,
          secondTier: sumTier(secondTierBranches, 'totalLoansWithRespa') > 0 ? (sumTier(secondTierBranches, 'falloutWithdrawn') / sumTier(secondTierBranches, 'totalLoansWithRespa')) * 100 : 0,
          bottomTier: sumTier(bottomTierBranches, 'totalLoansWithRespa') > 0 ? (sumTier(bottomTierBranches, 'falloutWithdrawn') / sumTier(bottomTierBranches, 'totalLoansWithRespa')) * 100 : 0
        },
        // Withdrawn $ (volume)
        volume: {
          totals: t.withdrawnVolume,
          topTier: sumTier(topTierBranches, 'withdrawnVolume'),
          secondTier: sumTier(secondTierBranches, 'withdrawnVolume'),
          bottomTier: sumTier(bottomTierBranches, 'withdrawnVolume')
        },
        // W/D ProForma Revenue
        proformaRevenue: {
          totals: t.withdrawnProformaRevenue,
          topTier: sumTier(topTierBranches, 'withdrawnProformaRevenue'),
          secondTier: sumTier(secondTierBranches, 'withdrawnProformaRevenue'),
          bottomTier: sumTier(bottomTierBranches, 'withdrawnProformaRevenue')
        },
      },
      deniedUnits: {
        units: { 
          totals: t.falloutDenied, 
          topTier: sumTier(topTierBranches, 'falloutDenied'),
          secondTier: sumTier(secondTierBranches, 'falloutDenied'),
          bottomTier: sumTier(bottomTierBranches, 'falloutDenied')
        },
        unitsPercent: { 
          totals: t.totalLoansWithRespa > 0 ? (t.falloutDenied / t.totalLoansWithRespa) * 100 : 0, 
          topTier: sumTier(topTierBranches, 'totalLoansWithRespa') > 0 ? (sumTier(topTierBranches, 'falloutDenied') / sumTier(topTierBranches, 'totalLoansWithRespa')) * 100 : 0,
          secondTier: sumTier(secondTierBranches, 'totalLoansWithRespa') > 0 ? (sumTier(secondTierBranches, 'falloutDenied') / sumTier(secondTierBranches, 'totalLoansWithRespa')) * 100 : 0,
          bottomTier: sumTier(bottomTierBranches, 'totalLoansWithRespa') > 0 ? (sumTier(bottomTierBranches, 'falloutDenied') / sumTier(bottomTierBranches, 'totalLoansWithRespa')) * 100 : 0
        },
        // Denied $ (volume)
        volume: {
          totals: t.deniedVolume,
          topTier: sumTier(topTierBranches, 'deniedVolume'),
          secondTier: sumTier(secondTierBranches, 'deniedVolume'),
          bottomTier: sumTier(bottomTierBranches, 'deniedVolume')
        },
      },
    };
  }, [data]);

  const formatCurrency = (value: number) => {
    if (value >= 1000000) {
      return `$${(value / 1000000).toFixed(1)}M`;
    }
    return `$${(value / 1000).toFixed(0)}K`;
  };

  const formatNumber = (num: number) => num.toLocaleString('en-US');

  const formatLargeNumber = (num: number) => {
    if (num >= 1000000) {
      return `$${(num / 1000000).toFixed(1)}M`;
    }
    return `$${num.toLocaleString()}`;
  };

  // Loading state
  if (loading) {
    return (
      <div className={`min-h-screen ${isDarkMode ? 'bg-slate-900' : 'bg-gradient-to-br from-blue-50/30 via-white to-blue-50/20'}`}>
        <Navigation />
        <main className="flex items-center justify-center min-h-[60vh]">
          <div className="flex flex-col items-center gap-4">
            <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
            <p className="text-slate-600 dark:text-slate-400">Loading scorecard data...</p>
          </div>
        </main>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className={`min-h-screen ${isDarkMode ? 'bg-slate-900' : 'bg-gradient-to-br from-blue-50/30 via-white to-blue-50/20'}`}>
        <Navigation />
        <main className="flex items-center justify-center min-h-[60vh]">
          <Card className="p-6 max-w-md">
            <div className="flex flex-col items-center gap-4 text-center">
              <AlertTriangle className="h-8 w-8 text-red-500" />
              <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Error Loading Data</h3>
              <p className="text-slate-600 dark:text-slate-400">{error}</p>
              <Button onClick={() => window.location.reload()}>Retry</Button>
            </div>
          </Card>
        </main>
      </div>
    );
  }

  const kpiData = data?.totals || {
    loansStarted: 0,
    totalLoansWithRespa: 0,  // Applications with RESPA - main "Total Loans" KPI
    originatedLoans: 0,
    totalVolume: 0,
    originatedVolume: 0,     // Volume for originated loans only
    fundedVolume: 0,
    totalRevenue: 0,
    originatedRevenue: 0,    // Revenue for originated loans only
    pullThroughRate: 0,
    avgCycleTime: 0,
    creditPulls: 0
  };
  const averageLoanSize = kpiData.totalLoansWithRespa > 0
    ? kpiData.totalVolume / kpiData.totalLoansWithRespa
    : 0;

  const getExportData = (): ExportData => ({
    title: "Company Scorecard",
    tables: [
      {
        name: "KPIs",
        headers: ["Metric", "Value"],
        rows: [
          ["Total Loans", kpiData.totalLoansWithRespa],
          ["Total Volume", formatCurrency(kpiData.totalVolume)],
          ["Total Revenue", formatCurrency(kpiData.totalRevenue)],
          ["Pull-Through Rate", `${kpiData.pullThroughRate.toFixed(1)}%`],
          ["Avg Cycle Time", `${Math.round(kpiData.avgCycleTime)}d`],
          ["Credit Pulls", kpiData.creditPulls],
        ],
      },
      ...(summaryData
        ? [
            {
              name: "Branch Counts",
              headers: ["Tier", "Count"],
              rows: [
                ["Total", summaryData.branchCount.totals],
                ["Top Tier", summaryData.branchCount.topTier],
                ["Second Tier", summaryData.branchCount.secondTier],
                ["Bottom Tier", summaryData.branchCount.bottomTier],
              ],
            },
          ]
        : []),
    ],
  });

  const renderHeaderSection = (compact = false) => (
    <div className={compact ? "mb-4 space-y-4" : "mb-4"}>
      <div className={`flex ${compact ? 'flex-col items-start gap-3' : 'items-center justify-between mb-4'}`}>
        <div>
          <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-1">Company Scorecard</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">{getDatePeriodLabel()} Performance ({selectedYear})</p>
        </div>
        <div className={`flex items-center gap-3 flex-wrap ${compact ? 'w-full' : ''}`}>
          <DatePeriodPicker
            year={selectedYear}
            onYearChange={setSelectedYear}
            onDateRangeChange={setDateRange}
            yearsToShow={4}
            size="default"
          />

          <Select value={selectedDateField} onValueChange={setSelectedDateField}>
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="Date Type" />
            </SelectTrigger>
            <SelectContent>
              {dateFieldOptions.map(option => (
                <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="h-6 w-px bg-slate-300 dark:bg-slate-600 hidden sm:block" />

          <Select value={selectedBranch} onValueChange={setSelectedBranch}>
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="Branch" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Branches</SelectItem>
              {data?.branches.map(branch => (
                <SelectItem key={branch} value={branch}>{branch}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={selectedLoanOfficer} onValueChange={setSelectedLoanOfficer}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Loan Officer" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Loan Officers</SelectItem>
              {data?.loanOfficers.map(lo => (
                <SelectItem key={lo} value={lo}>{lo}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <ExportShareMenu
            title="Company Scorecard"
            targetRef={pageRef}
            getExportData={getExportData}
            shareTarget={{
              type: "company-scorecard",
              label: "Company Scorecard",
            }}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-7 gap-3">
        <Card
          role="button"
          tabIndex={0}
          onClick={() => openDrilldown('Units (Applications Taken)', 'applicationsTaken')}
          className={`cursor-pointer rounded-xl backdrop-blur-sm transition hover:-translate-y-0.5 ${isDarkMode ? 'border-slate-700/50 bg-slate-800/70 shadow-[0_8px_24px_rgba(0,0,0,0.3)]' : 'border-blue-200/40 bg-white shadow-[0_8px_24px_rgba(59,130,246,0.08)]'}`}
        >
          <CardContent className="pt-6">
            <p className="text-xs text-slate-600 dark:text-slate-400 mb-2">UNITS</p>
            <p className="text-2xl font-bold text-slate-900 dark:text-white">{formatNumber(kpiData.totalLoansWithRespa)}</p>
          </CardContent>
        </Card>

        <Card
          role="button"
          tabIndex={0}
          onClick={() => openDrilldown('Volume (Applications Taken $)', 'applicationsTakenDollar')}
          className={`cursor-pointer rounded-xl backdrop-blur-sm transition hover:-translate-y-0.5 ${isDarkMode ? 'border-slate-700/50 bg-slate-800/70 shadow-[0_8px_24px_rgba(0,0,0,0.3)]' : 'border-blue-200/40 bg-white shadow-[0_8px_24px_rgba(59,130,246,0.08)]'}`}
        >
          <CardContent className="pt-6">
            <p className="text-xs text-slate-600 dark:text-slate-400 mb-2">VOLUME</p>
            <p className="text-2xl font-bold text-slate-900 dark:text-white">{formatCurrency(kpiData.totalVolume)}</p>
          </CardContent>
        </Card>

        <Card
          role="button"
          tabIndex={0}
          onClick={() => openDrilldown('Average Loan Size', 'avgLoanSize')}
          className={`cursor-pointer rounded-xl backdrop-blur-sm transition hover:-translate-y-0.5 ${isDarkMode ? 'border-slate-700/50 bg-slate-800/70 shadow-[0_8px_24px_rgba(0,0,0,0.3)]' : 'border-blue-200/40 bg-white shadow-[0_8px_24px_rgba(59,130,246,0.08)]'}`}
        >
          <CardContent className="pt-6">
            <p className="text-xs text-slate-600 dark:text-slate-400 mb-2">AVERAGE LOAN SIZE</p>
            <p className="text-2xl font-bold text-slate-900 dark:text-white">{formatNumber(Math.round(averageLoanSize))}</p>
          </CardContent>
        </Card>

        <Card
          role="button"
          tabIndex={0}
          onClick={() => openDrilldown('WAC', 'wac')}
          className={`cursor-pointer rounded-xl backdrop-blur-sm transition hover:-translate-y-0.5 ${isDarkMode ? 'border-slate-700/50 bg-slate-800/70 shadow-[0_8px_24px_rgba(0,0,0,0.3)]' : 'border-blue-200/40 bg-white shadow-[0_8px_24px_rgba(59,130,246,0.08)]'}`}
        >
          <CardContent className="pt-6">
            <p className="text-xs text-slate-600 dark:text-slate-400 mb-2">WAC</p>
            <p className="text-2xl font-bold text-slate-900 dark:text-white">{kpiData.wac.toFixed(3)}</p>
          </CardContent>
        </Card>

        <Card
          role="button"
          tabIndex={0}
          onClick={() => openDrilldown('WA FICO', 'waFico')}
          className={`cursor-pointer rounded-xl backdrop-blur-sm transition hover:-translate-y-0.5 ${isDarkMode ? 'border-slate-700/50 bg-slate-800/70 shadow-[0_8px_24px_rgba(0,0,0,0.3)]' : 'border-blue-200/40 bg-white shadow-[0_8px_24px_rgba(59,130,246,0.08)]'}`}
        >
          <CardContent className="pt-6">
            <p className="text-xs text-slate-600 dark:text-slate-400 mb-2">WA FICO</p>
            <p className="text-2xl font-bold text-slate-900 dark:text-white">{Math.round(kpiData.waFico || 0)}</p>
          </CardContent>
        </Card>

        <Card
          role="button"
          tabIndex={0}
          onClick={() => openDrilldown('WA LTV', 'waLtv')}
          className={`cursor-pointer rounded-xl backdrop-blur-sm transition hover:-translate-y-0.5 ${isDarkMode ? 'border-slate-700/50 bg-slate-800/70 shadow-[0_8px_24px_rgba(0,0,0,0.3)]' : 'border-blue-200/40 bg-white shadow-[0_8px_24px_rgba(59,130,246,0.08)]'}`}
        >
          <CardContent className="pt-6">
            <p className="text-xs text-slate-600 dark:text-slate-400 mb-2">WA LTV</p>
            <p className="text-2xl font-bold text-slate-900 dark:text-white">{(kpiData.waLtv || 0).toFixed(1)}</p>
          </CardContent>
        </Card>

        <Card
          role="button"
          tabIndex={0}
          onClick={() => openDrilldown('WA DTI', 'waDti')}
          className={`cursor-pointer rounded-xl backdrop-blur-sm transition hover:-translate-y-0.5 ${isDarkMode ? 'border-slate-700/50 bg-slate-800/70 shadow-[0_8px_24px_rgba(0,0,0,0.3)]' : 'border-blue-200/40 bg-white shadow-[0_8px_24px_rgba(59,130,246,0.08)]'}`}
        >
          <CardContent className="pt-6">
            <p className="text-xs text-slate-600 dark:text-slate-400 mb-2">WA DTI</p>
            <p className="text-2xl font-bold text-slate-900 dark:text-white">{(kpiData.waDti || 0).toFixed(1)}</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );

  const SummaryTable = () => (
    <Card className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden dark:bg-slate-800 dark:border-slate-700">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className={`border-b-2 ${isDarkMode ? 'border-slate-700' : 'border-slate-300'}`}>
              <th className={`text-left py-3 px-4 text-sm font-medium sticky left-0 ${isDarkMode ? 'bg-slate-800/90 text-slate-400 border-r border-slate-700' : 'bg-slate-50/90 text-slate-600 border-r border-slate-300'}`}>
                Metric
              </th>
              <th className={`text-right py-3 px-4 text-sm font-medium ${isDarkMode ? 'text-slate-400' : 'text-slate-600'}`}>
                Totals
              </th>
              <th className="text-right py-3 px-4 text-sm font-bold bg-tier-top text-white">
                Top Tier
              </th>
              <th className="text-right py-3 px-4 text-sm font-bold bg-tier-second text-white">
                Second Tier
              </th>
              <th className="text-right py-3 px-4 text-sm font-bold bg-tier-bottom text-slate-800">
                Bottom Tier
              </th>
            </tr>
          </thead>
          <tbody>
          {/* Branch Count */}
          <tr className={`border-b transition-colors ${isDarkMode ? 'border-slate-800/50 hover:bg-slate-800/30' : 'border-slate-100 hover:bg-slate-50'}`}>
            <td className={`py-3 px-4 text-sm sticky left-0 ${isDarkMode ? 'bg-slate-800/90 text-slate-300 border-r border-slate-700' : 'bg-slate-50/90 text-slate-700 border-r border-slate-300'}`}>Branch Count</td>
            <td className={`text-right py-3 px-4 text-sm font-mono ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>{summaryData.branchCount.totals}</td>
            <td className={`text-right py-3 px-4 text-sm font-mono bg-teal-600/10 cursor-pointer hover:bg-teal-600/20 transition-colors ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>{summaryData.branchCount.topTier}</td>
            <td className={`text-right py-3 px-4 text-sm font-mono bg-emerald-500/10 cursor-pointer hover:bg-emerald-500/20 transition-colors ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>{summaryData.branchCount.secondTier}</td>
            <td className={`text-right py-3 px-4 text-sm font-mono bg-red-500/10 cursor-pointer hover:bg-red-500/20 transition-colors ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>{summaryData.branchCount.bottomTier}</td>
          </tr>

          {/* Applications Taken */}
          <tr>
            <td colSpan={5} className={`py-2 px-4 text-xs font-semibold ${isDarkMode ? 'text-slate-300 bg-slate-800/50' : 'text-slate-700 bg-slate-50'}`}>
              Applications Taken
            </td>
          </tr>
          <tr className={`border-b transition-colors ${isDarkMode ? 'border-slate-800/50 hover:bg-slate-800/30' : 'border-slate-100 hover:bg-slate-50'}`}>
            <td className={`py-3 px-4 text-sm sticky left-0 ${isDarkMode ? 'bg-slate-800/90 text-slate-300 border-r border-slate-700' : 'bg-slate-50/90 text-slate-700 border-r border-slate-300'}`}>Units</td>
            <td className={`text-right py-3 px-4 text-sm font-mono ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>{formatNumber(summaryData.applicationsTaken.units.totals)}</td>
            <td className={`text-right py-3 px-4 text-sm font-mono bg-teal-600/10 cursor-pointer hover:bg-teal-600/20 transition-colors ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>{formatNumber(summaryData.applicationsTaken.units.topTier)}</td>
            <td className={`text-right py-3 px-4 text-sm font-mono bg-emerald-500/10 cursor-pointer hover:bg-emerald-500/20 transition-colors ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>{formatNumber(summaryData.applicationsTaken.units.secondTier)}</td>
            <td className={`text-right py-3 px-4 text-sm font-mono bg-red-500/10 cursor-pointer hover:bg-red-500/20 transition-colors ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>{formatNumber(summaryData.applicationsTaken.units.bottomTier)}</td>
          </tr>
          <tr className={`border-b transition-colors ${isDarkMode ? 'border-slate-800/50 hover:bg-slate-800/30' : 'border-slate-100 hover:bg-slate-50'}`}>
            <td className={`py-3 px-4 text-sm sticky left-0 ${isDarkMode ? 'bg-slate-800/90 text-slate-300 border-r border-slate-700' : 'bg-slate-50/90 text-slate-700 border-r border-slate-300'}`}>Volume</td>
            <td className={`text-right py-3 px-4 text-sm font-mono ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>{formatLargeNumber(summaryData.applicationsTaken.volume.totals)}</td>
            <td className={`text-right py-3 px-4 text-sm font-mono bg-teal-600/10 cursor-pointer hover:bg-teal-600/20 transition-colors ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>{formatLargeNumber(summaryData.applicationsTaken.volume.topTier)}</td>
            <td className={`text-right py-3 px-4 text-sm font-mono bg-emerald-500/10 cursor-pointer hover:bg-emerald-500/20 transition-colors ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>{formatLargeNumber(summaryData.applicationsTaken.volume.secondTier)}</td>
            <td className={`text-right py-3 px-4 text-sm font-mono bg-red-500/10 cursor-pointer hover:bg-red-500/20 transition-colors ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>{formatLargeNumber(summaryData.applicationsTaken.volume.bottomTier)}</td>
          </tr>
          <tr className={`border-b transition-colors ${isDarkMode ? 'border-slate-800/50 hover:bg-slate-800/30' : 'border-slate-100 hover:bg-slate-50'}`}>
            <td className={`py-3 px-4 text-sm sticky left-0 ${isDarkMode ? 'bg-slate-800/90 text-slate-300 border-r border-slate-700' : 'bg-slate-50/90 text-slate-700 border-r border-slate-300'}`}>WAC</td>
            <td className={`text-right py-3 px-4 text-sm font-mono ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>{summaryData.applicationsTaken.wac.totals.toFixed(3)}</td>
            <td className={`text-right py-3 px-4 text-sm font-mono bg-teal-600/10 cursor-pointer hover:bg-teal-600/20 transition-colors ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>{summaryData.applicationsTaken.wac.topTier.toFixed(3)}</td>
            <td className={`text-right py-3 px-4 text-sm font-mono bg-emerald-500/10 cursor-pointer hover:bg-emerald-500/20 transition-colors ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>{summaryData.applicationsTaken.wac.secondTier.toFixed(3)}</td>
            <td className={`text-right py-3 px-4 text-sm font-mono bg-red-500/10 cursor-pointer hover:bg-red-500/20 transition-colors ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>{summaryData.applicationsTaken.wac.bottomTier.toFixed(3)}</td>
          </tr>

          {/* Originated Totals */}
          <tr>
            <td colSpan={5} className={`py-2 px-4 text-xs font-semibold ${isDarkMode ? 'text-slate-300 bg-slate-800/50' : 'text-slate-700 bg-slate-50'}`}>
              Originated Totals
            </td>
          </tr>
          <tr className={`border-b transition-colors ${isDarkMode ? 'border-slate-800/50 hover:bg-slate-800/30' : 'border-slate-100 hover:bg-slate-50'}`}>
            <td className={`py-3 px-4 text-sm sticky left-0 ${isDarkMode ? 'bg-slate-800/90 text-slate-300 border-r border-slate-700' : 'bg-slate-50/90 text-slate-700 border-r border-slate-300'}`}>Originated Units</td>
            <td className={`text-right py-3 px-4 text-sm font-mono ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>{formatNumber(summaryData.originatedTotals.units.totals)}</td>
            <td className={`text-right py-3 px-4 text-sm font-mono bg-teal-600/10 cursor-pointer hover:bg-teal-600/20 transition-colors ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>{formatNumber(summaryData.originatedTotals.units.topTier)}</td>
            <td className={`text-right py-3 px-4 text-sm font-mono bg-emerald-500/10 cursor-pointer hover:bg-emerald-500/20 transition-colors ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>{formatNumber(summaryData.originatedTotals.units.secondTier)}</td>
            <td className={`text-right py-3 px-4 text-sm font-mono bg-red-500/10 cursor-pointer hover:bg-red-500/20 transition-colors ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>{formatNumber(summaryData.originatedTotals.units.bottomTier)}</td>
          </tr>
          <tr className={`border-b transition-colors ${isDarkMode ? 'border-slate-800/50 hover:bg-slate-800/30' : 'border-slate-100 hover:bg-slate-50'}`}>
            <td className={`py-3 px-4 text-sm sticky left-0 ${isDarkMode ? 'bg-slate-800/90 text-slate-300 border-r border-slate-700' : 'bg-slate-50/90 text-slate-700 border-r border-slate-300'}`}>Originated Units %</td>
            <td className={`text-right py-3 px-4 text-sm font-mono ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>{summaryData.originatedTotals.unitsPercent.totals.toFixed(1)}%</td>
            <td className={`text-right py-3 px-4 text-sm font-mono bg-teal-600/10 cursor-pointer hover:bg-teal-600/20 transition-colors ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>{summaryData.originatedTotals.unitsPercent.topTier.toFixed(1)}%</td>
            <td className={`text-right py-3 px-4 text-sm font-mono bg-emerald-500/10 cursor-pointer hover:bg-emerald-500/20 transition-colors ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>{summaryData.originatedTotals.unitsPercent.secondTier.toFixed(1)}%</td>
            <td className={`text-right py-3 px-4 text-sm font-mono bg-red-500/10 cursor-pointer hover:bg-red-500/20 transition-colors ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>{summaryData.originatedTotals.unitsPercent.bottomTier.toFixed(1)}%</td>
          </tr>
          <tr className={`border-b transition-colors ${isDarkMode ? 'border-slate-800/50 hover:bg-slate-800/30' : 'border-slate-100 hover:bg-slate-50'}`}>
            <td className={`py-3 px-4 text-sm sticky left-0 ${isDarkMode ? 'bg-slate-800/90 text-slate-300 border-r border-slate-700' : 'bg-slate-50/90 text-slate-700 border-r border-slate-300'}`}>Originated Volume $</td>
            <td className={`text-right py-3 px-4 text-sm font-mono ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>{formatLargeNumber(summaryData.originatedTotals.volume.totals)}</td>
            <td className={`text-right py-3 px-4 text-sm font-mono bg-teal-600/10 cursor-pointer hover:bg-teal-600/20 transition-colors ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>{formatLargeNumber(summaryData.originatedTotals.volume.topTier)}</td>
            <td className={`text-right py-3 px-4 text-sm font-mono bg-emerald-500/10 cursor-pointer hover:bg-emerald-500/20 transition-colors ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>{formatLargeNumber(summaryData.originatedTotals.volume.secondTier)}</td>
            <td className={`text-right py-3 px-4 text-sm font-mono bg-red-500/10 cursor-pointer hover:bg-red-500/20 transition-colors ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>{formatLargeNumber(summaryData.originatedTotals.volume.bottomTier)}</td>
          </tr>
          <tr className={`border-b transition-colors ${isDarkMode ? 'border-slate-800/50 hover:bg-slate-800/30' : 'border-slate-100 hover:bg-slate-50'}`}>
            <td className={`py-3 px-4 text-sm sticky left-0 ${isDarkMode ? 'bg-slate-800/90 text-slate-300 border-r border-slate-700' : 'bg-slate-50/90 text-slate-700 border-r border-slate-300'}`}>Originated Revenue $</td>
            <td className={`text-right py-3 px-4 text-sm font-mono ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>{formatLargeNumber(summaryData.originatedTotals.revenue.totals)}</td>
            <td className={`text-right py-3 px-4 text-sm font-mono bg-teal-600/10 cursor-pointer hover:bg-teal-600/20 transition-colors ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>{formatLargeNumber(summaryData.originatedTotals.revenue.topTier)}</td>
            <td className={`text-right py-3 px-4 text-sm font-mono bg-emerald-500/10 cursor-pointer hover:bg-emerald-500/20 transition-colors ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>{formatLargeNumber(summaryData.originatedTotals.revenue.secondTier)}</td>
            <td className={`text-right py-3 px-4 text-sm font-mono bg-red-500/10 cursor-pointer hover:bg-red-500/20 transition-colors ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>{formatLargeNumber(summaryData.originatedTotals.revenue.bottomTier)}</td>
          </tr>
          <tr className={`border-b transition-colors ${isDarkMode ? 'border-slate-800/50 hover:bg-slate-800/30' : 'border-slate-100 hover:bg-slate-50'}`}>
            <td className={`py-3 px-4 text-sm sticky left-0 ${isDarkMode ? 'bg-slate-800/90 text-slate-300 border-r border-slate-700' : 'bg-slate-50/90 text-slate-700 border-r border-slate-300'}`}>Gov't Originated Units</td>
            <td className={`text-right py-3 px-4 text-sm font-mono ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>{formatNumber(summaryData.originatedTotals.govtUnits.totals)}</td>
            <td className={`text-right py-3 px-4 text-sm font-mono bg-teal-600/10 cursor-pointer hover:bg-teal-600/20 transition-colors ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>{formatNumber(summaryData.originatedTotals.govtUnits.topTier)}</td>
            <td className={`text-right py-3 px-4 text-sm font-mono bg-emerald-500/10 cursor-pointer hover:bg-emerald-500/20 transition-colors ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>{formatNumber(summaryData.originatedTotals.govtUnits.secondTier)}</td>
            <td className={`text-right py-3 px-4 text-sm font-mono bg-red-500/10 cursor-pointer hover:bg-red-500/20 transition-colors ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>{formatNumber(summaryData.originatedTotals.govtUnits.bottomTier)}</td>
          </tr>
          <tr className={`border-b transition-colors ${isDarkMode ? 'border-slate-800/50 hover:bg-slate-800/30' : 'border-slate-100 hover:bg-slate-50'}`}>
            <td className={`py-3 px-4 text-sm sticky left-0 ${isDarkMode ? 'bg-slate-800/90 text-slate-300 border-r border-slate-700' : 'bg-slate-50/90 text-slate-700 border-r border-slate-300'}`}>Gov't Originated Units %</td>
            <td className={`text-right py-3 px-4 text-sm font-mono ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>{summaryData.originatedTotals.govtUnitsPercent.totals.toFixed(1)}%</td>
            <td className={`text-right py-3 px-4 text-sm font-mono bg-teal-600/10 cursor-pointer hover:bg-teal-600/20 transition-colors ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>{summaryData.originatedTotals.govtUnitsPercent.topTier.toFixed(1)}%</td>
            <td className={`text-right py-3 px-4 text-sm font-mono bg-emerald-500/10 cursor-pointer hover:bg-emerald-500/20 transition-colors ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>{summaryData.originatedTotals.govtUnitsPercent.secondTier.toFixed(1)}%</td>
            <td className={`text-right py-3 px-4 text-sm font-mono bg-red-500/10 cursor-pointer hover:bg-red-500/20 transition-colors ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>{summaryData.originatedTotals.govtUnitsPercent.bottomTier.toFixed(1)}%</td>
          </tr>
          <tr className={`border-b transition-colors ${isDarkMode ? 'border-slate-800/50 hover:bg-slate-800/30' : 'border-slate-100 hover:bg-slate-50'}`}>
            <td className={`py-3 px-4 text-sm sticky left-0 ${isDarkMode ? 'bg-slate-800/90 text-slate-300 border-r border-slate-700' : 'bg-slate-50/90 text-slate-700 border-r border-slate-300'}`}>Purchase Originated Units</td>
            <td className={`text-right py-3 px-4 text-sm font-mono ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>{formatNumber(summaryData.originatedTotals.purchaseUnits.totals)}</td>
            <td className={`text-right py-3 px-4 text-sm font-mono bg-teal-600/10 cursor-pointer hover:bg-teal-600/20 transition-colors ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>{formatNumber(summaryData.originatedTotals.purchaseUnits.topTier)}</td>
            <td className={`text-right py-3 px-4 text-sm font-mono bg-emerald-500/10 cursor-pointer hover:bg-emerald-500/20 transition-colors ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>{formatNumber(summaryData.originatedTotals.purchaseUnits.secondTier)}</td>
            <td className={`text-right py-3 px-4 text-sm font-mono bg-red-500/10 cursor-pointer hover:bg-red-500/20 transition-colors ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>{formatNumber(summaryData.originatedTotals.purchaseUnits.bottomTier)}</td>
          </tr>
          <tr className={`border-b transition-colors ${isDarkMode ? 'border-slate-800/50 hover:bg-slate-800/30' : 'border-slate-100 hover:bg-slate-50'}`}>
            <td className={`py-3 px-4 text-sm sticky left-0 ${isDarkMode ? 'bg-slate-800/90 text-slate-300 border-r border-slate-700' : 'bg-slate-50/90 text-slate-700 border-r border-slate-300'}`}>Purchase Originated Units %</td>
            <td className={`text-right py-3 px-4 text-sm font-mono ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>{summaryData.originatedTotals.purchaseUnitsPercent.totals.toFixed(1)}%</td>
            <td className={`text-right py-3 px-4 text-sm font-mono bg-teal-600/10 cursor-pointer hover:bg-teal-600/20 transition-colors ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>{summaryData.originatedTotals.purchaseUnitsPercent.topTier.toFixed(1)}%</td>
            <td className={`text-right py-3 px-4 text-sm font-mono bg-emerald-500/10 cursor-pointer hover:bg-emerald-500/20 transition-colors ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>{summaryData.originatedTotals.purchaseUnitsPercent.secondTier.toFixed(1)}%</td>
            <td className={`text-right py-3 px-4 text-sm font-mono bg-red-500/10 cursor-pointer hover:bg-red-500/20 transition-colors ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>{summaryData.originatedTotals.purchaseUnitsPercent.bottomTier.toFixed(1)}%</td>
          </tr>
          <tr className={`border-b transition-colors ${isDarkMode ? 'border-slate-800/50 hover:bg-slate-800/30' : 'border-slate-100 hover:bg-slate-50'}`}>
            <td className={`py-3 px-4 text-sm sticky left-0 ${isDarkMode ? 'bg-slate-800/90 text-slate-300 border-r border-slate-700' : 'bg-slate-50/90 text-slate-700 border-r border-slate-300'}`}>Originated WAC</td>
            <td className={`text-right py-3 px-4 text-sm font-mono ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>{summaryData.originatedTotals.wac.totals.toFixed(3)}</td>
            <td className={`text-right py-3 px-4 text-sm font-mono bg-teal-600/10 cursor-pointer hover:bg-teal-600/20 transition-colors ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>{summaryData.originatedTotals.wac.topTier.toFixed(3)}</td>
            <td className={`text-right py-3 px-4 text-sm font-mono bg-emerald-500/10 cursor-pointer hover:bg-emerald-500/20 transition-colors ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>{summaryData.originatedTotals.wac.secondTier.toFixed(3)}</td>
            <td className={`text-right py-3 px-4 text-sm font-mono bg-red-500/10 cursor-pointer hover:bg-red-500/20 transition-colors ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>{summaryData.originatedTotals.wac.bottomTier.toFixed(3)}</td>
          </tr>
          <tr className={`border-b transition-colors ${isDarkMode ? 'border-slate-800/50 hover:bg-slate-800/30' : 'border-slate-100 hover:bg-slate-50'}`}>
            <td className={`py-3 px-4 text-sm sticky left-0 ${isDarkMode ? 'bg-slate-800/90 text-slate-300 border-r border-slate-700' : 'bg-slate-50/90 text-slate-700 border-r border-slate-300'}`}>Originated WA FICO</td>
            <td className={`text-right py-3 px-4 text-sm font-mono ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>{Math.round(summaryData.originatedTotals.waFico.totals)}</td>
            <td className={`text-right py-3 px-4 text-sm font-mono bg-teal-600/10 cursor-pointer hover:bg-teal-600/20 transition-colors ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>{Math.round(summaryData.originatedTotals.waFico.topTier)}</td>
            <td className={`text-right py-3 px-4 text-sm font-mono bg-emerald-500/10 cursor-pointer hover:bg-emerald-500/20 transition-colors ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>{Math.round(summaryData.originatedTotals.waFico.secondTier)}</td>
            <td className={`text-right py-3 px-4 text-sm font-mono bg-red-500/10 cursor-pointer hover:bg-red-500/20 transition-colors ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>{Math.round(summaryData.originatedTotals.waFico.bottomTier)}</td>
          </tr>
          <tr className={`border-b transition-colors ${isDarkMode ? 'border-slate-800/50 hover:bg-slate-800/30' : 'border-slate-100 hover:bg-slate-50'}`}>
            <td className={`py-3 px-4 text-sm sticky left-0 ${isDarkMode ? 'bg-slate-800/90 text-slate-300 border-r border-slate-700' : 'bg-slate-50/90 text-slate-700 border-r border-slate-300'}`}>Originated WA LTV</td>
            <td className={`text-right py-3 px-4 text-sm font-mono ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>{summaryData.originatedTotals.waLtv.totals.toFixed(1)}</td>
            <td className={`text-right py-3 px-4 text-sm font-mono bg-teal-600/10 cursor-pointer hover:bg-teal-600/20 transition-colors ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>{summaryData.originatedTotals.waLtv.topTier.toFixed(1)}</td>
            <td className={`text-right py-3 px-4 text-sm font-mono bg-emerald-500/10 cursor-pointer hover:bg-emerald-500/20 transition-colors ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>{summaryData.originatedTotals.waLtv.secondTier.toFixed(1)}</td>
            <td className={`text-right py-3 px-4 text-sm font-mono bg-red-500/10 cursor-pointer hover:bg-red-500/20 transition-colors ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>{summaryData.originatedTotals.waLtv.bottomTier.toFixed(1)}</td>
          </tr>
          <tr className={`border-b transition-colors ${isDarkMode ? 'border-slate-800/50 hover:bg-slate-800/30' : 'border-slate-100 hover:bg-slate-50'}`}>
            <td className={`py-3 px-4 text-sm sticky left-0 ${isDarkMode ? 'bg-slate-800/90 text-slate-300 border-r border-slate-700' : 'bg-slate-50/90 text-slate-700 border-r border-slate-300'}`}>Originated WA DTI</td>
            <td className={`text-right py-3 px-4 text-sm font-mono ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>{summaryData.originatedTotals.waDti.totals.toFixed(1)}</td>
            <td className={`text-right py-3 px-4 text-sm font-mono bg-teal-600/10 cursor-pointer hover:bg-teal-600/20 transition-colors ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>{summaryData.originatedTotals.waDti.topTier.toFixed(1)}</td>
            <td className={`text-right py-3 px-4 text-sm font-mono bg-emerald-500/10 cursor-pointer hover:bg-emerald-500/20 transition-colors ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>{summaryData.originatedTotals.waDti.secondTier.toFixed(1)}</td>
            <td className={`text-right py-3 px-4 text-sm font-mono bg-red-500/10 cursor-pointer hover:bg-red-500/20 transition-colors ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>{summaryData.originatedTotals.waDti.bottomTier.toFixed(1)}</td>
          </tr>

          {/* Withdrawn Totals */}
          <tr>
            <td colSpan={5} className={`py-2 px-4 text-xs font-semibold ${isDarkMode ? 'text-slate-300 bg-slate-800/50' : 'text-slate-700 bg-slate-50'}`}>
              Withdrawn Totals
            </td>
          </tr>
          <tr className={`border-b transition-colors ${isDarkMode ? 'border-slate-800/50 hover:bg-slate-800/30' : 'border-slate-100 hover:bg-slate-50'}`}>
            <td className={`py-3 px-4 text-sm sticky left-0 ${isDarkMode ? 'bg-slate-800/90 text-slate-300 border-r border-slate-700' : 'bg-slate-50/90 text-slate-700 border-r border-slate-300'}`}>Withdrawn Units</td>
            <td className={`text-right py-3 px-4 text-sm font-mono ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>{formatNumber(summaryData.withdrawnTotals.units.totals)}</td>
            <td className={`text-right py-3 px-4 text-sm font-mono bg-teal-600/10 cursor-pointer hover:bg-teal-600/20 transition-colors ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>{formatNumber(summaryData.withdrawnTotals.units.topTier)}</td>
            <td className={`text-right py-3 px-4 text-sm font-mono bg-emerald-500/10 cursor-pointer hover:bg-emerald-500/20 transition-colors ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>{formatNumber(summaryData.withdrawnTotals.units.secondTier)}</td>
            <td className={`text-right py-3 px-4 text-sm font-mono bg-red-500/10 cursor-pointer hover:bg-red-500/20 transition-colors ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>{formatNumber(summaryData.withdrawnTotals.units.bottomTier)}</td>
          </tr>
          <tr className={`border-b transition-colors ${isDarkMode ? 'border-slate-800/50 hover:bg-slate-800/30' : 'border-slate-100 hover:bg-slate-50'}`}>
            <td className={`py-3 px-4 text-sm sticky left-0 ${isDarkMode ? 'bg-slate-800/90 text-slate-300 border-r border-slate-700' : 'bg-slate-50/90 text-slate-700 border-r border-slate-300'}`}>Withdrawn Units %</td>
            <td className={`text-right py-3 px-4 text-sm font-mono ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>{summaryData.withdrawnTotals.unitsPercent.totals.toFixed(1)}%</td>
            <td className={`text-right py-3 px-4 text-sm font-mono bg-teal-600/10 cursor-pointer hover:bg-teal-600/20 transition-colors ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>{summaryData.withdrawnTotals.unitsPercent.topTier.toFixed(1)}%</td>
            <td className={`text-right py-3 px-4 text-sm font-mono bg-emerald-500/10 cursor-pointer hover:bg-emerald-500/20 transition-colors ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>{summaryData.withdrawnTotals.unitsPercent.secondTier.toFixed(1)}%</td>
            <td className={`text-right py-3 px-4 text-sm font-mono bg-red-500/10 cursor-pointer hover:bg-red-500/20 transition-colors ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>{summaryData.withdrawnTotals.unitsPercent.bottomTier.toFixed(1)}%</td>
          </tr>
          <tr className={`border-b transition-colors ${isDarkMode ? 'border-slate-800/50 hover:bg-slate-800/30' : 'border-slate-100 hover:bg-slate-50'}`}>
            <td className={`py-3 px-4 text-sm sticky left-0 ${isDarkMode ? 'bg-slate-800/90 text-slate-300 border-r border-slate-700' : 'bg-slate-50/90 text-slate-700 border-r border-slate-300'}`}>Withdrawn $</td>
            <td className={`text-right py-3 px-4 text-sm font-mono ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>{formatLargeNumber(summaryData.withdrawnTotals.volume.totals)}</td>
            <td className={`text-right py-3 px-4 text-sm font-mono bg-teal-600/10 cursor-pointer hover:bg-teal-600/20 transition-colors ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>{formatLargeNumber(summaryData.withdrawnTotals.volume.topTier)}</td>
            <td className={`text-right py-3 px-4 text-sm font-mono bg-emerald-500/10 cursor-pointer hover:bg-emerald-500/20 transition-colors ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>{formatLargeNumber(summaryData.withdrawnTotals.volume.secondTier)}</td>
            <td className={`text-right py-3 px-4 text-sm font-mono bg-red-500/10 cursor-pointer hover:bg-red-500/20 transition-colors ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>{formatLargeNumber(summaryData.withdrawnTotals.volume.bottomTier)}</td>
          </tr>
          <tr className={`border-b transition-colors ${isDarkMode ? 'border-slate-800/50 hover:bg-slate-800/30' : 'border-slate-100 hover:bg-slate-50'}`}>
            <td className={`py-3 px-4 text-sm sticky left-0 ${isDarkMode ? 'bg-slate-800/90 text-slate-300 border-r border-slate-700' : 'bg-slate-50/90 text-slate-700 border-r border-slate-300'}`}>W/D ProForma Revenue</td>
            <td className={`text-right py-3 px-4 text-sm font-mono ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>{formatLargeNumber(summaryData.withdrawnTotals.proformaRevenue.totals)}</td>
            <td className={`text-right py-3 px-4 text-sm font-mono bg-teal-600/10 cursor-pointer hover:bg-teal-600/20 transition-colors ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>{formatLargeNumber(summaryData.withdrawnTotals.proformaRevenue.topTier)}</td>
            <td className={`text-right py-3 px-4 text-sm font-mono bg-emerald-500/10 cursor-pointer hover:bg-emerald-500/20 transition-colors ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>{formatLargeNumber(summaryData.withdrawnTotals.proformaRevenue.secondTier)}</td>
            <td className={`text-right py-3 px-4 text-sm font-mono bg-red-500/10 cursor-pointer hover:bg-red-500/20 transition-colors ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>{formatLargeNumber(summaryData.withdrawnTotals.proformaRevenue.bottomTier)}</td>
          </tr>

          {/* Denied Units */}
          <tr>
            <td colSpan={5} className={`py-2 px-4 text-xs font-semibold ${isDarkMode ? 'text-slate-300 bg-slate-800/50' : 'text-slate-700 bg-slate-50'}`}>
              Denied Units
            </td>
          </tr>
          <tr className={`border-b transition-colors ${isDarkMode ? 'border-slate-800/50 hover:bg-slate-800/30' : 'border-slate-100 hover:bg-slate-50'}`}>
            <td className={`py-3 px-4 text-sm sticky left-0 ${isDarkMode ? 'bg-slate-800/90 text-slate-300 border-r border-slate-700' : 'bg-slate-50/90 text-slate-700 border-r border-slate-300'}`}>Denied Units</td>
            <td className={`text-right py-3 px-4 text-sm font-mono ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>{formatNumber(summaryData.deniedUnits.units.totals)}</td>
            <td className={`text-right py-3 px-4 text-sm font-mono bg-teal-600/10 cursor-pointer hover:bg-teal-600/20 transition-colors ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>{formatNumber(summaryData.deniedUnits.units.topTier)}</td>
            <td className={`text-right py-3 px-4 text-sm font-mono bg-emerald-500/10 cursor-pointer hover:bg-emerald-500/20 transition-colors ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>{formatNumber(summaryData.deniedUnits.units.secondTier)}</td>
            <td className={`text-right py-3 px-4 text-sm font-mono bg-red-500/10 cursor-pointer hover:bg-red-500/20 transition-colors ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>{formatNumber(summaryData.deniedUnits.units.bottomTier)}</td>
          </tr>
          <tr className={`border-b transition-colors ${isDarkMode ? 'border-slate-800/50 hover:bg-slate-800/30' : 'border-slate-100 hover:bg-slate-50'}`}>
            <td className={`py-3 px-4 text-sm sticky left-0 ${isDarkMode ? 'bg-slate-800/90 text-slate-300 border-r border-slate-700' : 'bg-slate-50/90 text-slate-700 border-r border-slate-300'}`}>Denied Units %</td>
            <td className={`text-right py-3 px-4 text-sm font-mono ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>{summaryData.deniedUnits.unitsPercent.totals.toFixed(1)}%</td>
            <td className={`text-right py-3 px-4 text-sm font-mono bg-teal-600/10 cursor-pointer hover:bg-teal-600/20 transition-colors ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>{summaryData.deniedUnits.unitsPercent.topTier.toFixed(1)}%</td>
            <td className={`text-right py-3 px-4 text-sm font-mono bg-emerald-500/10 cursor-pointer hover:bg-emerald-500/20 transition-colors ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>{summaryData.deniedUnits.unitsPercent.secondTier.toFixed(1)}%</td>
            <td className={`text-right py-3 px-4 text-sm font-mono bg-red-500/10 cursor-pointer hover:bg-red-500/20 transition-colors ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>{summaryData.deniedUnits.unitsPercent.bottomTier.toFixed(1)}%</td>
          </tr>
          <tr className={`border-b transition-colors ${isDarkMode ? 'border-slate-800/50 hover:bg-slate-800/30' : 'border-slate-100 hover:bg-slate-50'}`}>
            <td className={`py-3 px-4 text-sm sticky left-0 ${isDarkMode ? 'bg-slate-800/90 text-slate-300 border-r border-slate-700' : 'bg-slate-50/90 text-slate-700 border-r border-slate-300'}`}>Denied $</td>
            <td className={`text-right py-3 px-4 text-sm font-mono ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>{formatLargeNumber(summaryData.deniedUnits.volume.totals)}</td>
            <td className={`text-right py-3 px-4 text-sm font-mono bg-teal-600/10 cursor-pointer hover:bg-teal-600/20 transition-colors ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>{formatLargeNumber(summaryData.deniedUnits.volume.topTier)}</td>
            <td className={`text-right py-3 px-4 text-sm font-mono bg-emerald-500/10 cursor-pointer hover:bg-emerald-500/20 transition-colors ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>{formatLargeNumber(summaryData.deniedUnits.volume.secondTier)}</td>
            <td className={`text-right py-3 px-4 text-sm font-mono bg-red-500/10 cursor-pointer hover:bg-red-500/20 transition-colors ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>{formatLargeNumber(summaryData.deniedUnits.volume.bottomTier)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </Card>
  );

  return (
    <div
      ref={pageRef}
      className={`min-h-screen ${isDarkMode ? 'bg-slate-900' : 'bg-gradient-to-br from-blue-50/30 via-white to-blue-50/20 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950/50'}`}
    >
      <Navigation />
      
      {/* Background pattern */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(59,130,246,0.03),transparent_50%),radial-gradient(circle_at_80%_80%,rgba(168,85,247,0.02),transparent_50%)] pointer-events-none" />

      <div className="flex pt-14 sm:pt-16 min-h-screen relative">
        <TopTieringSidebar
          sidebarOpen={sidebarOpen}
          onSidebarOpenChange={setSidebarOpen}
          sidebarCollapsed={sidebarCollapsed}
          onSidebarCollapsedChange={setSidebarCollapsed}
        />
        <div className="flex-1 flex flex-col min-w-0">
          <TopTieringTopBar title="Company Scorecard" onOpenSidebar={() => setSidebarOpen(true)} />

      <main className="relative flex-1 overflow-y-auto px-4 sm:px-6 py-2 sm:py-3 max-w-[1800px] mx-auto">
        {/* Header Section */}
        {renderHeaderSection()}

        {/* Charts Section removed per request */}

        {/* Tabular Data Section */}
        {summaryData && (
          <Card className={`rounded-xl backdrop-blur-sm ${isDarkMode ? 'border-slate-700/50 bg-slate-800/70 shadow-[0_8px_24px_rgba(0,0,0,0.3)]' : 'border-blue-200/40 bg-white shadow-[0_8px_24px_rgba(59,130,246,0.08)]'}`}>
            <CardHeader>
              <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'summary' | 'detail')}>
                <TabsList>
                  <TabsTrigger value="summary">Summary</TabsTrigger>
                  <TabsTrigger value="detail">Detail</TabsTrigger>
                </TabsList>
              </Tabs>
            </CardHeader>
            <CardContent>
              <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'summary' | 'detail')}>
                <TabsContent value="summary" className="mt-0">
                  <SummaryTable />
                </TabsContent>
                <TabsContent value="detail" className="mt-0">
                    <div className="space-y-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-slate-600 dark:text-slate-400">Choose Scorecard Actor</span>
                      <div className="inline-flex h-10 items-center justify-center rounded-md bg-muted p-1 text-muted-foreground">
                        <button
                          type="button"
                          onClick={() => {
                            setDetailActor('branch');
                            setDetailPage(1);
                          }}
                          className={`inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium ring-offset-background transition-all ${detailActor === 'branch' ? 'bg-background text-foreground shadow' : ''}`}
                        >
                          Branch
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setDetailActor('loan_officer');
                            setDetailPage(1);
                          }}
                          className={`inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium ring-offset-background transition-all ${detailActor === 'loan_officer' ? 'bg-background text-foreground shadow' : ''}`}
                        >
                          Loan Officer
                        </button>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setDetailFullscreenOpen(true)}
                        className="h-9"
                      >
                        <Maximize2 className="h-4 w-4 mr-2" />
                        Fullscreen
                      </Button>
                      <span className="text-xs text-slate-500 dark:text-slate-400">
                        Company Scorecard by {detailActor === 'branch' ? 'Branch' : 'Loan Officer'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-slate-500 dark:text-slate-400">Rows per page</span>
                        <Select
                          value={String(detailPageSize)}
                          onValueChange={(value) => {
                            setDetailPageSize(Number(value));
                            setDetailPage(1);
                          }}
                        >
                          <SelectTrigger className="h-8 w-[90px] text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="5">5</SelectItem>
                            <SelectItem value="10">10</SelectItem>
                            <SelectItem value="15">15</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                        <span>
                          {detailRows.length === 0
                            ? '0'
                            : `${detailStartIndex + 1}-${detailEndIndex}`} of {detailRows.length}
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-8 px-2"
                          disabled={detailPageSafe <= 1}
                          onClick={() => setDetailPage(detailPageSafe - 1)}
                        >
                          Prev
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-8 px-2"
                          disabled={detailPageSafe >= detailPageCount}
                          onClick={() => setDetailPage(detailPageSafe + 1)}
                        >
                          Next
                        </Button>
                      </div>
                    </div>
                    {data?.totals && (
                      <CompanyScorecardDetailTable
                        rows={detailPagedRows}
                        totals={data.totals}
                        actor={detailActor}
                        isDarkMode={isDarkMode}
                        formatNumber={formatNumber}
                        formatLargeNumber={formatLargeNumber}
                      />
                    )}
                    <Dialog
                      open={detailFullscreenOpen}
                      onOpenChange={(open) => {
                        setDetailFullscreenOpen(open);
                        if (!open) {
                          setDrilldownTitle(null);
                          setDrilldownSortKey(undefined);
                        }
                      }}
                    >
                      <DialogContent className="!fixed !inset-0 !left-0 !top-0 !right-0 !bottom-0 !translate-x-0 !translate-y-0 !max-w-none !max-h-none w-screen h-screen rounded-none border-0 p-4 sm:p-6 gap-4 overflow-hidden">
                        {renderHeaderSection(true)}
                        <DialogHeader className="items-start">
                          <DialogTitle className="text-lg sm:text-xl">{drilldownTitle || 'Company Scorecard Detail'}</DialogTitle>
                        </DialogHeader>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium text-slate-600 dark:text-slate-400">Choose Scorecard Actor</span>
                          <div className="inline-flex h-10 items-center justify-center rounded-md bg-muted p-1 text-muted-foreground">
                            <button
                              type="button"
                              onClick={() => {
                                setDetailActor('branch');
                                setDetailPage(1);
                              }}
                              className={`inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium ring-offset-background transition-all ${detailActor === 'branch' ? 'bg-background text-foreground shadow' : ''}`}
                            >
                              Branch
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setDetailActor('loan_officer');
                                setDetailPage(1);
                              }}
                              className={`inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium ring-offset-background transition-all ${detailActor === 'loan_officer' ? 'bg-background text-foreground shadow' : ''}`}
                            >
                              Loan Officer
                            </button>
                          </div>
                          <span className="text-xs text-slate-500 dark:text-slate-400">
                            Company Scorecard by {detailActor === 'branch' ? 'Branch' : 'Loan Officer'}
                          </span>
                        </div>
                        <div className="flex-1 overflow-auto">
                          {data?.totals && (
                            <CompanyScorecardDetailTable
                              rows={detailPagedRows}
                              totals={data.totals}
                              actor={detailActor}
                              isDarkMode={isDarkMode}
                              formatNumber={formatNumber}
                              formatLargeNumber={formatLargeNumber}
                              containerClassName="h-full"
                              initialSortKey={drilldownSortKey}
                            />
                          )}
                        </div>
                      </DialogContent>
                    </Dialog>
                  </div>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        )}

        {/* Footer Insights */}
        <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
          <Card className={`rounded-xl backdrop-blur-sm ${isDarkMode ? 'border-slate-700/50 bg-slate-800/70 shadow-[0_8px_24px_rgba(0,0,0,0.3)]' : 'border-blue-200/40 bg-white shadow-[0_8px_24px_rgba(59,130,246,0.08)]'}`}>
            <CardContent className="pt-6">
              <div className="flex items-center gap-2 mb-2">
                <Trophy className="h-5 w-5 text-amber-500" />
                <p className="text-sm font-semibold text-slate-900 dark:text-white">Top Performer</p>
              </div>
              {insights.topPerformer ? (
                <>
                  <p className="text-lg font-bold text-slate-900 dark:text-white">{insights.topPerformer.name}</p>
                  <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                    {insights.topPerformer.pullThroughRate.toFixed(1)}% pull-through - {formatCurrency(insights.topPerformer.revenue)} revenue
                  </p>
                </>
              ) : (
                <p className="text-sm text-slate-500">No data available</p>
              )}
            </CardContent>
          </Card>

          <Card className={`rounded-xl backdrop-blur-sm ${isDarkMode ? 'border-slate-700/50 bg-slate-800/70 shadow-[0_8px_24px_rgba(0,0,0,0.3)]' : 'border-blue-200/40 bg-white shadow-[0_8px_24px_rgba(59,130,246,0.08)]'}`}>
            <CardContent className="pt-6">
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle className="h-5 w-5 text-amber-500" />
                <p className="text-sm font-semibold text-slate-900 dark:text-white">Needs Attention</p>
              </div>
              {insights.needsAttention ? (
                <>
                  <p className="text-lg font-bold text-slate-900 dark:text-white">{insights.needsAttention.name}</p>
                  <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                    {insights.needsAttention.pullThroughRate.toFixed(1)}% pull-through - {formatNumber(insights.needsAttention.originatedLoans)} originated
                  </p>
                </>
              ) : (
                <p className="text-sm text-slate-500">No data available</p>
              )}
            </CardContent>
          </Card>

          <Card className={`rounded-xl backdrop-blur-sm ${isDarkMode ? 'border-slate-700/50 bg-slate-800/70 shadow-[0_8px_24px_rgba(0,0,0,0.3)]' : 'border-blue-200/40 bg-white shadow-[0_8px_24px_rgba(59,130,246,0.08)]'}`}>
            <CardContent className="pt-6">
              <div className="flex items-center gap-2 mb-2">
                <TrendingUp className="h-5 w-5 text-emerald-500" />
                <p className="text-sm font-semibold text-slate-900 dark:text-white">Highest Revenue</p>
              </div>
              {insights.fastestGrowth ? (
                <>
                  <p className="text-lg font-bold text-slate-900 dark:text-white">{insights.fastestGrowth.name}</p>
                  <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                    {formatCurrency(insights.fastestGrowth.revenue)} revenue - {formatNumber(insights.fastestGrowth.originatedLoans)} loans
                  </p>
                </>
              ) : (
                <p className="text-sm text-slate-500">No data available</p>
              )}
            </CardContent>
          </Card>
        </div>
      </main>
        </div>
      </div>
    </div>
  );
};

export default CompanyScorecard;
