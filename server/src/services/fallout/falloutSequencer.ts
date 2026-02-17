/**
 * Fallout Sequencer (COHI Numeric Segmented Risk Range Engine)
 *
 * Applies sequential fallout prediction: Denied → Withdrawn → Closing Late → Projected to Close.
 * Uses blended numeric outcome profiles (similarity scoring by feature zones). Persists to loan_predictions
 * with projected_status, reason_codes (feature + zone/points), projected_funding_date, projected_close_window.
 */

import pg from 'pg';
import { getTurnTimeBaseline, getAvgApplicationToFundingDays } from './turnTimeProjectionService.js';
import { logInfo, logError } from '../logger.js';
import { getBlendedProfiles, getProfileForLoan } from './numericProfileBlendService.js';
import type {
  ProjectedStatusType,
  ProjectedCloseWindow,
  FalloutStatusType,
  MilestoneType,
} from './falloutTypes.js';
import type { BlendedProfileMap, BlendedFeatureStats } from './falloutTypes.js';

/** Max number of reason codes (feature contributions) stored per loan. */
const MAX_REASON_CODES = 10;

/** Similarity zones: Zone1 P40–P60 = 3 pts, Zone2 P30–P40 or P60–P70 = 2, Zone3 P20–P30 or P70–P80 = 1, Zone4 below P10 or above P90 = 0. */
const ZONE_POINTS = [3, 2, 1, 0];

/** Risk threshold: only predict Denied/Withdrawn when risk score (0-100) is above this. */
const RISK_THRESHOLD_PCT = 60;

/** Max raw similarity points: Denied = 4 features × 3 (incl. days_active = app to today for active loans), Withdrawn = 5 × 3. */
const MAX_DENIED_POINTS = 4 * 3;
const MAX_WITHDRAWN_POINTS = 5 * 3;

function zoneAndPoints(
  value: number,
  stats: BlendedFeatureStats
): { zone: number; points: number } {
  const p10 = stats.blended_p10;
  const p20 = stats.blended_p20;
  const p30 = stats.blended_p30;
  const p40 = stats.blended_p40;
  const p60 = stats.blended_p60;
  const p70 = stats.blended_p70;
  const p80 = stats.blended_p80;
  const p90 = stats.blended_p90;
  if (
    p10 != null &&
    p20 != null &&
    p30 != null &&
    p40 != null &&
    p60 != null &&
    p70 != null &&
    p80 != null &&
    p90 != null
  ) {
    // Zone 1: Between P40 and P60 → 3 points
    if (value >= p40 && value <= p60) return { zone: 1, points: ZONE_POINTS[0] };
    // Zone 2: P30–P40 or P60–P70 → 2 points
    if ((value >= p30 && value < p40) || (value > p60 && value <= p70)) return { zone: 2, points: ZONE_POINTS[1] };
    // Zone 3: P20–P30 or P70–P80 (and P10–P20, P80–P90 for continuity) → 1 point
    if ((value >= p20 && value < p30) || (value > p70 && value <= p80) || (value >= p10 && value < p20) || (value > p80 && value <= p90)) return { zone: 3, points: ZONE_POINTS[2] };
    // Zone 4: Below P10 or above P90 → 0 points
    return { zone: 4, points: ZONE_POINTS[3] };
  }
  const { blended_q1, blended_q3, blended_iqr } = stats;
  const iqr = Math.max(blended_iqr, 0.01);
  if (value >= blended_q1 && value <= blended_q3) return { zone: 1, points: ZONE_POINTS[0] };
  if (value < blended_q1) {
    if (value >= blended_q1 - iqr) return { zone: 2, points: ZONE_POINTS[1] };
    if (value >= blended_q1 - 2 * iqr) return { zone: 3, points: ZONE_POINTS[2] };
    return { zone: 4, points: ZONE_POINTS[3] };
  }
  if (value <= blended_q3 + iqr) return { zone: 2, points: ZONE_POINTS[1] };
  if (value <= blended_q3 + 2 * iqr) return { zone: 3, points: ZONE_POINTS[2] };
  return { zone: 4, points: ZONE_POINTS[3] };
}

/** Raw segment key (loan_type, loan_purpose, occupancy) for profile lookup. */
function getSegmentKeyRaw(loan: any): { loan_type: string; loan_purpose: string; occupancy: string } {
  const loan_type = (loan.loan_type ?? loan.loanType ?? '').toString().trim() || 'Unknown';
  const loan_purpose = (loan.loan_purpose ?? loan.loanPurpose ?? '').toString().trim() || 'Unknown';
  const occupancy = (loan.occupancy_type ?? loan.occupancyType ?? '').toString().trim() || 'Unknown';
  return { loan_type, loan_purpose, occupancy };
}

/** Extract feature values for similarity (null/missing -> skip, do not use 0). For active loans, days_active end = funding_date ?? closing_date ?? current_status_date ?? today. */
function getFeatureValues(loan: any): {
  fico_score: number | null;
  ltv_ratio: number | null;
  be_dti_ratio: number | null;
  days_active: number | null;
  market_delta: number | null;
} {
  const app = loan.application_date ?? loan.applicationDate;
  const endDate = loan.funding_date ?? loan.fund_date ?? loan.closing_date ?? loan.current_status_date;
  let days_active: number | null = null;
  if (app) {
    const end = endDate ? new Date(endDate) : new Date();
    days_active = Math.floor((end.getTime() - new Date(app).getTime()) / (1000 * 60 * 60 * 24));
    if (days_active < 0 || days_active > 365 * 3) days_active = null;
  }
  const fico = loan.fico_score ?? loan.ficoScore;
  const ltv = loan.ltv_ratio ?? loan.ltv;
  const dti = loan.be_dti_ratio ?? loan.dti;
  const market_delta = loan.marketChangeDelta ?? loan.market_change_delta ?? null;
  return {
    fico_score: fico != null && !isNaN(Number(fico)) ? Number(fico) : null,
    ltv_ratio: ltv != null && !isNaN(Number(ltv)) ? Number(ltv) : null,
    be_dti_ratio: dti != null && !isNaN(Number(dti)) ? Number(dti) : null,
    days_active,
    market_delta: market_delta != null && !isNaN(Number(market_delta)) ? Number(market_delta) : null,
  };
}

/**
 * Compute similarity score for one status: sum of zone points for each feature (skip null/missing).
 * Returns { score (sum of points), reasonCodes }.
 */
function computeSimilarityScore(
  loan: any,
  statusType: FalloutStatusType,
  blendedMap: BlendedProfileMap,
  segment: { loan_type: string; loan_purpose: string; occupancy: string }
): { score: number; reasonCodes: Array<{ bucket_type: string; bucket_value: string; risk_score: number }> } {
  const profile = getProfileForLoan(
    blendedMap,
    statusType,
    segment.loan_type,
    segment.loan_purpose,
    segment.occupancy
  );
  const vals = getFeatureValues(loan);
  const features =
    statusType === 'Withdrawn'
      ? (['fico_score', 'ltv_ratio', 'be_dti_ratio', 'days_active', 'market_delta'] as const)
      : (['fico_score', 'ltv_ratio', 'be_dti_ratio', 'days_active'] as const); // Denied: days_active = app to today

  let score = 0;
  const reasonCodes: Array<{ bucket_type: string; bucket_value: string; risk_score: number }> = [];

  for (const f of features) {
    const value =
      f === 'fico_score'
        ? vals.fico_score
        : f === 'ltv_ratio'
          ? vals.ltv_ratio
          : f === 'be_dti_ratio'
            ? vals.be_dti_ratio
            : f === 'days_active'
              ? vals.days_active
              : vals.market_delta;
    if (value == null || isNaN(value)) continue; // skip null/missing
    const stats = profile.get(f);
    if (!stats) continue;
    const { zone, points } = zoneAndPoints(value, stats);
    score += points;
    reasonCodes.push({
      bucket_type: f,
      bucket_value: `Zone${zone}`,
      risk_score: points,
    });
  }

  reasonCodes.sort((a, b) => b.risk_score - a.risk_score);
  return { score, reasonCodes: reasonCodes.slice(0, MAX_REASON_CODES) };
}

/** Segment key for turn-time baseline lookup: raw loan_type|loan_purpose|occupancy (matches turn_time_baselines). */
function getSegmentKeyForTurnTime(loan: any): string {
  const lt = (loan.loan_type ?? loan.loanType ?? '').toString().trim() || 'Unknown';
  const purpose = (loan.loan_purpose ?? loan.loanPurpose ?? 'Unknown').toString().trim() || 'Unknown';
  const occ = (loan.occupancy_type ?? loan.occupancyType ?? 'Unknown').toString().trim() || 'Unknown';
  return `${lt}|${purpose}|${occ}`;
}

/**
 * Projected funding date from current milestone + turn_time_baselines. Milestone priority: CTC > Appr > CondAppr > Lock.
 */
async function getProjectedFundingDate(
  pool: pg.Pool,
  loan: any,
  segmentKey: string
): Promise<Date | null> {
  const has = (f: any) => f != null && f !== '';
  let milestoneType: MilestoneType | null = null;
  let milestoneDate: Date | null = null;
  if (has(loan.ctc_date ?? loan.ctcDate)) {
    milestoneType = 'CTC';
    milestoneDate = new Date(loan.ctc_date ?? loan.ctc_date);
  } else if (has(loan.uw_final_approval_date ?? loan.approval_date)) {
    milestoneType = 'Appr';
    milestoneDate = new Date(loan.uw_final_approval_date ?? loan.approval_date);
  } else if (has(loan.conditional_approval_date ?? loan.condApprovalDate)) {
    milestoneType = 'CondAppr';
    milestoneDate = new Date(loan.conditional_approval_date ?? loan.condApprovalDate);
  } else if (has(loan.lock_date ?? loan.lockDate)) {
    milestoneType = 'Lock';
    milestoneDate = new Date(loan.lock_date ?? loan.lockDate);
  }
  if (!milestoneType || !milestoneDate) return null;
  const avgDays = await getTurnTimeBaseline(pool, segmentKey, milestoneType);
  if (avgDays == null || avgDays <= 0) return null;
  const projected = new Date(milestoneDate);
  projected.setDate(projected.getDate() + Math.round(avgDays));
  return projected;
}

function getProjectedCloseWindow(projectedFunding: Date | null, ecd: Date | null): ProjectedCloseWindow {
  if (!projectedFunding || !ecd) return 'Later';
  const now = new Date();
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 2, 0);
  const rolling30 = new Date(now);
  rolling30.setDate(rolling30.getDate() + 30);
  if (projectedFunding <= endOfMonth) return 'MTD';
  if (projectedFunding <= rolling30) return 'Rolling30';
  if (projectedFunding <= nextMonthStart) return 'NextMonth';
  return 'Later';
}

/** Days before ECD over which "urgency" ramps from 0 to 1 (closer to ECD = higher score). */
const CLOSE_LATE_URGENCY_WINDOW_DAYS = 30;

/** Days past ECD at which "lateness" is considered full (1.0). */
const CLOSE_LATE_LATENESS_CAP_DAYS = 30;

/** Max reason_codes points for "other" outcome (API divides sum by this to get 0-100). */
const MAX_OTHER_POINTS = 18;

/**
 * Risk score 0-100 for Closing Late: urgency (closer to ECD = higher) + lateness (further past ECD = higher).
 * urgency = min(1, max(0, (window - daysToECD) / window)); lateness = min(1, projectedDaysPastECD / cap).
 * score_100 = min(100, round(50 * urgency + 50 * lateness)).
 * Returns the risk_score value to store in reason_codes so API (sum/18)*100 yields score_100.
 */
function closeLateRiskScore100(
  projectedFundingDate: Date | null,
  ecd: Date | null,
  asOfDate: Date
): { score100: number; projectedDaysPastECD: number } {
  if (!projectedFundingDate || !ecd) return { score100: 0, projectedDaysPastECD: 0 };
  const msPerDay = 1000 * 60 * 60 * 24;
  const daysToECD = Math.floor((ecd.getTime() - asOfDate.getTime()) / msPerDay);
  const projectedDaysPastECD = Math.floor(
    (projectedFundingDate.getTime() - ecd.getTime()) / msPerDay
  );
  if (projectedDaysPastECD <= 0) return { score100: 0, projectedDaysPastECD: 0 };
  const urgency = Math.min(
    1,
    Math.max(0, (CLOSE_LATE_URGENCY_WINDOW_DAYS - daysToECD) / CLOSE_LATE_URGENCY_WINDOW_DAYS)
  );
  const lateness = Math.min(1, projectedDaysPastECD / CLOSE_LATE_LATENESS_CAP_DAYS);
  const score100 = Math.min(100, Math.round(50 * urgency + 50 * lateness));
  return { score100, projectedDaysPastECD };
}

/**
 * Run sequential fallout scoring and persist to loan_predictions.
 * 1) Denied similarity score → top N = projected_denied_count (historical denied rate * active count)
 * 2) Withdrawn similarity → top M of remaining
 * 3) Closing Late = projected_funding_date > ECD
 * 4) Remaining = ProjectedToClose
 */
export async function runFalloutSequencer(
  pool: pg.Pool,
  activeLoans: any[],
  options?: { asOfDate?: Date; historicalDeniedRate?: number; historicalWithdrawnRate?: number }
): Promise<{ saved: number }> {
  const startMs = Date.now();
  const asOfDate = options?.asOfDate ?? new Date();
  const asOfDateStr = asOfDate.toISOString().split('T')[0];
  const historicalDeniedRate = options?.historicalDeniedRate ?? 0.1;
  const historicalWithdrawnRate = options?.historicalWithdrawnRate ?? 0.15;

  const blendedMap = await getBlendedProfiles(pool);
  const avgApplicationToFundingDays = await getAvgApplicationToFundingDays(pool);

  type LoanWithMeta = {
    loan: any;
    loan_id: string;
    segment: { loan_type: string; loan_purpose: string; occupancy: string };
    deniedScore: number;
    deniedReasonCodes: Array<{ bucket_type: string; bucket_value: string; risk_score: number }>;
    withdrawnScore: number;
    withdrawnReasonCodes: Array<{ bucket_type: string; bucket_value: string; risk_score: number }>;
    projectedFundingDate: Date | null;
    ecd: Date | null;
    projected_status: ProjectedStatusType;
    reason_codes: Array<{ bucket_type: string; bucket_value: string; risk_score: number }>;
    projected_close_window: ProjectedCloseWindow;
    confidence_score: number;
  };

  const list: LoanWithMeta[] = [];
  for (const loan of activeLoans) {
    const loan_id = (loan.loan_id ?? loan.loanId ?? '').toString();
    if (!loan_id) continue;
    const segment = getSegmentKeyRaw(loan);
    const denied = computeSimilarityScore(loan, 'Denied', blendedMap, segment);
    const withdrawn = computeSimilarityScore(loan, 'Withdrawn', blendedMap, segment);
    const segmentKeyForTurn = getSegmentKeyForTurnTime(loan);
    let projectedFundingDate = await getProjectedFundingDate(pool, loan, segmentKeyForTurn);
    // Fallback when milestone or turn-time baseline is missing: use average application-to-funding days.
    if (projectedFundingDate == null && avgApplicationToFundingDays != null && avgApplicationToFundingDays > 0) {
      const appRaw = loan.application_date ?? loan.applicationDate;
      if (appRaw) {
        const appDate = new Date(appRaw);
        if (!isNaN(appDate.getTime())) {
          projectedFundingDate = new Date(appDate);
          projectedFundingDate.setDate(projectedFundingDate.getDate() + Math.round(avgApplicationToFundingDays));
        }
      }
    }
    const ecdRaw = loan.estimated_closing_date ?? loan.estimatedClosingDate;
    const ecd = ecdRaw ? new Date(ecdRaw) : null;

    list.push({
      loan,
      loan_id,
      segment,
      deniedScore: denied.score,
      deniedReasonCodes: denied.reasonCodes,
      withdrawnScore: withdrawn.score,
      withdrawnReasonCodes: withdrawn.reasonCodes,
      projectedFundingDate,
      ecd,
      projected_status: 'ProjectedToClose',
      reason_codes: [],
      projected_close_window: 'Later',
      confidence_score: 0.5,
    });
  }

  // Deny vs Withdraw: compare risks; when both above threshold pick higher (ties → Withdraw).
  // Alternative (deny-first): comment out the block below and uncomment the "DENY-FIRST ALTERNATIVE" block.
  const deniedRisk100 = (score: number) => (score / MAX_DENIED_POINTS) * 100;
  const withdrawnRisk100 = (score: number) => (score / MAX_WITHDRAWN_POINTS) * 100;

  for (const item of list) {
    const dRisk = deniedRisk100(item.deniedScore);
    const wRisk = withdrawnRisk100(item.withdrawnScore);
    const denyMeetsThreshold = dRisk > RISK_THRESHOLD_PCT;
    const withdrawMeetsThreshold = wRisk > RISK_THRESHOLD_PCT;
    if (denyMeetsThreshold && (!withdrawMeetsThreshold || dRisk > wRisk)) {
      item.projected_status = 'Denied';
      item.reason_codes =
        item.deniedReasonCodes.length > 0
          ? item.deniedReasonCodes
          : [{ bucket_type: 'Outcome', bucket_value: `Denied (score=${Math.round(item.deniedScore)})`, risk_score: Math.min(100, item.deniedScore) }];
      item.confidence_score = 0.5 + Math.min(0.4, item.deniedScore / 300);
    } else if (withdrawMeetsThreshold && (!denyMeetsThreshold || wRisk >= dRisk)) {
      item.projected_status = 'Withdrawn';
      item.reason_codes =
        item.withdrawnReasonCodes.length > 0
          ? item.withdrawnReasonCodes
          : [{ bucket_type: 'Outcome', bucket_value: `Withdrawn (score=${Math.round(item.withdrawnScore)})`, risk_score: Math.min(100, item.withdrawnScore) }];
      item.confidence_score = 0.5 + Math.min(0.4, item.withdrawnScore / 300);
    }
  }

  /* ----- DENY-FIRST ALTERNATIVE: uncomment this block and comment out the "for (const item of list)" block above to use it -----
  // Predict deny first (risk > threshold), then withdraw on remaining loans (no deny vs withdraw comparison).
  for (const item of list) {
    const dRisk = deniedRisk100(item.deniedScore);
    if (dRisk > RISK_THRESHOLD_PCT) {
      item.projected_status = 'Denied';
      item.reason_codes =
        item.deniedReasonCodes.length > 0
          ? item.deniedReasonCodes
          : [{ bucket_type: 'Outcome', bucket_value: `Denied (score=${Math.round(item.deniedScore)})`, risk_score: Math.min(100, item.deniedScore) }];
      item.confidence_score = 0.5 + Math.min(0.4, item.deniedScore / 300);
    }
  }
  for (const item of list) {
    if (item.projected_status !== 'ProjectedToClose') continue;
    const wRisk = withdrawnRisk100(item.withdrawnScore);
    if (wRisk > RISK_THRESHOLD_PCT) {
      item.projected_status = 'Withdrawn';
      item.reason_codes =
        item.withdrawnReasonCodes.length > 0
          ? item.withdrawnReasonCodes
          : [{ bucket_type: 'Outcome', bucket_value: `Withdrawn (score=${Math.round(item.withdrawnScore)})`, risk_score: Math.min(100, item.withdrawnScore) }];
      item.confidence_score = 0.5 + Math.min(0.4, item.withdrawnScore / 300);
    }
  }
  ----- END DENY-FIRST ALTERNATIVE ----- */

  const stillRemaining = list.filter((x) => x.projected_status === 'ProjectedToClose');
  for (const item of stillRemaining) {
    if (item.projectedFundingDate && item.ecd && item.projectedFundingDate > item.ecd) {
      item.projected_status = 'ClosingLate';
      const { score100, projectedDaysPastECD } = closeLateRiskScore100(
        item.projectedFundingDate,
        item.ecd,
        asOfDate
      );
      const riskScoreForApi = (score100 * MAX_OTHER_POINTS) / 100;
      item.reason_codes = [
        {
          bucket_type: 'TurnTime',
          bucket_value: `ProjectedFundingAfterECD(${projectedDaysPastECD}d)`,
          risk_score: riskScoreForApi,
        },
      ];
      item.confidence_score = 0.7;
    }
    item.projected_close_window = getProjectedCloseWindow(item.projectedFundingDate, item.ecd);
    if (item.projected_status === 'ProjectedToClose' && item.reason_codes.length === 0) {
      const { score100 } = closeLateRiskScore100(
        item.projectedFundingDate,
        item.ecd,
        asOfDate
      );
      const riskScoreForApi = (score100 * MAX_OTHER_POINTS) / 100;
      item.reason_codes = [
        { bucket_type: 'Outcome', bucket_value: 'ProjectedToClose', risk_score: riskScoreForApi },
      ];
      item.confidence_score = 0.65;
    }
  }

  // Highest-risk Denied and Withdrawn only (exclude ClosingLate / ProjectedToClose)
  const pad = (s: string, len: number) => (s ?? '').toString().slice(0, len).padEnd(len);
  const riskScore100 = (item: LoanWithMeta): number => {
    const sum = item.reason_codes.reduce((acc, r) => acc + (r.risk_score ?? 0), 0);
    const max =
      item.projected_status === 'Denied'
        ? MAX_DENIED_POINTS
        : item.projected_status === 'Withdrawn'
          ? MAX_WITHDRAWN_POINTS
          : 18;
    return Math.min(100, Math.round((sum / max) * 100));
  };
  const topDenied = list
    .filter((x) => x.projected_status === 'Denied')
    .sort((a, b) => riskScore100(b) - riskScore100(a))
    .slice(0, 50);
  const topWithdrawn = list
    .filter((x) => x.projected_status === 'Withdrawn')
    .sort((a, b) => riskScore100(b) - riskScore100(a))
    .slice(0, 50);
  const printRow = (item: LoanWithMeta) => {
    const loanNumber = (item.loan?.loan_number ?? item.loan_id ?? '').toString();
    const risk = riskScore100(item);
    const outcome = item.projected_status;
    const reasonsStr = item.reason_codes.map((r) => `${r.bucket_type}=${r.bucket_value}(${r.risk_score})`).join('; ') || '—';
    // eslint-disable-next-line no-console
    console.log(`${pad(loanNumber, 14)} | ${pad(String(risk), 3)} | ${pad(outcome, 16)} | ${reasonsStr}`);
  };
  // eslint-disable-next-line no-console
  console.log('\n[Fallout Sequencer] Highest-risk Denied (loan # | risk | outcome | reasons):');
  // eslint-disable-next-line no-console
  console.log('─'.repeat(110));
  for (const item of topDenied) printRow(item);
  if (topDenied.length === 0) {
    // eslint-disable-next-line no-console
    console.log('(none)');
  }
  // eslint-disable-next-line no-console
  console.log('\n[Fallout Sequencer] Highest-risk Withdrawn (loan # | risk | outcome | reasons):');
  // eslint-disable-next-line no-console
  console.log('─'.repeat(110));
  for (const item of topWithdrawn) printRow(item);
  if (topWithdrawn.length === 0) {
    // eslint-disable-next-line no-console
    console.log('(none)');
  }
  // eslint-disable-next-line no-console
  console.log('─'.repeat(110) + '\n');

  const calculatedAt = new Date();
  let saved = 0;
  for (const item of list) {
    try {
      await pool.query(
        `DELETE FROM public.loan_predictions WHERE loan_id = $1`,
        [item.loan_id]
      );
      const projectedFundingStr = item.projectedFundingDate ? item.projectedFundingDate.toISOString().split('T')[0] : null;
      const predicted_outcome = item.projected_status === 'Denied' ? 'deny' : item.projected_status === 'Withdrawn' ? 'withdraw' : 'originate';
      await pool.query(
        `INSERT INTO public.loan_predictions (
          loan_id, predicted_outcome, confidence, reasoning, risk_factors, bucket, loan_data, model_version,
          as_of_date, projected_status, reason_codes, projected_funding_date, projected_close_window, confidence_score, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
        [
          item.loan_id,
          predicted_outcome,
          Math.round(item.confidence_score * 100),
          item.reason_codes.map((r) => `${r.bucket_type}=${r.bucket_value}`).join('; ') || item.projected_status,
          item.reason_codes.map((r) => r.bucket_type),
          'medium',
          JSON.stringify({ loan_id: item.loan_id, projected_status: item.projected_status }),
          'fallout-sequencer-v1',
          asOfDateStr,
          item.projected_status,
          JSON.stringify(item.reason_codes),
          projectedFundingStr,
          item.projected_close_window,
          item.confidence_score,
          calculatedAt,
          calculatedAt,
        ]
      );
      saved++;
    } catch (err: any) {
      logError('Fallout sequencer: failed to save prediction', err, { loan_id: item.loan_id });
    }
  }

  const elapsed = Date.now() - startMs;
  logInfo('Fallout sequencer completed', { saved, asOfDate: asOfDateStr, elapsedMs: elapsed });
  return { saved };
}
