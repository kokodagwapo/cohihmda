import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useTheme } from '@/components/theme-provider';
import { Search, BarChart3, Filter, Target, DollarSign, Users, Clock, TrendingUp, TrendingDown, Bookmark, LineChart, Loader2, AlertCircle, RefreshCw } from 'lucide-react';
import { BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip, Legend, AreaChart, Area, ComposedChart, Line } from 'recharts';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Button } from '@/components/ui/button';
import { useSalesTrendsData, type LoanOfficer as APILoanOfficer, type DrilldownData as APIDrilldownData, type DateRangeOption } from '@/hooks/useSalesTrendsData';
import { useTenantStore } from '@/stores/tenantStore';
import { useAuth } from '@/contexts/AuthContext';
import { TopTieringLayout } from '@/components/layout/TopTieringLayout';
import { TopTieringTopBar } from '@/components/layout/TopTieringTopBar';
import { DatePeriodPicker, type PeriodSelection, type PeriodPreset, computePresetDateRange } from '@/components/ui/DatePeriodPicker';

type DateRange = '3-months' | '6-months';

/** Map a PeriodPreset to Sales Trends DateRangeOption */
const mapPresetToSalesDateRange = (preset?: PeriodPreset): DateRange => {
  if (preset === 'rolling-6') return '6-months';
  return '3-months';
};
type ViewMode = 'cards' | 'tabular';

interface TrendDataPoint {
  value: number;
}

interface LoanOfficer {
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
  trendData: TrendDataPoint[];
}

interface FundTypeData {
  name: string;
  value: number;
  fill: string;
}

interface MonthlyPerformance {
  month: string;
  units: number;
  volume: number;
}

interface MonthlyDetail {
  month: string;
  closed: number;
  volume: number;
  margin: number;
  pullThrough: number;
  turnTime: number;
}

interface ContactInfo {
  email: string;
  phone: string;
  location: string;
}

interface DrilldownData {
  totalClosed: number;
  totalVolume: number;
  avgMargin: number;
  turnTime: number;
  branchRank: number;
  branchTotal: number;
  contact: ContactInfo;
  monthlyDetails: MonthlyDetail[];
  performanceTrend: {
    month: string;
    closedUnits: number;
    marginBPS: number;
  }[];
}

// Helper function to generate trend data based on trend percentage
const generateTrendData = (trendPercent: number): TrendDataPoint[] => {
  const dataPoints: TrendDataPoint[] = [];
  const isPositive = trendPercent >= 0;
  const absTrend = Math.abs(trendPercent);
  const baseValue = 40;
  const numPoints = 12;
  
  for (let i = 0; i < numPoints; i++) {
    const progress = i / (numPoints - 1);
    let value: number;
    
    if (isPositive) {
      if (absTrend > 100) {
        if (progress < 0.3) {
          value = baseValue - (progress * 0.3) * 15;
        } else {
          const riseProgress = (progress - 0.3) / 0.7;
          value = baseValue - 4.5 + (riseProgress * riseProgress * riseProgress * absTrend * 0.3);
        }
      } else {
        value = baseValue + (progress * progress * absTrend * 0.4);
      }
    } else {
      if (absTrend > 50) {
        if (progress < 0.3) {
          value = baseValue + (progress * 0.3) * 20;
        } else {
          const fallProgress = (progress - 0.3) / 0.7;
          value = baseValue + 6 - (fallProgress * fallProgress * absTrend * 0.3);
        }
      } else {
        value = baseValue + 20 - (progress * progress * absTrend * 0.4);
      }
    }
    
    value += (Math.random() * 3 - 1.5);
    value = Math.max(25, Math.min(95, value));
    dataPoints.push({ value });
  }
  
  return dataPoints;
};


const SalesTrends = () => {
  const { theme } = useTheme();
  const isDarkMode = theme === 'dark';
  
  // Tenant selection from global store (persists across pages)
  const { selectedTenantId } = useTenantStore();
  const { user } = useAuth();
  
  // Get tenant_id - prefer global selection (for admins), fall back to user's tenant
  const tenantId = selectedTenantId || user?.tenant_id || null;

  const [dateRange, setDateRange] = useState<DateRange>(() => {
    const saved = localStorage.getItem('sales-trends-dateRange');
    return (saved as DateRange) || '3-months';
  });
  const [stPickerYear, setStPickerYear] = useState(new Date().getFullYear());
  const [stCustomDateRange, setStCustomDateRange] = useState<{ start: string; end: string } | undefined>(undefined);
  const handleSalesTrendsPeriodChange = useCallback((selection: PeriodSelection) => {
    const mapped = mapPresetToSalesDateRange(selection.preset);
    setDateRange(mapped);
    // Forward custom calendar range if the user picked one
    if (selection.type === 'custom' && selection.dateRange) {
      setStCustomDateRange({ start: selection.dateRange.start, end: selection.dateRange.end });
    } else {
      setStCustomDateRange(undefined);
    }
  }, []);

  // Drive picker from current date range so selection is visible immediately (including initial load / while data loads)
  const salesTrendsPeriodSelection: PeriodSelection | null = useMemo(() => {
    if (stCustomDateRange) {
      return { type: 'custom', dateRange: stCustomDateRange };
    }
    const preset: PeriodPreset = dateRange === '6-months' ? 'rolling-6' : 'rolling-3';
    return { type: 'preset', preset, dateRange: computePresetDateRange(preset) };
  }, [dateRange, stCustomDateRange]);

  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    const saved = localStorage.getItem('sales-trends-viewMode');
    return (saved as ViewMode) || 'tabular';
  });

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedOfficer, setSelectedOfficer] = useState<LoanOfficer | null>(null);
  const [isDrilldownOpen, setIsDrilldownOpen] = useState(false);
  const [drilldownData, setDrilldownData] = useState<DrilldownData | null>(null);
  const [drilldownLoading, setDrilldownLoading] = useState(false);

  // Fetch data from API with tenant context
  const { data: apiData, loading, error, refetch, fetchDrilldown } = useSalesTrendsData(dateRange as DateRangeOption, 'Retail', tenantId, stCustomDateRange);

  useEffect(() => {
    localStorage.setItem('sales-trends-dateRange', dateRange);
  }, [dateRange]);

  useEffect(() => {
    localStorage.setItem('sales-trends-viewMode', viewMode);
  }, [viewMode]);

  // Transform API loan officers to include trendData for charts
  const loanOfficers = useMemo(() => {
    if (!apiData?.loanOfficers) return [];
    return apiData.loanOfficers.map(lo => ({
      ...lo,
      trendData: generateTrendData(lo.trendPercent),
    }));
  }, [apiData?.loanOfficers]);

  // Get fund type data from API
  const fundTypeData = useMemo(() => {
    return apiData?.fundTypeBreakdown || [];
  }, [apiData?.fundTypeBreakdown]);

  // Get monthly performance from API
  const monthlyPerformance = useMemo(() => {
    return apiData?.monthlyPerformance || [];
  }, [apiData?.monthlyPerformance]);

  // Get KPI metrics from API
  const kpiMetrics = useMemo(() => {
    if (!apiData?.kpiMetrics) {
      return { totalUnits: 0, totalVolume: 0, activeLOs: 0, topTierCount: 0, avgTurnTime: 0 };
    }
    const topTierCount = loanOfficers.filter(lo => lo.tier === 'top').length;
    return { ...apiData.kpiMetrics, topTierCount };
  }, [apiData?.kpiMetrics, loanOfficers]);

  // Filter data based on search query
  const filteredLoanOfficers = useMemo(() => {
    if (!searchQuery) return loanOfficers;
    const query = searchQuery.toLowerCase();
    return loanOfficers.filter(
      (officer) =>
        officer.name.toLowerCase().includes(query) ||
        officer.branch.toLowerCase().includes(query) ||
        officer.branchNumber.includes(query)
    );
  }, [searchQuery, loanOfficers]);

  const formatCurrency = (value: number) => {
    if (value >= 1000000) {
      return `$${(value / 1000000).toFixed(1)}M`;
    } else if (value >= 1000) {
      return `$${(value / 1000).toFixed(0)}K`;
    }
    return `$${value.toLocaleString()}`;
  };

  // Handle card click - fetch drilldown data from API
  const handleCardClick = async (officer: LoanOfficer) => {
    setSelectedOfficer(officer);
    setIsDrilldownOpen(true);
    setDrilldownLoading(true);
    setDrilldownData(null);
    
    try {
      const data = await fetchDrilldown(officer.name);
      if (data) {
        setDrilldownData({
          totalClosed: data.totalClosed,
          totalVolume: data.totalVolume,
          avgMargin: data.avgMargin,
          turnTime: data.turnTime,
          branchRank: data.branchRank,
          branchTotal: data.branchTotal,
          contact: data.contact,
          monthlyDetails: data.monthlyDetails,
          performanceTrend: data.performanceTrend,
        });
      } else {
        // Fallback to basic data from officer if API fails
        setDrilldownData({
          totalClosed: officer.closed,
          totalVolume: officer.volume,
          avgMargin: officer.marginBPS,
          turnTime: officer.daysAvg,
          branchRank: 1,
          branchTotal: 1,
          contact: { email: 'loan.officer@company.com', phone: '(555) 123-4567', location: officer.branch },
          monthlyDetails: [],
          performanceTrend: [],
        });
      }
    } catch (err) {
      console.error('Error fetching drilldown:', err);
      setDrilldownData({
        totalClosed: officer.closed,
        totalVolume: officer.volume,
        avgMargin: officer.marginBPS,
        turnTime: officer.daysAvg,
        branchRank: 1,
        branchTotal: 1,
        contact: { email: 'loan.officer@company.com', phone: '(555) 123-4567', location: officer.branch },
        monthlyDetails: [],
        performanceTrend: [],
      });
    } finally {
      setDrilldownLoading(false);
    }
  };

  const getTierBadge = (tier: 'top' | '2nd' | 'bottom') => {
    const baseClasses = "inline-flex px-2 py-0.5 rounded-full text-xs font-medium";
    switch (tier) {
      case 'top':
        return <span className={`${baseClasses} bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300`}>Top Tier</span>;
      case '2nd':
        return <span className={`${baseClasses} bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300`}>Second Tier</span>;
      case 'bottom':
        return <span className={`${baseClasses} bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300`}>Bottom Tier</span>;
    }
  };

  const getInitialsColor = (initials: string) => {
    return 'bg-teal-500';
  };

  const totalFundTypeUnits = fundTypeData.reduce((sum, item) => sum + item.value, 0);

  return (
    <TopTieringLayout>
      <div className="flex flex-col min-h-[calc(100vh-4rem)]">
        <TopTieringTopBar title="Sales Trends" />
        <main className="relative flex-1 overflow-y-auto px-6 py-4 max-w-[1800px] mx-auto">
        {/* Loading State */}
        {loading && (
          <div className="flex flex-col items-center justify-center min-h-[400px]">
            <Loader2 className="h-8 w-8 animate-spin text-teal-500 mb-4" />
            <p className="text-slate-600 dark:text-slate-400">Loading sales trends data...</p>
          </div>
        )}

        {/* Error State */}
        {error && !loading && (
          <div className="flex flex-col items-center justify-center min-h-[400px]">
            <div className={`rounded-xl p-8 text-center ${isDarkMode ? 'bg-slate-800/70' : 'bg-white'} shadow-lg max-w-md`}>
              <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-2">Failed to Load Data</h3>
              <p className="text-slate-600 dark:text-slate-400 mb-4">{error}</p>
              <Button onClick={refetch} className="gap-2">
                <RefreshCw className="h-4 w-4" />
                Try Again
              </Button>
            </div>
          </div>
        )}

        {/* Main Content */}
        {!loading && !error && (
        <div className="grid gap-4 sm:gap-5 md:gap-6 grid-cols-12">
          <div className="col-span-12 lg:col-span-8 space-y-4 sm:space-y-5 md:space-y-6">
            {/* KPI Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
              <Card className={`rounded-xl backdrop-blur-sm ${isDarkMode ? 'border-slate-700/50 bg-slate-800/70 shadow-[0_8px_24px_rgba(0,0,0,0.3)]' : 'border-blue-200/40 bg-white shadow-[0_8px_24px_rgba(59,130,246,0.08)]'}`}>
                <CardContent className="pt-4 sm:pt-6">
                  <div className="flex items-center justify-between mb-2">
                    <div className={`p-2 rounded-lg ${isDarkMode ? 'bg-green-500/20' : 'bg-green-100'}`}>
                      <Target className={`h-4 w-4 ${isDarkMode ? 'text-green-400' : 'text-green-600'}`} />
                    </div>
                    <Badge variant="secondary" className="text-xs bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300">+12%</Badge>
                  </div>
                  <div className="text-2xl sm:text-3xl font-bold text-slate-900 dark:text-slate-100 mb-1">{kpiMetrics.totalUnits}</div>
                  <div className="text-xs sm:text-sm text-slate-600 dark:text-slate-400">Total Units Closed</div>
                </CardContent>
              </Card>

              <Card className={`rounded-xl backdrop-blur-sm ${isDarkMode ? 'border-slate-700/50 bg-slate-800/70 shadow-[0_8px_24px_rgba(0,0,0,0.3)]' : 'border-blue-200/40 bg-white shadow-[0_8px_24px_rgba(59,130,246,0.08)]'}`}>
                <CardContent className="pt-4 sm:pt-6">
                  <div className="flex items-center justify-between mb-2">
                    <div className={`p-2 rounded-lg ${isDarkMode ? 'bg-blue-500/20' : 'bg-blue-100'}`}>
                      <DollarSign className={`h-4 w-4 ${isDarkMode ? 'text-blue-400' : 'text-blue-600'}`} />
                    </div>
                    <Badge variant="secondary" className="text-xs bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">+8%</Badge>
                  </div>
                  <div className="text-2xl sm:text-3xl font-bold text-slate-900 dark:text-slate-100 mb-1">{formatCurrency(kpiMetrics.totalVolume)}</div>
                  <div className="text-xs sm:text-sm text-slate-600 dark:text-slate-400">Total Volume</div>
                </CardContent>
              </Card>

              <Card className={`rounded-xl backdrop-blur-sm ${isDarkMode ? 'border-slate-700/50 bg-slate-800/70 shadow-[0_8px_24px_rgba(0,0,0,0.3)]' : 'border-blue-200/40 bg-white shadow-[0_8px_24px_rgba(59,130,246,0.08)]'}`}>
                <CardContent className="pt-4 sm:pt-6">
                  <div className="flex items-center justify-between mb-2">
                    <div className={`p-2 rounded-lg ${isDarkMode ? 'bg-purple-500/20' : 'bg-purple-100'}`}>
                      <Users className={`h-4 w-4 ${isDarkMode ? 'text-purple-400' : 'text-purple-600'}`} />
                    </div>
                    <Badge variant="secondary" className="text-xs bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300">{kpiMetrics.topTierCount} top</Badge>
                  </div>
                  <div className="text-2xl sm:text-3xl font-bold text-slate-900 dark:text-slate-100 mb-1">{kpiMetrics.activeLOs}</div>
                  <div className="text-xs sm:text-sm text-slate-600 dark:text-slate-400">Active Loan Officers</div>
                </CardContent>
              </Card>

              <Card className={`rounded-xl backdrop-blur-sm ${isDarkMode ? 'border-slate-700/50 bg-slate-800/70 shadow-[0_8px_24px_rgba(0,0,0,0.3)]' : 'border-blue-200/40 bg-white shadow-[0_8px_24px_rgba(59,130,246,0.08)]'}`}>
                <CardContent className="pt-4 sm:pt-6">
                  <div className="flex items-center justify-between mb-2">
                    <div className={`p-2 rounded-lg ${isDarkMode ? 'bg-orange-500/20' : 'bg-orange-100'}`}>
                      <Clock className={`h-4 w-4 ${isDarkMode ? 'text-orange-400' : 'text-orange-600'}`} />
                    </div>
                    <Badge variant="secondary" className="text-xs bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300">-3 days</Badge>
                  </div>
                  <div className="text-2xl sm:text-3xl font-bold text-slate-900 dark:text-slate-100 mb-1">{kpiMetrics.avgTurnTime}</div>
                  <div className="text-xs sm:text-sm text-slate-600 dark:text-slate-400">Avg Turn Time (days)</div>
                </CardContent>
              </Card>
            </div>

            {/* Filter Bar */}
            <Card className={`rounded-xl backdrop-blur-sm ${isDarkMode ? 'border-slate-700/50 bg-slate-800/70 shadow-[0_8px_24px_rgba(0,0,0,0.3)]' : 'border-blue-200/40 bg-white shadow-[0_8px_24px_rgba(59,130,246,0.08)]'}`}>
              <CardContent className="pt-4 sm:pt-6">
                <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 items-stretch sm:items-center">
                  <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 items-stretch sm:items-center">
                    <DatePeriodPicker
                      year={stPickerYear}
                      onYearChange={setStPickerYear}
                      presets={['rolling-3', 'rolling-6']}
                      showYears={false}
                      onPeriodChange={handleSalesTrendsPeriodChange}
                      periodSelectionFromStore={salesTrendsPeriodSelection}
                      defaultPreset="rolling-3"
                      showLabel={false}
                      size="sm"
                    />
                    {loading && (
                      <Loader2 className="h-4 w-4 animate-spin text-slate-400 dark:text-slate-500 flex-shrink-0" aria-hidden />
                    )}

                    <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as ViewMode)} className="w-full sm:w-auto">
                      <TabsList className={`grid w-full sm:w-auto grid-cols-2 h-9 sm:h-10 ${isDarkMode ? 'bg-slate-900/60 border border-slate-700/50' : 'bg-slate-100/80 border border-slate-300/40'}`}>
                        <TabsTrigger value="cards" className="px-3 sm:px-4 touch-manipulation justify-center data-[state=active]:bg-gradient-to-r data-[state=active]:from-blue-500 data-[state=active]:to-purple-500 data-[state=active]:text-white data-[state=active]:shadow-lg data-[state=active]:shadow-blue-500/25"><BarChart3 className="h-4 w-4" /></TabsTrigger>
                        <TabsTrigger value="tabular" className="px-3 sm:px-4 touch-manipulation justify-center data-[state=active]:bg-gradient-to-r data-[state=active]:from-blue-500 data-[state=active]:to-purple-500 data-[state=active]:text-white data-[state=active]:shadow-lg data-[state=active]:shadow-blue-500/25"><Filter className="h-4 w-4" /></TabsTrigger>
                      </TabsList>
                    </Tabs>
                  </div>

                  <div className="relative w-full sm:w-auto sm:flex-1 sm:max-w-xs ml-auto">
                    <Search className={`absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`} />
                    <Input type="text" placeholder="Search officers or branches..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className={`pl-9 h-9 sm:h-10 w-full ${isDarkMode ? 'bg-slate-800/60 border-slate-700' : 'bg-white border-slate-200'}`} />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Loan Officer Cards / Table */}
            {viewMode === 'cards' ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
                {filteredLoanOfficers.map((officer) => (
                  <Card key={officer.id} onClick={() => handleCardClick(officer)} className={`group rounded-xl backdrop-blur-sm transition-all cursor-pointer ${isDarkMode ? 'border-slate-700/50 bg-slate-800/70 shadow-[0_8px_24px_rgba(0,0,0,0.3)] hover:border-teal-400/60 hover:shadow-[0_12px_32px_rgba(20,184,166,0.25)]' : 'border-blue-200/40 bg-white shadow-[0_8px_24px_rgba(59,130,246,0.08)] hover:border-teal-300/60 hover:shadow-[0_12px_32px_rgba(20,184,166,0.2)]'}`}>
                    <CardContent className="pt-4 sm:pt-6">
                      <div className="flex items-start justify-between mb-4">
                        <div className="flex items-center gap-3">
                          <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-semibold text-sm ${getInitialsColor(officer.initials)}`}>{officer.initials}</div>
                          <div>
                            <div className="text-sm font-semibold text-slate-900 dark:text-slate-100 group-hover:text-teal-600 dark:group-hover:text-teal-400 transition-colors">{officer.name}</div>
                            <div className="text-xs text-slate-600 dark:text-slate-400">{officer.branch}</div>
                          </div>
                        </div>
                        {getTierBadge(officer.tier)}
                      </div>

                      <div className="grid grid-cols-3 gap-2 sm:gap-3 mb-4">
                        <div className={`rounded-lg p-3 text-center ${isDarkMode ? 'bg-slate-800/50' : 'bg-slate-50'}`}>
                          <div className="text-lg sm:text-xl font-bold text-slate-900 dark:text-slate-100 mb-1">{officer.closed}</div>
                          <div className="text-[10px] sm:text-xs font-medium uppercase tracking-wider text-slate-600 dark:text-slate-400">CLOSED</div>
                        </div>
                        <div className={`rounded-lg p-3 text-center ${isDarkMode ? 'bg-slate-800/50' : 'bg-slate-50'}`}>
                          <div className="text-lg sm:text-xl font-bold text-slate-900 dark:text-slate-100 mb-1">{formatCurrency(officer.volume)}</div>
                          <div className="text-[10px] sm:text-xs font-medium uppercase tracking-wider text-slate-600 dark:text-slate-400">VOLUME</div>
                        </div>
                        <div className={`rounded-lg p-3 text-center ${isDarkMode ? 'bg-slate-800/50' : 'bg-slate-50'}`}>
                          <div className="text-lg sm:text-xl font-bold text-slate-900 dark:text-slate-100 mb-1">{officer.marginBPS}</div>
                          <div className="text-[10px] sm:text-xs font-medium uppercase tracking-wider text-slate-600 dark:text-slate-400">MARGIN BPS</div>
                        </div>
                      </div>

                      <div className="pt-4 border-t border-slate-200 dark:border-slate-700 flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <div className="w-16 h-10 min-w-0 flex-shrink-0">
                            <ResponsiveContainer width="100%" height="100%">
                              <AreaChart data={officer.trendData} margin={{ top: 2, right: 2, left: 2, bottom: 2 }}>
                                <defs>
                                  <linearGradient id={`gradient-card-${officer.id}`} x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="0%" stopColor={officer.trendPercent >= 0 ? '#10b981' : '#ef4444'} stopOpacity={0.3} />
                                    <stop offset="100%" stopColor={officer.trendPercent >= 0 ? '#10b981' : '#ef4444'} stopOpacity={0} />
                                  </linearGradient>
                                </defs>
                                <Area type="linear" dataKey="value" stroke={officer.trendPercent >= 0 ? '#10b981' : '#ef4444'} strokeWidth={2} fill={`url(#gradient-card-${officer.id})`} dot={false} isAnimationActive={true} animationDuration={800} />
                              </AreaChart>
                            </ResponsiveContainer>
                          </div>
                          {officer.trendPercent >= 0 ? <TrendingUp className="h-4 w-4 text-green-600 dark:text-green-400" /> : <TrendingDown className="h-4 w-4 text-red-600 dark:text-red-400" />}
                          <span className={`text-sm font-semibold whitespace-nowrap ${officer.trendPercent >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>{Math.abs(officer.trendPercent)}%</span>
                        </div>
                        <span className="text-xs text-slate-600 dark:text-slate-400 whitespace-nowrap flex-shrink-0 ml-auto">{officer.daysAvg} days avg</span>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <Card className={`rounded-xl backdrop-blur-sm ${isDarkMode ? 'border-slate-700/50 bg-slate-800/70 shadow-[0_8px_24px_rgba(0,0,0,0.3)]' : 'border-blue-200/40 bg-white shadow-[0_8px_24px_rgba(59,130,246,0.08)]'}`}>
                <CardHeader className="p-4 bg-slate-50 border-b border-slate-200 dark:bg-slate-800/50 dark:border-slate-700">
                  <CardTitle className="text-sm font-semibold text-slate-700 dark:text-slate-200">Loan Officers</CardTitle>
                  <p className="text-xs text-slate-400 dark:text-slate-500">Performance metrics for all loan officers</p>
                </CardHeader>
                <div className="overflow-x-auto -mx-4 sm:mx-0">
                  <div className="inline-block min-w-full align-middle px-4 sm:px-0">
                    <table className="w-full min-w-[640px]">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200 dark:bg-slate-800/50 dark:border-slate-700">
                          <th className="py-2.5 px-4 text-left text-xs font-semibold text-slate-600 dark:text-slate-300">Name</th>
                          <th className="py-2.5 px-4 text-left text-xs font-semibold text-slate-600 dark:text-slate-300">Branch</th>
                          <th className="py-2.5 px-4 text-right text-xs font-semibold text-slate-600 dark:text-slate-300">Closed</th>
                          <th className="py-2.5 px-4 text-right text-xs font-semibold text-slate-600 dark:text-slate-300">Volume</th>
                          <th className="py-2.5 px-4 text-right text-xs font-semibold text-slate-600 dark:text-slate-300">Margin BPS</th>
                          <th className="py-2.5 px-4 text-right text-xs font-semibold text-slate-600 dark:text-slate-300">Trend</th>
                          <th className="py-2.5 px-4 text-right text-xs font-semibold text-slate-600 dark:text-slate-300">Days Avg</th>
                          <th className="py-2.5 px-4 text-center text-xs font-semibold text-slate-600 dark:text-slate-300">Tier</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredLoanOfficers.map((officer) => (
                          <tr key={officer.id} onClick={() => handleCardClick(officer)} className="border-b border-slate-100 hover:bg-slate-50 transition-colors cursor-pointer dark:border-slate-700 dark:hover:bg-slate-800/50">
                            <td className="py-3 px-4 text-sm font-medium text-slate-800 dark:text-slate-200">{officer.name}</td>
                            <td className="py-3 px-4 text-sm text-slate-600 dark:text-slate-300">{officer.branch}</td>
                            <td className="py-3 px-4 text-sm text-right text-slate-700 dark:text-slate-300">{officer.closed}</td>
                            <td className="py-3 px-4 text-sm text-right text-slate-700 dark:text-slate-300">{formatCurrency(officer.volume)}</td>
                            <td className="py-3 px-4 text-sm text-right text-slate-700 dark:text-slate-300">{officer.marginBPS}</td>
                            <td className="py-3 px-4 text-sm text-right">
                              <div className="flex items-center justify-end gap-2">
                                <div className="w-12 h-8 min-w-0 flex-shrink-0">
                                  <ResponsiveContainer width="100%" height="100%">
                                    <AreaChart data={officer.trendData} margin={{ top: 1, right: 1, left: 1, bottom: 1 }}>
                                      <defs>
                                        <linearGradient id={`gradient-table-${officer.id}`} x1="0" y1="0" x2="0" y2="1">
                                          <stop offset="0%" stopColor={officer.trendPercent >= 0 ? '#10b981' : '#ef4444'} stopOpacity={0.3} />
                                          <stop offset="100%" stopColor={officer.trendPercent >= 0 ? '#10b981' : '#ef4444'} stopOpacity={0} />
                                        </linearGradient>
                                      </defs>
                                      <Area type="linear" dataKey="value" stroke={officer.trendPercent >= 0 ? '#10b981' : '#ef4444'} strokeWidth={1.5} fill={`url(#gradient-table-${officer.id})`} dot={false} isAnimationActive={false} />
                                    </AreaChart>
                                  </ResponsiveContainer>
                                </div>
                                {officer.trendPercent >= 0 ? <TrendingUp className="h-3 w-3 text-green-600 dark:text-green-400" /> : <TrendingDown className="h-3 w-3 text-red-600 dark:text-red-400" />}
                                <span className={`text-sm font-semibold ${officer.trendPercent >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>{Math.abs(officer.trendPercent)}%</span>
                              </div>
                            </td>
                            <td className="py-3 px-4 text-sm text-right text-slate-700 dark:text-slate-300">{officer.daysAvg}</td>
                            <td className="py-3 px-4 text-center">{getTierBadge(officer.tier)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </Card>
            )}
          </div>

          {/* Right Sidebar */}
          <div className="col-span-12 lg:col-span-4 space-y-4 sm:space-y-5 md:space-y-6">
            {/* Units by Fund Type */}
            <Card className={`rounded-xl backdrop-blur-sm ${isDarkMode ? 'border-slate-700/50 bg-slate-800/70 shadow-[0_8px_24px_rgba(0,0,0,0.3)]' : 'border-blue-200/40 bg-white shadow-[0_8px_24px_rgba(59,130,246,0.08)]'}`}>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <CardTitle className="text-base sm:text-lg">Units by Fund Type</CardTitle>
                  <Clock className="h-4 w-4 text-purple-500" />
                </div>
              </CardHeader>
              <CardContent>
                <div className="h-64 sm:h-72 relative">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={fundTypeData} cx="50%" cy="50%" innerRadius="40%" outerRadius="70%" paddingAngle={2} dataKey="value" label={false}>
                        {fundTypeData.map((entry, index) => (<Cell key={`cell-${index}`} fill={entry.fill} />))}
                      </Pie>
                      <Tooltip contentStyle={{ backgroundColor: isDarkMode ? '#1e293b' : '#ffffff', border: `1px solid ${isDarkMode ? '#475569' : '#e2e8f0'}`, borderRadius: '8px', color: isDarkMode ? '#f1f5f9' : '#1e293b' }} formatter={(value: number) => [value, 'Units']} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div className="text-center">
                      <div className="text-3xl sm:text-4xl font-bold text-slate-900 dark:text-slate-100">{totalFundTypeUnits}</div>
                      <div className="text-sm text-slate-600 dark:text-slate-400 mt-1">Total</div>
                    </div>
                  </div>
                </div>
                <div className="mt-4 space-y-2">
                  {fundTypeData.map((item, index) => (
                    <div key={index} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: item.fill }} />
                        <span className="text-sm text-slate-700 dark:text-slate-300">{item.name}</span>
                      </div>
                      <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">{item.value}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Monthly Performance */}
            <Card className={`rounded-xl backdrop-blur-sm ${isDarkMode ? 'border-slate-700/50 bg-slate-800/70 shadow-[0_8px_24px_rgba(0,0,0,0.3)]' : 'border-blue-200/40 bg-white shadow-[0_8px_24px_rgba(59,130,246,0.08)]'}`}>
              <CardHeader><CardTitle className="text-base sm:text-lg">Monthly Performance</CardTitle></CardHeader>
              <CardContent>
                <div className="h-56 sm:h-64 md:h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={monthlyPerformance} margin={{ top: 10, right: 10, left: 0, bottom: 40 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={isDarkMode ? '#475569' : '#e2e8f0'} />
                      <XAxis dataKey="month" stroke={isDarkMode ? '#94a3b8' : '#64748b'} tick={{ fontSize: 10 }} angle={-45} textAnchor="end" height={60} />
                      <YAxis stroke={isDarkMode ? '#94a3b8' : '#64748b'} tick={{ fontSize: 11 }} label={{ value: 'Units', angle: -90, position: 'insideLeft', style: { textAnchor: 'middle', fill: isDarkMode ? '#94a3b8' : '#64748b', fontSize: '11px' } }} />
                      <Tooltip contentStyle={{ backgroundColor: isDarkMode ? '#1e293b' : '#ffffff', border: `1px solid ${isDarkMode ? '#475569' : '#e2e8f0'}`, borderRadius: '8px', color: isDarkMode ? '#f1f5f9' : '#1e293b' }} formatter={(value: number, name: string) => { if (name === 'units') return [value, 'Units']; if (name === 'volume') return [formatCurrency(value), 'Volume']; return [value, name]; }} />
                      <Bar dataKey="units" radius={[4, 4, 0, 0]} fill="#64748b">
                        {monthlyPerformance.map((entry, index) => {
                          const isLatestMonth = index === monthlyPerformance.length - 1;
                          return <Cell key={`cell-${index}`} fill={isLatestMonth ? '#10b981' : '#64748b'} />;
                        })}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="mt-4 space-y-2">
                  {monthlyPerformance.map((entry) => (
                    <div key={entry.month} className="flex justify-between items-center text-sm">
                      <span className="text-slate-600 dark:text-slate-400">{entry.month}:</span>
                      <div className="flex gap-4">
                        <span className="font-semibold text-slate-900 dark:text-slate-100">{entry.units} units</span>
                        <span className="text-slate-600 dark:text-slate-400">{formatCurrency(entry.volume)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
        )}
        </main>
      </div>

      {/* Drilldown Modal */}
      <Dialog open={isDrilldownOpen} onOpenChange={setIsDrilldownOpen}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className={`fixed inset-0 z-[80] backdrop-blur-sm sm:backdrop-blur-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 touch-none ${isDarkMode ? 'bg-black/70' : 'bg-black/50'}`} />
          <DialogContent className="max-w-[95vw] sm:max-w-6xl max-h-[95vh] sm:max-h-[90vh] overflow-y-auto p-0 w-full">
            {selectedOfficer && (
                <div className="p-4 sm:p-6">
                  {/* Drilldown Loading State */}
                  {drilldownLoading && (
                    <div className="flex flex-col items-center justify-center py-12">
                      <Loader2 className="h-8 w-8 animate-spin text-teal-500 mb-4" />
                      <p className="text-slate-600 dark:text-slate-400">Loading details...</p>
                    </div>
                  )}

                  {/* Drilldown Content */}
                  {!drilldownLoading && drilldownData && (
                  <>
                  <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
                    <div className="flex items-center gap-3 sm:gap-4 min-w-0 flex-1">
                      <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-full flex items-center justify-center text-white font-semibold text-sm sm:text-base bg-teal-500 flex-shrink-0">{selectedOfficer.initials}</div>
                      <div className="min-w-0 flex-1">
                        <h2 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-slate-100 truncate">{selectedOfficer.name}</h2>
                        <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 truncate">{selectedOfficer.branch}</p>
                        <div className="mt-1">{getTierBadge(selectedOfficer.tier)}</div>
                      </div>
                    </div>
                    <Button variant="outline" size="sm" className="gap-2 w-full sm:w-auto flex-shrink-0" onClick={() => {}}><Bookmark className="h-4 w-4" /><span className="hidden sm:inline">Save</span></Button>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-5 gap-3 sm:gap-4 mb-6">
                    <Card className={`${isDarkMode ? 'bg-green-500/10 border-green-500/20' : 'bg-green-50 border-green-100'}`}>
                      <CardContent className="pt-4 sm:pt-6">
                        <div className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-slate-100 mb-1">{drilldownData.totalClosed}</div>
                        <div className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 uppercase">Total Closed</div>
                      </CardContent>
                    </Card>
                    <Card className={`${isDarkMode ? 'bg-blue-500/10 border-blue-500/20' : 'bg-blue-50 border-blue-100'}`}>
                      <CardContent className="pt-4 sm:pt-6">
                        <div className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-slate-100 mb-1">{formatCurrency(drilldownData.totalVolume)}</div>
                        <div className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 uppercase">Total Volume</div>
                      </CardContent>
                    </Card>
                    <Card className={`${isDarkMode ? 'bg-yellow-500/10 border-yellow-500/20' : 'bg-yellow-50 border-yellow-100'}`}>
                      <CardContent className="pt-4 sm:pt-6">
                        <div className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-slate-100 mb-1">{drilldownData.avgMargin} BPS</div>
                        <div className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 uppercase">Avg Margin</div>
                      </CardContent>
                    </Card>
                    <Card className={`${isDarkMode ? 'bg-purple-500/10 border-purple-500/20' : 'bg-purple-50 border-purple-100'}`}>
                      <CardContent className="pt-4 sm:pt-6">
                        <div className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-slate-100 mb-1">{drilldownData.turnTime} days</div>
                        <div className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 uppercase">Turn Time</div>
                      </CardContent>
                    </Card>
                    <Card className={`${isDarkMode ? 'bg-orange-500/10 border-orange-500/20' : 'bg-orange-50 border-orange-100'}`}>
                      <CardContent className="pt-4 sm:pt-6">
                        <div className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-slate-100 mb-1">#{drilldownData.branchRank}</div>
                        <div className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 uppercase">of {drilldownData.branchTotal} in branch</div>
                      </CardContent>
                    </Card>
                  </div>

                  <div className="mb-6">
                    <Card className={`rounded-xl backdrop-blur-sm ${isDarkMode ? 'border-slate-700/50 bg-slate-800/70' : 'border-blue-200/40 bg-white'}`}>
                      <CardHeader><CardTitle className="text-base sm:text-lg">Performance Trend</CardTitle></CardHeader>
                      <CardContent>
                        <div className="h-72 sm:h-80 lg:h-96">
                          <ResponsiveContainer width="100%" height="100%">
                            <ComposedChart data={drilldownData.performanceTrend} margin={{ top: 10, right: 10, left: 0, bottom: 20 }}>
                              <CartesianGrid strokeDasharray="3 3" stroke={isDarkMode ? '#475569' : '#e2e8f0'} />
                              <XAxis dataKey="month" stroke={isDarkMode ? '#94a3b8' : '#64748b'} tick={{ fontSize: 10 }} angle={-45} textAnchor="end" height={60} />
                              <YAxis yAxisId="left" stroke={isDarkMode ? '#94a3b8' : '#64748b'} tick={{ fontSize: 10 }} width={50} label={{ value: 'Closed Units', angle: -90, position: 'insideLeft', style: { textAnchor: 'middle', fill: isDarkMode ? '#94a3b8' : '#64748b', fontSize: '10px' } }} />
                              <YAxis yAxisId="right" orientation="right" stroke={isDarkMode ? '#94a3b8' : '#64748b'} tick={{ fontSize: 10 }} width={50} label={{ value: 'Margin BPS', angle: 90, position: 'insideRight', style: { textAnchor: 'middle', fill: isDarkMode ? '#94a3b8' : '#64748b', fontSize: '10px' } }} />
                              <Tooltip contentStyle={{ backgroundColor: isDarkMode ? '#1e293b' : '#ffffff', border: `1px solid ${isDarkMode ? '#475569' : '#e2e8f0'}`, borderRadius: '8px', color: isDarkMode ? '#f1f5f9' : '#1e293b' }} />
                              <Legend />
                              <Bar yAxisId="left" dataKey="closedUnits" fill="#10b981" radius={[4, 4, 0, 0]} name="Closed Units" />
                              <Line yAxisId="right" type="monotone" dataKey="marginBPS" stroke="#f97316" strokeWidth={2} dot={{ fill: '#f97316', r: 4 }} name="Margin BPS" />
                            </ComposedChart>
                          </ResponsiveContainer>
                        </div>
                      </CardContent>
                    </Card>
                  </div>

                  <Card className={`rounded-xl backdrop-blur-sm ${isDarkMode ? 'border-slate-700/50 bg-slate-800/70' : 'border-blue-200/40 bg-white'}`}>
                    <CardHeader><CardTitle className="text-base sm:text-lg">Monthly Details</CardTitle></CardHeader>
                    <CardContent>
                      <div className="overflow-x-auto -mx-4 sm:mx-0">
                        <div className="inline-block min-w-full align-middle px-4 sm:px-0">
                          <table className="w-full min-w-[600px]">
                            <thead>
                              <tr className="border-b border-slate-200 dark:border-slate-700">
                                <th className="py-2.5 px-4 text-left text-xs font-semibold text-slate-600 dark:text-slate-300">Month</th>
                                <th className="py-2.5 px-4 text-right text-xs font-semibold text-slate-600 dark:text-slate-300">Closed</th>
                                <th className="py-2.5 px-4 text-right text-xs font-semibold text-slate-600 dark:text-slate-300">Volume</th>
                                <th className="py-2.5 px-4 text-right text-xs font-semibold text-slate-600 dark:text-slate-300">Margin</th>
                                <th className="py-2.5 px-4 text-right text-xs font-semibold text-slate-600 dark:text-slate-300">Pull Through</th>
                                <th className="py-2.5 px-4 text-right text-xs font-semibold text-slate-600 dark:text-slate-300">Turn Time</th>
                              </tr>
                            </thead>
                            <tbody>
                              {drilldownData.monthlyDetails.map((detail, index) => (
                                <tr key={index} className="border-b border-slate-100 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                                  <td className="py-3 px-4 text-sm text-slate-800 dark:text-slate-200">{detail.month}</td>
                                  <td className="py-3 px-4 text-sm text-right text-slate-700 dark:text-slate-300">{detail.closed}</td>
                                  <td className="py-3 px-4 text-sm text-right text-slate-700 dark:text-slate-300">{formatCurrency(detail.volume)}</td>
                                  <td className="py-3 px-4 text-sm text-right text-slate-700 dark:text-slate-300">{detail.margin} BPS</td>
                                  <td className="py-3 px-4 text-sm text-right text-slate-700 dark:text-slate-300">{detail.pullThrough.toFixed(1)}%</td>
                                  <td className="py-3 px-4 text-sm text-right text-slate-700 dark:text-slate-300">{detail.turnTime} days</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                  </>
                  )}
                </div>
            )}
          </DialogContent>
        </DialogPrimitive.Portal>
      </Dialog>
    </TopTieringLayout>
  );
};

export default SalesTrends;
