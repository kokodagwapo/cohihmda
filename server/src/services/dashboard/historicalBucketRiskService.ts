/**
 * Historical Bucket Risk Service
 *
 * Step 3 of the Historical Bucket–Based Risk Scoring plan:
 *   - For each signal, compute deny% and withdraw% per bucket (share of total fallout).
 *   - For FICO/LTV/DTI, stats are split by loan type (Conventional vs Government).
 *   - Use cumulative threshold to identify "significant" bucket sets.
 *   - Halfway default: if first 3 buckets don't meet threshold, use those 3.
 *
 * Step 4 helpers:
 *   - Binary scoring: "bucket in significant set → +1"
 *   - Scale to 1-100 based on present signal count.
 */

import { getLoanTypeCategory, type LoanTypeCategory } from './bucketThresholdService.js';
import { logInfo } from '../logger.js';

// ────────────────────────────── Types ──────────────────────────────

export interface SignalBucketStats {
  denySignificantBuckets: Set<number>;
  withdrawSignificantBuckets: Set<number>;
  denyPctByBucket: Record<number, number>;       // for debugging / logging
  withdrawPctByBucket: Record<number, number>;    // for debugging / logging
}

export interface HistoricalBucketRiskProfile {
  /** Keyed by signal key. For FICO/LTV/DTI: "ficoScoreSignal|Conventional", etc. For others: field name. */
  bySignal: Record<string, SignalBucketStats>;
}

// ────────────────────────────── Signal Configuration ──────────────────────────────

export interface SignalConfig {
  /** Field name on the bucketed loan object (1-6 integer bucket). */
  signalField: string;
  /** If true, compute stats per Conventional/Government. */
  loanTypeSplit: boolean;
  /**
   * Withdraw cumulative direction.
   * 'ascending'  = 1→6 (for FICO, LTV, DTI — better score ↔ higher withdraw risk).
   * 'descending' = 6→1 (all other signals).
   * Deny direction is always 'descending' (6→1).
   */
  withdrawDirection: 'ascending' | 'descending';
  /** Used in credit risk score (deny). */
  credit: boolean;
  /** Used in process risk score (withdraw). */
  process: boolean;
}

/** All signals used in credit and/or process risk scoring. */
export const SIGNAL_CONFIGS: SignalConfig[] = [
  // ── Credit + Process ──
  { signalField: 'loanTypeSignal',            loanTypeSplit: false, withdrawDirection: 'descending', credit: true,  process: true  },
  { signalField: 'loanPurposeSignal',         loanTypeSplit: false, withdrawDirection: 'descending', credit: true,  process: true  },
  { signalField: 'occupancyTypeSignal',        loanTypeSplit: false, withdrawDirection: 'descending', credit: true,  process: true  },
  { signalField: 'ficoScoreSignal',            loanTypeSplit: true,  withdrawDirection: 'ascending',  credit: true,  process: true  },
  { signalField: 'ltvSignal',                  loanTypeSplit: true,  withdrawDirection: 'ascending',  credit: true,  process: true  },
  { signalField: 'dtiSignal',                  loanTypeSplit: true,  withdrawDirection: 'ascending',  credit: true,  process: true  },
  { signalField: 'selfEmployedSignal',         loanTypeSplit: false, withdrawDirection: 'descending', credit: true,  process: true  },
  { signalField: 'timeInMotionSignal',         loanTypeSplit: false, withdrawDirection: 'descending', credit: true,  process: true  },
  { signalField: 'loPullthroughSignal',        loanTypeSplit: false, withdrawDirection: 'descending', credit: true,  process: true  },
  { signalField: 'processorPullthroughSignal', loanTypeSplit: false, withdrawDirection: 'descending', credit: true,  process: true  },
  { signalField: 'uwPullthroughSignal',        loanTypeSplit: false, withdrawDirection: 'descending', credit: true,  process: true  },
  { signalField: 'closerPullthroughSignal',    loanTypeSplit: false, withdrawDirection: 'descending', credit: true,  process: true  },
  // ── Process-only ──
  { signalField: 'lockExpirationDaysRemainingSignal', loanTypeSplit: false, withdrawDirection: 'descending', credit: false, process: true  },
  { signalField: 'interestLockVsMarketSignalStrength', loanTypeSplit: false, withdrawDirection: 'descending', credit: false, process: true  },
];

/** Credit-only signal configs. */
export const CREDIT_SIGNAL_CONFIGS = SIGNAL_CONFIGS.filter(c => c.credit);
/** Process-only signal configs. */
export const PROCESS_SIGNAL_CONFIGS = SIGNAL_CONFIGS.filter(c => c.process);

// ────────────────────────────── Constants ──────────────────────────────

const FALLOUT_CUMULATIVE_THRESHOLD = 0.5;
const HALFWAY_BUCKET_COUNT = 3;
export const FIXED_FALLOUT_THRESHOLD = 60;

// ────────────────────────────── Step 3: Compute Significant Bucket Sets ──────────────────────────────

/**
 * Compute significant bucket sets from historical loan outcomes.
 *
 * For each signal (and loan-type variant for FICO/LTV/DTI), we compute:
 *   denyPct[b]    = count(deny in bucket b) / totalDeny       (share of all denials)
 *   withdrawPct[b] = count(withdraw in bucket b) / totalWithdraw
 *
 * Then we cumulate in the configured direction until cumulative ≥ threshold (default 50%).
 * If the first 3 buckets don't meet the threshold we default to those 3 buckets.
 */
export function computeHistoricalBucketFalloutStats(
  historicalWithOutcomes: any[],
  options?: { cumulativeThreshold?: number },
): HistoricalBucketRiskProfile {
  const threshold = options?.cumulativeThreshold ?? FALLOUT_CUMULATIVE_THRESHOLD;
  const profile: HistoricalBucketRiskProfile = { bySignal: {} };

  for (const config of SIGNAL_CONFIGS) {
    if (config.loanTypeSplit) {
      for (const loanType of ['Conventional', 'Government'] as const) {
        const signalKey = `${config.signalField}|${loanType}`;
        const loansInScope = historicalWithOutcomes.filter(
          loan => getLoanTypeCategory(loan.loanType ?? loan.loan_type) === loanType,
        );
        profile.bySignal[signalKey] = computeStatsForSignal(
          loansInScope,
          config.signalField,
          config.withdrawDirection,
          threshold,
        );
      }
    } else {
      profile.bySignal[config.signalField] = computeStatsForSignal(
        historicalWithOutcomes,
        config.signalField,
        config.withdrawDirection,
        threshold,
      );
    }
  }

  // Log summary (structured for tooling)
  logInfo('Historical Bucket Risk Profile computed', {
    signalCount: Object.keys(profile.bySignal).length,
    signals: Object.entries(profile.bySignal).map(([key, stats]) => ({
      key,
      denyBuckets: Array.from(stats.denySignificantBuckets).sort((a, b) => a - b),
      withdrawBuckets: Array.from(stats.withdrawSignificantBuckets).sort((a, b) => a - b),
    })),
  });

  // Terminal-friendly log: high risk historical buckets (deny = credit risk, withdraw = process risk)
  const cumul = (pctByBucket: Record<number, number>, buckets: Set<number>) => {
    let s = 0;
    buckets.forEach((b) => { s += pctByBucket[b] ?? 0; });
    return s;
  };
  const pctStr = (p: number) => (p * 100).toFixed(1) + '%';

  const lines: string[] = [
    '',
    '——— High risk historical buckets (predictions) ———',
    '  Signal                              | Deny (credit) | Deny %   | Withdraw (process) | Withdraw %',
    '  ------------------------------------|---------------|---------|--------------------|-----------',
  ];
  const entries = Object.entries(profile.bySignal).sort(([a], [b]) => a.localeCompare(b));
  for (const [key, stats] of entries) {
    const denyBuckets = [...stats.denySignificantBuckets].sort((a, b) => a - b);
    const withdrawBuckets = [...stats.withdrawSignificantBuckets].sort((a, b) => a - b);
    const denyStr = denyBuckets.join(',') || '—';
    const withdrawStr = withdrawBuckets.join(',') || '—';
    const denyCumulPct = cumul(stats.denyPctByBucket, stats.denySignificantBuckets);
    const withdrawCumulPct = cumul(stats.withdrawPctByBucket, stats.withdrawSignificantBuckets);
    const keyPadded = key.padEnd(36);
    lines.push(
      `  ${keyPadded} | ${denyStr.padEnd(13)} | ${pctStr(denyCumulPct).padEnd(7)} | ${withdrawStr.padEnd(18)} | ${pctStr(withdrawCumulPct)}`,
    );
  }
  lines.push('————————————————————————————————————————————————————————————————————————————');
  // Print to terminal when predictions run (high risk historical buckets)
  // eslint-disable-next-line no-console
  console.log(lines.join('\n'));

  // Per-bucket percentages (deny % and withdraw % in each bucket 1–6)
  const pctCol = (p: number) => (p * 100).toFixed(1).padStart(5) + '%';
  const denyPctLines: string[] = [
    '',
    '——— Deny % in each bucket (share of all denials in that bucket) ———',
    '  Signal                              |    B1   |    B2   |    B3   |    B4   |    B5   |    B6   | Cumul(sig)',
    '  ------------------------------------|---------|---------|---------|---------|---------|---------|-----------',
  ];
  const withdrawPctLines: string[] = [
    '',
    '——— Withdraw % in each bucket (share of all withdrawals in that bucket) ———',
    '  Signal                              |    B1   |    B2   |    B3   |    B4   |    B5   |    B6   | Cumul(sig)',
    '  ------------------------------------|---------|---------|---------|---------|---------|---------|-----------',
  ];
  for (const [key, stats] of entries) {
    const keyPadded = key.padEnd(36);
    const d1 = stats.denyPctByBucket[1] ?? 0;
    const d2 = stats.denyPctByBucket[2] ?? 0;
    const d3 = stats.denyPctByBucket[3] ?? 0;
    const d4 = stats.denyPctByBucket[4] ?? 0;
    const d5 = stats.denyPctByBucket[5] ?? 0;
    const d6 = stats.denyPctByBucket[6] ?? 0;
    const denyCumul = cumul(stats.denyPctByBucket, stats.denySignificantBuckets);
    denyPctLines.push(
      `  ${keyPadded} | ${pctCol(d1)} | ${pctCol(d2)} | ${pctCol(d3)} | ${pctCol(d4)} | ${pctCol(d5)} | ${pctCol(d6)} | ${pctStr(denyCumul)}`,
    );
    const w1 = stats.withdrawPctByBucket[1] ?? 0;
    const w2 = stats.withdrawPctByBucket[2] ?? 0;
    const w3 = stats.withdrawPctByBucket[3] ?? 0;
    const w4 = stats.withdrawPctByBucket[4] ?? 0;
    const w5 = stats.withdrawPctByBucket[5] ?? 0;
    const w6 = stats.withdrawPctByBucket[6] ?? 0;
    const withdrawCumul = cumul(stats.withdrawPctByBucket, stats.withdrawSignificantBuckets);
    withdrawPctLines.push(
      `  ${keyPadded} | ${pctCol(w1)} | ${pctCol(w2)} | ${pctCol(w3)} | ${pctCol(w4)} | ${pctCol(w5)} | ${pctCol(w6)} | ${pctStr(withdrawCumul)}`,
    );
  }
  denyPctLines.push('—————————————————————————————————————————————————————————————————————————————————————————————');
  withdrawPctLines.push('—————————————————————————————————————————————————————————————————————————————————————————————');
  // eslint-disable-next-line no-console
  console.log(denyPctLines.join('\n'));
  // eslint-disable-next-line no-console
  console.log(withdrawPctLines.join('\n'));

  return profile;
}

// ────────────────────────────── Internal Helpers ──────────────────────────────

function computeStatsForSignal(
  loans: any[],
  signalField: string,
  withdrawDirection: 'ascending' | 'descending',
  threshold: number,
): SignalBucketStats {
  const denyCountByBucket: Record<number, number> = {};
  const withdrawCountByBucket: Record<number, number> = {};
  let totalDeny = 0;
  let totalWithdraw = 0;

  for (const loan of loans) {
    const bucket = loan[signalField];
    if (bucket == null || typeof bucket !== 'number') continue;

    const outcome = loan.actualOutcome;
    if (outcome === 'deny') {
      denyCountByBucket[bucket] = (denyCountByBucket[bucket] || 0) + 1;
      totalDeny++;
    } else if (outcome === 'withdraw') {
      withdrawCountByBucket[bucket] = (withdrawCountByBucket[bucket] || 0) + 1;
      totalWithdraw++;
    }
  }

  // Share-of-total-outcome percentages
  const denyPctByBucket: Record<number, number> = {};
  const withdrawPctByBucket: Record<number, number> = {};
  for (let b = 1; b <= 6; b++) {
    denyPctByBucket[b] = totalDeny > 0 ? (denyCountByBucket[b] || 0) / totalDeny : 0;
    withdrawPctByBucket[b] = totalWithdraw > 0 ? (withdrawCountByBucket[b] || 0) / totalWithdraw : 0;
  }

  // Deny: always 6→1
  const denySignificantBuckets = computeSignificantBuckets(denyPctByBucket, 'descending', threshold);
  // Withdraw: use provided direction
  const withdrawSignificantBuckets = computeSignificantBuckets(withdrawPctByBucket, withdrawDirection, threshold);

  return { denySignificantBuckets, withdrawSignificantBuckets, denyPctByBucket, withdrawPctByBucket };
}

/**
 * Cumulate bucket percentages in the given direction until cumulative ≥ threshold.
 * Halfway default: if the first 3 buckets don't reach the threshold, return those 3.
 */
function computeSignificantBuckets(
  pctByBucket: Record<number, number>,
  direction: 'ascending' | 'descending',
  threshold: number,
): Set<number> {
  const order = direction === 'descending' ? [6, 5, 4, 3, 2, 1] : [1, 2, 3, 4, 5, 6];
  const significant = new Set<number>();
  let cumulative = 0;

  for (let i = 0; i < order.length; i++) {
    const b = order[i];
    cumulative += pctByBucket[b] || 0;
    significant.add(b);

    if (cumulative >= threshold) {
      return significant;
    }
    // Halfway default: if first 3 buckets don't meet threshold, use them
    if (i === HALFWAY_BUCKET_COUNT - 1) {
      return significant;
    }
  }

  return significant;
}

// ────────────────────────────── Step 4 Helpers: Scoring ──────────────────────────────

/**
 * Get the signal key for looking up a signal's stats in the profile.
 * For FICO/LTV/DTI (loanTypeSplit signals), appends "|Conventional" or "|Government".
 * For others, returns the signalField as-is.
 */
function getSignalKey(config: SignalConfig, loanTypeCategory: LoanTypeCategory): string {
  return config.loanTypeSplit ? `${config.signalField}|${loanTypeCategory}` : config.signalField;
}

/**
 * Compute credit (deny) and process (withdraw) risk scores for a single loan
 * using the historical bucket risk profile (binary "bucket in significant set" scoring).
 *
 * Returns raw counts, present signal counts, and scaled 1-100 scores.
 */
export function computeRiskScoresFromProfile(
  loan: any,
  profile: HistoricalBucketRiskProfile,
): {
  creditRiskRaw: number;
  creditSignalCount: number;
  creditRiskScore100: number;
  processRiskRaw: number;
  processSignalCount: number;
  processRiskScore100: number;
  riskScore: number;
  predictedOutcome: 'originate' | 'withdraw' | 'deny';
  confidence: number;
  bucket: 'high' | 'medium' | 'low';
} {
  const loanTypeCategory = getLoanTypeCategory(loan.loanType ?? loan.loan_type);

  // ── Credit risk (deny) ──
  // Only count signals that are present (non-null bucket). Missing/empty buckets (e.g. no processor assigned yet) are skipped.
  // So denominator = present credit signals only; loans early in pipeline are not penalized for missing officer/pullthrough data.
  let creditRiskRaw = 0;
  let creditSignalCount = 0;
  for (const config of CREDIT_SIGNAL_CONFIGS) {
    const bucketVal = loan[config.signalField];
    if (bucketVal == null || typeof bucketVal !== 'number') continue;
    creditSignalCount++;

    const key = getSignalKey(config, loanTypeCategory);
    const stats = profile.bySignal[key];
    if (stats && stats.denySignificantBuckets.has(bucketVal)) {
      creditRiskRaw++;
    }
  }

  // ── Process risk (withdraw) ──
  // Same: only present signals count. Empty processor/underwriter/closer/lock-days do not reduce the score.
  let processRiskRaw = 0;
  let processSignalCount = 0;
  for (const config of PROCESS_SIGNAL_CONFIGS) {
    const bucketVal = loan[config.signalField];
    if (bucketVal == null || typeof bucketVal !== 'number') continue;
    processSignalCount++;

    const key = getSignalKey(config, loanTypeCategory);
    const stats = profile.bySignal[key];
    if (stats && stats.withdrawSignificantBuckets.has(bucketVal)) {
      processRiskRaw++;
    }
  }

  // ── Scale to 1-100 ──
  const scale = (raw: number, total: number): number => {
    if (total === 0) return 0;
    if (raw === 0) return 1;
    return Math.min(100, Math.max(1, Math.round((raw / total) * 99) + 1));
  };

  const creditRiskScore100 = scale(creditRiskRaw, creditSignalCount);
  const processRiskScore100 = scale(processRiskRaw, processSignalCount);

  // ── Combined risk score ──
  let riskScore: number;
  if (creditSignalCount === 0 && processSignalCount === 0) {
    riskScore = 50; // Fallback if no signals present
  } else {
    riskScore = Math.max(processRiskScore100, creditRiskScore100);
  }

  // ── Predicted outcome with fixed threshold ──
  let predictedOutcome: 'originate' | 'withdraw' | 'deny' = 'originate';
  let confidence = 70;

  if (riskScore >= FIXED_FALLOUT_THRESHOLD) {
    // Determine deny vs withdraw by which dimension is higher
    predictedOutcome = creditRiskScore100 >= processRiskScore100 ? 'deny' : 'withdraw';
    const overshoot = riskScore - FIXED_FALLOUT_THRESHOLD;
    confidence = Math.min(95, 55 + Math.round(overshoot * 0.8));
  } else {
    predictedOutcome = 'originate';
    const undershoot = FIXED_FALLOUT_THRESHOLD - riskScore;
    confidence = Math.min(95, 60 + Math.round(undershoot * 0.5));
  }

  // ── Bucket (high/medium/low) ──
  let bucket: 'high' | 'medium' | 'low';
  if (riskScore >= 75) bucket = 'high';
  else if (riskScore >= 50) bucket = 'medium';
  else bucket = 'low';

  return {
    creditRiskRaw,
    creditSignalCount,
    creditRiskScore100,
    processRiskRaw,
    processSignalCount,
    processRiskScore100,
    riskScore,
    predictedOutcome,
    confidence,
    bucket,
  };
}
