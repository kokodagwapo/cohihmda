import React, { memo } from 'react';

/** Reason code from fallout sequencer (bucket_type = feature or Outcome/TurnTime, bucket_value = Zone1–Zone6 or label). */
export type ReasonCodeEntry = { bucket_type: string; bucket_value: string; risk_score?: number };

interface LoanRiskDistributionProps {
  ficoScore: number | null;
  ltvRatio: number | null;
  dtiRatio: number | null;
  isDarkMode?: boolean;
  loanType?: string | null;
  loanPurpose?: string | null;
  channel?: string | null;
  activeDays?: number | null;
  applicationDate?: string | null;
  currentMilestone?: string | null;
  estimatedClosingDate?: string | null;
  closingDate?: string | null;
  loPullthroughPct?: number | null;
  interestRate?: number | null;
  marketRate?: number | null;
  marketChangeDelta?: number | null;
  /** When present, zone-based colors are used for FICO/LTV/DTI/Time in Motion: Zone1=red (6pts) … Zone6=lowest (1pt). */
  reasonCodes?: ReasonCodeEntry[] | null;
}

/** Get zone number (1–6) from reason_codes for a given bucket_type (e.g. fico_score, ltv_ratio, be_dti_ratio, days_active). */
export function getZoneFromReasonCodes(
  reasonCodes: ReasonCodeEntry[] | null | undefined,
  bucketType: string
): 1 | 2 | 3 | 4 | 5 | 6 | null {
  if (!reasonCodes || !Array.isArray(reasonCodes)) return null;
  const entry = reasonCodes.find((r) => (r?.bucket_type ?? '') === bucketType);
  const bv = (entry?.bucket_value ?? '').toString();
  if (bv === 'Zone1') return 1;
  if (bv === 'Zone2') return 2;
  if (bv === 'Zone3') return 3;
  if (bv === 'Zone4') return 4;
  if (bv === 'Zone5') return 5;
  if (bv === 'Zone6') return 6;
  return null;
}

/** Zone-based text color: Zones 1&2 = red (highest risk), 3&4 = yellow (middle), 5&6 = green (lowest risk). */
export function getZoneColorClass(zone: 1 | 2 | 3 | 4 | 5 | 6 | null, isDarkMode: boolean): string | undefined {
  if (zone == null) return undefined;
  if (zone === 1 || zone === 2) return isDarkMode ? 'text-rose-400' : 'text-rose-600';
  if (zone === 3 || zone === 4) return isDarkMode ? 'text-amber-400' : 'text-amber-600';
  if (zone === 5 || zone === 6) return isDarkMode ? 'text-emerald-400' : 'text-emerald-600';
  return undefined;
}

function MetricItem({
  label,
  value,
  valueClassName,
  isDarkMode,
}: {
  label: string;
  value: string | number;
  valueClassName?: string;
  isDarkMode: boolean;
}) {
  return (
    <div className="text-center min-w-0 w-full flex flex-col justify-center py-0.5 break-words">
      <p className={`text-[9px] font-medium uppercase tracking-wide break-words ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>{label}</p>
      <p className={`text-[12px] sm:text-[14px] font-semibold tracking-tight break-words ${valueClassName ?? (isDarkMode ? 'text-slate-200' : 'text-slate-800')}`}>{value}</p>
    </div>
  );
}

export const LoanRiskDistribution: React.FC<LoanRiskDistributionProps> = memo(({
  ficoScore,
  ltvRatio,
  dtiRatio,
  isDarkMode = false,
  loanType,
  loanPurpose,
  channel,
  activeDays,
  applicationDate,
  currentMilestone,
  estimatedClosingDate,
  closingDate,
  loPullthroughPct,
  interestRate,
  marketRate,
  marketChangeDelta,
  reasonCodes,
}) => {
  const hasFico = ficoScore != null && ficoScore > 0;
  const hasLtv = ltvRatio != null && ltvRatio > 0;
  const hasDti = dtiRatio != null && dtiRatio > 0;
  const hasLoanType = true;
  const hasLoanPurpose = true;
  const hasChannel = true;
  const hasMilestone = true; // Always show; display "—" when empty
  const hasTimeInMotion = true; // Always show (days or "—")
  const hasEstimatedClosing = true; // Always show; display "—" when empty
  const hasClosingDate = true; // Always show; display "—" when empty
  const hasLoPullthrough = loPullthroughPct != null && !Number.isNaN(Number(loPullthroughPct));
  const hasLockVsMarket = (interestRate != null && !Number.isNaN(Number(interestRate))) || (marketRate != null && !Number.isNaN(Number(marketRate))) || (marketChangeDelta != null && !Number.isNaN(Number(marketChangeDelta)));

  const hasAny = hasFico || hasLtv || hasDti || hasLoanType || hasLoanPurpose || hasChannel || hasMilestone || hasTimeInMotion || hasEstimatedClosing || hasClosingDate || hasLoPullthrough || hasLockVsMarket;
  if (!hasAny) return null;

  // Zone-based colors when reason_codes present: Zone1=red … Zone6=no color
  const zoneFico = getZoneFromReasonCodes(reasonCodes, 'fico_score');
  const zoneLtv = getZoneFromReasonCodes(reasonCodes, 'ltv_ratio');
  const zoneDti = getZoneFromReasonCodes(reasonCodes, 'be_dti_ratio');
  const zoneTimeInMotion = getZoneFromReasonCodes(reasonCodes, 'days_active');

  const defaultMetricColor = isDarkMode ? 'text-slate-200' : 'text-slate-800';

  const getFicoColor = (score: number) => {
    const zoneColor = getZoneColorClass(zoneFico ?? null, isDarkMode);
    if (zoneColor != null) return zoneColor;
    if (reasonCodes != null && reasonCodes.length > 0) return defaultMetricColor;
    if (score < 640) return 'text-rose-500';
    if (score < 700) return 'text-amber-500';
    return defaultMetricColor;
  };

  const getLtvColor = (ratio: number) => {
    const zoneColor = getZoneColorClass(zoneLtv ?? null, isDarkMode);
    if (zoneColor != null) return zoneColor;
    if (reasonCodes != null && reasonCodes.length > 0) return defaultMetricColor;
    if (ratio > 95) return 'text-rose-500';
    if (ratio > 80) return 'text-amber-500';
    return defaultMetricColor;
  };

  const getDtiColor = (ratio: number) => {
    const zoneColor = getZoneColorClass(zoneDti ?? null, isDarkMode);
    if (zoneColor != null) return zoneColor;
    if (reasonCodes != null && reasonCodes.length > 0) return defaultMetricColor;
    if (ratio > 50) return 'text-rose-500';
    if (ratio > 43) return 'text-amber-500';
    return defaultMetricColor;
  };

  const getTimeInMotionColor = (days: number) => {
    const zoneColor = getZoneColorClass(zoneTimeInMotion ?? null, isDarkMode);
    if (zoneColor != null) return zoneColor;
    if (reasonCodes != null && reasonCodes.length > 0) return defaultMetricColor;
    if (days > 45) return 'text-rose-500';
    if (days >= 30) return 'text-amber-500';
    return defaultMetricColor;
  };

  /** Pullthrough %: high = green (low risk), mid = yellow, low = red (high risk). Aligns with signal buckets 1–6. */
  const getPullthroughColor = (pct: number) => {
    if (pct >= 80) return 'text-emerald-500';
    if (pct >= 60) return 'text-amber-500';
    return 'text-rose-500';
  };

  /** Lock vs market delta: unfavorable = red, neutral = yellow, favorable = green. */
  const getLockVsMarketColor = (diff: number) => {
    if (diff < -0.25) return 'text-rose-500';
    if (diff <= 0.25) return 'text-amber-500';
    return 'text-emerald-500';
  };

  const milestoneDisplay = currentMilestone != null && String(currentMilestone).trim() !== '' ? String(currentMilestone) : '—';
  const timeInMotionDisplay = activeDays != null ? `${activeDays} days` : '—';
  const applicationDateDisplay = (() => {
    if (applicationDate == null || String(applicationDate).trim() === '') return '—';
    try {
      const d = new Date(applicationDate);
      if (Number.isNaN(d.getTime())) return String(applicationDate);
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    } catch {
      return String(applicationDate);
    }
  })();
  const estimatedClosingDisplay = (() => {
    if (estimatedClosingDate == null || String(estimatedClosingDate).trim() === '') return '—';
    try {
      const d = new Date(estimatedClosingDate);
      if (Number.isNaN(d.getTime())) return String(estimatedClosingDate);
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    } catch {
      return String(estimatedClosingDate);
    }
  })();
  const closingDateDisplay = (() => {
    if (closingDate == null || String(closingDate).trim() === '') return '—';
    try {
      const d = new Date(closingDate);
      if (Number.isNaN(d.getTime())) return String(closingDate);
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    } catch {
      return String(closingDate);
    }
  })();

  const lockVsMarketValue = (() => {
    const lock = interestRate != null && !Number.isNaN(Number(interestRate)) ? Number(interestRate) : null;
    const mkt = marketRate != null && !Number.isNaN(Number(marketRate)) ? Number(marketRate) : null;
    const deltaFromBackend = marketChangeDelta != null && !Number.isNaN(Number(marketChangeDelta)) ? Number(marketChangeDelta) : null;
    // Show actual difference: market - lock. Negative = market dropped since lock, positive = market increased.
    return lock != null && mkt != null ? mkt - lock : deltaFromBackend;
  })();
  const lockVsMarketDisplay = lockVsMarketValue != null
    ? `${lockVsMarketValue >= 0 ? '+' : ''}${lockVsMarketValue.toFixed(2)}%`
    : '—';

  return (
    <div className={`mt-3 pt-3 border-t ${isDarkMode ? 'border-white/10' : 'border-slate-100'}`}>
      <div className="grid grid-cols-5 gap-x-3 gap-y-0.5 sm:gap-x-4 py-1 items-start">
        {/* Row 1: FICO, LTV, DTI, LO Pullthrough, Time in Motion */}
        <MetricItem
          label="FICO"
          value={hasFico ? ficoScore! : '—'}
          valueClassName={hasFico ? getFicoColor(ficoScore!) : undefined}
          isDarkMode={isDarkMode}
        />
        <MetricItem
          label="LTV"
          value={hasLtv ? `${Math.round(Number(ltvRatio))}%` : '—'}
          valueClassName={hasLtv ? getLtvColor(ltvRatio!) : undefined}
          isDarkMode={isDarkMode}
        />
        <MetricItem
          label="DTI"
          value={hasDti ? `${Math.round(Number(dtiRatio))}%` : '—'}
          valueClassName={hasDti ? getDtiColor(dtiRatio!) : undefined}
          isDarkMode={isDarkMode}
        />
        <MetricItem
          label="LO Pullthrough"
          value={hasLoPullthrough ? `${Number(loPullthroughPct).toFixed(1)}%` : '—'}
          valueClassName={hasLoPullthrough ? getPullthroughColor(Number(loPullthroughPct)) : undefined}
          isDarkMode={isDarkMode}
        />
        <MetricItem
          label="Time in Motion"
          value={timeInMotionDisplay}
          valueClassName={activeDays != null ? getTimeInMotionColor(activeDays) : undefined}
          isDarkMode={isDarkMode}
        />
        {/* Row 2: Loan Type, Loan Purpose, Channel, Milestone, Application Date */}
        <MetricItem label="Loan Type" value={loanType != null && String(loanType).trim() !== '' ? String(loanType) : '—'} isDarkMode={isDarkMode} />
        <MetricItem label="Loan Purpose" value={loanPurpose != null && String(loanPurpose).trim() !== '' ? String(loanPurpose) : '—'} isDarkMode={isDarkMode} />
        <MetricItem label="Channel" value={channel != null && String(channel).trim() !== '' ? String(channel) : '—'} isDarkMode={isDarkMode} />
        <MetricItem label="Milestone" value={milestoneDisplay} isDarkMode={isDarkMode} />
        <MetricItem label="Application Date" value={applicationDateDisplay} isDarkMode={isDarkMode} />
        {/* Row 3: Estimated Closing, Closing Date */}
        <MetricItem label="Est. Closing" value={estimatedClosingDisplay} isDarkMode={isDarkMode} />
        <MetricItem label="Closing Date" value={closingDateDisplay} isDarkMode={isDarkMode} />
      </div>
    </div>
  );
});

LoanRiskDistribution.displayName = 'LoanRiskDistribution';
