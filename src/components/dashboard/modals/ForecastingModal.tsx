import { Dialog, DialogContent } from '@/components/ui/dialog';
import { X, ChevronRight, ArrowDown, CheckCircle2, AlertTriangle } from 'lucide-react';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Area, AreaChart } from 'recharts';

interface ForecastingModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  forecastSelectedScenario: string | null;
  setForecastSelectedScenario: (scenario: string | null) => void;
  setTopTieringModal: (open: boolean) => void;
  setTrendsModal: (open: boolean) => void;
}

export function ForecastingModal({
  open,
  onOpenChange,
  forecastSelectedScenario,
  setForecastSelectedScenario,
  setTopTieringModal,
  setTrendsModal
}: ForecastingModalProps) {
  return (
    <Dialog open={open} onOpenChange={(isOpen) => {
      onOpenChange(isOpen);
      if (!isOpen) setForecastSelectedScenario(null);
    }}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto bg-white/95 dark:bg-slate-950/95 backdrop-blur-xl border-0 shadow-2xl w-[95vw] sm:w-full p-4 sm:p-6">
        {/* Close Button */}
        <button onClick={() => onOpenChange(false)} className="absolute right-4 top-4 rounded-full w-8 h-8 flex items-center justify-center bg-white/90 dark:bg-slate-800/90 border border-slate-200 dark:border-slate-700 shadow-sm hover:bg-slate-50 dark:hover:bg-slate-700 backdrop-blur-sm transition-all duration-200 z-10 focus:outline-none focus:ring-2 focus:ring-slate-300 focus:ring-offset-1">
          <X className="h-4 w-4 text-slate-500 dark:text-slate-400" strokeWidth={1.5} />
        </button>
        
        {/* Breadcrumb Navigation */}
        <div className="flex items-center gap-2 mb-4 pb-3 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-1 text-[10px] sm:text-xs">
            <button onClick={() => onOpenChange(false)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors">
              Dashboard
            </button>
            <ChevronRight className="w-3 h-3 text-slate-300 dark:text-slate-600" />
            <span className="font-medium text-slate-700 dark:text-slate-200">Forecasting</span>
          </div>
          <div className="flex-1" />
          <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 rounded-lg p-0.5">
            <button onClick={() => {
              onOpenChange(false);
              setTopTieringModal(true);
            }} className="px-2.5 py-1 text-[10px] sm:text-xs font-medium rounded-md text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors">
              TopTiering
            </button>
            <button onClick={() => {
              onOpenChange(false);
              setTrendsModal(true);
            }} className="px-2.5 py-1 text-[10px] sm:text-xs font-medium rounded-md text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors">
              Trends
            </button>
            <button className="px-2.5 py-1 text-[10px] sm:text-xs font-medium rounded-md bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm">
              Forecast
            </button>
          </div>
        </div>
        
        {/* Header */}
        <div className="relative pb-4 sm:pb-6 border-b border-slate-100 dark:border-slate-800">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 sm:gap-0">
            <div className="space-y-1">
              {forecastSelectedScenario ? (
                <button onClick={() => setForecastSelectedScenario(null)} className="flex items-center gap-2 text-xs sm:text-sm text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 transition-colors mb-2 touch-manipulation">
                  <ArrowDown className="w-3 h-3 sm:w-3.5 sm:h-3.5 rotate-90" />
                  <span>Back to Overview</span>
                </button>
              ) : null}
              <h2 className="text-lg sm:text-2xl font-light text-slate-900 dark:text-white tracking-tight">
                {forecastSelectedScenario ? `${forecastSelectedScenario} Scenario` : 'Forecasting'}
              </h2>
              <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 font-light">
                {forecastSelectedScenario ? `Detailed projections and assumptions` : 'Revenue projections based on current trends'}
              </p>
            </div>
            <div className="flex items-center gap-1.5 sm:gap-2 px-2 sm:px-3 py-1 sm:py-1.5 rounded-full bg-gradient-to-r from-cyan-500/10 to-emerald-500/10 border border-cyan-500/20 self-start">
              <div className="w-1 h-1 sm:w-1.5 sm:h-1.5 rounded-full bg-cyan-500 animate-pulse" />
              <span className="text-[10px] sm:text-xs font-medium text-cyan-700 dark:text-cyan-400">Live Forecast</span>
            </div>
          </div>
        </div>
        
        <div className="mt-4 sm:mt-8 space-y-4 sm:space-y-8">
          {!forecastSelectedScenario ? (
            <>
              {/* Hero Metrics */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-6">
                {[{
                  value: '$17.2M',
                  label: 'EOY Revenue',
                  change: '+18%',
                  positive: true
                }, {
                  value: '812',
                  label: 'Projected Loans',
                  change: '+114',
                  positive: true
                }, {
                  value: '112%',
                  label: 'Target Achievement',
                  status: 'On Track'
                }, {
                  value: '87%',
                  label: 'Confidence',
                  status: 'High'
                }].map((metric, idx) => (
                  <div key={idx} className="group">
                    <div className="text-xl sm:text-3xl font-extralight text-slate-900 dark:text-white tracking-tight mb-0.5 sm:mb-1">
                      {metric.value}
                    </div>
                    <div className="text-[10px] sm:text-xs text-slate-500 dark:text-slate-400 mb-0.5 sm:mb-1">{metric.label}</div>
                    {'change' in metric ? (
                      <span className={`text-[10px] sm:text-xs font-medium ${metric.positive ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600'}`}>
                        {metric.change} vs target
                      </span>
                    ) : (
                      <span className="text-[10px] sm:text-xs text-slate-400">{metric.status}</span>
                    )}
                  </div>
                ))}
              </div>

              {/* Scenario Selection */}
              <div>
                <h3 className="text-[10px] sm:text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-3 sm:mb-4">Scenarios</h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
                  {[{
                    name: 'Conservative',
                    revenue: '$16.1M',
                    loans: 756,
                    confidence: 95,
                    color: 'amber',
                    desc: '10% slower growth'
                  }, {
                    name: 'Base Case',
                    revenue: '$17.2M',
                    loans: 812,
                    confidence: 87,
                    color: 'emerald',
                    desc: 'Current trajectory',
                    recommended: true
                  }, {
                    name: 'Optimistic',
                    revenue: '$18.8M',
                    loans: 892,
                    confidence: 72,
                    color: 'cyan',
                    desc: '15% acceleration'
                  }].map((scenario, idx) => (
                    <button
                      key={idx}
                      onClick={() => setForecastSelectedScenario(scenario.name)}
                      className="group relative p-3 sm:p-5 rounded-xl sm:rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 active:border-slate-300 dark:active:border-slate-700 active:shadow-lg transition-all duration-300 text-left touch-manipulation"
                    >
                      {scenario.recommended && (
                        <div className="absolute -top-2 sm:-top-2.5 left-3 sm:left-4 px-1.5 sm:px-2 py-0.5 bg-emerald-500 text-white text-[8px] sm:text-[10px] font-medium rounded-full">
                          Recommended
                        </div>
                      )}
                      <div className="flex items-center justify-between mb-2 sm:mb-4">
                        <span className="text-xs sm:text-sm font-medium text-slate-700 dark:text-slate-300">{scenario.name}</span>
                        <div className="flex items-center gap-1 sm:gap-1.5">
                          <div className="h-1 w-8 sm:w-12 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full ${
                                scenario.color === 'amber' ? 'bg-amber-500' :
                                scenario.color === 'emerald' ? 'bg-emerald-500' :
                                'bg-cyan-500'
                              }`}
                              style={{ width: `${scenario.confidence}%` }}
                            />
                          </div>
                          <span className="text-[10px] sm:text-xs text-slate-400">{scenario.confidence}%</span>
                        </div>
                      </div>
                      <div className="text-lg sm:text-2xl font-light text-slate-900 dark:text-white mb-0.5 sm:mb-1">{scenario.revenue}</div>
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] sm:text-xs text-slate-500">{scenario.loans} loans</span>
                        <span className="text-[10px] sm:text-xs text-slate-400 italic">{scenario.desc}</span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Q4 Projection Chart with Recharts */}
              <div className="p-4 sm:p-6 rounded-2xl bg-slate-50/50 dark:bg-slate-900/30">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-4 sm:mb-6">
                  <h3 className="text-xs sm:text-sm font-medium text-slate-700 dark:text-slate-300">Q4 Revenue Trajectory</h3>
                  <div className="flex items-center gap-3 sm:gap-4 text-[10px] sm:text-xs">
                    <span className="flex items-center gap-1.5">
                      <div className="w-2 h-2 sm:w-2.5 sm:h-2.5 bg-slate-900 dark:bg-white rounded-sm" /> Actual
                    </span>
                    <span className="flex items-center gap-1.5">
                      <div className="w-2 h-2 sm:w-2.5 sm:h-2.5 bg-cyan-500 rounded-sm opacity-50" /> Projected
                    </span>
                  </div>
                </div>
                <ChartContainer config={{}} className="h-40 sm:h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={[{
                        period: 'Nov W1',
                        actual: 380,
                        projected: null,
                        revenue: 380
                      }, {
                        period: 'Nov W2',
                        actual: 392,
                        projected: null,
                        revenue: 392
                      }, {
                        period: 'Nov W3',
                        actual: 405,
                        projected: null,
                        revenue: 405
                      }, {
                        period: 'Nov W4',
                        actual: 418,
                        projected: null,
                        revenue: 418
                      }, {
                        period: 'Dec W1',
                        actual: null,
                        projected: 425,
                        revenue: 425
                      }, {
                        period: 'Dec W2',
                        actual: null,
                        projected: 438,
                        revenue: 438
                      }, {
                        period: 'Dec W3',
                        actual: null,
                        projected: 445,
                        revenue: 445
                      }, {
                        period: 'Dec W4',
                        actual: null,
                        projected: 458,
                        revenue: 458
                      }]}
                      margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" opacity={0.15} vertical={false} />
                      <XAxis
                        dataKey="period"
                        tick={{ fill: '#64748b', fontSize: 9 }}
                        axisLine={false}
                        tickLine={false}
                        tickFormatter={v => v.split(' ')[1]}
                      />
                      <YAxis
                        tick={{ fill: '#64748b', fontSize: 9 }}
                        axisLine={false}
                        tickLine={false}
                        tickFormatter={v => `$${v}K`}
                      />
                      <ChartTooltip
                        content={({ active, payload, label }) => {
                          if (active && payload && payload.length) {
                            const data = payload[0]?.payload;
                            const isActual = data?.actual !== null;
                            return (
                              <div className="bg-slate-900 dark:bg-slate-700 text-white text-[10px] px-3 py-2 rounded-lg shadow-xl">
                                <div className="font-semibold mb-1">{label}</div>
                                <div className="flex justify-between gap-3">
                                  <span>{isActual ? 'Actual:' : 'Projected:'}</span>
                                  <span className="font-medium">${data?.revenue}K</span>
                                </div>
                                <div className={`text-[9px] mt-1 ${isActual ? 'text-emerald-400' : 'text-cyan-400'}`}>
                                  {isActual ? '✓ Confirmed' : '⊙ Forecast'}
                                </div>
                              </div>
                            );
                          }
                          return null;
                        }}
                      />
                      <Bar dataKey="actual" fill="#1e293b" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="projected" fill="#06b6d4" opacity={0.5} radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </ChartContainer>
                <div className="flex justify-between mt-2 px-1">
                  <span className="text-[9px] sm:text-[10px] text-slate-400">November</span>
                  <span className="text-[9px] sm:text-[10px] text-slate-400">December</span>
                </div>
              </div>

              {/* Cumulative Revenue Line Chart */}
              <div className="p-4 sm:p-6 rounded-2xl bg-white dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-4 sm:mb-6">
                  <div>
                    <h3 className="text-xs sm:text-sm font-medium text-slate-700 dark:text-slate-300">Cumulative Revenue Projection</h3>
                    <p className="text-[10px] sm:text-xs text-slate-500 mt-0.5">YTD progress toward $17.2M target</p>
                  </div>
                  <div className="flex items-center gap-3 sm:gap-4 text-[10px] sm:text-xs">
                    <span className="flex items-center gap-1.5">
                      <div className="w-2 h-2 sm:w-2.5 sm:h-2.5 bg-emerald-500 rounded-full" /> Actual
                    </span>
                    <span className="flex items-center gap-1.5">
                      <div className="w-2 h-2 sm:w-2.5 sm:h-2.5 bg-emerald-500/40 rounded-full" /> Projected
                    </span>
                    <span className="flex items-center gap-1.5">
                      <div className="w-4 sm:w-6 border-t-2 border-dashed border-slate-400" /> Target
                    </span>
                  </div>
                </div>
                <ChartContainer config={{}} className="h-40 sm:h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart
                      data={[{
                        month: 'Jan',
                        actual: 0.98,
                        target: 1.43
                      }, {
                        month: 'Feb',
                        actual: 2.03,
                        target: 2.87
                      }, {
                        month: 'Mar',
                        actual: 3.15,
                        target: 4.30
                      }, {
                        month: 'Apr',
                        actual: 4.23,
                        target: 5.73
                      }, {
                        month: 'May',
                        actual: 5.43,
                        target: 7.17
                      }, {
                        month: 'Jun',
                        actual: 6.71,
                        target: 8.60
                      }, {
                        month: 'Jul',
                        actual: 7.86,
                        target: 10.03
                      }, {
                        month: 'Aug',
                        actual: 9.18,
                        target: 11.47
                      }, {
                        month: 'Sep',
                        actual: 10.56,
                        target: 12.90
                      }, {
                        month: 'Oct',
                        actual: 12.01,
                        target: 14.33
                      }, {
                        month: 'Nov',
                        actual: 13.53,
                        target: 15.77
                      }, {
                        month: 'Dec',
                        projected: 15.15,
                        target: 17.20
                      }]}
                      margin={{ top: 10, right: 10, left: -15, bottom: 0 }}
                    >
                      <defs>
                        <linearGradient id="cumulativeGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" opacity={0.15} vertical={false} />
                      <XAxis
                        dataKey="month"
                        tick={{ fill: '#64748b', fontSize: 9 }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis
                        tick={{ fill: '#64748b', fontSize: 9 }}
                        axisLine={false}
                        tickLine={false}
                        tickFormatter={v => `$${v}M`}
                      />
                      <ChartTooltip
                        content={({ active, payload, label }) => {
                          if (active && payload && payload.length) {
                            const data = payload[0]?.payload;
                            const value = data?.actual || data?.projected;
                            const target = data?.target;
                            const pct = (value / target * 100).toFixed(1);
                            return (
                              <div className="bg-slate-900 dark:bg-slate-700 text-white text-[10px] px-3 py-2 rounded-lg shadow-xl">
                                <div className="font-semibold mb-1">{label}</div>
                                <div className="flex justify-between gap-3">
                                  <span>{data?.actual ? 'Actual:' : 'Projected:'}</span>
                                  <span className="font-medium text-emerald-400">${value}M</span>
                                </div>
                                <div className="flex justify-between gap-3">
                                  <span>Target:</span>
                                  <span>${target}M</span>
                                </div>
                                <div className="mt-1 pt-1 border-t border-slate-600">
                                  {pct}% of target
                                </div>
                              </div>
                            );
                          }
                          return null;
                        }}
                      />
                      <Line type="monotone" dataKey="target" stroke="#94a3b8" strokeWidth={2} strokeDasharray="5 5" dot={false} />
                      <Area type="monotone" dataKey="actual" stroke="#10b981" strokeWidth={2} fill="url(#cumulativeGrad)" />
                      <Area type="monotone" dataKey="projected" stroke="#10b981" strokeWidth={2} strokeDasharray="3 3" fill="url(#cumulativeGrad)" opacity={0.5} />
                    </AreaChart>
                  </ResponsiveContainer>
                </ChartContainer>
                <div className="flex items-center justify-between mt-3 sm:mt-4 pt-3 border-t border-slate-200 dark:border-slate-700">
                  <div className="text-[10px] sm:text-xs text-slate-500">
                    <span className="font-medium text-slate-700 dark:text-slate-300">Current:</span> $13.53M (78.7% of target)
                  </div>
                  <div className="text-[10px] sm:text-xs">
                    <span className="font-medium text-emerald-600">+$3.67M</span>
                    <span className="text-slate-400 ml-1">projected to close gap</span>
                  </div>
                </div>
              </div>

              {/* Branch Performance */}
              <div>
                <h3 className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-4">Branch Projections</h3>
                <div className="space-y-2">
                  {[{
                    name: 'North Region HQ',
                    current: '$3.2M',
                    projected: '$3.8M',
                    growth: 18.7,
                    onTrack: true
                  }, {
                    name: 'Downtown Metro',
                    current: '$2.8M',
                    projected: '$3.3M',
                    growth: 17.9,
                    onTrack: true
                  }, {
                    name: 'Coastal Division',
                    current: '$2.1M',
                    projected: '$2.6M',
                    growth: 23.8,
                    onTrack: true
                  }, {
                    name: 'Suburban West',
                    current: '$1.92M',
                    projected: '$2.2M',
                    growth: 14.6,
                    onTrack: true
                  }, {
                    name: 'East Valley',
                    current: '$1.65M',
                    projected: '$1.9M',
                    growth: 15.2,
                    onTrack: true
                  }, {
                    name: 'Other Branches',
                    current: '$2.90M',
                    projected: '$3.4M',
                    growth: 17.2,
                    onTrack: false
                  }].map((branch, idx) => (
                    <div
                      key={idx}
                      className="flex flex-col sm:flex-row sm:items-center sm:justify-between py-3 px-4 rounded-xl bg-white dark:bg-slate-900/50 border border-slate-100 dark:border-slate-800 hover:border-slate-200 dark:hover:border-slate-700 transition-colors gap-2"
                    >
                      <div className="flex items-center gap-3">
                        <div className={`w-1.5 h-1.5 rounded-full ${branch.onTrack ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                        <span className="text-sm text-slate-700 dark:text-slate-300">{branch.name}</span>
                      </div>
                      <div className="flex items-center gap-3 sm:gap-6 flex-wrap">
                        <span className="text-xs text-slate-400 tabular-nums">{branch.current}</span>
                        <span className="text-xs text-slate-400">→</span>
                        <span className="text-sm font-medium text-slate-900 dark:text-white tabular-nums">{branch.projected}</span>
                        <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400 tabular-nums sm:w-12 text-right">+{branch.growth}%</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Indicators Grid */}
              <div className="grid md:grid-cols-2 gap-4">
                <div className="p-5 rounded-2xl bg-emerald-50/50 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-900/30">
                  <div className="flex items-center gap-2 mb-3">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                    <h4 className="text-sm font-medium text-emerald-800 dark:text-emerald-300">Tailwinds</h4>
                  </div>
                  <ul className="space-y-2">
                    {['$42M pipeline strength', 'Pull-through +2.1% trend', 'Q4 seasonal boost (+12%)', '3 new top-tier LOs'].map((item, i) => (
                      <li key={i} className="text-xs text-slate-600 dark:text-slate-400 flex items-start gap-2">
                        <span className="text-emerald-500 mt-0.5">•</span>
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="p-5 rounded-2xl bg-amber-50/50 dark:bg-amber-950/20 border border-amber-100 dark:border-amber-900/30">
                  <div className="flex items-center gap-2 mb-3">
                    <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                    <h4 className="text-sm font-medium text-amber-800 dark:text-amber-300">Headwinds</h4>
                  </div>
                  <ul className="space-y-2">
                    {['Rate volatility risk', '2 top LOs may relocate', 'Bottom tier -2.3%', 'Holiday slowdown'].map((item, i) => (
                      <li key={i} className="text-xs text-slate-600 dark:text-slate-400 flex items-start gap-2">
                        <span className="text-amber-500 mt-0.5">•</span>
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </>
          ) : (
            /* Scenario drill-down - Minimalist */
            <div className="space-y-8">
              {/* Hero Stats */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
                {[{
                  value: forecastSelectedScenario === 'Conservative' ? '$16.1M' : forecastSelectedScenario === 'Optimistic' ? '$18.8M' : '$17.2M',
                  label: 'Revenue'
                }, {
                  value: forecastSelectedScenario === 'Conservative' ? '756' : forecastSelectedScenario === 'Optimistic' ? '892' : '812',
                  label: 'Loans'
                }, {
                  value: forecastSelectedScenario === 'Conservative' ? '105%' : forecastSelectedScenario === 'Optimistic' ? '122%' : '112%',
                  label: 'Achievement',
                  highlight: true
                }, {
                  value: forecastSelectedScenario === 'Conservative' ? '95%' : forecastSelectedScenario === 'Optimistic' ? '72%' : '87%',
                  label: 'Confidence'
                }].map((stat, idx) => (
                  <div key={idx}>
                    <div className={`text-3xl font-extralight tracking-tight mb-1 ${stat.highlight ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-900 dark:text-white'}`}>
                      {stat.value}
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">{stat.label}</div>
                  </div>
                ))}
              </div>

              {/* Assumptions */}
              <div>
                <h3 className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-4">Key Assumptions</h3>
                <div className="rounded-2xl border border-slate-100 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800 overflow-hidden">
                  {[{
                    label: 'Monthly Growth Rate',
                    value: forecastSelectedScenario === 'Conservative' ? '+3.2%' : forecastSelectedScenario === 'Optimistic' ? '+6.8%' : '+5.1%'
                  }, {
                    label: 'Pull-Thru',
                    value: forecastSelectedScenario === 'Conservative' ? '75%' : forecastSelectedScenario === 'Optimistic' ? '82%' : '78%'
                  }, {
                    label: 'Average Loan Size',
                    value: forecastSelectedScenario === 'Conservative' ? '$395K' : forecastSelectedScenario === 'Optimistic' ? '$425K' : '$408K'
                  }, {
                    label: 'LO Productivity',
                    value: forecastSelectedScenario === 'Conservative' ? '4.2/month' : forecastSelectedScenario === 'Optimistic' ? '5.8/month' : '4.8/month'
                  }, {
                    label: 'Market Outlook',
                    value: forecastSelectedScenario === 'Conservative' ? 'Slightly Bearish' : forecastSelectedScenario === 'Optimistic' ? 'Bullish' : 'Neutral'
                  }].map((item, idx) => (
                    <div key={idx} className="flex items-center justify-between py-4 px-5 bg-white dark:bg-slate-900/50">
                      <span className="text-sm text-slate-600 dark:text-slate-400">{item.label}</span>
                      <span className="text-sm font-medium text-slate-900 dark:text-white">{item.value}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Monthly Breakdown */}
              <div>
                <h3 className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-4">Monthly Breakdown</h3>
                <div className="grid gap-3">
                  {['November', 'December'].map((month, idx) => (
                    <div key={month} className="flex items-center justify-between p-5 rounded-2xl bg-slate-50/50 dark:bg-slate-900/30 border border-slate-100 dark:border-slate-800">
                      <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{month} 2024</span>
                      <div className="flex items-center gap-8">
                        <div className="text-right">
                          <div className="text-lg font-light text-slate-900 dark:text-white">
                            {forecastSelectedScenario === 'Conservative' ? idx === 0 ? '$1.28M' : '$1.32M' :
                             forecastSelectedScenario === 'Optimistic' ? idx === 0 ? '$1.52M' : '$1.68M' :
                             idx === 0 ? '$1.38M' : '$1.48M'}
                          </div>
                          <div className="text-xs text-slate-400">revenue</div>
                        </div>
                        <div className="text-right">
                          <div className="text-lg font-light text-slate-700 dark:text-slate-300">
                            {forecastSelectedScenario === 'Conservative' ? idx === 0 ? '62' : '65' :
                             forecastSelectedScenario === 'Optimistic' ? idx === 0 ? '74' : '82' :
                             idx === 0 ? '68' : '72'}
                          </div>
                          <div className="text-xs text-slate-400">loans</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

