import { useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, ComposedChart, Line } from 'recharts';
import { formatCompactNumber } from '@/utils/formatting';
import { useCohortStore } from '@/stores/cohortStore';
import { DollarSign, Hash, BarChart2, TrendingUp, Users } from 'lucide-react';
import { IconBadge } from '@/components/workbench/IconBadge';

const tierColors: Record<string, string> = {
  top: '#0d9488',
  second: '#059669',
  bottom: '#65a30d',
};

export function MultiCohortComparison() {
  const { getSelectedCohorts } = useCohortStore();
  const selectedCohorts = getSelectedCohorts();

  const comparisonData = useMemo(() => {
    return selectedCohorts.map((cohort) => {
      const totalRevenue = cohort.items.reduce((sum, item) => sum + item.revenue, 0);
      const totalUnits = cohort.items.reduce((sum, item) => sum + item.units, 0);
      const totalVolume = cohort.items.reduce((sum, item) => sum + item.volume, 0);
      const avgRevenuePerLoan = totalUnits > 0 ? totalRevenue / totalUnits : 0;
      const avgBps = cohort.items.reduce((sum, item) => sum + item.revenueBPS, 0) / cohort.items.length;

      return {
        name: cohort.name,
        revenue: totalRevenue,
        units: totalUnits,
        volume: totalVolume,
        avgRevenuePerLoan,
        avgBps,
        itemCount: cohort.items.length,
      };
    });
  }, [selectedCohorts]);

  if (selectedCohorts.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-200/80 dark:border-slate-700/80 bg-slate-50/60 dark:bg-slate-800/30 p-8 text-center">
        <IconBadge icon={Users} variant="slate" size="lg" rounded="xl" className="mx-auto mb-3" />
        <p className="text-sm font-medium text-slate-700 dark:text-slate-300">No cohorts selected</p>
        <p className="text-[13px] text-slate-500 dark:text-slate-400 mt-1 max-w-[260px] mx-auto">
          Select multiple cohorts from the sidebar to compare their performance side-by-side.
        </p>
      </div>
    );
  }

  if (selectedCohorts.length === 1) {
    const cohort = selectedCohorts[0];
    const data = comparisonData[0];
    return (
      <div className="rounded-xl border border-slate-200/70 dark:border-slate-700/70 bg-white/95 dark:bg-slate-900/80 shadow-md shadow-slate-200/40 dark:shadow-none backdrop-blur-sm overflow-hidden">
        <div className="px-5 pt-5 pb-4 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-3.5">
            <IconBadge icon={BarChart2} variant="sky" size="md" rounded="xl" />
            <div>
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">{cohort.name}</h2>
              <p className="text-[13px] text-slate-500 dark:text-slate-400 mt-0.5">
                {cohort.items.length} {cohort.actor_type === 'branch' ? 'branches' : 'loan officers'}
              </p>
            </div>
          </div>
        </div>
        <div className="p-5">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <div className="rounded-xl bg-violet-100/80 dark:bg-violet-900/30 p-3 flex items-start gap-2.5">
              <DollarSign className="h-4 w-4 shrink-0 mt-0.5 text-violet-600 dark:text-violet-400" />
              <div className="min-w-0">
                <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Revenue</p>
                <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">{formatCompactNumber(data.revenue)}</p>
              </div>
            </div>
            <div className="rounded-xl bg-emerald-100/80 dark:bg-emerald-900/30 p-3 flex items-start gap-2.5">
              <Hash className="h-4 w-4 shrink-0 mt-0.5 text-emerald-600 dark:text-emerald-400" />
              <div className="min-w-0">
                <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Units</p>
                <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">{formatCompactNumber(data.units)}</p>
              </div>
            </div>
            <div className="rounded-xl bg-sky-100/80 dark:bg-sky-900/30 p-3 flex items-start gap-2.5">
              <BarChart2 className="h-4 w-4 shrink-0 mt-0.5 text-sky-600 dark:text-sky-400" />
              <div className="min-w-0">
                <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Volume</p>
                <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">{formatCompactNumber(data.volume)}</p>
              </div>
            </div>
            <div className="rounded-xl bg-amber-100/80 dark:bg-amber-900/30 p-3 flex items-start gap-2.5">
              <TrendingUp className="h-4 w-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
              <div className="min-w-0">
                <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Avg Rev/Unit</p>
                <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">{formatCompactNumber(data.avgRevenuePerLoan)}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-200/70 dark:border-slate-700/70 bg-white/95 dark:bg-slate-900/80 shadow-md shadow-slate-200/40 dark:shadow-none backdrop-blur-sm overflow-hidden">
      <div className="px-5 pt-5 pb-4 border-b border-slate-100 dark:border-slate-800">
        <div className="flex items-center gap-3.5">
          <IconBadge icon={BarChart2} variant="sky" size="md" rounded="xl" />
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">Cohort Comparison</h2>
            <p className="text-[13px] text-slate-500 dark:text-slate-400 mt-0.5">
              Comparing {selectedCohorts.length} cohorts
            </p>
          </div>
        </div>
      </div>
      <div className="p-5 space-y-6">
        {/* Metrics Grid */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {comparisonData.map((data, idx) => (
            <div key={idx} className="space-y-3">
              <p className="text-xs font-semibold text-slate-700 dark:text-slate-300 truncate">{data.name}</p>
              <div className="space-y-2">
                <div className="rounded-lg bg-violet-50/50 dark:bg-violet-900/20 p-2">
                  <p className="text-[10px] text-slate-500 dark:text-slate-400">Revenue</p>
                  <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">{formatCompactNumber(data.revenue)}</p>
                </div>
                <div className="rounded-lg bg-emerald-50/50 dark:bg-emerald-900/20 p-2">
                  <p className="text-[10px] text-slate-500 dark:text-slate-400">Units</p>
                  <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">{formatCompactNumber(data.units)}</p>
                </div>
                <div className="rounded-lg bg-sky-50/50 dark:bg-sky-900/20 p-2">
                  <p className="text-[10px] text-slate-500 dark:text-slate-400">Volume</p>
                  <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">{formatCompactNumber(data.volume)}</p>
                </div>
                <div className="rounded-lg bg-amber-50/50 dark:bg-amber-900/20 p-2">
                  <p className="text-[10px] text-slate-500 dark:text-slate-400">Avg Rev/Unit</p>
                  <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">{formatCompactNumber(data.avgRevenuePerLoan)}</p>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Comparison Chart */}
        <div className="rounded-xl border border-slate-200/60 dark:border-slate-700/60 bg-slate-50/40 dark:bg-slate-800/30 p-4">
          <p className="text-xs font-semibold text-slate-600 dark:text-slate-300 mb-3">Revenue & Units Comparison</p>
          <div className="w-full h-64">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={comparisonData}>
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis yAxisId="left" tick={{ fontSize: 11 }} />
                <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} />
                <Tooltip
                  formatter={(value: any, name) => {
                    return [`${formatCompactNumber(value)}`, name === 'revenue' ? 'Revenue' : 'Units'];
                  }}
                />
                <Bar yAxisId="left" dataKey="revenue" radius={[4, 4, 0, 0]} fill="#8b5cf6">
                  {comparisonData.map((entry, idx) => (
                    <Cell key={idx} fill={['#0d9488', '#059669', '#65a30d', '#8b5cf6', '#ec4899'][idx % 5]} />
                  ))}
                </Bar>
                <Line yAxisId="right" type="monotone" dataKey="units" stroke="#06b6d4" strokeWidth={2} dot={{ r: 4 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}
