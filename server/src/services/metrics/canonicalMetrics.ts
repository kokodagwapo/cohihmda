/**
 * Canonical Metrics Service
 *
 * Shared, authoritative metric computation used by both the Insights pipeline
 * and the Workbench / Chat AI system.  A single source of truth for:
 *
 *  - Pull-Through Rate  (funded / completed * 100)
 *  - Fallout Rate        ((completed - funded) / completed * 100)
 *  - Cycle Time          avg days from application to close for funded loans
 *  - Funded Volume       total loan_amount of funded loans
 *  - Funded Revenue      total tenant-specific revenue expression of funded loans
 *  - Units               count of funded loans
 *
 * All metrics share the same SQL so PT + Fallout = 100% in every window.
 */

import pg from "pg";
import {
  buildChannelWhereClause,
  getTenantRevenueExpression,
} from "../../utils/scorecard-utils.js";

// ============================================================================
// Types
// ============================================================================

/** Unified period snapshot — all key metrics from one SQL query for one time window. */
export interface PeriodSnapshot {
  window: string;          // "ytd" | "90d" | "60d" | "30d" | "mtd"
  start: string;
  end: string;
  totalApplications: number;
  completed: number;       // loans that have finished lifecycle (non-active)
  funded: number;          // subset of completed that were funded/closed
  locked: number;
  fundedVolume: number;
  fundedRevenue: number;
  avgCycleTime: number;
  pullThroughRate: number; // funded / completed * 100
  falloutRate: number;     // (completed - funded) / completed * 100
}

export interface DateRange {
  start: string;
  end: string;
}

// ============================================================================
// Date Ranges
// ============================================================================

/**
 * Standard date ranges used across insights and workbench metrics.
 */
export function getStandardDateRanges(): {
  today: DateRange;
  mtd: DateRange;
  ytd: DateRange;
  rolling90D: DateRange;
  rolling60D: DateRange;
  trailing30: DateRange;
  lastMonth: DateRange;
  lastYear: DateRange;
  prior30: DateRange;
  prior60: DateRange;
  prior90: DateRange;
} {
  const now = new Date();
  const today = now.toISOString().split("T")[0];
  const DAY = 24 * 60 * 60 * 1000;
  const toDate = (d: Date) => d.toISOString().split("T")[0];

  const startOfMonth = toDate(new Date(now.getFullYear(), now.getMonth(), 1));
  const startOfYear = toDate(new Date(now.getFullYear(), 0, 1));

  const rolling90Start = toDate(new Date(now.getTime() - 90 * DAY));
  const rolling60Start = toDate(new Date(now.getTime() - 60 * DAY));
  const trailing30Start = toDate(new Date(now.getTime() - 30 * DAY));

  const prior30Start = toDate(new Date(now.getTime() - 60 * DAY));
  const prior30End = toDate(new Date(now.getTime() - 31 * DAY));
  const prior60Start = toDate(new Date(now.getTime() - 120 * DAY));
  const prior60End = toDate(new Date(now.getTime() - 61 * DAY));
  const prior90Start = toDate(new Date(now.getTime() - 180 * DAY));
  const prior90End = toDate(new Date(now.getTime() - 91 * DAY));

  const lastMonthEnd = toDate(new Date(now.getFullYear(), now.getMonth(), 0));
  const lastMonthStart = toDate(new Date(now.getFullYear(), now.getMonth() - 1, 1));

  const lastYearStart = toDate(new Date(now.getFullYear() - 1, 0, 1));
  const lastYearEnd = toDate(new Date(now.getFullYear() - 1, now.getMonth(), now.getDate()));

  return {
    today: { start: today, end: today },
    mtd: { start: startOfMonth, end: today },
    ytd: { start: startOfYear, end: today },
    rolling90D: { start: rolling90Start, end: today },
    rolling60D: { start: rolling60Start, end: today },
    trailing30: { start: trailing30Start, end: today },
    lastMonth: { start: lastMonthStart, end: lastMonthEnd },
    lastYear: { start: lastYearStart, end: lastYearEnd },
    prior30: { start: prior30Start, end: prior30End },
    prior60: { start: prior60Start, end: prior60End },
    prior90: { start: prior90Start, end: prior90End },
  };
}

// ============================================================================
// Core Metric Computation
// ============================================================================

/**
 * Compute a PeriodSnapshot for a given time window using a single SQL query.
 *
 * Guarantees: pullThroughRate + falloutRate = 100% (both use `completed` as denominator).
 */
export async function computePeriodSnapshot(
  tenantPool: pg.Pool,
  windowName: string,
  start: string,
  end: string,
  revenueExpr: string,
  channelGroup?: string
): Promise<PeriodSnapshot> {
  const channelClause = buildChannelWhereClause(channelGroup);
  const closeDateExpr = "COALESCE(funding_date::date, closing_date)";

  try {
    const result = await tenantPool.query(
      `SELECT
        COUNT(*) as total_apps,
        COUNT(CASE WHEN current_loan_status NOT IN ('Active Loan','active','locked','submitted','approved')
          THEN 1 END) as completed,
        COUNT(CASE WHEN (funding_date IS NOT NULL OR closing_date IS NOT NULL OR investor_purchase_date IS NOT NULL)
          AND current_loan_status NOT IN ('Active Loan','active','locked','submitted','approved')
          THEN 1 END) as funded,
        SUM(CASE WHEN (funding_date IS NOT NULL OR closing_date IS NOT NULL)
          THEN loan_amount ELSE 0 END) as funded_volume,
        SUM(CASE WHEN (funding_date IS NOT NULL OR closing_date IS NOT NULL)
          THEN (${revenueExpr}) ELSE 0 END) as funded_revenue,
        AVG(CASE WHEN (funding_date IS NOT NULL OR closing_date IS NOT NULL)
          THEN ${closeDateExpr} - application_date END) as avg_cycle_days,
        COUNT(CASE WHEN lock_date IS NOT NULL THEN 1 END) as locked
      FROM public.loans
      WHERE application_date >= $1 AND application_date <= $2
        ${channelClause}`,
      [start, end]
    );

    const row = result.rows[0];
    const completed = parseInt(row?.completed) || 0;
    const funded = parseInt(row?.funded) || 0;

    const snapshot: PeriodSnapshot = {
      window: windowName,
      start,
      end,
      totalApplications: parseInt(row?.total_apps) || 0,
      completed,
      funded,
      locked: parseInt(row?.locked) || 0,
      fundedVolume: parseFloat(row?.funded_volume) || 0,
      fundedRevenue: parseFloat(row?.funded_revenue) || 0,
      avgCycleTime: Math.round(parseFloat(row?.avg_cycle_days) || 0),
      pullThroughRate: completed > 0 ? Math.round((funded / completed) * 1000) / 10 : 0,
      falloutRate: completed > 0 ? Math.round(((completed - funded) / completed) * 1000) / 10 : 0,
    };

    console.log(
      `[CanonicalMetrics] Snapshot "${windowName}" (${start}→${end}): ` +
      `apps=${snapshot.totalApplications}, completed=${completed}, funded=${funded}, ` +
      `PT=${snapshot.pullThroughRate}%, Fallout=${snapshot.falloutRate}%, ` +
      `Vol=$${Math.round(snapshot.fundedVolume)}, Rev=$${Math.round(snapshot.fundedRevenue)}, ` +
      `Cycle=${snapshot.avgCycleTime}d`
    );

    return snapshot;
  } catch (error) {
    console.error(`[CanonicalMetrics] Error computing period snapshot for ${windowName}:`, error);
    return {
      window: windowName, start, end,
      totalApplications: 0, completed: 0, funded: 0, locked: 0,
      fundedVolume: 0, fundedRevenue: 0, avgCycleTime: 0,
      pullThroughRate: 0, falloutRate: 0,
    };
  }
}

/**
 * Compute all 10 standard period snapshots in parallel.
 * Returns a keyed object matching the InsightMetricsPayload.periodSnapshots shape.
 */
export async function computeAllPeriodSnapshots(
  tenantPool: pg.Pool,
  revenueExpr: string,
  channelGroup?: string
): Promise<{
  ytd: PeriodSnapshot;
  rolling90d: PeriodSnapshot;
  rolling60d: PeriodSnapshot;
  rolling30d: PeriodSnapshot;
  mtd: PeriodSnapshot;
  priorYtd: PeriodSnapshot;
  prior90d: PeriodSnapshot;
  prior60d: PeriodSnapshot;
  prior30d: PeriodSnapshot;
  priorMtd: PeriodSnapshot;
}> {
  const dr = getStandardDateRanges();

  const [ytd, rolling90d, rolling60d, rolling30d, mtd, priorYtd, prior90d, prior60d, prior30d, priorMtd] =
    await Promise.all([
      computePeriodSnapshot(tenantPool, "ytd", dr.ytd.start, dr.ytd.end, revenueExpr, channelGroup),
      computePeriodSnapshot(tenantPool, "90d", dr.rolling90D.start, dr.rolling90D.end, revenueExpr, channelGroup),
      computePeriodSnapshot(tenantPool, "60d", dr.rolling60D.start, dr.rolling60D.end, revenueExpr, channelGroup),
      computePeriodSnapshot(tenantPool, "30d", dr.trailing30.start, dr.trailing30.end, revenueExpr, channelGroup),
      computePeriodSnapshot(tenantPool, "mtd", dr.mtd.start, dr.mtd.end, revenueExpr, channelGroup),
      computePeriodSnapshot(tenantPool, "prior_ytd", dr.lastYear.start, dr.lastYear.end, revenueExpr, channelGroup),
      computePeriodSnapshot(tenantPool, "prior_90d", dr.prior90.start, dr.prior90.end, revenueExpr, channelGroup),
      computePeriodSnapshot(tenantPool, "prior_60d", dr.prior60.start, dr.prior60.end, revenueExpr, channelGroup),
      computePeriodSnapshot(tenantPool, "prior_30d", dr.prior30.start, dr.prior30.end, revenueExpr, channelGroup),
      computePeriodSnapshot(tenantPool, "prior_mtd", dr.lastMonth.start, dr.lastMonth.end, revenueExpr, channelGroup),
    ]);

  return { ytd, rolling90d, rolling60d, rolling30d, mtd, priorYtd, prior90d, prior60d, prior30d, priorMtd };
}

// ============================================================================
// Verified SQL Snippets (for injection into Workbench LLM context)
// ============================================================================

/**
 * Returns a block of verified SQL snippets that the workbench LLM can reference
 * when generating queries. This ensures the chat produces numbers consistent
 * with the insights pipeline.
 */
export function getVerifiedMetricsSQL(revenueExpr: string): string {
  return `
## VERIFIED METRICS SQL (CRITICAL — use these exact formulas for consistency with Cohi Insights)

### Pull-Through Rate
Definition: funded loans / completed loans * 100.  "Completed" = loans NOT in active statuses.
\`\`\`sql
-- Pull-Through Rate (for a given date range, replace $START / $END)
SELECT
  COUNT(CASE WHEN (l.funding_date IS NOT NULL OR l.closing_date IS NOT NULL OR l.investor_purchase_date IS NOT NULL)
    AND l.current_loan_status NOT IN ('Active Loan','active','locked','submitted','approved')
    THEN 1 END) * 100.0
  / NULLIF(COUNT(CASE WHEN l.current_loan_status NOT IN ('Active Loan','active','locked','submitted','approved')
    THEN 1 END), 0)  AS pull_through_rate
FROM public.loans l
WHERE l.application_date >= $START AND l.application_date <= $END
\`\`\`

### Fallout Rate
Definition: 100% - Pull-Through Rate.  (completed - funded) / completed * 100.
Always complementary to pull-through — they MUST sum to 100%.

### Revenue (Gain-on-Sale)
Definition: tenant-specific formula, NOT the same as loan volume.
Revenue is typically in $thousands, volume is in $millions. Never confuse them.
\`\`\`sql
-- Revenue per loan
SELECT SUM(
  CASE WHEN (l.funding_date IS NOT NULL OR l.closing_date IS NOT NULL)
  THEN (${revenueExpr}) ELSE 0 END
) AS total_revenue
FROM public.loans l
WHERE l.application_date >= $START AND l.application_date <= $END
\`\`\`

### Funded Volume
Definition: total loan_amount of loans that have a funding/closing date.
\`\`\`sql
SELECT SUM(
  CASE WHEN (l.funding_date IS NOT NULL OR l.closing_date IS NOT NULL)
  THEN l.loan_amount ELSE 0 END
) AS funded_volume
FROM public.loans l
WHERE l.application_date >= $START AND l.application_date <= $END
\`\`\`

### Cycle Time
Definition: average days from application_date to close date for funded loans.
\`\`\`sql
SELECT AVG(COALESCE(l.funding_date::date, l.closing_date) - l.application_date) AS avg_cycle_days
FROM public.loans l
WHERE (l.funding_date IS NOT NULL OR l.closing_date IS NOT NULL)
  AND l.application_date >= $START AND l.application_date <= $END
\`\`\`

### Revenue BPS (Basis Points)
Definition: (revenue / volume) * 10000. Measures margin per dollar of volume.
\`\`\`sql
SELECT
  CASE WHEN SUM(l.loan_amount) > 0
    THEN (SUM(${revenueExpr}) / SUM(l.loan_amount)) * 10000
    ELSE 0
  END AS revenue_bps
FROM public.loans l
WHERE (l.funding_date IS NOT NULL OR l.closing_date IS NOT NULL)
  AND l.application_date >= $START AND l.application_date <= $END
\`\`\`

### Monthly Trend Template (use for all "trend over time" / "by month" requests)
When asked for monthly trends of ANY metric, use this pattern:
\`\`\`sql
SELECT
  DATE_TRUNC('month', l.application_date) AS sort_period,
  TO_CHAR(DATE_TRUNC('month', l.application_date), 'Mon YYYY') AS period,
  -- Replace the aggregation below with the appropriate metric formula from above
  SUM(CASE WHEN (l.funding_date IS NOT NULL OR l.closing_date IS NOT NULL)
    THEN (${revenueExpr}) ELSE 0 END) AS revenue
FROM public.loans l
WHERE l.application_date >= $START AND l.application_date <= $END
GROUP BY sort_period, period
ORDER BY sort_period
\`\`\`
For "last 12 months", set $START = CURRENT_DATE - INTERVAL '12 months'.
For "last 6 months", set $START = CURRENT_DATE - INTERVAL '6 months'.
NEVER default to YTD when the user asks for a specific number of months.

IMPORTANT: When computing these metrics, ALWAYS use these exact formulas.
Do NOT invent your own pull-through or revenue calculation.
Revenue is NOT the same as volume — revenue is gain-on-sale (the tenant-specific expression above, typically $K), volume is loan amounts ($M).
Revenue uses the expression: ${revenueExpr}
Volume uses: l.loan_amount
These are DIFFERENT numbers. Never confuse them.
`.trim();
}

/**
 * Helper to get the tenant's revenue expression (re-exported for convenience).
 */
export { getTenantRevenueExpression } from "../../utils/scorecard-utils.js";
