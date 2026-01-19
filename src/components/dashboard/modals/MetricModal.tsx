import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ChartContainer } from '@/components/ui/chart';
import { BarChart, Bar, AreaChart, Area, XAxis, YAxis, CartesianGrid, ResponsiveContainer } from 'recharts';

interface Performer {
  name: string;
  loans?: number;
  revenue?: number;
}

interface MetricModalProps {
  open: boolean;
  type: 'score' | 'loans' | 'revenue' | null;
  performer: Performer | null;
  onClose: () => void;
}

export function MetricModal({ open, type, performer, onClose }: MetricModalProps) {
  if (!type || !performer) return null;

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-w-[95vw] sm:max-w-2xl bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-lg sm:text-xl">
            {performer.name} - {type === 'score' ? 'Performance Score' : type === 'loans' ? 'Loan Volume' : 'Revenue'} Breakdown
          </DialogTitle>
          <DialogDescription>
            Detailed analysis for {type}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 sm:space-y-6 py-2 sm:py-4">
          {type === 'score' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-2 sm:gap-4">
                <div className="p-3 sm:p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                  <div className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 mb-1">Productivity</div>
                  <div className="text-xl sm:text-2xl font-light text-slate-900 dark:text-slate-100">98</div>
                </div>
                <div className="p-3 sm:p-4 bg-green-50 dark:bg-green-900/20 rounded-lg">
                  <div className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 mb-1">Quality</div>
                  <div className="text-xl sm:text-2xl font-light text-slate-900 dark:text-slate-100">95</div>
                </div>
                <div className="p-3 sm:p-4 bg-purple-50 dark:bg-purple-900/20 rounded-lg">
                  <div className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 mb-1">Efficiency</div>
                  <div className="text-xl sm:text-2xl font-light text-slate-900 dark:text-slate-100">92</div>
                </div>
                <div className="p-3 sm:p-4 bg-orange-50 dark:bg-orange-900/20 rounded-lg">
                  <div className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 mb-1">Complexity</div>
                  <div className="text-xl sm:text-2xl font-light text-slate-900 dark:text-slate-100">91</div>
                </div>
              </div>
              <ChartContainer config={{}} className="h-48 sm:h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={[
                    { metric: 'Prod', value: 98 },
                    { metric: 'Qual', value: 95 },
                    { metric: 'Eff', value: 92 },
                    { metric: 'Comp', value: 91 }
                  ]} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.15} vertical={false} />
                    <XAxis dataKey="metric" tick={{ fill: '#64748b', fontSize: 11 }} />
                    <YAxis tick={{ fill: '#64748b', fontSize: 11 }} />
                    <Bar dataKey="value" fill="#60a5fa" radius={[8, 8, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartContainer>
            </div>
          )}

          {type === 'loans' && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-2 sm:gap-4">
                <div className="p-2 sm:p-4 bg-green-50 dark:bg-green-900/20 rounded-lg">
                  <div className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 mb-1">Closed</div>
                  <div className="text-lg sm:text-2xl font-light text-green-600">{performer.loans || 0}</div>
                </div>
                <div className="p-2 sm:p-4 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg">
                  <div className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 mb-1">In Process</div>
                  <div className="text-lg sm:text-2xl font-light text-yellow-600">12</div>
                </div>
                <div className="p-2 sm:p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                  <div className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 mb-1">Pending</div>
                  <div className="text-lg sm:text-2xl font-light text-blue-600">8</div>
                </div>
              </div>
              <ChartContainer config={{}} className="h-48 sm:h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={[
                    { month: 'Jan', loans: 4 },
                    { month: 'Feb', loans: 5 },
                    { month: 'Mar', loans: 7 },
                    { month: 'Apr', loans: 6 },
                    { month: 'May', loans: 8 },
                    { month: 'Jun', loans: (performer.loans || 28) / 6 }
                  ]} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                    <defs>
                      <linearGradient id="loansGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#34d399" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#34d399" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.15} vertical={false} />
                    <XAxis dataKey="month" tick={{ fill: '#64748b', fontSize: 11 }} />
                    <YAxis tick={{ fill: '#64748b', fontSize: 11 }} />
                    <Area type="monotone" dataKey="loans" stroke="#34d399" strokeWidth={2} fill="url(#loansGradient)" />
                  </AreaChart>
                </ResponsiveContainer>
              </ChartContainer>
            </div>
          )}

          {type === 'revenue' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-2 sm:gap-4">
                <div className="p-3 sm:p-4 bg-green-50 dark:bg-green-900/20 rounded-lg">
                  <div className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 mb-1">Total Revenue</div>
                  <div className="text-xl sm:text-2xl font-light text-green-600">${((performer.revenue || 0) / 1000).toFixed(0)}K</div>
                </div>
                <div className="p-3 sm:p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                  <div className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 mb-1">Avg per Loan</div>
                  <div className="text-xl sm:text-2xl font-light text-blue-600">${((performer.revenue || 0) / (performer.loans || 1) / 1000).toFixed(0)}K</div>
                </div>
              </div>
              <ChartContainer config={{}} className="h-48 sm:h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={[
                    { month: 'Jan', revenue: 180 },
                    { month: 'Feb', revenue: 210 },
                    { month: 'Mar', revenue: 240 },
                    { month: 'Apr', revenue: 195 },
                    { month: 'May', revenue: 220 },
                    { month: 'Jun', revenue: (performer.revenue || 1250000) / 1000 / 6 }
                  ]} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.15} vertical={false} />
                    <XAxis dataKey="month" tick={{ fill: '#64748b', fontSize: 11 }} />
                    <YAxis tick={{ fill: '#64748b', fontSize: 11 }} />
                    <Bar dataKey="revenue" fill="#f59e0b" radius={[8, 8, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartContainer>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

