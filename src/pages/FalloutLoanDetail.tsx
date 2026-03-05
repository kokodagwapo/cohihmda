import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { TopTieringLayout } from "@/components/layout/TopTieringLayout";
import { TopTieringTopBar } from "@/components/layout/TopTieringTopBar";
import { LoanCardContent, type LoanCardContentLoan } from "@/components/dashboard/LoanCardContent";
import { useTheme } from "@/components/theme-provider";
import { useTenantStore } from "@/stores/tenantStore";
import { transformLoanToCard } from "@/utils/loanDataTransform";
import { api } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface LoanByIdResponse {
  loan: Record<string, unknown>;
}

function numberOrNull(...values: unknown[]): number | null {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const n = Number(value);
    if (!Number.isNaN(n) && Number.isFinite(n)) return n;
  }
  return null;
}

function stringOrNull(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return null;
}

function normalizePredictionLoan(rawLoan: Record<string, unknown>): Record<string, unknown> {
  const rawLoanData = rawLoan.loan_data;
  const loanData =
    typeof rawLoanData === "string"
      ? (() => {
          try {
            return JSON.parse(rawLoanData) as Record<string, unknown>;
          } catch {
            return {};
          }
        })()
      : (rawLoanData as Record<string, unknown> | null) ?? {};
  const nestedLoanData =
    (loanData.loan as Record<string, unknown> | undefined) ??
    (loanData.loanData as Record<string, unknown> | undefined) ??
    {};

  const predictedOutcome =
    (rawLoan.predicted_outcome as string | undefined) ||
    ((loanData.riskSummary as Record<string, unknown> | undefined)?.predictedOutcome as string | undefined) ||
    "originate";
  const confidence =
    Number(rawLoan.confidence_score ?? rawLoan.confidence ?? (loanData.riskSummary as Record<string, unknown> | undefined)?.confidence ?? 50) || 50;
  const riskFactors = Array.isArray(rawLoan.risk_factors)
    ? (rawLoan.risk_factors as string[])
    : [];
  const riskSummary =
    (loanData.riskSummary as Record<string, unknown> | undefined) ?? {
      predictedOutcome,
      confidence,
      risks: riskFactors,
      positives: [],
      overallRisk: predictedOutcome === "originate" ? "Low" : "High",
      riskScore: confidence,
    };

  return {
    ...rawLoan,
    ...loanData,
    ...nestedLoanData,
    loan_id: (rawLoan.loan_id as string | undefined) ?? (loanData.loan_id as string | undefined),
    loan_number: (rawLoan.loan_number as string | undefined) ?? (loanData.loan_number as string | undefined),
    loan_officer:
      (rawLoan.loan_officer as string | undefined) ??
      (loanData.loan_officer as string | undefined) ??
      (loanData.loan_officer_name as string | undefined) ??
      (nestedLoanData.loan_officer as string | undefined) ??
      (nestedLoanData.loan_officer_name as string | undefined),
    loan_officer_name:
      (rawLoan.loan_officer as string | undefined) ??
      (rawLoan.loan_officer_name as string | undefined) ??
      (loanData.loan_officer as string | undefined) ??
      (loanData.loan_officer_name as string | undefined) ??
      (nestedLoanData.loan_officer as string | undefined) ??
      (nestedLoanData.loan_officer_name as string | undefined),
    officer:
      (rawLoan.loan_officer as string | undefined) ??
      (rawLoan.loan_officer_name as string | undefined) ??
      (loanData.loan_officer as string | undefined) ??
      (loanData.loan_officer_name as string | undefined) ??
      (nestedLoanData.loan_officer as string | undefined) ??
      (nestedLoanData.loan_officer_name as string | undefined),
    riskSummary,
    reasonCodes: rawLoan.reason_codes ?? loanData.reasonCodes ?? null,
    reason_codes: rawLoan.reason_codes ?? loanData.reasonCodes ?? null,
    riskScore:
      Number(
        (loanData.riskSummary as Record<string, unknown> | undefined)?.riskScore ??
          rawLoan.confidence_score ??
          rawLoan.confidence ??
          confidence,
      ) || 50,
  };
}

function mapLoanToCard(loan: Record<string, unknown>): LoanCardContentLoan {
  const merged = normalizePredictionLoan(loan);
  const base = transformLoanToCard(merged);
  const riskSummary = merged.riskSummary as
    | {
        risks?: string[];
        positives?: string[];
        overallRisk?: string;
        predictedOutcome?: "originate" | "withdraw" | "deny" | "at_risk";
        confidence?: number;
      }
    | undefined;

  const risks = Array.isArray(riskSummary?.risks) ? riskSummary.risks : [];
  const reason =
    risks.length > 0
      ? risks.slice(0, 3).join("; ")
      : riskSummary?.overallRisk
        ? `Overall risk: ${riskSummary.overallRisk}`
        : base.reason;

  const loanAmount = numberOrNull(
    merged.loan_amount,
    merged.amount,
    base.amountValue,
  );
  const lockDate = stringOrNull(merged.lock_date, merged.lockDate);
  const lockExpirationDate = stringOrNull(
    merged.lock_expiration_date,
    merged.lockExpirationDate,
  );
  const lockMarketRate = numberOrNull(
    merged.lockMarketRate,
    merged.market_rate_at_lock,
    lockDate ? merged.interest_rate : null,
  );
  const marketRate = numberOrNull(
    merged.market_rate,
    merged.closeMarketRate,
    base.marketRate,
  );
  const marketChangeDelta = numberOrNull(
    merged.marketChangeDelta,
    merged.market_change_delta,
    lockMarketRate != null && marketRate != null ? marketRate - lockMarketRate : null,
  );
  const loPullthroughPct = numberOrNull(
    merged.loPullthroughPercentage,
    merged.lo_pullthrough_percentage,
    merged.lo_pullthrough_pct,
    merged.loPullthroughPct,
    base.loPullthroughPct,
  );
  const uwPullthroughPct = numberOrNull(
    merged.uwPullthroughPercentage,
    merged.uw_pullthrough_percentage,
    merged.uwPullthroughPct,
    base.uwPullthroughPct,
  );
  const closerPullthroughPct = numberOrNull(
    merged.closerPullthroughPercentage,
    merged.closer_pullthrough_percentage,
    merged.closerPullthroughPct,
    base.closerPullthroughPct,
  );
  const processorPullthroughPct = numberOrNull(
    merged.processorPullthroughPercentage,
    merged.processor_pullthrough_percentage,
    merged.processorPullthroughPct,
    base.processorPullthroughPct,
  );
  const dtiRatio = numberOrNull(
    merged.be_dti_ratio,
    merged.dti_ratio,
    merged.dti,
    merged.dtiRatio,
    base.dtiRatio,
  );
  const ltvRatio = numberOrNull(
    merged.ltv_ratio,
    merged.ltv,
    merged.ltvRatio,
    base.ltvRatio,
  );
  const ficoScore = numberOrNull(
    merged.fico_score,
    merged.fico,
    merged.ficoScore,
    base.ficoScore,
  );
  const officerName =
    stringOrNull(
      merged.loan_officer,
      merged.loan_officer_name,
      merged.officer,
      base.officer,
    ) ?? "Unassigned";

  return {
    ...base,
    officer: officerName,
    amount:
      loanAmount != null
        ? loanAmount >= 1000000
          ? `$${(loanAmount / 1000000).toFixed(1)}M`
          : loanAmount >= 1000
            ? `$${(loanAmount / 1000).toFixed(0)}K`
            : `$${loanAmount.toFixed(0)}`
        : base.amount,
    amountValue: loanAmount ?? base.amountValue,
    reason,
    ficoScore,
    ltvRatio,
    dtiRatio,
    riskScore:
      Number(
        merged.riskScore ??
          (riskSummary as Record<string, unknown> | undefined)?.riskScore ??
          riskSummary?.confidence ??
          base.riskScore,
      ) || 50,
    riskSummary: {
      risks,
      positives: Array.isArray(riskSummary?.positives) ? riskSummary.positives : [],
      overallRisk: riskSummary?.overallRisk ?? "Unknown",
      predictedOutcome: riskSummary?.predictedOutcome ?? "originate",
      confidence: Number(riskSummary?.confidence ?? 50) || 50,
    },
    loanType: (merged.loan_type as string | null | undefined) ?? base.loanType,
    loanPurpose: (merged.loan_purpose as string | null | undefined) ?? base.loanPurpose,
    channel: (merged.channel as string | null | undefined) ?? base.channel,
    currentMilestone:
      (merged.current_milestone as string | null | undefined) ?? base.currentMilestone,
    activeDays:
      Number(merged.active_days ?? merged.activeDays ?? base.activeDays ?? 0) || null,
    applicationDate:
      (merged.application_date as string | null | undefined) ??
      (merged.applicationDate as string | null | undefined) ??
      null,
    estimatedClosingDate:
      (merged.estimated_closing_date as string | null | undefined) ??
      (merged.estimatedClosingDate as string | null | undefined) ??
      null,
    interestRate: numberOrNull(merged.interest_rate, merged.interestRate, base.interestRate),
    marketRate,
    lockMarketRate,
    marketChangeDelta,
    rateReferenceType: (lockDate != null ? "lock" : "application") as "lock" | "application",
    lockDate,
    lockExpirationDate,
    loPullthroughPct,
    uwPullthroughPct,
    closerPullthroughPct,
    processorPullthroughPct,
    closeLateRisk:
      (merged.closeLateRisk as boolean | null | undefined) ??
      (merged.close_late_risk as boolean | null | undefined) ??
      null,
    officerTtsScore:
      numberOrNull(
        merged.officerTtsScore,
        merged.officer_tts_score,
        base.officerTtsScore,
      ) ?? null,
    officerTier:
      (merged.officerTier as string | null | undefined) ??
      (merged.officer_tier as string | null | undefined) ??
      base.officerTier ??
      null,
    creditMetricsSignalStrength:
      Number(merged.creditMetricsSignalStrength ?? base.creditMetricsSignalStrength ?? 0) || null,
    loanCharacteristicsSignalStrength:
      Number(
        merged.loanCharacteristicsSignalStrength ??
          base.loanCharacteristicsSignalStrength ??
          0,
      ) || null,
    timeInMotionSignalStrength:
      Number(merged.timeInMotionSignalStrength ?? base.timeInMotionSignalStrength ?? 0) || null,
    mloAeFalloutProneSignalStrength:
      Number(
        merged.mloAeFalloutProneSignalStrength ??
          base.mloAeFalloutProneSignalStrength ??
          0,
      ) || null,
    interestLockVsMarketSignalStrength:
      Number(
        merged.interestLockVsMarketSignalStrength ??
          base.interestLockVsMarketSignalStrength ??
          0,
      ) || null,
    reasonCodes:
      (merged.reasonCodes as { code: string; zone?: string }[] | null | undefined) ??
      (merged.reason_codes as { code: string; zone?: string }[] | null | undefined) ??
      null,
    loPullthroughSignal:
      Number(merged.loPullthroughSignal ?? base.loPullthroughSignal ?? 0) || null,
    marketChangeDeltaSignal:
      Number(merged.marketChangeDeltaSignal ?? base.marketChangeDeltaSignal ?? 0) || null,
  };
}

function buildCoachingTips(loan: LoanCardContentLoan): string[] {
  const tips: string[] = [];
  if ((loan.ficoScore ?? 999) < 620) tips.push("Low FICO: avoid opening new credit lines or hard pulls before closing.");
  if ((loan.ltvRatio ?? 0) > 95) tips.push("Very high LTV: confirm funds-to-close and PMI docs early to reduce fallout risk.");
  if ((loan.dtiRatio ?? 0) > 43) tips.push("High DTI: avoid large purchases and document liabilities proactively.");
  if ((loan.riskSummary?.predictedOutcome ?? "originate") !== "originate") {
    tips.push("Prioritize this file in the next 24 hours and clear outstanding conditions.");
  }
  tips.push("Keep borrower communication cadence tight (24-48 hour check-ins) until clear-to-close.");
  return Array.from(new Set(tips)).slice(0, 4);
}

const FalloutLoanDetail = () => {
  const { loanId } = useParams<{ loanId: string }>();
  const { theme } = useTheme();
  const isDarkMode = theme === "dark";
  const { selectedTenantId } = useTenantStore();
  const [loanCard, setLoanCard] = useState<LoanCardContentLoan | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    const loadLoan = async () => {
      if (!loanId) {
        setError("Missing loan identifier.");
        setLoading(false);
        return;
      }
      try {
        setLoading(true);
        setError(null);
        const tenantQuery = selectedTenantId
          ? `?tenant_id=${encodeURIComponent(selectedTenantId)}`
          : "";
        const response = await api.request<LoanByIdResponse>(
          `/api/loans/${encodeURIComponent(loanId)}${tenantQuery}`,
          { method: "GET" },
        );
        if (!mounted) return;
        setLoanCard(mapLoanToCard(response.loan));
      } catch (err: unknown) {
        if (!mounted) return;
        setError(err instanceof Error ? err.message : "Failed to load loan details.");
      } finally {
        if (mounted) setLoading(false);
      }
    };
    void loadLoan();
    return () => {
      mounted = false;
    };
  }, [loanId, selectedTenantId]);

  const coachingTips = useMemo(
    () => (loanCard ? buildCoachingTips(loanCard) : []),
    [loanCard],
  );

  return (
    <TopTieringLayout>
      <div className="flex flex-col min-h-[calc(100vh-4rem)]">
        <TopTieringTopBar title="Fallout Loan Detail" />
        <main className="flex-1 overflow-y-auto px-4 sm:px-6 py-3">
          <div className="max-w-[1200px] mx-auto space-y-4">
            <div className="flex items-center justify-between">
              <Button asChild variant="outline" size="sm">
                <Link to="/fallout-forecast">
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  Back to Coheus Fallout Report
                </Link>
              </Button>
            </div>

            {loading ? (
              <Card>
                <CardContent className="py-8 text-sm text-muted-foreground">
                  Loading loan details...
                </CardContent>
              </Card>
            ) : error || !loanCard ? (
              <Card>
                <CardContent className="py-8 text-sm text-red-600 dark:text-red-400">
                  {error || "Loan not found."}
                </CardContent>
              </Card>
            ) : (
              <>
                <Card>
                  <CardContent className="pt-6">
                    <LoanCardContent
                      loan={loanCard}
                      isDarkMode={isDarkMode}
                      showTapForDetails={false}
                      showRiskBreakdown={true}
                      selectedTenantId={selectedTenantId}
                    />
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Coaching Priorities</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ul className="list-disc pl-5 space-y-1 text-sm text-muted-foreground">
                      {coachingTips.map((tip) => (
                        <li key={tip}>{tip}</li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              </>
            )}
          </div>
        </main>
      </div>
    </TopTieringLayout>
  );
};

export default FalloutLoanDetail;
