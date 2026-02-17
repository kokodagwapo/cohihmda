/**
 * Numeric Profile Blend Service
 *
 * Loads outcome_numeric_risk_profiles from DB (year >= 2023 to filter date range only).
 * Profiles are stored per recency bucket (≤180 days, >180 days). This service merges the two
 * buckets with recency weights (1.2 and 1.0) into one profile per (status_type, segment, feature).
 * No yearly grouping or averaging. Used on every Predict run; no persistence of blend.
 */

import pg from 'pg';
import type { FalloutStatusType } from './falloutTypes.js';
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
  status_type: FalloutStatusType;
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
  p40_value: number | null;
  p60_value: number | null;
  p70_value: number | null;
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
              p10_value, p20_value, p30_value, p40_value, p60_value, p70_value, p80_value, p90_value
       FROM public.outcome_numeric_risk_profiles
       WHERE year >= $1 AND year <= $2
       ORDER BY year DESC`,
      [START_YEAR, currentYear]
    );
  } catch {
    // recency_bucket column may not exist yet (pre-migration 035); load without it and treat all as older
    result = await pool.query(
      `SELECT year, status_type, loan_type, loan_purpose, occupancy, feature_name, mean_value, q1_value, q3_value, iqr_value,
              p10_value, p20_value, p30_value, p40_value, p60_value, p70_value, p80_value, p90_value
       FROM public.outcome_numeric_risk_profiles
       WHERE year >= $1 AND year <= $2
       ORDER BY year DESC`,
      [START_YEAR, currentYear]
    );
    for (const r of result.rows) (r as any).recency_bucket = '>180 days';
  }
  return result.rows.map((r) => ({
    year: Number(r.year),
    status_type: r.status_type as FalloutStatusType,
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
    p20_value: r.p20_value != null ? Number(r.p20_value) : null,
    p30_value: r.p30_value != null ? Number(r.p30_value) : null,
    p40_value: r.p40_value != null ? Number(r.p40_value) : null,
    p60_value: r.p60_value != null ? Number(r.p60_value) : null,
    p70_value: r.p70_value != null ? Number(r.p70_value) : null,
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
    r.p60_value != null &&
    r.p70_value != null &&
    r.p80_value != null &&
    r.p90_value != null
  ) {
    s.blended_p10 = r.p10_value;
    s.blended_p20 = r.p20_value;
    s.blended_p30 = r.p30_value;
    s.blended_p40 = r.p40_value;
    s.blended_p60 = r.p60_value;
    s.blended_p70 = r.p70_value;
    s.blended_p80 = r.p80_value;
    s.blended_p90 = r.p90_value;
  }
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
      older.blended_p40 != null &&
      older.blended_p60 != null
    ) {
      stats.blended_p10 = (RECENCY_WEIGHT_RECENT * (recent.blended_p10 ?? 0) + RECENCY_WEIGHT_OLDER * (older.blended_p10 ?? 0)) / totalW;
      stats.blended_p20 = (RECENCY_WEIGHT_RECENT * (recent.blended_p20 ?? 0) + RECENCY_WEIGHT_OLDER * (older.blended_p20 ?? 0)) / totalW;
      stats.blended_p30 = (RECENCY_WEIGHT_RECENT * (recent.blended_p30 ?? 0) + RECENCY_WEIGHT_OLDER * (older.blended_p30 ?? 0)) / totalW;
      stats.blended_p40 = (RECENCY_WEIGHT_RECENT * recent.blended_p40 + RECENCY_WEIGHT_OLDER * older.blended_p40) / totalW;
      stats.blended_p60 = (RECENCY_WEIGHT_RECENT * recent.blended_p60 + RECENCY_WEIGHT_OLDER * older.blended_p60) / totalW;
      stats.blended_p70 = (RECENCY_WEIGHT_RECENT * (recent.blended_p70 ?? 0) + RECENCY_WEIGHT_OLDER * (older.blended_p70 ?? 0)) / totalW;
      stats.blended_p80 = (RECENCY_WEIGHT_RECENT * (recent.blended_p80 ?? 0) + RECENCY_WEIGHT_OLDER * (older.blended_p80 ?? 0)) / totalW;
      stats.blended_p90 = (RECENCY_WEIGHT_RECENT * (recent.blended_p90 ?? 0) + RECENCY_WEIGHT_OLDER * (older.blended_p90 ?? 0)) / totalW;
    }
    return stats;
  }
  return recent ?? older;
}

/**
 * Build blended profile map from DB. Recalculate every Predict run (no persistence of blend).
 * One row per (status, segment, feature, recency_bucket); merge ≤180d (1.2) and >180d (1.0) into final thresholds.
 */
export async function getBlendedProfiles(pool: pg.Pool): Promise<BlendedProfileMap> {
  const rows = await loadProfiles(pool);
  const map: BlendedProfileMap = new Map();

  const SEP = '\x01';
  const baseKey = (status: FalloutStatusType, seg: string, feat: string) =>
    `${status}${SEP}${seg}${SEP}${feat}`;

  // Group by (status, segment, feature, recency_bucket); keep latest year if multiple (e.g. legacy data)
  const byRecency = new Map<string, ProfileRow>();
  for (const r of rows) {
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

  // For each (status, segment, feature), collect recent and older stats, then merge with recency weights
  const byBaseKey = new Map<string, { recent: BlendedFeatureStats | null; older: BlendedFeatureStats | null }>();
  for (const [k, r] of byRecency) {
    const parts = k.split(SEP);
    const status = parts[0] as FalloutStatusType;
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
    const st = parts[0] as FalloutStatusType;
    const seg = parts[1] ?? '';
    const feat = parts[2] ?? '';
    if (!map.has(st)) map.set(st, new Map());
    const bySegment = map.get(st)!;
    if (!bySegment.has(seg)) bySegment.set(seg, new Map());
    bySegment.get(seg)!.set(feat, merged);
  }

  // Log mean and IQR per feature (recency-weighted: ≤180d ×1.2, >180d ×1.0; data range 2023–present)
  const statuses = ['Denied', 'Withdrawn'] as FalloutStatusType[];
  // eslint-disable-next-line no-console
  console.log('\n[Fallout Profiles] Blended zone thresholds (≤180d ×1.2, >180d ×1.0; data 2023–present):');
  // eslint-disable-next-line no-console
  console.log('[Fallout Profiles] outcome | loan_type | purpose | occupancy | feature | mean | P40-P60 (zones) | IQR');
  // eslint-disable-next-line no-console
  console.log('─'.repeat(100));
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
        const zoneBand =
          s.blended_p40 != null && s.blended_p60 != null
            ? `P40=${s.blended_p40.toFixed(2)} P60=${s.blended_p60.toFixed(2)}`
            : `Q1=${s.blended_q1.toFixed(2)} Q3=${s.blended_q3.toFixed(2)}`;
        // eslint-disable-next-line no-console
        console.log(
          `[Fallout Profiles] ${status} | ${loan_type} | ${loan_purpose} | ${occupancy} | ${feat} | mean=${s.blended_mean.toFixed(2)} | ${zoneBand} | IQR=${s.blended_iqr.toFixed(2)}`
        );
      }
    }
  }
  // eslint-disable-next-line no-console
  console.log('─'.repeat(100) + '\n');

  return map;
}

/**
 * Get blended feature map for a segment, with partial-aggregate fallback: if exact (loan_type, loan_purpose, occupancy)
 * is missing, aggregate over all segments that match the dimensions we have (e.g. all occupancy for that loan_type+loan_purpose).
 */
export function getProfileForLoan(
  blendedMap: BlendedProfileMap,
  status: FalloutStatusType,
  loan_type: string,
  loan_purpose: string,
  occupancy: string
): Map<string, BlendedFeatureStats> {
  const bySegment = blendedMap.get(status);
  if (!bySegment) return new Map();
  const exact = segmentKey(loan_type, loan_purpose, occupancy);
  const exactProfile = bySegment.get(exact);
  if (exactProfile && exactProfile.size > 0) return new Map(exactProfile);

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
      stats.blended_p60 = withP.reduce((s, v) => s + (v.blended_p60 ?? 0), 0) / withP.length;
      stats.blended_p70 = withP.reduce((s, v) => s + (v.blended_p70 ?? 0), 0) / withP.length;
      stats.blended_p80 = withP.reduce((s, v) => s + (v.blended_p80 ?? 0), 0) / withP.length;
      stats.blended_p90 = withP.reduce((s, v) => s + (v.blended_p90 ?? 0), 0) / withP.length;
    }
    result.set(feat, stats);
  }
  return result;
}
