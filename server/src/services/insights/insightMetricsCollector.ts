/**
 * Insight Metrics Collector
 * Aggregates metrics from multiple sources into a single payload for LLM processing
 */

import pg from "pg";
import { queryMetrics, DateRange } from "../metrics/metricsService.js";
import {
  buildChannelWhereClause,
  getTenantRevenueExpression,
  getActorColumnForChannel,
  getActorLabelForChannel,
  isActorMissing,
} from "../../utils/scorecard-utils.js";

// Prediction data structure
export interface PredictionData {
  loanId: string;
  predictedOutcome: "withdraw" | "deny" | "originate";
  confidence: number;
  reasoning?: string;
  riskFactors?: string[];
}

// Full metrics payload for LLM insights generation
export interface InsightMetricsPayload {
  generatedAt: string;
  period: {
    dateFilter: string;
    start: string | null;
    end: string | null;
  };

  // Core pipeline metrics
  pipeline: {
    activeLoans: number;
    activeVolume: number;
    lockedLoans: number;
    closedLoans: number;
    closedVolume: number;
  };

  // Predictions data (from loan_predictions table)
  predictions: {
    likelyWithdraw: number;
    likelyDeny: number;
    likelyOriginate: number;
    /** All loan IDs predicted to withdraw or deny (any confidence) */
    allAtRiskLoanIds: string[];
    /** Volume of ALL withdraw/deny predictions */
    allAtRiskVolume: number;
    /** Loans with >= 70% confidence for withdraw/deny */
    highRiskLoans: Array<{
      loanId: string;
      confidence: number;
      predictedOutcome: string;
      riskFactors: string[];
    }>;
    /** Volume of ONLY the >=70% confidence loans */
    highRiskVolume: number;
  };

  // Performance metrics
  performance: {
    pullThroughRolling90D: number;
    avgCycleTime: number;
    revenueYTD: number;
    revenueMTD: number;
    volumeYTD: number;
    volumeMTD: number;
  };

  // Credit risk profile
  creditRisk: {
    waFico: number;
    waLtv: number;
    waDti: number;
    highRiskLoanCount: number; // FICO<620 OR LTV>95 OR DTI>50
    highRiskLoanIds: string[]; // Exact loan IDs meeting criteria
    highRiskVolume: number; // Total volume of high-risk credit loans
  };

  // Lost opportunity
  lostOpportunity: {
    withdrawnUnits: number;
    withdrawnVolume: number;
    withdrawnProformaRevenue: number;
    deniedUnits: number;
    deniedVolume: number;
    withdrawnLoanIds: string[];
    deniedLoanIds: string[];
  };

  // Funnel metrics
  funnel: {
    loansStarted: number;
    loansLocked: number;
    loansOriginated: number;
    falloutRate: number;
  };

  // Comparisons (month-over-month, year-over-year)
  comparisons: {
    volumeVsLastMonth: number; // percentage change
    volumeVsLastYear: number;
    cycleTimeVsLastMonth: number;
    pullThroughVsLastMonth: number;
    /** Actual dollar amounts used in the comparison */
    currentMtdVolume: number;
    lastMonthVolume: number;
    currentYtdVolume: number;
    lastYearVolume: number;
    currentCycleTime: number;
    lastMonthCycleTime: number;
  };

  // Scorecard summary (if available)
  scorecard?: {
    topTierCount: number;
    secondTierCount: number;
    bottomTierCount: number;
    avgTtsScore: number;
  };

  // B3 — Closing risk: loans closing within 10 days without CTC
  closingRisk: {
    atRiskCount: number;
    atRiskVolume: number;
    loanIds: string[];
    avgDaysToClose: number;
  };

  // C1 — Lock expiration: locked loans expiring within 7 days without CTC
  lockExpiration: {
    expiringCount: number;
    expiringVolume: number;
    loanIds: string[];
    avgDaysToExpiry: number;
  };

  // G1 — TRID timing exposure: loans closing soon without CD sent
  tridExposure: {
    atRiskCount: number;
    loanIds: string[];
    avgDaysToClose: number;
  };

  // C2 — Margin data: gain-on-sale margin current vs prior month (bps)
  marginData: {
    currentMonthBps: number;
    priorMonthBps: number;
    deltaBps: number;
  };

  // D2 — Condition backlog: average conditions per active loan
  conditionBacklog: {
    avgConditions: number;
    highConditionCount: number;
    highConditionLoanIds: string[];
  };

  // Personnel tiering — revenue-based Pareto tiers per actor type
  tiering: {
    byActorType: Array<{
      actorType: "loan_officer" | "branch";
      actorLabel: string;
      totalActors: number;
      tierDistribution: { top: number; second: number; bottom: number };
      topPerformers: Array<{
        name: string;
        revenue: number;
        units: number;
        volume: number;
        revenueBps: number;
        pullThrough: number;
        avgCycleTime: number;
        lostOpportunityUnits: number;
        deniedUnits: number;
        tier: string;
      }>;
      bottomPerformers: Array<{
        name: string;
        revenue: number;
        units: number;
        volume: number;
        revenueBps: number;
        pullThrough: number;
        avgCycleTime: number;
        lostOpportunityUnits: number;
        deniedUnits: number;
        tier: string;
      }>;
      tierAverages: {
        top: { avgRevenue: number; avgUnits: number; avgBps: number; avgPullThrough: number; avgCycleTime: number };
        second: { avgRevenue: number; avgUnits: number; avgBps: number; avgPullThrough: number; avgCycleTime: number };
        bottom: { avgRevenue: number; avgUnits: number; avgBps: number; avgPullThrough: number; avgCycleTime: number };
      };
      /** Multi-window period-over-period changes; officers with notable improvement or decline */
      periodChanges?: Array<{
        name: string;
        metric: "revenue" | "units" | "volume" | "pullThrough" | "revenueBps" | "cycleTime";
        current: number;
        prior: number;
        deltaPct: number;
        direction: "improved" | "declined";
        window: "30d" | "60d" | "90d";
      }>;
    }>;
  };
}

/**
 * Calculate date ranges for different periods
 */
function getDateRanges(): {
  today: DateRange;
  mtd: DateRange;
  ytd: DateRange;
  rolling90D: DateRange;
  lastMonth: DateRange;
  lastYear: DateRange;
  trailing30: DateRange;
  prior30: DateRange;
} {
  const now = new Date();
  const today = now.toISOString().split("T")[0];

  // Start of month
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
    .toISOString()
    .split("T")[0];

  // Start of year
  const startOfYear = new Date(now.getFullYear(), 0, 1)
    .toISOString()
    .split("T")[0];

  // Rolling 90 days
  const rolling90Start = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000)
    .toISOString()
    .split("T")[0];

  // Last month (calendar)
  const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0)
    .toISOString()
    .split("T")[0];
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    .toISOString()
    .split("T")[0];

  // Last year same period
  const lastYearStart = new Date(now.getFullYear() - 1, 0, 1)
    .toISOString()
    .split("T")[0];
  const lastYearEnd = new Date(
    now.getFullYear() - 1,
    now.getMonth(),
    now.getDate()
  )
    .toISOString()
    .split("T")[0];

  // Trailing 30 days (today back 30 days) — always apples-to-apples
  const trailing30Start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .split("T")[0];

  // Prior 30 days (31-60 days ago) — the period before trailing 30
  const prior30Start = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000)
    .toISOString()
    .split("T")[0];
  const prior30End = new Date(now.getTime() - 31 * 24 * 60 * 60 * 1000)
    .toISOString()
    .split("T")[0];

  return {
    today: { start: today, end: today },
    mtd: { start: startOfMonth, end: today },
    ytd: { start: startOfYear, end: today },
    rolling90D: { start: rolling90Start, end: today },
    lastMonth: { start: lastMonthStart, end: lastMonthEnd },
    lastYear: { start: lastYearStart, end: lastYearEnd },
    trailing30: { start: trailing30Start, end: today },
    prior30: { start: prior30Start, end: prior30End },
  };
}

/**
 * Fetch stored predictions from the database
 */
async function fetchPredictions(
  tenantPool: pg.Pool,
  channelGroup?: string
): Promise<PredictionData[]> {
  try {
    // Check if loan_predictions table exists
    const tableCheck = await tenantPool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'loan_predictions'
      ) as exists
    `);

    if (!tableCheck.rows[0]?.exists) {
      console.log("[InsightMetrics] loan_predictions table does not exist");
      return [];
    }

    // Get most recent prediction per loan — ONLY for currently active loans.
    // Predictions for withdrawn / denied / funded loans are stale and should not
    // be surfaced as fallout risk.
    const channelClause = buildChannelWhereClause(channelGroup);
    const result = await tenantPool.query(`
      SELECT DISTINCT ON (p.loan_id)
        p.loan_id,
        p.predicted_outcome,
        p.confidence,
        p.reasoning,
        p.risk_factors
      FROM public.loan_predictions p
      JOIN public.loans l ON p.loan_id = l.loan_id
      WHERE l.current_loan_status = 'Active Loan'
        ${channelGroup ? channelClause : ""}
      ORDER BY p.loan_id, p.created_at DESC
      LIMIT 5000
    `);

    return result.rows.map((row) => ({
      loanId: row.loan_id,
      predictedOutcome: row.predicted_outcome,
      confidence: parseFloat(row.confidence) || 0,
      reasoning: row.reasoning,
      riskFactors: row.risk_factors || [],
    }));
  } catch (error) {
    console.error("[InsightMetrics] Error fetching predictions:", error);
    return [];
  }
}

/**
 * Fetch high-risk loan volume (loans with withdraw/deny predictions)
 */
async function fetchAtRiskVolume(
  tenantPool: pg.Pool,
  highRiskLoanIds: string[]
): Promise<number> {
  if (highRiskLoanIds.length === 0) return 0;

  try {
    const result = await tenantPool.query(
      `
      SELECT COALESCE(SUM(loan_amount), 0) as volume
      FROM public.loans
      WHERE loan_id = ANY($1)
    `,
      [highRiskLoanIds]
    );

    return parseFloat(result.rows[0]?.volume) || 0;
  } catch (error) {
    console.error("[InsightMetrics] Error fetching at-risk volume:", error);
    return 0;
  }
}

/**
 * Fetch credit risk metrics (high risk loan count, loan IDs, and total volume)
 */
async function fetchCreditRiskLoans(
  tenantPool: pg.Pool,
  channelGroup?: string
): Promise<{ count: number; loanIds: string[]; volume: number }> {
  try {
    const channelClause = buildChannelWhereClause(channelGroup);
    const result = await tenantPool.query(`
      SELECT loan_id, COALESCE(loan_amount, 0) as loan_amount
      FROM public.loans
      WHERE current_loan_status = 'Active Loan'
        AND (
          (fico_score IS NOT NULL AND CAST(fico_score AS DECIMAL) < 620)
          OR (ltv_ratio IS NOT NULL AND CAST(ltv_ratio AS DECIMAL) > 95)
          OR (be_dti_ratio IS NOT NULL AND CAST(be_dti_ratio AS DECIMAL) > 50)
        )
        ${channelClause}
    `);

    const loanIds = result.rows.map((r: any) => r.loan_id);
    const volume = result.rows.reduce((sum: number, r: any) => sum + (parseFloat(r.loan_amount) || 0), 0);
    return { count: loanIds.length, loanIds, volume };
  } catch (error) {
    console.error("[InsightMetrics] Error fetching credit risk loans:", error);
    return { count: 0, loanIds: [], volume: 0 };
  }
}

/**
 * Calculate Rolling 90-Day Pull-Through Rate
 */
async function calculateRolling90DPullThrough(
  tenantPool: pg.Pool,
  channelGroup?: string
): Promise<number> {
  const endDate = new Date();
  const startDate = new Date(endDate.getTime() - 90 * 24 * 60 * 60 * 1000);
  const channelClause = buildChannelWhereClause(channelGroup);

  try {
    const result = await tenantPool.query(
      `
      SELECT 
        COUNT(CASE 
          WHEN l.current_loan_status NOT IN ('Active Loan', 'active', 'locked', 'submitted', 'approved')
          AND (l.funding_date IS NOT NULL OR l.closing_date IS NOT NULL OR l.investor_purchase_date IS NOT NULL)
          THEN 1 
        END)::float / 
        NULLIF(COUNT(CASE 
          WHEN l.current_loan_status NOT IN ('Active Loan', 'active', 'locked', 'submitted', 'approved')
          THEN 1 
        END), 0) * 100 as pull_through_rate
      FROM public.loans l
      WHERE l.application_date >= $1
        AND l.application_date <= $2
        ${channelClause}
    `,
      [startDate, endDate]
    );

    return parseFloat(result.rows[0]?.pull_through_rate) || 0;
  } catch (error) {
    console.error("[InsightMetrics] Error calculating pull-through:", error);
    return 0;
  }
}

/**
 * Fetch lost opportunity metrics (withdrawn and denied loans) WITH loan IDs
 */
async function fetchLostOpportunity(
  tenantPool: pg.Pool,
  dateRange: DateRange,
  channelGroup?: string
): Promise<{
  withdrawnUnits: number;
  withdrawnVolume: number;
  withdrawnProformaRevenue: number;
  deniedUnits: number;
  deniedVolume: number;
  withdrawnLoanIds: string[];
  deniedLoanIds: string[];
}> {
  try {
    const channelClause = buildChannelWhereClause(channelGroup);

    // Fetch individual rows so we get both aggregates AND loan IDs
    const result = await tenantPool.query(
      `
      SELECT loan_id, current_loan_status, COALESCE(loan_amount, 0) as loan_amount
      FROM public.loans
      WHERE current_loan_status IN ('withdrawn', 'cancelled', 'Withdrawn', 'denied', 'declined', 'Denied')
        AND application_date >= $1
        AND application_date <= $2
        ${channelClause}
    `,
      [dateRange.start, dateRange.end]
    );

    const withdrawn = result.rows.filter((r: any) =>
      ["withdrawn", "cancelled", "Withdrawn"].includes(r.current_loan_status)
    );
    const denied = result.rows.filter((r: any) =>
      ["denied", "declined", "Denied"].includes(r.current_loan_status)
    );

    const withdrawnVolume = withdrawn.reduce(
      (sum: number, r: any) => sum + (parseFloat(r.loan_amount) || 0),
      0
    );
    const deniedVolume = denied.reduce(
      (sum: number, r: any) => sum + (parseFloat(r.loan_amount) || 0),
      0
    );

    return {
      withdrawnUnits: withdrawn.length,
      withdrawnVolume,
      withdrawnProformaRevenue: withdrawnVolume * 0.01,
      deniedUnits: denied.length,
      deniedVolume,
      withdrawnLoanIds: withdrawn.map((r: any) => r.loan_id),
      deniedLoanIds: denied.map((r: any) => r.loan_id),
    };
  } catch (error) {
    console.error("[InsightMetrics] Error fetching lost opportunity:", error);
    return {
      withdrawnUnits: 0,
      withdrawnVolume: 0,
      withdrawnProformaRevenue: 0,
      deniedUnits: 0,
      deniedVolume: 0,
      withdrawnLoanIds: [],
      deniedLoanIds: [],
    };
  }
}

/**
 * Fetch funnel metrics
 */
async function fetchFunnelMetrics(
  tenantPool: pg.Pool,
  dateRange: DateRange,
  channelGroup?: string
): Promise<{
  loansStarted: number;
  loansLocked: number;
  loansOriginated: number;
  falloutRate: number;
}> {
  try {
    const channelClause = buildChannelWhereClause(channelGroup);
    const result = await tenantPool.query(
      `
      SELECT
        COUNT(*) as total,
        COUNT(CASE WHEN lock_date IS NOT NULL THEN 1 END) as locked,
        COUNT(CASE WHEN funding_date IS NOT NULL
          OR current_loan_status ILIKE '%funded%' OR current_loan_status ILIKE '%closed%' OR current_loan_status ILIKE '%originated%'
          THEN 1 END) as originated,
        COUNT(CASE WHEN current_loan_status ILIKE '%withdraw%' OR current_loan_status ILIKE '%cancelled%'
          OR current_loan_status ILIKE '%canceled%' OR current_loan_status ILIKE '%not accepted%'
          OR current_loan_status ILIKE '%incomplete%' OR current_loan_status ILIKE '%denied%'
          OR current_loan_status ILIKE '%declined%'
          THEN 1 END) as fallout,
        -- Loans that have completed their lifecycle (not still active in pipeline)
        -- This matches the pull-through denominator so PT + Fallout ≈ 100%
        COUNT(CASE WHEN current_loan_status NOT IN ('Active Loan', 'active', 'locked', 'submitted', 'approved')
          THEN 1 END) as completed
      FROM public.loans
      WHERE application_date >= $1
        AND application_date <= $2
        ${channelClause}
    `,
      [dateRange.start, dateRange.end]
    );

    const row = result.rows[0];
    const total = parseInt(row?.total) || 0;
    const fallout = parseInt(row?.fallout) || 0;
    const completed = parseInt(row?.completed) || 0;

    return {
      loansStarted: total,
      loansLocked: parseInt(row?.locked) || 0,
      loansOriginated: parseInt(row?.originated) || 0,
      // Use completed (non-active) as denominator — same population as pull-through
      // so that pullThrough + falloutRate ≈ 100%
      falloutRate: completed > 0 ? (fallout / completed) * 100 : 0,
    };
  } catch (error) {
    console.error("[InsightMetrics] Error fetching funnel metrics:", error);
    return {
      loansStarted: 0,
      loansLocked: 0,
      loansOriginated: 0,
      falloutRate: 0,
    };
  }
}

/**
 * Calculate comparison metrics (month-over-month, year-over-year)
 */
async function calculateComparisons(
  tenantPool: pg.Pool,
  currentMtdMetrics: Record<string, any>,
  currentYtdMetrics: Record<string, any>,
  dateRanges: ReturnType<typeof getDateRanges>
): Promise<{
  volumeVsLastMonth: number;
  volumeVsLastYear: number;
  cycleTimeVsLastMonth: number;
  pullThroughVsLastMonth: number;
  /** Trailing 30 days funded volume (apples-to-apples) */
  currentMtdVolume: number;
  /** Prior 30 days funded volume (the 30-day window before trailing 30) */
  lastMonthVolume: number;
  currentYtdVolume: number;
  lastYearVolume: number;
  currentCycleTime: number;
  lastMonthCycleTime: number;
}> {
  try {
    // -------- TRAILING 30 vs PRIOR 30 (apples-to-apples) --------
    // This avoids the "10 days vs 31 days" problem when comparing
    // partial-month MTD against a full prior month.
    const trailing30Metrics = await queryMetrics(
      tenantPool,
      ["funded_volume", "avg_cycle_time", "pull_through_rate"],
      { dateRange: dateRanges.trailing30 }
    );

    const prior30Metrics = await queryMetrics(
      tenantPool,
      ["funded_volume", "avg_cycle_time", "pull_through_rate"],
      { dateRange: dateRanges.prior30 }
    );

    // Get last year same YTD period metrics
    const lastYearMetrics = await queryMetrics(tenantPool, ["funded_volume"], {
      dateRange: dateRanges.lastYear,
    });

    const trailing30Volume = Number(trailing30Metrics.funded_volume?.value || 0);
    const prior30Volume = Number(prior30Metrics.funded_volume?.value || 0);
    const lastYearVolume = Number(lastYearMetrics.funded_volume?.value || 0);
    const currentYtdVolume = Number(currentYtdMetrics.funded_volume?.value || 0);

    const trailing30CycleTime = Number(
      trailing30Metrics.avg_cycle_time?.value || 0
    );
    const prior30CycleTime = Number(
      prior30Metrics.avg_cycle_time?.value || 0
    );

    return {
      volumeVsLastMonth:
        prior30Volume > 0
          ? ((trailing30Volume - prior30Volume) / prior30Volume) * 100
          : 0,
      volumeVsLastYear:
        lastYearVolume > 0
          ? ((currentYtdVolume - lastYearVolume) / lastYearVolume) * 100
          : 0,
      cycleTimeVsLastMonth:
        prior30CycleTime > 0
          ? ((trailing30CycleTime - prior30CycleTime) / prior30CycleTime) * 100
          : 0,
      pullThroughVsLastMonth: 0, // Calculated separately with rolling 90D methodology
      currentMtdVolume: trailing30Volume,
      lastMonthVolume: prior30Volume,
      currentYtdVolume,
      lastYearVolume,
      currentCycleTime: trailing30CycleTime,
      lastMonthCycleTime: prior30CycleTime,
    };
  } catch (error) {
    console.error("[InsightMetrics] Error calculating comparisons:", error);
    return {
      volumeVsLastMonth: 0,
      volumeVsLastYear: 0,
      cycleTimeVsLastMonth: 0,
      pullThroughVsLastMonth: 0,
      currentMtdVolume: 0,
      lastMonthVolume: 0,
      currentYtdVolume: 0,
      lastYearVolume: 0,
      currentCycleTime: 0,
      lastMonthCycleTime: 0,
    };
  }
}

// ============================================================================
// B3 — Closing-Late Risk
// Loans with estimated_closing_date within 10 days that have NOT reached CTC
// ============================================================================

async function fetchClosingLateRisk(
  tenantPool: pg.Pool,
  channelGroup?: string
): Promise<{ atRiskCount: number; atRiskVolume: number; loanIds: string[]; avgDaysToClose: number }> {
  try {
    const channelClause = buildChannelWhereClause(channelGroup);
    const result = await tenantPool.query(`
      SELECT loan_id, COALESCE(loan_amount, 0) as loan_amount,
             estimated_closing_date,
             (estimated_closing_date - CURRENT_DATE) as days_to_close
      FROM public.loans
      WHERE current_loan_status = 'Active Loan'
        AND estimated_closing_date IS NOT NULL
        AND estimated_closing_date <= CURRENT_DATE + INTERVAL '10 days'
        AND estimated_closing_date >= CURRENT_DATE
        AND ctc_date IS NULL
        ${channelClause}
    `);

    const loanIds = result.rows.map((r: any) => r.loan_id);
    const volume = result.rows.reduce((sum: number, r: any) => sum + (parseFloat(r.loan_amount) || 0), 0);
    const avgDays = result.rows.length > 0
      ? result.rows.reduce((sum: number, r: any) => sum + (parseInt(r.days_to_close) || 0), 0) / result.rows.length
      : 0;

    return { atRiskCount: loanIds.length, atRiskVolume: volume, loanIds, avgDaysToClose: Math.round(avgDays) };
  } catch (error) {
    console.error("[InsightMetrics] Error fetching closing-late risk:", error);
    return { atRiskCount: 0, atRiskVolume: 0, loanIds: [], avgDaysToClose: 0 };
  }
}

// ============================================================================
// C1 — Lock Expiration Exposure
// Locked loans with lock_expiration_date within 7 days that have NOT reached CTC
// ============================================================================

async function fetchLockExpirationExposure(
  tenantPool: pg.Pool,
  channelGroup?: string
): Promise<{ expiringCount: number; expiringVolume: number; loanIds: string[]; avgDaysToExpiry: number }> {
  try {
    const channelClause = buildChannelWhereClause(channelGroup);
    const result = await tenantPool.query(`
      SELECT loan_id, COALESCE(loan_amount, 0) as loan_amount,
             lock_expiration_date,
             (lock_expiration_date - CURRENT_DATE) as days_to_expiry
      FROM public.loans
      WHERE current_loan_status = 'Active Loan'
        AND lock_date IS NOT NULL
        AND lock_expiration_date IS NOT NULL
        AND lock_expiration_date <= CURRENT_DATE + INTERVAL '7 days'
        AND lock_expiration_date >= CURRENT_DATE
        AND ctc_date IS NULL
        ${channelClause}
    `);

    const loanIds = result.rows.map((r: any) => r.loan_id);
    const volume = result.rows.reduce((sum: number, r: any) => sum + (parseFloat(r.loan_amount) || 0), 0);
    const avgDays = result.rows.length > 0
      ? result.rows.reduce((sum: number, r: any) => sum + (parseInt(r.days_to_expiry) || 0), 0) / result.rows.length
      : 0;

    return { expiringCount: loanIds.length, expiringVolume: volume, loanIds, avgDaysToExpiry: Math.round(avgDays) };
  } catch (error) {
    console.error("[InsightMetrics] Error fetching lock expiration exposure:", error);
    return { expiringCount: 0, expiringVolume: 0, loanIds: [], avgDaysToExpiry: 0 };
  }
}

// ============================================================================
// G1 — TRID Timing Exposure
// Loans closing within 5 calendar days where Closing Disclosure has NOT been sent
// (TRID requires CD at least 3 business days before closing)
// ============================================================================

async function fetchTridExposure(
  tenantPool: pg.Pool,
  channelGroup?: string
): Promise<{ atRiskCount: number; loanIds: string[]; avgDaysToClose: number }> {
  try {
    const channelClause = buildChannelWhereClause(channelGroup);
    const result = await tenantPool.query(`
      SELECT loan_id, estimated_closing_date,
             (estimated_closing_date - CURRENT_DATE) as days_to_close
      FROM public.loans
      WHERE current_loan_status = 'Active Loan'
        AND estimated_closing_date IS NOT NULL
        AND estimated_closing_date <= CURRENT_DATE + INTERVAL '5 days'
        AND estimated_closing_date >= CURRENT_DATE
        AND closing_disclosure_sent_date IS NULL
        ${channelClause}
    `);

    const loanIds = result.rows.map((r: any) => r.loan_id);
    const avgDays = result.rows.length > 0
      ? result.rows.reduce((sum: number, r: any) => sum + (parseInt(r.days_to_close) || 0), 0) / result.rows.length
      : 0;

    return { atRiskCount: loanIds.length, loanIds, avgDaysToClose: Math.round(avgDays) };
  } catch (error) {
    console.error("[InsightMetrics] Error fetching TRID exposure:", error);
    return { atRiskCount: 0, loanIds: [], avgDaysToClose: 0 };
  }
}

// ============================================================================
// C2 — Margin Compression
// Gain-on-sale margin: (net_sell - net_buy) / loan_amount * 10000 (bps)
// Compare current month funded loans vs prior month
// ============================================================================

async function fetchMarginData(
  tenantPool: pg.Pool,
  channelGroup?: string
): Promise<{ currentMonthBps: number; priorMonthBps: number; deltaBps: number }> {
  try {
    const channelClause = buildChannelWhereClause(channelGroup);

    // Current month
    const currentResult = await tenantPool.query(`
      SELECT AVG(
        (COALESCE(net_sell, 0) - COALESCE(net_buy, 0)) / NULLIF(loan_amount, 0) * 10000
      ) as avg_margin_bps
      FROM public.loans
      WHERE funding_date >= DATE_TRUNC('month', CURRENT_DATE)
        AND loan_amount > 0
        AND (net_sell IS NOT NULL OR net_buy IS NOT NULL)
        ${channelClause}
    `);

    // Prior month
    const priorResult = await tenantPool.query(`
      SELECT AVG(
        (COALESCE(net_sell, 0) - COALESCE(net_buy, 0)) / NULLIF(loan_amount, 0) * 10000
      ) as avg_margin_bps
      FROM public.loans
      WHERE funding_date >= DATE_TRUNC('month', CURRENT_DATE - INTERVAL '1 month')
        AND funding_date < DATE_TRUNC('month', CURRENT_DATE)
        AND loan_amount > 0
        AND (net_sell IS NOT NULL OR net_buy IS NOT NULL)
        ${channelClause}
    `);

    const currentBps = parseFloat(currentResult.rows[0]?.avg_margin_bps) || 0;
    const priorBps = parseFloat(priorResult.rows[0]?.avg_margin_bps) || 0;

    return {
      currentMonthBps: Math.round(currentBps * 100) / 100,
      priorMonthBps: Math.round(priorBps * 100) / 100,
      deltaBps: Math.round((currentBps - priorBps) * 100) / 100,
    };
  } catch (error) {
    console.error("[InsightMetrics] Error fetching margin data:", error);
    return { currentMonthBps: 0, priorMonthBps: 0, deltaBps: 0 };
  }
}

// ============================================================================
// D2 — Condition Backlog
// Average number_of_conditions for active loans; flag loans with >10
// ============================================================================

async function fetchConditionBacklog(
  tenantPool: pg.Pool,
  channelGroup?: string
): Promise<{ avgConditions: number; highConditionCount: number; highConditionLoanIds: string[] }> {
  try {
    const channelClause = buildChannelWhereClause(channelGroup);

    const result = await tenantPool.query(`
      SELECT loan_id, COALESCE(number_of_conditions, 0) as conditions
      FROM public.loans
      WHERE current_loan_status = 'Active Loan'
        AND number_of_conditions IS NOT NULL
        AND number_of_conditions > 0
        ${channelClause}
    `);

    const totalConditions = result.rows.reduce((sum: number, r: any) => sum + (parseInt(r.conditions) || 0), 0);
    const avgConditions = result.rows.length > 0 ? totalConditions / result.rows.length : 0;
    const highConditionRows = result.rows.filter((r: any) => parseInt(r.conditions) > 10);

    return {
      avgConditions: Math.round(avgConditions * 10) / 10,
      highConditionCount: highConditionRows.length,
      highConditionLoanIds: highConditionRows.map((r: any) => r.loan_id),
    };
  } catch (error) {
    console.error("[InsightMetrics] Error fetching condition backlog:", error);
    return { avgConditions: 0, highConditionCount: 0, highConditionLoanIds: [] };
  }
}

// ============================================================================
// Personnel Tiering — Revenue-based Pareto tiers
// ============================================================================

interface TieringActorRow {
  name: string;
  revenue: number;
  units: number;
  volume: number;
  revenueBps: number;
  pullThrough: number;
  avgCycleTime: number;
  lostOpportunityUnits: number;
  deniedUnits: number;
  tier: "top" | "second" | "bottom";
}

function computeTiers(rawActors: Array<{ name: string; revenue: number; units: number; volume: number; revenueBps: number; pullThrough: number; avgCycleTime: number; lostOpportunityUnits: number; deniedUnits: number }>): TieringActorRow[] {
  const totalRevenue = rawActors.reduce((s, a) => s + a.revenue, 0);
  let cumRev = 0;
  return rawActors.map(a => {
    cumRev += a.revenue;
    const pct = totalRevenue > 0 ? (cumRev / totalRevenue) * 100 : 0;
    const tier: "top" | "second" | "bottom" = pct <= 50 ? "top" : pct <= 80 ? "second" : "bottom";
    return { ...a, tier };
  });
}

function tierAverages(actors: TieringActorRow[], tier: string) {
  const subset = actors.filter(a => a.tier === tier);
  if (subset.length === 0) return { avgRevenue: 0, avgUnits: 0, avgBps: 0, avgPullThrough: 0, avgCycleTime: 0 };
  return {
    avgRevenue: Math.round(subset.reduce((s, a) => s + a.revenue, 0) / subset.length),
    avgUnits: Math.round(subset.reduce((s, a) => s + a.units, 0) / subset.length * 10) / 10,
    avgBps: Math.round(subset.reduce((s, a) => s + a.revenueBps, 0) / subset.length),
    avgPullThrough: Math.round(subset.reduce((s, a) => s + a.pullThrough, 0) / subset.length * 10) / 10,
    avgCycleTime: Math.round(subset.reduce((s, a) => s + a.avgCycleTime, 0) / subset.length),
  };
}

async function fetchPersonnelTiering(
  tenantPool: pg.Pool,
  channelGroup?: string
): Promise<InsightMetricsPayload["tiering"]> {
  const result: InsightMetricsPayload["tiering"] = { byActorType: [] };

  try {
    const revenueExpr = await getTenantRevenueExpression(tenantPool);
    console.log(`[InsightMetrics] Revenue expression (first 200 chars): ${revenueExpr.substring(0, 200)}`);
    const channelClause = buildChannelWhereClause(channelGroup);

    // Date ranges: YTD + multi-window period-over-period (30D, 60D, 90D)
    const now = new Date();
    const today = now.toISOString().split("T")[0];
    const startOfYear = new Date(now.getFullYear(), 0, 1).toISOString().split("T")[0];
    const DAY = 24 * 60 * 60 * 1000;
    const periodWindows: Array<{ window: "30d" | "60d" | "90d"; curStart: string; curEnd: string; priorStart: string; priorEnd: string }> = [
      { window: "30d", curStart: new Date(now.getTime() - 30 * DAY).toISOString().split("T")[0], curEnd: today, priorStart: new Date(now.getTime() - 60 * DAY).toISOString().split("T")[0], priorEnd: new Date(now.getTime() - 31 * DAY).toISOString().split("T")[0] },
      { window: "60d", curStart: new Date(now.getTime() - 60 * DAY).toISOString().split("T")[0], curEnd: today, priorStart: new Date(now.getTime() - 120 * DAY).toISOString().split("T")[0], priorEnd: new Date(now.getTime() - 61 * DAY).toISOString().split("T")[0] },
      { window: "90d", curStart: new Date(now.getTime() - 90 * DAY).toISOString().split("T")[0], curEnd: today, priorStart: new Date(now.getTime() - 180 * DAY).toISOString().split("T")[0], priorEnd: new Date(now.getTime() - 91 * DAY).toISOString().split("T")[0] },
    ];

    // Actor configs: use channel-aware column for loan officers (TPO → account_executive)
    // When channel is "All", use COALESCE(loan_officer, account_executive) to capture both Retail and TPO
    const actorExpr =
      !channelGroup || channelGroup === "All"
        ? "COALESCE(NULLIF(TRIM(loan_officer), ''), NULLIF(TRIM(account_executive), ''))"
        : getActorColumnForChannel(channelGroup);
    const actorConfigs: Array<{
      actorType: "loan_officer" | "branch";
      actorLabel: string;
      actorColumn: string;
    }> = [
      {
        actorType: "loan_officer",
        actorLabel: getActorLabelForChannel(channelGroup),
        actorColumn: actorExpr,
      },
      { actorType: "branch", actorLabel: "Branches", actorColumn: "branch" },
    ];

    // Use COALESCE(funding_date, closing_date) to match toptiering—include loans closed via either field
    // Cast to DATE because funding_date is TIMESTAMPTZ — subtraction with DATE application_date needs matching types
    const closeDateExpr = "COALESCE(funding_date::date, closing_date)";

    for (const cfg of actorConfigs) {
      try {
        // Query 1: Funded loans — revenue, volume, units, BPS, cycle time per actor
        const fundedQuery = `
          SELECT
            ${cfg.actorColumn} AS actor_name,
            COUNT(DISTINCT COALESCE(loan_number, loan_id::text)) AS units,
            SUM(loan_amount) AS volume,
            SUM(${revenueExpr}) AS revenue,
            CASE WHEN SUM(loan_amount) > 0
              THEN (SUM(${revenueExpr}) / SUM(loan_amount)) * 10000
              ELSE 0
            END AS revenue_bps,
            AVG(${closeDateExpr} - application_date) AS avg_cycle_days
          FROM public.loans
          WHERE (funding_date IS NOT NULL OR closing_date IS NOT NULL)
            AND ${closeDateExpr} >= $1
            AND ${closeDateExpr} <= $2
            ${channelClause}
          GROUP BY ${cfg.actorColumn}
          HAVING SUM(${revenueExpr}) > 0
          ORDER BY revenue DESC
        `;

        // Query 2: All applications — started, lost, denied per actor (YTD by application_date)
        const appQuery = `
          SELECT
            ${cfg.actorColumn} AS actor_name,
            COUNT(DISTINCT COALESCE(loan_number, loan_id::text)) AS started,
            COUNT(DISTINCT CASE WHEN current_loan_status ILIKE '%withdraw%' OR current_loan_status ILIKE '%cancelled%'
              OR current_loan_status ILIKE '%canceled%' OR current_loan_status ILIKE '%not accepted%'
              OR current_loan_status ILIKE '%incomplete%' THEN COALESCE(loan_number, loan_id::text) END) AS lost,
            COUNT(DISTINCT CASE WHEN current_loan_status ILIKE '%denied%'
              OR current_loan_status ILIKE '%declined%' THEN COALESCE(loan_number, loan_id::text) END) AS denied
          FROM public.loans
          WHERE application_date >= $1
            AND application_date <= $2
            ${channelClause}
          GROUP BY ${cfg.actorColumn}
        `;

        const [fundedRes, appRes] = await Promise.all([
          tenantPool.query(fundedQuery, [startOfYear, today]),
          tenantPool.query(appQuery, [startOfYear, today]),
        ]);

        // Build lookup from application query
        const appMap = new Map<string, { started: number; lost: number; denied: number }>();
        for (const r of appRes.rows) {
          if (!isActorMissing(r.actor_name)) {
            appMap.set(r.actor_name, {
              started: parseInt(r.started) || 0,
              lost: parseInt(r.lost) || 0,
              denied: parseInt(r.denied) || 0,
            });
          }
        }

        const rawActors = fundedRes.rows
          .filter((r: any) => !isActorMissing(r.actor_name))
          .map((r: any) => {
            const name = r.actor_name || "Unknown";
            const units = parseInt(r.units) || 0;
            const appData = appMap.get(r.actor_name) || { started: 0, lost: 0, denied: 0 };
            const started = Math.max(appData.started, units); // started should be >= funded
            return {
              name,
              revenue: parseFloat(r.revenue) || 0,
              units,
              volume: parseFloat(r.volume) || 0,
              revenueBps: Math.round(parseFloat(r.revenue_bps) || 0),
              pullThrough: started > 0 ? Math.round((units / started) * 1000) / 10 : 0,
              avgCycleTime: Math.round(parseFloat(r.avg_cycle_days) || 0),
              lostOpportunityUnits: appData.lost,
              deniedUnits: appData.denied,
            };
          });

        if (rawActors.length === 0) continue;

        const tieredActors = computeTiers(rawActors);
        const topCount = tieredActors.filter(a => a.tier === "top").length;
        const secondCount = tieredActors.filter(a => a.tier === "second").length;
        const bottomCount = tieredActors.filter(a => a.tier === "bottom").length;

        // Multi-window period-over-period: 30D, 60D, 90D each vs their prior equivalent period
        let periodChanges: InsightMetricsPayload["tiering"]["byActorType"][0]["periodChanges"] = [];
        try {
          const periodQuery = `
            SELECT
              ${cfg.actorColumn} AS actor_name,
              COUNT(DISTINCT CASE WHEN (funding_date IS NOT NULL OR closing_date IS NOT NULL) AND ${closeDateExpr} >= $1 AND ${closeDateExpr} <= $2 THEN COALESCE(loan_number, loan_id::text) END) AS funded_cur,
              COUNT(DISTINCT CASE WHEN application_date >= $1 AND application_date <= $2 THEN COALESCE(loan_number, loan_id::text) END) AS started_cur,
              SUM(CASE WHEN (funding_date IS NOT NULL OR closing_date IS NOT NULL) AND ${closeDateExpr} >= $1 AND ${closeDateExpr} <= $2 THEN (${revenueExpr}) ELSE 0 END) AS revenue_cur,
              SUM(CASE WHEN (funding_date IS NOT NULL OR closing_date IS NOT NULL) AND ${closeDateExpr} >= $1 AND ${closeDateExpr} <= $2 THEN loan_amount ELSE 0 END) AS volume_cur,
              AVG(CASE WHEN (funding_date IS NOT NULL OR closing_date IS NOT NULL) AND ${closeDateExpr} >= $1 AND ${closeDateExpr} <= $2
                  THEN (${closeDateExpr} - application_date) END) AS cycle_cur,
              COUNT(DISTINCT CASE WHEN (funding_date IS NOT NULL OR closing_date IS NOT NULL) AND ${closeDateExpr} >= $3 AND ${closeDateExpr} <= $4 THEN COALESCE(loan_number, loan_id::text) END) AS funded_prior,
              COUNT(DISTINCT CASE WHEN application_date >= $3 AND application_date <= $4 THEN COALESCE(loan_number, loan_id::text) END) AS started_prior,
              SUM(CASE WHEN (funding_date IS NOT NULL OR closing_date IS NOT NULL) AND ${closeDateExpr} >= $3 AND ${closeDateExpr} <= $4 THEN (${revenueExpr}) ELSE 0 END) AS revenue_prior,
              SUM(CASE WHEN (funding_date IS NOT NULL OR closing_date IS NOT NULL) AND ${closeDateExpr} >= $3 AND ${closeDateExpr} <= $4 THEN loan_amount ELSE 0 END) AS volume_prior,
              AVG(CASE WHEN (funding_date IS NOT NULL OR closing_date IS NOT NULL) AND ${closeDateExpr} >= $3 AND ${closeDateExpr} <= $4
                  THEN (${closeDateExpr} - application_date) END) AS cycle_prior
            FROM public.loans
            WHERE (application_date >= $1 AND application_date <= $2) OR (application_date >= $3 AND application_date <= $4)
              OR ((${closeDateExpr} >= $1 AND ${closeDateExpr} <= $2) OR (${closeDateExpr} >= $3 AND ${closeDateExpr} <= $4))
              ${channelClause}
            GROUP BY ${cfg.actorColumn}
          `;
          const MIN_DELTA_PCT = 5;
          const invertedMetrics = new Set<string>(["cycleTime"]);

          // Run the same query across 30D, 60D, 90D windows
          for (const pw of periodWindows) {
            console.log(`[InsightMetrics] Running period query for ${pw.window}: cur=${pw.curStart}→${pw.curEnd}, prior=${pw.priorStart}→${pw.priorEnd}`);
            const periodRes = await tenantPool.query(periodQuery, [pw.curStart, pw.curEnd, pw.priorStart, pw.priorEnd]);
            console.log(`[InsightMetrics] Period ${pw.window} returned ${periodRes.rows.length} rows`);
            for (const r of periodRes.rows) {
              if (isActorMissing(r.actor_name)) continue;
              const fundedCur = parseInt(r.funded_cur) || 0;
              const startedCur = parseInt(r.started_cur) || 0;
              const fundedPrior = parseInt(r.funded_prior) || 0;
              const startedPrior = parseInt(r.started_prior) || 0;
              const revenueCur = parseFloat(r.revenue_cur) || 0;
              const volumeCur = parseFloat(r.volume_cur) || 0;
              const revenuePrior = parseFloat(r.revenue_prior) || 0;
              const volumePrior = parseFloat(r.volume_prior) || 0;

              // Debug: log revenue vs volume for top actors to catch any mismatch
              if (fundedCur >= 5 || fundedPrior >= 5) {
                console.log(`[InsightMetrics] Period ${pw.window} actor="${r.actor_name}": rev_cur=$${Math.round(revenueCur)} vol_cur=$${Math.round(volumeCur)} rev_prior=$${Math.round(revenuePrior)} vol_prior=$${Math.round(volumePrior)} units_cur=${fundedCur} units_prior=${fundedPrior}`);
              }
              const pullCur = startedCur > 0 ? (fundedCur / startedCur) * 100 : 0;
              const pullPrior = startedPrior > 0 ? (fundedPrior / startedPrior) * 100 : 0;
              const bpsCur = volumeCur > 0 ? (revenueCur / volumeCur) * 10000 : 0;
              const bpsPrior = volumePrior > 0 ? (revenuePrior / volumePrior) * 10000 : 0;
              const unitsCur = fundedCur;
              const unitsPrior = fundedPrior;
              const cycleCur = parseFloat(r.cycle_cur) || 0;
              const cyclePrior = parseFloat(r.cycle_prior) || 0;

              const checkDelta = (
                metric: "revenue" | "units" | "volume" | "pullThrough" | "revenueBps" | "cycleTime",
                cur: number,
                prior: number
              ) => {
                if (prior <= 0 || cur === prior) return;
                const deltaPct = ((cur - prior) / prior) * 100;
                if (Math.abs(deltaPct) >= MIN_DELTA_PCT) {
                  const isInverted = invertedMetrics.has(metric);
                  const needsDecimalRounding = metric === "pullThrough" || metric === "cycleTime";
                  const roundedCur = needsDecimalRounding ? Math.round(cur * 10) / 10 : Math.round(cur);
                  const roundedPrior = needsDecimalRounding ? Math.round(prior * 10) / 10 : Math.round(prior);
                  // Skip if rounded values are identical (would display as e.g. "$163K→$163K")
                  if (roundedCur === roundedPrior) return;
                  periodChanges.push({
                    name: r.actor_name || "Unknown",
                    metric,
                    current: roundedCur,
                    prior: roundedPrior,
                    deltaPct: Math.round(deltaPct * 10) / 10,
                    direction: isInverted
                      ? (deltaPct < 0 ? "improved" : "declined")
                      : (deltaPct > 0 ? "improved" : "declined"),
                    window: pw.window,
                  });
                }
              };
              checkDelta("revenue", revenueCur, revenuePrior);
              checkDelta("units", unitsCur, unitsPrior);
              checkDelta("volume", volumeCur, volumePrior);
              if (pullPrior > 0 && pullCur > 0) checkDelta("pullThrough", pullCur, pullPrior);
              if (bpsPrior > 0 && bpsCur > 0) checkDelta("revenueBps", bpsCur, bpsPrior);
              if (cyclePrior > 0 && cycleCur > 0) checkDelta("cycleTime", cycleCur, cyclePrior);
            }
          }
          // Keep top 30 most significant changes across all windows
          periodChanges = periodChanges
            .sort((a, b) => Math.abs(b.deltaPct) - Math.abs(a.deltaPct))
            .slice(0, 30);
          if (periodChanges.length > 0) {
            console.log(`[InsightMetrics] Tiering period changes (multi-window) for ${cfg.actorLabel}: ${periodChanges.length} entries`);
            // Log sample for debugging
            const sample = periodChanges.slice(0, 5).map(c => `${c.name}:${c.metric}(${c.window})=${c.deltaPct}%`).join(", ");
            console.log(`[InsightMetrics] Period sample: ${sample}`);
          } else {
            console.log(`[InsightMetrics] Tiering period changes: NONE found for ${cfg.actorLabel}. Windows checked: ${periodWindows.map(w => w.window).join(",")}`);
          }
        } catch (periodErr) {
          console.warn(`[InsightMetrics] Period comparison failed for ${cfg.actorType}:`, periodErr);
        }

        result.byActorType.push({
          actorType: cfg.actorType,
          actorLabel: cfg.actorLabel,
          totalActors: tieredActors.length,
          tierDistribution: { top: topCount, second: secondCount, bottom: bottomCount },
          topPerformers: tieredActors.filter(a => a.tier === "top").slice(0, 5),
          bottomPerformers: tieredActors.filter(a => a.tier === "bottom").slice(-5).reverse(),
          tierAverages: {
            top: tierAverages(tieredActors, "top"),
            second: tierAverages(tieredActors, "second"),
            bottom: tierAverages(tieredActors, "bottom"),
          },
          periodChanges: periodChanges.length > 0 ? periodChanges : undefined,
        });
      } catch (innerErr) {
        console.warn(`[InsightMetrics] Tiering failed for ${cfg.actorType}:`, innerErr);
      }
    }

    if (result.byActorType.length === 0) {
      console.log("[InsightMetrics] Tiering: no actor data (no funded loans YTD, or all actors filtered as missing)");
    } else {
      console.log(`[InsightMetrics] Tiering: collected for ${result.byActorType.map((t) => `${t.actorLabel}=${t.totalActors}`).join(", ")}`);
    }
  } catch (error) {
    console.error("[InsightMetrics] Error fetching personnel tiering:", error);
  }

  return result;
}

/**
 * Main function to collect all metrics for insights generation
 *
 * @param tenantPool - Database connection pool
 * @param dateFilter - Date filter ('today', 'mtd', 'ytd')
 * @param options - Additional options including channelGroup filter
 */
export async function collectInsightMetrics(
  tenantPool: pg.Pool,
  dateFilter: string = "ytd",
  options: { channelGroup?: string } = {}
): Promise<InsightMetricsPayload> {
  const { channelGroup } = options;
  console.log(
    `[InsightMetrics] Collecting metrics for dateFilter: ${dateFilter}, channelGroup: ${
      channelGroup || "all"
    }`
  );

  const dateRanges = getDateRanges();
  const now = new Date().toISOString();

  // Build additional filters for channel filtering
  const additionalFilters: Record<string, any> = {};
  if (channelGroup) {
    additionalFilters.consolidated_channel = channelGroup;
  }

  // Determine the primary date range based on filter
  let primaryDateRange: DateRange;
  switch (dateFilter) {
    case "today":
      primaryDateRange = dateRanges.today;
      break;
    case "mtd":
      primaryDateRange = dateRanges.mtd;
      break;
    case "ytd":
    default:
      primaryDateRange = dateRanges.ytd;
      break;
  }

  // Fetch all data in parallel, applying channel filter to all queries
  const [
    // Core metrics for different periods
    ytdMetrics,
    mtdMetrics,
    rolling90DMetrics,
    // Predictions
    predictions,
    // Rolling 90D pull-through
    pullThroughRolling90D,
    // Lost opportunity
    lostOpportunity,
    // Funnel
    funnel,
    // Credit risk (now returns { count, loanIds })
    creditRiskResult,
    // New trigger metrics
    closingRisk,
    lockExpiration,
    tridExposure,
    marginData,
    conditionBacklog,
    // Personnel tiering
    tiering,
  ] = await Promise.all([
    // YTD metrics
    queryMetrics(
      tenantPool,
      [
        "active_loans",
        "active_volume",
        "locked_loans",
        "closed_loans",
        "funded_volume",
        "avg_cycle_time",
        "total_revenue",
        "wa_fico",
        "wa_ltv",
        "wa_dti",
      ],
      { dateRange: dateRanges.ytd, additionalFilters }
    ),

    // MTD metrics
    queryMetrics(
      tenantPool,
      ["funded_volume", "total_revenue", "avg_cycle_time"],
      { dateRange: dateRanges.mtd, additionalFilters }
    ),

    // Rolling 90D metrics (for comparison)
    queryMetrics(tenantPool, ["funded_volume", "avg_cycle_time"], {
      dateRange: dateRanges.rolling90D,
      additionalFilters,
    }),

    // Predictions (channel filter applied within function)
    fetchPredictions(tenantPool, channelGroup),

    // Rolling 90D pull-through (channel filter applied within function)
    calculateRolling90DPullThrough(tenantPool, channelGroup),

    // Lost opportunity YTD (channel filter applied within function)
    fetchLostOpportunity(tenantPool, dateRanges.ytd, channelGroup),

    // Funnel YTD (channel filter applied within function)
    fetchFunnelMetrics(tenantPool, dateRanges.ytd, channelGroup),

    // High risk loans with IDs (channel filter applied within function)
    fetchCreditRiskLoans(tenantPool, channelGroup),

    // New trigger metrics (B3, C1, G1, C2, D2)
    fetchClosingLateRisk(tenantPool, channelGroup),
    fetchLockExpirationExposure(tenantPool, channelGroup),
    fetchTridExposure(tenantPool, channelGroup),
    fetchMarginData(tenantPool, channelGroup),
    fetchConditionBacklog(tenantPool, channelGroup),

    // Personnel tiering
    fetchPersonnelTiering(tenantPool, channelGroup),
  ]);

  // Process predictions
  const withdrawPredictions = predictions.filter(
    (p) => p.predictedOutcome === "withdraw"
  );
  const denyPredictions = predictions.filter(
    (p) => p.predictedOutcome === "deny"
  );
  const originatePredictions = predictions.filter(
    (p) => p.predictedOutcome === "originate"
  );

  // ALL at-risk loan IDs (any confidence, withdraw or deny)
  const allAtRiskPredictions = predictions.filter(
    (p) => p.predictedOutcome === "withdraw" || p.predictedOutcome === "deny"
  );
  const allAtRiskLoanIds = allAtRiskPredictions.map((p) => p.loanId);

  // High-risk loans (confidence >= 70% for withdraw or deny)
  const highRiskLoans = predictions
    .filter(
      (p) =>
        (p.predictedOutcome === "withdraw" || p.predictedOutcome === "deny") &&
        p.confidence >= 70
    )
    .slice(0, 20) // Top 20 high risk
    .map((p) => ({
      loanId: p.loanId,
      confidence: p.confidence,
      predictedOutcome: p.predictedOutcome,
      riskFactors: p.riskFactors || [],
    }));

  // Fetch volumes for BOTH groups in parallel
  const highRiskLoanIds = highRiskLoans.map((l) => l.loanId);
  const [allAtRiskVolume, highRiskVolume] = await Promise.all([
    fetchAtRiskVolume(tenantPool, allAtRiskLoanIds),
    fetchAtRiskVolume(tenantPool, highRiskLoanIds),
  ]);

  // Calculate comparisons
  const comparisons = await calculateComparisons(
    tenantPool,
    mtdMetrics,
    ytdMetrics,
    dateRanges
  );

  // Build the payload
  const payload: InsightMetricsPayload = {
    generatedAt: now,
    period: {
      dateFilter,
      start: primaryDateRange.start,
      end: primaryDateRange.end,
    },

    pipeline: {
      activeLoans: Number(ytdMetrics.active_loans?.value || 0),
      activeVolume: Number(ytdMetrics.active_volume?.value || 0),
      lockedLoans: Number(ytdMetrics.locked_loans?.value || 0),
      closedLoans: Number(ytdMetrics.closed_loans?.value || 0),
      closedVolume: Number(ytdMetrics.funded_volume?.value || 0),
    },

    predictions: {
      likelyWithdraw: withdrawPredictions.length,
      likelyDeny: denyPredictions.length,
      likelyOriginate: originatePredictions.length,
      allAtRiskLoanIds,
      allAtRiskVolume,
      highRiskLoans,
      highRiskVolume,
    },

    performance: {
      pullThroughRolling90D,
      avgCycleTime: Number(ytdMetrics.avg_cycle_time?.value || 0),
      revenueYTD:
        Number(ytdMetrics.total_revenue?.value || 0) ||
        Number(ytdMetrics.funded_volume?.value || 0) * 0.01,
      revenueMTD:
        Number(mtdMetrics.total_revenue?.value || 0) ||
        Number(mtdMetrics.funded_volume?.value || 0) * 0.01,
      volumeYTD: Number(ytdMetrics.funded_volume?.value || 0),
      volumeMTD: Number(mtdMetrics.funded_volume?.value || 0),
    },

    creditRisk: {
      waFico: Number(ytdMetrics.wa_fico?.value || 0),
      waLtv: Number(ytdMetrics.wa_ltv?.value || 0),
      waDti: Number(ytdMetrics.wa_dti?.value || 0),
      highRiskLoanCount: creditRiskResult.count,
      highRiskLoanIds: creditRiskResult.loanIds,
      highRiskVolume: creditRiskResult.volume,
    },

    lostOpportunity,

    funnel,

    comparisons,

    closingRisk,
    lockExpiration,
    tridExposure,
    marginData,
    conditionBacklog,
    tiering,
  };

  console.log(`[InsightMetrics] Collected metrics payload:`, {
    activeLoans: payload.pipeline.activeLoans,
    predictions: {
      withdraw: payload.predictions.likelyWithdraw,
      deny: payload.predictions.likelyDeny,
      originate: payload.predictions.likelyOriginate,
      allAtRisk: payload.predictions.allAtRiskLoanIds.length,
      allAtRiskVolume: payload.predictions.allAtRiskVolume,
      highRisk: payload.predictions.highRiskLoans.length,
      highRiskVolume: payload.predictions.highRiskVolume,
    },
    pullThrough: payload.performance.pullThroughRolling90D,
    cycleTime: payload.performance.avgCycleTime,
    closingRisk: payload.closingRisk.atRiskCount,
    lockExpiration: payload.lockExpiration.expiringCount,
    tridExposure: payload.tridExposure.atRiskCount,
    marginBps: `${payload.marginData.currentMonthBps} (delta: ${payload.marginData.deltaBps})`,
    conditionBacklog: `avg=${payload.conditionBacklog.avgConditions}, high=${payload.conditionBacklog.highConditionCount}`,
    tiering: payload.tiering.byActorType.map(t => `${t.actorLabel}: ${t.totalActors} (${t.tierDistribution.top}/${t.tierDistribution.second}/${t.tierDistribution.bottom})`).join(', '),
  });

  return payload;
}

export default {
  collectInsightMetrics,
};
