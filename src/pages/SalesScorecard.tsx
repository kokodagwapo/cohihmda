import React, { useState, useEffect, useMemo } from 'react';
import { Navigation } from '@/components/layout/Navigation';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useTheme } from '@/components/theme-provider';
import { Filter, BookmarkCheck, ChevronLeft, ChevronRight, Plus, Search, Download, Maximize2, Minimize2, TrendingUp, Info } from 'lucide-react';

type ScorecardActor = 'branch' | 'loan-officer';
type DateRange = '3-months' | '6-months';
type ActiveTab = 'summary' | 'detail';

interface LoanOfficer {
  id: string;
  name: string;
  branch: string;
  units: number;
  volume: number;
  revenue: number;
  pullThrough: number;
  tier: 'top' | '2nd' | 'bottom';
}

interface Branch {
  id: string;
  name: string;
  loCount: number;
  units: number;
  volume: number;
  revenue: number;
  pullThrough: number;
}

interface SummaryMetrics {
  metric: string;
  totals: string | number;
  topTier: string | number;
  secondTier: string | number;
  bottomTier: string | number;
  category?: 'general' | 'average-conditions';
}

// Mock data for 3 months
const mockLoanOfficers3Months: LoanOfficer[] = [
  { id: '1', name: 'John Smith', branch: 'Main Branch', units: 45, volume: 12500000, revenue: 312500, pullThrough: 78.0, tier: 'top' },
  { id: '2', name: 'Sarah Johnson', branch: 'Main Branch', units: 38, volume: 10200000, revenue: 275400, pullThrough: 72.0, tier: 'top' },
  { id: '3', name: 'Mike Davis', branch: 'West Branch', units: 32, volume: 8900000, revenue: 231400, pullThrough: 68.0, tier: '2nd' },
  { id: '4', name: 'Emily Chen', branch: 'East Branch', units: 28, volume: 7500000, revenue: 187500, pullThrough: 65.0, tier: '2nd' },
  { id: '5', name: 'Robert Wilson', branch: 'West Branch', units: 22, volume: 5800000, revenue: 139200, pullThrough: 58.0, tier: 'bottom' },
];

// Mock data for 6 months (same structure, could have different values)
const mockLoanOfficers6Months: LoanOfficer[] = [
  { id: '1', name: 'John Smith', branch: 'Main Branch', units: 45, volume: 12500000, revenue: 312500, pullThrough: 78.0, tier: 'top' },
  { id: '2', name: 'Sarah Johnson', branch: 'Main Branch', units: 38, volume: 10200000, revenue: 275400, pullThrough: 72.0, tier: 'top' },
  { id: '3', name: 'Mike Davis', branch: 'West Branch', units: 32, volume: 8900000, revenue: 231400, pullThrough: 68.0, tier: '2nd' },
  { id: '4', name: 'Emily Chen', branch: 'East Branch', units: 28, volume: 7500000, revenue: 187500, pullThrough: 65.0, tier: '2nd' },
  { id: '5', name: 'Robert Wilson', branch: 'West Branch', units: 22, volume: 5800000, revenue: 139200, pullThrough: 58.0, tier: 'bottom' },
];

// Mock data for branches (3 months)
const mockBranches3Months: Branch[] = [
  { id: '1', name: 'Main Branch', loCount: 12, units: 245, volume: 68500000, revenue: 1700000, pullThrough: 74.0 },
  { id: '2', name: 'West Branch', loCount: 8, units: 165, volume: 45200000, revenue: 1100000, pullThrough: 68.0 },
  { id: '3', name: 'East Branch', loCount: 6, units: 120, volume: 32000000, revenue: 800000, pullThrough: 62.0 },
];

// Mock data for branches (6 months)
const mockBranches6Months: Branch[] = [
  { id: '1', name: 'Main Branch', loCount: 12, units: 245, volume: 68500000, revenue: 1700000, pullThrough: 74.0 },
  { id: '2', name: 'West Branch', loCount: 8, units: 165, volume: 45200000, revenue: 1100000, pullThrough: 68.0 },
  { id: '3', name: 'East Branch', loCount: 6, units: 120, volume: 32000000, revenue: 800000, pullThrough: 62.0 },
];

// Summary metrics data for 3 months
const summaryMetrics3Months: SummaryMetrics[] = [
  { metric: 'Loan Officer Count', totals: 162, topTier: 27, secondTier: 54, bottomTier: 81, category: 'general' },
  { metric: 'TTS Long Term Units', totals: 100.6, topTier: 65.4, secondTier: 25.2, bottomTier: 10.1, category: 'general' },
  { metric: 'Loan Complexity Score', totals: 113.2, topTier: 113.6, secondTier: 113.4, bottomTier: 113.5, category: 'general' },
  { metric: 'Units', totals: 2051, topTier: 1333, secondTier: 513, bottomTier: 205, category: 'general' },
  { metric: 'Units %', totals: 100.0, topTier: 65.0, secondTier: 25.0, bottomTier: 10.0, category: 'general' },
  { metric: 'Volume', totals: 468900000, topTier: 304800000, secondTier: 117200000, bottomTier: 46900000, category: 'general' },
  { metric: 'Volume %', totals: 100.0, topTier: 65.0, secondTier: 25.0, bottomTier: 10.0, category: 'general' },
  { metric: 'Revenue $', totals: 12500000, topTier: 8100000, secondTier: 3100000, bottomTier: 1300000, category: 'general' },
  { metric: 'Revenue (BPS)', totals: 269.7, topTier: 276.5, secondTier: 268.7, bottomTier: 272.7, category: 'general' },
  { metric: 'Lost Opportunity Revenue', totals: 3000000, topTier: 1900000, secondTier: 743117, bottomTier: 297247, category: 'general' },
  { metric: 'Turn Time App to Close', totals: 38.55, topTier: 38.46, secondTier: 35.75, bottomTier: 38.22, category: 'average-conditions' },
  { metric: 'Pull Through', totals: 70.0, topTier: 67.4, secondTier: 70.9, bottomTier: 64.7, category: 'average-conditions' },
  { metric: 'WA W-H Days', totals: 8.97, topTier: 7.78, secondTier: 7.85, bottomTier: 7.34, category: 'average-conditions' },
  { metric: 'WA FICO', totals: 711, topTier: 713, secondTier: 717, bottomTier: 713, category: 'average-conditions' },
  { metric: 'WA LTV', totals: 80.3, topTier: 81.9, secondTier: 80.0, bottomTier: 79.2, category: 'average-conditions' },
  { metric: 'WA DTI', totals: 38.6, topTier: 38.6, secondTier: 40.5, bottomTier: 39.6, category: 'average-conditions' },
  { metric: 'Lost Opportunity Units', totals: 992, topTier: 645, secondTier: 248, bottomTier: 99, category: 'general' },
  { metric: 'Denied Units', totals: 25, topTier: 16, secondTier: 6, bottomTier: 3, category: 'general' },
  { metric: 'Avg LO Revenue', totals: 77386, topTier: 50301, secondTier: 19347, bottomTier: 7739, category: 'general' },
  { metric: 'Avg LO Units', totals: 13, topTier: 8, secondTier: 3, bottomTier: 1, category: 'general' },
];

// Summary metrics data for 6 months
const summaryMetrics6Months: SummaryMetrics[] = [
  { metric: 'Loan Officer Count', totals: 162, topTier: 27, secondTier: 54, bottomTier: 81, category: 'general' },
  { metric: 'TTS Long Term Units', totals: 100.6, topTier: 65.4, secondTier: 25.2, bottomTier: 10.1, category: 'general' },
  { metric: 'Loan Complexity Score', totals: 114.6, topTier: 114.5, secondTier: 113.7, bottomTier: 113.3, category: 'general' },
  { metric: 'Units', totals: 2051, topTier: 1333, secondTier: 513, bottomTier: 205, category: 'general' },
  { metric: 'Units %', totals: 100.0, topTier: 65.0, secondTier: 25.0, bottomTier: 10.0, category: 'general' },
  { metric: 'Volume', totals: 468900000, topTier: 304800000, secondTier: 117200000, bottomTier: 46900000, category: 'general' },
  { metric: 'Volume %', totals: 100.0, topTier: 65.0, secondTier: 25.0, bottomTier: 10.0, category: 'general' },
  { metric: 'Revenue $', totals: 12500000, topTier: 8100000, secondTier: 3100000, bottomTier: 1300000, category: 'general' },
  { metric: 'Revenue (BPS)', totals: 271.2, topTier: 277.8, secondTier: 262.7, bottomTier: 262.6, category: 'general' },
  { metric: 'Lost Opportunity Revenue', totals: 3000000, topTier: 1900000, secondTier: 743117, bottomTier: 297247, category: 'general' },
  { metric: 'Turn Time App to Close', totals: 39.24, topTier: 39.18, secondTier: 36.27, bottomTier: 36.85, category: 'average-conditions' },
  { metric: 'Pull Through', totals: 68.2, topTier: 69.9, secondTier: 69.8, bottomTier: 70.2, category: 'average-conditions' },
  { metric: 'WA W-H Days', totals: 4.87, topTier: 10.21, secondTier: 7.56, bottomTier: 7.23, category: 'average-conditions' },
  { metric: 'WA FICO', totals: 717, topTier: 713, secondTier: 715, bottomTier: 714, category: 'average-conditions' },
  { metric: 'WA LTV', totals: 80.8, topTier: 81.2, secondTier: 80.5, bottomTier: 80.9, category: 'average-conditions' },
  { metric: 'WA DTI', totals: 40.6, topTier: 38.5, secondTier: 39.9, bottomTier: 37.8, category: 'average-conditions' },
  { metric: 'Lost Opportunity Units', totals: 992, topTier: 645, secondTier: 248, bottomTier: 99, category: 'general' },
  { metric: 'Denied Units', totals: 25, topTier: 16, secondTier: 6, bottomTier: 3, category: 'general' },
  { metric: 'Avg LO Revenue', totals: 77386, topTier: 50301, secondTier: 19347, bottomTier: 7739, category: 'general' },
  { metric: 'Avg LO Units', totals: 13, topTier: 8, secondTier: 3, bottomTier: 1, category: 'general' },
];

const SalesScorecard = () => {
  const { theme } = useTheme();
  const isDarkMode = theme === 'dark';

  const [selectedActor, setSelectedActor] = useState<ScorecardActor>(() => {
    const saved = localStorage.getItem('sales-scorecard-actor');
    return (saved as ScorecardActor) || 'loan-officer';
  });

  const [dateRange, setDateRange] = useState<DateRange>(() => {
    const saved = localStorage.getItem('sales-scorecard-dateRange');
    return (saved as DateRange) || '6-months';
  });

  const [activeTab, setActiveTab] = useState<ActiveTab>(() => {
    const saved = localStorage.getItem('sales-scorecard-tab');
    return (saved as ActiveTab) || 'detail';
  });

  const [searchQuery, setSearchQuery] = useState('');
  const [isFullscreen, setIsFullscreen] = useState(false);


  useEffect(() => {
    localStorage.setItem('sales-scorecard-actor', selectedActor);
  }, [selectedActor]);

  useEffect(() => {
    localStorage.setItem('sales-scorecard-dateRange', dateRange);
  }, [dateRange]);

  useEffect(() => {
    localStorage.setItem('sales-scorecard-tab', activeTab);
  }, [activeTab]);

  // Get data based on actor and date range
  const getCurrentData = useMemo(() => {
    if (selectedActor === 'branch') {
      return dateRange === '3-months' ? mockBranches3Months : mockBranches6Months;
    } else {
      return dateRange === '3-months' ? mockLoanOfficers3Months : mockLoanOfficers6Months;
    }
  }, [selectedActor, dateRange]);

  // Get summary metrics based on date range
  const summaryMetrics = useMemo(() => {
    return dateRange === '3-months' ? summaryMetrics3Months : summaryMetrics6Months;
  }, [dateRange]);

  // Filter data based on search query
  const filteredData = useMemo(() => {
    if (!searchQuery) return getCurrentData;
    const query = searchQuery.toLowerCase();
    
    if (selectedActor === 'branch') {
      return (getCurrentData as Branch[]).filter(
        (branch) => branch.name.toLowerCase().includes(query)
      );
    } else {
      return (getCurrentData as LoanOfficer[]).filter(
        (officer) =>
          officer.name.toLowerCase().includes(query) ||
          officer.branch.toLowerCase().includes(query)
      );
    }
  }, [searchQuery, getCurrentData, selectedActor]);

  const formatCurrency = (value: number) => {
    if (value >= 1000000) {
      return `$${(value / 1000000).toFixed(1)}M`;
    }
    return `$${(value / 1000).toFixed(0)}K`;
  };

  const formatNumber = (num: number) => num.toLocaleString('en-US');

  const getTierBadge = (tier: 'top' | '2nd' | 'bottom') => {
    const baseClasses = "inline-flex px-2 py-0.5 rounded-full text-xs font-medium";
    switch (tier) {
      case 'top':
        return <span className={`${baseClasses} bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300`}>Top</span>;
      case '2nd':
        return <span className={`${baseClasses} bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300`}>2nd</span>;
      case 'bottom':
        return <span className={`${baseClasses} bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300`}>Bottom</span>;
    }
  };

  const getDateRangeLabel = () => {
    switch (dateRange) {
      case '3-months':
        return '3 Months';
      case '6-months':
        return '6 Months';
    }
  };

  const getDateRangeText = () => {
    const monthsAgo = dateRange === '3-months' ? 3 : 6;
    // Using the date from the screenshot: 1/23/2026
    return `Last ${monthsAgo} months: Data through Jan 23, 2026`;
  };

  const formatCurrencyFull = (value: number) => {
    if (value >= 1000000) {
      return `$${(value / 1000000).toFixed(1)}M`;
    } else if (value >= 100000) {
      // For values 100K-1M, show full number with commas
      return `$${value.toLocaleString()}`;
    } else if (value >= 1000) {
      return `$${(value / 1000).toFixed(0)}K`;
    }
    return `$${value.toLocaleString()}`;
  };

  const convertToCSV = (data: any, tab: ActiveTab, actor: ScorecardActor): string => {
    if (tab === 'summary') {
      const headers = ['Metric', 'Totals', 'Top Tier', 'Second Tier', 'Bottom Tier'];
      const rows = (data as SummaryMetrics[]).map(m => [
        m.metric,
        typeof m.totals === 'number' ? m.totals.toString() : m.totals,
        typeof m.topTier === 'number' ? m.topTier.toString() : m.topTier,
        typeof m.secondTier === 'number' ? m.secondTier.toString() : m.secondTier,
        typeof m.bottomTier === 'number' ? m.bottomTier.toString() : m.bottomTier,
      ]);
      return [headers, ...rows].map(row => row.join(',')).join('\n');
    } else {
      if (actor === 'branch') {
        const headers = ['Branch', 'LO Count', 'Units', 'Volume', 'Revenue', 'Pull Through'];
        const rows = (data as Branch[]).map(b => [
          b.name,
          b.loCount.toString(),
          b.units.toString(),
          b.volume.toString(),
          b.revenue.toString(),
          b.pullThrough.toString(),
        ]);
        return [headers, ...rows].map(row => row.join(',')).join('\n');
      } else {
        const headers = ['Name', 'Branch', 'Units', 'Volume', 'Revenue', 'Pull Through', 'Tier'];
        const rows = (data as LoanOfficer[]).map(lo => [
          lo.name,
          lo.branch,
          lo.units.toString(),
          lo.volume.toString(),
          lo.revenue.toString(),
          lo.pullThrough.toString(),
          lo.tier,
        ]);
        return [headers, ...rows].map(row => row.join(',')).join('\n');
      }
    }
  };

  const formatMetricValue = (metricName: string, value: string | number): string => {
    if (typeof value === 'string') return value;
    
    if (metricName.includes('Revenue') && !metricName.includes('BPS')) {
      return formatCurrencyFull(value);
    }
    if (metricName.includes('Volume')) {
      return formatCurrencyFull(value);
    }
    if (metricName.includes('%')) {
      return `${value}%`;
    }
    if (metricName.includes('Score') || metricName.includes('FICO') || metricName.includes('LTV') || metricName.includes('DTI') || metricName.includes('Days')) {
      return value.toFixed(1);
    }
    if (metricName.includes('Avg LO Revenue')) {
      return formatCurrencyFull(value);
    }
    if (metricName.includes('Avg LO Units')) {
      return value.toFixed(1);
    }
    return formatNumber(value);
  };

  return (
    <div className={`min-h-screen ${isDarkMode ? 'bg-slate-900' : 'bg-gradient-to-br from-blue-50/30 via-white to-blue-50/20 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950/50'}`}>
      <Navigation />

      {/* Background pattern */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(59,130,246,0.03),transparent_50%),radial-gradient(circle_at_80%_80%,rgba(168,85,247,0.02),transparent_50%)] pointer-events-none" />

      <main className={`relative mx-auto px-6 pt-24 pb-12 transition-all duration-300 ${isFullscreen ? 'max-w-full' : 'max-w-[1800px]'}`}>
        <div className={`grid gap-4 sm:gap-5 md:gap-6 transition-all duration-300 ${isFullscreen ? 'grid-cols-1' : 'grid-cols-12'}`}>
          {/* Left Sidebar - Weights & Insights */}
          {!isFullscreen && (
            <div className="col-span-12 lg:col-span-3 space-y-4 sm:space-y-5 md:space-y-6">
              {/* Weights & Story Card */}
              <Card className={`rounded-xl backdrop-blur-sm ${isDarkMode ? 'border-slate-700/50 bg-slate-800/70 shadow-[0_8px_24px_rgba(0,0,0,0.3)]' : 'border-blue-200/40 bg-white shadow-[0_8px_24px_rgba(59,130,246,0.08)]'}`}>
                <Tabs defaultValue="weights" className="w-full">
                  <CardHeader className={`border-b pb-4 ${isDarkMode ? 'border-slate-700/50 bg-gradient-to-r from-slate-800/50 to-slate-700/30' : 'border-blue-100/50 bg-gradient-to-r from-blue-50/30 to-purple-50/30'}`}>
                    <TabsList className={`grid w-full grid-cols-2 h-9 ${isDarkMode ? 'bg-slate-800/60 border border-slate-700/50' : 'bg-blue-50/50 border border-blue-200/30'}`}>
                      <TabsTrigger 
                        value="weights"
                        className="text-xs data-[state=active]:bg-gradient-to-r data-[state=active]:from-blue-500 data-[state=active]:to-purple-500 data-[state=active]:text-white data-[state=active]:shadow-lg data-[state=active]:shadow-blue-500/25"
                      >
                        Applied Weights
                      </TabsTrigger>
                      <TabsTrigger 
                        value="story"
                        className="text-xs data-[state=active]:bg-gradient-to-r data-[state=active]:from-blue-500 data-[state=active]:to-purple-500 data-[state=active]:text-white data-[state=active]:shadow-lg data-[state=active]:shadow-blue-500/25"
                      >
                        Story
                      </TabsTrigger>
                    </TabsList>
                  </CardHeader>

                  {/* Applied Weights Tab Content */}
                  <TabsContent value="weights" className="mt-0">
                    <CardContent className="space-y-6">
                      {/* Units */}
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <span className={`text-sm font-medium ${isDarkMode ? 'text-emerald-400' : 'text-emerald-600'}`}>
                            Units
                          </span>
                          <Badge variant="secondary" className="font-mono">70%</Badge>
                        </div>
                        <div className={`h-3 rounded-full overflow-hidden backdrop-blur-sm ${isDarkMode ? 'bg-slate-800/60 border border-slate-700/50' : 'bg-slate-200/80 border border-slate-300/40'}`}>
                          <div 
                            className="h-full bg-gradient-to-r from-emerald-600 to-emerald-400 rounded-full shadow-lg shadow-emerald-500/30 transition-all duration-1000 ease-out animate-in slide-in-from-left" 
                            style={{ width: '70%' }} 
                          />
                        </div>
                        <p className={`text-xs mt-1.5 ${isDarkMode ? 'text-slate-500' : 'text-slate-500'}`}>
                          Unit Weight: 70%
                        </p>
                      </div>

                      {/* Revenue */}
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <span className={`text-sm font-medium ${isDarkMode ? 'text-blue-400' : 'text-blue-600'}`}>
                            Revenue
                          </span>
                          <Badge variant="secondary" className="font-mono">20%</Badge>
                        </div>
                        <div className={`h-3 rounded-full overflow-hidden backdrop-blur-sm ${isDarkMode ? 'bg-slate-800/60 border border-slate-700/50' : 'bg-slate-200/80 border border-slate-300/40'}`}>
                          <div 
                            className="h-full bg-gradient-to-r from-blue-600 to-blue-400 rounded-full shadow-lg shadow-blue-500/30 transition-all duration-1000 ease-out animate-in slide-in-from-left delay-150" 
                            style={{ width: '20%' }} 
                          />
                        </div>
                        <p className={`text-xs mt-1.5 ${isDarkMode ? 'text-slate-500' : 'text-slate-500'}`}>
                          Revenue Weight: 20%
                        </p>
                      </div>

                      {/* Pull Through */}
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <span className={`text-sm font-medium ${isDarkMode ? 'text-amber-400' : 'text-amber-600'}`}>
                            Pull Through
                          </span>
                          <Badge variant="secondary" className="font-mono">10%</Badge>
                        </div>
                        <div className={`h-3 rounded-full overflow-hidden backdrop-blur-sm ${isDarkMode ? 'bg-slate-800/60 border border-slate-700/50' : 'bg-slate-200/80 border border-slate-300/40'}`}>
                          <div 
                            className="h-full bg-gradient-to-r from-amber-600 to-amber-400 rounded-full shadow-lg shadow-amber-500/30 transition-all duration-1000 ease-out animate-in slide-in-from-left delay-300" 
                            style={{ width: '10%' }} 
                          />
                        </div>
                        <p className={`text-xs mt-1.5 ${isDarkMode ? 'text-slate-500' : 'text-slate-500'}`}>
                          Pull Through Weight: 10%
                        </p>
                      </div>
                    </CardContent>
                  </TabsContent>

                  {/* Story Tab Content */}
                  <TabsContent value="story" className="mt-0">
                    <CardContent className="space-y-4">
                      <div>
                        <h3 className={`text-sm font-semibold mb-2 ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>
                          Sales Scorecard Methodology
                        </h3>
                        <p className={`text-xs leading-relaxed ${isDarkMode ? 'text-slate-400' : 'text-slate-600'}`}>
                          Our Sales Scorecard evaluates performance across key sales dimensions to create a comprehensive view of sales excellence.
                        </p>
                      </div>

                      <div className={`p-3 rounded-lg ${isDarkMode ? 'bg-slate-800/50' : 'bg-blue-50/30'}`}>
                        <h4 className={`text-xs font-semibold mb-1.5 flex items-center gap-1.5 ${isDarkMode ? 'text-emerald-400' : 'text-emerald-600'}`}>
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                          Units (70%)
                        </h4>
                        <p className={`text-[11px] leading-relaxed ${isDarkMode ? 'text-slate-400' : 'text-slate-600'}`}>
                          Volume-based output measuring productivity and loan origination capacity. This is the primary driver of tiering.
                        </p>
                      </div>

                      <div className={`p-3 rounded-lg ${isDarkMode ? 'bg-slate-800/50' : 'bg-blue-50/30'}`}>
                        <h4 className={`text-xs font-semibold mb-1.5 flex items-center gap-1.5 ${isDarkMode ? 'text-blue-400' : 'text-blue-600'}`}>
                          <span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span>
                          Revenue (20%)
                        </h4>
                        <p className={`text-[11px] leading-relaxed ${isDarkMode ? 'text-slate-400' : 'text-slate-600'}`}>
                          Revenue generation metrics tracking commission and fee income per loan officer.
                        </p>
                      </div>

                      <div className={`p-3 rounded-lg ${isDarkMode ? 'bg-slate-800/50' : 'bg-blue-50/30'}`}>
                        <h4 className={`text-xs font-semibold mb-1.5 flex items-center gap-1.5 ${isDarkMode ? 'text-amber-400' : 'text-amber-600'}`}>
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
                          Pull Through (10%)
                        </h4>
                        <p className={`text-[11px] leading-relaxed ${isDarkMode ? 'text-slate-400' : 'text-slate-600'}`}>
                          Conversion rate from application to funding, measuring sales effectiveness and customer follow-through.
                        </p>
                      </div>

                      <div className={`mt-4 pt-4 border-t ${isDarkMode ? 'border-slate-700' : 'border-slate-200'}`}>
                        <p className={`text-[11px] leading-relaxed ${isDarkMode ? 'text-slate-500' : 'text-slate-500'}`}>
                          Tiers are calculated by combining these weighted scores to identify top performers, consistent contributors, and areas for development.
                        </p>
                      </div>
                    </CardContent>
                  </TabsContent>
                </Tabs>
              </Card>

              {/* Key Insights Card */}
              <Card className={`rounded-xl backdrop-blur-sm overflow-hidden ${isDarkMode ? 'border-slate-700/50 bg-slate-800/70 shadow-[0_8px_24px_rgba(0,0,0,0.3)]' : 'border-blue-200/40 bg-white shadow-[0_8px_24px_rgba(59,130,246,0.08)]'}`}>
                <CardHeader className={`border-b pb-3 ${isDarkMode ? 'border-slate-700/50 bg-gradient-to-r from-blue-600/10 to-purple-600/10' : 'border-blue-100/50 bg-gradient-to-r from-blue-50/80 to-purple-50/60'}`}>
                  <div className="flex items-center gap-2">
                    <div className="p-1.5 rounded-lg bg-gradient-to-br from-blue-500 to-purple-500">
                      <TrendingUp className="w-3.5 h-3.5 text-white" />
                    </div>
                    <CardTitle className="text-sm font-bold">Key Insights</CardTitle>
                  </div>
                </CardHeader>
                <CardContent className="pt-5 space-y-4">
                  {/* Top Tier Performance */}
                  <div className={`relative overflow-hidden p-4 rounded-xl border-2 ${isDarkMode ? 'bg-gradient-to-br from-teal-500/10 via-teal-500/5 to-transparent border-white/10 shadow-[0_3px_10px_rgba(20,184,166,0.2)]' : 'bg-gradient-to-br from-teal-50 via-teal-25 to-white border-white shadow-[0_3px_10px_rgba(20,184,166,0.3)]'}`}>
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <div className="w-1.5 h-1.5 rounded-full bg-teal-500 animate-pulse"></div>
                        <p className={`text-[10px] uppercase tracking-wider font-bold ${isDarkMode ? 'text-teal-400/90' : 'text-teal-600/90'}`}>
                          Top Tier Output
                        </p>
                      </div>
                    </div>
                    <p className={`text-3xl font-bold leading-none mb-2 ${isDarkMode ? 'text-teal-300' : 'text-teal-600'}`}>
                      {selectedActor === 'branch' 
                        ? `${filteredData.length > 0 ? Math.round((filteredData as Branch[]).reduce((sum, b) => sum + b.units, 0) / filteredData.length) : 0}`
                        : `${filteredData.length > 0 ? Math.round((filteredData as LoanOfficer[]).filter(lo => lo.tier === 'top').length / filteredData.length * 100) : 0}`}
                      <span className="text-xl">{selectedActor === 'loan-officer' ? '%' : ''}</span>
                    </p>
                    <p className={`text-xs ${isDarkMode ? 'text-slate-400' : 'text-slate-600'}`}>
                      {selectedActor === 'branch' 
                        ? `${filteredData.length} branches · ${(filteredData as Branch[]).reduce((sum, b) => sum + b.units, 0)} total units`
                        : `${(filteredData as LoanOfficer[]).filter(lo => lo.tier === 'top').length} performers · ${(filteredData as LoanOfficer[]).filter(lo => lo.tier === 'top').reduce((sum, lo) => sum + lo.units, 0)} units`}
                    </p>
                  </div>

                  {/* Revenue Insight */}
                  <div className={`relative overflow-hidden p-4 rounded-xl border-2 ${isDarkMode ? 'bg-gradient-to-br from-blue-500/10 via-blue-500/5 to-transparent border-white/10 shadow-[0_3px_10px_rgba(59,130,246,0.2)]' : 'bg-gradient-to-br from-blue-50 via-blue-25 to-white border-white shadow-[0_3px_10px_rgba(59,130,246,0.3)]'}`}>
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <div className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse"></div>
                        <p className={`text-[10px] uppercase tracking-wider font-bold ${isDarkMode ? 'text-blue-400/90' : 'text-blue-600/90'}`}>
                          Avg Revenue
                        </p>
                      </div>
                    </div>
                    <p className={`text-3xl font-bold leading-none mb-2 ${isDarkMode ? 'text-blue-300' : 'text-blue-600'}`}>
                      {selectedActor === 'branch'
                        ? formatCurrency((filteredData as Branch[]).reduce((sum, b) => sum + b.revenue, 0) / Math.max(filteredData.length, 1))
                        : formatCurrency((filteredData as LoanOfficer[]).reduce((sum, lo) => sum + lo.revenue, 0) / Math.max(filteredData.length, 1))}
                    </p>
                    <p className={`text-xs ${isDarkMode ? 'text-slate-400' : 'text-slate-600'}`}>
                      {selectedActor === 'branch' ? 'Per branch average' : 'Per loan officer average'}
                    </p>
                  </div>

                  {/* Pull Through Insight */}
                  <div className={`relative overflow-hidden p-4 rounded-xl border-2 ${isDarkMode ? 'bg-gradient-to-br from-emerald-500/10 via-emerald-500/5 to-transparent border-white/10 shadow-[0_3px_10px_rgba(16,185,129,0.2)]' : 'bg-gradient-to-br from-emerald-50 via-emerald-25 to-white border-white shadow-[0_3px_10px_rgba(16,185,129,0.3)]'}`}>
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></div>
                        <p className={`text-[10px] uppercase tracking-wider font-bold ${isDarkMode ? 'text-emerald-400/90' : 'text-emerald-600/90'}`}>
                          Avg Pull Through
                        </p>
                      </div>
                    </div>
                    <p className={`text-3xl font-bold leading-none mb-2 ${isDarkMode ? 'text-emerald-300' : 'text-emerald-600'}`}>
                      {selectedActor === 'branch'
                        ? `${((filteredData as Branch[]).reduce((sum, b) => sum + b.pullThrough, 0) / Math.max(filteredData.length, 1)).toFixed(1)}`
                        : `${((filteredData as LoanOfficer[]).reduce((sum, lo) => sum + lo.pullThrough, 0) / Math.max(filteredData.length, 1)).toFixed(1)}`}
                      <span className="text-xl">%</span>
                    </p>
                    <p className={`text-xs ${isDarkMode ? 'text-slate-400' : 'text-slate-600'}`}>
                      Conversion rate performance
                    </p>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Main Content */}
          <div className={`space-y-4 sm:space-y-6 transition-all duration-300 ${isFullscreen ? 'col-span-1' : 'col-span-12 lg:col-span-9'}`}>
            {/* Filter Controls Row */}
            {!isFullscreen && (
            <Card className={`rounded-xl backdrop-blur-sm ${isDarkMode ? 'border-slate-700/50 bg-slate-800/70 shadow-[0_8px_24px_rgba(0,0,0,0.3)]' : 'border-blue-200/40 bg-white shadow-[0_8px_24px_rgba(59,130,246,0.08)]'}`}>
              <CardContent className="pt-6">
                <div className="flex flex-col sm:flex-row gap-3 sm:gap-4">
              {/* Scorecard Actor Tabs */}
              <div>
                <label className={`text-xs font-semibold mb-2 block uppercase tracking-wider ${isDarkMode ? 'text-slate-400' : 'text-slate-600'}`}>
                  Scorecard Actor
                </label>
                <Tabs value={selectedActor} onValueChange={(v) => setSelectedActor(v as ScorecardActor)}>
                  <TabsList className={`grid w-full grid-cols-2 h-10 sm:h-9 ${isDarkMode ? 'bg-slate-900/60 border border-slate-700/50' : 'bg-slate-100/80 border border-slate-300/40'}`}>
                    <TabsTrigger 
                      value="branch"
                      className="text-xs sm:text-xs touch-manipulation data-[state=active]:bg-gradient-to-r data-[state=active]:from-blue-500 data-[state=active]:to-purple-500 data-[state=active]:text-white data-[state=active]:shadow-lg data-[state=active]:shadow-blue-500/25"
                    >
                      Branch
                    </TabsTrigger>
                    <TabsTrigger 
                      value="loan-officer"
                      className="text-xs sm:text-xs touch-manipulation data-[state=active]:bg-gradient-to-r data-[state=active]:from-blue-500 data-[state=active]:to-purple-500 data-[state=active]:text-white data-[state=active]:shadow-lg data-[state=active]:shadow-blue-500/25"
                    >
                      Loan Officer
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>

              {/* Date Range Tabs */}
              <div>
                <label className={`text-xs font-semibold mb-2 block uppercase tracking-wider ${isDarkMode ? 'text-slate-400' : 'text-slate-600'}`}>
                  Date Range
                </label>
                <Tabs value={dateRange} onValueChange={(v) => setDateRange(v as DateRange)}>
                  <TabsList className={`grid w-full grid-cols-2 h-10 sm:h-9 ${isDarkMode ? 'bg-slate-900/60 border border-slate-700/50' : 'bg-slate-100/80 border border-slate-300/40'}`}>
                    <TabsTrigger 
                      value="3-months"
                      className="text-xs sm:text-xs touch-manipulation data-[state=active]:bg-gradient-to-r data-[state=active]:from-teal-500 data-[state=active]:to-teal-600 data-[state=active]:text-white data-[state=active]:shadow-lg data-[state=active]:shadow-teal-500/25"
                    >
                      3 Months
                    </TabsTrigger>
                    <TabsTrigger 
                      value="6-months"
                      className="text-xs sm:text-xs touch-manipulation data-[state=active]:bg-gradient-to-r data-[state=active]:from-teal-500 data-[state=active]:to-teal-600 data-[state=active]:text-white data-[state=active]:shadow-lg data-[state=active]:shadow-teal-500/25"
                    >
                      6 Months
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>
                </div>
              </CardContent>
            </Card>
            )}

            {/* Scorecard Table */}
            <Card className={`rounded-xl backdrop-blur-sm ${isDarkMode ? 'border-slate-700/50 bg-slate-800/70 shadow-[0_8px_24px_rgba(0,0,0,0.3)]' : 'border-blue-200/40 bg-white shadow-[0_8px_24px_rgba(59,130,246,0.08)]'}`}>
              <CardHeader className={`border-b pb-4 ${isDarkMode ? 'border-slate-700/50 bg-gradient-to-r from-slate-800/50 to-slate-700/30' : 'border-blue-100/50 bg-gradient-to-r from-blue-50/30 to-purple-50/30'}`}>
                {/* Tabs and Fullscreen Toggle */}
                <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as ActiveTab)} className="w-full">
                  <div className="flex items-center justify-between mb-4">
                    <TabsList className={`grid w-fit grid-cols-2 h-9 ${isDarkMode ? 'bg-slate-800/60 border border-slate-700/50' : 'bg-blue-50/50 border border-blue-200/30'}`}>
                      <TabsTrigger 
                        value="summary"
                        className="text-sm px-4 data-[state=active]:bg-gradient-to-r data-[state=active]:from-blue-500 data-[state=active]:to-purple-500 data-[state=active]:text-white data-[state=active]:shadow-lg data-[state=active]:shadow-blue-500/25"
                      >
                        Summary
                      </TabsTrigger>
                      <TabsTrigger 
                        value="detail"
                        className="text-sm px-4 data-[state=active]:bg-gradient-to-r data-[state=active]:from-blue-500 data-[state=active]:to-purple-500 data-[state=active]:text-white data-[state=active]:shadow-lg data-[state=active]:shadow-blue-500/25"
                      >
                        Detail
                      </TabsTrigger>
                    </TabsList>
                    
                    {/* Fullscreen Toggle Button */}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setIsFullscreen(!isFullscreen)}
                      className={`gap-2 ${isDarkMode ? 'hover:bg-slate-700' : 'hover:bg-slate-100'}`}
                      title={isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'}
                    >
                      {isFullscreen ? (
                        <>
                          <Minimize2 className="h-4 w-4" />
                          <span className="text-xs">Exit Fullscreen</span>
                        </>
                      ) : (
                        <>
                          <Maximize2 className="h-4 w-4" />
                          <span className="text-xs">Fullscreen</span>
                        </>
                    )}
                  </Button>
                  </div>
                </Tabs>

                {/* Title and Description */}
                <div>
                  <CardTitle className="text-base sm:text-lg font-semibold">
                    RETAIL: Scorecard {activeTab === 'summary' ? 'Summary' : 'Detail'}
                  </CardTitle>
                  <CardDescription className="mt-1">
                    {getDateRangeText()}
                  </CardDescription>
                </div>
              </CardHeader>
              <CardContent>
                {/* Controls Row */}
                <div className="flex items-center gap-4 mb-4 flex-wrap">
                  {/* Search */}
                  <div className="relative flex-1 max-w-xs">
                    <Search className={`absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`} />
                    <Input
                      type="text"
                      placeholder="Search..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className={`pl-9 h-9 ${isDarkMode ? 'bg-slate-800/60 border-slate-700' : 'bg-white border-slate-200'}`}
                    />
                  </div>
                  
                  {/* Action Buttons */}
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className={`gap-2 ${isDarkMode ? 'border-slate-600 hover:bg-slate-800' : 'border-slate-300 hover:bg-slate-50'}`}
                    >
                      <Filter className="h-4 w-4" />
                      Weights
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className={`gap-2 ${isDarkMode ? 'border-slate-600 hover:bg-slate-800' : 'border-slate-300 hover:bg-slate-50'}`}
                    >
                      <BookmarkCheck className="h-4 w-4" />
                      Bookmarks
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        // Export functionality
                        const data = activeTab === 'summary' ? summaryMetrics : filteredData;
                        const csv = convertToCSV(data, activeTab, selectedActor);
                        const blob = new Blob([csv], { type: 'text/csv' });
                        const url = window.URL.createObjectURL(blob);
                        const link = document.createElement('a');
                        link.href = url;
                        link.download = `sales-scorecard-${activeTab}-${selectedActor}-${dateRange}.csv`;
                        link.click();
                      }}
                      className={`gap-2 ${isDarkMode ? 'border-slate-600 hover:bg-slate-800' : 'border-slate-300 hover:bg-slate-50'}`}
                    >
                      <Download className="h-4 w-4" />
                      Export
                    </Button>
                  </div>
                </div>

                {/* Table View */}
                {activeTab === 'summary' ? (
              // Summary Tab - Tier Comparison Table
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
                        <th className={`text-right py-3 px-4 text-sm font-bold bg-gradient-to-br from-teal-500 via-teal-600 to-teal-700 text-white shadow-[0_2px_8px_rgba(20,184,166,0.3)]`}>
                          Top Tier
                        </th>
                        <th className={`text-right py-3 px-4 text-sm font-bold bg-gradient-to-br from-emerald-400 via-emerald-500 to-emerald-600 text-white shadow-[0_2px_8px_rgba(16,185,129,0.3)]`}>
                          Second Tier
                        </th>
                        <th className={`text-right py-3 px-4 text-sm font-bold bg-gradient-to-br from-red-400 via-red-500 to-red-600 text-white shadow-[0_2px_8px_rgba(239,68,68,0.3)]`}>
                          Bottom Tier
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {summaryMetrics.map((metric, index) => {
                        const prevMetric = index > 0 ? summaryMetrics[index - 1] : null;
                        const isCategoryHeader = prevMetric && prevMetric.category !== metric.category;
                        
                        return (
                          <React.Fragment key={index}>
                            {isCategoryHeader && (
                              <tr>
                                <td colSpan={5} className="py-2 px-4 text-xs font-semibold text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-slate-800/50">
                                  Average Conditions
                                </td>
                              </tr>
                            )}
                            <tr className={`border-b transition-colors ${isDarkMode ? 'border-slate-800/50 hover:bg-slate-800/30' : 'border-slate-100 hover:bg-slate-50'}`}>
                              <td className={`py-3 px-4 text-sm sticky left-0 ${isDarkMode ? 'bg-slate-800/90 text-slate-300 border-r border-slate-700 group-hover:bg-slate-800/95' : 'bg-slate-50/90 text-slate-700 border-r border-slate-300 group-hover:bg-slate-50/95'}`}>
                                {metric.metric}
                              </td>
                              <td className={`py-3 px-4 text-sm text-right font-mono ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>
                                {formatMetricValue(metric.metric, metric.totals)}
                              </td>
                              <td className={`py-3 px-4 text-sm text-right font-mono bg-teal-600/10 cursor-pointer hover:bg-teal-600/20 transition-colors ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>
                                {formatMetricValue(metric.metric, metric.topTier)}
                              </td>
                              <td className={`py-3 px-4 text-sm text-right font-mono bg-emerald-500/10 cursor-pointer hover:bg-emerald-500/20 transition-colors ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>
                                {formatMetricValue(metric.metric, metric.secondTier)}
                              </td>
                              <td className={`py-3 px-4 text-sm text-right font-mono bg-red-500/10 cursor-pointer hover:bg-red-500/20 transition-colors ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>
                                {formatMetricValue(metric.metric, metric.bottomTier)}
                              </td>
                            </tr>
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Card>
            ) : (
              // Detail Tab - Branches or Loan Officers Table
              <div className="overflow-x-auto">
                <Card className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden dark:bg-slate-800 dark:border-slate-700">
                <CardHeader className="p-4 bg-slate-50 border-b border-slate-200 dark:bg-slate-800/50 dark:border-slate-700">
                  <CardTitle className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                    {selectedActor === 'branch' ? 'Branches' : 'Loan Officers'}
                  </CardTitle>
                  <p className="text-xs text-slate-400 dark:text-slate-500">
                    Click on a row to zoom into Canvas view
                  </p>
                </CardHeader>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 dark:bg-slate-800/50 dark:border-slate-700">
                        {selectedActor === 'branch' ? (
                          <>
                            <th className="py-2.5 px-4 text-left text-xs font-semibold text-slate-600 dark:text-slate-300">
                              Branch
                            </th>
                            <th className="py-2.5 px-4 text-right text-xs font-semibold text-slate-600 dark:text-slate-300">
                              LO Count
                            </th>
                            <th className="py-2.5 px-4 text-right text-xs font-semibold text-slate-600 dark:text-slate-300">
                              Units
                            </th>
                            <th className="py-2.5 px-4 text-right text-xs font-semibold text-slate-600 dark:text-slate-300">
                              Volume
                            </th>
                            <th className="py-2.5 px-4 text-right text-xs font-semibold text-slate-600 dark:text-slate-300">
                              Revenue
                            </th>
                            <th className="py-2.5 px-4 text-right text-xs font-semibold text-slate-600 dark:text-slate-300">
                              Pull Through
                            </th>
                            <th className="py-2.5 px-4 text-center text-xs font-semibold text-slate-600 dark:text-slate-300">
                              Action
                            </th>
                          </>
                        ) : (
                          <>
                            <th className="py-2.5 px-4 text-left text-xs font-semibold text-slate-600 dark:text-slate-300">
                              Name
                            </th>
                            <th className="py-2.5 px-4 text-left text-xs font-semibold text-slate-600 dark:text-slate-300">
                              Branch
                            </th>
                            <th className="py-2.5 px-4 text-right text-xs font-semibold text-slate-600 dark:text-slate-300">
                              Units
                            </th>
                            <th className="py-2.5 px-4 text-right text-xs font-semibold text-slate-600 dark:text-slate-300">
                              Volume
                            </th>
                            <th className="py-2.5 px-4 text-right text-xs font-semibold text-slate-600 dark:text-slate-300">
                              Revenue
                            </th>
                            <th className="py-2.5 px-4 text-right text-xs font-semibold text-slate-600 dark:text-slate-300">
                              Pull Through
                            </th>
                            <th className="py-2.5 px-4 text-center text-xs font-semibold text-slate-600 dark:text-slate-300">
                              Tier
                            </th>
                            <th className="py-2.5 px-4 text-center text-xs font-semibold text-slate-600 dark:text-slate-300">
                              Action
                            </th>
                          </>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {selectedActor === 'branch' ? (
                        (filteredData as Branch[]).map((branch) => (
                          <tr
                            key={branch.id}
                            className="border-b border-slate-100 hover:bg-slate-50 transition-colors cursor-pointer dark:border-slate-700 dark:hover:bg-slate-800/50"
                          >
                            <td className="py-3 px-4 text-sm font-medium text-slate-800 dark:text-slate-200">
                              {branch.name}
                            </td>
                            <td className="py-3 px-4 text-sm text-right text-slate-700 dark:text-slate-300">
                              {formatNumber(branch.loCount)}
                            </td>
                            <td className="py-3 px-4 text-sm text-right text-slate-700 dark:text-slate-300">
                              {formatNumber(branch.units)}
                            </td>
                            <td className="py-3 px-4 text-sm text-right text-slate-700 dark:text-slate-300">
                              {formatCurrency(branch.volume)}
                            </td>
                            <td className="py-3 px-4 text-sm text-right text-slate-700 dark:text-slate-300">
                              {formatCurrency(branch.revenue)}
                            </td>
                            <td className="py-3 px-4 text-sm text-right text-slate-700 dark:text-slate-300">
                              {branch.pullThrough.toFixed(1)}%
                            </td>
                            <td className="py-3 px-4 text-center">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 px-3 text-xs text-teal-600 hover:text-teal-700 hover:bg-teal-50 dark:text-teal-400 dark:hover:text-teal-300 dark:hover:bg-teal-900/20"
                              >
                                <Plus className="w-3 h-3 mr-1" />
                                Canvas
                              </Button>
                            </td>
                          </tr>
                        ))
                      ) : (
                        (filteredData as LoanOfficer[]).map((officer) => (
                          <tr
                            key={officer.id}
                            className="border-b border-slate-100 hover:bg-slate-50 transition-colors cursor-pointer dark:border-slate-700 dark:hover:bg-slate-800/50"
                          >
                            <td className="py-3 px-4 text-sm font-medium text-slate-800 dark:text-slate-200">
                              {officer.name}
                            </td>
                            <td className="py-3 px-4 text-sm text-slate-600 dark:text-slate-300">
                              {officer.branch}
                            </td>
                            <td className="py-3 px-4 text-sm text-right text-slate-700 dark:text-slate-300">
                              {formatNumber(officer.units)}
                            </td>
                            <td className="py-3 px-4 text-sm text-right text-slate-700 dark:text-slate-300">
                              {formatCurrency(officer.volume)}
                            </td>
                            <td className="py-3 px-4 text-sm text-right text-slate-700 dark:text-slate-300">
                              {formatCurrency(officer.revenue)}
                            </td>
                            <td className="py-3 px-4 text-sm text-right text-slate-700 dark:text-slate-300">
                              {officer.pullThrough.toFixed(1)}%
                            </td>
                            <td className="py-3 px-4 text-center">
                              {getTierBadge(officer.tier)}
                            </td>
                            <td className="py-3 px-4 text-center">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 px-3 text-xs text-teal-600 hover:text-teal-700 hover:bg-teal-50 dark:text-teal-400 dark:hover:text-teal-300 dark:hover:bg-teal-900/20"
                              >
                                <Plus className="w-3 h-3 mr-1" />
                                Canvas
                              </Button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </Card>
              </div>
            )}
              </CardContent>
            </Card>
          </div>
        </div>
      </main>
    </div>
  );
};

export default SalesScorecard;
