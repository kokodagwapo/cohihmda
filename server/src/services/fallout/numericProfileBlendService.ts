/**
 * Numeric Profile Blend Service
 *
 * Loads outcome_numeric_risk_profiles from DB (year >= 2023 to filter date range only).
 * Profiles are stored per recency bucket (≤180 days, >180 days). This service merges the two
 * buckets with recency weights (1.2 and 1.0) into one profile per (status_type, segment, feature).
 * No yearly grouping or averaging. Used on every Predict run; no persistence of blend.
 */

import pg from 'pg';
import type { FalloutStatusType, OutcomeProfileStatusType } from './falloutTypes.js';
import type { BlendedFeatureStats, BlendedProfileMap } from './falloutTypes.js';

const START_YEAR = 2023;

/** Weight for <=180 days recency bucket when merging with >180 days (recent = 1.2, older = 1.0). */
const RECENCY_WEIGHT_RECENT = 1.2;
const RECENCY_WEIGHT_OLDER = 1.0;

function segmentKey(loan_type: string, loan_purpose: string, occupancy: string): string {
  return `${loan_type}|${loan_purpose}|${occupancy}`;
}

type ProfileRow = {
  year: number;
  status_type: OutcomeProfileStatusType;
  loan_type: string;
  loan_purpose: string;
  occupancy: string;
  feature_name: string;
  recency_bucket: string | null;
  mean_value: number | null;
  q1_value: number | null;
  q3_value: number | null;
  iqr_value: number | null;
  p10_value: number | null;
  p20_value: number | null;
  p30_value: number | null;
  p15_value: number | null;
  p40_value: number | null;
  p45_value: number | null;
  p55_value: number | null;
  p60_value: number | null;
  p65_value: number | null;
  p70_value: number | null;
  p35_value: number | null;
  p75_value: number | null;
  p80_value: number | null;
  p90_value: number | null;
};

/**
 * Load profile rows from DB (year >= 2023 for date range only; no year-based weighting).
 */
async function loadProfiles(pool: pg.Pool): Promise<ProfileRow[]> {
  const currentYear = new Date().getFullYear();
  let result: { rows: any[] };
  try {
    result = await pool.query(
      `SELECT year, status_type, loan_type, loan_purpose, occupancy, feature_name, recency_bucket, mean_value, q1_value, q3_value, iqr_value,
              p10_value, p15_value, p20_value, p30_value, p35_value, p40_value, p45_value, p55_value, p60_value, p65_value, p70_value, p75_value, p80_value, p90_value
       FROM public.outcome_numeric_risk_profiles
       WHERE year >= $1 AND year <= $2
       ORDER BY year DESC`,
      [START_YEAR, currentYear]
    );
  } catch {
    // recency_bucket or p15/p35/p55/p75 columns may not exist yet; load without and use nulls
    result = await pool.query(
      `SELECT year, status_type, loan_type, loan_purpose, occupancy, feature_name, mean_value, q1_value, q3_value, iqr_value,
              p10_value, p20_value, p30_value, p40_value, p45_value, p60_value, p65_value, p70_value, p80_value, p90_value
       FROM public.outcome_numeric_risk_profiles
       WHERE year >= $1 AND year <= $2
       ORDER BY year DESC`,
      [START_YEAR, currentYear]
    );
    for (const r of result.rows) {
      (r as any).recency_bucket = '>180 days';
      (r as any).p15_value = null;
      (r as any).p35_value = null;
      (r as any).p55_value = null;
      (r as any).p75_value = null;
    }
  }
  return result.rows.map((r) => ({
    year: Number(r.year),
    status_type: r.status_type as OutcomeProfileStatusType,
    loan_type: r.loan_type,
    loan_purpose: r.loan_purpose,
    occupancy: r.occupancy,
    feature_name: r.feature_name,
    recency_bucket: r.recency_bucket != null ? String(r.recency_bucket) : null,
    mean_value: r.mean_value != null ? Number(r.mean_value) : null,
    q1_value: r.q1_value != null ? Number(r.q1_value) : null,
    q3_value: r.q3_value != null ? Number(r.q3_value) : null,
    iqr_value: r.iqr_value != null ? Number(r.iqr_value) : null,
    p10_value: r.p10_value != null ? Number(r.p10_value) : null,
    p15_value: r.p15_value != null ? Number(r.p15_value) : null,
    p20_value: r.p20_value != null ? Number(r.p20_value) : null,
    p30_value: r.p30_value != null ? Number(r.p30_value) : null,
    p35_value: r.p35_value != null ? Number(r.p35_value) : null,
    p40_value: r.p40_value != null ? Number(r.p40_value) : null,
    p45_value: r.p45_value != null ? Number(r.p45_value) : null,
    p55_value: r.p55_value != null ? Number(r.p55_value) : null,
    p60_value: r.p60_value != null ? Number(r.p60_value) : null,
    p65_value: r.p65_value != null ? Number(r.p65_value) : null,
    p70_value: r.p70_value != null ? Number(r.p70_value) : null,
    p75_value: r.p75_value != null ? Number(r.p75_value) : null,
    p80_value: r.p80_value != null ? Number(r.p80_value) : null,
    p90_value: r.p90_value != null ? Number(r.p90_value) : null,
  }));
}

/** Recency bucket labels (must match outcome profile service). */
const RECENCY_BUCKET_RECENT = '<=180 days';
const RECENCY_BUCKET_OLDER = '>180 days';

/** Convert a single profile row to BlendedFeatureStats. */
function rowToStats(r: ProfileRow): BlendedFeatureStats {
  const s: BlendedFeatureStats = {
    blended_mean: r.mean_value!,
    blended_q1: r.q1_value!,
    blended_q3: r.q3_value!,
    blended_iqr: r.iqr_value!,
  };
  if (
    r.p10_value != null &&
    r.p20_value != null &&
    r.p30_value != null &&
    r.p40_value != null &&
    r.p45_value != null &&
    r.p60_value != null &&
    r.p65_value != null &&
    r.p70_value != null &&
    r.p80_value != null &&
    r.p90_value != null
  ) {
    s.blended_p10 = r.p10_value;
    s.blended_p20 = r.p20_value;
    s.blended_p30 = r.p30_value;
    s.blended_p40 = r.p40_value;
    s.blended_p45 = r.p45_value;
    s.blended_p60 = r.p60_value;
    s.blended_p65 = r.p65_value;
    s.blended_p70 = r.p70_value;
    s.blended_p80 = r.p80_value;
    s.blended_p90 = r.p90_value;
  }
  if (r.p15_value != null) s.blended_p15 = r.p15_value;
  if (r.p35_value != null) s.blended_p35 = r.p35_value;
  if (r.p55_value != null) s.blended_p55 = r.p55_value;
  if (r.p75_value != null) s.blended_p75 = r.p75_value;
  return s;
}

/**
 * Merge two blended stats (recent and older) with recency weights. Recent = 1.2, older = 1.0.
 * If only one is present, return it.
 */
function mergeRecencyWeightedStats(
  recent: BlendedFeatureStats | null,
  older: BlendedFeatureStats | null
): BlendedFeatureStats | null {
  if (recent != null && older != null) {
    const totalW = RECENCY_WEIGHT_RECENT + RECENCY_WEIGHT_OLDER;
    const stats: BlendedFeatureStats = {
      blended_mean: (RECENCY_WEIGHT_RECENT * recent.blended_mean + RECENCY_WEIGHT_OLDER * older.blended_mean) / totalW,
      blended_q1: (RECENCY_WEIGHT_RECENT * recent.blended_q1 + RECENCY_WEIGHT_OLDER * older.blended_q1) / totalW,
      blended_q3: (RECENCY_WEIGHT_RECENT * recent.blended_q3 + RECENCY_WEIGHT_OLDER * older.blended_q3) / totalW,
      blended_iqr: (RECENCY_WEIGHT_RECENT * recent.blended_iqr + RECENCY_WEIGHT_OLDER * older.blended_iqr) / totalW,
    };
    if (
      recent.blended_p40 != null &&
      recent.blended_p60 != null &&
      recent.blended_p45 != null &&
      recent.blended_p65 != null &&
      older.blended_p40 != null &&
      older.blended_p60 != null &&
      older.blended_p45 != null &&
      older.blended_p65 != null
    ) {
      stats.blended_p10 = (RECENCY_WEIGHT_RECENT * (recent.blended_p10 ?? 0) + RECENCY_WEIGHT_OLDER * (older.blended_p10 ?? 0)) / totalW;
      stats.blended_p20 = (RECENCY_WEIGHT_RECENT * (recent.blended_p20 ?? 0) + RECENCY_WEIGHT_OLDER * (older.blended_p20 ?? 0)) / totalW;
      stats.blended_p30 = (RECENCY_WEIGHT_RECENT * (recent.blended_p30 ?? 0) + RECENCY_WEIGHT_OLDER * (older.blended_p30 ?? 0)) / totalW;
      stats.blended_p40 = (RECENCY_WEIGHT_RECENT * recent.blended_p40 + RECENCY_WEIGHT_OLDER * older.blended_p40) / totalW;
      stats.blended_p45 = (RECENCY_WEIGHT_RECENT * recent.blended_p45 + RECENCY_WEIGHT_OLDER * older.blended_p45) / totalW;
      stats.blended_p60 = (RECENCY_WEIGHT_RECENT * recent.blended_p60 + RECENCY_WEIGHT_OLDER * older.blended_p60) / totalW;
      stats.blended_p65 = (RECENCY_WEIGHT_RECENT * recent.blended_p65 + RECENCY_WEIGHT_OLDER * older.blended_p65) / totalW;
      stats.blended_p70 = (RECENCY_WEIGHT_RECENT * (recent.blended_p70 ?? 0) + RECENCY_WEIGHT_OLDER * (older.blended_p70 ?? 0)) / totalW;
      stats.blended_p80 = (RECENCY_WEIGHT_RECENT * (recent.blended_p80 ?? 0) + RECENCY_WEIGHT_OLDER * (older.blended_p80 ?? 0)) / totalW;
      stats.blended_p90 = (RECENCY_WEIGHT_RECENT * (recent.blended_p90 ?? 0) + RECENCY_WEIGHT_OLDER * (older.blended_p90 ?? 0)) / totalW;
    }
    if (
      recent.blended_p15 != null && older.blended_p15 != null &&
      recent.blended_p35 != null && older.blended_p35 != null &&
      recent.blended_p55 != null && older.blended_p55 != null &&
      recent.blended_p75 != null && older.blended_p75 != null
    ) {
      stats.blended_p15 = (RECENCY_WEIGHT_RECENT * recent.blended_p15 + RECENCY_WEIGHT_OLDER * older.blended_p15) / totalW;
      stats.blended_p35 = (RECENCY_WEIGHT_RECENT * recent.blended_p35 + RECENCY_WEIGHT_OLDER * older.blended_p35) / totalW;
      stats.blended_p55 = (RECENCY_WEIGHT_RECENT * recent.blended_p55 + RECENCY_WEIGHT_OLDER * older.blended_p55) / totalW;
      stats.blended_p75 = (RECENCY_WEIGHT_RECENT * recent.blended_p75 + RECENCY_WEIGHT_OLDER * older.blended_p75) / totalW;
    }
    return stats;
  }
  return recent ?? older;
}

/** Only Denied and Withdrawn are used for fallout prediction. 100% separate from Originated. */
const PREDICTION_STATUSES: OutcomeProfileStatusType[] = ['Denied', 'Withdrawn'];

/**
 * Build blended profile map from DB. Recalculate every Predict run (no persistence of blend).
 * One row per (status, segment, feature, recency_bucket); merge ≤180d (1.2) and >180d (1.0) into final thresholds.
 *
 * Prediction pipeline and Originated profiles are 100% separate:
 * - First pass: only Denied and Withdrawn (used to determine fallout prediction).
 * - Second pass: ClosingLate and Originated (all profiles saved; Originated used only after prediction for signal buckets).
 */
export async function getBlendedProfiles(pool: pg.Pool): Promise<BlendedProfileMap> {
  const rows = await loadProfiles(pool);
  const map: BlendedProfileMap = new Map();

  const SEP = '\x01';
  const baseKey = (status: OutcomeProfileStatusType, seg: string, feat: string) =>
    `${status}${SEP}${seg}${SEP}${feat}`;

  function processRows(filter: (r: ProfileRow) => boolean) {
    const byRecency = new Map<string, ProfileRow>();
    for (const r of rows) {
      if (!filter(r)) continue;
      if (
        r.mean_value == null ||
        r.q1_value == null ||
        r.q3_value == null ||
        r.iqr_value == null
      ) {
        continue;
      }
      const recency_bucket = r.recency_bucket ?? RECENCY_BUCKET_OLDER;
      const seg = segmentKey(r.loan_type, r.loan_purpose, r.occupancy);
      const k = `${r.status_type}${SEP}${seg}${SEP}${r.feature_name}${SEP}${recency_bucket}`;
      const existing = byRecency.get(k);
      if (!existing || r.year > existing.year) byRecency.set(k, r);
    }

    const byBaseKey = new Map<string, { recent: BlendedFeatureStats | null; older: BlendedFeatureStats | null }>();
    for (const [k, r] of byRecency) {
      const parts = k.split(SEP);
      const status = parts[0] as OutcomeProfileStatusType;
      const seg = parts[1] ?? '';
      const feat = parts[2] ?? '';
      const recency = parts[3] ?? RECENCY_BUCKET_OLDER;
      const key = baseKey(status, seg, feat);
      let entry = byBaseKey.get(key);
      if (!entry) {
        entry = { recent: null, older: null };
        byBaseKey.set(key, entry);
      }
      const stats = rowToStats(r);
      if (recency === RECENCY_BUCKET_RECENT) entry.recent = stats;
      else entry.older = stats;
    }

    for (const [key, { recent, older }] of byBaseKey) {
      const merged = mergeRecencyWeightedStats(recent, older);
      if (!merged) continue;
      const parts = key.split(SEP);
      const st = parts[0] as OutcomeProfileStatusType;
      const seg = parts[1] ?? '';
      const feat = parts[2] ?? '';
      if (!map.has(st)) map.set(st, new Map());
      const bySegment = map.get(st)!;
      if (!bySegment.has(seg)) bySegment.set(seg, new Map());
      bySegment.get(seg)!.set(feat, merged);
    }
  }

  // First pass: only Denied and Withdrawn — used for fallout prediction only.
  processRows((r) => PREDICTION_STATUSES.includes(r.status_type));
  // Second pass: add ClosingLate and Originated (all profiles in map; Originated used only for signal buckets after prediction).
  processRows((r) => r.status_type === 'ClosingLate' || r.status_type === 'Originated');

  // Log mean, percentiles (zone boundaries: Zone1 P45–P55, Zone2 P40–P45/P55–P60, … Zone6 <P10 or >P90), and IQR (recency-weighted: ≤180d ×1.2, >180d ×1.0)
  const statuses = ['Denied', 'Withdrawn', 'ClosingLate', 'Originated'] as OutcomeProfileStatusType[];
  // eslint-disable-next-line no-console
  console.log('\n[Fallout Profiles] Blended zone thresholds (Zone1 P45–P55=6pts, Zone2 P40–P45|P55–P60=5, Zone3 P30–P40|P60–P70=4, Zone4 P20–P30|P70–P80=3, Zone5 P10–P20|P80–P90=2, Zone6 <P10|>P90=1):');
  // eslint-disable-next-line no-console
  console.log('[Fallout Profiles] outcome | loan_type | purpose | occupancy | feature | mean | P10 P20 P30 P40 P45 P55 P60 P70 P80 P90 | IQR');
  // eslint-disable-next-line no-console
  console.log('─'.repeat(140));
  for (const status of statuses) {
    const bySegment = map.get(status);
    if (!bySegment) continue;
    const segmentKeys = [...bySegment.keys()].sort();
    for (const seg of segmentKeys) {
      const segParts = seg.split('|');
      const loan_type = segParts[0] ?? '';
      const loan_purpose = segParts[1] ?? '';
      const occupancy = segParts[2] ?? '';
      const byFeature = bySegment.get(seg)!;
      const features = [...byFeature.keys()].sort();
      for (const feat of features) {
        const s = byFeature.get(feat)!;
        const hasAllP =
          s.blended_p10 != null &&
          s.blended_p20 != null &&
          s.blended_p30 != null &&
          s.blended_p40 != null &&
          s.blended_p45 != null &&
          s.blended_p55 != null &&
          s.blended_p60 != null &&
          s.blended_p70 != null &&
          s.blended_p80 != null &&
          s.blended_p90 != null;
        const pBand = hasAllP
          ? `P10=${s.blended_p10!.toFixed(2)} P20=${s.blended_p20!.toFixed(2)} P30=${s.blended_p30!.toFixed(2)} P40=${s.blended_p40!.toFixed(2)} P45=${s.blended_p45!.toFixed(2)} P55=${s.blended_p55!.toFixed(2)} P60=${s.blended_p60!.toFixed(2)} P70=${s.blended_p70!.toFixed(2)} P80=${s.blended_p80!.toFixed(2)} P90=${s.blended_p90!.toFixed(2)}`
          : `Q1=${s.blended_q1.toFixed(2)} Q3=${s.blended_q3.toFixed(2)}`;
        // eslint-disable-next-line no-console
        console.log(
          `[Fallout Profiles] ${status} | ${loan_type} | ${loan_purpose} | ${occupancy} | ${feat} | mean=${s.blended_mean.toFixed(2)} | ${pBand} | IQR=${s.blended_iqr.toFixed(2)}`
        );
      }
    }
  }
  // eslint-disable-next-line no-console
  console.log('─'.repeat(140) + '\n');

  return map;
}

/**
 * Get blended feature map for a segment, with partial-aggregate fallback: if exact (loan_type, loan_purpose, occupancy)
 * is missing, aggregate over all segments that match the dimensions we have (e.g. all occupancy for that loan_type+loan_purpose).
 */
export function getProfileForLoan(
  blendedMap: BlendedProfileMap,
  status: OutcomeProfileStatusType,
  loan_type: string,
  loan_purpose: string,
  occupancy: string
): Map<string, BlendedFeatureStats> {
  const bySegment = blendedMap.get(status);
  if (!bySegment) return new Map();
  const exact = segmentKey(loan_type, loan_purpose, occupancy);
  const exactProfile = bySegment.get(exact);
  if (exactProfile && exactProfile.size > 0) return new Map(exactProfile);

  // Fallback: stored type + purpose (e.g. VA|Purchase|All) — computed like type-only, visible in terminal
  const typePurposeAll = segmentKey(loan_type, loan_purpose, 'All');
  const typePurposeProfile = bySegment.get(typePurposeAll);
  if (typePurposeProfile && typePurposeProfile.size > 0) return new Map(typePurposeProfile);

  // Fallback: aggregate over segments matching (loan_type, loan_purpose, *) then (loan_type, *, *) then all
  const segments = [...bySegment.keys()];
  const matchLtLp = segments.filter((k) => {
    const [lt, lp] = k.split('|');
    return lt === loan_type && lp === loan_purpose;
  });
  if (matchLtLp.length > 0) {
    return aggregateFeatureMaps(matchLtLp.map((k) => bySegment.get(k)!).filter(Boolean));
  }
  const matchLt = segments.filter((k) => k.split('|')[0] === loan_type);
  if (matchLt.length > 0) {
    return aggregateFeatureMaps(matchLt.map((k) => bySegment.get(k)!).filter(Boolean));
  }
  // Global fallback: explicit All|All|All profile (all loan types, purpose, occupancy) for unknown segments.
  const allProfile = bySegment.get('All|All|All');
  if (allProfile && allProfile.size > 0) return new Map(allProfile);
  return aggregateFeatureMaps(segments.map((k) => bySegment.get(k)!).filter(Boolean));
}

function aggregateFeatureMaps(maps: Map<string, BlendedFeatureStats>[]): Map<string, BlendedFeatureStats> {
  if (maps.length === 0) return new Map();
  const allFeatures = new Set<string>();
  for (const m of maps) {
    for (const f of m.keys()) allFeatures.add(f);
  }
  const result = new Map<string, BlendedFeatureStats>();
  for (const feat of allFeatures) {
    const vals = maps.map((m) => m.get(feat)).filter(Boolean) as BlendedFeatureStats[];
    if (vals.length === 0) continue;
    const withP = vals.filter((v) => v.blended_p40 != null && v.blended_p60 != null);
    const stats: BlendedFeatureStats = {
      blended_mean: vals.reduce((s, v) => s + v.blended_mean, 0) / vals.length,
      blended_q1: vals.reduce((s, v) => s + v.blended_q1, 0) / vals.length,
      blended_q3: vals.reduce((s, v) => s + v.blended_q3, 0) / vals.length,
      blended_iqr: vals.reduce((s, v) => s + v.blended_iqr, 0) / vals.length,
    };
    if (withP.length > 0) {
      stats.blended_p10 = withP.reduce((s, v) => s + (v.blended_p10 ?? 0), 0) / withP.length;
      stats.blended_p20 = withP.reduce((s, v) => s + (v.blended_p20 ?? 0), 0) / withP.length;
      stats.blended_p30 = withP.reduce((s, v) => s + (v.blended_p30 ?? 0), 0) / withP.length;
      stats.blended_p40 = withP.reduce((s, v) => s + (v.blended_p40 ?? 0), 0) / withP.length;
      stats.blended_p45 = withP.reduce((s, v) => s + (v.blended_p45 ?? 0), 0) / withP.length;
      stats.blended_p60 = withP.reduce((s, v) => s + (v.blended_p60 ?? 0), 0) / withP.length;
      stats.blended_p65 = withP.reduce((s, v) => s + (v.blended_p65 ?? 0), 0) / withP.length;
      stats.blended_p70 = withP.reduce((s, v) => s + (v.blended_p70 ?? 0), 0) / withP.length;
      stats.blended_p80 = withP.reduce((s, v) => s + (v.blended_p80 ?? 0), 0) / withP.length;
      stats.blended_p90 = withP.reduce((s, v) => s + (v.blended_p90 ?? 0), 0) / withP.length;
    }
    const withOriginateP = vals.filter(
      (v) =>
        v.blended_p15 != null &&
        v.blended_p35 != null &&
        v.blended_p55 != null &&
        v.blended_p75 != null &&
        v.blended_p90 != null
    );
    if (withOriginateP.length > 0) {
      stats.blended_p15 = withOriginateP.reduce((s, v) => s + (v.blended_p15 ?? 0), 0) / withOriginateP.length;
      stats.blended_p35 = withOriginateP.reduce((s, v) => s + (v.blended_p35 ?? 0), 0) / withOriginateP.length;
      stats.blended_p55 = withOriginateP.reduce((s, v) => s + (v.blended_p55 ?? 0), 0) / withOriginateP.length;
      stats.blended_p75 = withOriginateP.reduce((s, v) => s + (v.blended_p75 ?? 0), 0) / withOriginateP.length;
    }
    result.set(feat, stats);
  }
  return result;
}

/**
 * Originate zones (UI only). Returns zone 1–6 for a value given blended stats (P10, P15, P35, P55, P75, P90).
 * Used for loans predicted to originate (not deny/withdraw). UI maps zone to display bucket as 7 − zone (zone 1 = worst → bucket 6, zone 6 = best → bucket 1).
 *
 * Either <P10 or >P90 goes into zone 1 (display bucket 6), depending on direction:
 * - lowerIsWorse (default): FICO, market_delta — lower value = worse. Zone1 = <P10 (bucket 6), Zone6 = P90–P100 (bucket 1).
 * - higherIsWorse: LTV, DTI, days_active — higher value = worse. Zone1 = >P90 (bucket 6), Zone6 = P0–P15 (bucket 1).
 */
export function zoneAndPointsOriginate(
  value: number,
  stats: BlendedFeatureStats,
  higherIsWorse: boolean = false
): { zone: number } | null {
  const p10 = stats.blended_p10;
  const p15 = stats.blended_p15;
  const p35 = stats.blended_p35;
  const p55 = stats.blended_p55;
  const p75 = stats.blended_p75;
  const p90 = stats.blended_p90;
  if (p15 == null || p35 == null || p55 == null || p75 == null || p90 == null) return null;
  if (higherIsWorse) {
    // Higher value = worse: >P90 → zone 1 (display bucket 6)
    if (value > p90) return { zone: 1 };
    if (value > p75) return { zone: 2 };
    if (value > p55) return { zone: 3 };
    if (value > p35) return { zone: 4 };
    if (value > p15) return { zone: 5 };
    return { zone: 6 };
  }
  // Lower value = worse (FICO, market_delta): <P10 → zone 1 (display bucket 6). Fall back to <=P15 when P10 missing.
  const lowTailThreshold = p10 ?? p15;
  if (value < lowTailThreshold) return { zone: 1 };
  if (value <= p15) return { zone: 2 };
  if (value <= p35) return { zone: 3 };
  if (value <= p55) return { zone: 4 };
  if (value <= p75) return { zone: 5 };
  return { zone: 6 };
}
