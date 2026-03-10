/**
 * Numeric Outcome Profile Service (COHI Numeric Segmented Risk Range Engine)
 *
 * Builds per-segment (loan_type, loan_purpose, occupancy) feature stats (mean, Q1, Q3, IQR, P10–P90)
 * for Denied and Withdrawn from historical loans (2023 to present). Data is aggregated only by
 * recency bucket (≤180 days vs >180 days from outcome date); year is used only to filter the
 * date range (2023–present), not to split profiles. Outcome date for days_active: Denied = denial_date
 * (application to denial); Withdrawn/ClosingLate = funding_date ?? closing_date ?? current_status_date.
 * Market delta uses existing market rate service.
 *
 * Persistence: One full refresh per run (all rows replaced). Year column stores current year as
 * “as-of” for compatibility; blend service merges the two recency buckets with weights 1.2 / 1.0.
 *
 * TODO: Job scheduling for this service still needs to be done (e.g. nightly or weekly profile refresh).
 */

import pg from 'pg';
import { logInfo, logError } from '../logger.js';
import { computeMarketDeltaForDates } from '../dashboard/marketRateService.js';
import type { FalloutStatusType, OutcomeProfileStatusType } from './falloutTypes.js';

const START_YEAR = 2023;
/** Minimum loans in a segment/feature to save a profile row (skip saving below this). */
const MIN_SAMPLE_SIZE = 10;
/** Minimum loans for loan-type-only fallback profile (Denied|VA, Withdrawn|VA, etc.); use 1 so sparse types still get a profile. Type+ purpose fallback (e.g. Denied|VA|NoCash-Out Refinance|All) requires MIN_SAMPLE_SIZE so we do not persist 1-loan groupings. */
const MIN_SAMPLE_SIZE_FALLBACK = 1;

/** Recency cutoff: loans with outcome date within this many days of reference date are "<=180 days". */
const RECENCY_DAYS = 180;
export const RECENCY_BUCKET_RECENT = '<=180 days';
export const RECENCY_BUCKET_OLDER = '>180 days';

/** Segment key: raw loan_type, loan_purpose, occupancy (null/empty -> 'Unknown') */
export type SegmentKey = { loan_type: string; loan_purpose: string; occupancy: string };

/** Denied: fico, ltv, be_dti, days_active (days_active = application_date to denial_date for historical Denied). */
const FEATURES_DENIED = ['fico_score', 'ltv_ratio', 'be_dti_ratio', 'days_active'] as const;
const FEATURES_WITHDRAWN = ['fico_score', 'ltv_ratio', 'be_dti_ratio', 'days_active', 'market_delta'] as const;
/** Originated (Loan Originated): same as Withdrawn (includes market_delta); used only for UI zone colors, not prediction. */
const FEATURES_ORIGINATED = FEATURES_WITHDRAWN;

export function classifyStatus(row: any): FalloutStatusType | 'FundedOnTime' | null {
  const status = (row.current_loan_status ?? '').toString().trim().toUpperCase();
  if (!status) return null;
  if (status === 'ACTIVE LOAN' || status === 'ACTIVE' || status === 'INQUIRY') return null;
  if (
    status === 'APPLICATION WITHDRAWN' ||
    status === 'APPLICATION APPROVED BUT NOT ACCEPTED' ||
    status === 'FILE CLOSED FOR INCOMPLETENESS' ||
    status === 'PREAPPROVAL REQUEST APPROVED BUT NOT ACCEPTED' ||
    status === 'WITHDRAWN'
  ) {
    return 'Withdrawn';
  }
  if (
    status === 'APPLICATION DENIED' ||
    status === 'PREAPPROVAL REQUEST DENIED BY FINANCIAL INSTITUTION' ||
    status === 'DENIED' ||
    status === 'DECLINED'
  ) {
    return 'Denied';
  }
  const fundingDate = row.funding_date ?? row.fund_date ?? row.closing_date;
  const ecd = row.estimated_closing_date;
  if (fundingDate && ecd) {
    const fund = new Date(fundingDate);
    const ecdDate = new Date(ecd);
    if (!isNaN(fund.getTime()) && !isNaN(ecdDate.getTime()) && fund > ecdDate) return 'ClosingLate';
  }
  return 'FundedOnTime';
}

export function norm(s: any): string {
  const v = (s ?? '').toString().trim();
  return v || 'Unknown';
}

/** End date for days_active: Denied = denial_date ?? current_status_date; else funding_date ?? closing_date ?? current_status_date */
function outcomeEndDateForDaysActive(row: any, statusType: FalloutStatusType | null): Date | null {
  if (statusType === 'Denied') {
    const d = row.denial_date ?? row.current_status_date;
    if (d) {
      const date = new Date(d);
      if (!isNaN(date.getTime())) return date;
    }
  }
  const d = row.funding_date ?? row.fund_date ?? row.closing_date ?? row.current_status_date;
  if (!d) return null;
  const date = new Date(d);
  return isNaN(date.getTime()) ? null : date;
}

/** Date used for recency bucket: first available of funding_date, current_status_date, denial_date, application_date (and closing_date) */
function outcomeDateForRecency(row: any): Date | null {
  const d =
    row.funding_date ?? row.fund_date ?? row.current_status_date ?? row.denial_date ?? row.closing_date ?? row.application_date;
  if (!d) return null;
  const date = new Date(d);
  return isNaN(date.getTime()) ? null : date;
}

/**
 * Load historical loans from 2023 through present year (year from application_date).
 */
export async function loadHistoricalLoans(pool: pg.Pool): Promise<any[]> {
  const endYear = new Date().getFullYear();
  const startStr = `${START_YEAR}-01-01`;
  const baseCols = `
    loan_id, current_loan_status, application_date, denial_date, funding_date, closing_date, current_status_date,
    loan_type, loan_purpose, occupancy_type, fico_score, ltv_ratio, be_dti_ratio,
    lock_date, interest_rate`;
  const where = `WHERE application_date IS NOT NULL AND application_date::date >= $1
    AND (current_loan_status IS NULL OR current_loan_status NOT IN ('Active Loan', 'Active', 'Inquiry'))
    ORDER BY application_date DESC`;
  try {
    const result = await pool.query(
      `SELECT ${baseCols} FROM public.loans ${where}`,
      [startStr]
    );
    return result.rows;
  } catch (e: any) {
    logError('numericOutcomeProfileService: loadHistoricalLoans failed', e);
    return [];
  }
}

/**
 * Get distinct segments (loan_type, loan_purpose, occupancy) from historical loans.
 */
function getDistinctSegments(rows: any[]): SegmentKey[] {
  const set = new Set<string>();
  const list: SegmentKey[] = [];
  for (const row of rows) {
    const lt = norm(row.loan_type);
    const lp = norm(row.loan_purpose);
    const occ = norm(row.occupancy_type);
    const key = `${lt}|${lp}|${occ}`;
    if (set.has(key)) continue;
    set.add(key);
    list.push({ loan_type: lt, loan_purpose: lp, occupancy: occ });
  }
  return list;
}

interface FeatureRow {
  year: number;
  status_type: OutcomeProfileStatusType;
  loan_type: string;
  loan_purpose: string;
  occupancy: string;
  feature_name: string;
  recency_bucket: string;
  mean_value: number | null;
  q1_value: number | null;
  q3_value: number | null;
  iqr_value: number | null;
  p10_value: number | null;
  p15_value: number | null;
  p20_value: number | null;
  p30_value: number | null;
  p35_value: number | null;
  p40_value: number | null;
  p45_value: number | null;
  p55_value: number | null;
  p60_value: number | null;
  p65_value: number | null;
  p70_value: number | null;
  p75_value: number | null;
  p80_value: number | null;
  p90_value: number | null;
  sample_size: number;
  low_confidence: boolean;
}

function quantile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const i = p * (sorted.length - 1);
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (i - lo) * (sorted[hi] - sorted[lo]);
}

/**
 * Ensure outcome_numeric_risk_profiles has P10–P90 and P45/P65 columns (for 6-zone scoring).
 * Safe to call every time; uses ADD COLUMN IF NOT EXISTS.
 */
async function ensureOutcomeNumericRiskProfilesPercentileColumns(pool: pg.Pool): Promise<void> {
  try {
    await pool.query(`
      ALTER TABLE public.outcome_numeric_risk_profiles
        ADD COLUMN IF NOT EXISTS p10_value NUMERIC,
        ADD COLUMN IF NOT EXISTS p15_value NUMERIC,
        ADD COLUMN IF NOT EXISTS p20_value NUMERIC,
        ADD COLUMN IF NOT EXISTS p30_value NUMERIC,
        ADD COLUMN IF NOT EXISTS p35_value NUMERIC,
        ADD COLUMN IF NOT EXISTS p40_value NUMERIC,
        ADD COLUMN IF NOT EXISTS p45_value NUMERIC,
        ADD COLUMN IF NOT EXISTS p55_value NUMERIC,
        ADD COLUMN IF NOT EXISTS p60_value NUMERIC,
        ADD COLUMN IF NOT EXISTS p65_value NUMERIC,
        ADD COLUMN IF NOT EXISTS p70_value NUMERIC,
        ADD COLUMN IF NOT EXISTS p75_value NUMERIC,
        ADD COLUMN IF NOT EXISTS p80_value NUMERIC,
        ADD COLUMN IF NOT EXISTS p90_value NUMERIC
    `);
  } catch {
    // Table may not exist yet (e.g. first run); caller will handle
  }
}

/**
 * Ensure outcome_numeric_risk_profiles has recency_bucket column and that the primary key
 * includes it (for tenants created before migration 035 or where the migration didn't run).
 * Without recency_bucket in the PK, inserting both <=180 and >180 rows causes duplicate-key errors.
 */
async function ensureOutcomeNumericRiskProfilesRecencyBucket(pool: pg.Pool): Promise<void> {
  try {
    await pool.query(`
      ALTER TABLE public.outcome_numeric_risk_profiles
        ADD COLUMN IF NOT EXISTS recency_bucket TEXT NOT NULL DEFAULT '>180 days'
    `);
    // If the PK does not include recency_bucket, add it so we can store two rows per segment/feature.
    const pkCheck = await pool.query(`
      SELECT a.attname FROM pg_attribute a
      JOIN pg_constraint c ON c.conrelid = a.attrelid AND a.attnum = ANY(c.conkey) AND NOT a.attisdropped
      WHERE c.conname = 'outcome_numeric_risk_profiles_pkey' AND c.contype = 'p'
        AND a.attrelid = 'public.outcome_numeric_risk_profiles'::regclass
    `);
    const pkColumns = (pkCheck.rows as { attname: string }[]).map((r) => r.attname);
    if (pkColumns.length > 0 && !pkColumns.includes('recency_bucket')) {
      await pool.query(`
        ALTER TABLE public.outcome_numeric_risk_profiles DROP CONSTRAINT outcome_numeric_risk_profiles_pkey
      `);
      await pool.query(`
        ALTER TABLE public.outcome_numeric_risk_profiles
          ADD PRIMARY KEY (year, status_type, loan_type, loan_purpose, occupancy, feature_name, recency_bucket)
      `);
    }
  } catch {
    // Table may not exist yet
  }
}

/**
 * Ensure outcome_numeric_risk_profiles allows status_type = 'Originated' (for UI zone profiles).
 * Drops the existing status_type check constraint and re-adds it including 'Originated'.
 * Safe to call every time; avoids insert failures when migration 037 has not been run.
 */
async function ensureOutcomeNumericRiskProfilesOriginatedStatus(pool: pg.Pool): Promise<void> {
  try {
    const nameResult = await pool.query(
      `SELECT c.conname FROM pg_constraint c
       JOIN pg_class t ON c.conrelid = t.oid
       WHERE t.relname = 'outcome_numeric_risk_profiles' AND c.contype = 'c'
         AND (pg_get_constraintdef(c.oid) LIKE '%status_type%' OR c.conname = 'outcome_numeric_risk_profiles_status_type_check')
       LIMIT 1`
    );
    const conname = (nameResult.rows[0] as { conname: string } | undefined)?.conname;
    const constraintId = conname ? `"${String(conname).replace(/"/g, '""')}"` : 'outcome_numeric_risk_profiles_status_type_check';
    await pool.query(
      `ALTER TABLE public.outcome_numeric_risk_profiles DROP CONSTRAINT IF EXISTS ${constraintId}`
    );
    await pool.query(
      `ALTER TABLE public.outcome_numeric_risk_profiles
       ADD CONSTRAINT outcome_numeric_risk_profiles_status_type_check
       CHECK (status_type IN ('Denied', 'Withdrawn', 'ClosingLate', 'Originated'))`
    );
  } catch (e: any) {
    if (e.code !== '42710') {
      logError('numericOutcomeProfileService: ensure Originated status constraint failed', e);
    }
  }
}

/**
 * Run profile derivation: compute profiles by segment and recency only (2023–present data).
 * Year is used only to filter the date range; aggregation is by (status, segment, recency_bucket).
 */
export async function runNumericOutcomeProfileDerivation(pool: pg.Pool): Promise<{
  rowsInserted: number;
  yearsProcessed: number[];
}> {
  await ensureOutcomeNumericRiskProfilesPercentileColumns(pool);
  await ensureOutcomeNumericRiskProfilesRecencyBucket(pool);
  await ensureOutcomeNumericRiskProfilesOriginatedStatus(pool);

  const currentYear = new Date().getFullYear();
  const referenceDate = new Date();

  const rows = await loadHistoricalLoans(pool);
  const segments = getDistinctSegments(rows);

  // Normalize: status, segment, recency_bucket (year only used to filter 2023–present)
  type LoanRec = {
    status_type: OutcomeProfileStatusType;
    segment: SegmentKey;
    recency_bucket: string;
    fico_score: number | null;
    ltv_ratio: number | null;
    be_dti_ratio: number | null;
    days_active: number | null;
    market_delta: number | null;
  };

  const recs: LoanRec[] = [];
  const marketDeltaToPersist: { loan_id: string; market_delta: number }[] = [];
  for (const row of rows) {
    const rawStatus = classifyStatus(row);
    if (rawStatus == null) continue;
    // Map FundedOnTime (Loan Originated) to 'Originated' for profile building (UI zones only; not used for deny/withdraw prediction).
    const status_type: OutcomeProfileStatusType =
      rawStatus === 'FundedOnTime' ? 'Originated' : rawStatus;
    const appDate = row.application_date;
    const year = appDate ? new Date(appDate).getFullYear() : currentYear;
    if (year < START_YEAR || year > currentYear) continue;

    const outcomeDate = outcomeDateForRecency(row);
    const daysAgo =
      outcomeDate != null
        ? Math.floor((referenceDate.getTime() - outcomeDate.getTime()) / (1000 * 60 * 60 * 24))
        : 9999;
    const recency_bucket = daysAgo <= RECENCY_DAYS ? RECENCY_BUCKET_RECENT : RECENCY_BUCKET_OLDER;

    const endDate = outcomeEndDateForDaysActive(row, rawStatus === 'FundedOnTime' ? 'Withdrawn' : rawStatus);
    let days_active: number | null = null;
    if (appDate && endDate) {
      days_active = Math.floor(
        (endDate.getTime() - new Date(appDate).getTime()) / (1000 * 60 * 60 * 24)
      );
      if (days_active < 0 || days_active > 365 * 2) days_active = null;
    }

    const fico = row.fico_score != null && !isNaN(Number(row.fico_score)) ? Number(row.fico_score) : null;
    const ltv = row.ltv_ratio != null && !isNaN(Number(row.ltv_ratio)) ? Number(row.ltv_ratio) : null;
    const dti =
      row.be_dti_ratio != null && !isNaN(Number(row.be_dti_ratio)) ? Number(row.be_dti_ratio) : null;

    const segment: SegmentKey = {
      loan_type: norm(row.loan_type),
      loan_purpose: norm(row.loan_purpose),
      occupancy: norm(row.occupancy_type),
    };

    let market_delta: number | null = null;
    if (rawStatus === 'Withdrawn' || rawStatus === 'FundedOnTime') {
      // Only compute market delta when loan has a lock date; do not use application date for lock rate
      const lockDate = row.lock_date ?? null;
      const outcomeDate = row.current_status_date ?? row.funding_date ?? row.closing_date;
      if (lockDate && outcomeDate) {
        market_delta = await computeMarketDeltaForDates(lockDate, outcomeDate);
      }
    }

    if (market_delta != null && row.loan_id != null && !Number.isNaN(Number(market_delta))) {
      marketDeltaToPersist.push({ loan_id: String(row.loan_id), market_delta: Number(market_delta) });
    }

    recs.push({
      status_type,
      segment,
      recency_bucket,
      fico_score: fico,
      ltv_ratio: ltv,
      be_dti_ratio: dti,
      days_active,
      market_delta,
    });
  }

  // Persist market_delta to loans table when column exists (migration 038) so UI and sequencer can use it
  if (marketDeltaToPersist.length > 0) {
    try {
      await pool.query(
        `UPDATE public.loans AS l SET market_change_delta = v.delta
         FROM (SELECT unnest($1::text[]) AS loan_id, unnest($2::decimal[]) AS delta) AS v
         WHERE l.loan_id = v.loan_id`,
        [
          marketDeltaToPersist.map((r) => r.loan_id),
          marketDeltaToPersist.map((r) => r.market_delta),
        ]
      );
    } catch (e: any) {
      if (e?.code !== '42703') logError('numericOutcomeProfileService: persist market_change_delta failed', e);
    }
  }

  // Aggregate by (status_type, segment, recency_bucket) only — no year in key
  const agg = new Map<
    string,
    {
      fico: number[];
      ltv: number[];
      dti: number[];
      days_active: number[];
      market_delta: number[];
    }
  >();
  const aggByLoanType = new Map<
    string,
    {
      fico: number[];
      ltv: number[];
      dti: number[];
      days_active: number[];
      market_delta: number[];
    }
  >();
  const aggByLoanTypePurpose = new Map<
    string,
    {
      fico: number[];
      ltv: number[];
      dti: number[];
      days_active: number[];
      market_delta: number[];
    }
  >();
  const aggAll = new Map<
    string,
    {
      fico: number[];
      ltv: number[];
      dti: number[];
      days_active: number[];
      market_delta: number[];
    }
  >();

  for (const r of recs) {
    const key = `${r.status_type}|${r.segment.loan_type}|${r.segment.loan_purpose}|${r.segment.occupancy}|${r.recency_bucket}`;
    let entry = agg.get(key);
    if (!entry) {
      entry = { fico: [], ltv: [], dti: [], days_active: [], market_delta: [] };
      agg.set(key, entry);
    }
    if (r.fico_score != null) entry.fico.push(r.fico_score);
    if (r.ltv_ratio != null) entry.ltv.push(r.ltv_ratio);
    if (r.be_dti_ratio != null) entry.dti.push(r.be_dti_ratio);
    if (r.days_active != null) entry.days_active.push(r.days_active);
    if (r.market_delta != null) entry.market_delta.push(r.market_delta);

    const fallbackKey = `${r.status_type}|${r.segment.loan_type}|${r.recency_bucket}`;
    let fallbackEntry = aggByLoanType.get(fallbackKey);
    if (!fallbackEntry) {
      fallbackEntry = { fico: [], ltv: [], dti: [], days_active: [], market_delta: [] };
      aggByLoanType.set(fallbackKey, fallbackEntry);
    }
    if (r.fico_score != null) fallbackEntry.fico.push(r.fico_score);
    if (r.ltv_ratio != null) fallbackEntry.ltv.push(r.ltv_ratio);
    if (r.be_dti_ratio != null) fallbackEntry.dti.push(r.be_dti_ratio);
    if (r.days_active != null) fallbackEntry.days_active.push(r.days_active);
    if (r.market_delta != null) fallbackEntry.market_delta.push(r.market_delta);

    const typePurposeKey = `${r.status_type}|${r.segment.loan_type}|${r.segment.loan_purpose}|${r.recency_bucket}`;
    let typePurposeEntry = aggByLoanTypePurpose.get(typePurposeKey);
    if (!typePurposeEntry) {
      typePurposeEntry = { fico: [], ltv: [], dti: [], days_active: [], market_delta: [] };
      aggByLoanTypePurpose.set(typePurposeKey, typePurposeEntry);
    }
    if (r.fico_score != null) typePurposeEntry.fico.push(r.fico_score);
    if (r.ltv_ratio != null) typePurposeEntry.ltv.push(r.ltv_ratio);
    if (r.be_dti_ratio != null) typePurposeEntry.dti.push(r.be_dti_ratio);
    if (r.days_active != null) typePurposeEntry.days_active.push(r.days_active);
    if (r.market_delta != null) typePurposeEntry.market_delta.push(r.market_delta);

    const allKey = `${r.status_type}|${r.recency_bucket}`;
    let allEntry = aggAll.get(allKey);
    if (!allEntry) {
      allEntry = { fico: [], ltv: [], dti: [], days_active: [], market_delta: [] };
      aggAll.set(allKey, allEntry);
    }
    if (r.fico_score != null) allEntry.fico.push(r.fico_score);
    if (r.ltv_ratio != null) allEntry.ltv.push(r.ltv_ratio);
    if (r.be_dti_ratio != null) allEntry.dti.push(r.be_dti_ratio);
    if (r.days_active != null) allEntry.days_active.push(r.days_active);
    if (r.market_delta != null) allEntry.market_delta.push(r.market_delta);
  }

  const featureRows: FeatureRow[] = [];
  for (const [key, data] of agg) {
    const parts = key.split('|');
    const recency_bucket = parts[4] ?? RECENCY_BUCKET_OLDER;
    const [status_type, loan_type, loan_purpose, occupancy] = parts;
    const status = status_type as OutcomeProfileStatusType;
    const features =
      status === 'Withdrawn'
        ? FEATURES_WITHDRAWN
        : status === 'Originated'
          ? (FEATURES_ORIGINATED as readonly string[])
          : (FEATURES_DENIED as readonly string[]);

    for (const f of features) {
      let arr: number[] = [];
      if (f === 'fico_score') arr = data.fico;
      else if (f === 'ltv_ratio') arr = data.ltv;
      else if (f === 'be_dti_ratio') arr = data.dti;
      else if (f === 'days_active') arr = data.days_active;
      else if (f === 'market_delta') arr = data.market_delta;

      if (arr.length === 0) continue;
      const sorted = [...arr].sort((a, b) => a - b);
      if (sorted.length < MIN_SAMPLE_SIZE) continue; // only save profile when we have enough loans
      const mean = sorted.reduce((s, x) => s + x, 0) / sorted.length;
      const q1 = quantile(sorted, 0.25);
      const q3 = quantile(sorted, 0.75);
      const iqr = q1 != null && q3 != null ? q3 - q1 : null;
      const p10 = quantile(sorted, 0.1);
      const p15 = quantile(sorted, 0.15);
      const p20 = quantile(sorted, 0.2);
      const p30 = quantile(sorted, 0.3);
      const p35 = quantile(sorted, 0.35);
      const p40 = quantile(sorted, 0.4);
      const p45 = quantile(sorted, 0.45);
      const p55 = quantile(sorted, 0.55);
      const p60 = quantile(sorted, 0.6);
      const p65 = quantile(sorted, 0.65);
      const p70 = quantile(sorted, 0.7);
      const p75 = quantile(sorted, 0.75);
      const p80 = quantile(sorted, 0.8);
      const p90 = quantile(sorted, 0.9);
      featureRows.push({
        year: currentYear,
        status_type: status,
        loan_type: loan_type!,
        loan_purpose: loan_purpose!,
        occupancy: occupancy!,
        feature_name: f,
        recency_bucket,
        mean_value: mean,
        q1_value: q1 ?? null,
        q3_value: q3 ?? null,
        iqr_value: iqr,
        p10_value: p10 ?? null,
        p15_value: p15 ?? null,
        p20_value: p20 ?? null,
        p30_value: p30 ?? null,
        p35_value: p35 ?? null,
        p40_value: p40 ?? null,
        p45_value: p45 ?? null,
        p55_value: p55 ?? null,
        p60_value: p60 ?? null,
        p65_value: p65 ?? null,
        p70_value: p70 ?? null,
        p75_value: p75 ?? null,
        p80_value: p80 ?? null,
        p90_value: p90 ?? null,
        sample_size: sorted.length,
        low_confidence: sorted.length < MIN_SAMPLE_SIZE,
      });
    }
  }

  // Fallback profiles: one per (status_type, loan_type, loan_purpose, recency_bucket) with occupancy='All' (type + purpose fallback)
  // Require MIN_SAMPLE_SIZE so we do not persist e.g. Denied|VA|NoCash-Out Refinance|All with only 1 loan; use loan-type-only fallback instead.
  for (const [key, data] of aggByLoanTypePurpose) {
    const parts = key.split('|');
    const recency_bucket = parts[3] ?? RECENCY_BUCKET_OLDER;
    const [status_type, loan_type, loan_purpose] = parts;
    const status = status_type as OutcomeProfileStatusType;
    const features =
      status === 'Withdrawn'
        ? FEATURES_WITHDRAWN
        : status === 'Originated'
          ? (FEATURES_ORIGINATED as readonly string[])
          : (FEATURES_DENIED as readonly string[]);

    for (const f of features) {
      let arr: number[] = [];
      if (f === 'fico_score') arr = data.fico;
      else if (f === 'ltv_ratio') arr = data.ltv;
      else if (f === 'be_dti_ratio') arr = data.dti;
      else if (f === 'days_active') arr = data.days_active;
      else if (f === 'market_delta') arr = data.market_delta;

      if (arr.length === 0) continue;
      const sorted = [...arr].sort((a, b) => a - b);
      if (sorted.length < MIN_SAMPLE_SIZE) continue;
      const mean = sorted.reduce((s, x) => s + x, 0) / sorted.length;
      const q1 = quantile(sorted, 0.25);
      const q3 = quantile(sorted, 0.75);
      const iqr = q1 != null && q3 != null ? q3 - q1 : null;
      const p10 = quantile(sorted, 0.1);
      const p15 = quantile(sorted, 0.15);
      const p20 = quantile(sorted, 0.2);
      const p30 = quantile(sorted, 0.3);
      const p35 = quantile(sorted, 0.35);
      const p40 = quantile(sorted, 0.4);
      const p45 = quantile(sorted, 0.45);
      const p55 = quantile(sorted, 0.55);
      const p60 = quantile(sorted, 0.6);
      const p65 = quantile(sorted, 0.65);
      const p70 = quantile(sorted, 0.7);
      const p75 = quantile(sorted, 0.75);
      const p80 = quantile(sorted, 0.8);
      const p90 = quantile(sorted, 0.9);
      featureRows.push({
        year: currentYear,
        status_type: status,
        loan_type: loan_type!,
        loan_purpose: loan_purpose!,
        occupancy: 'All',
        feature_name: f,
        recency_bucket,
        mean_value: mean,
        q1_value: q1 ?? null,
        q3_value: q3 ?? null,
        iqr_value: iqr,
        p10_value: p10 ?? null,
        p15_value: p15 ?? null,
        p20_value: p20 ?? null,
        p30_value: p30 ?? null,
        p35_value: p35 ?? null,
        p40_value: p40 ?? null,
        p45_value: p45 ?? null,
        p55_value: p55 ?? null,
        p60_value: p60 ?? null,
        p65_value: p65 ?? null,
        p70_value: p70 ?? null,
        p75_value: p75 ?? null,
        p80_value: p80 ?? null,
        p90_value: p90 ?? null,
        sample_size: sorted.length,
        low_confidence: true, // type+purpose fallback profile
      });
    }
  }

  // Fallback profiles: one per (status_type, loan_type, recency_bucket) with loan_purpose='All', occupancy='All'
  for (const [key, data] of aggByLoanType) {
    const parts = key.split('|');
    const recency_bucket = parts[2] ?? RECENCY_BUCKET_OLDER;
    const [status_type, loan_type] = parts;
    const status = status_type as OutcomeProfileStatusType;
    const features =
      status === 'Withdrawn'
        ? FEATURES_WITHDRAWN
        : status === 'Originated'
          ? (FEATURES_ORIGINATED as readonly string[])
          : (FEATURES_DENIED as readonly string[]);

    for (const f of features) {
      let arr: number[] = [];
      if (f === 'fico_score') arr = data.fico;
      else if (f === 'ltv_ratio') arr = data.ltv;
      else if (f === 'be_dti_ratio') arr = data.dti;
      else if (f === 'days_active') arr = data.days_active;
      else if (f === 'market_delta') arr = data.market_delta;

      if (arr.length === 0) continue;
      const sorted = [...arr].sort((a, b) => a - b);
      if (sorted.length < MIN_SAMPLE_SIZE_FALLBACK) continue;
      const mean = sorted.reduce((s, x) => s + x, 0) / sorted.length;
      const q1 = quantile(sorted, 0.25);
      const q3 = quantile(sorted, 0.75);
      const iqr = q1 != null && q3 != null ? q3 - q1 : null;
      const p10 = quantile(sorted, 0.1);
      const p15 = quantile(sorted, 0.15);
      const p20 = quantile(sorted, 0.2);
      const p30 = quantile(sorted, 0.3);
      const p35 = quantile(sorted, 0.35);
      const p40 = quantile(sorted, 0.4);
      const p45 = quantile(sorted, 0.45);
      const p55 = quantile(sorted, 0.55);
      const p60 = quantile(sorted, 0.6);
      const p65 = quantile(sorted, 0.65);
      const p70 = quantile(sorted, 0.7);
      const p75 = quantile(sorted, 0.75);
      const p80 = quantile(sorted, 0.8);
      const p90 = quantile(sorted, 0.9);
      featureRows.push({
        year: currentYear,
        status_type: status,
        loan_type: loan_type!,
        loan_purpose: 'All',
        occupancy: 'All',
        feature_name: f,
        recency_bucket,
        mean_value: mean,
        q1_value: q1 ?? null,
        q3_value: q3 ?? null,
        iqr_value: iqr,
        p10_value: p10 ?? null,
        p15_value: p15 ?? null,
        p20_value: p20 ?? null,
        p30_value: p30 ?? null,
        p35_value: p35 ?? null,
        p40_value: p40 ?? null,
        p45_value: p45 ?? null,
        p55_value: p55 ?? null,
        p60_value: p60 ?? null,
        p65_value: p65 ?? null,
        p70_value: p70 ?? null,
        p75_value: p75 ?? null,
        p80_value: p80 ?? null,
        p90_value: p90 ?? null,
        sample_size: sorted.length,
        low_confidence: true, // fallback profile
      });
    }
  }

  // Global fallback: All|All|All per recency_bucket so unknown loan types still get deny/withdraw feature means and zones.
  for (const [key, data] of aggAll) {
    const parts = key.split('|');
    const recency_bucket = parts[1] ?? RECENCY_BUCKET_OLDER;
    const [status_type] = parts;
    const status = status_type as OutcomeProfileStatusType;
    const features =
      status === 'Withdrawn'
        ? FEATURES_WITHDRAWN
        : status === 'Originated'
          ? (FEATURES_ORIGINATED as readonly string[])
          : (FEATURES_DENIED as readonly string[]);

    for (const f of features) {
      let arr: number[] = [];
      if (f === 'fico_score') arr = data.fico;
      else if (f === 'ltv_ratio') arr = data.ltv;
      else if (f === 'be_dti_ratio') arr = data.dti;
      else if (f === 'days_active') arr = data.days_active;
      else if (f === 'market_delta') arr = data.market_delta;

      if (arr.length === 0) continue;
      const sorted = [...arr].sort((a, b) => a - b);
      if (sorted.length < MIN_SAMPLE_SIZE) continue;
      const mean = sorted.reduce((s, x) => s + x, 0) / sorted.length;
      const q1 = quantile(sorted, 0.25);
      const q3 = quantile(sorted, 0.75);
      const iqr = q1 != null && q3 != null ? q3 - q1 : null;
      const p10 = quantile(sorted, 0.1);
      const p15 = quantile(sorted, 0.15);
      const p20 = quantile(sorted, 0.2);
      const p30 = quantile(sorted, 0.3);
      const p35 = quantile(sorted, 0.35);
      const p40 = quantile(sorted, 0.4);
      const p45 = quantile(sorted, 0.45);
      const p55 = quantile(sorted, 0.55);
      const p60 = quantile(sorted, 0.6);
      const p65 = quantile(sorted, 0.65);
      const p70 = quantile(sorted, 0.7);
      const p75 = quantile(sorted, 0.75);
      const p80 = quantile(sorted, 0.8);
      const p90 = quantile(sorted, 0.9);
      featureRows.push({
        year: currentYear,
        status_type: status,
        loan_type: 'All',
        loan_purpose: 'All',
        occupancy: 'All',
        feature_name: f,
        recency_bucket,
        mean_value: mean,
        q1_value: q1 ?? null,
        q3_value: q3 ?? null,
        iqr_value: iqr,
        p10_value: p10 ?? null,
        p15_value: p15 ?? null,
        p20_value: p20 ?? null,
        p30_value: p30 ?? null,
        p35_value: p35 ?? null,
        p40_value: p40 ?? null,
        p45_value: p45 ?? null,
        p55_value: p55 ?? null,
        p60_value: p60 ?? null,
        p65_value: p65 ?? null,
        p70_value: p70 ?? null,
        p75_value: p75 ?? null,
        p80_value: p80 ?? null,
        p90_value: p90 ?? null,
        sample_size: sorted.length,
        low_confidence: true, // global fallback profile
      });
    }
  }

  const calculatedAt = new Date();
  let rowsInserted = 0;

  // Replace all profile data (one set per recency bucket; year column = current year for compatibility)
  await pool.query(`DELETE FROM public.outcome_numeric_risk_profiles WHERE year >= $1`, [START_YEAR]);

  for (const r of featureRows) {
    try {
      await pool.query(
        `INSERT INTO public.outcome_numeric_risk_profiles
         (year, status_type, loan_type, loan_purpose, occupancy, feature_name, recency_bucket, mean_value, q1_value, q3_value, iqr_value, p10_value, p15_value, p20_value, p30_value, p35_value, p40_value, p45_value, p55_value, p60_value, p65_value, p70_value, p75_value, p80_value, p90_value, sample_size, low_confidence, calculated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28)`,
        [
          r.year,
          r.status_type,
          r.loan_type,
          r.loan_purpose,
          r.occupancy,
          r.feature_name,
          r.recency_bucket,
          r.mean_value,
          r.q1_value,
          r.q3_value,
          r.iqr_value,
          r.p10_value,
          r.p15_value,
          r.p20_value,
          r.p30_value,
          r.p35_value,
          r.p40_value,
          r.p45_value,
          r.p55_value,
          r.p60_value,
          r.p65_value,
          r.p70_value,
          r.p75_value,
          r.p80_value,
          r.p90_value,
          r.sample_size,
          r.low_confidence,
          calculatedAt,
        ]
      );
      rowsInserted++;
    } catch (err: any) {
      logError('numericOutcomeProfileService: insert failed', err, { row: r });
    }
  }

  logInfo('Numeric outcome profile derivation completed', {
    rowsInserted,
    yearsProcessed: [currentYear],
    segmentsCount: segments.length,
    recencyBuckets: '<=180 days, >180 days (per outcome | segment | feature)',
  });
  return { rowsInserted, yearsProcessed: [currentYear] };
}
