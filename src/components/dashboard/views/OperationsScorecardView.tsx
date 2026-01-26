import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useTheme } from '@/components/theme-provider';
import { Search, Download, TrendingUp, TrendingDown, Minus, Info, BarChart3, Filter, Maximize2, Minimize2 } from 'lucide-react';

type ScorecardActor = 'processor' | 'underwriter' | 'closer';
type DateRange = '3-months' | '6-months' | '12-months';

interface ScorecardData {
  underwriterCount: number;
  unitsOutput: number;
  unitsPercent: number;
  volumeOutput: number;
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
}

interface MetricChange {
  value: number;
  percentChange: number;
  trend: 'up' | 'down' | 'flat';
  isPositive: boolean;
}

interface MetricInfo {
  name: string;
  description: string;
  calculation?: string;
  benchmark?: string;
}

interface TierData {
  totals: ScorecardData;
  topTier: ScorecardData;
  secondTier: ScorecardData;
  bottomTier: ScorecardData;
}

// Metric tooltips and information
const metricInfo: Record<string, MetricInfo> = {
  count: {
    name: 'Actor Count',
    description: 'Total number of active team members in each tier',
    benchmark: 'Top performers typically represent 20-30% of team'
  },
  unitsOutput: {
    name: 'Units Output',
    description: 'Total number of loans processed during the period',
    calculation: 'Sum of all closed loans',
    benchmark: 'Industry average: 15-25 units/month per person'
  },
  unitsPercent: {
    name: 'Units % Output',
    description: 'Percentage distribution of total units across tiers',
    calculation: '(Tier Units / Total Units) × 100'
  },
  volumeOutput: {
    name: 'Volume Output',
    description: 'Total dollar volume of loans processed',
    calculation: 'Sum of loan amounts across all closed loans',
    benchmark: 'Target: $2-3M per month per person'
  },
  loanComplexity: {
    name: 'Loan Complexity Score',
    description: 'Weighted score based on loan difficulty factors',
    calculation: 'Composite of government loans (15%), purchase tx (10%), FICO/LTV/DTI risk (5%)',
    benchmark: 'Score > 110 indicates higher complexity portfolio'
  },
  avgUnitsPerMonth: {
    name: 'Average Units Per Month',
    description: 'Monthly average loan output per person',
    calculation: 'Total Units / Number of Months / Team Count'
  },
  avgDays: {
    name: 'Average Days',
    description: 'Average time from application to closing',
    calculation: 'Sum of processing days / Total Units',
    benchmark: 'Target: 5-7 days for conventional, 10-14 for government'
  },
  compensation: {
    name: 'Compensation $',
    description: 'Total compensation paid (data not currently available)',
    calculation: 'Sum of base salary + bonuses + commissions'
  },
  costPerFile: {
    name: 'Cost Per File',
    description: 'Average cost to process each loan (data not currently available)',
    calculation: 'Total Compensation / Total Units'
  },
  approvedPercent: {
    name: '% Approved',
    description: 'Percentage of loans approved for underwriting',
    calculation: '(Approved Loans / Total Decisions) × 100',
    benchmark: 'Industry average: 75-85%'
  },
  deniedPercent: {
    name: '% Denied',
    description: 'Percentage of loans denied',
    calculation: '(Denied Loans / Total Decisions) × 100',
    benchmark: 'Target: < 10%'
  },
  governmentPercent: {
    name: 'Government %',
    description: 'Percentage of government-backed loans (FHA, VA, USDA)',
    calculation: '(Government Loans / Total Units) × 100'
  },
  purchasePercent: {
    name: 'Purchase %',
    description: 'Percentage of purchase transactions vs refinances',
    calculation: '(Purchase Loans / Total Units) × 100'
  },
  waFico: {
    name: 'WA FICO',
    description: 'Weighted average FICO credit score',
    calculation: 'Weighted by loan amount',
    benchmark: '720+ is excellent, 640-719 is good'
  },
  waLtv: {
    name: 'WA LTV',
    description: 'Weighted average loan-to-value ratio',
    calculation: 'Weighted by loan amount',
    benchmark: '< 80% is preferred, > 95% is high risk'
  }
};

// Previous period comparison data (mocked - would come from API)
const mockPreviousData: TierData = {
  totals: {
    underwriterCount: 8,
    unitsOutput: 2050,
    unitsPercent: 100.0,
    volumeOutput: 478000000,
    loanComplexityScore: 115.2,
    avgUnitsPerMonth: 20,
    avgDays: 6.10,
    compensation: '-',
    costPerFile: '-',
    approvedPercent: 90.5,
    deniedPercent: 1.8,
    governmentPercent: 52.1,
    purchasePercent: 43.8,
    waFico: 712,
    waLtv: 81.2,
  },
  topTier: {
    underwriterCount: 3,
    unitsOutput: 1450,
    unitsPercent: 70.7,
    volumeOutput: 340000000,
    loanComplexityScore: 115.5,
    avgUnitsPerMonth: 37,
    avgDays: 5.95,
    compensation: '-',
    costPerFile: '-',
    approvedPercent: 91.8,
    deniedPercent: 1.9,
    governmentPercent: 50.2,
    purchasePercent: 48.5,
    waFico: 714,
    waLtv: 82.0,
  },
  secondTier: {
    underwriterCount: 2,
    unitsOutput: 510,
    unitsPercent: 24.9,
    volumeOutput: 112000000,
    loanComplexityScore: 113.8,
    avgUnitsPerMonth: 20,
    avgDays: 6.58,
    compensation: '-',
    costPerFile: '-',
    approvedPercent: 94.2,
    deniedPercent: 1.5,
    governmentPercent: 56.8,
    purchasePercent: 28.4,
    waFico: 704,
    waLtv: 78.1,
  },
  bottomTier: {
    underwriterCount: 3,
    unitsOutput: 90,
    unitsPercent: 4.4,
    volumeOutput: 26000000,
    loanComplexityScore: 118.5,
    avgUnitsPerMonth: 2,
    avgDays: 4.50,
    compensation: '-',
    costPerFile: '-',
    approvedPercent: 65.2,
    deniedPercent: 1.2,
    governmentPercent: 48.0,
    purchasePercent: 52.1,
    waFico: 715,
    waLtv: 85.2,
  },
};

// Mock data - replace with API call
const mockData: TierData = {
  totals: {
    underwriterCount: 8,
    unitsOutput: 2167,
    unitsPercent: 100.0,
    volumeOutput: 496841208,
    loanComplexityScore: 113.7,
    avgUnitsPerMonth: 21,
    avgDays: 5.81,
    compensation: '-',
    costPerFile: '-',
    approvedPercent: 92.8,
    deniedPercent: 1.4,
    governmentPercent: 50.2,
    purchasePercent: 45.2,
    waFico: 714,
    waLtv: 80.4,
  },
  topTier: {
    underwriterCount: 3,
    unitsOutput: 1521,
    unitsPercent: 70.2,
    volumeOutput: 354468599,
    loanComplexityScore: 113.9,
    avgUnitsPerMonth: 39,
    avgDays: 5.70,
    compensation: '-',
    costPerFile: '-',
    approvedPercent: 93.4,
    deniedPercent: 1.6,
    governmentPercent: 48.7,
    purchasePercent: 50.3,
    waFico: 716,
    waLtv: 81.3,
  },
  secondTier: {
    underwriterCount: 2,
    unitsOutput: 549,
    unitsPercent: 25.3,
    volumeOutput: 116312874,
    loanComplexityScore: 112.3,
    avgUnitsPerMonth: 21,
    avgDays: 6.36,
    compensation: '-',
    costPerFile: '-',
    approvedPercent: 95.4,
    deniedPercent: 0.9,
    governmentPercent: 55.0,
    purchasePercent: 29.1,
    waFico: 706,
    waLtv: 76.8,
  },
  bottomTier: {
    underwriterCount: 3,
    unitsOutput: 97,
    unitsPercent: 4.5,
    volumeOutput: 26059735,
    loanComplexityScore: 117.9,
    avgUnitsPerMonth: 2,
    avgDays: 4.24,
    compensation: '-',
    costPerFile: '-',
    approvedPercent: 68.0,
    deniedPercent: 1.0,
    governmentPercent: 46.4,
    purchasePercent: 55.7,
    waFico: 717,
    waLtv: 84.0,
  },
};

export function OperationsScorecardView() {
  const { theme } = useTheme();
  const isDarkMode = theme === 'dark';
  // Initialize from localStorage or defaults
  const [selectedActor, setSelectedActor] = useState<ScorecardActor>(() => {
    const saved = localStorage.getItem('op-scorecard-actor');
    return (saved as ScorecardActor) || 'underwriter';
  });
  const [dateRange, setDateRange] = useState<DateRange>(() => {
    const saved = localStorage.getItem('op-scorecard-dateRange');
    return (saved as DateRange) || '3-months';
  });
  const [scorecardView, setScorecardView] = useState<'summary' | 'detail' | 'charts'>(() => {
    const saved = localStorage.getItem('op-scorecard-view');
    return (saved as 'summary' | 'detail' | 'charts') || 'summary';
  });
  const [searchQuery, setSearchQuery] = useState('');
  const [showComparison, setShowComparison] = useState(() => {
    const saved = localStorage.getItem('op-scorecard-showComparison');
    return saved === 'true';
  });
  const [drilldownModal, setDrilldownModal] = useState<{
    isOpen: boolean;
    tier: 'top' | 'second' | 'bottom' | null;
    metric: string | null;
  }>({ isOpen: false, tier: null, metric: null });
  const [activeFilters, setActiveFilters] = useState<string[]>([]);
  const [showFilterPanel, setShowFilterPanel] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Persist preferences to localStorage
  useEffect(() => {
    localStorage.setItem('op-scorecard-actor', selectedActor);
  }, [selectedActor]);

  useEffect(() => {
    localStorage.setItem('op-scorecard-dateRange', dateRange);
  }, [dateRange]);

  useEffect(() => {
    localStorage.setItem('op-scorecard-view', scorecardView);
  }, [scorecardView]);

  useEffect(() => {
    localStorage.setItem('op-scorecard-showComparison', showComparison.toString());
  }, [showComparison]);

  const formatNumber = (num: number) => num.toLocaleString();
  const formatCurrency = (num: number) => `$${num.toLocaleString()}`;
  const formatPercent = (num: number) => `${num.toFixed(1)}%`;

  // Calculate trend indicator
  const calculateChange = (current: number, previous: number, higherIsBetter: boolean = true): MetricChange => {
    const diff = current - previous;
    const percentChange = previous !== 0 ? (diff / previous) * 100 : 0;
    const trend: 'up' | 'down' | 'flat' = Math.abs(percentChange) < 0.5 ? 'flat' : diff > 0 ? 'up' : 'down';
    const isPositive = higherIsBetter ? diff > 0 : diff < 0;
    
    return {
      value: diff,
      percentChange,
      trend,
      isPositive
    };
  };

  // Render trend indicator
  const TrendIndicator = ({ change, compact = false }: { change: MetricChange, compact?: boolean }) => {
    if (change.trend === 'flat') {
      return (
        <span className={`inline-flex items-center gap-1 text-xs ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>
          <Minus className="w-3 h-3" />
          {!compact && <span>0%</span>}
        </span>
      );
    }

    const Icon = change.trend === 'up' ? TrendingUp : TrendingDown;
    const colorClass = change.isPositive 
      ? 'text-emerald-600 dark:text-emerald-400' 
      : 'text-red-600 dark:text-red-400';

    return (
      <span className={`inline-flex items-center gap-1 text-xs font-medium ${colorClass}`}>
        <Icon className="w-3 h-3" />
        {!compact && <span>{Math.abs(change.percentChange).toFixed(1)}%</span>}
      </span>
    );
  };

  // Handle drilldown click
  const handleTierClick = (tier: 'top' | 'second' | 'bottom', metric: string) => {
    setDrilldownModal({ isOpen: true, tier, metric });
  };

  // Get tier display data
  const getTierData = (tier: 'top' | 'second' | 'bottom') => {
    switch (tier) {
      case 'top':
        return { name: 'Top Tier', data: mockData.topTier, color: 'teal' };
      case 'second':
        return { name: 'Second Tier', data: mockData.secondTier, color: 'emerald' };
      case 'bottom':
        return { name: 'Bottom Tier', data: mockData.bottomTier, color: 'lime' };
    }
  };

  // Export to Excel function
  const exportToExcel = () => {
    const timestamp = new Date().toISOString().split('T')[0];
    const filename = `operation-scorecard-${selectedActor}-${dateRange}-${timestamp}.csv`;
    
    // Build CSV content
    let csv = `Operation Scorecard - ${selectedActor.charAt(0).toUpperCase() + selectedActor.slice(1)}\n`;
    csv += `Date Range: ${dateRange}\n`;
    csv += `Generated: ${new Date().toLocaleString()}\n\n`;
    
    csv += `Metric,Totals,Top Tier,Second Tier,Bottom Tier\n`;
    csv += `${selectedActor.charAt(0).toUpperCase() + selectedActor.slice(1)} Count,${mockData.totals.underwriterCount},${mockData.topTier.underwriterCount},${mockData.secondTier.underwriterCount},${mockData.bottomTier.underwriterCount}\n`;
    csv += `Units Output,${mockData.totals.unitsOutput},${mockData.topTier.unitsOutput},${mockData.secondTier.unitsOutput},${mockData.bottomTier.unitsOutput}\n`;
    csv += `Units % Output,${mockData.totals.unitsPercent}%,${mockData.topTier.unitsPercent}%,${mockData.secondTier.unitsPercent}%,${mockData.bottomTier.unitsPercent}%\n`;
    csv += `Volume Output,$${mockData.totals.volumeOutput},$${mockData.topTier.volumeOutput},$${mockData.secondTier.volumeOutput},$${mockData.bottomTier.volumeOutput}\n`;
    csv += `Loan Complexity Score,${mockData.totals.loanComplexityScore},${mockData.topTier.loanComplexityScore},${mockData.secondTier.loanComplexityScore},${mockData.bottomTier.loanComplexityScore}\n`;
    csv += `Avg Units Per Month,${mockData.totals.avgUnitsPerMonth},${mockData.topTier.avgUnitsPerMonth},${mockData.secondTier.avgUnitsPerMonth},${mockData.bottomTier.avgUnitsPerMonth}\n`;
    csv += `Average Days,${mockData.totals.avgDays},${mockData.topTier.avgDays},${mockData.secondTier.avgDays},${mockData.bottomTier.avgDays}\n`;
    csv += `% Approved,${mockData.totals.approvedPercent}%,${mockData.topTier.approvedPercent}%,${mockData.secondTier.approvedPercent}%,${mockData.bottomTier.approvedPercent}%\n`;
    csv += `% Denied,${mockData.totals.deniedPercent}%,${mockData.topTier.deniedPercent}%,${mockData.secondTier.deniedPercent}%,${mockData.bottomTier.deniedPercent}%\n`;
    csv += `Government %,${mockData.totals.governmentPercent}%,${mockData.topTier.governmentPercent}%,${mockData.secondTier.governmentPercent}%,${mockData.bottomTier.governmentPercent}%\n`;
    csv += `Purchase %,${mockData.totals.purchasePercent}%,${mockData.topTier.purchasePercent}%,${mockData.secondTier.purchasePercent}%,${mockData.bottomTier.purchasePercent}%\n`;
    csv += `WA FICO,${mockData.totals.waFico},${mockData.topTier.waFico},${mockData.secondTier.waFico},${mockData.bottomTier.waFico}\n`;
    csv += `WA LTV,${mockData.totals.waLtv}%,${mockData.topTier.waLtv}%,${mockData.secondTier.waLtv}%,${mockData.bottomTier.waLtv}%\n`;
    
    // Create download
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
  };

  return (
    <>
      <div className={`relative mx-auto px-6 py-6 transition-all duration-300 ${isFullscreen ? 'max-w-full' : 'max-w-[1800px]'}`}>
        <div className={`grid gap-6 transition-all duration-300 ${isFullscreen ? 'grid-cols-1' : 'grid-cols-12'}`}>
          {/* Left Sidebar - Weights & Insights */}
          {!isFullscreen && (
            <div className="col-span-12 lg:col-span-3 space-y-6">
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

                {/* Turn Time */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className={`text-sm font-medium ${isDarkMode ? 'text-blue-400' : 'text-blue-600'}`}>
                      Turn Time
                    </span>
                    <Badge variant="secondary" className="font-mono">15%</Badge>
                  </div>
                  <div className={`h-3 rounded-full overflow-hidden backdrop-blur-sm ${isDarkMode ? 'bg-slate-800/60 border border-slate-700/50' : 'bg-slate-200/80 border border-slate-300/40'}`}>
                    <div 
                      className="h-full bg-gradient-to-r from-blue-600 to-blue-400 rounded-full shadow-lg shadow-blue-500/30 transition-all duration-1000 ease-out animate-in slide-in-from-left delay-150" 
                      style={{ width: '15%' }} 
                    />
                  </div>
                  <p className={`text-xs mt-1.5 ${isDarkMode ? 'text-slate-500' : 'text-slate-500'}`}>
                    Turn Time Weight: 15%
                  </p>
                </div>

                {/* Loan Complexity */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className={`text-sm font-medium ${isDarkMode ? 'text-amber-400' : 'text-amber-600'}`}>
                      Loan Complexity
                    </span>
                    <Badge variant="secondary" className="font-mono">15%</Badge>
                  </div>
                  <div className={`h-3 rounded-full overflow-hidden backdrop-blur-sm ${isDarkMode ? 'bg-slate-800/60 border border-slate-700/50' : 'bg-slate-200/80 border border-slate-300/40'}`}>
                    <div 
                      className="h-full bg-gradient-to-r from-amber-600 to-amber-400 rounded-full shadow-lg shadow-amber-500/30 transition-all duration-1000 ease-out animate-in slide-in-from-left delay-300" 
                      style={{ width: '15%' }} 
                    />
                  </div>
                  <p className={`text-xs mt-1.5 ${isDarkMode ? 'text-slate-500' : 'text-slate-500'}`}>
                    Loan Complexity Weight: 15%
                  </p>
                </div>
                  </CardContent>
                </TabsContent>

                {/* Story Tab Content */}
                <TabsContent value="story" className="mt-0">
                  <CardContent className="space-y-4">
                    <div>
                      <h3 className={`text-sm font-semibold mb-2 ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>
                        TopTiering Methodology
                      </h3>
                      <p className={`text-xs leading-relaxed ${isDarkMode ? 'text-slate-400' : 'text-slate-600'}`}>
                        Our proprietary TopTiering system evaluates performance across three key dimensions to create a holistic view of operational excellence.
                      </p>
                    </div>

                    <div className={`p-3 rounded-lg ${isDarkMode ? 'bg-slate-800/50' : 'bg-blue-50/30'}`}>
                      <h4 className={`text-xs font-semibold mb-1.5 flex items-center gap-1.5 ${isDarkMode ? 'text-emerald-400' : 'text-emerald-600'}`}>
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                        Units (70%)
                      </h4>
                      <p className={`text-[11px] leading-relaxed ${isDarkMode ? 'text-slate-400' : 'text-slate-600'}`}>
                        Volume-based output measuring productivity and throughput capacity. This is the primary driver of tiering.
                      </p>
                    </div>

                    <div className={`p-3 rounded-lg ${isDarkMode ? 'bg-slate-800/50' : 'bg-blue-50/30'}`}>
                      <h4 className={`text-xs font-semibold mb-1.5 flex items-center gap-1.5 ${isDarkMode ? 'text-blue-400' : 'text-blue-600'}`}>
                        <span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span>
                        Turn Time (15%)
                      </h4>
                      <p className={`text-[11px] leading-relaxed ${isDarkMode ? 'text-slate-400' : 'text-slate-600'}`}>
                        Speed and efficiency metrics tracking average days to completion and process velocity.
                      </p>
                    </div>

                    <div className={`p-3 rounded-lg ${isDarkMode ? 'bg-slate-800/50' : 'bg-blue-50/30'}`}>
                      <h4 className={`text-xs font-semibold mb-1.5 flex items-center gap-1.5 ${isDarkMode ? 'text-amber-400' : 'text-amber-600'}`}>
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
                        Loan Complexity (15%)
                      </h4>
                      <p className={`text-[11px] leading-relaxed ${isDarkMode ? 'text-slate-400' : 'text-slate-600'}`}>
                        Weighted scoring of deal difficulty factors including government loans, purchase transactions, and risk indicators.
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
                 {/* Insight 1: Top Tier Performance */}
                 <div className={`relative overflow-hidden p-4 rounded-xl border-2 ${isDarkMode ? 'bg-gradient-to-br from-teal-500/10 via-teal-500/5 to-transparent border-white/10 shadow-[0_3px_10px_rgba(20,184,166,0.2)]' : 'bg-gradient-to-br from-teal-50 via-teal-25 to-white border-white shadow-[0_3px_10px_rgba(20,184,166,0.3)]'}`}>
                   <div className="flex items-center justify-between mb-3">
                     <div className="flex items-center gap-2">
                       <div className="w-1.5 h-1.5 rounded-full bg-teal-500 animate-pulse"></div>
                       <p className={`text-[10px] uppercase tracking-wider font-bold ${isDarkMode ? 'text-teal-400/90' : 'text-teal-600/90'}`}>
                         Top Tier Output
                       </p>
                     </div>
                     {showComparison && (
                       <TrendIndicator 
                         change={calculateChange(mockData.topTier.unitsOutput, mockPreviousData.topTier.unitsOutput)} 
                       />
                     )}
                   </div>
                   <p className={`text-3xl font-bold leading-none mb-2 ${isDarkMode ? 'text-teal-300' : 'text-teal-600'}`}>
                     {mockData.topTier.unitsPercent.toFixed(1)}<span className="text-xl">%</span>
                   </p>
                   <p className={`text-xs ${isDarkMode ? 'text-slate-400' : 'text-slate-600'}`}>
                     {mockData.topTier.underwriterCount} performers · {formatNumber(mockData.topTier.unitsOutput)} units
                   </p>
                 </div>

                 {/* Insight 2: Turn Time */}
                 <div className={`relative overflow-hidden p-4 rounded-xl border-2 ${isDarkMode ? 'bg-gradient-to-br from-blue-500/10 via-blue-500/5 to-transparent border-white/10 shadow-[0_3px_10px_rgba(59,130,246,0.2)]' : 'bg-gradient-to-br from-blue-50 via-blue-25 to-white border-white shadow-[0_3px_10px_rgba(59,130,246,0.3)]'}`}>
                   <div className="flex items-center justify-between mb-3">
                     <div className="flex items-center gap-2">
                       <div className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse"></div>
                       <p className={`text-[10px] uppercase tracking-wider font-bold ${isDarkMode ? 'text-blue-400/90' : 'text-blue-600/90'}`}>
                         Avg Turn Time
                       </p>
                     </div>
                     {showComparison && (
                       <TrendIndicator 
                         change={calculateChange(mockData.totals.avgDays, mockPreviousData.totals.avgDays, false)} 
                       />
                     )}
                   </div>
                   <p className={`text-3xl font-bold leading-none mb-2 ${isDarkMode ? 'text-blue-300' : 'text-blue-600'}`}>
                     {mockData.totals.avgDays.toFixed(1)} <span className="text-base font-normal opacity-70">days</span>
                   </p>
                   <p className={`text-xs ${isDarkMode ? 'text-slate-400' : 'text-slate-600'}`}>
                     {mockData.totals.avgDays < 6 ? '🎉 Excellent performance' : mockData.totals.avgDays < 8 ? '✓ On target' : '⚠️ Needs attention'}
                   </p>
                 </div>

                 {/* Insight 3: Approval Rate */}
                 <div className={`relative overflow-hidden p-4 rounded-xl border-2 ${isDarkMode ? 'bg-gradient-to-br from-emerald-500/10 via-emerald-500/5 to-transparent border-white/10 shadow-[0_3px_10px_rgba(16,185,129,0.2)]' : 'bg-gradient-to-br from-emerald-50 via-emerald-25 to-white border-white shadow-[0_3px_10px_rgba(16,185,129,0.3)]'}`}>
                   <div className="flex items-center justify-between mb-3">
                     <div className="flex items-center gap-2">
                       <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></div>
                       <p className={`text-[10px] uppercase tracking-wider font-bold ${isDarkMode ? 'text-emerald-400/90' : 'text-emerald-600/90'}`}>
                         Approval Rate
                       </p>
                     </div>
                     {showComparison && (
                       <TrendIndicator 
                         change={calculateChange(mockData.totals.approvedPercent, mockPreviousData.totals.approvedPercent)} 
                       />
                     )}
                   </div>
                   <p className={`text-3xl font-bold leading-none mb-2 ${isDarkMode ? 'text-emerald-300' : 'text-emerald-600'}`}>
                     {mockData.totals.approvedPercent.toFixed(1)}<span className="text-xl">%</span>
                   </p>
                   <p className={`text-xs ${isDarkMode ? 'text-slate-400' : 'text-slate-600'}`}>
                     {mockData.totals.deniedPercent.toFixed(1)}% denied · High quality
                   </p>
                 </div>

                 {/* Action Required Alert */}
                 {mockData.bottomTier.underwriterCount > 0 && (
                   <div className={`relative overflow-hidden p-4 rounded-xl border-2 ${isDarkMode ? 'bg-gradient-to-br from-amber-500/10 via-amber-500/5 to-transparent border-white/10 shadow-[0_3px_10px_rgba(245,158,11,0.2)]' : 'bg-gradient-to-br from-amber-50 via-amber-25 to-white border-white shadow-[0_3px_10px_rgba(245,158,11,0.3)]'}`}>
                     <div className="flex items-start gap-3">
                       <Info className={`w-4 h-4 mt-0.5 flex-shrink-0 ${isDarkMode ? 'text-amber-400' : 'text-amber-600'}`} />
                       <div className="flex-1 min-w-0">
                         <p className={`text-[10px] uppercase tracking-wider font-bold mb-2 ${isDarkMode ? 'text-amber-400/90' : 'text-amber-600/90'}`}>
                           Action Required
                         </p>
                         <p className={`text-xs leading-relaxed ${isDarkMode ? 'text-slate-300' : 'text-slate-700'}`}>
                           {mockData.bottomTier.underwriterCount} team member{mockData.bottomTier.underwriterCount > 1 ? 's' : ''} in bottom tier ({mockData.bottomTier.unitsPercent.toFixed(1)}%). Consider coaching.
                         </p>
                       </div>
                     </div>
                   </div>
                 )}
               </CardContent>
            </Card>
          </div>
          )}

          {/* Main Content */}
          <div className={`space-y-6 transition-all duration-300 ${isFullscreen ? 'col-span-1' : 'col-span-12 lg:col-span-9'}`}>
            {/* Controls */}
            {!isFullscreen && (
              <Card className={`rounded-xl backdrop-blur-sm ${isDarkMode ? 'border-slate-700/50 bg-slate-800/70 shadow-[0_8px_24px_rgba(0,0,0,0.3)]' : 'border-blue-200/40 bg-white shadow-[0_8px_24px_rgba(59,130,246,0.08)]'}`}>
              <CardContent className="pt-6">
                <div className="flex flex-col sm:flex-row gap-6">
                  {/* Actor Selection */}
                  <div className="flex-1">
                    <label className={`text-sm font-medium mb-3 block ${isDarkMode ? 'text-slate-300' : 'text-slate-700'}`}>
                      Choose Scorecard Actor
                    </label>
                    <Tabs value={selectedActor} onValueChange={(v) => setSelectedActor(v as ScorecardActor)}>
                      <TabsList className={`grid w-full grid-cols-3 rounded-lg ${isDarkMode ? 'bg-slate-800/60 border border-slate-700/50' : 'bg-blue-50/50 border border-blue-200/30'}`}>
                        <TabsTrigger 
                          value="processor"
                          className="data-[state=active]:bg-gradient-to-r data-[state=active]:from-blue-500 data-[state=active]:to-purple-500 data-[state=active]:text-white data-[state=active]:shadow-lg data-[state=active]:shadow-blue-500/25"
                        >
                          Processor
                        </TabsTrigger>
                        <TabsTrigger 
                          value="underwriter"
                          className="data-[state=active]:bg-gradient-to-r data-[state=active]:from-blue-500 data-[state=active]:to-purple-500 data-[state=active]:text-white data-[state=active]:shadow-lg data-[state=active]:shadow-blue-500/25"
                        >
                          Underwriter
                        </TabsTrigger>
                        <TabsTrigger 
                          value="closer"
                          className="data-[state=active]:bg-gradient-to-r data-[state=active]:from-blue-500 data-[state=active]:to-purple-500 data-[state=active]:text-white data-[state=active]:shadow-lg data-[state=active]:shadow-blue-500/25"
                        >
                          Closer
                        </TabsTrigger>
                      </TabsList>
                    </Tabs>
                  </div>

                  {/* Date Range Selection */}
                  <div className="flex-1">
                    <label className={`text-sm font-medium mb-3 block ${isDarkMode ? 'text-slate-300' : 'text-slate-700'}`}>
                      Choose Short Term Comparison Date Range
                    </label>
                    <Tabs value={dateRange} onValueChange={(v) => setDateRange(v as DateRange)}>
                      <TabsList className={`grid w-full grid-cols-3 rounded-lg ${isDarkMode ? 'bg-slate-800/60 border border-slate-700/50' : 'bg-blue-50/50 border border-blue-200/30'}`}>
                        <TabsTrigger 
                          value="3-months"
                          className="data-[state=active]:bg-gradient-to-r data-[state=active]:from-blue-500 data-[state=active]:to-purple-500 data-[state=active]:text-white data-[state=active]:shadow-lg data-[state=active]:shadow-blue-500/25"
                        >
                          3 Months
                        </TabsTrigger>
                        <TabsTrigger 
                          value="6-months"
                          className="data-[state=active]:bg-gradient-to-r data-[state=active]:from-blue-500 data-[state=active]:to-purple-500 data-[state=active]:text-white data-[state=active]:shadow-lg data-[state=active]:shadow-blue-500/25"
                        >
                          6 Months
                        </TabsTrigger>
                        <TabsTrigger 
                          value="12-months"
                          className="data-[state=active]:bg-gradient-to-r data-[state=active]:from-blue-500 data-[state=active]:to-purple-500 data-[state=active]:text-white data-[state=active]:shadow-lg data-[state=active]:shadow-blue-500/25"
                        >
                          12 Months
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
                <Tabs value={scorecardView} onValueChange={(v) => setScorecardView(v as 'summary' | 'detail' | 'charts')} className="w-full">
                  <div className="flex items-center justify-between mb-4">
                    <TabsList className={`grid w-fit grid-cols-3 h-9 ${isDarkMode ? 'bg-slate-800/60 border border-slate-700/50' : 'bg-blue-50/50 border border-blue-200/30'}`}>
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
                        Details
                      </TabsTrigger>
                      <TabsTrigger 
                        value="charts"
                        className="text-sm px-4 data-[state=active]:bg-gradient-to-r data-[state=active]:from-blue-500 data-[state=active]:to-purple-500 data-[state=active]:text-white data-[state=active]:shadow-lg data-[state=active]:shadow-blue-500/25"
                      >
                        <BarChart3 className="w-4 h-4 mr-1.5 inline" />
                        Charts
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
                  <CardTitle>{selectedActor.charAt(0).toUpperCase() + selectedActor.slice(1)} Output Scorecard {scorecardView === 'summary' ? 'Summary' : ''}</CardTitle>
                  <CardDescription className="mt-1">
                    Displays data for last {dateRange === '3-months' ? '3 months' : dateRange === '6-months' ? '6 months' : '12 months'}: 1/1/2025 to 12/31/2025
                  </CardDescription>
                </div>
              </CardHeader>
              <CardContent>
                {/* Controls Row */}
                <div className="flex items-center gap-4 mb-4 flex-wrap">
                  {/* Filter Toggle Button */}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowFilterPanel(!showFilterPanel)}
                    className={`gap-2 ${isDarkMode ? 'border-slate-600 hover:bg-slate-800' : 'border-slate-300 hover:bg-slate-50'} ${showFilterPanel ? 'bg-blue-50 border-blue-300' : ''}`}
                  >
                    <Filter className="h-4 w-4" />
                    Filters {activeFilters.length > 0 && `(${activeFilters.length})`}
                  </Button>
                  <Badge variant="outline" className={`${isDarkMode ? 'border-slate-600 text-slate-300' : 'border-slate-300 text-slate-700'}`}>
                    Values
                  </Badge>
                  <div className="relative flex-1 max-w-xs">
                    <Search className={`absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`} />
                    <Input
                      type="text"
                      placeholder="13 Month TVI..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className={`pl-9 h-9 ${isDarkMode ? 'bg-slate-800/60 border-slate-700' : 'bg-white border-slate-200'}`}
                    />
                  </div>
                  
                  {/* Comparison Toggle */}
                  <div className="flex items-center gap-2">
                    <Checkbox 
                      id="compare" 
                      checked={showComparison}
                      onCheckedChange={(checked) => setShowComparison(checked as boolean)}
                    />
                    <Label htmlFor="compare" className={`text-sm cursor-pointer ${isDarkMode ? 'text-slate-300' : 'text-slate-700'}`}>
                      Compare to Previous Period
                    </Label>
                  </div>

                  {/* Export Button */}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={exportToExcel}
                    className={`ml-auto gap-2 ${isDarkMode ? 'border-slate-600 hover:bg-slate-800' : 'border-slate-300 hover:bg-slate-50'}`}
                  >
                    <Download className="h-4 w-4" />
                    Export to Excel
                  </Button>
                </div>

                {/* Advanced Filter Panel */}
                {showFilterPanel && (
                  <div className={`mb-4 p-4 rounded-lg border ${isDarkMode ? 'bg-slate-800/50 border-slate-700' : 'bg-blue-50/30 border-blue-200/50'}`}>
                    <div className="flex items-center justify-between mb-3">
                      <h4 className={`text-sm font-semibold ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>
                        Advanced Filters
                      </h4>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setActiveFilters([])}
                        className="text-xs h-7"
                      >
                        Clear All
                      </Button>
                    </div>
                    
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      {/* Metric Category Filters */}
                      {[
                        { id: 'productivity', label: 'Productivity', metrics: ['Units', 'Volume', 'Avg Units/Month'] },
                        { id: 'efficiency', label: 'Efficiency', metrics: ['Avg Days', 'Turn Time'] },
                        { id: 'quality', label: 'Quality', metrics: ['Approved %', 'Denied %'] },
                        { id: 'portfolio', label: 'Portfolio Mix', metrics: ['Government %', 'Purchase %'] },
                        { id: 'risk', label: 'Risk Indicators', metrics: ['FICO', 'LTV', 'Complexity'] },
                        { id: 'cost', label: 'Cost Metrics', metrics: ['Compensation', 'Cost/File'] },
                      ].map((category) => (
                        <div key={category.id}>
                          <Checkbox
                            id={category.id}
                            checked={activeFilters.includes(category.id)}
                            onCheckedChange={(checked) => {
                              if (checked) {
                                setActiveFilters([...activeFilters, category.id]);
                              } else {
                                setActiveFilters(activeFilters.filter(f => f !== category.id));
                              }
                            }}
                          />
                          <Label htmlFor={category.id} className={`ml-2 text-sm cursor-pointer ${isDarkMode ? 'text-slate-300' : 'text-slate-700'}`}>
                            {category.label}
                          </Label>
                          <p className={`text-xs ml-6 mt-0.5 ${isDarkMode ? 'text-slate-500' : 'text-slate-500'}`}>
                            {category.metrics.join(', ')}
                          </p>
                        </div>
                      ))}
                    </div>

                    {activeFilters.length > 0 && (
                      <div className="mt-3 pt-3 border-t border-slate-300 dark:border-slate-700">
                        <p className={`text-xs ${isDarkMode ? 'text-slate-400' : 'text-slate-600'}`}>
                          Active filters: {activeFilters.length} selected
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {/* Table View */}
                {(scorecardView === 'summary' || scorecardView === 'detail') && (
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
                        <th className={`text-right py-3 px-4 text-sm font-bold bg-gradient-to-br from-lime-400 via-lime-500 to-lime-600 text-white shadow-[0_2px_8px_rgba(132,204,22,0.3)]`}>
                          Bottom Tier
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {/* Actor Count */}
                      <tr className={`border-b transition-colors ${isDarkMode ? 'border-slate-800/50 hover:bg-slate-800/30' : 'border-slate-100 hover:bg-slate-50'}`}>
                        <td className={`py-3 px-4 text-sm sticky left-0 ${isDarkMode ? 'bg-slate-800/90 text-slate-300 border-r border-slate-700 group-hover:bg-slate-800/95' : 'bg-slate-50/90 text-slate-700 border-r border-slate-300 group-hover:bg-slate-50/95'}`}>
                          <Tooltip>
                            <TooltipTrigger className="flex items-center gap-1.5 cursor-help">
                              {selectedActor.charAt(0).toUpperCase() + selectedActor.slice(1)} Count
                              <Info className="w-3 h-3 text-slate-400" />
                            </TooltipTrigger>
                            <TooltipContent className="max-w-xs">
                              <p className="font-semibold mb-1">{metricInfo.count.name}</p>
                              <p className="text-xs text-slate-400 mb-2">{metricInfo.count.description}</p>
                              {metricInfo.count.benchmark && (
                                <p className="text-xs text-emerald-400 mt-1">📊 {metricInfo.count.benchmark}</p>
                              )}
                            </TooltipContent>
                          </Tooltip>
                        </td>
                        <td className={`py-3 px-4 text-sm text-right font-mono ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>
                          <div className="flex items-center justify-end gap-2">
                            <span>{mockData.totals.underwriterCount}</span>
                            {showComparison && (
                              <TrendIndicator change={calculateChange(mockData.totals.underwriterCount, mockPreviousData.totals.underwriterCount)} compact />
                            )}
                          </div>
                        </td>
                        <td 
                          className={`py-3 px-4 text-sm text-right font-mono bg-teal-600/10 cursor-pointer hover:bg-teal-600/20 transition-colors ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}
                          onClick={() => handleTierClick('top', 'count')}
                          title="Click for details"
                        >
                          <span className="underline decoration-dotted underline-offset-2">{mockData.topTier.underwriterCount}</span>
                        </td>
                        <td 
                          className={`py-3 px-4 text-sm text-right font-mono bg-emerald-500/10 cursor-pointer hover:bg-emerald-500/20 transition-colors ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}
                          onClick={() => handleTierClick('second', 'count')}
                          title="Click for details"
                        >
                          <span className="underline decoration-dotted underline-offset-2">{mockData.secondTier.underwriterCount}</span>
                        </td>
                        <td 
                          className={`py-3 px-4 text-sm text-right font-mono bg-lime-500/10 cursor-pointer hover:bg-lime-500/20 transition-colors ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}
                          onClick={() => handleTierClick('bottom', 'count')}
                          title="Click for details"
                        >
                          <span className="underline decoration-dotted underline-offset-2">{mockData.bottomTier.underwriterCount}</span>
                        </td>
                      </tr>

                      {/* Units Output */}
                      <tr className={`border-b transition-colors ${isDarkMode ? 'border-slate-800/50 hover:bg-slate-800/30' : 'border-slate-100 hover:bg-slate-50'}`}>
                        <td className={`py-3 px-4 text-sm sticky left-0 ${isDarkMode ? 'bg-slate-800/90 text-slate-300 border-r border-slate-700' : 'bg-slate-50/90 text-slate-700 border-r border-slate-300'}`}>
                          <Tooltip>
                            <TooltipTrigger className="flex items-center gap-1.5 cursor-help">
                              Units Output
                              <Info className="w-3 h-3 text-slate-400" />
                            </TooltipTrigger>
                            <TooltipContent className="max-w-xs">
                              <p className="font-semibold mb-1">{metricInfo.unitsOutput.name}</p>
                              <p className="text-xs text-slate-400 mb-2">{metricInfo.unitsOutput.description}</p>
                              {metricInfo.unitsOutput.calculation && (
                                <p className="text-xs text-blue-400 mt-1">📐 {metricInfo.unitsOutput.calculation}</p>
                              )}
                              {metricInfo.unitsOutput.benchmark && (
                                <p className="text-xs text-emerald-400 mt-1">📊 {metricInfo.unitsOutput.benchmark}</p>
                              )}
                            </TooltipContent>
                          </Tooltip>
                        </td>
                        <td className={`py-3 px-4 text-sm text-right font-mono ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>
                          <div className="flex items-center justify-end gap-2">
                            <span>{formatNumber(mockData.totals.unitsOutput)}</span>
                            {showComparison && (
                              <TrendIndicator change={calculateChange(mockData.totals.unitsOutput, mockPreviousData.totals.unitsOutput)} compact />
                            )}
                          </div>
                        </td>
                        <td className={`py-3 px-4 text-sm text-right font-mono bg-teal-600/10 ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>
                          {formatNumber(mockData.topTier.unitsOutput)}
                        </td>
                        <td className={`py-3 px-4 text-sm text-right font-mono bg-emerald-500/10 ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>
                          {formatNumber(mockData.secondTier.unitsOutput)}
                        </td>
                        <td className={`py-3 px-4 text-sm text-right font-mono bg-lime-500/10 ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>
                          {formatNumber(mockData.bottomTier.unitsOutput)}
                        </td>
                      </tr>

                      {/* Units % Output */}
                      <tr className={`border-b transition-colors ${isDarkMode ? 'border-slate-800/50 hover:bg-slate-800/30' : 'border-slate-100 hover:bg-slate-50'}`}>
                        <td className={`py-3 px-4 text-sm sticky left-0 ${isDarkMode ? 'bg-slate-800/90 text-slate-300 border-r border-slate-700' : 'bg-slate-50/90 text-slate-700 border-r border-slate-300'}`}>
                          Units % Output
                        </td>
                        <td className={`py-3 px-4 text-sm text-right font-mono ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>
                          {formatPercent(mockData.totals.unitsPercent)}
                        </td>
                        <td className={`py-3 px-4 text-sm text-right font-mono bg-teal-600/10 ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>
                          {formatPercent(mockData.topTier.unitsPercent)}
                        </td>
                        <td className={`py-3 px-4 text-sm text-right font-mono bg-emerald-500/10 ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>
                          {formatPercent(mockData.secondTier.unitsPercent)}
                        </td>
                        <td className={`py-3 px-4 text-sm text-right font-mono bg-lime-500/10 ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>
                          {formatPercent(mockData.bottomTier.unitsPercent)}
                        </td>
                      </tr>

                      {/* Volume Output */}
                      <tr className={`border-b transition-colors ${isDarkMode ? 'border-slate-800/50 hover:bg-slate-800/30' : 'border-slate-100 hover:bg-slate-50'}`}>
                        <td className={`py-3 px-4 text-sm sticky left-0 ${isDarkMode ? 'bg-slate-800/90 text-slate-300 border-r border-slate-700' : 'bg-slate-50/90 text-slate-700 border-r border-slate-300'}`}>
                          Volume Output
                        </td>
                        <td className={`py-3 px-4 text-sm text-right font-mono ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>
                          {formatCurrency(mockData.totals.volumeOutput)}
                        </td>
                        <td className={`py-3 px-4 text-sm text-right font-mono bg-teal-600/10 ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>
                          {formatCurrency(mockData.topTier.volumeOutput)}
                        </td>
                        <td className={`py-3 px-4 text-sm text-right font-mono bg-emerald-500/10 ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>
                          {formatCurrency(mockData.secondTier.volumeOutput)}
                        </td>
                        <td className={`py-3 px-4 text-sm text-right font-mono bg-lime-500/10 ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>
                          {formatCurrency(mockData.bottomTier.volumeOutput)}
                        </td>
                      </tr>

                      {/* Loan Complexity Score */}
                      <tr className={`border-b transition-colors ${isDarkMode ? 'border-slate-800/50 hover:bg-slate-800/30' : 'border-slate-100 hover:bg-slate-50'}`}>
                        <td className={`py-3 px-4 text-sm sticky left-0 ${isDarkMode ? 'bg-slate-800/90 text-slate-300 border-r border-slate-700' : 'bg-slate-50/90 text-slate-700 border-r border-slate-300'}`}>
                          Loan Complexity Score
                        </td>
                        <td className={`py-3 px-4 text-sm text-right font-mono ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>
                          {mockData.totals.loanComplexityScore.toFixed(1)}
                        </td>
                        <td className={`py-3 px-4 text-sm text-right font-mono bg-teal-600/10 ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>
                          {mockData.topTier.loanComplexityScore.toFixed(1)}
                        </td>
                        <td className={`py-3 px-4 text-sm text-right font-mono bg-emerald-500/10 ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>
                          {mockData.secondTier.loanComplexityScore.toFixed(1)}
                        </td>
                        <td className={`py-3 px-4 text-sm text-right font-mono bg-lime-500/10 ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>
                          {mockData.bottomTier.loanComplexityScore.toFixed(1)}
                        </td>
                      </tr>

                      {/* Average Units Output Per Month */}
                      <tr className={`border-b transition-colors ${isDarkMode ? 'border-slate-800/50 hover:bg-slate-800/30' : 'border-slate-100 hover:bg-slate-50'}`}>
                        <td className={`py-3 px-4 text-sm sticky left-0 ${isDarkMode ? 'bg-slate-800/90 text-slate-300 border-r border-slate-700' : 'bg-slate-50/90 text-slate-700 border-r border-slate-300'}`}>
                          Average Units Output Per Month
                        </td>
                        <td className={`py-3 px-4 text-sm text-right font-mono ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>
                          {mockData.totals.avgUnitsPerMonth}
                        </td>
                        <td className={`py-3 px-4 text-sm text-right font-mono bg-teal-600/10 ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>
                          {mockData.topTier.avgUnitsPerMonth}
                        </td>
                        <td className={`py-3 px-4 text-sm text-right font-mono bg-emerald-500/10 ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>
                          {mockData.secondTier.avgUnitsPerMonth}
                        </td>
                        <td className={`py-3 px-4 text-sm text-right font-mono bg-lime-500/10 ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>
                          {mockData.bottomTier.avgUnitsPerMonth}
                        </td>
                      </tr>

                      {/* Average Days */}
                      <tr className={`border-b transition-colors ${isDarkMode ? 'border-slate-800/50 hover:bg-slate-800/30' : 'border-slate-100 hover:bg-slate-50'}`}>
                        <td className={`py-3 px-4 text-sm sticky left-0 ${isDarkMode ? 'bg-slate-800/90 text-slate-300 border-r border-slate-700' : 'bg-slate-50/90 text-slate-700 border-r border-slate-300'}`}>
                          <Tooltip>
                            <TooltipTrigger className="flex items-center gap-1.5 cursor-help">
                              Average Days
                              <Info className="w-3 h-3 text-slate-400" />
                            </TooltipTrigger>
                            <TooltipContent className="max-w-xs">
                              <p className="font-semibold mb-1">{metricInfo.avgDays.name}</p>
                              <p className="text-xs text-slate-400 mb-2">{metricInfo.avgDays.description}</p>
                              {metricInfo.avgDays.calculation && (
                                <p className="text-xs text-blue-400 mt-1">📐 {metricInfo.avgDays.calculation}</p>
                              )}
                              {metricInfo.avgDays.benchmark && (
                                <p className="text-xs text-emerald-400 mt-1">📊 {metricInfo.avgDays.benchmark}</p>
                              )}
                            </TooltipContent>
                          </Tooltip>
                        </td>
                        <td className={`py-3 px-4 text-sm text-right font-mono ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>
                          <div className="flex items-center justify-end gap-2">
                            <span>{mockData.totals.avgDays.toFixed(2)}</span>
                            {showComparison && (
                              <TrendIndicator change={calculateChange(mockData.totals.avgDays, mockPreviousData.totals.avgDays, false)} compact />
                            )}
                          </div>
                        </td>
                        <td className={`py-3 px-4 text-sm text-right font-mono bg-teal-600/10 ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>
                          {mockData.topTier.avgDays.toFixed(2)}
                        </td>
                        <td className={`py-3 px-4 text-sm text-right font-mono bg-emerald-500/10 ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>
                          {mockData.secondTier.avgDays.toFixed(2)}
                        </td>
                        <td className={`py-3 px-4 text-sm text-right font-mono bg-lime-500/10 ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>
                          {mockData.bottomTier.avgDays.toFixed(2)}
                        </td>
                      </tr>

                      {/* Compensation $ */}
                      <tr className={`border-b transition-colors ${isDarkMode ? 'border-slate-800/50 hover:bg-slate-800/30' : 'border-slate-100 hover:bg-slate-50'}`}>
                        <td className={`py-3 px-4 text-sm sticky left-0 ${isDarkMode ? 'bg-slate-800/90 text-slate-300 border-r border-slate-700' : 'bg-slate-50/90 text-slate-700 border-r border-slate-300'}`}>
                          Compensation $
                        </td>
                        <td className={`py-3 px-4 text-sm text-right font-mono ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
                          {mockData.totals.compensation}
                        </td>
                        <td className={`py-3 px-4 text-sm text-right font-mono bg-teal-600/10 ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
                          {mockData.topTier.compensation}
                        </td>
                        <td className={`py-3 px-4 text-sm text-right font-mono bg-emerald-500/10 ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
                          {mockData.secondTier.compensation}
                        </td>
                        <td className={`py-3 px-4 text-sm text-right font-mono bg-lime-500/10 ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
                          {mockData.bottomTier.compensation}
                        </td>
                      </tr>

                      {/* Cost per File */}
                      <tr className={`border-b transition-colors ${isDarkMode ? 'border-slate-800/50 hover:bg-slate-800/30' : 'border-slate-100 hover:bg-slate-50'}`}>
                        <td className={`py-3 px-4 text-sm sticky left-0 ${isDarkMode ? 'bg-slate-800/90 text-slate-300 border-r border-slate-700' : 'bg-slate-50/90 text-slate-700 border-r border-slate-300'}`}>
                          Cost per File
                        </td>
                        <td className={`py-3 px-4 text-sm text-right font-mono ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
                          {mockData.totals.costPerFile}
                        </td>
                        <td className={`py-3 px-4 text-sm text-right font-mono bg-teal-600/10 ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
                          {mockData.topTier.costPerFile}
                        </td>
                        <td className={`py-3 px-4 text-sm text-right font-mono bg-emerald-500/10 ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
                          {mockData.secondTier.costPerFile}
                        </td>
                        <td className={`py-3 px-4 text-sm text-right font-mono bg-lime-500/10 ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
                          {mockData.bottomTier.costPerFile}
                        </td>
                      </tr>

                      {/* % Approved */}
                      <tr className={`border-b transition-colors ${isDarkMode ? 'border-slate-800/50 hover:bg-slate-800/30' : 'border-slate-100 hover:bg-slate-50'}`}>
                        <td className={`py-3 px-4 text-sm sticky left-0 ${isDarkMode ? 'bg-slate-800/90 text-slate-300 border-r border-slate-700' : 'bg-slate-50/90 text-slate-700 border-r border-slate-300'}`}>
                          % Approved
                        </td>
                        <td className={`py-3 px-4 text-sm text-right font-mono ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>
                          {formatPercent(mockData.totals.approvedPercent)}
                        </td>
                        <td className={`py-3 px-4 text-sm text-right font-mono bg-teal-600/10 ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>
                          {formatPercent(mockData.topTier.approvedPercent)}
                        </td>
                        <td className={`py-3 px-4 text-sm text-right font-mono bg-emerald-500/10 ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>
                          {formatPercent(mockData.secondTier.approvedPercent)}
                        </td>
                        <td className={`py-3 px-4 text-sm text-right font-mono bg-lime-500/10 ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>
                          {formatPercent(mockData.bottomTier.approvedPercent)}
                        </td>
                      </tr>

                      {/* % Denied */}
                      <tr className={`border-b transition-colors ${isDarkMode ? 'border-slate-800/50 hover:bg-slate-800/30' : 'border-slate-100 hover:bg-slate-50'}`}>
                        <td className={`py-3 px-4 text-sm sticky left-0 ${isDarkMode ? 'bg-slate-800/90 text-slate-300 border-r border-slate-700' : 'bg-slate-50/90 text-slate-700 border-r border-slate-300'}`}>
                          % Denied
                        </td>
                        <td className={`py-3 px-4 text-sm text-right font-mono ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>
                          {formatPercent(mockData.totals.deniedPercent)}
                        </td>
                        <td className={`py-3 px-4 text-sm text-right font-mono bg-teal-600/10 ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>
                          {formatPercent(mockData.topTier.deniedPercent)}
                        </td>
                        <td className={`py-3 px-4 text-sm text-right font-mono bg-emerald-500/10 ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>
                          {formatPercent(mockData.secondTier.deniedPercent)}
                        </td>
                        <td className={`py-3 px-4 text-sm text-right font-mono bg-lime-500/10 ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>
                          {formatPercent(mockData.bottomTier.deniedPercent)}
                        </td>
                      </tr>

                      {/* Government % */}
                      <tr className={`border-b transition-colors ${isDarkMode ? 'border-slate-800/50 hover:bg-slate-800/30' : 'border-slate-100 hover:bg-slate-50'}`}>
                        <td className={`py-3 px-4 text-sm sticky left-0 ${isDarkMode ? 'bg-slate-800/90 text-slate-300 border-r border-slate-700' : 'bg-slate-50/90 text-slate-700 border-r border-slate-300'}`}>
                          Government %
                        </td>
                        <td className={`py-3 px-4 text-sm text-right font-mono ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>
                          {formatPercent(mockData.totals.governmentPercent)}
                        </td>
                        <td className={`py-3 px-4 text-sm text-right font-mono bg-teal-600/10 ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>
                          {formatPercent(mockData.topTier.governmentPercent)}
                        </td>
                        <td className={`py-3 px-4 text-sm text-right font-mono bg-emerald-500/10 ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>
                          {formatPercent(mockData.secondTier.governmentPercent)}
                        </td>
                        <td className={`py-3 px-4 text-sm text-right font-mono bg-lime-500/10 ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>
                          {formatPercent(mockData.bottomTier.governmentPercent)}
                        </td>
                      </tr>

                      {/* Purchase % */}
                      <tr className={`border-b transition-colors ${isDarkMode ? 'border-slate-800/50 hover:bg-slate-800/30' : 'border-slate-100 hover:bg-slate-50'}`}>
                        <td className={`py-3 px-4 text-sm sticky left-0 ${isDarkMode ? 'bg-slate-800/90 text-slate-300 border-r border-slate-700' : 'bg-slate-50/90 text-slate-700 border-r border-slate-300'}`}>
                          Purchase %
                        </td>
                        <td className={`py-3 px-4 text-sm text-right font-mono ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>
                          {formatPercent(mockData.totals.purchasePercent)}
                        </td>
                        <td className={`py-3 px-4 text-sm text-right font-mono bg-teal-600/10 ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>
                          {formatPercent(mockData.topTier.purchasePercent)}
                        </td>
                        <td className={`py-3 px-4 text-sm text-right font-mono bg-emerald-500/10 ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>
                          {formatPercent(mockData.secondTier.purchasePercent)}
                        </td>
                        <td className={`py-3 px-4 text-sm text-right font-mono bg-lime-500/10 ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>
                          {formatPercent(mockData.bottomTier.purchasePercent)}
                        </td>
                      </tr>

                      {/* WA FICO */}
                      <tr className={`border-b transition-colors ${isDarkMode ? 'border-slate-800/50 hover:bg-slate-800/30' : 'border-slate-100 hover:bg-slate-50'}`}>
                        <td className={`py-3 px-4 text-sm sticky left-0 ${isDarkMode ? 'bg-slate-800/90 text-slate-300 border-r border-slate-700' : 'bg-slate-50/90 text-slate-700 border-r border-slate-300'}`}>
                          WA FICO
                        </td>
                        <td className={`py-3 px-4 text-sm text-right font-mono ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>
                          {mockData.totals.waFico}
                        </td>
                        <td className={`py-3 px-4 text-sm text-right font-mono bg-teal-600/10 ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>
                          {mockData.topTier.waFico}
                        </td>
                        <td className={`py-3 px-4 text-sm text-right font-mono bg-emerald-500/10 ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>
                          {mockData.secondTier.waFico}
                        </td>
                        <td className={`py-3 px-4 text-sm text-right font-mono bg-lime-500/10 ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>
                          {mockData.bottomTier.waFico}
                        </td>
                      </tr>

                      {/* WA LTV */}
                      <tr>
                        <td className={`py-3 px-4 text-sm sticky left-0 ${isDarkMode ? 'bg-slate-800/90 text-slate-300 border-r border-slate-700' : 'bg-slate-50/90 text-slate-700 border-r border-slate-300'}`}>
                          WA LTV
                        </td>
                        <td className={`py-3 px-4 text-sm text-right font-mono ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>
                          {mockData.totals.waLtv.toFixed(1)}
                        </td>
                        <td className={`py-3 px-4 text-sm text-right font-mono bg-teal-600/10 ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>
                          {mockData.topTier.waLtv.toFixed(1)}
                        </td>
                        <td className={`py-3 px-4 text-sm text-right font-mono bg-emerald-500/10 ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>
                          {mockData.secondTier.waLtv.toFixed(1)}
                        </td>
                        <td className={`py-3 px-4 text-sm text-right font-mono bg-lime-500/10 ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>
                          {mockData.bottomTier.waLtv.toFixed(1)}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                )}

                {/* Charts View */}
                {scorecardView === 'charts' && (
                  <div className="space-y-6">
                    {/* Tier Distribution */}
                    <div className={`p-4 rounded-xl backdrop-blur-md ${isDarkMode ? 'bg-slate-800/40 border border-slate-700/50' : 'bg-white/60 border border-slate-200/60'}`}>
                      <h3 className={`text-sm font-semibold mb-4 ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>
                        Units Distribution by Tier
                      </h3>
                      <div className="space-y-3">
                        {[
                          { name: 'Top Tier', value: mockData.topTier.unitsOutput, percent: mockData.topTier.unitsPercent, color: 'teal', delay: '' },
                          { name: 'Second Tier', value: mockData.secondTier.unitsOutput, percent: mockData.secondTier.unitsPercent, color: 'emerald', delay: 'delay-150' },
                          { name: 'Bottom Tier', value: mockData.bottomTier.unitsOutput, percent: mockData.bottomTier.unitsPercent, color: 'lime', delay: 'delay-300' },
                        ].map((tier) => (
                          <div key={tier.name}>
                            <div className="flex items-center justify-between mb-1.5">
                              <span className={`text-sm font-medium ${isDarkMode ? 'text-slate-300' : 'text-slate-700'}`}>
                                {tier.name}
                              </span>
                              <div className="flex items-center gap-3">
                                <span className={`text-sm font-mono ${isDarkMode ? 'text-slate-400' : 'text-slate-600'}`}>
                                  {formatNumber(tier.value)} units
                                </span>
                                <span className={`text-sm font-bold ${tier.color === 'teal' ? 'text-teal-600' : tier.color === 'emerald' ? 'text-emerald-600' : 'text-lime-600'}`}>
                                  {tier.percent.toFixed(1)}%
                                </span>
                              </div>
                            </div>
                            <div className={`h-8 rounded-full overflow-hidden ${isDarkMode ? 'bg-slate-800/60' : 'bg-slate-100'}`}>
                              <div 
                                className={`h-full flex items-center px-3 text-white text-sm font-medium rounded-full transition-all duration-1000 ease-out animate-in slide-in-from-left ${tier.delay} ${
                                  tier.color === 'teal' ? 'bg-gradient-to-r from-teal-600 to-teal-500 shadow-lg shadow-teal-500/30' :
                                  tier.color === 'emerald' ? 'bg-gradient-to-r from-emerald-600 to-emerald-500 shadow-lg shadow-emerald-500/30' :
                                  'bg-gradient-to-r from-lime-600 to-lime-500 shadow-lg shadow-lime-500/30'
                                }`}
                                style={{ width: `${tier.percent}%` }}
                              >
                                {tier.percent > 15 && `${tier.percent.toFixed(1)}%`}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Performance Metrics Comparison */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      {/* Average Days Chart */}
                      <div className={`p-4 rounded-xl backdrop-blur-md ${isDarkMode ? 'bg-slate-800/40 border border-slate-700/50' : 'bg-white/60 border border-slate-200/60'}`}>
                        <h4 className={`text-sm font-semibold mb-4 ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>
                          Average Days by Tier
                        </h4>
                        <div className="space-y-3">
                          {[
                            { name: 'Top', value: mockData.topTier.avgDays, color: 'teal', delay: '' },
                            { name: 'Second', value: mockData.secondTier.avgDays, color: 'emerald', delay: 'delay-150' },
                            { name: 'Bottom', value: mockData.bottomTier.avgDays, color: 'lime', delay: 'delay-300' },
                          ].map((tier) => (
                            <div key={tier.name} className="flex items-center gap-3">
                              <div className={`w-20 text-sm font-medium ${isDarkMode ? 'text-slate-400' : 'text-slate-600'}`}>
                                {tier.name}
                              </div>
                              <div className="flex-1">
                                <div className={`h-6 rounded-full ${isDarkMode ? 'bg-slate-700/60' : 'bg-slate-200/80'}`}>
                                  <div 
                                    className={`h-full rounded-full flex items-center justify-end px-2 text-xs font-bold text-white transition-all duration-1000 ease-out animate-in slide-in-from-left ${tier.delay} ${
                                      tier.color === 'teal' ? 'bg-gradient-to-r from-teal-600 to-teal-500 shadow-md shadow-teal-500/30' :
                                      tier.color === 'emerald' ? 'bg-gradient-to-r from-emerald-600 to-emerald-500 shadow-md shadow-emerald-500/30' :
                                      'bg-gradient-to-r from-lime-600 to-lime-500 shadow-md shadow-lime-500/30'
                                    }`}
                                    style={{ width: `${(tier.value / 10) * 100}%` }}
                                  >
                                    {tier.value.toFixed(2)}
                                  </div>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Approval Rate Chart */}
                      <div className={`p-4 rounded-xl backdrop-blur-md ${isDarkMode ? 'bg-slate-800/40 border border-slate-700/50' : 'bg-white/60 border border-slate-200/60'}`}>
                        <h4 className={`text-sm font-semibold mb-4 ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>
                          Approval Rate by Tier
                        </h4>
                        <div className="space-y-3">
                          {[
                            { name: 'Top', value: mockData.topTier.approvedPercent, color: 'teal', delay: '' },
                            { name: 'Second', value: mockData.secondTier.approvedPercent, color: 'emerald', delay: 'delay-150' },
                            { name: 'Bottom', value: mockData.bottomTier.approvedPercent, color: 'lime', delay: 'delay-300' },
                          ].map((tier) => (
                            <div key={tier.name} className="flex items-center gap-3">
                              <div className={`w-20 text-sm font-medium ${isDarkMode ? 'text-slate-400' : 'text-slate-600'}`}>
                                {tier.name}
                              </div>
                              <div className="flex-1">
                                <div className={`h-6 rounded-full ${isDarkMode ? 'bg-slate-700/60' : 'bg-slate-200/80'}`}>
                                  <div 
                                    className={`h-full rounded-full flex items-center justify-end px-2 text-xs font-bold text-white transition-all duration-1000 ease-out animate-in slide-in-from-left ${tier.delay} ${
                                      tier.color === 'teal' ? 'bg-gradient-to-r from-teal-600 to-teal-500 shadow-md shadow-teal-500/30' :
                                      tier.color === 'emerald' ? 'bg-gradient-to-r from-emerald-600 to-emerald-500 shadow-md shadow-emerald-500/30' :
                                      'bg-gradient-to-r from-lime-600 to-lime-500 shadow-md shadow-lime-500/30'
                                    }`}
                                    style={{ width: `${tier.value}%` }}
                                  >
                                    {tier.value.toFixed(1)}%
                                  </div>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Portfolio Mix */}
                    <div className={`p-4 rounded-xl backdrop-blur-md ${isDarkMode ? 'bg-slate-800/40 border border-slate-700/50' : 'bg-white/60 border border-slate-200/60'}`}>
                      <h4 className={`text-sm font-semibold mb-4 ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>
                        Portfolio Mix (All Tiers)
                      </h4>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        {[
                          { label: 'Government', value: mockData.totals.governmentPercent, gradient: 'from-blue-400/80 via-blue-500/70 to-blue-600/80', shadow: 'shadow-blue-500/20' },
                          { label: 'Purchase', value: mockData.totals.purchasePercent, gradient: 'from-purple-400/80 via-purple-500/70 to-purple-600/80', shadow: 'shadow-purple-500/20' },
                          { label: 'Approved', value: mockData.totals.approvedPercent, gradient: 'from-emerald-400/80 via-emerald-500/70 to-emerald-600/80', shadow: 'shadow-emerald-500/20' },
                          { label: 'Denied', value: mockData.totals.deniedPercent, gradient: 'from-red-400/80 via-red-500/70 to-red-600/80', shadow: 'shadow-red-500/20' },
                        ].map((metric) => (
                          <div key={metric.label} className="text-center">
                            <div className={`w-full h-32 rounded-xl bg-gradient-to-br ${metric.gradient} backdrop-blur-sm border ${isDarkMode ? 'border-white/10' : 'border-white/40'} flex items-center justify-center text-white shadow-lg ${metric.shadow} transition-all duration-500 hover:scale-105 hover:shadow-xl`}>
                              <div>
                                <div className="text-3xl font-bold drop-shadow-md">{metric.value.toFixed(1)}%</div>
                                <div className="text-sm opacity-90 font-medium drop-shadow">{metric.label}</div>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      {/* Tier Drilldown Modal */}
      <Dialog open={drilldownModal.isOpen} onOpenChange={(open) => setDrilldownModal({ ...drilldownModal, isOpen: open })}>
        <DialogContent className={`max-w-2xl ${isDarkMode ? 'bg-slate-900 border-slate-700' : 'bg-white'}`}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {drilldownModal.tier && (
                <>
                  <div className={`w-3 h-3 rounded-full ${
                    drilldownModal.tier === 'top' ? 'bg-teal-500' :
                    drilldownModal.tier === 'second' ? 'bg-emerald-500' :
                    'bg-lime-500'
                  }`} />
                  {getTierData(drilldownModal.tier).name} Details
                </>
              )}
            </DialogTitle>
            <DialogDescription>
              Performance breakdown for {drilldownModal.tier && getTierData(drilldownModal.tier).name.toLowerCase()} performers
            </DialogDescription>
          </DialogHeader>

          {drilldownModal.tier && (
            <div className="space-y-4">
              {/* Summary Stats */}
              <div className="grid grid-cols-3 gap-4">
                <div className={`p-4 rounded-lg ${isDarkMode ? 'bg-slate-800' : 'bg-slate-50'}`}>
                  <p className={`text-xs font-medium mb-1 ${isDarkMode ? 'text-slate-400' : 'text-slate-600'}`}>
                    Team Members
                  </p>
                  <p className={`text-2xl font-bold ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>
                    {getTierData(drilldownModal.tier).data.underwriterCount}
                  </p>
                </div>
                <div className={`p-4 rounded-lg ${isDarkMode ? 'bg-slate-800' : 'bg-slate-50'}`}>
                  <p className={`text-xs font-medium mb-1 ${isDarkMode ? 'text-slate-400' : 'text-slate-600'}`}>
                    Total Units
                  </p>
                  <p className={`text-2xl font-bold ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>
                    {formatNumber(getTierData(drilldownModal.tier).data.unitsOutput)}
                  </p>
                </div>
                <div className={`p-4 rounded-lg ${isDarkMode ? 'bg-slate-800' : 'bg-slate-50'}`}>
                  <p className={`text-xs font-medium mb-1 ${isDarkMode ? 'text-slate-400' : 'text-slate-600'}`}>
                    % of Output
                  </p>
                  <p className={`text-2xl font-bold ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>
                    {getTierData(drilldownModal.tier).data.unitsPercent.toFixed(1)}%
                  </p>
                </div>
              </div>

              {/* Detailed Metrics */}
              <div className={`border rounded-lg overflow-hidden ${isDarkMode ? 'border-slate-700' : 'border-slate-200'}`}>
                <div className={`grid grid-cols-2 gap-px ${isDarkMode ? 'bg-slate-700' : 'bg-slate-200'}`}>
                  {[
                    { label: 'Avg Units/Month', value: getTierData(drilldownModal.tier).data.avgUnitsPerMonth },
                    { label: 'Avg Days', value: getTierData(drilldownModal.tier).data.avgDays.toFixed(2) },
                    { label: 'Volume', value: formatCurrency(getTierData(drilldownModal.tier).data.volumeOutput) },
                    { label: 'Complexity Score', value: getTierData(drilldownModal.tier).data.loanComplexityScore.toFixed(1) },
                    { label: 'Approval Rate', value: `${getTierData(drilldownModal.tier).data.approvedPercent.toFixed(1)}%` },
                    { label: 'Denial Rate', value: `${getTierData(drilldownModal.tier).data.deniedPercent.toFixed(1)}%` },
                    { label: 'Government %', value: `${getTierData(drilldownModal.tier).data.governmentPercent.toFixed(1)}%` },
                    { label: 'Purchase %', value: `${getTierData(drilldownModal.tier).data.purchasePercent.toFixed(1)}%` },
                    { label: 'WA FICO', value: getTierData(drilldownModal.tier).data.waFico },
                    { label: 'WA LTV', value: `${getTierData(drilldownModal.tier).data.waLtv.toFixed(1)}%` },
                  ].map((metric, idx) => (
                    <div key={idx} className={`p-3 ${isDarkMode ? 'bg-slate-900' : 'bg-white'}`}>
                      <p className={`text-xs font-medium mb-1 ${isDarkMode ? 'text-slate-400' : 'text-slate-600'}`}>
                        {metric.label}
                      </p>
                      <p className={`text-base font-semibold ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>
                        {metric.value}
                      </p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Sample Team Members (Mock Data) */}
              <div>
                <h4 className={`text-sm font-semibold mb-3 ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>
                  Team Members ({getTierData(drilldownModal.tier).data.underwriterCount})
                </h4>
                <div className="space-y-2">
                  {Array.from({ length: getTierData(drilldownModal.tier).data.underwriterCount }, (_, i) => (
                    <div key={i} className={`p-3 rounded-lg flex items-center justify-between ${isDarkMode ? 'bg-slate-800' : 'bg-slate-50'}`}>
                      <div className="flex items-center gap-3">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center font-semibold text-white ${
                          drilldownModal.tier === 'top' ? 'bg-teal-500' :
                          drilldownModal.tier === 'second' ? 'bg-emerald-500' :
                          'bg-lime-500'
                        }`}>
                          {String.fromCharCode(65 + i)}
                        </div>
                        <div>
                          <p className={`text-sm font-medium ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>
                            Team Member {i + 1}
                          </p>
                          <p className={`text-xs ${isDarkMode ? 'text-slate-400' : 'text-slate-600'}`}>
                            {Math.round(getTierData(drilldownModal.tier).data.unitsOutput / getTierData(drilldownModal.tier).data.underwriterCount)} units
                          </p>
                        </div>
                      </div>
                      <Button variant="ghost" size="sm" className="text-xs">
                        View Details
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
