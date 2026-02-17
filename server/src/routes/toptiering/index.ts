/**
 * TopTiering API Routes
 * Consolidated endpoints for TopTiering revenue-based ranking
 *
 * Migrated from /api/loans/toptiering and /api/loans/toptiering-comparison
 * Also consolidates /api/dashboard/top-tiering
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
  buildChannelWhereClause,
  calcLoanRevenue,
  getVMaxDate,
  formatDateForSQL,
  getActorColumnForChannel,
  getActorLabelForChannel,
  getTenantRevenueExpression,
  REVENUE_SQL_EXPRESSION,
  buildFundedFilter,
  type ActorMissingMode,
} from "../../utils/scorecard-utils.js";

const router = Router();

// =============================================================================
// TOPTIERING - GET /api/toptiering
// =============================================================================
// Migrated from: /api/loans/toptiering
// Also consolidates: /api/dashboard/top-tiering
// =============================================================================

/**
 * GET /api/toptiering
 * Get TopTiering data - revenue-based tier assignment (50/30/20 or 65/25/10 split)
 *
 * This endpoint assigns tiers based on CUMULATIVE REVENUE PERCENTAGE,
 * not the TTS weighted composite score used in scorecards.
 *
 * Query Parameters:
 * - actor: 'branch' | 'loan_officer' (default: 'branch')
 * - startDate: ISO date string (default: Jan 1 of current year)
 * - endDate: ISO date string (default: today)
 * - channel_group: Optional channel filter (e.g., 'Retail')
 */
router.get(
  "/",
  authenticateToken,
  attachTenantContext,
  apiLimiter,
  async (req: AuthRequest, res) => {
    try {
      const tenantPool = getTenantContext(req).tenantPool;

      // Get tenant-specific revenue expression (or default if none configured)
      const revenueExpression = await getTenantRevenueExpression(tenantPool);

      // Get user's loan access context
      const accessCtx = await getLoanAccessContext(req, tenantPool);

      // If user has no access, return empty toptiering data
      if (accessCtx.hasNoAccess) {
        return res.json({
          actor: req.query.actor || "branch",
          dateRange: {},
          data: [],
          summary: {
            totalActors: 0,
            topTierCount: 0,
            middleTierCount: 0,
            developTierCount: 0,
          },
          accessFiltered: true,
          noAccess: true,
        });
      }

      const actor = (req.query.actor as string) || "branch";
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

      // Calculate date range
      const now = new Date();
      const effectiveEndDate = endDate ? new Date(endDate) : now;
      const effectiveStartDate = startDate
        ? new Date(startDate)
        : new Date(now.getFullYear(), 0, 1);

      logInfo("[TopTiering] Start", {
        actor,
        dateRange: {
          start: effectiveStartDate.toISOString(),
          end: effectiveEndDate.toISOString(),
        },
        channel: channelGroup,
        hasAccessFilter: accessCtx.requiresFiltering,
      });

      // SQL filtering setup
      const channelClause = buildChannelWhereClause(channelGroup);
      const startDateStr = formatDateForSQL(effectiveStartDate);
      const endDateStr = formatDateForSQL(effectiveEndDate);

      // Build query params with access filter
      const queryParams = accessCtx.requiresFiltering
        ? [startDateStr, endDateStr, accessCtx.userId]
        : [startDateStr, endDateStr];

      const accessWhereClause = accessCtx.requiresFiltering
        ? `AND guid IN (SELECT loan_guid FROM user_loan_access WHERE user_id = $3)`
        : "";

      // Channel-aware funded filter: Retail uses rate_lock > 0, TPO/All do not.
      const fundedFilter = buildFundedFilter(channelGroup);

      // Fetch FUNDED loans with tenant-specific revenue calculation
      const fundedLoansResult = await retryQuery(
        () =>
          tenantPool.query(
            `SELECT 
          loan_id, loan_amount, loan_type, current_loan_status, channel,
          funding_date, closing_date, application_date, started_date,
          branch, loan_officer, fico_score, ltv_ratio, be_dti_ratio,
          origination_points, orig_fee_borr_pd, orig_fees_seller, cd_lender_credits,
          rate_lock_buy_side_base_price_rate,
          (${revenueExpression}) AS revenue
         FROM public.loans 
         WHERE ${fundedFilter}
           AND funding_date >= $1
           AND funding_date <= $2
           ${accessWhereClause}
           ${channelClause}`,
            queryParams
          ),
        2,
        500
      );
      const fundedLoans = fundedLoansResult.rows;

      // Fetch LOST OPPORTUNITY loans (with access filter) and tenant-specific revenue
      const lostOpportunityResult = await retryQuery(
        () =>
          tenantPool.query(
            `SELECT 
          loan_id, loan_amount, current_loan_status, channel,
          application_date, branch, loan_officer,
          origination_points, orig_fee_borr_pd, orig_fees_seller, cd_lender_credits,
          rate_lock_buy_side_base_price_rate,
          (${revenueExpression}) AS revenue
         FROM public.loans 
         WHERE application_date >= $1
           AND application_date <= $2
           AND (
             current_loan_status ILIKE '%withdraw%' OR
             current_loan_status ILIKE '%cancelled%' OR
             current_loan_status ILIKE '%not accepted%' OR
             current_loan_status ILIKE '%incomplete%'
           )
           ${accessWhereClause}
           ${channelClause}`,
            queryParams
          ),
        2,
        500
      );
      const lostOpportunityLoans = lostOpportunityResult.rows;

      // Fetch DENIED loans
      const deniedResult = await retryQuery(
        () =>
          tenantPool.query(
            `SELECT 
          loan_id, application_date, branch, loan_officer
         FROM public.loans 
         WHERE application_date >= $1
           AND application_date <= $2
           AND (current_loan_status ILIKE '%denied%' OR current_loan_status ILIKE '%declined%')
           ${channelClause}`,
            [startDateStr, endDateStr]
          ),
        2,
        500
      );
      const deniedLoans = deniedResult.rows;

      // Fetch STARTED loans (for pull-through)
      const startedResult = await retryQuery(
        () =>
          tenantPool.query(
            `SELECT 
          loan_id, branch, loan_officer, current_loan_status
         FROM public.loans 
         WHERE COALESCE(started_date, application_date) >= $1
           AND COALESCE(started_date, application_date) <= $2
           ${channelClause}`,
            [startDateStr, endDateStr]
          ),
        2,
        500
      );
      const startedLoans = startedResult.rows;

      logInfo("[TopTiering] Data loaded", {
        funded: fundedLoans.length,
        lostOpp: lostOpportunityLoans.length,
        denied: deniedLoans.length,
        started: startedLoans.length,
      });

      // Helper: Calculate turn time
      const calcTurnTime = (l: any): number | null => {
        const appDate = l.application_date;
        const fundDate = l.funding_date || l.closing_date;
        if (!appDate || !fundDate) return null;
        const diffMs =
          new Date(fundDate).getTime() - new Date(appDate).getTime();
        return Math.round(diffMs / (1000 * 60 * 60 * 24));
      };

      // Aggregate by actor
      interface ActorData {
        loans: any[];
        revenue: number;
        volume: number;
        units: number;
        turnTimes: number[];
        ficoWeighted: { sum: number; weight: number };
        ltvWeighted: { sum: number; weight: number };
        dtiWeighted: { sum: number; weight: number };
      }

      const actorMap = new Map<string, ActorData>();

      fundedLoans.forEach((l: any) => {
        const actorName = l[actorColumn];
        if (isActorMissing(actorName)) return;

        if (!actorMap.has(actorName)) {
          actorMap.set(actorName, {
            loans: [],
            revenue: 0,
            volume: 0,
            units: 0,
            turnTimes: [],
            ficoWeighted: { sum: 0, weight: 0 },
            ltvWeighted: { sum: 0, weight: 0 },
            dtiWeighted: { sum: 0, weight: 0 },
          });
        }

        const actor = actorMap.get(actorName)!;
        const loanAmount = parseFloat(l.loan_amount) || 0;
        const revenue = parseFloat(l.revenue) || 0; // Uses tenant-specific formula from SQL
        const turnTime = calcTurnTime(l);

        actor.loans.push(l);
        actor.revenue += revenue;
        actor.volume += loanAmount;
        actor.units += 1;

        if (turnTime !== null && turnTime > 0) {
          actor.turnTimes.push(turnTime);
        }

        // Weighted averages
        if (l.fico_score && loanAmount > 0) {
          actor.ficoWeighted.sum += parseFloat(l.fico_score) * loanAmount;
          actor.ficoWeighted.weight += loanAmount;
        }
        if (l.ltv_ratio && loanAmount > 0) {
          actor.ltvWeighted.sum += parseFloat(l.ltv_ratio) * loanAmount;
          actor.ltvWeighted.weight += loanAmount;
        }
        if (l.be_dti_ratio && loanAmount > 0) {
          actor.dtiWeighted.sum += parseFloat(l.be_dti_ratio) * loanAmount;
          actor.dtiWeighted.weight += loanAmount;
        }
      });

      // Calculate metrics and sort by revenue
      const actorMetrics = Array.from(actorMap.entries())
        .map(([name, data]) => ({
          name,
          revenue: data.revenue,
          volume: data.volume,
          units: data.units,
          revenueBps:
            data.volume > 0 ? (data.revenue / data.volume) * 10000 : 0,
          revenuePerLoan: data.units > 0 ? data.revenue / data.units : 0,
          avgTurnTime:
            data.turnTimes.length > 0
              ? data.turnTimes.reduce((a, b) => a + b, 0) /
                data.turnTimes.length
              : 0,
          waFico:
            data.ficoWeighted.weight > 0
              ? data.ficoWeighted.sum / data.ficoWeighted.weight
              : 0,
          waLtv:
            data.ltvWeighted.weight > 0
              ? data.ltvWeighted.sum / data.ltvWeighted.weight
              : 0,
          waDti:
            data.dtiWeighted.weight > 0
              ? data.dtiWeighted.sum / data.dtiWeighted.weight
              : 0,
        }))
        .sort((a, b) => b.revenue - a.revenue);

      // Calculate totals
      const totalRevenue = actorMetrics.reduce((sum, a) => sum + a.revenue, 0);
      const totalVolume = actorMetrics.reduce((sum, a) => sum + a.volume, 0);
      const totalUnits = actorMetrics.reduce((sum, a) => sum + a.units, 0);

      // Assign tiers based on cumulative revenue percentage (65/90 thresholds)
      let cumulativeRevenue = 0;
      const actors = actorMetrics.map((a) => {
        cumulativeRevenue += a.revenue;
        const cumulativePercent =
          totalRevenue > 0 ? (cumulativeRevenue / totalRevenue) * 100 : 0;

        let tier: "top" | "second" | "bottom";
        if (cumulativePercent <= 65) {
          tier = "top";
        } else if (cumulativePercent <= 90) {
          tier = "second";
        } else {
          tier = "bottom";
        }

        return {
          ...a,
          cumulativePercent,
          tier,
        };
      });

      // Calculate lost opportunity and denied by actor
      const lostOpportunityByActor = new Map<
        string,
        { units: number; revenue: number }
      >();
      const deniedByActor = new Map<string, number>();

      lostOpportunityLoans.forEach((l: any) => {
        const actorName = l[actorColumn];
        if (isActorMissing(actorName)) return;

        if (!lostOpportunityByActor.has(actorName)) {
          lostOpportunityByActor.set(actorName, { units: 0, revenue: 0 });
        }
        const lo = lostOpportunityByActor.get(actorName)!;
        lo.units += 1;
        lo.revenue += parseFloat(l.revenue) || 0; // Uses tenant-specific formula from SQL
      });

      deniedLoans.forEach((l: any) => {
        const actorName = l[actorColumn];
        if (isActorMissing(actorName)) return;
        deniedByActor.set(actorName, (deniedByActor.get(actorName) || 0) + 1);
      });

      // Calculate tier summaries
      const topTierActors = actors.filter((a) => a.tier === "top");
      const secondTierActors = actors.filter((a) => a.tier === "second");
      const bottomTierActors = actors.filter((a) => a.tier === "bottom");

      const calcTierSummary = (tierActors: typeof actors) => {
        const tierNames = new Set(tierActors.map((a) => a.name));

        let lostUnits = 0;
        let lostRevenue = 0;
        let deniedUnits = 0;

        tierNames.forEach((name) => {
          const lo = lostOpportunityByActor.get(name);
          if (lo) {
            lostUnits += lo.units;
            lostRevenue += lo.revenue;
          }
          deniedUnits += deniedByActor.get(name) || 0;
        });

        const tierStartedLoans = startedLoans.filter((l: any) =>
          tierNames.has(l[actorColumn])
        );
        const tierOriginatedCount = tierStartedLoans.filter((l: any) => {
          const s = (l.current_loan_status || "").toLowerCase();
          return s.includes("originated") || s.includes("purchased");
        }).length;
        const tierCompleted = tierStartedLoans.filter((l: any) => {
          const s = (l.current_loan_status || "").toLowerCase();
          return !["active loan","active","locked","submitted","approved"].includes(s);
        }).length;
        const pullThrough =
          tierCompleted > 0
            ? (tierOriginatedCount / tierCompleted) * 100
            : 0;

        const validTurnTimes = tierActors.filter((a) => a.avgTurnTime > 0);
        const validFicos = tierActors.filter((a) => a.waFico > 0);
        const validLtvs = tierActors.filter((a) => a.waLtv > 0);
        const validDtis = tierActors.filter((a) => a.waDti > 0);

        return {
          count: tierActors.length,
          revenue: tierActors.reduce((sum, a) => sum + a.revenue, 0),
          volume: tierActors.reduce((sum, a) => sum + a.volume, 0),
          units: tierActors.reduce((sum, a) => sum + a.units, 0),
          percent:
            totalRevenue > 0
              ? (tierActors.reduce((sum, a) => sum + a.revenue, 0) /
                  totalRevenue) *
                100
              : 0,
          avgTurnTime:
            validTurnTimes.length > 0
              ? validTurnTimes.reduce((sum, a) => sum + a.avgTurnTime, 0) /
                validTurnTimes.length
              : 0,
          waFico:
            validFicos.length > 0
              ? validFicos.reduce((sum, a) => sum + a.waFico, 0) /
                validFicos.length
              : 0,
          waLtv:
            validLtvs.length > 0
              ? validLtvs.reduce((sum, a) => sum + a.waLtv, 0) /
                validLtvs.length
              : 0,
          waDti:
            validDtis.length > 0
              ? validDtis.reduce((sum, a) => sum + a.waDti, 0) /
                validDtis.length
              : 0,
          lostOpportunityUnits: lostUnits,
          lostOpportunityRevenue: lostRevenue,
          deniedUnits: deniedUnits,
          pullThrough: pullThrough,
        };
      };

      const tierSummary = {
        topTier: calcTierSummary(topTierActors),
        secondTier: calcTierSummary(secondTierActors),
        bottomTier: calcTierSummary(bottomTierActors),
      };

      // Overall totals - uses tenant-specific revenue from SQL
      const totalLostOpportunityUnits = lostOpportunityLoans.length;
      const totalLostOpportunityRevenue = lostOpportunityLoans.reduce(
        (sum: number, l: any) => sum + (parseFloat(l.revenue) || 0),
        0
      );
      const totalDeniedUnits = deniedLoans.length;
      const totalOriginated = startedLoans.filter((l: any) => {
        const s = (l.current_loan_status || "").toLowerCase();
        return s.includes("originated") || s.includes("purchased");
      }).length;
      const totalCompleted = startedLoans.filter((l: any) => {
        const s = (l.current_loan_status || "").toLowerCase();
        return !["active loan","active","locked","submitted","approved"].includes(s);
      }).length;
      const totalPullThrough =
        totalCompleted > 0
          ? (totalOriginated / totalCompleted) * 100
          : 0;

      const allTurnTimes = actors.filter((a) => a.avgTurnTime > 0);
      const allFicos = actors.filter((a) => a.waFico > 0);
      const allLtvs = actors.filter((a) => a.waLtv > 0);
      const allDtis = actors.filter((a) => a.waDti > 0);

      const totals = {
        revenue: totalRevenue,
        volume: totalVolume,
        units: totalUnits,
        avgTurnTime:
          allTurnTimes.length > 0
            ? allTurnTimes.reduce((sum, a) => sum + a.avgTurnTime, 0) /
              allTurnTimes.length
            : 0,
        waFico:
          allFicos.length > 0
            ? allFicos.reduce((sum, a) => sum + a.waFico, 0) / allFicos.length
            : 0,
        waLtv:
          allLtvs.length > 0
            ? allLtvs.reduce((sum, a) => sum + a.waLtv, 0) / allLtvs.length
            : 0,
        waDti:
          allDtis.length > 0
            ? allDtis.reduce((sum, a) => sum + a.waDti, 0) / allDtis.length
            : 0,
        lostOpportunityUnits: totalLostOpportunityUnits,
        lostOpportunityRevenue: totalLostOpportunityRevenue,
        deniedUnits: totalDeniedUnits,
        pullThrough: totalPullThrough,
      };

      logInfo("[TopTiering] Complete", {
        actors: actors.length,
        tiers: {
          top: topTierActors.length,
          second: secondTierActors.length,
          bottom: bottomTierActors.length,
        },
      });

      res.json({
        actors,
        totals,
        tierSummary,
        dateRange: {
          startDate: effectiveStartDate.toISOString(),
          endDate: effectiveEndDate.toISOString(),
        },
      });
    } catch (error: any) {
      logError("Error fetching toptiering data", error, { userId: req.userId });
      res
        .status(500)
        .json({ error: error.message || "Failed to fetch toptiering data" });
    }
  }
);

// =============================================================================
// TOPTIERING COMPARISON - GET /api/toptiering/comparison
// =============================================================================
// Migrated from: /api/loans/toptiering-comparison
// =============================================================================

/**
 * GET /api/toptiering/comparison
 * Get TopTiering Pareto chart data for Branch or Loan Officer comparison
 *
 * Uses cumulative revenue percentage for tier assignment (50/30/20 split)
 *
 * Query Parameters:
 * - actor_type: 'branch' | 'loan-officer' (default: 'loan-officer')
 * - date_range: 'last-year' | 'last-quarter' | 'last-month' | 'ytd' | 'qtd' | 'mtd' | 'custom'
 * - start_date: ISO date string (for custom range)
 * - end_date: ISO date string (for custom range)
 * - channel_group: 'Retail' | 'TPO' | specific channel
 */
router.get(
  "/comparison",
  authenticateToken,
  attachTenantContext,
  apiLimiter,
  async (req: AuthRequest, res) => {
    try {
      const tenantPool = getTenantContext(req).tenantPool;

      // Get tenant-specific revenue expression (or default if none configured)
      const revenueExpression = await getTenantRevenueExpression(tenantPool);

      const actorType = (req.query.actor_type as string) || "loan-officer";
      const dateRange = (req.query.date_range as string) || "last-year";
      const startDateParam = req.query.start_date as string | undefined;
      const endDateParam = req.query.end_date as string | undefined;
      const channelGroup = req.query.channel_group as string | undefined;

      // Validate actor type
      if (!["branch", "loan-officer"].includes(actorType)) {
        return res.status(400).json({
          error: 'Invalid actor_type. Must be "branch" or "loan-officer"',
        });
      }

      // For TPO channels, use account_executive instead of loan_officer
      // Branch remains the same regardless of channel
      const actorColumn =
        actorType === "branch"
          ? "branch"
          : getActorColumnForChannel(channelGroup);
      const actorIdColumn =
        actorType === "branch"
          ? "branch"
          : actorColumn === "account_executive"
          ? "account_executive"
          : "loan_officer_id";

      // Get vMaxDate
      const vMaxDate = await getVMaxDate(tenantPool);

      // Calculate effective date range
      let effectiveStartDate: Date;
      let effectiveEndDate: Date;
      let dateRangeLabel: string;

      if (dateRange === "custom" && startDateParam && endDateParam) {
        effectiveStartDate = new Date(startDateParam);
        effectiveEndDate = new Date(endDateParam);
        dateRangeLabel = "Custom Range";
      } else {
        effectiveEndDate = new Date(vMaxDate);

        switch (dateRange) {
          case "last-year":
            effectiveStartDate = new Date(vMaxDate.getFullYear() - 1, 0, 1);
            effectiveEndDate = new Date(vMaxDate.getFullYear() - 1, 11, 31);
            dateRangeLabel = "Last Year";
            break;
          case "last-quarter":
            const currentQuarter = Math.floor(vMaxDate.getMonth() / 3);
            const lastQuarter = currentQuarter - 1;
            if (lastQuarter < 0) {
              effectiveStartDate = new Date(vMaxDate.getFullYear() - 1, 9, 1);
              effectiveEndDate = new Date(vMaxDate.getFullYear() - 1, 11, 31);
            } else {
              effectiveStartDate = new Date(
                vMaxDate.getFullYear(),
                lastQuarter * 3,
                1
              );
              effectiveEndDate = new Date(
                vMaxDate.getFullYear(),
                (lastQuarter + 1) * 3,
                0
              );
            }
            dateRangeLabel = "Last Quarter";
            break;
          case "last-month":
            const lastMonth = new Date(vMaxDate);
            lastMonth.setMonth(lastMonth.getMonth() - 1);
            effectiveStartDate = new Date(
              lastMonth.getFullYear(),
              lastMonth.getMonth(),
              1
            );
            effectiveEndDate = new Date(
              lastMonth.getFullYear(),
              lastMonth.getMonth() + 1,
              0
            );
            dateRangeLabel = "Last Month";
            break;
          case "ytd":
            effectiveStartDate = new Date(vMaxDate.getFullYear(), 0, 1);
            effectiveEndDate = new Date(vMaxDate);
            dateRangeLabel = "Year to Date";
            break;
          case "qtd":
            const qStart = Math.floor(vMaxDate.getMonth() / 3) * 3;
            effectiveStartDate = new Date(vMaxDate.getFullYear(), qStart, 1);
            effectiveEndDate = new Date(vMaxDate);
            dateRangeLabel = "Quarter to Date";
            break;
          case "mtd":
            effectiveStartDate = new Date(
              vMaxDate.getFullYear(),
              vMaxDate.getMonth(),
              1
            );
            effectiveEndDate = new Date(vMaxDate);
            dateRangeLabel = "Month to Date";
            break;
          case "trailing-12":
            // Trailing 12 months from vMaxDate (most useful for performance analysis)
            effectiveStartDate = new Date(vMaxDate);
            effectiveStartDate.setFullYear(
              effectiveStartDate.getFullYear() - 1
            );
            effectiveEndDate = new Date(vMaxDate);
            dateRangeLabel = "Trailing 12 Months";
            break;
          default:
            // Default to YTD instead of Last Year for better UX
            effectiveStartDate = new Date(vMaxDate.getFullYear(), 0, 1);
            effectiveEndDate = new Date(vMaxDate);
            dateRangeLabel = "Year to Date";
        }
      }

      logInfo("[TopTiering/Comparison] Start", {
        actorType,
        dateRange,
        channel: channelGroup,
        startDate: effectiveStartDate.toISOString(),
        endDate: effectiveEndDate.toISOString(),
      });

      // Build channel filter using shared utility (correctly handles Retail vs TPO grouping)
      const channelCondition = buildChannelWhereClause(channelGroup);
      // Channel-aware funded filter: Retail uses rate_lock > 0, TPO/All do not.
      const compFundedFilter = buildFundedFilter(channelGroup);
      const queryParams: any[] = [
        effectiveStartDate.toISOString().split("T")[0],
        effectiveEndDate.toISOString().split("T")[0],
      ];

      // Aggregate data by actor with tenant-specific revenue calculation
      const actorDataQuery = `
      WITH funded_loans AS (
        SELECT 
          ${actorColumn} AS actor_name,
          ${actorIdColumn} AS actor_id,
          loan_id,
          COALESCE(loan_number, loan_id::text) AS loan_number,
          loan_amount,
          funding_date,
          (${revenueExpression}) AS revenue
        FROM public.loans
        WHERE ${compFundedFilter}
          AND funding_date >= $1
          AND funding_date <= $2
          ${channelCondition}
      ),
      actor_aggregates AS (
        SELECT 
          actor_name,
          actor_id,
          COUNT(DISTINCT COALESCE(loan_number, loan_id::text)) AS units,
          SUM(loan_amount) AS volume,
          SUM(revenue) AS revenue,
          CASE 
            WHEN SUM(loan_amount) > 0 THEN (SUM(revenue) / SUM(loan_amount)) * 10000 
            ELSE 0 
          END AS revenue_bps,
          CASE 
            WHEN COUNT(DISTINCT COALESCE(loan_number, loan_id::text)) > 0 
            THEN SUM(revenue) / COUNT(DISTINCT COALESCE(loan_number, loan_id::text)) 
            ELSE 0 
          END AS revenue_per_loan
        FROM funded_loans
        WHERE actor_name IS NOT NULL 
          AND actor_name != ''
          AND actor_name NOT ILIKE '99-%'
          AND actor_name NOT ILIKE 'Missing'
          AND actor_name NOT ILIKE 'No LO Found'
          AND actor_name NOT ILIKE 'No Loan Officer'
          AND actor_name NOT ILIKE 'No Branch Found'
          AND actor_name NOT ILIKE 'Unknown'
        GROUP BY actor_name, actor_id
        HAVING SUM(revenue) > 0
      )
      SELECT * FROM actor_aggregates
      ORDER BY revenue DESC
    `;

      const actorDataResult = await tenantPool.query(
        actorDataQuery,
        queryParams
      );

      // Filter with helper function
      const rawActors = actorDataResult.rows.filter(
        (row) => !isActorMissing(row.actor_name)
      );

      // Calculate totals
      const totalRevenue = rawActors.reduce(
        (sum, a) => sum + parseFloat(a.revenue || 0),
        0
      );
      const totalUnits = rawActors.reduce(
        (sum, a) => sum + parseInt(a.units || 0),
        0
      );
      const totalVolume = rawActors.reduce(
        (sum, a) => sum + parseFloat(a.volume || 0),
        0
      );

      // Assign tiers (50/80 thresholds)
      let cumulativeRevenue = 0;
      const actorsWithTiers = rawActors.map((actor) => {
        const actorRevenue = parseFloat(actor.revenue || 0);
        cumulativeRevenue += actorRevenue;
        const cumulativePercent =
          totalRevenue > 0 ? (cumulativeRevenue / totalRevenue) * 100 : 0;

        let tier: "top" | "second" | "bottom";
        if (cumulativePercent <= 50) {
          tier = "top";
        } else if (cumulativePercent <= 80) {
          tier = "second";
        } else {
          tier = "bottom";
        }

        return {
          id: actor.actor_id || actor.actor_name,
          name: actor.actor_name,
          tier,
          revenue: actorRevenue,
          units: parseInt(actor.units || 0),
          volume: parseFloat(actor.volume || 0),
          revenueBPS: parseFloat(actor.revenue_bps || 0),
          revenuePerLoan: parseFloat(actor.revenue_per_loan || 0),
          cumulativeRevenuePercent: cumulativePercent,
        };
      });

      // Add cumulative units percentage
      let cumulativeUnits = 0;
      actorsWithTiers.forEach((actor) => {
        cumulativeUnits += actor.units;
        (actor as any).cumulativeUnitsPercent =
          totalUnits > 0 ? (cumulativeUnits / totalUnits) * 100 : 0;
      });

      // Tier summaries
      const tierSummary = {
        top: {
          count: 0,
          revenue: 0,
          revenuePercent: 0,
          units: 0,
          unitsPercent: 0,
          avgRevenue: 0,
          avgUnits: 0,
        },
        second: {
          count: 0,
          revenue: 0,
          revenuePercent: 0,
          units: 0,
          unitsPercent: 0,
          avgRevenue: 0,
          avgUnits: 0,
        },
        bottom: {
          count: 0,
          revenue: 0,
          revenuePercent: 0,
          units: 0,
          unitsPercent: 0,
          avgRevenue: 0,
          avgUnits: 0,
        },
      };

      actorsWithTiers.forEach((actor) => {
        tierSummary[actor.tier].count += 1;
        tierSummary[actor.tier].revenue += actor.revenue;
        tierSummary[actor.tier].units += actor.units;
      });

      (["top", "second", "bottom"] as const).forEach((tier) => {
        const t = tierSummary[tier];
        t.revenuePercent =
          totalRevenue > 0 ? (t.revenue / totalRevenue) * 100 : 0;
        t.unitsPercent = totalUnits > 0 ? (t.units / totalUnits) * 100 : 0;
        t.avgRevenue = t.count > 0 ? t.revenue / t.count : 0;
        t.avgUnits = t.count > 0 ? t.units / t.count : 0;
      });

      // YoY growth calculation
      let yoyGrowth: number | undefined;
      try {
        const lastYearStart = new Date(effectiveStartDate);
        lastYearStart.setFullYear(lastYearStart.getFullYear() - 1);
        const lastYearEnd = new Date(effectiveEndDate);
        lastYearEnd.setFullYear(lastYearEnd.getFullYear() - 1);

        const lastYearQuery = `
        SELECT SUM(${revenueExpression}) AS last_year_revenue
        FROM public.loans
        WHERE ${compFundedFilter}
          AND funding_date >= $1
          AND funding_date <= $2
          ${channelCondition}
      `;

        const lastYearParams = [
          lastYearStart.toISOString().split("T")[0],
          lastYearEnd.toISOString().split("T")[0],
        ];
        if (
          channelGroup &&
          channelGroup !== "Retail" &&
          channelGroup !== "TPO"
        ) {
          lastYearParams.push(channelGroup);
        }

        const lastYearResult = await tenantPool.query(
          lastYearQuery,
          lastYearParams
        );
        const lastYearRevenue = parseFloat(
          lastYearResult.rows[0]?.last_year_revenue || 0
        );

        if (lastYearRevenue > 0) {
          yoyGrowth =
            ((totalRevenue - lastYearRevenue) / lastYearRevenue) * 100;
        }
      } catch (e) {
        logWarn("[TopTiering/Comparison] Failed to calculate YoY growth", {
          error: e,
        });
      }

      logInfo("[TopTiering/Comparison] Complete", {
        actors: actorsWithTiers.length,
        totalRevenue,
        totalUnits,
      });

      res.json({
        actors: actorsWithTiers,
        totals: {
          revenue: totalRevenue,
          units: totalUnits,
          volume: totalVolume,
          avgRevenueBPS:
            totalVolume > 0 ? (totalRevenue / totalVolume) * 10000 : 0,
          actorCount: actorsWithTiers.length,
          avgRevenuePerActor:
            actorsWithTiers.length > 0
              ? totalRevenue / actorsWithTiers.length
              : 0,
          avgUnitsPerActor:
            actorsWithTiers.length > 0
              ? totalUnits / actorsWithTiers.length
              : 0,
        },
        tierSummary,
        dateRange: {
          start: effectiveStartDate.toISOString().split("T")[0],
          end: effectiveEndDate.toISOString().split("T")[0],
          label: dateRangeLabel,
          periodType: dateRange,
        },
        yoyGrowth,
      });
    } catch (error: any) {
      logError("Error fetching toptiering comparison data", error, {
        userId: req.userId,
      });
      res.status(500).json({
        error: error.message || "Failed to fetch toptiering comparison data",
      });
    }
  }
);

export default router;
