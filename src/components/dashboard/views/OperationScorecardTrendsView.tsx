import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useTheme } from '@/components/theme-provider';
import { Search, Download, Info, Target, Hash, DollarSign, Gauge, Clock, Maximize2, Minimize2, AlertTriangle, CheckCircle2, ArrowUpRight, ArrowDownRight, Calendar, TrendingUp } from 'lucide-react';

type ScorecardActor = 'processor' | 'underwriter' | 'closer';
type ComparisonView = 'monthly' | 'vs-target' | 'year-over-year';

interface ProcessorMonthData {
  unitsOutput: number;
  outputVsTarget: number;
  averageDays: number;
  conversionPercent: number;
  loanComplexityScore: number;
}

interface ProcessorData {
  id: string;
  name: string;
  tier: 'top' | 'second' | 'bottom';
  months: {
    [key: string]: ProcessorMonthData;
  };
}

interface TierSummary {
  tier: 'top' | 'second' | 'bottom';
  count: number;
  totalUnits: number;
  percentOfTotal: number;
  avgUnitsPerMonth: number;
  avgDaysPerUnit: number;
}

// Mock data for the trends view
const mockMonths = ['Jan-2026', 'Dec-2025', 'Nov-2025', 'Oct-2025'];

const mockProcessors: ProcessorData[] = [
  {
    id: '1',
    name: 'Michelle Neuf',
    tier: 'top',
    months: {
      'Jan-2026': { unitsOutput: 73, outputVsTarget: 48, averageDays: 0, conversionPercent: 56.2, loanComplexityScore: 111.5 },
      'Dec-2025': { unitsOutput: 158, outputVsTarget: 133, averageDays: 0, conversionPercent: 53.2, loanComplexityScore: 111.1 },
      'Nov-2025': { unitsOutput: 158, outputVsTarget: 133, averageDays: 0, conversionPercent: 51.3, loanComplexityScore: 111.6 },
      'Oct-2025': { unitsOutput: 179, outputVsTarget: 0, averageDays: 0, conversionPercent: 0, loanComplexityScore: 0 },
    }
  },
  {
    id: '2',
    name: 'Tianna Haynes',
    tier: 'second',
    months: {
      'Jan-2026': { unitsOutput: 19, outputVsTarget: -6, averageDays: 0, conversionPercent: 57.9, loanComplexityScore: 108.7 },
      'Dec-2025': { unitsOutput: 43, outputVsTarget: 18, averageDays: 0, conversionPercent: 51.2, loanComplexityScore: 107.9 },
      'Nov-2025': { unitsOutput: 39, outputVsTarget: 14, averageDays: 0, conversionPercent: 70.7, loanComplexityScore: 107.9 },
      'Oct-2025': { unitsOutput: 36, outputVsTarget: 11, averageDays: 0, conversionPercent: 52.8, loanComplexityScore: 110.4 },
    }
  },
  {
    id: '3',
    name: 'Melanie Helen Ledford',
    tier: 'second',
    months: {
      'Jan-2026': { unitsOutput: 16, outputVsTarget: -9, averageDays: 0, conversionPercent: 81.3, loanComplexityScore: 103.4 },
      'Dec-2025': { unitsOutput: 26, outputVsTarget: 1, averageDays: 0, conversionPercent: 53.8, loanComplexityScore: 115.0 },
      'Nov-2025': { unitsOutput: 31, outputVsTarget: 6, averageDays: 0, conversionPercent: 61.3, loanComplexityScore: 111.8 },
      'Oct-2025': { unitsOutput: 30, outputVsTarget: 0, averageDays: 0, conversionPercent: 0, loanComplexityScore: 0 },
    }
  },
  {
    id: '4',
    name: 'Katherine Goodey',
    tier: 'second',
    months: {
      'Jan-2026': { unitsOutput: 8, outputVsTarget: -17, averageDays: 0, conversionPercent: 12.5, loanComplexityScore: 130.6 },
      'Dec-2025': { unitsOutput: 20, outputVsTarget: -5, averageDays: 0, conversionPercent: 30.0, loanComplexityScore: 113.5 },
      'Nov-2025': { unitsOutput: 15, outputVsTarget: -10, averageDays: 0, conversionPercent: 53.3, loanComplexityScore: 111.0 },
      'Oct-2025': { unitsOutput: 25, outputVsTarget: 0, averageDays: 0, conversionPercent: 0, loanComplexityScore: 0 },
    }
  },
  {
    id: '5',
    name: 'Tanya Cantrell',
    tier: 'bottom',
    months: {
      'Jan-2026': { unitsOutput: 11, outputVsTarget: -14, averageDays: 0, conversionPercent: 45.5, loanComplexityScore: 115.9 },
      'Dec-2025': { unitsOutput: 15, outputVsTarget: -10, averageDays: 0, conversionPercent: 53.3, loanComplexityScore: 108.3 },
      'Nov-2025': { unitsOutput: 25, outputVsTarget: 0, averageDays: 0, conversionPercent: 36.0, loanComplexityScore: 113.0 },
      'Oct-2025': { unitsOutput: 23, outputVsTarget: 0, averageDays: 0, conversionPercent: 0, loanComplexityScore: 0 },
    }
  },
  {
    id: '6',
    name: 'Brett Smith',
    tier: 'bottom',
    months: {
      'Jan-2026': { unitsOutput: 5, outputVsTarget: -20, averageDays: 0, conversionPercent: 60.0, loanComplexityScore: 116.0 },
      'Dec-2025': { unitsOutput: 13, outputVsTarget: -12, averageDays: 0, conversionPercent: 38.5, loanComplexityScore: 123.1 },
      'Nov-2025': { unitsOutput: 12, outputVsTarget: -13, averageDays: 0, conversionPercent: 58.3, loanComplexityScore: 117.5 },
      'Oct-2025': { unitsOutput: 12, outputVsTarget: 0, averageDays: 0, conversionPercent: 0, loanComplexityScore: 0 },
    }
  },
  {
    id: '7',
    name: 'Eric Paniucki',
    tier: 'bottom',
    months: {
      'Jan-2026': { unitsOutput: 0, outputVsTarget: 0, averageDays: 0, conversionPercent: 0, loanComplexityScore: 0 },
      'Dec-2025': { unitsOutput: 0, outputVsTarget: 0, averageDays: 0, conversionPercent: 0, loanComplexityScore: 0 },
      'Nov-2025': { unitsOutput: 0, outputVsTarget: 0, averageDays: 0, conversionPercent: 0, loanComplexityScore: 0 },
      'Oct-2025': { unitsOutput: 0, outputVsTarget: 0, averageDays: 0, conversionPercent: 0, loanComplexityScore: 0 },
    }
  },
];

const mockTierSummaries: TierSummary[] = [
  { tier: 'top', count: 1, totalUnits: 516, percentOfTotal: 24.8, avgUnitsPerMonth: 40, avgDaysPerUnit: 0 },
  { tier: 'second', count: 2, totalUnits: 824, percentOfTotal: 39.6, avgUnitsPerMonth: 32, avgDaysPerUnit: 0 },
  { tier: 'bottom', count: 4, totalUnits: 739, percentOfTotal: 35.5, avgUnitsPerMonth: 14, avgDaysPerUnit: 0 },
];

export function OperationScorecardTrendsView() {
  const { theme } = useTheme();
  const isDarkMode = theme === 'dark';
  
  const [selectedActor, setSelectedActor] = useState<ScorecardActor>(() => {
    const saved = localStorage.getItem('op-scorecard-trends-actor');
    return (saved as ScorecardActor) || 'processor';
  });
  const [comparisonView, setComparisonView] = useState<ComparisonView>(() => {
    const saved = localStorage.getItem('op-scorecard-trends-comparison');
    return (saved as ComparisonView) || 'vs-target';
  });
  const [searchQuery, setSearchQuery] = useState('');
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    localStorage.setItem('op-scorecard-trends-actor', selectedActor);
  }, [selectedActor]);

  useEffect(() => {
    localStorage.setItem('op-scorecard-trends-comparison', comparisonView);
  }, [comparisonView]);

  const formatNumber = (num: number) => num.toLocaleString('en-US');
  const formatPercent = (num: number) => `${num.toFixed(1)}%`;
  
  // Format negative numbers with parentheses (financial standard)
  const formatFinancialNumber = (num: number) => {
    if (num < 0) {
      return `(${Math.abs(num).toLocaleString('en-US')})`;
    }
    return num > 0 ? `+${num.toLocaleString('en-US')}` : num.toLocaleString('en-US');
  };
  
  // Get performance indicator
  const getPerformanceIndicator = (value: number, target: number = 25) => {
    const percentage = (value / target) * 100;
    if (percentage >= 100) return { icon: CheckCircle2, color: 'text-emerald-500', bg: 'bg-emerald-50 dark:bg-emerald-900/20', label: 'On Target' };
    if (percentage >= 80) return { icon: TrendingUp, color: 'text-blue-500', bg: 'bg-blue-50 dark:bg-blue-900/20', label: 'Good' };
    return { icon: AlertTriangle, color: 'text-amber-500', bg: 'bg-amber-50 dark:bg-amber-900/20', label: 'Below Target' };
  };

  // Calculate totals for top metrics
  const totalUnits = mockProcessors.reduce((sum, p) => {
    return sum + Object.values(p.months).reduce((s, m) => s + m.unitsOutput, 0);
  }, 0);

  const avgVolumeOutput = 68360393; // From screenshot
  const avgLoanComplexityScore = 113.5; // From screenshot
  const targetUnitsPerMonth = 25; // From screenshot

  // Get tier color - matching operation scorecard
  const getTierColor = (tier: 'top' | 'second' | 'bottom') => {
    switch (tier) {
      case 'top':
        return 'bg-teal-600/10';
      case 'second':
        return 'bg-emerald-500/10';
      case 'bottom':
        return 'bg-lime-500/10';
    }
  };

  const getTierHoverColor = (tier: 'top' | 'second' | 'bottom') => {
    switch (tier) {
      case 'top':
        return 'hover:bg-teal-600/20';
      case 'second':
        return 'hover:bg-emerald-500/20';
      case 'bottom':
        return 'hover:bg-lime-500/20';
    }
  };

  const getTierBadgeColor = (tier: 'top' | 'second' | 'bottom') => {
    switch (tier) {
      case 'top':
        return 'bg-gradient-to-br from-teal-500 via-teal-600 to-teal-700 text-white';
      case 'second':
        return 'bg-gradient-to-br from-emerald-400 via-emerald-500 to-emerald-600 text-white';
      case 'bottom':
        return 'bg-gradient-to-br from-lime-400 via-lime-500 to-lime-600 text-white';
    }
  };

  // Export to Excel
  const exportToExcel = () => {
    const timestamp = new Date().toISOString().split('T')[0];
    const filename = `operation-scorecard-trends-${selectedActor}-${timestamp}.csv`;
    
    let csv = `Operation Scorecard Trends - ${selectedActor.charAt(0).toUpperCase() + selectedActor.slice(1)}\n`;
    csv += `Generated: ${new Date().toLocaleString()}\n\n`;
    
    // Header row
    csv += `Processor,Tier,${mockMonths.map(m => `${m} Units,${m} vs Target,${m} Conversion %,${m} Complexity`).join(',')}\n`;
    
    // Data rows
    mockProcessors.forEach(p => {
      csv += `${p.name},${p.tier}`;
      mockMonths.forEach(month => {
        const data = p.months[month];
        csv += `,${data.unitsOutput},${data.outputVsTarget},${data.conversionPercent},${data.loanComplexityScore}`;
      });
      csv += '\n';
    });
    
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
  };

  return (
    <div className="relative">
      {/* Background pattern */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(59,130,246,0.03),transparent_50%),radial-gradient(circle_at_80%_80%,rgba(168,85,247,0.02),transparent_50%)] pointer-events-none" />

      <div className={`relative mx-auto px-6 py-6 transition-all duration-300 ${isFullscreen ? 'max-w-full' : 'max-w-[1800px]'}`}>
        <div className={`grid gap-6 transition-all duration-300 ${isFullscreen ? 'grid-cols-1' : 'grid-cols-12'}`}>
          {/* Left Sidebar - Controls + TopTiering Story */}
          {!isFullscreen && (
          <div className="col-span-12 lg:col-span-3 space-y-6">
            {/* Combined Actor and Comparison Selection */}
            <Card className={`rounded-xl backdrop-blur-sm ${isDarkMode ? 'border-slate-700/50 bg-slate-800/70 shadow-[0_8px_24px_rgba(0,0,0,0.3)]' : 'border-blue-200/40 bg-white shadow-[0_8px_24px_rgba(59,130,246,0.08)]'}`}>
              <CardContent className="pt-5 space-y-5">
                {/* Choose Actor */}
                <div>
                  <label className={`text-xs font-semibold mb-2 block uppercase tracking-wider ${isDarkMode ? 'text-slate-400' : 'text-slate-600'}`}>
                    Choose Actor
                  </label>
                  <Tabs value={selectedActor} onValueChange={(v) => setSelectedActor(v as ScorecardActor)}>
                    <TabsList className={`grid w-full grid-cols-3 h-9 ${isDarkMode ? 'bg-slate-900/60 border border-slate-700/50' : 'bg-slate-100/80 border border-slate-300/40'}`}>
                      <TabsTrigger 
                        value="processor"
                        className="text-xs data-[state=active]:bg-gradient-to-r data-[state=active]:from-blue-500 data-[state=active]:to-purple-500 data-[state=active]:text-white data-[state=active]:shadow-lg data-[state=active]:shadow-blue-500/25"
                      >
                        Processor
                      </TabsTrigger>
                      <TabsTrigger 
                        value="underwriter"
                        className="text-xs data-[state=active]:bg-gradient-to-r data-[state=active]:from-blue-500 data-[state=active]:to-purple-500 data-[state=active]:text-white data-[state=active]:shadow-lg data-[state=active]:shadow-blue-500/25"
                      >
                        Underwriter
                      </TabsTrigger>
                      <TabsTrigger 
                        value="closer"
                        className="text-xs data-[state=active]:bg-gradient-to-r data-[state=active]:from-blue-500 data-[state=active]:to-purple-500 data-[state=active]:text-white data-[state=active]:shadow-lg data-[state=active]:shadow-blue-500/25"
                      >
                        Closer
                      </TabsTrigger>
                    </TabsList>
                  </Tabs>
                </div>

                {/* Divider */}
                <div className={`border-t ${isDarkMode ? 'border-slate-700/50' : 'border-slate-200/50'}`}></div>

                {/* Choose Comparison */}
                <div>
                  <label className={`text-xs font-semibold mb-2 block uppercase tracking-wider ${isDarkMode ? 'text-slate-400' : 'text-slate-600'}`}>
                    Choose Comparison
                  </label>
                  <Tabs value={comparisonView} onValueChange={(v) => setComparisonView(v as ComparisonView)}>
                    <TabsList className={`grid w-full grid-cols-3 h-9 ${isDarkMode ? 'bg-slate-900/60 border border-slate-700/50' : 'bg-slate-100/80 border border-slate-300/40'}`}>
                      <TabsTrigger 
                        value="vs-target"
                        className="text-[10px] data-[state=active]:bg-gradient-to-r data-[state=active]:from-emerald-500 data-[state=active]:to-teal-500 data-[state=active]:text-white data-[state=active]:shadow-lg data-[state=active]:shadow-emerald-500/25"
                      >
                        Vs Target
                      </TabsTrigger>
                      <TabsTrigger 
                        value="monthly"
                        className="text-[10px] data-[state=active]:bg-gradient-to-r data-[state=active]:from-emerald-500 data-[state=active]:to-teal-500 data-[state=active]:text-white data-[state=active]:shadow-lg data-[state=active]:shadow-emerald-500/25"
                      >
                        Monthly
                      </TabsTrigger>
                      <TabsTrigger 
                        value="year-over-year"
                        className="text-[10px] data-[state=active]:bg-gradient-to-r data-[state=active]:from-emerald-500 data-[state=active]:to-teal-500 data-[state=active]:text-white data-[state=active]:shadow-lg data-[state=active]:shadow-emerald-500/25"
                      >
                        YoY
                      </TabsTrigger>
                    </TabsList>
                  </Tabs>
                  <p className={`text-[10px] mt-2 ${isDarkMode ? 'text-slate-500' : 'text-slate-500'}`}>
                    {comparisonView === 'vs-target' && 'View performance against target goals'}
                    {comparisonView === 'monthly' && 'Compare month-to-month performance'}
                    {comparisonView === 'year-over-year' && 'Compare same period last year'}
                  </p>
                </div>
              </CardContent>
            </Card>

            {/* TopTiering Story Card */}
            <Card className={`rounded-xl backdrop-blur-sm ${isDarkMode ? 'border-slate-700/50 bg-slate-800/70 shadow-[0_8px_24px_rgba(0,0,0,0.3)]' : 'border-blue-200/40 bg-white shadow-[0_8px_24px_rgba(59,130,246,0.08)]'}`}>
              <CardHeader className={`border-b pb-3 ${isDarkMode ? 'border-slate-700/50 bg-gradient-to-r from-blue-600/10 to-purple-600/10' : 'border-blue-100/50 bg-gradient-to-r from-blue-50/80 to-purple-50/60'}`}>
                <CardTitle className="text-sm font-bold">TopTiering Story</CardTitle>
                <CardDescription className="text-xs">
                  {selectedActor.charAt(0).toUpperCase() + selectedActor.slice(1)} Output Trends from Jan 2025 to Jan 2026
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-5 space-y-4">
                {/* Total Summary */}
                <div className={`p-4 rounded-lg ${isDarkMode ? 'bg-slate-700/30' : 'bg-slate-50'}`}>
                  <p className={`text-sm font-semibold mb-1 ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>
                    {mockProcessors.length} {selectedActor.charAt(0).toUpperCase() + selectedActor.slice(1)}s output {formatNumber(totalUnits)} Total Units.
                  </p>
                </div>

                {/* Tier Summaries - Premium Redesign */}
                {mockTierSummaries.map((tierData) => {
                  const tierName = tierData.tier.charAt(0).toUpperCase() + tierData.tier.slice(1) + ' Tier';
                  
                  // Define tier-specific styles
                  const tierStyles = {
                    top: {
                      bg: isDarkMode ? 'bg-gradient-to-br from-teal-500/20 via-teal-500/10 to-transparent' : 'bg-gradient-to-br from-teal-100 via-teal-50 to-teal-50/80',
                      border: isDarkMode ? 'border-teal-500/40' : 'border-teal-300',
                      dot: 'bg-teal-500',
                      text: isDarkMode ? 'text-teal-400' : 'text-teal-600',
                      iconBg: isDarkMode ? 'bg-teal-500/20' : 'bg-teal-100',
                      badge: 'bg-teal-500'
                    },
                    second: {
                      bg: isDarkMode ? 'bg-gradient-to-br from-emerald-500/10 via-emerald-500/5 to-transparent' : 'bg-gradient-to-br from-emerald-50 via-emerald-25 to-white',
                      border: isDarkMode ? 'border-emerald-500/30' : 'border-emerald-200',
                      dot: 'bg-emerald-500',
                      text: isDarkMode ? 'text-emerald-400' : 'text-emerald-600',
                      iconBg: isDarkMode ? 'bg-emerald-500/20' : 'bg-emerald-100',
                      badge: 'bg-emerald-500'
                    },
                    bottom: {
                      bg: isDarkMode ? 'bg-gradient-to-br from-lime-500/10 via-lime-500/5 to-transparent' : 'bg-gradient-to-br from-lime-50 via-lime-25 to-white',
                      border: isDarkMode ? 'border-lime-500/30' : 'border-lime-200',
                      dot: 'bg-lime-500',
                      text: isDarkMode ? 'text-lime-400' : 'text-lime-600',
                      iconBg: isDarkMode ? 'bg-lime-500/20' : 'bg-lime-100',
                      badge: 'bg-lime-500'
                    }
                  }[tierData.tier];
                  
                  return (
                    <div key={tierData.tier} className={`p-5 rounded-xl border-2 transition-all duration-200 hover:scale-[1.02] hover:shadow-lg ${tierStyles.bg} ${tierStyles.border}`}>
                      {/* Header with Badge */}
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2">
                          <div className={`w-2 h-2 rounded-full ${tierStyles.dot} animate-pulse`}></div>
                          <h4 className={`text-[10px] font-bold uppercase tracking-wider ${tierStyles.text}`}>
                            {tierName}
                          </h4>
                        </div>
                        <div className={`px-2 py-0.5 rounded-full ${tierStyles.badge} text-white text-[10px] font-bold`}>
                          {tierData.percentOfTotal.toFixed(1)}%
                        </div>
                      </div>

                      {/* Main Content - 3 Elements in Row */}
                      <div className="flex items-center gap-3 mb-4">
                        {/* Main Metric */}
                        <div className="flex-shrink-0">
                          <div className="flex items-baseline gap-2">
                            <span className={`text-3xl font-bold tracking-tight ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>
                              {formatNumber(tierData.totalUnits)}
                            </span>
                            <span className={`text-sm font-medium ${isDarkMode ? 'text-slate-400' : 'text-slate-600'}`}>
                              units
                            </span>
                          </div>
                          <p className={`text-xs mt-1 ${isDarkMode ? 'text-slate-500' : 'text-slate-600'}`}>
                            {tierData.count} {selectedActor.charAt(0).toUpperCase() + selectedActor.slice(1)}{tierData.count > 1 ? 's' : ''}
                          </p>
                        </div>

                        {/* Metrics - Vertical Layout */}
                        <div className="flex flex-col gap-2 flex-1">
                          {/* Units per Month */}
                          <div className={`flex items-center gap-2 p-2 rounded-lg w-full ${isDarkMode ? 'bg-slate-800/40' : 'bg-white/60'}`}>
                            <div className={`p-1.5 rounded ${tierStyles.iconBg}`}>
                              <Calendar className={`w-3.5 h-3.5 ${tierStyles.text}`} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className={`text-[10px] ${isDarkMode ? 'text-slate-500' : 'text-slate-600'}`}>
                                Avg / Month
                              </p>
                              <p className={`text-sm font-bold ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>
                                {tierData.avgUnitsPerMonth}
                              </p>
                            </div>
                          </div>

                          {/* Days per Unit */}
                          <div className={`flex items-center gap-2 p-2 rounded-lg w-full ${isDarkMode ? 'bg-slate-800/40' : 'bg-white/60'}`}>
                            <div className={`p-1.5 rounded ${tierStyles.iconBg}`}>
                              <Clock className={`w-3.5 h-3.5 ${tierStyles.text}`} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className={`text-[10px] ${isDarkMode ? 'text-slate-500' : 'text-slate-600'}`}>
                                Avg Days
                              </p>
                              <p className={`text-sm font-bold ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>
                                {tierData.avgDaysPerUnit || '-'}
                              </p>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Progress Bar */}
                      <div className="mt-3">
                        <div className={`h-1.5 rounded-full overflow-hidden backdrop-blur-sm ${isDarkMode ? 'bg-slate-800/60 border border-slate-700/50' : 'bg-slate-200/80 border border-slate-300/40'}`}>
                          <div 
                            className={`h-full rounded-full shadow-lg transition-all duration-1000 ease-out ${
                              tierData.tier === 'top' ? 'bg-gradient-to-r from-teal-600 to-teal-400 shadow-teal-500/30' :
                              tierData.tier === 'second' ? 'bg-gradient-to-r from-emerald-600 to-emerald-400 shadow-emerald-500/30' :
                              'bg-gradient-to-r from-lime-600 to-lime-400 shadow-lime-500/30'
                            }`}
                            style={{ width: `${tierData.percentOfTotal}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          </div>
          )}

          {/* Main Content - Trends Table */}
          <div className={`space-y-6 transition-all duration-300 ${isFullscreen ? 'col-span-1' : 'col-span-12 lg:col-span-9'}`}>
            {/* Top Metrics - Enhanced Cards */}
            {!isFullscreen && (
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              {/* Target Units Card */}
              <Card className={`rounded-xl backdrop-blur-sm transition-all duration-300 hover:scale-105 hover:shadow-lg overflow-hidden ${isDarkMode ? 'border-slate-700/50 bg-gradient-to-br from-blue-900/20 via-slate-800/70 to-slate-800/70 hover:border-blue-600/50' : 'border-blue-200/40 bg-gradient-to-br from-blue-50 via-white to-white hover:border-blue-400/50 hover:shadow-blue-200/50'}`}>
                <CardContent className="pt-4 pb-4 relative">
                  <div className="flex items-start justify-between mb-2">
                    <div className={`p-2 rounded-lg ${isDarkMode ? 'bg-blue-500/20' : 'bg-blue-100'}`}>
                      <Target className={`w-4 h-4 ${isDarkMode ? 'text-blue-400' : 'text-blue-600'}`} />
                    </div>
                  </div>
                  <p className={`text-[10px] font-semibold mb-1 uppercase tracking-wider ${isDarkMode ? 'text-slate-400' : 'text-slate-600'}`}>
                    Target Units Per Month
                  </p>
                  <p className={`text-3xl font-bold tracking-tight ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>
                    {targetUnitsPerMonth}
                  </p>
                  <div className={`absolute top-0 right-0 w-20 h-20 rounded-full blur-2xl opacity-20 ${isDarkMode ? 'bg-blue-500' : 'bg-blue-300'}`}></div>
                </CardContent>
              </Card>

              {/* Total Monthly Output Card */}
              <Card className={`rounded-xl backdrop-blur-sm transition-all duration-300 hover:scale-105 hover:shadow-lg overflow-hidden ${isDarkMode ? 'border-slate-700/50 bg-gradient-to-br from-emerald-900/20 via-slate-800/70 to-slate-800/70 hover:border-emerald-600/50' : 'border-emerald-200/40 bg-gradient-to-br from-emerald-50 via-white to-white hover:border-emerald-400/50 hover:shadow-emerald-200/50'}`}>
                <CardContent className="pt-4 pb-4 relative">
                  <div className="flex items-start justify-between mb-2">
                    <div className={`p-2 rounded-lg ${isDarkMode ? 'bg-emerald-500/20' : 'bg-emerald-100'}`}>
                      <Hash className={`w-4 h-4 ${isDarkMode ? 'text-emerald-400' : 'text-emerald-600'}`} />
                    </div>
                  </div>
                  <p className={`text-[10px] font-semibold mb-1 uppercase tracking-wider ${isDarkMode ? 'text-slate-400' : 'text-slate-600'}`}>
                    Total Monthly Output
                  </p>
                  <p className={`text-3xl font-bold tracking-tight ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>
                    {formatNumber(totalUnits)}
                  </p>
                  <div className={`absolute top-0 right-0 w-20 h-20 rounded-full blur-2xl opacity-20 ${isDarkMode ? 'bg-emerald-500' : 'bg-emerald-300'}`}></div>
                </CardContent>
              </Card>

              {/* Avg Volume Output Card */}
              <Card className={`rounded-xl backdrop-blur-sm transition-all duration-300 hover:scale-105 hover:shadow-lg overflow-hidden ${isDarkMode ? 'border-slate-700/50 bg-gradient-to-br from-purple-900/20 via-slate-800/70 to-slate-800/70 hover:border-purple-600/50' : 'border-purple-200/40 bg-gradient-to-br from-purple-50 via-white to-white hover:border-purple-400/50 hover:shadow-purple-200/50'}`}>
                <CardContent className="pt-4 pb-4 relative">
                  <div className="flex items-start justify-between mb-2">
                    <div className={`p-2 rounded-lg ${isDarkMode ? 'bg-purple-500/20' : 'bg-purple-100'}`}>
                      <DollarSign className={`w-4 h-4 ${isDarkMode ? 'text-purple-400' : 'text-purple-600'}`} />
                    </div>
                  </div>
                  <p className={`text-[10px] font-semibold mb-1 uppercase tracking-wider ${isDarkMode ? 'text-slate-400' : 'text-slate-600'}`}>
                    Avg Volume Output
                  </p>
                  <p className={`text-3xl font-bold tracking-tight ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>
                    {formatNumber(avgVolumeOutput)}
                  </p>
                  <div className={`absolute top-0 right-0 w-20 h-20 rounded-full blur-2xl opacity-20 ${isDarkMode ? 'bg-purple-500' : 'bg-purple-300'}`}></div>
                </CardContent>
              </Card>

              {/* Loan Complexity Score Card */}
              <Card className={`rounded-xl backdrop-blur-sm transition-all duration-300 hover:scale-105 hover:shadow-lg overflow-hidden ${isDarkMode ? 'border-slate-700/50 bg-gradient-to-br from-amber-900/20 via-slate-800/70 to-slate-800/70 hover:border-amber-600/50' : 'border-amber-200/40 bg-gradient-to-br from-amber-50 via-white to-white hover:border-amber-400/50 hover:shadow-amber-200/50'}`}>
                <CardContent className="pt-4 pb-4 relative">
                  <div className="flex items-start justify-between mb-2">
                    <div className={`p-2 rounded-lg ${isDarkMode ? 'bg-amber-500/20' : 'bg-amber-100'}`}>
                      <Gauge className={`w-4 h-4 ${isDarkMode ? 'text-amber-400' : 'text-amber-600'}`} />
                    </div>
                  </div>
                  <p className={`text-[10px] font-semibold mb-1 uppercase tracking-wider ${isDarkMode ? 'text-slate-400' : 'text-slate-600'}`}>
                    Loan Complexity Score
                  </p>
                  <p className={`text-3xl font-bold tracking-tight ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>
                    {avgLoanComplexityScore}
                  </p>
                  <div className={`absolute top-0 right-0 w-20 h-20 rounded-full blur-2xl opacity-20 ${isDarkMode ? 'bg-amber-500' : 'bg-amber-300'}`}></div>
                </CardContent>
              </Card>

              {/* Average Days Card */}
              <Card className={`rounded-xl backdrop-blur-sm transition-all duration-300 hover:scale-105 hover:shadow-lg overflow-hidden ${isDarkMode ? 'border-slate-700/50 bg-gradient-to-br from-slate-800/70 via-slate-800/70 to-slate-800/70 hover:border-slate-600/50' : 'border-slate-200/40 bg-gradient-to-br from-slate-50 via-white to-white hover:border-slate-300/50 hover:shadow-slate-200/50'}`}>
                <CardContent className="pt-4 pb-4 relative">
                  <div className="flex items-start justify-between mb-2">
                    <div className={`p-2 rounded-lg ${isDarkMode ? 'bg-slate-700/50' : 'bg-slate-100'}`}>
                      <Clock className={`w-4 h-4 ${isDarkMode ? 'text-slate-400' : 'text-slate-600'}`} />
                    </div>
                  </div>
                  <p className={`text-[10px] font-semibold mb-1 uppercase tracking-wider ${isDarkMode ? 'text-slate-400' : 'text-slate-600'}`}>
                    Average Days
                  </p>
                  <p className={`text-3xl font-bold tracking-tight ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>
                    -
                  </p>
                  <p className={`text-[9px] mt-1 ${isDarkMode ? 'text-slate-600' : 'text-slate-400'}`}>
                    Data not available
                  </p>
                  <div className={`absolute top-0 right-0 w-20 h-20 rounded-full blur-2xl opacity-20 ${isDarkMode ? 'bg-slate-600' : 'bg-slate-300'}`}></div>
                </CardContent>
              </Card>
            </div>
            )}

            {/* Trends Table Card */}
            <Card className={`rounded-xl backdrop-blur-sm ${isDarkMode ? 'border-slate-700/50 bg-slate-800/70 shadow-[0_8px_24px_rgba(0,0,0,0.3)]' : 'border-blue-200/40 bg-white shadow-[0_8px_24px_rgba(59,130,246,0.08)]'}`}>
              <CardHeader className={`border-b pb-4 ${isDarkMode ? 'border-slate-700/50 bg-gradient-to-r from-slate-800/50 to-slate-700/30' : 'border-blue-100/50 bg-gradient-to-r from-blue-50/30 to-purple-50/30'}`}>
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <CardTitle>{selectedActor.charAt(0).toUpperCase() + selectedActor.slice(1)} Output Trends</CardTitle>
                    <CardDescription className="mt-1">
                      Date Currently Displayed: Sent To Underwriting
                    </CardDescription>
                  </div>
                  
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
              </CardHeader>
              <CardContent>
                {/* Key Insights Banner */}
                <div className={`mb-4 p-4 rounded-lg border ${isDarkMode ? 'bg-blue-900/10 border-blue-700/30' : 'bg-blue-50 border-blue-200'}`}>
                  <div className="flex items-start gap-3">
                    <Info className={`w-5 h-5 mt-0.5 flex-shrink-0 ${isDarkMode ? 'text-blue-400' : 'text-blue-600'}`} />
                    <div className="flex-1">
                      <h4 className={`text-sm font-semibold mb-2 ${isDarkMode ? 'text-blue-300' : 'text-blue-900'}`}>
                        Performance Insights
                      </h4>
                      <div className={`grid grid-cols-1 md:grid-cols-3 gap-3 text-xs ${isDarkMode ? 'text-slate-300' : 'text-slate-700'}`}>
                        <div>
                          <span className="font-semibold">Top Performer:</span> Michelle Neuf
                          <span className="ml-1 text-emerald-600 dark:text-emerald-400">(+48 vs target)</span>
                        </div>
                        <div>
                          <span className="font-semibold">Needs Support:</span> Brett Smith, Katherine Goodey
                          <span className="ml-1 text-red-600 dark:text-red-400">(Below target)</span>
                        </div>
                        <div>
                          <span className="font-semibold">Avg Performance:</span> {Math.round((totalUnits / mockProcessors.length) / mockMonths.length)} units/month
                          <span className={`ml-1 ${totalUnits / mockProcessors.length / mockMonths.length >= targetUnitsPerMonth ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>
                            ({totalUnits / mockProcessors.length / mockMonths.length >= targetUnitsPerMonth ? 'On track' : 'Below target'})
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Controls Row */}
                <div className="flex items-center gap-4 mb-4 flex-wrap">
                  {/* Filter Buttons */}
                  <Button
                    variant="outline"
                    size="sm"
                    className={`gap-2 ${isDarkMode ? 'border-slate-600 hover:bg-slate-800' : 'border-slate-300 hover:bg-slate-50'}`}
                  >
                    <Search className="h-4 w-4" />
                    Processor
                  </Button>
                  
                  <Button
                    variant="outline"
                    size="sm"
                    className={`gap-2 ${isDarkMode ? 'border-slate-600 hover:bg-slate-800' : 'border-slate-300 hover:bg-slate-50'}`}
                  >
                    Scorecard Year...
                  </Button>

                  <Badge variant="secondary" className={`${isDarkMode ? 'border-slate-600 text-slate-300' : 'border-slate-300 text-slate-700'}`}>
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

                {/* Trends Table */}
                <div className="overflow-x-auto relative">
                  <table className="w-full border-collapse min-w-max">
                    <thead>
                      <tr className={`border-b-2 ${isDarkMode ? 'border-slate-700' : 'border-slate-300'}`}>
                        <th className={`text-left py-3 px-4 text-sm font-semibold sticky left-0 z-20 min-w-[200px] backdrop-blur-md ${isDarkMode ? 'bg-slate-800/70 text-slate-400 border-r-2 border-slate-700 shadow-[4px_0_8px_-2px_rgba(0,0,0,0.3)]' : 'bg-white/70 text-slate-600 border-r-2 border-slate-300 shadow-[4px_0_8px_-2px_rgba(0,0,0,0.1)]'}`}>
                          {selectedActor.charAt(0).toUpperCase() + selectedActor.slice(1)}
                        </th>
                        {mockMonths.map((month) => (
                          <th key={month} colSpan={5} className={`text-center py-3 px-2 text-sm font-semibold border-l ${isDarkMode ? 'border-slate-700 text-slate-300' : 'border-slate-300 text-slate-700'}`}>
                            {month}
                          </th>
                        ))}
                      </tr>
                      <tr className={`border-b ${isDarkMode ? 'border-slate-700' : 'border-slate-300'}`}>
                        <th className={`text-left py-2 px-4 text-xs font-medium sticky left-0 z-20 min-w-[200px] backdrop-blur-md ${isDarkMode ? 'bg-slate-800/70 text-slate-500 border-r-2 border-slate-700 shadow-[4px_0_8px_-2px_rgba(0,0,0,0.3)]' : 'bg-white/70 text-slate-500 border-r-2 border-slate-300 shadow-[4px_0_8px_-2px_rgba(0,0,0,0.1)]'}`}>
                          {/* Empty */}
                        </th>
                        {mockMonths.map((month) => (
                          <React.Fragment key={month}>
                            <th className={`text-center py-2 px-2 text-xs font-medium border-l ${isDarkMode ? 'border-slate-700 text-slate-500' : 'border-slate-300 text-slate-500'}`}>
                              Units Output
                            </th>
                            <th className={`text-center py-2 px-2 text-xs font-medium ${isDarkMode ? 'text-slate-500' : 'text-slate-500'}`}>
                              Output vs Target
                            </th>
                            <th className={`text-center py-2 px-2 text-xs font-medium ${isDarkMode ? 'text-slate-500' : 'text-slate-500'}`}>
                              Average Days
                            </th>
                            <th className={`text-center py-2 px-2 text-xs font-medium ${isDarkMode ? 'text-slate-500' : 'text-slate-500'}`}>
                              % Conversion
                            </th>
                            <th className={`text-center py-2 px-2 text-xs font-medium ${isDarkMode ? 'text-slate-500' : 'text-slate-500'}`}>
                              Loan Complexity Score
                            </th>
                          </React.Fragment>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {/* Totals Row */}
                      <tr className={`border-b font-semibold transition-colors duration-200 ${isDarkMode ? 'border-slate-700 bg-slate-700/30 hover:bg-slate-700/50' : 'border-slate-300 bg-slate-100 hover:bg-slate-200/70'}`}>
                        <td className={`py-3 px-4 text-sm sticky left-0 z-10 min-w-[200px] backdrop-blur-md ${isDarkMode ? 'bg-slate-700/65 text-white border-r-2 border-slate-700 shadow-[4px_0_8px_-2px_rgba(0,0,0,0.3)]' : 'bg-slate-100/70 text-slate-900 border-r-2 border-slate-300 shadow-[4px_0_8px_-2px_rgba(0,0,0,0.1)]'}`}>
                          Totals
                        </td>
                        {mockMonths.map((month) => {
                          const monthTotals = mockProcessors.reduce((acc, p) => {
                            const data = p.months[month];
                            return {
                              units: acc.units + data.unitsOutput,
                              vsTarget: acc.vsTarget + data.outputVsTarget,
                              avgDays: 0,
                              conversion: 0,
                              complexity: 0,
                            };
                          }, { units: 0, vsTarget: 0, avgDays: 0, conversion: 0, complexity: 0 });

                          return (
                            <React.Fragment key={month}>
                              <td className={`py-3 px-2 text-sm text-center font-mono border-l ${isDarkMode ? 'border-slate-700 text-white' : 'border-slate-300 text-slate-900'}`}>
                                {monthTotals.units}
                              </td>
                              <td className={`py-3 px-2 text-sm text-center font-mono font-semibold ${
                                monthTotals.vsTarget > 0 
                                  ? 'text-emerald-600 dark:text-emerald-400'
                                  : monthTotals.vsTarget < 0
                                  ? 'text-red-600 dark:text-red-400'
                                  : isDarkMode ? 'text-white' : 'text-slate-900'
                              }`}>
                                {formatFinancialNumber(monthTotals.vsTarget)}
                              </td>
                              <td className={`py-3 px-2 text-sm text-center font-mono ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>
                                -
                              </td>
                              <td className={`py-3 px-2 text-sm text-center font-mono ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>
                                -
                              </td>
                              <td className={`py-3 px-2 text-sm text-center font-mono ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>
                                -
                              </td>
                            </React.Fragment>
                          );
                        })}
                      </tr>

                      {/* Individual Processor Rows */}
                      {mockProcessors.map((processor) => {
                        // Define backdrop styles for each tier
                        const tierBackdropStyles = {
                          top: isDarkMode 
                            ? 'bg-teal-600/10 backdrop-blur-md shadow-[4px_0_8px_-2px_rgba(0,0,0,0.3)]' 
                            : 'bg-teal-50/70 backdrop-blur-md shadow-[4px_0_8px_-2px_rgba(0,0,0,0.1)]',
                          second: isDarkMode 
                            ? 'bg-emerald-500/10 backdrop-blur-md shadow-[4px_0_8px_-2px_rgba(0,0,0,0.3)]' 
                            : 'bg-emerald-50/70 backdrop-blur-md shadow-[4px_0_8px_-2px_rgba(0,0,0,0.1)]',
                          bottom: isDarkMode 
                            ? 'bg-lime-500/10 backdrop-blur-md shadow-[4px_0_8px_-2px_rgba(0,0,0,0.3)]' 
                            : 'bg-lime-50/70 backdrop-blur-md shadow-[4px_0_8px_-2px_rgba(0,0,0,0.1)]'
                        }[processor.tier];

                        // Check if processor is on target
                        const latestMonth = mockMonths[0];
                        const latestData = processor.months[latestMonth];
                        const isOnTarget = latestData.unitsOutput >= targetUnitsPerMonth;
                        
                        // Apply distinct background for "On Target" rows
                        const rowBgColor = isOnTarget 
                          ? isDarkMode 
                            ? 'bg-emerald-500/15 hover:bg-emerald-500/25' 
                            : 'bg-emerald-50/90 hover:bg-emerald-100/90'
                          : `${getTierColor(processor.tier)} ${getTierHoverColor(processor.tier)}`;

                        // Update processor column background for "On Target" rows
                        const processorColumnBg = isOnTarget
                          ? isDarkMode
                            ? 'bg-emerald-500/20 backdrop-blur-md shadow-[4px_0_8px_-2px_rgba(0,0,0,0.3)]'
                            : 'bg-emerald-100/90 backdrop-blur-md shadow-[4px_0_8px_-2px_rgba(0,0,0,0.1)]'
                          : tierBackdropStyles;

                        return (
                        <tr 
                          key={processor.id} 
                          className={`border-b transition-all duration-200 cursor-pointer ${rowBgColor} ${isDarkMode ? 'border-slate-800/50' : 'border-slate-200'}`}
                        >
                          <td className={`py-3 px-4 text-sm font-medium sticky left-0 z-10 border-r-2 min-w-[200px] whitespace-nowrap ${processorColumnBg} ${isDarkMode ? 'text-slate-200 border-slate-700' : 'text-slate-900 border-slate-300'}`}>
                            <div className="flex items-center justify-between gap-2">
                              <span>{processor.name}</span>
                              {(() => {
                                const latestMonth = mockMonths[0];
                                const latestData = processor.months[latestMonth];
                                const indicator = getPerformanceIndicator(latestData.unitsOutput, targetUnitsPerMonth);
                                const IndicatorIcon = indicator.icon;
                                return latestData.unitsOutput > 0 ? (
                                  <Tooltip>
                                    <TooltipTrigger>
                                      <div className={`p-1 rounded ${indicator.bg}`}>
                                        <IndicatorIcon className={`w-3 h-3 ${indicator.color}`} />
                                      </div>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                      <p className="text-xs font-semibold">{indicator.label}</p>
                                      <p className="text-xs text-slate-400">
                                        {latestData.unitsOutput} units / {targetUnitsPerMonth} target
                                      </p>
                                    </TooltipContent>
                                  </Tooltip>
                                ) : null;
                              })()}
                            </div>
                          </td>
                          {mockMonths.map((month) => {
                            const data = processor.months[month];
                            const hasData = data.unitsOutput > 0 || data.outputVsTarget !== 0;

                            return (
                              <React.Fragment key={month}>
                                <td className={`py-3 px-2 text-sm text-center font-mono border-l transition-colors hover:bg-opacity-10 ${
                                  data.unitsOutput >= targetUnitsPerMonth 
                                    ? isDarkMode ? 'border-slate-700 text-emerald-300 font-semibold hover:bg-emerald-500' : 'border-slate-300 text-emerald-700 font-semibold hover:bg-emerald-500'
                                    : isDarkMode ? 'border-slate-700 text-slate-200 hover:bg-slate-400' : 'border-slate-300 text-slate-900 hover:bg-slate-400'
                                }`}>
                                  {data.unitsOutput > 0 ? (
                                    <Tooltip delayDuration={300}>
                                      <TooltipTrigger asChild>
                                        <span className="cursor-help">
                                          {data.unitsOutput}
                                        </span>
                                      </TooltipTrigger>
                                      <TooltipContent side="top" align="center" className="z-50">
                                        <div className="text-xs space-y-1">
                                          <p className="font-semibold">{month}</p>
                                          <p>Units: {data.unitsOutput}</p>
                                          <p>Target: {targetUnitsPerMonth}</p>
                                          <p className={data.unitsOutput >= targetUnitsPerMonth ? 'text-emerald-400' : 'text-red-400'}>
                                            {data.unitsOutput >= targetUnitsPerMonth ? '✓ Target achieved' : '⚠ Below target'}
                                          </p>
                                        </div>
                                      </TooltipContent>
                                    </Tooltip>
                                  ) : (
                                    '-'
                                  )}
                                </td>
                                <td className={`py-3 px-2 text-sm text-center font-mono font-semibold transition-colors ${
                                  data.outputVsTarget > 0 
                                    ? 'text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500 hover:bg-opacity-10' 
                                    : data.outputVsTarget < 0 
                                    ? 'text-red-600 dark:text-red-400 hover:bg-red-500 hover:bg-opacity-10' 
                                    : isDarkMode ? 'text-slate-500 hover:bg-slate-400 hover:bg-opacity-10' : 'text-slate-400 hover:bg-slate-400 hover:bg-opacity-10'
                                }`}>
                                  <div className="flex items-center justify-center gap-1">
                                    {hasData && data.outputVsTarget !== 0 && (
                                      data.outputVsTarget > 0 ? (
                                        <ArrowUpRight className="w-3 h-3" />
                                      ) : (
                                        <ArrowDownRight className="w-3 h-3" />
                                      )
                                    )}
                                    <span>{hasData ? formatFinancialNumber(data.outputVsTarget) : '-'}</span>
                                  </div>
                                </td>
                                <td className={`py-3 px-2 text-sm text-center font-mono ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>
                                  -
                                </td>
                                <td className={`py-3 px-2 text-sm text-center font-mono ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>
                                  {hasData && data.conversionPercent > 0 ? formatPercent(data.conversionPercent) : '-'}
                                </td>
                                <td className={`py-3 px-2 text-sm text-center font-mono ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>
                                  {hasData && data.loanComplexityScore > 0 ? data.loanComplexityScore.toFixed(1) : '-'}
                                </td>
                              </React.Fragment>
                            );
                          })}
                        </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
