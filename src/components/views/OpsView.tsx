import { useMemo } from 'react';
import { useDashboardFilterAnalytics } from '@/hooks/useDashboardFilterAnalytics';
import { DASHBOARD_PAGE_KEYS } from '@/lib/dashboardPageKeys';
import { BarChart3, ArrowUp, ArrowDown } from 'lucide-react';
import { motion } from 'framer-motion';
import { useOpsData } from '@/hooks/useOpsData';

interface OpsViewProps {
  onTabChange: (tab: 'company' | 'sales' | 'ops') => void;
  selectedTenantId?: string | null;
  selectedChannel?: string | null;
  year: number;
  dateFilterType: 'year' | 'custom';
  customDateRange: { start: Date | null; end: Date | null };
}

export const OpsView = ({ 
  onTabChange, 
  selectedTenantId, 
  selectedChannel, 
  year, 
  dateFilterType, 
  customDateRange 
}: OpsViewProps) => {
  // Build date range for the hook
  const dateRange = useMemo(() => {
    if (dateFilterType === 'custom' && customDateRange.start && customDateRange.end) {
      return {
        startDate: customDateRange.start.toISOString().split('T')[0],
        endDate: customDateRange.end.toISOString().split('T')[0],
      };
    }
    
    // For year-based filtering
    const startOfYear = `${year}-01-01`;
    const today = new Date();
    const isCurrentYear = year === today.getFullYear();
    const endDate = isCurrentYear 
      ? today.toISOString().split('T')[0]
      : `${year}-12-31`;
    
    return { startDate: startOfYear, endDate };
  }, [dateFilterType, year, customDateRange.start, customDateRange.end]);

  const opsFilterAnalytics = useMemo(
    () => ({
      date_filter_type: dateFilterType,
      year,
      date_range: dateRange,
      selected_channel: selectedChannel ?? 'All',
    }),
    [dateFilterType, year, dateRange, selectedChannel]
  );
  useDashboardFilterAnalytics(DASHBOARD_PAGE_KEYS.ops_view, opsFilterAnalytics);
  
  const { opsData, loading } = useOpsData(dateRange, selectedTenantId, selectedChannel);

  // Helper to format volume
  const formatVolume = (volume: number) => {
    if (volume >= 1000000) return `$${(volume / 1000000).toFixed(1)}M`;
    if (volume >= 1000) return `$${(volume / 1000).toFixed(0)}K`;
    return `$${volume.toFixed(0)}`;
  };

  // Operations metrics data from API
  const opsMetrics = [{
    title: 'Average Cycle Time',
    value: `${opsData?.avgCycleTime?.current || 0} days`,
    target: `${opsData?.avgCycleTime?.target || 0} days`,
    status: (opsData?.avgCycleTime?.current || 0) > (opsData?.avgCycleTime?.target || 0) ? 'warning' : 'healthy',
    definition: 'Average time from application to funding'
  }, {
    title: 'Active Pipeline',
    value: `${opsData?.activePipeline?.count || 0} loans`,
    volume: formatVolume(opsData?.activePipeline?.volume || 0),
    status: 'healthy',
    definition: 'Total loans currently in processing'
  }, {
    title: 'Processing Efficiency',
    value: `${opsData?.processingEfficiency?.current || 0}%`,
    target: `${opsData?.processingEfficiency?.target || 0}%`,
    status: (opsData?.processingEfficiency?.current || 0) < (opsData?.processingEfficiency?.target || 0) ? 'warning' : 'healthy',
    definition: 'Percentage of loans processed within target timeframe'
  }];

  // Turn time by stage data from API
  const turnTimeData = opsData?.turnTimeByStage ? [
    {
      stage: 'Application to Lock',
      days: opsData.turnTimeByStage.appToLock.actual,
      target: opsData.turnTimeByStage.appToLock.target
    },
    {
      stage: 'Lock to CTC',
      days: opsData.turnTimeByStage.lockToCTC.actual,
      target: opsData.turnTimeByStage.lockToCTC.target
    },
    {
      stage: 'CTC to Funding',
      days: opsData.turnTimeByStage.ctcToFunding.actual,
      target: opsData.turnTimeByStage.ctcToFunding.target
    }
  ] : [{
    stage: 'Application to Lock',
    days: 0,
    target: 0
  }, {
    stage: 'Lock to CTC',
    days: 0,
    target: 0
  }, {
    stage: 'CTC to Funding',
    days: 0,
    target: 0
  }];

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header with Navigation */}
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
            <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800/50 rounded-lg flex-shrink-0 flex-wrap">
              <button onClick={() => onTabChange('company')} className="px-3 py-1.5 sm:px-4 sm:py-2 text-xs sm:text-sm font-medium rounded-md transition-all text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300">
                Company
              </button>
              <button onClick={() => onTabChange('sales')} className="px-3 py-1.5 sm:px-4 sm:py-2 text-xs sm:text-sm font-medium rounded-md transition-all text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300">
                Sales
              </button>
              <button onClick={() => onTabChange('ops')} className="px-3 py-1.5 sm:px-4 sm:py-2 text-xs sm:text-sm font-medium rounded-md transition-all bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm">
                Ops
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Operations Overview Header */}
      <div className="bg-white dark:bg-slate-900/70 rounded-xl p-3 sm:p-4 md:p-6 border border-slate-100 dark:border-slate-800 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4 mb-4 sm:mb-6">
          <h2 className="text-lg sm:text-2xl md:text-3xl font-extralight text-slate-900 dark:text-white tracking-tight">
            Operations Overview
          </h2>
          <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
            <span className="text-[10px] sm:text-xs md:text-sm font-light text-slate-500 dark:text-slate-400">
              Showing data for: <span className="text-slate-900 dark:text-white">{dateRange.startDate} - {dateRange.endDate}</span>
            </span>
          </div>
        </div>

        {/* Operations Metrics Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 sm:gap-4 mb-4 sm:mb-6">
          {opsMetrics.map((metric, idx) => {
            const statusColors = {
              healthy: 'border-emerald-200 dark:border-emerald-800',
              warning: 'border-amber-200 dark:border-amber-800',
              critical: 'border-rose-200 dark:border-rose-800'
            };
            return (
              <motion.div 
                key={idx} 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.1 }}
                className={`bg-white dark:bg-slate-800/50 border ${statusColors[metric.status as keyof typeof statusColors]} rounded-xl p-4 sm:p-5 shadow-[0_1px_3px_rgba(0,0,0,0.04)]`}
              >
                <h3 className="text-sm sm:text-base font-light text-slate-900 dark:text-white mb-3 sm:mb-4 tracking-tight">
                  {metric.title}
                </h3>
                <div className="space-y-2 sm:space-y-2.5 mb-3 sm:mb-4">
                  <div className="flex items-baseline gap-2">
                    <span className="text-2xl sm:text-3xl md:text-4xl font-extralight text-slate-900 dark:text-white tracking-tight">
                      {metric.value}
                    </span>
                  </div>
                  {metric.target && (
                    <div className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 font-light">
                      Target: <span className="font-light text-slate-900 dark:text-white">{metric.target}</span>
                    </div>
                  )}
                  {metric.volume && (
                    <div className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 font-light">
                      Volume: <span className="font-light text-slate-900 dark:text-white">{metric.volume}</span>
                    </div>
                  )}
                </div>
                <p className="text-[10px] sm:text-xs text-slate-400 dark:text-slate-500 leading-relaxed pt-3 border-t border-slate-100 dark:border-slate-700 font-light">
                  {metric.definition}
                </p>
              </motion.div>
            );
          })}
        </div>

        {/* Turn Time Analysis */}
        <div className="bg-white dark:bg-slate-800/50 border border-slate-100 dark:border-slate-700 rounded-xl p-4 sm:p-5 md:p-6 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
          <div className="mb-4 sm:mb-6">
            <h3 className="text-base sm:text-lg md:text-xl font-extralight text-slate-900 dark:text-white tracking-tight mb-1">
              Turn Time by Stage
            </h3>
            <p className="text-[10px] sm:text-xs text-slate-500 dark:text-slate-400 font-light">Processing efficiency metrics</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
            {turnTimeData.map((item, idx) => {
              const isOverTarget = item.days > item.target;
              const percentage = Math.min((item.days / item.target) * 100, 100);
              const variance = item.days - item.target;
              const variancePercent = ((variance / item.target) * 100).toFixed(0);
              
              return (
                <motion.div
                  key={idx}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.1 }}
                  className="relative bg-white dark:bg-slate-800/50 border border-slate-100 dark:border-slate-700 rounded-xl p-4 sm:p-5 shadow-[0_1px_3px_rgba(0,0,0,0.04)] hover:shadow-[0_2px_8px_rgba(0,0,0,0.08)] transition-all duration-200"
                >
                  {/* Status Badge */}
                  <div className={`absolute top-3 right-3 px-2 py-1 rounded-md text-[10px] font-light ${
                    isOverTarget 
                      ? 'bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800/40' 
                      : 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/40'
                  }`}>
                    {isOverTarget ? 'Over Target' : 'On Track'}
                  </div>

                  {/* Stage Name */}
                  <div className="mb-4 pr-20">
                    <h4 className="text-sm sm:text-base font-light text-slate-900 dark:text-white tracking-tight mb-1">
                      {item.stage}
                    </h4>
                    <p className="text-[10px] sm:text-xs text-slate-500 dark:text-slate-400 font-light">
                      Target: {item.target} days
                    </p>
                  </div>

                  {/* Days Display */}
                  <div className="mb-4">
                    <div className="flex items-baseline gap-2 mb-2">
                      <span className={`text-2xl sm:text-3xl font-extralight tracking-tight ${
                        isOverTarget 
                          ? 'text-amber-600 dark:text-amber-400' 
                          : 'text-emerald-600 dark:text-emerald-400'
                      }`}>
                        {item.days}
                      </span>
                      <span className="text-sm text-slate-500 dark:text-slate-400 font-light">days</span>
                    </div>
                    {variance !== 0 && (
                      <div className={`flex items-center gap-1 text-xs font-light ${
                        isOverTarget 
                          ? 'text-amber-600 dark:text-amber-400' 
                          : 'text-emerald-600 dark:text-emerald-400'
                      }`}>
                        {isOverTarget ? (
                          <>
                            <ArrowUp className="w-3 h-3" />
                            <span>+{variance} days ({variancePercent}% over)</span>
                          </>
                        ) : (
                          <>
                            <ArrowDown className="w-3 h-3" />
                            <span>{Math.abs(variance)} days under</span>
                          </>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Progress Bar */}
                  <div className="space-y-1.5">
                    <div className="w-full bg-slate-100 dark:bg-slate-700/50 rounded-full h-1.5 overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${Math.min(percentage, 100)}%` }}
                        transition={{ duration: 0.8, delay: idx * 0.1 + 0.2 }}
                        className={`h-1.5 rounded-full ${
                          isOverTarget 
                            ? 'bg-amber-500 dark:bg-amber-500' 
                            : 'bg-emerald-500 dark:bg-emerald-500'
                        }`}
                      />
                    </div>
                    <div className="flex items-center justify-between text-[10px] text-slate-400 dark:text-slate-500 font-light">
                      <span>0</span>
                      <span>{item.target}</span>
                      <span>{item.days}</span>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

