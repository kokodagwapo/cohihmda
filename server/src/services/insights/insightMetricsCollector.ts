/**
 * Insight Metrics Collector
 * Aggregates metrics from multiple sources into a single payload for LLM processing
 */

import pg from "pg";
import { queryMetrics, DateRange } from "../metrics/metricsService.js";
import {
  buildChannelWhereClause,
  buildFundedFilter,
  getActorColumnForChannel,
  getActorLabelForChannel,
  isActorMissing,
} from "../../utils/scorecard-utils.js";
import {
  computePeriodSnapshot,
  computeAllPeriodSnapshots,
  getStandardDateRanges,
  getTenantRevenueExpression,
  type PeriodSnapshot,
} from "../metrics/canonicalMetrics.js";
import { generateEmbeddings } from "../embeddingService.js";
import {
  searchSimilarHistorical,
  type SimilarLoan,
} from "../dashboard/loanRag/loanEmbeddingStore.js";
import { LOAN_RAG_EMBEDDING_MODEL } from "../dashboard/loanRag/config.js";
import { tenantDbManager } from "../../config/tenantDatabaseManager.js";

// Prediction data structure
export interface PredictionData {
  loanId: string;
  predictedOutcome: "withdraw" | "deny" | "originate";
  confidence: number;
  reasoning?: string;
  riskFactors?: string[];
  // Enriched fields from loan_data JSONB (prediction service output)
  loanAmount: number;
  riskScore: number | null;
  creditRiskScore: number | null;
  processRiskScore: number | null;
  bucket: string | null;
  // Composite signal strengths (1-6 scale)
  creditMetricsSignal: number | null;
  loanCharacteristicsSignal: number | null;
  timeInMotionSignal: number | null;
  mloSignal: number | null;
  marketDeltaSignal: number | null;
  // Key raw values for aggregation
  marketChangeDelta: number | null;
  loPullthroughPct: number | null;
  activeDays: number | null;
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

  // Prediction signal summary — driver distributions and risk score buckets
  predictionSignals: {
    withdrawalDrivers: Array<{ driver: string; count: number; volume: number }>;
    denialDrivers: Array<{ driver: string; count: number; volume: number }>;
    riskScoreDistribution: { high: number; medium: number; low: number };
    avgCreditRiskScore: number;
    avgProcessRiskScore: number;
    topRiskFactors: Array<{ factor: string; count: number }>;
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
    // Enhanced close-late probability data from prediction service
    closeLate: {
      highProbCount: number;
      highProbVolume: number;
      highProbLoanIds: string[];
      mediumProbCount: number;
      mediumProbVolume: number;
      lowProbCount: number;
      lowProbVolume: number;
      byStage: Array<{
        stage: string;
        count: number;
        volume: number;
        avgDaysToEcd: number;
      }>;
    };
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
        top: {
          avgRevenue: number;
          avgUnits: number;
          avgBps: number;
          avgPullThrough: number;
          avgCycleTime: number;
        };
        second: {
          avgRevenue: number;
          avgUnits: number;
          avgBps: number;
          avgPullThrough: number;
          avgCycleTime: number;
        };
        bottom: {
          avgRevenue: number;
          avgUnits: number;
          avgBps: number;
          avgPullThrough: number;
          avgCycleTime: number;
        };
      };
      /** Multi-window period-over-period changes; officers with notable improvement or decline */
      periodChanges?: Array<{
        name: string;
        metric:
          | "revenue"
          | "units"
          | "volume"
          | "pullThrough"
          | "revenueBps"
          | "cycleTime";
        current: number;
        prior: number;
        deltaPct: number;
        direction: "improved" | "declined";
        window: "30d" | "60d" | "90d";
      }>;
      /** Complete officer name lists per tier (for evidence agent SQL filtering) */
      tierOfficerNames?: {
        top: string[];
        second: string[];
        bottom: string[];
      };
      /** Aggregate trends computed across the entire personnel population */
      aggregateTrends?: {
        /** Tier-level period trends: avg metrics per tier for current vs prior windows */
        tierTrends: Array<{
          tier: "top" | "second" | "bottom";
          metric: "revenue" | "units" | "volume" | "pullThrough" | "revenueBps" | "cycleTime";
          currentAvg: number;
          priorAvg: number;
          deltaPct: number;
          direction: "improved" | "declined";
          window: "30d" | "60d" | "90d";
        }>;
        /** Officers who moved between tiers compared to 90D prior */
        tierMigration?: Array<{
          name: string;
          fromTier: "top" | "second" | "bottom";
          toTier: "top" | "second" | "bottom";
          direction: "promoted" | "demoted";
        }>;
        /** Revenue concentration metrics */
        concentration: {
          top3RevenueShare: number;
          top5RevenueShare: number;
          giniCoefficient: number;
        };
        /** Disparity between headcount distribution and production distribution */
        headcountProductionGap: Array<{
          tier: "top" | "second" | "bottom";
          headcountPct: number;
          revenuePct: number;
          unitsPct: number;
          gap: number;
        }>;
        /** Company-wide averages across ALL actors (not tier-specific) */
        companyAverages: {
          avgRevenue: number;
          avgUnits: number;
          avgBps: number;
          avgPullThrough: number;
          avgCycleTime: number;
        };
      };
    }>;
  };

  // Pre-computed period snapshots — consistent metrics per time window
  // Pull-Through + Fallout = 100% guaranteed within each snapshot
  periodSnapshots: {
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
    // Long-term baselines
    trailing12m: PeriodSnapshot;
    trailing36m: PeriodSnapshot;
    prior12m: PeriodSnapshot;
    prior36mBaseline: PeriodSnapshot;
  };

  // Product breakdown — YTD metrics grouped by loan_type
  productBreakdown: Array<{
    productType: string;
    active: number;
    funded: number;
    withdrawn: number;
    denied: number;
    completed: number;
    fallenOut: number;
    fundedVolume: number;
    pullThroughRate: number;
    falloutRate: number;
    highRiskCreditCount: number;
  }>;

  // Field population rates — percentage of loans with non-null values for key fields
  // Used to suppress/annotate insights based on poorly-populated fields
  fieldPopulation: Record<string, number>;

  // Risk cross-tabulation — Product x FICO Band x DTI Band fallout analysis
  riskCrossTab: {
    currentPeriod: Array<{
      product: string;
      ficoBand: string;
      dtiBand: string;
      total: number;
      funded: number;
      fallenOut: number;
      falloutRate: number;
    }>;
    baseline: Array<{
      product: string;
      ficoBand: string;
      dtiBand: string;
      total: number;
      funded: number;
      fallenOut: number;
      falloutRate: number;
    }>;
    deteriorating: Array<{
      product: string;
      ficoBand: string;
      dtiBand: string;
      currentFalloutRate: number;
      baselineFalloutRate: number;
      deltaPercent: number;
      affectedLoans: number;
    }>;
  };
}

// Re-export PeriodSnapshot from canonical metrics (single source of truth)
export type { PeriodSnapshot } from "../metrics/canonicalMetrics.js";

// Date ranges now come from canonical metrics (getStandardDateRanges)
// Alias for backward compatibility within this file
const getDateRanges = getStandardDateRanges;

// computePeriodSnapshot is now imported from canonicalMetrics.ts

/**
 * Fetch stored predictions from the database
 */
async function fetchPredictions(
  tenantPool: pg.Pool,
  channelGroup?: string,
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
    // Also exclude stale active loans (application_date > 180 days ago) — these are
    // likely abandoned or stuck, and inflate prediction counts misleadingly.
    const channelClause = buildChannelWhereClause(channelGroup);
    const result = await tenantPool.query(`
      SELECT DISTINCT ON (p.loan_id)
        p.loan_id,
        p.predicted_outcome,
        p.confidence,
        p.reasoning,
        p.risk_factors,
        p.loan_data,
        COALESCE(l.loan_amount, 0) AS loan_amount
      FROM public.loan_predictions p
      JOIN public.loans l ON p.loan_id = l.loan_id
      WHERE l.current_loan_status = 'Active Loan'
        AND l.application_date >= CURRENT_DATE - INTERVAL '180 days'
        ${channelGroup ? channelClause : ""}
      ORDER BY p.loan_id, p.created_at DESC
      LIMIT 5000
    `);

    return result.rows.map((row) => {
      const ld = row.loan_data || {};
      return {
        loanId: row.loan_id,
        predictedOutcome: row.predicted_outcome,
        confidence: parseFloat(row.confidence) || 0,
        reasoning: row.reasoning,
        riskFactors: row.risk_factors || [],
        loanAmount: parseFloat(row.loan_amount) || 0,
        riskScore: ld.riskScore != null ? Number(ld.riskScore) : null,
        creditRiskScore:
          ld.creditRiskScore != null ? Number(ld.creditRiskScore) : null,
        processRiskScore:
          ld.processRiskScore != null ? Number(ld.processRiskScore) : null,
        bucket: ld.bucket || null,
        creditMetricsSignal:
          ld.creditMetricsSignalStrength != null
            ? Number(ld.creditMetricsSignalStrength)
            : null,
        loanCharacteristicsSignal:
          ld.loanCharacteristicsSignalStrength != null
            ? Number(ld.loanCharacteristicsSignalStrength)
            : null,
        timeInMotionSignal:
          ld.timeInMotionSignalStrength != null
            ? Number(ld.timeInMotionSignalStrength)
            : null,
        mloSignal:
          ld.mloAeFalloutProneSignalStrength != null
            ? Number(ld.mloAeFalloutProneSignalStrength)
            : null,
        marketDeltaSignal:
          ld.interestLockVsMarketSignalStrength != null
            ? Number(ld.interestLockVsMarketSignalStrength)
            : null,
        marketChangeDelta:
          ld.marketChangeDelta != null ? Number(ld.marketChangeDelta) : null,
        loPullthroughPct:
          ld.loPullthroughPercentage != null
            ? Number(ld.loPullthroughPercentage)
            : null,
        activeDays: ld.activeDays != null ? Number(ld.activeDays) : null,
      };
    });
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
  highRiskLoanIds: string[],
): Promise<number> {
  if (highRiskLoanIds.length === 0) return 0;

  try {
    const result = await tenantPool.query(
      `
      SELECT COALESCE(SUM(loan_amount), 0) as volume
      FROM public.loans
      WHERE loan_id = ANY($1)
    `,
      [highRiskLoanIds],
    );

    return parseFloat(result.rows[0]?.volume) || 0;
  } catch (error) {
    console.error("[InsightMetrics] Error fetching at-risk volume:", error);
    return 0;
  }
}

// ============================================================================
// Prediction Signal Summary
// Computes driver distributions and risk score buckets from enriched predictions
// ============================================================================

interface PredictionSignalSummary {
  withdrawalDrivers: Array<{ driver: string; count: number; volume: number }>;
  denialDrivers: Array<{ driver: string; count: number; volume: number }>;
  riskScoreDistribution: { high: number; medium: number; low: number };
  avgCreditRiskScore: number;
  avgProcessRiskScore: number;
  topRiskFactors: Array<{ factor: string; count: number }>;
}

function computePredictionSignalSummary(
  predictions: PredictionData[],
): PredictionSignalSummary {
  const empty: PredictionSignalSummary = {
    withdrawalDrivers: [],
    denialDrivers: [],
    riskScoreDistribution: { high: 0, medium: 0, low: 0 },
    avgCreditRiskScore: 0,
    avgProcessRiskScore: 0,
    topRiskFactors: [],
  };

  if (predictions.length === 0) return empty;

  // Signal dimension labels and the field they map to
  const signalDimensions: Array<{
    key: keyof PredictionData;
    label: string;
  }> = [
    { key: "marketDeltaSignal", label: "Market delta (unfavorable rate lock)" },
    { key: "mloSignal", label: "Low LO pull-through history" },
    {
      key: "timeInMotionSignal",
      label: "Pipeline aging (extended time in motion)",
    },
    { key: "creditMetricsSignal", label: "Credit metrics risk (FICO/LTV/DTI)" },
    { key: "loanCharacteristicsSignal", label: "Loan characteristics risk" },
  ];

  // Classify the dominant risk driver for a loan: whichever composite signal is highest (>= 4)
  function classifyDriver(loan: PredictionData): string {
    let maxSignal = 0;
    let maxLabel = "Other/unclassified";
    for (const dim of signalDimensions) {
      const val = loan[dim.key] as number | null;
      if (val != null && val > maxSignal) {
        maxSignal = val;
        maxLabel = dim.label;
      }
    }
    return maxSignal >= 4 ? maxLabel : "Other/unclassified";
  }

  // Build driver distribution for a subset of predictions
  function buildDriverDistribution(
    subset: PredictionData[],
  ): Array<{ driver: string; count: number; volume: number }> {
    const driverMap = new Map<string, { count: number; volume: number }>();
    for (const loan of subset) {
      const driver = classifyDriver(loan);
      const existing = driverMap.get(driver) || { count: 0, volume: 0 };
      existing.count++;
      existing.volume += loan.loanAmount;
      driverMap.set(driver, existing);
    }
    return Array.from(driverMap.entries())
      .map(([driver, data]) => ({ driver, ...data }))
      .sort((a, b) => b.count - a.count);
  }

  const withdrawLoans = predictions.filter(
    (p) => p.predictedOutcome === "withdraw",
  );
  const denyLoans = predictions.filter((p) => p.predictedOutcome === "deny");

  // Risk score distribution across ALL predictions (not just at-risk)
  let high = 0,
    medium = 0,
    low = 0;
  let creditSum = 0,
    processSum = 0,
    scoreCount = 0;

  for (const p of predictions) {
    if (p.riskScore != null) {
      if (p.riskScore >= 75) high++;
      else if (p.riskScore >= 50) medium++;
      else low++;
    }
    if (p.creditRiskScore != null || p.processRiskScore != null) {
      creditSum += p.creditRiskScore ?? 0;
      processSum += p.processRiskScore ?? 0;
      scoreCount++;
    }
  }

  // Top risk factors by frequency across all at-risk predictions
  const factorCounts = new Map<string, number>();
  for (const p of [...withdrawLoans, ...denyLoans]) {
    if (p.riskFactors) {
      for (const f of p.riskFactors) {
        factorCounts.set(f, (factorCounts.get(f) || 0) + 1);
      }
    }
  }
  const topRiskFactors = Array.from(factorCounts.entries())
    .map(([factor, count]) => ({ factor, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  return {
    withdrawalDrivers: buildDriverDistribution(withdrawLoans),
    denialDrivers: buildDriverDistribution(denyLoans),
    riskScoreDistribution: { high, medium, low },
    avgCreditRiskScore: scoreCount > 0 ? Math.round(creditSum / scoreCount) : 0,
    avgProcessRiskScore:
      scoreCount > 0 ? Math.round(processSum / scoreCount) : 0,
    topRiskFactors,
  };
}

/**
 * Fetch credit risk metrics (high risk loan count, loan IDs, and total volume)
 */
async function fetchCreditRiskLoans(
  tenantPool: pg.Pool,
  channelGroup?: string,
): Promise<{ count: number; loanIds: string[]; volume: number }> {
  try {
    const channelClause = buildChannelWhereClause(channelGroup);
    const result = await tenantPool.query(`
      SELECT loan_id, COALESCE(loan_amount, 0) as loan_amount
      FROM public.loans
      WHERE current_loan_status = 'Active Loan'
        AND application_date IS NOT NULL
        AND (
          (fico_score IS NOT NULL AND CAST(fico_score AS DECIMAL) < 620)
          OR (ltv_ratio IS NOT NULL AND CAST(ltv_ratio AS DECIMAL) > 95)
          OR (be_dti_ratio IS NOT NULL AND CAST(be_dti_ratio AS DECIMAL) > 50)
        )
        ${channelClause}
    `);

    const loanIds = result.rows.map((r: any) => r.loan_id);
    const volume = result.rows.reduce(
      (sum: number, r: any) => sum + (parseFloat(r.loan_amount) || 0),
      0,
    );
    return { count: loanIds.length, loanIds, volume };
  } catch (error) {
    console.error("[InsightMetrics] Error fetching credit risk loans:", error);
    return { count: 0, loanIds: [], volume: 0 };
  }
}

/**
 * Fetch lost opportunity metrics (withdrawn and denied loans) WITH loan IDs
 * Uses ILIKE patterns to match all status variants (e.g. "Withdrawn - by Borrower", "Denied - Credit")
 */
async function fetchLostOpportunity(
  tenantPool: pg.Pool,
  dateRange: DateRange,
  channelGroup?: string,
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

    // Use ILIKE patterns to match all status variants — same patterns used in the
    // snapshot fallout definition and the old fetchFunnelMetrics
    const result = await tenantPool.query(
      `
      SELECT loan_id, current_loan_status, COALESCE(loan_amount, 0) as loan_amount
      FROM public.loans
      WHERE (
          current_loan_status ILIKE '%withdraw%'
          OR current_loan_status ILIKE '%cancelled%'
          OR current_loan_status ILIKE '%canceled%'
          OR current_loan_status ILIKE '%not accepted%'
          OR current_loan_status ILIKE '%incomplete%'
          OR current_loan_status ILIKE '%denied%'
          OR current_loan_status ILIKE '%declined%'
        )
        AND application_date >= $1
        AND application_date <= $2
        ${channelClause}
    `,
      [dateRange.start, dateRange.end],
    );

    const statusLower = (r: any) => (r.current_loan_status || "").toLowerCase();
    const withdrawn = result.rows.filter((r: any) => {
      const s = statusLower(r);
      return (
        s.includes("withdraw") ||
        s.includes("cancel") ||
        s.includes("not accepted") ||
        s.includes("incomplete")
      );
    });
    const denied = result.rows.filter((r: any) => {
      const s = statusLower(r);
      return s.includes("denied") || s.includes("declined");
    });

    const withdrawnVolume = withdrawn.reduce(
      (sum: number, r: any) => sum + (parseFloat(r.loan_amount) || 0),
      0,
    );
    const deniedVolume = denied.reduce(
      (sum: number, r: any) => sum + (parseFloat(r.loan_amount) || 0),
      0,
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
 * Calculate comparison metrics (month-over-month, year-over-year)
 * Now derived from pre-computed period snapshots for consistency.
 */
function deriveComparisons(
  snapshots: InsightMetricsPayload["periodSnapshots"],
): InsightMetricsPayload["comparisons"] {
  const pctDelta = (cur: number, prior: number) =>
    prior > 0 ? ((cur - prior) / prior) * 100 : 0;

  return {
    volumeVsLastMonth: pctDelta(
      snapshots.rolling30d.fundedVolume,
      snapshots.prior30d.fundedVolume,
    ),
    volumeVsLastYear: pctDelta(
      snapshots.ytd.fundedVolume,
      snapshots.priorYtd.fundedVolume,
    ),
    cycleTimeVsLastMonth: pctDelta(
      snapshots.rolling30d.avgCycleTime,
      snapshots.prior30d.avgCycleTime,
    ),
    pullThroughVsLastMonth: pctDelta(
      snapshots.rolling30d.pullThroughRate,
      snapshots.prior30d.pullThroughRate,
    ),
    currentMtdVolume: snapshots.rolling30d.fundedVolume,
    lastMonthVolume: snapshots.prior30d.fundedVolume,
    currentYtdVolume: snapshots.ytd.fundedVolume,
    lastYearVolume: snapshots.priorYtd.fundedVolume,
    currentCycleTime: snapshots.rolling30d.avgCycleTime,
    lastMonthCycleTime: snapshots.prior30d.avgCycleTime,
  };
}

// ============================================================================
// Product Breakdown — YTD metrics grouped by loan_type
// ============================================================================

interface ProductBreakdownRow {
  productType: string;
  active: number;
  funded: number;
  withdrawn: number;
  denied: number;
  completed: number;
  fallenOut: number;
  fundedVolume: number;
  pullThroughRate: number;
  falloutRate: number;
  highRiskCreditCount: number;
}

async function fetchProductBreakdown(
  tenantPool: pg.Pool,
  dateRange: DateRange,
  channelGroup?: string,
): Promise<ProductBreakdownRow[]> {
  try {
    const channelClause = buildChannelWhereClause(channelGroup);
    // Product breakdown now uses the SAME "completed" definition as computePeriodSnapshot:
    //   completed = NOT IN ('Active Loan','active','locked','submitted','approved')
    //   funded    = originated/purchased
    //   fallen_out = completed - funded
    // This ensures product-level numbers match the aggregate period snapshots and prevents
    // under-counting fallout when loans have non-standard terminal statuses.
    // Scoped by application_date for pull-through/fallout consistency.
    // NOTE: funded_volume uses the same status-based filter as the funded COUNT
    // (Originated/Purchased) to keep count and dollar volume consistent.
    const result = await tenantPool.query(
      `
      SELECT
        COALESCE(NULLIF(TRIM(loan_type), ''), 'Other') AS product_type,
        COUNT(*) FILTER (WHERE current_loan_status = 'Active Loan' AND application_date IS NOT NULL) AS active,
        COUNT(*) FILTER (
          WHERE current_loan_status NOT IN ('Active Loan','active','locked','submitted','approved')
            AND application_date >= $1 AND application_date <= $2
        ) AS completed,
        COUNT(*) FILTER (
          WHERE (current_loan_status ILIKE '%Originated%' OR current_loan_status ILIKE '%purchased%')
            AND application_date >= $1 AND application_date <= $2
        ) AS funded,
        COUNT(*) FILTER (
          WHERE (current_loan_status ILIKE '%withdraw%'
              OR current_loan_status ILIKE '%cancelled%'
              OR current_loan_status ILIKE '%canceled%'
              OR current_loan_status ILIKE '%not accepted%'
              OR current_loan_status ILIKE '%incomplete%')
            AND application_date >= $1 AND application_date <= $2
        ) AS withdrawn,
        COUNT(*) FILTER (
          WHERE (current_loan_status ILIKE '%denied%'
              OR current_loan_status ILIKE '%declined%')
            AND application_date >= $1 AND application_date <= $2
        ) AS denied,
        COALESCE(SUM(loan_amount) FILTER (
          WHERE (current_loan_status ILIKE '%Originated%' OR current_loan_status ILIKE '%purchased%')
            AND application_date >= $1 AND application_date <= $2
        ), 0) AS funded_volume,
        COUNT(*) FILTER (
          WHERE current_loan_status = 'Active Loan'
            AND application_date IS NOT NULL
            AND (
              (fico_score IS NOT NULL AND CAST(fico_score AS DECIMAL) < 620)
              OR (ltv_ratio IS NOT NULL AND CAST(ltv_ratio AS DECIMAL) > 95)
              OR (be_dti_ratio IS NOT NULL AND CAST(be_dti_ratio AS DECIMAL) > 50)
            )
        ) AS high_risk_credit
      FROM public.loans
      WHERE (
        (current_loan_status = 'Active Loan' AND application_date IS NOT NULL)
        OR (application_date >= $1 AND application_date <= $2)
      )
        ${channelClause}
      GROUP BY COALESCE(NULLIF(TRIM(loan_type), ''), 'Other')
      ORDER BY funded DESC
      `,
      [dateRange.start, dateRange.end],
    );

    return result.rows.map((r: any) => {
      const funded = parseInt(r.funded) || 0;
      const withdrawn = parseInt(r.withdrawn) || 0;
      const denied = parseInt(r.denied) || 0;
      const completed = parseInt(r.completed) || 0;
      // Use the broader "completed" count for fallout, not just withdrawn+denied.
      // fallen_out = completed - funded catches all terminal non-funded statuses.
      const fallenOut = Math.max(0, completed - funded);
      const pullThroughRate = completed > 0 ? (funded / completed) * 100 : 0;
      const falloutRate = completed > 0 ? (fallenOut / completed) * 100 : 0;

      return {
        productType: r.product_type,
        active: parseInt(r.active) || 0,
        funded,
        withdrawn,
        denied,
        completed,
        fallenOut,
        fundedVolume: parseFloat(r.funded_volume) || 0,
        pullThroughRate: Math.round(pullThroughRate * 10) / 10,
        falloutRate: Math.round(falloutRate * 10) / 10,
        highRiskCreditCount: parseInt(r.high_risk_credit) || 0,
      };
    });
  } catch (error) {
    console.error("[InsightMetrics] Error fetching product breakdown:", error);
    return [];
  }
}

// ============================================================================
// B3 — Closing-Late Risk
// Loans with estimated_closing_date within 10 days that have NOT reached CTC
// ============================================================================

async function fetchClosingLateRisk(
  tenantPool: pg.Pool,
  channelGroup?: string,
): Promise<{
  atRiskCount: number;
  atRiskVolume: number;
  loanIds: string[];
  avgDaysToClose: number;
}> {
  try {
    const channelClause = buildChannelWhereClause(channelGroup);
    const result = await tenantPool.query(`
      SELECT loan_id, COALESCE(loan_amount, 0) as loan_amount,
             estimated_closing_date,
             (estimated_closing_date - CURRENT_DATE) as days_to_close
      FROM public.loans
      WHERE current_loan_status = 'Active Loan'
        AND application_date IS NOT NULL
        AND estimated_closing_date IS NOT NULL
        AND estimated_closing_date <= CURRENT_DATE + INTERVAL '10 days'
        AND estimated_closing_date >= CURRENT_DATE
        AND ctc_date IS NULL
        ${channelClause}
    `);

    const loanIds = result.rows.map((r: any) => r.loan_id);
    const volume = result.rows.reduce(
      (sum: number, r: any) => sum + (parseFloat(r.loan_amount) || 0),
      0,
    );
    const avgDays =
      result.rows.length > 0
        ? result.rows.reduce(
            (sum: number, r: any) => sum + (parseInt(r.days_to_close) || 0),
            0,
          ) / result.rows.length
        : 0;

    return {
      atRiskCount: loanIds.length,
      atRiskVolume: volume,
      loanIds,
      avgDaysToClose: Math.round(avgDays),
    };
  } catch (error) {
    console.error("[InsightMetrics] Error fetching closing-late risk:", error);
    return { atRiskCount: 0, atRiskVolume: 0, loanIds: [], avgDaysToClose: 0 };
  }
}

// ============================================================================
// Close-Late Enhanced — Probabilistic close-late data from prediction service
// Uses closeOnTimeProbability and pipelineStage stored in loan_data JSONB
// ============================================================================

interface CloseLateEnhancedData {
  highProbCount: number;
  highProbVolume: number;
  highProbLoanIds: string[];
  mediumProbCount: number;
  mediumProbVolume: number;
  lowProbCount: number;
  lowProbVolume: number;
  byStage: Array<{
    stage: string;
    count: number;
    volume: number;
    avgDaysToEcd: number;
  }>;
}

async function fetchCloseLateEnhanced(
  tenantPool: pg.Pool,
  channelGroup?: string,
): Promise<CloseLateEnhancedData> {
  const empty: CloseLateEnhancedData = {
    highProbCount: 0,
    highProbVolume: 0,
    highProbLoanIds: [],
    mediumProbCount: 0,
    mediumProbVolume: 0,
    lowProbCount: 0,
    lowProbVolume: 0,
    byStage: [],
  };

  try {
    // Check if loan_predictions table exists
    const tableCheck = await tenantPool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name = 'loan_predictions'
      ) as exists
    `);
    if (!tableCheck.rows[0]?.exists) return empty;

    const channelClause = buildChannelWhereClause(channelGroup);
    const result = await tenantPool.query(`
      SELECT DISTINCT ON (p.loan_id)
        p.loan_id,
        COALESCE(l.loan_amount, 0) AS loan_amount,
        l.current_milestone,
        (p.loan_data->>'closeOnTimeProbability')::numeric AS on_time_prob,
        (p.loan_data->>'closeLateRisk')::boolean AS close_late_risk,
        COALESCE(p.loan_data->>'pipelineStage', 'Unknown') AS pipeline_stage,
        l.estimated_closing_date,
        (l.estimated_closing_date - CURRENT_DATE) AS days_to_ecd
      FROM public.loan_predictions p
      JOIN public.loans l ON p.loan_id = l.loan_id
      WHERE l.current_loan_status = 'Active Loan'
        AND l.application_date >= CURRENT_DATE - INTERVAL '180 days'
        AND l.estimated_closing_date IS NOT NULL
        AND p.loan_data->>'closeOnTimeProbability' IS NOT NULL
        ${channelGroup ? channelClause : ""}
      ORDER BY p.loan_id, p.created_at DESC
    `);

    if (result.rows.length === 0) return empty;

    // Bucket by close-late probability tier
    // on_time_prob < 30% => high probability of being late
    // on_time_prob 30-60% => medium
    // on_time_prob > 60% => low
    const highProb: any[] = [];
    const mediumProb: any[] = [];
    const lowProb: any[] = [];

    for (const row of result.rows) {
      const onTimeProb = parseFloat(row.on_time_prob) || 0;
      if (onTimeProb < 30) {
        highProb.push(row);
      } else if (onTimeProb <= 60) {
        mediumProb.push(row);
      } else {
        lowProb.push(row);
      }
    }

    const sumVolume = (rows: any[]) =>
      rows.reduce(
        (sum: number, r: any) => sum + (parseFloat(r.loan_amount) || 0),
        0,
      );

    // Group high-probability loans by pipeline stage
    const stageMap = new Map<
      string,
      { count: number; volume: number; daysSum: number }
    >();
    for (const row of highProb) {
      const stage = row.pipeline_stage || "Unknown";
      const existing = stageMap.get(stage) || {
        count: 0,
        volume: 0,
        daysSum: 0,
      };
      existing.count++;
      existing.volume += parseFloat(row.loan_amount) || 0;
      existing.daysSum += parseInt(row.days_to_ecd) || 0;
      stageMap.set(stage, existing);
    }

    const byStage = Array.from(stageMap.entries())
      .map(([stage, data]) => ({
        stage,
        count: data.count,
        volume: data.volume,
        avgDaysToEcd:
          data.count > 0 ? Math.round(data.daysSum / data.count) : 0,
      }))
      .sort((a, b) => b.count - a.count);

    return {
      highProbCount: highProb.length,
      highProbVolume: sumVolume(highProb),
      highProbLoanIds: highProb.map((r: any) => r.loan_id),
      mediumProbCount: mediumProb.length,
      mediumProbVolume: sumVolume(mediumProb),
      lowProbCount: lowProb.length,
      lowProbVolume: sumVolume(lowProb),
      byStage,
    };
  } catch (error) {
    console.error(
      "[InsightMetrics] Error fetching close-late enhanced data:",
      error,
    );
    return empty;
  }
}

// ============================================================================
// C1 — Lock Expiration Exposure
// Locked loans with lock_expiration_date within 7 days that have NOT reached CTC
// ============================================================================

async function fetchLockExpirationExposure(
  tenantPool: pg.Pool,
  channelGroup?: string,
): Promise<{
  expiringCount: number;
  expiringVolume: number;
  loanIds: string[];
  avgDaysToExpiry: number;
}> {
  try {
    const channelClause = buildChannelWhereClause(channelGroup);
    const result = await tenantPool.query(`
      SELECT loan_id, COALESCE(loan_amount, 0) as loan_amount,
             lock_expiration_date,
             (lock_expiration_date - CURRENT_DATE) as days_to_expiry
      FROM public.loans
      WHERE current_loan_status = 'Active Loan'
        AND application_date IS NOT NULL
        AND lock_date IS NOT NULL
        AND lock_expiration_date IS NOT NULL
        AND lock_expiration_date <= CURRENT_DATE + INTERVAL '7 days'
        AND lock_expiration_date >= CURRENT_DATE
        AND ctc_date IS NULL
        ${channelClause}
    `);

    const loanIds = result.rows.map((r: any) => r.loan_id);
    const volume = result.rows.reduce(
      (sum: number, r: any) => sum + (parseFloat(r.loan_amount) || 0),
      0,
    );
    const avgDays =
      result.rows.length > 0
        ? result.rows.reduce(
            (sum: number, r: any) => sum + (parseInt(r.days_to_expiry) || 0),
            0,
          ) / result.rows.length
        : 0;

    return {
      expiringCount: loanIds.length,
      expiringVolume: volume,
      loanIds,
      avgDaysToExpiry: Math.round(avgDays),
    };
  } catch (error) {
    console.error(
      "[InsightMetrics] Error fetching lock expiration exposure:",
      error,
    );
    return {
      expiringCount: 0,
      expiringVolume: 0,
      loanIds: [],
      avgDaysToExpiry: 0,
    };
  }
}

// ============================================================================
// G1 — TRID Timing Exposure
// Loans closing within 5 calendar days where Closing Disclosure has NOT been sent
// (TRID requires CD at least 3 business days before closing)
// ============================================================================

async function fetchTridExposure(
  tenantPool: pg.Pool,
  channelGroup?: string,
): Promise<{ atRiskCount: number; loanIds: string[]; avgDaysToClose: number }> {
  try {
    const channelClause = buildChannelWhereClause(channelGroup);
    const result = await tenantPool.query(`
      SELECT loan_id, estimated_closing_date,
             (estimated_closing_date - CURRENT_DATE) as days_to_close
      FROM public.loans
      WHERE current_loan_status = 'Active Loan'
        AND application_date IS NOT NULL
        AND estimated_closing_date IS NOT NULL
        AND estimated_closing_date <= CURRENT_DATE + INTERVAL '5 days'
        AND estimated_closing_date >= CURRENT_DATE
        AND closing_disclosure_sent_date IS NULL
        ${channelClause}
    `);

    const loanIds = result.rows.map((r: any) => r.loan_id);
    const avgDays =
      result.rows.length > 0
        ? result.rows.reduce(
            (sum: number, r: any) => sum + (parseInt(r.days_to_close) || 0),
            0,
          ) / result.rows.length
        : 0;

    return {
      atRiskCount: loanIds.length,
      loanIds,
      avgDaysToClose: Math.round(avgDays),
    };
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
  channelGroup?: string,
): Promise<{
  currentMonthBps: number;
  priorMonthBps: number;
  deltaBps: number;
}> {
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
  channelGroup?: string,
): Promise<{
  avgConditions: number;
  highConditionCount: number;
  highConditionLoanIds: string[];
}> {
  try {
    const channelClause = buildChannelWhereClause(channelGroup);

    const result = await tenantPool.query(`
      SELECT loan_id, COALESCE(number_of_conditions, 0) as conditions
      FROM public.loans
      WHERE current_loan_status = 'Active Loan'
        AND application_date IS NOT NULL
        AND number_of_conditions IS NOT NULL
        AND number_of_conditions > 0
        ${channelClause}
    `);

    const totalConditions = result.rows.reduce(
      (sum: number, r: any) => sum + (parseInt(r.conditions) || 0),
      0,
    );
    const avgConditions =
      result.rows.length > 0 ? totalConditions / result.rows.length : 0;
    const highConditionRows = result.rows.filter(
      (r: any) => parseInt(r.conditions) > 10,
    );

    return {
      avgConditions: Math.round(avgConditions * 10) / 10,
      highConditionCount: highConditionRows.length,
      highConditionLoanIds: highConditionRows.map((r: any) => r.loan_id),
    };
  } catch (error) {
    console.error("[InsightMetrics] Error fetching condition backlog:", error);
    return {
      avgConditions: 0,
      highConditionCount: 0,
      highConditionLoanIds: [],
    };
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

function computeTiers(
  rawActors: Array<{
    name: string;
    revenue: number;
    units: number;
    volume: number;
    revenueBps: number;
    pullThrough: number;
    avgCycleTime: number;
    lostOpportunityUnits: number;
    deniedUnits: number;
  }>,
): TieringActorRow[] {
  const totalRevenue = rawActors.reduce((s, a) => s + a.revenue, 0);
  let cumRev = 0;
  return rawActors.map((a) => {
    cumRev += a.revenue;
    const pct = totalRevenue > 0 ? (cumRev / totalRevenue) * 100 : 0;
    const tier: "top" | "second" | "bottom" =
      pct <= 50 ? "top" : pct <= 80 ? "second" : "bottom";
    return { ...a, tier };
  });
}

function tierAverages(actors: TieringActorRow[], tier: string) {
  const subset = actors.filter((a) => a.tier === tier);
  if (subset.length === 0)
    return {
      avgRevenue: 0,
      avgUnits: 0,
      avgBps: 0,
      avgPullThrough: 0,
      avgCycleTime: 0,
    };
  return {
    avgRevenue: Math.round(
      subset.reduce((s, a) => s + a.revenue, 0) / subset.length,
    ),
    avgUnits:
      Math.round(
        (subset.reduce((s, a) => s + a.units, 0) / subset.length) * 10,
      ) / 10,
    avgBps: Math.round(
      subset.reduce((s, a) => s + a.revenueBps, 0) / subset.length,
    ),
    avgPullThrough:
      Math.round(
        (subset.reduce((s, a) => s + a.pullThrough, 0) / subset.length) * 10,
      ) / 10,
    avgCycleTime: Math.round(
      subset.reduce((s, a) => s + a.avgCycleTime, 0) / subset.length,
    ),
  };
}

async function fetchPersonnelTiering(
  tenantPool: pg.Pool,
  revenueExpr: string,
  channelGroup?: string,
): Promise<InsightMetricsPayload["tiering"]> {
  const result: InsightMetricsPayload["tiering"] = { byActorType: [] };

  try {
    const channelClause = buildChannelWhereClause(channelGroup);

    // Date ranges: YTD + multi-window period-over-period (30D, 60D, 90D)
    const now = new Date();
    const today = now.toISOString().split("T")[0];
    const startOfYear = new Date(now.getFullYear(), 0, 1)
      .toISOString()
      .split("T")[0];
    const DAY = 24 * 60 * 60 * 1000;
    const periodWindows: Array<{
      window: "30d" | "60d" | "90d";
      curStart: string;
      curEnd: string;
      priorStart: string;
      priorEnd: string;
    }> = [
      {
        window: "30d",
        curStart: new Date(now.getTime() - 30 * DAY)
          .toISOString()
          .split("T")[0],
        curEnd: today,
        priorStart: new Date(now.getTime() - 60 * DAY)
          .toISOString()
          .split("T")[0],
        priorEnd: new Date(now.getTime() - 31 * DAY)
          .toISOString()
          .split("T")[0],
      },
      {
        window: "60d",
        curStart: new Date(now.getTime() - 60 * DAY)
          .toISOString()
          .split("T")[0],
        curEnd: today,
        priorStart: new Date(now.getTime() - 120 * DAY)
          .toISOString()
          .split("T")[0],
        priorEnd: new Date(now.getTime() - 61 * DAY)
          .toISOString()
          .split("T")[0],
      },
      {
        window: "90d",
        curStart: new Date(now.getTime() - 90 * DAY)
          .toISOString()
          .split("T")[0],
        curEnd: today,
        priorStart: new Date(now.getTime() - 180 * DAY)
          .toISOString()
          .split("T")[0],
        priorEnd: new Date(now.getTime() - 91 * DAY)
          .toISOString()
          .split("T")[0],
      },
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

    // Channel-aware funded filter: Retail uses rate_lock > 0, TPO/All do not.
    const fundedFilter = buildFundedFilter(channelGroup);
    // Cast to DATE because funding_date is TIMESTAMPTZ — subtraction with DATE application_date needs matching types
    const closeDateExpr = "funding_date::date";

    for (const cfg of actorConfigs) {
      try {
        // Query 1: Funded loans — revenue, volume, units, BPS, cycle time per actor
        // MUST match TopTieringComparison and LeaderBoardSection exactly:
        //   - Scoped by funding_date (not application_date)
        //   - Channel-aware funded filter (Retail: rate_lock > 0, TPO/All: no rate_lock)
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
          WHERE ${fundedFilter}
            AND funding_date >= $1
            AND funding_date <= $2
            ${channelClause}
          GROUP BY ${cfg.actorColumn}
          HAVING COUNT(DISTINCT COALESCE(loan_number, loan_id::text)) > 0
          ORDER BY revenue DESC
        `;

        // Query 2: Application cohort — started, completed, funded-from-cohort, lost, denied per actor
        // Scoped by application_date for pull-through calculation (PT = funded_from_cohort / completed).
        // funded_from_cohort counts loans APPLIED in period that reached funded status,
        // which is different from funded query above (scoped by funding_date).
        const appQuery = `
          SELECT
            ${cfg.actorColumn} AS actor_name,
            COUNT(DISTINCT COALESCE(loan_number, loan_id::text)) AS started,
            COUNT(DISTINCT CASE WHEN current_loan_status NOT IN ('Active Loan', 'active', 'locked', 'submitted', 'approved')
              THEN COALESCE(loan_number, loan_id::text) END) AS completed,
            COUNT(DISTINCT CASE WHEN (current_loan_status ILIKE '%Originated%' OR current_loan_status ILIKE '%purchased%')
              THEN COALESCE(loan_number, loan_id::text) END) AS funded_from_cohort,
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

        // Use rolling 90D for current tier assignment (not YTD) so that
        // tier migration comparisons use equal-length windows (90D vs prior 90D).
        const cur90dStart = new Date(now.getTime() - 90 * DAY).toISOString().split("T")[0];
        const [fundedRes, appRes] = await Promise.all([
          tenantPool.query(fundedQuery, [cur90dStart, today]),
          tenantPool.query(appQuery, [cur90dStart, today]),
        ]);

        // Build lookup from application cohort query
        const appMap = new Map<
          string,
          {
            started: number;
            completed: number;
            fundedFromCohort: number;
            lost: number;
            denied: number;
          }
        >();
        for (const r of appRes.rows) {
          if (!isActorMissing(r.actor_name)) {
            appMap.set(r.actor_name, {
              started: parseInt(r.started) || 0,
              completed: parseInt(r.completed) || 0,
              fundedFromCohort: parseInt(r.funded_from_cohort) || 0,
              lost: parseInt(r.lost) || 0,
              denied: parseInt(r.denied) || 0,
            });
          }
        }

        const rawActors = fundedRes.rows
          .filter((r: any) => !isActorMissing(r.actor_name))
          .map((r: any) => {
            const name = r.actor_name || "Unknown";
            const fundedUnits = parseInt(r.units) || 0;
            const appData = appMap.get(r.actor_name) || {
              started: 0,
              completed: 0,
              fundedFromCohort: 0,
              lost: 0,
              denied: 0,
            };
            // Pull-through uses originated status (fundedFromCohort), not funding_date units.
            // fundedUnits (funding_date-scoped) is for financial metrics only.
            const originated = appData.fundedFromCohort;
            const completed = appData.completed;
            return {
              name,
              revenue: parseFloat(r.revenue) || 0,
              units: fundedUnits,
              volume: parseFloat(r.volume) || 0,
              revenueBps: Math.round(parseFloat(r.revenue_bps) || 0),
              pullThrough:
                completed > 0 ? Math.round((originated / completed) * 1000) / 10 : 0,
              avgCycleTime: Math.round(parseFloat(r.avg_cycle_days) || 0),
              lostOpportunityUnits: appData.lost,
              deniedUnits: appData.denied,
            };
          });

        if (rawActors.length === 0) continue;

        const tieredActors = computeTiers(rawActors);
        const topCount = tieredActors.filter((a) => a.tier === "top").length;
        const secondCount = tieredActors.filter(
          (a) => a.tier === "second",
        ).length;
        const bottomCount = tieredActors.filter(
          (a) => a.tier === "bottom",
        ).length;

        // Multi-window period-over-period: 30D, 60D, 90D each vs their prior equivalent period
        let periodChanges: InsightMetricsPayload["tiering"]["byActorType"][0]["periodChanges"] =
          [];
        // Period comparison query — funded/revenue/volume/cycle use funding_date
        // scoping (matching TopTieringComparison), while PT uses app cohort.
        // Defined outside try block so it's accessible by aggregate trends code too.
        const periodQuery = `
            SELECT
              ${cfg.actorColumn} AS actor_name,
              -- Funded units: scoped by funding_date (matches TopTiering)
              COUNT(DISTINCT CASE WHEN funding_date >= $1 AND funding_date <= $2
                THEN COALESCE(loan_number, loan_id::text) END) AS funded_cur,
              -- PT numerator: originated from app cohort (status-based originated flag)
              COUNT(DISTINCT CASE WHEN application_date >= $1 AND application_date <= $2
                AND (current_loan_status ILIKE '%Originated%' OR current_loan_status ILIKE '%purchased%')
                THEN COALESCE(loan_number, loan_id::text) END) AS funded_cohort_cur,
              -- PT denominator: completed from app cohort
              COUNT(DISTINCT CASE WHEN application_date >= $1 AND application_date <= $2
                AND current_loan_status NOT IN ('Active Loan','active','locked','submitted','approved')
                THEN COALESCE(loan_number, loan_id::text) END) AS completed_cur,
              -- Revenue/volume/cycle: scoped by funding_date
              SUM(CASE WHEN funding_date >= $1 AND funding_date <= $2
                THEN (${revenueExpr}) ELSE 0 END) AS revenue_cur,
              SUM(CASE WHEN funding_date >= $1 AND funding_date <= $2
                THEN loan_amount ELSE 0 END) AS volume_cur,
              AVG(CASE WHEN funding_date >= $1 AND funding_date <= $2
                THEN (${closeDateExpr} - application_date) END) AS cycle_cur,
              -- Prior period: same dual-scoping approach
              COUNT(DISTINCT CASE WHEN funding_date >= $3 AND funding_date <= $4
                THEN COALESCE(loan_number, loan_id::text) END) AS funded_prior,
              COUNT(DISTINCT CASE WHEN application_date >= $3 AND application_date <= $4
                AND (current_loan_status ILIKE '%Originated%' OR current_loan_status ILIKE '%purchased%')
                THEN COALESCE(loan_number, loan_id::text) END) AS funded_cohort_prior,
              COUNT(DISTINCT CASE WHEN application_date >= $3 AND application_date <= $4
                AND current_loan_status NOT IN ('Active Loan','active','locked','submitted','approved')
                THEN COALESCE(loan_number, loan_id::text) END) AS completed_prior,
              SUM(CASE WHEN funding_date >= $3 AND funding_date <= $4
                THEN (${revenueExpr}) ELSE 0 END) AS revenue_prior,
              SUM(CASE WHEN funding_date >= $3 AND funding_date <= $4
                THEN loan_amount ELSE 0 END) AS volume_prior,
              AVG(CASE WHEN funding_date >= $3 AND funding_date <= $4
                THEN (${closeDateExpr} - application_date) END) AS cycle_prior
            FROM public.loans
            WHERE (funding_date >= $1 AND funding_date <= $2)
               OR (funding_date >= $3 AND funding_date <= $4)
               OR (application_date >= $1 AND application_date <= $2)
               OR (application_date >= $3 AND application_date <= $4)
              ${channelClause}
            GROUP BY ${cfg.actorColumn}
          `;
        try {
          const MIN_DELTA_PCT = 5;
          const invertedMetrics = new Set<string>(["cycleTime"]);
          // Minimum absolute deltas to avoid misleading insights on tiny amounts
          // (e.g., $278→$5K = 1737% but only $4.7K change — not material)
          const MIN_ABSOLUTE_DELTAS: Partial<Record<string, number>> = {
            revenue: 10000,    // $10K minimum absolute change
            volume: 100000,    // $100K minimum absolute change
            units: 2,          // at least 2 unit change
            revenueBps: 10,    // at least 10 bps change
          };

          // Run the same query across 30D, 60D, 90D windows
          for (const pw of periodWindows) {
            console.log(
              `[InsightMetrics] Running period query for ${pw.window}: cur=${pw.curStart}→${pw.curEnd}, prior=${pw.priorStart}→${pw.priorEnd}`,
            );
            const periodRes = await tenantPool.query(periodQuery, [
              pw.curStart,
              pw.curEnd,
              pw.priorStart,
              pw.priorEnd,
            ]);
            console.log(
              `[InsightMetrics] Period ${pw.window} returned ${periodRes.rows.length} rows`,
            );
            for (const r of periodRes.rows) {
              if (isActorMissing(r.actor_name)) continue;
              const fundedCur = parseInt(r.funded_cur) || 0;
              const fundedCohortCur = parseInt(r.funded_cohort_cur) || 0;
              const completedCur = parseInt(r.completed_cur) || 0;
              const fundedPrior = parseInt(r.funded_prior) || 0;
              const fundedCohortPrior = parseInt(r.funded_cohort_prior) || 0;
              const completedPrior = parseInt(r.completed_prior) || 0;
              const revenueCur = parseFloat(r.revenue_cur) || 0;
              const volumeCur = parseFloat(r.volume_cur) || 0;
              const revenuePrior = parseFloat(r.revenue_prior) || 0;
              const volumePrior = parseFloat(r.volume_prior) || 0;

              if (fundedCur >= 5 || fundedPrior >= 5) {
                console.log(
                  `[InsightMetrics] Period ${pw.window} actor="${r.actor_name}": rev_cur=$${Math.round(revenueCur)} vol_cur=$${Math.round(volumeCur)} rev_prior=$${Math.round(revenuePrior)} vol_prior=$${Math.round(volumePrior)} units_cur=${fundedCur} units_prior=${fundedPrior}`,
                );
              }
              // PT from app cohort (funded_cohort / completed), not from funding_date-scoped units
              const pullCur =
                completedCur > 0 ? (fundedCohortCur / completedCur) * 100 : 0;
              const pullPrior =
                completedPrior > 0
                  ? (fundedCohortPrior / completedPrior) * 100
                  : 0;
              const bpsCur =
                volumeCur > 0 ? (revenueCur / volumeCur) * 10000 : 0;
              const bpsPrior =
                volumePrior > 0 ? (revenuePrior / volumePrior) * 10000 : 0;
              const unitsCur = fundedCur;
              const unitsPrior = fundedPrior;
              const cycleCur = parseFloat(r.cycle_cur) || 0;
              const cyclePrior = parseFloat(r.cycle_prior) || 0;

              const checkDelta = (
                metric:
                  | "revenue"
                  | "units"
                  | "volume"
                  | "pullThrough"
                  | "revenueBps"
                  | "cycleTime",
                cur: number,
                prior: number,
              ) => {
                if (prior <= 0 || cur === prior) return;
                const absDelta = Math.abs(cur - prior);
                const minAbsDelta = MIN_ABSOLUTE_DELTAS[metric];
                if (minAbsDelta && absDelta < minAbsDelta) return;
                const deltaPct = ((cur - prior) / prior) * 100;
                if (Math.abs(deltaPct) >= MIN_DELTA_PCT) {
                  const isInverted = invertedMetrics.has(metric);
                  const needsDecimalRounding =
                    metric === "pullThrough" || metric === "cycleTime";
                  const roundedCur = needsDecimalRounding
                    ? Math.round(cur * 10) / 10
                    : Math.round(cur);
                  const roundedPrior = needsDecimalRounding
                    ? Math.round(prior * 10) / 10
                    : Math.round(prior);
                  // Skip if rounded values are identical (would display as e.g. "$163K→$163K")
                  if (roundedCur === roundedPrior) return;
                  periodChanges.push({
                    name: r.actor_name || "Unknown",
                    metric,
                    current: roundedCur,
                    prior: roundedPrior,
                    deltaPct: Math.round(deltaPct * 10) / 10,
                    direction: isInverted
                      ? deltaPct < 0
                        ? "improved"
                        : "declined"
                      : deltaPct > 0
                        ? "improved"
                        : "declined",
                    window: pw.window,
                  });
                }
              };
              checkDelta("revenue", revenueCur, revenuePrior);
              checkDelta("units", unitsCur, unitsPrior);
              checkDelta("volume", volumeCur, volumePrior);
              if (pullPrior > 0 && pullCur > 0)
                checkDelta("pullThrough", pullCur, pullPrior);
              if (bpsPrior > 0 && bpsCur > 0)
                checkDelta("revenueBps", bpsCur, bpsPrior);
              if (cyclePrior > 0 && cycleCur > 0)
                checkDelta("cycleTime", cycleCur, cyclePrior);
            }
          }
          // Keep top 30 most significant changes across all windows
          periodChanges = periodChanges
            .sort((a, b) => Math.abs(b.deltaPct) - Math.abs(a.deltaPct))
            .slice(0, 30);
          if (periodChanges.length > 0) {
            console.log(
              `[InsightMetrics] Tiering period changes (multi-window) for ${cfg.actorLabel}: ${periodChanges.length} entries`,
            );
            // Log sample for debugging
            const sample = periodChanges
              .slice(0, 5)
              .map((c) => `${c.name}:${c.metric}(${c.window})=${c.deltaPct}%`)
              .join(", ");
            console.log(`[InsightMetrics] Period sample: ${sample}`);
          } else {
            console.log(
              `[InsightMetrics] Tiering period changes: NONE found for ${cfg.actorLabel}. Windows checked: ${periodWindows.map((w) => w.window).join(",")}`,
            );
          }
        } catch (periodErr) {
          console.warn(
            `[InsightMetrics] Period comparison failed for ${cfg.actorType}:`,
            periodErr,
          );
        }

        // ================================================================
        // AGGREGATE TRENDS — computed from existing tieredActors + period data
        // ================================================================
        let aggregateTrends: InsightMetricsPayload["tiering"]["byActorType"][0]["aggregateTrends"];
        try {
          const totalRevenue = tieredActors.reduce((s, a) => s + a.revenue, 0);
          const totalUnits = tieredActors.reduce((s, a) => s + a.units, 0);
          const totalActorCount = tieredActors.length;

          // --- Company-wide averages ---
          const companyAverages = {
            avgRevenue: totalActorCount > 0 ? Math.round(totalRevenue / totalActorCount) : 0,
            avgUnits: totalActorCount > 0
              ? Math.round((tieredActors.reduce((s, a) => s + a.units, 0) / totalActorCount) * 10) / 10
              : 0,
            avgBps: totalActorCount > 0
              ? Math.round(tieredActors.reduce((s, a) => s + a.revenueBps, 0) / totalActorCount)
              : 0,
            avgPullThrough: totalActorCount > 0
              ? Math.round((tieredActors.reduce((s, a) => s + a.pullThrough, 0) / totalActorCount) * 10) / 10
              : 0,
            avgCycleTime: totalActorCount > 0
              ? Math.round(tieredActors.reduce((s, a) => s + a.avgCycleTime, 0) / totalActorCount)
              : 0,
          };

          // --- Concentration metrics ---
          // tieredActors is already sorted by revenue desc (from computeTiers)
          const top3Rev = tieredActors.slice(0, 3).reduce((s, a) => s + a.revenue, 0);
          const top5Rev = tieredActors.slice(0, 5).reduce((s, a) => s + a.revenue, 0);
          // Gini coefficient: measures inequality (0 = equal, 1 = maximally concentrated)
          let gini = 0;
          if (totalActorCount > 1 && totalRevenue > 0) {
            let sumOfDiffs = 0;
            for (let i = 0; i < totalActorCount; i++) {
              for (let j = 0; j < totalActorCount; j++) {
                sumOfDiffs += Math.abs(tieredActors[i].revenue - tieredActors[j].revenue);
              }
            }
            gini = Math.round((sumOfDiffs / (2 * totalActorCount * totalRevenue)) * 100) / 100;
          }
          const concentration = {
            top3RevenueShare: totalRevenue > 0 ? Math.round((top3Rev / totalRevenue) * 1000) / 10 : 0,
            top5RevenueShare: totalRevenue > 0 ? Math.round((top5Rev / totalRevenue) * 1000) / 10 : 0,
            giniCoefficient: gini,
          };

          // --- Headcount-production gap ---
          const tiers: Array<"top" | "second" | "bottom"> = ["top", "second", "bottom"];
          const headcountProductionGap = tiers.map((tier) => {
            const subset = tieredActors.filter((a) => a.tier === tier);
            const headcountPct = totalActorCount > 0
              ? Math.round((subset.length / totalActorCount) * 1000) / 10
              : 0;
            const tierRev = subset.reduce((s, a) => s + a.revenue, 0);
            const tierUnits = subset.reduce((s, a) => s + a.units, 0);
            const revenuePct = totalRevenue > 0
              ? Math.round((tierRev / totalRevenue) * 1000) / 10
              : 0;
            const unitsPct = totalUnits > 0
              ? Math.round((tierUnits / totalUnits) * 1000) / 10
              : 0;
            return {
              tier,
              headcountPct,
              revenuePct,
              unitsPct,
              gap: Math.round((revenuePct - headcountPct) * 10) / 10,
            };
          });

          // --- Tier-level period trends ---
          // Build a tier lookup for each actor so we can aggregate period data by tier
          const actorTierMap = new Map<string, "top" | "second" | "bottom">();
          for (const a of tieredActors) {
            actorTierMap.set(a.name, a.tier);
          }

          type TierMetricKey = "revenue" | "units" | "volume" | "pullThrough" | "revenueBps" | "cycleTime";
          const tierTrends: NonNullable<typeof aggregateTrends>["tierTrends"] = [];

          // Re-run period queries grouped by tier to get aggregate tier trends
          // We reuse the same periodQuery and periodWindows from above
          try {
            for (const pw of periodWindows) {
              const periodRes = await tenantPool.query(periodQuery, [
                pw.curStart, pw.curEnd, pw.priorStart, pw.priorEnd,
              ]);

              // Accumulate metrics per tier
              const tierAccum: Record<string, {
                revCur: number; revPrior: number; unitsCur: number; unitsPrior: number;
                volCur: number; volPrior: number; ptCur: number; ptPrior: number;
                ptCount: number; ptCountPrior: number;
                bpsCur: number; bpsPrior: number; bpsCount: number; bpsCountPrior: number;
                cycleCur: number; cyclePrior: number; cycleCount: number; cycleCountPrior: number;
                count: number;
              }> = {};
              for (const t of tiers) {
                tierAccum[t] = {
                  revCur: 0, revPrior: 0, unitsCur: 0, unitsPrior: 0,
                  volCur: 0, volPrior: 0, ptCur: 0, ptPrior: 0, ptCount: 0, ptCountPrior: 0,
                  bpsCur: 0, bpsPrior: 0, bpsCount: 0, bpsCountPrior: 0,
                  cycleCur: 0, cyclePrior: 0, cycleCount: 0, cycleCountPrior: 0,
                  count: 0,
                };
              }

              for (const r of periodRes.rows as any[]) {
                if (isActorMissing(r.actor_name)) continue;
                const tier = actorTierMap.get(r.actor_name);
                if (!tier) continue;
                const acc = tierAccum[tier];
                acc.count++;
                const fCur = parseInt(r.funded_cur) || 0;
                const fPrior = parseInt(r.funded_prior) || 0;
                const fcCur = parseInt(r.funded_cohort_cur) || 0;
                const ccCur = parseInt(r.completed_cur) || 0;
                const fcPrior = parseInt(r.funded_cohort_prior) || 0;
                const ccPrior = parseInt(r.completed_prior) || 0;
                const rCur = parseFloat(r.revenue_cur) || 0;
                const rPrior = parseFloat(r.revenue_prior) || 0;
                const vCur = parseFloat(r.volume_cur) || 0;
                const vPrior = parseFloat(r.volume_prior) || 0;
                const cyCur = parseFloat(r.cycle_cur) || 0;
                const cyPrior = parseFloat(r.cycle_prior) || 0;

                acc.revCur += rCur;
                acc.revPrior += rPrior;
                acc.unitsCur += fCur;
                acc.unitsPrior += fPrior;
                acc.volCur += vCur;
                acc.volPrior += vPrior;
                if (ccCur > 0) { acc.ptCur += (fcCur / ccCur) * 100; acc.ptCount++; }
                if (ccPrior > 0) { acc.ptPrior += (fcPrior / ccPrior) * 100; acc.ptCountPrior++; }
                if (vCur > 0) { acc.bpsCur += (rCur / vCur) * 10000; acc.bpsCount++; }
                if (vPrior > 0) { acc.bpsPrior += (rPrior / vPrior) * 10000; acc.bpsCountPrior++; }
                if (cyCur > 0) { acc.cycleCur += cyCur; acc.cycleCount++; }
                if (cyPrior > 0) { acc.cyclePrior += cyPrior; acc.cycleCountPrior++; }
              }

              // Emit tier trends for each tier/metric pair with significant change
              const TIER_MIN_DELTA_PCT = 8;
              for (const tier of tiers) {
                const acc = tierAccum[tier];
                if (acc.count === 0) continue;
                const checkTierDelta = (
                  metric: TierMetricKey,
                  curAvg: number,
                  priorAvg: number,
                ) => {
                  if (priorAvg <= 0 || curAvg === priorAvg) return;
                  const deltaPct = ((curAvg - priorAvg) / priorAvg) * 100;
                  if (Math.abs(deltaPct) < TIER_MIN_DELTA_PCT) return;
                  const isInverted = metric === "cycleTime";
                  tierTrends.push({
                    tier,
                    metric,
                    currentAvg: Math.round(curAvg * 10) / 10,
                    priorAvg: Math.round(priorAvg * 10) / 10,
                    deltaPct: Math.round(deltaPct * 10) / 10,
                    direction: isInverted
                      ? (deltaPct < 0 ? "improved" : "declined")
                      : (deltaPct > 0 ? "improved" : "declined"),
                    window: pw.window,
                  });
                };
                const n = acc.count;
                checkTierDelta("revenue", acc.revCur / n, acc.revPrior / n);
                checkTierDelta("units", acc.unitsCur / n, acc.unitsPrior / n);
                checkTierDelta("volume", acc.volCur / n, acc.volPrior / n);
                if (acc.ptCount > 0 && acc.ptCountPrior > 0)
                  checkTierDelta("pullThrough", acc.ptCur / acc.ptCount, acc.ptPrior / acc.ptCountPrior);
                if (acc.bpsCount > 0 && acc.bpsCountPrior > 0)
                  checkTierDelta("revenueBps", acc.bpsCur / acc.bpsCount, acc.bpsPrior / acc.bpsCountPrior);
                if (acc.cycleCount > 0 && acc.cycleCountPrior > 0)
                  checkTierDelta("cycleTime", acc.cycleCur / acc.cycleCount, acc.cyclePrior / acc.cycleCountPrior);
              }
            }
          } catch (tierTrendErr) {
            console.warn(`[InsightMetrics] Tier-level trend computation failed:`, tierTrendErr);
          }

          // --- Tier migration (vs 90D prior) ---
          // Reconstruct approximate 90D-prior tiers from the 90D period data
          let tierMigration: NonNullable<typeof aggregateTrends>["tierMigration"];
          try {
            const pw90 = periodWindows.find((w) => w.window === "90d");
            if (pw90) {
              const priorRes = await tenantPool.query(periodQuery, [
                pw90.priorStart, pw90.priorEnd, pw90.priorStart, pw90.priorEnd,
              ]);
              // Build prior-period actor revenue list for tier assignment
              const priorActors = priorRes.rows
                .filter((r: any) => !isActorMissing(r.actor_name))
                .map((r: any) => ({
                  name: r.actor_name || "Unknown",
                  revenue: parseFloat(r.revenue_cur) || 0,
                }))
                .filter((a: any) => a.revenue > 0)
                .sort((a: any, b: any) => b.revenue - a.revenue);

              if (priorActors.length > 0) {
                const priorTotalRev = priorActors.reduce((s: number, a: any) => s + a.revenue, 0);
                let cumRev = 0;
                const priorTierMap = new Map<string, "top" | "second" | "bottom">();
                for (const a of priorActors) {
                  cumRev += a.revenue;
                  const pct = priorTotalRev > 0 ? (cumRev / priorTotalRev) * 100 : 0;
                  priorTierMap.set(a.name, pct <= 50 ? "top" : pct <= 80 ? "second" : "bottom");
                }

                tierMigration = [];
                const tierOrder = { top: 0, second: 1, bottom: 2 };
                for (const actor of tieredActors) {
                  const priorTier = priorTierMap.get(actor.name);
                  if (!priorTier || priorTier === actor.tier) continue;
                  tierMigration.push({
                    name: actor.name,
                    fromTier: priorTier,
                    toTier: actor.tier,
                    direction: tierOrder[actor.tier] < tierOrder[priorTier] ? "promoted" : "demoted",
                  });
                }
                if (tierMigration.length === 0) tierMigration = undefined;
              }
            }
          } catch (migrationErr) {
            console.warn(`[InsightMetrics] Tier migration computation failed:`, migrationErr);
          }

          aggregateTrends = {
            tierTrends,
            tierMigration,
            concentration,
            headcountProductionGap,
            companyAverages,
          };
          console.log(
            `[InsightMetrics] Aggregate trends computed: ${tierTrends.length} tier trends, ` +
            `${tierMigration?.length ?? 0} migrations, Gini=${gini}, ` +
            `top3Share=${concentration.top3RevenueShare}%`,
          );
        } catch (aggErr) {
          console.warn(`[InsightMetrics] Aggregate trends computation failed:`, aggErr);
        }

        result.byActorType.push({
          actorType: cfg.actorType,
          actorLabel: cfg.actorLabel,
          totalActors: tieredActors.length,
          tierDistribution: {
            top: topCount,
            second: secondCount,
            bottom: bottomCount,
          },
          topPerformers: tieredActors
            .filter((a) => a.tier === "top")
            .slice(0, 5),
          bottomPerformers: tieredActors
            .filter((a) => a.tier === "bottom")
            .slice(-5)
            .reverse(),
          tierOfficerNames: {
            top: tieredActors.filter(a => a.tier === "top").map(a => a.name),
            second: tieredActors.filter(a => a.tier === "second").map(a => a.name),
            bottom: tieredActors.filter(a => a.tier === "bottom").map(a => a.name),
          },
          tierAverages: {
            top: tierAverages(tieredActors, "top"),
            second: tierAverages(tieredActors, "second"),
            bottom: tierAverages(tieredActors, "bottom"),
          },
          periodChanges: periodChanges.length > 0 ? periodChanges : undefined,
          aggregateTrends,
        });
      } catch (innerErr) {
        console.warn(
          `[InsightMetrics] Tiering failed for ${cfg.actorType}:`,
          innerErr,
        );
      }
    }

    if (result.byActorType.length === 0) {
      console.log(
        "[InsightMetrics] Tiering: no actor data (no funded loans YTD, or all actors filtered as missing)",
      );
    } else {
      console.log(
        `[InsightMetrics] Tiering: collected for ${result.byActorType.map((t) => `${t.actorLabel}=${t.totalActors}`).join(", ")}`,
      );
    }
  } catch (error) {
    console.error("[InsightMetrics] Error fetching personnel tiering:", error);
  }

  return result;
}

// ============================================================================
// Risk Cross-Tabulation — Product x FICO Band x DTI Band fallout analysis
// ============================================================================

interface RiskCrossTabRow {
  product: string;
  ficoBand: string;
  dtiBand: string;
  total: number;
  funded: number;
  fallenOut: number;
  falloutRate: number;
}

interface DeterioratingCell {
  product: string;
  ficoBand: string;
  dtiBand: string;
  currentFalloutRate: number;
  baselineFalloutRate: number;
  deltaPercent: number;
  affectedLoans: number;
}

// ============================================================================
// Field Population Stats — check population rates for insight-critical fields
// ============================================================================

/** Fields that drive insight signals and should be checked for population */
const INSIGHT_CRITICAL_FIELDS = [
  "ctc_date",
  "estimated_closing_date",
  "lock_expiration_date",
  "cd_sent_date",
  "closing_date",
  "funding_date",
  "underwriter",
  "processor",
  "loan_officer",
  "conditional_approval_date",
  "uw_approval_date",
  "credit_pull_date",
  "submitted_to_processing_date",
  "submitted_to_underwriting_date",
] as const;

async function fetchFieldPopulationStats(
  tenantPool: pg.Pool,
): Promise<Record<string, number>> {
  const result: Record<string, number> = {};
  try {
    // Get total active+completed loan count (recent loans are more relevant)
    const countResult = await tenantPool.query(
      "SELECT COUNT(*) as total FROM public.loans WHERE application_date IS NOT NULL"
    );
    const totalLoans = parseInt(countResult.rows[0]?.total || "0");
    if (totalLoans === 0) return result;

    // Check which columns actually exist
    const columnsResult = await tenantPool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'loans'
    `);
    const existingColumns = new Set(columnsResult.rows.map((r: any) => r.column_name));

    // Batch query: compute population rate for each existing field
    const existingFields = INSIGHT_CRITICAL_FIELDS.filter(f => existingColumns.has(f));
    if (existingFields.length === 0) return result;

    const selectParts = existingFields.map(f =>
      `ROUND(COUNT(CASE WHEN ${f} IS NOT NULL AND TRIM(CAST(${f} AS TEXT)) != '' THEN 1 END)::numeric / ${totalLoans} * 100, 1) AS "${f}"`
    );

    const popResult = await tenantPool.query(
      `SELECT ${selectParts.join(", ")} FROM public.loans WHERE application_date IS NOT NULL`
    );

    if (popResult.rows.length > 0) {
      for (const field of existingFields) {
        result[field] = parseFloat(popResult.rows[0][field]) || 0;
      }
    }

    // Mark non-existing fields as 0
    for (const field of INSIGHT_CRITICAL_FIELDS) {
      if (!existingColumns.has(field)) {
        result[field] = 0;
      }
    }

    console.log(
      `[InsightMetrics] Field population: ${existingFields.map(f => `${f}=${result[f]}%`).join(", ")}`
    );

    return result;
  } catch (error) {
    console.error("[InsightMetrics] Error fetching field population stats:", error);
    return result;
  }
}

// ============================================================================
// Risk cross-tabulation
// ============================================================================

async function fetchRiskCrossTab(
  tenantPool: pg.Pool,
  dateRange: DateRange,
  channelGroup?: string,
): Promise<RiskCrossTabRow[]> {
  try {
    const channelClause = buildChannelWhereClause(channelGroup);
    const result = await tenantPool.query(
      `
      SELECT
        COALESCE(NULLIF(TRIM(loan_type), ''), 'Other') AS product,
        CASE
          WHEN fico_score IS NULL THEN 'Unknown'
          WHEN CAST(fico_score AS DECIMAL) < 620 THEN '<620'
          WHEN CAST(fico_score AS DECIMAL) < 660 THEN '620-659'
          WHEN CAST(fico_score AS DECIMAL) < 700 THEN '660-699'
          WHEN CAST(fico_score AS DECIMAL) < 740 THEN '700-739'
          ELSE '740+'
        END AS fico_band,
        CASE
          WHEN be_dti_ratio IS NULL THEN 'Unknown'
          WHEN CAST(be_dti_ratio AS DECIMAL) > 50 THEN '>50%'
          WHEN CAST(be_dti_ratio AS DECIMAL) > 43 THEN '43-50%'
          ELSE '<=43%'
        END AS dti_band,
        COUNT(*) AS total,
        COUNT(CASE WHEN (current_loan_status ILIKE '%Originated%' OR current_loan_status ILIKE '%purchased%')
          THEN 1 END) AS funded,
        COUNT(CASE WHEN current_loan_status NOT IN ('Active Loan','active','locked','submitted','approved')
          AND NOT (current_loan_status ILIKE '%Originated%' OR current_loan_status ILIKE '%purchased%')
          THEN 1 END) AS fallen_out
      FROM public.loans
      WHERE application_date >= $1 AND application_date <= $2
        ${channelClause}
      GROUP BY
        COALESCE(NULLIF(TRIM(loan_type), ''), 'Other'),
        CASE
          WHEN fico_score IS NULL THEN 'Unknown'
          WHEN CAST(fico_score AS DECIMAL) < 620 THEN '<620'
          WHEN CAST(fico_score AS DECIMAL) < 660 THEN '620-659'
          WHEN CAST(fico_score AS DECIMAL) < 700 THEN '660-699'
          WHEN CAST(fico_score AS DECIMAL) < 740 THEN '700-739'
          ELSE '740+'
        END,
        CASE
          WHEN be_dti_ratio IS NULL THEN 'Unknown'
          WHEN CAST(be_dti_ratio AS DECIMAL) > 50 THEN '>50%'
          WHEN CAST(be_dti_ratio AS DECIMAL) > 43 THEN '43-50%'
          ELSE '<=43%'
        END
      HAVING COUNT(*) >= 5
      ORDER BY COUNT(CASE WHEN current_loan_status NOT IN ('Active Loan','active','locked','submitted','approved')
        AND NOT (current_loan_status ILIKE '%Originated%' OR current_loan_status ILIKE '%purchased%')
        THEN 1 END) DESC
      `,
      [dateRange.start, dateRange.end],
    );

    return result.rows.map((r: any) => {
      const total = parseInt(r.total) || 0;
      const funded = parseInt(r.funded) || 0;
      const fallenOut = parseInt(r.fallen_out) || 0;
      const completed = funded + fallenOut;
      return {
        product: r.product,
        ficoBand: r.fico_band,
        dtiBand: r.dti_band,
        total,
        funded,
        fallenOut,
        falloutRate:
          completed > 0 ? Math.round((fallenOut / completed) * 1000) / 10 : 0,
      };
    });
  } catch (error) {
    console.error("[InsightMetrics] Error fetching risk cross-tab:", error);
    return [];
  }
}

function computeDeterioratingCells(
  current: RiskCrossTabRow[],
  baseline: RiskCrossTabRow[],
): DeterioratingCell[] {
  // Build lookup from baseline by composite key
  const baselineMap = new Map<string, RiskCrossTabRow>();
  for (const row of baseline) {
    const key = `${row.product}|${row.ficoBand}|${row.dtiBand}`;
    baselineMap.set(key, row);
  }

  const deteriorating: DeterioratingCell[] = [];

  for (const cur of current) {
    const key = `${cur.product}|${cur.ficoBand}|${cur.dtiBand}`;
    const base = baselineMap.get(key);
    if (!base) continue;
    // Only flag cells where fallout rate increased and baseline had meaningful data
    if (base.falloutRate <= 0 || cur.falloutRate <= base.falloutRate) continue;

    const delta = cur.falloutRate - base.falloutRate;
    deteriorating.push({
      product: cur.product,
      ficoBand: cur.ficoBand,
      dtiBand: cur.dtiBand,
      currentFalloutRate: cur.falloutRate,
      baselineFalloutRate: base.falloutRate,
      deltaPercent: Math.round(delta * 10) / 10,
      affectedLoans: cur.fallenOut,
    });
  }

  // Return top 10 most deteriorated cells, sorted by delta descending
  return deteriorating
    .sort((a, b) => b.deltaPercent - a.deltaPercent)
    .slice(0, 10);
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
  options: { channelGroup?: string } = {},
): Promise<InsightMetricsPayload> {
  const { channelGroup } = options;
  console.log(
    `[InsightMetrics] Collecting metrics for dateFilter: ${dateFilter}, channelGroup: ${
      channelGroup || "all"
    }`,
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

  // Get the revenue expression FIRST so it can be shared across snapshots and tiering
  const revenueExpr = await getTenantRevenueExpression(tenantPool);
  console.log(
    `[InsightMetrics] Revenue expression (first 200 chars): ${revenueExpr.substring(0, 200)}`,
  );

  // ====================================================================
  // Phase 1: Compute unified period snapshots + other independent queries
  // All snapshots use the SAME SQL formula so PT + Fallout = 100% always
  // ====================================================================
  const [
    // 10 period snapshots (current + prior windows)
    snapYtd,
    snapRolling90d,
    snapRolling60d,
    snapRolling30d,
    snapMtd,
    snapPriorYtd,
    snapPrior90d,
    snapPrior60d,
    snapPrior30d,
    snapPriorMtd,
    // 4 long-term baseline snapshots
    snapTrailing12m,
    snapTrailing36m,
    snapPrior12m,
    snapPrior36mBaseline,
    // Other independent queries
    ytdMetrics,
    predictions,
    lostOpportunity,
    creditRiskResult,
    closingRisk,
    lockExpiration,
    tridExposure,
    marginData,
    conditionBacklog,
    tiering,
    productBreakdown,
    closeLateEnhanced,
    riskCrossTabCurrent,
    riskCrossTabBaseline,
    fieldPopulation,
  ] = await Promise.all([
    // --- Period snapshots (all use computePeriodSnapshot with same formula) ---
    computePeriodSnapshot(
      tenantPool,
      "ytd",
      dateRanges.ytd.start,
      dateRanges.ytd.end,
      revenueExpr,
      channelGroup,
    ),
    computePeriodSnapshot(
      tenantPool,
      "90d",
      dateRanges.rolling90D.start,
      dateRanges.rolling90D.end,
      revenueExpr,
      channelGroup,
    ),
    computePeriodSnapshot(
      tenantPool,
      "60d",
      dateRanges.rolling60D.start,
      dateRanges.rolling60D.end,
      revenueExpr,
      channelGroup,
    ),
    computePeriodSnapshot(
      tenantPool,
      "30d",
      dateRanges.trailing30.start,
      dateRanges.trailing30.end,
      revenueExpr,
      channelGroup,
    ),
    computePeriodSnapshot(
      tenantPool,
      "mtd",
      dateRanges.mtd.start,
      dateRanges.mtd.end,
      revenueExpr,
      channelGroup,
    ),
    computePeriodSnapshot(
      tenantPool,
      "prior_ytd",
      dateRanges.lastYear.start,
      dateRanges.lastYear.end,
      revenueExpr,
      channelGroup,
    ),
    computePeriodSnapshot(
      tenantPool,
      "prior_90d",
      dateRanges.prior90.start,
      dateRanges.prior90.end,
      revenueExpr,
      channelGroup,
    ),
    computePeriodSnapshot(
      tenantPool,
      "prior_60d",
      dateRanges.prior60.start,
      dateRanges.prior60.end,
      revenueExpr,
      channelGroup,
    ),
    computePeriodSnapshot(
      tenantPool,
      "prior_30d",
      dateRanges.prior30.start,
      dateRanges.prior30.end,
      revenueExpr,
      channelGroup,
    ),
    computePeriodSnapshot(
      tenantPool,
      "prior_mtd",
      dateRanges.lastMonth.start,
      dateRanges.lastMonth.end,
      revenueExpr,
      channelGroup,
    ),
    // --- Long-term baseline snapshots ---
    computePeriodSnapshot(
      tenantPool,
      "trailing_12m",
      dateRanges.trailing12m.start,
      dateRanges.trailing12m.end,
      revenueExpr,
      channelGroup,
    ),
    computePeriodSnapshot(
      tenantPool,
      "trailing_36m",
      dateRanges.trailing36m.start,
      dateRanges.trailing36m.end,
      revenueExpr,
      channelGroup,
    ),
    computePeriodSnapshot(
      tenantPool,
      "prior_12m",
      dateRanges.prior12m.start,
      dateRanges.prior12m.end,
      revenueExpr,
      channelGroup,
    ),
    computePeriodSnapshot(
      tenantPool,
      "prior_36m_baseline",
      dateRanges.prior36mBaseline.start,
      dateRanges.prior36mBaseline.end,
      revenueExpr,
      channelGroup,
    ),

    // --- Pipeline & credit risk (these use queryMetrics for active loan counts, FICO, etc.) ---
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
      { dateRange: dateRanges.ytd, additionalFilters },
    ),

    // --- Predictions ---
    fetchPredictions(tenantPool, channelGroup),

    // --- Lost opportunity YTD ---
    fetchLostOpportunity(tenantPool, dateRanges.ytd, channelGroup),

    // --- Credit risk ---
    fetchCreditRiskLoans(tenantPool, channelGroup),

    // --- Trigger metrics (B3, C1, G1, C2, D2) ---
    fetchClosingLateRisk(tenantPool, channelGroup),
    fetchLockExpirationExposure(tenantPool, channelGroup),
    fetchTridExposure(tenantPool, channelGroup),
    fetchMarginData(tenantPool, channelGroup),
    fetchConditionBacklog(tenantPool, channelGroup),

    // --- Personnel tiering (now receives revenueExpr to avoid duplicate fetch) ---
    fetchPersonnelTiering(tenantPool, revenueExpr, channelGroup),

    // --- Product breakdown (YTD by loan_type) ---
    fetchProductBreakdown(tenantPool, dateRanges.ytd, channelGroup),

    // --- Close-late enhanced (probabilistic data from prediction service) ---
    fetchCloseLateEnhanced(tenantPool, channelGroup),

    // --- Risk cross-tabulation (Product x FICO x DTI) ---
    fetchRiskCrossTab(tenantPool, dateRanges.ytd, channelGroup),
    fetchRiskCrossTab(tenantPool, dateRanges.prior36mBaseline, channelGroup),

    // --- Field population stats (for insight quality gating) ---
    fetchFieldPopulationStats(tenantPool),
  ]);

  // Assemble the period snapshots object
  const periodSnapshots: InsightMetricsPayload["periodSnapshots"] = {
    ytd: snapYtd,
    rolling90d: snapRolling90d,
    rolling60d: snapRolling60d,
    rolling30d: snapRolling30d,
    mtd: snapMtd,
    priorYtd: snapPriorYtd,
    prior90d: snapPrior90d,
    prior60d: snapPrior60d,
    prior30d: snapPrior30d,
    priorMtd: snapPriorMtd,
    // Long-term baselines
    trailing12m: snapTrailing12m,
    trailing36m: snapTrailing36m,
    prior12m: snapPrior12m,
    prior36mBaseline: snapPrior36mBaseline,
  };

  // Log the consistency check: PT + Fallout should always = 100%
  for (const [key, snap] of Object.entries(periodSnapshots)) {
    const sum = snap.pullThroughRate + snap.falloutRate;
    if (snap.completed > 0 && Math.abs(sum - 100) > 0.2) {
      console.warn(
        `[InsightMetrics] CONSISTENCY WARNING: ${key} PT(${snap.pullThroughRate}) + Fallout(${snap.falloutRate}) = ${sum} (expected 100)`,
      );
    }
  }

  // ====================================================================
  // Phase 2: Process predictions
  // ====================================================================
  const withdrawPredictions = predictions.filter(
    (p) => p.predictedOutcome === "withdraw",
  );
  const denyPredictions = predictions.filter(
    (p) => p.predictedOutcome === "deny",
  );
  const originatePredictions = predictions.filter(
    (p) => p.predictedOutcome === "originate",
  );

  const allAtRiskPredictions = predictions.filter(
    (p) => p.predictedOutcome === "withdraw" || p.predictedOutcome === "deny",
  );
  const allAtRiskLoanIds = allAtRiskPredictions.map((p) => p.loanId);

  const highRiskLoans = predictions
    .filter(
      (p) =>
        (p.predictedOutcome === "withdraw" || p.predictedOutcome === "deny") &&
        p.confidence >= 70,
    )
    .slice(0, 20)
    .map((p) => ({
      loanId: p.loanId,
      confidence: p.confidence,
      predictedOutcome: p.predictedOutcome,
      riskFactors: p.riskFactors || [],
    }));

  const highRiskLoanIds = highRiskLoans.map((l) => l.loanId);
  const [allAtRiskVolume, highRiskVolume] = await Promise.all([
    fetchAtRiskVolume(tenantPool, allAtRiskLoanIds),
    fetchAtRiskVolume(tenantPool, highRiskLoanIds),
  ]);

  // Compute prediction signal summary from enriched prediction data
  const predictionSignals = computePredictionSignalSummary(predictions);

  // Compute risk cross-tab deteriorating cells
  const deterioratingCells = computeDeterioratingCells(
    riskCrossTabCurrent,
    riskCrossTabBaseline,
  );

  // ====================================================================
  // Phase 3: Derive legacy fields from snapshots (backward compatibility)
  // ====================================================================
  const comparisons = deriveComparisons(periodSnapshots);

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

    predictionSignals,

    // Derived from snapshots — guaranteed consistent with funnel metrics
    performance: {
      pullThroughRolling90D: snapRolling90d.pullThroughRate,
      avgCycleTime: snapYtd.avgCycleTime,
      revenueYTD:
        snapYtd.fundedRevenue || Number(ytdMetrics.total_revenue?.value || 0),
      revenueMTD: snapMtd.fundedRevenue,
      volumeYTD: snapYtd.fundedVolume,
      volumeMTD: snapMtd.fundedVolume,
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

    // Derived from YTD snapshot — guaranteed consistent with performance.pullThrough
    funnel: {
      loansStarted: snapYtd.totalApplications,
      loansLocked: snapYtd.locked,
      loansOriginated: snapYtd.funded,
      falloutRate: snapYtd.falloutRate,
    },

    comparisons,

    closingRisk: {
      ...closingRisk,
      closeLate: closeLateEnhanced,
    },
    lockExpiration,
    tridExposure,
    marginData,
    conditionBacklog,
    tiering,
    periodSnapshots,
    productBreakdown,
    fieldPopulation,
    riskCrossTab: {
      currentPeriod: riskCrossTabCurrent,
      baseline: riskCrossTabBaseline,
      deteriorating: deterioratingCells,
    },
  };

  console.log(`[InsightMetrics] Collected metrics payload:`, {
    activeLoans: payload.pipeline.activeLoans,
    activeVolume: payload.pipeline.activeVolume,
    predictions: {
      withdraw: payload.predictions.likelyWithdraw,
      deny: payload.predictions.likelyDeny,
      originate: payload.predictions.likelyOriginate,
      allAtRisk: payload.predictions.allAtRiskLoanIds.length,
      allAtRiskVolume: payload.predictions.allAtRiskVolume,
      highRisk: payload.predictions.highRiskLoans.length,
      highRiskVolume: payload.predictions.highRiskVolume,
    },
    snapshots: Object.entries(periodSnapshots)
      .map(
        ([k, s]) =>
          `${k}: PT=${s.pullThroughRate}% Fallout=${s.falloutRate}% FundedInPeriod=${s.fundedCount} Vol=$${Math.round(s.fundedVolume)} Rev=$${Math.round(s.fundedRevenue)} Cycle=${s.avgCycleTime}d`,
      )
      .join(" | "),
    closingRisk: `${payload.closingRisk.atRiskCount} loans, $${Math.round(payload.closingRisk.atRiskVolume)}, avg ${payload.closingRisk.avgDaysToClose}d`,
    lockExpiration: `${payload.lockExpiration.expiringCount} loans, $${Math.round(payload.lockExpiration.expiringVolume)}, avg ${payload.lockExpiration.avgDaysToExpiry}d`,
    tridExposure: `${payload.tridExposure.atRiskCount} loans, avg ${payload.tridExposure.avgDaysToClose}d`,
    creditRisk: `${payload.creditRisk.highRiskLoanCount} loans, $${Math.round(payload.creditRisk.highRiskVolume)}, FICO=${payload.creditRisk.waFico} LTV=${payload.creditRisk.waLtv} DTI=${payload.creditRisk.waDti}`,
    lostOpportunity: `${payload.lostOpportunity.withdrawnUnits + payload.lostOpportunity.deniedUnits} loans ($${Math.round(payload.lostOpportunity.withdrawnVolume + payload.lostOpportunity.deniedVolume)})`,
    marginBps: `${payload.marginData.currentMonthBps} (delta: ${payload.marginData.deltaBps})`,
    conditionBacklog: `avg=${payload.conditionBacklog.avgConditions}, high=${payload.conditionBacklog.highConditionCount}`,
    tiering: payload.tiering.byActorType
      .map(
        (t) =>
          `${t.actorLabel}: ${t.totalActors} (${t.tierDistribution.top}/${t.tierDistribution.second}/${t.tierDistribution.bottom})`,
      )
      .join(", "),
    products: payload.productBreakdown
      .map(
        (p) =>
          `${p.productType}: ${p.active} active, ${p.completed} completed, ${p.funded} funded, ${p.fallenOut} fallen out, PT=${p.pullThroughRate}%, Fallout=${p.falloutRate}%`,
      )
      .join(" | "),
  });

  return payload;
}

// ============================================================================
// Signal Pre-Analysis
// Deterministic code that tags every metric with direction + magnitude
// before any LLM sees the data. Eliminates "LLM misreads a metric" problems.
// ============================================================================

export interface Signal {
  area:
    | "performance"
    | "personnel"
    | "personnel_aggregate"
    | "predictions"
    | "risk"
    | "risk_cross_tab"
    | "structural"
    | "pipeline"
    | "compliance"
    | "product"
    | "margin"
    | "revenue"
    | "funnel"
    | "comparisons";
  metric: string;
  value: string;
  direction: "positive" | "negative" | "critical" | "neutral";
  context?: string;
  magnitude: "minor" | "moderate" | "major";
}

const fmt$ = (v: number): string => {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
};

const fmtPct = (v: number): string => `${v.toFixed(1)}%`;

export function computeSignals(metrics: InsightMetricsPayload): Signal[] {
  const signals: Signal[] = [];
  const snaps = metrics.periodSnapshots;

  // --- Performance: Pull-Through ---
  const ytdPT = snaps.ytd.pullThroughRate;
  const baseline36mPT = snaps.trailing36m.pullThroughRate;
  const ptDelta = ytdPT - baseline36mPT;

  if (ytdPT > 0 && baseline36mPT > 0) {
    if (ytdPT >= 55 && ptDelta >= 0) {
      signals.push({
        area: "performance",
        metric: "Pull-Through Rate",
        value: fmtPct(ytdPT),
        direction: "positive",
        context: `vs ${fmtPct(baseline36mPT)} trailing 36M baseline (+${ptDelta.toFixed(1)}pp)`,
        magnitude: ptDelta >= 5 ? "major" : "moderate",
      });
    } else if (ytdPT < 50 || ptDelta < -5) {
      signals.push({
        area: "performance",
        metric: "Pull-Through Rate",
        value: fmtPct(ytdPT),
        direction: "negative",
        context: `vs ${fmtPct(baseline36mPT)} trailing 36M baseline (${ptDelta.toFixed(1)}pp)`,
        magnitude: ptDelta < -10 ? "major" : "moderate",
      });
    }
  } else if (ytdPT > 0) {
    signals.push({
      area: "performance",
      metric: "Pull-Through Rate",
      value: fmtPct(ytdPT),
      direction: ytdPT >= 55 ? "positive" : ytdPT < 45 ? "negative" : "neutral",
      magnitude: "moderate",
    });
  }

  // --- Performance: Fallout (compared to tenant's own 36M trailing baseline) ---
  const ytdFallout = snaps.ytd.falloutRate;
  const baselineFallout = snaps.trailing36m.falloutRate;
  if (ytdFallout > 0 && baselineFallout > 0) {
    const falloutDelta = ytdFallout - baselineFallout;
    if (falloutDelta > 10) {
      signals.push({
        area: "performance",
        metric: "Fallout Rate",
        value: fmtPct(ytdFallout),
        direction: "critical",
        context: `vs ${fmtPct(baselineFallout)} trailing 36M baseline (+${falloutDelta.toFixed(1)}pp)`,
        magnitude: "major",
      });
    } else if (falloutDelta > 3) {
      signals.push({
        area: "performance",
        metric: "Fallout Rate",
        value: fmtPct(ytdFallout),
        direction: "negative",
        context: `vs ${fmtPct(baselineFallout)} trailing 36M baseline (+${falloutDelta.toFixed(1)}pp)`,
        magnitude: "moderate",
      });
    } else if (falloutDelta < -3) {
      signals.push({
        area: "performance",
        metric: "Fallout Rate",
        value: fmtPct(ytdFallout),
        direction: "positive",
        context: `vs ${fmtPct(baselineFallout)} trailing 36M baseline (${falloutDelta.toFixed(1)}pp improvement)`,
        magnitude: "moderate",
      });
    } else {
      signals.push({
        area: "performance",
        metric: "Fallout Rate",
        value: fmtPct(ytdFallout),
        direction: "neutral",
        context: `in line with ${fmtPct(baselineFallout)} trailing 36M baseline (${falloutDelta > 0 ? "+" : ""}${falloutDelta.toFixed(1)}pp)`,
        magnitude: "minor",
      });
    }
  } else if (ytdFallout > 0) {
    signals.push({
      area: "performance",
      metric: "Fallout Rate",
      value: fmtPct(ytdFallout),
      direction: ytdFallout > 50 ? "negative" : "neutral",
      context: "no historical baseline available for comparison",
      magnitude: "minor",
    });
  }

  // --- Performance: Cycle Time ---
  const currentCycle = metrics.performance.avgCycleTime;
  const baseline90dCycle = snaps.rolling90d.avgCycleTime;
  if (currentCycle > 0 && baseline90dCycle > 0) {
    const cycleDelta = currentCycle - baseline90dCycle;
    if (cycleDelta >= 3) {
      signals.push({
        area: "performance",
        metric: "Cycle Time",
        value: `${currentCycle}d`,
        direction: "negative",
        context: `vs ${baseline90dCycle}d 90D baseline (+${cycleDelta.toFixed(0)}d)`,
        magnitude: cycleDelta >= 7 ? "major" : "moderate",
      });
    } else if (cycleDelta <= -3) {
      signals.push({
        area: "performance",
        metric: "Cycle Time",
        value: `${currentCycle}d`,
        direction: "positive",
        context: `vs ${baseline90dCycle}d 90D baseline (${cycleDelta.toFixed(0)}d)`,
        magnitude: Math.abs(cycleDelta) >= 7 ? "major" : "moderate",
      });
    }
  } else if (currentCycle > 0) {
    signals.push({
      area: "performance",
      metric: "Cycle Time",
      value: `${currentCycle}d`,
      direction:
        currentCycle <= 35
          ? "positive"
          : currentCycle > 45
            ? "negative"
            : "neutral",
      magnitude: "minor",
    });
  }

  // --- Volume Comparisons ---
  const trailing30Vol = snaps.rolling30d.fundedVolume;
  const prior30Vol = snaps.prior30d.fundedVolume;
  if (trailing30Vol > 0 && prior30Vol > 0) {
    const volChange = ((trailing30Vol - prior30Vol) / prior30Vol) * 100;
    if (Math.abs(volChange) >= 5) {
      signals.push({
        area: "performance",
        metric: "Volume Trailing 30D",
        value: fmt$(trailing30Vol),
        direction: volChange > 0 ? "positive" : "negative",
        context: `vs ${fmt$(prior30Vol)} prior 30D (${volChange > 0 ? "+" : ""}${volChange.toFixed(1)}%)`,
        magnitude: Math.abs(volChange) >= 15 ? "major" : "moderate",
      });
    }
  }

  // --- Structural: 12M vs Prior 12M ---
  const trailing12mPT = snaps.trailing12m.pullThroughRate;
  const prior12mPT = snaps.prior12m.pullThroughRate;
  const trailing12mVol = snaps.trailing12m.fundedVolume;
  const prior12mVol = snaps.prior12m.fundedVolume;

  if (trailing12mPT > 0 && prior12mPT > 0) {
    const pt12Delta = trailing12mPT - prior12mPT;
    if (Math.abs(pt12Delta) >= 2) {
      signals.push({
        area: "structural",
        metric: "12M Pull-Through Trend",
        value: fmtPct(trailing12mPT),
        direction: pt12Delta > 0 ? "positive" : "negative",
        context: `vs ${fmtPct(prior12mPT)} prior 12M (${pt12Delta > 0 ? "+" : ""}${pt12Delta.toFixed(1)}pp)`,
        magnitude: Math.abs(pt12Delta) >= 5 ? "major" : "moderate",
      });
    }
  }
  if (trailing12mVol > 0 && prior12mVol > 0) {
    const volDelta = ((trailing12mVol - prior12mVol) / prior12mVol) * 100;
    if (Math.abs(volDelta) >= 5) {
      signals.push({
        area: "structural",
        metric: "12M Volume Trend",
        value: fmt$(trailing12mVol),
        direction: volDelta > 0 ? "positive" : "negative",
        context: `vs ${fmt$(prior12mVol)} prior 12M (${volDelta > 0 ? "+" : ""}${volDelta.toFixed(1)}%)`,
        magnitude: Math.abs(volDelta) >= 15 ? "major" : "moderate",
      });
    }
  }

  // --- Structural: 36M Baseline ---
  if (baseline36mPT > 0) {
    signals.push({
      area: "structural",
      metric: "36M Baseline",
      value: `PT ${fmtPct(baseline36mPT)}, cycle ${snaps.trailing36m.avgCycleTime}d, ${fmt$(snaps.trailing36m.fundedVolume)} funded`,
      direction: "neutral",
      magnitude: "moderate",
    });
  }

  // --- Predictions: At-Risk ---
  const totalAtRisk = metrics.predictions.allAtRiskLoanIds.length;
  const highConfAtRisk = metrics.predictions.highRiskLoans.length;

  if (highConfAtRisk > 0) {
    signals.push({
      area: "predictions",
      metric: "High-Confidence Fallout Predictions",
      value: `${highConfAtRisk} loans, ${fmt$(metrics.predictions.highRiskVolume)}`,
      direction: "critical",
      context: ">70% predicted fallout probability",
      magnitude:
        metrics.predictions.highRiskVolume >= 1_000_000 ? "major" : "moderate",
    });
  }
  if (totalAtRisk > 0) {
    signals.push({
      area: "predictions",
      metric: "All Predicted Fallout",
      value: `${totalAtRisk} loans (${metrics.predictions.likelyWithdraw} withdraw, ${metrics.predictions.likelyDeny} deny), ${fmt$(metrics.predictions.allAtRiskVolume)}`,
      direction: totalAtRisk >= 10 ? "critical" : "negative",
      magnitude:
        metrics.predictions.allAtRiskVolume >= 2_000_000 ? "major" : "moderate",
    });
  }
  if (metrics.predictions.likelyOriginate > 0 && totalAtRisk === 0) {
    signals.push({
      area: "predictions",
      metric: "Predicted Originations",
      value: `${metrics.predictions.likelyOriginate} loans`,
      direction: "positive",
      magnitude: "minor",
    });
  }

  // --- Prediction Drivers ---
  if (metrics.predictionSignals.withdrawalDrivers.length > 0) {
    const top = metrics.predictionSignals.withdrawalDrivers[0];
    signals.push({
      area: "predictions",
      metric: "Top Withdrawal Driver",
      value: `${top.driver}: ${top.count} loans, ${fmt$(top.volume)}`,
      direction: "negative",
      magnitude: top.count >= 5 ? "major" : "moderate",
    });
  }

  // --- Risk: Credit ---
  if (metrics.creditRisk.highRiskLoanCount >= 3) {
    signals.push({
      area: "risk",
      metric: "High-Risk Credit Loans",
      value: `${metrics.creditRisk.highRiskLoanCount} loans, ${fmt$(metrics.creditRisk.highRiskVolume)}`,
      direction:
        metrics.creditRisk.highRiskLoanCount >= 10 ? "critical" : "negative",
      context: "FICO<620 OR LTV>95% OR DTI>50%",
      magnitude:
        metrics.creditRisk.highRiskLoanCount >= 10 ? "major" : "moderate",
    });
  }

  // --- Risk: Cross-Tab Deteriorating Pockets ---
  // Use area "risk_cross_tab" (not "risk") so the LLM picks the correct source
  // and the detail drilldown shows the Product × FICO × DTI analysis,
  // NOT the generic high-risk loan list.
  for (const pocket of metrics.riskCrossTab.deteriorating.slice(0, 3)) {
    if (pocket.deltaPercent >= 10) {
      signals.push({
        area: "risk_cross_tab",
        metric: "Risk Pocket Deterioration",
        value: `${pocket.product} / FICO ${pocket.ficoBand} / DTI ${pocket.dtiBand}`,
        direction: "critical",
        context: `fallout ${fmtPct(pocket.baselineFalloutRate)} -> ${fmtPct(pocket.currentFalloutRate)} (+${pocket.deltaPercent.toFixed(1)}pp), ${pocket.affectedLoans} loans`,
        magnitude: "major",
      });
    } else if (pocket.deltaPercent >= 5) {
      signals.push({
        area: "risk_cross_tab",
        metric: "Risk Pocket Deterioration",
        value: `${pocket.product} / FICO ${pocket.ficoBand} / DTI ${pocket.dtiBand}`,
        direction: "negative",
        context: `fallout ${fmtPct(pocket.baselineFalloutRate)} -> ${fmtPct(pocket.currentFalloutRate)} (+${pocket.deltaPercent.toFixed(1)}pp), ${pocket.affectedLoans} loans`,
        magnitude: "moderate",
      });
    }
  }

  // --- Field population threshold for gating field-dependent signals ---
  const FIELD_POP_THRESHOLD = 40; // Below this %, signal is unreliable
  const fp = metrics.fieldPopulation || {};
  const ctcPop = fp["ctc_date"] ?? 100;
  const cdSentPop = fp["cd_sent_date"] ?? 100;
  const ctcIsLow = ctcPop < FIELD_POP_THRESHOLD;
  const cdIsLow = cdSentPop < FIELD_POP_THRESHOLD;

  // --- Compliance: Closing Risk ---
  if (metrics.closingRisk.atRiskCount > 0) {
    if (ctcIsLow) {
      console.log(`[Signals] Suppressing Closing-at-Risk: ctc_date only ${ctcPop}% populated (threshold ${FIELD_POP_THRESHOLD}%)`);
    } else {
      signals.push({
        area: "compliance",
        metric: "Closing-at-Risk",
        value: `${metrics.closingRisk.atRiskCount} loans, ${fmt$(metrics.closingRisk.atRiskVolume)}`,
        direction: "critical",
        context: `closing within 10d without CTC, avg ${metrics.closingRisk.avgDaysToClose}d to close`,
        magnitude:
          metrics.closingRisk.atRiskVolume >= 1_000_000 ? "major" : "moderate",
      });
    }
  }

  // --- Compliance: Close-Late Probability ---
  if (metrics.closingRisk.closeLate.highProbCount > 0) {
    signals.push({
      area: "compliance",
      metric: "Close-Late High Probability",
      value: `${metrics.closingRisk.closeLate.highProbCount} loans, ${fmt$(metrics.closingRisk.closeLate.highProbVolume)}`,
      direction: "critical",
      context: ">70% probability of closing late",
      magnitude:
        metrics.closingRisk.closeLate.highProbVolume >= 1_000_000
          ? "major"
          : "moderate",
    });
  }

  // --- Compliance: Lock Expiration ---
  if (metrics.lockExpiration.expiringCount > 0) {
    if (ctcIsLow) {
      console.log(`[Signals] Suppressing Lock Expiration Exposure: ctc_date only ${ctcPop}% populated (threshold ${FIELD_POP_THRESHOLD}%)`);
    } else {
      signals.push({
        area: "compliance",
        metric: "Lock Expiration Exposure",
        value: `${metrics.lockExpiration.expiringCount} loans, ${fmt$(metrics.lockExpiration.expiringVolume)}`,
        direction: "critical",
        context: `expiring within 7d without CTC, avg ${metrics.lockExpiration.avgDaysToExpiry}d`,
        magnitude:
          metrics.lockExpiration.expiringVolume >= 500_000 ? "major" : "moderate",
      });
    }
  }

  // --- Compliance: TRID ---
  if (metrics.tridExposure.atRiskCount > 0) {
    if (cdIsLow) {
      console.log(`[Signals] Suppressing TRID Compliance Exposure: cd_sent_date only ${cdSentPop}% populated (threshold ${FIELD_POP_THRESHOLD}%)`);
    } else {
      signals.push({
        area: "compliance",
        metric: "TRID Compliance Exposure",
        value: `${metrics.tridExposure.atRiskCount} loans`,
        direction: "critical",
        context: `closing within 5d without CD sent`,
        magnitude: "major",
      });
    }
  }

  // --- Margin ---
  if (metrics.marginData.currentMonthBps > 0) {
    const deltaBps = metrics.marginData.deltaBps;
    signals.push({
      area: "margin",
      metric: "Gain-on-Sale Margin",
      value: `${metrics.marginData.currentMonthBps}bps`,
      direction:
        deltaBps > 5 ? "positive" : deltaBps < -5 ? "negative" : "neutral",
      context:
        deltaBps !== 0
          ? `${deltaBps > 0 ? "+" : ""}${deltaBps}bps vs prior month`
          : undefined,
      magnitude:
        Math.abs(deltaBps) >= 15
          ? "major"
          : Math.abs(deltaBps) >= 5
            ? "moderate"
            : "minor",
    });
  }

  // --- Pipeline ---
  if (metrics.pipeline.activeLoans > 0) {
    signals.push({
      area: "pipeline",
      metric: "Active Pipeline",
      value: `${metrics.pipeline.activeLoans} loans, ${fmt$(metrics.pipeline.activeVolume)}`,
      direction: "neutral",
      magnitude: "moderate",
    });
  }

  // --- Credit Profile ---
  if (metrics.creditRisk.waFico > 0) {
    signals.push({
      area: "pipeline",
      metric: "Credit Profile",
      value: `WA FICO ${metrics.creditRisk.waFico}, LTV ${fmtPct(metrics.creditRisk.waLtv)}, DTI ${fmtPct(metrics.creditRisk.waDti)}`,
      direction: "neutral",
      magnitude: "minor",
    });
  }

  // --- Lost Opportunity ---
  const totalLost =
    metrics.lostOpportunity.withdrawnUnits +
    metrics.lostOpportunity.deniedUnits;
  const totalLostVol =
    metrics.lostOpportunity.withdrawnVolume +
    metrics.lostOpportunity.deniedVolume;
  if (totalLost > 0) {
    signals.push({
      area: "performance",
      metric: "Lost Opportunity",
      value: `${totalLost} loans lost (${metrics.lostOpportunity.withdrawnUnits} withdrawn, ${metrics.lostOpportunity.deniedUnits} denied), ${fmt$(totalLostVol)}`,
      direction: totalLostVol >= 1_000_000 ? "critical" : "negative",
      context: `proforma revenue lost: ${fmt$(metrics.lostOpportunity.withdrawnProformaRevenue)}`,
      magnitude: totalLostVol >= 2_000_000 ? "major" : "moderate",
    });
  }

  // --- Product Breakdown ---
  for (const prod of metrics.productBreakdown) {
    if (prod.funded === 0 && prod.active === 0) continue;
    const portfolioPT = ytdPT;
    if (portfolioPT > 0 && prod.pullThroughRate > 0) {
      const ptDiff = prod.pullThroughRate - portfolioPT;
      if (ptDiff >= 10) {
        signals.push({
          area: "product",
          metric: `Product: ${prod.productType}`,
          value: `${fmtPct(prod.pullThroughRate)} PT, ${prod.funded} funded, ${fmt$(prod.fundedVolume)}`,
          direction: "positive",
          context: `+${ptDiff.toFixed(1)}pp above portfolio avg`,
          magnitude: ptDiff >= 20 ? "major" : "moderate",
        });
      } else if (ptDiff <= -10) {
        signals.push({
          area: "product",
          metric: `Product: ${prod.productType}`,
          value: `${fmtPct(prod.pullThroughRate)} PT, ${prod.funded} funded, ${fmt$(prod.fundedVolume)}`,
          direction: "negative",
          context: `${ptDiff.toFixed(1)}pp below portfolio avg`,
          magnitude: ptDiff <= -20 ? "major" : "moderate",
        });
      }
    }
    if (prod.falloutRate > 40 && prod.fallenOut > 5) {
      signals.push({
        area: "product",
        metric: `Product Fallout: ${prod.productType}`,
        value: `${fmtPct(prod.falloutRate)} fallout, ${prod.fallenOut} fallen out`,
        direction: "critical",
        magnitude: "major",
      });
    }
  }

  // --- Personnel: Top Performers ---
  // Gate on BOTH volume AND pull-through. High revenue with bad PT is NOT a
  // "top performer" — it's a high-volume LO with conversion problems.
  for (const tierGroup of metrics.tiering.byActorType) {
    if (tierGroup.actorType !== "loan_officer") continue;
    const portfolioPT = ytdPT; // portfolio-level pull-through for comparison
    for (const officer of tierGroup.topPerformers.slice(0, 3)) {
      if (officer.units < 3) continue;
      if (officer.pullThrough >= 50 && (portfolioPT <= 0 || officer.pullThrough >= portfolioPT * 0.8)) {
        // Genuinely strong performer: good volume AND acceptable PT
        signals.push({
          area: "personnel",
          metric: `Top Performer: ${officer.name}`,
          value: `${officer.units} units funded YTD, ${fmt$(officer.revenue)} GOS revenue, ${fmtPct(officer.pullThrough)} PT`,
          direction: "positive",
          context: `${fmt$(officer.volume)} funded volume (funding_date scoped YTD). Detail should show loans WHERE funding_date is in YTD range for this officer.`,
          magnitude: officer.units >= 8 ? "major" : "moderate",
        });
      } else {
        // High volume but poor conversion — flag as needing attention, NOT positive
        signals.push({
          area: "personnel",
          metric: `High Volume, Low Conversion: ${officer.name}`,
          value: `${officer.units} units funded YTD, ${fmt$(officer.revenue)} rev, but only ${fmtPct(officer.pullThrough)} PT`,
          direction: "negative",
          context: `Top revenue tier but PT is ${officer.pullThrough < portfolioPT ? `${(portfolioPT - officer.pullThrough).toFixed(1)}pp below portfolio avg (${fmtPct(portfolioPT)})` : "below 50% threshold"}. ${officer.lostOpportunityUnits} withdrawn, ${officer.deniedUnits} denied. Detail should show loans WHERE funding_date is in YTD range for this officer.`,
          magnitude: "major",
        });
      }
    }
    for (const officer of tierGroup.bottomPerformers.slice(0, 3)) {
      signals.push({
        area: "personnel",
        metric: `Bottom Performer: ${officer.name}`,
        value: `${officer.units} units funded YTD, ${fmt$(officer.revenue)} rev, ${fmtPct(officer.pullThrough)} PT`,
        direction: "negative",
        context: `${officer.lostOpportunityUnits} lost, ${officer.deniedUnits} denied, tier: ${officer.tier}. Detail should show loans WHERE funding_date is in YTD range for this officer.`,
        magnitude: officer.lostOpportunityUnits >= 3 ? "major" : "moderate",
      });
    }

    // Period change trends
    if (tierGroup.periodChanges) {
      for (const change of tierGroup.periodChanges.slice(0, 5)) {
        const isTop = tierGroup.topPerformers.some(
          (p) => p.name === change.name,
        );
        const isBottom = tierGroup.bottomPerformers.some(
          (p) => p.name === change.name,
        );
        if (!isTop && !isBottom) continue;
        signals.push({
          area: "personnel",
          metric: `${change.name}: ${change.metric} ${change.window} trend`,
          value: `${change.prior} -> ${change.current}`,
          direction: change.direction === "improved" ? "positive" : "negative",
          context: `${change.direction} ${Math.abs(change.deltaPct).toFixed(0)}% over ${change.window}`,
          magnitude: Math.abs(change.deltaPct) >= 30 ? "major" : "moderate",
        });
      }
    }

    // --- Aggregate Personnel Trends ---
    if (tierGroup.aggregateTrends) {
      const agg = tierGroup.aggregateTrends;

      // Tier-level period trends
      for (const trend of agg.tierTrends.slice(0, 10)) {
        const tierLabel = trend.tier === "top" ? "Top Tier" : trend.tier === "second" ? "Second Tier" : "Bottom Tier";
        const metricLabel: Record<string, string> = {
          revenue: "avg GOS Revenue", units: "avg Units", volume: "avg Volume",
          pullThrough: "avg PT", revenueBps: "avg BPS", cycleTime: "avg Cycle Time",
        };
        signals.push({
          area: "personnel_aggregate",
          metric: `${tierLabel} ${metricLabel[trend.metric] || trend.metric} ${trend.window} trend`,
          value: `${trend.priorAvg} -> ${trend.currentAvg}`,
          direction: trend.direction === "improved" ? "positive" : "negative",
          context: `${tierLabel} ${trend.direction} ${Math.abs(trend.deltaPct).toFixed(0)}% over ${trend.window}`,
          magnitude: Math.abs(trend.deltaPct) >= 20 ? "major" : "moderate",
        });
      }

      // Tier migration
      if (agg.tierMigration && agg.tierMigration.length > 0) {
        const promoted = agg.tierMigration.filter((m) => m.direction === "promoted");
        const demoted = agg.tierMigration.filter((m) => m.direction === "demoted");
        if (promoted.length > 0) {
          signals.push({
            area: "personnel_aggregate",
            metric: "Tier Promotion (vs 90D prior)",
            value: `${promoted.length} officer${promoted.length > 1 ? "s" : ""} promoted`,
            direction: "positive",
            context: promoted.map((m) => `${m.name}: ${m.fromTier}→${m.toTier}`).join("; "),
            magnitude: promoted.length >= 3 ? "major" : "moderate",
          });
        }
        if (demoted.length > 0) {
          signals.push({
            area: "personnel_aggregate",
            metric: "Tier Demotion (vs 90D prior)",
            value: `${demoted.length} officer${demoted.length > 1 ? "s" : ""} demoted`,
            direction: "negative",
            context: demoted.map((m) => `${m.name}: ${m.fromTier}→${m.toTier}`).join("; "),
            magnitude: demoted.length >= 3 ? "major" : "moderate",
          });
        }
      }

      // Concentration risk
      if (agg.concentration.top3RevenueShare >= 60) {
        signals.push({
          area: "personnel_aggregate",
          metric: "Revenue Concentration Risk",
          value: `Top 3 officers = ${agg.concentration.top3RevenueShare}% of total revenue`,
          direction: agg.concentration.top3RevenueShare >= 75 ? "critical" : "negative",
          context: `Top 5 = ${agg.concentration.top5RevenueShare}%, Gini = ${agg.concentration.giniCoefficient}`,
          magnitude: agg.concentration.top3RevenueShare >= 75 ? "major" : "moderate",
        });
      } else if (agg.concentration.giniCoefficient >= 0.5) {
        signals.push({
          area: "personnel_aggregate",
          metric: "Revenue Concentration",
          value: `Gini coefficient = ${agg.concentration.giniCoefficient} (moderate inequality)`,
          direction: "neutral",
          context: `Top 3 = ${agg.concentration.top3RevenueShare}%, Top 5 = ${agg.concentration.top5RevenueShare}%`,
          magnitude: "minor",
        });
      }

      // Headcount-production gap
      for (const gap of agg.headcountProductionGap) {
        // Flag when bottom tier has disproportionately large headcount relative to revenue
        if (gap.tier === "bottom" && gap.headcountPct >= 40 && gap.revenuePct <= 15) {
          signals.push({
            area: "personnel_aggregate",
            metric: "Headcount-Production Gap (Bottom Tier)",
            value: `${gap.headcountPct}% of headcount but only ${gap.revenuePct}% of revenue`,
            direction: "negative",
            context: `${gap.unitsPct}% of units. Gap: ${gap.gap}pp`,
            magnitude: gap.headcountPct - gap.revenuePct >= 35 ? "major" : "moderate",
          });
        }
        // Flag when top tier is very lean — key-person risk
        if (gap.tier === "top" && gap.headcountPct <= 15 && gap.revenuePct >= 50) {
          signals.push({
            area: "personnel_aggregate",
            metric: "Key-Person Risk (Top Tier)",
            value: `${gap.headcountPct}% of headcount generates ${gap.revenuePct}% of revenue`,
            direction: "negative",
            context: `Small number of top producers carry majority of revenue. Gap: ${gap.gap}pp`,
            magnitude: "major",
          });
        }
      }

      // Company benchmark signals — tier averages vs company-wide averages
      const ca = agg.companyAverages;
      const tierAvgs = tierGroup.tierAverages;
      if (ca.avgPullThrough > 0 && tierAvgs.bottom.avgPullThrough > 0) {
        const ptGap = ca.avgPullThrough - tierAvgs.bottom.avgPullThrough;
        if (ptGap >= 10) {
          signals.push({
            area: "personnel_aggregate",
            metric: "Bottom Tier vs Company Avg PT",
            value: `Bottom tier PT ${fmtPct(tierAvgs.bottom.avgPullThrough)} vs company avg ${fmtPct(ca.avgPullThrough)}`,
            direction: "negative",
            context: `${ptGap.toFixed(1)}pp below company average`,
            magnitude: ptGap >= 15 ? "major" : "moderate",
          });
        }
      }
      if (ca.avgCycleTime > 0 && tierAvgs.bottom.avgCycleTime > 0) {
        const cycleGap = tierAvgs.bottom.avgCycleTime - ca.avgCycleTime;
        if (cycleGap >= 10) {
          signals.push({
            area: "personnel_aggregate",
            metric: "Bottom Tier vs Company Avg Cycle Time",
            value: `Bottom tier ${tierAvgs.bottom.avgCycleTime}d vs company avg ${ca.avgCycleTime}d`,
            direction: "negative",
            context: `${cycleGap}d slower than company average`,
            magnitude: cycleGap >= 15 ? "major" : "moderate",
          });
        }
      }
    }
  }

  // --- Condition Backlog ---
  if (metrics.conditionBacklog.avgConditions > 5) {
    signals.push({
      area: "pipeline",
      metric: "Condition Backlog",
      value: `avg ${metrics.conditionBacklog.avgConditions.toFixed(1)} conditions/loan`,
      direction: "negative",
      context: `${metrics.conditionBacklog.highConditionCount} loans with >10 conditions`,
      magnitude:
        metrics.conditionBacklog.avgConditions > 8 ? "major" : "moderate",
    });
  } else if (metrics.conditionBacklog.avgConditions > 0) {
    signals.push({
      area: "pipeline",
      metric: "Condition Backlog",
      value: `avg ${metrics.conditionBacklog.avgConditions.toFixed(1)} conditions/loan`,
      direction:
        metrics.conditionBacklog.avgConditions <= 3 ? "positive" : "neutral",
      context: `${metrics.conditionBacklog.highConditionCount} loans with >10 conditions`,
      magnitude: "minor",
    });
  }

  // ==========================================
  // COMPARISONS: MoM & YoY signals
  // ==========================================
  const comp = metrics.comparisons;

  // Volume MoM
  if (comp.currentMtdVolume > 0 && comp.lastMonthVolume > 0) {
    const volMom = comp.volumeVsLastMonth;
    if (Math.abs(volMom) >= 5) {
      signals.push({
        area: "comparisons",
        metric: "Volume MoM Change",
        value: `${fmt$(comp.currentMtdVolume)} trailing 30D`,
        direction: volMom > 0 ? "positive" : "negative",
        context: `${volMom > 0 ? "+" : ""}${volMom.toFixed(1)}% vs prior 30D (${fmt$(comp.lastMonthVolume)})`,
        magnitude: Math.abs(volMom) >= 20 ? "major" : "moderate",
      });
    }
  }

  // Volume YoY
  if (comp.currentYtdVolume > 0 && comp.lastYearVolume > 0) {
    const volYoy = comp.volumeVsLastYear;
    if (Math.abs(volYoy) >= 5) {
      signals.push({
        area: "comparisons",
        metric: "Volume YoY Change",
        value: `${fmt$(comp.currentYtdVolume)} YTD`,
        direction: volYoy > 0 ? "positive" : "negative",
        context: `${volYoy > 0 ? "+" : ""}${volYoy.toFixed(1)}% vs prior YTD (${fmt$(comp.lastYearVolume)})`,
        magnitude: Math.abs(volYoy) >= 20 ? "major" : "moderate",
      });
    }
  }

  // Cycle Time MoM
  if (comp.currentCycleTime > 0 && comp.lastMonthCycleTime > 0) {
    const cycleMom = comp.cycleTimeVsLastMonth;
    if (Math.abs(cycleMom) >= 5) {
      signals.push({
        area: "comparisons",
        metric: "Cycle Time MoM Change",
        value: `${comp.currentCycleTime.toFixed(0)}d trailing 30D`,
        direction: cycleMom > 0 ? "negative" : "positive",
        context: `${cycleMom > 0 ? "+" : ""}${cycleMom.toFixed(1)}% vs prior 30D (${comp.lastMonthCycleTime.toFixed(0)}d)`,
        magnitude: Math.abs(cycleMom) >= 15 ? "major" : "moderate",
      });
    }
  }

  // Pull-Through MoM
  const ptMom = comp.pullThroughVsLastMonth;
  if (
    snaps.rolling30d.pullThroughRate > 0 &&
    snaps.prior30d.pullThroughRate > 0 &&
    Math.abs(ptMom) >= 3
  ) {
    signals.push({
      area: "comparisons",
      metric: "Pull-Through MoM Change",
      value: `${fmtPct(snaps.rolling30d.pullThroughRate)} trailing 30D`,
      direction: ptMom > 0 ? "positive" : "negative",
      context: `${ptMom > 0 ? "+" : ""}${ptMom.toFixed(1)}% vs prior 30D (${fmtPct(snaps.prior30d.pullThroughRate)})`,
      magnitude: Math.abs(ptMom) >= 10 ? "major" : "moderate",
    });
  }

  // ==========================================
  // FUNNEL: Start/Lock/Originate metrics
  // ==========================================
  const funnel = metrics.funnel;

  if (funnel.loansStarted > 0) {
    signals.push({
      area: "funnel",
      metric: "Loans Started YTD",
      value: `${funnel.loansStarted} applications`,
      direction: "neutral",
      magnitude: "moderate",
    });
  }

  if (funnel.loansLocked > 0 && funnel.loansStarted > 0) {
    const lockRate = (funnel.loansLocked / funnel.loansStarted) * 100;
    signals.push({
      area: "funnel",
      metric: "Lock Rate YTD",
      value: `${fmtPct(lockRate)} (${funnel.loansLocked} of ${funnel.loansStarted})`,
      direction:
        lockRate >= 70 ? "positive" : lockRate < 50 ? "negative" : "neutral",
      magnitude: "moderate",
    });
  }

  if (funnel.loansOriginated > 0 && funnel.loansStarted > 0) {
    const originateRate = (funnel.loansOriginated / funnel.loansStarted) * 100;
    signals.push({
      area: "funnel",
      metric: "Conversion Rate YTD",
      value: `${fmtPct(originateRate)} (${funnel.loansOriginated} funded of ${funnel.loansStarted} started)`,
      direction:
        originateRate >= 40
          ? "positive"
          : originateRate < 25
            ? "negative"
            : "neutral",
      magnitude: "moderate",
    });
  }

  // ==========================================
  // REVENUE: YTD & MTD revenue signals
  // ==========================================
  const perf = metrics.performance;

  if (perf.revenueYTD > 0) {
    signals.push({
      area: "revenue",
      metric: "Revenue YTD",
      value: fmt$(perf.revenueYTD),
      direction: "neutral",
      magnitude: "moderate",
      context: `${fmt$(perf.volumeYTD)} funded volume YTD`,
    });
  }

  if (perf.revenueYTD > 0 && perf.volumeYTD > 0) {
    const revPerLoan = perf.revenueYTD / (funnel.loansOriginated || 1);
    const revBps = (perf.revenueYTD / perf.volumeYTD) * 10000;
    signals.push({
      area: "revenue",
      metric: "Revenue Per Loan YTD",
      value: `${fmt$(revPerLoan)} per funded loan (${Math.round(revBps)}bps)`,
      direction:
        revBps >= 100 ? "positive" : revBps < 50 ? "negative" : "neutral",
      magnitude: "moderate",
    });
  }

  // Revenue MoM comparison
  if (perf.revenueMTD > 0 && snaps.prior30d.fundedRevenue > 0) {
    const revMom =
      ((perf.revenueMTD - snaps.prior30d.fundedRevenue) /
        snaps.prior30d.fundedRevenue) *
      100;
    if (Math.abs(revMom) >= 5) {
      signals.push({
        area: "revenue",
        metric: "Revenue MoM Change",
        value: `${fmt$(perf.revenueMTD)} trailing 30D`,
        direction: revMom > 0 ? "positive" : "negative",
        context: `${revMom > 0 ? "+" : ""}${revMom.toFixed(1)}% vs prior 30D (${fmt$(snaps.prior30d.fundedRevenue)})`,
        magnitude: Math.abs(revMom) >= 20 ? "major" : "moderate",
      });
    }
  }

  // ==========================================
  // PERIOD VELOCITY: MTD vs rolling 30D momentum (funding-cohort based)
  // ==========================================
  const mtdFundedCount = snaps.mtd.fundedCount;
  const rolling30FundedCount = snaps.rolling30d.fundedCount;
  if (mtdFundedCount > 0 && rolling30FundedCount > 0) {
    const now = new Date();
    const dayOfMonth = now.getDate();
    const daysInMonth = new Date(
      now.getFullYear(),
      now.getMonth() + 1,
      0,
    ).getDate();
    const paceFactor = daysInMonth / dayOfMonth;
    const projectedMonthFunded = Math.round(mtdFundedCount * paceFactor);
    if (projectedMonthFunded > rolling30FundedCount * 1.1) {
      signals.push({
        area: "performance",
        metric: "MTD Pace",
        value: `${mtdFundedCount} funded through day ${dayOfMonth}, ${projectedMonthFunded} projected`,
        direction: "positive",
        context: `on pace to exceed prior 30D (${rolling30FundedCount} funded)`,
        magnitude:
          projectedMonthFunded > rolling30FundedCount * 1.3 ? "major" : "moderate",
      });
    } else if (projectedMonthFunded < rolling30FundedCount * 0.8) {
      signals.push({
        area: "performance",
        metric: "MTD Pace",
        value: `${mtdFundedCount} funded through day ${dayOfMonth}, ${projectedMonthFunded} projected`,
        direction: "negative",
        context: `falling behind prior 30D (${rolling30FundedCount} funded)`,
        magnitude:
          projectedMonthFunded < rolling30FundedCount * 0.6 ? "major" : "moderate",
      });
    }
  }

  // ==========================================
  // ALL PRODUCTS: Ensure every product gets a signal (not just outliers)
  // ==========================================
  for (const prod of metrics.productBreakdown) {
    if (prod.funded === 0 && prod.active === 0 && prod.fallenOut === 0)
      continue;
    // Summary signal for every product with activity
    if (prod.completed > 0) {
      signals.push({
        area: "product",
        metric: `Product Summary: ${prod.productType}`,
        value: `${prod.active} active, ${prod.funded} funded, ${prod.fallenOut} fallen out (${prod.withdrawn} withdrawn, ${prod.denied} denied)`,
        direction:
          prod.pullThroughRate >= 60
            ? "positive"
            : prod.pullThroughRate < 40
              ? "negative"
              : "neutral",
        context: `PT=${fmtPct(prod.pullThroughRate)}, Vol=${fmt$(prod.fundedVolume)}`,
        magnitude:
          prod.funded >= 20 ? "major" : prod.funded >= 5 ? "moderate" : "minor",
      });
    }
  }

  // ==========================================
  // PERSONNEL: Ensure more personnel signals
  // ==========================================
  for (const tierGroup of metrics.tiering.byActorType) {
    if (tierGroup.actorType !== "loan_officer") continue;

    // Tier distribution signal
    const dist = tierGroup.tierDistribution;
    signals.push({
      area: "personnel",
      metric: "Tier Distribution",
      value: `${dist.top} top, ${dist.second} mid, ${dist.bottom} bottom tier (${tierGroup.totalActors} total)`,
      direction: dist.top >= dist.bottom ? "positive" : "negative",
      context: `${tierGroup.actorLabel} tiering`,
      magnitude: "moderate",
    });

    // Revenue distribution — top performers' revenue concentration
    const allPerformers = [
      ...tierGroup.topPerformers,
      ...tierGroup.bottomPerformers,
    ];
    if (allPerformers.length > 0) {
      const topRev = tierGroup.topPerformers.reduce(
        (sum, p) => sum + p.revenue,
        0,
      );
      const totalRev = allPerformers.reduce((sum, p) => sum + p.revenue, 0);
      if (totalRev > 0) {
        const topConcentration = (topRev / totalRev) * 100;
        if (topConcentration > 70) {
          signals.push({
            area: "personnel",
            metric: "Revenue Concentration",
            value: `Top ${tierGroup.topPerformers.length} officers generate ${fmtPct(topConcentration)} of tracked revenue`,
            direction: "neutral",
            context: `${fmt$(topRev)} from top tier vs ${fmt$(totalRev)} total`,
            magnitude: "moderate",
          });
        }
      }
    }
  }

  // ==========================================
  // ROLLING 90D snapshot signals (distinct from 30D)
  // ==========================================
  if (snaps.rolling90d.fundedCount > 0 || snaps.rolling90d.funded > 0) {
    signals.push({
      area: "performance",
      metric: "Rolling 90D Performance",
      value: `${snaps.rolling90d.fundedCount} funded in period, ${fmt$(snaps.rolling90d.fundedVolume)}, PT=${fmtPct(snaps.rolling90d.pullThroughRate)}`,
      direction:
        snaps.rolling90d.pullThroughRate >= 55
          ? "positive"
          : snaps.rolling90d.pullThroughRate < 45
            ? "negative"
            : "neutral",
      context: `cycle time ${snaps.rolling90d.avgCycleTime}d, revenue ${fmt$(snaps.rolling90d.fundedRevenue)}`,
      magnitude: "moderate",
    });
  }

  // YTD vs prior YTD pull-through comparison
  if (snaps.ytd.pullThroughRate > 0 && snaps.priorYtd.pullThroughRate > 0) {
    const ptYoyDelta =
      snaps.ytd.pullThroughRate - snaps.priorYtd.pullThroughRate;
    if (Math.abs(ptYoyDelta) >= 2) {
      signals.push({
        area: "structural",
        metric: "Pull-Through YoY Change",
        value: `${fmtPct(snaps.ytd.pullThroughRate)} YTD`,
        direction: ptYoyDelta > 0 ? "positive" : "negative",
        context: `vs ${fmtPct(snaps.priorYtd.pullThroughRate)} prior YTD (${ptYoyDelta > 0 ? "+" : ""}${ptYoyDelta.toFixed(1)}pp)`,
        magnitude: Math.abs(ptYoyDelta) >= 5 ? "major" : "moderate",
      });
    }
  }

  // Revenue YoY
  if (snaps.ytd.fundedRevenue > 0 && snaps.priorYtd.fundedRevenue > 0) {
    const revYoy =
      ((snaps.ytd.fundedRevenue - snaps.priorYtd.fundedRevenue) /
        snaps.priorYtd.fundedRevenue) *
      100;
    if (Math.abs(revYoy) >= 5) {
      signals.push({
        area: "revenue",
        metric: "Revenue YoY Change",
        value: `${fmt$(snaps.ytd.fundedRevenue)} YTD`,
        direction: revYoy > 0 ? "positive" : "negative",
        context: `${revYoy > 0 ? "+" : ""}${revYoy.toFixed(1)}% vs prior YTD (${fmt$(snaps.priorYtd.fundedRevenue)})`,
        magnitude: Math.abs(revYoy) >= 20 ? "major" : "moderate",
      });
    }
  }

  // Rolling 60D vs prior 60D (medium-term momentum)
  if (snaps.rolling60d.fundedVolume > 0 && snaps.prior60d.fundedVolume > 0) {
    const vol60Delta =
      ((snaps.rolling60d.fundedVolume - snaps.prior60d.fundedVolume) /
        snaps.prior60d.fundedVolume) *
      100;
    if (Math.abs(vol60Delta) >= 5) {
      signals.push({
        area: "comparisons",
        metric: "Volume 60D Momentum",
        value: `${fmt$(snaps.rolling60d.fundedVolume)} trailing 60D`,
        direction: vol60Delta > 0 ? "positive" : "negative",
        context: `${vol60Delta > 0 ? "+" : ""}${vol60Delta.toFixed(1)}% vs prior 60D (${fmt$(snaps.prior60d.fundedVolume)})`,
        magnitude: Math.abs(vol60Delta) >= 15 ? "major" : "moderate",
      });
    }
  }

  console.log(
    `[InsightMetrics] Computed ${signals.length} signals: ${signals.filter((s) => s.direction === "critical").length} critical, ${signals.filter((s) => s.direction === "negative").length} negative, ${signals.filter((s) => s.direction === "positive").length} positive, ${signals.filter((s) => s.direction === "neutral").length} neutral`,
  );

  return signals;
}

/**
 * Format signals into a text block for the LLM prompt.
 */
export function formatSignalsForPrompt(signals: Signal[]): string {
  const grouped: Record<string, Signal[]> = {
    critical: [],
    negative: [],
    positive: [],
    neutral: [],
  };
  for (const s of signals) {
    grouped[s.direction].push(s);
  }

  const lines: string[] = [
    "=== PRE-COMPUTED SIGNALS (use these to guide your analysis) ===",
  ];
  for (const [dir, sigs] of Object.entries(grouped)) {
    if (sigs.length === 0) continue;
    lines.push(`\n${dir.toUpperCase()} (${sigs.length} signals):`);
    for (const s of sigs) {
      let line = `- ${s.metric}: ${s.value}`;
      if (s.context) line += ` (${s.context})`;
      line += ` [${s.area}, ${s.magnitude}]`;
      lines.push(line);
    }
  }
  return lines.join("\n");
}

/**
 * Filter signals to only those relevant to a specific insight domain.
 * Each domain has a set of signal `area` values it covers.
 */
export function filterSignalsByDomain(signals: Signal[], signalAreas: Signal["area"][]): Signal[] {
  const areaSet = new Set(signalAreas);
  return signals.filter(s => areaSet.has(s.area));
}

// ============================================================================
// RAG Context Functions — enrich the Generator prompt with historical + KB data
// ============================================================================

/**
 * Build a risk profile summary text from the current signals for embedding.
 * Focuses on the most impactful signals to find similar historical patterns.
 */
function buildRiskProfileText(
  signals: Signal[],
  metrics: InsightMetricsPayload,
): string {
  const parts: string[] = [];

  // Core pipeline metrics
  parts.push(
    `Pipeline: ${metrics.pipeline.activeLoans} active loans, $${(metrics.pipeline.activeVolume / 1_000_000).toFixed(1)}M volume`,
  );

  // Pull-through and fallout
  const ytd = metrics.periodSnapshots.ytd;
  if (ytd) {
    parts.push(
      `Pull-through: ${ytd.pullThroughRate.toFixed(1)}%, Fallout: ${ytd.falloutRate.toFixed(1)}%`,
    );
    parts.push(`Avg cycle time: ${ytd.avgCycleTime.toFixed(0)} days`);
  }

  // Credit risk profile
  parts.push(
    `Credit profile: FICO ${metrics.creditRisk.waFico.toFixed(0)}, LTV ${metrics.creditRisk.waLtv.toFixed(1)}%, DTI ${metrics.creditRisk.waDti.toFixed(1)}%`,
  );
  parts.push(`High-risk loans: ${metrics.creditRisk.highRiskLoanCount}`);

  // Prediction summary
  parts.push(
    `Predicted withdrawals: ${metrics.predictions.likelyWithdraw}, denials: ${metrics.predictions.likelyDeny}`,
  );

  // Top critical/negative signals
  const severeSignals = signals
    .filter((s) => s.direction === "critical" || s.direction === "negative")
    .slice(0, 8);
  if (severeSignals.length > 0) {
    parts.push("Key risk signals:");
    for (const s of severeSignals) {
      parts.push(`  ${s.metric}: ${s.value} (${s.direction}/${s.magnitude})`);
    }
  }

  return parts.join("\n");
}

/**
 * Fetch historical pattern context using loan outcome embeddings.
 * Embeds the current risk profile, searches for similar historical loans,
 * and returns an aggregated summary of what happened to similar loans.
 *
 * Graceful: returns empty string on any failure.
 */
export async function fetchHistoricalPatternContext(
  tenantPool: pg.Pool,
  tenantId: string,
  signals: Signal[],
  metrics: InsightMetricsPayload,
): Promise<string> {
  try {
    // Check if loan_outcome_embeddings table exists
    const tableCheck = await tenantPool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'loan_outcome_embeddings'
      ) as exists
    `);
    if (!tableCheck.rows[0]?.exists) {
      console.log(
        "[RAG] loan_outcome_embeddings table does not exist, skipping historical context",
      );
      return "";
    }

    // Check if there are any embeddings
    const countCheck = await tenantPool.query(
      `SELECT COUNT(*) as cnt FROM public.loan_outcome_embeddings`,
    );
    const embeddingCount = parseInt(countCheck.rows[0]?.cnt || "0");
    if (embeddingCount === 0) {
      console.log("[RAG] No historical loan embeddings found, skipping");
      return "";
    }

    // Build a risk profile summary and embed it
    const riskProfileText = buildRiskProfileText(signals, metrics);
    const embedResult = await generateEmbeddings(
      [riskProfileText],
      LOAN_RAG_EMBEDDING_MODEL,
    );
    if (!embedResult || embedResult.length === 0) {
      console.warn("[RAG] Failed to generate embedding for risk profile");
      return "";
    }

    const queryEmbedding = embedResult[0].embedding;

    // Search for similar historical loans (top 30)
    const similarLoans = await searchSimilarHistorical(
      tenantId,
      queryEmbedding,
      30,
      tenantPool,
    );

    if (similarLoans.length === 0) {
      console.log("[RAG] No similar historical loans found");
      return "";
    }

    // Aggregate outcomes
    const outcomes = { originate: 0, withdraw: 0, deny: 0 };
    let totalSimilarity = 0;
    for (const loan of similarLoans) {
      outcomes[loan.outcome] = (outcomes[loan.outcome] || 0) + 1;
      totalSimilarity += loan.similarity;
    }
    const avgSimilarity = totalSimilarity / similarLoans.length;

    const total = similarLoans.length;
    const originateRate = ((outcomes.originate / total) * 100).toFixed(1);
    const withdrawRate = ((outcomes.withdraw / total) * 100).toFixed(1);
    const denyRate = ((outcomes.deny / total) * 100).toFixed(1);

    const context = [
      "HISTORICAL PATTERN CONTEXT (from RAG similarity search on loan outcome embeddings):",
      `Searched ${embeddingCount} historical loans. Found ${total} with similar risk profiles (avg similarity: ${(avgSimilarity * 100).toFixed(1)}%).`,
      `Outcome distribution of similar historical loans:`,
      `  - Originated: ${outcomes.originate} (${originateRate}%)`,
      `  - Withdrew: ${outcomes.withdraw} (${withdrawRate}%)`,
      `  - Denied: ${outcomes.deny} (${denyRate}%)`,
      ``,
      `Use this to contextualize current predictions. If historical withdraw rate is high among similar loans, that pattern is likely to repeat.`,
      `Do NOT fabricate historical dates or periods — only reference the pattern distribution above.`,
    ].join("\n");

    console.log(
      `[RAG] Historical pattern context: ${total} similar loans (${originateRate}% originated, ${withdrawRate}% withdrew, ${denyRate}% denied)`,
    );
    return context;
  } catch (err: any) {
    console.warn(
      `[RAG] Historical pattern context failed (non-fatal): ${err.message}`,
    );
    return "";
  }
}

/**
 * Fetch knowledge base context by semantically searching rag_embeddings
 * using the top signals as queries.
 *
 * Uses text-embedding-3-large (3072 dims) to match rag_embeddings storage.
 * Graceful: returns empty string on any failure.
 */
export async function fetchKnowledgeContextForInsights(
  tenantPool: pg.Pool,
  tenantId: string,
  signals: Signal[],
): Promise<string> {
  try {
    // Check if rag_embeddings table exists
    const tableCheck = await tenantPool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'rag_embeddings'
      ) as exists
    `);
    if (!tableCheck.rows[0]?.exists) {
      console.log(
        "[RAG] rag_embeddings table does not exist, skipping knowledge context",
      );
      return "";
    }

    // Check if there are any documents
    const countCheck = await tenantPool.query(
      `SELECT COUNT(*) as cnt FROM public.rag_embeddings`,
    );
    if (parseInt(countCheck.rows[0]?.cnt || "0") === 0) {
      console.log("[RAG] No knowledge base embeddings found, skipping");
      return "";
    }

    // Take the top 5-6 most severe signals and construct query texts
    const topSignals = signals
      .filter((s) => s.direction === "critical" || s.direction === "negative")
      .slice(0, 6);

    if (topSignals.length === 0) {
      // No critical/negative signals — try positive ones for context
      const altSignals = signals.slice(0, 4);
      if (altSignals.length === 0) return "";
      topSignals.push(...altSignals);
    }

    // Build natural language queries from the signals
    const queryTexts = topSignals.map((s) =>
      `${s.metric}: ${s.value}. ${s.context || ""} Area: ${s.area}, Direction: ${s.direction}`.trim(),
    );

    // Embed all queries in one batch using the same model as rag_embeddings (3072 dims)
    const embedResults = await generateEmbeddings(
      queryTexts,
      "openai/text-embedding-3-large",
    );

    if (!embedResults || embedResults.length === 0) {
      console.warn("[RAG] Failed to generate embeddings for knowledge queries");
      return "";
    }

    // Search rag_embeddings for each query (top 3 per query)
    const allChunks: Array<{ text: string; score: number; source: string }> =
      [];
    const seenTexts = new Set<string>();

    for (let i = 0; i < embedResults.length; i++) {
      const emb = embedResults[i].embedding;
      const embStr = `[${emb.join(",")}]`;

      try {
        const result = await tenantPool.query(
          `SELECT
            e.chunk_text,
            d.title,
            d.filename,
            1 - (e.embedding <=> $1::vector) as similarity
          FROM rag_embeddings e
          JOIN rag_documents d ON e.document_id = d.id
          WHERE d.status = 'indexed'
            AND 1 - (e.embedding <=> $1::vector) >= 0.3
          ORDER BY e.embedding <=> $1::vector
          LIMIT 3`,
          [embStr],
        );

        for (const row of result.rows) {
          const text = row.chunk_text?.trim();
          if (!text || seenTexts.has(text)) continue;
          seenTexts.add(text);
          allChunks.push({
            text,
            score: parseFloat(row.similarity),
            source: row.title || row.filename || "Unknown",
          });
        }
      } catch (queryErr: any) {
        console.warn(`[RAG] Knowledge query ${i} failed: ${queryErr.message}`);
      }
    }

    if (allChunks.length === 0) {
      console.log("[RAG] No relevant knowledge base chunks found");
      return "";
    }

    // Sort by score, take top 8
    allChunks.sort((a, b) => b.score - a.score);
    const topChunks = allChunks.slice(0, 8);

    const contextParts = [
      "COMPANY KNOWLEDGE CONTEXT (from knowledge base RAG search):",
      "The following excerpts from company documents may be relevant to the current metrics.",
      "Reference specific sources when they explain observed metric changes.",
      "",
    ];

    for (let i = 0; i < topChunks.length; i++) {
      const c = topChunks[i];
      contextParts.push(
        `[Source: ${c.source}] (relevance: ${(c.score * 100).toFixed(0)}%)`,
      );
      contextParts.push(c.text);
      contextParts.push("");
    }

    console.log(
      `[RAG] Knowledge context: ${topChunks.length} chunks from ${new Set(topChunks.map((c) => c.source)).size} sources`,
    );
    return contextParts.join("\n");
  } catch (err: any) {
    console.warn(`[RAG] Knowledge context failed (non-fatal): ${err.message}`);
    return "";
  }
}

export default {
  collectInsightMetrics,
  computeSignals,
  formatSignalsForPrompt,
  fetchHistoricalPatternContext,
  fetchKnowledgeContextForInsights,
};
