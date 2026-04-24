import React from 'react';
import { Card } from '@/components/ui/card';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { BranchData, ScorecardTotals } from '@/hooks/useCompanyScorecardData';

export type DetailActor = 'branch' | 'loan_officer';

export type SortKey =
  | 'name'
  | 'applicationsTakenDollar'
  | 'applicationsTaken'
  | 'avgLoanSize'
  | 'originatedUnitsPct'
  | 'withdrawnUnits'
  | 'withdrawnUnitsPct'
  | 'deniedUnits'
  | 'deniedUnitsPct'
  | 'originatedRevenue'
  | 'withdrawnProformaRevenue'
  | 'volumeAllFinal'
  | 'unitsAllFinal'
  | 'originatedVolume'
  | 'withdrawnDollar'
  | 'deniedDollar'
  | 'govtUnitsPct'
  | 'purchaseUnitsPct'
  | 'wac'
  | 'waFico'
  | 'waLtv'
  | 'waDti';

interface CompanyScorecardDetailTableProps {
  rows: BranchData[];
  totals: ScorecardTotals;
  actor: DetailActor;
  isDarkMode: boolean;
  formatNumber: (num: number) => string;
  formatLargeNumber: (num: number) => string;
  containerClassName?: string;
  tableWrapperClassName?: string;
  initialSortKey?: SortKey;
  initialSortDir?: 'asc' | 'desc';
}

function pctClass(
  kind: 'goodHigh' | 'goodLow',
  value: number,
  isDarkMode: boolean
): string {
  const base = isDarkMode ? 'text-slate-200' : 'text-slate-900';
  if (kind === 'goodHigh') {
    if (value >= 70) return 'text-emerald-600 dark:text-emerald-400 font-medium';
    if (value < 45) return 'text-red-600 dark:text-red-400 font-medium';
  } else {
    if (value <= 25) return 'text-emerald-600 dark:text-emerald-400 font-medium';
    if (value > 45) return 'text-red-600 dark:text-red-400 font-medium';
  }
  return base;
}

export function CompanyScorecardDetailTable({
  rows,
  totals,
  actor,
  isDarkMode,
  formatNumber,
  formatLargeNumber,
  containerClassName,
  tableWrapperClassName,
  initialSortKey,
  initialSortDir,
}: CompanyScorecardDetailTableProps) {
  const [sortKey, setSortKey] = React.useState<SortKey | null>(null);
  const [sortDir, setSortDir] = React.useState<'asc' | 'desc'>('desc');
  const actorLabel = actor === 'branch' ? 'Branch' : 'Loan Officer';
  const borderTh = isDarkMode ? 'border-slate-700' : 'border-slate-300';
  const bgTh = isDarkMode ? 'bg-slate-800/90 text-slate-400 whitespace-nowrap' : 'bg-slate-50/90 text-slate-600 whitespace-nowrap';
  const borderTd = isDarkMode ? 'border-slate-800/50' : 'border-slate-100';
  const hoverTd = isDarkMode ? 'hover:bg-slate-800/30' : 'hover:bg-slate-50';
  const stickyCell = isDarkMode ? 'bg-slate-800/90 text-slate-300 border-r border-slate-700' : 'bg-slate-50/90 text-slate-700 border-r border-slate-300';
  const textDefault = isDarkMode ? 'text-slate-200' : 'text-slate-900';

  const t = totals;
  const totalApps = t.totalLoansWithRespa;
  const originatedPctTotals = totalApps > 0 ? (t.originatedLoans / totalApps) * 100 : 0;
  const withdrawnPctTotals = totalApps > 0 ? (t.falloutWithdrawn / totalApps) * 100 : 0;
  const deniedPctTotals = totalApps > 0 ? (t.falloutDenied / totalApps) * 100 : 0;
  const govtPctTotals = t.originatedLoans > 0 ? (t.govtUnits / t.originatedLoans) * 100 : 0;
  const purchasePctTotals = t.originatedLoans > 0 ? (t.purchaseUnits / t.originatedLoans) * 100 : 0;

  const sortTypes: Record<SortKey, 'string' | 'number'> = {
    name: 'string',
    applicationsTakenDollar: 'number',
    applicationsTaken: 'number',
    avgLoanSize: 'number',
    originatedUnitsPct: 'number',
    withdrawnUnits: 'number',
    withdrawnUnitsPct: 'number',
    deniedUnits: 'number',
    deniedUnitsPct: 'number',
    originatedRevenue: 'number',
    withdrawnProformaRevenue: 'number',
    volumeAllFinal: 'number',
    unitsAllFinal: 'number',
    originatedVolume: 'number',
    withdrawnDollar: 'number',
    deniedDollar: 'number',
    govtUnitsPct: 'number',
    purchaseUnitsPct: 'number',
    wac: 'number',
    waFico: 'number',
    waLtv: 'number',
    waDti: 'number',
  };

  const getSortValue = (row: BranchData, key: SortKey) => {
    switch (key) {
      case 'name':
        return row.name || '';
      case 'applicationsTakenDollar':
        return row.tieringVolume;
      case 'applicationsTaken':
        return row.totalLoansWithRespa;
      case 'avgLoanSize':
        return row.totalLoansWithRespa > 0 ? row.tieringVolume / row.totalLoansWithRespa : 0;
      case 'originatedUnitsPct':
        return row.totalLoansWithRespa > 0 ? (row.originatedLoans / row.totalLoansWithRespa) * 100 : 0;
      case 'withdrawnUnits':
        return row.falloutWithdrawn;
      case 'withdrawnUnitsPct':
        return row.totalLoansWithRespa > 0 ? (row.falloutWithdrawn / row.totalLoansWithRespa) * 100 : 0;
      case 'deniedUnits':
        return row.falloutDenied;
      case 'deniedUnitsPct':
        return row.totalLoansWithRespa > 0 ? (row.falloutDenied / row.totalLoansWithRespa) * 100 : 0;
      case 'originatedRevenue':
        return row.revenue;
      case 'withdrawnProformaRevenue':
        return row.withdrawnProformaRevenue;
      case 'volumeAllFinal':
        return row.hmdaVolume;
      case 'unitsAllFinal':
        return row.hmdaUnits;
      case 'originatedVolume':
        return row.volume;
      case 'withdrawnDollar':
        return row.withdrawnVolume;
      case 'deniedDollar':
        return row.deniedVolume;
      case 'govtUnitsPct':
        return row.originatedLoans > 0 ? (row.govtUnits / row.originatedLoans) * 100 : 0;
      case 'purchaseUnitsPct':
        return row.originatedLoans > 0 ? (row.purchaseUnits / row.originatedLoans) * 100 : 0;
      case 'wac':
        return row.wac;
      case 'waFico':
        return row.waFico;
      case 'waLtv':
        return row.waLtv;
      case 'waDti':
        return row.waDti;
      default:
        return 0;
    }
  };

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
      return;
    }
    setSortKey(key);
    setSortDir(sortTypes[key] === 'string' ? 'asc' : 'desc');
  };

  React.useEffect(() => {
    if (!initialSortKey) return;
    setSortKey(initialSortKey);
    if (initialSortDir) {
      setSortDir(initialSortDir);
      return;
    }
    setSortDir(sortTypes[initialSortKey] === 'string' ? 'asc' : 'desc');
  }, [initialSortKey, initialSortDir, sortTypes]);

  const sortedRows = React.useMemo(() => {
    if (!sortKey) return rows;
    const type = sortTypes[sortKey];
    const nextRows = [...rows];
    nextRows.sort((a, b) => {
      const aVal = getSortValue(a, sortKey);
      const bVal = getSortValue(b, sortKey);
      if (type === 'string') {
        const cmp = String(aVal).localeCompare(String(bVal));
        return sortDir === 'asc' ? cmp : -cmp;
      }
      const diff = (Number(aVal) || 0) - (Number(bVal) || 0);
      return sortDir === 'asc' ? diff : -diff;
    });
    return nextRows;
  }, [rows, sortKey, sortDir]);

  const renderSortIcon = (key: SortKey) => {
    if (sortKey !== key) return <span className="text-[10px] opacity-50">⇅</span>;
    return <span className="text-[10px]">{sortDir === 'asc' ? '↑' : '↓'}</span>;
  };

  const renderHeaderButton = (shortLabel: string, fullLabel: string, key: SortKey) => (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={() => handleSort(key)}
          className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-slate-100"
        >
          <span>{shortLabel}</span>
          {renderSortIcon(key)}
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-[240px] bg-black text-white border-slate-700 text-xs">
        {fullLabel}
      </TooltipContent>
    </Tooltip>
  );

  return (
    <Card className={`rounded-xl shadow-sm border overflow-hidden ${isDarkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-200'} ${containerClassName ?? ''}`}>
      <div className={`overflow-auto ${tableWrapperClassName ?? ''}`}>
        <table className="w-full border-collapse min-w-[1400px]">
          <thead>
            <tr className={`border-b-2 ${borderTh}`}>
              <th className={`text-left py-2 px-2 text-[10px] sm:text-xs sm:py-3 sm:px-3 font-medium sticky left-0 z-10 ${bgTh} border-r ${borderTh}`}>
                {renderHeaderButton(actorLabel === 'Branch' ? 'Branch' : 'LO', actorLabel, 'name')}
              </th>
              <th className={`text-right py-2 px-2 text-[10px] sm:text-xs sm:py-3 sm:px-3 font-medium ${bgTh}`}>{renderHeaderButton('Apps $', 'Applications Taken ($)', 'applicationsTakenDollar')}</th>
              <th className={`text-right py-2 px-2 text-[10px] sm:text-xs sm:py-3 sm:px-3 font-medium ${bgTh}`}>{renderHeaderButton('Apps', 'Applications Taken', 'applicationsTaken')}</th>
              <th className={`text-right py-2 px-2 text-[10px] sm:text-xs sm:py-3 sm:px-3 font-medium ${bgTh}`}>{renderHeaderButton('Orig %', 'Originated Units %', 'originatedUnitsPct')}</th>
              <th className={`text-right py-2 px-2 text-[10px] sm:text-xs sm:py-3 sm:px-3 font-medium ${bgTh}`}>{renderHeaderButton('W/D', 'Withdrawn Units', 'withdrawnUnits')}</th>
              <th className={`text-right py-2 px-2 text-[10px] sm:text-xs sm:py-3 sm:px-3 font-medium ${bgTh}`}>{renderHeaderButton('W/D %', 'Withdrawn Units %', 'withdrawnUnitsPct')}</th>
              <th className={`text-right py-2 px-2 text-[10px] sm:text-xs sm:py-3 sm:px-3 font-medium ${bgTh}`}>{renderHeaderButton('Denied', 'Denied Units', 'deniedUnits')}</th>
              <th className={`text-right py-2 px-2 text-[10px] sm:text-xs sm:py-3 sm:px-3 font-medium ${bgTh}`}>{renderHeaderButton('Denied %', 'Denied Units %', 'deniedUnitsPct')}</th>
              <th className={`text-right py-2 px-2 text-[10px] sm:text-xs sm:py-3 sm:px-3 font-medium ${bgTh}`}>{renderHeaderButton('Orig Rev $', 'Originated Revenue $', 'originatedRevenue')}</th>
              <th className={`text-right py-2 px-2 text-[10px] sm:text-xs sm:py-3 sm:px-3 font-medium ${bgTh}`}>{renderHeaderButton('W/D Rev', 'W/D ProForma Revenue', 'withdrawnProformaRevenue')}</th>
              <th className={`text-right py-2 px-2 text-[10px] sm:text-xs sm:py-3 sm:px-3 font-medium ${bgTh}`}>{renderHeaderButton('Final Vol', 'Volume All Final Status', 'volumeAllFinal')}</th>
              <th className={`text-right py-2 px-2 text-[10px] sm:text-xs sm:py-3 sm:px-3 font-medium ${bgTh}`}>{renderHeaderButton('Final Units', 'Units All Final Status', 'unitsAllFinal')}</th>
              <th className={`text-right py-2 px-2 text-[10px] sm:text-xs sm:py-3 sm:px-3 font-medium ${bgTh}`}>{renderHeaderButton('Orig Vol $', 'Originated Volume $', 'originatedVolume')}</th>
              <th className={`text-right py-2 px-2 text-[10px] sm:text-xs sm:py-3 sm:px-3 font-medium ${bgTh}`}>{renderHeaderButton('W/D $', 'Withdrawn $', 'withdrawnDollar')}</th>
              <th className={`text-right py-2 px-2 text-[10px] sm:text-xs sm:py-3 sm:px-3 font-medium ${bgTh}`}>{renderHeaderButton('Denied $', 'Denied $', 'deniedDollar')}</th>
              <th className={`text-right py-2 px-2 text-[10px] sm:text-xs sm:py-3 sm:px-3 font-medium ${bgTh}`}>{renderHeaderButton("Gov't %", "Gov't Originated Units %", 'govtUnitsPct')}</th>
              <th className={`text-right py-2 px-2 text-[10px] sm:text-xs sm:py-3 sm:px-3 font-medium ${bgTh}`}>{renderHeaderButton('Purch %', 'Purchase Originated Units %', 'purchaseUnitsPct')}</th>
              <th className={`text-right py-2 px-2 text-[10px] sm:text-xs sm:py-3 sm:px-3 font-medium ${bgTh}`}>{renderHeaderButton('WAC', 'WAC', 'wac')}</th>
              <th className={`text-right py-2 px-2 text-[10px] sm:text-xs sm:py-3 sm:px-3 font-medium ${bgTh}`}>{renderHeaderButton('WA FICO', 'Originated WA FICO', 'waFico')}</th>
              <th className={`text-right py-2 px-2 text-[10px] sm:text-xs sm:py-3 sm:px-3 font-medium ${bgTh}`}>{renderHeaderButton('WA LTV', 'Originated WA LTV', 'waLtv')}</th>
              <th className={`text-right py-2 px-2 text-[10px] sm:text-xs sm:py-3 sm:px-3 font-medium ${bgTh}`}>{renderHeaderButton('WA DTI', 'Originated WA DTI', 'waDti')}</th>
            </tr>
          </thead>
          <tbody>
            {/* Totals row */}
            <tr className={`border-b ${borderTd} ${hoverTd} font-semibold`}>
              <td className={`py-2 px-2 text-[11px] sm:text-sm sm:py-2.5 sm:px-3 sticky left-0 z-10 ${stickyCell}`}>Totals</td>
              <td className={`text-right py-2 px-2 text-[11px] sm:text-sm sm:py-2.5 sm:px-3 font-mono ${textDefault}`}>{formatLargeNumber(t.totalVolume)}</td>
              <td className={`text-right py-2 px-2 text-[11px] sm:text-sm sm:py-2.5 sm:px-3 font-mono ${textDefault}`}>{formatNumber(t.totalLoansWithRespa)}</td>
              <td className={`text-right py-2 px-2 text-[11px] sm:text-sm sm:py-2.5 sm:px-3 font-mono ${pctClass('goodHigh', originatedPctTotals, isDarkMode)}`}>{originatedPctTotals.toFixed(1)}%</td>
              <td className={`text-right py-2 px-2 text-[11px] sm:text-sm sm:py-2.5 sm:px-3 font-mono ${textDefault}`}>{formatNumber(t.falloutWithdrawn)}</td>
              <td className={`text-right py-2 px-2 text-[11px] sm:text-sm sm:py-2.5 sm:px-3 font-mono ${pctClass('goodLow', withdrawnPctTotals, isDarkMode)}`}>{withdrawnPctTotals.toFixed(1)}%</td>
              <td className={`text-right py-2 px-2 text-[11px] sm:text-sm sm:py-2.5 sm:px-3 font-mono ${textDefault}`}>{formatNumber(t.falloutDenied)}</td>
              <td className={`text-right py-2 px-2 text-[11px] sm:text-sm sm:py-2.5 sm:px-3 font-mono ${pctClass('goodLow', deniedPctTotals, isDarkMode)}`}>{deniedPctTotals.toFixed(1)}%</td>
              <td className={`text-right py-2 px-2 text-[11px] sm:text-sm sm:py-2.5 sm:px-3 font-mono ${textDefault}`}>{formatLargeNumber(t.originatedRevenue)}</td>
              <td className={`text-right py-2 px-2 text-[11px] sm:text-sm sm:py-2.5 sm:px-3 font-mono ${textDefault}`}>{formatLargeNumber(t.withdrawnProformaRevenue)}</td>
              <td className={`text-right py-2 px-2 text-[11px] sm:text-sm sm:py-2.5 sm:px-3 font-mono ${textDefault}`}>{formatLargeNumber(t.hmdaVolume)}</td>
              <td className={`text-right py-2 px-2 text-[11px] sm:text-sm sm:py-2.5 sm:px-3 font-mono ${textDefault}`}>{formatNumber(t.hmdaUnits)}</td>
              <td className={`text-right py-2 px-2 text-[11px] sm:text-sm sm:py-2.5 sm:px-3 font-mono ${textDefault}`}>{formatLargeNumber(t.originatedVolume)}</td>
              <td className={`text-right py-2 px-2 text-[11px] sm:text-sm sm:py-2.5 sm:px-3 font-mono ${textDefault}`}>{formatLargeNumber(t.withdrawnVolume)}</td>
              <td className={`text-right py-2 px-2 text-[11px] sm:text-sm sm:py-2.5 sm:px-3 font-mono ${textDefault}`}>{formatLargeNumber(t.deniedVolume)}</td>
              <td className={`text-right py-2 px-2 text-[11px] sm:text-sm sm:py-2.5 sm:px-3 font-mono ${pctClass('goodHigh', govtPctTotals, isDarkMode)}`}>{govtPctTotals.toFixed(1)}%</td>
              <td className={`text-right py-2 px-2 text-[11px] sm:text-sm sm:py-2.5 sm:px-3 font-mono ${pctClass('goodHigh', purchasePctTotals, isDarkMode)}`}>{purchasePctTotals.toFixed(1)}%</td>
              <td className={`text-right py-2 px-2 text-[11px] sm:text-sm sm:py-2.5 sm:px-3 font-mono ${textDefault}`}>{(t.wac || 0).toFixed(3)}</td>
              <td className={`text-right py-2 px-2 text-[11px] sm:text-sm sm:py-2.5 sm:px-3 font-mono ${textDefault}`}>{Math.round(t.waFico || 0)}</td>
              <td className={`text-right py-2 px-2 text-[11px] sm:text-sm sm:py-2.5 sm:px-3 font-mono ${textDefault}`}>{(t.waLtv || 0).toFixed(1)}</td>
              <td className={`text-right py-2 px-2 text-[11px] sm:text-sm sm:py-2.5 sm:px-3 font-mono ${textDefault}`}>{(t.waDti || 0).toFixed(1)}</td>
            </tr>
            {sortedRows.map((row) => {
              const apps = row.totalLoansWithRespa;
              const origPct = apps > 0 ? (row.originatedLoans / apps) * 100 : 0;
              const wdrPct = apps > 0 ? (row.falloutWithdrawn / apps) * 100 : 0;
              const denPct = apps > 0 ? (row.falloutDenied / apps) * 100 : 0;
              const govPct = row.originatedLoans > 0 ? (row.govtUnits / row.originatedLoans) * 100 : 0;
              const purPct = row.originatedLoans > 0 ? (row.purchaseUnits / row.originatedLoans) * 100 : 0;
              return (
                <tr key={row.name} className={`border-b ${borderTd} ${hoverTd} transition-colors`}>
                  <td className={`py-2 px-2 text-[11px] sm:text-sm sm:py-2.5 sm:px-3 sticky left-0 z-10 ${stickyCell}`}>{row.name}</td>
                  <td className={`text-right py-2 px-2 text-[11px] sm:text-sm sm:py-2.5 sm:px-3 font-mono ${textDefault}`}>{formatLargeNumber(row.tieringVolume)}</td>
                  <td className={`text-right py-2 px-2 text-[11px] sm:text-sm sm:py-2.5 sm:px-3 font-mono ${textDefault}`}>{formatNumber(row.totalLoansWithRespa)}</td>
                  <td className={`text-right py-2 px-2 text-[11px] sm:text-sm sm:py-2.5 sm:px-3 font-mono ${pctClass('goodHigh', origPct, isDarkMode)}`}>{origPct.toFixed(1)}%</td>
                  <td className={`text-right py-2 px-2 text-[11px] sm:text-sm sm:py-2.5 sm:px-3 font-mono ${textDefault}`}>{formatNumber(row.falloutWithdrawn)}</td>
                  <td className={`text-right py-2 px-2 text-[11px] sm:text-sm sm:py-2.5 sm:px-3 font-mono ${pctClass('goodLow', wdrPct, isDarkMode)}`}>{wdrPct.toFixed(1)}%</td>
                  <td className={`text-right py-2 px-2 text-[11px] sm:text-sm sm:py-2.5 sm:px-3 font-mono ${textDefault}`}>{formatNumber(row.falloutDenied)}</td>
                  <td className={`text-right py-2 px-2 text-[11px] sm:text-sm sm:py-2.5 sm:px-3 font-mono ${pctClass('goodLow', denPct, isDarkMode)}`}>{denPct.toFixed(1)}%</td>
                  <td className={`text-right py-2 px-2 text-[11px] sm:text-sm sm:py-2.5 sm:px-3 font-mono ${textDefault}`}>{formatLargeNumber(row.revenue)}</td>
                  <td className={`text-right py-2 px-2 text-[11px] sm:text-sm sm:py-2.5 sm:px-3 font-mono ${textDefault}`}>{formatLargeNumber(row.withdrawnProformaRevenue)}</td>
                  <td className={`text-right py-2 px-2 text-[11px] sm:text-sm sm:py-2.5 sm:px-3 font-mono ${textDefault}`}>{formatLargeNumber(row.hmdaVolume)}</td>
                  <td className={`text-right py-2 px-2 text-[11px] sm:text-sm sm:py-2.5 sm:px-3 font-mono ${textDefault}`}>{formatNumber(row.hmdaUnits)}</td>
                  <td className={`text-right py-2 px-2 text-[11px] sm:text-sm sm:py-2.5 sm:px-3 font-mono ${textDefault}`}>{formatLargeNumber(row.volume)}</td>
                  <td className={`text-right py-2 px-2 text-[11px] sm:text-sm sm:py-2.5 sm:px-3 font-mono ${textDefault}`}>{formatLargeNumber(row.withdrawnVolume)}</td>
                  <td className={`text-right py-2 px-2 text-[11px] sm:text-sm sm:py-2.5 sm:px-3 font-mono ${textDefault}`}>{formatLargeNumber(row.deniedVolume)}</td>
                  <td className={`text-right py-2 px-2 text-[11px] sm:text-sm sm:py-2.5 sm:px-3 font-mono ${pctClass('goodHigh', govPct, isDarkMode)}`}>{govPct.toFixed(1)}%</td>
                  <td className={`text-right py-2 px-2 text-[11px] sm:text-sm sm:py-2.5 sm:px-3 font-mono ${pctClass('goodHigh', purPct, isDarkMode)}`}>{purPct.toFixed(1)}%</td>
                  <td className={`text-right py-2 px-2 text-[11px] sm:text-sm sm:py-2.5 sm:px-3 font-mono ${textDefault}`}>{(row.wac || 0).toFixed(3)}</td>
                  <td className={`text-right py-2 px-2 text-[11px] sm:text-sm sm:py-2.5 sm:px-3 font-mono ${textDefault}`}>{Math.round(row.waFico || 0)}</td>
                  <td className={`text-right py-2 px-2 text-[11px] sm:text-sm sm:py-2.5 sm:px-3 font-mono ${textDefault}`}>{(row.waLtv || 0).toFixed(1)}</td>
                  <td className={`text-right py-2 px-2 text-[11px] sm:text-sm sm:py-2.5 sm:px-3 font-mono ${textDefault}`}>{(row.waDti || 0).toFixed(1)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
