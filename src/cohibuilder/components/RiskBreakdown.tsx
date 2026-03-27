import React, { useMemo } from 'react';
import { motion } from 'motion/react';
import { ArrowLeft, AlertTriangle, ShieldCheck, ShieldAlert, DollarSign, Calendar, Activity, Briefcase } from 'lucide-react';
import { useCohiBuilderPortfolio } from '../contexts/CohiBuilderPortfolioContext';
import { findLoanForNavId } from '../lib/resolveLoanNav';
import type { CohiPortfolioLoan } from '../data/portfolioFromBuilderImport';
import type { BuilderImportRow } from '../data/builderImportFields';
import { anonymizeBorrowerName } from '../lib/borrowerPrivacy';
import { resolvedPrimaryLenderLabel } from '../lib/lenderDisplay';

interface RiskBreakdownProps {
  loanId: number | null;
  onBack: () => void;
}

type Factor = { category: string; impact: string; description: string };

const NO_IMPORT_FACTORS: Factor[] = [
  {
    category: 'No spreadsheet row',
    impact: 'Low',
    description:
      'This loan has no builder import row attached. Load a backlog file so capture fields, dates, and Loan_Type can be read from named columns.',
  },
];

function importCell(row: BuilderImportRow | undefined, key: keyof BuilderImportRow): string {
  if (!row) return '—';
  const v = row[key];
  if (v == null || String(v).trim() === '') return '—';
  return String(v).trim();
}

function capturePreferred(raw: string | undefined): boolean {
  const v = String(raw ?? '')
    .trim()
    .toUpperCase();
  return v === 'Y' || v === 'YES' || v === '1' || v === 'TRUE';
}

/** Risk bullets derived only from spreadsheet + app mapping — no fictional DTI / appraisal stories. */
function factorsFromImportLoan(loan: CohiPortfolioLoan): Factor[] {
  const row = loan.builderImportRow;
  if (!row) return NO_IMPORT_FACTORS;
  const out: Factor[] = [];
  const lostReason = row.Capture_Lost_Reason?.trim();
  const lostComment = row.Capture_Lost_Comment?.trim();
  if (lostReason || lostComment) {
    out.push({
      category: 'Capture (spreadsheet)',
      impact: 'High',
      description: [
        lostReason && `Capture_Lost_Reason: ${lostReason}`,
        lostComment && `Capture_Lost_Comment: ${lostComment}`,
      ]
        .filter(Boolean)
        .join(' · '),
    });
  } else if (!capturePreferred(row.Capture_Indicator)) {
    const cap = (row.Capture_Indicator ?? '').trim() || '(blank)';
    out.push({
      category: 'Capture (spreadsheet)',
      impact: 'Medium',
      description: `Capture_Indicator: ${cap}. Not flagged as preferred capture (Y / Yes / 1 / True).`,
    });
  }
  if (loan.daysToClose <= 14) {
    out.push({
      category: 'Closing window (PRJ_STL_D)',
      impact: 'High',
      description: `About ${loan.daysToClose} days to targeted close — computed in the app from PRJ_STL_D vs today.`,
    });
  } else if (loan.daysToClose <= 45) {
    out.push({
      category: 'Closing window (PRJ_STL_D)',
      impact: 'Medium',
      description: `About ${loan.daysToClose} days to targeted close from projected settlement in the file.`,
    });
  }
  const lt = (row.Loan_Type ?? '').trim();
  if (/fha|va|non|asset|dscr|tru\s*cash/i.test(lt)) {
    out.push({
      category: 'Program (spreadsheet)',
      impact: 'Medium',
      description: `Loan_Type: ${lt}`,
    });
  }
  if (out.length === 0) {
    out.push({
      category: 'Import summary',
      impact: 'Low',
      description:
        'No capture lost-reason or comment in file; Capture_Indicator is preferred or blank; PRJ_STL_D is more than 45 days out. Verify against your source file.',
    });
  }
  return out;
}

export default function RiskBreakdown({ loanId, onBack }: RiskBreakdownProps) {
  const { allLoans: loans } = useCohiBuilderPortfolio();
  const loan = useMemo(() => findLoanForNavId(loans, loanId), [loans, loanId]);
  const factors = useMemo((): Factor[] => {
    if (!loan) return [];
    if (loan.builderImportRow) return factorsFromImportLoan(loan);
    return NO_IMPORT_FACTORS;
  }, [loan]);
  const fromImport = Boolean(loan?.builderImportRow);

  const importReferenceRows = useMemo(() => {
    const row = loan?.builderImportRow;
    if (!row) return [];
    return [
      { label: 'LoanAmount', value: importCell(row, 'LoanAmount') },
      { label: 'Loanno', value: importCell(row, 'Loanno') },
      { label: 'Loan_Type', value: importCell(row, 'Loan_Type') },
      { label: 'Origination_Status', value: importCell(row, 'Origination_Status') },
      { label: 'PRJ_STL_D', value: importCell(row, 'PRJ_STL_D') },
      { label: 'AGR_DTE_T', value: importCell(row, 'AGR_DTE_T') },
      { label: 'APP_DATE', value: importCell(row, 'APP_DATE') },
      { label: 'LOCKED', value: importCell(row, 'LOCKED') },
      { label: 'Capture_Indicator', value: importCell(row, 'Capture_Indicator') },
      { label: 'External_Lender', value: importCell(row, 'External_Lender') },
      { label: 'REF_LOAN_IND', value: importCell(row, 'REF_LOAN_IND') },
    ];
  }, [loan]);

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value);
  };

  if (!loan) {
    return (
      <div className="card-base rounded-2xl p-8 sm:p-10 text-center space-y-4 max-w-lg mx-auto">
        <p className="text-lg font-semibold text-slate-900 dark:text-slate-100">Loan not in portfolio</p>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          {loanId != null ? (
            <>
              No loan matches id <span className="tabular-nums font-medium">{loanId}</span> (internal id or LOS loan number).
            </>
          ) : (
            'Open a loan from the list first.'
          )}
        </p>
        <button type="button" onClick={onBack} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl btn-primary text-sm font-semibold">
          <ArrowLeft size={16} />
          Back
        </button>
      </div>
    );
  }

  const propertyValueNote = fromImport
    ? `Property value ${formatCurrency(loan.propertyValue)} is stored on the loan object in this app; it is not part of the standard builder import column set.`
    : `Property value ${formatCurrency(loan.propertyValue)} is stored on the loan object in the loaded portfolio.`;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <button 
            onClick={onBack}
            className="p-2 hover:bg-slate-100 rounded-xl text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
          >
            <ArrowLeft size={20} />
          </button>
          <div>
            <div className="flex items-center gap-3 mb-1">
              <h1 className="text-2xl sm:text-3xl text-[var(--text-primary)] font-bold tracking-tight">Loan risk summary</h1>
              {fromImport ? (
                <span className="px-2.5 py-1 rounded-md bg-slate-200/80 text-slate-700 dark:bg-slate-800 dark:text-slate-200 text-[10px] font-bold uppercase tracking-widest border border-slate-300/80 dark:border-slate-600">
                  Import row
                </span>
              ) : null}
            </div>
            <p className="text-sm text-[var(--text-secondary)] font-medium max-w-3xl leading-relaxed">
              <span className="text-[var(--text-primary)] font-semibold">{anonymizeBorrowerName(loan.borrower)}</span>
              {fromImport ? (
                <>
                  . Numbers and text below are either copied from named spreadsheet columns or computed in this app as labeled
                  (e.g. days to PRJ_STL_D). They are not LOS underwriting decisions.
                </>
              ) : (
                <>
                  . This loan has no attached import row; factors and reference fields cannot be tied to a file until you load
                  builder backlog data that includes this loan.
                </>
              )}
            </p>
          </div>
        </div>
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
          <button
            type="button"
            className="px-4 py-2 bg-white border border-[var(--border-subtle)] text-[var(--text-primary)] text-sm font-bold rounded-xl shadow-sm opacity-60 cursor-not-allowed"
            disabled
            title="Export is not available in this build"
          >
            Export PDF
          </button>
          <button
            type="button"
            className="px-4 py-2 bg-slate-900 text-white text-sm font-bold rounded-xl shadow-sm opacity-60 cursor-not-allowed"
            disabled
            title="Escalation is not connected in this build"
          >
            Escalate
          </button>
        </div>
      </div>

      {/* Factual KPI row — only values that exist on the loan or import */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="card-base p-5 border-l-4 border-l-rose-500">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 bg-rose-50 text-rose-600 rounded-lg"><DollarSign size={18} /></div>
            <h3 className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider">Loan amount</h3>
          </div>
          <p className="text-2xl font-extrabold text-[var(--text-primary)] font-mono">{formatCurrency(loan.loanAmount)}</p>
          <p className="text-xs text-[var(--text-secondary)] mt-1 font-medium leading-relaxed">
            {fromImport ? (
              <>
                <span className="block">LoanAmount: value from the spreadsheet row.</span>
                <span className="block mt-1">{propertyValueNote}</span>
              </>
            ) : (
              <>Loan amount and property value are fields on this loan in the loaded portfolio; there is no import row to cite.</>
            )}
          </p>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="card-base p-5 border-l-4 border-l-amber-500">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 bg-amber-50 text-amber-600 rounded-lg"><Activity size={18} /></div>
            <h3 className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider">Fallout index</h3>
          </div>
          <p className="text-2xl font-extrabold text-[var(--text-primary)] font-mono">{loan.riskScore}%</p>
          <p className="text-xs text-[var(--text-secondary)] mt-1 font-medium leading-relaxed">
            Whole number stored on this loan in the loaded portfolio. It is a coarse in-app index, not an underwriting or credit
            model output.
          </p>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="card-base p-5 border-l-4 border-l-indigo-500">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg"><Calendar size={18} /></div>
            <h3 className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider">Days to projected close</h3>
          </div>
          <p className="text-2xl font-extrabold text-[var(--text-primary)] font-mono tabular-nums">{loan.daysToClose}</p>
          <p className="text-xs text-[var(--text-secondary)] mt-1 font-medium leading-relaxed">
            {fromImport
              ? 'Computed in this app from PRJ_STL_D on the import row versus today’s date.'
              : 'Value on the loan record in the loaded portfolio (no import row to tie to PRJ_STL_D).'}
          </p>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }} className="card-base p-5 border-l-4 border-l-emerald-500">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 bg-emerald-50 text-emerald-600 rounded-lg"><Briefcase size={18} /></div>
            <h3 className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider">Origination status (file)</h3>
          </div>
          <p className="text-lg sm:text-xl font-bold text-[var(--text-primary)] leading-snug break-words">
            {fromImport ? importCell(loan.builderImportRow, 'Origination_Status') : '—'}
          </p>
          <p className="text-xs text-[var(--text-secondary)] mt-1 font-medium leading-relaxed">
            Origination_Status cell from the spreadsheet when an import row is present.
          </p>
        </motion.div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left Column: Deep Dive */}
        <div className="lg:col-span-2 space-y-8">
          
          {/* Risk Factors */}
          <div className="card-base p-6 sm:p-8">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-[var(--text-primary)]">Import-based signals</h2>
              <span className="text-sm font-medium text-[var(--text-secondary)]">
                {fromImport ? 'Spreadsheet + dated rules' : 'No file row'}
              </span>
            </div>
            <div className="space-y-4">
              {factors.map((factor, index) => (
                <motion.div 
                  key={index}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: index * 0.1 }}
                  className="p-5 rounded-2xl border border-[var(--border-subtle)] bg-slate-50/50 flex flex-col sm:flex-row items-start gap-4 sm:gap-5 group hover:bg-white hover:shadow-md transition-all duration-300"
                >
                  <div className={`p-3 rounded-xl shrink-0 ${
                    factor.impact === 'High' ? 'bg-rose-100 text-rose-600' : 
                    factor.impact === 'Medium' ? 'bg-amber-100 text-amber-600' : 'bg-emerald-100 text-emerald-600'
                  }`}>
                    {factor.impact === 'High' ? <ShieldAlert size={24} /> : factor.impact === 'Medium' ? <AlertTriangle size={24} /> : <ShieldCheck size={24} />}
                  </div>
                  <div className="flex-1">
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                      <h4 className="text-base font-bold text-[var(--text-primary)]">{factor.category}</h4>
                      <span className={`text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full ${
                        factor.impact === 'High' ? 'bg-rose-100 text-rose-700 border border-rose-200' : 
                        factor.impact === 'Medium' ? 'bg-amber-100 text-amber-700 border border-amber-200' : 'bg-emerald-100 text-emerald-700 border border-emerald-200'
                      }`}>
                        {factor.impact} tier
                      </span>
                    </div>
                    <p className="text-sm text-[var(--text-secondary)] font-medium leading-relaxed">{factor.description}</p>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>

          {/* Selected import columns — read-only reference */}
          <div className="card-base p-6 sm:p-8">
            <h2 className="text-xl font-bold text-[var(--text-primary)] mb-2">Spreadsheet fields (reference)</h2>
            <p className="text-sm text-[var(--text-secondary)] font-medium mb-6 leading-relaxed">
              {fromImport
                ? 'Raw values from the attached import row for this loan. Empty cells show as an em dash.'
                : 'Load builder backlog data that includes this loan to populate these cells from the file.'}
            </p>
            {fromImport ? (
              <div className="rounded-xl border border-[var(--border-subtle)] overflow-hidden divide-y divide-[var(--border-subtle)]">
                {importReferenceRows.map((row) => (
                  <div
                    key={row.label}
                    className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 px-4 py-3 bg-slate-50/40 dark:bg-slate-900/30"
                  >
                    <span className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wide">{row.label}</span>
                    <span className="text-sm font-medium text-[var(--text-primary)] text-right break-words sm:max-w-[min(100%,24rem)]">
                      {row.value}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-[var(--text-secondary)]">No import row — field list is not available for this loan.</p>
            )}
          </div>

        </div>

        {/* Right column: reconciliation checklist + loan context */}
        <div className="space-y-8">
          <div className="card-base p-6 sm:p-8 bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 shadow-sm">
            <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100 mb-3 flex items-center gap-2">
              <Briefcase size={20} className="text-brand-primary" />
              Column reconciliation
            </h2>
            <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed mb-4">
              {fromImport
                ? 'The import template does not define workflow tasks. These are neutral checks you can run against the same columns shown on this page and your system of record.'
                : 'Without an import row, reconcile using your LOS or source file directly after the loan appears in a loaded backlog.'}
            </p>
            <ul className="list-disc list-inside space-y-2 text-xs sm:text-sm text-slate-600 dark:text-slate-400">
              <li>
                <strong className="text-slate-800 dark:text-slate-200">Capture_Indicator</strong>, Capture_Lost_Reason, Capture_Lost_Comment
                {fromImport ? ' — compare to your CRM or LOS capture flags.' : ' — not available from this screen until a row exists.'}
              </li>
              <li>
                <strong className="text-slate-800 dark:text-slate-200">PRJ_STL_D</strong> and <strong className="text-slate-800 dark:text-slate-200">LOCKED</strong>
                {fromImport ? ' — compare to scheduled close and lock dates in your pipeline tools.' : ' — same as above.'}
              </li>
              <li>
                <strong className="text-slate-800 dark:text-slate-200">LoanAmount</strong>, <strong className="text-slate-800 dark:text-slate-200">Loan_Type</strong>,{' '}
                <strong className="text-slate-800 dark:text-slate-200">External_Lender</strong>
                {fromImport ? ' — match the active registration or loan file.' : ' — match when the loan is tied to an import.'}
              </li>
            </ul>
          </div>

          {/* Key Loan Details Summary */}
          <div className="card-base p-6 sm:p-8">
            <h2 className="text-sm font-bold text-[var(--text-secondary)] uppercase tracking-wider mb-2">Loan context</h2>
            <p className="text-[11px] text-[var(--text-secondary)] font-medium mb-4 leading-relaxed">
              {fromImport ? (
                <>
                  Lender label uses import and capture rules. City/state come from the loan record. Build progress and preparedness
                  percentages are <strong>fields on the loan object</strong> in this app (mapped from pipeline data such as{' '}
                  <strong>Origination_Status</strong>), not standalone columns in the standard import template.
                </>
              ) : (
                <>
                  Lender, location, build progress, and preparedness are fields on this loan in the loaded portfolio. They are not
                  tied to a spreadsheet row for this loan until backlog data includes it.
                </>
              )}
            </p>
            <div className="space-y-4">
              <div className="flex justify-between items-center pb-4 border-b border-[var(--border-subtle)]">
                <span className="text-sm font-medium text-[var(--text-secondary)]">Lender</span>
                <span className="text-sm font-bold text-[var(--text-primary)] text-right max-w-[150px] truncate">
                  {resolvedPrimaryLenderLabel(loan.lender, loan.isPreferred, loan.builderImportRow)}
                </span>
              </div>
              <div className="flex justify-between items-center pb-4 border-b border-[var(--border-subtle)]">
                <span className="text-sm font-medium text-[var(--text-secondary)]">Build Progress</span>
                <span className="text-sm font-bold text-[var(--text-primary)]">{loan.constructionProgress}%</span>
              </div>
              <div className="flex justify-between items-center pb-4 border-b border-[var(--border-subtle)]">
                <span className="text-sm font-medium text-[var(--text-secondary)]">Loan Preparedness</span>
                <span className="text-sm font-bold text-[var(--text-primary)]">{loan.loanPreparedness}%</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium text-[var(--text-secondary)]">Location</span>
                <span className="text-sm font-bold text-[var(--text-primary)]">{loan.city}, {loan.state}</span>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
