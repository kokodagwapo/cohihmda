import { useState, useMemo } from 'react';
import { BarChart3, Share2, ChevronLeft, X, Sparkles } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';
import { DashboardCard } from '@/components/dashboard/DashboardCard';
import { DataTable } from '@/components/dashboard/DataTable';
import { useCompanyData } from '@/hooks/useCompanyData';
import { useCompanyMetrics } from '@/hooks/useCompanyMetrics';

interface CompanyDetailViewProps {
  onBack: () => void;
  onTabChange?: (tab: 'company' | 'sales' | 'ops') => void;
}

export const CompanyDetailView = ({ onBack, onTabChange }: CompanyDetailViewProps) => {
  const [showRawData, setShowRawData] = useState(false);
  const [year, setYear] = useState(new Date().getFullYear());
  const { toast } = useToast();

  // Fetch data using hooks
  const { data: companyData, loading: dataLoading } = useCompanyData(year);
  const { metrics, loading: metricsLoading } = useCompanyMetrics(year);

  const loading = dataLoading || metricsLoading;

  // Dashboard data structure
  const dashboardData = useMemo(() => {
    const projectedClosingsHeaders = [{
      key: "funded",
      label: "Funded",
      color: "bg-rose-500"
    }, {
      key: "ctc",
      label: "CTC",
      color: "bg-emerald-500"
    }, {
      key: "condApproved",
      label: "Cond. Approved",
      color: "bg-sky-500"
    }, {
      key: "locked",
      label: "Locked",
      color: "bg-green-500"
    }];

    const finalDispositionHeaders = [{
      key: "originated",
      label: "Originated"
    }, {
      key: "adverse",
      label: "Adverse"
    }, {
      key: "withdrawn",
      label: "Withdrawn"
    }];

    const activeLoansHeaders = [{
      key: "today10",
      label: "Today + 10"
    }, {
      key: "11_30",
      label: "11 - 30"
    }, {
      key: "gt30",
      label: "> 30"
    }, {
      key: "notLocked",
      label: "Not Locked"
    }];

    return {
      projectedClosings: {
        title: "Projected Closings",
        headers: projectedClosingsHeaders,
        data: companyData?.projectedClosings || []
      },
      finalDisposition: {
        title: "Month to Date Final Disposition",
        headers: finalDispositionHeaders,
        data: companyData?.finalDisposition || []
      },
      activeLoans: {
        title: "Active Loans by Status",
        headers: activeLoansHeaders,
        data: companyData?.activeLoans || []
      }
    };
  }, [companyData]);

  // Calculate donut chart data from projected closings
  const donutData = useMemo(() => {
    if (!companyData?.projectedClosings || companyData.projectedClosings.length === 0) {
      return [{
        name: "Funded",
        value: 0,
        fill: "#f43f5e"
      }, {
        name: "CTC",
        value: 0,
        fill: "#10b981"
      }, {
        name: "Conditional Approved",
        value: 0,
        fill: "#0ea5e9"
      }, {
        name: "Locked",
        value: 0,
        fill: "#22c55e"
      }];
    }

    // Sum up all months
    const totals = companyData.projectedClosings.reduce((acc, row) => {
      acc.funded += row.columns.funded;
      acc.ctc += row.columns.ctc;
      acc.condApproved += row.columns.condApproved;
      acc.locked += row.columns.locked;
      return acc;
    }, { funded: 0, ctc: 0, condApproved: 0, locked: 0 });

    return [{
      name: "Funded",
      value: totals.funded,
      fill: "#f43f5e"
    }, {
      name: "CTC",
      value: totals.ctc,
      fill: "#10b981"
    }, {
      name: "Conditional Approved",
      value: totals.condApproved,
      fill: "#0ea5e9"
    }, {
      name: "Locked",
      value: totals.locked,
      fill: "#22c55e"
    }];
  }, [companyData]);

  // Format volume for display
  const formatVolume = (volume: number): string => {
    if (volume >= 1000000) {
      return `$${(volume / 1000000).toFixed(1)}M`;
    } else if (volume >= 1000) {
      return `$${(volume / 1000).toFixed(0)}K`;
    }
    return `$${volume.toFixed(0)}`;
  };

  const handleCopyJSON = () => {
    navigator.clipboard.writeText(JSON.stringify(dashboardData, null, 2));
    toast({
      title: "Copied!",
      description: "JSON data copied to clipboard"
    });
  };

  // Get insight color class based on type
  const getInsightColorClass = (type: 'info' | 'success' | 'warning') => {
    switch (type) {
      case 'info':
        return 'bg-indigo-50/50 dark:bg-indigo-950/20 border-indigo-100 dark:border-indigo-900/40';
      case 'success':
        return 'bg-emerald-50/50 dark:bg-emerald-950/20 border-emerald-100 dark:border-emerald-900/40';
      case 'warning':
        return 'bg-amber-50/50 dark:bg-amber-950/20 border-amber-100 dark:border-amber-900/40';
      default:
        return 'bg-indigo-50/50 dark:bg-indigo-950/20 border-indigo-100 dark:border-indigo-900/40';
    }
  };

  return (
    <div className="min-h-screen bg-white dark:bg-slate-950">
      <div className="container mx-auto px-3 sm:px-6 md:px-8 lg:px-12 pb-4 sm:pb-8 md:pb-12 relative z-10">
        <div>
          <div className="mt-12 sm:mt-16">
            <div className="space-y-4 sm:space-y-6">
              {/* TopTiering Header with Navigation */}
              <div className="bg-white dark:bg-slate-900/70 rounded-xl p-3 sm:p-4 md:p-6 border border-slate-100 dark:border-slate-800 shadow-[0_1px_3px_rgba(0,0,0,0.04)] overflow-hidden">
                <div className="mb-4 sm:mb-6 space-y-3 sm:space-y-4 pb-3 sm:pb-4 border-b border-slate-200 dark:border-slate-700">
                  <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
                    <div className="flex items-center gap-3 sm:gap-4 flex-1 min-w-0">
                      <div className="relative flex-shrink-0">
                        <div className="w-10 h-10 sm:w-14 sm:h-14 rounded-xl sm:rounded-2xl bg-gradient-to-br from-[#007AFF] to-blue-600 flex items-center justify-center shadow-lg shadow-blue-500/20">
                          <BarChart3 className="w-5 h-5 sm:w-7 sm:h-7 text-white" />
                        </div>
                      </div>
                      <div className="min-w-0">
                        <h3 className="text-lg sm:text-2xl md:text-3xl font-extralight text-slate-900 dark:text-white mb-0.5 tracking-tight leading-tight truncate">
                          TopTiering<sup className="text-[10px] sm:text-xs md:text-sm align-super ml-0.5 opacity-70">®</sup>
                        </h3>
                      </div>
                    </div>
                    {onTabChange && (
                      <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800/50 rounded-lg flex-shrink-0 flex-wrap">
                        <button onClick={() => onTabChange('company')} className="px-3 py-1.5 sm:px-4 sm:py-2 text-xs sm:text-sm font-medium rounded-md transition-all bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm">
                          Company
                        </button>
                        <button onClick={() => onTabChange('sales')} className="px-3 py-1.5 sm:px-4 sm:py-2 text-xs sm:text-sm font-medium rounded-md transition-all text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300">
                          Sales
                        </button>
                        <button onClick={() => onTabChange('ops')} className="px-3 py-1.5 sm:px-4 sm:py-2 text-xs sm:text-sm font-medium rounded-md transition-all text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300">
                          Ops
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Company Detail Header */}
        <div className="bg-white dark:bg-slate-900/70 rounded-xl p-3 sm:p-4 md:p-6 border border-slate-100 dark:border-slate-800 shadow-[0_1px_3px_rgba(0,0,0,0.04)] mb-4 sm:mb-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4 mb-4 sm:mb-6">
            <h2 className="text-lg sm:text-2xl md:text-3xl font-extralight text-slate-900 dark:text-white tracking-tight">
              Company Detail
            </h2>
            <div className="flex items-center gap-2">
              <button className="p-2 hover:bg-slate-50 dark:hover:bg-slate-800/50 rounded-lg transition-colors">
                <Share2 className="w-4 h-4 text-slate-500 dark:text-slate-400" />
              </button>
              <button onClick={onBack} className="p-2 hover:bg-slate-50 dark:hover:bg-slate-800/50 rounded-lg transition-colors" title="Back to Company Overview">
                <ChevronLeft className="w-4 h-4 text-slate-500 dark:text-slate-400" />
              </button>
            </div>
          </div>

          {/* Year Selection */}
          <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
            <span className="text-[10px] sm:text-xs md:text-sm font-light text-slate-500 dark:text-slate-400">Year:</span>
            <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800/50 rounded-lg">
              {[2025, 2024, 2023, 2022].map(y => (
                <button 
                  key={y} 
                  onClick={() => setYear(y)} 
                  className={`px-3 py-1.5 text-xs sm:text-sm font-medium rounded-md transition-all tracking-tight ${
                    year === y 
                      ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm' 
                      : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
                  }`}
                >
                  {y}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Raw JSON View Toggle */}
        {showRawData && (
          <div className="mb-6">
            <DashboardCard>
              <div className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-extralight text-slate-900 dark:text-white tracking-tight">Raw JSON Data</h3>
                  <button onClick={() => setShowRawData(false)} className="w-8 h-8 rounded-full bg-white/90 dark:bg-slate-800/90 border border-slate-200 dark:border-slate-700 shadow-sm hover:bg-slate-50 dark:hover:bg-slate-700 backdrop-blur-sm flex items-center justify-center transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-slate-300 focus:ring-offset-1">
                    <X className="w-4 h-4 text-slate-500 dark:text-slate-400" strokeWidth={1.5} />
                  </button>
                </div>
                <pre className="bg-slate-50 dark:bg-slate-800/50 text-slate-900 dark:text-slate-100 p-4 rounded-lg overflow-x-auto text-xs font-mono border border-slate-200 dark:border-slate-700">
                  {JSON.stringify(dashboardData, null, 2)}
                </pre>
              </div>
            </DashboardCard>
          </div>
        )}

        {/* Top Row: 1:3 Grid Split */}
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 sm:gap-6 mb-4 sm:mb-6" style={{ fontFamily: 'Inter, sans-serif' }}>
          {/* AI Insights Card - Left (1 column) */}
          <DashboardCard>
            <div className="p-4 sm:p-5 md:p-6">
              <div className="flex items-center gap-2 mb-3 sm:mb-4">
                <Sparkles className="w-4 h-4 sm:w-5 sm:h-5 text-indigo-600 dark:text-indigo-400" />
                <h3 className="text-sm sm:text-base font-extralight text-slate-900 dark:text-white tracking-tight">AI Insights</h3>
              </div>
              <div className="space-y-2 sm:space-y-3">
                {loading ? (
                  <div className="p-2 sm:p-3 bg-slate-50/50 dark:bg-slate-800/20 rounded-lg border border-slate-100 dark:border-slate-700">
                    <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 font-light">Loading insights...</p>
                  </div>
                ) : metrics?.aiInsights && metrics.aiInsights.length > 0 ? (
                  metrics.aiInsights.map((insight, idx) => (
                    <div key={idx} className={`p-2 sm:p-3 rounded-lg border ${getInsightColorClass(insight.type)}`}>
                      <p className="text-xs sm:text-sm text-slate-700 dark:text-slate-300 font-light">
                        {insight.message}
                      </p>
                    </div>
                  ))
                ) : (
                  <div className="p-2 sm:p-3 bg-slate-50/50 dark:bg-slate-800/20 rounded-lg border border-slate-100 dark:border-slate-700">
                    <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 font-light">No insights available</p>
                  </div>
                )}
              </div>
            </div>
          </DashboardCard>

          {/* Right Side (3 columns) */}
          <div className="lg:col-span-3 grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
            {/* Projected Closings Donut Chart */}
            <DashboardCard>
              <div className="p-4 sm:p-5 md:p-6">
                <h3 className="text-sm sm:text-base font-extralight text-slate-900 dark:text-white mb-3 sm:mb-4 tracking-tight">Projected Closings</h3>
                <div className="h-48 sm:h-56 md:h-64">
                  <ChartContainer config={{}} className="h-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={donutData} cx="50%" cy="50%" innerRadius="40%" outerRadius="70%" paddingAngle={2} dataKey="value">
                          {donutData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.fill} />
                          ))}
                        </Pie>
                        <ChartTooltip content={<ChartTooltipContent />} />
                      </PieChart>
                    </ResponsiveContainer>
                  </ChartContainer>
                </div>
                <div className="flex flex-wrap gap-2 sm:gap-3 mt-3 sm:mt-4 justify-center">
                  {donutData.map((item, idx) => (
                    <div key={idx} className="flex items-center gap-1.5 sm:gap-2">
                      <div className="w-2.5 h-2.5 sm:w-3 sm:h-3 rounded-full" style={{ backgroundColor: item.fill }} />
                      <span className="text-[10px] sm:text-xs text-slate-500 dark:text-slate-400 font-light">{item.name}: {item.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            </DashboardCard>

            {/* Quick Stats Card */}
            <DashboardCard className="bg-white dark:bg-slate-800/50 border border-slate-100 dark:border-slate-700">
              <div className="p-4 sm:p-5 md:p-6">
                <h3 className="text-sm sm:text-base font-extralight text-slate-900 dark:text-white mb-4 sm:mb-6 tracking-tight">Quick Stats</h3>
                <div className="space-y-3 sm:space-y-4">
                  <div>
                    <p className="text-[10px] sm:text-xs text-slate-500 dark:text-slate-400 mb-1 font-light">Total Projected Units</p>
                    <p className="text-2xl sm:text-3xl font-extralight text-slate-900 dark:text-white tracking-tight">
                      {loading ? '...' : (metrics?.totalProjectedUnits || 0)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] sm:text-xs text-slate-500 dark:text-slate-400 mb-1 font-light">Total Projected Volume</p>
                    <p className="text-xl sm:text-2xl font-extralight text-slate-900 dark:text-white tracking-tight">
                      {loading ? '...' : formatVolume(metrics?.totalProjectedVolume || 0)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] sm:text-xs text-slate-500 dark:text-slate-400 mb-1 font-light">Weighted Avg WAC</p>
                    <p className="text-xl sm:text-2xl font-extralight text-slate-900 dark:text-white tracking-tight">
                      {loading ? '...' : `${(metrics?.weightedAvgWAC || 0).toFixed(3)}%`}
                    </p>
                  </div>
                  <div className="pt-3 sm:pt-4 border-t border-slate-100 dark:border-slate-700">
                    <p className="text-[10px] sm:text-xs text-slate-500 dark:text-slate-400 mb-1 font-light">Active Loans</p>
                    <p className="text-xl sm:text-2xl font-extralight text-slate-900 dark:text-white tracking-tight">
                      {loading ? '...' : (metrics?.activeLoans || 0)}
                    </p>
                  </div>
                </div>
              </div>
            </DashboardCard>
          </div>
        </div>

        {/* Projected Closings Table - Fullscreen */}
        <div className="mb-4 sm:mb-6" style={{ fontFamily: 'Inter, sans-serif' }}>
          <DataTable 
            title={dashboardData.projectedClosings.title} 
            headers={dashboardData.projectedClosings.headers} 
            data={dashboardData.projectedClosings.data} 
            showTotal={true} 
            stickyFirstColumn={true} 
          />
        </div>

        {/* 2 Column Grid: Final Disposition and Active Loans */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6" style={{ fontFamily: 'Inter, sans-serif' }}>
          {/* Final Disposition Table */}
          <DataTable 
            title={dashboardData.finalDisposition.title} 
            headers={dashboardData.finalDisposition.headers} 
            data={dashboardData.finalDisposition.data} 
            showTotal={false} 
            stickyFirstColumn={true} 
          />

          {/* Active Loans Table */}
          <DataTable 
            title={dashboardData.activeLoans.title} 
            headers={dashboardData.activeLoans.headers} 
            data={dashboardData.activeLoans.data} 
            showTotal={true} 
            stickyFirstColumn={true} 
          />
        </div>
      </div>
    </div>
  );
};

