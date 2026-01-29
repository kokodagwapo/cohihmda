import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { TrendingUp, TrendingDown, Minus, Sparkles } from 'lucide-react';
import { 
  ActiveLoansData, 
  ClosedLoansData, 
  LockedLoansData, 
  CycleTimeData, 
  PullThroughData, 
  CreditPullsData,
  KPIMetric,
  KPIDrilldown
} from '@/types/businessOverview';

interface BusinessOverviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  type: 'kpi' | 'activeLoans' | 'closedLoans' | 'lockedLoans' | 'cycleTime' | 'pullThrough' | 'creditPulls';
  data: ActiveLoansData | ClosedLoansData | LockedLoansData | CycleTimeData | PullThroughData | CreditPullsData | KPIMetric | null;
}

// Pastel color schemes for different section types
const sectionColors = [
  'from-blue-50/80 to-indigo-50/60 dark:from-blue-950/20 dark:to-indigo-950/15 border-blue-100/60 dark:border-blue-900/30',
  'from-emerald-50/80 to-teal-50/60 dark:from-emerald-950/20 dark:to-teal-950/15 border-emerald-100/60 dark:border-emerald-900/30',
  'from-violet-50/80 to-purple-50/60 dark:from-violet-950/20 dark:to-purple-950/15 border-violet-100/60 dark:border-violet-900/30',
  'from-amber-50/80 to-orange-50/60 dark:from-amber-950/20 dark:to-orange-950/15 border-amber-100/60 dark:border-amber-900/30',
  'from-rose-50/80 to-pink-50/60 dark:from-rose-950/20 dark:to-pink-950/15 border-rose-100/60 dark:border-rose-900/30',
];

export const BusinessOverviewModal: React.FC<BusinessOverviewModalProps> = ({ 
  isOpen, 
  onClose, 
  title, 
  type, 
  data 
}) => {
  if (!data) return null;

  const renderContent = () => {
    switch (type) {
      case 'kpi': {
        const kpiData = data as KPIMetric;
        const drilldown = kpiData.drilldown;
        return (
          <div className="px-4 sm:px-6 py-4 sm:py-5 overflow-y-auto max-h-[65vh] sm:max-h-[60vh]">
            {/* Hero Header with value and change */}
            <div className="text-center mb-5 sm:mb-6 pb-4 sm:pb-5 border-b border-slate-200/60 dark:border-slate-700/50">
              <div className="flex items-center justify-center gap-2 sm:gap-3 mb-2">
                <h3 className="text-4xl sm:text-5xl font-extralight text-slate-900 dark:text-white tracking-[-0.02em]">{kpiData.value}</h3>
                <div className="flex items-center gap-1">
                  {kpiData.trend === 'up' ? (
                    <TrendingUp className="w-5 h-5 sm:w-6 sm:h-6 text-emerald-500" />
                  ) : kpiData.trend === 'down' ? (
                    <TrendingDown className="w-5 h-5 sm:w-6 sm:h-6 text-rose-500" />
                  ) : (
                    <Minus className="w-5 h-5 sm:w-6 sm:h-6 text-slate-400" />
                  )}
                  <span className={`text-lg sm:text-xl font-light tracking-tight ${
                    kpiData.trend === 'up' ? 'text-emerald-500' : 
                    kpiData.trend === 'down' ? 'text-rose-500' : 
                    'text-slate-400'
                  }`}>
                    {kpiData.changeValue}
                  </span>
                </div>
              </div>
              {drilldown?.summary && (
                <p className="text-sm sm:text-base text-slate-600 dark:text-slate-400 font-light tracking-tight">{drilldown.summary}</p>
              )}
            </div>

            {/* Drilldown Sections with Pastel Backgrounds */}
            {drilldown?.sections && drilldown.sections.map((section, sectionIdx) => (
              <div 
                key={sectionIdx} 
                className={`mb-4 sm:mb-5 p-3 sm:p-4 rounded-xl sm:rounded-2xl bg-gradient-to-br ${sectionColors[sectionIdx % sectionColors.length]} border`}
              >
                <h4 className="text-xs sm:text-sm font-medium text-slate-700 dark:text-slate-300 mb-3 tracking-tight">{section.title}</h4>
                <div className="overflow-x-auto -mx-3 sm:mx-0 px-3 sm:px-0">
                  <table className="w-full text-xs sm:text-sm min-w-[280px]">
                    <thead>
                      <tr className="border-b border-slate-200/50 dark:border-slate-700/50">
                        <th className="text-left py-2 px-2 sm:px-3 text-[10px] sm:text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">Category</th>
                        <th className="text-right py-2 px-2 sm:px-3 text-[10px] sm:text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">Value</th>
                        {section.data[0]?.pct && (
                          <th className="text-right py-2 px-2 sm:px-3 text-[10px] sm:text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">Share</th>
                        )}
                        {section.data[0]?.change && (
                          <th className="text-right py-2 px-2 sm:px-3 text-[10px] sm:text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">Change</th>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {section.data.map((item, itemIdx) => (
                        <tr key={itemIdx} className="border-b border-slate-100/50 dark:border-slate-800/50 last:border-0">
                          <td className="py-2.5 px-2 sm:px-3 text-slate-700 dark:text-slate-300 font-light tracking-tight">{item.label}</td>
                          <td className="py-2.5 px-2 sm:px-3 text-right text-slate-900 dark:text-white font-medium tabular-nums">{item.value}</td>
                          {item.pct && (
                            <td className="py-2.5 px-2 sm:px-3 text-right text-slate-500 dark:text-slate-400 font-light tabular-nums">{item.pct}</td>
                          )}
                          {item.change && (
                            <td className={`py-2.5 px-2 sm:px-3 text-right font-medium tabular-nums ${
                              item.change.startsWith('+') ? 'text-emerald-600 dark:text-emerald-400' : 
                              item.change.startsWith('-') ? 'text-rose-600 dark:text-rose-400' : 
                              'text-slate-600'
                            }`}>
                              {item.change}
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}

            {/* Insight Card */}
            {drilldown?.insight && (
              <div className="bg-gradient-to-br from-sky-50/90 to-blue-50/70 dark:from-sky-950/30 dark:to-blue-950/20 rounded-xl sm:rounded-2xl p-4 sm:p-5 border border-sky-100/60 dark:border-sky-900/30">
                <div className="flex items-start gap-2.5 sm:gap-3">
                  <div className="w-6 h-6 sm:w-7 sm:h-7 rounded-lg bg-gradient-to-br from-sky-500 to-blue-600 flex items-center justify-center flex-shrink-0 shadow-sm">
                    <Sparkles className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-white" />
                  </div>
                  <div>
                    <p className="text-[10px] sm:text-xs font-medium text-sky-700 dark:text-sky-400 uppercase tracking-wider mb-1">Insight</p>
                    <p className="text-xs sm:text-sm text-slate-700 dark:text-slate-300 font-light leading-relaxed tracking-tight">{drilldown.insight}</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      }

      case 'activeLoans':
      case 'closedLoans': {
        const loanData = data as ActiveLoansData | ClosedLoansData;
        return (
          <div className="px-4 sm:px-6 py-4 sm:py-5 max-h-[65vh] sm:max-h-[55vh] overflow-y-auto">
            {/* Summary Badge */}
            <div className="mb-4 sm:mb-5 inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-gradient-to-r from-emerald-50 to-teal-50 dark:from-emerald-950/30 dark:to-teal-950/20 border border-emerald-100/60 dark:border-emerald-900/30">
              <TrendingUp className="w-3.5 h-3.5 text-emerald-500" />
              <span className="text-xs sm:text-sm font-light text-slate-700 dark:text-slate-300 tracking-tight">
                Units Change: <span className="font-medium text-emerald-600 dark:text-emerald-400">{loanData.totalUnitsUpDown}</span>
              </span>
            </div>

            {loanData.sections.map((section, idx) => (
              <div 
                key={idx} 
                className={`mb-4 sm:mb-5 p-3 sm:p-4 rounded-xl sm:rounded-2xl bg-gradient-to-br ${sectionColors[idx % sectionColors.length]} border`}
              >
                <h4 className="text-xs sm:text-sm font-medium text-slate-700 dark:text-slate-300 mb-3 tracking-tight">{section.title}</h4>
                <div className="overflow-x-auto -mx-3 sm:mx-0 px-3 sm:px-0">
                  <table className="w-full text-xs sm:text-sm min-w-[480px]">
                    <thead>
                      <tr className="border-b border-slate-200/50 dark:border-slate-700/50">
                        <th className="text-left py-2 px-2 sm:px-3 text-[10px] sm:text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider whitespace-nowrap">Type</th>
                        <th className="text-right py-2 px-2 sm:px-3 text-[10px] sm:text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider whitespace-nowrap">Units</th>
                        <th className="text-right py-2 px-2 sm:px-3 text-[10px] sm:text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider whitespace-nowrap">Volume</th>
                        <th className="text-right py-2 px-2 sm:px-3 text-[10px] sm:text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider whitespace-nowrap">Rate</th>
                        <th className="text-right py-2 px-2 sm:px-3 text-[10px] sm:text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider whitespace-nowrap">Balance</th>
                        <th className="text-right py-2 px-2 sm:px-3 text-[10px] sm:text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider whitespace-nowrap">FICO</th>
                        <th className="text-right py-2 px-2 sm:px-3 text-[10px] sm:text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider whitespace-nowrap">LTV</th>
                      </tr>
                    </thead>
                    <tbody>
                      {section.rows.map((row, rowIdx) => (
                        <tr key={rowIdx} className="border-b border-slate-100/50 dark:border-slate-800/50 last:border-0">
                          <td className="py-2.5 px-2 sm:px-3 text-slate-700 dark:text-slate-300 font-light tracking-tight whitespace-nowrap">{row.category}</td>
                          <td className="py-2.5 px-2 sm:px-3 text-right text-slate-900 dark:text-white font-medium tabular-nums">{row.units}</td>
                          <td className="py-2.5 px-2 sm:px-3 text-right text-slate-900 dark:text-white font-medium tabular-nums">{row.volume}</td>
                          <td className="py-2.5 px-2 sm:px-3 text-right text-slate-600 dark:text-slate-400 font-light tabular-nums">{row.avgInterestRate}</td>
                          <td className="py-2.5 px-2 sm:px-3 text-right text-slate-600 dark:text-slate-400 font-light tabular-nums">{row.avgBalance}</td>
                          <td className="py-2.5 px-2 sm:px-3 text-right text-slate-600 dark:text-slate-400 font-light tabular-nums">{row.avgFICO}</td>
                          <td className="py-2.5 px-2 sm:px-3 text-right text-slate-600 dark:text-slate-400 font-light tabular-nums">{row.avgLTV}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        );
      }

      case 'lockedLoans': {
        const lockedData = data as LockedLoansData;
        return (
          <div className="px-4 sm:px-6 py-4 sm:py-5">
            {/* Summary Badge */}
            <div className="mb-4 sm:mb-5 inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-gradient-to-r from-emerald-50 to-teal-50 dark:from-emerald-950/30 dark:to-teal-950/20 border border-emerald-100/60 dark:border-emerald-900/30">
              <TrendingUp className="w-3.5 h-3.5 text-emerald-500" />
              <span className="text-xs sm:text-sm font-light text-slate-700 dark:text-slate-300 tracking-tight">
                Units Change: <span className="font-medium text-emerald-600 dark:text-emerald-400">{lockedData.totalUnitsUpDown}</span>
              </span>
            </div>

            <div className="p-3 sm:p-4 rounded-xl sm:rounded-2xl bg-gradient-to-br from-violet-50/80 to-purple-50/60 dark:from-violet-950/20 dark:to-purple-950/15 border border-violet-100/60 dark:border-violet-900/30">
              <h4 className="text-xs sm:text-sm font-medium text-slate-700 dark:text-slate-300 mb-3 tracking-tight">Lock Expiration Breakdown</h4>
              <div className="overflow-x-auto -mx-3 sm:mx-0 px-3 sm:px-0">
                <table className="w-full text-xs sm:text-sm">
                  <thead>
                    <tr className="border-b border-slate-200/50 dark:border-slate-700/50">
                      <th className="text-left py-2 px-2 sm:px-3 text-[10px] sm:text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">Expiration Period</th>
                      <th className="text-right py-2 px-2 sm:px-3 text-[10px] sm:text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">Units</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lockedData.breakdown.map((row, idx) => (
                      <tr key={idx} className="border-b border-slate-100/50 dark:border-slate-800/50 last:border-0">
                        <td className="py-2.5 px-2 sm:px-3 text-slate-700 dark:text-slate-300 font-light tracking-tight">{row.category}</td>
                        <td className="py-2.5 px-2 sm:px-3 text-right text-slate-900 dark:text-white font-medium tabular-nums">{row.units}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        );
      }

      case 'cycleTime': {
        const cycleData = data as CycleTimeData;
        return (
          <div className="px-4 sm:px-6 py-4 sm:py-5 overflow-y-auto max-h-[65vh] sm:max-h-[55vh]">
            {/* Hero Stats */}
            <div className="mb-5 sm:mb-6 p-4 sm:p-5 rounded-xl sm:rounded-2xl bg-gradient-to-br from-slate-50 to-slate-100/60 dark:from-slate-800/50 dark:to-slate-800/30 border border-slate-200/60 dark:border-slate-700/50">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-0">
                <div>
                  <p className="text-[10px] sm:text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">Avg Days to Funding</p>
                  <p className="text-3xl sm:text-4xl font-extralight text-slate-900 dark:text-white tracking-[-0.02em]">{cycleData.avgDaysToFunding} <span className="text-lg sm:text-xl text-slate-500">days</span></p>
                </div>
                <div className="flex gap-4 sm:gap-6">
                  <div className="text-center sm:text-right">
                    <p className="text-[10px] sm:text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">Target</p>
                    <p className="text-lg sm:text-xl font-light text-slate-700 dark:text-slate-300">{cycleData.target}d</p>
                  </div>
                  <div className="text-center sm:text-right">
                    <p className="text-[10px] sm:text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">Variance</p>
                    <p className={`text-lg sm:text-xl font-medium ${cycleData.variance.startsWith('-') ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                      {cycleData.variance}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Time By Stage */}
            <div className="mb-4 sm:mb-5 p-3 sm:p-4 rounded-xl sm:rounded-2xl bg-gradient-to-br from-blue-50/80 to-indigo-50/60 dark:from-blue-950/20 dark:to-indigo-950/15 border border-blue-100/60 dark:border-blue-900/30">
              <h4 className="text-xs sm:text-sm font-medium text-slate-700 dark:text-slate-300 mb-3 tracking-tight">Time By Stage</h4>
              <div className="overflow-x-auto -mx-3 sm:mx-0 px-3 sm:px-0">
                <table className="w-full text-xs sm:text-sm min-w-[300px]">
                  <thead>
                    <tr className="border-b border-slate-200/50 dark:border-slate-700/50">
                      <th className="text-left py-2 px-2 sm:px-3 text-[10px] sm:text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">Stage</th>
                      <th className="text-right py-2 px-2 sm:px-3 text-[10px] sm:text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">Days</th>
                      <th className="text-right py-2 px-2 sm:px-3 text-[10px] sm:text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">Target</th>
                      <th className="text-right py-2 px-2 sm:px-3 text-[10px] sm:text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">Var</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cycleData.timeByStage.map((stage, idx) => (
                      <tr key={idx} className="border-b border-slate-100/50 dark:border-slate-800/50 last:border-0">
                        <td className="py-2.5 px-2 sm:px-3 text-slate-700 dark:text-slate-300 font-light tracking-tight">{stage.stage}</td>
                        <td className="py-2.5 px-2 sm:px-3 text-right text-slate-900 dark:text-white font-medium tabular-nums">{stage.avgDays}</td>
                        <td className="py-2.5 px-2 sm:px-3 text-right text-slate-500 dark:text-slate-400 font-light tabular-nums">{stage.target}</td>
                        <td className={`py-2.5 px-2 sm:px-3 text-right font-medium tabular-nums ${stage.variance.startsWith('-') ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                          {stage.variance}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Cycle Time By Loan Type */}
            <div className="p-3 sm:p-4 rounded-xl sm:rounded-2xl bg-gradient-to-br from-emerald-50/80 to-teal-50/60 dark:from-emerald-950/20 dark:to-teal-950/15 border border-emerald-100/60 dark:border-emerald-900/30">
              <h4 className="text-xs sm:text-sm font-medium text-slate-700 dark:text-slate-300 mb-3 tracking-tight">Cycle Time By Loan Type</h4>
              <div className="overflow-x-auto -mx-3 sm:mx-0 px-3 sm:px-0">
                <table className="w-full text-xs sm:text-sm min-w-[280px]">
                  <thead>
                    <tr className="border-b border-slate-200/50 dark:border-slate-700/50">
                      <th className="text-left py-2 px-2 sm:px-3 text-[10px] sm:text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">Type</th>
                      <th className="text-right py-2 px-2 sm:px-3 text-[10px] sm:text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">Days</th>
                      <th className="text-center py-2 px-2 sm:px-3 text-[10px] sm:text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">Trend</th>
                      <th className="text-center py-2 px-2 sm:px-3 text-[10px] sm:text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cycleData.cycleTimeByType.map((type, idx) => (
                      <tr key={idx} className="border-b border-slate-100/50 dark:border-slate-800/50 last:border-0">
                        <td className="py-2.5 px-2 sm:px-3 text-slate-700 dark:text-slate-300 font-light tracking-tight">{type.loanType}</td>
                        <td className="py-2.5 px-2 sm:px-3 text-right text-slate-900 dark:text-white font-medium tabular-nums">{type.avgDays}</td>
                        <td className="py-2.5 px-2 sm:px-3 text-center">
                          {type.trend === 'up' ? (
                            <TrendingUp className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-rose-500 mx-auto" />
                          ) : type.trend === 'down' ? (
                            <TrendingDown className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-emerald-500 mx-auto" />
                          ) : (
                            <Minus className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-slate-400 mx-auto" />
                          )}
                        </td>
                        <td className="py-2.5 px-2 sm:px-3 text-center">
                          <span className={`px-2 py-0.5 sm:py-1 rounded-full text-[10px] sm:text-xs font-medium ${
                            type.status === 'good' ? 'bg-emerald-100/80 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' :
                            type.status === 'warning' ? 'bg-amber-100/80 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' :
                            'bg-rose-100/80 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400'
                          }`}>
                            {type.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        );
      }

      case 'pullThrough': {
        const pullData = data as PullThroughData;
        return (
          <div className="px-4 sm:px-6 py-4 sm:py-5 max-h-[65vh] sm:max-h-[55vh] overflow-y-auto">
            {/* Summary Badge */}
            <div className="mb-4 sm:mb-5 inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-gradient-to-r from-emerald-50 to-teal-50 dark:from-emerald-950/30 dark:to-teal-950/20 border border-emerald-100/60 dark:border-emerald-900/30">
              <TrendingUp className="w-3.5 h-3.5 text-emerald-500" />
              <span className="text-xs sm:text-sm font-light text-slate-700 dark:text-slate-300 tracking-tight">
                Average Change: <span className="font-medium text-emerald-600 dark:text-emerald-400">{pullData.avgPercentUpDown}</span>
              </span>
            </div>

            {/* Methodology Note */}
            <div className="mb-3 px-2 py-1.5 rounded-lg bg-blue-50/50 dark:bg-blue-950/20 border border-blue-100/40 dark:border-blue-900/20">
              <p className="text-[10px] sm:text-xs text-blue-600 dark:text-blue-400 font-light">
                Pull-through uses Rolling 90 Days and excludes active loans for accurate historical analysis.
              </p>
            </div>

            {/* Pull-Through By Type */}
            <div className="mb-4 sm:mb-5 p-3 sm:p-4 rounded-xl sm:rounded-2xl bg-gradient-to-br from-blue-50/80 to-indigo-50/60 dark:from-blue-950/20 dark:to-indigo-950/15 border border-blue-100/60 dark:border-blue-900/30">
              <h4 className="text-xs sm:text-sm font-medium text-slate-700 dark:text-slate-300 mb-3 tracking-tight">Pull-Through By Loan Type (Rolling 90D)</h4>
              <div className="overflow-x-auto -mx-3 sm:mx-0 px-3 sm:px-0">
                <table className="w-full text-xs sm:text-sm min-w-[300px]">
                  <thead>
                    <tr className="border-b border-slate-200/50 dark:border-slate-700/50">
                      <th className="text-left py-2 px-2 sm:px-3 text-[10px] sm:text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">Type</th>
                      <th className="text-right py-2 px-2 sm:px-3 text-[10px] sm:text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">Value</th>
                      <th className="text-right py-2 px-2 sm:px-3 text-[10px] sm:text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">Co. Avg</th>
                      <th className="text-center py-2 px-2 sm:px-3 text-[10px] sm:text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pullData.byType.map((type, idx) => (
                      <tr key={idx} className="border-b border-slate-100/50 dark:border-slate-800/50 last:border-0">
                        <td className="py-2.5 px-2 sm:px-3 text-slate-700 dark:text-slate-300 font-light tracking-tight">{type.loanType}</td>
                        <td className="py-2.5 px-2 sm:px-3 text-right text-slate-900 dark:text-white font-medium tabular-nums">{type.value}</td>
                        <td className="py-2.5 px-2 sm:px-3 text-right text-slate-500 dark:text-slate-400 font-light tabular-nums">{type.companyAverage}</td>
                        <td className="py-2.5 px-2 sm:px-3 text-center">
                          <span className={`px-2 py-0.5 sm:py-1 rounded-full text-[10px] sm:text-xs font-medium ${
                            type.status === 'above' ? 'bg-emerald-100/80 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' :
                            type.status === 'at' ? 'bg-blue-100/80 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' :
                            'bg-rose-100/80 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400'
                          }`}>
                            {type.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Fallout Breakdown */}
            <div className="p-3 sm:p-4 rounded-xl sm:rounded-2xl bg-gradient-to-br from-amber-50/80 to-orange-50/60 dark:from-amber-950/20 dark:to-orange-950/15 border border-amber-100/60 dark:border-amber-900/30">
              <h4 className="text-xs sm:text-sm font-medium text-slate-700 dark:text-slate-300 mb-3 tracking-tight">Fallout Breakdown</h4>
              <div className="grid grid-cols-2 gap-3 sm:gap-4">
                <div className="bg-white/60 dark:bg-slate-800/40 rounded-lg sm:rounded-xl p-3 sm:p-4 text-center border border-slate-200/40 dark:border-slate-700/30">
                  <p className="text-2xl sm:text-3xl font-extralight text-slate-900 dark:text-white tracking-[-0.02em] mb-1">{pullData.fallout.withdrawn}</p>
                  <p className="text-[10px] sm:text-xs text-slate-500 dark:text-slate-400 font-medium uppercase tracking-wider">Withdrawn</p>
                </div>
                <div className="bg-white/60 dark:bg-slate-800/40 rounded-lg sm:rounded-xl p-3 sm:p-4 text-center border border-slate-200/40 dark:border-slate-700/30">
                  <p className="text-2xl sm:text-3xl font-extralight text-slate-900 dark:text-white tracking-[-0.02em] mb-1">{pullData.fallout.denied}</p>
                  <p className="text-[10px] sm:text-xs text-slate-500 dark:text-slate-400 font-medium uppercase tracking-wider">Denied</p>
                </div>
              </div>
            </div>
          </div>
        );
      }

      case 'creditPulls': {
        const creditData = data as CreditPullsData;
        return (
          <div className="px-4 sm:px-6 py-4 sm:py-5">
            {/* Summary Badge */}
            <div className="mb-4 sm:mb-5 inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-gradient-to-r from-emerald-50 to-teal-50 dark:from-emerald-950/30 dark:to-teal-950/20 border border-emerald-100/60 dark:border-emerald-900/30">
              <TrendingUp className="w-3.5 h-3.5 text-emerald-500" />
              <span className="text-xs sm:text-sm font-light text-slate-700 dark:text-slate-300 tracking-tight">
                Units Change: <span className="font-medium text-emerald-600 dark:text-emerald-400">{creditData.unitsUpDown}</span>
              </span>
            </div>

            <div className="p-3 sm:p-4 rounded-xl sm:rounded-2xl bg-gradient-to-br from-blue-50/80 to-indigo-50/60 dark:from-blue-950/20 dark:to-indigo-950/15 border border-blue-100/60 dark:border-blue-900/30">
              <h4 className="text-xs sm:text-sm font-medium text-slate-700 dark:text-slate-300 mb-3 tracking-tight">Credit Pulls by Loan Type</h4>
              <div className="overflow-x-auto -mx-3 sm:mx-0 px-3 sm:px-0">
                <table className="w-full text-xs sm:text-sm">
                  <thead>
                    <tr className="border-b border-slate-200/50 dark:border-slate-700/50">
                      <th className="text-left py-2 px-2 sm:px-3 text-[10px] sm:text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">Loan Type</th>
                      <th className="text-right py-2 px-2 sm:px-3 text-[10px] sm:text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">MTD</th>
                      <th className="text-right py-2 px-2 sm:px-3 text-[10px] sm:text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">Month</th>
                    </tr>
                  </thead>
                  <tbody>
                    {creditData.byType.map((type, idx) => (
                      <tr key={idx} className="border-b border-slate-100/50 dark:border-slate-800/50 last:border-0">
                        <td className="py-2.5 px-2 sm:px-3 text-slate-700 dark:text-slate-300 font-light tracking-tight">{type.loanType}</td>
                        <td className="py-2.5 px-2 sm:px-3 text-right text-slate-900 dark:text-white font-medium tabular-nums">{type.mtdUnits}</td>
                        <td className="py-2.5 px-2 sm:px-3 text-right text-slate-900 dark:text-white font-medium tabular-nums">{type.monthUnits}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        );
      }

      default:
        return null;
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="w-[95vw] sm:w-auto sm:max-w-2xl p-0 gap-0 mx-auto rounded-2xl sm:rounded-3xl border border-slate-200/60 dark:border-slate-700/50 shadow-xl">
        <DialogHeader className="px-4 sm:px-6 py-4 sm:py-5 border-b border-slate-200/60 dark:border-slate-700/50 bg-gradient-to-br from-slate-50/80 to-white dark:from-slate-800/50 dark:to-slate-900/50 sticky top-0 z-10 backdrop-blur-sm flex-shrink-0">
          <DialogTitle className="text-lg sm:text-xl font-extralight text-slate-900 dark:text-white tracking-[-0.02em]">
            {title}
          </DialogTitle>
        </DialogHeader>
        {renderContent()}
      </DialogContent>
    </Dialog>
  );
});
