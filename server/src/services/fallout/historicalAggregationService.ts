/**
 * Historical fallout rates for the numeric outcome sequencer.
 * Computes denied/withdrawn rates from completed loans (3-year window) for threshold calibration.
 */

import pg from 'pg';

/**
 * Compute historical denied and withdrawn rates from completed loans (same 3-year window).
 * Used to project denied_count = deniedRate * active_count, withdrawn_count = withdrawnRate * remaining.
 */
export async function getHistoricalFalloutRates(pool: pg.Pool): Promise<{ deniedRate: number; withdrawnRate: number; totalCompleted: number }> {
  const endYear = new Date().getFullYear();
  const startDate = new Date(endYear - 2, 0, 1);
  const startDateStr = startDate.toISOString().split('T')[0];
  const countResult = await pool.query(
    `SELECT current_loan_status FROM public.loans
     WHERE application_date IS NOT NULL AND application_date::date >= $1
       AND (current_loan_status IS NULL OR current_loan_status != 'Active Loan')`,
    [startDateStr]
  );
  let denied = 0;
  let withdrawn = 0;
  for (const row of countResult.rows) {
    const status = (row.current_loan_status ?? '').toString().trim().toUpperCase();
    if (status === 'APPLICATION WITHDRAWN' || status === 'WITHDRAWN' || status === 'APPLICATION APPROVED BUT NOT ACCEPTED' ||
        status === 'FILE CLOSED FOR INCOMPLETENESS' || status === 'PREAPPROVAL REQUEST APPROVED BUT NOT ACCEPTED') {
      withdrawn++;
    } else if (status === 'APPLICATION DENIED' || status === 'DENIED' || status === 'DECLINED' ||
        status === 'PREAPPROVAL REQUEST DENIED BY FINANCIAL INSTITUTION') {
      denied++;
    }
  }
  const totalCompleted = countResult.rows.length;
  const deniedRate = totalCompleted > 0 ? denied / totalCompleted : 0.1;
  const withdrawnRate = totalCompleted > 0 ? withdrawn / totalCompleted : 0.15;
  return { deniedRate, withdrawnRate, totalCompleted };
}
