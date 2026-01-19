import { PeriodValue, getLoanAmountNumber, getLoanOfficerName, inferLoanStatus, isDateInPeriod, isFundedInPeriod } from '@/utils/closingFalloutFilters';
import { transformLoanToCard } from '@/utils/loanDataTransform';

export type MetricKey =
  | 'Active Loans Today'
  | 'Funded Loans'
  | 'Predicted Closing'
  | 'Predicted Fallout';

export type AlethiaSectionKey =
  | 'Success'
  | 'Warning'
  | 'Critical'
  | 'TopTiering Insights for Loan Officers'
  | 'Borrower Coaching';

export interface AlethiaSection {
  title: AlethiaSectionKey;
  items: string[];
}

export interface AlethiaInsights {
  sections: AlethiaSection[];
}

function pct(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n);
}

function safePct(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, pct(n)));
}

function asIso(v: any): string | null {
  if (!v) return null;
  if (typeof v === 'string') return v;
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString();
  return null;
}

function computePullThroughPct(loans: any[], period: PeriodValue, now: Date): number | null {
  const started = loans.filter((l) => isDateInPeriod(asIso(l?.application_date ?? l?.applicationDate), period, now));
  if (started.length === 0) return null;
  const funded = started.filter((l) => isFundedInPeriod(l, period, now));
  return (funded.length / started.length) * 100;
}

function officerStats(loans: any[], period: PeriodValue, now: Date) {
  const map = new Map<
    string,
    { name: string; activeCount: number; activeVolume: number; startedCount: number; fundedCount: number; criticalRiskCount: number }
  >();

  for (const l of loans) {
    const name = getLoanOfficerName(l);
    if (!name || name === 'Unassigned') continue;
    if (!map.has(name)) {
      map.set(name, { name, activeCount: 0, activeVolume: 0, startedCount: 0, fundedCount: 0, criticalRiskCount: 0 });
    }
    const row = map.get(name)!;

    const status = inferLoanStatus(l);
    if (status === 'Active' || status === 'Locked') {
      row.activeCount += 1;
      row.activeVolume += getLoanAmountNumber(l);
    }

    const started = isDateInPeriod(asIso(l?.application_date ?? l?.applicationDate), period, now);
    if (started) row.startedCount += 1;
    if (isFundedInPeriod(l, period, now)) row.fundedCount += 1;

    const card = transformLoanToCard(l);
    if (card.riskLevel === 'Very High') row.criticalRiskCount += 1;
  }

  const list = Array.from(map.values());
  list.sort((a, b) => b.activeVolume - a.activeVolume);
  return list;
}

function topBorrowerCoachingTipsFromRisk(loans: any[]): string[] {
  // Use a small sample (priority loans) and infer common risk drivers.
  const cards = loans.map(transformLoanToCard);

  const lowFico = cards.filter((c) => (c.ficoScore ?? 999) < 620).length;
  const highLtv = cards.filter((c) => (c.ltvRatio ?? 0) > 95).length;
  const highDti = cards.filter((c) => (c.dtiRatio ?? 0) > 43).length;
  const midLtv = cards.filter((c) => (c.ltvRatio ?? 0) > 80 && (c.ltvRatio ?? 0) <= 95).length;

  const tips: string[] = [];

  if (highLtv > 0) tips.push('High LTV borrowers: set expectations on PMI and document funds-to-close early to prevent late-stage surprises.');
  if (midLtv > 0) tips.push('LTV 80–95%: confirm MI requirements and appraisal contingencies early; avoid last-minute re-trades.');
  if (lowFico > 0) tips.push('Low FICO borrowers: avoid new credit lines and keep utilization stable until funding.');
  if (highDti > 0) tips.push('High DTI borrowers: avoid large purchases and document recurring liabilities (auto/student loans) to reduce underwriting friction.');

  // Ensure at least 3 items
  tips.push('Respond to document requests within 24–48 hours to protect closing timelines.');
  tips.push('Avoid job changes or unexplained deposits during underwriting.');

  // Dedupe + cap
  const uniq = Array.from(new Set(tips));
  return uniq.slice(0, 3);
}

export function generateAlethiaInsightsForMetric(args: {
  metricKey: MetricKey;
  loansRaw: any[] | null;
  dateFilter: PeriodValue;
  headlineValue?: number;
  computed?: {
    activeCount?: number;
    activeVolume?: number;
    fundedCount?: number;
    fundedVolume?: number;
    falloutCount?: number;
    falloutVolume?: number;
  };
  priorityLoansRaw?: any[];
  now?: Date;
}): AlethiaInsights {
  const {
    metricKey,
    loansRaw,
    dateFilter,
    headlineValue,
    computed,
    priorityLoansRaw,
    now = new Date(),
  } = args;

  const loans = loansRaw ?? [];
  const activeLoans = loans.filter((l) => {
    const s = inferLoanStatus(l);
    return s === 'Active' || s === 'Locked';
  });
  const falloutLoans = loans.filter((l) => ['Withdrawn', 'Denied'].includes(inferLoanStatus(l)));

  const activeCards = activeLoans.map(transformLoanToCard);
  const criticalRiskCount = activeCards.filter((c) => c.riskLevel === 'Very High').length;
  const mediumRiskCount = activeCards.filter((c) => c.riskLevel === 'Medium').length;

  const highLtvCount = activeCards.filter((c) => (c.ltvRatio ?? 0) > 95).length;
  const lowFicoCount = activeCards.filter((c) => (c.ficoScore ?? 999) < 620).length;
  const highDtiCount = activeCards.filter((c) => (c.dtiRatio ?? 0) > 43).length;

  const pullThroughPct = computePullThroughPct(loans, dateFilter, now);
  const pullThrough = pullThroughPct === null ? null : safePct(pullThroughPct);

  const activeCount = computed?.activeCount ?? activeLoans.length;
  const fundedCount = computed?.fundedCount ?? loans.filter((l) => isFundedInPeriod(l, dateFilter, now)).length;
  const falloutCount = computed?.falloutCount ?? falloutLoans.length;

  const falloutRate = activeCount > 0 ? safePct((falloutCount / activeCount) * 100) : 0;

  const success: string[] = [];
  const warning: string[] = [];
  const critical: string[] = [];

  // Generic signals (used across tiles)
  if (pullThrough !== null && pullThrough >= 70) success.push(`Pull-through at ${pullThrough}% supports predictable closings.`);
  if (criticalRiskCount === 0 && activeCount > 0) success.push('No critical-risk loans detected in the active/locked pipeline.');
  if (mediumRiskCount > 0) warning.push(`${mediumRiskCount} medium-risk loans require proactive monitoring to protect pull-through.`);
  if (pullThrough !== null && pullThrough < 70 && pullThrough >= 50) warning.push(`Pull-through at ${pullThrough}% indicates optimization opportunity (docs, underwriting, and borrower engagement).`);
  if (pullThrough !== null && pullThrough < 50) critical.push(`Pull-through at ${pullThrough}% is below target and will pressure closings without intervention.`);
  if (criticalRiskCount > 0) critical.push(`${criticalRiskCount} critical-risk loans need immediate attention to prevent fallout.`);
  if (highLtvCount > 0) critical.push(`${highLtvCount} loans with LTV > 95% face elevated PMI/decline friction—tighten borrower readiness.`);
  if (lowFicoCount > 0) critical.push(`${lowFicoCount} loans with subprime FICO (<620) increase denial probability—validate compensating factors early.`);
  if (highDtiCount > 0) warning.push(`${highDtiCount} loans with DTI > 43% may trigger underwriting conditions—preempt documentation gaps.`);

  // Metric-specific emphasis
  if (metricKey === 'Funded Loans') {
    if (fundedCount > 0) success.push(`${fundedCount} loans funded in the selected period—realized production is tracking.`);
    if (pullThrough !== null && pullThrough < 70) warning.push('Improve lock-to-close execution and borrower responsiveness to lift funded volume.');
  }

  if (metricKey === 'Predicted Closing') {
    if (headlineValue !== undefined) success.push(`Forecast indicates ${headlineValue} expected closings—prioritize bottleneck removal to hit target.`);
    if (falloutRate >= 15) warning.push(`Fallout rate at ${falloutRate}% could reduce forecasted closings if unaddressed.`);
  }

  if (metricKey === 'Predicted Fallout') {
    if (falloutCount === 0) success.push('No withdraw/deny fallout detected in the current dataset.');
    if (falloutRate >= 10) warning.push(`Fallout rate at ${falloutRate}% warrants borrower coaching and underwriting pre-work.`);
    if (falloutRate >= 20) critical.push(`Fallout rate at ${falloutRate}% is critical—triage highest-risk files immediately.`);
  }

  if (metricKey === 'Active Loans Today') {
    if (activeCount > 0) success.push(`${activeCount} active/locked loans—pipeline is live and actionable.`);
    if (falloutRate >= 15) warning.push(`Model-implied fallout exposure at ${falloutRate}%—intervene early on high-LTV/high-DTI borrowers.`);
  }

  const officers = officerStats(loans, dateFilter, now);
  const topOfficer = officers[0];
  const riskOfficer = officers.find((o) => o.criticalRiskCount > 0) ?? officers[0];

  const topTiering: string[] = [];
  if (topOfficer) {
    const pt = topOfficer.startedCount > 0 ? safePct((topOfficer.fundedCount / topOfficer.startedCount) * 100) : null;
    topTiering.push(
      `Top producer: ${topOfficer.name} with ${topOfficer.activeCount} active loans (${Math.round(topOfficer.activeVolume / 1_000_000 * 10) / 10}M pipeline).`
    );
    if (pt !== null) topTiering.push(`${topOfficer.name} pull-through is ${pt}%—replicate their workflow across the team where possible.`);
  }
  if (riskOfficer && riskOfficer.criticalRiskCount > 0) {
    topTiering.push(`Coaching focus: ${riskOfficer.name} has ${riskOfficer.criticalRiskCount} critical-risk loans—prioritize daily borrower touchpoints.`);
  }
  if (topTiering.length < 3) topTiering.push('Tighten pre-qualification and condition-clearing cadence within 48 hours to reduce leakage.');

  const borrowerCoaching = topBorrowerCoachingTipsFromRisk(priorityLoansRaw && priorityLoansRaw.length > 0 ? priorityLoansRaw : activeLoans.slice(0, 12));

  const rawSections = [
    { title: 'Success', items: success.slice(0, 3) },
    { title: 'Warning', items: warning.slice(0, 3) },
    { title: 'Critical', items: critical.slice(0, 3) },
    { title: 'TopTiering Insights for Loan Officers', items: topTiering.slice(0, 3) },
    { title: 'Borrower Coaching', items: borrowerCoaching.slice(0, 3) },
  ] satisfies AlethiaSection[];

  const sections = rawSections.filter((s) => s.items.length > 0);
  return { sections };
}

