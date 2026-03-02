/**
 * Scorecard API Routes
 * Consolidated endpoints for Sales and Operations Scorecards
 *
 * Migrated from /api/loans/* to /api/scorecard/*
 * Old endpoints remain as aliases for backward compatibility
 */

import { Router } from "express";
import {
  pool,
  retryQuery,
  handleDatabaseError,
} from "../../config/database.js";
import { authenticateToken, AuthRequest } from "../../middleware/auth.js";
import {
  attachTenantContext,
  getTenantContext,
} from "../../middleware/tenantContext.js";
import { apiLimiter } from "../../middleware/rateLimiter.js";
import { logError, logWarn, logInfo, logDebug } from "../../services/logger.js";
import { getLoanAccessContext } from "../../services/userLoanAccessService.js";
import {
  isActorMissing,
  filterByChannel,
  buildChannelWhereClause,
  buildActorNotMissingClause,
  calcLoanRevenue,
  calcLoanComplexity,
  parseComplexityConfigV2,
  DEFAULT_COMPLEXITY_WEIGHTS,
  getVMaxDate,
  formatDateForSQL,
  formatMonthKey,
  assignTTSTier,
  assignTTSTierByPercentile,
  assignTiersByCumulativeValue,
  getActorColumnForChannel,
  getActorLabelForChannel,
  isTPOChannel,
  OPERATIONS_ACTOR_CONFIGS,
  SALES_ACTOR_CONFIGS,
  REVENUE_SQL_EXPRESSION,
  getTenantRevenueExpression,
  TTS_TIER_THRESHOLDS,
  TTS_TIER_PERCENTILES,
  OPS_TTS_WEIGHTS,
  SALES_TTS_WEIGHTS,
  type ActorConfig,
  buildDimensionFilterWhereClause,
  type ActorMissingMode,
  type TTSTier,
  type ComplexityConfig,
  type ComplexityConfigV2,
} from "../../utils/scorecard-utils.js";
import { getOperationsScorecardTrends } from "../../services/scorecard/operationsScorecardTrendsService.js";
import {
  getSalesScorecardOverview,
  getSalesScorecardOverviewBranches,
  getSalesScorecardOverviewLoanOfficers,
  type SalesScorecardOverviewMeasure,
  type SalesScorecardOverviewTimePeriod,
} from "../../services/dashboard/salesScorecardOverviewService.js";

const router = Router();

// =============================================================================
// HELPER: Load Complexity Configuration from Database
// =============================================================================

/**
 * Load loan complexity config from the complexity_components table (V2 with range_min/range_max).
 * Falls back to default legacy weights if no configuration exists.
 */
async function loadComplexityConfig(
  tenantPool: any
): Promise<ComplexityConfigV2 | ComplexityConfig> {
  try {
    const result = await tenantPool.query(`
      SELECT component_name, condition_value, weight, range_min, range_max
      FROM public.complexity_components
      WHERE is_active = true
      ORDER BY component_name, COALESCE(range_min, 0), condition_value
    `);

    if (result.rows.length === 0) {
      logDebug("[Scorecard] No complexity config found, using defaults");
      return DEFAULT_COMPLEXITY_WEIGHTS;
    }

    const config = parseComplexityConfigV2(result.rows);
    logDebug("[Scorecard] Loaded complexity config V2", {
      rowCount: result.rows.length,
    });
    return config;
  } catch (error) {
    logWarn("[Scorecard] Failed to load complexity config, using defaults", {
      error,
    });
    return DEFAULT_COMPLEXITY_WEIGHTS;
  }
}

// =============================================================================
// HELPER: Load Scoring Weights from Database
// =============================================================================

interface SalesWeightConfig {
  volume: number;
  margin: number;
  unit: number;
  pullThrough: number;
  turnTime: number;
  concession: number;
}

interface OpsWeightConfig {
  units: number;
  turnTime: number;
  complexity: number;
}

/**
 * Load sales scorecard weights from the scoring_weights table.
 * Falls back to default weights if no configuration exists.
 */
async function loadSalesWeights(tenantPool: any): Promise<SalesWeightConfig> {
  try {
    const result = await tenantPool.query(`
      SELECT metric_name, weight
      FROM public.scoring_weights
      WHERE scorecard_type = 'sales' AND is_active = true AND persona_id IS NULL
    `);

    if (result.rows.length === 0) {
      logDebug("[Scorecard] No sales weights found, using defaults");
      return { ...SALES_TTS_WEIGHTS };
    }

    // Build config from database rows
    const config: SalesWeightConfig = { ...SALES_TTS_WEIGHTS };
    for (const row of result.rows) {
      const metricMap: Record<string, keyof SalesWeightConfig> = {
        volume: "volume",
        margin: "margin",
        unit: "unit",
        pull_through: "pullThrough",
        turn_time: "turnTime",
        concession: "concession",
      };
      const key = metricMap[row.metric_name];
      if (key) {
        config[key] = parseFloat(row.weight);
      }
    }

    logDebug("[Scorecard] Loaded sales weights from database", { config });
    return config;
  } catch (error) {
    logWarn("[Scorecard] Failed to load sales weights, using defaults", {
      error,
    });
    return { ...SALES_TTS_WEIGHTS };
  }
}

/**
 * Load operations scorecard weights from the scoring_weights table.
 * Falls back to default weights if no configuration exists.
 */
async function loadOpsWeights(tenantPool: any): Promise<OpsWeightConfig> {
  try {
    const result = await tenantPool.query(`
      SELECT metric_name, weight
      FROM public.scoring_weights
      WHERE scorecard_type = 'operations' AND is_active = true AND persona_id IS NULL
    `);

    if (result.rows.length === 0) {
      logDebug("[Scorecard] No operations weights found, using defaults");
      return { ...OPS_TTS_WEIGHTS };
    }

    // Build config from database rows
    const config: OpsWeightConfig = { ...OPS_TTS_WEIGHTS };
    for (const row of result.rows) {
      const metricMap: Record<string, keyof OpsWeightConfig> = {
        units: "units",
        turn_time: "turnTime",
        complexity: "complexity",
      };
      const key = metricMap[row.metric_name];
      if (key) {
        config[key] = parseFloat(row.weight);
      }
    }

    logDebug("[Scorecard] Loaded operations weights from database", { config });
    return config;
  } catch (error) {
    logWarn("[Scorecard] Failed to load operations weights, using defaults", {
      error,
    });
    return { ...OPS_TTS_WEIGHTS };
  }
}

// =============================================================================
// SALES SCORECARD - GET /api/scorecard/sales
// =============================================================================
// Migrated from: /api/loans/sales-scorecard
// Documentation: See docs/TTS_FORMULA_FINDINGS.md for TTS calculation details
// =============================================================================

/**
 * GET /api/scorecard/sales
 * Get Sales Scorecard TTS data for Loan Officers or Branches
 *
 * TTS Formula (Sales - 6 components):
 * TTS = (VolumeRating × 2 + MarginRating × 2 + TurnTimeRating × 0.5 +
 *        PullThroughRating × 1.5 + UnitRating × 2 + ConcessionRating × 2) / 10
 *
 * Rolling 13 months from vMaxDate (max last_modified_date in data)
 *
 * Query Parameters:
 * - actor: 'branch' | 'loan_officer' (default: 'loan_officer')
 * - startDate: ISO date string (default: 13 months ago)
 * - endDate: ISO date string (default: today)
 * - channel_group: Optional channel filter (e.g., 'Retail')
 */
router.get(
  "/sales",
  authenticateToken,
  attachTenantContext,
  apiLimiter,
  async (req: AuthRequest, res) => {
    try {
      const tenantPool = getTenantContext(req).tenantPool;

      // Get tenant-specific revenue expression (or default if none configured)
      const revenueExpression = await getTenantRevenueExpression(tenantPool);

      // Get tenant-specific complexity weights (or defaults)
      const complexityConfig = await loadComplexityConfig(tenantPool);

      // Get user's loan access context
      const accessCtx = await getLoanAccessContext(req, tenantPool);

      // If user has no access, return empty scorecard
      if (accessCtx.hasNoAccess) {
        return res.json({
          actor: req.query.actor || "loan_officer",
          dateRange: { start: "", end: "" },
          data: [],
          summary: { actorCount: 0, avgTTS: 0, medianTTS: 0, totalVolume: 0 },
        });
      }

      const actor = (req.query.actor as string) || "loan_officer";
      const startDate = req.query.startDate as string | undefined;
      const endDate = req.query.endDate as string | undefined;
      const channelGroup = req.query.channel_group as string | undefined;

      // Validate actor type
      if (!["branch", "loan_officer"].includes(actor)) {
        return res.status(400).json({
          error: 'Invalid actor type. Must be "branch" or "loan_officer"',
        });
      }

      // For TPO channels, use account_executive instead of loan_officer
      // Branch remains the same regardless of channel
      const actorColumn =
        actor === "branch" ? "branch" : getActorColumnForChannel(channelGroup);

      // Label for display purposes
      const actorLabel =
        actor === "branch" ? "Branch" : getActorLabelForChannel(channelGroup);

      // Get vMaxDate from data (matching Qlik's Max("Last Modified Date"))
      const vMaxDate = await getVMaxDate(tenantPool);

      // Use client-supplied date range when provided, otherwise default to
      // rolling 13-month window from vMaxDate (Qlik standard for TTS)
      let effectiveStartDate: Date;
      let effectiveEndDate: Date;

      if (startDate && endDate) {
        effectiveStartDate = new Date(startDate);
        effectiveEndDate = new Date(endDate);
        // Sanity-check: if parsed dates are invalid, fall back to defaults
        if (isNaN(effectiveStartDate.getTime()) || isNaN(effectiveEndDate.getTime())) {
          logWarn("[Scorecard/Sales] Invalid startDate/endDate params, falling back to default 13-month window", { startDate, endDate });
          effectiveEndDate = vMaxDate;
          effectiveStartDate = new Date(vMaxDate.getFullYear(), vMaxDate.getMonth() - 12, 1);
        }
      } else {
        // Default: Rolling 13 months from vMaxDate
        effectiveEndDate = vMaxDate;
        effectiveStartDate = new Date(vMaxDate.getFullYear(), vMaxDate.getMonth() - 12, 1);
      }

      // Calculate months in the date range for per-month averages
      const monthsInRange = Math.max(
        1,
        (effectiveEndDate.getFullYear() - effectiveStartDate.getFullYear()) * 12 +
          effectiveEndDate.getMonth() -
          effectiveStartDate.getMonth() +
          1
      );

      logInfo("[Scorecard/Sales] Start", {
        actor,
        channel: channelGroup,
        hasAccessFilter: accessCtx.requiresFiltering,
        monthsInRange,
      });

      // TTS Weight Configuration - load from database or use defaults
      const weightConfig = await loadSalesWeights(tenantPool);

      // SQL filtering setup
      const channelClause = buildChannelWhereClause(channelGroup);
      const dimensionFilterClause = buildDimensionFilterWhereClause(req.query as Record<string, any>, '', new Set(['channel_group', 'tenant_id']));
      const startDateStr = formatDateForSQL(effectiveStartDate);
      const endDateStr = formatDateForSQL(effectiveEndDate);

      // Build access filter clause
      const { accessClause, accessParams } = accessCtx.buildWhereClause("", 3); // Params start at $3 (after $1, $2 for dates)
      const accessFilterClause = accessClause
        ? accessClause.replace(/^AND\s+/, "AND ")
        : "";

      // Build query params - access filter params come after date params
      const fundedQueryParams = accessCtx.requiresFiltering
        ? [startDateStr, endDateStr, accessCtx.userId]
        : [startDateStr, endDateStr];

      const accessWhereClause = accessCtx.requiresFiltering
        ? `AND guid IN (SELECT loan_guid FROM user_loan_access WHERE user_id = $3)`
        : "";

      // Fetch FUNDED loans with tenant-specific revenue calculation (main data for scorecard - DateType={'Funding'})
      const fundedLoansResult = await retryQuery(
        () =>
          tenantPool.query(
            `SELECT 
          loan_id, loan_amount, loan_type, loan_purpose, current_loan_status, channel,
          funding_date, closing_date, application_date, started_date,
          branch, loan_officer, fico_score, ltv_ratio, be_dti_ratio,
          origination_points, orig_fee_borr_pd, orig_fees_seller, cd_lender_credits,
          branch_price_concession, occupancy_type, borr_self_employed,
          rate_lock_buy_side_base_price_rate,
          number_of_conditions, date_warehoused, investor_status, investor_purchase_date,
          (${revenueExpression}) AS revenue
         FROM loans
         WHERE funding_date IS NOT NULL
           AND funding_date >= $1
           AND funding_date <= $2
           AND ${actorColumn} IS NOT NULL
           AND TRIM(${actorColumn}) != ''
           AND UPPER(TRIM(${actorColumn})) NOT IN ('99-MISSING', 'MISSING', 'NO LO FOUND', 'NO LOAN OFFICER', 'NO BRANCH FOUND', 'UNKNOWN')
           AND UPPER(TRIM(${actorColumn})) NOT LIKE '99-%'
           ${accessWhereClause}
           ${channelClause}
           ${dimensionFilterClause}`,
            fundedQueryParams
          ),
        2,
        500
      );
      const fundedLoans = fundedLoansResult.rows;

      // Fetch supporting loans with tenant-specific revenue (for pull-through and lost opportunity calculation - DateType={'Application'})
      const supportingLoansResult = await retryQuery(
        () =>
          tenantPool.query(
            `SELECT 
          loan_id, loan_amount, loan_type, loan_purpose, current_loan_status, channel,
          funding_date, closing_date, application_date, started_date,
          branch, loan_officer, fico_score, ltv_ratio, be_dti_ratio,
          origination_points, orig_fee_borr_pd, orig_fees_seller, cd_lender_credits,
          rate_lock_buy_side_base_price_rate,
          (${revenueExpression}) AS revenue
         FROM loans
         WHERE COALESCE(started_date, application_date) >= $1
           AND COALESCE(started_date, application_date) <= $2
           ${accessWhereClause}
           ${channelClause}
           ${dimensionFilterClause}`,
            fundedQueryParams
          ),
        2,
        500
      );
      const channelFilteredLoans = supportingLoansResult.rows;

      logInfo("[Scorecard/Sales] Data loaded", {
        funded: fundedLoans.length,
        supporting: channelFilteredLoans.length,
      });

      // Calculate pull-through data
      const actorApplicationCount = new Map<string, number>();
      const actorFundedCount = new Map<string, number>();

      channelFilteredLoans.forEach((l: any) => {
        const actorName = l[actorColumn];
        if (isActorMissing(actorName)) return;

        const appDate = l.application_date;
        if (!appDate) return;
        const ad = new Date(appDate);
        if (ad < effectiveStartDate || ad > effectiveEndDate) return;

        const status = (l.current_loan_status || "").toUpperCase().trim();
        const isActiveLoan = status === "ACTIVE LOAN";
        if (isActiveLoan) return; // Skip active loans for pull-through

        actorApplicationCount.set(
          actorName,
          (actorApplicationCount.get(actorName) || 0) + 1
        );

        // Originated = status-based (Qlik Pull Through Originated Flag)
        const statusUpper = status;
        if (statusUpper.includes("ORIGINATED") || statusUpper.includes("PURCHASED")) {
          actorFundedCount.set(
            actorName,
            (actorFundedCount.get(actorName) || 0) + 1
          );
        }
      });

      // Aggregate metrics by actor
      interface ActorMetrics {
        name: string;
        units: number;
        volume: number;
        revenue: number;
        marginBpsValues: number[];
        concessions: number[];
        turnTimes: number[];
        complexityScores: number[];
        applicationCount: number;
        fundedForPullThrough: number;
        lostOpportunityUnits: number;
        lostOpportunityRevenue: number;
        deniedUnits: number;
        ficoWeighted: { sum: number; weight: number };
        ltvWeighted: { sum: number; weight: number };
        dtiWeighted: { sum: number; weight: number };
        whDaysWeighted: { sum: number; weight: number };
        conditionsValues: number[];
      }

      const actorMap = new Map<string, ActorMetrics>();

      fundedLoans.forEach((l: any) => {
        const actorName = l[actorColumn];
        if (isActorMissing(actorName)) return;

        const existing = actorMap.get(actorName) || {
          name: actorName,
          units: 0,
          volume: 0,
          revenue: 0,
          marginBpsValues: [],
          concessions: [],
          turnTimes: [],
          complexityScores: [],
          applicationCount: actorApplicationCount.get(actorName) || 0,
          fundedForPullThrough: actorFundedCount.get(actorName) || 0,
          lostOpportunityUnits: 0,
          lostOpportunityRevenue: 0,
          deniedUnits: 0,
          ficoWeighted: { sum: 0, weight: 0 },
          ltvWeighted: { sum: 0, weight: 0 },
          dtiWeighted: { sum: 0, weight: 0 },
          whDaysWeighted: { sum: 0, weight: 0 },
          conditionsValues: [],
        };

        const loanAmount = parseFloat(l.loan_amount) || 0;
        existing.units += 1;
        existing.volume += loanAmount;

        const revenue = parseFloat(l.revenue) || 0; // Uses tenant-specific formula from SQL
        existing.revenue += revenue;

        if (loanAmount > 0) {
          const marginBps = (revenue / loanAmount) * 10000;
          existing.marginBpsValues.push(marginBps);
        }

        // Concession (price concession)
        const concession = parseFloat(l.branch_price_concession) || 0;
        if (concession !== 0) {
          existing.concessions.push(concession);
        }

        // Turn time (App-Close)
        if (l.application_date && l.closing_date) {
          const diffMs =
            new Date(l.closing_date).getTime() -
            new Date(l.application_date).getTime();
          const days = Math.round(diffMs / (1000 * 60 * 60 * 24));
          if (days > 0) {
            existing.turnTimes.push(days);
          }
        }

        // Loan complexity (using tenant-configurable weights)
        existing.complexityScores.push(calcLoanComplexity(l, complexityConfig));

        // Weighted averages (FICO, LTV, DTI)
        const fico = parseFloat(l.fico_score) || 0;
        if (fico >= 350 && fico <= 900) {
          existing.ficoWeighted.sum += fico * loanAmount;
          existing.ficoWeighted.weight += loanAmount;
        }

        const ltv = parseFloat(l.ltv_ratio) || 0;
        if (ltv >= 0 && ltv <= 110) {
          existing.ltvWeighted.sum += ltv * loanAmount;
          existing.ltvWeighted.weight += loanAmount;
        }

        const dti = parseFloat(l.be_dti_ratio) || 0;
        if (dti >= 0 && dti <= 70) {
          existing.dtiWeighted.sum += dti * loanAmount;
          existing.dtiWeighted.weight += loanAmount;
        }

        // Warehouse holding days (Qlik: W-H Days, volume-weighted)
        // If investor purchased: purchase_date - funding_date
        // If not yet purchased (and not brokered): use effectiveEndDate - funding_date
        const investorStatus = (l.investor_status || "").toUpperCase();
        if (investorStatus !== "PURCHASED" && l.funding_date && loanAmount > 0) {
          let whDays = 0;
          if (l.investor_purchase_date) {
            const diffMs =
              new Date(l.investor_purchase_date).getTime() -
              new Date(l.funding_date).getTime();
            whDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
          } else {
            // Not yet purchased: days from funding to end of period
            const diffMs =
              effectiveEndDate.getTime() -
              new Date(l.funding_date).getTime();
            whDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
          }
          if (whDays >= 0) {
            existing.whDaysWeighted.sum += whDays * loanAmount;
            existing.whDaysWeighted.weight += loanAmount;
          }
        }

        // Number of conditions
        const conditions = parseFloat(l.number_of_conditions) || 0;
        if (conditions > 0) {
          existing.conditionsValues.push(conditions);
        }

        actorMap.set(actorName, existing);
      });

      // Count lost opportunities and denied loans
      channelFilteredLoans.forEach((l: any) => {
        const actorName = l[actorColumn];
        if (!actorMap.has(actorName)) return;

        const status = (l.current_loan_status || "").toUpperCase();
        const appDate = l.application_date;
        if (!appDate) return;
        const ad = new Date(appDate);
        if (ad < effectiveStartDate || ad > effectiveEndDate) return;

        const existing = actorMap.get(actorName)!;

        // Lost opportunity (withdrawn, not accepted, incomplete)
        if (
          status.includes("WITHDRAWN") ||
          status.includes("CANCELLED") ||
          status.includes("NOT ACCEPTED") ||
          status.includes("INCOMPLETE")
        ) {
          existing.lostOpportunityUnits += 1;
          existing.lostOpportunityRevenue += parseFloat(l.revenue) || 0; // Uses tenant-specific formula from SQL
        }

        // Denied
        if (status.includes("DENIED") || status.includes("DECLINED")) {
          existing.deniedUnits += 1;
        }
      });

      // Calculate company-wide averages for rating normalization
      const allMetrics = Array.from(actorMap.values()).filter(
        (a) => a.units > 0
      );

      const totalUnits = allMetrics.reduce((sum, a) => sum + a.units, 0);
      const totalVolume = allMetrics.reduce((sum, a) => sum + a.volume, 0);
      const totalRevenue = allMetrics.reduce((sum, a) => sum + a.revenue, 0);

      const avgUnits =
        allMetrics.length > 0 ? totalUnits / allMetrics.length : 0;
      const avgVolume =
        allMetrics.length > 0 ? totalVolume / allMetrics.length : 0;
      const avgRevenue =
        allMetrics.length > 0 ? totalRevenue / allMetrics.length : 0;
      const avgMarginBps =
        totalVolume > 0 ? (totalRevenue / totalVolume) * 10000 : 0;

      // Turn time average
      const allTurnTimes = allMetrics.flatMap((a) => a.turnTimes);
      const companyAvgTurnTime =
        allTurnTimes.length > 0
          ? allTurnTimes.reduce((a, b) => a + b, 0) / allTurnTimes.length
          : 0;

      // Pull through average
      const totalAppCount = allMetrics.reduce(
        (sum, a) => sum + a.applicationCount,
        0
      );
      const totalFundedForPT = allMetrics.reduce(
        (sum, a) => sum + a.fundedForPullThrough,
        0
      );
      const companyPullThrough =
        totalAppCount > 0 ? (totalFundedForPT / totalAppCount) * 100 : 0;

      // Concession average
      const allConcessions = allMetrics.flatMap((a) => a.concessions);
      const companyAvgConcession =
        allConcessions.length > 0
          ? allConcessions.reduce((a, b) => a + b, 0) / allConcessions.length
          : 0;

      const companyAverages = {
        units: avgUnits,
        volume: avgVolume,
        revenue: avgRevenue,
        marginBps: avgMarginBps,
        turnTime: companyAvgTurnTime,
        pullThrough: companyPullThrough,
        concession: companyAvgConcession,
      };

      // Helper to convert NaN to 0 (NaN becomes null in JSON which breaks the frontend)
      const safeNum = (n: number): number => (isNaN(n) || !isFinite(n) ? 0 : n);

      // Calculate TTS scores for each actor
      const actorsWithScores = allMetrics
        .map((actor) => {
          // Ensure revenue is a valid number (guard against NaN from bad data)
          const safeRevenue = safeNum(actor.revenue);

          // Individual metrics
          const actorMarginBps =
            actor.volume > 0 ? (safeRevenue / actor.volume) * 10000 : 0;
          const actorAvgTurnTime =
            actor.turnTimes.length > 0
              ? actor.turnTimes.reduce((a, b) => a + b, 0) /
                actor.turnTimes.length
              : 0;
          const actorPullThrough =
            actor.applicationCount > 0
              ? (actor.fundedForPullThrough / actor.applicationCount) * 100
              : 0;
          const actorAvgConcession =
            actor.concessions.length > 0
              ? actor.concessions.reduce((a, b) => a + b, 0) /
                actor.concessions.length
              : 0;
          const actorAvgComplexity =
            actor.complexityScores.length > 0
              ? actor.complexityScores.reduce((a, b) => a + b, 0) /
                actor.complexityScores.length
              : 100;

          // Calculate ratings (actor / company avg * 100)
          const volumeRating =
            avgVolume > 0 ? (actor.volume / avgVolume) * 100 : 100;
          const marginRating =
            avgMarginBps > 0 ? (actorMarginBps / avgMarginBps) * 100 : 100;
          const unitRating =
            avgUnits > 0 ? (actor.units / avgUnits) * 100 : 100;

          // Turn time: LOWER is BETTER (inverted)
          const turnTimeRating =
            actorAvgTurnTime > 0 && companyAvgTurnTime > 0
              ? (companyAvgTurnTime / actorAvgTurnTime) * 100
              : 100;

          // Pull through rating
          const pullThroughRating =
            companyPullThrough > 0
              ? (actorPullThrough / companyPullThrough) * 100
              : 100;

          // Concession rating: LOWER concession is BETTER (inverted)
          const concessionRating =
            actorAvgConcession !== 0 && companyAvgConcession !== 0
              ? (companyAvgConcession / actorAvgConcession) * 100
              : 100;

          // TTS Score calculation (6 components)
          // Sum of weights = 0.2 * 6 = 1.2
          // Divide by 1.2 so average performer (all ratings = 100) scores 100
          const weightSum =
            weightConfig.volume +
            weightConfig.margin +
            weightConfig.turnTime +
            weightConfig.pullThrough +
            weightConfig.unit +
            weightConfig.concession;
          const ttsScore =
            (volumeRating * weightConfig.volume +
              marginRating * weightConfig.margin +
              turnTimeRating * weightConfig.turnTime +
              pullThroughRating * weightConfig.pullThrough +
              unitRating * weightConfig.unit +
              concessionRating * weightConfig.concession) /
            weightSum;

          // Weighted averages
          const waFico =
            actor.ficoWeighted.weight > 0
              ? actor.ficoWeighted.sum / actor.ficoWeighted.weight
              : 0;
          const waLtv =
            actor.ltvWeighted.weight > 0
              ? actor.ltvWeighted.sum / actor.ltvWeighted.weight
              : 0;
          const waDti =
            actor.dtiWeighted.weight > 0
              ? actor.dtiWeighted.sum / actor.dtiWeighted.weight
              : 0;
          const waWhDays =
            actor.whDaysWeighted.weight > 0
              ? actor.whDaysWeighted.sum / actor.whDaysWeighted.weight
              : 0;
          const avgConditions =
            actor.conditionsValues.length > 0
              ? actor.conditionsValues.reduce((a, b) => a + b, 0) /
                actor.conditionsValues.length
              : 0;

          return {
            name: actor.name,
            units: safeNum(actor.units),
            volume: safeNum(actor.volume),
            revenue: safeRevenue,
            revenueBps: safeNum(actorMarginBps),
            avgTurnTime: safeNum(actorAvgTurnTime),
            pullThrough: safeNum(actorPullThrough),
            avgConcession: safeNum(actorAvgConcession),
            avgComplexity: safeNum(actorAvgComplexity),
            waFico: safeNum(waFico),
            waLtv: safeNum(waLtv),
            waDti: safeNum(waDti),
            waWhDays: safeNum(waWhDays),
            avgConditions: safeNum(avgConditions),
            lostOpportunityUnits: safeNum(actor.lostOpportunityUnits),
            lostOpportunityRevenue: safeNum(actor.lostOpportunityRevenue),
            deniedUnits: safeNum(actor.deniedUnits),
            // Ratings
            volumeRating: safeNum(volumeRating),
            marginRating: safeNum(marginRating),
            unitRating: safeNum(unitRating),
            turnTimeRating: safeNum(turnTimeRating),
            pullThroughRating: safeNum(pullThroughRating),
            concessionRating: safeNum(concessionRating),
            ttsScore: safeNum(ttsScore),
            tier: "bottom" as TTSTier, // Placeholder, will be assigned after sorting
          };
        })
        .sort((a, b) => b.ttsScore - a.ttsScore);

      // Assign tiers based on percentile distribution (20/30/50 Pareto rule)
      // Top 20% of actors by count → "top"
      // Next 30% (20-50%) → "second"
      // Remaining 50% → "bottom"
      const actorsWithScoresAndTiers = actorsWithScores.map((actor, index) => ({
        ...actor,
        tier: assignTTSTierByPercentile(actorsWithScores.length, index),
      }));

      // Use the actors with proper tiers for subsequent calculations
      const actorsWithTiers = actorsWithScoresAndTiers;

      // Calculate tier summaries
      const topActors = actorsWithTiers.filter((a) => a.tier === "top");
      const secondActors = actorsWithTiers.filter((a) => a.tier === "second");
      const bottomActors = actorsWithTiers.filter((a) => a.tier === "bottom");

      // Compute all 28 tier summary fields matching frontend TTSTierSummary interface
      const calcTierSummary = (actors: typeof actorsWithTiers) => {
        const emptyTierSummary = {
          count: 0,
          units: 0,
          unitsPercent: 0,
          volume: 0,
          volumePercent: 0,
          revenue: 0,
          revenueBps: 0,
          avgTurnTime: 0,
          pullThrough: 0,
          waFico: 0,
          waLtv: 0,
          waDti: 0,
          waWhDays: 0,
          avgConditions: 0,
          lostOpportunityUnits: 0,
          lostOpportunityUnitsPercent: 0,
          lostOpportunityRevenue: 0,
          deniedUnits: 0,
          deniedUnitsPercent: 0,
          deniedRevenue: 0,
          lostOpportunityAndDeniedRevenue: 0,
          lostOpportunityAndDeniedRevenueBps: 0,
          avgLoRevenue: 0,
          avgLoUnits: 0,
          avgLoUnitsPerMonth: 0,
          avgLoVolume: 0,
          avgLoVolumePerMonth: 0,
          avgTtsScore: 0,
          loanComplexityScore: 0,
        };

        if (actors.length === 0) return emptyTierSummary;

        // Core aggregates
        const tierUnits = actors.reduce((sum, a) => sum + a.units, 0);
        const tierVolume = actors.reduce((sum, a) => sum + a.volume, 0);
        const tierRevenue = actors.reduce((sum, a) => sum + a.revenue, 0);

        // Lost opportunity / denied aggregates
        const tierLostOppUnits = actors.reduce(
          (sum, a) => sum + a.lostOpportunityUnits,
          0
        );
        const tierLostOppRevenue = actors.reduce(
          (sum, a) => sum + a.lostOpportunityRevenue,
          0
        );
        const tierDeniedUnits = actors.reduce(
          (sum, a) => sum + a.deniedUnits,
          0
        );
        // Approximate total applications as funded + lost + denied
        const tierTotalApps = tierUnits + tierLostOppUnits + tierDeniedUnits;

        // Weighted averages (weighted by volume since actor values are volume-weighted)
        const tierWaFico =
          tierVolume > 0
            ? actors.reduce((sum, a) => sum + a.waFico * a.volume, 0) /
              tierVolume
            : 0;
        const tierWaLtv =
          tierVolume > 0
            ? actors.reduce((sum, a) => sum + a.waLtv * a.volume, 0) /
              tierVolume
            : 0;
        const tierWaDti =
          tierVolume > 0
            ? actors.reduce((sum, a) => sum + a.waDti * a.volume, 0) /
              tierVolume
            : 0;

        // Complexity (weighted by units)
        const complexityWeighted = actors.reduce(
          (sum, a) => sum + a.avgComplexity * a.units,
          0
        );
        const avgComplexity =
          tierUnits > 0 ? complexityWeighted / tierUnits : 0;

        return {
          count: actors.length,
          units: tierUnits,
          unitsPercent:
            totalUnits > 0 ? (tierUnits / totalUnits) * 100 : 0,
          volume: tierVolume,
          volumePercent:
            totalVolume > 0 ? (tierVolume / totalVolume) * 100 : 0,
          revenue: tierRevenue,
          revenueBps:
            tierVolume > 0 ? (tierRevenue / tierVolume) * 10000 : 0,
          avgTtsScore:
            actors.reduce((sum, a) => sum + a.ttsScore, 0) / actors.length,
          avgTurnTime:
            actors.reduce((sum, a) => sum + a.avgTurnTime, 0) / actors.length,
          pullThrough:
            actors.reduce((sum, a) => sum + a.pullThrough, 0) / actors.length,
          waFico: tierWaFico,
          waLtv: tierWaLtv,
          waDti: tierWaDti,
          waWhDays:
            tierVolume > 0
              ? actors.reduce((sum, a) => sum + a.waWhDays * a.volume, 0) /
                tierVolume
              : 0,
          avgConditions:
            actors.length > 0
              ? actors.reduce((sum, a) => sum + a.avgConditions, 0) /
                actors.length
              : 0,
          lostOpportunityUnits: tierLostOppUnits,
          lostOpportunityUnitsPercent:
            tierTotalApps > 0
              ? (tierLostOppUnits / tierTotalApps) * 100
              : 0,
          lostOpportunityRevenue: tierLostOppRevenue,
          deniedUnits: tierDeniedUnits,
          deniedUnitsPercent:
            tierTotalApps > 0
              ? (tierDeniedUnits / tierTotalApps) * 100
              : 0,
          deniedRevenue: 0, // Not tracked separately at actor level
          lostOpportunityAndDeniedRevenue: tierLostOppRevenue,
          lostOpportunityAndDeniedRevenueBps:
            tierVolume > 0
              ? (tierLostOppRevenue / tierVolume) * 10000
              : 0,
          avgLoRevenue:
            actors.length > 0 ? tierRevenue / actors.length : 0,
          avgLoUnits:
            actors.length > 0 ? tierUnits / actors.length : 0,
          avgLoUnitsPerMonth:
            actors.length > 0
              ? tierUnits / actors.length / monthsInRange
              : 0,
          avgLoVolume:
            actors.length > 0 ? tierVolume / actors.length : 0,
          avgLoVolumePerMonth:
            actors.length > 0
              ? tierVolume / actors.length / monthsInRange
              : 0,
          loanComplexityScore: avgComplexity,
        };
      };

      const tierSummary = {
        top: calcTierSummary(topActors),
        second: calcTierSummary(secondActors),
        bottom: calcTierSummary(bottomActors),
      };

      // Calculate company-wide average complexity (weighted by units)
      const companyComplexityWeighted = actorsWithTiers.reduce(
        (sum, a) => sum + a.avgComplexity * a.units,
        0
      );
      const companyAvgComplexity =
        totalUnits > 0 ? companyComplexityWeighted / totalUnits : 100;

      // Company-wide aggregates for totals row
      const totalLostOppUnits = actorsWithTiers.reduce(
        (sum, a) => sum + a.lostOpportunityUnits,
        0
      );
      const totalLostOppRevenue = actorsWithTiers.reduce(
        (sum, a) => sum + a.lostOpportunityRevenue,
        0
      );
      const totalDeniedUnits = actorsWithTiers.reduce(
        (sum, a) => sum + a.deniedUnits,
        0
      );
      const totalApps = totalUnits + totalLostOppUnits + totalDeniedUnits;

      // Weighted averages across all actors (weighted by volume)
      const companyWaFico =
        totalVolume > 0
          ? actorsWithTiers.reduce(
              (sum, a) => sum + a.waFico * a.volume,
              0
            ) / totalVolume
          : 0;
      const companyWaLtv =
        totalVolume > 0
          ? actorsWithTiers.reduce(
              (sum, a) => sum + a.waLtv * a.volume,
              0
            ) / totalVolume
          : 0;
      const companyWaDti =
        totalVolume > 0
          ? actorsWithTiers.reduce(
              (sum, a) => sum + a.waDti * a.volume,
              0
            ) / totalVolume
          : 0;

      // Company totals (all 28 metrics matching frontend TotalsData interface)
      const totals = {
        actorCount: actorsWithTiers.length,
        units: totalUnits,
        volume: totalVolume,
        revenue: totalRevenue,
        revenueBps: totalVolume > 0 ? (totalRevenue / totalVolume) * 10000 : 0,
        avgTurnTime: companyAvgTurnTime,
        pullThrough: companyPullThrough,
        waFico: companyWaFico,
        waLtv: companyWaLtv,
        waDti: companyWaDti,
        waWhDays:
          totalVolume > 0
            ? actorsWithTiers.reduce(
                (sum, a) => sum + a.waWhDays * a.volume,
                0
              ) / totalVolume
            : 0,
        avgConditions:
          actorsWithTiers.length > 0
            ? actorsWithTiers.reduce(
                (sum, a) => sum + a.avgConditions,
                0
              ) / actorsWithTiers.length
            : 0,
        lostOpportunityUnits: totalLostOppUnits,
        lostOpportunityUnitsPercent:
          totalApps > 0 ? (totalLostOppUnits / totalApps) * 100 : 0,
        lostOpportunityRevenue: totalLostOppRevenue,
        deniedUnits: totalDeniedUnits,
        deniedUnitsPercent:
          totalApps > 0 ? (totalDeniedUnits / totalApps) * 100 : 0,
        deniedRevenue: 0, // Not tracked separately
        lostOpportunityAndDeniedRevenue: totalLostOppRevenue,
        lostOpportunityAndDeniedRevenueBps:
          totalVolume > 0
            ? (totalLostOppRevenue / totalVolume) * 10000
            : 0,
        avgLoRevenue:
          actorsWithTiers.length > 0
            ? totalRevenue / actorsWithTiers.length
            : 0,
        avgLoUnits:
          actorsWithTiers.length > 0
            ? totalUnits / actorsWithTiers.length
            : 0,
        avgLoUnitsPerMonth:
          actorsWithTiers.length > 0
            ? totalUnits / actorsWithTiers.length / monthsInRange
            : 0,
        avgLoVolume:
          actorsWithTiers.length > 0
            ? totalVolume / actorsWithTiers.length
            : 0,
        avgLoVolumePerMonth:
          actorsWithTiers.length > 0
            ? totalVolume / actorsWithTiers.length / monthsInRange
            : 0,
        avgTtsScore:
          actorsWithTiers.length > 0
            ? actorsWithTiers.reduce((sum, a) => sum + a.ttsScore, 0) /
              actorsWithTiers.length
            : 0,
        loanComplexityScore: companyAvgComplexity,
      };

      logInfo("[Scorecard/Sales] Complete", {
        actors: actorsWithTiers.length,
        totalUnits,
      });

      res.json({
        actors: actorsWithTiers,
        companyAverages,
        weightConfig,
        tierSummary,
        totals,
        dateRange: {
          startDate: effectiveStartDate.toISOString(),
          endDate: effectiveEndDate.toISOString(),
        },
      });
    } catch (error: any) {
      logError("Error fetching sales scorecard data", error, {
        userId: req.userId,
      });
      res.status(500).json({
        error: error.message || "Failed to fetch sales scorecard data",
      });
    }
  }
);

// =============================================================================
// OPERATIONS SCORECARD - GET /api/scorecard/operations
// =============================================================================
// Migrated from: /api/loans/operations-scorecard
// Documentation: See docs/OPERATIONS_SCORECARD_SPECIFICATION.md
// =============================================================================

/**
 * GET /api/scorecard/operations
 * Get Operations Scorecard data for Processors, Underwriters, and Closers
 *
 * TTS Formula (Operations - 3 components):
 * OPS_TTS = (UnitRating × 0.70 + TurnTimeRating × 0.15 + ComplexityRating × 0.15)
 *
 * Query Parameters:
 * - actor_type: 'processor' | 'underwriter' | 'closer' (default: 'underwriter')
 * - date_range: '3-months' | '6-months' | '12-months' (default: '3-months')
 * - channel_group: Optional channel filter
 */
router.get(
  "/operations",
  authenticateToken,
  attachTenantContext,
  apiLimiter,
  async (req: AuthRequest, res) => {
    try {
      const tenantPool = getTenantContext(req).tenantPool;

      // Get tenant-specific complexity weights (or defaults)
      const complexityConfig = await loadComplexityConfig(tenantPool);

      const actorType = (req.query.actor_type as string) || "underwriter";
      const dateRange = (req.query.date_range as string) || "3-months";
      const channelGroup = req.query.channel_group as string | undefined;
      const customStartDate = req.query.start_date as string | undefined;
      const customEndDate = req.query.end_date as string | undefined;

      // Validate actor type
      if (!["processor", "underwriter", "closer"].includes(actorType)) {
        return res.status(400).json({
          error:
            'Invalid actor_type. Must be "processor", "underwriter", or "closer"',
        });
      }

      const monthsMap: Record<string, number> = {
        "3-months": 3,
        "6-months": 6,
        "12-months": 12,
      };
      const monthsBack = monthsMap[dateRange] || 3;

      const config = OPERATIONS_ACTOR_CONFIGS[actorType];
      // TTS Weight Configuration - load from database or use defaults
      const weightConfig = await loadOpsWeights(tenantPool);

      // Get vMaxDate
      const vMaxDate = await getVMaxDate(tenantPool);

      // Use client-supplied custom date range when provided, otherwise
      // fall back to rolling N-month window from vMaxDate
      let effectiveStartDate: Date;
      let effectiveEndDate: Date;

      if (customStartDate && customEndDate) {
        effectiveStartDate = new Date(customStartDate);
        effectiveEndDate = new Date(customEndDate);
        // Sanity-check: if parsed dates are invalid, fall back to defaults
        if (isNaN(effectiveStartDate.getTime()) || isNaN(effectiveEndDate.getTime())) {
          logWarn("[Scorecard/Operations] Invalid start_date/end_date params, falling back to default", { customStartDate, customEndDate });
          effectiveEndDate = new Date(vMaxDate);
          effectiveStartDate = new Date(vMaxDate.getFullYear(), vMaxDate.getMonth() - monthsBack, 1);
        }
      } else {
        effectiveEndDate = new Date(vMaxDate);
        effectiveStartDate = new Date(vMaxDate.getFullYear(), vMaxDate.getMonth() - monthsBack, 1);
      }

      logInfo("[Scorecard/Operations] Start", {
        actorType,
        dateRange,
        channel: channelGroup,
      });

      // SQL filtering
      const channelClause = buildChannelWhereClause(channelGroup);
      const dimensionFilterClause = buildDimensionFilterWhereClause(req.query as Record<string, any>, '', new Set(['channel_group', 'tenant_id']));
      const startDateStr = formatDateForSQL(effectiveStartDate);
      const endDateStr = formatDateForSQL(effectiveEndDate);

      // Fetch loans with output date in range
      const outputLoansResult = await tenantPool.query(
        `
      SELECT 
        loan_id,
        COALESCE(loan_number, loan_id::text) as loan_number,
        loan_amount, loan_type, loan_purpose, current_loan_status, channel,
        processor, underwriter, closer,
        submitted_to_processing_date, submitted_to_underwriting_date,
        processing_date, approval_date, closing_date, disbursement_date,
        funding_date, application_date,
        fico_score, ltv_ratio, be_dti_ratio, occupancy_type, borr_self_employed
      FROM loans
      WHERE ${config.outputDateField} IS NOT NULL
        AND ${config.outputDateField} >= $1
        AND ${config.outputDateField} < $2
        AND ${config.actorColumn} IS NOT NULL
        AND TRIM(${config.actorColumn}) != ''
        AND UPPER(TRIM(${config.actorColumn})) != '99-MISSING'
        ${channelClause}
        ${dimensionFilterClause}
    `,
        [startDateStr, endDateStr]
      );

      const outputLoans = outputLoansResult.rows;
      logInfo("[Scorecard/Operations] Loans loaded", {
        count: outputLoans.length,
      });

      // Helper: Calculate turn time in days
      const calcTurnTime = (l: any): number | null => {
        const startDate = l[config.turnTimeStartField];
        const endDate = l[config.turnTimeEndField];
        if (!startDate || !endDate) return null;
        const start = new Date(startDate);
        const end = new Date(endDate);
        if (isNaN(start.getTime()) || isNaN(end.getTime())) return null;
        const days = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
        return days > 0 ? days : null;
      };

      // Helper: Calculate loan complexity for operations
      // Uses the same configurable weights as Sales Scorecard for consistency
      const calcOpsComplexity = (l: any): number => {
        return calcLoanComplexity(l, complexityConfig);
      };

      // Aggregate by actor
      interface OpsActorMetrics {
        name: string;
        units: number;
        volume: number;
        turnTimes: number[];
        complexityScores: number[];
        governmentLoans: number;
        purchaseLoans: number;
        approvedLoans: number;
        deniedLoans: number;
        ficoWeightedSum: number;
        ficoWeight: number;
        ltvWeightedSum: number;
        ltvWeight: number;
        seenLoanNumbers: Set<string>;
      }

      const actorMap = new Map<string, OpsActorMetrics>();

      outputLoans.forEach((l: any) => {
        const actorName = l[config.actorColumn];
        if (isActorMissing(actorName, "strict")) return;

        const loanNumber = l.loan_number;
        const existing = actorMap.get(actorName) || {
          name: actorName,
          units: 0,
          volume: 0,
          turnTimes: [],
          complexityScores: [],
          governmentLoans: 0,
          purchaseLoans: 0,
          approvedLoans: 0,
          deniedLoans: 0,
          ficoWeightedSum: 0,
          ficoWeight: 0,
          ltvWeightedSum: 0,
          ltvWeight: 0,
          seenLoanNumbers: new Set<string>(),
        };

        // Count distinct loans
        if (!existing.seenLoanNumbers.has(loanNumber)) {
          existing.seenLoanNumbers.add(loanNumber);
          existing.units += 1;
        }

        const loanAmount = parseFloat(l.loan_amount) || 0;
        existing.volume += loanAmount;

        // Turn time
        const turnTime = calcTurnTime(l);
        if (turnTime !== null) {
          existing.turnTimes.push(turnTime);
        }

        // Complexity
        existing.complexityScores.push(calcOpsComplexity(l));

        // Loan type counts
        const loanType = (l.loan_type || "").toUpperCase();
        if (
          loanType.includes("FHA") ||
          loanType.includes("VA") ||
          loanType.includes("USDA")
        ) {
          existing.governmentLoans += 1;
        }

        const loanPurpose = (l.loan_purpose || "").toUpperCase();
        if (loanPurpose.includes("PURCHASE")) {
          existing.purchaseLoans += 1;
        }

        // Status counts
        const status = (l.current_loan_status || "").toUpperCase();
        if (status.includes("APPROVED") || status.includes("ORIGINATED")) {
          existing.approvedLoans += 1;
        }
        if (status.includes("DENIED")) {
          existing.deniedLoans += 1;
        }

        // Weighted averages
        const fico = parseFloat(l.fico_score) || 0;
        if (fico >= 350 && fico <= 900) {
          existing.ficoWeightedSum += fico * loanAmount;
          existing.ficoWeight += loanAmount;
        }

        const ltv = parseFloat(l.ltv_ratio) || 0;
        if (ltv >= 0 && ltv <= 110) {
          existing.ltvWeightedSum += ltv * loanAmount;
          existing.ltvWeight += loanAmount;
        }

        actorMap.set(actorName, existing);
      });

      // Convert to array and calculate scores
      const allActors = Array.from(actorMap.values()).filter(
        (a) => a.units > 0
      );

      // Calculate company averages
      const totalUnits = allActors.reduce((sum, a) => sum + a.units, 0);
      const totalVolume = allActors.reduce((sum, a) => sum + a.volume, 0);
      const avgUnits = allActors.length > 0 ? totalUnits / allActors.length : 0;

      const allTurnTimes = allActors.flatMap((a) => a.turnTimes);
      const companyAvgTurnTime =
        allTurnTimes.length > 0
          ? allTurnTimes.reduce((a, b) => a + b, 0) / allTurnTimes.length
          : 0;

      const allComplexities = allActors.flatMap((a) => a.complexityScores);
      const companyAvgComplexity =
        allComplexities.length > 0
          ? allComplexities.reduce((a, b) => a + b, 0) / allComplexities.length
          : 100;

      // Helper to convert NaN to 0 (NaN becomes null in JSON which breaks the frontend)
      const safeNum = (n: number): number => (isNaN(n) || !isFinite(n) ? 0 : n);

      // Calculate TTS scores
      const actorsWithScores = allActors
        .map((actor) => {
          const actorAvgTurnTime =
            actor.turnTimes.length > 0
              ? actor.turnTimes.reduce((a, b) => a + b, 0) /
                actor.turnTimes.length
              : 0;
          const actorAvgComplexity =
            actor.complexityScores.length > 0
              ? actor.complexityScores.reduce((a, b) => a + b, 0) /
                actor.complexityScores.length
              : 100;

          // Calculate ratings
          const unitRating =
            avgUnits > 0 ? (actor.units / avgUnits) * 100 : 100;
          const turnTimeRating =
            actorAvgTurnTime > 0 && companyAvgTurnTime > 0
              ? (companyAvgTurnTime / actorAvgTurnTime) * 100 // Lower is better
              : 100;
          const complexityRating =
            companyAvgComplexity > 0
              ? (actorAvgComplexity / companyAvgComplexity) * 100
              : 100;

          // TTS Score (70/15/15) - weights sum to 1.0, so average performer scores 100
          const ttsScore =
            unitRating * weightConfig.units +
            turnTimeRating * weightConfig.turnTime +
            complexityRating * weightConfig.complexity;

          // Weighted averages
          const waFico =
            actor.ficoWeight > 0 ? actor.ficoWeightedSum / actor.ficoWeight : 0;
          const waLtv =
            actor.ltvWeight > 0 ? actor.ltvWeightedSum / actor.ltvWeight : 0;

          // Percentages
          const totalDecisions = actor.approvedLoans + actor.deniedLoans;
          const approvedPercent =
            totalDecisions > 0
              ? (actor.approvedLoans / totalDecisions) * 100
              : 0;
          const deniedPercent =
            totalDecisions > 0 ? (actor.deniedLoans / totalDecisions) * 100 : 0;
          const governmentPercent =
            actor.units > 0 ? (actor.governmentLoans / actor.units) * 100 : 0;
          const purchasePercent =
            actor.units > 0 ? (actor.purchaseLoans / actor.units) * 100 : 0;

          return {
            name: actor.name,
            units: safeNum(actor.units),
            volume: safeNum(actor.volume),
            avgDays: safeNum(actorAvgTurnTime),
            loanComplexityScore: safeNum(actorAvgComplexity),
            waFico: safeNum(waFico),
            waLtv: safeNum(waLtv),
            approvedPercent: safeNum(approvedPercent),
            deniedPercent: safeNum(deniedPercent),
            governmentPercent: safeNum(governmentPercent),
            purchasePercent: safeNum(purchasePercent),
            unitRating: safeNum(unitRating),
            turnTimeRating: safeNum(turnTimeRating),
            complexityRating: safeNum(complexityRating),
            ttsScore: safeNum(ttsScore),
            tier: "bottom" as TTSTier, // Placeholder, will be assigned after sorting
          };
        })
        .sort((a, b) => b.ttsScore - a.ttsScore);

      // Pareto: assign tiers by CUMULATIVE VALUE so top tier ≈ 50% of units, second ≈ 30%, bottom ≈ 20%.
      const byValue = [...actorsWithScores].sort((a, b) => b.units - a.units);
      const opsActorsWithTiers = assignTiersByCumulativeValue(
        byValue,
        totalUnits
      );

      logInfo("[Scorecard/Operations] Tier assignment by cumulative value", {
        actorCount: opsActorsWithTiers.length,
        topCount: opsActorsWithTiers.filter((a) => a.tier === "top").length,
        topUnits: opsActorsWithTiers.filter((a) => a.tier === "top").reduce((s, a) => s + a.units, 0),
        totalUnits,
      });

      // Tier summaries
      const topActors = opsActorsWithTiers.filter((a) => a.tier === "top");
      const secondActors = opsActorsWithTiers.filter(
        (a) => a.tier === "second"
      );
      const bottomActors = opsActorsWithTiers.filter(
        (a) => a.tier === "bottom"
      );

      const calcOpsTierSummary = (actors: typeof opsActorsWithTiers) => {
        if (actors.length === 0) {
          return {
            count: 0,
            units: 0,
            unitsPercent: 0,
            volume: 0,
            avgDays: 0,
            loanComplexityScore: 100,
            avgUnitsPerMonth: 0,
            compensation: "-",
            costPerFile: "-",
            approvedPercent: 0,
            deniedPercent: 0,
            governmentPercent: 0,
            purchasePercent: 0,
            waFico: 0,
            waLtv: 0,
            avgTtsScore: 0,
          };
        }
        const tierUnits = actors.reduce((sum, a) => sum + a.units, 0);
        // Calculate tier percentages (weighted by units)
        const tierApproved = actors.reduce(
          (sum, a) => sum + (a.approvedPercent * a.units) / 100,
          0
        );
        const tierDenied = actors.reduce(
          (sum, a) => sum + (a.deniedPercent * a.units) / 100,
          0
        );
        const tierGovernment = actors.reduce(
          (sum, a) => sum + (a.governmentPercent * a.units) / 100,
          0
        );
        const tierPurchase = actors.reduce(
          (sum, a) => sum + (a.purchasePercent * a.units) / 100,
          0
        );
        const tierDecisions = tierApproved + tierDenied;
        // Weighted averages for FICO and LTV
        const tierFicoWeighted = actors.reduce(
          (sum, a) => sum + a.waFico * a.units,
          0
        );
        const tierLtvWeighted = actors.reduce(
          (sum, a) => sum + a.waLtv * a.units,
          0
        );

        return {
          count: actors.length,
          units: tierUnits,
          unitsPercent: totalUnits > 0 ? (tierUnits / totalUnits) * 100 : 0,
          volume: actors.reduce((sum, a) => sum + a.volume, 0),
          avgDays:
            actors.reduce((sum, a) => sum + a.avgDays, 0) / actors.length,
          loanComplexityScore:
            actors.reduce((sum, a) => sum + a.loanComplexityScore, 0) /
            actors.length,
          avgUnitsPerMonth: tierUnits / actors.length / Math.max(1, monthsBack),
          compensation: "-",
          costPerFile: "-",
          approvedPercent:
            tierDecisions > 0 ? (tierApproved / tierDecisions) * 100 : 0,
          deniedPercent:
            tierDecisions > 0 ? (tierDenied / tierDecisions) * 100 : 0,
          governmentPercent:
            tierUnits > 0 ? (tierGovernment / tierUnits) * 100 : 0,
          purchasePercent:
            tierUnits > 0 ? (tierPurchase / tierUnits) * 100 : 0,
          waFico: tierUnits > 0 ? tierFicoWeighted / tierUnits : 0,
          waLtv: tierUnits > 0 ? tierLtvWeighted / tierUnits : 0,
          avgTtsScore:
            actors.reduce((sum, a) => sum + a.ttsScore, 0) / actors.length,
        };
      };

      const tierSummary = {
        top: calcOpsTierSummary(topActors),
        second: calcOpsTierSummary(secondActors),
        bottom: calcOpsTierSummary(bottomActors),
      };

      // Company totals - include all fields expected by frontend
      // Calculate company-wide percentages from all actors
      const totalApproved = opsActorsWithTiers.reduce(
        (sum, a) => sum + (a.approvedPercent * a.units) / 100,
        0
      );
      const totalDenied = opsActorsWithTiers.reduce(
        (sum, a) => sum + (a.deniedPercent * a.units) / 100,
        0
      );
      const totalGovernment = opsActorsWithTiers.reduce(
        (sum, a) => sum + (a.governmentPercent * a.units) / 100,
        0
      );
      const totalPurchase = opsActorsWithTiers.reduce(
        (sum, a) => sum + (a.purchasePercent * a.units) / 100,
        0
      );
      const totalDecisions = totalApproved + totalDenied;

      // Weighted average FICO and LTV across all actors (weighted by units)
      const totalFicoWeighted = opsActorsWithTiers.reduce(
        (sum, a) => sum + a.waFico * a.units,
        0
      );
      const totalLtvWeighted = opsActorsWithTiers.reduce(
        (sum, a) => sum + a.waLtv * a.units,
        0
      );

      const totals = {
        count: opsActorsWithTiers.length,
        units: totalUnits,
        unitsPercent: 100,
        volume: totalVolume,
        avgDays: companyAvgTurnTime,
        loanComplexityScore: companyAvgComplexity,
        avgUnitsPerMonth:
          opsActorsWithTiers.length > 0
            ? avgUnits / Math.max(1, monthsBack)
            : 0,
        compensation: "-",
        costPerFile: "-",
        approvedPercent:
          totalDecisions > 0 ? (totalApproved / totalDecisions) * 100 : 0,
        deniedPercent:
          totalDecisions > 0 ? (totalDenied / totalDecisions) * 100 : 0,
        governmentPercent:
          totalUnits > 0 ? (totalGovernment / totalUnits) * 100 : 0,
        purchasePercent:
          totalUnits > 0 ? (totalPurchase / totalUnits) * 100 : 0,
        waFico: totalUnits > 0 ? totalFicoWeighted / totalUnits : 0,
        waLtv: totalUnits > 0 ? totalLtvWeighted / totalUnits : 0,
        avgTtsScore:
          opsActorsWithTiers.length > 0
            ? opsActorsWithTiers.reduce((sum, a) => sum + a.ttsScore, 0) /
              opsActorsWithTiers.length
            : 0,
      };

      const companyAverages = {
        units: avgUnits,
        turnTime: companyAvgTurnTime,
        complexity: companyAvgComplexity,
      };

      logInfo("[Scorecard/Operations] Complete", {
        actors: opsActorsWithTiers.length,
        totalUnits,
      });

      res.setHeader("X-Scorecard-Tier-By", "value-rank");
      res.json({
        actors: opsActorsWithTiers,
        companyAverages,
        weightConfig,
        tierSummary,
        totals,
        dateRange: {
          startDate: effectiveStartDate.toISOString(),
          endDate: effectiveEndDate.toISOString(),
          months: monthsBack,
        },
      });
    } catch (error: any) {
      logError("Error fetching operations scorecard data", error, {
        userId: req.userId,
      });
      res.status(500).json({
        error: error.message || "Failed to fetch operations scorecard data",
      });
    }
  }
);

// =============================================================================
// OPERATIONS TRENDS - GET /api/scorecard/operations-trends
// =============================================================================
// Migrated from: /api/loans/operations-scorecard-trends
// =============================================================================

/**
 * GET /api/scorecard/operations-trends
 * Get Operations Scorecard Trends - monthly performance breakdown by actor
 *
 * Query Parameters:
 * - actor_type: 'processor' | 'underwriter' | 'closer' (default: 'underwriter')
 * - months: Number of months (default: 12)
 * - channel_group: Optional channel filter
 */
router.get(
  "/operations-trends",
  authenticateToken,
  attachTenantContext,
  apiLimiter,
  async (req: AuthRequest, res) => {
    try {
      const tenantPool = getTenantContext(req).tenantPool;

      const actorType = (req.query.actor_type as string) || "underwriter";
      const monthsCount = parseInt(req.query.months as string) || 12;
      const channelGroup = req.query.channel_group as string | undefined;

      if (!["processor", "underwriter", "closer"].includes(actorType)) {
        return res.status(400).json({ error: "Invalid actor_type" });
      }

      logInfo("[Scorecard/Operations-Trends] Start", {
        actorType,
        months: monthsCount,
      });

      const dimensionFilterClause = buildDimensionFilterWhereClause(req.query as Record<string, any>, '', new Set(['channel_group', 'tenant_id']));

      const result = await getOperationsScorecardTrends(tenantPool, {
        actorType,
        monthsCount,
        channelGroup,
        dimensionFilterClause,
      });

      logInfo("[Scorecard/Operations-Trends] Complete", {
        actors: result.actors.length,
        months: result.months.length,
      });

      res.json(result);
    } catch (error: any) {
      logError("Error fetching operations trends data", error, {
        userId: req.userId,
      });
      res.status(500).json({
        error: error.message || "Failed to fetch operations trends data",
      });
    }
  }
);

// =============================================================================
// SALES TRENDS - GET /api/scorecard/sales-trends
// =============================================================================
// Migrated from: /api/loans/sales-trends
// =============================================================================

/**
 * GET /api/scorecard/sales-trends
 * Get Sales Trends data for LO performance over 3 or 6 months
 *
 * Query Parameters:
 * - date_range: '3-months' | '6-months' (default: '3-months')
 * - channel_group: Channel filter (default: 'Retail')
 */
router.get(
  "/sales-trends",
  authenticateToken,
  attachTenantContext,
  apiLimiter,
  async (req: AuthRequest, res) => {
    try {
      const tenantPool = getTenantContext(req).tenantPool;

      // Get tenant-specific revenue expression (or default if none configured)
      const revenueExpression = await getTenantRevenueExpression(tenantPool);

      const dateRange = (req.query.date_range as string) || "3-months";
      const channelGroup = (req.query.channel_group as string) || "Retail";
      const monthsBack = dateRange === "6-months" ? 6 : 3;

      // Get vMaxDate
      const vMaxDate = await getVMaxDate(tenantPool);

      // Date ranges
      const currentEndDate = new Date(vMaxDate);
      const currentStartDate = new Date(vMaxDate);
      currentStartDate.setMonth(currentStartDate.getMonth() - monthsBack);
      currentStartDate.setDate(1);

      const previousEndDate = new Date(currentStartDate);
      previousEndDate.setDate(previousEndDate.getDate() - 1);
      const previousStartDate = new Date(previousEndDate);
      previousStartDate.setMonth(previousStartDate.getMonth() - monthsBack + 1);
      previousStartDate.setDate(1);

      const dimensionFilterClause = buildDimensionFilterWhereClause(
        req.query as Record<string, any>,
        '',
        new Set(['channel_group', 'tenant_id', 'date_range'])
      );

      logInfo("[Scorecard/Sales-Trends] Start", {
        dateRange,
        channel: channelGroup,
      });

      // Fetch loans with tenant-specific revenue calculation
      const loansResult = await tenantPool.query(
        `
      SELECT 
        loan_id, loan_number, loan_amount, loan_type, loan_purpose,
        funding_date, application_date, closing_date,
        loan_officer, branch, channel, current_loan_status,
        rate_lock_buy_side_base_price_rate,
        orig_fee_borr_pd, orig_fees_seller, cd_lender_credits,
        (${revenueExpression}) AS revenue
      FROM public.loans
      WHERE funding_date IS NOT NULL
        AND funding_date >= $1
        AND funding_date <= $2
        ${dimensionFilterClause}
    `,
        [previousStartDate.toISOString(), currentEndDate.toISOString()]
      );

      const allLoans = loansResult.rows;

      // Apply channel filter
      const channelFilteredLoans = allLoans.filter((l: any) => {
        const channel = (l.channel || "").toLowerCase();
        if (channelGroup.toLowerCase() === "retail") {
          return channel.includes("retail") || channel.includes("brok");
        } else if (channelGroup.toLowerCase() === "tpo") {
          return channel.includes("whole") || channel.includes("corresp");
        }
        return true;
      });

      // Split by period
      const currentPeriodLoans = channelFilteredLoans.filter((l: any) => {
        const fundDate = new Date(l.funding_date);
        return fundDate >= currentStartDate && fundDate <= currentEndDate;
      });

      const previousPeriodLoans = channelFilteredLoans.filter((l: any) => {
        const fundDate = new Date(l.funding_date);
        return fundDate >= previousStartDate && fundDate <= previousEndDate;
      });

      // Filter out missing LOs
      const validCurrentLoans = currentPeriodLoans.filter(
        (l: any) => !isActorMissing(l.loan_officer)
      );
      const validPreviousLoans = previousPeriodLoans.filter(
        (l: any) => !isActorMissing(l.loan_officer)
      );

      // Helper: turn time
      const calcTurnTime = (loan: any): number | null => {
        if (!loan.closing_date || !loan.application_date) return null;
        const days =
          (new Date(loan.closing_date).getTime() -
            new Date(loan.application_date).getTime()) /
          (1000 * 60 * 60 * 24);
        return days > 0 ? days : null;
      };

      // Aggregate per LO
      const loMap = new Map<
        string,
        {
          name: string;
          branch: string;
          units: number;
          volume: number;
          revenue: number;
          turnTimes: number[];
          previousUnits: number;
        }
      >();

      validCurrentLoans.forEach((loan: any) => {
        const loName = loan.loan_officer;
        const existing = loMap.get(loName) || {
          name: loName,
          branch: loan.branch || "Unknown",
          units: 0,
          volume: 0,
          revenue: 0,
          turnTimes: [],
          previousUnits: 0,
        };

        existing.units += 1;
        existing.volume += parseFloat(loan.loan_amount || 0);
        existing.revenue += parseFloat(loan.revenue) || 0; // Uses tenant-specific formula from SQL

        const turnTime = calcTurnTime(loan);
        if (turnTime !== null) {
          existing.turnTimes.push(turnTime);
        }

        loMap.set(loName, existing);
      });

      // Add previous period units
      validPreviousLoans.forEach((loan: any) => {
        const existing = loMap.get(loan.loan_officer);
        if (existing) {
          existing.previousUnits += 1;
        }
      });

      // Build response
      const allLOs = Array.from(loMap.values());
      const totalVolume = allLOs.reduce((sum, lo) => sum + lo.volume, 0);
      const avgVolume = allLOs.length > 0 ? totalVolume / allLOs.length : 0;

      const loanOfficers = allLOs
        .filter((lo) => lo.units > 0)
        .map((lo, index) => {
          const marginBPS =
            lo.volume > 0 ? (lo.revenue / lo.volume) * 10000 : 0;
          const trendPercent =
            lo.previousUnits > 0
              ? ((lo.units - lo.previousUnits) / lo.previousUnits) * 100
              : lo.units > 0
              ? 100
              : 0;
          const daysAvg =
            lo.turnTimes.length > 0
              ? lo.turnTimes.reduce((a, b) => a + b, 0) / lo.turnTimes.length
              : 0;
          const volumeRating =
            avgVolume > 0 ? (lo.volume / avgVolume) * 100 : 100;

          let tier: "top" | "2nd" | "bottom" = "bottom";
          if (volumeRating >= 120) tier = "top";
          else if (volumeRating >= 80) tier = "2nd";

          const nameParts = lo.name.split(" ");
          const initials =
            nameParts.length >= 2
              ? `${nameParts[0][0]}${
                  nameParts[nameParts.length - 1][0]
                }`.toUpperCase()
              : lo.name.substring(0, 2).toUpperCase();

          return {
            id: `lo-${index + 1}`,
            name: lo.name,
            initials,
            branch: lo.branch,
            tier,
            closed: lo.units,
            volume: lo.volume,
            marginBPS: Math.round(marginBPS),
            trendPercent: Math.round(trendPercent),
            daysAvg: Math.round(daysAvg),
            ttsScore: Math.round(volumeRating),
          };
        })
        .sort((a, b) => b.ttsScore - a.ttsScore);

      // KPI metrics
      const totalUnits = loanOfficers.reduce((sum, lo) => sum + lo.closed, 0);
      const allTurnTimes = validCurrentLoans
        .map((l: any) => calcTurnTime(l))
        .filter((t): t is number => t !== null);
      const avgTurnTime =
        allTurnTimes.length > 0
          ? Math.round(
              allTurnTimes.reduce((a, b) => a + b, 0) / allTurnTimes.length
            )
          : 0;

      // Fund type breakdown
      const conformingLimit = 726200;
      const fundTypeBreakdown = [
        {
          name: "Conventional",
          value: validCurrentLoans.filter(
            (l: any) =>
              l.loan_type === "Conventional" &&
              parseFloat(l.loan_amount || 0) <= conformingLimit
          ).length,
          fill: "#3b82f6",
        },
        {
          name: "FHA",
          value: validCurrentLoans.filter((l: any) => l.loan_type === "FHA")
            .length,
          fill: "#10b981",
        },
        {
          name: "VA",
          value: validCurrentLoans.filter((l: any) => l.loan_type === "VA")
            .length,
          fill: "#a855f7",
        },
        {
          name: "USDA",
          value: validCurrentLoans.filter((l: any) => {
            const loanType = (l.loan_type || "").toLowerCase();
            return loanType.includes("farmershome") || loanType === "usda";
          }).length,
          fill: "#f97316",
        },
        {
          name: "Jumbo",
          value: validCurrentLoans.filter(
            (l: any) =>
              l.loan_type === "Conventional" &&
              parseFloat(l.loan_amount || 0) > conformingLimit
          ).length,
          fill: "#ec4899",
        },
      ];

      // Monthly performance
      const monthMap = new Map<string, { units: number; volume: number }>();
      validCurrentLoans.forEach((loan: any) => {
        const fundDate = new Date(loan.funding_date);
        const monthKey = `${fundDate.getFullYear()}-${fundDate.toLocaleString(
          "en",
          { month: "short" }
        )}`;
        const existing = monthMap.get(monthKey) || { units: 0, volume: 0 };
        monthMap.set(monthKey, {
          units: existing.units + 1,
          volume: existing.volume + parseFloat(loan.loan_amount || 0),
        });
      });

      const monthlyPerformance = Array.from(monthMap.entries())
        .map(([month, data]) => ({ month, ...data }))
        .sort((a, b) => a.month.localeCompare(b.month));

      logInfo("[Scorecard/Sales-Trends] Complete", {
        los: loanOfficers.length,
        totalUnits,
      });

      res.json({
        loanOfficers,
        kpiMetrics: {
          totalUnits,
          totalVolume: totalVolume,
          activeLOs: loanOfficers.length,
          avgTurnTime,
        },
        fundTypeBreakdown,
        monthlyPerformance,
        dateRange: {
          startDate: currentStartDate.toISOString(),
          endDate: currentEndDate.toISOString(),
        },
      });
    } catch (error: any) {
      logError("Error fetching sales trends data", error, {
        userId: req.userId,
      });
      res
        .status(500)
        .json({ error: error.message || "Failed to fetch sales trends data" });
    }
  }
);

// =============================================================================
// SALES TRENDS DRILLDOWN - GET /api/scorecard/sales-trends/drilldown/:loName
// =============================================================================
// Migrated from: /api/loans/sales-trends/drilldown/:loName
// =============================================================================

/**
 * GET /api/scorecard/sales-trends/drilldown/:loName
 * Get detailed drilldown data for a specific Loan Officer
 */
router.get(
  "/sales-trends/drilldown/:loName",
  authenticateToken,
  attachTenantContext,
  apiLimiter,
  async (req: AuthRequest, res) => {
    try {
      const tenantPool = getTenantContext(req).tenantPool;

      // Get tenant-specific revenue expression (or default if none configured)
      const revenueExpression = await getTenantRevenueExpression(tenantPool);

      const loName = req.params.loName as string;
      const decodedLoName = decodeURIComponent(loName);

      const dateRange = (req.query.date_range as string) || "3-months";
      const channelGroup = (req.query.channel_group as string) || "Retail";
      const monthsBack = dateRange === "6-months" ? 6 : 3;

      // Get date range
      const vMaxDate = await getVMaxDate(tenantPool);
      const endDate = new Date(vMaxDate);
      const startDate = new Date(vMaxDate);
      startDate.setMonth(startDate.getMonth() - monthsBack);
      startDate.setDate(1);

      const dimensionFilterClause = buildDimensionFilterWhereClause(
        req.query as Record<string, any>,
        '',
        new Set(['channel_group', 'tenant_id', 'date_range', 'loan_officer'])
      );

      // Fetch LO's loans with tenant-specific revenue calculation
      const loansResult = await tenantPool.query(
        `
      SELECT 
        loan_id, loan_number, loan_amount, loan_type, loan_purpose,
        funding_date, application_date, closing_date,
        loan_officer, branch, channel, current_loan_status,
        rate_lock_buy_side_base_price_rate,
        orig_fee_borr_pd, orig_fees_seller, cd_lender_credits,
        (${revenueExpression}) AS revenue
      FROM public.loans
      WHERE loan_officer = $1
        AND funding_date IS NOT NULL
        AND funding_date >= $2
        AND funding_date <= $3
        ${dimensionFilterClause}
    `,
        [decodedLoName, startDate.toISOString(), endDate.toISOString()]
      );

      const loLoans = loansResult.rows;

      // Apply channel filter
      const filteredLoans = loLoans.filter((l: any) => {
        const channel = (l.channel || "").toLowerCase();
        if (channelGroup.toLowerCase() === "retail") {
          return channel.includes("retail") || channel.includes("brok");
        } else if (channelGroup.toLowerCase() === "tpo") {
          return channel.includes("whole") || channel.includes("corresp");
        }
        return true;
      });

      // Helper: turn time
      const calcTurnTime = (loan: any): number | null => {
        if (!loan.closing_date || !loan.application_date) return null;
        const days =
          (new Date(loan.closing_date).getTime() -
            new Date(loan.application_date).getTime()) /
          (1000 * 60 * 60 * 24);
        return days > 0 ? days : null;
      };

      // Calculate metrics using tenant-specific revenue from SQL
      const totalClosed = filteredLoans.length;
      const totalVolume = filteredLoans.reduce(
        (sum: number, l: any) => sum + parseFloat(l.loan_amount || 0),
        0
      );
      const totalRevenue = filteredLoans.reduce(
        (sum: number, l: any) => sum + (parseFloat(l.revenue) || 0),
        0
      );
      const avgMargin =
        totalVolume > 0 ? (totalRevenue / totalVolume) * 10000 : 0;

      const turnTimes = filteredLoans
        .map((l: any) => calcTurnTime(l))
        .filter((t): t is number => t !== null);
      const turnTime =
        turnTimes.length > 0
          ? turnTimes.reduce((a, b) => a + b, 0) / turnTimes.length
          : 0;

      // Branch rank
      const branchRankResult = await tenantPool.query(
        `
      SELECT loan_officer, COUNT(*) as units
      FROM public.loans
      WHERE branch = (SELECT branch FROM public.loans WHERE loan_officer = $1 LIMIT 1)
        AND funding_date IS NOT NULL
        AND funding_date >= $2
        AND funding_date <= $3
      GROUP BY loan_officer
      ORDER BY units DESC
    `,
        [decodedLoName, startDate.toISOString(), endDate.toISOString()]
      );

      const branchLOs = branchRankResult.rows;
      const branchRank =
        branchLOs.findIndex((r: any) => r.loan_officer === decodedLoName) + 1;
      const branchTotal = branchLOs.length;

      // Monthly details
      const monthMap = new Map<string, { loans: any[] }>();
      filteredLoans.forEach((loan: any) => {
        const fundDate = new Date(loan.funding_date);
        const monthKey = `${fundDate.getFullYear()}-${fundDate.toLocaleString(
          "en",
          { month: "short" }
        )}`;
        const existing = monthMap.get(monthKey) || { loans: [] };
        existing.loans.push(loan);
        monthMap.set(monthKey, existing);
      });

      const monthlyDetails = Array.from(monthMap.entries())
        .map(([month, data]) => {
          const monthLoans = data.loans;
          const monthVolume = monthLoans.reduce(
            (sum: number, l: any) => sum + parseFloat(l.loan_amount || 0),
            0
          );
          const monthRevenue = monthLoans.reduce(
            (sum: number, l: any) => sum + (parseFloat(l.revenue) || 0), // Uses tenant-specific formula from SQL
            0
          );
          const monthTurnTimes = monthLoans
            .map((l: any) => calcTurnTime(l))
            .filter((t): t is number => t !== null);

          return {
            month,
            closed: monthLoans.length,
            volume: monthVolume,
            margin:
              monthVolume > 0
                ? Math.round((monthRevenue / monthVolume) * 10000)
                : 0,
            pullThrough: 50, // Placeholder
            turnTime:
              monthTurnTimes.length > 0
                ? Math.round(
                    monthTurnTimes.reduce((a, b) => a + b, 0) /
                      monthTurnTimes.length
                  )
                : 0,
          };
        })
        .sort((a, b) => b.month.localeCompare(a.month));

      // Performance trend
      const performanceTrend = monthlyDetails
        .slice()
        .reverse()
        .map((d) => ({
          month: d.month.split("-")[1],
          closedUnits: d.closed,
          marginBPS: d.margin,
        }));

      res.json({
        totalClosed,
        totalVolume,
        avgMargin: Math.round(avgMargin),
        turnTime: Math.round(turnTime),
        branchRank,
        branchTotal,
        contact: {
          email: "loan.officer@company.com",
          phone: "(555) 123-4567",
          location: filteredLoans[0]?.branch || "Unknown",
        },
        monthlyDetails,
        performanceTrend,
      });
    } catch (error: any) {
      logError("Error fetching sales trends drilldown", error, {
        userId: req.userId,
        loName: req.params.loName,
      });
      res.status(500).json({
        error: error.message || "Failed to fetch sales trends drilldown",
      });
    }
  }
);

// =============================================================================
// SALES SCORECARD OVERVIEW - GET /api/scorecard/sales-scorecard-overview
// =============================================================================

/**
 * GET /api/scorecard/sales-scorecard-overview
 * Volume or units by pipeline stage (started, application, locked, closed, funded) per time period.
 *
 * Query: measure=volume|units, time_period=monthly-ytd|quarterly-ytd|weekly-mtd|weekly-last-3|daily-mtd|daily-last-month,
 *        branch?, loan_officer?
 */
router.get(
  "/sales-scorecard-overview",
  authenticateToken,
  attachTenantContext,
  apiLimiter,
  async (req: AuthRequest, res) => {
    try {
      const tenantPool = getTenantContext(req).tenantPool;
      if (!tenantPool) {
        return res.status(400).json({ error: "Tenant context required" });
      }
      const measure = (req.query.measure as SalesScorecardOverviewMeasure) || "volume";
      const timePeriod =
        (req.query.time_period as SalesScorecardOverviewTimePeriod) || "monthly-ytd";
      const filters = {
        branch: req.query.branch ? [].concat(req.query.branch as any).filter(Boolean) : undefined,
        loan_officer: req.query.loan_officer
          ? [].concat(req.query.loan_officer as any).filter(Boolean)
          : undefined,
      };
      const queryParams = req.query as Record<string, unknown>;
      const rows = await getSalesScorecardOverview(
        tenantPool,
        measure,
        timePeriod,
        filters,
        queryParams
      );
      return res.json({ rows });
    } catch (error: any) {
      logError("Error fetching sales scorecard overview", error, {
        userId: req.userId,
      });
      res.status(500).json({
        error: error.message || "Failed to fetch sales scorecard overview",
      });
    }
  }
);

/**
 * GET /api/scorecard/sales-scorecard-overview/filter-options
 * Returns { branches, loanOfficers } for filter dropdowns.
 */
router.get(
  "/sales-scorecard-overview/filter-options",
  authenticateToken,
  attachTenantContext,
  async (req: AuthRequest, res) => {
    try {
      const tenantPool = getTenantContext(req).tenantPool;
      if (!tenantPool) {
        return res.status(400).json({ error: "Tenant context required" });
      }
      const [branches, loanOfficers] = await Promise.all([
        getSalesScorecardOverviewBranches(tenantPool),
        getSalesScorecardOverviewLoanOfficers(tenantPool),
      ]);
      return res.json({ branches, loanOfficers });
    } catch (error: any) {
      logError("Error fetching sales scorecard overview filter options", error, {
        userId: req.userId,
      });
      res.status(500).json({
        error:
          error.message ||
          "Failed to fetch sales scorecard overview filter options",
      });
    }
  }
);

export default router;
