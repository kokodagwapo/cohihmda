import React, { useState, useEffect, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogClose } from '@/components/ui/dialog';
import { X, ChevronRight } from 'lucide-react';
import { LoanRiskDistribution } from './LoanRiskDistribution';
import { LoanDrilldownModal } from './LoanDrilldownModal';
import { ExportShareMenu } from '@/components/common/ExportShareMenu';
import type { ExportData } from '@/utils/exportUtils';

interface OfficerData {
  name: string;
  email: string | null;
  phone: string | null;
  totalLoans: number;
  activeLoans: number;
  closedLoans: number;
  pullThrough: string;
  totalVolume: string;
  activeVolume: string;
  closedVolume: string;
  atRiskVolume: string;
}

interface LoanDetail {
  id: string;
  guid: string;
  borrower: string;
  amount: string;
  amountValue: number;
  riskLevel: string;
  riskScore: number;
  predictedOutcome: string;
  reason: string;
  status: string;
  loanType: string;
  lender: string;
  ficoScore: number | null;
  ltvRatio: number | null;
  dtiRatio: number | null;
}

interface LoanOfficerModalProps {
  officerName: string;
  isOpen: boolean;
  onClose: () => void;
  isDarkMode?: boolean;
}

export const LoanOfficerModal: React.FC<LoanOfficerModalProps> = ({
  officerName,
  isOpen,
  onClose,
  isDarkMode = false
}) => {
  const modalRef = useRef<HTMLDivElement>(null);
  const [officer, setOfficer] = useState<OfficerData | null>(null);
  const [riskBreakdown, setRiskBreakdown] = useState<{ veryHigh: number; medium: number; low: number } | null>(null);
  const [loans, setLoans] = useState<LoanDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState<'risk' | 'amount' | 'borrower'>('risk');
  const [drilldownLoan, setDrilldownLoan] = useState<LoanDetail | null>(null);

  const getExportData = (): ExportData => ({
    title: `${officerName} Loans`,
    tables: [
      {
        name: "Loan Officer Detail",
        headers: ["Borrower", "Amount", "Risk", "Status", "Type", "FICO", "LTV", "DTI"],
        rows: loans.map((loan) => [
          loan.borrower,
          loan.amount,
          loan.riskLevel,
          loan.status,
          loan.loanType,
          loan.ficoScore ?? "--",
          loan.ltvRatio ?? "--",
          loan.dtiRatio ?? "--",
        ]),
      },
    ],
  });

  useEffect(() => {
    if (isOpen && officerName) {
      fetchOfficerData();
    }
  }, [isOpen, officerName]);

  const fetchOfficerData = async () => {
    setLoading(true);
    try {
      // TODO: Replace with actual API endpoint
      // For now, create mock data
      const mockOfficer: OfficerData = {
        name: officerName,
        email: null,
        phone: null,
        totalLoans: 0,
        activeLoans: 0,
        closedLoans: 0,
        pullThrough: '0%',
        totalVolume: '$0',
        activeVolume: '$0',
        closedVolume: '$0',
        atRiskVolume: '$0'
      };
      
      // Sample loans for demo; replace with API when available
      const mockLoans: LoanDetail[] = [
        { id: 'LN-2025-001', guid: 'a1', borrower: 'Jane Smith', amount: '$425,000', amountValue: 425000, riskLevel: 'Very High', riskScore: 82, predictedOutcome: 'at_risk', reason: 'LTV > 95% and FICO below 680; rate lock expires in 12 days.', status: 'Processing', loanType: 'Conventional', lender: 'Sample Lender', ficoScore: 665, ltvRatio: 97, dtiRatio: 41 },
        { id: 'LN-2025-002', guid: 'a2', borrower: 'Robert Jones', amount: '$312,000', amountValue: 312000, riskLevel: 'Medium', riskScore: 58, predictedOutcome: 'at_risk', reason: 'DTI at 44%; one missing pay stub.', status: 'Processing', loanType: 'FHA', lender: 'Sample Lender', ficoScore: 698, ltvRatio: 92, dtiRatio: 44 },
        { id: 'LN-2025-003', guid: 'a3', borrower: 'Maria Garcia', amount: '$580,000', amountValue: 580000, riskLevel: 'Low', riskScore: 24, predictedOutcome: 'originate', reason: 'Strong profile; docs complete.', status: 'Clear to Close', loanType: 'Jumbo', lender: 'Sample Lender', ficoScore: 748, ltvRatio: 78, dtiRatio: 35 },
      ];
      const mockRiskBreakdown = {
        veryHigh: mockLoans.filter((l) => l.riskLevel === 'Very High').length,
        medium: mockLoans.filter((l) => l.riskLevel === 'Medium').length,
        low: mockLoans.filter((l) => l.riskLevel === 'Low').length,
      };
      const mockOfficerWithCounts: OfficerData = {
        ...mockOfficer,
        activeLoans: mockLoans.length,
        activeVolume: '$1,317,000',
        atRiskVolume: '$737,000',
        pullThrough: '72%',
        closedLoans: 8,
      };

      setOfficer(mockOfficerWithCounts);
      setRiskBreakdown(mockRiskBreakdown);
      setLoans(mockLoans);
    } catch (error) {
      console.error('Failed to fetch officer data:', error);
    }
    setLoading(false);
  };

  const sortedLoans = [...loans].sort((a, b) => {
    switch (sortBy) {
      case 'risk':
        return b.riskScore - a.riskScore;
      case 'amount':
        return b.amountValue - a.amountValue;
      case 'borrower':
        return a.borrower.localeCompare(b.borrower);
      default:
        return 0;
    }
  });

  const predictedFalloutCount = (riskBreakdown?.veryHigh ?? 0) + (riskBreakdown?.medium ?? 0);

  /** Map LoanDetail to the shape expected by LoanDrilldownModal (LoanData). */
  const loanToDrilldownData = (loan: LoanDetail) => ({
    id: loan.id,
    loan_number: loan.id,
    guid: loan.guid,
    officer: officerName,
    amount: loan.amount,
    amountValue: loan.amountValue,
    riskLevel: loan.riskLevel,
    riskScore: loan.riskScore,
    reason: loan.reason,
    loanType: loan.loanType,
    status: loan.status,
    ficoScore: loan.ficoScore,
    ltvRatio: loan.ltvRatio,
    dtiRatio: loan.dtiRatio,
  });

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        ref={modalRef}
        hideCloseButton
        className="w-[95vw] max-w-3xl max-h-[90vh] overflow-hidden flex flex-col bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 p-4 sm:p-6"
      >
        <DialogHeader className="flex-shrink-0 flex flex-row items-start justify-between gap-3 pb-4 border-b border-slate-200 dark:border-slate-700">
          <div className="space-y-1">
            <DialogTitle className="text-base sm:text-lg">{officerName}</DialogTitle>
            <DialogDescription className="text-xs sm:text-sm">Portfolio — pipeline, predicted fallout, and loans by risk</DialogDescription>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <ExportShareMenu
              title={`${officerName} Loans`}
              targetRef={modalRef}
              getExportData={getExportData}
              shareTarget={{ type: "loan-officer-detail", id: officerName, label: officerName }}
            />
            <DialogClose
              className="rounded-lg p-2 bg-slate-50/80 dark:bg-slate-800/80 text-slate-600 dark:text-slate-400 border-0 shadow-sm opacity-70 ring-offset-background transition-all hover:opacity-100 hover:bg-slate-100 dark:hover:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2 disabled:pointer-events-none"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </DialogClose>
          </div>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-12 flex-1">
            <div className="animate-spin w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full" />
          </div>
        ) : officer ? (
          <div className="flex-1 overflow-y-auto space-y-5 pt-4">
            {/* KPIs: Pipeline + Predicted fallouts */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/30 border border-slate-200 dark:border-slate-700">
                <p className="text-[10px] sm:text-xs uppercase tracking-wider font-medium text-slate-500 dark:text-slate-400">Pipeline</p>
                <p className="text-lg sm:text-xl font-semibold text-slate-900 dark:text-slate-100 mt-1">{officer.activeVolume}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{officer.activeLoans} loans</p>
              </div>
              <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/30 border border-slate-200 dark:border-slate-700">
                <p className="text-[10px] sm:text-xs uppercase tracking-wider font-medium text-slate-500 dark:text-slate-400">Predicted fallout</p>
                <p className="text-lg sm:text-xl font-semibold text-rose-600 dark:text-rose-400 mt-1">{predictedFalloutCount}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">loans at risk</p>
              </div>
              <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/30 border border-slate-200 dark:border-slate-700 col-span-2 sm:col-span-1">
                <p className="text-[10px] sm:text-xs uppercase tracking-wider font-medium text-slate-500 dark:text-slate-400">Pull-through</p>
                <p className={`text-lg sm:text-xl font-semibold mt-1 ${parseFloat(officer.pullThrough) >= 70 ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>{officer.pullThrough}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{officer.closedLoans} closed</p>
              </div>
            </div>

            {loans.length > 0 && (
            <div>
              <div className="flex items-center justify-between gap-2 mb-3">
                <h3 className="text-xs sm:text-sm font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400">
                  Loans ({loans.length}) — highest risk first · click for details
                </h3>
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as 'risk' | 'amount' | 'borrower')}
                  className="text-xs sm:text-sm px-3 py-2 rounded-lg border bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-600 text-slate-700 dark:text-slate-200"
                >
                  <option value="risk">By risk</option>
                  <option value="amount">By amount</option>
                  <option value="borrower">By name</option>
                </select>
              </div>
              <div className="space-y-2 max-h-[45vh] overflow-y-auto pr-1">
                {sortedLoans.map((loan) => (
                  <button
                    type="button"
                    key={loan.id}
                    onClick={() => setDrilldownLoan(loan)}
                    className="w-full text-left p-4 sm:p-5 rounded-lg border bg-slate-50 dark:bg-slate-800/30 border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800/50 transition-colors focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2"
                  >
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 bg-slate-100 dark:bg-slate-700">
                          <svg className="w-5 h-5 text-slate-500 dark:text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                          </svg>
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="font-normal text-[15px] tracking-tight truncate text-slate-700 dark:text-slate-100">{loan.id}</p>
                          <p className="text-[13px] font-light truncate text-slate-400 dark:text-slate-500">{loan.borrower}</p>
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0 flex items-center gap-2">
                        <p className="font-light text-[18px] tracking-tight text-slate-800 dark:text-slate-100">{loan.amount}</p>
                        <span
                          className={`text-[11px] font-normal px-2.5 py-1 rounded-lg inline-block border ${
                            loan.riskLevel === 'Very High'
                              ? 'bg-rose-50 text-rose-600 border-rose-200 dark:bg-rose-900/20 dark:text-rose-400 dark:border-rose-800'
                              : loan.riskLevel === 'Medium'
                                ? 'bg-amber-50 text-amber-600 border-amber-200 dark:bg-amber-900/20 dark:text-amber-400 dark:border-amber-800'
                                : 'bg-emerald-50 text-emerald-600 border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-400 dark:border-emerald-800'
                          }`}
                        >
                          {loan.riskLevel === 'Very High' ? 'Critical' : loan.riskLevel === 'Medium' ? 'At Risk' : 'Low'}
                        </span>
                        <ChevronRight className="h-4 w-4 text-slate-400 flex-shrink-0" aria-hidden />
                      </div>
                    </div>
                    <p className="text-[14px] font-light leading-relaxed text-slate-500 dark:text-slate-400">{loan.reason}</p>
                    <LoanRiskDistribution
                      ficoScore={loan.ficoScore}
                      ltvRatio={loan.ltvRatio}
                      dtiRatio={loan.dtiRatio}
                      isDarkMode={isDarkMode}
                    />
                  </button>
                ))}
              </div>
            </div>
            )}
          </div>
        ) : (
          <p className={`text-center py-8 text-slate-400 dark:text-slate-500`}>
            No data found for this loan officer.
          </p>
        )}
      </DialogContent>

      {drilldownLoan && (
        <LoanDrilldownModal
          loan={loanToDrilldownData(drilldownLoan)}
          isOpen={!!drilldownLoan}
          onClose={() => setDrilldownLoan(null)}
          isDarkMode={isDarkMode}
        />
      )}
    </Dialog>
  );
};
