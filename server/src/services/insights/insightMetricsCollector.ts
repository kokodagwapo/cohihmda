/**
 * Insight Metrics Collector
 * Aggregates metrics from multiple sources into a single payload for LLM processing
 */

import pg from "pg";
import { queryMetrics, DateRange } from "../metrics/metricsService.js";
import { buildChannelWhereClause } from "../../utils/scorecard-utils.js";

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

    // Get most recent prediction per loan, optionally filtered by channel
    const channelClause = buildChannelWhereClause(channelGroup);
    const result = await tenantPool.query(`
      SELECT DISTINCT ON (p.loan_id)
        p.loan_id,
        p.predicted_outcome,
        p.confidence,
        p.reasoning,
        p.risk_factors
      FROM public.loan_predictions p
      ${channelGroup ? "JOIN public.loans l ON p.loan_id = l.loan_id" : ""}
      WHERE 1=1
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
        COUNT(CASE WHEN funding_date IS NOT NULL OR current_loan_status IN ('funded', 'closed', 'originated') THEN 1 END) as originated,
        COUNT(CASE WHEN current_loan_status IN ('withdrawn', 'cancelled', 'denied', 'declined') THEN 1 END) as fallout
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

    return {
      loansStarted: total,
      loansLocked: parseInt(row?.locked) || 0,
      loansOriginated: parseInt(row?.originated) || 0,
      falloutRate: total > 0 ? (fallout / total) * 100 : 0,
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
  });

  return payload;
}

export default {
  collectInsightMetrics,
};
