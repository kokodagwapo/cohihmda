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
import { getBlendedProfiles, getProfileForLoan, zoneAndPointsOriginate } from './numericProfileBlendService.js';
import type {
  ProjectedStatusType,
  ProjectedCloseWindow,
  FalloutStatusType,
  MilestoneType,
} from './falloutTypes.js';
import type { BlendedProfileMap, BlendedFeatureStats } from './falloutTypes.js';

/** Max number of reason codes (feature contributions) stored per loan. */
const MAX_REASON_CODES = 10;

/** Zone points: 6 pts = bucket 6 (worst), 1 pt = best. Both middle (P45–P55) and worse tail get 6 pts (direction-aware). */
const ZONE_POINTS = [6, 5, 4, 3, 2, 1];

/**
 * Static market delta zone from fixed bucket ranges (not profile-based).
 * Bucket 1 (low risk) = ≤−0.25%, Bucket 6 (high risk) = >+0.3%.
 * Zone = 7 − bucket (Zone 1 = worst/6pts, Zone 6 = best/1pt).
 */
function staticMarketDeltaZone(delta: number | null): { zone: number; points: number } | null {
  if (delta == null || isNaN(delta)) return null;
  let bucket: number;
  if (delta <= -0.25) bucket = 1;
  else if (delta <= 0) bucket = 2;
  else if (delta <= 0.1) bucket = 3;
  else if (delta <= 0.2) bucket = 4;
  else if (delta <= 0.3) bucket = 5;
  else bucket = 6;
  const zone = 7 - bucket;
  return { zone, points: ZONE_POINTS[zone - 1] };
}

/**
 * VA LTV hard rules: override profile-based LTV zones for VA loans by purpose.
 * - VA + Purchase or NoCash-Out Refinance: LTV ≤ 100 → zones 4–6 (100 = zone 4); LTV > 100 → zones 1–3.
 * - VA + Cash-Out Refinance: LTV ≤ 90 → zones 4–6 (90 = zone 4); LTV > 90 → zones 1–3.
 * Returns null if not VA or purpose not in (Purchase, NoCash-Out Refinance, Cash-Out Refinance) so caller uses profile.
 */
function vaLtvZoneAndPoints(
  ltv: number,
  loanType: string,
  loanPurpose: string
): { zone: number; points: number } | null {
  const lt = (loanType ?? '').toString().trim().toUpperCase();
  const lp = (loanPurpose ?? '').toString().trim();
  const lpNorm = lp.replace(/\s+/g, ' ').toLowerCase();
  if (lt !== 'VA') return null;
  const isPurchase = lpNorm === 'purchase';
  const isNoCashOut =
    lpNorm === 'nocash-out refinance' || lpNorm === 'no cash-out refinance';
  const isCashOut = lpNorm === 'cash-out refinance';
  if (!isPurchase && !isNoCashOut && !isCashOut) return null;

  const threshold = isCashOut ? 90 : 100; // Purchase and NoCash-Out use 100
  if (ltv <= threshold) {
    // Zones 4–6: at threshold = 4, better = 5, 6
    if (ltv >= threshold) return { zone: 4, points: ZONE_POINTS[3] };
    const step = 10;
    if (ltv >= threshold - step) return { zone: 5, points: ZONE_POINTS[4] };
    return { zone: 6, points: ZONE_POINTS[5] };
  }
  // Above threshold: zones 1–3 (worse)
  if (ltv <= threshold + 5) return { zone: 3, points: ZONE_POINTS[2] };
  if (ltv <= threshold + 15) return { zone: 2, points: ZONE_POINTS[1] };
  return { zone: 1, points: ZONE_POINTS[0] };
}

/** Risk threshold: only predict Denied/Withdrawn when risk score (0-100) is above this. */
const RISK_THRESHOLD_PCT = 60;

/** Max raw similarity points: Denied = 4 features × 6, Withdrawn = 5 features × 6. */
const MAX_DENIED_POINTS = 4 * 6;
const MAX_WITHDRAWN_POINTS = 5 * 6;

/**
 * Zone scoring for Denied vs Withdrawn.
 * Withdrawn (symmetricBands = true): Symmetric only. Zone 1 = middle (P45–P55) only. Zone 6 = both tails (<P10 or >P90) = 1 pt.
 * Denied (symmetricBands = false): Direction-aware tails only. Middle P45–P55 = Zone 1; <P10 and >P90 by direction (FICO: <P10=Zone1, >P90=Zone6; LTV/DTI/days: >P90=Zone1, <P10=Zone6); same percentile bands as Withdrawn in between.
 * (Purely direction-based Denied implementation is commented out below for reference.)
 */
function zoneAndPoints(
  value: number,
  stats: BlendedFeatureStats,
  higherIsWorse: boolean,
  symmetricBands: boolean
): { zone: number; points: number } {
  const p10 = stats.blended_p10;
  const p20 = stats.blended_p20;
  const p30 = stats.blended_p30;
  const p40 = stats.blended_p40;
  const p45 = stats.blended_p45;
  const p55 = stats.blended_p55;
  const p60 = stats.blended_p60;
  const p70 = stats.blended_p70;
  const p80 = stats.blended_p80;
  const p90 = stats.blended_p90;
  if (
    p10 != null &&
    p20 != null &&
    p30 != null &&
    p40 != null &&
    p45 != null &&
    p55 != null &&
    p60 != null &&
    p70 != null &&
    p80 != null &&
    p90 != null
  ) {
    if (symmetricBands) {
      // Withdrawn: symmetric only. Middle = Zone 1, both tails = Zone 6.
      if (value >= p45 && value <= p55) return { zone: 1, points: ZONE_POINTS[0] };
      if ((value >= p40 && value < p45) || (value > p55 && value <= p60)) return { zone: 2, points: ZONE_POINTS[1] };
      if ((value >= p30 && value < p40) || (value > p60 && value <= p70)) return { zone: 3, points: ZONE_POINTS[2] };
      if ((value >= p20 && value < p30) || (value > p70 && value <= p80)) return { zone: 4, points: ZONE_POINTS[3] };
      if ((value >= p10 && value < p20) || (value > p80 && value <= p90)) return { zone: 5, points: ZONE_POINTS[4] };
      return { zone: 6, points: ZONE_POINTS[5] }; // both tails
    }
    // Denied (direction-aware): middle P45–P55 = Zone 1; tails by direction; same bands as Withdrawn in between.
    if (value >= p45 && value <= p55) return { zone: 1, points: ZONE_POINTS[0] };
    if (value < p10) return { zone: higherIsWorse ? 6 : 1, points: ZONE_POINTS[higherIsWorse ? 5 : 0] };
    if (value > p90) return { zone: higherIsWorse ? 1 : 6, points: ZONE_POINTS[higherIsWorse ? 0 : 5] };
    if ((value >= p40 && value < p45) || (value > p55 && value <= p60)) return { zone: 2, points: ZONE_POINTS[1] };
    if ((value >= p30 && value < p40) || (value > p60 && value <= p70)) return { zone: 3, points: ZONE_POINTS[2] };
    if ((value >= p20 && value < p30) || (value > p70 && value <= p80)) return { zone: 4, points: ZONE_POINTS[3] };
    if ((value >= p10 && value < p20) || (value > p80 && value <= p90)) return { zone: 5, points: ZONE_POINTS[4] };
    return { zone: 6, points: ZONE_POINTS[5] };
    // --- COMMENTED OUT: Purely direction-based Denied (kept for reference) ---
    // // Denied: purely direction-based bands. Lower-is-worse = FICO; higher-is-worse = LTV, DTI, days_active.
    // if (higherIsWorse) {
    //   // LTV, DTI, days_active: Zone 1 = worst (high), Zone 6 = best (low). Zone 1: ≥P70, Zone 2: P60–<P70, Zone 3: P55–<P60, Zone 4: P45–<P55, Zone 5: P30–<P45, Zone 6: <P30.
    //   if (value >= p70) return { zone: 1, points: ZONE_POINTS[0] };
    //   if (value >= p60 && value < p70) return { zone: 2, points: ZONE_POINTS[1] };
    //   if (value >= p55 && value < p60) return { zone: 3, points: ZONE_POINTS[2] };
    //   if (value >= p45 && value < p55) return { zone: 4, points: ZONE_POINTS[3] };
    //   if (value >= p30 && value < p45) return { zone: 5, points: ZONE_POINTS[4] };
    //   return { zone: 6, points: ZONE_POINTS[5] }; // value < p30
    // } else {
    //   // FICO: Zone 1 = worst (low), Zone 6 = best (high). Zone 1: ≤P30, Zone 2: P30–P45, Zone 3: P45–P55, Zone 4: P55–P60, Zone 5: P60–P70, Zone 6: >P70.
    //   if (value <= p30) return { zone: 1, points: ZONE_POINTS[0] };
    //   if (value > p30 && value <= p45) return { zone: 2, points: ZONE_POINTS[1] };
    //   if (value > p45 && value <= p55) return { zone: 3, points: ZONE_POINTS[2] };
    //   if (value > p55 && value <= p60) return { zone: 4, points: ZONE_POINTS[3] };
    //   if (value > p60 && value <= p70) return { zone: 5, points: ZONE_POINTS[4] };
    //   return { zone: 6, points: ZONE_POINTS[5] }; // value > p70
    // }
  }
  const { blended_q1, blended_q3, blended_iqr } = stats;
  const iqr = Math.max(blended_iqr, 0.01);
  if (symmetricBands) {
    if (value >= blended_q1 && value <= blended_q3) return { zone: 1, points: ZONE_POINTS[0] };
    if (value < blended_q1) {
      if (value >= blended_q1 - iqr / 2) return { zone: 2, points: ZONE_POINTS[1] };
      if (value >= blended_q1 - iqr) return { zone: 3, points: ZONE_POINTS[2] };
      if (value >= blended_q1 - 1.5 * iqr) return { zone: 4, points: ZONE_POINTS[3] };
      if (value >= blended_q1 - 2 * iqr) return { zone: 5, points: ZONE_POINTS[4] };
      return { zone: 6, points: ZONE_POINTS[5] };
    }
    if (value <= blended_q3 + iqr / 2) return { zone: 2, points: ZONE_POINTS[1] };
    if (value <= blended_q3 + iqr) return { zone: 3, points: ZONE_POINTS[2] };
    if (value <= blended_q3 + 1.5 * iqr) return { zone: 4, points: ZONE_POINTS[3] };
    if (value <= blended_q3 + 2 * iqr) return { zone: 5, points: ZONE_POINTS[4] };
    return { zone: 6, points: ZONE_POINTS[5] };
  }
  // Denied (direction-aware) IQR fallback: middle = Zone 1; extreme tails by direction; same symmetric bands in between.
  if (value >= blended_q1 && value <= blended_q3) return { zone: 1, points: ZONE_POINTS[0] };
  if (value < blended_q1 - 2 * iqr) return { zone: higherIsWorse ? 6 : 1, points: ZONE_POINTS[higherIsWorse ? 5 : 0] };
  if (value > blended_q3 + 2 * iqr) return { zone: higherIsWorse ? 1 : 6, points: ZONE_POINTS[higherIsWorse ? 0 : 5] };
  if (value < blended_q1) {
    if (value >= blended_q1 - iqr / 2) return { zone: 2, points: ZONE_POINTS[1] };
    if (value >= blended_q1 - iqr) return { zone: 3, points: ZONE_POINTS[2] };
    if (value >= blended_q1 - 1.5 * iqr) return { zone: 4, points: ZONE_POINTS[3] };
    if (value >= blended_q1 - 2 * iqr) return { zone: 5, points: ZONE_POINTS[4] };
    return { zone: 6, points: ZONE_POINTS[5] };
  }
  if (value <= blended_q3 + iqr / 2) return { zone: 2, points: ZONE_POINTS[1] };
  if (value <= blended_q3 + iqr) return { zone: 3, points: ZONE_POINTS[2] };
  if (value <= blended_q3 + 1.5 * iqr) return { zone: 4, points: ZONE_POINTS[3] };
  if (value <= blended_q3 + 2 * iqr) return { zone: 5, points: ZONE_POINTS[4] };
  return { zone: 6, points: ZONE_POINTS[5] };
  // --- COMMENTED OUT: Purely direction-based Denied IQR fallback (kept for reference) ---
  // if (higherIsWorse) {
  //   if (value > blended_q3) {
  //     if (value <= blended_q3 + iqr / 2) return { zone: 2, points: ZONE_POINTS[1] };
  //     if (value <= blended_q3 + iqr) return { zone: 3, points: ZONE_POINTS[2] };
  //     if (value <= blended_q3 + 1.5 * iqr) return { zone: 4, points: ZONE_POINTS[3] };
  //     if (value <= blended_q3 + 2 * iqr) return { zone: 5, points: ZONE_POINTS[4] };
  //     return { zone: 1, points: ZONE_POINTS[0] };
  //   }
  //   if (value < blended_q1) return { zone: 6, points: ZONE_POINTS[5] };
  // } else {
  //   if (value < blended_q1) {
  //     if (value >= blended_q1 - iqr / 2) return { zone: 2, points: ZONE_POINTS[1] };
  //     if (value >= blended_q1 - iqr) return { zone: 3, points: ZONE_POINTS[2] };
  //     if (value >= blended_q1 - 1.5 * iqr) return { zone: 4, points: ZONE_POINTS[3] };
  //     if (value >= blended_q1 - 2 * iqr) return { zone: 5, points: ZONE_POINTS[4] };
  //     return { zone: 1, points: ZONE_POINTS[0] };
  //   }
  //   if (value > blended_q3) return { zone: 6, points: ZONE_POINTS[5] };
  // }
  // if (value >= blended_q1 && value <= blended_q3) return { zone: 1, points: ZONE_POINTS[0] };
  // return { zone: 4, points: ZONE_POINTS[3] };
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
      : (['fico_score', 'ltv_ratio', 'be_dti_ratio', 'days_active'] as const); // Denied (likely decline): 4 features only; market_delta not used

  // Lower value = worse: fico_score, market_delta. Higher value = worse: ltv_ratio, be_dti_ratio, days_active.
  const higherIsWorseFeatures = new Set(['ltv_ratio', 'be_dti_ratio', 'days_active']);

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

    // market_delta: use static bucket ranges instead of profile-based zones
    if (f === 'market_delta') {
      const result = staticMarketDeltaZone(value);
      if (result) {
        score += result.points;
        reasonCodes.push({
          bucket_type: f,
          bucket_value: `Zone${result.zone}`,
          risk_score: result.points,
        });
      }
      continue;
    }

    // VA LTV hard rules: override profile-based LTV zones for VA + Purchase / NoCash-Out / Cash-Out Refinance
    if (f === 'ltv_ratio') {
      const vaResult = vaLtvZoneAndPoints(value, segment.loan_type, segment.loan_purpose);
      if (vaResult) {
        score += vaResult.points;
        reasonCodes.push({
          bucket_type: f,
          bucket_value: `Zone${vaResult.zone}`,
          risk_score: vaResult.points,
        });
        continue;
      }
    }

    const stats = profile.get(f);
    if (!stats) continue;
    const higherIsWorse = higherIsWorseFeatures.has(f);
    const symmetricBands = statusType === 'Withdrawn'; // Denied = direction-aware; Withdrawn = symmetric only
    const { zone, points } = zoneAndPoints(value, stats, higherIsWorse, symmetricBands);
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
 * Risk score 0-100 for Closing Late: urgency (closer to ECD = higher) and lateness (further past ECD = higher).
 * urgency = min(1, max(0, (window - daysToECD) / window)); lateness = min(1, projectedDaysPastECD / cap).
 * The worse of the two is weighted more so a single severe dimension can push the score well above 50:
 * score_100 = round(100 * (0.75 * max(urgency, lateness) + 0.25 * min(urgency, lateness))).
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
  const u = urgency;
  const L = lateness;
  const score100 = Math.min(100, Math.round(100 * (0.75 * Math.max(u, L) + 0.25 * Math.min(u, L))));
  return { score100, projectedDaysPastECD };
}

/**
 * Run fallout scoring and persist to loan_predictions.
 * Deny vs Withdraw: compare-risks (deny > 60% and (withdraw ≤ 60% or deny > withdraw) → Denied; withdraw > 60% and (deny ≤ 60% or withdraw ≥ deny) → Withdrawn; ties to Withdraw).
 * Then: Closing Late = projected_funding_date > ECD; remainder = ProjectedToClose. Originated profiles applied only to ProjectedToClose/ClosingLate for UI signal buckets.
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

  // Compare-risks: Predict Deny when deny risk > 60% and (withdraw ≤ 60% or deny > withdraw); Predict Withdraw when withdraw > 60% and (deny ≤ 60% or withdraw ≥ deny). Ties go to Withdraw.
  // Withdrawn risk denominator: 30 if loan has market_delta (5 features), else 24 (4 features) so % is comparable.
  const deniedRisk100 = (score: number) => (score / MAX_DENIED_POINTS) * 100;
  const getWithdrawnMaxPoints = (loan: any): number => {
    const vals = getFeatureValues(loan);
    return vals.market_delta != null ? MAX_WITHDRAWN_POINTS : MAX_DENIED_POINTS;
  };
  const withdrawnRisk100 = (score: number, loan: any) =>
    (score / getWithdrawnMaxPoints(loan)) * 100;

  for (const item of list) {
    const dRisk = deniedRisk100(item.deniedScore);
    const wRisk = withdrawnRisk100(item.withdrawnScore, item.loan);
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

  // Originated profiles (100% separate from prediction): applied only to remainder (ProjectedToClose, ClosingLate)
  // for UI signal buckets. Zone 1 = 6 points for bucket display; we store risk_score: 0 so the loan’s official
  // risk score (close-late / outcome-based) is unchanged and not based on these zone points.
  const originateFeatures = ['fico_score', 'ltv_ratio', 'be_dti_ratio', 'days_active', 'market_delta'] as const;
  for (const item of list) {
    if (item.projected_status !== 'ProjectedToClose' && item.projected_status !== 'ClosingLate') continue;
    const profile = getProfileForLoan(
      blendedMap,
      'Originated',
      item.segment.loan_type,
      item.segment.loan_purpose,
      item.segment.occupancy
    );
    const vals = getFeatureValues(item.loan);
    // FICO and market_delta: lower = worse. LTV, DTI, days_active: higher = worse.
    const higherIsWorseFeatures = new Set(['ltv_ratio', 'be_dti_ratio', 'days_active']);
    for (const f of originateFeatures) {
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
      if (value == null || isNaN(value)) continue;

      // market_delta: use static bucket ranges instead of profile-based zones
      if (f === 'market_delta') {
        const staticResult = staticMarketDeltaZone(value);
        if (staticResult) {
          item.reason_codes.push({
            bucket_type: f,
            bucket_value: `Zone${staticResult.zone}`,
            risk_score: 0,
          });
        }
        continue;
      }

      // VA LTV hard rules: same override for Originated bucket display
      if (f === 'ltv_ratio') {
        const vaResult = vaLtvZoneAndPoints(
          value,
          item.segment.loan_type,
          item.segment.loan_purpose
        );
        if (vaResult) {
          item.reason_codes.push({
            bucket_type: f,
            bucket_value: `Zone${vaResult.zone}`,
            risk_score: 0,
          });
          continue;
        }
      }

      const stats = profile.get(f);
      if (!stats) continue;
      const higherIsWorse = higherIsWorseFeatures.has(f);
      const result = zoneAndPointsOriginate(value, stats, higherIsWorse);
      if (result) {
        item.reason_codes.push({
          bucket_type: f,
          bucket_value: `Zone${result.zone}`,
          risk_score: 0,
        });
      }
    }
    item.reason_codes = item.reason_codes.slice(0, MAX_REASON_CODES);
  }

  // Log each active loan: loan number, denied_points, withdraw_points, predicted outcome
  // eslint-disable-next-line no-console
  console.log('\n[Fallout Sequencer] Active loans (loan_number | denied_points | withdraw_points | outcome):');
  for (const item of list) {
    const loanNumber = (item.loan?.loan_number ?? item.loan_id ?? '').toString();
    // eslint-disable-next-line no-console
    console.log(`${loanNumber} | ${item.deniedScore} | ${item.withdrawnScore} | ${item.projected_status}`);
  }

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
