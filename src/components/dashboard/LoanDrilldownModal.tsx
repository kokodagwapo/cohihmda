import React, { useState, memo } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { LoanCardContent } from "./LoanCardContent";

interface RiskSummary {
  risks: string[];
  positives: string[];
  overallRisk: string;
  predictedOutcome: "originate" | "withdraw" | "deny" | "at_risk";
  confidence: number;
}

interface LoanData {
  id: string;
  loan_number?: string | null;
  guid?: string;
  officer: string;
  amount: string;
  amountValue?: number;
  officerTtsScore?: number | null;
  officerTier?: string | null;
  riskLevel: string;
  riskScore: number;
  reason: string;
  loanType?: string;
  loanPurpose?: string | null;
  channel?: string | null;
  status?: string;
  ficoScore: number | null;
  ltvRatio: number | null;
  dtiRatio: number | null;
  currentMilestone?: string | null;
  activeDays?: number | null;
  estimatedClosingDate?: string | null;
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
  riskSummary?: RiskSummary;
  creditMetricsSignalStrength?: number | null;
  loanCharacteristicsSignalStrength?: number | null;
  timeInMotionSignalStrength?: number | null;
  mloAeFalloutProneSignalStrength?: number | null;
  interestLockVsMarketSignalStrength?: number | null;
  uwPullthroughSignalStrength?: number | null;
  closerPullthroughSignalStrength?: number | null;
  processorPullthroughSignalStrength?: number | null;
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
  onSelectOfficer?: (officer: string) => void;
  selectedTenantId?: string | null;
}

export const LoanDrilldownModal: React.FC<LoanDrilldownModalProps> = memo(
  ({
    loan,
    isOpen,
    onClose,
    isDarkMode = false,
    onSelectOfficer,
    selectedTenantId,
  }) => {
    const [emailLoading, setEmailLoading] = useState(false);

    const getRiskLabel = (level: string) => {
      if (level === "Very High") return "CRITICAL";
      if (level === "Medium") return "WARNING";
      return "SUCCESS";
    };

    const riskLabel = getRiskLabel(loan.riskLevel);

    const handleEmail = async () => {
      setEmailLoading(true);
      try {
        const lenderCoaching: string[] = [];
        const borrowerCoaching: string[] = [];

        if (loan.ficoScore && loan.ficoScore < 620) {
          lenderCoaching.push(
            `With FICO at ${loan.ficoScore}, request 12-month payment history for rent/utilities as compensating factor`
          );
          borrowerCoaching.push(
            `Do not open any new credit cards or store accounts until after closing`
          );
        }

        if (loan.ltvRatio && loan.ltvRatio > 95) {
          lenderCoaching.push(
            `At ${Math.round(
              loan.ltvRatio
            )}% LTV, order property inspection waiver eligibility check`
          );
          borrowerCoaching.push(
            `Save additional funds for potential appraisal gap coverage`
          );
        }

        if (loan.dtiRatio && loan.dtiRatio > 43) {
          lenderCoaching.push(
            `At ${Math.round(
              loan.dtiRatio
            )}% DTI, document non-QM pricing adjustment if applicable`
          );
          borrowerCoaching.push(
            `Avoid financing furniture, appliances, or vehicles before closing`
          );
        }

        const subject = encodeURIComponent(
          `Loan Update: ${loan.id} - ${loan.officer || "Unassigned"}`
        );
        const body = encodeURIComponent(
          `Loan ${loan.id}\n\n` +
            `Loan Officer: ${loan.officer || "Unassigned"}\n` +
            `Amount: ${loan.amount}\n` +
            `Status: ${riskLabel}\n` +
            `Risk Score: ${loan.riskScore}/100\n\n` +
            `FICO: ${loan.ficoScore || "N/A"}\n` +
            `LTV: ${
              loan.ltvRatio ? Math.round(loan.ltvRatio) + "%" : "N/A"
            }\n` +
            `DTI: ${
              loan.dtiRatio ? Math.round(loan.dtiRatio) + "%" : "N/A"
            }\n\n` +
            `Assessment: ${loan.reason}\n\n` +
            (lenderCoaching.length > 0
              ? `COACHING FOR LENDER\n${lenderCoaching
                  .map((t) => `  • ${t}`)
                  .join("\n")}\n\n`
              : "") +
            (borrowerCoaching.length > 0
              ? `COACHING FOR BORROWER\n${borrowerCoaching
                  .map((t) => `  • ${t}`)
                  .join("\n")}\n\n`
              : "")
        );
        window.open(`mailto:?subject=${subject}&body=${body}`, "_blank");
      } finally {
        setEmailLoading(false);
      }
    };

    const handleSave = () => {
      const loanNum = (loan.loan_number || "").toString().trim();
      const displayNum =
        loanNum &&
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          loanNum
        )
          ? loanNum
          : loan.id;
      const content = `Loan ${displayNum}\nOfficer: ${loan.officer}\nAmount: ${
        loan.amount
      }\nStatus: ${riskLabel}\nFICO: ${loan.ficoScore || "N/A"}\nLTV: ${
        loan.ltvRatio ? Math.round(loan.ltvRatio) : "N/A"
      }%\nDTI: ${loan.dtiRatio ? Math.round(loan.dtiRatio) : "N/A"}%`;
      const blob = new Blob([content], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `loan-${displayNum}.txt`;
      a.click();
      URL.revokeObjectURL(url);
    };

    return (
      <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-[80] bg-black/35 dark:bg-black/70 backdrop-blur-sm sm:backdrop-blur-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />

          <DialogPrimitive.Content className="fixed left-[50%] z-[90] flex flex-col w-full max-w-md sm:max-w-lg lg:max-w-2xl translate-x-[-50%] border border-slate-200/60 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xl duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 rounded-t-2xl sm:rounded-2xl max-h-[90vh] top-auto bottom-0 sm:top-28 sm:bottom-auto md:top-[50%] md:translate-y-[-50%] md:bottom-auto outline-none overflow-hidden">
            <DialogPrimitive.Close className="absolute top-4 right-4 z-[95] rounded-lg p-2 bg-slate-50/80 dark:bg-slate-800/80 text-slate-600 dark:text-slate-400 border-0 shadow-sm opacity-70 ring-offset-background transition-all hover:opacity-100 hover:bg-slate-100 dark:hover:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2 disabled:pointer-events-none">
              <X className="h-4 w-4" />
              <span className="sr-only">Close</span>
            </DialogPrimitive.Close>

            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-4 sm:p-6 pt-2">
              <LoanCardContent
                loan={loan}
                isDarkMode={isDarkMode}
                onSelectOfficer={onSelectOfficer}
                showTapForDetails={false}
                showRiskBreakdown={true}
                selectedTenantId={selectedTenantId}
              />
            </div>

            <div className="flex-shrink-0 flex items-center gap-2 px-4 sm:px-6 py-2.5 border-t border-slate-200/60 dark:border-slate-700 bg-white dark:bg-slate-900">
              <button
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-[13px] font-light transition-all active:scale-[0.98] ${
                  emailLoading ? "opacity-60" : ""
                } text-slate-500 hover:text-slate-700 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-slate-200 dark:hover:bg-slate-800`}
                disabled={emailLoading}
                onClick={handleEmail}
              >
                {emailLoading ? (
                  <div className="animate-spin w-4 h-4 border-2 border-current border-t-transparent rounded-full" />
                ) : (
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                    />
                  </svg>
                )}
                Email
              </button>
              <div
                className="w-px h-10 bg-slate-200 dark:bg-slate-600 flex-shrink-0"
                aria-hidden
              />
              <button
                className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-[13px] font-light transition-all active:scale-[0.98] text-slate-500 hover:text-slate-700 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-slate-200 dark:hover:bg-slate-800"
                onClick={handleSave}
              >
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                  />
                </svg>
                Save
              </button>
            </div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </Dialog>
    );
  }
);

LoanDrilldownModal.displayName = "LoanDrilldownModal";
