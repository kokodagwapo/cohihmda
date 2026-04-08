import React, { useMemo, useState } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { LoanDrilldownModal } from '@/components/dashboard/LoanDrilldownModal';
import { LoanCardContent, type LoanCardContentLoan } from '@/components/dashboard/LoanCardContent';
import { CohiInsightsBlock, CohiSectionCard } from '@/components/dashboard/CohiInsightsBlock';
import { transformLoanToCard, type LoanCard } from '@/utils/loanDataTransform';
import { PeriodValue, getLoanAmountNumber, inferLoanStatus, isFundedInPeriod } from '@/utils/closingFalloutFilters';
import { generateCohiInsightsForMetric, type MetricKey } from '@/utils/CohiInsights';

function normalizeMetricLabel(label: string): MetricKey | null {
  if (label.startsWith('Funded Loans')) return 'Funded Loans';
  if (label === 'Active Loans Today') return 'Active Loans Today';
  if (label === 'Predicted Closing') return 'Predicted Closing';
  if (label === 'Predicted Fallout') return 'Predicted Fallout';
  return null;
}

const METRIC_CONTENT: Record<MetricKey, { title: string; description: string }> = {
  'Active Loans Today': {
    title: 'Active Pipeline Intelligence',
    description:
      'Real-time snapshot of loans currently in the production pipeline across all stages. Useful for understanding workload, resource allocation, and revenue potential.',
  },
  'Funded Loans': {
    title: 'Production Output',
    description:
      'Loans successfully funded and closed during the selected period. This is the core realized production metric for revenue recognition and operational performance.',
  },
  'Predicted Closing': {
    title: 'Closing Forecast Intelligence',
    description:
      'Projected number of loans expected to close based on current pipeline health and historical conversion rates. Use this to anticipate volume and identify bottlenecks.',
  },
  'Predicted Fallout': {
    title: 'Fallout Risk Analysis',
    description:
      'Forecasted pipeline leakage. Use this view to understand drivers of fallout (withdrawn/denied) and prioritize intervention to protect revenue.',
  },
};

function formatMoneyShort(value: number): string {
  if (!Number.isFinite(value)) return '$0';
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${Math.round(value).toLocaleString()}`;
}

export interface ClosingFalloutMetricModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  label: string | null;
  dateFilter: PeriodValue;
  isDarkMode: boolean;
  loansRaw: any[] | null;
  loansLoading?: boolean;
  loansError?: string | null;
  headlineValue?: number; // the tile number being drilled into
  subLabel?: string; // small text under tile number (e.g. "$xxM Pipeline")
  /** Fallback active volume when loansRaw is empty (from statsData.activeVolume) */
  fallbackActiveVolume?: number;
  /** Fallback active count when loansRaw is empty (from statsData.active) */
  fallbackActiveCount?: number;
  /** When label is "High Risk", list of loans (card shape) and total volume for modal */
  highRiskLoans?: LoanCardContentLoan[];
  highRiskVolume?: number;
}

export function ClosingFalloutMetricModal({
  open,
  onOpenChange,
  label,
  dateFilter,
  isDarkMode,
  loansRaw,
  loansLoading = false,
  loansError = null,
  headlineValue,
  subLabel,
  fallbackActiveVolume,
  fallbackActiveCount,
  highRiskLoans,
  highRiskVolume = 0,
}: ClosingFalloutMetricModalProps) {
  const [selectedLoan, setSelectedLoan] = useState<LoanCard | LoanCardContentLoan | null>(null);

  const metricKey = useMemo(() => (label ? normalizeMetricLabel(label) : null), [label]);
  const content = metricKey ? METRIC_CONTENT[metricKey] : null;

  const computed = useMemo(() => {
    const loans = loansRaw ?? [];

    const activeLoans = loans.filter((l) => {
      const s = inferLoanStatus(l);
      return s === 'Active' || s === 'Locked';
    });

    const fundedLoans = loans.filter((l) => isFundedInPeriod(l, dateFilter));

    const withdrawnLoans = loans.filter((l) => inferLoanStatus(l) === 'Withdrawn');
    const deniedLoans = loans.filter((l) => inferLoanStatus(l) === 'Denied');

    const activeVolume = activeLoans.reduce((sum, l) => sum + getLoanAmountNumber(l), 0);
    const fundedVolume = fundedLoans.reduce((sum, l) => sum + getLoanAmountNumber(l), 0);
    const falloutVolume = withdrawnLoans.reduce((sum, l) => sum + getLoanAmountNumber(l), 0) + deniedLoans.reduce((sum, l) => sum + getLoanAmountNumber(l), 0);

    return {
      active: { count: activeLoans.length, volume: activeVolume, loans: activeLoans },
      funded: { count: fundedLoans.length, volume: fundedVolume, loans: fundedLoans },
      fallout: {
        count: withdrawnLoans.length + deniedLoans.length,
        volume: falloutVolume,
        withdrawnCount: withdrawnLoans.length,
        deniedCount: deniedLoans.length,
      },
    };
  }, [loansRaw, dateFilter]);

  const isHighRiskMode = label === 'High Risk' && highRiskLoans != null;

  const priorityLoansRaw = useMemo(() => {
    if (isHighRiskMode) return [];
    if (!metricKey || !loansRaw) return [];

    let base: any[] = loansRaw;
    if (metricKey === 'Active Loans Today' || metricKey === 'Predicted Closing') {
      base = loansRaw.filter((l) => ['Active', 'Locked'].includes(inferLoanStatus(l)));
    } else if (metricKey === 'Funded Loans') {
      base = loansRaw.filter((l) => isFundedInPeriod(l, dateFilter));
    } else if (metricKey === 'Predicted Fallout') {
      base = loansRaw.filter((l) => ['Withdrawn', 'Denied'].includes(inferLoanStatus(l)));
    }

    return base
      .map((l) => ({ loan: l, risk: transformLoanToCard(l).riskScore ?? 0 }))
      .sort((a, b) => b.risk - a.risk)
      .slice(0, 8)
      .map((x) => x.loan);
  }, [metricKey, loansRaw, dateFilter, isHighRiskMode]);

  const priorityLoans = useMemo(() => {
    return priorityLoansRaw.map(transformLoanToCard);
  }, [priorityLoansRaw]);

  const title = isHighRiskMode
    ? 'High Risk Loans'
    : (content?.title || label || '');
  const description = isHighRiskMode
    ? 'Predicted withdraw or decline with risk score ≥ 80/100. Sorted by risk score.'
    : (content?.description || '');

  const CohiInsights = useMemo(() => {
    if (!metricKey) return null;
    // Use fallbacks when computed values are 0 (e.g. loansRaw empty or still loading)
    const activeCount = (computed.active.count || fallbackActiveCount) ?? 0;
    const activeVolume = (computed.active.volume || fallbackActiveVolume) ?? 0;
    return generateCohiInsightsForMetric({
      metricKey,
      loansRaw,
      dateFilter,
      headlineValue,
      computed: {
        activeCount: activeCount || undefined,
        activeVolume: activeVolume || undefined,
        fundedCount: computed.funded.count,
        fundedVolume: computed.funded.volume,
        falloutCount: computed.fallout.count,
        falloutVolume: computed.fallout.volume,
      },
      priorityLoansRaw,
    });
  }, [metricKey, loansRaw, dateFilter, headlineValue, computed, priorityLoansRaw, fallbackActiveCount, fallbackActiveVolume]);

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
                ? 'bg-[#0B0F1A] shadow-[0_25px_60px_-15px_rgba(15,23,42,0.4)] border-white/10'
                : 'bg-white shadow-[0_20px_50px_-12px_rgba(15,23,42,0.1)] border-slate-200'
            } rounded-t-xl sm:rounded-xl md:rounded-xl border-t sm:border overflow-hidden sm:max-w-4xl`}
          >
            <div className={`px-4 sm:px-6 md:px-8 py-4 sm:py-5 md:py-6 border-b flex items-center justify-between gap-3 ${isDarkMode ? 'border-white/10' : 'border-slate-100'}`}>
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <div className="w-1 h-5 sm:hidden bg-slate-300 dark:bg-slate-600 rounded-full"></div>
                <h2 className={`text-[13px] sm:text-[14px] font-semibold uppercase tracking-widest truncate ${isDarkMode ? 'text-slate-200' : 'text-slate-600'}`}>
                  {title}
                </h2>
              </div>
              <DialogPrimitive.Close
                className={`p-2 sm:p-2.5 rounded-lg transition-all active:scale-95 flex-shrink-0 ${isDarkMode ? 'hover:bg-white/10 active:bg-white/15 text-slate-400 hover:text-slate-200' : 'hover:bg-slate-100 active:bg-slate-200 text-slate-400 hover:text-slate-600'}`}
              >
                <X className="h-5 w-5 sm:h-6 sm:w-6" />
                <span className="sr-only">Close</span>
              </DialogPrimitive.Close>
            </div>

            <div className="p-4 sm:p-6 md:p-8 flex-1 overflow-y-auto overscroll-contain space-y-5">
              {description && (
                <p className={`text-[12px] sm:text-[13px] leading-relaxed ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
                  {description}
                </p>
              )}

              {/* Cohi - Success/Warning/Critical at top */}
              {metricKey && CohiInsights && (
                <CohiInsightsBlock
                  insights={CohiInsights}
                  isDarkMode={isDarkMode}
                  subtitle={title}
                  loading={loansLoading}
                  emptyText="No insights available for this metric."
                  filterSections={['Success', 'Warning', 'Critical']}
                />
              )}

              {/* Hero */}
              <div className="grid grid-cols-2 gap-3 sm:gap-4">
                <div className={`p-5 rounded-xl text-center overflow-hidden border ${isDarkMode ? 'bg-slate-800/50 border-slate-700' : 'bg-white border-slate-200 shadow-sm'}`}>
                  <p className={`text-[10px] font-medium uppercase tracking-widest mb-2 ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>Selected Metric</p>
                  <p className={`text-2xl sm:text-3xl font-extralight tracking-tight tabular-nums ${isDarkMode ? 'text-slate-100' : 'text-slate-800'}`}>
                    {headlineValue !== undefined ? headlineValue.toLocaleString() : '—'}
                  </p>
                  {subLabel && <p className={`mt-2 text-[11px] ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>{subLabel}</p>}
                </div>

                <div className={`p-5 rounded-xl text-center overflow-hidden border ${isDarkMode ? 'bg-slate-800/50 border-slate-700' : 'bg-white border-slate-200 shadow-sm'}`}>
                  <p className={`text-[10px] font-medium uppercase tracking-widest mb-2 ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>Computed Volume</p>
                  <p className={`text-2xl sm:text-3xl font-extralight tracking-tight tabular-nums ${isDarkMode ? 'text-slate-100' : 'text-slate-800'}`}>
                    {isHighRiskMode
                      ? formatMoneyShort(highRiskVolume ?? 0)
                      : metricKey === 'Active Loans Today'
                        ? formatMoneyShort((computed.active.volume || fallbackActiveVolume) ?? 0)
                        : metricKey === 'Funded Loans'
                          ? formatMoneyShort(computed.funded.volume)
                          : metricKey === 'Predicted Fallout'
                            ? formatMoneyShort(computed.fallout.volume)
                            : metricKey === 'Predicted Closing'
                              ? (() => {
                                  const activeCount = (computed.active.count || fallbackActiveCount) ?? 0;
                                  const activeVolume = (computed.active.volume || fallbackActiveVolume) ?? 0;
                                  const predictedCount = headlineValue ?? 0;
                                  const vol = activeCount > 0 && predictedCount > 0
                                    ? (predictedCount / activeCount) * activeVolume
                                    : 0;
                                  return formatMoneyShort(vol);
                                })()
                              : formatMoneyShort((computed.active.volume || fallbackActiveVolume) ?? 0)}
                  </p>
                  <p className={`mt-2 text-[11px] ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>
                    {isHighRiskMode
                      ? `${highRiskLoans?.length ?? 0} high-risk loans`
                      : metricKey === 'Predicted Fallout'
                        ? `${computed.fallout.withdrawnCount} withdrawn · ${computed.fallout.deniedCount} denied`
                        : metricKey === 'Funded Loans'
                          ? `${computed.funded.count} funded loans in period`
                          : metricKey === 'Predicted Closing'
                            ? `${headlineValue ?? 0} loans predicted to close`
                            : `${(computed.active.count || fallbackActiveCount) ?? 0} active/locked loans`}
                  </p>
                </div>
              </div>

              {/* Priority loans */}
              <div className={`rounded-xl border overflow-hidden ${isDarkMode ? 'bg-slate-800/40 border-slate-700' : 'bg-white border-slate-200 shadow-sm'}`}>
                <div className={`px-5 py-4 border-b ${isDarkMode ? 'border-slate-700' : 'border-slate-100'}`}>
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className={`text-[10px] font-semibold uppercase tracking-widest ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>Priority Loans</p>
                      <p className={`text-[11px] font-normal mt-1 truncate ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>Click a loan for details</p>
                    </div>
                    <span className={`text-[10px] px-2.5 py-1 rounded-md font-medium flex-shrink-0 ${isDarkMode ? 'bg-white/10 text-slate-300' : 'bg-slate-50 text-slate-600 border border-slate-200'}`}>
                      {isHighRiskMode
                        ? `${highRiskLoans?.length ?? 0} loans`
                        : (loansLoading ? 'Loading…' : `${priorityLoans.length} loans`)}
                    </span>
                  </div>
                </div>

                <div className="p-4">
                  {isHighRiskMode ? (
                    highRiskLoans == null || highRiskLoans.length === 0 ? (
                      <div className={`text-sm py-10 text-center ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>No loans match this metric.</div>
                    ) : (
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-2 sm:gap-3 lg:gap-4">
                        {highRiskLoans.map((loan) => (
                          <div
                            key={loan.id}
                            onClick={() => setSelectedLoan(loan)}
                            className={`p-3 sm:p-4 lg:p-5 rounded-lg sm:rounded-xl overflow-hidden cursor-pointer transition-all hover:shadow-md active:scale-[0.99] ${
                              isDarkMode
                                ? 'bg-slate-800/50 border border-slate-700 hover:bg-slate-800'
                                : 'bg-white border border-slate-200 shadow-[0_1px_4px_rgba(0,0,0,0.04)] hover:shadow-[0_2px_8px_rgba(0,0,0,0.06)]'
                            }`}
                          >
                            <LoanCardContent
                              loan={loan}
                              isDarkMode={isDarkMode}
                              showTapForDetails
                              compact
                            />
                          </div>
                        ))}
                      </div>
                    )
                  ) : loansError ? (
                    <div className="text-sm text-rose-500 py-6 text-center">{loansError}</div>
                  ) : loansLoading ? (
                    <div className={`text-sm py-10 text-center ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>Loading loans…</div>
                  ) : !loansRaw || loansRaw.length === 0 ? (
                    <div className={`text-sm py-10 text-center ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>No loans available.</div>
                  ) : priorityLoans.length === 0 ? (
                    <div className={`text-sm py-10 text-center ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>No loans match this metric.</div>
                  ) : (
                    <div className="space-y-3">
                      {priorityLoans.map((loan) => (
                        <button
                          key={loan.id}
                          onClick={() => setSelectedLoan(loan)}
                          className={`w-full text-left p-4 rounded-lg border cursor-pointer transition-all hover:shadow-sm active:scale-[0.99] ${isDarkMode ? 'bg-slate-800/50 border-slate-700 hover:bg-slate-800' : 'bg-white border-slate-200 hover:border-slate-300 shadow-sm'}`}
                        >
                          <div className="flex items-start justify-between gap-4 mb-2">
                            <div className="min-w-0 flex-1">
                              <p className={`text-[8px] uppercase tracking-widest font-semibold mb-0.5 ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>
                                {loan.borrower === 'Unknown' || loan.borrower === loan.officer ? 'Loan Officer' : 'Borrower'}
                              </p>
                              <p className={`font-medium text-[14px] tracking-tight truncate ${isDarkMode ? 'text-slate-50' : 'text-slate-800'}`}>
                                {loan.borrower}
                              </p>
                              <p className={`text-[10px] font-normal truncate mt-0.5 ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>
                                Loan #{loan.loan_number || loan.id}{loan.borrower !== loan.officer && loan.officer !== 'Unassigned' ? ` · Loan Officer: ${loan.officer}` : ''}
                              </p>
                            </div>
                            <div className="text-right flex-shrink-0">
                              <p className={`font-semibold text-base tracking-tight ${isDarkMode ? 'text-slate-50' : 'text-slate-800'}`}>{loan.amount}</p>
                              <span className={`text-[9px] font-medium px-2 py-0.5 rounded-md inline-block mt-1 ${isDarkMode ? 'bg-white/10 text-slate-300' : 'bg-slate-50 text-slate-600 border border-slate-200'}`}>
                                Risk {loan.riskScore}/100
                              </span>
                            </div>
                          </div>
                          <p className={`text-[12px] font-normal line-clamp-2 leading-relaxed ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
                            {loan.reason}
                          </p>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* TopTiering Insights for Loan Officers - at bottom */}
              {metricKey && CohiInsights && (() => {
                const topTieringSection = CohiInsights.sections.find((s) => s.title === 'TopTiering Insights for Loan Officers');
                return topTieringSection && topTieringSection.items.length > 0 ? (
                  <CohiSectionCard section={topTieringSection} isDarkMode={isDarkMode} />
                ) : null;
              })()}

              {/* Borrower Coaching - at bottom */}
              {metricKey && CohiInsights && (() => {
                const borrowerCoachingSection = CohiInsights.sections.find((s) => s.title === 'Borrower Coaching');
                return borrowerCoachingSection && borrowerCoachingSection.items.length > 0 ? (
                  <CohiSectionCard section={borrowerCoachingSection} isDarkMode={isDarkMode} />
                ) : null;
              })()}
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

