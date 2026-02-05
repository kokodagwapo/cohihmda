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
    highRiskLoans: Array<{
      loanId: string;
      confidence: number;
      predictedOutcome: string;
      riskFactors: string[];
    }>;
    totalAtRiskVolume: number;
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
  };

  // Lost opportunity
  lostOpportunity: {
    withdrawnUnits: number;
    withdrawnVolume: number;
    withdrawnProformaRevenue: number;
    deniedUnits: number;
    deniedVolume: number;
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
  };

  // Scorecard summary (if available)
  scorecard?: {
    topTierCount: number;
    secondTierCount: number;
    bottomTierCount: number;
    avgTtsScore: number;
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

  // Last month
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

  return {
    today: { start: today, end: today },
    mtd: { start: startOfMonth, end: today },
    ytd: { start: startOfYear, end: today },
    rolling90D: { start: rolling90Start, end: today },
    lastMonth: { start: lastMonthStart, end: lastMonthEnd },
    lastYear: { start: lastYearStart, end: lastYearEnd },
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
 * Fetch credit risk metrics (high risk loan count)
 */
async function fetchCreditRiskCount(
  tenantPool: pg.Pool,
  channelGroup?: string
): Promise<number> {
  try {
    const channelClause = buildChannelWhereClause(channelGroup);
    const result = await tenantPool.query(`
      SELECT COUNT(*) as count
      FROM public.loans
      WHERE current_loan_status = 'Active Loan'
        AND (
          (fico_score IS NOT NULL AND CAST(fico_score AS DECIMAL) < 620)
          OR (ltv_ratio IS NOT NULL AND CAST(ltv_ratio AS DECIMAL) > 95)
          OR (be_dti_ratio IS NOT NULL AND CAST(be_dti_ratio AS DECIMAL) > 50)
        )
        ${channelClause}
    `);

    return parseInt(result.rows[0]?.count) || 0;
  } catch (error) {
    console.error("[InsightMetrics] Error fetching credit risk count:", error);
    return 0;
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
 * Fetch lost opportunity metrics (withdrawn and denied loans)
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
}> {
  try {
    const channelClause = buildChannelWhereClause(channelGroup);
    const result = await tenantPool.query(
      `
      SELECT
        COUNT(CASE WHEN current_loan_status IN ('withdrawn', 'cancelled', 'Withdrawn') THEN 1 END) as withdrawn_units,
        COALESCE(SUM(CASE WHEN current_loan_status IN ('withdrawn', 'cancelled', 'Withdrawn') THEN loan_amount END), 0) as withdrawn_volume,
        COUNT(CASE WHEN current_loan_status IN ('denied', 'declined', 'Denied') THEN 1 END) as denied_units,
        COALESCE(SUM(CASE WHEN current_loan_status IN ('denied', 'declined', 'Denied') THEN loan_amount END), 0) as denied_volume
      FROM public.loans
      WHERE application_date >= $1
        AND application_date <= $2
        ${channelClause}
    `,
      [dateRange.start, dateRange.end]
    );

    const row = result.rows[0];
    const withdrawnVolume = parseFloat(row?.withdrawn_volume) || 0;

    return {
      withdrawnUnits: parseInt(row?.withdrawn_units) || 0,
      withdrawnVolume,
      withdrawnProformaRevenue: withdrawnVolume * 0.01, // Estimate 1% revenue
      deniedUnits: parseInt(row?.denied_units) || 0,
      deniedVolume: parseFloat(row?.denied_volume) || 0,
    };
  } catch (error) {
    console.error("[InsightMetrics] Error fetching lost opportunity:", error);
    return {
      withdrawnUnits: 0,
      withdrawnVolume: 0,
      withdrawnProformaRevenue: 0,
      deniedUnits: 0,
      deniedVolume: 0,
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
}> {
  try {
    // Get last month's metrics
    const lastMonthMetrics = await queryMetrics(
      tenantPool,
      ["funded_volume", "avg_cycle_time", "pull_through_rate"],
      { dateRange: dateRanges.lastMonth }
    );

    // Get last year same period metrics
    const lastYearMetrics = await queryMetrics(tenantPool, ["funded_volume"], {
      dateRange: dateRanges.lastYear,
    });

    const currentVolume = Number(currentMtdMetrics.funded_volume?.value || 0);
    const lastMonthVolume = Number(lastMonthMetrics.funded_volume?.value || 0);
    const lastYearVolume = Number(lastYearMetrics.funded_volume?.value || 0);

    const currentCycleTime = Number(
      currentMtdMetrics.avg_cycle_time?.value || 0
    );
    const lastMonthCycleTime = Number(
      lastMonthMetrics.avg_cycle_time?.value || 0
    );

    return {
      volumeVsLastMonth:
        lastMonthVolume > 0
          ? ((currentVolume - lastMonthVolume) / lastMonthVolume) * 100
          : 0,
      volumeVsLastYear:
        lastYearVolume > 0
          ? ((Number(currentYtdMetrics.funded_volume?.value || 0) -
              lastYearVolume) /
              lastYearVolume) *
            100
          : 0,
      cycleTimeVsLastMonth:
        lastMonthCycleTime > 0
          ? ((currentCycleTime - lastMonthCycleTime) / lastMonthCycleTime) * 100
          : 0,
      pullThroughVsLastMonth: 0, // Will be calculated separately with rolling 90D methodology
    };
  } catch (error) {
    console.error("[InsightMetrics] Error calculating comparisons:", error);
    return {
      volumeVsLastMonth: 0,
      volumeVsLastYear: 0,
      cycleTimeVsLastMonth: 0,
      pullThroughVsLastMonth: 0,
    };
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
    // Credit risk
    highRiskCount,
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

    // High risk loan count (channel filter applied within function)
    fetchCreditRiskCount(tenantPool, channelGroup),
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

  // High-risk loans (confidence > 70% for withdraw or deny)
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

  // Fetch at-risk volume
  const highRiskLoanIds = highRiskLoans.map((l) => l.loanId);
  const totalAtRiskVolume = await fetchAtRiskVolume(
    tenantPool,
    highRiskLoanIds
  );

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
      highRiskLoans,
      totalAtRiskVolume,
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
      highRiskLoanCount: highRiskCount,
    },

    lostOpportunity,

    funnel,

    comparisons,
  };

  console.log(`[InsightMetrics] Collected metrics payload:`, {
    activeLoans: payload.pipeline.activeLoans,
    predictions: {
      withdraw: payload.predictions.likelyWithdraw,
      deny: payload.predictions.likelyDeny,
      originate: payload.predictions.likelyOriginate,
      highRisk: payload.predictions.highRiskLoans.length,
    },
    pullThrough: payload.performance.pullThroughRolling90D,
    cycleTime: payload.performance.avgCycleTime,
  });

  return payload;
}

export default {
  collectInsightMetrics,
};
