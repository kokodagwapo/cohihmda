import { Dialog, DialogContent } from '@/components/ui/dialog';
import { X, ChevronRight, ArrowDown, TrendingUp, FileCheck, Clock, Target } from 'lucide-react';
import { ChartContainer, ChartTooltip } from '@/components/ui/chart';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer, PieChart, Pie, Area, AreaChart } from 'recharts';
import { motion } from 'framer-motion';
import { DateFilter } from '@/hooks/useDashboardFilters';

interface TrendsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trendsSelectedMetric: string | null;
  setTrendsSelectedMetric: (metric: string | null) => void;
  dateFilter: DateFilter;
  setDateFilter: (filter: DateFilter) => void;
  setTopTieringModal: (open: boolean) => void;
  setForecastingModal: (open: boolean) => void;
}

export function TrendsModal({
  open,
  onOpenChange,
  trendsSelectedMetric,
  setTrendsSelectedMetric,
  dateFilter,
  setDateFilter,
  setTopTieringModal,
  setForecastingModal
}: TrendsModalProps) {
  return (
    <Dialog open={open} onOpenChange={(isOpen) => {
      onOpenChange(isOpen);
      if (!isOpen) setTrendsSelectedMetric(null);
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
            <span className="font-medium text-slate-700 dark:text-slate-200">Trends</span>
          </div>
          <div className="flex-1" />
          <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 rounded-lg p-0.5">
            <button onClick={() => {
              onOpenChange(false);
              setTopTieringModal(true);
            }} className="px-2.5 py-1 text-[10px] sm:text-xs font-medium rounded-md text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors">
              TopTiering
            </button>
            <button className="px-2.5 py-1 text-[10px] sm:text-xs font-medium rounded-md bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm">
              Trends
            </button>
            <button onClick={() => {
              onOpenChange(false);
              setForecastingModal(true);
            }} className="px-2.5 py-1 text-[10px] sm:text-xs font-medium rounded-md text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors">
              Forecast
            </button>
          </div>
        </div>
        
        {/* Header */}
        <div className="relative pb-4 sm:pb-6 border-b border-slate-100 dark:border-slate-800">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 sm:gap-0">
            <div className="space-y-1">
              {trendsSelectedMetric ? (
                <button onClick={() => setTrendsSelectedMetric(null)} className="flex items-center gap-2 text-xs sm:text-sm text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 transition-colors mb-2 touch-manipulation">
                  <ArrowDown className="w-3 h-3 sm:w-3.5 sm:h-3.5 rotate-90" />
                  <span>Back to Overview</span>
                </button>
              ) : null}
              <h2 className="text-lg sm:text-2xl font-light text-slate-900 dark:text-white tracking-tight">
                {trendsSelectedMetric ? `${trendsSelectedMetric} Analysis` : 'Trends & Performance'}
              </h2>
              <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 font-light">
                {trendsSelectedMetric ? `Historical data and performance breakdown` : 'Key performance indicators and their evolution over time'}
              </p>
            </div>
            <div className="flex items-center gap-1 sm:gap-1.5 overflow-x-auto -mx-1 px-1">
              {['today', 'mtd', 'ytd'].map(period => (
                <button
                  key={period}
                  onClick={() => setDateFilter(period as DateFilter)}
                  className={`px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-full text-[10px] sm:text-xs font-medium transition-all touch-manipulation whitespace-nowrap ${
                    dateFilter === period
                      ? 'bg-gradient-to-r from-blue-500/10 to-indigo-500/10 border border-blue-500/20 text-blue-700 dark:text-blue-400'
                      : 'bg-slate-100 dark:bg-slate-800/50 border border-transparent text-slate-500 dark:text-slate-400 active:bg-slate-200 dark:active:bg-slate-700'
                  }`}
                >
                  {period === 'today' ? 'Daily' : period.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
        </div>
        
        <div className="mt-4 sm:mt-8 space-y-4 sm:space-y-8">
          {!trendsSelectedMetric ? (
            <>
              {/* Hero Metrics with Animation */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-4">
                {[{
                  label: 'Revenue Growth',
                  value: '+18.6%',
                  vsLast: '+3.2% vs LQ',
                  color: 'emerald',
                  icon: TrendingUp
                }, {
                  label: 'Loan Volume',
                  value: '698',
                  vsLast: '+156 YTD',
                  color: 'blue',
                  icon: FileCheck
                }, {
                  label: 'Pull-Through',
                  value: '78%',
                  vsLast: '+2.1% vs LQ',
                  color: 'indigo',
                  icon: Target
                }, {
                  label: 'Cycle Time',
                  value: '28d',
                  vsLast: '-3.4d improved',
                  color: 'violet',
                  icon: Clock
                }].map((metric, idx) => (
                  <motion.button
                    key={idx}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: idx * 0.1 }}
                    onClick={() => setTrendsSelectedMetric(metric.label)}
                    className="group relative p-3 sm:p-5 rounded-xl sm:rounded-2xl bg-white dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800 active:border-slate-300 dark:active:border-slate-700 active:shadow-lg transition-all text-left overflow-hidden touch-manipulation"
                  >
                    <div className={`absolute top-0 right-0 w-16 sm:w-20 h-16 sm:h-20 bg-${metric.color}-500/10 rounded-full blur-2xl -translate-y-1/2 translate-x-1/2`} />
                    <metric.icon className={`w-4 h-4 sm:w-5 sm:h-5 text-${metric.color}-500 mb-2 sm:mb-3`} />
                    <div className="text-lg sm:text-2xl font-light text-slate-900 dark:text-white mb-0.5 sm:mb-1">{metric.value}</div>
                    <div className="text-[10px] sm:text-xs text-slate-500 dark:text-slate-400 mb-1 sm:mb-2">{metric.label}</div>
                    <div className="text-[10px] sm:text-xs font-medium text-emerald-600 dark:text-emerald-400">{metric.vsLast}</div>
                  </motion.button>
                ))}
              </div>

              {/* Monthly Revenue Chart - Enhanced with Recharts */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
                className="p-4 sm:p-6 rounded-2xl bg-slate-50/30 dark:bg-slate-900/20 border border-slate-100/40 dark:border-slate-800/30"
              >
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-4 sm:mb-6">
                  <div>
                    <h3 className="text-xs sm:text-sm font-light text-slate-700 dark:text-slate-300 tracking-tight">Monthly Revenue Trend</h3>
                    <p className="text-[10px] sm:text-xs text-slate-500 mt-0.5">2024 Performance vs Target</p>
                  </div>
                  <div className="flex items-center gap-4 sm:gap-6 text-[10px] sm:text-xs">
                    <span className="flex items-center gap-1.5 sm:gap-2">
                      <div className="w-2.5 h-2.5 sm:w-3 sm:h-3 bg-blue-500 rounded" /> <span className="text-slate-600 dark:text-slate-400">Actual</span>
                    </span>
                    <span className="flex items-center gap-1.5 sm:gap-2">
                      <div className="w-2.5 h-2.5 sm:w-3 sm:h-3 bg-slate-300 dark:bg-slate-600 rounded" /> <span className="text-slate-600 dark:text-slate-400">Target</span>
                    </span>
                  </div>
                </div>
                <ChartContainer config={{}} className="h-48 sm:h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={[{
                        month: 'Jan',
                        actual: 980,
                        target: 900
                      }, {
                        month: 'Feb',
                        actual: 1050,
                        target: 950
                      }, {
                        month: 'Mar',
                        actual: 1120,
                        target: 1000
                      }, {
                        month: 'Apr',
                        actual: 1080,
                        target: 1050
                      }, {
                        month: 'May',
                        actual: 1200,
                        target: 1100
                      }, {
                        month: 'Jun',
                        actual: 1280,
                        target: 1150
                      }, {
                        month: 'Jul',
                        actual: 1150,
                        target: 1200
                      }, {
                        month: 'Aug',
                        actual: 1320,
                        target: 1250
                      }, {
                        month: 'Sep',
                        actual: 1380,
                        target: 1300
                      }, {
                        month: 'Oct',
                        actual: 1450,
                        target: 1350
                      }, {
                        month: 'Nov',
                        actual: 1520,
                        target: 1400
                      }, {
                        month: 'Dec',
                        actual: 1620,
                        target: 1450
                      }]}
                      margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" opacity={0.15} vertical={false} />
                      <XAxis
                        dataKey="month"
                        tick={{ fill: '#64748b', fontSize: 10 }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis
                        tick={{ fill: '#64748b', fontSize: 10 }}
                        axisLine={false}
                        tickLine={false}
                        tickFormatter={v => `$${v / 1000}M`}
                      />
                      <ChartTooltip
                        content={({ active, payload, label }) => {
                          if (active && payload && payload.length) {
                            const actual = payload[0]?.value as number;
                            const target = payload[1]?.value as number;
                            const diff = ((actual - target) / target * 100).toFixed(1);
                            const exceeded = actual >= target;
                            return (
                              <div className="bg-slate-900 dark:bg-slate-700 text-white text-[10px] px-3 py-2 rounded-lg shadow-xl">
                                <div className="font-semibold mb-1">{label} 2024</div>
                                <div className="flex justify-between gap-4">
                                  <span>Actual:</span>
                                  <span className="font-medium">${(actual / 1000).toFixed(2)}M</span>
                                </div>
                                <div className="flex justify-between gap-4">
                                  <span>Target:</span>
                                  <span>${(target / 1000).toFixed(2)}M</span>
                                </div>
                                <div className={`mt-1 pt-1 border-t border-slate-600 ${exceeded ? 'text-emerald-400' : 'text-rose-400'}`}>
                                  {exceeded ? '↑' : '↓'} {Math.abs(Number(diff))}% {exceeded ? 'above' : 'below'}
                                </div>
                              </div>
                            );
                          }
                          return null;
                        }}
                      />
                      <Bar dataKey="actual" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="target" fill="#94a3b8" opacity={0.4} radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </ChartContainer>
                {/* Summary row */}
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mt-4 sm:mt-6 pt-3 sm:pt-4 border-t border-slate-200 dark:border-slate-700">
                  <div className="text-[10px] sm:text-xs text-slate-500">
                    <span className="font-medium text-slate-700 dark:text-slate-300">YTD Total:</span> $14.58M
                  </div>
                  <div className="flex items-center gap-3 sm:gap-4 text-[10px] sm:text-xs">
                    <span className="text-slate-500">Target: $13.1M</span>
                    <span className="font-semibold text-emerald-600">+11.3% ahead</span>
                  </div>
                </div>
              </motion.div>

              {/* Year-over-Year Comparison Line Chart */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
                className="p-4 sm:p-6 rounded-2xl bg-white dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800"
              >
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-4 sm:mb-6">
                  <div>
                    <h3 className="text-xs sm:text-sm font-light text-slate-700 dark:text-slate-300 tracking-tight">Year-over-Year Comparison</h3>
                    <p className="text-[10px] sm:text-xs text-slate-500 mt-0.5">2024 vs 2023 Monthly Performance</p>
                  </div>
                  <div className="flex items-center gap-4 sm:gap-6 text-[10px] sm:text-xs">
                    <span className="flex items-center gap-1.5 sm:gap-2">
                      <div className="w-2.5 h-2.5 sm:w-3 sm:h-3 bg-emerald-500 rounded-full" /> <span className="text-slate-600 dark:text-slate-400">2024</span>
                    </span>
                    <span className="flex items-center gap-1.5 sm:gap-2">
                      <div className="w-2.5 h-2.5 sm:w-3 sm:h-3 bg-slate-400 rounded-full" /> <span className="text-slate-600 dark:text-slate-400">2023</span>
                    </span>
                  </div>
                </div>
                <ChartContainer config={{}} className="h-48 sm:h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart
                      data={[{
                        month: 'Jan',
                        current: 980,
                        previous: 850
                      }, {
                        month: 'Feb',
                        current: 1050,
                        previous: 920
                      }, {
                        month: 'Mar',
                        current: 1120,
                        previous: 980
                      }, {
                        month: 'Apr',
                        current: 1080,
                        previous: 1020
                      }, {
                        month: 'May',
                        current: 1200,
                        previous: 1050
                      }, {
                        month: 'Jun',
                        current: 1280,
                        previous: 1100
                      }, {
                        month: 'Jul',
                        current: 1150,
                        previous: 1080
                      }, {
                        month: 'Aug',
                        current: 1320,
                        previous: 1150
                      }, {
                        month: 'Sep',
                        current: 1380,
                        previous: 1200
                      }, {
                        month: 'Oct',
                        current: 1450,
                        previous: 1280
                      }, {
                        month: 'Nov',
                        current: 1520,
                        previous: 1320
                      }, {
                        month: 'Dec',
                        current: 1620,
                        previous: 1380
                      }]}
                      margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                    >
                      <defs>
                        <linearGradient id="colorCurrent" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="colorPrevious" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#94a3b8" stopOpacity={0.2} />
                          <stop offset="95%" stopColor="#94a3b8" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" opacity={0.15} vertical={false} />
                      <XAxis
                        dataKey="month"
                        tick={{ fill: '#64748b', fontSize: 10 }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis
                        tick={{ fill: '#64748b', fontSize: 10 }}
                        axisLine={false}
                        tickLine={false}
                        tickFormatter={v => `$${v / 1000}M`}
                      />
                      <ChartTooltip
                        content={({ active, payload, label }) => {
                          if (active && payload && payload.length) {
                            const current = payload[0]?.value as number;
                            const previous = payload[1]?.value as number;
                            const growth = ((current - previous) / previous * 100).toFixed(1);
                            return (
                              <div className="bg-slate-900 dark:bg-slate-700 text-white text-[10px] px-3 py-2 rounded-lg shadow-xl">
                                <div className="font-semibold mb-1">{label}</div>
                                <div className="flex justify-between gap-4">
                                  <span>2024:</span>
                                  <span className="font-medium text-emerald-400">${(current / 1000).toFixed(2)}M</span>
                                </div>
                                <div className="flex justify-between gap-4">
                                  <span>2023:</span>
                                  <span>${(previous / 1000).toFixed(2)}M</span>
                                </div>
                                <div className="mt-1 pt-1 border-t border-slate-600 text-emerald-400">
                                  ↑ {growth}% YoY growth
                                </div>
                              </div>
                            );
                          }
                          return null;
                        }}
                      />
                      <Area type="monotone" dataKey="previous" stroke="#94a3b8" strokeWidth={2} fill="url(#colorPrevious)" />
                      <Area type="monotone" dataKey="current" stroke="#10b981" strokeWidth={2} fill="url(#colorCurrent)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </ChartContainer>
              </motion.div>

              {/* Metrics Categories - Enhanced */}
              <div className="grid md:grid-cols-3 gap-4">
                {[{
                  title: 'Production',
                  icon: TrendingUp,
                  color: 'blue',
                  items: [{
                    name: 'Loans Closed',
                    current: '698',
                    change: '+12%',
                    progress: 85
                  }, {
                    name: 'Loan Volume',
                    current: '$285M',
                    change: '+18%',
                    progress: 92
                  }, {
                    name: 'Avg Loan Size',
                    current: '$408K',
                    change: '+5%',
                    progress: 78
                  }, {
                    name: 'Applications',
                    current: '892',
                    change: '+8%',
                    progress: 88
                  }]
                }, {
                  title: 'Efficiency',
                  icon: Clock,
                  color: 'indigo',
                  items: [{
                    name: 'Pull-Through',
                    current: '78%',
                    change: '+2.1%',
                    progress: 78
                  }, {
                    name: 'Cycle Time',
                    current: '28 days',
                    change: '-3.4d',
                    progress: 82
                  }, {
                    name: 'UW Turn Time',
                    current: '4.2 days',
                    change: '-0.8d',
                    progress: 90
                  }, {
                    name: 'Docs to Close',
                    current: '12 days',
                    change: '-1.2d',
                    progress: 75
                  }]
                }, {
                  title: 'Quality',
                  icon: Target,
                  color: 'emerald',
                  items: [{
                    name: 'First-Time Approval',
                    current: '82%',
                    change: '+4%',
                    progress: 82
                  }, {
                    name: 'Fallout Rate',
                    current: '8.2%',
                    change: '-1.8%',
                    progress: 92
                  }, {
                    name: 'Rework Rate',
                    current: '3.4%',
                    change: '-0.6%',
                    progress: 97
                  }, {
                    name: 'Customer Sat',
                    current: '4.7/5',
                    change: '+0.2',
                    progress: 94
                  }]
                }].map((category, catIdx) => (
                  <motion.div
                    key={catIdx}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.4 + catIdx * 0.1 }}
                    className="bg-white dark:bg-slate-900/50 rounded-2xl p-5 border border-slate-200 dark:border-slate-800"
                  >
                    <div className="flex items-center gap-2 mb-4">
                      <div className={`w-8 h-8 rounded-lg bg-${category.color}-100 dark:bg-${category.color}-900/30 flex items-center justify-center`}>
                        <category.icon className={`w-4 h-4 text-${category.color}-600 dark:text-${category.color}-400`} />
                      </div>
                      <h4 className="text-sm font-light text-slate-700 dark:text-slate-300 tracking-tight">{category.title}</h4>
                    </div>
                    <div className="space-y-3">
                      {category.items.map((item, idx) => (
                        <button
                          key={idx}
                          onClick={() => setTrendsSelectedMetric(item.name)}
                          className="w-full text-left group"
                        >
                          <div className="flex items-center justify-between mb-1.5">
                            <span className="text-xs text-slate-600 dark:text-slate-400 group-hover:text-slate-900 dark:group-hover:text-slate-200 transition-colors">{item.name}</span>
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-semibold text-slate-900 dark:text-white">{item.current}</span>
                              <span className="text-[10px] font-medium text-emerald-600">{item.change}</span>
                            </div>
                          </div>
                          <div className="h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                            <motion.div
                              className={`h-full bg-${category.color}-500 rounded-full`}
                              initial={{ width: 0 }}
                              animate={{ width: `${item.progress}%` }}
                              transition={{ delay: 0.6 + catIdx * 0.1 + idx * 0.05, duration: 0.5 }}
                            />
                          </div>
                        </button>
                      ))}
                    </div>
                  </motion.div>
                ))}
              </div>

              {/* Branch Sparklines - Enhanced with Recharts */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.6 }}
                className="p-4 sm:p-6 rounded-2xl bg-white dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800"
              >
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-4 sm:mb-5">
                  <div>
                    <h3 className="text-xs sm:text-sm font-light text-slate-700 dark:text-slate-300 tracking-tight">Branch Performance Sparklines</h3>
                    <p className="text-[10px] sm:text-xs text-slate-500 mt-0.5">12-month trend by branch</p>
                  </div>
                  <span className="text-[10px] sm:text-xs text-slate-400">Monthly index (100 = target)</span>
                </div>
                <div className="space-y-3 sm:space-y-4">
                  {[{
                    name: 'North Region HQ',
                    data: [{ m: 'J', v: 85 }, { m: 'F', v: 88 }, { m: 'M', v: 92 }, { m: 'A', v: 90 }, { m: 'M', v: 95 }, { m: 'J', v: 98 }, { m: 'J', v: 94 }, { m: 'A', v: 102 }, { m: 'S', v: 98 }, { m: 'O', v: 105 }, { m: 'N', v: 108 }, { m: 'D', v: 112 }],
                    revenue: '$3.2M',
                    color: '#10b981',
                    current: 112
                  }, {
                    name: 'Downtown Metro',
                    data: [{ m: 'J', v: 78 }, { m: 'F', v: 82 }, { m: 'M', v: 85 }, { m: 'A', v: 83 }, { m: 'M', v: 88 }, { m: 'J', v: 92 }, { m: 'J', v: 89 }, { m: 'A', v: 95 }, { m: 'S', v: 92 }, { m: 'O', v: 98 }, { m: 'N', v: 102 }, { m: 'D', v: 105 }],
                    revenue: '$2.8M',
                    color: '#3b82f6',
                    current: 105
                  }, {
                    name: 'Coastal Division',
                    data: [{ m: 'J', v: 62 }, { m: 'F', v: 68 }, { m: 'M', v: 72 }, { m: 'A', v: 70 }, { m: 'M', v: 78 }, { m: 'J', v: 85 }, { m: 'J', v: 82 }, { m: 'A', v: 92 }, { m: 'S', v: 88 }, { m: 'O', v: 95 }, { m: 'N', v: 98 }, { m: 'D', v: 102 }],
                    revenue: '$2.1M',
                    color: '#6366f1',
                    current: 102
                  }, {
                    name: 'Suburban West',
                    data: [{ m: 'J', v: 55 }, { m: 'F', v: 58 }, { m: 'M', v: 62 }, { m: 'A', v: 60 }, { m: 'M', v: 65 }, { m: 'J', v: 68 }, { m: 'J', v: 66 }, { m: 'A', v: 72 }, { m: 'S', v: 70 }, { m: 'O', v: 75 }, { m: 'N', v: 78 }, { m: 'D', v: 82 }],
                    revenue: '$1.92M',
                    color: '#f59e0b',
                    current: 82
                  }, {
                    name: 'East Valley',
                    data: [{ m: 'J', v: 48 }, { m: 'F', v: 52 }, { m: 'M', v: 55 }, { m: 'A', v: 53 }, { m: 'M', v: 58 }, { m: 'J', v: 62 }, { m: 'J', v: 60 }, { m: 'A', v: 65 }, { m: 'S', v: 63 }, { m: 'O', v: 68 }, { m: 'N', v: 72 }, { m: 'D', v: 75 }],
                    revenue: '$1.65M',
                    color: '#f43f5e',
                    current: 75
                  }].map((branch, idx) => (
                    <motion.div
                      key={idx}
                      className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 p-2 sm:p-3 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors cursor-pointer group"
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.7 + idx * 0.05 }}
                    >
                      <div className="flex items-center gap-2 sm:w-36">
                        <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: branch.color }} />
                        <span className="text-[10px] sm:text-xs font-medium text-slate-700 dark:text-slate-300 truncate">{branch.name}</span>
                      </div>
                      <div className="flex-1 h-8 sm:h-10">
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart data={branch.data} margin={{ top: 2, right: 2, left: 2, bottom: 2 }}>
                            <defs>
                              <linearGradient id={`sparkGrad${idx}`} x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor={branch.color} stopOpacity={0.3} />
                                <stop offset="95%" stopColor={branch.color} stopOpacity={0} />
                              </linearGradient>
                            </defs>
                            <Area type="monotone" dataKey="v" stroke={branch.color} strokeWidth={1.5} fill={`url(#sparkGrad${idx})`} />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                      <div className="flex items-center justify-between sm:justify-end gap-3 sm:gap-4">
                        <div className="text-left sm:text-right">
                          <span className="text-xs font-bold text-slate-900 dark:text-white">{branch.current}%</span>
                          <span className={`block text-[9px] sm:text-[10px] ${branch.current >= 100 ? 'text-emerald-600' : 'text-amber-600'}`}>
                            {branch.current >= 100 ? 'Above target' : 'Below target'}
                          </span>
                        </div>
                        <span className="text-[10px] sm:text-xs text-slate-500 w-14 sm:w-16 text-right">{branch.revenue}</span>
                      </div>
                    </motion.div>
                  ))}
                </div>
              </motion.div>

              {/* Loan Product Mix Pie Chart */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.7 }}
                className="p-4 sm:p-6 rounded-2xl bg-slate-50/30 dark:bg-slate-900/20 border border-slate-100/40 dark:border-slate-800/30"
              >
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-4 sm:mb-6">
                  <div>
                    <h3 className="text-xs sm:text-sm font-light text-slate-700 dark:text-slate-300 tracking-tight">Loan Product Mix</h3>
                    <p className="text-[10px] sm:text-xs text-slate-500 mt-0.5">Distribution by loan type YTD</p>
                  </div>
                </div>
                <div className="flex flex-col lg:flex-row items-center gap-6">
                  <div className="w-full lg:w-1/2 h-48 sm:h-56">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={[{
                            name: 'Conventional',
                            value: 42,
                            fill: '#3b82f6'
                          }, {
                            name: 'FHA',
                            value: 28,
                            fill: '#10b981'
                          }, {
                            name: 'VA',
                            value: 18,
                            fill: '#8b5cf6'
                          }, {
                            name: 'Jumbo',
                            value: 8,
                            fill: '#f59e0b'
                          }, {
                            name: 'Other',
                            value: 4,
                            fill: '#64748b'
                          }]}
                          cx="50%"
                          cy="50%"
                          innerRadius={50}
                          outerRadius={80}
                          paddingAngle={2}
                          dataKey="value"
                        />
                        <ChartTooltip
                          content={({ active, payload }) => {
                            if (active && payload && payload.length) {
                              return (
                                <div className="bg-slate-900 dark:bg-slate-700 text-white text-[10px] px-3 py-2 rounded-lg shadow-xl">
                                  <div className="font-semibold">{payload[0].name}</div>
                                  <div>{payload[0].value}% of total volume</div>
                                </div>
                              );
                            }
                            return null;
                          }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="w-full lg:w-1/2 grid grid-cols-2 sm:grid-cols-1 gap-2 sm:gap-3">
                    {[{
                      name: 'Conventional',
                      value: '42%',
                      amount: '$119.7M',
                      color: '#3b82f6'
                    }, {
                      name: 'FHA',
                      value: '28%',
                      amount: '$79.8M',
                      color: '#10b981'
                    }, {
                      name: 'VA',
                      value: '18%',
                      amount: '$51.3M',
                      color: '#8b5cf6'
                    }, {
                      name: 'Jumbo',
                      value: '8%',
                      amount: '$22.8M',
                      color: '#f59e0b'
                    }, {
                      name: 'Other',
                      value: '4%',
                      amount: '$11.4M',
                      color: '#64748b'
                    }].map((item, idx) => (
                      <div key={idx} className="flex items-center gap-2 sm:gap-3">
                        <div className="w-2.5 h-2.5 sm:w-3 sm:h-3 rounded-full flex-shrink-0" style={{ backgroundColor: item.color }} />
                        <div className="flex-1 min-w-0">
                          <span className="text-[10px] sm:text-xs text-slate-600 dark:text-slate-400">{item.name}</span>
                        </div>
                        <span className="text-[10px] sm:text-xs font-semibold text-slate-900 dark:text-white">{item.value}</span>
                        <span className="text-[10px] sm:text-xs text-slate-500 hidden sm:inline">{item.amount}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </motion.div>
            </>
          ) : (
            /* Drill-down view for selected metric - Enhanced */
            <div className="space-y-6">
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="grid grid-cols-2 md:grid-cols-4 gap-4"
              >
                {[{
                  label: 'Current YTD',
                  value: '698',
                  color: 'blue'
                }, {
                  label: 'Last Year YTD',
                  value: '622',
                  color: 'slate'
                }, {
                  label: 'YoY Change',
                  value: '+12.2%',
                  color: 'emerald'
                }, {
                  label: 'Monthly Avg',
                  value: '58',
                  color: 'slate'
                }].map((stat, idx) => (
                  <motion.div
                    key={idx}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: idx * 0.1 }}
                    className="bg-slate-50 dark:bg-slate-800/50 rounded-xl p-4 text-center"
                  >
                    <p className={`text-2xl font-light ${
                      stat.color === 'emerald' ? 'text-emerald-600' :
                      stat.color === 'blue' ? 'text-blue-600 dark:text-blue-400' :
                      'text-slate-900 dark:text-white'
                    }`}>
                      {stat.value}
                    </p>
                    <p className="text-xs text-slate-500 mt-1">{stat.label}</p>
                  </motion.div>
                ))}
              </motion.div>

              {/* Weekly breakdown */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
                className="bg-white dark:bg-slate-800/50 rounded-xl p-5 border border-slate-200 dark:border-slate-700"
              >
                <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-4">Weekly Performance</h4>
                <div className="grid gap-2 max-h-64 overflow-y-auto">
                  {[{
                    week: 'Week 48',
                    value: 18,
                    change: '+12.5%',
                    positive: true
                  }, {
                    week: 'Week 47',
                    value: 16,
                    change: '+6.7%',
                    positive: true
                  }, {
                    week: 'Week 46',
                    value: 15,
                    change: '-3.2%',
                    positive: false
                  }, {
                    week: 'Week 45',
                    value: 17,
                    change: '+8.9%',
                    positive: true
                  }, {
                    week: 'Week 44',
                    value: 14,
                    change: '-5.4%',
                    positive: false
                  }, {
                    week: 'Week 43',
                    value: 19,
                    change: '+15.2%',
                    positive: true
                  }, {
                    week: 'Week 42',
                    value: 16,
                    change: '+2.1%',
                    positive: true
                  }, {
                    week: 'Week 41',
                    value: 15,
                    change: '-1.8%',
                    positive: false
                  }, {
                    week: 'Week 40',
                    value: 17,
                    change: '+9.3%',
                    positive: true
                  }, {
                    week: 'Week 39',
                    value: 14,
                    change: '-4.2%',
                    positive: false
                  }, {
                    week: 'Week 38',
                    value: 18,
                    change: '+11.1%',
                    positive: true
                  }, {
                    week: 'Week 37',
                    value: 16,
                    change: '+3.5%',
                    positive: true
                  }].map((week, idx) => (
                    <motion.div
                      key={idx}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.3 + idx * 0.03 }}
                      className="flex items-center justify-between py-3 px-4 bg-slate-50 dark:bg-slate-800/30 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800/50 transition-colors"
                    >
                      <span className="text-sm text-slate-600 dark:text-slate-400">{week.week}</span>
                      <div className="flex items-center gap-6">
                        <div className="w-32 h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                          <motion.div
                            className="h-full bg-blue-500 rounded-full"
                            initial={{ width: 0 }}
                            animate={{ width: `${week.value / 20 * 100}%` }}
                            transition={{ delay: 0.4 + idx * 0.03, duration: 0.3 }}
                          />
                        </div>
                        <span className="font-light text-slate-900 dark:text-white w-16 tracking-tight">{week.value} loans</span>
                        <span className={`text-xs font-medium w-16 text-right ${week.positive ? 'text-emerald-600' : 'text-rose-600'}`}>
                          {week.change}
                        </span>
                      </div>
                    </motion.div>
                  ))}
                </div>
              </motion.div>

              {/* By Branch */}
              <div className="bg-white dark:bg-slate-800/50 rounded-lg p-4 border border-slate-200 dark:border-slate-700">
                <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3">Breakdown by Branch</h4>
                <div className="space-y-2">
                  {[{
                    name: 'North Region HQ',
                    value: 156,
                    pct: '22.3%',
                    change: '+18%'
                  }, {
                    name: 'Downtown Metro',
                    value: 142,
                    pct: '20.3%',
                    change: '+15%'
                  }, {
                    name: 'Coastal Division',
                    value: 98,
                    pct: '14.0%',
                    change: '+22%'
                  }, {
                    name: 'Suburban West',
                    value: 89,
                    pct: '12.8%',
                    change: '+8%'
                  }, {
                    name: 'East Valley',
                    value: 76,
                    pct: '10.9%',
                    change: '+5%'
                  }, {
                    name: 'Others (9)',
                    value: 137,
                    pct: '19.6%',
                    change: '-2%'
                  }].map((branch, idx) => (
                    <div key={idx} className="flex items-center justify-between py-2">
                      <div className="flex items-center gap-3">
                        <div className="w-24 h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                          <div className="h-full bg-blue-500 rounded-full" style={{ width: branch.pct }} />
                        </div>
                        <span className="text-sm text-slate-600 dark:text-slate-400">{branch.name}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="font-medium text-slate-900 dark:text-white">{branch.value}</span>
                        <span className={`text-xs ${branch.change.startsWith('+') ? 'text-emerald-600' : 'text-rose-600'}`}>
                          {branch.change}
                        </span>
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

