/**
 * Bucket Threshold Service
 *
 * Calculates and caches dynamic bucket thresholds for credit features (FICO, LTV, DTI)
 * per loan type: Conventional vs Government. Government = FHA, VA, USDA, Rural only;
 * all other types (Conventional, FarmersHomeAdministrative, Rural, Construction, Other, etc.)
 * are treated as Conventional.
 *
 * Single fallout rate: withdraw OR deny counts as fallout (no per-outcome split).
 * Algorithm: micro-binning, rate smoothing, quantile cut points, min bucket size, clamp, monotonicity.
 */

import pg from 'pg';
import { logInfo, logError } from '../logger.js';

export type LoanTypeCategory = 'Conventional' | 'Government';

export interface NumericThreshold {
  min: number | null;
  max: number | null;
  bucket: number;
}

export type LoanTypeForCache = LoanTypeCategory | 'All';

export interface ThresholdCacheEntry {
  featureName: string;
  loanType: LoanTypeForCache;
  thresholdData: NumericThreshold[];
  sampleSize: number;
  calculatedAt: Date;
}

const MIN_TOTAL_LOANS_FOR_CALCULATION = 100;
const QUANTILE_TARGETS = [0.1, 0.25, 0.45, 0.65, 0.85] as const;
const MIN_BIN_LOANS = 30;
const MIN_BUCKET_PCT = 0.05;

/** Government loan types only (FHA, VA, USDA). Rural, Construction, FarmersHomeAdministrative, Other = Conventional. */
const GOVERNMENT_LOAN_TYPES = ['FHA', 'VA', 'USDA'];

export function isGovernmentLoanType(loanType: string | null | undefined): boolean {
  if (!loanType || typeof loanType !== 'string') return false;
  const lt = loanType.trim();
  return GOVERNMENT_LOAN_TYPES.some((g) => g.toLowerCase() === lt.toLowerCase());
}

export function getLoanTypeCategory(loanType: string | null | undefined): LoanTypeCategory {
  return isGovernmentLoanType(loanType) ? 'Government' : 'Conventional';
}

/**
 * Self-employed bucket (field: borr_self_employed).
 * Bucket 1: false or null (less fallout prone).
 * Bucket 6: true (more fallout prone).
 * Accepts boolean or string from DB (Y/N, Yes/No, 1/0, true/false).
 */
export function getSelfEmployedBucket(value: boolean | string | null | undefined): 1 | 6 {
  if (value === true || value === 'Y' || value === 'Yes' || value === '1' || value === 'true' || value === 'y') {
    return 6;
  }
  return 1; // false, null, undefined, 'N', 'No', '0', 'false', 'n', or any other value
}

/** Credit features: per loan type (Conventional vs Government). higherIsWorse: true = higher value → bucket 6 (worse). */
const CREDIT_FEATURES = [
  { featureName: 'ficoScore', fieldName: 'ficoScore', higherIsWorse: false, microBinSize: 10, clamp: {} as Record<string, number>, loanTypeSpecific: true as const },
  { featureName: 'ltv', fieldName: 'ltv', higherIsWorse: true, microBinSize: 2, clamp: { bucket1Max: 65, bucket6Min: 90 }, loanTypeSpecific: true as const },
  { featureName: 'dti', fieldName: 'be_dti_ratio', higherIsWorse: true, microBinSize: 2, clamp: { bucket1Max: 33, bucket6Min: 55 }, loanTypeSpecific: true as const },
];

/** Global features: one threshold set for all loans (loan_type = 'All'). */
const GLOBAL_FEATURES = [
  { featureName: 'loanAmount', fieldName: 'loanAmount', higherIsWorse: true, microBinSize: 10000, clamp: {} as Record<string, number>, loanTypeSpecific: false as const },
  { featureName: 'activeDays', fieldName: 'activeDays', higherIsWorse: true, microBinSize: 7, clamp: { bucket1Max: 10, bucket6Min: 90 }, loanTypeSpecific: false as const },
  { featureName: 'lockExpirationDaysRemaining', fieldName: 'lockExpirationDaysRemaining', higherIsWorse: false, microBinSize: 7, clamp: {} as Record<string, number>, loanTypeSpecific: false as const },
  { featureName: 'loPullthroughPercentage', fieldName: 'loPullthroughPercentage', higherIsWorse: false, microBinSize: 5, clamp: {} as Record<string, number>, loanTypeSpecific: false as const },
  { featureName: 'uwPullthroughPercentage', fieldName: 'uwPullthroughPercentage', higherIsWorse: false, microBinSize: 5, clamp: {} as Record<string, number>, loanTypeSpecific: false as const },
  { featureName: 'closerPullthroughPercentage', fieldName: 'closerPullthroughPercentage', higherIsWorse: false, microBinSize: 5, clamp: {} as Record<string, number>, loanTypeSpecific: false as const },
  { featureName: 'processorPullthroughPercentage', fieldName: 'processorPullthroughPercentage', higherIsWorse: false, microBinSize: 5, clamp: {} as Record<string, number>, loanTypeSpecific: false as const },
];

const DYNAMIC_NUMERIC_FEATURES = [...CREDIT_FEATURES, ...GLOBAL_FEATURES];

function getDtiValue(loan: any): number | null {
  let value = loan.be_dti_ratio ?? loan.dti;
  if (value != null && !isNaN(Number(value))) return Number(value);
  const raw = loan.raw_data;
  const rd = typeof raw === 'string' ? (() => { try { return JSON.parse(raw); } catch { return null; } })() : raw;
  if (rd && typeof rd === 'object') {
    value = rd.dti ?? rd.dti_ratio ?? rd['BE DTI Ratio'] ?? rd['DTI Ratio'] ?? null;
    if (value != null && !isNaN(Number(value))) return Number(value);
  }
  return null;
}

function getLockExpirationDaysRemaining(loan: any): number | null {
  const lockExp = loan.lockExpirationDate ?? loan.lock_expiration_date;
  if (!lockExp) return null;
  const expDate = new Date(lockExp);
  if (isNaN(expDate.getTime())) return null;
  const refDate = (() => {
    const d = loan.fundDate ?? loan.fund_date ?? loan.closingDate ?? loan.closing_date ?? loan.uwDeniedDate ?? (loan as any).uw_denied_date ?? loan.lastModifiedDate ?? (loan as any).last_modified_date;
    return d ? new Date(d) : new Date();
  })();
  const days = Math.floor((expDate.getTime() - refDate.getTime()) / (1000 * 60 * 60 * 24));
  return days;
}

function getFeatureValue(loan: any, fieldName: string): number | null {
  if (fieldName === 'be_dti_ratio') return getDtiValue(loan);
  if (fieldName === 'lockExpirationDaysRemaining') return getLockExpirationDaysRemaining(loan);
  const raw = loan[fieldName]
    ?? loan[fieldName === 'ficoScore' ? 'fico_score' : fieldName === 'loanAmount' ? 'loan_amount' : fieldName]
    ?? (fieldName === 'loPullthroughPercentage' ? (loan as any).lo_pullthrough_percentage : undefined)
    ?? (fieldName === 'uwPullthroughPercentage' ? (loan as any).uw_pullthrough_percentage : undefined)
    ?? (fieldName === 'closerPullthroughPercentage' ? (loan as any).closer_pullthrough_percentage : undefined)
    ?? (fieldName === 'processorPullthroughPercentage' ? (loan as any).processor_pullthrough_percentage : undefined);
  if (raw == null || raw === '') return null;
  const n = typeof raw === 'string' ? parseFloat(raw) : Number(raw);
  if (isNaN(n)) return null;
  if (fieldName === 'be_dti_ratio' && (n < 0 || n > 200)) return null;
  if ((fieldName === 'loPullthroughPercentage' || fieldName === 'uwPullthroughPercentage' || fieldName === 'closerPullthroughPercentage' || fieldName === 'processorPullthroughPercentage') && (n < 0 || n > 100)) return null;
  return n;
}

/**
 * Calculate numeric bucket thresholds for one feature and one loan type category.
 * Fallout = withdraw or deny (single rate).
 * When explicitConfig is provided, higherIsWorse (and microBinSize, clamp) are taken from it — no auto-detect.
 * So: higherIsWorse true = higher value → bucket 6 (worse); false = lower value → bucket 6 (worse).
 */
export function calculateNumericThresholds(
  loans: any[],
  featureField: string,
  loanTypeCategory: LoanTypeCategory | 'All',
  explicitConfig?: { higherIsWorse: boolean; microBinSize: number; clamp: Record<string, number> }
): NumericThreshold[] | null {
  const dataPoints: { value: number; rate: number }[] = [];
  for (const loan of loans) {
    const value = getFeatureValue(loan, featureField);
    if (value === null) continue;
    const actualOutcome = loan.actualOutcome;
    if (!actualOutcome) continue;
    dataPoints.push({
      value,
      rate: actualOutcome === 'withdraw' || actualOutcome === 'deny' ? 1 : 0,
    });
  }

  if (dataPoints.length < MIN_TOTAL_LOANS_FOR_CALCULATION) return null;

  const configFromList = DYNAMIC_NUMERIC_FEATURES.find((c) => c.fieldName === featureField);
  const config = explicitConfig ?? (configFromList ? {
    higherIsWorse: configFromList.higherIsWorse,
    microBinSize: configFromList.microBinSize,
    clamp: configFromList.clamp as Record<string, number>,
  } : { higherIsWorse: true, microBinSize: 10, clamp: {} });

  const sorted = [...dataPoints].sort((a, b) => a.value - b.value);
  const n = sorted.length;
  const quintileSize = Math.max(1, Math.floor(n * 0.2));
  const bottomRate = sorted.slice(0, quintileSize).reduce((s, p) => s + p.rate, 0) / quintileSize;
  const topRate = sorted.slice(n - quintileSize).reduce((s, p) => s + p.rate, 0) / quintileSize;
  const higherIsWorse = explicitConfig || configFromList
    ? config.higherIsWorse
    : (Math.abs(topRate - bottomRate) > 0.01 ? topRate > bottomRate : config.higherIsWorse);

  const bins = microBin(dataPoints, config.microBinSize, higherIsWorse);
  if (bins.length < 2) return null;
  const rates = bins.map((b) => b.rate);
  const smoothedRates = smooth(rates);
  const cutPoints = quantileCutPoints(bins, smoothedRates);
  const thresholds = buildRanges(cutPoints, dataPoints, higherIsWorse, config.clamp);
  return thresholds;
}

function microBin(
  points: Array<{ value: number; rate: number }>,
  binSize: number,
  higherIsWorse: boolean
): Array<{ valueMin: number; valueMax: number; total: number; rateSum: number; rate: number }> {
  if (points.length === 0) return [];
  const getBinKey = (v: number) => Math.floor(v / binSize) * binSize;
  const bins = new Map<number, { total: number; rateSum: number }>();
  for (const { value, rate } of points) {
    const key = getBinKey(value);
    if (!bins.has(key)) bins.set(key, { total: 0, rateSum: 0 });
    const b = bins.get(key)!;
    b.total += 1;
    b.rateSum += rate;
  }
  return Array.from(bins.entries())
    .filter(([, b]) => b.total >= MIN_BIN_LOANS)
    .map(([key, b]) => ({
      valueMin: key,
      valueMax: key + binSize,
      total: b.total,
      rateSum: b.rateSum,
      rate: b.total > 0 ? b.rateSum / b.total : 0,
    }))
    .sort((a, b) => (higherIsWorse ? a.valueMin - b.valueMin : b.valueMin - a.valueMin));
}

function smooth(rates: number[]): number[] {
  if (rates.length === 0) return [];
  const out: number[] = [];
  for (let i = 0; i < rates.length; i++) {
    const left = Math.max(0, i - 1);
    const right = Math.min(rates.length - 1, i + 1);
    const slice = rates.slice(left, right + 1);
    out.push(slice.reduce((s, r) => s + r, 0) / slice.length);
  }
  return out;
}

function quantileCutPoints(
  bins: Array<{ valueMin: number; valueMax: number; total: number; rate: number }>,
  _smoothedRates: number[]
): number[] {
  const totalLoans = bins.reduce((s, b) => s + b.total, 0);
  if (totalLoans === 0) return [];
  const cutPoints: number[] = [];
  let cum = 0;
  let binIdx = 0;
  for (const target of QUANTILE_TARGETS) {
    const need = target * totalLoans;
    while (binIdx < bins.length && cum + bins[binIdx].total < need) {
      cum += bins[binIdx].total;
      binIdx++;
    }
    if (binIdx < bins.length) cutPoints.push(bins[binIdx].valueMin);
    else if (bins.length > 0) cutPoints.push(bins[bins.length - 1].valueMax);
  }
  return cutPoints;
}

function assignBucketFromRanges(value: number, ranges: NumericThreshold[]): number {
  for (const r of ranges) {
    const min = r.min ?? -Infinity;
    const max = r.max ?? Infinity;
    if (value >= min && (r.max == null || value < max)) return r.bucket;
    if (r.max == null && value >= min) return r.bucket;
  }
  return 6;
}

function buildRanges(
  cutPoints: number[],
  points: Array<{ value: number; rate: number }>,
  higherIsWorse: boolean,
  clamp: { bucket1Max?: number; bucket6Min?: number; bucket1Min?: number; bucket6Max?: number }
): NumericThreshold[] {
  const sorted = [...new Set(cutPoints)].sort((a, b) => a - b);
  while (sorted.length < 5) sorted.push((sorted[sorted.length - 1] ?? 0) + 1);
  const bounds = sorted.slice(0, 5);

  let ranges: NumericThreshold[];
  if (higherIsWorse) {
    ranges = [
      { min: null, max: bounds[0], bucket: 1 },
      { min: bounds[0], max: bounds[1], bucket: 2 },
      { min: bounds[1], max: bounds[2], bucket: 3 },
      { min: bounds[2], max: bounds[3], bucket: 4 },
      { min: bounds[3], max: bounds[4], bucket: 5 },
      { min: bounds[4], max: null, bucket: 6 },
    ];
  } else {
    ranges = [
      { min: bounds[4], max: null, bucket: 1 },
      { min: bounds[3], max: bounds[4], bucket: 2 },
      { min: bounds[2], max: bounds[3], bucket: 3 },
      { min: bounds[1], max: bounds[2], bucket: 4 },
      { min: bounds[0], max: bounds[1], bucket: 5 },
      { min: null, max: bounds[0], bucket: 6 },
    ];
  }

  const totalPts = points.length;
  const minSize = Math.max(1, Math.floor(totalPts * MIN_BUCKET_PCT));
  const bucketLoans: Record<number, Array<{ value: number; rate: number }>> = { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
  for (const p of points) {
    const b = assignBucketFromRanges(p.value, ranges);
    bucketLoans[b].push(p);
  }

  for (let b = 1; b <= 6; b++) {
    if (bucketLoans[b].length >= minSize || bucketLoans[b].length === 0) continue;
    const rate = bucketLoans[b].length > 0 ? bucketLoans[b].reduce((s, p) => s + p.rate, 0) / bucketLoans[b].length : 0;
    const nextRate = b < 6 && bucketLoans[b + 1].length > 0 ? bucketLoans[b + 1].reduce((s, p) => s + p.rate, 0) / bucketLoans[b + 1].length : Infinity;
    const prevRate = b > 1 && bucketLoans[b - 1].length > 0 ? bucketLoans[b - 1].reduce((s, p) => s + p.rate, 0) / bucketLoans[b - 1].length : Infinity;
    const mergeInto = Math.abs(nextRate - rate) <= Math.abs(prevRate - rate) ? b + 1 : b - 1;
    if (mergeInto >= 1 && mergeInto <= 6) {
      bucketLoans[mergeInto].push(...bucketLoans[b]);
      bucketLoans[b] = [];
    }
  }

  const dataRange = totalPts > 0 ? Math.max(...points.map((p) => p.value)) - Math.min(...points.map((p) => p.value)) : 1;
  const emptyStep = Math.max(1, dataRange * 0.005);
  const bucketBounds: Array<{ min: number; max: number; rate: number }> = [];
  for (let b = 1; b <= 6; b++) {
    const arr = bucketLoans[b];
    if (arr.length === 0) {
      const prev = bucketBounds[bucketBounds.length - 1];
      bucketBounds.push({ min: prev ? prev.max : -Infinity, max: prev ? prev.max + emptyStep : 0, rate: 0 });
      continue;
    }
    const vals = arr.map((p) => p.value).sort((a, b) => a - b);
    bucketBounds.push({ min: vals[0], max: vals[vals.length - 1], rate: arr.reduce((s, p) => s + p.rate, 0) / arr.length });
  }

  for (let pass = 0; pass < 30; pass++) {
    let violated = false;
    for (let i = 0; i < 5; i++) {
      const bIdx = i + 1;
      if (bucketBounds[i].rate > bucketBounds[i + 1].rate) {
        violated = true;
        const merged = [...bucketLoans[bIdx], ...bucketLoans[bIdx + 1]];
        if (merged.length === 0) break;
        const sortedMerged = merged.slice().sort((a, b) => a.value - b.value);
        const bestSplitIdx = Math.floor(sortedMerged.length / 2);
        const low = sortedMerged.slice(0, bestSplitIdx);
        const high = sortedMerged.slice(bestSplitIdx);
        const lowRate = low.length ? low.reduce((s, p) => s + p.rate, 0) / low.length : 0;
        const highRate = high.length ? high.reduce((s, p) => s + p.rate, 0) / high.length : 0;
        const splitVal = high.length ? high[0].value : (low.length ? low[low.length - 1].value : 0);
        if (higherIsWorse) {
          bucketLoans[bIdx] = low;
          bucketLoans[bIdx + 1] = high;
          bucketBounds[i] = { min: low.length ? Math.min(...low.map((p) => p.value)) : bucketBounds[i].min, max: splitVal, rate: lowRate };
          bucketBounds[i + 1] = { min: splitVal, max: high.length ? Math.max(...high.map((p) => p.value)) : bucketBounds[i + 1].max, rate: highRate };
        } else {
          bucketLoans[bIdx] = high;
          bucketLoans[bIdx + 1] = low;
          bucketBounds[i] = { min: high.length ? Math.min(...high.map((p) => p.value)) : bucketBounds[i].min, max: high.length ? Math.max(...high.map((p) => p.value)) : bucketBounds[i].max, rate: highRate };
          bucketBounds[i + 1] = { min: low.length ? Math.min(...low.map((p) => p.value)) : bucketBounds[i + 1].min, max: low.length ? Math.max(...low.map((p) => p.value)) : bucketBounds[i + 1].max, rate: lowRate };
        }
        break;
      }
    }
    if (!violated) break;
  }

  let cuts: number[] = [
    bucketBounds[0]?.max ?? -Infinity,
    bucketBounds[1]?.max ?? -Infinity,
    bucketBounds[2]?.max ?? -Infinity,
    bucketBounds[3]?.max ?? -Infinity,
    bucketBounds[4]?.max ?? -Infinity,
  ]
    .filter((x) => x !== -Infinity && Number.isFinite(x))
    .filter((x, i, a) => a.indexOf(x) === i)
    .sort((a, b) => a - b);
  while (cuts.length < 5) cuts.push((cuts[cuts.length - 1] ?? 0) + 1);
  cuts = cuts.slice(0, 5);

  const scale = Math.max(1, Math.abs(cuts[0] ?? 0), Math.abs(cuts[4] ?? 0));
  const epsilon = scale >= 1 ? 1 : Math.max(1e-6, scale / 1e6);
  const minGap = Math.max(epsilon, scale * 0.005);
  for (let i = 1; i < cuts.length; i++) {
    if (cuts[i]! <= cuts[i - 1]!) cuts[i] = cuts[i - 1]! + minGap;
  }
  const c = clamp as Record<string, number | undefined>;
  if (higherIsWorse) {
    if (c.bucket1Max != null && cuts[0]! > c.bucket1Max) cuts[0] = c.bucket1Max;
    if (c.bucket6Min != null && cuts[4]! < c.bucket6Min) cuts[4] = c.bucket6Min;
  } else {
    if (c.bucket1Min != null && cuts[4]! < c.bucket1Min) cuts[4] = c.bucket1Min;
    if (c.bucket6Max != null && cuts[0]! > c.bucket6Max) cuts[0] = c.bucket6Max;
  }
  for (let i = 1; i < cuts.length; i++) {
    if (cuts[i]! <= cuts[i - 1]!) cuts[i] = cuts[i - 1]! + minGap;
  }

  const valuesSorted = points.map((p) => p.value).sort((a, b) => a - b);
  const nPts = valuesSorted.length;
  if (nPts >= minSize) {
    if (higherIsWorse) {
      const count1 = points.filter((p) => p.value < cuts[0]!).length;
      const count6 = points.filter((p) => p.value >= cuts[4]!).length;
      if (count1 < minSize) {
        const bound = valuesSorted[Math.min(minSize - 1, nPts - 1)]!;
        cuts[0] = Math.max(cuts[0]!, bound + minGap);
        if (cuts[0]! >= cuts[1]!) cuts[0] = cuts[1]! - minGap;
      }
      if (count6 < minSize) {
        const bound = valuesSorted[Math.max(0, nPts - minSize)]!;
        cuts[4] = Math.min(cuts[4]!, bound);
        if (cuts[4]! <= cuts[3]!) cuts[4] = cuts[3]! + minGap;
      }
    } else {
      const count1 = points.filter((p) => p.value >= cuts[4]!).length;
      const count6 = points.filter((p) => p.value < cuts[0]!).length;
      if (count1 < minSize) {
        const bound = valuesSorted[Math.max(0, nPts - minSize)]!;
        cuts[4] = Math.min(cuts[4]!, bound);
        if (cuts[4]! <= cuts[3]!) cuts[4] = cuts[3]! + minGap;
      }
      if (count6 < minSize) {
        const bound = valuesSorted[Math.min(minSize - 1, nPts - 1)]!;
        cuts[0] = Math.max(cuts[0]!, bound + minGap);
        if (cuts[0]! >= cuts[1]!) cuts[0] = cuts[1]! - minGap;
      }
    }
    for (let i = 1; i < cuts.length; i++) {
      if (cuts[i]! <= cuts[i - 1]!) cuts[i] = cuts[i - 1]! + minGap;
    }
    if (higherIsWorse) {
      if (c.bucket1Max != null && cuts[0]! > c.bucket1Max) cuts[0] = c.bucket1Max;
      if (c.bucket6Min != null && cuts[4]! < c.bucket6Min) cuts[4] = c.bucket6Min;
    } else {
      if (c.bucket1Min != null && cuts[4]! < c.bucket1Min) cuts[4] = c.bucket1Min;
      if (c.bucket6Max != null && cuts[0]! > c.bucket6Max) cuts[0] = c.bucket6Max;
    }
    for (let i = 1; i < cuts.length; i++) {
      if (cuts[i]! <= cuts[i - 1]!) cuts[i] = cuts[i - 1]! + minGap;
    }
  }

  if (higherIsWorse) {
    return [
      { min: null, max: cuts[0], bucket: 1 },
      { min: cuts[0], max: cuts[1], bucket: 2 },
      { min: cuts[1], max: cuts[2], bucket: 3 },
      { min: cuts[2], max: cuts[3], bucket: 4 },
      { min: cuts[3], max: cuts[4], bucket: 5 },
      { min: cuts[4], max: null, bucket: 6 },
    ];
  }
  return [
    { min: cuts[4], max: null, bucket: 1 },
    { min: cuts[3], max: cuts[4], bucket: 2 },
    { min: cuts[2], max: cuts[3], bucket: 3 },
    { min: cuts[1], max: cuts[2], bucket: 4 },
    { min: cuts[0], max: cuts[1], bucket: 5 },
    { min: null, max: cuts[0], bucket: 6 },
  ];
}

/** Assign value to bucket 1-6 using threshold ranges. */
export function bucketValueWithRanges(value: number, ranges: NumericThreshold[]): number {
  return assignBucketFromRanges(value, ranges);
}

// ─── Cache ───────────────────────────────────────────────────────────────────

export async function saveThresholds(entry: ThresholdCacheEntry, dbPool: pg.Pool): Promise<void> {
  try {
    await dbPool.query(
      `INSERT INTO public.bucket_thresholds_cache (feature_name, loan_type, threshold_data, sample_size, calculated_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (feature_name, loan_type)
       DO UPDATE SET threshold_data = $3, sample_size = $4, calculated_at = NOW()`,
      [entry.featureName, entry.loanType, JSON.stringify(entry.thresholdData), entry.sampleSize]
    );
  } catch (err: unknown) {
    logError('Failed to cache bucket thresholds', err as Error, { feature: entry.featureName, loanType: entry.loanType });
  }
}

/** Load all cached credit thresholds. Key: "featureName|loanType" e.g. "ficoScore|Government". */
export async function getAllCachedThresholds(dbPool: pg.Pool): Promise<Map<string, NumericThreshold[]>> {
  const map = new Map<string, NumericThreshold[]>();
  try {
    const result = await dbPool.query(
      `SELECT feature_name, loan_type, threshold_data, sample_size, calculated_at FROM public.bucket_thresholds_cache`
    );
    for (const row of result.rows) {
      const key = `${row.feature_name}|${row.loan_type}`;
      const data = typeof row.threshold_data === 'string' ? JSON.parse(row.threshold_data) : row.threshold_data;
      map.set(key, Array.isArray(data) ? data : []);
    }
  } catch {
    // Table may not exist
  }
  return map;
}

/**
 * Calculate and cache thresholds for all dynamic numeric features.
 * Credit features (FICO, LTV, DTI): per loan type (Conventional, Government).
 * Global features (loan amount, active days, lock expiration, pullthroughs): single set for all loans (loan_type = 'All').
 * higherIsWorse from config: true = higher value → bucket 6 (worse); false = lower value → bucket 6 (worse).
 */
export async function calculateAndCacheAllThresholds(
  historicalLoansWithOutcomes: any[],
  dbPool: pg.Pool
): Promise<Map<string, NumericThreshold[]>> {
  const results = new Map<string, NumericThreshold[]>();
  const explicitConfig = (f: typeof DYNAMIC_NUMERIC_FEATURES[number]) => ({
    higherIsWorse: f.higherIsWorse,
    microBinSize: f.microBinSize,
    clamp: f.clamp as Record<string, number>,
  });

  for (const feature of DYNAMIC_NUMERIC_FEATURES) {
    if (feature.loanTypeSpecific) {
      for (const loanType of ['Conventional', 'Government'] as const) {
        const filtered = historicalLoansWithOutcomes.filter((loan) => getLoanTypeCategory(loan.loanType || loan.loan_type) === loanType);
        const thresholds = calculateNumericThresholds(filtered, feature.fieldName, loanType, explicitConfig(feature));
        if (thresholds) {
          const key = `${feature.featureName}|${loanType}`;
          results.set(key, thresholds);
          await saveThresholds(
            { featureName: feature.featureName, loanType, thresholdData: thresholds, sampleSize: filtered.length, calculatedAt: new Date() },
            dbPool
          );
        }
      }
    } else {
      const thresholds = calculateNumericThresholds(historicalLoansWithOutcomes, feature.fieldName, 'All', explicitConfig(feature));
      if (thresholds) {
        const key = `${feature.featureName}|All`;
        results.set(key, thresholds);
        await saveThresholds(
          { featureName: feature.featureName, loanType: 'All', thresholdData: thresholds, sampleSize: historicalLoansWithOutcomes.length, calculatedAt: new Date() },
          dbPool
        );
      }
    }
  }

  logInfo('[ThresholdCalc] Dynamic thresholds calculated', { keys: Array.from(results.keys()), historicalCount: historicalLoansWithOutcomes.length });

  // Terminal log: bucket threshold ranges (value ranges that map to buckets 1-6)
  const threshLines: string[] = [
    '',
    '——— Bucket threshold calculations (dynamic numeric features) ———',
    '  Feature     | Loan type     | Sample  | Bucket 1      | Bucket 2      | Bucket 3      | Bucket 4      | Bucket 5      | Bucket 6',
    '  ------------|---------------|---------|----------------|----------------|----------------|----------------|----------------|----------------',
  ];
  for (const key of Array.from(results.keys()).sort()) {
    const thresholds = results.get(key)!;
    const [feature, loanType] = key.split('|');
    const sampleEntry = loanType === 'All'
      ? historicalLoansWithOutcomes.length
      : historicalLoansWithOutcomes.filter((l) => getLoanTypeCategory(l.loanType ?? l.loan_type) === loanType).length;
    const sorted = [...thresholds].sort((a, b) => a.bucket - b.bucket);
    const rangeStr = (r: NumericThreshold) => {
      const lo = r.min == null ? '−∞' : r.min.toFixed(1);
      const hi = r.max == null ? '∞' : r.max.toFixed(1);
      return `${lo}–${hi}`;
    };
    const b1 = sorted.find((r) => r.bucket === 1);
    const b2 = sorted.find((r) => r.bucket === 2);
    const b3 = sorted.find((r) => r.bucket === 3);
    const b4 = sorted.find((r) => r.bucket === 4);
    const b5 = sorted.find((r) => r.bucket === 5);
    const b6 = sorted.find((r) => r.bucket === 6);
    threshLines.push(
      `  ${(feature || key).padEnd(11)} | ${(loanType || '').padEnd(13)} | ${String(sampleEntry).padEnd(7)} | ${(b1 ? rangeStr(b1) : '—').padEnd(14)} | ${(b2 ? rangeStr(b2) : '—').padEnd(14)} | ${(b3 ? rangeStr(b3) : '—').padEnd(14)} | ${(b4 ? rangeStr(b4) : '—').padEnd(14)} | ${(b5 ? rangeStr(b5) : '—').padEnd(14)} | ${b6 ? rangeStr(b6) : '—'}`,
    );
  }
  threshLines.push('————————————————————————————————————————————————————————————————————————————————————————————————————————————————————————————');
  // eslint-disable-next-line no-console
  console.log(threshLines.join('\n'));

  return results;
}
