import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Calendar, 
  Clock, 
  ShieldAlert, 
  CreditCard, 
  Info,
  HardHat,
  CheckCircle2,
  AlertCircle,
  FileText,
  AlertTriangle,
  ArrowLeft,
  MapPin,
  DollarSign,
  Crown,
  Wallet,
  X,
  ChevronRight,
  Lock,
} from 'lucide-react';
import Tooltip from './Tooltip';
import { useCohiBuilderPortfolio } from '../contexts/CohiBuilderPortfolioContext';
import { findLoanForNavId } from '../lib/resolveLoanNav';
import {
  anonymizeBorrowerName,
  anonymizeImportKvPersonName,
  displayLoanOfficer,
  formatErpBdmDisplayLine,
} from '../lib/borrowerPrivacy';

type DrilldownCard =
  | 'loan-amount'
  | 'import-dates'
  | 'bdm-import'
  | 'rate-lock'
  | 'incentives'
  | 'construction'
  | 'preparedness'
  | 'expiration'
  | 'risk'
  | 'assets'
  | null;

import type { CohiPortfolioLoan, CohiPortfolioBundle } from '../data/portfolioFromBuilderImport';
import { BUILDER_IMPORT_FIELDS, type BuilderImportRow } from '../data/builderImportFields';

type PortfolioLoan = CohiPortfolioLoan;
type RiskFactorRow = CohiPortfolioBundle['riskFactors'][number];

type ImportTimelineItem = { key: string; label: string; value: string; note?: string };

function daysToLockExpiry(loan: PortfolioLoan): number | null {
  if (!loan.rateLock?.expires) return null;
  const ms = new Date(loan.rateLock.expires).getTime();
  if (Number.isNaN(ms)) return null;
  return Math.ceil((ms - Date.now()) / (1000 * 60 * 60 * 24));
}

function formatShortDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return iso;
  }
}

/** Human-readable incentive type (import pipeline used to store `TotalIncentive` as the type string). */
function displayIncentiveType(type: string | undefined): string {
  if (!type || type === 'None') return 'None';
  if (type === 'TotalIncentive' || type === 'Total Incentive') return 'Total Incentive';
  return type;
}

function importCellDisplay(row: BuilderImportRow | undefined, key: string): string {
  if (!row) return '—';
  const raw = row[key];
  if (raw == null || String(raw).trim() === '') return '—';
  return String(raw).trim();
}

function importDateCellDisplay(row: BuilderImportRow | undefined, key: string): string {
  const raw = importCellDisplay(row, key);
  if (raw === '—') return '—';
  const t = Date.parse(raw);
  if (!Number.isNaN(t)) return formatShortDate(new Date(t).toISOString().slice(0, 10));
  return raw;
}

function importTimelineItems(loan: PortfolioLoan): ImportTimelineItem[] {
  const row = loan.builderImportRow;
  if (!row) {
    return [
      {
        key: 'no-import',
        label: 'Spreadsheet dates',
        value: '—',
        note: 'Demo loan only — import a backlog file to show AGR_DTE_T, APP_DATE, PRJ_STL_D, and LOCKED from columns.',
      },
    ];
  }
  const items: ImportTimelineItem[] = [
    { key: 'agr', label: 'Agreement (AGR_DTE_T)', value: importDateCellDisplay(row, 'AGR_DTE_T') },
    { key: 'app', label: 'Application (APP_DATE)', value: importDateCellDisplay(row, 'APP_DATE') },
    {
      key: 'prj',
      label: 'Projected close (PRJ_STL_D)',
      value: importDateCellDisplay(row, 'PRJ_STL_D'),
      note:
        loan.daysToClose != null && !Number.isNaN(loan.daysToClose)
          ? `${loan.daysToClose} days from today vs that date (app calculation)`
          : undefined,
    },
    { key: 'lck', label: 'Lock date in file (LOCKED)', value: importDateCellDisplay(row, 'LOCKED') },
  ];
  if (importCellDisplay(row, 'Cancdt_2') !== '—') {
    items.push({ key: 'cxl', label: 'Canceled (Cancdt_2)', value: importDateCellDisplay(row, 'Cancdt_2') });
  }
  return items.slice(0, 5);
}

function importFieldMeaning(fieldId: string): string {
  return BUILDER_IMPORT_FIELDS.find((f) => f.id === fieldId)?.meaning ?? '';
}

/** Person-like spreadsheet cells: abbreviate surname (e.g. S.); mask given names. */
const IMPORT_PRIVACY_NAME_KEYS = new Set(['P_Div_VP', 'BDM_Name', 'TMName']);

function ImportKvTable({
  row,
  entries,
}: {
  row: BuilderImportRow;
  entries: { label: string; key: string }[];
}) {
  return (
    <div className="rounded-xl border border-slate-200/60 dark:border-slate-700 overflow-hidden divide-y divide-slate-200/60 dark:divide-slate-700">
      {entries.map(({ label, key }) => {
        const raw = row[key];
        const v = raw != null && String(raw).trim() !== '' ? String(raw).trim() : '—';
        const display =
          IMPORT_PRIVACY_NAME_KEYS.has(key) && v !== '—' ? anonymizeImportKvPersonName(String(raw).trim()) : v;
        return (
          <div
            key={`${label}-${key}`}
            className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-1 py-4 px-5 bg-slate-50/50 dark:bg-slate-800/30"
          >
            <span className="text-sm text-slate-600 dark:text-slate-400 font-light shrink-0">{label}</span>
            <span className="font-medium text-sm text-slate-900 dark:text-slate-100 text-right break-words sm:max-w-[min(100%,16rem)]">
              {display}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** Fields from the builder spreadsheet shown in loan drilldowns (no fabricated marketing copy). */
const IMPORT_INCENTIVE_FIELDS: { label: string; key: string }[] = [
  { label: 'Total Incentive (cell)', key: 'TotalIncentive' },
  { label: 'P_Name', key: 'P_Name' },
  { label: 'Project Number', key: 'Project Number' },
  { label: 'Business_U', key: 'Business_U' },
  { label: 'Loan_Type', key: 'Loan_Type' },
  { label: 'Capture_Indicator', key: 'Capture_Indicator' },
  { label: 'Capture_Lost_Reason', key: 'Capture_Lost_Reason' },
  { label: 'Capture_Lost_Comment', key: 'Capture_Lost_Comment' },
];

const IMPORT_LOAN_AMOUNT_FIELDS: { label: string; key: string }[] = [
  { label: 'LoanAmount', key: 'LoanAmount' },
  { label: 'Loanno', key: 'Loanno' },
  { label: 'Loan_Type', key: 'Loan_Type' },
  { label: 'Origination_Status', key: 'Origination_Status' },
  { label: 'External_Lender', key: 'External_Lender' },
  { label: 'PRJ_STL_D', key: 'PRJ_STL_D' },
  { label: 'AGR_DTE_T', key: 'AGR_DTE_T' },
  { label: 'TBI_State', key: 'TBI_State' },
];

const IMPORT_BDM_FIELDS: { label: string; key: string }[] = [
  { label: 'P_Div_VP', key: 'P_Div_VP' },
  { label: 'BDM_Name', key: 'BDM_Name' },
  { label: 'BDM_Num', key: 'BDM_Num' },
  { label: 'MLS_Num', key: 'MLS_Num' },
  { label: 'TMName', key: 'TMName' },
  { label: 'Business Unit', key: 'Business Unit' },
];

const IMPORT_LOCK_FIELDS: { label: string; key: string }[] = [
  { label: 'LOCKED', key: 'LOCKED' },
  { label: 'REF_LOAN_IND', key: 'REF_LOAN_IND' },
];

const IMPORT_DATES_SITE_FIELDS: { label: string; key: string }[] = [
  { label: 'PRJ_STL_D', key: 'PRJ_STL_D' },
  { label: 'AGR_DTE_T', key: 'AGR_DTE_T' },
  { label: 'APP_DATE', key: 'APP_DATE' },
  { label: 'LOCKED', key: 'LOCKED' },
  { label: 'Cancdt_2', key: 'Cancdt_2' },
  { label: 'P_Name', key: 'P_Name' },
  { label: 'Project Number', key: 'Project Number' },
  { label: 'TBI_State', key: 'TBI_State' },
];

const IMPORT_CAPTURE_FIELDS: { label: string; key: string }[] = [
  { label: 'Capture_Indicator', key: 'Capture_Indicator' },
  { label: 'Capture_Lost_Reason', key: 'Capture_Lost_Reason' },
  { label: 'Capture_Lost_Comment', key: 'Capture_Lost_Comment' },
  { label: 'Capture_Lost_Cmnt_By', key: 'Capture_Lost_Cmnt_By' },
];

const IMPORT_LENDER_PROGRAM_FIELDS: { label: string; key: string }[] = [
  { label: 'External_Lender', key: 'External_Lender' },
  { label: 'Loan_Type', key: 'Loan_Type' },
  { label: 'REF_LOAN_IND', key: 'REF_LOAN_IND' },
  { label: 'Origination_Status', key: 'Origination_Status' },
];

const IMPORT_ORIGINATION_FIELDS: { label: string; key: string }[] = [
  { label: 'Origination_Status', key: 'Origination_Status' },
  { label: 'Loan_Type', key: 'Loan_Type' },
  { label: 'Loanno', key: 'Loanno' },
];

interface LoanDetailProps {
  loanId: number | null;
  onBack: () => void;
  onViewRisk: (id: number) => void;
  onViewHeloc: (id: number) => void;
}

const drilldownCardStyles =
  'cursor-pointer transition-all group hover:!translate-y-0 hover:shadow-[0_12px_40px_-12px_rgba(15,23,42,0.12)] hover:border-white/80 dark:hover:border-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/35';

const LOAN_DRILLDOWN_HINTS = {
  loanAmount:
    'Click to open a panel with import-backed loan amount, loan number, type, origination status, lender, and key dates.',
  importDates:
    'Click for projected close plus agreement, application, and lock dates with site fields from your spreadsheet.',
  bdmImport:
    'Click for BDM, division VP, MLS, and team columns exactly as they appear in the uploaded file.',
  rateLock:
    'Click for LOCKED and REF_LOAN_IND values with short field definitions from the import spec.',
  incentives:
    'Click for incentive totals and capture lost-reason / comment columns from the import row.',
  construction:
    'Click for origination status, loan type, and program context pulled from the spreadsheet.',
  preparedness:
    'Click for capture indicator, lost reason, and related checklist-style columns in a detail panel.',
  expirationTile:
    'Click for the full key-dates breakdown with a short meaning for each spreadsheet column.',
  risk:
    'Click for pipeline risk factors and the demo fallout-style readout for this loan.',
  assets:
    'Click for external lender, loan type, and referral (REF_LOAN_IND) — balances are not in the standard import.',
} as const;

export default function LoanDetail({ loanId, onBack, onViewRisk, onViewHeloc }: LoanDetailProps) {
  const { allLoans: loans, riskFactors } = useCohiBuilderPortfolio();
  const loan = useMemo(() => findLoanForNavId(loans, loanId), [loans, loanId]);
  const [drilldown, setDrilldown] = useState<DrilldownCard>(null);

  const riskDetail = useMemo(
    () => (loan ? riskFactors.find((r) => r.loanId === loan.id) : undefined),
    [loan, riskFactors],
  );
  const timelineItems = useMemo(() => (loan ? importTimelineItems(loan) : []), [loan]);
  const lockDaysRemaining = loan ? daysToLockExpiry(loan) : null;

  if (!loan) {
    return (
      <div className="card-base rounded-2xl p-8 sm:p-10 text-center space-y-4 max-w-lg mx-auto">
        <p className="text-lg font-semibold text-slate-900 dark:text-slate-100">Loan not in portfolio</p>
        <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
          {loanId != null ? (
            <>
              No loan matches id <span className="tabular-nums font-medium text-slate-800 dark:text-slate-200">{loanId}</span>{' '}
              (internal id or LOS loan number from your import). Upload the file that contains this loan or open it from
              All Loans.
            </>
          ) : (
            <>Open a loan from the dashboard or loan list.</>
          )}
        </p>
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl btn-primary text-sm font-semibold"
        >
          <ArrowLeft size={16} />
          Back
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header & Property Hero */}
      <div className="card-base relative rounded-3xl overflow-hidden min-h-[280px] md:min-h-[300px] md:h-[320px] group hover:!translate-y-0">
        <img 
          src={loan.propertyImage} 
          alt="Property" 
          className="absolute inset-0 w-full h-full object-cover opacity-25 dark:opacity-20 group-hover:scale-[1.03] transition-transform duration-1400"
          referrerPolicy="no-referrer"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-white/95 via-white/55 to-white/10 dark:from-slate-950/95 dark:via-slate-900/55" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_10%,rgba(59,130,246,0.14),transparent_55%),radial-gradient(circle_at_80%_80%,rgba(34,211,238,0.12),transparent_50%)]" />
        
        <div className="relative p-5 sm:p-6 flex flex-col h-full justify-between min-h-[inherit]">
          <div className="flex items-start justify-between gap-4">
            <button 
              onClick={onBack}
              type="button"
              className="p-2.5 glass-panel rounded-2xl text-slate-800 dark:text-slate-100 hover:bg-white/50 dark:hover:bg-slate-800/80 transition-all shadow-sm"
              title="Back to list"
            >
              <ArrowLeft size={18} />
            </button>
            
            <div className="flex flex-wrap justify-end gap-2">
              {loan.isPreferred && (
                <span className="px-3 py-1.5 rounded-xl text-[10px] font-bold uppercase tracking-wider glass-panel text-emerald-800 dark:text-emerald-200 border border-emerald-200/50 dark:border-emerald-800/60">
                  Preferred / captive
                </span>
              )}
              {loan.isNonQM && (
                <div className="px-3 py-1.5 bg-indigo-600/90 backdrop-blur-md text-white rounded-xl text-[11px] font-semibold uppercase tracking-wider flex items-center gap-1.5 shadow-sm border border-indigo-400/30">
                  <Crown size={12} />
                  Non-QM
                </div>
              )}
              <div className={`px-3 py-1.5 ${loan.riskLevel === 'Low' ? 'bg-emerald-600/90' : loan.riskLevel === 'Medium' ? 'bg-amber-600/90' : 'bg-rose-600/90'} backdrop-blur-md text-white rounded-xl text-[11px] font-semibold uppercase tracking-wider shadow-sm border border-white/10`}>
                {loan.riskLevel} pipeline risk (estimate)
              </div>
            </div>
          </div>

          <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
            <div className="space-y-2 min-w-0">
              <div className="flex flex-wrap items-center gap-2 text-slate-600 dark:text-slate-300 font-semibold text-[10px] sm:text-xs tracking-wider uppercase">
                <FileText size={14} className="shrink-0 opacity-80" />
                <span className="px-2.5 py-1 rounded-full glass-panel border border-white/60 dark:border-slate-600/80">
                  File CP-2026-{String(loan.id).padStart(3, '0')}
                </span>
                <span className="px-2.5 py-1 rounded-full glass-panel border border-white/60 dark:border-slate-600/80 hidden sm:inline">
                  C-to-P
                </span>
              </div>
              <h1 className="text-2xl md:text-4xl text-slate-900 dark:text-slate-50 font-bold tracking-tight font-display leading-[1.05]">
                {anonymizeBorrowerName(loan.borrower)}
              </h1>
              <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 font-medium">
                Loan officer · {displayLoanOfficer(loan)}
              </p>
              <div className="flex items-center gap-2 text-slate-700 dark:text-slate-200 font-medium">
                <MapPin size={16} className="text-sky-600 shrink-0" />
                <span className="text-sm md:text-base line-clamp-2">{loan.address}</span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 font-medium leading-relaxed max-w-2xl">
                {loan.city}, {loan.state}
                {loan.builderImportRow ? (
                  <>
                    {' · '}
                    Origination (file):{' '}
                    <span className="text-slate-700 dark:text-slate-200">
                      {importCellDisplay(loan.builderImportRow, 'Origination_Status')}
                    </span>
                    {' · '}
                    Mapped stage: <span className="text-slate-700 dark:text-slate-200">{loan.status}</span>
                    {' · '}
                    <span className="tabular-nums">{loan.daysToClose}</span> days vs PRJ_STL_D (app)
                  </>
                ) : (
                  <>
                    {' · '}
                    Stage: <span className="text-slate-700 dark:text-slate-200">{loan.status}</span>
                    {' · '}
                    <span className="tabular-nums">{loan.daysToClose}</span> days (demo placeholder — no import row)
                  </>
                )}
              </p>
            </div>
            
            <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 sm:items-center sm:justify-end shrink-0">
              <button
                type="button"
                className="w-full sm:w-auto px-5 py-2.5 glass-panel text-slate-900 dark:text-slate-100 rounded-xl text-sm font-semibold hover:bg-white/50 dark:hover:bg-slate-800/70 transition-all shadow-sm border border-white/50 dark:border-slate-600/60"
              >
                Export file
              </button>
              <Tooltip text={LOAN_DRILLDOWN_HINTS.preparedness}>
                <button
                  type="button"
                  onClick={() => setDrilldown('preparedness')}
                  className="w-full sm:w-auto px-5 py-2.5 btn-primary rounded-xl text-sm font-semibold transition-all"
                  aria-label="Update conditions — open capture and checklist detail"
                >
                  Update conditions
                </button>
              </Tooltip>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {/* Financial Overview */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Tooltip text={LOAN_DRILLDOWN_HINTS.loanAmount}>
              <div
                onClick={() => setDrilldown('loan-amount')}
                className={`card-base p-5 relative ${drilldownCardStyles}`}
              >
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-[11px] text-[var(--text-secondary)] font-semibold uppercase tracking-wider mb-2">Loan amount</p>
                    <div className="flex items-center gap-2">
                      <DollarSign size={18} className="text-teal-600" />
                      <p className="text-2xl font-light text-[var(--text-primary)] tracking-tight font-mono">
                        {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(loan.loanAmount)}
                      </p>
                    </div>
                    <p className="text-xs text-[var(--text-secondary)] mt-1.5 font-medium leading-snug">
                      {loan.builderImportRow
                        ? `Loan_Type: ${importCellDisplay(loan.builderImportRow, 'Loan_Type')}`
                        : 'Demo amount — not from a spreadsheet row'}
                    </p>
                  </div>
                  <ChevronRight size={18} className="text-slate-400 group-hover:text-teal-600 transition-colors" />
                </div>
              </div>
            </Tooltip>
            
            <Tooltip text={LOAN_DRILLDOWN_HINTS.importDates}>
              <div
                onClick={() => setDrilldown('import-dates')}
                className={`card-base p-5 relative ${drilldownCardStyles}`}
              >
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-[11px] text-[var(--text-secondary)] font-semibold uppercase tracking-wider mb-2">Projected close</p>
                    <div className="flex items-center gap-2">
                      <Calendar size={18} className="text-emerald-600" />
                      <p className="text-2xl font-light text-[var(--text-primary)] tracking-tight font-mono">
                        {loan.builderImportRow
                          ? importDateCellDisplay(loan.builderImportRow, 'PRJ_STL_D')
                          : '—'}
                      </p>
                    </div>
                    <p className="text-xs text-[var(--text-secondary)] mt-1.5 font-medium leading-snug">
                      {loan.builderImportRow
                        ? `AGR ${importDateCellDisplay(loan.builderImportRow, 'AGR_DTE_T')} · App ${importDateCellDisplay(loan.builderImportRow, 'APP_DATE')}`
                        : 'PRJ_STL_D and other dates appear when this loan comes from your import'}
                    </p>
                  </div>
                  <ChevronRight size={18} className="text-slate-400 group-hover:text-emerald-600 transition-colors" />
                </div>
              </div>
            </Tooltip>

            <Tooltip text={LOAN_DRILLDOWN_HINTS.bdmImport}>
              <div
                onClick={() => setDrilldown('bdm-import')}
                className={`card-base p-5 relative ${drilldownCardStyles}`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-emerald-50 text-emerald-600 rounded-xl flex items-center justify-center font-bold text-lg ring-1 ring-black/5">
                      {formatErpBdmDisplayLine(loan.erpSync).charAt(0) || 'B'}
                    </div>
                    <div>
                      <p className="text-[11px] text-[var(--text-secondary)] font-semibold uppercase tracking-wider mb-0.5">BDM &amp; division</p>
                      <p className="text-lg font-semibold text-[var(--text-primary)] tracking-tight">
                        {formatErpBdmDisplayLine(loan.erpSync)}
                      </p>
                      <p className="text-[10px] text-[var(--text-secondary)] font-semibold uppercase tracking-wider mt-0.5">
                        {loan.builderImportRow ? 'From uploaded spreadsheet (not a live ERP feed)' : 'Demo label — import for BDM columns'}
                      </p>
                    </div>
                  </div>
                  <ChevronRight size={18} className="text-slate-400 group-hover:text-emerald-600 transition-colors" />
                </div>
              </div>
            </Tooltip>
          </div>

          {/* Rate Lock & Incentives */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Tooltip text={LOAN_DRILLDOWN_HINTS.rateLock}>
              <div
                onClick={() => setDrilldown('rate-lock')}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setDrilldown('rate-lock');
                  }
                }}
                className={`rounded-2xl border border-white/50 dark:border-slate-600/60 bg-gradient-to-br from-amber-50/80 to-white/40 dark:from-amber-950/30 dark:to-slate-900/40 backdrop-blur-md p-5 sm:p-6 shadow-sm relative ${drilldownCardStyles}`}
              >
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="p-2 rounded-xl bg-amber-500 text-white shadow-sm shrink-0">
                    <ShieldAlert size={18} />
                  </div>
                  <div className="min-w-0">
                    <h3 className="font-bold text-slate-900 dark:text-slate-100 text-sm sm:text-base">Rate lock</h3>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                      LOCKED column drives status; expiry below is projected in the app
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={`px-2 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider ${
                    loan.rateLock?.status === 'Locked' ? 'bg-emerald-100/90 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200' : 'bg-amber-100/90 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200'
                  }`}>
                    {loan.rateLock?.status || 'Floating'}
                  </span>
                  <ChevronRight size={18} className="text-slate-400 group-hover:text-amber-600 transition-colors" />
                </div>
              </div>
              <div className="space-y-2.5 text-sm">
                <div className="flex justify-between items-center gap-2">
                  <span className="text-slate-500 dark:text-slate-400">Program</span>
                  <span className="font-semibold text-slate-900 dark:text-slate-100 text-right">{loan.rateLock?.type || 'Standard'}</span>
                </div>
                {loan.rateLock?.expires ? (
                  <div className="flex justify-between items-center gap-2">
                    <span className="text-slate-500 dark:text-slate-400">Expires</span>
                    <span className="font-semibold text-slate-900 dark:text-slate-100 tabular-nums text-right">
                      {formatShortDate(loan.rateLock.expires)}
                      {lockDaysRemaining != null && (
                        <span className={`block text-[11px] font-bold mt-0.5 ${lockDaysRemaining <= 14 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-500'}`}>
                          {lockDaysRemaining} days remaining
                        </span>
                      )}
                    </span>
                  </div>
                ) : (
                  <p className="text-xs text-amber-800/90 dark:text-amber-200/90 font-medium">No lock date — monitor float risk vs. COE.</p>
                )}
              </div>
              </div>
            </Tooltip>

            <Tooltip text={LOAN_DRILLDOWN_HINTS.incentives}>
              <div
                onClick={() => setDrilldown('incentives')}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setDrilldown('incentives');
                  }
                }}
                className={`rounded-2xl border border-white/50 dark:border-slate-600/60 bg-gradient-to-br from-sky-50/80 to-white/40 dark:from-sky-950/25 dark:to-slate-900/40 backdrop-blur-md p-5 sm:p-6 shadow-sm relative ${drilldownCardStyles}`}
              >
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="p-2 rounded-xl bg-sky-600 text-white shadow-sm shrink-0">
                    <DollarSign size={18} />
                  </div>
                  <div className="min-w-0">
                    <h3 className="font-bold text-slate-900 dark:text-slate-100 text-sm sm:text-base">Builder incentives</h3>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                      {loan.builderImportRow
                        ? 'Total Incentive column from your spreadsheet'
                        : 'Demo only — import a builder file to use the Total Incentive column'}
                    </p>
                  </div>
                </div>
                <ChevronRight size={18} className="text-slate-400 group-hover:text-sky-600 transition-colors shrink-0" />
              </div>
              <div className="space-y-2.5 text-sm">
                <div className="flex justify-between items-center gap-2">
                  <span className="text-slate-500 dark:text-slate-400">{loan.builderImportRow ? 'Parsed label' : 'Type'}</span>
                  <span className="font-semibold text-slate-900 dark:text-slate-100 text-right">
                    {displayIncentiveType(loan.incentives?.type)}
                  </span>
                </div>
                <div className="flex justify-between items-center gap-2">
                  <span className="text-slate-500 dark:text-slate-400">{loan.builderImportRow ? 'Amount' : 'Value'}</span>
                  <span className="font-bold text-sky-700 dark:text-sky-300 tabular-nums">
                    {loan.incentives?.value ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(loan.incentives.value) : '$0'}
                  </span>
                </div>
              </div>
              </div>
            </Tooltip>
          </div>

          {/* Non-QM Details Section */}
          {loan.isNonQM && loan.nonQMData && (
            <div className="card-base p-6 relative hover:!translate-y-0 rounded-2xl border border-indigo-200/40 dark:border-indigo-900/50 bg-gradient-to-br from-indigo-50/40 to-white/30 dark:from-indigo-950/30 dark:to-slate-900/40">
              <div className="flex items-center justify-between mb-5">
                <Tooltip text="Non-QM (Non-Qualified Mortgage) loans use alternative documentation like bank statements or asset depletion to qualify HNW borrowers.">
                  <div className="flex items-center gap-3">
                    <div className="p-2.5 bg-indigo-600 text-white rounded-xl shadow-sm shrink-0">
                      <Crown size={20} />
                    </div>
                    <div>
                      <h2 className="text-xl font-semibold text-[var(--text-primary)]">Non-QM (from import)</h2>
                      <p className="text-sm text-[var(--text-secondary)]">
                        Flagged from Loan_Type text. Assets, income, and LTV tiles are not in the standard spreadsheet — only the columns below are.
                      </p>
                    </div>
                  </div>
                </Tooltip>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1 p-4 rounded-xl border border-white/50 dark:border-slate-600/50 bg-white/35 dark:bg-slate-800/35 backdrop-blur-sm">
                  <p className="text-[10px] text-indigo-600 dark:text-indigo-400 font-bold uppercase tracking-wider">Loan_Type (file)</p>
                  <p className="text-base font-semibold text-[var(--text-primary)] break-words">{loan.nonQMData.type}</p>
                </div>
                <div className="space-y-1 p-4 rounded-xl border border-white/50 dark:border-slate-600/50 bg-white/35 dark:bg-slate-800/35 backdrop-blur-sm">
                  <p className="text-[10px] text-indigo-600 dark:text-indigo-400 font-bold uppercase tracking-wider">External_Lender (file)</p>
                  <p className="text-base font-semibold text-[var(--text-primary)] break-words">
                    {loan.builderImportRow ? importCellDisplay(loan.builderImportRow, 'External_Lender') : '—'}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Construction & Readiness */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Tooltip text={LOAN_DRILLDOWN_HINTS.construction}>
              <div
                onClick={() => setDrilldown('construction')}
                className={`card-base p-6 relative ${drilldownCardStyles}`}
              >
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="p-2.5 bg-amber-600 text-white rounded-xl shadow-sm">
                      <HardHat size={20} />
                    </div>
                    <h2 className="text-xl font-semibold text-[var(--text-primary)]">Origination (import)</h2>
                  </div>
                  <ChevronRight size={18} className="text-slate-400 group-hover:text-amber-600 transition-colors" />
                </div>
                <p className="text-sm text-[var(--text-secondary)] mb-2">
                  Status in file:{' '}
                  <span className="font-semibold text-[var(--text-primary)]">
                    {loan.builderImportRow ? importCellDisplay(loan.builderImportRow, 'Origination_Status') : '—'}
                  </span>
                </p>
                <p className="text-sm text-[var(--text-secondary)]">
                  Mapped pipeline stage: <span className="font-semibold text-amber-600">{loan.status}</span>
                  {loan.builderImportRow && (
                    <span className="block text-[11px] font-medium mt-2 text-[var(--text-secondary)]">
                      Construction % is not a column in the import — the bar was removed so we do not imply field progress from the spreadsheet.
                    </span>
                  )}
                </p>
              </div>
            </Tooltip>

            <Tooltip text={LOAN_DRILLDOWN_HINTS.preparedness}>
              <div
                onClick={() => setDrilldown('preparedness')}
                className={`card-base p-6 relative ${drilldownCardStyles}`}
              >
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="p-2.5 bg-emerald-600 text-white rounded-xl shadow-sm">
                      <CheckCircle2 size={20} />
                    </div>
                    <h2 className="text-xl font-semibold text-[var(--text-primary)]">Capture (import)</h2>
                  </div>
                  <ChevronRight size={18} className="text-slate-400 group-hover:text-emerald-600 transition-colors" />
                </div>
                <p className="text-sm text-[var(--text-secondary)] mb-3">
                  Capture_Indicator:{' '}
                  <span className="font-semibold text-emerald-700 dark:text-emerald-400">
                    {loan.builderImportRow ? importCellDisplay(loan.builderImportRow, 'Capture_Indicator') : '—'}
                  </span>
                </p>
                <p className="text-xs text-[var(--text-secondary)] line-clamp-3">
                  {loan.builderImportRow
                    ? importCellDisplay(loan.builderImportRow, 'Capture_Lost_Reason')
                    : 'Import a file to show Capture_Lost_Reason and related columns.'}
                </p>
              </div>
            </Tooltip>
          </div>

          {/* Key dates from import */}
          <div className="card-base p-5 sm:p-6 relative hover:!translate-y-0">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-teal-600 text-white rounded-xl shadow-sm shrink-0">
                  <Clock size={20} />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-[var(--text-primary)]">Key dates (spreadsheet)</h2>
                  <p className="text-xs text-[var(--text-secondary)] mt-0.5 max-w-xl">
                    Agreement, application, projected close, and lock date come from named columns in your import — not from a live LOS or fabricated document expirations.
                  </p>
                </div>
              </div>
              <Tooltip text="Opens the key-dates detail with the same rows and short definitions for each spreadsheet column.">
                <span className="text-[11px] text-[var(--text-secondary)] inline-flex items-center gap-1.5 font-semibold glass-panel px-2.5 py-1.5 rounded-lg border border-white/50 dark:border-slate-600/60 w-fit">
                  <Info size={14} />
                  Import columns
                </span>
              </Tooltip>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {timelineItems.map((item) => (
                <Tooltip key={item.key} text={LOAN_DRILLDOWN_HINTS.expirationTile}>
                  <div
                    onClick={() => setDrilldown('expiration')}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setDrilldown('expiration');
                      }
                    }}
                    role="button"
                    tabIndex={0}
                    className={`p-4 rounded-xl border border-white/50 dark:border-slate-600/50 bg-white/30 dark:bg-slate-800/25 backdrop-blur-sm shadow-sm relative ${drilldownCardStyles}`}
                  >
                    <div className="w-9 h-9 rounded-lg flex items-center justify-center mb-2.5 shadow-sm bg-teal-600 text-white">
                      <Calendar size={16} />
                    </div>
                    <h4 className="font-semibold text-[var(--text-primary)] text-sm tracking-tight mb-0.5 line-clamp-2">{item.label}</h4>
                    <p className="text-sm font-mono text-[var(--text-primary)] font-medium tabular-nums">{item.value}</p>
                    {item.note && (
                      <p className="text-[10px] text-[var(--text-secondary)] font-medium mt-2 leading-snug">{item.note}</p>
                    )}
                    <ChevronRight size={14} className="absolute top-3 right-3 text-slate-400 group-hover:text-teal-600 opacity-60 group-hover:opacity-100 transition-opacity" />
                  </div>
                </Tooltip>
              ))}
            </div>
          </div>

          {/* Build Progress */}
          <div className="card-base p-6 relative hover:!translate-y-0">
            <div className="mb-6">
              <h2 className="text-xl font-semibold text-[var(--text-primary)]">Construction milestones</h2>
              <p className="text-xs text-[var(--text-secondary)] mt-1">
                Built from import fields (AGR_DTE_T, APP_DATE, Origination_Status, PRJ_STL_D) — not a live builder ERP schedule.
              </p>
            </div>
            <div className="relative">
              <div className="absolute left-5 top-0 bottom-0 w-0.5 bg-[var(--border-subtle)] rounded-full"></div>
              <div className="space-y-8 relative">
                {loan.milestones.map((step, i) => (
                  <div key={i} className="flex items-start gap-6 relative">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center z-10 shadow-sm border-2 ${
                      step.completed ? 'bg-teal-600 text-white border-teal-500' : 
                      step.current ? 'bg-[var(--bg-surface)] text-teal-600 ring-4 ring-teal-500/10 border-teal-500' : 'bg-[var(--bg-app)] border-[var(--border-subtle)] text-slate-400'
                    }`}>
                      {step.completed ? <CheckCircle2 size={20} /> : <div className="w-2.5 h-2.5 rounded-full bg-current"></div>}
                    </div>
                    <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] p-4 rounded-xl flex-1 shadow-sm hover:border-slate-300 transition-all">
                      <div className="flex items-center justify-between mb-1">
                        <h4 className={`text-base font-semibold tracking-tight ${step.pending ? 'text-[var(--text-secondary)]' : 'text-[var(--text-primary)]'}`}>{step.label}</h4>
                        {step.current && <span className="px-2 py-0.5 bg-teal-50 text-teal-700 border border-teal-100 text-[10px] font-semibold uppercase tracking-wider rounded-md">Current Phase</span>}
                      </div>
                      <p className="text-sm text-[var(--text-secondary)]">{step.date}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Sidebar Cards */}
        <div className="space-y-6">
          {/* HELOC Monitor - hidden for now; not applicable for new homes */}
          {false && loan.isHeloc && loan.helocData && (
            <div 
              onClick={() => onViewHeloc(loan.id)}
              className="card-base p-6 cursor-pointer hover:shadow-[0_8px_30px_rgba(0,0,0,0.04)] hover:border-slate-300 hover:scale-[1.01] transition-all group relative"
            >
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 bg-teal-600 text-white rounded-xl shadow-sm">
                    <CreditCard size={20} />
                  </div>
                  <Tooltip text="HELOC is typically secured by the borrower’s existing home and can support a new-build closing (cash-to-close, reserves, carrying costs). It impacts DTI/credit utilization, liquidity/reserves, and the risk of re-qualification changes before closing.">
                    <h2 className="text-lg font-semibold tracking-tight text-[var(--text-primary)]">HELOC (Existing Home) Monitor</h2>
                  </Tooltip>
                </div>
                <div className={`${
                  loan.helocData.status === 'Frozen' ? 'bg-rose-500 text-white' :
                  loan.helocData.status === 'Warning' ? 'bg-amber-500 text-white' :
                  'bg-emerald-500 text-white'
                } px-2 py-1 rounded-md text-[10px] font-semibold uppercase tracking-wider flex items-center gap-1 shadow-sm`}>
                  {loan.helocData.status === 'Frozen' ? <ShieldAlert size={10} /> : <Info size={10} />}
                  {loan.helocData.status}
                </div>
              </div>

              <div className="space-y-5">
                <div>
                  <p className="text-[11px] text-[var(--text-secondary)] uppercase font-semibold tracking-wider mb-1">Total Line Amount</p>
                  <p className="text-2xl font-light text-[var(--text-primary)] tracking-tight font-mono">
                    {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(loan.helocData.totalLine)}
                  </p>
                </div>
                
                <div className="p-5 bg-[var(--bg-app)] rounded-xl border border-[var(--border-subtle)] shadow-sm">
                  <div className="flex justify-between items-end mb-3">
                    <div>
                      <p className="text-[10px] text-[var(--text-secondary)] font-semibold tracking-wider uppercase mb-1">Current Balance</p>
                      <p className="text-xl font-medium text-[var(--text-primary)] tracking-tight font-mono">
                        {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(loan.helocData.currentBalance)}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] text-[var(--text-secondary)] font-semibold tracking-wider uppercase mb-1">Utilization</p>
                      <p className={`text-sm font-semibold font-mono ${loan.helocData.utilization > 80 ? 'text-rose-600' : 'text-teal-600'}`}>
                        {loan.helocData.utilization}%
                      </p>
                    </div>
                  </div>
                  <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden">
                    <div 
                      className={`h-full transition-all duration-1000 ${loan.helocData.utilization > 80 ? 'bg-rose-500' : 'bg-teal-500'}`} 
                      style={{ width: `${loan.helocData.utilization}%` }}
                    ></div>
                  </div>
                </div>

                {loan.helocData.status === 'Frozen' && (
                  <div className="flex items-start gap-2.5 p-3.5 bg-rose-50 rounded-xl text-rose-700 text-xs border border-rose-100 shadow-sm font-medium">
                    <AlertCircle size={14} className="shrink-0 mt-0.5" />
                    <p>Line frozen due to construction-to-perm lock. No further draws permitted until final closing.</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Risk Summary */}
          <Tooltip text={LOAN_DRILLDOWN_HINTS.risk}>
            <div
              onClick={() => setDrilldown('risk')}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setDrilldown('risk');
                }
              }}
              tabIndex={0}
              className={`card-base p-6 text-[var(--text-primary)] relative overflow-hidden ${drilldownCardStyles} hover:!translate-y-0 cursor-pointer`}
            >
            <div className="absolute top-0 right-0 p-6 opacity-[0.06] text-sky-600 pointer-events-none">
              <ShieldAlert size={100} />
            </div>
            
            <h3 className="text-lg mb-4 flex items-center gap-2.5 font-semibold tracking-tight relative z-10">
              <AlertTriangle size={20} className="text-amber-500 shrink-0" />
              Pipeline risk (estimate)
              <ChevronRight size={18} className="ml-auto text-slate-400 group-hover:text-amber-600 transition-colors shrink-0" />
            </h3>
            <p className="text-xs text-[var(--text-secondary)] relative z-10 mb-4">
              Heuristic fallout index from the app — DTI is not supplied by the standard import.
            </p>
            
            <div className="space-y-4 relative z-10">
              <div className="p-4 rounded-xl border border-white/50 dark:border-slate-600/50 bg-white/25 dark:bg-slate-800/30 backdrop-blur-sm">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-[var(--text-secondary)] text-[11px] font-bold uppercase tracking-wider">Fallout index</span>
                  <span className={`${loan.riskLevel === 'High' ? 'text-rose-600 dark:text-rose-400' : loan.riskLevel === 'Medium' ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'} font-bold font-mono text-base tabular-nums`}>
                    {loan.riskScore}%
                  </span>
                </div>
                <div className="w-full h-1.5 bg-slate-200/80 dark:bg-slate-700 rounded-full overflow-hidden">
                  <div 
                    className={`h-full ${loan.riskLevel === 'High' ? 'bg-rose-500' : loan.riskLevel === 'Medium' ? 'bg-amber-500' : 'bg-emerald-500'}`}
                    style={{ width: `${Math.min(100, loan.riskScore)}%` }}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="p-3 rounded-xl border border-white/50 dark:border-slate-600/50 bg-white/20 dark:bg-slate-800/25">
                  <p className="text-[10px] text-[var(--text-secondary)] font-bold uppercase tracking-wider mb-1">Origination (file)</p>
                  <p className="text-sm font-semibold text-[var(--text-primary)] leading-snug line-clamp-2">
                    {loan.builderImportRow ? importCellDisplay(loan.builderImportRow, 'Origination_Status') : '—'}
                  </p>
                </div>
                <div className="p-3 rounded-xl border border-white/50 dark:border-slate-600/50 bg-white/20 dark:bg-slate-800/25">
                  <p className="text-[10px] text-[var(--text-secondary)] font-bold uppercase tracking-wider mb-1">Lock runway</p>
                  <p className={`text-sm font-semibold font-mono tabular-nums flex items-center gap-1 ${lockDaysRemaining != null && lockDaysRemaining <= 30 ? 'text-rose-600 dark:text-rose-400' : 'text-[var(--text-primary)]'}`}>
                    {lockDaysRemaining != null ? `${lockDaysRemaining}d` : loan.rateLock?.status === 'Floating' ? 'Floating' : '—'}
                    {lockDaysRemaining != null && lockDaysRemaining <= 30 && <AlertTriangle size={14} className="shrink-0" />}
                  </p>
                </div>
              </div>

              {riskDetail && (
                <ul className="text-[11px] text-[var(--text-secondary)] space-y-1.5 border-t border-white/30 dark:border-slate-600/40 pt-3">
                  {riskDetail.factors.slice(0, 2).map((f, i) => (
                    <li key={i} className="leading-snug">
                      <span className="font-semibold text-[var(--text-primary)]">{f.category}:</span> {f.description}
                    </li>
                  ))}
                </ul>
              )}

              <button 
                type="button"
                onClick={(e) => { e.stopPropagation(); onViewRisk(loan.id); }}
                className="w-full py-3 btn-primary rounded-xl text-sm font-semibold transition-all"
              >
                Full risk breakdown
              </button>
            </div>
            </div>
          </Tooltip>

          {/* Asset Verification */}
          <Tooltip text={LOAN_DRILLDOWN_HINTS.assets}>
            <div
              onClick={() => setDrilldown('assets')}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setDrilldown('assets');
                }
              }}
              tabIndex={0}
              className={`card-base p-6 relative ${drilldownCardStyles} hover:!translate-y-0 cursor-pointer`}
            >
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2.5 rounded-xl bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border border-indigo-200/50 dark:border-indigo-800/50">
                <Wallet size={20} />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-lg font-semibold text-[var(--text-primary)]">Lender &amp; program (import)</h3>
                <p className="text-[11px] text-[var(--text-secondary)] mt-0.5">
                  External_Lender, loan type, and referral indicator from the spreadsheet — not verified asset balances
                </p>
              </div>
              <ChevronRight size={18} className="text-slate-400 group-hover:text-indigo-600 transition-colors shrink-0" />
            </div>
            
            <div className="space-y-2">
              <div className="flex items-center justify-between p-3 rounded-xl border border-white/50 dark:border-slate-600/50 bg-white/25 dark:bg-slate-800/25 gap-2">
                <span className="text-sm font-medium text-[var(--text-secondary)] shrink-0">External lender</span>
                <span className="font-semibold text-[var(--text-primary)] text-sm text-right break-words">
                  {loan.builderImportRow ? importCellDisplay(loan.builderImportRow, 'External_Lender') : '—'}
                </span>
              </div>
              <div className="flex items-center justify-between p-3 rounded-xl border border-white/50 dark:border-slate-600/50 bg-white/25 dark:bg-slate-800/25 gap-2">
                <span className="text-sm font-medium text-[var(--text-secondary)] shrink-0">Loan type</span>
                <span className="font-semibold text-[var(--text-primary)] text-sm text-right break-words">
                  {loan.builderImportRow ? importCellDisplay(loan.builderImportRow, 'Loan_Type') : '—'}
                </span>
              </div>
              <div className="flex items-center justify-between p-3 rounded-xl border border-emerald-200/60 dark:border-emerald-900/40 bg-emerald-50/50 dark:bg-emerald-950/25 gap-2">
                <span className="text-sm font-semibold text-emerald-800 dark:text-emerald-200 shrink-0">Referred (REF_LOAN_IND)</span>
                <span className="font-bold text-emerald-800 dark:text-emerald-200 text-sm text-right break-words">
                  {loan.builderImportRow ? importCellDisplay(loan.builderImportRow, 'REF_LOAN_IND') : '—'}
                </span>
              </div>
            </div>
            </div>
          </Tooltip>
        </div>
      </div>

      {/* Drilldown Modal — portaled to body so fixed centering isn’t clipped by transformed ancestors (sidebar, embed scroll). */}
      {typeof document !== 'undefined' &&
        createPortal(
          <AnimatePresence>
            {drilldown && (
              <>
                <motion.div
                  key="drilldown-backdrop"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  onClick={() => setDrilldown(null)}
                  className="fixed inset-0 z-[var(--z-modal-backdrop)] bg-slate-900/40 backdrop-blur-[2px]"
                  aria-hidden
                />
                <div className="cohi-modal-center-host">
                  <motion.div
                    key="drilldown-panel"
                    role="dialog"
                    aria-modal="true"
                    initial={{ opacity: 0, scale: 0.97 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.97 }}
                    transition={{ type: 'spring', damping: 28, stiffness: 320 }}
                    className="pointer-events-auto flex w-full max-w-lg max-h-[min(88dvh,calc(100dvh-2rem))] flex-col overflow-hidden overflow-x-hidden rounded-2xl border border-slate-200/90 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl"
                    onClick={(e) => e.stopPropagation()}
                  >
              <div className="sticky top-0 z-10 shrink-0 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-b border-slate-200/80 dark:border-slate-800 px-6 py-4 flex items-center justify-between rounded-t-2xl">
                <h3 className="text-lg font-display font-semibold text-slate-900 dark:text-slate-100 tracking-tight">
                  {drilldown === 'loan-amount' && 'Loan amount (import)'}
                  {drilldown === 'import-dates' && 'Dates & site (import)'}
                  {drilldown === 'bdm-import' && 'BDM & division (import)'}
                  {drilldown === 'rate-lock' && 'Rate Lock Details'}
                  {drilldown === 'incentives' && 'Builder Incentives Details'}
                  {drilldown === 'construction' && 'Origination (import)'}
                  {drilldown === 'preparedness' && 'Capture (import)'}
                  {drilldown === 'expiration' && 'Key dates (import)'}
                  {drilldown === 'risk' && 'Pipeline risk (estimate)'}
                  {drilldown === 'assets' && 'Lender & program (import)'}
                </h3>
                <button
                  type="button"
                  onClick={() => setDrilldown(null)}
                  className="p-2 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 transition-colors"
                >
                  <X size={20} />
                </button>
              </div>
              <div className="cohi-modal-scroll min-h-0 flex-1 overflow-y-auto p-6 sm:p-8 space-y-6 text-slate-700 dark:text-slate-300">
                {drilldown === 'loan-amount' && (
                  <>
                    <div className="p-5 rounded-2xl bg-teal-500/10 backdrop-blur-md border border-teal-400/30 shadow-lg shadow-teal-500/5">
                      <p className="text-[10px] text-teal-600 font-display font-bold uppercase tracking-[0.2em] mb-2">Principal Loan Amount</p>
                      <p className="text-3xl font-display font-bold text-[var(--text-primary)] tracking-tight">
                        {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(loan.loanAmount)}
                      </p>
                      <p className="text-xs text-[var(--text-secondary)] mt-2 font-medium">
                        {loan.builderImportRow
                          ? importFieldMeaning('LoanAmount')
                          : 'Demo portfolio — not loaded from your spreadsheet.'}
                      </p>
                    </div>
                    {loan.builderImportRow ? (
                      <>
                        <ImportKvTable row={loan.builderImportRow} entries={IMPORT_LOAN_AMOUNT_FIELDS} />
                        <div className="rounded-xl border border-slate-200/60 dark:border-slate-700 overflow-hidden divide-y divide-slate-200/60 dark:divide-slate-700">
                          <div className="flex justify-between items-center py-4 px-5 bg-slate-50/50 dark:bg-slate-800/30">
                            <span className="text-sm text-slate-600 dark:text-slate-400 font-light">Days vs PRJ_STL_D (app)</span>
                            <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">{loan.daysToClose}</span>
                          </div>
                          <div className="py-4 px-5 bg-slate-50/50 dark:bg-slate-800/30">
                            <span className="text-sm text-slate-600 dark:text-slate-400 font-light block mb-1">LTV / value</span>
                            <span className="text-sm text-slate-700 dark:text-slate-300 font-medium leading-relaxed">
                              Not in the standard import. Appraised value and LTV belong in your LOS — we only show LoanAmount here.
                            </span>
                          </div>
                        </div>
                      </>
                    ) : (
                      <div className="rounded-xl border border-slate-200/60 overflow-hidden divide-y divide-slate-200/60">
                        <div className="py-4 px-5 bg-slate-50/50">
                          <span className="text-sm text-slate-600 font-light block mb-1">LTV / down payment</span>
                          <span className="text-sm text-slate-700 font-medium leading-relaxed">
                            Demo loan — no spreadsheet row. We do not show synthetic LTV or equity from a modeled property value.
                          </span>
                        </div>
                      </div>
                    )}
                  </>
                )}
                {drilldown === 'import-dates' && (
                  <>
                    <div className="p-5 rounded-2xl bg-emerald-500/10 backdrop-blur-md border border-emerald-400/30 shadow-lg shadow-emerald-500/5">
                      <p className="text-[10px] text-emerald-600 font-display font-bold uppercase tracking-[0.2em] mb-2">Projected close (PRJ_STL_D)</p>
                      <p className="text-3xl font-display font-bold text-[var(--text-primary)] tracking-tight font-mono">
                        {loan.builderImportRow ? importDateCellDisplay(loan.builderImportRow, 'PRJ_STL_D') : '—'}
                      </p>
                      <p className="text-xs text-[var(--text-secondary)] mt-2 font-medium leading-relaxed">
                        {loan.builderImportRow
                          ? 'Shown with agreement, application, lock, and site columns from the same row — not an appraisal or AVM.'
                          : 'Import a backlog row to populate PRJ_STL_D, AGR_DTE_T, APP_DATE, and community fields.'}
                      </p>
                    </div>
                    {loan.builderImportRow ? (
                      <>
                        <div className="rounded-xl border border-slate-200/60 dark:border-slate-700 overflow-hidden divide-y divide-slate-200/60 dark:divide-slate-700">
                          <div className="flex flex-col gap-1 py-4 px-5 bg-slate-50/50 dark:bg-slate-800/30">
                            <span className="text-sm text-slate-600 dark:text-slate-400 font-light">Address line (app-built from import)</span>
                            <span className="font-medium text-slate-900 dark:text-slate-100">{loan.address}</span>
                          </div>
                          <div className="flex justify-between items-center py-4 px-5 bg-slate-50/50 dark:bg-slate-800/30">
                            <span className="text-sm text-slate-600 dark:text-slate-400 font-light">Market label (derived)</span>
                            <span className="font-semibold text-slate-900 dark:text-slate-100">
                              {loan.city}, {loan.state}
                            </span>
                          </div>
                        </div>
                        <ImportKvTable row={loan.builderImportRow} entries={IMPORT_DATES_SITE_FIELDS} />
                      </>
                    ) : (
                      <div className="rounded-xl border border-slate-200/60 overflow-hidden divide-y divide-slate-200/60">
                        <div className="flex flex-col gap-1 py-4 px-5 bg-slate-50/50">
                          <span className="text-sm text-slate-600 font-light">Property Address (demo)</span>
                          <span className="font-medium text-slate-900">{loan.address}</span>
                        </div>
                        <div className="flex justify-between items-center py-4 px-5 bg-slate-50/50">
                          <span className="text-sm text-slate-600 font-light">Community</span>
                          <span className="font-semibold">
                            {loan.city}, {loan.state}
                          </span>
                        </div>
                      </div>
                    )}
                  </>
                )}
                {drilldown === 'bdm-import' && (
                  <>
                    <div className="p-5 rounded-2xl bg-emerald-500/10 backdrop-blur-md border border-emerald-400/30 shadow-lg shadow-emerald-500/5">
                      <p className="text-[10px] text-emerald-600 font-display font-bold uppercase tracking-[0.2em] mb-2">BDM &amp; division (spreadsheet)</p>
                      <p className="text-2xl font-display font-bold text-[var(--text-primary)] tracking-tight">
                        {formatErpBdmDisplayLine(loan.erpSync, '—')}
                      </p>
                      <p className="text-xs text-[var(--text-secondary)] mt-2 font-medium">
                        {loan.builderImportRow
                          ? 'P_Div_VP, BDM_Name, BDM_Num, and related columns from your file — not a live ERP sync.'
                          : 'Demo summary line only; no spreadsheet row on this loan.'}
                      </p>
                    </div>
                    {loan.builderImportRow ? (
                      <ImportKvTable row={loan.builderImportRow} entries={IMPORT_BDM_FIELDS} />
                    ) : (
                      <p className="text-sm text-slate-500 dark:text-slate-400">Import a builder backlog file to see BDM and division fields.</p>
                    )}
                  </>
                )}
                {drilldown === 'rate-lock' && (
                  <>
                    <div className="p-5 rounded-2xl bg-amber-500/10 backdrop-blur-md border border-amber-400/30 shadow-lg shadow-amber-500/5">
                      <p className="text-[10px] text-amber-600 font-display font-bold uppercase tracking-[0.2em] mb-2">Lock status (app)</p>
                      <p className="text-2xl font-display font-bold text-amber-700 dark:text-amber-400">{loan.rateLock?.status || 'Floating'}</p>
                      <p className="text-xs text-[var(--text-secondary)] mt-2 font-medium">
                        {loan.builderImportRow
                          ? 'LOCKED in your file sets status here; expiration is projected in the app when a lock date exists — not copied verbatim from the spreadsheet.'
                          : loan.rateLock?.status === 'Locked'
                            ? 'Rate protected until expiration (demo).'
                            : 'Awaiting lock — rate may change (demo).'}
                      </p>
                    </div>
                    <div className="rounded-xl border border-slate-200/60 dark:border-slate-700 overflow-hidden divide-y divide-slate-200/60 dark:divide-slate-700">
                      <div className="flex justify-between items-center py-4 px-5 bg-slate-50/50 dark:bg-slate-800/30">
                        <span className="text-sm text-slate-600 dark:text-slate-400 font-light">Lock product (app)</span>
                        <span className="font-display font-semibold text-slate-900 dark:text-slate-100">{loan.rateLock?.type || 'Standard'}</span>
                      </div>
                      <div className="flex justify-between items-center py-4 px-5 bg-slate-50/50 dark:bg-slate-800/30">
                        <span className="text-sm text-slate-600 dark:text-slate-400 font-light">Expiration (shown)</span>
                        <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                          {loan.rateLock?.expires ? formatShortDate(loan.rateLock.expires) : '—'}
                        </span>
                      </div>
                    </div>
                    {loan.builderImportRow && <ImportKvTable row={loan.builderImportRow} entries={IMPORT_LOCK_FIELDS} />}
                  </>
                )}
                {drilldown === 'incentives' && (
                  <>
                    <div className="p-5 rounded-2xl bg-blue-500/10 backdrop-blur-md border border-blue-400/30 shadow-lg shadow-blue-500/5">
                      <p className="text-[10px] text-blue-600 font-display font-bold uppercase tracking-[0.2em] mb-2">Total Incentive</p>
                      <p className="text-3xl font-display font-bold text-blue-700 dark:text-blue-400">
                        {loan.incentives?.value
                          ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(loan.incentives.value)
                          : '$0'}
                      </p>
                      <p className="text-xs text-[var(--text-secondary)] mt-2 font-medium">
                        {loan.builderImportRow
                          ? importFieldMeaning('TotalIncentive')
                          : 'This loan is not tied to an import row — incentive type/value come from demo data only.'}
                      </p>
                    </div>
                    <div className="rounded-xl border border-slate-200/60 dark:border-slate-700 overflow-hidden divide-y divide-slate-200/60 dark:divide-slate-700">
                      <div className="flex justify-between items-center py-4 px-5 bg-slate-50/50 dark:bg-slate-800/30">
                        <span className="text-sm text-slate-600 dark:text-slate-400 font-light">Parsed type</span>
                        <span className="font-display font-semibold text-slate-900 dark:text-slate-100">
                          {displayIncentiveType(loan.incentives?.type)}
                        </span>
                      </div>
                    </div>
                    {loan.builderImportRow ? (
                      <ImportKvTable row={loan.builderImportRow} entries={IMPORT_INCENTIVE_FIELDS} />
                    ) : (
                      <p className="text-sm text-slate-500 dark:text-slate-400">
                        Upload your Toll / Encompass-style spreadsheet so each loan carries the original columns (including Total Incentive).
                      </p>
                    )}
                  </>
                )}
                {drilldown === 'construction' && (
                  <>
                    <div className="p-5 rounded-2xl bg-amber-500/10 backdrop-blur-md border border-amber-400/30 shadow-lg shadow-amber-500/5">
                      <p className="text-[10px] text-amber-600 font-display font-bold uppercase tracking-[0.2em] mb-2">Origination_Status (file)</p>
                      <p className="text-xl font-display font-bold text-amber-700 dark:text-amber-400 break-words">
                        {loan.builderImportRow ? importCellDisplay(loan.builderImportRow, 'Origination_Status') : '—'}
                      </p>
                      <p className="text-xs text-[var(--text-secondary)] mt-2 font-medium">
                        {loan.builderImportRow
                          ? 'Pipeline stage in the app is mapped from this text — there is no construction completion % in the import.'
                          : 'Demo mapped stage only; no Origination_Status column on this loan.'}
                      </p>
                    </div>
                    <div className="rounded-xl border border-slate-200/60 overflow-hidden divide-y divide-slate-200/60">
                      <div className="flex justify-between items-center py-4 px-5 bg-slate-50/50"><span className="text-sm text-slate-600 font-light">Mapped stage (app)</span><span className="font-display font-bold text-amber-600">{loan.status}</span></div>
                      <div className="flex justify-between items-center py-4 px-5 bg-slate-50/50"><span className="text-sm text-slate-600 font-light">Days vs PRJ_STL_D</span><span className="font-mono font-semibold">{loan.daysToClose} days</span></div>
                    </div>
                    {loan.builderImportRow && (
                      <ImportKvTable row={loan.builderImportRow} entries={IMPORT_ORIGINATION_FIELDS} />
                    )}
                    <div className="pt-2">
                      <p className="text-[10px] font-display font-bold text-[var(--text-secondary)] uppercase tracking-[0.2em] mb-3">Milestones (from import fields)</p>
                      <div className="space-y-2">
                        {loan.milestones.map((step, i) => (
                          <div key={i} className="flex items-center justify-between py-3 px-4 rounded-xl bg-white/30 backdrop-blur-sm border border-white/50">
                            <span className={step.completed ? 'text-emerald-600 font-semibold' : step.current ? 'text-amber-600 font-display font-bold' : 'text-[var(--text-secondary)] font-medium'}>{step.label}</span>
                            <span className="text-xs font-mono text-[var(--text-secondary)]">{step.date}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                )}
                {drilldown === 'preparedness' && (
                  <>
                    <div className="p-5 rounded-2xl bg-emerald-500/10 backdrop-blur-md border border-emerald-400/30 shadow-lg shadow-emerald-500/5">
                      <p className="text-[10px] text-emerald-600 font-display font-bold uppercase tracking-[0.2em] mb-2">Capture_Indicator</p>
                      <p className="text-2xl font-display font-bold text-emerald-700 break-words">
                        {loan.builderImportRow ? importCellDisplay(loan.builderImportRow, 'Capture_Indicator') : '—'}
                      </p>
                      <p className="text-xs text-[var(--text-secondary)] mt-2 font-medium">
                        {loan.builderImportRow
                          ? 'Toll capture expectation fields from the same row. Readiness % was removed — it was not a spreadsheet column.'
                          : 'Import a file for Capture_Indicator, Capture_Lost_Reason, and comments.'}
                      </p>
                    </div>
                    {loan.builderImportRow ? (
                      <ImportKvTable row={loan.builderImportRow} entries={IMPORT_CAPTURE_FIELDS} />
                    ) : null}
                    <div className="pt-2">
                      <p className="text-[10px] font-display font-bold text-[var(--text-secondary)] uppercase tracking-[0.2em] mb-3">App checklist (scaffolding)</p>
                      <p className="text-xs text-[var(--text-secondary)] mb-3 leading-relaxed">
                        Rows below are generated in the app for navigation — they are not LOS conditions from your import.
                      </p>
                      <div className="space-y-2">
                        {loan.preparednessChecklist?.map((item, i) => (
                          <div key={i} className="flex items-center justify-between py-3 px-4 rounded-xl bg-white/30 backdrop-blur-sm border border-white/50">
                            <span className="text-sm font-medium text-[var(--text-primary)]">{item.task}</span>
                            <span className={`text-xs font-bold px-2.5 py-1 rounded-lg backdrop-blur-sm border ${item.status === 'Completed' ? 'bg-emerald-500/20 text-emerald-700 border-emerald-400/30' : item.status.includes('Pending') ? 'bg-amber-500/20 text-amber-700 border-amber-400/30' : 'bg-slate-500/10 text-slate-600 border-white/30'}`}>
                              {item.status}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                )}
                {drilldown === 'expiration' && (
                  <>
                    <p className="text-sm text-slate-600 dark:text-slate-400 font-medium mb-4 leading-relaxed">
                      These rows mirror named date columns in your import. They replace the old “document expiration” demo tiles, which were not sourced from the spreadsheet.
                    </p>
                    <div className="space-y-3">
                      {timelineItems.map((item) => (
                        <div key={item.key} className="p-5 rounded-2xl border border-slate-200/80 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-800/40 shadow-sm">
                          <h4 className="font-display font-bold text-slate-900 dark:text-slate-100 text-sm mb-2">{item.label}</h4>
                          <p className="text-lg font-mono font-semibold text-slate-900 dark:text-slate-100 tabular-nums">{item.value}</p>
                          {item.note && (
                            <p className="text-xs text-slate-500 dark:text-slate-400 font-medium mt-2 leading-relaxed">{item.note}</p>
                          )}
                        </div>
                      ))}
                    </div>
                    {loan.builderImportRow && (
                      <ImportKvTable row={loan.builderImportRow} entries={IMPORT_DATES_SITE_FIELDS} />
                    )}
                  </>
                )}
                {drilldown === 'risk' && (
                  <>
                    <div className="p-6 rounded-2xl bg-slate-50/80 dark:bg-slate-800/50 border border-slate-200/60 dark:border-slate-700">
                      <p className="text-[10px] text-slate-500 dark:text-slate-400 font-display font-semibold uppercase tracking-wider mb-2">Fallout index</p>
                      <p className={`text-4xl font-display font-bold tabular-nums ${loan.riskLevel === 'High' ? 'text-rose-600 dark:text-rose-400' : loan.riskLevel === 'Medium' ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                        {loan.riskScore}%
                      </p>
                      <p className="text-sm text-slate-500 dark:text-slate-400 mt-2 font-light">
                        Modeled in the app from pipeline heuristics — not an underwriting decision or credit finding.
                      </p>
                    </div>
                    <div className="rounded-xl border border-slate-200/60 dark:border-slate-700 overflow-hidden divide-y divide-slate-200/60 dark:divide-slate-700">
                      <div className="flex justify-between items-center py-4 px-5 bg-slate-50/50 dark:bg-slate-800/30">
                        <span className="text-sm text-slate-600 dark:text-slate-400 font-light">Qualification band</span>
                        <span className={`font-display font-semibold ${loan.riskLevel === 'High' ? 'text-rose-600 dark:text-rose-400' : loan.riskLevel === 'Medium' ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}`}>{loan.riskLevel}</span>
                      </div>
                      <div className="flex flex-col gap-1 py-4 px-5 bg-slate-50/50 dark:bg-slate-800/30">
                        <span className="text-sm text-slate-600 dark:text-slate-400 font-light">DTI</span>
                        <span className="text-sm text-slate-700 dark:text-slate-300 font-medium leading-relaxed">
                          Not in the standard builder import. Use your LOS for debt, income, and ratios.
                        </span>
                      </div>
                      <div className="flex justify-between items-center py-4 px-5 bg-slate-50/50 dark:bg-slate-800/30">
                        <span className="text-sm text-slate-600 dark:text-slate-400 font-light">Lock runway</span>
                        <span className={`font-medium flex items-center gap-1.5 tabular-nums ${lockDaysRemaining != null && lockDaysRemaining <= 30 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-900 dark:text-slate-100'}`}>
                          {lockDaysRemaining != null ? `${lockDaysRemaining} days` : loan.rateLock?.status === 'Floating' ? 'Floating' : '—'}
                          {lockDaysRemaining != null && lockDaysRemaining <= 30 && <AlertTriangle size={14} />}
                        </span>
                      </div>
                      <div className="flex flex-col gap-1.5 py-4 px-5 bg-slate-50/50 dark:bg-slate-800/30">
                        <span className="text-sm text-slate-600 dark:text-slate-400 font-light">Drivers</span>
                        <span className="text-sm text-slate-700 dark:text-slate-300 font-light leading-relaxed">
                          {riskDetail
                            ? riskDetail.factors.map((f) => f.description).join(' ')
                            : 'No expanded risk narrative for this loan ID — use fallout index and conditions list.'}
                        </span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => { setDrilldown(null); onViewRisk(loan.id); }}
                      className="w-full py-3.5 mt-1 font-display font-semibold btn-primary text-white rounded-xl transition-colors"
                    >
                      Full risk breakdown
                    </button>
                  </>
                )}
                {drilldown === 'assets' && (
                  <>
                    <p className="text-sm text-slate-600 dark:text-slate-400 font-medium leading-relaxed">
                      Asset balances are not part of the standard backlog import. This panel lists lender and program columns from the file instead.
                    </p>
                    {loan.builderImportRow ? (
                      <ImportKvTable row={loan.builderImportRow} entries={IMPORT_LENDER_PROGRAM_FIELDS} />
                    ) : (
                      <div className="rounded-xl border border-slate-200/60 dark:border-slate-700 py-4 px-5 bg-slate-50/50 dark:bg-slate-800/30">
                        <span className="text-sm text-slate-600 dark:text-slate-400 font-light">
                          Demo loan — import a spreadsheet row to populate External_Lender, Loan_Type, and REF_LOAN_IND.
                        </span>
                      </div>
                    )}
                  </>
                )}
              </div>
                  </motion.div>
                </div>
              </>
            )}
          </AnimatePresence>,
          document.body,
        )}
    </div>
  );
}
