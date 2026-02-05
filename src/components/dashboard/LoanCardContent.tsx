import React, { useState, useCallback, memo } from 'react';
import { Sparkles, Loader2, Heart } from 'lucide-react';
import { api } from '@/lib/api';
import { LoanRiskDistribution } from './LoanRiskDistribution';

export interface LoanCardContentLoan {
  id: string;
  loan_number?: string | null;
  officer: string;
  amount: string;
  amountValue?: number;
  officerTtsScore?: number | null;
  officerTier?: string | null;
  riskLevel: string;
  riskScore: number;
  reason: string;
  ficoScore: number | null;
  ltvRatio: number | null;
  dtiRatio: number | null;
  loanType?: string | null;
  loanPurpose?: string | null;
  channel?: string | null;
  currentMilestone?: string | null;
  activeDays?: number | null;
  interestRate?: number | null;
  marketRate?: number | null;
  lockMarketRate?: number | null;
  marketChangeDelta?: number | null;
  lockDate?: string | null;
  lockExpirationDate?: string | null;
  loPullthroughPct?: number | null;
  uwPullthroughPct?: number | null;
  closerPullthroughPct?: number | null;
  processorPullthroughPct?: number | null;
  riskSummary?: {
    risks: string[];
    positives: string[];
    overallRisk: string;
    predictedOutcome: 'originate' | 'withdraw' | 'deny' | 'at_risk';
    confidence: number;
  } | null;
  creditMetricsSignalStrength?: number | null;
  loanCharacteristicsSignalStrength?: number | null;
  timeInMotionSignalStrength?: number | null;
  mloAeFalloutProneSignalStrength?: number | null;
  interestLockVsMarketSignalStrength?: number | null;
  loPullthroughSignal?: number | null;
  marketChangeDeltaSignal?: number | null;
}

function formatLockExpirationDate(value: string | null | undefined): string {
  if (value == null || value === '') return '';
  try {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return String(value);
  }
}

function getExpirationDateColorClass(expirationDate: string | null | undefined, isDarkMode: boolean): string {
  if (expirationDate == null || expirationDate === '') return isDarkMode ? 'text-slate-100' : 'text-slate-900';
  try {
    const exp = new Date(expirationDate);
    if (Number.isNaN(exp.getTime())) return isDarkMode ? 'text-slate-100' : 'text-slate-900';
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    exp.setHours(0, 0, 0, 0);
    const msPerDay = 24 * 60 * 60 * 1000;
    const daysFromToday = Math.round((exp.getTime() - today.getTime()) / msPerDay);
    if (daysFromToday < 0) return isDarkMode ? 'text-rose-400' : 'text-rose-600';
    if (daysFromToday <= 7) return isDarkMode ? 'text-amber-400' : 'text-amber-600';
    return isDarkMode ? 'text-emerald-400' : 'text-emerald-600';
  } catch {
    return isDarkMode ? 'text-slate-100' : 'text-slate-900';
  }
}

interface LoanCardContentProps {
  loan: LoanCardContentLoan;
  isDarkMode: boolean;
  onSelectOfficer?: (officer: string) => void;
  showTapForDetails?: boolean;
  /** Show WARNING/CRITICAL/Successes breakdown (modal only, not on card) */
  showRiskBreakdown?: boolean;
  /** Compact mode: card shows only up to signal buckets; modal shows full content */
  compact?: boolean;
  isFavorited?: boolean;
  onToggleFavorite?: (e: React.MouseEvent) => void;
  showFavoriteButton?: boolean;
}

export const LoanCardContent = memo(({
  loan,
  isDarkMode,
  onSelectOfficer,
  showTapForDetails = true,
  showRiskBreakdown = false,
  compact = false,
  isFavorited,
  onToggleFavorite,
  showFavoriteButton,
}: LoanCardContentProps) => {
  const [aiRecommendations, setAiRecommendations] = useState<string[] | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  const fetchAiRecommendations = useCallback((e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!loan.id) return;
    setAiLoading(true);
    setAiError(null);
    api.request<{ recommendations: string[] }>(
      `/api/loans/${encodeURIComponent(loan.id)}/recommendations`,
      { method: 'GET' }
    )
      .then((res) => setAiRecommendations(res.recommendations || []))
      .catch((err: any) => setAiError(err.message || 'Failed to get AI recommendations'))
      .finally(() => setAiLoading(false));
  }, [loan.id]);

  const lockVsMarketBucket = loan.interestLockVsMarketSignalStrength ?? (() => {
    const delta = loan.marketChangeDelta ?? (loan.interestRate != null && loan.marketRate != null ? loan.interestRate - loan.marketRate : null);
    if (delta === null || delta === undefined || Number.isNaN(delta)) return null;
    const d = Number(delta);
    if (d <= -0.3) return 1;
    if (d <= -0.1) return 2;
    if (d <= 0.05) return 3;
    if (d <= 0.2) return 4;
    if (d <= 0.5) return 5;
    return 6;
  })();

  const bucketBg = (b: number | null | undefined) => {
    if (b === null || b === undefined) return isDarkMode ? 'bg-slate-700/50' : 'bg-slate-100';
    if (b <= 2) return isDarkMode ? 'bg-emerald-900/30' : 'bg-emerald-50';
    if (b <= 4) return isDarkMode ? 'bg-amber-900/30' : 'bg-amber-50';
    return isDarkMode ? 'bg-rose-900/30' : 'bg-rose-50';
  };
  const bucketText = (b: number | null | undefined) => {
    if (b === null || b === undefined) return isDarkMode ? 'text-slate-400' : 'text-slate-500';
    if (b <= 2) return isDarkMode ? 'text-emerald-400' : 'text-emerald-600';
    if (b <= 4) return isDarkMode ? 'text-amber-400' : 'text-amber-600';
    return isDarkMode ? 'text-rose-400' : 'text-rose-600';
  };

  const hasAnySignal = loan.creditMetricsSignalStrength != null || loan.loanCharacteristicsSignalStrength != null
    || loan.timeInMotionSignalStrength != null || loan.mloAeFalloutProneSignalStrength != null
    || loan.loPullthroughSignal != null || lockVsMarketBucket != null;

  const signalItems: { label: string; value: number | null }[] = [
    { label: 'Credit Metrics', value: loan.creditMetricsSignalStrength ?? null },
    { label: 'Loan Characteristics', value: loan.loanCharacteristicsSignalStrength ?? null },
    { label: 'Time in Motion', value: loan.timeInMotionSignalStrength ?? null },
    { label: 'MLO Fallout Prone', value: loan.mloAeFalloutProneSignalStrength ?? loan.loPullthroughSignal ?? null },
    { label: 'Lock vs Market', value: lockVsMarketBucket },
  ];

  return (
    <>
      <div className={`flex items-start justify-between gap-3 mb-2 sm:mb-3 ${!showTapForDetails ? 'mt-8' : ''}`}>
        <div className="flex items-center gap-2.5 sm:gap-3 min-w-0 flex-1">
          <div className="min-w-0 flex-1">
            <p className={`font-medium text-[13px] sm:text-sm tracking-tight break-words ${isDarkMode ? 'text-slate-100' : 'text-slate-800'}`}>
              Loan #{(() => {
                const num = (loan.loan_number || '').toString().trim();
                if (!num) return '—';
                if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(num)) return '—';
                return num;
              })()}
            </p>
            <p className={`text-[13px] sm:text-sm font-medium mt-0.5 ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
              Estimated commission at risk: {((): string => {
                const amt = loan.amountValue ?? (() => {
                  const s = String(loan.amount);
                  const num = parseFloat(s.replace(/[$,KkMm]/g, '')) || 0;
                  if (s.toLowerCase().includes('m')) return num * 1e6;
                  if (s.toLowerCase().includes('k')) return num * 1000;
                  return num;
                })();
                const format = (val: number) => val >= 1000 ? `$${(val / 1000).toFixed(2)}K` : `$${val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
                const low = amt * 0.005;
                const high = amt * 0.01;
                return `${format(low)} – ${format(high)}`;
              })()}
            </p>
            {onSelectOfficer ? (
              <button
                onClick={(e) => { e.stopPropagation(); onSelectOfficer(loan.officer); }}
                className="text-[13px] sm:text-sm font-medium flex items-center gap-1 hover:underline mt-0.5"
              >
                <span className={`whitespace-nowrap ${isDarkMode ? 'text-slate-300' : 'text-slate-900'}`}>MLO/AE: </span>
                <span className={`whitespace-nowrap ${isDarkMode ? 'text-blue-400' : 'text-blue-600'}`}>{loan.officer || 'Unknown LO'}</span>
                {loan.officerTtsScore != null && !Number.isNaN(loan.officerTtsScore) && (
                  <span className={`flex-shrink-0 text-[13px] sm:text-sm font-medium ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
                    {loan.officerTier === 'top' ? 'Top Tier' : loan.officerTier === 'second' ? 'Second Tier' : 'Bottom Tier'} – {Math.round(loan.officerTtsScore)}
                  </span>
                )}
              </button>
            ) : (
              <p className="text-[13px] sm:text-sm font-medium mt-0.5">
                <span className={isDarkMode ? 'text-slate-300' : 'text-slate-900'}>MLO/AE: </span>
                <span className={isDarkMode ? 'text-blue-400' : 'text-blue-600'}>{loan.officer || 'Unknown LO'}</span>
                {loan.officerTtsScore != null && !Number.isNaN(loan.officerTtsScore) && (
                  <span className={`ml-1 text-[13px] sm:text-sm font-medium ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
                    {loan.officerTier === 'top' ? 'Top Tier' : loan.officerTier === 'second' ? 'Second Tier' : 'Bottom Tier'} – {Math.round(loan.officerTtsScore)}
                  </span>
                )}
              </p>
            )}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1 flex-shrink-0">
          <div className="flex flex-col items-end gap-0.5">
            <p className={`font-semibold text-sm sm:text-base tracking-tight ${isDarkMode ? 'text-slate-100' : 'text-slate-800'}`}>
              Loan Amount: ${loan.amount.replace(/^\$/, '')}
            </p>
          </div>
          <div className="flex flex-col items-end gap-0.5 mt-0.5 shrink-0">
            {loan.riskSummary?.predictedOutcome && loan.riskSummary.predictedOutcome !== 'originate' && (
              <span className={`text-[8px] sm:text-[9px] font-semibold px-1.5 py-0.5 rounded uppercase tracking-wide whitespace-nowrap ${
                loan.riskSummary.predictedOutcome === 'deny'
                  ? (isDarkMode ? 'bg-red-600/30 text-red-300' : 'bg-red-100 text-red-700')
                  : loan.riskSummary.predictedOutcome === 'withdraw'
                    ? (isDarkMode ? 'bg-orange-500/30 text-orange-300' : 'bg-orange-100 text-orange-700')
                    : (isDarkMode ? 'bg-amber-500/30 text-amber-300' : 'bg-amber-100 text-amber-700')
              }`}>
                {loan.riskSummary.predictedOutcome === 'deny' ? '⚠ Likely Decline' :
                 loan.riskSummary.predictedOutcome === 'withdraw' ? '↩ Likely Withdraw' : '⚡ At Risk'}
              </span>
            )}
            <span className={`text-[9px] sm:text-[10px] font-medium px-1.5 sm:px-2 py-0.5 rounded inline-block whitespace-nowrap ${
              loan.riskLevel === 'Very High'
                ? (isDarkMode ? 'bg-rose-500/20 text-rose-400' : 'bg-rose-50 text-rose-600')
                : loan.riskLevel === 'Medium'
                  ? (isDarkMode ? 'bg-amber-500/20 text-amber-400' : 'bg-amber-50 text-amber-600')
                  : (isDarkMode ? 'bg-emerald-500/20 text-emerald-400' : 'bg-emerald-50 text-emerald-600')
            }`}>
              {loan.riskLevel === 'Very High' ? 'CRITICAL' : loan.riskLevel === 'Medium' ? 'AT RISK' : 'LOW'}
            </span>
          </div>
        </div>
      </div>
      <div className="flex items-center justify-between text-[11px] sm:text-[12px] mb-2">
        <div className={`flex items-center gap-1.5 ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${
            loan.riskLevel === 'Very High' ? 'bg-rose-500' : loan.riskLevel === 'Medium' ? 'bg-amber-500' : 'bg-emerald-500'
          }`}></span>
          <span className="font-medium">Risk Score: {loan.riskScore}/100</span>
          <span className={`text-[10px] ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`} title="Score scale: 40 = worst, 100 = best">(40 = worst, 100 = best)</span>
        </div>
      </div>
      {hasAnySignal && (
        <div className="mb-3 pt-2.5 pb-2 border-t border-transparent">
          <p className={`text-[9px] uppercase tracking-wider font-medium mb-1.5 ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>
            Signal buckets (1=low, 6=high)
          </p>
          <div className="grid grid-cols-5 gap-1.5 sm:gap-2">
            {signalItems.map(({ label, value }) => (
              <div
                key={label}
                className={`flex flex-col justify-between rounded-lg px-1.5 py-2 sm:px-2 sm:py-2.5 text-center min-w-0 break-words min-h-[60px] sm:min-h-[68px] ${bucketBg(value)}`}
              >
                <p className={`text-[9px] sm:text-[10px] font-medium uppercase tracking-wide break-words ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
                  {label}
                </p>
                <p className={`text-sm sm:text-base font-semibold break-words mt-auto ${bucketText(value)}`}>
                  {value != null ? value : '—'}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
      {!compact && (
      <LoanRiskDistribution
        ficoScore={loan.ficoScore}
        ltvRatio={loan.ltvRatio}
        dtiRatio={loan.dtiRatio}
        isDarkMode={isDarkMode}
        loanType={loan.loanType}
        loanPurpose={loan.loanPurpose}
        channel={loan.channel}
        activeDays={loan.activeDays}
        currentMilestone={loan.currentMilestone}
        estimatedClosingDate={loan.estimatedClosingDate}
        loPullthroughPct={loan.loPullthroughPct}
        interestRate={loan.interestRate}
        marketRate={loan.marketRate}
        marketChangeDelta={loan.marketChangeDelta}
      />
      )}
      {!compact && (loan.lockDate != null || loan.lockMarketRate != null || loan.interestRate != null || loan.marketRate != null || loan.lockExpirationDate != null) && (
        <div className={`mt-3 p-4 rounded-xl ${isDarkMode ? 'bg-slate-800/50' : 'bg-slate-50'}`}>
          <p className={`text-[10px] uppercase tracking-wider font-semibold mb-3 ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
            Rate & Market
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
            <div>
              <p className={`text-[9px] uppercase tracking-wider mb-1 ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>Market rate at lock</p>
              {loan.lockMarketRate != null && !Number.isNaN(loan.lockMarketRate) ? (
                <p className={`font-medium text-sm ${isDarkMode ? 'text-slate-100' : 'text-slate-900'}`}>
                  {loan.lockMarketRate.toFixed(3)}%
                </p>
              ) : (
                <p className={`font-medium text-sm ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>—</p>
              )}
            </div>
            {loan.marketRate != null && loan.marketRate !== undefined && (
              <div>
                <p className={`text-[9px] uppercase tracking-wider mb-1 ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>Market rate today</p>
                <p className={`font-medium text-sm ${isDarkMode ? 'text-slate-100' : 'text-slate-900'}`}>{loan.marketRate.toFixed(3)}%</p>
              </div>
            )}
            <div>
              <p className={`text-[9px] uppercase tracking-wider mb-1 ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>Market Delta</p>
              {(loan.marketChangeDelta != null && loan.marketChangeDelta !== undefined && !Number.isNaN(loan.marketChangeDelta)) ? (
                <p className={`font-medium text-sm ${loan.marketChangeDelta > 0.2 ? 'text-rose-600 dark:text-rose-400' : loan.marketChangeDelta < -0.1 ? 'text-emerald-600 dark:text-emerald-400' : isDarkMode ? 'text-slate-100' : 'text-slate-900'}`}>
                  {loan.marketChangeDelta > 0 ? '+' : ''}{loan.marketChangeDelta.toFixed(3)}%
                </p>
              ) : (
                <p className={`font-medium text-sm ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>—</p>
              )}
            </div>
            <div>
              <p className={`text-[9px] uppercase tracking-wider mb-1 ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>
                Lock Status
              </p>
              {(loan.lockDate != null && loan.lockDate !== '') ? (
                loan.lockExpirationDate ? (
                  <p className={`font-medium text-sm ${getExpirationDateColorClass(loan.lockExpirationDate, isDarkMode)}`}>
                    {formatLockExpirationDate(loan.lockExpirationDate)}
                  </p>
                ) : (
                  <p className={`font-medium text-sm ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>—</p>
                )
              ) : (
                <p className={`font-bold text-sm ${isDarkMode ? 'text-slate-100' : 'text-slate-900'}`}>Locked: No</p>
              )}
            </div>
          </div>
        </div>
      )}
      {!compact && (
      <div className={`mt-3 p-4 rounded-xl ${isDarkMode ? 'bg-slate-800/50' : 'bg-slate-50'}`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-purple-500" />
            <p className={`text-[10px] uppercase tracking-wider font-medium ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
              Action Plan
            </p>
          </div>
          {!aiRecommendations && !aiLoading && (
            <button
              onClick={(e) => fetchAiRecommendations(e)}
              className={`px-3 py-1.5 rounded-lg text-[11px] font-medium transition-all ${
                isDarkMode
                  ? 'bg-purple-900/30 text-purple-400 hover:bg-purple-900/50'
                  : 'bg-purple-50 text-purple-600 hover:bg-purple-100'
              }`}
            >
              Get Recommendations
            </button>
          )}
        </div>
        {aiLoading && (
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <Loader2 className="w-4 h-4 animate-spin" />
            Getting AI recommendations...
          </div>
        )}
        {aiError && (
          <div className={`text-sm ${isDarkMode ? 'text-rose-400' : 'text-rose-600'}`}>
            {aiError}
          </div>
        )}
        {aiRecommendations && aiRecommendations.length > 0 && (
          <ul className="space-y-1.5">
            {aiRecommendations.map((rec, i) => (
              <li key={i} className={`text-[12px] font-light flex items-start gap-2 ${isDarkMode ? 'text-slate-300' : 'text-slate-700'}`}>
                <span className="text-purple-500 mt-0.5">•</span>
                <span>{rec}</span>
              </li>
            ))}
          </ul>
        )}
        {aiRecommendations && aiRecommendations.length === 0 && !aiLoading && (
          <p className={`text-xs ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
            No specific recommendations for this loan.
          </p>
        )}
      </div>
      )}
      {showRiskBreakdown && (() => {
        const serverRisks = loan.riskSummary?.risks || [];
        const serverPositives = loan.riskSummary?.positives || [];
        const localSuccesses: string[] = [];
        const localWarnings: string[] = [];
        const localCriticals: string[] = [];
        if (loan.ficoScore) {
          if (loan.ficoScore >= 700) localSuccesses.push(`Strong credit profile (FICO ${loan.ficoScore})`);
          else if (loan.ficoScore >= 620) localWarnings.push(`Credit needs monitoring (FICO ${loan.ficoScore})`);
          else localCriticals.push(`High-risk credit profile (FICO ${loan.ficoScore})`);
        }
        if (loan.ltvRatio) {
          if (loan.ltvRatio <= 80) localSuccesses.push(`Healthy equity position (LTV ${loan.ltvRatio.toFixed(0)}%)`);
          else if (loan.ltvRatio <= 95) localWarnings.push(`Elevated LTV may require PMI (${loan.ltvRatio.toFixed(0)}%)`);
          else localCriticals.push(`Very high LTV indicates minimal equity (${loan.ltvRatio.toFixed(0)}%)`);
        }
        if (loan.dtiRatio) {
          if (loan.dtiRatio <= 36) localSuccesses.push(`Manageable debt load (DTI ${loan.dtiRatio.toFixed(0)}%)`);
          else if (loan.dtiRatio <= 43) localWarnings.push(`DTI approaching threshold (${loan.dtiRatio.toFixed(0)}%)`);
          else localCriticals.push(`DTI exceeds QM threshold (${loan.dtiRatio.toFixed(0)}%)`);
        }
        const criticals = [...serverRisks, ...localCriticals];
        const warnings = localWarnings;
        const successes = [...serverPositives, ...localSuccesses];
        if (successes.length === 0 && warnings.length === 0 && criticals.length === 0) {
          return (
            <div className={`mt-3 p-4 rounded-xl ${isDarkMode ? 'bg-slate-800/50' : 'bg-slate-50'}`}>
              <p className={`text-[12px] ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
                {loan.reason || 'No additional risk factors identified.'}
              </p>
            </div>
          );
        }
        return (
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3">
            {successes.length > 0 && (
              <div className={`p-3 rounded-xl border-l-4 bg-sky-50 dark:bg-sky-900/20 border-sky-400`}>
                <p className={`text-[10px] font-semibold uppercase tracking-wider mb-2 text-sky-600 dark:text-sky-400`}>Successes</p>
                <ul className={`text-[12px] space-y-1 text-sky-700 dark:text-sky-300`}>
                  {successes.map((s, i) => <li key={i}>• {s}</li>)}
                </ul>
              </div>
            )}
            {warnings.length > 0 && (
              <div className={`p-3 rounded-xl border-l-4 bg-amber-50 dark:bg-amber-900/20 border-amber-500`}>
                <p className={`text-[10px] font-semibold uppercase tracking-wider mb-2 text-amber-600 dark:text-amber-400`}>Warning</p>
                <ul className={`text-[12px] space-y-1 text-amber-700 dark:text-amber-300`}>
                  {warnings.map((w, i) => <li key={i}>• {w}</li>)}
                </ul>
              </div>
            )}
            {criticals.length > 0 && (
              <div className={`p-3 rounded-xl border-l-4 bg-red-50 dark:bg-red-900/20 border-red-500`}>
                <p className={`text-[10px] font-semibold uppercase tracking-wider mb-2 text-red-600 dark:text-red-400`}>Critical</p>
                <ul className={`text-[12px] space-y-1 text-red-700 dark:text-red-300`}>
                  {criticals.map((c, i) => <li key={i}>• {c}</li>)}
                </ul>
              </div>
            )}
          </div>
        );
      })()}
      {showTapForDetails && (
        <div className={`mt-2.5 sm:mt-3 pt-2.5 sm:pt-3 border-t flex items-center justify-between ${isDarkMode ? 'border-slate-700/50' : 'border-slate-100'}`}>
          {showFavoriteButton && onToggleFavorite && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onToggleFavorite(e); }}
              className="flex-shrink-0 p-0.5 rounded hover:opacity-80 transition-opacity"
              aria-label={isFavorited ? 'Remove from favorites' : 'Add to favorites'}
            >
              {isFavorited ? (
                <Heart className="w-4 h-4 text-blue-500 fill-blue-500" />
              ) : (
                <Heart className="w-4 h-4 text-slate-400" fill="none" strokeWidth={2} stroke="currentColor" />
              )}
            </button>
          )}
          <span className={`text-[9px] sm:text-[10px] ${isDarkMode ? 'text-slate-600' : 'text-slate-400'}`}>
            Tap for details
          </span>
          <svg className={`w-4 h-4 ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </div>
      )}
    </>
  );
});

LoanCardContent.displayName = 'LoanCardContent';
