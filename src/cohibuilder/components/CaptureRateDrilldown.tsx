import React, { useMemo, useCallback, useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  ChevronLeft,
  TrendingUp,
  CheckCircle2,
  XCircle,
  Clock,
  Users,
  Building2,
  Target,
  AlertTriangle,
  X,
  Map as MapIcon,
} from 'lucide-react';
import { useCohiBuilderPortfolio } from '../contexts/CohiBuilderPortfolioContext';
import { useFunnelPeriod, FUNNEL_PERIOD_SCALE } from '../contexts/FunnelPeriodContext';
import { contracts as defaultContracts } from '../data/mockData';
import { anonymizeBorrowerName, displayLoanOfficer, formatCityState } from '../lib/borrowerPrivacy';
import { externalLenderFromImportRow } from '../lib/externalLenderFromRow';

interface Props {
  onBack: () => void;
  /** Opens National Portfolio Map (same as sidebar Portfolio Map). */
  onOpenMapView?: () => void;
}

type Contract = (typeof defaultContracts)[number];
type ContractChannel = 'preferred' | 'external' | 'cashSale' | 'undecided';
type CategorizedContract = Contract & { cat: ContractChannel };

function statusCategory(c: Contract): ContractChannel {
  const s = (c.mortgageStatus ?? '').toLowerCase();
  /** Import rows prefix captured deals with `TBI Mortgage · …`; demos may use “Preferred”. */
  if (s.includes('tbi mortgage') || s.includes('preferred')) return 'preferred';
  if (s.includes('external')) return 'external';
  if (s.includes('cash sale')) return 'cashSale';
  return 'undecided';
}

function statusBadge(cat: ContractChannel) {
  if (cat === 'preferred')
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-emerald-50 text-emerald-700 text-[10px] font-bold rounded-full uppercase tracking-wide">
        <CheckCircle2 className="w-3 h-3" /> TBI Mortgage
      </span>
    );
  if (cat === 'external')
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-slate-100 text-slate-600 text-[10px] font-bold rounded-full uppercase tracking-wide">
        <XCircle className="w-3 h-3" /> External
      </span>
    );
  if (cat === 'cashSale')
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-50 text-amber-700 text-[10px] font-bold rounded-full uppercase tracking-wide">
        <Clock className="w-3 h-3" /> Cash-type
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-slate-100 text-slate-600 text-[10px] font-bold rounded-full uppercase tracking-wide">
      <Clock className="w-3 h-3" /> Pending
    </span>
  );
}

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return iso;
  }
}

/** Pick the most common city/state among loans matched to contracts in a community (borrower match). */
function loanCommunityLabel(l: { address?: string; builderImportRow?: { P_Name?: string } }) {
  const p = l.builderImportRow?.P_Name?.trim();
  if (p) return p;
  const m = (l.address || '').match(/Toll Brothers at\s+(.+)$/i);
  if (m) return m[1].trim();
  return '—';
}

function topCityStateFromHits(
  hits: { city: string; state: string }[],
): { city: string; state: string } {
  if (hits.length === 0) return { city: '—', state: '—' };
  const tallies = new Map<string, { city: string; state: string; n: number }>();
  for (const h of hits) {
    const city = (h.city || '').trim();
    const state = (h.state || '').trim();
    if (!city && !state) continue;
    const key = `${city}\t${state}`;
    const prev = tallies.get(key);
    tallies.set(key, { city: city || '—', state: state || '—', n: (prev?.n ?? 0) + 1 });
  }
  if (tallies.size === 0) return { city: '—', state: '—' };
  let best = { city: '—', state: '—' };
  let bestN = 0;
  for (const v of tallies.values()) {
    if (v.n > bestN) {
      bestN = v.n;
      best = { city: v.city, state: v.state };
    }
  }
  return best;
}

type ChannelFilter = 'all' | ContractChannel;

export default function CaptureRateDrilldown({ onBack, onOpenMapView }: Props) {
  const { contracts, allLoans: loans } = useCohiBuilderPortfolio();
  const { funnelPeriod } = useFunnelPeriod();
  const [externalBankModalOpen, setExternalBankModalOpen] = useState(false);
  const [channelFilter, setChannelFilter] = useState<ChannelFilter>('all');
  const contractsListRef = useRef<HTMLDivElement>(null);
  const categorized = useMemo(() => contracts.map((c) => ({ ...c, cat: statusCategory(c as Contract) })), [contracts]);

  const filteredCategorized = useMemo(() => {
    if (channelFilter === 'all') return categorized;
    return categorized.filter((c) => c.cat === channelFilter);
  }, [categorized, channelFilter]);

  const setChannel = (next: Exclude<ChannelFilter, 'all'>) => {
    setChannelFilter((prev) => (prev === next ? 'all' : next));
  };


  useEffect(() => {
    if (!externalBankModalOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setExternalBankModalOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [externalBankModalOpen]);

  const preferred = categorized.filter(c => c.cat === 'preferred');
  const external = categorized.filter(c => c.cat === 'external');
  const cashSales = categorized.filter(c => c.cat === 'cashSale');
  const undecided = categorized.filter(c => c.cat === 'undecided');
  const total = contracts.length;

  const isPortfolioEmpty = total === 0;
  const periodScale = FUNNEL_PERIOD_SCALE[funnelPeriod];
  const periodCount = useCallback(
    (n: number) => (isPortfolioEmpty ? 0 : Math.max(0, Math.round(Number(n) * periodScale))),
    [isPortfolioEmpty, periodScale],
  );

  const nPreferred = periodCount(preferred.length);
  const nExternal = periodCount(external.length);
  const nCashSales = periodCount(cashSales.length);
  const nUndecided = periodCount(undecided.length);
  /** Cash-type (import Loan_Type) + capture TBD, rolled into one “Pending” bucket in KPIs and summaries. */
  const nUndecidedPendingTotal = nCashSales + nUndecided;
  const nTotal = periodCount(total);
  /** Contracts where a lender path is known: TBI Mortgage + third-party (excludes pending). */
  const nTbiMortgagePlusExternal = nPreferred + nExternal;

  const captureRate = nTotal ? Math.round((nPreferred / nTotal) * 100) : 0;
  const target = 85;
  const gap = target - captureRate;
  const onTarget = captureRate >= target;
  const gapContractCount = Math.max(0, Math.ceil((gap / 100) * nTotal));

  const loanByBorrower = useMemo(() => {
    const m = new Map<string, (typeof loans)[number]>();
    for (const l of loans) {
      const k = l.borrower.trim().toLowerCase();
      if (!m.has(k)) m.set(k, l);
    }
    return m;
  }, [loans]);

  // Community breakdown (city/state from loans matched by borrower on same row / name)
  const byComm = useMemo(() => {
    const map = new Map<
      string,
      {
        preferred: number;
        external: number;
        cashSale: number;
        undecided: number;
        total: number;
        locationHits: { city: string; state: string }[];
      }
    >();
    categorized.forEach((c) => {
      const comm = c.community || 'Unknown';
      if (!map.has(comm)) {
        map.set(comm, { preferred: 0, external: 0, cashSale: 0, undecided: 0, total: 0, locationHits: [] });
      }
      const entry = map.get(comm)!;
      entry[c.cat]++;
      entry.total++;
      const loan = loanByBorrower.get((c.borrower || '').trim().toLowerCase());
      if (loan) {
        entry.locationHits.push({ city: loan.city || '', state: loan.state || '' });
      }
    });
    return Array.from(map.entries())
      .map(([name, v]) => {
        const { city, state } = topCityStateFromHits(v.locationHits);
        const cityCol =
          city !== '—' && city.trim().toLowerCase() === name.trim().toLowerCase() ? '—' : city;
        return {
          name,
          city: cityCol,
          state: state !== '—' ? state : '—',
          preferred: v.preferred,
          external: v.external,
          cashSale: v.cashSale,
          undecided: v.undecided,
          total: v.total,
          rate: Math.round((v.preferred / v.total) * 100),
        };
      })
      .sort((a, b) => b.total - a.total);
  }, [categorized, loanByBorrower]);

  const byCommScaled = useMemo(() => {
    return byComm
      .map((row) => {
        const p = periodCount(row.preferred);
        const e = periodCount(row.external);
        const cs = periodCount(row.cashSale);
        const u = periodCount(row.undecided);
        const t = p + e + cs + u;
        return {
          name: row.name,
          city: row.city,
          state: row.state,
          preferred: p,
          external: e,
          cashSale: cs,
          undecided: u,
          undecidedPending: cs + u,
          total: t,
          rate: t > 0 ? Math.round((p / t) * 100) : 0,
        };
      })
      .sort((a, b) => b.total - a.total);
  }, [byComm, periodCount]);

  // Preferred loan details from loans array
  const preferredLoansData = useMemo(() => loans.filter(l => l.isPreferred), [loans]);

  const externalFinancingRows = useMemo(() => {
    return external.map((c) => {
      const loan = loanByBorrower.get((c.borrower || '').trim().toLowerCase());
      const row = loan?.builderImportRow;
      const bank = externalLenderFromImportRow(row, loan?.lender);
      const loanNumber = row?.Loanno?.trim() || loan?.loanNumber || '—';
      const status =
        row?.Origination_Status?.trim() || loan?.status || c.mortgageStatus || '—';
      return {
        key: c.id,
        borrower: c.borrower,
        city: loan?.city?.trim() || '—',
        state: loan?.state?.trim() || '—',
        bank,
        loanNumber,
        status,
      };
    });
  }, [external, loanByBorrower]);

  const renderContractRow = useCallback(
    (c: CategorizedContract) => {
      const loan = loanByBorrower.get((c.borrower || '').trim().toLowerCase());
      const loc = formatCityState(loan?.city, loan?.state);
      return (
        <div
          key={c.id}
          className="flex items-center justify-between gap-2 py-2.5 px-2.5 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800/40 border border-transparent hover:border-slate-100 dark:hover:border-slate-700 transition-all"
        >
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate" title="Borrower (masked)">
              {anonymizeBorrowerName(c.borrower)}
            </p>
            <p className="text-xs text-slate-400 dark:text-slate-500">
              {c.community} · {loc} · {formatDate(c.date)}
            </p>
            {loan ? (
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">LO {displayLoanOfficer(loan)}</p>
            ) : null}
          </div>
          <div className="flex items-center gap-2 ml-2 shrink-0">
            <span className="text-xs text-slate-400 dark:text-slate-500 hidden sm:block max-w-[9rem] truncate">
              {c.mortgageStatus}
            </span>
            {statusBadge(c.cat)}
          </div>
        </div>
      );
    },
    [loanByBorrower],
  );

  const segmentFilterTitle =
    channelFilter === 'preferred'
      ? 'Captured TBI Mortgage'
      : channelFilter === 'external'
        ? 'External'
        : channelFilter === 'cashSale'
          ? 'Cash sales'
          : channelFilter === 'undecided'
            ? 'Undecided'
            : '';

  const kpis: Array<{
    label: string;
    value: string | number;
    sub: string;
    color: 'emerald' | 'rose' | 'amber' | 'slate';
    icon: typeof TrendingUp;
    drilldown?: 'external-bank';
  }> = [
    {
      label: 'Capture Rate',
      value: `${captureRate}%`,
      sub: `vs ${target}% goal · ${funnelPeriod.toUpperCase()}`,
      color: onTarget ? 'emerald' : 'rose',
      icon: TrendingUp,
    },
    {
      label: 'TBI Mortgage',
      value: nPreferred,
      sub: `TBI Mortgage (${funnelPeriod.toUpperCase()} window)`,
      color: 'emerald',
      icon: CheckCircle2,
    },
    {
      label: 'External',
      value: nExternal,
      sub: `3rd-party (${funnelPeriod.toUpperCase()})`,
      color: 'slate',
      icon: XCircle,
      drilldown: 'external-bank',
    },
    {
      label: 'Pending',
      value: nUndecidedPendingTotal,
      sub: funnelPeriod.toUpperCase(),
      color: 'amber',
      icon: Clock,
    },
  ];

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={onBack}
          className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition-colors shrink-0"
          aria-label="Go back"
        >
          <ChevronLeft className="w-5 h-5 text-slate-500 dark:text-slate-400" aria-hidden />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Mortgage Capture Rate</h1>
          <p className="text-sm text-slate-500 font-medium mt-0.5">
            TBI Mortgage capture share for the{' '}
            <span className="font-semibold text-slate-700">{funnelPeriod.toUpperCase()}</span> reporting window (same control
            as the builder header). Contract list below is the full import.
          </p>
        </div>
      </div>

      {/* TBI Mortgage capture vs external */}
      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 }}
        className="card-base p-6 border border-emerald-200/60 bg-gradient-to-br from-emerald-50/40 via-white to-slate-50/80 dark:from-emerald-950/20 dark:via-slate-900/40 dark:to-slate-950/60 dark:border-emerald-900/40"
      >
        <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">Toll Brothers mortgage lending</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5 max-w-2xl">
              TBI Mortgage–captured contracts vs external financing. Counts follow the{' '}
              <span className="font-semibold text-slate-600 dark:text-slate-300">{funnelPeriod.toUpperCase()}</span> window;
              pipeline split shows active loans captured to TB Mortgage (captive vs preferred channels).
            </p>
          </div>
        </div>

        <div className="mb-4 flex flex-col gap-3 rounded-xl border border-emerald-200/50 bg-emerald-50/35 dark:bg-emerald-950/25 dark:border-emerald-900/40 px-4 py-3">
          <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-2 sm:gap-x-4 sm:gap-y-1">
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            {onOpenMapView ? (
              <button
                type="button"
                onClick={onOpenMapView}
                aria-label="Open portfolio map for this capture view"
                className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/80 bg-white px-3 py-2 text-xs font-bold text-emerald-800 shadow-sm transition-colors hover:bg-emerald-50 dark:border-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-200 dark:hover:bg-emerald-950/60"
              >
                <MapIcon className="h-4 w-4 shrink-0" aria-hidden />
                View on map
              </button>
            ) : null}
            <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span className="text-2xl font-bold tabular-nums text-slate-900 dark:text-slate-50">{nTbiMortgagePlusExternal}</span>
              <span className="text-xs text-slate-500 dark:text-slate-400">
                TBI Mortgage + external · excludes pending · same window as segments
              </span>
            </div>
          </div>
          <div className="hidden sm:block h-8 w-px bg-emerald-200/60 dark:bg-emerald-800/60 shrink-0" aria-hidden />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-2 text-sm">
              <button
                type="button"
                onClick={() => setChannel('preferred')}
                aria-pressed={channelFilter === 'preferred'}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-left transition-colors ${
                  channelFilter === 'preferred'
                    ? 'border-emerald-500 bg-emerald-50/90 ring-2 ring-emerald-400/30 dark:bg-emerald-950/50 dark:ring-emerald-500/25'
                    : 'border-transparent bg-white/60 hover:border-emerald-200/80 dark:bg-slate-800/40 dark:hover:border-emerald-900/50'
                }`}
              >
                <span className="h-2 w-2 rounded-full bg-emerald-500 shrink-0" aria-hidden />
                <span className="text-slate-600 dark:text-slate-300">Captured TBI Mortgage</span>
                <span className="font-bold tabular-nums text-emerald-700 dark:text-emerald-400">{nPreferred}</span>
              </button>
              <span className="text-slate-300 dark:text-slate-600 hidden sm:inline" aria-hidden>
                +
              </span>
              <button
                type="button"
                onClick={() => setChannel('external')}
                aria-pressed={channelFilter === 'external'}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-left transition-colors ${
                  channelFilter === 'external'
                    ? 'border-slate-500 bg-slate-100/90 ring-2 ring-slate-400/25 dark:bg-slate-800/80 dark:ring-slate-500/20'
                    : 'border-transparent bg-white/60 hover:border-slate-200/80 dark:bg-slate-800/40 dark:hover:border-slate-600'
                }`}
              >
                <span className="h-2 w-2 rounded-full bg-slate-400 shrink-0" aria-hidden />
                <span className="text-slate-600 dark:text-slate-300">External</span>
                <span className="font-bold tabular-nums text-slate-700 dark:text-slate-200">{nExternal}</span>
              </button>
              <span className="text-slate-400 dark:text-slate-500 hidden sm:inline" aria-hidden>
                ·
              </span>
              <button
                type="button"
                onClick={() => setChannel('cashSale')}
                aria-pressed={channelFilter === 'cashSale'}
                disabled={nCashSales === 0}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-left transition-colors disabled:pointer-events-none disabled:opacity-40 ${
                  channelFilter === 'cashSale'
                    ? 'border-amber-400 bg-amber-50/90 ring-2 ring-amber-400/30 dark:bg-amber-950/40 dark:ring-amber-500/25'
                    : 'border-transparent bg-white/60 hover:border-amber-200/80 dark:bg-slate-800/40 dark:hover:border-amber-900/50'
                }`}
              >
                <span className="h-2 w-2 rounded-full bg-amber-400 shrink-0" aria-hidden />
                <span className="text-slate-600 dark:text-slate-300">Cash sales</span>
                <span className="font-bold tabular-nums text-amber-800 dark:text-amber-200">{nCashSales}</span>
              </button>
              <span className="text-slate-400 dark:text-slate-500 hidden sm:inline" aria-hidden>
                ·
              </span>
              <button
                type="button"
                onClick={() => setChannel('undecided')}
                aria-pressed={channelFilter === 'undecided'}
                disabled={nUndecided === 0}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-left transition-colors disabled:pointer-events-none disabled:opacity-40 ${
                  channelFilter === 'undecided'
                    ? 'border-amber-300 bg-amber-50/60 ring-2 ring-amber-300/40 dark:border-amber-800 dark:bg-amber-950/30 dark:ring-amber-700/30'
                    : 'border-transparent bg-white/60 hover:border-amber-200/60 dark:bg-slate-800/40 dark:hover:border-amber-900/40'
                }`}
              >
                <span className="h-2 w-2 rounded-full bg-amber-200 dark:bg-amber-700 shrink-0" aria-hidden />
                <span className="text-slate-600 dark:text-slate-300">Undecided</span>
                <span className="font-bold tabular-nums text-slate-700 dark:text-slate-200">{nUndecided}</span>
              </button>
            </div>
            <p className="text-[10px] text-slate-400 dark:text-slate-500">
              Tap a segment to filter · lists appear here and in Contracts below · tap the same segment again to show all
            </p>
          </div>
          </div>
          {channelFilter !== 'all' && (
            <div className="border-t border-emerald-200/50 dark:border-emerald-800/50 pt-3">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-bold text-slate-800 dark:text-slate-100">
                  {segmentFilterTitle}{' '}
                  <span className="font-semibold text-slate-500 dark:text-slate-400">
                    ({filteredCategorized.length.toLocaleString()})
                  </span>
                </p>
                <button
                  type="button"
                  onClick={() => contractsListRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                  className="text-[10px] font-semibold text-emerald-700 hover:text-emerald-800 dark:text-emerald-400 dark:hover:text-emerald-300"
                >
                  Jump to full Contracts list
                </button>
              </div>
              <div className="cohi-modal-scroll max-h-72 space-y-1 overflow-y-auto overscroll-contain rounded-lg border border-emerald-200/40 bg-white/60 p-2 pr-1 dark:border-emerald-900/40 dark:bg-slate-900/40">
                {filteredCategorized.length === 0 ? (
                  <p className="py-6 text-center text-xs text-slate-500 dark:text-slate-400">No contracts in this slice.</p>
                ) : (
                  filteredCategorized.map(renderContractRow)
                )}
              </div>
            </div>
          )}
        </div>
      </motion.div>

      {/* KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map((k, i) => {
          const inner = (
            <>
              <div className="flex items-center gap-2 mb-3">
                <div
                  className={`p-2 rounded-xl shrink-0 ${
                    k.color === 'emerald'
                      ? 'bg-emerald-50 text-emerald-600'
                      : k.color === 'rose'
                        ? 'bg-rose-50 text-rose-600'
                        : k.color === 'amber'
                          ? 'bg-amber-50 text-amber-600'
                          : 'bg-slate-100 text-slate-500'
                  }`}
                >
                  <k.icon className="w-4 h-4" />
                </div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{k.label}</p>
              </div>
              <p
                className={`text-3xl font-bold tracking-tight ${
                  k.color === 'emerald'
                    ? 'text-emerald-700'
                    : k.color === 'rose'
                      ? 'text-rose-600'
                      : k.color === 'amber'
                        ? 'text-amber-700'
                        : 'text-slate-700'
                }`}
              >
                {k.value}
              </p>
              <p className="text-xs text-slate-400 mt-1">{k.sub}</p>
              {k.drilldown === 'external-bank' && external.length > 0 ? (
                <p className="text-[10px] font-semibold text-sky-600 mt-2">Tap for lender detail</p>
              ) : null}
            </>
          );
          if (k.drilldown === 'external-bank' && external.length > 0) {
            return (
              <motion.button
                key={k.label}
                type="button"
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.07 }}
                onClick={() => setExternalBankModalOpen(true)}
                className="card-base p-5 text-left w-full rounded-2xl border border-transparent hover:border-slate-200 dark:hover:border-slate-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40 transition-colors"
              >
                {inner}
              </motion.button>
            );
          }
          return (
            <motion.div
              key={k.label}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.07 }}
              className="card-base p-5"
            >
              {inner}
            </motion.div>
          );
        })}
      </div>

      {/* Goal gauge + insight */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className="card-base p-6"
      >
        <div className="flex items-start gap-3 mb-5">
          <div className="p-2.5 rounded-xl bg-emerald-50 text-emerald-600 shrink-0">
            <Target className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-900">Capture Goal Tracker</h2>
            <p className="text-sm text-slate-500">
              Target: {target}% TBI Mortgage share · window: {funnelPeriod.toUpperCase()}
            </p>
          </div>
        </div>

        {/* Progress bar */}
        <div className="mb-4">
          <div className="flex justify-between text-xs font-semibold text-slate-500 mb-1.5">
            <span>Current: {captureRate}%</span>
            <span>Goal: {target}%</span>
          </div>
          <div className="relative h-4 bg-slate-100 rounded-full overflow-hidden">
            {/* Target line */}
            <div
              className="absolute top-0 bottom-0 w-0.5 bg-slate-400 z-10"
              style={{ left: `${target}%` }}
            />
            {/* Fill */}
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${captureRate}%` }}
              transition={{ duration: 1.2, ease: 'easeOut', delay: 0.4 }}
              className={`h-full rounded-full ${onTarget ? 'bg-emerald-500' : 'bg-rose-400'}`}
            />
          </div>
        </div>

        {/* Stacked bar by category */}
        <div className="mb-4">
          <div className="flex text-xs font-semibold text-slate-500 mb-1.5">
            <span>Contract mix by channel</span>
          </div>
          <div className="flex h-6 rounded-full overflow-hidden gap-0.5">
            {nPreferred > 0 && (
              <motion.div
                initial={{ flex: 0 }}
                animate={{ flex: nPreferred }}
                transition={{ duration: 1.0, ease: 'easeOut', delay: 0.5 }}
                className="bg-emerald-500 flex items-center justify-center"
                title={`TBI Mortgage: ${nPreferred} (${funnelPeriod.toUpperCase()})`}
              >
                <span className="text-[10px] font-bold text-white">{nPreferred}</span>
              </motion.div>
            )}
            {nExternal > 0 && (
              <motion.div
                initial={{ flex: 0 }}
                animate={{ flex: nExternal }}
                transition={{ duration: 1.0, ease: 'easeOut', delay: 0.6 }}
                className="bg-slate-400 flex items-center justify-center"
                title={`External: ${nExternal} (${funnelPeriod.toUpperCase()})`}
              >
                <span className="text-[10px] font-bold text-white">{nExternal}</span>
              </motion.div>
            )}
            {nCashSales > 0 && (
              <motion.div
                initial={{ flex: 0 }}
                animate={{ flex: nCashSales }}
                transition={{ duration: 1.0, ease: 'easeOut', delay: 0.7 }}
                className="bg-amber-400 flex items-center justify-center"
                title={`Cash-type (Loan_Type): ${nCashSales} (${funnelPeriod.toUpperCase()})`}
              >
                <span className="text-[10px] font-bold text-white">{nCashSales}</span>
              </motion.div>
            )}
            {nUndecided > 0 && (
              <motion.div
                initial={{ flex: 0 }}
                animate={{ flex: nUndecided }}
                transition={{ duration: 1.0, ease: 'easeOut', delay: 0.75 }}
                className="bg-amber-200 dark:bg-amber-900/50 flex items-center justify-center"
                title={`Pending: ${nUndecided} (${funnelPeriod.toUpperCase()})`}
              >
                <span className="text-[10px] font-bold text-amber-900 dark:text-amber-100">{nUndecided}</span>
              </motion.div>
            )}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
            <span className="flex items-center gap-1 text-[11px] text-slate-500"><span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block" /> TBI Mortgage</span>
            <span className="flex items-center gap-1 text-[11px] text-slate-500"><span className="w-2.5 h-2.5 rounded-full bg-slate-400 inline-block" /> External</span>
            <span className="flex items-center gap-1 text-[11px] text-slate-500"><span className="w-2.5 h-2.5 rounded-full bg-amber-400 inline-block" /> Cash-type</span>
            {nUndecided > 0 ? (
              <span className="flex items-center gap-1 text-[11px] text-slate-500"><span className="w-2.5 h-2.5 rounded-full bg-amber-200 dark:bg-amber-800 inline-block" /> Pending</span>
            ) : null}
          </div>
        </div>

        {/* Insight callout */}
        <div className={`rounded-xl p-4 border ${
          onTarget
            ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
            : 'bg-rose-50 border-rose-200 text-rose-800'
        }`}>
          {onTarget ? (
            <p className="text-sm font-medium flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              On target — {captureRate}% is {captureRate - target}pts above goal. Maintain velocity and protect pull-through.
            </p>
          ) : (
            <p className="text-sm font-medium flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>
                {captureRate}% capture — <strong>{gap}pts below goal</strong>.
                {` Capture ${gapContractCount} more to TBI Mortgage (in this window) to reach target.`}
              </span>
            </p>
          )}
        </div>
      </motion.div>

      {/* Community breakdown */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.35 }}
        className="card-base p-6"
      >
        <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <div className="shrink-0 rounded-xl bg-sky-50 p-2.5 text-sky-600 dark:bg-sky-950/50 dark:text-sky-400">
              <Building2 className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">By Community</h2>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Counts scaled to {funnelPeriod.toUpperCase()} (same as header). City is the metro / municipality, not the plan name.
              </p>
            </div>
          </div>
          {onOpenMapView && (
            <button
              type="button"
              onClick={onOpenMapView}
              aria-label="Open portfolio map"
              title="Open portfolio map"
              className="inline-flex shrink-0 items-center justify-center gap-2 self-start rounded-xl border border-sky-200/90 bg-white px-3.5 py-2 text-xs font-bold text-sky-700 shadow-sm transition-colors hover:border-sky-300 hover:bg-sky-50 dark:border-sky-800 dark:bg-slate-900 dark:text-sky-300 dark:hover:bg-sky-950/40 sm:self-center"
            >
              <MapIcon className="h-4 w-4" aria-hidden />
              View on map
            </button>
          )}
        </div>

        <div className="overflow-x-auto -mx-2">
          <table className="w-full text-sm min-w-[640px]">
            <thead>
              <tr className="border-b border-slate-100">
                <th className="text-left text-[10px] font-bold text-slate-400 uppercase tracking-wider pb-2 px-2">Community</th>
                <th className="text-left text-[10px] font-bold text-slate-400 uppercase tracking-wider pb-2 px-2">City</th>
                <th className="text-left text-[10px] font-bold text-slate-400 uppercase tracking-wider pb-2 px-2 w-14">St</th>
                <th className="text-center text-[10px] font-bold text-slate-400 uppercase tracking-wider pb-2 px-2">Total</th>
                <th className="text-center text-[10px] font-bold text-slate-400 uppercase tracking-wider pb-2 px-2">TBI Mortgage</th>
                <th className="text-center text-[10px] font-bold text-slate-400 uppercase tracking-wider pb-2 px-2">External</th>
                <th className="text-center text-[10px] font-bold text-slate-400 uppercase tracking-wider pb-2 px-2">
                  Pending
                </th>
                <th className="text-right text-[10px] font-bold text-slate-400 uppercase tracking-wider pb-2 px-2">Rate</th>
              </tr>
            </thead>
            <tbody>
              {byCommScaled.map((row, i) => (
                <tr key={row.name} className={i % 2 === 0 ? 'bg-slate-50/50 dark:bg-slate-800/30' : ''}>
                  <td className="py-2.5 px-2 font-semibold text-slate-800 dark:text-slate-100">{row.name}</td>
                  <td className="py-2.5 px-2 text-slate-600 dark:text-slate-300 text-xs max-w-[10rem] truncate" title={row.city}>
                    {row.city}
                  </td>
                  <td className="py-2.5 px-2 text-slate-600 dark:text-slate-300 text-xs font-semibold tabular-nums">{row.state}</td>
                  <td className="py-2.5 px-2 text-center text-slate-600">{row.total}</td>
                  <td className="py-2.5 px-2 text-center">
                    <span className="text-emerald-700 font-bold">{row.preferred}</span>
                  </td>
                  <td className="py-2.5 px-2 text-center">
                    <span className="text-slate-500">{row.external}</span>
                  </td>
                  <td className="py-2.5 px-2 text-center">
                    <span className="text-amber-600 font-semibold tabular-nums">{row.undecidedPending}</span>
                  </td>
                  <td className="py-2.5 px-2 text-right">
                    <span className={`font-bold text-sm ${
                      row.rate >= target ? 'text-emerald-600' : row.rate >= 50 ? 'text-amber-600' : 'text-rose-600'
                    }`}>{row.rate}%</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </motion.div>

      {/* All contracts list */}
      <motion.div
        ref={contractsListRef}
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4 }}
        className="card-base p-6 scroll-mt-4"
      >
        <div className="flex items-center gap-3 mb-5">
          <div className="p-2.5 rounded-xl bg-violet-50 text-violet-600 shrink-0">
            <Users className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
              {channelFilter === 'all'
                ? 'All contracts'
                : channelFilter === 'preferred'
                  ? 'TBI Mortgage contracts'
                  : channelFilter === 'external'
                    ? 'External financing contracts'
                    : channelFilter === 'cashSale'
                      ? 'Cash sales contracts'
                      : 'Undecided contracts'}
            </h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Showing {filteredCategorized.length.toLocaleString()} of {total.toLocaleString()} signed contracts
              {channelFilter !== 'all' ? ' · filtered from TB lending bar above' : ''} · KPIs use{' '}
              {funnelPeriod.toUpperCase()}
            </p>
          </div>
        </div>

        <div className="space-y-2">
          {filteredCategorized.length === 0 && (
            <p className="text-sm text-slate-500 py-8 text-center">No contracts in this slice for the current portfolio.</p>
          )}
          {filteredCategorized.map(renderContractRow)}
        </div>
      </motion.div>

      {/* Preferred loan portfolio detail */}
      {preferredLoansData.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.45 }}
          className="card-base p-6"
        >
          <div className="flex items-center gap-3 mb-5">
            <div className="p-2.5 rounded-xl bg-emerald-50 text-emerald-600 shrink-0">
              <CheckCircle2 className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">TBI Mortgage — active captured loans</h2>
              <p className="text-sm text-slate-500">Captive vs preferred TB Mortgage pipeline</p>
            </div>
          </div>

          <div className="overflow-x-auto -mx-2">
            <table className="w-full text-sm min-w-[720px]">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="text-left text-[10px] font-bold text-slate-400 uppercase tracking-wider pb-2 px-2">Borrower</th>
                  <th className="text-left text-[10px] font-bold text-slate-400 uppercase tracking-wider pb-2 px-2">Loan officer</th>
                  <th className="text-left text-[10px] font-bold text-slate-400 uppercase tracking-wider pb-2 px-2">Community</th>
                  <th className="text-left text-[10px] font-bold text-slate-400 uppercase tracking-wider pb-2 px-2">Location</th>
                  <th className="text-right text-[10px] font-bold text-slate-400 uppercase tracking-wider pb-2 px-2">Loan Amount</th>
                  <th className="text-center text-[10px] font-bold text-slate-400 uppercase tracking-wider pb-2 px-2">Status</th>
                  <th className="text-center text-[10px] font-bold text-slate-400 uppercase tracking-wider pb-2 px-2">Days to Close</th>
                </tr>
              </thead>
              <tbody>
                {preferredLoansData.map((l, i) => (
                  <tr key={l.id} className={i % 2 === 0 ? 'bg-slate-50/50' : ''}>
                    <td className="py-2.5 px-2 font-semibold text-slate-800 dark:text-slate-100" title="Borrower (masked)">
                      {anonymizeBorrowerName(l.borrower)}
                    </td>
                    <td className="py-2.5 px-2 text-xs text-slate-600 max-w-[9rem]" title="Loan officer (masked)">
                      {displayLoanOfficer(l)}
                    </td>
                    <td className="py-2.5 px-2 text-slate-600 text-xs max-w-[9rem] truncate" title={loanCommunityLabel(l)}>
                      {loanCommunityLabel(l)}
                    </td>
                    <td className="py-2.5 px-2 text-slate-500 text-xs max-w-[10rem] truncate" title={formatCityState(l.city, l.state)}>
                      {formatCityState(l.city, l.state)}
                    </td>
                    <td className="py-2.5 px-2 text-right font-mono text-slate-700 font-semibold text-xs">
                      {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(l.loanAmount)}
                    </td>
                    <td className="py-2.5 px-2 text-center">
                      <span className="text-[10px] font-bold bg-sky-50 text-sky-700 px-2 py-0.5 rounded-full">{l.status}</span>
                    </td>
                    <td className="py-2.5 px-2 text-center text-slate-600">{l.daysToClose}d</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </motion.div>
      )}

      <AnimatePresence>
        {externalBankModalOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setExternalBankModalOpen(false)}
              className="fixed inset-0 z-[var(--z-modal-backdrop)] bg-slate-400/25 backdrop-blur-[2px]"
              aria-hidden
            />
            <div className="cohi-modal-center-host">
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-labelledby="external-lender-modal-title"
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.97 }}
              transition={{ type: 'spring', damping: 26, stiffness: 320 }}
              className="flex w-[min(100vw-1.5rem,calc(100%-2rem))] max-w-4xl max-h-[min(88dvh,calc(100dvh-2rem))] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="sticky top-0 z-10 shrink-0 border-b border-slate-200 bg-white p-4 sm:p-5 dark:border-slate-700 dark:bg-slate-900 flex items-start justify-between gap-3">
                <div>
                  <h3
                    id="external-lender-modal-title"
                    className="text-lg font-bold text-slate-900 dark:text-slate-100"
                  >
                    External financing — lender detail
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-2xl leading-relaxed">
                    Bank / lender is read from the <span className="font-mono">External_Lender</span> column when your
                    sheet includes it; otherwise from <span className="font-mono">Capture_Lost_Comment</span> (e.g.
                    “Borrower selected …”). Loan # uses <span className="font-mono">Loanno</span> when linked. Status
                    prefers <span className="font-mono">Origination_Status</span>, then pipeline status, then contract
                    mortgage line.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setExternalBankModalOpen(false)}
                  className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 shrink-0"
                  aria-label="Close"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="cohi-modal-scroll min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
                <div className="overflow-x-auto -mx-1">
                  <table className="w-full text-sm min-w-[720px]">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-slate-700">
                        <th className="text-left text-[10px] font-bold text-slate-400 uppercase tracking-wider pb-2 px-2">
                          Borrower
                        </th>
                        <th className="text-left text-[10px] font-bold text-slate-400 uppercase tracking-wider pb-2 px-2">
                          City
                        </th>
                        <th className="text-left text-[10px] font-bold text-slate-400 uppercase tracking-wider pb-2 px-2 w-14">
                          St
                        </th>
                        <th className="text-left text-[10px] font-bold text-slate-400 uppercase tracking-wider pb-2 px-2">
                          Bank / lender
                        </th>
                        <th className="text-left text-[10px] font-bold text-slate-400 uppercase tracking-wider pb-2 px-2">
                          Loan #
                        </th>
                        <th className="text-left text-[10px] font-bold text-slate-400 uppercase tracking-wider pb-2 px-2">
                          Status
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {externalFinancingRows.map((r, idx) => (
                        <tr
                          key={r.key}
                          className={idx % 2 === 0 ? 'bg-slate-50/60 dark:bg-slate-800/40' : ''}
                        >
                          <td className="py-2.5 px-2 font-medium text-slate-800 dark:text-slate-100">
                            {anonymizeBorrowerName(r.borrower)}
                          </td>
                          <td className="py-2.5 px-2 text-slate-600 dark:text-slate-300">{r.city}</td>
                          <td className="py-2.5 px-2 text-slate-600 dark:text-slate-300 font-semibold tabular-nums">
                            {r.state}
                          </td>
                          <td className="py-2.5 px-2 text-slate-700 dark:text-slate-200 max-w-[14rem] truncate" title={r.bank}>
                            {r.bank}
                          </td>
                          <td className="py-2.5 px-2 font-mono text-xs text-slate-700 dark:text-slate-200">{r.loanNumber}</td>
                          <td className="py-2.5 px-2 text-slate-600 dark:text-slate-300 text-xs max-w-[12rem] truncate" title={r.status}>
                            {r.status}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </motion.div>
            </div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
