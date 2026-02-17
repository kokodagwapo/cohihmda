/**
 * Human Pattern Service (BRD Phase 5)
 *
 * Computes role-based propensity (deny/withdraw/close-late rate) and velocity (avg_days_to_fund)
 * per Loan Officer, Processor, Underwriter, Closer. risk_multiplier = role_rate / tenant_rate, capped 0.75–1.5.
 * Persists to human_pattern_stats.
 */

import pg from 'pg';
import { logInfo } from '../logger.js';
import type { FalloutStatusType, HumanRoleType } from './falloutTypes.js';

const MULTIPLIER_MIN = 0.75;
const MULTIPLIER_MAX = 1.5;
const WINDOW_DAYS_OVERALL = 365;
const WINDOW_DAYS_RECENT = 90;

/** DB column / role_type mapping */
const ROLE_FIELDS: { roleType: HumanRoleType; idField: string; nameField: string }[] = [
  { roleType: 'LO', idField: 'loan_officer_id', nameField: 'loan_officer' },
  { roleType: 'Processor', idField: 'loan_processor_id', nameField: 'processor' },
  { roleType: 'Underwriter', idField: 'underwriter_id', nameField: 'underwriter' },
  { roleType: 'Closer', idField: 'closer_id', nameField: 'closer' },
];

/**
 * Classify loan into Denied, Withdrawn, ClosingLate (same as historicalAggregationService).
 */
function classifyStatus(row: any): FalloutStatusType | 'FundedOnTime' | null {
  const status = (row.current_loan_status ?? '').toString().trim().toUpperCase();
  if (!status || status === 'ACTIVE LOAN' || status === 'ACTIVE' || status === 'INQUIRY') return null;
  if (status === 'APPLICATION WITHDRAWN' || status === 'APPLICATION APPROVED BUT NOT ACCEPTED' ||
      status === 'FILE CLOSED FOR INCOMPLETENESS' || status === 'PREAPPROVAL REQUEST APPROVED BUT NOT ACCEPTED' || status === 'WITHDRAWN') {
    return 'Withdrawn';
  }
  if (status === 'APPLICATION DENIED' || status === 'PREAPPROVAL REQUEST DENIED BY FINANCIAL INSTITUTION' || status === 'DENIED' || status === 'DECLINED') {
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

/**
 * Load completed loans with role and date fields.
 */
async function loadLoansForHumanPatterns(pool: pg.Pool): Promise<any[]> {
  const endDate = new Date();
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - WINDOW_DAYS_OVERALL);
  const q = `
    SELECT
      loan_id, current_loan_status, application_date, funding_date, estimated_closing_date, closing_date,
      loan_officer_id, loan_officer, loan_processor_id, processor, underwriter_id, underwriter, closer_id, closer
    FROM public.loans
    WHERE application_date IS NOT NULL AND application_date::date >= $1
      AND (current_loan_status IS NULL OR current_loan_status != 'Active Loan')
  `;
  const result = await pool.query(q, [startDate.toISOString().split('T')[0]]);
  return result.rows;
}

function getRoleId(row: any, role: typeof ROLE_FIELDS[0]): string {
  const id = row[role.idField] ?? row[role.nameField];
  return (id ?? 'Unknown').toString().trim() || 'Unknown';
}

function daysToFund(row: any): number | null {
  const end = row.funding_date ?? row.fund_date ?? row.closing_date ?? row.closing_date;
  if (!end) return null;
  const app = row.application_date;
  if (!app) return null;
  const endD = end instanceof Date ? end : new Date(end);
  const appD = app instanceof Date ? app : new Date(app);
  if (isNaN(endD.getTime()) || isNaN(appD.getTime())) return null;
  const days = Math.floor((endD.getTime() - appD.getTime()) / (1000 * 60 * 60 * 24));
  return (days > 0 && days < 365) ? days : null;
}

/**
 * Run human pattern stats and persist to human_pattern_stats.
 */
export async function runHumanPatternStats(pool: pg.Pool): Promise<{ inserted: number }> {
  const startMs = Date.now();
  const rows = await loadLoansForHumanPatterns(pool);

  const tenantDenied = rows.filter((r) => classifyStatus(r) === 'Denied').length;
  const tenantWithdrawn = rows.filter((r) => classifyStatus(r) === 'Withdrawn').length;
  const tenantClosingLate = rows.filter((r) => classifyStatus(r) === 'ClosingLate').length;
  const tenantTotal = rows.length;
  const tenantRates: Record<FalloutStatusType, number> = {
    Denied: tenantTotal > 0 ? tenantDenied / tenantTotal : 0,
    Withdrawn: tenantTotal > 0 ? tenantWithdrawn / tenantTotal : 0,
    ClosingLate: tenantTotal > 0 ? tenantClosingLate / tenantTotal : 0,
  };

  const tenantAvgDays = (() => {
    const funded = rows.filter((r) => classifyStatus(r) === 'FundedOnTime' || classifyStatus(r) === 'ClosingLate');
    const days = funded.map(daysToFund).filter((d): d is number => d != null);
    return days.length > 0 ? days.reduce((s, d) => s + d, 0) / days.length : 0;
  })();

  const calculatedAt = new Date();
  await pool.query('DELETE FROM public.human_pattern_stats');

  let inserted = 0;

  for (const roleDef of ROLE_FIELDS) {
    const byRoleId = new Map<string, { denied: number; withdrawn: number; closingLate: number; total: number; daysToFund: number[] }>();

    for (const row of rows) {
      const roleId = getRoleId(row, roleDef);
      if (!byRoleId.has(roleId)) {
        byRoleId.set(roleId, { denied: 0, withdrawn: 0, closingLate: 0, total: 0, daysToFund: [] });
      }
      const rec = byRoleId.get(roleId)!;
      rec.total++;
      const status = classifyStatus(row);
      if (status === 'Denied') rec.denied++;
      else if (status === 'Withdrawn') rec.withdrawn++;
      else if (status === 'ClosingLate') rec.closingLate++;
      const d = daysToFund(row);
      if (d != null) rec.daysToFund.push(d);
    }

    for (const [role_id, rec] of byRoleId) {
      if (rec.total < 5) continue;

      for (const status_type of ['Denied', 'Withdrawn', 'ClosingLate'] as FalloutStatusType[]) {
        let count = 0;
        if (status_type === 'Denied') count = rec.denied;
        else if (status_type === 'Withdrawn') count = rec.withdrawn;
        else count = rec.closingLate;
        const rate = rec.total > 0 ? count / rec.total : 0;
        const tenantRate = tenantRates[status_type] || 0.001;
        let risk_multiplier = tenantRate > 0 ? rate / tenantRate : 1;
        risk_multiplier = Math.max(MULTIPLIER_MIN, Math.min(MULTIPLIER_MAX, risk_multiplier));

        const avg_days_to_fund =
          rec.daysToFund.length > 0
            ? rec.daysToFund.reduce((s, d) => s + d, 0) / rec.daysToFund.length
            : null;

        await pool.query(
          `INSERT INTO public.human_pattern_stats (role_type, role_id, status_type, loan_count, rate, avg_days_to_fund, risk_multiplier, window_days, calculated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [roleDef.roleType, role_id, status_type, rec.total, rate, avg_days_to_fund, risk_multiplier, WINDOW_DAYS_OVERALL, calculatedAt]
        );
        inserted++;
      }
    }
  }

  const elapsed = Date.now() - startMs;
  logInfo('Human pattern stats persisted', { inserted, elapsedMs: elapsed });
  return { inserted };
}
