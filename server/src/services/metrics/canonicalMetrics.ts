/**
 * Canonical Metrics Service
 *
 * Shared, authoritative metric computation used by both the Insights pipeline
 * and the Workbench / Chat AI system.  A single source of truth for:
 *
 *  - Pull-Through Rate  (originated / completed * 100)  — application_date scoped
 *  - Fallout Rate        ((completed - originated) / completed * 100) — application_date scoped
 *  - Cycle Time          avg days from application to funding — funding_date scoped
 *  - Funded Volume       SUM(loan_amount) of loans funded in period — funding_date scoped
 *  - Funded Revenue      SUM(revenueExpr) of loans funded in period — funding_date scoped
 *  - Funded Count        COUNT of loans funded in period — funding_date scoped
 *
 * Dual-query design matches Qlik's DateType={'Application'} vs DateType={'Funding'}.
 * PT + Fallout = 100% in every window (both use application cohort denominator).
 */

import pg from "pg";
import {
  buildChannelWhereClause,
  buildFundedFilter,
  getTenantRevenueExpression,
} from "../../utils/scorecard-utils.js";

// ============================================================================
// Types
// ============================================================================

/** Unified period snapshot — dual-query approach matching Qlik DateType separation. */
export interface PeriodSnapshot {
  window: string;          // "ytd" | "90d" | "60d" | "30d" | "mtd"
  start: string;
  end: string;
  // --- Application cohort (scoped by application_date) ---
  totalApplications: number;
  completed: number;       // loans that have finished lifecycle (non-active)
  funded: number;          // originated status-based (PT numerator)
  locked: number;
  pullThroughRate: number; // funded / completed * 100
  falloutRate: number;     // (completed - funded) / completed * 100
  // --- Funding cohort (scoped by funding_date) ---
  fundedVolume: number;    // SUM(loan_amount) for loans funded in this period
  fundedRevenue: number;   // SUM(revenueExpr) for loans funded in this period
  fundedCount: number;     // COUNT of loans funded in this period
  avgCycleTime: number;    // AVG days from application to funding
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
  // Long-term ranges for historical baselines
  trailing12m: DateRange;
  trailing24m: DateRange;
  trailing36m: DateRange;
  prior12m: DateRange;
  prior36mBaseline: DateRange;
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

  // Long-term trailing windows
  const trailing12mStart = toDate(new Date(now.getTime() - 365 * DAY));
  const trailing24mStart = toDate(new Date(now.getTime() - 730 * DAY));
  const trailing36mStart = toDate(new Date(now.getTime() - 1095 * DAY));
  // Prior 12 months = the 12 months before trailing12m (i.e. 24m ago → 12m+1d ago)
  const prior12mStart = toDate(new Date(now.getTime() - 730 * DAY));
  const prior12mEnd = toDate(new Date(now.getTime() - 366 * DAY));
  // 36-month baseline excluding most recent 12 months (36m ago → 12m+1d ago)
  const prior36mBaselineStart = toDate(new Date(now.getTime() - 1095 * DAY));
  const prior36mBaselineEnd = toDate(new Date(now.getTime() - 366 * DAY));

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
    // Long-term ranges
    trailing12m: { start: trailing12mStart, end: today },
    trailing24m: { start: trailing24mStart, end: today },
    trailing36m: { start: trailing36mStart, end: today },
    prior12m: { start: prior12mStart, end: prior12mEnd },
    prior36mBaseline: { start: prior36mBaselineStart, end: prior36mBaselineEnd },
  };
}

// ============================================================================
// Core Metric Computation
// ============================================================================

/**
 * Compute a PeriodSnapshot for a given time window using dual SQL queries.
 *
 * Query A (Application Cohort): scoped by application_date — pull-through, fallout.
 * Query B (Funding Cohort): scoped by funding_date — volume, revenue, cycle time.
 *
 * This matches Qlik's DateType={'Application'} vs DateType={'Funding'} separation.
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

  try {
    // Query A: Application cohort — pull-through, fallout, total apps
    // NOTE on "completed" definition:
    //   Qlik's [Active Loan Flag]={No} only excludes status='Active Loan'.
    //   We additionally exclude 'active','locked','submitted','approved' because these
    //   are intermediate pipeline statuses (not terminal). This gives a more conservative
    //   denominator. If PT/fallout differ from Qlik, validate DB status distribution
    //   to confirm these statuses represent meaningful loan counts.
    const appQuery = tenantPool.query(
      `SELECT
        COUNT(*) as total_apps,
        COUNT(CASE WHEN current_loan_status NOT IN ('Active Loan','active','locked','submitted','approved')
          THEN 1 END) as completed,
        COUNT(CASE WHEN (current_loan_status ILIKE '%Originated%' OR current_loan_status ILIKE '%purchased%')
          THEN 1 END) as funded,
        COUNT(CASE WHEN lock_date IS NOT NULL THEN 1 END) as locked
      FROM public.loans
      WHERE application_date >= $1 AND application_date <= $2
        ${channelClause}`,
      [start, end]
    );

    // Query B: Funding cohort — volume, revenue, cycle time, funded count
    // Channel-aware funded filter: Retail uses rate_lock > 0, TPO/All do not.
    const fundedFilter = buildFundedFilter(channelGroup);
    const fundQuery = tenantPool.query(
      `SELECT
        COALESCE(SUM(loan_amount), 0) as funded_volume,
        COALESCE(SUM(${revenueExpr}), 0) as funded_revenue,
        AVG(funding_date::date - application_date) as avg_cycle_days,
        COUNT(*) as funded_count
      FROM public.loans
      WHERE ${fundedFilter}
        AND funding_date >= $1 AND funding_date <= $2
        ${channelClause}`,
      [start, end]
    );

    const [appResult, fundResult] = await Promise.all([appQuery, fundQuery]);

    const appRow = appResult.rows[0];
    const fundRow = fundResult.rows[0];
    const completed = parseInt(appRow?.completed) || 0;
    const funded = parseInt(appRow?.funded) || 0;

    const snapshot: PeriodSnapshot = {
      window: windowName,
      start,
      end,
      totalApplications: parseInt(appRow?.total_apps) || 0,
      completed,
      funded,
      locked: parseInt(appRow?.locked) || 0,
      pullThroughRate: completed > 0 ? Math.round((funded / completed) * 1000) / 10 : 0,
      falloutRate: completed > 0 ? Math.round(((completed - funded) / completed) * 1000) / 10 : 0,
      fundedVolume: parseFloat(fundRow?.funded_volume) || 0,
      fundedRevenue: parseFloat(fundRow?.funded_revenue) || 0,
      fundedCount: parseInt(fundRow?.funded_count) || 0,
      avgCycleTime: Math.round(parseFloat(fundRow?.avg_cycle_days) || 0),
    };

    console.log(
      `[CanonicalMetrics] Snapshot "${windowName}" (${start}→${end}): ` +
      `apps=${snapshot.totalApplications}, completed=${completed}, originated=${funded}, ` +
      `PT=${snapshot.pullThroughRate}%, Fallout=${snapshot.falloutRate}%, ` +
      `FundedInPeriod=${snapshot.fundedCount}, Vol=$${Math.round(snapshot.fundedVolume)}, ` +
      `Rev=$${Math.round(snapshot.fundedRevenue)}, Cycle=${snapshot.avgCycleTime}d`
    );

    return snapshot;
  } catch (error) {
    console.error(`[CanonicalMetrics] Error computing period snapshot for ${windowName}:`, error);
    return {
      window: windowName, start, end,
      totalApplications: 0, completed: 0, funded: 0, locked: 0,
      fundedVolume: 0, fundedRevenue: 0, fundedCount: 0, avgCycleTime: 0,
      pullThroughRate: 0, falloutRate: 0,
    };
  }
}

/**
 * Compute all standard period snapshots in parallel (10 core + 4 long-term baselines).
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
  trailing12m: PeriodSnapshot;
  trailing36m: PeriodSnapshot;
  prior12m: PeriodSnapshot;
  prior36mBaseline: PeriodSnapshot;
}> {
  const dr = getStandardDateRanges();

  const [
    ytd, rolling90d, rolling60d, rolling30d, mtd,
    priorYtd, prior90d, prior60d, prior30d, priorMtd,
    trailing12m, trailing36m, prior12m, prior36mBaseline,
  ] =
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
      computePeriodSnapshot(tenantPool, "trailing_12m", dr.trailing12m.start, dr.trailing12m.end, revenueExpr, channelGroup),
      computePeriodSnapshot(tenantPool, "trailing_36m", dr.trailing36m.start, dr.trailing36m.end, revenueExpr, channelGroup),
      computePeriodSnapshot(tenantPool, "prior_12m", dr.prior12m.start, dr.prior12m.end, revenueExpr, channelGroup),
      computePeriodSnapshot(tenantPool, "prior_36m_baseline", dr.prior36mBaseline.start, dr.prior36mBaseline.end, revenueExpr, channelGroup),
    ]);

  return {
    ytd, rolling90d, rolling60d, rolling30d, mtd,
    priorYtd, prior90d, prior60d, prior30d, priorMtd,
    trailing12m, trailing36m, prior12m, prior36mBaseline,
  };
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
Definition: originated loans / completed loans * 100. "Originated" = status ILIKE Originated or purchased. "Completed" = loans NOT in active statuses.
\`\`\`sql
-- Pull-Through Rate (for a given date range, replace $START / $END)
SELECT
  COUNT(CASE WHEN (l.current_loan_status ILIKE '%Originated%' OR l.current_loan_status ILIKE '%purchased%')
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
CRITICAL: Revenue/Volume are scoped by FUNDING_DATE. For Retail channel only, also filter rate_lock > 0.
\`\`\`sql
-- Revenue for funded loans (scoped by funding_date)
SELECT SUM(${revenueExpr}) AS total_revenue
FROM public.loans l
WHERE l.funding_date >= $START AND l.funding_date <= $END
\`\`\`

### Funded Volume
Definition: total loan_amount of loans funded in the period. Scoped by FUNDING_DATE.
\`\`\`sql
SELECT SUM(l.loan_amount) AS funded_volume
FROM public.loans l
WHERE l.funding_date >= $START AND l.funding_date <= $END
\`\`\`

### Cycle Time
Definition: average days from application_date to funding_date for loans funded in the period.
CRITICAL: Scoped by FUNDING_DATE.
\`\`\`sql
SELECT AVG(l.funding_date::date - l.application_date) AS avg_cycle_days
FROM public.loans l
WHERE l.funding_date >= $START AND l.funding_date <= $END
\`\`\`

### Revenue BPS (Basis Points)
Definition: (revenue / volume) * 10000. Measures margin per dollar of volume.
CRITICAL: Scoped by FUNDING_DATE.
\`\`\`sql
SELECT
  CASE WHEN SUM(l.loan_amount) > 0
    THEN (SUM(${revenueExpr}) / SUM(l.loan_amount)) * 10000
    ELSE 0
  END AS revenue_bps
FROM public.loans l
WHERE l.funding_date >= $START AND l.funding_date <= $END
\`\`\`

### Monthly Trend Template (use for all "trend over time" / "by month" requests)
When asked for monthly trends of ANY metric, use this pattern:
\`\`\`sql
SELECT
  DATE_TRUNC('month', l.application_date) AS sort_period,
  TO_CHAR(DATE_TRUNC('month', l.application_date), 'Mon YYYY') AS period,
  -- Replace the aggregation below with the appropriate metric formula from above
  SUM(CASE WHEN l.funding_date IS NOT NULL
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
