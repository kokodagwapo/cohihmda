import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  ArrowLeft,
  ChevronRight,
  ChevronLeft,
  Calendar,
  Clock,
  Lock,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  ArrowUpDown,
} from 'lucide-react';
import Tooltip from './Tooltip';
import { useCohiBuilderPortfolio } from '../contexts/CohiBuilderPortfolioContext';
import type { CohiPortfolioLoan } from '../data/portfolioFromBuilderImport';
import { anonymizeBorrowerName, displayLoanOfficer } from '../lib/borrowerPrivacy';
import {
  lenderMessagingName,
  resolvedLenderTitle,
  resolvedPrimaryLenderLabel,
} from '../lib/lenderDisplay';
import {
  getLoanPipelineCategory,
  LOAN_PIPELINE_TABS,
  type LoanPipelineTabId,
} from '../lib/loanPipelineCategory';

type Loan = CohiPortfolioLoan;

function daysToLockExpiry(loan: Loan): number | null {
  if (!loan.rateLock?.expires) return null;
  const expiresMs = new Date(loan.rateLock.expires).getTime();
  if (Number.isNaN(expiresMs)) return null;
  return Math.ceil((expiresMs - Date.now()) / (1000 * 60 * 60 * 24));
}

function formatLockDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return iso;
  }
}

type LoanSortKey =
  | 'borrower'
  | 'dateStarted'
  | 'lender'
  | 'construction'
  | 'readiness'
  | 'nonQmType'
  | 'verifiedAssets'
  | 'lockExpires'
  | 'lockDaysLeft'
  | 'daysToClose'
  | 'risk';

/** Parseable timestamp for sorting; falls back to loan id for stable ordering. */
function loanStartedTimestamp(loan: Loan): number {
  const row = loan.builderImportRow;
  const tryIso = (s: string | undefined) => {
    if (!s?.trim()) return null;
    const t = Date.parse(s.trim());
    return Number.isNaN(t) ? null : t;
  };
  if (row) {
    const app = tryIso(row.APP_DATE);
    if (app != null) return app;
    const agr = tryIso(row.AGR_DTE_T);
    if (agr != null) return agr;
  }
  const milestones = loan.milestones;
  if (milestones?.length) {
    for (const m of milestones) {
      if (/agreement|contract signed|builder contract/i.test(m.label) && m.date && m.date !== '—') {
        const t = Date.parse(String(m.date));
        if (!Number.isNaN(t)) return t;
      }
    }
    for (const m of milestones) {
      const d = m.date != null ? String(m.date) : '';
      if (d && d !== '—' && !/in progress|est\.|pending/i.test(d)) {
        const t = Date.parse(d);
        if (!Number.isNaN(t)) return t;
      }
    }
  }
  return loan.id;
}

function formatDateStartedDisplay(loan: Loan): string {
  const row = loan.builderImportRow;
  const tryIso = (s: string | undefined) => {
    if (!s?.trim()) return null;
    const t = Date.parse(s.trim());
    return Number.isNaN(t) ? null : formatLockDate(s.trim());
  };
  if (row) {
    const fromApp = tryIso(row.APP_DATE);
    if (fromApp) return fromApp;
    const fromAgr = tryIso(row.AGR_DTE_T);
    if (fromAgr) return fromAgr;
  }
  const milestones = loan.milestones;
  if (milestones?.length) {
    for (const m of milestones) {
      if (/agreement|contract signed|builder contract/i.test(m.label) && m.date && m.date !== '—') {
        const t = Date.parse(String(m.date));
        if (!Number.isNaN(t)) return formatLockDate(new Date(t).toISOString().slice(0, 10));
      }
    }
  }
  return '—';
}

function compareLoansForSort(a: Loan, b: Loan, key: LoanSortKey): number {
  switch (key) {
    case 'borrower':
      return a.borrower.localeCompare(b.borrower, undefined, { sensitivity: 'base' });
    case 'dateStarted':
      return loanStartedTimestamp(a) - loanStartedTimestamp(b);
    case 'lender': {
      const la = resolvedPrimaryLenderLabel(a.lender, a.isPreferred, a.builderImportRow);
      const lb = resolvedPrimaryLenderLabel(b.lender, b.isPreferred, b.builderImportRow);
      return la.localeCompare(lb, undefined, { sensitivity: 'base' });
    }
    case 'construction':
      return a.constructionProgress - b.constructionProgress;
    case 'readiness':
      return a.loanPreparedness - b.loanPreparedness;
    case 'nonQmType':
      return (a.nonQMData?.type ?? '').localeCompare(b.nonQMData?.type ?? '', undefined, { sensitivity: 'base' });
    case 'verifiedAssets':
      return (a.nonQMData?.verifiedAssets ?? 0) - (b.nonQMData?.verifiedAssets ?? 0);
    case 'lockExpires': {
      const ta = a.rateLock?.expires ? Date.parse(a.rateLock.expires) : 0;
      const tb = b.rateLock?.expires ? Date.parse(b.rateLock.expires) : 0;
      return ta - tb;
    }
    case 'lockDaysLeft': {
      const da = daysToLockExpiry(a);
      const db = daysToLockExpiry(b);
      return (da ?? 9999) - (db ?? 9999);
    }
    case 'daysToClose':
      return a.daysToClose - b.daysToClose;
    case 'risk':
      return a.riskScore - b.riskScore;
    default:
      return 0;
  }
}

function SortableColumnHeader({
  label,
  columnKey,
  activeKey,
  dir,
  onSort,
  align = 'left',
}: {
  label: string;
  columnKey: LoanSortKey;
  activeKey: LoanSortKey | null;
  dir: 'asc' | 'desc';
  onSort: (k: LoanSortKey) => void;
  align?: 'left' | 'right';
}) {
  const active = activeKey === columnKey;
  return (
    <th className={`px-6 py-3 ${align === 'right' ? 'text-right' : 'text-left'}`}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onSort(columnKey);
        }}
        className={`group inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-[0.05em] text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)] ${
          align === 'right' ? 'ml-auto' : ''
        }`}
      >
        <span>{label}</span>
        {active ? (
          dir === 'asc' ? (
            <ChevronUp className="h-3.5 w-3.5 shrink-0" strokeWidth={2.5} aria-hidden />
          ) : (
            <ChevronDown className="h-3.5 w-3.5 shrink-0" strokeWidth={2.5} aria-hidden />
          )
        ) : (
          <ArrowUpDown className="h-3.5 w-3.5 shrink-0 opacity-35 group-hover:opacity-60" strokeWidth={2.25} aria-hidden />
        )}
      </button>
    </th>
  );
}

interface LoanListProps {
  title: string;
  filterType: 'all' | 'high-risk' | 'expiring' | 'locks-expiring' | 'active' | 'non-qm';
  onBack: () => void;
  onLoanClick: (id: number) => void;
}

export default function LoanList({ title, filterType, onBack, onLoanClick }: LoanListProps) {
  const { allLoans: loans, expiringDocs } = useCohiBuilderPortfolio();
  const [currentPage, setCurrentPage] = React.useState(1);
  const [expandedId, setExpandedId] = React.useState<number | null>(null);
  const [pipelineTab, setPipelineTab] = React.useState<LoanPipelineTabId>('all');
  const [sort, setSort] = React.useState<{ key: LoanSortKey | null; dir: 'asc' | 'desc' }>({
    key: null,
    dir: 'asc',
  });
  const itemsPerPage = 20;

  const tableColSpan =
    8 + (filterType === 'non-qm' ? 2 : 0) + (filterType === 'locks-expiring' ? 1 : 0);

  const filteredLoans = React.useMemo(() => {
    const base = loans.filter((loan) => {
      if (filterType === 'high-risk') return loan.riskLevel === 'High';
      if (filterType === 'expiring') return loan.daysToClose < 60;
      if (filterType === 'locks-expiring') {
        if (!loan.rateLock?.expires) return false;
        const expiresMs = new Date(loan.rateLock.expires).getTime();
        if (Number.isNaN(expiresMs)) return false;
        const days = (expiresMs - Date.now()) / (1000 * 60 * 60 * 24);
        return days >= 0 && days <= 30;
      }
      if (filterType === 'active') return loan.status !== 'Closed';
      if (filterType === 'non-qm') return loan.isNonQM;
      return true;
    });
    if (filterType !== 'active' || pipelineTab === 'all') return base;
    return base.filter((loan) => getLoanPipelineCategory(loan) === pipelineTab);
  }, [loans, filterType, pipelineTab]);

  const pipelineTabCounts = React.useMemo(() => {
    const empty: Record<LoanPipelineTabId, number> = {
      all: 0,
      clearToClose: 0,
      approved: 0,
      conditional: 0,
      locked: 0,
      processing: 0,
      other: 0,
    };
    if (filterType !== 'active') return empty;
    const counts = { ...empty };
    for (const loan of loans) {
      if (loan.status === 'Closed') continue;
      counts.all += 1;
      counts[getLoanPipelineCategory(loan)] += 1;
    }
    return counts;
  }, [loans, filterType]);

  /** Non-empty tabs first (highest count left), then zero-count tabs in default order. */
  const orderedPipelineTabs = React.useMemo(() => {
    const originalIndex = new Map(LOAN_PIPELINE_TABS.map((t, i) => [t.id, i]));
    const enriched = LOAN_PIPELINE_TABS.map((t) => ({
      tab: t,
      count: pipelineTabCounts[t.id],
    }));
    const nonZero = enriched.filter((x) => x.count > 0);
    const zero = enriched.filter((x) => x.count === 0);
    nonZero.sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return (originalIndex.get(a.tab.id) ?? 0) - (originalIndex.get(b.tab.id) ?? 0);
    });
    zero.sort((a, b) => (originalIndex.get(a.tab.id) ?? 0) - (originalIndex.get(b.tab.id) ?? 0));
    return [...nonZero, ...zero].map((x) => x.tab);
  }, [pipelineTabCounts]);

  const toggleSort = React.useCallback((key: LoanSortKey) => {
    setSort((s) =>
      s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' },
    );
  }, []);

  const sortedLoans = React.useMemo(() => {
    if (!sort.key) return filteredLoans;
    const next = [...filteredLoans];
    next.sort((a, b) => {
      const c = compareLoansForSort(a, b, sort.key!);
      return sort.dir === 'asc' ? c : -c;
    });
    return next;
  }, [filteredLoans, sort.key, sort.dir]);

  const totalPages = Math.ceil(sortedLoans.length / itemsPerPage);
  const paginatedLoans = sortedLoans.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  React.useEffect(() => {
    if (filterType !== 'active') setPipelineTab('all');
  }, [filterType]);

  React.useEffect(() => {
    setCurrentPage(1);
    setExpandedId(null);
    setSort({ key: null, dir: 'asc' });
  }, [filterType, pipelineTab]);

  React.useEffect(() => {
    setCurrentPage(1);
    setExpandedId(null);
  }, [sort.key, sort.dir]);

  const isExpiringView = filterType === 'expiring';
  const helocExplain =
    'HELOC is typically secured by the borrower’s existing home and can support a new-build closing (cash-to-close, reserves, carrying costs). It impacts DTI/credit utilization, liquidity/reserves, and the risk of re-qualification changes before closing.';

  const renderExpandedPanel = (loan: Loan) => {
    const lockDays = daysToLockExpiry(loan);
    const ltv = Math.round((loan.loanAmount / loan.propertyValue) * 100);

    if (filterType === 'locks-expiring') {
      return (
        <div className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="rounded-xl border border-amber-200/60 bg-amber-50/50 p-4">
              <p className="text-[10px] font-semibold text-amber-800 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <Lock size={12} /> Rate lock
              </p>
              <p className="text-lg font-semibold text-slate-900">{loan.rateLock?.type || '—'}</p>
              <p className="text-sm text-slate-600 mt-1">Status: <span className="font-medium text-slate-800">{loan.rateLock?.status || '—'}</span></p>
              <p className="text-sm text-slate-600 mt-1">
                Expires: <span className="font-mono font-medium">{loan.rateLock?.expires ? formatLockDate(loan.rateLock.expires) : '—'}</span>
              </p>
              {lockDays != null && (
                <p className={`text-2xl font-bold mt-2 ${lockDays <= 7 ? 'text-rose-600' : lockDays <= 14 ? 'text-amber-700' : 'text-slate-800'}`}>
                  {lockDays} days left
                </p>
              )}
            </div>
            <div className="rounded-xl border border-slate-200/60 bg-white p-4">
              <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-2">Recommended actions</p>
              <ul className="text-sm text-slate-700 space-y-2 list-disc list-inside font-light">
                <li>
                  Confirm extension eligibility with{' '}
                  {lenderMessagingName(loan.lender, loan.builderImportRow)} before expiration.
                </li>
                <li>Align CD timeline with builder completion — delays may require lock extension or renegotiation.</li>
                <li>Refresh credit / income docs if lock extends past 30 days from last pull.</li>
              </ul>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 text-xs text-slate-600">
            <span className="px-2 py-1 rounded-lg bg-slate-100">Est. close: {loan.daysToClose} days</span>
            <span className="px-2 py-1 rounded-lg bg-slate-100">Risk: {loan.riskLevel} ({loan.riskScore})</span>
            <span className="px-2 py-1 rounded-lg bg-slate-100">LO: {displayLoanOfficer(loan)}</span>
          </div>
        </div>
      );
    }

    if (filterType === 'high-risk') {
      return (
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="rounded-xl border border-rose-200/60 bg-rose-50/40 p-4">
            <p className="text-[10px] font-semibold text-rose-800 uppercase tracking-wider mb-2">Qualification risk</p>
            <p className="text-3xl font-bold text-rose-600">{loan.riskScore}</p>
            <p className="text-sm text-slate-700 mt-1">Level: <span className="font-semibold">{loan.riskLevel}</span></p>
            <p className="text-sm text-slate-600 mt-2 font-light leading-relaxed">
              Elevated fallout probability — prioritize outstanding conditions, expiring documents, and lock timeline.
            </p>
            <p className="text-xs text-slate-500 mt-3 font-medium">Loan officer: {displayLoanOfficer(loan)}</p>
          </div>
          <div className="rounded-xl border border-slate-200/60 bg-white p-4">
            <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-2">Loan readiness</p>
            <p className="text-2xl font-semibold text-slate-900">{loan.loanPreparedness}%</p>
            <p className="text-sm text-slate-600 mt-2 font-light">
              Construction {loan.constructionProgress}% complete · {loan.daysToClose} days to targeted delivery.
            </p>
          </div>
        </div>
      );
    }

    return (
      <div className="grid sm:grid-cols-2 gap-4">
        <div className="rounded-xl border border-slate-200/60 bg-white p-4">
          <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-2">Loan & property</p>
          <p className="font-mono text-slate-900 font-medium">
            {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(loan.loanAmount)}
          </p>
          <p className="text-sm text-slate-600 mt-1">LTV {ltv}% · {loan.address}</p>
          <p className="text-xs text-slate-500 mt-2 font-medium">Loan officer: {displayLoanOfficer(loan)}</p>
        </div>
        <div className="rounded-xl border border-slate-200/60 bg-slate-50/50 p-4">
          <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-2">Pipeline</p>
          <p className="text-sm text-slate-700">
            Phase: <span className="font-medium">{loan.status}</span> · Readiness {loan.loanPreparedness}% · Build {loan.constructionProgress}%
          </p>
          {loan.rateLock?.status === 'Locked' && loan.rateLock.expires && (
            <p className="text-sm text-slate-600 mt-2">
              Lock through {formatLockDate(loan.rateLock.expires)}
              {daysToLockExpiry(loan) != null ? ` (${daysToLockExpiry(loan)}d)` : ''}
            </p>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-8">
      <div className="flex items-start sm:items-center gap-3 sm:gap-4">
        <button 
          onClick={onBack}
          className="p-2 hover:bg-white/30 rounded-xl text-slate-600 hover:text-slate-900 transition-colors shrink-0 mt-1 sm:mt-0 glass-panel"
        >
          <ArrowLeft size={20} />
        </button>
        <div className="min-w-0">
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight truncate">{title}</h1>
          <p className="text-slate-500 mt-1 font-medium text-sm sm:text-base truncate">
            {isExpiringView
              ? `Detailed view of ${expiringDocs.length} documents expiring soon across your portfolio.`
              : filterType === 'active'
                ? pipelineTab === 'all'
                  ? `Detailed view of ${filteredLoans.length} active loans. Use pipeline tabs to filter by stage.`
                  : `Showing ${filteredLoans.length} active loan${filteredLoans.length === 1 ? '' : 's'} in ${LOAN_PIPELINE_TABS.find((t) => t.id === pipelineTab)?.label ?? 'this stage'}.`
                : `Detailed view of ${filteredLoans.length} loans matching criteria.`}
          </p>
        </div>
      </div>

      {!isExpiringView && filterType === 'active' && (
        <div
          role="tablist"
          aria-label="Loan pipeline stage"
          className="flex flex-wrap gap-1.5 sm:gap-2 overflow-x-auto pb-1 -mx-1 px-1 [scrollbar-width:thin]"
        >
          {orderedPipelineTabs.map(({ id, label, shortLabel }) => {
            const count = pipelineTabCounts[id];
            const selected = pipelineTab === id;
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setPipelineTab(id)}
                className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors text-[var(--text-secondary)] ${
                  selected
                    ? 'border-[var(--brand-primary)] bg-[var(--brand-primary)]/14 dark:bg-[var(--brand-primary)]/22 shadow-sm'
                    : 'border-[var(--border-subtle)] bg-[var(--bg-surface)] hover:border-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/60'
                }`}
              >
                <span className="hidden sm:inline">{label}</span>
                <span className="sm:hidden">{shortLabel ?? label}</span>
                {id === 'all' ? (
                  <span className="ml-1.5 tabular-nums opacity-90">({count})</span>
                ) : (
                  <span className="ml-1.5 tabular-nums opacity-70">({count})</span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {isExpiringView ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {expiringDocs.map((doc, index) => (
            <motion.div
              key={doc.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1 }}
              onClick={() => onLoanClick(doc.loanId)}
              className="card-base p-6 hover:shadow-[0_8px_30_rgba(0,0,0,0.04)] hover:border-slate-200 transition-all duration-300 cursor-pointer group"
            >
              <div className="flex items-center justify-between mb-4">
                <div className={`p-3 rounded-xl ${
                  doc.status === 'critical' ? 'bg-rose-50 text-rose-600' : 
                  doc.status === 'warning' ? 'bg-amber-50 text-amber-600' : 'bg-emerald-50 text-emerald-600'
                }`}>
                  <Calendar size={24} />
                </div>
                <div className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                  doc.status === 'critical' ? 'bg-rose-100 text-rose-700' : 
                  doc.status === 'warning' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'
                }`}>
                  {doc.status}
                </div>
              </div>
              <h3 className="text-lg font-bold text-slate-900 mb-1">{doc.type}</h3>
              <p className="text-sm text-slate-600 mb-4">Borrower: <span className="font-semibold text-slate-900">{anonymizeBorrowerName(doc.borrower)}</span></p>
              
              <div className="flex items-center justify-between p-3 rounded-xl border border-white/50 bg-white/25 backdrop-blur-sm">
                <div className="flex items-center gap-2">
                  <Clock size={14} className="text-[var(--text-secondary)]" />
                  <span className="text-xs font-bold text-slate-600 uppercase tracking-wider">Expires In</span>
                </div>
                <span className={`text-lg font-extrabold ${
                  doc.status === 'critical' ? 'text-rose-600' : doc.status === 'warning' ? 'text-amber-600' : 'text-emerald-600'
                }`}>
                  {doc.days} Days
                </span>
              </div>
              
              <div className="mt-4 flex items-center justify-between text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                <span>Date: {doc.expires}</span>
                <span className="flex items-center gap-1 text-blue-600 group-hover:translate-x-1 transition-transform">
                  View Loan <ChevronRight size={12} />
                </span>
              </div>
            </motion.div>
          ))}
        </div>
      ) : (
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="card-base overflow-hidden"
        >
          <div className="md:hidden flex flex-wrap items-center gap-2 px-4 pt-4 pb-2 border-b border-[var(--border-subtle)]">
            <label htmlFor="loan-list-sort-mobile" className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
              Sort by
            </label>
            <select
              id="loan-list-sort-mobile"
              value={sort.key ?? ''}
              onChange={(e) => {
                const v = e.target.value as LoanSortKey | '';
                if (!v) setSort({ key: null, dir: 'asc' });
                else setSort({ key: v, dir: 'asc' });
              }}
              className="flex-1 min-w-[10rem] rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 py-1.5 text-sm text-[var(--text-primary)]"
            >
              <option value="">Default order</option>
              <option value="dateStarted">Date started</option>
              <option value="borrower">Borrower</option>
              <option value="lender">Lender</option>
              <option value="construction">Build progress</option>
              <option value="readiness">Loan readiness</option>
              {filterType === 'locks-expiring' ? (
                <>
                  <option value="lockExpires">Lock expiration</option>
                  <option value="lockDaysLeft">Days to lock expiry</option>
                </>
              ) : (
                <option value="daysToClose">Days until delivery</option>
              )}
              <option value="risk">Risk score</option>
              {filterType === 'non-qm' && (
                <>
                  <option value="nonQmType">Non-QM type</option>
                  <option value="verifiedAssets">Verified assets</option>
                </>
              )}
            </select>
            <button
              type="button"
              disabled={!sort.key}
              onClick={() => setSort((s) => (s.key ? { ...s, dir: s.dir === 'asc' ? 'desc' : 'asc' } : s))}
              className="shrink-0 rounded-lg border border-[var(--border-subtle)] px-2.5 py-1.5 text-xs font-semibold text-[var(--text-secondary)] disabled:opacity-40"
            >
              {sort.dir === 'asc' ? 'Asc' : 'Desc'}
            </button>
          </div>
          <div className="overflow-x-auto hidden md:block">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-[var(--bg-surface)] border-b border-[var(--border-subtle)]">
                  <th className="px-3 py-3 w-11 text-right text-xs font-semibold uppercase tracking-[0.05em] text-[var(--text-secondary)]">
                    #
                  </th>
                  <SortableColumnHeader
                    label="Date started"
                    columnKey="dateStarted"
                    activeKey={sort.key}
                    dir={sort.dir}
                    onSort={toggleSort}
                  />
                  <SortableColumnHeader
                    label="Property & Buyer"
                    columnKey="borrower"
                    activeKey={sort.key}
                    dir={sort.dir}
                    onSort={toggleSort}
                  />
                  <SortableColumnHeader
                    label="Lender & Source"
                    columnKey="lender"
                    activeKey={sort.key}
                    dir={sort.dir}
                    onSort={toggleSort}
                  />
                  <SortableColumnHeader
                    label="Build Progress"
                    columnKey="construction"
                    activeKey={sort.key}
                    dir={sort.dir}
                    onSort={toggleSort}
                  />
                  <SortableColumnHeader
                    label="Loan Readiness"
                    columnKey="readiness"
                    activeKey={sort.key}
                    dir={sort.dir}
                    onSort={toggleSort}
                  />
                  {filterType === 'non-qm' && (
                    <>
                      <SortableColumnHeader
                        label="Non-QM Type"
                        columnKey="nonQmType"
                        activeKey={sort.key}
                        dir={sort.dir}
                        onSort={toggleSort}
                      />
                      <SortableColumnHeader
                        label="Verified Assets"
                        columnKey="verifiedAssets"
                        activeKey={sort.key}
                        dir={sort.dir}
                        onSort={toggleSort}
                      />
                    </>
                  )}
                  {filterType === 'locks-expiring' ? (
                    <>
                      <SortableColumnHeader
                        label="Lock expiration"
                        columnKey="lockExpires"
                        activeKey={sort.key}
                        dir={sort.dir}
                        onSort={toggleSort}
                      />
                      <SortableColumnHeader
                        label="Days to lock expiry"
                        columnKey="lockDaysLeft"
                        activeKey={sort.key}
                        dir={sort.dir}
                        onSort={toggleSort}
                      />
                    </>
                  ) : (
                    <SortableColumnHeader
                      label="Days Until Delivery"
                      columnKey="daysToClose"
                      activeKey={sort.key}
                      dir={sort.dir}
                      onSort={toggleSort}
                    />
                  )}
                  <th className="px-6 py-3 text-right text-xs font-semibold uppercase tracking-[0.05em] text-[var(--text-secondary)]">
                    Details
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200/50">
                {paginatedLoans.map((loan, rowIndex) => {
                  const pipelineStageLabel =
                    filterType === 'active'
                      ? (LOAN_PIPELINE_TABS.find((t) => t.id === getLoanPipelineCategory(loan))?.label ?? 'Other')
                      : null;
                  const rowNum = (currentPage - 1) * itemsPerPage + rowIndex + 1;
                  return (
                  <React.Fragment key={loan.id}>
                  <tr 
                    onClick={() => setExpandedId((id) => (id === loan.id ? null : loan.id))}
                    className={`hover:bg-slate-50/80 transition-colors cursor-pointer group ${
                      expandedId === loan.id ? 'bg-slate-50/90' : 'bg-white/40'
                    }`}
                  >
                    <td className="px-3 py-3 w-11 align-top text-right text-sm font-semibold tabular-nums text-[var(--text-secondary)]">
                      {rowNum}.
                    </td>
                    <td className="px-4 py-3 align-top text-xs font-mono text-slate-700 dark:text-slate-300 whitespace-nowrap">
                      {formatDateStartedDisplay(loan)}
                    </td>
                    <td className="px-6 py-3">
                      <p className="font-semibold text-[var(--text-primary)]">{anonymizeBorrowerName(loan.borrower)}</p>
                      <p className="text-xs text-[var(--text-secondary)] mt-0.5">Loan ID: CP-2026-{loan.id}00</p>
                      {pipelineStageLabel && (
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-sky-700/90 dark:text-sky-400/90 mt-1">
                          {pipelineStageLabel}
                        </p>
                      )}
                      {loan.isHeloc && (
                        <div className="mt-1">
                          <Tooltip text={helocExplain}>
                            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-semibold tracking-wide bg-blue-50/70 text-blue-700 border border-blue-200/50">
                              HELOC (existing home)
                            </span>
                          </Tooltip>
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-3 align-top">
                      {!loan.isPreferred ? (
                        <div className="flex items-start gap-2 min-w-0 max-w-[16rem]">
                          <span className="mt-0.5 shrink-0 inline-flex items-center rounded-md bg-slate-500/[0.09] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-600 ring-1 ring-slate-500/10 dark:bg-slate-500/15 dark:text-slate-300 dark:ring-slate-500/25">
                            Ext
                          </span>
                          <p
                            className="min-w-0 text-sm font-semibold leading-snug text-[var(--text-primary)] line-clamp-2"
                            title={resolvedLenderTitle(loan.lender, false, loan.builderImportRow)}
                          >
                            {resolvedPrimaryLenderLabel(loan.lender, false, loan.builderImportRow)}
                          </p>
                        </div>
                      ) : (
                        <p
                          className="text-sm font-semibold leading-snug text-[var(--text-primary)] line-clamp-2 max-w-[16rem]"
                          title={resolvedLenderTitle(loan.lender, true, loan.builderImportRow)}
                        >
                          {resolvedPrimaryLenderLabel(loan.lender, true, loan.builderImportRow)}
                        </p>
                      )}
                      <p className="text-[11px] text-[var(--text-secondary)] mt-1.5 font-medium">
                        Source: {loan.sourceType ?? '—'}
                      </p>
                      <p className="text-[11px] text-[var(--text-secondary)] mt-1">
                        <span className="font-semibold text-[var(--text-primary)]/80">LO</span>{' '}
                        {displayLoanOfficer(loan)}
                      </p>
                    </td>
                    <td className="px-6 py-3">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-1.5 bg-slate-100 rounded-full max-w-[60px] overflow-hidden">
                          <div 
                            className="h-full bg-amber-500 rounded-full"
                            style={{ width: `${loan.constructionProgress}%` }}
                          />
                        </div>
                        <span className="text-xs font-semibold text-slate-700">{loan.constructionProgress}%</span>
                      </div>
                    </td>
                    <td className="px-6 py-3">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-1.5 bg-slate-100 rounded-full max-w-[60px] overflow-hidden">
                          <div 
                            className="h-full bg-emerald-500 rounded-full"
                            style={{ width: `${loan.loanPreparedness}%` }}
                          />
                        </div>
                        <span className="text-xs font-semibold text-slate-700">{loan.loanPreparedness}%</span>
                      </div>
                    </td>
                    {filterType === 'non-qm' && (
                      <>
                        <td className="px-6 py-3">
                          <p className="text-sm font-medium text-[var(--text-primary)]">{loan.nonQMData?.type || 'N/A'}</p>
                        </td>
                        <td className="px-6 py-3">
                          <p className="text-sm font-medium text-[var(--text-primary)] font-mono">
                            {loan.nonQMData?.verifiedAssets ? `$${(loan.nonQMData.verifiedAssets / 1000000).toFixed(1)}M` : 'N/A'}
                          </p>
                        </td>
                      </>
                    )}
                    {filterType === 'locks-expiring' ? (
                      <>
                        <td className="px-6 py-3 text-sm font-mono text-slate-800">
                          {loan.rateLock?.expires ? formatLockDate(loan.rateLock.expires) : '—'}
                        </td>
                        <td className="px-6 py-3">
                          {(() => {
                            const d = daysToLockExpiry(loan);
                            if (d == null) return <span className="text-sm text-slate-500">—</span>;
                            return (
                              <span
                                className={`text-sm font-mono font-semibold ${
                                  d <= 7 ? 'text-rose-600' : d <= 14 ? 'text-amber-600' : 'text-slate-800'
                                }`}
                              >
                                {d}d
                              </span>
                            );
                          })()}
                        </td>
                      </>
                    ) : (
                      <td className="px-6 py-3 text-sm text-slate-900 font-mono font-medium">{loan.daysToClose}d</td>
                    )}
                    <td className="px-6 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-0.5">
                        <button
                          type="button"
                          title={expandedId === loan.id ? 'Hide details' : 'Show details'}
                          onClick={() => setExpandedId((id) => (id === loan.id ? null : loan.id))}
                          className="p-2 text-slate-500 hover:text-slate-800 rounded-lg hover:bg-slate-100 transition-colors"
                        >
                          <ChevronDown size={18} className={expandedId === loan.id ? 'rotate-180 transition-transform' : 'transition-transform'} />
                        </button>
                        <button
                          type="button"
                          title="Open full loan"
                          onClick={(e) => {
                            e.stopPropagation();
                            setExpandedId(null);
                            onLoanClick(loan.id);
                          }}
                          className="p-2 text-slate-500 hover:text-blue-600 rounded-lg hover:bg-slate-100 transition-colors"
                        >
                          <ExternalLink size={18} />
                        </button>
                      </div>
                    </td>
                  </tr>
                  <AnimatePresence initial={false}>
                    {expandedId === loan.id && (
                      <tr key={`exp-${loan.id}`}>
                        <td colSpan={tableColSpan} className="p-0 border-b border-slate-200/60 align-top">
                          {/*
                            Avoid height + overflow:hidden on the motion wrapper — it breaks pointer events
                            for buttons in some browsers after height:auto animation.
                          */}
                          <motion.div
                            initial={{ opacity: 0, y: -8 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -8 }}
                            transition={{ duration: 0.2 }}
                            className="relative z-[1]"
                          >
                            <div className="px-6 py-5 bg-[var(--bg-muted)]/95 border-t border-[var(--border-subtle)]">
                              {renderExpandedPanel(loan)}
                              <div
                                className="mt-5 flex flex-wrap gap-2 justify-end relative z-[2]"
                                onClick={(e) => e.stopPropagation()}
                                onPointerDown={(e) => e.stopPropagation()}
                              >
                                <button
                                  type="button"
                                  onClick={() => setExpandedId(null)}
                                  className="px-4 py-2 text-sm font-medium text-[var(--text-secondary)] rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] hover:bg-[var(--bg-muted)]"
                                >
                                  Close
                                </button>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    setExpandedId(null);
                                    onLoanClick(loan.id);
                                  }}
                                  className="px-4 py-2 text-sm font-medium text-white rounded-lg btn-primary inline-flex items-center gap-2 cursor-pointer"
                                >
                                  Open full loan profile
                                  <ChevronRight size={16} />
                                </button>
                              </div>
                            </div>
                          </motion.div>
                        </td>
                      </tr>
                    )}
                  </AnimatePresence>
                  </React.Fragment>
                );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile Card View */}
          <div className="md:hidden divide-y divide-[var(--border-subtle)]">
            {paginatedLoans.map((loan, rowIndex) => {
              const lockDaysLeft = daysToLockExpiry(loan);
              const pipelineCat = filterType === 'active' ? getLoanPipelineCategory(loan) : null;
              const pipelineMeta = pipelineCat
                ? LOAN_PIPELINE_TABS.find((t) => t.id === pipelineCat)
                : undefined;
              const rowNum = (currentPage - 1) * itemsPerPage + rowIndex + 1;
              return (
              <div key={loan.id} className="bg-[var(--bg-surface)]">
                <button
                  type="button"
                  onClick={() => setExpandedId((id) => (id === loan.id ? null : loan.id))}
                  className="w-full text-left p-4 hover:bg-[var(--bg-muted)]/80 transition-colors cursor-pointer"
                >
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <p className="text-xs font-semibold text-[var(--text-secondary)] tabular-nums">
                        {rowNum}. · Started {formatDateStartedDisplay(loan)}
                      </p>
                      <p className="font-bold text-[var(--text-primary)] mt-1">{anonymizeBorrowerName(loan.borrower)}</p>
                      <p className="text-[10px] text-[var(--text-secondary)] uppercase tracking-wider">ID: CP-2026-{loan.id}00</p>
                      {pipelineMeta && (
                        <p className="text-[10px] font-semibold text-sky-700 dark:text-sky-400 mt-1">
                          {pipelineMeta.shortLabel ?? pipelineMeta.label}
                        </p>
                      )}
                      {loan.isHeloc && (
                        <div className="mt-1">
                          <Tooltip text={helocExplain}>
                            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-semibold tracking-wide bg-blue-50/70 text-blue-700 border border-blue-200/50">
                              HELOC (existing home)
                            </span>
                          </Tooltip>
                        </div>
                      )}
                      <div className="mt-1.5 flex items-start gap-2 min-w-0">
                        {!loan.isPreferred ? (
                          <span className="mt-0.5 shrink-0 rounded-md bg-slate-500/[0.09] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-slate-600 ring-1 ring-slate-500/10 dark:bg-slate-500/15 dark:text-slate-300">
                            Ext
                          </span>
                        ) : null}
                        <p
                          className="text-[11px] text-[var(--text-secondary)] line-clamp-2 min-w-0"
                          title={resolvedLenderTitle(loan.lender, loan.isPreferred, loan.builderImportRow)}
                        >
                          <span className="font-medium text-[var(--text-primary)]">
                            {resolvedPrimaryLenderLabel(loan.lender, loan.isPreferred, loan.builderImportRow)}
                          </span>
                          {' · '}
                          {loan.sourceType ?? '—'}
                        </p>
                      </div>
                      <p className="text-[11px] text-[var(--text-secondary)] mt-0.5">
                        LO {displayLoanOfficer(loan)}
                      </p>
                    </div>
                    <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                      loan.riskLevel === 'Low' ? 'bg-emerald-100 text-emerald-700' :
                      loan.riskLevel === 'Medium' ? 'bg-amber-100 text-amber-700' :
                      'bg-rose-100 text-rose-700'
                    }`}>
                      {loan.riskLevel} Risk
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-4 my-3 text-xs">
                    <div>
                      <p className="text-[var(--text-secondary)] mb-0.5">Build Progress</p>
                      <p className="font-semibold text-amber-600 font-mono">{loan.constructionProgress}%</p>
                    </div>
                    <div>
                      <p className="text-[var(--text-secondary)] mb-0.5">Loan Readiness</p>
                      <p className="font-semibold text-emerald-600 font-mono">{loan.loanPreparedness}%</p>
                    </div>
                    {filterType === 'locks-expiring' ? (
                      <>
                        <div>
                          <p className="text-[var(--text-secondary)] mb-0.5">Lock expires</p>
                          <p className="font-semibold text-[var(--text-primary)] font-mono">
                            {loan.rateLock?.expires ? formatLockDate(loan.rateLock.expires) : '—'}
                          </p>
                        </div>
                        <div>
                          <p className="text-[var(--text-secondary)] mb-0.5">Days to lock expiry</p>
                          <p
                            className={`font-semibold font-mono ${
                              lockDaysLeft == null
                                ? 'text-[var(--text-secondary)]'
                                : lockDaysLeft <= 7
                                  ? 'text-rose-600'
                                  : lockDaysLeft <= 14
                                    ? 'text-amber-600'
                                    : 'text-[var(--text-primary)]'
                            }`}
                          >
                            {lockDaysLeft != null ? `${lockDaysLeft}d` : '—'}
                          </p>
                        </div>
                      </>
                    ) : (
                      <div>
                        <p className="text-[var(--text-secondary)] mb-0.5">Closing In</p>
                        <p className="font-semibold text-[var(--text-primary)] font-mono">{loan.daysToClose} days</p>
                      </div>
                    )}
                    <div>
                      <p className="text-[var(--text-secondary)] mb-0.5">Risk Score</p>
                      <p className="font-semibold text-[var(--text-primary)] font-mono">{loan.riskScore}/100</p>
                    </div>
                  </div>

                  <div className="flex items-center justify-end gap-2 pt-2 border-t border-[var(--border-subtle)] text-[var(--text-secondary)] text-xs font-semibold">
                    <ChevronDown size={16} className={expandedId === loan.id ? 'rotate-180 transition-transform' : 'transition-transform'} />
                    {expandedId === loan.id ? 'Hide details' : 'Tap for details'}
                  </div>
                </button>

                <AnimatePresence initial={false}>
                  {expandedId === loan.id && (
                    <motion.div
                      key={`mob-exp-${loan.id}`}
                      initial={{ opacity: 0, y: -8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -8 }}
                      transition={{ duration: 0.2 }}
                      className="border-t border-[var(--border-subtle)] relative z-[1]"
                    >
                      <div className="px-4 py-4 bg-[var(--bg-muted)]/90">
                        {renderExpandedPanel(loan)}
                        <div
                          className="mt-4 flex flex-col gap-2"
                          onClick={(e) => e.stopPropagation()}
                          onPointerDown={(e) => e.stopPropagation()}
                        >
                          <button
                            type="button"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setExpandedId(null);
                              onLoanClick(loan.id);
                            }}
                            className="w-full py-2.5 text-sm font-medium text-white rounded-lg btn-primary inline-flex items-center justify-center gap-2 cursor-pointer"
                          >
                            Open full loan profile
                            <ExternalLink size={16} />
                          </button>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
            })}
          </div>

          {/* Pagination Controls */}
          {totalPages > 1 && (
            <div className="px-4 sm:px-6 py-4 border-t border-[var(--border-subtle)] flex flex-col sm:flex-row items-center justify-between gap-4 bg-[var(--bg-surface)]">
              <div className="text-sm text-[var(--text-secondary)]">
                Showing <span className="font-medium text-[var(--text-primary)]">{(currentPage - 1) * itemsPerPage + 1}</span> to <span className="font-medium text-[var(--text-primary)]">{Math.min(currentPage * itemsPerPage, sortedLoans.length)}</span> of <span className="font-medium text-[var(--text-primary)]">{sortedLoans.length}</span> results
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="p-2 rounded-lg border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronLeft size={18} />
                </button>
                <div className="flex items-center gap-1">
                  {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                    let pageNum = i + 1;
                    if (totalPages > 5) {
                      if (currentPage > 3) {
                        pageNum = currentPage - 2 + i;
                      }
                      if (pageNum > totalPages) {
                        pageNum = totalPages - (4 - i);
                      }
                    }
                    return (
                      <button
                        key={pageNum}
                        onClick={() => setCurrentPage(pageNum)}
                        className={`w-8 h-8 rounded-lg text-sm font-medium transition-colors ${
                          currentPage === pageNum
                            ? 'bg-[var(--brand-primary)] text-white'
                            : 'text-[var(--text-secondary)] hover:bg-slate-50'
                        }`}
                      >
                        {pageNum}
                      </button>
                    );
                  })}
                </div>
                <button
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  className="p-2 rounded-lg border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronRight size={18} />
                </button>
              </div>
            </div>
          )}
        </motion.div>
      )}
    </div>
  );
}
