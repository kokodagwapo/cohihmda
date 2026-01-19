import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

interface RiskCaseBreakdown {
  rateLockExpiry?: string;
  currentRate?: string;
  marketRate?: string;
  estimatedLoss?: string;
  missingDocs?: string[];
  lastContact?: string;
  estimatedDelay?: string;
  issues?: string[];
  probabilityApproval?: string;
  appraiserAssigned?: string;
  scheduledDate?: string;
  estimatedValue?: string;
  actions?: string[];
  timeline?: Array<{
    event: string;
    date: string;
    status: 'completed' | 'in-progress' | 'flagged' | 'pending';
  }>;
}

interface RiskCase {
  borrower: string;
  loanAmount: number;
  risk: 'high' | 'medium' | 'low';
  daysOverdue: number;
  breakdown?: RiskCaseBreakdown;
}

interface RiskModalProps {
  open: boolean;
  case: RiskCase | null;
  onClose: () => void;
}

export function RiskModal({ open, case: riskCase, onClose }: RiskModalProps) {
  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-w-[95vw] sm:max-w-3xl bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 sm:gap-3 text-base sm:text-lg">
            <div className={`w-2.5 h-2.5 sm:w-3 sm:h-3 rounded-full ${riskCase?.risk === 'high' ? 'bg-red-500' : 'bg-yellow-500'}`} />
            <span>Risk Case: {riskCase?.borrower}</span>
          </DialogTitle>
          <DialogDescription>
            Detailed analysis and action plan
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 sm:space-y-6">
          {riskCase && (
            <>
              {/* Overview */}
              <div className="grid grid-cols-3 gap-2 sm:gap-4 p-3 sm:p-4 bg-slate-50 dark:bg-slate-800/30 rounded-xl">
                <div>
                  <div className="text-[10px] sm:text-xs text-slate-500 dark:text-slate-400 mb-1">Loan Amount</div>
                  <div className="text-sm sm:text-lg font-semibold text-slate-900 dark:text-slate-50">
                    ${(riskCase.loanAmount / 1000).toFixed(0)}K
                  </div>
                </div>
                <div>
                  <div className="text-[10px] sm:text-xs text-slate-500 dark:text-slate-400 mb-1">Risk Level</div>
                  <div className={`text-sm sm:text-lg font-semibold capitalize ${riskCase.risk === 'high' ? 'text-red-600' : 'text-yellow-600'}`}>
                    {riskCase.risk}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] sm:text-xs text-slate-500 dark:text-slate-400 mb-1">Days Overdue</div>
                  <div className="text-sm sm:text-lg font-semibold text-slate-900 dark:text-slate-50">
                    {riskCase.daysOverdue}
                  </div>
                </div>
              </div>

              {/* Key Details */}
              <div className="space-y-3 sm:space-y-4">
                <h3 className="font-semibold text-sm sm:text-base text-slate-900 dark:text-slate-50">Key Issues</h3>
                {riskCase.breakdown?.rateLockExpiry && (
                  <div className="p-2.5 sm:p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                    <div className="font-medium text-sm sm:text-base text-red-900 dark:text-red-200">Rate Lock Expiring</div>
                    <div className="text-xs sm:text-sm text-red-700 dark:text-red-300 mt-1">
                      Time remaining: {riskCase.breakdown.rateLockExpiry}
                    </div>
                    <div className="text-xs sm:text-sm text-red-700 dark:text-red-300">
                      Current rate: {riskCase.breakdown.currentRate} | Market rate: {riskCase.breakdown.marketRate}
                    </div>
                    <div className="text-xs sm:text-sm font-semibold text-red-900 dark:text-red-200 mt-2">
                      Estimated loss if rate expires: {riskCase.breakdown.estimatedLoss}
                    </div>
                  </div>
                )}
                {riskCase.breakdown?.missingDocs && (
                  <div className="p-2.5 sm:p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg">
                    <div className="font-medium text-sm sm:text-base text-yellow-900 dark:text-yellow-200">Missing Documentation</div>
                    <ul className="text-xs sm:text-sm text-yellow-700 dark:text-yellow-300 mt-2 space-y-1">
                      {riskCase.breakdown.missingDocs.map((doc, i) => (
                        <li key={i}>• {doc}</li>
                      ))}
                    </ul>
                    <div className="text-xs sm:text-sm text-yellow-700 dark:text-yellow-300 mt-2">
                      Last contact: {riskCase.breakdown.lastContact} | Estimated delay: {riskCase.breakdown.estimatedDelay}
                    </div>
                  </div>
                )}
                {riskCase.breakdown?.issues && (
                  <div className="p-2.5 sm:p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                    <div className="font-medium text-sm sm:text-base text-red-900 dark:text-red-200">Underwriting Issues</div>
                    <ul className="text-xs sm:text-sm text-red-700 dark:text-red-300 mt-2 space-y-1">
                      {riskCase.breakdown.issues.map((issue, i) => (
                        <li key={i}>• {issue}</li>
                      ))}
                    </ul>
                    <div className="text-xs sm:text-sm text-red-700 dark:text-red-300 mt-2">
                      Probability of approval: {riskCase.breakdown.probabilityApproval} | Potential loss: {riskCase.breakdown.estimatedLoss}
                    </div>
                  </div>
                )}
                {riskCase.breakdown?.appraiserAssigned && (
                  <div className="p-2.5 sm:p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
                    <div className="font-medium text-sm sm:text-base text-blue-900 dark:text-blue-200">Appraisal Status</div>
                    <div className="text-xs sm:text-sm text-blue-700 dark:text-blue-300 mt-1">
                      Appraiser: {riskCase.breakdown.appraiserAssigned}
                    </div>
                    <div className="text-xs sm:text-sm text-blue-700 dark:text-blue-300">
                      Scheduled: {riskCase.breakdown.scheduledDate} | Est. value: {riskCase.breakdown.estimatedValue}
                    </div>
                  </div>
                )}
              </div>

              {/* Action Items */}
              <div className="space-y-2 sm:space-y-3">
                <h3 className="font-semibold text-sm sm:text-base text-slate-900 dark:text-slate-50">Recommended Actions</h3>
                <div className="space-y-2">
                  {riskCase.breakdown?.actions?.map((action, i) => (
                    <div key={i} className="flex items-start gap-2 sm:gap-3 p-2 sm:p-3 bg-slate-50 dark:bg-slate-800/30 rounded-lg">
                      <div className="w-5 h-5 sm:w-6 sm:h-6 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-blue-600 dark:text-blue-400 text-xs sm:text-sm font-semibold flex-shrink-0">
                        {i + 1}
                      </div>
                      <div className="text-xs sm:text-sm text-slate-700 dark:text-slate-300 flex-1">{action}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Timeline */}
              <div className="space-y-2 sm:space-y-3">
                <h3 className="font-semibold text-sm sm:text-base text-slate-900 dark:text-slate-50">Timeline</h3>
                <div className="space-y-2">
                  {riskCase.breakdown?.timeline?.map((event, i) => (
                    <div key={i} className="flex items-start gap-2 sm:gap-3">
                      <div className={`w-2.5 h-2.5 sm:w-3 sm:h-3 rounded-full mt-1 flex-shrink-0 ${
                        event.status === 'completed' ? 'bg-green-500' : 
                        event.status === 'in-progress' ? 'bg-blue-500' : 
                        event.status === 'flagged' ? 'bg-red-500' : 
                        'bg-slate-300 dark:bg-slate-600'
                      }`} />
                      <div className="flex-1">
                        <div className="text-xs sm:text-sm font-medium text-slate-900 dark:text-slate-50">{event.event}</div>
                        <div className="text-[10px] sm:text-xs text-slate-500 dark:text-slate-400">{event.date}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

