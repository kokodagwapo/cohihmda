import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useTheme } from '@/components/theme-provider';
import { Search, Download, Info, Target, Hash, DollarSign, Gauge, Clock, Maximize2, Minimize2, AlertTriangle, CheckCircle2, ArrowUpRight, ArrowDownRight, Calendar, TrendingUp, Loader2 } from 'lucide-react';
import { useOperationsScorecardTrendsData, ScorecardActorType, ComparisonViewType, TierSummary } from '@/hooks/useOperationsScorecardTrendsData';

// Props interface for the view component
interface OperationScorecardTrendsViewProps {
  selectedTenantId?: string | null;
  selectedChannel?: string | null;
}

export function OperationScorecardTrendsView({ selectedTenantId, selectedChannel }: OperationScorecardTrendsViewProps) {
  const { theme } = useTheme();
  const isDarkMode = theme === 'dark';
  
  const [selectedActor, setSelectedActor] = useState<ScorecardActorType>(() => {
    const saved = localStorage.getItem('op-scorecard-trends-actor');
    return (saved as ScorecardActorType) || 'underwriter';
  });
  const [comparisonView, setComparisonView] = useState<ComparisonViewType>(() => {
    const saved = localStorage.getItem('op-scorecard-trends-comparison');
    return (saved as ComparisonViewType) || 'vs-target';
  });
  const [searchQuery, setSearchQuery] = useState('');
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Fetch data using the hook
  const { data, loading, error } = useOperationsScorecardTrendsData(
    selectedActor,
    comparisonView,
    selectedTenantId,
    selectedChannel
  );

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

  // Get data from API or use defaults
  const months = data?.months || [];
  const actors = data?.actors || [];
  const tierSummary = data?.tierSummary;
  const kpis = data?.kpis;
  
  // Convert tier summary to array format for rendering
  const tierSummaries: TierSummary[] = tierSummary ? [
    tierSummary.top,
    tierSummary.second,
    tierSummary.bottom
  ] : [];

  // Calculate totals for top metrics from API data
  const totalUnits = actors.reduce((sum, p) => {
    return sum + Object.values(p.months).reduce((s: number, m: any) => s + (m.unitsOutput || 0), 0);
  }, 0);

  const avgVolumeOutput = kpis?.avgVolumeOutput || 0;
  const avgLoanComplexityScore = kpis?.avgLoanComplexityScore || 100;
  const targetUnitsPerMonth = kpis?.targetUnitsPerMonth || 25;
  const avgUnitsOutput = kpis?.avgUnitsOutput || 0;
  const avgDays = kpis?.avgDays || 0;

  // Get tier color - matching operation scorecard
  const getTierColor = (tier: 'top' | 'second' | 'bottom') => {
    switch (tier) {
      case 'top':
        return 'bg-tier-top-light';
      case 'second':
        return 'bg-tier-second-light';
      case 'bottom':
        return 'bg-tier-bottom-light';
    }
  };

  const getTierHoverColor = (tier: 'top' | 'second' | 'bottom') => {
    switch (tier) {
      case 'top':
        return 'hover:bg-tier-top/20';
      case 'second':
        return 'hover:bg-tier-second/20';
      case 'bottom':
        return 'hover:bg-tier-bottom/30';
    }
  };

  const getTierBadgeColor = (tier: 'top' | 'second' | 'bottom') => {
    switch (tier) {
      case 'top':
        return 'bg-tier-top text-white';
      case 'second':
        return 'bg-tier-second text-white';
      case 'bottom':
        return 'bg-tier-bottom text-slate-800';
    }
  };

  // Export to Excel
  const exportToExcel = () => {
    const timestamp = new Date().toISOString().split('T')[0];
    const filename = `operation-scorecard-trends-${selectedActor}-${timestamp}.csv`;
    
    let csv = `Operation Scorecard Trends - ${selectedActor.charAt(0).toUpperCase() + selectedActor.slice(1)}\n`;
    csv += `Generated: ${new Date().toLocaleString()}\n\n`;
    
    // Header row
    csv += `${selectedActor.charAt(0).toUpperCase() + selectedActor.slice(1)},Tier,${months.map(m => `${m} Units,${m} vs Target,${m} Conversion %,${m} Complexity`).join(',')}\n`;
    
    // Data rows
    actors.forEach(p => {
      csv += `${p.name},${p.tier}`;
      months.forEach(month => {
        const monthData = p.months[month];
        csv += `,${monthData?.unitsOutput || 0},${monthData?.outputVsTarget || 0},${monthData?.conversionPercent || 0},${monthData?.loanComplexityScore || 0}`;
      });
      csv += '\n';
    });
    
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
  };

  // Loading state
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
          <p className={`text-sm ${isDarkMode ? 'text-slate-400' : 'text-slate-600'}`}>
            Loading trends data...
          </p>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className={`p-6 rounded-lg border ${isDarkMode ? 'bg-red-900/20 border-red-700/50' : 'bg-red-50 border-red-200'}`}>
          <div className="flex items-center gap-3">
            <AlertTriangle className="h-6 w-6 text-red-500" />
            <div>
              <p className={`font-medium ${isDarkMode ? 'text-red-300' : 'text-red-900'}`}>Failed to load data</p>
              <p className={`text-sm ${isDarkMode ? 'text-red-400' : 'text-red-700'}`}>{error}</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Empty state
  if (!data || actors.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className={`p-6 rounded-lg border ${isDarkMode ? 'bg-slate-800/50 border-slate-700' : 'bg-slate-50 border-slate-200'}`}>
          <div className="flex items-center gap-3">
            <Info className="h-6 w-6 text-slate-400" />
            <div>
              <p className={`font-medium ${isDarkMode ? 'text-slate-300' : 'text-slate-900'}`}>No data available</p>
              <p className={`text-sm ${isDarkMode ? 'text-slate-400' : 'text-slate-600'}`}>
                No {selectedActor} performance data found for the selected period.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

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
                    {actors.length} {selectedActor.charAt(0).toUpperCase() + selectedActor.slice(1)}s output {formatNumber(totalUnits)} Total Units.
                  </p>
                </div>

                {/* Tier Summaries - Premium Redesign */}
                {tierSummaries.map((tierData) => {
                  const tierName = tierData.tier.charAt(0).toUpperCase() + tierData.tier.slice(1) + ' Tier';
                  
                  // Define tier-specific styles
                  const tierStyles = {
                    top: {
                      bg: isDarkMode ? 'bg-tier-top-dark' : 'bg-tier-top-light',
                      border: isDarkMode ? 'border-tier-top/40' : 'border-tier-top/30',
                      dot: 'bg-tier-top',
                      text: isDarkMode ? 'text-white' : 'text-tier-top',
                      iconBg: isDarkMode ? 'bg-tier-top/20' : 'bg-tier-top-light',
                      badge: 'bg-tier-top'
                    },
                    second: {
                      bg: isDarkMode ? 'bg-tier-second-dark' : 'bg-tier-second-light',
                      border: isDarkMode ? 'border-tier-second/40' : 'border-tier-second/30',
                      dot: 'bg-tier-second',
                      text: isDarkMode ? 'text-white' : 'text-tier-second',
                      iconBg: isDarkMode ? 'bg-tier-second/20' : 'bg-tier-second-light',
                      badge: 'bg-tier-second'
                    },
                    bottom: {
                      bg: isDarkMode ? 'bg-tier-bottom-dark' : 'bg-tier-bottom-light',
                      border: isDarkMode ? 'border-tier-bottom/60' : 'border-tier-bottom',
                      dot: 'bg-tier-bottom',
                      text: isDarkMode ? 'text-tier-bottom' : 'text-slate-600',
                      iconBg: isDarkMode ? 'bg-tier-bottom/30' : 'bg-tier-bottom-light',
                      badge: 'bg-tier-bottom text-slate-800'
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
                              tierData.tier === 'top' ? 'bg-tier-top shadow-tier-top/30' :
                              tierData.tier === 'second' ? 'bg-tier-second shadow-tier-second/30' :
                              'bg-tier-bottom shadow-tier-bottom/30'
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

              {/* Average Monthly Output Card */}
              <Card className={`rounded-xl backdrop-blur-sm transition-all duration-300 hover:scale-105 hover:shadow-lg overflow-hidden ${isDarkMode ? 'border-slate-700/50 bg-gradient-to-br from-emerald-900/20 via-slate-800/70 to-slate-800/70 hover:border-emerald-600/50' : 'border-emerald-200/40 bg-gradient-to-br from-emerald-50 via-white to-white hover:border-emerald-400/50 hover:shadow-emerald-200/50'}`}>
                <CardContent className="pt-4 pb-4 relative">
                  <div className="flex items-start justify-between mb-2">
                    <div className={`p-2 rounded-lg ${isDarkMode ? 'bg-emerald-500/20' : 'bg-emerald-100'}`}>
                      <Hash className={`w-4 h-4 ${isDarkMode ? 'text-emerald-400' : 'text-emerald-600'}`} />
                    </div>
                  </div>
                  <p className={`text-[10px] font-semibold mb-1 uppercase tracking-wider ${isDarkMode ? 'text-slate-400' : 'text-slate-600'}`}>
                    Avg Monthly Output
                  </p>
                  <p className={`text-3xl font-bold tracking-tight ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>
                    {formatNumber(avgUnitsOutput)}
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
              <Card className={`rounded-xl backdrop-blur-sm transition-all duration-300 hover:scale-105 hover:shadow-lg overflow-hidden ${isDarkMode ? 'border-slate-700/50 bg-gradient-to-br from-cyan-900/20 via-slate-800/70 to-slate-800/70 hover:border-cyan-600/50' : 'border-cyan-200/40 bg-gradient-to-br from-cyan-50 via-white to-white hover:border-cyan-400/50 hover:shadow-cyan-200/50'}`}>
                <CardContent className="pt-4 pb-4 relative">
                  <div className="flex items-start justify-between mb-2">
                    <div className={`p-2 rounded-lg ${isDarkMode ? 'bg-cyan-500/20' : 'bg-cyan-100'}`}>
                      <Clock className={`w-4 h-4 ${isDarkMode ? 'text-cyan-400' : 'text-cyan-600'}`} />
                    </div>
                  </div>
                  <p className={`text-[10px] font-semibold mb-1 uppercase tracking-wider ${isDarkMode ? 'text-slate-400' : 'text-slate-600'}`}>
                    Average Days
                  </p>
                  <p className={`text-3xl font-bold tracking-tight ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>
                    {avgDays > 0 ? avgDays : '-'}
                  </p>
                  {avgDays === 0 && (
                    <p className={`text-[9px] mt-1 ${isDarkMode ? 'text-slate-600' : 'text-slate-400'}`}>
                      Data not available
                    </p>
                  )}
                  <div className={`absolute top-0 right-0 w-20 h-20 rounded-full blur-2xl opacity-20 ${isDarkMode ? 'bg-cyan-500' : 'bg-cyan-300'}`}></div>
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
                          <span className="font-semibold">Avg Performance:</span> {Math.round((totalUnits / actors.length) / months.length)} units/month
                          <span className={`ml-1 ${totalUnits / actors.length / months.length >= targetUnitsPerMonth ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>
                            ({totalUnits / actors.length / months.length >= targetUnitsPerMonth ? 'On track' : 'Below target'})
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
                        {months.map((month) => (
                          <th key={month} colSpan={5} className={`text-center py-3 px-2 text-sm font-semibold border-l ${isDarkMode ? 'border-slate-700 text-slate-300' : 'border-slate-300 text-slate-700'}`}>
                            {month}
                          </th>
                        ))}
                      </tr>
                      <tr className={`border-b ${isDarkMode ? 'border-slate-700' : 'border-slate-300'}`}>
                        <th className={`text-left py-2 px-4 text-xs font-medium sticky left-0 z-20 min-w-[200px] backdrop-blur-md ${isDarkMode ? 'bg-slate-800/70 text-slate-500 border-r-2 border-slate-700 shadow-[4px_0_8px_-2px_rgba(0,0,0,0.3)]' : 'bg-white/70 text-slate-500 border-r-2 border-slate-300 shadow-[4px_0_8px_-2px_rgba(0,0,0,0.1)]'}`}>
                          {/* Empty */}
                        </th>
                        {months.map((month) => (
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
                        {months.map((month) => {
                          const monthData = actors.map(p => p.months[month]).filter(d => d);
                          const monthTotals = {
                            units: monthData.reduce((sum, d) => sum + (d.unitsOutput || 0), 0),
                            vsTarget: monthData.reduce((sum, d) => sum + (d.outputVsTarget || 0), 0),
                            avgDays: (() => {
                              const daysData = monthData.filter(d => d.avgDays > 0);
                              return daysData.length > 0 
                                ? daysData.reduce((sum, d) => sum + d.avgDays, 0) / daysData.length 
                                : 0;
                            })(),
                            conversion: (() => {
                              const convData = monthData.filter(d => d.conversionPercent > 0);
                              return convData.length > 0 
                                ? convData.reduce((sum, d) => sum + d.conversionPercent, 0) / convData.length 
                                : 0;
                            })(),
                            complexity: (() => {
                              const compData = monthData.filter(d => d.loanComplexityScore > 0);
                              return compData.length > 0 
                                ? compData.reduce((sum, d) => sum + d.loanComplexityScore, 0) / compData.length 
                                : 0;
                            })(),
                          };

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
                              <td className={`py-3 px-2 text-sm text-center font-mono ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>
                                {monthTotals.avgDays > 0 ? monthTotals.avgDays.toFixed(1) : '-'}
                              </td>
                              <td className={`py-3 px-2 text-sm text-center font-mono ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>
                                {monthTotals.conversion > 0 ? formatPercent(monthTotals.conversion) : '-'}
                              </td>
                              <td className={`py-3 px-2 text-sm text-center font-mono ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>
                                {monthTotals.complexity > 0 ? monthTotals.complexity.toFixed(1) : '-'}
                              </td>
                            </React.Fragment>
                          );
                        })}
                      </tr>

                      {/* Individual Processor Rows */}
                      {actors.map((processor) => {
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
                        const latestMonth = months[0];
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
                                const latestMonth = months[0];
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
                          {months.map((month) => {
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
                                <td className={`py-3 px-2 text-sm text-center font-mono ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>
                                  {hasData && data.avgDays > 0 ? data.avgDays.toFixed(1) : '-'}
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
