import React, { useMemo, useState } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Dialog } from '@/components/ui/dialog';
import { LoanDrilldownModal } from '@/components/dashboard/LoanDrilldownModal';
import { transformLoanToCard, type LoanCard } from '@/utils/loanDataTransform';
import { PeriodValue, inferLoanStatus, isFundedInPeriod, isLikelyCloseLate } from '@/utils/closingFalloutFilters';

export type OutcomeModalType = 'withdraw' | 'decline' | 'delayed';

const OUTCOME_UI: Record<OutcomeModalType, { title: string; subtitle: string; description: string; color: 'amber' | 'rose' | 'orange'; icon: React.ReactNode }> = {
  withdraw: {
    title: 'Likely Withdraw',
    subtitle: 'Borrower Says No',
    description: "Borrower decision - often rate shopping, buyer’s remorse, or choosing a competitor.",
    color: 'amber',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
      </svg>
    ),
  },
  decline: {
    title: 'Likely Decline',
    subtitle: 'Lender Says No',
    description: 'Lender decision - underwriting denial, credit issues, or documentation requirements.',
    color: 'rose',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
      </svg>
    ),
  },
  delayed: {
    title: 'Likely Close Late',
    subtitle: 'Pipeline Stagnation',
    description: 'Active/locked loans that appear past an expected closing window (heuristic-based).',
    color: 'orange',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
};

function getColorClasses(color: 'amber' | 'rose' | 'orange', isDarkMode: boolean) {
  switch (color) {
    case 'rose':
      return {
        bg: isDarkMode ? 'bg-rose-500/10' : 'bg-rose-50',
        border: isDarkMode ? 'border-rose-500/30' : 'border-rose-200',
        text: isDarkMode ? 'text-rose-400' : 'text-rose-600',
        badge: isDarkMode ? 'bg-rose-500/15 text-rose-400' : 'bg-rose-50 text-rose-600 border border-rose-100',
      };
    case 'orange':
      return {
        bg: isDarkMode ? 'bg-orange-500/10' : 'bg-orange-50',
        border: isDarkMode ? 'border-orange-500/30' : 'border-orange-200',
        text: isDarkMode ? 'text-orange-400' : 'text-orange-600',
        badge: isDarkMode ? 'bg-orange-500/15 text-orange-400' : 'bg-orange-50 text-orange-600 border border-orange-100',
      };
    default:
      return {
        bg: isDarkMode ? 'bg-amber-500/10' : 'bg-amber-50',
        border: isDarkMode ? 'border-amber-500/30' : 'border-amber-200',
        text: isDarkMode ? 'text-amber-400' : 'text-amber-600',
        badge: isDarkMode ? 'bg-amber-500/15 text-amber-400' : 'bg-amber-50 text-amber-600 border border-amber-100',
      };
  }
}

function getRiskBadgeClass(riskLevel: string, isDarkMode: boolean) {
  if (riskLevel === 'Very High') return isDarkMode ? 'bg-rose-500/15 text-rose-400' : 'bg-rose-50 text-rose-600 border border-rose-100';
  if (riskLevel === 'Medium') return isDarkMode ? 'bg-amber-500/15 text-amber-400' : 'bg-amber-50 text-amber-600 border border-amber-100';
  return isDarkMode ? 'bg-emerald-500/15 text-emerald-400' : 'bg-emerald-50 text-emerald-600 border border-emerald-100';
}

export interface OutcomeLoansModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  outcomeType: OutcomeModalType | null;
  dateFilter: PeriodValue;
  isDarkMode: boolean;
  loansRaw: any[] | null;
  loansLoading?: boolean;
  loansError?: string | null;
}

export function OutcomeLoansModal({
  open,
  onOpenChange,
  outcomeType,
  dateFilter,
  isDarkMode,
  loansRaw,
  loansLoading = false,
  loansError = null,
}: OutcomeLoansModalProps) {
  const [selectedLoan, setSelectedLoan] = useState<LoanCard | null>(null);

  const config = outcomeType ? OUTCOME_UI[outcomeType] : null;

  const filtered = useMemo(() => {
    if (!outcomeType || !loansRaw) return [];

    const now = new Date();

    const matches = loansRaw.filter((l) => {
      if (outcomeType === 'withdraw') {
        return inferLoanStatus(l) === 'Withdrawn';
      }
      if (outcomeType === 'decline') {
        return inferLoanStatus(l) === 'Denied';
      }
      // delayed
      return isLikelyCloseLate(l, 30, now);
    });

    // For context, keep this list focused on active-ish time horizon by excluding already funded loans in the selected period.
    // (Withdraw/Decline are fallout outcomes and can have closing_date; if they do, keep them anyway.)
    if (outcomeType === 'delayed') {
      return matches.filter((l) => !isFundedInPeriod(l, dateFilter));
    }

    return matches;
  }, [outcomeType, loansRaw, dateFilter]);

  const cards = useMemo(() => filtered.map(transformLoanToCard), [filtered]);

  return (
    <>
      <Dialog open={open} onOpenChange={(isOpen) => onOpenChange(isOpen)}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay
            className={`fixed inset-0 z-[60] backdrop-blur-sm animate-in fade-in duration-300 ${
              isDarkMode ? 'bg-black/60' : 'bg-black/20'
            }`}
          />
          <DialogPrimitive.Content
            className={`fixed left-[50%] z-[70] w-full translate-x-[-50%] animate-in duration-300 data-[state=open]:slide-in-from-bottom sm:data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 h-[90vh] top-auto bottom-0 sm:top-[5vh] sm:bottom-auto sm:translate-y-0 outline-none flex flex-col ${
              isDarkMode
                ? 'bg-slate-900 shadow-[0_25px_60px_-15px_rgba(15,23,42,0.4)] border-white/10'
                : 'bg-white shadow-[0_25px_60px_-15px_rgba(15,23,42,0.12)] border-slate-200'
            } rounded-t-xl sm:rounded-xl border-t sm:border overflow-hidden sm:max-w-2xl`}
          >
            {/* Header (fallout style) */}
            <div className={`sticky top-0 z-10 p-5 border-b ${isDarkMode ? 'bg-slate-900 border-slate-700' : 'bg-white border-slate-100'}`}>
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  {config ? (
                    (() => {
                      const colors = getColorClasses(config.color, isDarkMode);
                      return (
                        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${colors.bg} ${colors.border} border`}>
                          <span className={colors.text}>{config.icon}</span>
                        </div>
                      );
                    })()
                  ) : null}
                  <div>
                    <h2 className={`text-[15px] font-semibold tracking-tight ${isDarkMode ? 'text-white' : 'text-slate-800'}`}>
                      {config ? config.title : 'Loans'}
                    </h2>
                    {config && (
                      <p className={`text-[12px] font-normal ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
                        {config.subtitle} - {loansLoading ? 'Loading…' : `${cards.length} loans`}
                      </p>
                    )}
                  </div>
                </div>
                <DialogPrimitive.Close
                  className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${isDarkMode ? 'hover:bg-white/10 text-slate-400' : 'hover:bg-slate-100 text-slate-500'}`}
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                  <span className="sr-only">Close</span>
                </DialogPrimitive.Close>
              </div>
              {config && (
                <p className={`mt-3 text-[13px] ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
                  {config.description}
                </p>
              )}
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-4">
              {loansError ? (
                <div className="text-sm text-rose-500 py-10 text-center">{loansError}</div>
              ) : loansLoading ? (
                <div className={`text-sm py-10 text-center ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>Loading loans…</div>
              ) : !outcomeType ? (
                <div className={`text-sm py-10 text-center ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>No category selected.</div>
              ) : !loansRaw || loansRaw.length === 0 ? (
                <div className={`text-sm py-10 text-center ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>No loans available.</div>
              ) : cards.length === 0 ? (
                <div className={`text-center py-12 ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
                  <svg className="w-12 h-12 mx-auto mb-3 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <p className="font-medium">No loans in this category</p>
                  <p className="text-sm mt-1 opacity-70">All loans are performing within expected parameters</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {cards.map((loan) => {
                    const colors = config ? getColorClasses(config.color, isDarkMode) : null;
                    const badge = getRiskBadgeClass(loan.riskLevel, isDarkMode);
                    return (
                      <div
                        key={loan.id}
                        onClick={() => setSelectedLoan(loan)}
                        className={`p-4 rounded-lg border cursor-pointer transition-all hover:shadow-sm active:scale-[0.99] ${
                          isDarkMode ? 'bg-slate-800/50 border-slate-700 hover:bg-slate-800' : 'bg-white border-slate-200 hover:border-slate-300 shadow-sm'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-4 mb-3">
                          <div className="flex items-center gap-3 min-w-0 flex-1">
                            <div className={`w-9 h-9 rounded-md flex items-center justify-center flex-shrink-0 ${isDarkMode ? 'bg-slate-700' : 'bg-slate-100'}`}>
                              <svg className={`w-4 h-4 ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                              </svg>
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className={`text-[8px] uppercase tracking-widest font-semibold mb-0.5 ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>
                                {loan.borrower === 'Unknown' || loan.borrower === loan.officer ? 'Loan Officer' : 'Borrower'}
                              </p>
                              <p className={`font-medium text-[14px] tracking-tight truncate ${isDarkMode ? 'text-slate-50' : 'text-slate-800'}`}>
                                {loan.borrower}
                              </p>
                              <p className={`text-[10px] font-normal truncate mt-0.5 ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>
                                Loan #{loan.id}{loan.borrower !== loan.officer && loan.officer !== 'Unassigned' ? ` · Loan Officer: ${loan.officer}` : ''}
                              </p>
                            </div>
                          </div>
                          <div className="text-right flex-shrink-0">
                            <p className={`font-semibold text-base tracking-tight ${isDarkMode ? 'text-slate-50' : 'text-slate-800'}`}>{loan.amount}</p>
                            <span className={`text-[9px] font-medium px-2 py-0.5 rounded-md inline-block mt-1 ${badge}`}>
                              {loan.riskLevel === 'Very High' ? 'Critical' : loan.riskLevel === 'Medium' ? 'At Risk' : 'Low'}
                            </span>
                          </div>
                        </div>

                        <p className={`text-[12px] font-normal mb-3 line-clamp-2 leading-relaxed ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
                          {loan.reason}
                        </p>

                        <div className={`flex items-center gap-4 pt-3 border-t border-dashed ${isDarkMode ? 'border-slate-700' : 'border-slate-200'}`}>
                          <div className="ml-auto flex items-center gap-1.5">
                            <span className={`text-[11px] font-medium ${isDarkMode ? 'text-slate-400' : colors ? colors.text : 'text-indigo-600'}`}>
                              View Details
                            </span>
                            <svg className={`w-4 h-4 ${isDarkMode ? 'text-slate-500' : colors ? colors.text : 'text-indigo-500'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                            </svg>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </Dialog>

      {selectedLoan && (
        <LoanDrilldownModal
          loan={selectedLoan}
          isOpen={!!selectedLoan}
          onClose={() => setSelectedLoan(null)}
          isDarkMode={isDarkMode}
        />
      )}
    </>
  );
}

