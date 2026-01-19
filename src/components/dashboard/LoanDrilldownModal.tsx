import React, { useState, useEffect, useRef } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { LoanRiskDistribution } from './LoanRiskDistribution';

interface LoanData {
  id: string;
  guid?: string;
  borrower: string;
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
}

interface LoanDrilldownModalProps {
  loan: LoanData;
  isOpen: boolean;
  onClose: () => void;
  isDarkMode?: boolean;
}

export const LoanDrilldownModal: React.FC<LoanDrilldownModalProps> = ({
  loan,
  isOpen,
  onClose,
  isDarkMode = false
}) => {
  const [emailLoading, setEmailLoading] = useState(false);
  const loanDetailsRef = useRef<HTMLDivElement>(null);

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

  const riskStyles = getRiskStyles(loan.riskLevel);
  const riskLabel = getRiskLabel(loan.riskLevel);

  const ficoStatus = getMetricStatus('fico', loan.ficoScore);
  const ltvStatus = getMetricStatus('ltv', loan.ltvRatio);
  const dtiStatus = getMetricStatus('dti', loan.dtiRatio);

  const successes: string[] = [];
  const warnings: string[] = [];
  const criticals: string[] = [];

  if (loan.ficoScore) {
    if (loan.ficoScore >= 700) successes.push(`Strong credit profile (FICO ${loan.ficoScore})`);
    else if (loan.ficoScore >= 620) warnings.push(`Credit needs monitoring (FICO ${loan.ficoScore})`);
    else criticals.push(`Subprime credit risk (FICO ${loan.ficoScore})`);
  }
  if (loan.ltvRatio) {
    if (loan.ltvRatio <= 80) successes.push(`Healthy equity position (LTV ${loan.ltvRatio.toFixed(0)}%)`);
    else if (loan.ltvRatio <= 95) warnings.push(`Elevated LTV may require PMI (${loan.ltvRatio.toFixed(0)}%)`);
    else criticals.push(`Very high LTV indicates minimal equity (${loan.ltvRatio.toFixed(0)}%)`);
  }
  if (loan.dtiRatio) {
    if (loan.dtiRatio <= 36) successes.push(`Manageable debt load (DTI ${loan.dtiRatio.toFixed(0)}%)`);
    else if (loan.dtiRatio <= 43) warnings.push(`DTI approaching threshold (${loan.dtiRatio.toFixed(0)}%)`);
    else criticals.push(`DTI exceeds QM threshold (${loan.dtiRatio.toFixed(0)}%)`);
  }

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

      const subject = encodeURIComponent(`Loan Update: ${loan.id} - ${loan.borrower}`);
      const body = encodeURIComponent(
        `Loan ${loan.id}\n\n` +
        `Borrower: ${loan.borrower}\n` +
        `Officer: ${loan.officer}\n` +
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
          className="fixed left-[50%] z-[90] flex flex-col w-full max-w-md translate-x-[-50%] gap-4 border border-slate-200/60 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-6 shadow-xl duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 rounded-t-2xl sm:rounded-2xl max-h-[90vh] overflow-y-auto overscroll-contain top-auto bottom-0 sm:top-28 sm:bottom-auto md:top-[50%] md:translate-y-[-50%] md:bottom-auto outline-none"
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
            <span className={`px-3 py-1.5 rounded-lg text-[10px] font-medium tracking-wide ${riskStyles.bg} ${riskStyles.text}`}>
              {riskLabel}
            </span>
            </div>
          </div>
        
        <div ref={loanDetailsRef} className="space-y-4">
          <div className="grid grid-cols-3 gap-2">
            <div className={`p-3 rounded-xl text-center ${getMetricColor(ficoStatus)}`}>
              <p className="text-lg font-light tracking-tight">{loan.ficoScore || '—'}</p>
              <p className="text-[9px] uppercase tracking-wider font-medium opacity-70">FICO</p>
            </div>
            <div className={`p-3 rounded-xl text-center ${getMetricColor(ltvStatus)}`}>
              <p className="text-lg font-light tracking-tight">{loan.ltvRatio ? `${loan.ltvRatio.toFixed(0)}%` : '—'}</p>
              <p className="text-[9px] uppercase tracking-wider font-medium opacity-70">LTV</p>
            </div>
            <div className={`p-3 rounded-xl text-center ${getMetricColor(dtiStatus)}`}>
              <p className="text-lg font-light tracking-tight">{loan.dtiRatio ? `${loan.dtiRatio.toFixed(0)}%` : '—'}</p>
              <p className="text-[9px] uppercase tracking-wider font-medium opacity-70">DTI</p>
            </div>
          </div>

          <div className={`p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50`}>
            <div className="flex items-center justify-between">
              <div className="min-w-0 flex-1">
                <p className={`text-[10px] uppercase tracking-wider font-medium mb-1 text-slate-500 dark:text-slate-400`}>
                  {loan.borrower === 'Unknown' || loan.borrower === loan.officer ? 'Loan Officer' : 'Borrower'}
                </p>
                <p className={`font-normal text-sm truncate text-slate-900 dark:text-slate-100`}>{loan.borrower}</p>
              </div>
              {loan.borrower !== loan.officer && loan.officer !== 'Unassigned' && (
                <div className="text-right ml-4">
                  <p className={`text-[10px] uppercase tracking-wider font-medium mb-1 text-slate-500 dark:text-slate-400`}>Officer</p>
                  <p className={`font-normal text-sm truncate text-slate-900 dark:text-slate-100`}>{loan.officer}</p>
                </div>
              )}
            </div>
          </div>

          <div className="space-y-3">
            {successes.length > 0 && (
              <div className={`p-4 rounded-xl border-l-4 bg-sky-50 dark:bg-sky-900/20 border-sky-400`}>
                <p className={`text-[11px] font-medium uppercase tracking-wider mb-2 text-sky-600 dark:text-sky-400`}>
                  {successes.length > 1 ? 'Successes' : 'Success'}
                </p>
                <div className={`text-[13px] font-light space-y-1 text-sky-700 dark:text-sky-300`}>
                  {successes.map((s, i) => <p key={i}>• {s}</p>)}
                </div>
              </div>
            )}
            
            {warnings.length > 0 && (
              <div className={`p-4 rounded-xl border-l-4 bg-amber-50 dark:bg-amber-900/20 border-amber-500`}>
                <p className={`text-[11px] font-medium uppercase tracking-wider mb-2 text-amber-600 dark:text-amber-400`}>
                  {warnings.length > 1 ? 'Warnings' : 'Warning'}
                </p>
                <div className={`text-[13px] font-light space-y-1 text-amber-700 dark:text-amber-300`}>
                  {warnings.map((w, i) => <p key={i}>• {w}</p>)}
                </div>
              </div>
            )}
            
            {criticals.length > 0 && (
              <div className={`p-4 rounded-xl border-l-4 bg-red-50 dark:bg-red-900/20 border-red-500`}>
                <p className={`text-[11px] font-medium uppercase tracking-wider mb-2 text-red-600 dark:text-red-400`}>
                  Critical
                </p>
                <div className={`text-[13px] font-light space-y-1 text-red-700 dark:text-red-300`}>
                  {criticals.map((c, i) => <p key={i}>• {c}</p>)}
                </div>
              </div>
            )}

            {successes.length === 0 && warnings.length === 0 && criticals.length === 0 && (
              <div className={`p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50`}>
                <p className={`text-[13px] font-light text-slate-500 dark:text-slate-400`}>
                  {loan.reason || 'No additional risk factors identified.'}
                </p>
              </div>
            )}
          </div>

          <LoanRiskDistribution
            ficoScore={loan.ficoScore}
            ltvRatio={loan.ltvRatio}
            dtiRatio={loan.dtiRatio}
            isDarkMode={isDarkMode}
          />

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
};
