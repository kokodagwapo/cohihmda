import React, { useState, useRef, memo, useCallback, useEffect } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X, Loader2, Plus, Trash2 } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { LoanCardContent } from "./LoanCardContent";
import { api } from "@/lib/api";
import type { LoanFalloutStatus } from "./LoanCardsContainer";

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
  rateReferenceType?: "lock" | "application" | null;
  marketChangeDelta?: number | null;
  lockDate?: string | null;
  lockExpirationDate?: string | null;
  loPullthroughPct?: number | null;
  uwPullthroughPct?: number | null;
  closerPullthroughPct?: number | null;
  processorPullthroughPct?: number | null;
  riskSummary?: RiskSummary;
  closeLateRisk?: boolean | null;
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
  loan: LoanData | null;
  isOpen: boolean;
  onClose: () => void;
  isDarkMode?: boolean;
  onSelectOfficer?: (officer: string) => void;
  selectedTenantId?: string | null;
  /** When true, hide risk score line and LOW/CRITICAL/IMPORTANT label (e.g. credit risk drilldown) */
  hideRiskScoreAndLabel?: boolean;
  falloutStatus?: LoanFalloutStatus;
}

const RESPONSE_LABELS: Record<string, string> = {
  acknowledged: "Acknowledged",
  working_on_it: "Working on it",
  need_help: "Needs help",
};
const RESPONSE_COLORS: Record<string, string> = {
  acknowledged: "text-emerald-600 dark:text-emerald-400",
  working_on_it: "text-amber-600 dark:text-amber-400",
  need_help: "text-rose-600 dark:text-rose-400",
};

function formatLockExpirationForEmail(value: string | null | undefined): string {
  if (value == null || value === "") return "—";
  try {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    return d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return String(value);
  }
}

function buildEmailBody(loan: LoanData): string {
  const loanNum = (loan.loan_number || '').toString().trim();
  const displayNum = !loanNum || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(loanNum) ? loan.id : loanNum;
  const amt = loan.amountValue ?? (() => {
    const s = String(loan.amount);
    const num = parseFloat(s.replace(/[$,KkMm]/g, '')) || 0;
    if (s.toLowerCase().includes('m')) return num * 1e6;
    if (s.toLowerCase().includes('k')) return num * 1000;
    return num;
  })();
  const formatAmt = (val: number) => val >= 1000 ? `$${(val / 1000).toFixed(2)}K` : `$${val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const COMMISSION_MAX = 6000;
  const commissionLow = formatAmt(Math.min(amt * 0.005, COMMISSION_MAX));
  const commissionHigh = formatAmt(Math.min(amt * 0.01, COMMISSION_MAX));
  const officerTier = loan.officerTier === 'top' ? 'Top Tier' : loan.officerTier === 'second' ? 'Second Tier' : 'Bottom Tier';
  const officerSuffix = loan.officerTtsScore != null && !Number.isNaN(loan.officerTtsScore) ? `  ${officerTier} – ${Math.round(loan.officerTtsScore)}` : '';
  const isPastEcd = (() => {
    const ecdRaw = loan.estimatedClosingDate;
    if (ecdRaw == null || ecdRaw === '') return false;
    try {
      const ecd = new Date(ecdRaw);
      if (Number.isNaN(ecd.getTime())) return false;
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      ecd.setHours(0, 0, 0, 0);
      return today > ecd;
    } catch {
      return false;
    }
  })();
  const predictedLabel = loan.riskSummary?.predictedOutcome === 'deny' ? '▲ LIKELY DECLINE' :
    loan.riskSummary?.predictedOutcome === 'withdraw' ? '↩ LIKELY WITHDRAW' :
    isPastEcd ? '📅 PAST EST. CLOSING' :
    loan.closeLateRisk === true ? '⏱ LIKELY CLOSE LATE' :
    loan.riskSummary?.predictedOutcome === 'at_risk' ? '⚡ AT RISK' : null;
  const riskLabel = loan.riskLevel === 'Very High' ? 'CRITICAL' : loan.riskLevel === 'Medium' ? 'AT RISK' : 'LOW';
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
  const signalItems = [
    { label: 'Credit Metrics', value: loan.creditMetricsSignalStrength ?? null },
    { label: 'Loan Characteristics', value: loan.loanCharacteristicsSignalStrength ?? null },
    { label: 'Time in Motion', value: loan.timeInMotionSignalStrength ?? null },
    { label: 'MLO Fallout Prone', value: loan.mloAeFalloutProneSignalStrength ?? loan.loPullthroughSignal ?? null },
    { label: 'Lock vs Market', value: lockVsMarketBucket },
  ];
  const hasSignals = signalItems.some(s => s.value != null);
  const fmt = (v: number | null | undefined) => v != null && !Number.isNaN(v) ? String(v) : '—';
  const fmtPct = (v: number | null | undefined) => v != null && !Number.isNaN(v) ? `${v.toFixed(1)}%` : '—';
  const estClose = loan.estimatedClosingDate ? (() => {
    try {
      const d = new Date(loan.estimatedClosingDate);
      return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    } catch { return '—'; }
  })() : '—';

  const sep = '───────────────────────────────────────────────────────────';
  const top = '═══════════════════════════════════════════════════════════';
  let body = `${top}\nLOAN CARD\n${top}\n\n`;
  body += `Loan #${displayNum}\n`;
  body += `Estimated commission at risk: ${commissionLow} – ${commissionHigh}\n`;
  body += `MLO/AE: ${loan.officer || 'Unknown LO'}${officerSuffix}\n\n`;
  body += `${' '.repeat(36)}Loan Amount: $${loan.amount.replace(/^\$/, '')}\n`;
  if (predictedLabel) body += `${' '.repeat(36)}${predictedLabel}\n`;
  body += `${' '.repeat(36)}${riskLabel}\n\n`;
  body += `${sep}\n`;
  body += `● Risk Score: ${loan.riskScore}/100 (0 = lowest risk, 100 = highest risk)\n`;
  body += `${sep}\n\n`;

  if (hasSignals) {
    body += `SIGNAL BUCKETS (1=low, 6=high)\n`;
    body += signalItems.map(s => `  ${s.label}: ${s.value != null ? s.value : '—'}`).join('  |  ') + '\n\n';
  }

  body += `${sep}\nLOAN DETAILS\n${sep}\n`;
  body += `FICO: ${fmt(loan.ficoScore)}    LTV: ${loan.ltvRatio != null && !Number.isNaN(loan.ltvRatio) ? loan.ltvRatio.toFixed(0) + '%' : '—'}    DTI: ${loan.dtiRatio != null && !Number.isNaN(loan.dtiRatio) ? loan.dtiRatio.toFixed(0) + '%' : '—'}\n`;
  body += `LO PULLTHROUGH: ${fmtPct(loan.loPullthroughPct)}    TIME IN MOTION: ${loan.activeDays != null ? `${loan.activeDays} days` : '—'}\n`;
  body += `LOAN TYPE: ${loan.loanType || '—'}    LOAN PURPOSE: ${loan.loanPurpose || '—'}\n`;
  body += `CHANNEL: ${loan.channel || '—'}    MILESTONE: ${loan.currentMilestone || '—'}\n`;
  body += `ESTIMATED CLOSING DATE: ${estClose}\n\n`;

  if (loan.lockDate != null || loan.lockMarketRate != null || loan.marketRate != null || loan.lockExpirationDate != null) {
    body += `${sep}\nRATE & MARKET\n${sep}\n`;
    const rateLabel = loan.rateReferenceType === "application" ? "Rate at application" : "Market rate at lock";
    body += `${rateLabel}: ${loan.lockMarketRate != null && !Number.isNaN(Number(loan.lockMarketRate)) ? Number(loan.lockMarketRate).toFixed(3) + '%' : '—'}\n`;
    body += `Market rate today: ${loan.marketRate != null && !Number.isNaN(Number(loan.marketRate)) ? Number(loan.marketRate).toFixed(3) + '%' : '—'}\n`;
    body += `Market Delta: ${loan.marketChangeDelta != null && !Number.isNaN(Number(loan.marketChangeDelta)) ? (Number(loan.marketChangeDelta) > 0 ? '+' : '') + Number(loan.marketChangeDelta).toFixed(3) + '%' : '—'}\n`;
    body += `Lock Status: ${(loan.lockDate != null && loan.lockDate !== '') ? (loan.lockExpirationDate ? formatLockExpirationForEmail(loan.lockExpirationDate) : '—') : 'Locked: No'}\n\n`;
  }

  const loanIdentifier = !loanNum || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(loanNum) ? loan.id : loanNum;
  const viewUrl = `${window.location.origin}/insights?loan=${encodeURIComponent(loanIdentifier)}`;
  
  body += `${top}\n— Coheus\n${top}\n\n`;
  body += `View in Coheus: ${viewUrl}`;
  return body;
}

export const LoanDrilldownModal: React.FC<LoanDrilldownModalProps> = memo(
  ({
    loan,
    isOpen,
    onClose,
    isDarkMode = false,
    onSelectOfficer,
    selectedTenantId,
    hideRiskScoreAndLabel = false,
    falloutStatus,
  }) => {
    const [saveLoading, setSaveLoading] = useState(false);
    const [emailSending, setEmailSending] = useState(false);
    const [emailResult, setEmailResult] = useState<{ success: boolean; message: string } | null>(null);
    const [showEmailConfirm, setShowEmailConfirm] = useState(false);
    const [resolving, setResolving] = useState(false);
    const [loInfo, setLoInfo] = useState<{ email: string | null; name: string | null; redirectActive: boolean; redirectTo: string | null } | null>(null);
    const [additionalEmails, setAdditionalEmails] = useState<string[]>([]);
    const [newEmail, setNewEmail] = useState("");
    const [customMessage, setCustomMessage] = useState("");
    const cardRef = useRef<HTMLDivElement>(null);

  const captureCardAsBlob = useCallback(async (): Promise<Blob | null> => {
    const el = cardRef.current;
    if (!el) return null;
    const scrollParent = el.parentElement;
    const savedScrollTop = scrollParent?.scrollTop ?? 0;
    if (scrollParent && scrollParent.scrollHeight > scrollParent.clientHeight) {
      scrollParent.scrollTop = scrollParent.scrollHeight;
    }
    await new Promise((r) => setTimeout(r, 150));
    try {
      const html2canvas = (await import('html2canvas')).default;
      const pad = 24;
      const scale = 2;
      const contentCanvas = await html2canvas(el, {
        useCORS: true,
        allowTaint: true,
        scale,
        width: el.scrollWidth,
        height: el.scrollHeight + 40,
        backgroundColor: isDarkMode ? '#0f172a' : '#ffffff',
        logging: false,
      });
      const outW = contentCanvas.width + pad * 2 * scale;
      const outH = contentCanvas.height + pad * 2 * scale;
      const canvas = document.createElement('canvas');
      canvas.width = outW;
      canvas.height = outH;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = isDarkMode ? '#0f172a' : '#ffffff';
      ctx.fillRect(0, 0, outW, outH);
      ctx.drawImage(contentCanvas, pad * scale, pad * scale);
      if (scrollParent) scrollParent.scrollTop = savedScrollTop;
      return await new Promise<Blob | null>((resolve) => {
        canvas.toBlob((b) => resolve(b ?? null), 'image/png', 1);
      });
    } catch (e) {
      console.error('Card capture error:', e);
      return null;
    }
  }, [isDarkMode]);

  const openEmailConfirm = useCallback(async () => {
    if (!loan) return;
    setResolving(true);
    setEmailResult(null);
    setAdditionalEmails([]);
    setNewEmail("");
    setCustomMessage("");
    try {
      const info = await api.resolveLoanLo(loan.id, selectedTenantId);
      setLoInfo({
        email: info.loEmail,
        name: info.loName,
        redirectActive: info.redirectActive,
        redirectTo: info.redirectTo,
      });
      setShowEmailConfirm(true);
    } catch {
      setEmailResult({ success: false, message: "Failed to resolve LO email" });
    } finally {
      setResolving(false);
    }
  }, [loan, selectedTenantId]);

  const handleSendConfirmed = useCallback(async () => {
    if (!loan) return;
    try {
      setEmailSending(true);
      setEmailResult(null);
      const result = await api.sendFalloutAlertSingle(
        loan.id,
        selectedTenantId,
        additionalEmails.length > 0 ? additionalEmails : undefined,
        customMessage.trim() || undefined,
      );
      setEmailResult({ success: result.sent, message: result.message });
      setShowEmailConfirm(false);
    } catch (err: unknown) {
      setEmailResult({ success: false, message: err instanceof Error ? err.message : "Failed to send email" });
    } finally {
      setEmailSending(false);
    }
  }, [loan, selectedTenantId, additionalEmails, customMessage]);

  const addExtraEmail = useCallback(() => {
    const trimmed = newEmail.trim().toLowerCase();
    if (trimmed && trimmed.includes("@") && !additionalEmails.includes(trimmed)) {
      setAdditionalEmails((prev) => [...prev, trimmed]);
      setNewEmail("");
    }
  }, [newEmail, additionalEmails]);

  useEffect(() => {
    if (!isOpen) {
      setShowEmailConfirm(false);
      setLoInfo(null);
      setEmailResult(null);
      setAdditionalEmails([]);
      setNewEmail("");
      setCustomMessage("");
    }
  }, [isOpen]);

  const handleSave = async () => {
    if (!loan) return;
    setSaveLoading(true);
    try {
      const blob = await captureCardAsBlob();
      if (!blob) return;
      const loanNum = (loan.loan_number || '').toString().trim();
      const displayNum = loanNum && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(loanNum) ? loanNum : loan.id;
      const mloaeName = (loan.officer || '').trim();
      const filename = mloaeName
        ? `${mloaeName.replace(/[^a-zA-Z0-9_-]/g, '_')}_${displayNum}.png`
        : `${displayNum}.png`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('Card capture error:', e);
    } finally {
      setSaveLoading(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[80] bg-black/35 dark:bg-black/70 backdrop-blur-sm sm:backdrop-blur-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />

        <DialogPrimitive.Content
          className="fixed left-[50%] z-[90] flex flex-col w-full max-w-md sm:max-w-lg lg:max-w-2xl translate-x-[-50%] border border-slate-200/60 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xl duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 rounded-t-2xl sm:rounded-2xl max-h-[90vh] top-auto bottom-0 sm:top-28 sm:bottom-auto md:top-[50%] md:translate-y-[-50%] md:bottom-auto outline-none overflow-hidden"
        >
          <DialogPrimitive.Title className="sr-only">Loan Details</DialogPrimitive.Title>

          <DialogPrimitive.Close className="absolute top-4 right-4 z-[95] rounded-lg p-2 bg-slate-50/80 dark:bg-slate-800/80 text-slate-600 dark:text-slate-400 border-0 shadow-sm opacity-70 ring-offset-background transition-all hover:opacity-100 hover:bg-slate-100 dark:hover:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2 disabled:pointer-events-none">
            <X className="h-4 w-4" />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>

          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-4 sm:p-6 pt-2">
            {loan ? (
              <div ref={cardRef} className="w-full min-w-0">
                <LoanCardContent
                  loan={loan}
                  isDarkMode={isDarkMode}
                  onSelectOfficer={onSelectOfficer}
                  showTapForDetails={false}
                  showRiskBreakdown={true}
                  selectedTenantId={selectedTenantId}
                  hideRiskScoreAndLabel={hideRiskScoreAndLabel}
                />
                {falloutStatus && (
                  <div className="mt-4 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-800/40 p-3 space-y-1.5">
                    <div className="flex items-center gap-2 text-xs font-medium text-slate-600 dark:text-slate-300">
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
                      Fallout Alert History
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">
                      Sent {new Date(falloutStatus.sent_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}
                      {falloutStatus.recipient_email && <> to <span className="font-medium text-slate-600 dark:text-slate-300">{falloutStatus.recipient_email}</span></>}
                    </div>
                    {falloutStatus.response ? (
                      <div className="text-[11px]">
                        <span className="text-slate-500 dark:text-slate-400">Response: </span>
                        <span className={`font-medium ${RESPONSE_COLORS[falloutStatus.response] || ""}`}>{RESPONSE_LABELS[falloutStatus.response] || falloutStatus.response}</span>
                        {falloutStatus.responded_at && (
                          <span className="text-slate-400 dark:text-slate-500"> — {new Date(falloutStatus.responded_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}</span>
                        )}
                      </div>
                    ) : (
                      <div className="text-[11px] text-slate-400 dark:text-slate-500 italic">No response yet</div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-center justify-center p-8 text-slate-500">
                No loan data available
              </div>
            )}
          </div>
        
          {emailResult && (
            <div className={`flex-shrink-0 px-4 sm:px-6 py-2 text-xs border-t ${emailResult.success ? "text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/20" : "text-rose-600 dark:text-rose-400 border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/20"}`}>
              {emailResult.message}
            </div>
          )}
          <div className="flex-shrink-0 flex items-center gap-2 px-4 sm:px-6 py-2.5 border-t border-slate-200/60 dark:border-slate-700 bg-white dark:bg-slate-900">
            <button
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-[13px] font-light transition-all active:scale-[0.98] text-slate-500 hover:text-slate-700 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-slate-200 dark:hover:bg-slate-800 ${resolving ? "opacity-60 pointer-events-none" : ""}`}
              onClick={openEmailConfirm}
              disabled={resolving}
            >
              {resolving ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
              )}
              {resolving ? "Resolving..." : "Email Now"}
            </button>
            <div className="w-px h-10 bg-slate-200 dark:bg-slate-600 flex-shrink-0" aria-hidden />
            <button
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-[13px] font-light transition-all active:scale-[0.98] ${saveLoading ? 'opacity-60' : ''} text-slate-500 hover:text-slate-700 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-slate-200 dark:hover:bg-slate-800`}
              disabled={saveLoading}
              onClick={handleSave}
            >
              {saveLoading ? (
                <div className="animate-spin w-4 h-4 border-2 border-current border-t-transparent rounded-full" />
              ) : (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
              )}
              Save
            </button>
          </div>

          {/* Email confirmation overlay — inside DialogPrimitive.Content to stay within Radix focus trap */}
          {showEmailConfirm && (
            <div className="absolute inset-0 z-[100] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl w-full max-w-md p-5 animate-in fade-in-0 zoom-in-95">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-medium text-slate-800 dark:text-slate-200">Send Fallout Alert</h3>
                  <button onClick={() => setShowEmailConfirm(false)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 rounded-lg p-1 hover:bg-slate-100 dark:hover:bg-slate-800">
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <div className="space-y-3">
                  <div>
                    <label className="text-[11px] font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">Primary Recipient (LO)</label>
                    <div className="mt-1 text-sm text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-slate-800 rounded-lg px-3 py-2 border border-slate-200 dark:border-slate-700">
                      {loInfo?.redirectActive ? (
                        <div>
                          <div className="flex items-center gap-1.5">
                            <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400" />
                            <span className="text-amber-600 dark:text-amber-400 text-[11px] font-medium">Redirect active</span>
                          </div>
                          <div className="mt-0.5">{loInfo.redirectTo || "No redirect email configured"}</div>
                          {loInfo.email && (
                            <div className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">Original: {loInfo.name ? `${loInfo.name} <${loInfo.email}>` : loInfo.email}</div>
                          )}
                        </div>
                      ) : loInfo?.email ? (
                        <span>{loInfo.name ? `${loInfo.name} — ` : ""}{loInfo.email}</span>
                      ) : (
                        <span className="text-slate-400 italic">No LO email found for this loan</span>
                      )}
                    </div>
                  </div>

                  <div>
                    <label className="text-[11px] font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">Additional Recipients</label>
                    {additionalEmails.length > 0 && (
                      <div className="mt-1 space-y-1">
                        {additionalEmails.map((email) => (
                          <div key={email} className="flex items-center justify-between bg-slate-50 dark:bg-slate-800 rounded-lg px-3 py-1.5 border border-slate-200 dark:border-slate-700">
                            <span className="text-sm text-slate-700 dark:text-slate-300">{email}</span>
                            <button onClick={() => setAdditionalEmails((prev) => prev.filter((e) => e !== email))} className="text-slate-400 hover:text-rose-500">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="mt-1.5 flex gap-2">
                      <input
                        type="email"
                        value={newEmail}
                        onChange={(e) => setNewEmail(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addExtraEmail())}
                        placeholder="Add email address..."
                        className="flex-1 text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-1.5 text-slate-700 dark:text-slate-300 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-sky-400"
                      />
                      <button
                        onClick={addExtraEmail}
                        disabled={!newEmail.trim() || !newEmail.includes("@")}
                        className="px-2.5 py-1.5 rounded-lg text-sm bg-sky-50 dark:bg-sky-900/30 text-sky-600 dark:text-sky-400 hover:bg-sky-100 dark:hover:bg-sky-900/50 disabled:opacity-40 disabled:pointer-events-none transition-colors"
                      >
                        <Plus className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="text-[11px] font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">Personal Message (optional)</label>
                    <textarea
                      value={customMessage}
                      onChange={(e) => setCustomMessage(e.target.value)}
                      placeholder="Add a note to include in the email..."
                      rows={3}
                      className="mt-1 w-full text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-slate-700 dark:text-slate-300 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-sky-400 resize-none"
                    />
                  </div>
                </div>

                <div className="flex gap-2 mt-5">
                  <button
                    onClick={() => setShowEmailConfirm(false)}
                    className="flex-1 py-2 rounded-lg text-sm text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSendConfirmed}
                    disabled={emailSending || (!loInfo?.email && !loInfo?.redirectTo && additionalEmails.length === 0)}
                    className="flex-1 py-2 rounded-lg text-sm font-medium bg-sky-600 hover:bg-sky-700 text-white disabled:opacity-50 disabled:pointer-events-none transition-colors flex items-center justify-center gap-2"
                  >
                    {emailSending ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                    {emailSending ? "Sending..." : `Send${additionalEmails.length > 0 ? ` to ${1 + additionalEmails.length}` : ""}`}
                  </button>
                </div>
              </div>
            </div>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </Dialog>
  );
});

LoanDrilldownModal.displayName = "LoanDrilldownModal";
