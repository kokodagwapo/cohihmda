import React, { useMemo, useState } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Dialog } from '@/components/ui/dialog';
import { LoanDrilldownModal } from '@/components/dashboard/LoanDrilldownModal';
import { transformLoanToCard, type LoanCard } from '@/utils/loanDataTransform';
import { PeriodValue, inferLoanStatus, isFundedInPeriod, isLikelyCloseLate, getLoanAmountNumber } from '@/utils/closingFalloutFilters';

export type OutcomeModalType = 'withdraw' | 'decline' | 'delayed' | 'fallout';

const OUTCOME_UI: Record<OutcomeModalType, { title: string; subtitle: string; description: string; color: 'amber' | 'rose' | 'orange'; icon: React.ReactNode }> = {
  fallout: {
    title: 'Predicted Fallout',
    subtitle: 'All At-Risk Loans',
    description: 'Loans predicted to either withdraw (borrower decision) or decline (lender decision) based on AI analysis.',
    color: 'rose',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
      </svg>
    ),
  },
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
    description: 'Active loans predicted to close late based on pipeline stage, estimated closing date, and historical on-time closing rates.',
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

function getRiskBadgeClass(riskLabel: 'Critical' | 'Urgent', isDarkMode: boolean) {
  if (riskLabel === 'Critical') return isDarkMode ? 'bg-rose-500/15 text-rose-400' : 'bg-rose-50 text-rose-600 border border-rose-100';
  return isDarkMode ? 'bg-amber-500/15 text-amber-400' : 'bg-amber-50 text-amber-600 border border-amber-100';
}

/** Compute prediction-service risk score (40-100) from bucketed loan signals */
function computePredictionRiskScore(loan: any): number {
  const signals = [
    loan.creditMetricsSignalStrength,
    loan.loanCharacteristicsSignalStrength,
    loan.timeInMotionSignalStrength,
    loan.mloAeFalloutProneSignalStrength,
    loan.interestLockVsMarketSignalStrength,
  ].filter((s): s is number => typeof s === 'number' && !isNaN(s));

  if (signals.length === 0) {
    return loan.riskSummary?.confidence ?? 75;
  }
  const avgSignal = signals.reduce((sum, s) => sum + s, 0) / signals.length;
  const severeCount = signals.filter((s) => s >= 5).length;
  const elevatedCount = signals.filter((s) => s >= 4).length;
  let bucket: 'low' | 'medium' | 'high';
  if (severeCount >= 3) bucket = 'high';
  else if (severeCount >= 2 || elevatedCount >= 2 || avgSignal >= 5) bucket = 'medium';
  else if (avgSignal <= 3) bucket = 'low';
  else bucket = 'medium';

  let riskScore: number;
  if (bucket === 'low') riskScore = Math.round(40 + (avgSignal / 3) * 15);
  else if (bucket === 'medium') riskScore = Math.round(55 + (avgSignal / 6) * 20);
  else riskScore = Math.round(75 + (avgSignal / 6) * 25);
  return Math.min(100, Math.max(40, riskScore));
}

/** Map prediction risk score to Critical (>95) or Urgent (≤95) */
function getRiskLabel(loan: any): 'Critical' | 'Urgent' {
  const riskScore = computePredictionRiskScore(loan);
  return riskScore > 95 ? 'Critical' : 'Urgent';
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
  /** Map of loan_id -> predicted outcome string ('withdraw' | 'deny' | 'originate') */
  loanPredictions?: Record<string, string>;
  /** Bucketed loans from predictions (already have riskSummary attached) */
  bucketedLoans?: any[];
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
  loanPredictions = {},
  bucketedLoans = [],
}: OutcomeLoansModalProps) {
  const [selectedLoan, setSelectedLoan] = useState<LoanCard | null>(null);

  const config = outcomeType ? OUTCOME_UI[outcomeType] : null;

  const filtered = useMemo(() => {
    if (!outcomeType) return [];

    const now = new Date();

    // For fallout/withdraw/decline, use PREDICTED outcomes from loanPredictions or bucketedLoans
    if (outcomeType === 'fallout' || outcomeType === 'withdraw' || outcomeType === 'decline') {
      // fallout = both withdraw and deny, otherwise specific outcome
      const targetOutcomes = outcomeType === 'fallout' 
        ? ['withdraw', 'deny'] 
        : [outcomeType === 'withdraw' ? 'withdraw' : 'deny'];
      
      // First try bucketedLoans (they have full riskSummary data)
      if (bucketedLoans && bucketedLoans.length > 0) {
        return bucketedLoans.filter((l) => {
          // Get predicted outcome from riskSummary or loanPredictions map (which stores just the outcome string)
          const predicted = l.riskSummary?.predictedOutcome || loanPredictions[l.loan_id];
          return targetOutcomes.includes(predicted);
        });
      }
      
      // Fall back to loansRaw + loanPredictions map (loanPredictions is loan_id -> outcome string)
      if (loansRaw && Object.keys(loanPredictions).length > 0) {
        return loansRaw.filter((l) => {
          const loanId = l.loan_id || l.loanId || l.id;
          const predictedOutcome = loanPredictions[loanId]; // This is the outcome string directly
          return predictedOutcome && targetOutcomes.includes(predictedOutcome);
        });
      }
      
      // No predictions available - show empty
      return [];
    }

    // For delayed (Likely Close Late), prefer server-computed closeLateRisk from bucketedLoans
    if (bucketedLoans && bucketedLoans.length > 0) {
      return bucketedLoans.filter((l) => l.closeLateRisk === true);
    }

    // Fallback: use heuristic on raw loans
    if (!loansRaw) return [];
    
    const matches = loansRaw.filter((l) => isLikelyCloseLate(l, 30, now));
    // Exclude already funded loans
    return matches.filter((l) => !isFundedInPeriod(l, dateFilter));
  }, [outcomeType, loansRaw, dateFilter, loanPredictions, bucketedLoans]);

  const cards = useMemo(() => {
    return filtered.map((loan) => {
      const base = transformLoanToCard(loan);
      // Use prediction-service risk for Critical/Urgent label (no numeric score shown)
      const riskLabel = loan.creditMetricsSignalStrength != null || loan.riskSummary?.confidence != null
        ? getRiskLabel(loan)
        : 'Urgent'; // Fallback for loansRaw/delayed (no signal data)
      return { ...base, riskLabel } as LoanCard & { riskLabel: 'Critical' | 'Urgent' };
    });
  }, [filtered]);

  // Calculate summary stats
  const summaryStats = useMemo(() => {
    const totalVolume = filtered.reduce((sum, l) => sum + getLoanAmountNumber(l), 0);
    const withdrawCount = filtered.filter(l => {
      const predicted = l.riskSummary?.predictedOutcome || loanPredictions[l.loan_id];
      return predicted === 'withdraw';
    }).length;
    const declineCount = filtered.filter(l => {
      const predicted = l.riskSummary?.predictedOutcome || loanPredictions[l.loan_id];
      return predicted === 'deny';
    }).length;
    
    return {
      count: filtered.length,
      volume: totalVolume,
      volumeFormatted: totalVolume >= 1_000_000 
        ? `$${(totalVolume / 1_000_000).toFixed(1)}M` 
        : totalVolume >= 1_000 
          ? `$${(totalVolume / 1_000).toFixed(0)}K`
          : `$${Math.round(totalVolume).toLocaleString()}`,
      withdrawCount,
      declineCount,
    };
  }, [filtered, loanPredictions]);

  return (
    <>
      <Dialog open={open} onOpenChange={(isOpen) => onOpenChange(isOpen)}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay
            className={`fixed inset-0 z-[80] backdrop-blur-sm animate-in fade-in duration-300 ${
              isDarkMode ? 'bg-black/60' : 'bg-black/20'
            }`}
          />
          <DialogPrimitive.Content
            className={`fixed left-[50%] z-[90] w-full translate-x-[-50%] animate-in duration-300 data-[state=open]:slide-in-from-bottom sm:data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 h-[90vh] top-auto bottom-0 sm:top-[5vh] sm:bottom-auto sm:translate-y-0 outline-none flex flex-col ${
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
            <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5">
              {/* Summary Stats */}
              {!loansLoading && !loansError && cards.length > 0 && (
                <div className="grid grid-cols-2 gap-3 sm:gap-4">
                  <div className={`p-5 rounded-xl text-center overflow-hidden border ${isDarkMode ? 'bg-slate-800/50 border-slate-700' : 'bg-white border-slate-200 shadow-sm'}`}>
                    <p className={`text-[10px] font-medium uppercase tracking-widest mb-2 ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>
                      {outcomeType === 'fallout' ? 'Total Fallout' : outcomeType === 'withdraw' ? 'Likely Withdrawals' : outcomeType === 'decline' ? 'Likely Declines' : 'Delayed Loans'}
                    </p>
                    <p className={`text-2xl sm:text-3xl font-extralight tracking-tight tabular-nums ${isDarkMode ? 'text-slate-100' : 'text-slate-800'}`}>
                      {summaryStats.count.toLocaleString()}
                    </p>
                    {outcomeType === 'fallout' && (
                      <p className={`mt-2 text-[11px] ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>
                        {summaryStats.withdrawCount} withdraw · {summaryStats.declineCount} decline
                      </p>
                    )}
                  </div>

                  <div className={`p-5 rounded-xl text-center overflow-hidden border ${isDarkMode ? 'bg-slate-800/50 border-slate-700' : 'bg-white border-slate-200 shadow-sm'}`}>
                    <p className={`text-[10px] font-medium uppercase tracking-widest mb-2 ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>At-Risk Volume</p>
                    <p className={`text-2xl sm:text-3xl font-extralight tracking-tight tabular-nums ${isDarkMode ? 'text-slate-100' : 'text-slate-800'}`}>
                      {summaryStats.volumeFormatted}
                    </p>
                    <p className={`mt-2 text-[11px] ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>
                      Pipeline at risk
                    </p>
                  </div>
                </div>
              )}

              {/* Loan List */}
              {loansError ? (
                <div className="text-sm text-rose-500 py-10 text-center">{loansError}</div>
              ) : loansLoading ? (
                <div className={`text-sm py-10 text-center ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>Loading loans…</div>
              ) : !outcomeType ? (
                <div className={`text-sm py-10 text-center ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>No category selected.</div>
              ) : cards.length === 0 ? (
                <div className={`text-center py-12 ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
                  <svg className="w-12 h-12 mx-auto mb-3 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <p className="font-medium">No loans in this category</p>
                  <p className="text-sm mt-1 opacity-70">Run predictions to see at-risk loans</p>
                </div>
              ) : (
                <div className={`rounded-xl border overflow-hidden ${isDarkMode ? 'bg-slate-800/40 border-slate-700' : 'bg-white border-slate-200 shadow-sm'}`}>
                  <div className={`px-5 py-4 border-b ${isDarkMode ? 'border-slate-700' : 'border-slate-100'}`}>
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className={`text-[10px] font-semibold uppercase tracking-widest ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>At-Risk Loans</p>
                        <p className={`text-[11px] font-normal mt-1 truncate ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>Click a loan for details</p>
                      </div>
                      <span className={`text-[10px] px-2.5 py-1 rounded-md font-medium flex-shrink-0 ${isDarkMode ? 'bg-white/10 text-slate-300' : 'bg-slate-50 text-slate-600 border border-slate-200'}`}>
                        {cards.length} loans
                      </span>
                    </div>
                  </div>
                  <div className="p-4 space-y-3">
                  {cards.map((loan) => {
                    const colors = config ? getColorClasses(config.color, isDarkMode) : null;
                    const riskLabel = (loan as LoanCard & { riskLabel?: 'Critical' | 'Urgent' }).riskLabel ?? 'Urgent';
                    const badge = getRiskBadgeClass(riskLabel, isDarkMode);
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
                            <div className="min-w-0 flex-1">
                              <p className={`font-medium text-[13px] sm:text-sm tracking-tight break-words ${isDarkMode ? 'text-slate-100' : 'text-slate-800'}`}>
                                Loan #{(() => {
                                  const num = loan.loan_number?.trim();
                                  if (!num) return '—';
                                  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(num)) return '—';
                                  return num;
                                })()}
                              </p>
                            </div>
                          </div>
                          <div className="text-right flex-shrink-0">
                            <p className={`font-semibold text-base tracking-tight ${isDarkMode ? 'text-slate-50' : 'text-slate-800'}`}>{loan.amount}</p>
                            <span className={`text-[9px] font-medium px-2 py-0.5 rounded-md inline-block mt-1 ${badge}`}>
                              {riskLabel}
                            </span>
                          </div>
                        </div>

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

