import { Link } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { formatCompactNumber } from '@/utils/formatting';
import { Button } from '@/components/ui/button';
import { IconBadge } from '@/components/workbench/IconBadge';
import { useTopTieringSelectionStore } from '@/stores/topTieringSelectionStore';
import { Filter, DollarSign, Hash, BarChart2, TrendingUp, ArrowRight, Save } from 'lucide-react';
import { SaveCohortDialog } from '@/components/workbench/SaveCohortDialog';
import { useState } from 'react';

type TopTieringSelectionAnalysisProps = {
  variant?: 'inline' | 'side' | 'compact';
  hideWhenEmpty?: boolean;
};

const tierColors: Record<string, string> = {
  top: '#0d9488',
  second: '#059669',
  bottom: '#65a30d',
};

const tierDot: Record<string, string> = {
  top: 'bg-teal-500',
  second: 'bg-emerald-500',
  bottom: 'bg-lime-600',
};

export const TopTieringSelectionAnalysis = ({ variant = 'inline', hideWhenEmpty = false }: TopTieringSelectionAnalysisProps) => {
  const { selectedItems, actorType, clearSelection } = useTopTieringSelectionStore();
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);

  if (selectedItems.length === 0) {
    if (hideWhenEmpty) {
      return null;
    }
    return (
      <div className="rounded-xl border border-dashed border-slate-200/80 dark:border-slate-700/80 bg-slate-50/60 dark:bg-slate-800/30 p-6 text-center">
        <IconBadge icon={Filter} variant="slate" size="lg" rounded="xl" className="mx-auto mb-3" />
        <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
          Select {actorType === 'branch' ? 'branches' : 'loan officers'} to analyze
        </p>
        <p className="text-[13px] text-slate-500 dark:text-slate-400 mt-1 max-w-[260px] mx-auto">
          Choose multiple {actorType === 'branch' ? 'branches' : 'loan officers'} in TopTiering Comparison to see metrics here.
        </p>
        <Link
          to="/performance/toptiering-comparison"
          className="inline-flex items-center gap-1.5 mt-4 text-sm font-medium text-violet-600 dark:text-violet-400 hover:text-violet-700 dark:hover:text-violet-300"
        >
          Open TopTiering Comparison
          <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    );
  }

  const totalRevenue = selectedItems.reduce((sum, item) => sum + item.revenue, 0);
  const totalUnits = selectedItems.reduce((sum, item) => sum + item.units, 0);
  const totalVolume = selectedItems.reduce((sum, item) => sum + item.volume, 0);
  const avgRevenuePerLoan = totalUnits > 0 ? totalRevenue / totalUnits : 0;
  const avgBps = selectedItems.reduce((sum, item) => sum + item.revenueBPS, 0) / selectedItems.length;

  const chartData = selectedItems.map((item) => ({
    ...item,
    label: item.name,
  }));

  const isCompact = variant === 'compact';
  const spacing = variant === 'side' ? 'space-y-4' : 'space-y-4';

  const metrics = [
    { label: 'Revenue', value: formatCompactNumber(totalRevenue), icon: DollarSign, bg: 'bg-violet-100/80 dark:bg-violet-900/30', iconCl: 'text-violet-600 dark:text-violet-400' },
    { label: 'Units', value: formatCompactNumber(totalUnits), icon: Hash, bg: 'bg-emerald-100/80 dark:bg-emerald-900/30', iconCl: 'text-emerald-600 dark:text-emerald-400' },
    { label: 'Volume', value: formatCompactNumber(totalVolume), icon: BarChart2, bg: 'bg-sky-100/80 dark:bg-sky-900/30', iconCl: 'text-sky-600 dark:text-sky-400' },
    { label: 'Avg Rev/Unit', value: formatCompactNumber(avgRevenuePerLoan), icon: TrendingUp, bg: 'bg-amber-100/80 dark:bg-amber-900/30', iconCl: 'text-amber-600 dark:text-amber-400' },
  ];

  return (
    <div className={`rounded-xl border border-slate-200/70 dark:border-slate-700/70 p-4 ${spacing} shadow-sm`}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Selection Analysis</p>
          <p className="text-[12px] text-slate-500 dark:text-slate-400">
            {selectedItems.length} selected {actorType === 'branch' ? 'branches' : 'loan officers'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setSaveDialogOpen(true)}
            className="text-violet-600 dark:text-violet-400 hover:text-violet-700 dark:hover:text-violet-300 border-violet-200 dark:border-violet-800"
          >
            <Save className="h-3.5 w-3.5 mr-1.5" />
            Save
          </Button>
          <Button variant="ghost" size="sm" onClick={clearSelection} className="text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200">
            Clear
          </Button>
        </div>
      </div>

      <div className={`grid gap-3 ${isCompact ? 'grid-cols-2' : 'grid-cols-2 lg:grid-cols-4'}`}>
        {metrics.map(({ label, value, icon: Icon, bg, iconCl }) => (
          <div key={label} className={`rounded-xl ${bg} p-3 flex items-start gap-2.5`}>
            <Icon className={`h-4 w-4 shrink-0 mt-0.5 ${iconCl}`} />
            <div className="min-w-0">
              <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">{label}</p>
              <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">{value}</p>
            </div>
          </div>
        ))}
      </div>

      {!isCompact && (
        <div className="rounded-xl border border-slate-200/60 dark:border-slate-700/60 bg-slate-50/40 dark:bg-slate-800/30 p-3">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold text-slate-600 dark:text-slate-300">Revenue vs Units</p>
            <p className="text-[10px] text-slate-400 dark:text-slate-500">Avg BPS: {avgBps.toFixed(0)}</p>
          </div>
          <div className="w-full h-40">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <XAxis dataKey="label" hide />
                <YAxis hide />
                <Tooltip
                  formatter={(value: any, name, props) => {
                    const entry = props.payload;
                    return [`${formatCompactNumber(value)}`, name === 'revenue' ? 'Revenue' : 'Units'];
                  }}
                  labelFormatter={(label, payload) => payload?.[0]?.payload?.name || label}
                />
                <Bar dataKey="revenue" radius={[4, 4, 0, 0]}>
                  {chartData.map((entry) => (
                    <Cell key={entry.id} fill={tierColors[entry.tier] || '#94a3b8'} />
                  ))}
                </Bar>
                <Bar dataKey="units" radius={[4, 4, 0, 0]} fill="#94a3b8" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      <div className="space-y-0">
        <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-2">Selected</p>
        {selectedItems.slice(0, isCompact ? 5 : 6).map((item) => (
          <div key={item.id} className="flex items-center gap-2 py-1.5 border-b border-slate-100 dark:border-slate-800 last:border-0">
            <span className={`h-2 w-2 rounded-full shrink-0 ${tierDot[item.tier] || 'bg-slate-400'}`} />
            <span className="text-[13px] text-slate-700 dark:text-slate-300 truncate flex-1">{item.name}</span>
            <span className="text-[12px] font-medium text-slate-900 dark:text-slate-100">{formatCompactNumber(item.revenue)}</span>
          </div>
        ))}
        {selectedItems.length > (isCompact ? 5 : 6) && (
          <p className="text-[11px] text-slate-400 dark:text-slate-500 pt-1">+{selectedItems.length - (isCompact ? 5 : 6)} more</p>
        )}
      </div>
      <SaveCohortDialog
        open={saveDialogOpen}
        onOpenChange={setSaveDialogOpen}
        items={selectedItems}
        actorType={actorType}
      />
    </div>
  );
};
