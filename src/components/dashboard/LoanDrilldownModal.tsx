import React, { useState, useEffect, useRef, memo } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X, Sparkles, Loader2 } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { LoanRiskDistribution } from './LoanRiskDistribution';
import { api } from '@/lib/api';
import { useTenantStore } from '@/stores/tenantStore';

interface RiskSummary {
  risks: string[];
  positives: string[];
  overallRisk: string;
  predictedOutcome: 'originate' | 'withdraw' | 'deny' | 'at_risk';
  confidence: number;
}

interface LoanData {
  id: string;
  guid?: string;
  officer: string;
  amount: string;
  amountValue?: number;
  riskLevel: string;
  riskScore: number;
  reason: string;
  loanType?: string;
  status?: string;
  ficoScore: number | null;
  ltvRatio: number | null;
  dtiRatio: number | null;
  // Milestone and time in motion
  currentMilestone?: string | null;
  activeDays?: number | null;
  // Rates and market
  interestRate?: number | null;
  marketRate?: number | null;
  marketChangeDelta?: number | null;
  // Pullthrough percentages (actual values)
  loPullthroughPct?: number | null;
  uwPullthroughPct?: number | null;
  closerPullthroughPct?: number | null;
  processorPullthroughPct?: number | null;
  // Rule-based risk summary from backend
  riskSummary?: RiskSummary;
  // Composite signal bucket scores (1-6 scale)
  creditMetricsSignalStrength?: number | null;
  loanCharacteristicsSignalStrength?: number | null;
  timeInMotionSignalStrength?: number | null;
  mloAeFalloutProneSignalStrength?: number | null;
  interestLockVsMarketSignalStrength?: number | null;
  uwPullthroughSignalStrength?: number | null;
  closerPullthroughSignalStrength?: number | null;
  processorPullthroughSignalStrength?: number | null;
  // Individual signal buckets
  ficoScoreSignal?: number | null;
  ltvSignal?: number | null;
  dtiSignal?: number | null;
  loPullthroughSignal?: number | null;
  marketChangeDeltaSignal?: number | null;
}

interface LoanDrilldownModalProps {
  loan: LoanData;
  isOpen: boolean;
  onClose: () => void;
  isDarkMode?: boolean;
}

export const LoanDrilldownModal: React.FC<LoanDrilldownModalProps> = memo(({
  loan,
  isOpen,
  onClose,
  isDarkMode = false
}) => {
  const { selectedTenantId } = useTenantStore();
  const [emailLoading, setEmailLoading] = useState(false);
  const [aiRecommendations, setAiRecommendations] = useState<string[] | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const loanDetailsRef = useRef<HTMLDivElement>(null);

  // Reset AI recommendations when modal closes or loan changes
  useEffect(() => {
    if (!isOpen) {
      setAiRecommendations(null);
      setAiError(null);
    }
  }, [isOpen, loan.id]);

  const fetchAiRecommendations = async () => {
    if (!loan.id) return;
    setAiLoading(true);
    setAiError(null);
    try {
      const tenantQuery = selectedTenantId ? `?tenant_id=${encodeURIComponent(selectedTenantId)}` : '';
      const response = await api.request<{ recommendations: string[] }>(
        `/api/predictions/${encodeURIComponent(loan.id)}/recommendations${tenantQuery}`,
        { method: 'GET' }
      );
      setAiRecommendations(response.recommendations || []);
    } catch (err: any) {
      setAiError(err.message || 'Failed to get AI recommendations');
    } finally {
      setAiLoading(false);
    }
  };

  const getRiskLabel = (level: string) => {
    if (level === 'Very High') return 'CRITICAL';
    if (level === 'Medium') return 'WARNING';
    return 'SUCCESS';
  };

  const getRiskStyles = (level: string) => {
    if (level === 'Very High') return { bg: 'bg-rose-500', text: 'text-white', border: 'border-rose-500' };
    if (level === 'Medium') return { bg: 'bg-amber-500', text: 'text-white', border: 'border-amber-500' };
    return { bg: 'bg-sky-400', text: 'text-white', border: 'border-sky-400' };
  };

  const getMetricStatus = (type: string, value: number | null): 'success' | 'warning' | 'critical' | 'neutral' => {
    if (value === null) return 'neutral';
    if (type === 'fico') {
      if (value < 620) return 'critical';
      if (value < 700) return 'warning';
      return 'success';
    } else if (type === 'ltv') {
      if (value > 95) return 'critical';
      if (value > 80) return 'warning';
      return 'success';
    } else if (type === 'dti') {
      if (value > 43) return 'critical';
      if (value > 36) return 'warning';
      return 'success';
    }
    return 'neutral';
  };

  const getMetricColor = (status: string) => {
    if (status === 'critical') return 'text-rose-600 bg-rose-50 dark:text-rose-400 dark:bg-rose-900/20';
    if (status === 'warning') return 'text-amber-600 bg-amber-50 dark:text-amber-400 dark:bg-amber-900/20';
    if (status === 'success') return 'text-sky-600 bg-sky-50 dark:text-sky-400 dark:bg-sky-900/20';
    return 'text-slate-400 bg-slate-100 dark:text-slate-500 dark:bg-slate-800';
  };

  // Helper functions for signal bucket colors (1-6 scale: 1-2=low risk, 3-4=medium, 5-6=high)
  const getBucketBgColor = (bucket: number | null | undefined): string => {
    if (bucket === null || bucket === undefined) return isDarkMode ? 'bg-slate-700/50' : 'bg-slate-100';
    if (bucket <= 2) return isDarkMode ? 'bg-emerald-900/30' : 'bg-emerald-50';
    if (bucket <= 4) return isDarkMode ? 'bg-amber-900/30' : 'bg-amber-50';
    return isDarkMode ? 'bg-rose-900/30' : 'bg-rose-50';
  };

  const getBucketTextColor = (bucket: number | null | undefined): string => {
    if (bucket === null || bucket === undefined) return isDarkMode ? 'text-slate-400' : 'text-slate-500';
    if (bucket <= 2) return isDarkMode ? 'text-emerald-400' : 'text-emerald-600';
    if (bucket <= 4) return isDarkMode ? 'text-amber-400' : 'text-amber-600';
    return isDarkMode ? 'text-rose-400' : 'text-rose-600';
  };

  const riskStyles = getRiskStyles(loan.riskLevel);
  const riskLabel = getRiskLabel(loan.riskLevel);

  const ficoStatus = getMetricStatus('fico', loan.ficoScore);
  const ltvStatus = getMetricStatus('ltv', loan.ltvRatio);
  const dtiStatus = getMetricStatus('dti', loan.dtiRatio);

  // Use server-generated riskSummary when available, otherwise compute locally
  const serverRisks = loan.riskSummary?.risks || [];
  const serverPositives = loan.riskSummary?.positives || [];
  
  // Local fallback computations for credit metrics
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

  // Combine server-generated insights with local computations
  // Server risks are the signal-based insights, local criticals/warnings are metric-based
  const criticals = [...serverRisks, ...localCriticals];
  const warnings = localWarnings;
  const successes = [...serverPositives, ...localSuccesses];

  const handleEmail = async () => {
    setEmailLoading(true);
    try {
      const lenderCoaching: string[] = [];
      const borrowerCoaching: string[] = [];
      
      if (loan.ficoScore && loan.ficoScore < 620) {
        lenderCoaching.push(`With FICO at ${loan.ficoScore}, request 12-month payment history for rent/utilities as compensating factor`);
        borrowerCoaching.push(`Do not open any new credit cards or store accounts until after closing`);
      }
      
      if (loan.ltvRatio && loan.ltvRatio > 95) {
        lenderCoaching.push(`At ${Math.round(loan.ltvRatio)}% LTV, order property inspection waiver eligibility check`);
        borrowerCoaching.push(`Save additional funds for potential appraisal gap coverage`);
      }
      
      if (loan.dtiRatio && loan.dtiRatio > 43) {
        lenderCoaching.push(`At ${Math.round(loan.dtiRatio)}% DTI, document non-QM pricing adjustment if applicable`);
        borrowerCoaching.push(`Avoid financing furniture, appliances, or vehicles before closing`);
      }

      const subject = encodeURIComponent(`Loan Update: ${loan.id} - ${loan.officer || 'Unassigned'}`);
      const body = encodeURIComponent(
        `Loan ${loan.id}\n\n` +
        `Loan Officer: ${loan.officer || 'Unassigned'}\n` +
        `Amount: ${loan.amount}\n` +
        `Status: ${riskLabel}\n` +
        `Risk Score: ${loan.riskScore}/100\n\n` +
        `FICO: ${loan.ficoScore || 'N/A'}\n` +
        `LTV: ${loan.ltvRatio ? Math.round(loan.ltvRatio) + '%' : 'N/A'}\n` +
        `DTI: ${loan.dtiRatio ? Math.round(loan.dtiRatio) + '%' : 'N/A'}\n\n` +
        `Assessment: ${loan.reason}\n\n` +
        (lenderCoaching.length > 0 ? `COACHING FOR LENDER\n${lenderCoaching.map(t => `  • ${t}`).join('\n')}\n\n` : '') +
        (borrowerCoaching.length > 0 ? `COACHING FOR BORROWER\n${borrowerCoaching.map(t => `  • ${t}`).join('\n')}\n\n` : '')
      );
      window.open(`mailto:?subject=${subject}&body=${body}`, '_blank');
    } finally {
      setEmailLoading(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogPrimitive.Portal>
        {/* Darker overlay for stacked / top modal */}
        <DialogPrimitive.Overlay className="fixed inset-0 z-[80] bg-black/35 dark:bg-black/70 backdrop-blur-sm sm:backdrop-blur-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />

        <DialogPrimitive.Content
          className="fixed left-[50%] z-[90] flex flex-col w-full max-w-md sm:max-w-lg lg:max-w-2xl translate-x-[-50%] gap-4 border border-slate-200/60 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-6 shadow-xl duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 rounded-t-2xl sm:rounded-2xl max-h-[90vh] overflow-y-auto overscroll-contain top-auto bottom-0 sm:top-28 sm:bottom-auto md:top-[50%] md:translate-y-[-50%] md:bottom-auto outline-none"
        >
          <DialogPrimitive.Close className="absolute top-4 right-4 z-[95] rounded-lg p-2 bg-slate-50/80 dark:bg-slate-800/80 text-slate-600 dark:text-slate-400 border-0 shadow-sm opacity-70 ring-offset-background transition-all hover:opacity-100 hover:bg-slate-100 dark:hover:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2 disabled:pointer-events-none">
            <X className="h-4 w-4" />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>

          <div className="flex flex-col space-y-1.5 text-center sm:text-left">
            <div className="flex items-center justify-between">
            <div>
              <p className="text-2xl font-light tracking-tight">{loan.amount}</p>
              <p className="text-xs font-light mt-0.5 text-slate-500 dark:text-slate-400">Loan #{loan.id}</p>
            </div>
            <div className="flex flex-col items-end gap-1 mr-10">
              {/* Predicted outcome badge - only show for withdraw/deny */}
              {loan.riskSummary?.predictedOutcome && (loan.riskSummary.predictedOutcome === 'withdraw' || loan.riskSummary.predictedOutcome === 'deny') && (
                <span className={`px-3 py-1.5 rounded-lg text-[10px] font-semibold tracking-wide ${
                  loan.riskSummary.predictedOutcome === 'deny'
                    ? (isDarkMode ? 'bg-red-600/30 text-red-300' : 'bg-red-100 text-red-700')
                    : (isDarkMode ? 'bg-orange-500/30 text-orange-300' : 'bg-orange-100 text-orange-700')
                }`}>
                  {loan.riskSummary.predictedOutcome === 'deny' ? '⚠ LIKELY DECLINE' : '↩ LIKELY WITHDRAW'}
                </span>
              )}
              <span className={`px-3 py-1.5 rounded-lg text-[10px] font-medium tracking-wide ${riskStyles.bg} ${riskStyles.text}`}>
                {riskLabel}
              </span>
              {loan.riskSummary && (
                <span className={`text-[10px] ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
                  {loan.riskSummary.confidence}% confidence
                </span>
              )}
            </div>
            </div>
          </div>
        
        <div ref={loanDetailsRef} className="space-y-4">
          <div className="grid grid-cols-3 gap-2">
            <div className={`p-3 rounded-xl text-center ${getMetricColor(ficoStatus)}`}>
              <p className="text-lg font-light tracking-tight">{loan.ficoScore || '—'}</p>
              <p className="text-[9px] uppercase tracking-wider font-medium opacity-70">FICO</p>
            </div>
            <div className={`p-3 rounded-xl text-center ${getMetricColor(ltvStatus)}`}>
              <p className="text-lg font-light tracking-tight">{loan.ltvRatio ? `${Number(loan.ltvRatio).toFixed(0)}%` : '—'}</p>
              <p className="text-[9px] uppercase tracking-wider font-medium opacity-70">LTV</p>
            </div>
            <div className={`p-3 rounded-xl text-center ${getMetricColor(dtiStatus)}`}>
              <p className="text-lg font-light tracking-tight">{loan.dtiRatio ? `${Number(loan.dtiRatio).toFixed(0)}%` : '—'}</p>
              <p className="text-[9px] uppercase tracking-wider font-medium opacity-70">DTI</p>
            </div>
          </div>

          {/* Signal Bucket Scores - Only show if we have signal data */}
          {(loan.creditMetricsSignalStrength || loan.loanCharacteristicsSignalStrength || 
            loan.timeInMotionSignalStrength || loan.mloAeFalloutProneSignalStrength || 
            loan.interestLockVsMarketSignalStrength || loan.loPullthroughSignal || loan.marketChangeDeltaSignal) && (
            <div className={`p-4 rounded-xl ${isDarkMode ? 'bg-slate-800/50' : 'bg-slate-50'}`}>
              <p className={`text-[10px] uppercase tracking-wider font-medium mb-3 ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
                Signal Bucket Scores (1=Low Risk, 6=High Risk)
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
                {loan.creditMetricsSignalStrength && (
                  <div className={`p-2 rounded-lg text-center ${getBucketBgColor(loan.creditMetricsSignalStrength)}`}>
                    <p className={`text-base font-semibold ${getBucketTextColor(loan.creditMetricsSignalStrength)}`}>{loan.creditMetricsSignalStrength}</p>
                    <p className={`text-[8px] uppercase tracking-wider ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>Credit</p>
                  </div>
                )}
                {loan.loanCharacteristicsSignalStrength && (
                  <div className={`p-2 rounded-lg text-center ${getBucketBgColor(loan.loanCharacteristicsSignalStrength)}`}>
                    <p className={`text-base font-semibold ${getBucketTextColor(loan.loanCharacteristicsSignalStrength)}`}>{loan.loanCharacteristicsSignalStrength}</p>
                    <p className={`text-[8px] uppercase tracking-wider ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>Loan Char</p>
                  </div>
                )}
                {loan.timeInMotionSignalStrength && (
                  <div className={`p-2 rounded-lg text-center ${getBucketBgColor(loan.timeInMotionSignalStrength)}`}>
                    <p className={`text-base font-semibold ${getBucketTextColor(loan.timeInMotionSignalStrength)}`}>{loan.timeInMotionSignalStrength}</p>
                    <p className={`text-[8px] uppercase tracking-wider ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>Time Motion</p>
                  </div>
                )}
                {loan.loPullthroughSignal && (
                  <div className={`p-2 rounded-lg text-center ${getBucketBgColor(loan.loPullthroughSignal)}`}>
                    <p className={`text-base font-semibold ${getBucketTextColor(loan.loPullthroughSignal)}`}>{loan.loPullthroughSignal}</p>
                    <p className={`text-[8px] uppercase tracking-wider ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>LO Pull</p>
                  </div>
                )}
                {loan.marketChangeDeltaSignal && (
                  <div className={`p-2 rounded-lg text-center ${getBucketBgColor(loan.marketChangeDeltaSignal)}`}>
                    <p className={`text-base font-semibold ${getBucketTextColor(loan.marketChangeDeltaSignal)}`}>{loan.marketChangeDeltaSignal}</p>
                    <p className={`text-[8px] uppercase tracking-wider ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>Market Δ</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Loan Info Section */}
          <div className={`p-4 rounded-xl ${isDarkMode ? 'bg-slate-800/50' : 'bg-slate-50'}`}>
            <p className={`text-[10px] uppercase tracking-wider font-semibold mb-3 ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
              Loan Information
            </p>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <div>
                <p className={`text-[9px] uppercase tracking-wider mb-1 ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>Officer</p>
                <p className={`font-medium text-sm truncate ${isDarkMode ? 'text-slate-100' : 'text-slate-900'}`}>{loan.officer || 'Unassigned'}</p>
              </div>
              <div>
                <p className={`text-[9px] uppercase tracking-wider mb-1 ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>Type</p>
                <p className={`font-medium text-sm truncate ${isDarkMode ? 'text-slate-100' : 'text-slate-900'}`}>{loan.loanType || '—'}</p>
              </div>
              <div>
                <p className={`text-[9px] uppercase tracking-wider mb-1 ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>Milestone</p>
                <p className={`font-medium text-sm truncate ${isDarkMode ? 'text-slate-100' : 'text-slate-900'}`}>{loan.currentMilestone || '—'}</p>
              </div>
              <div>
                <p className={`text-[9px] uppercase tracking-wider mb-1 ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>Active Days</p>
                <p className={`font-medium text-sm ${loan.activeDays && loan.activeDays > 45 ? 'text-rose-600 dark:text-rose-400' : loan.activeDays && loan.activeDays > 30 ? 'text-amber-600 dark:text-amber-400' : isDarkMode ? 'text-slate-100' : 'text-slate-900'}`}>
                  {loan.activeDays !== null && loan.activeDays !== undefined ? `${loan.activeDays} days` : '—'}
                </p>
              </div>
            </div>
          </div>

          {/* Rate & Market Section */}
          {(loan.interestRate !== null || loan.marketRate !== null) && (
            <div className={`p-4 rounded-xl ${isDarkMode ? 'bg-slate-800/50' : 'bg-slate-50'}`}>
              <p className={`text-[10px] uppercase tracking-wider font-semibold mb-3 ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
                Rate & Market
              </p>
              <div className="grid grid-cols-3 gap-4">
                {(loan.interestRate !== null && loan.interestRate !== undefined) && (
                  <div>
                    <p className={`text-[9px] uppercase tracking-wider mb-1 ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>Lock Rate</p>
                    <p className={`font-medium text-sm ${isDarkMode ? 'text-slate-100' : 'text-slate-900'}`}>{loan.interestRate.toFixed(3)}%</p>
                  </div>
                )}
                {(loan.marketRate !== null && loan.marketRate !== undefined) && (
                  <div>
                    <p className={`text-[9px] uppercase tracking-wider mb-1 ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>Market (FRED)</p>
                    <p className={`font-medium text-sm ${isDarkMode ? 'text-slate-100' : 'text-slate-900'}`}>{loan.marketRate.toFixed(3)}%</p>
                  </div>
                )}
                {(loan.marketChangeDelta !== null && loan.marketChangeDelta !== undefined) ? (
                  <div>
                    <p className={`text-[9px] uppercase tracking-wider mb-1 ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>Market Delta</p>
                    <p className={`font-medium text-sm ${loan.marketChangeDelta > 0.2 ? 'text-rose-600 dark:text-rose-400' : loan.marketChangeDelta < -0.1 ? 'text-emerald-600 dark:text-emerald-400' : isDarkMode ? 'text-slate-100' : 'text-slate-900'}`}>
                      {loan.marketChangeDelta > 0 ? '+' : ''}{loan.marketChangeDelta.toFixed(3)}%
                    </p>
                  </div>
                ) : (loan.interestRate && loan.marketRate) && (
                  <div>
                    <p className={`text-[9px] uppercase tracking-wider mb-1 ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>Rate Delta</p>
                    <p className={`font-medium text-sm ${(loan.interestRate - loan.marketRate) > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                      {(loan.interestRate - loan.marketRate) > 0 ? '+' : ''}{(loan.interestRate - loan.marketRate).toFixed(3)}%
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Pullthrough Rates Section */}
          {(loan.loPullthroughPct !== null || loan.uwPullthroughPct !== null || loan.closerPullthroughPct !== null || loan.processorPullthroughPct !== null) && (
            <div className={`p-4 rounded-xl ${isDarkMode ? 'bg-slate-800/50' : 'bg-slate-50'}`}>
              <p className={`text-[10px] uppercase tracking-wider font-semibold mb-3 ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
                Pullthrough Rates
              </p>
              <div className="grid grid-cols-4 gap-3">
                {(loan.loPullthroughPct !== null && loan.loPullthroughPct !== undefined) && (
                  <div>
                    <p className={`text-[9px] uppercase tracking-wider mb-1 ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>LO</p>
                    <p className={`font-medium text-sm ${loan.loPullthroughPct < 60 ? 'text-rose-600 dark:text-rose-400' : loan.loPullthroughPct < 75 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                      {loan.loPullthroughPct.toFixed(1)}%
                    </p>
                  </div>
                )}
                {(loan.uwPullthroughPct !== null && loan.uwPullthroughPct !== undefined) && (
                  <div>
                    <p className={`text-[9px] uppercase tracking-wider mb-1 ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>UW</p>
                    <p className={`font-medium text-sm ${loan.uwPullthroughPct < 60 ? 'text-rose-600 dark:text-rose-400' : loan.uwPullthroughPct < 75 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                      {loan.uwPullthroughPct.toFixed(1)}%
                    </p>
                  </div>
                )}
                {(loan.closerPullthroughPct !== null && loan.closerPullthroughPct !== undefined) && (
                  <div>
                    <p className={`text-[9px] uppercase tracking-wider mb-1 ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>Closer</p>
                    <p className={`font-medium text-sm ${loan.closerPullthroughPct < 60 ? 'text-rose-600 dark:text-rose-400' : loan.closerPullthroughPct < 75 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                      {loan.closerPullthroughPct.toFixed(1)}%
                    </p>
                  </div>
                )}
                {(loan.processorPullthroughPct !== null && loan.processorPullthroughPct !== undefined) && (
                  <div>
                    <p className={`text-[9px] uppercase tracking-wider mb-1 ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>Processor</p>
                    <p className={`font-medium text-sm ${loan.processorPullthroughPct < 60 ? 'text-rose-600 dark:text-rose-400' : loan.processorPullthroughPct < 75 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                      {loan.processorPullthroughPct.toFixed(1)}%
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Risk Assessment - Side by side columns */}
          {(successes.length > 0 || warnings.length > 0 || criticals.length > 0) ? (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {successes.length > 0 && (
                <div className={`p-3 rounded-xl border-l-4 bg-sky-50 dark:bg-sky-900/20 border-sky-400`}>
                  <p className={`text-[10px] font-semibold uppercase tracking-wider mb-2 text-sky-600 dark:text-sky-400`}>
                    Successes
                  </p>
                  <ul className={`text-[12px] space-y-1 text-sky-700 dark:text-sky-300`}>
                    {successes.map((s, i) => <li key={i}>• {s}</li>)}
                  </ul>
                </div>
              )}
              
              {warnings.length > 0 && (
                <div className={`p-3 rounded-xl border-l-4 bg-amber-50 dark:bg-amber-900/20 border-amber-500`}>
                  <p className={`text-[10px] font-semibold uppercase tracking-wider mb-2 text-amber-600 dark:text-amber-400`}>
                    Warning
                  </p>
                  <ul className={`text-[12px] space-y-1 text-amber-700 dark:text-amber-300`}>
                    {warnings.map((w, i) => <li key={i}>• {w}</li>)}
                  </ul>
                </div>
              )}
              
              {criticals.length > 0 && (
                <div className={`p-3 rounded-xl border-l-4 bg-red-50 dark:bg-red-900/20 border-red-500`}>
                  <p className={`text-[10px] font-semibold uppercase tracking-wider mb-2 text-red-600 dark:text-red-400`}>
                    Critical
                  </p>
                  <ul className={`text-[12px] space-y-1 text-red-700 dark:text-red-300`}>
                    {criticals.map((c, i) => <li key={i}>• {c}</li>)}
                  </ul>
                </div>
              )}
            </div>
          ) : (
            <div className={`p-3 rounded-xl ${isDarkMode ? 'bg-slate-800/50' : 'bg-slate-50'}`}>
              <p className={`text-[12px] ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
                {loan.reason || 'No additional risk factors identified.'}
              </p>
            </div>
          )}

          <LoanRiskDistribution
            ficoScore={loan.ficoScore}
            ltvRatio={loan.ltvRatio}
            dtiRatio={loan.dtiRatio}
            isDarkMode={isDarkMode}
          />

          {/* AI Recommendations Section */}
          <div className={`p-4 rounded-xl ${isDarkMode ? 'bg-slate-800/50' : 'bg-slate-50'}`}>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-purple-500" />
                <p className={`text-[10px] uppercase tracking-wider font-medium ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
                  Cohi Recommendations
                </p>
              </div>
              {!aiRecommendations && !aiLoading && (
                <button
                  onClick={fetchAiRecommendations}
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
              <ul className="space-y-2">
                {aiRecommendations.map((rec, i) => (
                  <li key={i} className={`text-[13px] font-light flex items-start gap-2 ${isDarkMode ? 'text-slate-300' : 'text-slate-700'}`}>
                    <span className="text-purple-500 mt-0.5">•</span>
                    <span>{rec}</span>
                  </li>
                ))}
              </ul>
            )}

            {aiRecommendations && aiRecommendations.length === 0 && (
              <p className={`text-sm ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
                No specific recommendations for this loan.
              </p>
            )}
          </div>

          <div className="flex gap-2 pt-2">
            <button 
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-[13px] font-light transition-all active:scale-98 ${emailLoading ? 'opacity-60' : ''} text-slate-500 hover:text-slate-700 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-slate-200 dark:hover:bg-slate-800`}
              disabled={emailLoading}
              onClick={handleEmail}
            >
              {emailLoading ? (
                <div className="animate-spin w-4 h-4 border-2 border-current border-t-transparent rounded-full"></div>
              ) : (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
              )}
              Email
            </button>
            <button 
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-[13px] font-light transition-all active:scale-98 text-slate-500 hover:text-slate-700 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-slate-200 dark:hover:bg-slate-800`}
              onClick={() => {
                const content = `Loan ${loan.id}\nBorrower: ${loan.borrower}\nOfficer: ${loan.officer}\nAmount: ${loan.amount}\nStatus: ${riskLabel}\nFICO: ${loan.ficoScore || 'N/A'}\nLTV: ${loan.ltvRatio ? Math.round(loan.ltvRatio) : 'N/A'}%\nDTI: ${loan.dtiRatio ? Math.round(loan.dtiRatio) : 'N/A'}%`;
                const blob = new Blob([content], { type: 'text/plain' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `loan-${loan.id}.txt`;
                a.click();
                URL.revokeObjectURL(url);
              }}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Save
            </button>
          </div>
        </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </Dialog>
  );
});

LoanDrilldownModal.displayName = 'LoanDrilldownModal';
