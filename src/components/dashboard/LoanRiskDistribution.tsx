import React, { memo } from 'react';

interface LoanRiskDistributionProps {
  ficoScore: number | null;
  ltvRatio: number | null;
  dtiRatio: number | null;
  isDarkMode?: boolean;
  loanType?: string | null;
  loanPurpose?: string | null;
  channel?: string | null;
  activeDays?: number | null;
  currentMilestone?: string | null;
  estimatedClosingDate?: string | null;
  loPullthroughPct?: number | null;
  interestRate?: number | null;
  marketRate?: number | null;
  marketChangeDelta?: number | null;
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
  currentMilestone,
  estimatedClosingDate,
  loPullthroughPct,
  interestRate,
  marketRate,
  marketChangeDelta,
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
  const hasLoPullthrough = loPullthroughPct != null && !Number.isNaN(Number(loPullthroughPct));
  const hasLockVsMarket = (interestRate != null && !Number.isNaN(Number(interestRate))) || (marketRate != null && !Number.isNaN(Number(marketRate))) || (marketChangeDelta != null && !Number.isNaN(Number(marketChangeDelta)));

  const hasAny = hasFico || hasLtv || hasDti || hasLoanType || hasLoanPurpose || hasChannel || hasMilestone || hasTimeInMotion || hasEstimatedClosing || hasLoPullthrough || hasLockVsMarket;
  if (!hasAny) return null;

  const getFicoColor = (score: number) => {
    if (score < 640) return 'text-rose-500';
    if (score < 700) return 'text-amber-500';
    return 'text-emerald-500';
  };

  const getLtvColor = (ratio: number) => {
    if (ratio > 95) return 'text-rose-500';
    if (ratio > 80) return 'text-amber-500';
    return 'text-emerald-500';
  };

  const getDtiColor = (ratio: number) => {
    if (ratio > 50) return 'text-rose-500';
    if (ratio > 43) return 'text-amber-500';
    return 'text-emerald-500';
  };

  const getTimeInMotionColor = (days: number) => {
    if (days > 45) return 'text-rose-500';
    if (days >= 30) return 'text-amber-500';
    return 'text-emerald-500';
  };

  const getPullthroughColor = (pct: number) => {
    if (pct >= 80) return 'text-emerald-500';
    if (pct >= 60) return 'text-amber-500';
    return 'text-rose-500';
  };

  const getLockVsMarketColor = (diff: number) => {
    if (diff < -0.25) return 'text-rose-500';
    if (diff <= 0.25) return 'text-amber-500';
    return 'text-emerald-500';
  };

  const milestoneDisplay = currentMilestone != null && String(currentMilestone).trim() !== '' ? String(currentMilestone) : '—';
  const timeInMotionDisplay = activeDays != null ? `${activeDays} days` : '—';
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
      <div className="grid grid-cols-5 grid-rows-2 gap-x-3 gap-y-0.5 sm:gap-x-4 py-1 items-start">
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
        {/* Row 2: Loan Type, Loan Purpose, Channel, Milestone */}
        <MetricItem label="Loan Type" value={loanType != null && String(loanType).trim() !== '' ? String(loanType) : '—'} isDarkMode={isDarkMode} />
        <MetricItem label="Loan Purpose" value={loanPurpose != null && String(loanPurpose).trim() !== '' ? String(loanPurpose) : '—'} isDarkMode={isDarkMode} />
        <MetricItem label="Channel" value={channel != null && String(channel).trim() !== '' ? String(channel) : '—'} isDarkMode={isDarkMode} />
        <MetricItem label="Milestone" value={milestoneDisplay} isDarkMode={isDarkMode} />
        <MetricItem label="Estimated closing date" value={estimatedClosingDisplay} isDarkMode={isDarkMode} />
      </div>
    </div>
  );
});

LoanRiskDistribution.displayName = 'LoanRiskDistribution';
