import React, { useState } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X, AlertTriangle, CheckCircle, Loader2, Sparkles } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';

interface RiskSummary {
  risks: string[];
  positives: string[];
  overallRisk: string;
  predictedOutcome: 'originate' | 'withdraw' | 'deny' | 'at_risk';
  confidence: number;
}

interface BucketedLoan {
  loan_id?: string;
  loanId?: string;
  loan_number?: string;
  loanNumber?: string;
  loan_amount?: number;
  interest_rate?: number;
  loan_type?: string;
  bucket?: string;
  signal_strength?: number;
  application_date?: string;
  loan_officer?: string;
  branch?: string;
  riskSummary?: RiskSummary;
  // Signal strengths (1-6 scale)
  creditMetricsSignalStrength?: number;
  loanCharacteristicsSignalStrength?: number;
  timeInMotionSignalStrength?: number;
  mloAeFalloutProneSignalStrength?: number;
  interestLockVsMarketSignalStrength?: number;
  uwPullthroughSignalStrength?: number;
  // Reason codes
  creditMetricsReasonCodes?: string[];
  loanCharacteristicsReasonCodes?: string[];
  timeInMotionReasonCodes?: string[];
  mloAeFalloutProneReasonCodes?: string[];
  interestLockVsMarketReasonCodes?: string[];
  uwPullthroughReasonCodes?: string[];
}

export interface LoanRiskDetailModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  loan: BucketedLoan | null;
  isDarkMode: boolean;
}

const SIGNAL_LABELS: Record<string, string> = {
  creditMetricsSignalStrength: 'Credit Metrics',
  loanCharacteristicsSignalStrength: 'Loan Characteristics',
  timeInMotionSignalStrength: 'Time in Motion',
  mloAeFalloutProneSignalStrength: 'LO Pullthrough',
  interestLockVsMarketSignalStrength: 'Rate vs Market',
  uwPullthroughSignalStrength: 'UW Pullthrough',
};

const REASON_CODE_KEYS: Record<string, string> = {
  creditMetricsSignalStrength: 'creditMetricsReasonCodes',
  loanCharacteristicsSignalStrength: 'loanCharacteristicsReasonCodes',
  timeInMotionSignalStrength: 'timeInMotionReasonCodes',
  mloAeFalloutProneSignalStrength: 'mloAeFalloutProneReasonCodes',
  interestLockVsMarketSignalStrength: 'interestLockVsMarketReasonCodes',
  uwPullthroughSignalStrength: 'uwPullthroughReasonCodes',
};

function getSignalColor(value: number | null | undefined): string {
  if (value === null || value === undefined) return 'bg-slate-300 dark:bg-slate-600';
  if (value <= 2) return 'bg-emerald-500';
  if (value <= 4) return 'bg-amber-500';
  return 'bg-red-500';
}

function getSignalLabel(value: number | null | undefined): string {
  if (value === null || value === undefined) return 'Unknown';
  if (value <= 2) return 'Low Risk';
  if (value <= 4) return 'Medium Risk';
  return 'High Risk';
}

function getBucketBadgeClass(bucket: string | undefined): string {
  switch (bucket) {
    case 'low':
      return 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300';
    case 'medium':
      return 'bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300';
    case 'high':
      return 'bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-300';
    default:
      return 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300';
  }
}

function formatCurrency(value: number | undefined): string {
  if (!value) return '$0';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value);
}

export function LoanRiskDetailModal({
  open,
  onOpenChange,
  loan,
  isDarkMode,
}: LoanRiskDetailModalProps) {
  const [aiRecommendations, setAiRecommendations] = useState<string[] | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  const loanId = loan?.loan_id || loan?.loanId;
  const riskSummary = loan?.riskSummary;

  const fetchAiRecommendations = async () => {
    if (!loanId) return;
    setAiLoading(true);
    setAiError(null);
    try {
      const response = await api.request<{ recommendations: string[] }>(
        `/api/loans/${encodeURIComponent(loanId)}/recommendations`,
        { method: 'GET' }
      );
      setAiRecommendations(response.recommendations || []);
    } catch (err: any) {
      setAiError(err.message || 'Failed to get AI recommendations');
    } finally {
      setAiLoading(false);
    }
  };

  // Reset AI state when modal closes
  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      setAiRecommendations(null);
      setAiError(null);
    }
    onOpenChange(newOpen);
  };

  if (!loan) return null;

  const signalKeys = Object.keys(SIGNAL_LABELS) as Array<keyof typeof SIGNAL_LABELS>;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[80] bg-black/50 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          className={`fixed left-[50%] top-[50%] z-[90] w-full max-w-2xl translate-x-[-50%] translate-y-[-50%] rounded-2xl border p-6 shadow-2xl duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] max-h-[90vh] overflow-y-auto ${
            isDarkMode ? 'bg-slate-900 border-white/10 text-slate-100' : 'bg-white border-slate-200 text-slate-900'
          }`}
        >
          {/* Header */}
          <div className="flex items-start justify-between mb-6">
            <div>
              <h2 className="text-xl font-semibold">Loan Risk Analysis</h2>
              <p className={`text-sm mt-1 ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
                Loan #{loan.loan_number || loan.loanNumber || loan.loan_id || loan.loanId || 'N/A'} - {formatCurrency(loan.loan_amount)}
              </p>
            </div>
            <DialogPrimitive.Close className={`rounded-full p-2 transition-colors ${isDarkMode ? 'hover:bg-slate-800' : 'hover:bg-slate-100'}`}>
              <X className="h-5 w-5" />
            </DialogPrimitive.Close>
          </div>

          {/* Overall Risk Badge */}
          <div className="mb-6">
            <div className="flex items-center gap-3">
              <span className={`px-3 py-1.5 rounded-full text-sm font-medium uppercase tracking-wide ${getBucketBadgeClass(loan.bucket)}`}>
                {loan.bucket || 'Unknown'} Risk
              </span>
              {riskSummary && (
                <span className={`text-sm ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
                  {riskSummary.confidence}% confidence - Predicted: {riskSummary.predictedOutcome}
                </span>
              )}
            </div>
          </div>

          {/* Loan Details */}
          <div className={`grid grid-cols-2 gap-4 mb-6 p-4 rounded-xl ${isDarkMode ? 'bg-slate-800/50' : 'bg-slate-50'}`}>
            <div>
              <p className={`text-xs uppercase tracking-wide ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>Loan Type</p>
              <p className="font-medium">{loan.loan_type || 'N/A'}</p>
            </div>
            <div>
              <p className={`text-xs uppercase tracking-wide ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>Interest Rate</p>
              <p className="font-medium">{loan.interest_rate ? `${loan.interest_rate.toFixed(3)}%` : 'N/A'}</p>
            </div>
            <div>
              <p className={`text-xs uppercase tracking-wide ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>Loan Officer</p>
              <p className="font-medium">{loan.loan_officer || 'N/A'}</p>
            </div>
            <div>
              <p className={`text-xs uppercase tracking-wide ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>Branch</p>
              <p className="font-medium">{loan.branch || 'N/A'}</p>
            </div>
          </div>

          {/* Signal Strengths */}
          <div className="mb-6">
            <h3 className="text-sm font-semibold uppercase tracking-wide mb-4">Signal Breakdown</h3>
            <div className="space-y-3">
              {signalKeys.map((key) => {
                const value = loan[key as keyof BucketedLoan] as number | undefined;
                const reasonCodes = loan[REASON_CODE_KEYS[key] as keyof BucketedLoan] as string[] | undefined;
                
                return (
                  <div key={key}>
                    <div className="flex items-center justify-between mb-1">
                      <span className={`text-sm ${isDarkMode ? 'text-slate-300' : 'text-slate-600'}`}>
                        {SIGNAL_LABELS[key]}
                      </span>
                      <span className={`text-xs px-2 py-0.5 rounded ${getSignalColor(value)} text-white`}>
                        {value ?? '-'} / 6 - {getSignalLabel(value)}
                      </span>
                    </div>
                    <div className={`h-2 rounded-full overflow-hidden ${isDarkMode ? 'bg-slate-700' : 'bg-slate-200'}`}>
                      <div
                        className={`h-full rounded-full transition-all ${getSignalColor(value)}`}
                        style={{ width: `${((value ?? 0) / 6) * 100}%` }}
                      />
                    </div>
                    {reasonCodes && reasonCodes.length > 0 && (
                      <p className={`text-xs mt-1 ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>
                        {reasonCodes.join(', ')}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Risk Summary */}
          {riskSummary && (
            <div className="mb-6">
              <h3 className="text-sm font-semibold uppercase tracking-wide mb-4">Risk Assessment</h3>
              
              {riskSummary.risks.length > 0 && (
                <div className="mb-4">
                  <div className="flex items-center gap-2 mb-2">
                    <AlertTriangle className="w-4 h-4 text-red-500" />
                    <span className={`text-sm font-medium ${isDarkMode ? 'text-red-400' : 'text-red-600'}`}>Risk Factors</span>
                  </div>
                  <ul className={`space-y-1 ml-6 ${isDarkMode ? 'text-slate-300' : 'text-slate-600'}`}>
                    {riskSummary.risks.map((risk, i) => (
                      <li key={i} className="text-sm list-disc">{risk}</li>
                    ))}
                  </ul>
                </div>
              )}
              
              {riskSummary.positives.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <CheckCircle className="w-4 h-4 text-emerald-500" />
                    <span className={`text-sm font-medium ${isDarkMode ? 'text-emerald-400' : 'text-emerald-600'}`}>Positive Indicators</span>
                  </div>
                  <ul className={`space-y-1 ml-6 ${isDarkMode ? 'text-slate-300' : 'text-slate-600'}`}>
                    {riskSummary.positives.map((positive, i) => (
                      <li key={i} className="text-sm list-disc">{positive}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* AI Recommendations Section */}
          <div className={`p-4 rounded-xl ${isDarkMode ? 'bg-slate-800/50' : 'bg-slate-50'}`}>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-purple-500" />
                <h3 className="text-sm font-semibold">AI Recommendations</h3>
              </div>
              {!aiRecommendations && !aiLoading && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={fetchAiRecommendations}
                  className="text-xs"
                >
                  Get Recommendations
                </Button>
              )}
            </div>
            
            {aiLoading && (
              <div className="flex items-center gap-2 text-sm text-slate-500">
                <Loader2 className="w-4 h-4 animate-spin" />
                Getting AI recommendations...
              </div>
            )}
            
            {aiError && (
              <p className="text-sm text-red-500">{aiError}</p>
            )}
            
            {aiRecommendations && aiRecommendations.length > 0 && (
              <ul className={`space-y-2 ${isDarkMode ? 'text-slate-300' : 'text-slate-600'}`}>
                {aiRecommendations.map((rec, i) => (
                  <li key={i} className="text-sm flex items-start gap-2">
                    <span className="text-purple-500 mt-1">-</span>
                    {rec}
                  </li>
                ))}
              </ul>
            )}
            
            {aiRecommendations && aiRecommendations.length === 0 && (
              <p className={`text-sm ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>
                No specific recommendations available for this loan.
              </p>
            )}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </Dialog>
  );
}
