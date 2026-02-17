/**
 * Turn-Time Projection Service
 *
 * Lookup avg_days_to_fund from turn_time_baselines (or fallback from loans) for projected_funding_date
 * and Closing Late classification in the fallout sequencer.
 */

import pg from 'pg';
import type { MilestoneType } from './falloutTypes.js';

const DEFAULT_SEGMENT_KEY = 'All';

/**
 * Average days from application_date to funding (or closing) across all historical funded loans.
 * Used as fallback for projected_funding_date when milestone or turn-time baseline is missing.
 */
export async function getAvgApplicationToFundingDays(pool: pg.Pool): Promise<number | null> {
  const result = await pool.query(
    `SELECT AVG(EXTRACT(EPOCH FROM (funding_date::date - application_date::date)) / 86400) AS avg_days
     FROM public.loans
     WHERE application_date IS NOT NULL
       AND funding_date IS NOT NULL
       AND (current_loan_status IS NULL OR current_loan_status NOT IN ('Active Loan', 'Active', 'Inquiry'))`
  );
  if (result.rows.length === 0 || result.rows[0].avg_days == null) return null;
  const days = Number(result.rows[0].avg_days);
  return Number.isFinite(days) && days > 0 && days < 365 * 2 ? Math.round(days) : null;
}

/**
 * Lookup avg_days_to_fund for a segment and milestone.
 * Fallback order: exact segment → loan_type|All|All → All.
 */
export async function getTurnTimeBaseline(
  pool: pg.Pool,
  segment_key: string,
  milestone_type: MilestoneType
): Promise<number | null> {
  let r = await pool.query(
    `SELECT avg_days_to_fund FROM public.turn_time_baselines WHERE segment_key = $1 AND milestone_type = $2`,
    [segment_key, milestone_type]
  );
  if (r.rows.length === 0 && segment_key !== DEFAULT_SEGMENT_KEY) {
    const loanType = segment_key.split('|')[0] ?? 'Unknown';
    const fallbackKey = `${loanType}|All|All`;
    if (fallbackKey !== segment_key) {
      r = await pool.query(
        `SELECT avg_days_to_fund FROM public.turn_time_baselines WHERE segment_key = $1 AND milestone_type = $2`,
        [fallbackKey, milestone_type]
      );
    }
    if (r.rows.length === 0) {
      r = await pool.query(
        `SELECT avg_days_to_fund FROM public.turn_time_baselines WHERE segment_key = $1 AND milestone_type = $2`,
        [DEFAULT_SEGMENT_KEY, milestone_type]
      );
    }
  }
  if (r.rows.length === 0) return null;
  const v = r.rows[0].avg_days_to_fund;
  return v != null ? Number(v) : null;
}
