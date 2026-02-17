/**
 * Segment Fallout Rate Service
 *
 * Computes per-segment (loan_type | loan_purpose | occupancy) historical fallout rates
 * (withdrawn %, denied %, combined fallout %) from the same historical loan set as the
 * outcome profiles. Used only for the Loan Characteristics signal bucket (1–6); does not
 * affect prediction. Bucket = rank-based: segments ordered by the relevant rate (denied %
 * for predicted deny, withdrawn % for predicted withdraw, fallout % for predicted
 * originate); top 1/6 → bucket 6, next 1/6 → bucket 5, … bottom 1/6 → bucket 1.
 *
 * Fallback: if a segment has ≤10 loans, use type|purpose|All, then type|All|All, then
 * All|All|All (same logic as outcome profiles).
 */

import type pg from 'pg';
import { loadHistoricalLoans, classifyStatus, norm, type SegmentKey } from './numericOutcomeProfileService.js';
import { logInfo } from '../logger.js';

const MIN_SAMPLE_SIZE = 10;

type SegmentCounts = { total: number; denied: number; withdrawn: number };

function segmentKeyStr(s: SegmentKey): string {
  return `${s.loan_type}|${s.loan_purpose}|${s.occupancy}`;
}

function parseSegmentKeyStr(key: string): SegmentKey {
  const [loan_type, loan_purpose, occupancy] = key.split('|');
  return {
    loan_type: loan_type ?? 'Unknown',
    loan_purpose: loan_purpose ?? 'Unknown',
    occupancy: occupancy ?? 'Unknown',
  };
}

/**
 * Aggregate historical rows by segment: total, denied, withdrawn.
 * Same classification as outcome profiles (Denied, Withdrawn, Originated/ClosingLate/FundedOnTime).
 */
function getSegmentCounts(rows: any[]): Map<string, SegmentCounts> {
  const map = new Map<string, SegmentCounts>();
  for (const row of rows) {
    const status = classifyStatus(row);
    if (status == null) continue;
    const segment: SegmentKey = {
      loan_type: norm(row.loan_type),
      loan_purpose: norm(row.loan_purpose),
      occupancy: norm(row.occupancy_type),
    };
    const key = segmentKeyStr(segment);
    const cur = map.get(key) ?? { total: 0, denied: 0, withdrawn: 0 };
    cur.total += 1;
    if (status === 'Denied') cur.denied += 1;
    else if (status === 'Withdrawn') cur.withdrawn += 1;
    map.set(key, cur);
  }
  return map;
}

type SegmentRates = { denied_pct: number; withdrawn_pct: number; fallout_pct: number };

/**
 * Resolve rates per segment with fallback: if segment has ≤10 loans, use type|purpose|All,
 * then type|All|All, then All|All|All (first segment with total >= MIN_SAMPLE_SIZE, or All|All|All).
 */
function resolveRatesWithFallback(counts: Map<string, SegmentCounts>): Map<string, SegmentRates> {
  const rates = new Map<string, SegmentRates>();

  function ratesFor(total: number, denied: number, withdrawn: number): SegmentRates {
    const fallouts = denied + withdrawn;
    return {
      denied_pct: total > 0 ? (denied / total) * 100 : 0,
      withdrawn_pct: total > 0 ? (withdrawn / total) * 100 : 0,
      fallout_pct: total > 0 ? (fallouts / total) * 100 : 0,
    };
  }

  const allKey = 'All|All|All';
  const allCount: SegmentCounts = { total: 0, denied: 0, withdrawn: 0 };
  for (const c of counts.values()) {
    allCount.total += c.total;
    allCount.denied += c.denied;
    allCount.withdrawn += c.withdrawn;
  }
  rates.set(allKey, ratesFor(allCount.total, allCount.denied, allCount.withdrawn));

  for (const [key, c] of counts.entries()) {
    let total = c.total;
    let denied = c.denied;
    let withdrawn = c.withdrawn;
    if (total < MIN_SAMPLE_SIZE) {
      const seg = parseSegmentKeyStr(key);
      // type | purpose | All
      const typePurposeAll = `${seg.loan_type}|${seg.loan_purpose}|All`;
      const c1 = counts.get(typePurposeAll);
      if (c1 && c1.total >= MIN_SAMPLE_SIZE) {
        total = c1.total;
        denied = c1.denied;
        withdrawn = c1.withdrawn;
      } else {
        // type | All | All
        const typeAll = `${seg.loan_type}|All|All`;
        const c2 = counts.get(typeAll);
        if (c2 && c2.total >= MIN_SAMPLE_SIZE) {
          total = c2.total;
          denied = c2.denied;
          withdrawn = c2.withdrawn;
        } else {
          total = allCount.total;
          denied = allCount.denied;
          withdrawn = allCount.withdrawn;
        }
      }
    }
    rates.set(key, ratesFor(total, denied, withdrawn));
  }

  return rates;
}

/**
 * Build rank-based bucket lookup. Segments sorted by rate desc; rank 1 = worst (highest %).
 * Bucket 6 = top 1/6 of segments, bucket 5 = next 1/6, … bucket 1 = bottom 1/6.
 */
function buildBucketLookup(
  ratesMap: Map<string, SegmentRates>
): (segment: SegmentKey, predictedOutcome: 'deny' | 'withdraw' | 'originate') => number {
  const keys = Array.from(ratesMap.keys());
  const n = Math.max(1, keys.length);
  const bucketSize = Math.ceil(n / 6);

  function rankToBucket(rank: number): number {
    if (rank < 1) return 1;
    const b = 6 - Math.floor((rank - 1) / bucketSize);
    return Math.max(1, Math.min(6, b));
  }

  // Sort by denied_pct desc -> rank 1 = highest denied %
  const byDenied = [...keys].sort(
    (a, b) => (ratesMap.get(b)!.denied_pct ?? 0) - (ratesMap.get(a)!.denied_pct ?? 0)
  );
  const byWithdrawn = [...keys].sort(
    (a, b) => (ratesMap.get(b)!.withdrawn_pct ?? 0) - (ratesMap.get(a)!.withdrawn_pct ?? 0)
  );
  const byFallout = [...keys].sort(
    (a, b) => (ratesMap.get(b)!.fallout_pct ?? 0) - (ratesMap.get(a)!.fallout_pct ?? 0)
  );

  const rankByDenied = new Map<string, number>();
  const rankByWithdrawn = new Map<string, number>();
  const rankByFallout = new Map<string, number>();
  byDenied.forEach((k, i) => rankByDenied.set(k, i + 1));
  byWithdrawn.forEach((k, i) => rankByWithdrawn.set(k, i + 1));
  byFallout.forEach((k, i) => rankByFallout.set(k, i + 1));

  // Terminal log: Loan Characteristic fallout percentages and buckets per segment
  const pad = (s: string, len: number) => (s ?? '').toString().slice(0, len).padEnd(len);
  // eslint-disable-next-line no-console
  console.log('\n[Segment Fallout Rates] Loan Characteristics — fallout % and buckets by segment (1=best, 6=worst)');
  // eslint-disable-next-line no-console
  console.log('─'.repeat(120));
  // eslint-disable-next-line no-console
  console.log(
    `${pad('Segment (type|purpose|occupancy)', 42)} | ${pad('Denied %', 8)} | ${pad('Withdrawn %', 10)} | ${pad('Fallout %', 9)} | B(deny) B(wdraw) B(orig)`
  );
  // eslint-disable-next-line no-console
  console.log('─'.repeat(120));
  const keysForLog = [...keys].sort((a, b) => (ratesMap.get(b)!.fallout_pct ?? 0) - (ratesMap.get(a)!.fallout_pct ?? 0));
  for (const key of keysForLog) {
    const r = ratesMap.get(key)!;
    const bDeny = rankToBucket(rankByDenied.get(key) ?? n);
    const bWithdraw = rankToBucket(rankByWithdrawn.get(key) ?? n);
    const bOrig = rankToBucket(rankByFallout.get(key) ?? n);
    // eslint-disable-next-line no-console
    console.log(
      `${pad(key, 42)} | ${pad(r.denied_pct.toFixed(1), 8)} | ${pad(r.withdrawn_pct.toFixed(1), 10)} | ${pad(r.fallout_pct.toFixed(1), 9)} | ${bDeny}        ${bWithdraw}        ${bOrig}`
    );
  }
  // eslint-disable-next-line no-console
  console.log('─'.repeat(120) + '\n');

  /**
   * Resolve segment to a key that exists in ratesMap (with fallback).
   */
  function resolveKey(segment: SegmentKey): string {
    const key = segmentKeyStr(segment);
    if (ratesMap.has(key)) return key;
    const typePurposeAll = `${segment.loan_type}|${segment.loan_purpose}|All`;
    if (ratesMap.has(typePurposeAll)) return typePurposeAll;
    const typeAll = `${segment.loan_type}|All|All`;
    if (ratesMap.has(typeAll)) return typeAll;
    return 'All|All|All';
  }

  return (segment: SegmentKey, predictedOutcome: 'deny' | 'withdraw' | 'originate'): number => {
    const key = resolveKey(segment);
    const rank =
      predictedOutcome === 'deny'
        ? rankByDenied.get(key) ?? n
        : predictedOutcome === 'withdraw'
          ? rankByWithdrawn.get(key) ?? n
          : rankByFallout.get(key) ?? n;
    return rankToBucket(rank);
  };
}

/**
 * Run segment fallout rate derivation and return a function that returns Loan Characteristics
 * bucket (1–6) for a given segment and predicted outcome. Use same historical loan set as
 * outcome profiles. Does not affect prediction.
 */
export async function runSegmentFalloutRates(
  pool: pg.Pool
): Promise<(segment: SegmentKey, predictedOutcome: 'deny' | 'withdraw' | 'originate') => number> {
  const rows = await loadHistoricalLoans(pool);
  const counts = getSegmentCounts(rows);
  const ratesMap = resolveRatesWithFallback(counts);
  const getBucket = buildBucketLookup(ratesMap);
  logInfo('[SegmentFalloutRates] Built bucket lookup', {
    segmentCount: counts.size,
    historicalLoans: rows.length,
  });
  return getBucket;
}
