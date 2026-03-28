import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import {
  ChevronLeft,
  ChevronRight,
  Lock,
  Unlock,
  AlertTriangle,
  ShieldCheck,
  Clock,
  TrendingUp,
  CalendarClock,
  Search,
} from 'lucide-react';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { useCohiBuilderPortfolio } from '../contexts/CohiBuilderPortfolioContext';
import type { CohiPortfolioLoan } from '../data/portfolioFromBuilderImport';
import { anonymizeBorrowerName, displayLoanOfficer, formatCityState } from '../lib/borrowerPrivacy';

interface Props {
  onBack: () => void;
  onLoanClick: (id: number) => void;
}

type Loan = CohiPortfolioLoan;

const EXPIRING_DAY_WINDOWS = [30, 20, 15, 10, 5] as const;
type ExpiringDayWindow = (typeof EXPIRING_DAY_WINDOWS)[number];
const EXPIRING_PAGE_SIZE = 20;

type LoanWithDays = Loan & { days: number };

function daysToExpiry(loan: Loan): number | null {
  if (!loan.rateLock?.expires) return null;
  const ms = new Date(loan.rateLock.expires).getTime();
  if (Number.isNaN(ms)) return null;
  return Math.ceil((ms - Date.now()) / (1000 * 60 * 60 * 24));
}

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return iso;
  }
}

function urgencyColor(days: number) {
  if (days <= 7) return { bg: 'bg-rose-50', border: 'border-rose-200', text: 'text-rose-700', badge: 'bg-rose-100 text-rose-700' };
  if (days <= 14) return { bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-700', badge: 'bg-amber-100 text-amber-700' };
  return { bg: 'bg-sky-50', border: 'border-sky-200', text: 'text-sky-700', badge: 'bg-sky-100 text-sky-700' };
}

function formatCurrency(v: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v);
}

function loanMatchesExpiringSearch(loan: LoanWithDays, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  const hay = [
    loan.borrower,
    anonymizeBorrowerName(loan.borrower),
    loan.city,
    loan.state,
    displayLoanOfficer(loan),
    String(loan.id),
    formatCurrency(loan.loanAmount),
    loan.rateLock?.type ?? '',
    String(loan.days),
  ]
    .join(' ')
    .toLowerCase();
  return hay.includes(needle);
}

export default function RateLockDrilldown({ onBack, onLoanClick }: Props) {
  const { allLoans: loans } = useCohiBuilderPortfolio();
  const locked = useMemo(() => loans.filter(l => l.rateLock?.status === 'Locked'), [loans]);
  const floating = useMemo(() => loans.filter(l => l.rateLock?.status === 'Floating' || !l.rateLock?.status), [loans]);

  const expiringIn30 = useMemo(() =>
    locked
      .map(l => ({ ...l, days: daysToExpiry(l)! }))
      .filter(l => l.days != null && l.days >= 0 && l.days <= 30)
      .sort((a, b) => a.days - b.days),
    [locked]
  );

  const expiringIn7 = expiringIn30.filter(l => l.days <= 7);
  const expiringIn14 = expiringIn30.filter(l => l.days <= 14);

  const [expiringTab, setExpiringTab] = useState<string>('30');
  const [expiringSearch, setExpiringSearch] = useState('');
  const [expiringPage, setExpiringPage] = useState(1);

  const expiringCountsByWindow = useMemo(() => {
    const m = new Map<ExpiringDayWindow, number>();
    for (const w of EXPIRING_DAY_WINDOWS) {
      m.set(w, expiringIn30.filter((l) => l.days <= w).length);
    }
    return m;
  }, [expiringIn30]);

  const activeExpiringWindow: ExpiringDayWindow = (() => {
    const n = Number(expiringTab);
    return (EXPIRING_DAY_WINDOWS as readonly number[]).includes(n) ? (n as ExpiringDayWindow) : 30;
  })();
  const expiringFiltered = useMemo(() => {
    const maxDays = activeExpiringWindow;
    return expiringIn30
      .filter((l) => l.days <= maxDays)
      .filter((l) => loanMatchesExpiringSearch(l, expiringSearch));
  }, [expiringIn30, activeExpiringWindow, expiringSearch]);

  const expiringTotalPages = Math.max(1, Math.ceil(expiringFiltered.length / EXPIRING_PAGE_SIZE));
  const expiringPageSafe = Math.min(expiringPage, expiringTotalPages);
  const expiringPageSlice = useMemo(() => {
    const start = (expiringPageSafe - 1) * EXPIRING_PAGE_SIZE;
    return expiringFiltered.slice(start, start + EXPIRING_PAGE_SIZE);
  }, [expiringFiltered, expiringPageSafe]);

  useEffect(() => {
    setExpiringPage(1);
  }, [expiringTab, expiringSearch]);

  useEffect(() => {
    if (expiringPage > expiringTotalPages) setExpiringPage(expiringTotalPages);
  }, [expiringPage, expiringTotalPages]);

  const lockedSorted = useMemo(() =>
    locked
      .map(l => ({ ...l, days: daysToExpiry(l) }))
      .sort((a, b) => {
        if (a.days == null && b.days == null) return 0;
        if (a.days == null) return 1;
        if (b.days == null) return -1;
        return a.days - b.days;
      }),
    [locked]
  );

  const lockCoverage = loans.length ? Math.round((locked.length / loans.length) * 100) : 0;
  const target = 70;
  const onTarget = lockCoverage >= target;

  // Lock type breakdown
  const lockTypes = useMemo(() => {
    const map = new Map<string, number>();
    locked.forEach(l => {
      const t = l.rateLock?.type || 'Standard';
      map.set(t, (map.get(t) || 0) + 1);
    });
    return Array.from(map.entries())
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count);
  }, [locked]);

  const kpis = [
    {
      label: 'Lock Coverage',
      value: `${lockCoverage}%`,
      sub: `vs ${target}% target`,
      color: onTarget ? 'emerald' : 'amber',
      icon: ShieldCheck,
    },
    {
      label: 'Locked',
      value: locked.length,
      sub: 'loans with active lock',
      color: 'blue',
      icon: Lock,
    },
    {
      label: 'Floating',
      value: floating.length,
      sub: 'exposed to rate moves',
      color: 'rose',
      icon: Unlock,
    },
    {
      label: 'Expiring ≤30d',
      value: expiringIn30.length,
      sub: `${expiringIn7.length} critical (≤7 days)`,
      color: expiringIn7.length > 0 ? 'rose' : expiringIn30.length > 0 ? 'amber' : 'emerald',
      icon: CalendarClock,
    },
  ];

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={onBack}
          className="p-2 hover:bg-slate-100 rounded-full transition-colors shrink-0"
          aria-label="Go back"
        >
          <ChevronLeft className="w-5 h-5 text-slate-500" aria-hidden />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Rate Lock Coverage</h1>
          <p className="text-sm text-slate-500 font-medium mt-0.5">
            Lock status, expiration timeline, and floating-rate exposure across the portfolio
          </p>
        </div>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map((k, i) => (
          <motion.div
            key={k.label}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.07 }}
            className="card-base p-5"
          >
            <div className="flex items-center gap-2 mb-3">
              <div className={`p-2 rounded-xl shrink-0 ${
                k.color === 'emerald' ? 'bg-emerald-50 text-emerald-600' :
                k.color === 'blue' ? 'bg-sky-50 text-sky-600' :
                k.color === 'rose' ? 'bg-rose-50 text-rose-600' :
                k.color === 'amber' ? 'bg-amber-50 text-amber-600' :
                'bg-slate-100 text-slate-500'
              }`}>
                <k.icon className="w-4 h-4" />
              </div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{k.label}</p>
            </div>
            <p className={`text-3xl font-bold tracking-tight ${
              k.color === 'emerald' ? 'text-emerald-700' :
              k.color === 'blue' ? 'text-sky-700' :
              k.color === 'rose' ? 'text-rose-600' :
              k.color === 'amber' ? 'text-amber-700' :
              'text-slate-700'
            }`}>{k.value}</p>
            <p className="text-xs text-slate-400 mt-1">{k.sub}</p>
          </motion.div>
        ))}
      </div>

      {/* Coverage gauge */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className="card-base p-6"
      >
        <div className="flex items-start gap-3 mb-5">
          <div className="p-2.5 rounded-xl bg-sky-50 text-sky-600 shrink-0">
            <TrendingUp className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-900">Coverage vs Target</h2>
            <p className="text-sm text-slate-500">Target: {target}% of loans locked</p>
          </div>
        </div>

        <div className="mb-5">
          <div className="flex justify-between text-xs font-semibold text-slate-500 mb-1.5">
            <span>Coverage: {lockCoverage}%</span>
            <span>Target: {target}%</span>
          </div>
          <div className="relative h-4 bg-slate-100 rounded-full overflow-hidden">
            <div
              className="absolute top-0 bottom-0 w-0.5 bg-slate-400 z-10"
              style={{ left: `${target}%` }}
            />
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${lockCoverage}%` }}
              transition={{ duration: 1.2, ease: 'easeOut', delay: 0.4 }}
              className={`h-full rounded-full ${onTarget ? 'bg-emerald-500' : 'bg-amber-400'}`}
            />
          </div>
        </div>

        {/* Portfolio split bar */}
        <div className="mb-5">
          <div className="text-xs font-semibold text-slate-500 mb-1.5">Portfolio lock status</div>
          <div className="flex h-6 rounded-full overflow-hidden gap-0.5">
            {locked.length > 0 && (
              <motion.div
                initial={{ flex: 0 }}
                animate={{ flex: locked.length }}
                transition={{ duration: 1.0, ease: 'easeOut', delay: 0.5 }}
                className="bg-emerald-500 flex items-center justify-center"
              >
                <span className="text-[10px] font-bold text-white">{locked.length}</span>
              </motion.div>
            )}
            {floating.length > 0 && (
              <motion.div
                initial={{ flex: 0 }}
                animate={{ flex: floating.length }}
                transition={{ duration: 1.0, ease: 'easeOut', delay: 0.6 }}
                className="bg-rose-400 flex items-center justify-center"
              >
                <span className="text-[10px] font-bold text-white">{floating.length}</span>
              </motion.div>
            )}
          </div>
          <div className="flex gap-4 mt-2">
            <span className="flex items-center gap-1 text-[11px] text-slate-500">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block" /> Locked ({locked.length})
            </span>
            <span className="flex items-center gap-1 text-[11px] text-slate-500">
              <span className="w-2.5 h-2.5 rounded-full bg-rose-400 inline-block" /> Floating ({floating.length})
            </span>
          </div>
        </div>

        {/* Insight */}
        <div className={`rounded-xl p-4 border ${
          onTarget
            ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
            : 'bg-amber-50 border-amber-200 text-amber-800'
        }`}>
          <p className="text-sm font-medium flex items-center gap-2">
            {onTarget
              ? <><ShieldCheck className="w-4 h-4 shrink-0" /> Lock coverage at {lockCoverage}% — above {target}% target. Monitor expiration pipeline to maintain this level.</>
              : <><AlertTriangle className="w-4 h-4 shrink-0" /> Coverage at {lockCoverage}%, {target - lockCoverage}pts below target. Lock {Math.ceil(((target - lockCoverage) / 100) * loans.length)} additional floating loans to reach goal.</>
            }
          </p>
        </div>
      </motion.div>

      {/* Expiring soon — critical list */}
      {expiringIn30.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35 }}
          className="card-base p-6"
        >
          <div className="flex items-center gap-3 mb-5">
            <div className="p-2.5 rounded-xl bg-amber-50 text-amber-600 shrink-0">
              <Clock className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-slate-50">Expiring Within 30 Days</h2>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {expiringIn7.length > 0 && <span className="text-rose-600 font-semibold dark:text-rose-400">{expiringIn7.length} critical (≤7d) · </span>}
                {expiringIn14.length - expiringIn7.length > 0 && <span className="text-amber-600 font-semibold dark:text-amber-400">{expiringIn14.length - expiringIn7.length} warning (8–14d) · </span>}
                {expiringIn30.length - expiringIn14.length} upcoming (15–30d)
              </p>
            </div>
          </div>

          <Tabs value={expiringTab} onValueChange={setExpiringTab} className="w-full">
            <TabsList
              className="mb-3 flex h-auto w-full flex-wrap justify-start gap-1 bg-slate-100 p-1 dark:bg-slate-800/80"
              aria-label="Days until lock expiry"
            >
              {EXPIRING_DAY_WINDOWS.map((w) => (
                <TabsTrigger
                  key={w}
                  id={`expiring-tab-${w}`}
                  value={String(w)}
                  className="shrink-0 px-2.5 py-2 text-xs sm:text-sm data-[state=active]:bg-white dark:data-[state=active]:bg-slate-900"
                >
                  ≤{w}d
                  <span className="ml-1 tabular-nums text-slate-500 dark:text-slate-400">
                    ({expiringCountsByWindow.get(w) ?? 0})
                  </span>
                </TabsTrigger>
              ))}
            </TabsList>

            <div
              role="tabpanel"
              id={`expiring-locks-panel-${expiringTab}`}
              aria-labelledby={`expiring-tab-${expiringTab}`}
            >
              <div className="relative mb-4">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                  aria-hidden
                />
                <Input
                  type="search"
                  placeholder="Search borrower, LO, location, amount, lock type…"
                  value={expiringSearch}
                  onChange={(e) => setExpiringSearch(e.target.value)}
                  className="h-10 border-slate-200 bg-white pl-9 dark:border-slate-700 dark:bg-slate-900"
                  aria-label="Search expiring locks"
                />
              </div>

              {expiringFiltered.length === 0 ? (
                <p className="rounded-xl border border-dashed border-slate-200 py-10 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                  {expiringSearch.trim()
                    ? 'No loans match your search in this window.'
                    : `No locks expiring within ${activeExpiringWindow} days.`}
                </p>
              ) : (
                <div className="space-y-3">
                  {expiringPageSlice.map((loan) => {
                    const colors = urgencyColor(loan.days);
                    return (
                      <button
                        key={loan.id}
                        type="button"
                        onClick={() => onLoanClick(loan.id)}
                        className={`flex w-full items-center justify-between rounded-xl border p-4 text-left transition-all hover:shadow-sm ${colors.bg} ${colors.border}`}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="mb-1 flex items-center gap-2">
                            <p className="truncate text-sm font-bold text-slate-800 dark:text-slate-100" title="Borrower (masked)">
                              {anonymizeBorrowerName(loan.borrower)}
                            </p>
                            {loan.isNonQM && (
                              <span className="rounded-full bg-purple-100 px-1.5 py-0.5 text-[9px] font-bold uppercase text-purple-700 dark:bg-purple-950/60 dark:text-purple-300">
                                Non-QM
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            {formatCityState(loan.city, loan.state)} · {formatCurrency(loan.loanAmount)}
                          </p>
                          <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">LO {displayLoanOfficer(loan)}</p>
                          <p className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">
                            Lock type: {loan.rateLock?.type || 'Standard'} · Expires{' '}
                            {loan.rateLock?.expires ? formatDate(loan.rateLock.expires) : '—'}
                          </p>
                        </div>
                        <div className="ml-4 shrink-0 text-right">
                          <span className={`text-lg font-bold ${colors.text}`}>{loan.days}d</span>
                          <p className={`mt-0.5 text-[10px] font-bold uppercase ${colors.text}`}>
                            {loan.days <= 7 ? 'Critical' : loan.days <= 14 ? 'Warning' : 'Upcoming'}
                          </p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}

              {expiringFiltered.length > EXPIRING_PAGE_SIZE && (
                <div className="mt-4 flex flex-col items-center justify-between gap-3 border-t border-slate-200 pt-4 sm:flex-row dark:border-slate-700">
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Showing {(expiringPageSafe - 1) * EXPIRING_PAGE_SIZE + 1}–
                    {Math.min(expiringPageSafe * EXPIRING_PAGE_SIZE, expiringFiltered.length)} of {expiringFiltered.length}
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={expiringPageSafe <= 1}
                      onClick={() => setExpiringPage((p) => Math.max(1, p - 1))}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:pointer-events-none disabled:opacity-40 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                    >
                      <ChevronLeft className="h-4 w-4" aria-hidden />
                      Prev
                    </button>
                    <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
                      Page {expiringPageSafe} / {expiringTotalPages}
                    </span>
                    <button
                      type="button"
                      disabled={expiringPageSafe >= expiringTotalPages}
                      onClick={() => setExpiringPage((p) => Math.min(expiringTotalPages, p + 1))}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:pointer-events-none disabled:opacity-40 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                    >
                      Next
                      <ChevronRight className="h-4 w-4" aria-hidden />
                    </button>
                  </div>
                </div>
              )}
            </div>
          </Tabs>
        </motion.div>
      )}

      {/* Floating loans — at market risk */}
      {floating.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="card-base p-6"
        >
          <div className="flex items-center gap-3 mb-5">
            <div className="p-2.5 rounded-xl bg-rose-50 text-rose-600 shrink-0">
              <Unlock className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">Floating — At Market Risk</h2>
              <p className="text-sm text-slate-500">
                {floating.length} loans with no rate lock · exposed to market-rate moves
              </p>
            </div>
          </div>

          <div className="overflow-x-auto -mx-2">
            <table className="w-full text-sm min-w-[480px]">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="text-left text-[10px] font-bold text-slate-400 uppercase tracking-wider pb-2 px-2">Borrower</th>
                  <th className="text-left text-[10px] font-bold text-slate-400 uppercase tracking-wider pb-2 px-2">Loan officer</th>
                  <th className="text-left text-[10px] font-bold text-slate-400 uppercase tracking-wider pb-2 px-2">Location</th>
                  <th className="text-right text-[10px] font-bold text-slate-400 uppercase tracking-wider pb-2 px-2">Loan Amount</th>
                  <th className="text-center text-[10px] font-bold text-slate-400 uppercase tracking-wider pb-2 px-2">Risk</th>
                  <th className="text-center text-[10px] font-bold text-slate-400 uppercase tracking-wider pb-2 px-2">Days to Close</th>
                </tr>
              </thead>
              <tbody>
                {floating.map((loan, i) => (
                  <tr
                    key={loan.id}
                    className={`cursor-pointer hover:bg-rose-50/40 transition-colors ${i % 2 === 0 ? 'bg-slate-50/40' : ''}`}
                    onClick={() => onLoanClick(loan.id)}
                  >
                    <td className="py-2.5 px-2 font-semibold text-slate-800" title="Borrower (masked)">
                      {anonymizeBorrowerName(loan.borrower)}
                    </td>
                    <td className="py-2.5 px-2 text-xs text-slate-600 max-w-[9rem]" title="Loan officer (masked)">
                      {displayLoanOfficer(loan)}
                    </td>
                    <td className="py-2.5 px-2 text-xs text-slate-500">{formatCityState(loan.city, loan.state)}</td>
                    <td className="py-2.5 px-2 text-right font-mono text-xs font-semibold text-slate-700">{formatCurrency(loan.loanAmount)}</td>
                    <td className="py-2.5 px-2 text-center">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                        loan.riskLevel === 'High' ? 'bg-rose-100 text-rose-700' :
                        loan.riskLevel === 'Medium' ? 'bg-amber-100 text-amber-700' :
                        'bg-emerald-100 text-emerald-700'
                      }`}>{loan.riskLevel}</span>
                    </td>
                    <td className="py-2.5 px-2 text-center text-slate-600">{loan.daysToClose}d</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </motion.div>
      )}

      {/* All locked loans */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.45 }}
        className="card-base p-6"
      >
        <div className="flex items-center gap-3 mb-5">
          <div className="p-2.5 rounded-xl bg-emerald-50 text-emerald-600 shrink-0">
            <Lock className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-900">All Locked Loans</h2>
            <p className="text-sm text-slate-500">Sorted by days remaining on lock</p>
          </div>
          {/* Lock type summary */}
          <div className="ml-auto flex gap-2 flex-wrap justify-end">
            {lockTypes.map(lt => (
              <span key={lt.type} className="text-[10px] font-bold bg-slate-100 text-slate-600 px-2 py-1 rounded-full">
                {lt.type}: {lt.count}
              </span>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto -mx-2">
          <table className="w-full text-sm min-w-[640px]">
            <thead>
              <tr className="border-b border-slate-100">
                <th className="text-left text-[10px] font-bold text-slate-400 uppercase tracking-wider pb-2 px-2">Borrower</th>
                <th className="text-left text-[10px] font-bold text-slate-400 uppercase tracking-wider pb-2 px-2">Loan officer</th>
                <th className="text-left text-[10px] font-bold text-slate-400 uppercase tracking-wider pb-2 px-2">Location</th>
                <th className="text-left text-[10px] font-bold text-slate-400 uppercase tracking-wider pb-2 px-2">Lock Type</th>
                <th className="text-center text-[10px] font-bold text-slate-400 uppercase tracking-wider pb-2 px-2">Expires</th>
                <th className="text-center text-[10px] font-bold text-slate-400 uppercase tracking-wider pb-2 px-2">Days Left</th>
                <th className="text-right text-[10px] font-bold text-slate-400 uppercase tracking-wider pb-2 px-2">Loan Amount</th>
              </tr>
            </thead>
            <tbody>
              {lockedSorted.map((loan, i) => {
                const isExpiringSoon = loan.days != null && loan.days <= 30;
                const colors = loan.days != null ? urgencyColor(loan.days) : null;
                return (
                  <tr
                    key={loan.id}
                    className={`cursor-pointer hover:bg-slate-50 transition-colors ${i % 2 === 0 ? 'bg-slate-50/30' : ''}`}
                    onClick={() => onLoanClick(loan.id)}
                  >
                    <td className="py-2.5 px-2 font-semibold text-slate-800" title="Borrower (masked)">
                      {anonymizeBorrowerName(loan.borrower)}
                    </td>
                    <td className="py-2.5 px-2 text-xs text-slate-600 max-w-[9rem]" title="Loan officer (masked)">
                      {displayLoanOfficer(loan)}
                    </td>
                    <td className="py-2.5 px-2 text-xs text-slate-500">{formatCityState(loan.city, loan.state)}</td>
                    <td className="py-2.5 px-2 text-xs text-slate-500">{loan.rateLock?.type || '—'}</td>
                    <td className="py-2.5 px-2 text-center text-xs text-slate-500">
                      {loan.rateLock?.expires ? formatDate(loan.rateLock.expires) : '—'}
                    </td>
                    <td className="py-2.5 px-2 text-center">
                      {loan.days != null ? (
                        <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${
                          isExpiringSoon && colors ? `${colors.badge}` : 'bg-emerald-50 text-emerald-700'
                        }`}>
                          {loan.days}d
                        </span>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                    <td className="py-2.5 px-2 text-right font-mono text-xs font-semibold text-slate-700">
                      {formatCurrency(loan.loanAmount)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </motion.div>
    </div>
  );
}
