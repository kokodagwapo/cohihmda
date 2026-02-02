/**
 * Scorecard API Routes
 * Consolidated endpoints for Sales and Operations Scorecards
 * 
 * Migrated from /api/loans/* to /api/scorecard/*
 * Old endpoints remain as aliases for backward compatibility
 */

import { Router } from 'express';
import { pool, retryQuery, handleDatabaseError } from '../../config/database.js';
import { authenticateToken, AuthRequest } from '../../middleware/auth.js';
import { attachTenantContext, getTenantContext } from '../../middleware/tenantContext.js';
import { apiLimiter } from '../../middleware/rateLimiter.js';
import { logError, logWarn, logInfo, logDebug } from '../../services/logger.js';
import { getLoanAccessContext } from '../../services/userLoanAccessService.js';
import {
  isActorMissing,
  filterByChannel,
  buildChannelWhereClause,
  buildActorNotMissingClause,
  calcLoanRevenue,
  calcLoanComplexity,
  getVMaxDate,
  formatDateForSQL,
  formatMonthKey,
  assignTTSTier,
  OPERATIONS_ACTOR_CONFIGS,
  SALES_ACTOR_CONFIGS,
  REVENUE_SQL_EXPRESSION,
  TTS_TIER_THRESHOLDS,
  OPS_TTS_WEIGHTS,
  SALES_TTS_WEIGHTS,
  type ActorConfig,
  type ActorMissingMode,
  type TTSTier,
} from '../../utils/scorecard-utils.js';

const router = Router();

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
router.get('/sales', authenticateToken, attachTenantContext, apiLimiter, async (req: AuthRequest, res) => {
  try {
    const tenantPool = getTenantContext(req).tenantPool;

    // Get user's loan access context
    const accessCtx = await getLoanAccessContext(req, tenantPool);
    
    // If user has no access, return empty scorecard
    if (accessCtx.hasNoAccess) {
      return res.json({
        actor: req.query.actor || 'loan_officer',
        dateRange: { start: '', end: '' },
        data: [],
        summary: { actorCount: 0, avgTTS: 0, medianTTS: 0, totalVolume: 0 }
      });
    }

    const actor = (req.query.actor as string) || 'loan_officer';
    const startDate = req.query.startDate as string | undefined;
    const endDate = req.query.endDate as string | undefined;
    const channelGroup = req.query.channel_group as string | undefined;

    // Validate actor type
    if (!['branch', 'loan_officer'].includes(actor)) {
      return res.status(400).json({ error: 'Invalid actor type. Must be "branch" or "loan_officer"' });
    }

    const actorColumn = actor === 'branch' ? 'branch' : 'loan_officer';

    // Get vMaxDate from data (matching Qlik's Max("Last Modified Date"))
    const vMaxDate = await getVMaxDate(tenantPool);
    
    // Calculate Rolling 13 Month date range
    const effectiveEndDate = vMaxDate;
    const effectiveStartDate = new Date(vMaxDate.getFullYear(), vMaxDate.getMonth() - 12, 1);
    
    logInfo('[Scorecard/Sales] Start', { actor, channel: channelGroup, hasAccessFilter: accessCtx.requiresFiltering });

    // TTS Weight Configuration - matches Qlik eCCA_TVI_Score_13_Months formula
    const weightConfig = SALES_TTS_WEIGHTS;

    // SQL filtering setup
    const channelClause = buildChannelWhereClause(channelGroup);
    const startDateStr = formatDateForSQL(effectiveStartDate);
    const endDateStr = formatDateForSQL(effectiveEndDate);
    
    // Build access filter clause
    const { accessClause, accessParams } = accessCtx.buildWhereClause('', 3); // Params start at $3 (after $1, $2 for dates)
    const accessFilterClause = accessClause ? accessClause.replace(/^AND\s+/, 'AND ') : '';

    // Build query params - access filter params come after date params
    const fundedQueryParams = accessCtx.requiresFiltering 
      ? [startDateStr, endDateStr, accessCtx.userId]
      : [startDateStr, endDateStr];
    
    const accessWhereClause = accessCtx.requiresFiltering 
      ? `AND guid IN (SELECT loan_guid FROM user_loan_access WHERE user_id = $3)` 
      : '';

    // Fetch FUNDED loans (main data for scorecard - DateType={'Funding'})
    const fundedLoansResult = await retryQuery(
      () => tenantPool.query(
        `SELECT 
          loan_id, loan_amount, loan_type, loan_purpose, current_loan_status, channel,
          funding_date, closing_date, application_date, started_date,
          branch, loan_officer, fico_score, ltv_ratio, be_dti_ratio,
          origination_points, orig_fee_borr_pd, orig_fees_seller, cd_lender_credits,
          branch_price_concession, occupancy_type, borr_self_employed,
          rate_lock_buy_side_base_price_rate,
          number_of_conditions, date_warehoused, investor_status, investor_purchase_date
         FROM loans
         WHERE funding_date IS NOT NULL
           AND funding_date >= $1
           AND funding_date <= $2
           AND ${actorColumn} IS NOT NULL
           AND TRIM(${actorColumn}) != ''
           AND UPPER(TRIM(${actorColumn})) NOT IN ('99-MISSING', 'MISSING', 'NO LO FOUND', 'NO LOAN OFFICER', 'NO BRANCH FOUND', 'UNKNOWN')
           AND UPPER(TRIM(${actorColumn})) NOT LIKE '99-%'
           ${accessWhereClause}
           ${channelClause}`,
        fundedQueryParams
      ),
      2, 500
    );
    const fundedLoans = fundedLoansResult.rows;

    // Fetch supporting loans (for pull-through calculation - DateType={'Application'})
    const supportingLoansResult = await retryQuery(
      () => tenantPool.query(
        `SELECT 
          loan_id, loan_amount, loan_type, loan_purpose, current_loan_status, channel,
          funding_date, closing_date, application_date, started_date,
          branch, loan_officer, fico_score, ltv_ratio, be_dti_ratio,
          origination_points, orig_fee_borr_pd, orig_fees_seller, cd_lender_credits,
          rate_lock_buy_side_base_price_rate
         FROM loans
         WHERE COALESCE(started_date, application_date) >= $1
           AND COALESCE(started_date, application_date) <= $2
           ${accessWhereClause}
           ${channelClause}`,
        fundedQueryParams
      ),
      2, 500
    );
    const channelFilteredLoans = supportingLoansResult.rows;

    logInfo('[Scorecard/Sales] Data loaded', { funded: fundedLoans.length, supporting: channelFilteredLoans.length });

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
      
      const status = (l.current_loan_status || '').toUpperCase().trim();
      const isActiveLoan = status === 'ACTIVE LOAN';
      if (isActiveLoan) return; // Skip active loans for pull-through
      
      actorApplicationCount.set(actorName, (actorApplicationCount.get(actorName) || 0) + 1);
      
      if (l.funding_date) {
        actorFundedCount.set(actorName, (actorFundedCount.get(actorName) || 0) + 1);
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
      };

      const loanAmount = parseFloat(l.loan_amount) || 0;
      existing.units += 1;
      existing.volume += loanAmount;
      
      const revenue = calcLoanRevenue(l);
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
        const diffMs = new Date(l.closing_date).getTime() - new Date(l.application_date).getTime();
        const days = Math.round(diffMs / (1000 * 60 * 60 * 24));
        if (days > 0) {
          existing.turnTimes.push(days);
        }
      }

      // Loan complexity
      existing.complexityScores.push(calcLoanComplexity(l));

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

      actorMap.set(actorName, existing);
    });

    // Count lost opportunities and denied loans
    channelFilteredLoans.forEach((l: any) => {
      const actorName = l[actorColumn];
      if (!actorMap.has(actorName)) return;
      
      const status = (l.current_loan_status || '').toUpperCase();
      const appDate = l.application_date;
      if (!appDate) return;
      const ad = new Date(appDate);
      if (ad < effectiveStartDate || ad > effectiveEndDate) return;

      const existing = actorMap.get(actorName)!;
      
      // Lost opportunity (withdrawn, not accepted, incomplete)
      if (status.includes('WITHDRAWN') || status.includes('CANCELLED') ||
          status.includes('NOT ACCEPTED') || status.includes('INCOMPLETE')) {
        existing.lostOpportunityUnits += 1;
        existing.lostOpportunityRevenue += calcLoanRevenue(l);
      }
      
      // Denied
      if (status.includes('DENIED') || status.includes('DECLINED')) {
        existing.deniedUnits += 1;
      }
    });

    // Calculate company-wide averages for rating normalization
    const allMetrics = Array.from(actorMap.values()).filter(a => a.units > 0);
    
    const totalUnits = allMetrics.reduce((sum, a) => sum + a.units, 0);
    const totalVolume = allMetrics.reduce((sum, a) => sum + a.volume, 0);
    const totalRevenue = allMetrics.reduce((sum, a) => sum + a.revenue, 0);
    
    const avgUnits = allMetrics.length > 0 ? totalUnits / allMetrics.length : 0;
    const avgVolume = allMetrics.length > 0 ? totalVolume / allMetrics.length : 0;
    const avgRevenue = allMetrics.length > 0 ? totalRevenue / allMetrics.length : 0;
    const avgMarginBps = totalVolume > 0 ? (totalRevenue / totalVolume) * 10000 : 0;
    
    // Turn time average
    const allTurnTimes = allMetrics.flatMap(a => a.turnTimes);
    const companyAvgTurnTime = allTurnTimes.length > 0
      ? allTurnTimes.reduce((a, b) => a + b, 0) / allTurnTimes.length
      : 0;
    
    // Pull through average
    const totalAppCount = allMetrics.reduce((sum, a) => sum + a.applicationCount, 0);
    const totalFundedForPT = allMetrics.reduce((sum, a) => sum + a.fundedForPullThrough, 0);
    const companyPullThrough = totalAppCount > 0 ? (totalFundedForPT / totalAppCount) * 100 : 0;

    // Concession average
    const allConcessions = allMetrics.flatMap(a => a.concessions);
    const companyAvgConcession = allConcessions.length > 0
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

    // Calculate TTS scores for each actor
    const actorsWithScores = allMetrics.map(actor => {
      // Individual metrics
      const actorMarginBps = actor.volume > 0 ? (actor.revenue / actor.volume) * 10000 : 0;
      const actorAvgTurnTime = actor.turnTimes.length > 0
        ? actor.turnTimes.reduce((a, b) => a + b, 0) / actor.turnTimes.length
        : 0;
      const actorPullThrough = actor.applicationCount > 0
        ? (actor.fundedForPullThrough / actor.applicationCount) * 100
        : 0;
      const actorAvgConcession = actor.concessions.length > 0
        ? actor.concessions.reduce((a, b) => a + b, 0) / actor.concessions.length
        : 0;
      const actorAvgComplexity = actor.complexityScores.length > 0
        ? actor.complexityScores.reduce((a, b) => a + b, 0) / actor.complexityScores.length
        : 100;

      // Calculate ratings (actor / company avg * 100)
      const volumeRating = avgVolume > 0 ? (actor.volume / avgVolume) * 100 : 100;
      const marginRating = avgMarginBps > 0 ? (actorMarginBps / avgMarginBps) * 100 : 100;
      const unitRating = avgUnits > 0 ? (actor.units / avgUnits) * 100 : 100;
      
      // Turn time: LOWER is BETTER (inverted)
      const turnTimeRating = actorAvgTurnTime > 0 && companyAvgTurnTime > 0
        ? (companyAvgTurnTime / actorAvgTurnTime) * 100
        : 100;
      
      // Pull through rating
      const pullThroughRating = companyPullThrough > 0
        ? (actorPullThrough / companyPullThrough) * 100
        : 100;
      
      // Concession rating: LOWER concession is BETTER (inverted)
      const concessionRating = actorAvgConcession !== 0 && companyAvgConcession !== 0
        ? (companyAvgConcession / actorAvgConcession) * 100
        : 100;

      // TTS Score calculation (6 components)
      const ttsScore = (
        (volumeRating * weightConfig.volume) +
        (marginRating * weightConfig.margin) +
        (turnTimeRating * weightConfig.turnTime) +
        (pullThroughRating * weightConfig.pullThrough) +
        (unitRating * weightConfig.unit) +
        (concessionRating * weightConfig.concession)
      ) / 10;

      // Assign tier
      const tier = assignTTSTier(ttsScore);

      // Weighted averages
      const waFico = actor.ficoWeighted.weight > 0
        ? actor.ficoWeighted.sum / actor.ficoWeighted.weight
        : 0;
      const waLtv = actor.ltvWeighted.weight > 0
        ? actor.ltvWeighted.sum / actor.ltvWeighted.weight
        : 0;
      const waDti = actor.dtiWeighted.weight > 0
        ? actor.dtiWeighted.sum / actor.dtiWeighted.weight
        : 0;

      return {
        name: actor.name,
        units: actor.units,
        volume: actor.volume,
        revenue: actor.revenue,
        revenueBps: actorMarginBps,
        avgTurnTime: actorAvgTurnTime,
        pullThrough: actorPullThrough,
        avgConcession: actorAvgConcession,
        avgComplexity: actorAvgComplexity,
        waFico,
        waLtv,
        waDti,
        lostOpportunityUnits: actor.lostOpportunityUnits,
        lostOpportunityRevenue: actor.lostOpportunityRevenue,
        deniedUnits: actor.deniedUnits,
        // Ratings
        volumeRating,
        marginRating,
        unitRating,
        turnTimeRating,
        pullThroughRating,
        concessionRating,
        ttsScore,
        tier,
      };
    }).sort((a, b) => b.ttsScore - a.ttsScore);

    // Calculate tier summaries
    const topActors = actorsWithScores.filter(a => a.tier === 'top');
    const secondActors = actorsWithScores.filter(a => a.tier === 'second');
    const bottomActors = actorsWithScores.filter(a => a.tier === 'bottom');

    const calcTierSummary = (actors: typeof actorsWithScores) => {
      if (actors.length === 0) {
        return {
          count: 0,
          units: 0,
          volume: 0,
          revenue: 0,
          avgTtsScore: 0,
          avgTurnTime: 0,
          pullThrough: 0,
        };
      }
      return {
        count: actors.length,
        units: actors.reduce((sum, a) => sum + a.units, 0),
        volume: actors.reduce((sum, a) => sum + a.volume, 0),
        revenue: actors.reduce((sum, a) => sum + a.revenue, 0),
        avgTtsScore: actors.reduce((sum, a) => sum + a.ttsScore, 0) / actors.length,
        avgTurnTime: actors.reduce((sum, a) => sum + a.avgTurnTime, 0) / actors.length,
        pullThrough: actors.reduce((sum, a) => sum + a.pullThrough, 0) / actors.length,
      };
    };

    const tierSummary = {
      top: calcTierSummary(topActors),
      second: calcTierSummary(secondActors),
      bottom: calcTierSummary(bottomActors),
    };

    // Company totals
    const totals = {
      actorCount: actorsWithScores.length,
      units: totalUnits,
      volume: totalVolume,
      revenue: totalRevenue,
      revenueBps: totalVolume > 0 ? (totalRevenue / totalVolume) * 10000 : 0,
      avgTurnTime: companyAvgTurnTime,
      pullThrough: companyPullThrough,
      avgTtsScore: actorsWithScores.length > 0
        ? actorsWithScores.reduce((sum, a) => sum + a.ttsScore, 0) / actorsWithScores.length
        : 0,
    };

    logInfo('[Scorecard/Sales] Complete', { actors: actorsWithScores.length, totalUnits });

    res.json({
      actors: actorsWithScores,
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
    logError('Error fetching sales scorecard data', error, { userId: req.userId });
    res.status(500).json({ error: error.message || 'Failed to fetch sales scorecard data' });
  }
});

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
router.get('/operations', authenticateToken, attachTenantContext, apiLimiter, async (req: AuthRequest, res) => {
  try {
    const tenantPool = getTenantContext(req).tenantPool;
    
    const actorType = (req.query.actor_type as string) || 'underwriter';
    const dateRange = (req.query.date_range as string) || '3-months';
    const channelGroup = req.query.channel_group as string | undefined;
    
    // Validate actor type
    if (!['processor', 'underwriter', 'closer'].includes(actorType)) {
      return res.status(400).json({ error: 'Invalid actor_type. Must be "processor", "underwriter", or "closer"' });
    }
    
    const monthsMap: Record<string, number> = { '3-months': 3, '6-months': 6, '12-months': 12 };
    const monthsBack = monthsMap[dateRange] || 3;
    
    const config = OPERATIONS_ACTOR_CONFIGS[actorType];
    const weightConfig = OPS_TTS_WEIGHTS;
    
    // Get vMaxDate
    const vMaxDate = await getVMaxDate(tenantPool);
    
    // Calculate date range
    const effectiveEndDate = new Date(vMaxDate);
    const effectiveStartDate = new Date(vMaxDate.getFullYear(), vMaxDate.getMonth() - monthsBack, 1);
    
    logInfo('[Scorecard/Operations] Start', { actorType, dateRange, channel: channelGroup });
    
    // SQL filtering
    const channelClause = buildChannelWhereClause(channelGroup);
    const startDateStr = formatDateForSQL(effectiveStartDate);
    const endDateStr = formatDateForSQL(effectiveEndDate);
    
    // Fetch loans with output date in range
    const outputLoansResult = await tenantPool.query(`
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
    `, [startDateStr, endDateStr]);
    
    const outputLoans = outputLoansResult.rows;
    logInfo('[Scorecard/Operations] Loans loaded', { count: outputLoans.length });

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
    const calcOpsComplexity = (l: any): number => {
      let complexity = 0;
      
      // Government loan bonus (15%)
      const loanType = (l.loan_type || '').toUpperCase();
      if (loanType.includes('FHA') || loanType.includes('VA') || loanType.includes('USDA')) {
        complexity += 0.15;
      }
      
      // Purchase transaction bonus (10%)
      const loanPurpose = (l.loan_purpose || '').toUpperCase();
      if (loanPurpose.includes('PURCHASE')) {
        complexity += 0.10;
      }
      
      // Risk factors
      const fico = parseFloat(l.fico_score) || 0;
      const ltv = parseFloat(l.ltv_ratio) || 0;
      const dti = parseFloat(l.be_dti_ratio) || 0;
      
      if (fico > 0 && fico < 680) complexity += 0.02;
      if (ltv > 80) complexity += 0.02;
      if (dti > 43) complexity += 0.01;
      
      return (1 + complexity) * 100;
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
      if (isActorMissing(actorName, 'strict')) return;

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
      const loanType = (l.loan_type || '').toUpperCase();
      if (loanType.includes('FHA') || loanType.includes('VA') || loanType.includes('USDA')) {
        existing.governmentLoans += 1;
      }
      
      const loanPurpose = (l.loan_purpose || '').toUpperCase();
      if (loanPurpose.includes('PURCHASE')) {
        existing.purchaseLoans += 1;
      }

      // Status counts
      const status = (l.current_loan_status || '').toUpperCase();
      if (status.includes('APPROVED') || status.includes('ORIGINATED')) {
        existing.approvedLoans += 1;
      }
      if (status.includes('DENIED')) {
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
    const allActors = Array.from(actorMap.values()).filter(a => a.units > 0);
    
    // Calculate company averages
    const totalUnits = allActors.reduce((sum, a) => sum + a.units, 0);
    const totalVolume = allActors.reduce((sum, a) => sum + a.volume, 0);
    const avgUnits = allActors.length > 0 ? totalUnits / allActors.length : 0;
    
    const allTurnTimes = allActors.flatMap(a => a.turnTimes);
    const companyAvgTurnTime = allTurnTimes.length > 0
      ? allTurnTimes.reduce((a, b) => a + b, 0) / allTurnTimes.length
      : 0;
    
    const allComplexities = allActors.flatMap(a => a.complexityScores);
    const companyAvgComplexity = allComplexities.length > 0
      ? allComplexities.reduce((a, b) => a + b, 0) / allComplexities.length
      : 100;

    // Calculate TTS scores
    const actorsWithScores = allActors.map(actor => {
      const actorAvgTurnTime = actor.turnTimes.length > 0
        ? actor.turnTimes.reduce((a, b) => a + b, 0) / actor.turnTimes.length
        : 0;
      const actorAvgComplexity = actor.complexityScores.length > 0
        ? actor.complexityScores.reduce((a, b) => a + b, 0) / actor.complexityScores.length
        : 100;

      // Calculate ratings
      const unitRating = avgUnits > 0 ? (actor.units / avgUnits) * 100 : 100;
      const turnTimeRating = actorAvgTurnTime > 0 && companyAvgTurnTime > 0
        ? (companyAvgTurnTime / actorAvgTurnTime) * 100 // Lower is better
        : 100;
      const complexityRating = companyAvgComplexity > 0
        ? (actorAvgComplexity / companyAvgComplexity) * 100
        : 100;

      // TTS Score (70/15/15)
      const ttsScore = (
        (unitRating * weightConfig.units) +
        (turnTimeRating * weightConfig.turnTime) +
        (complexityRating * weightConfig.complexity)
      );

      const tier = assignTTSTier(ttsScore);

      // Weighted averages
      const waFico = actor.ficoWeight > 0 ? actor.ficoWeightedSum / actor.ficoWeight : 0;
      const waLtv = actor.ltvWeight > 0 ? actor.ltvWeightedSum / actor.ltvWeight : 0;

      // Percentages
      const totalDecisions = actor.approvedLoans + actor.deniedLoans;
      const approvedPercent = totalDecisions > 0 ? (actor.approvedLoans / totalDecisions) * 100 : 0;
      const deniedPercent = totalDecisions > 0 ? (actor.deniedLoans / totalDecisions) * 100 : 0;
      const governmentPercent = actor.units > 0 ? (actor.governmentLoans / actor.units) * 100 : 0;
      const purchasePercent = actor.units > 0 ? (actor.purchaseLoans / actor.units) * 100 : 0;

      return {
        name: actor.name,
        units: actor.units,
        volume: actor.volume,
        avgDays: actorAvgTurnTime,
        avgComplexity: actorAvgComplexity,
        waFico,
        waLtv,
        approvedPercent,
        deniedPercent,
        governmentPercent,
        purchasePercent,
        unitRating,
        turnTimeRating,
        complexityRating,
        ttsScore,
        tier,
      };
    }).sort((a, b) => b.ttsScore - a.ttsScore);

    // Tier summaries
    const topActors = actorsWithScores.filter(a => a.tier === 'top');
    const secondActors = actorsWithScores.filter(a => a.tier === 'second');
    const bottomActors = actorsWithScores.filter(a => a.tier === 'bottom');

    const calcOpsTierSummary = (actors: typeof actorsWithScores) => {
      if (actors.length === 0) {
        return {
          count: 0,
          units: 0,
          unitsPercent: 0,
          volume: 0,
          avgDays: 0,
          avgComplexity: 100,
          avgTtsScore: 0,
        };
      }
      const tierUnits = actors.reduce((sum, a) => sum + a.units, 0);
      return {
        count: actors.length,
        units: tierUnits,
        unitsPercent: totalUnits > 0 ? (tierUnits / totalUnits) * 100 : 0,
        volume: actors.reduce((sum, a) => sum + a.volume, 0),
        avgDays: actors.reduce((sum, a) => sum + a.avgDays, 0) / actors.length,
        avgComplexity: actors.reduce((sum, a) => sum + a.avgComplexity, 0) / actors.length,
        avgTtsScore: actors.reduce((sum, a) => sum + a.ttsScore, 0) / actors.length,
      };
    };

    const tierSummary = {
      top: calcOpsTierSummary(topActors),
      second: calcOpsTierSummary(secondActors),
      bottom: calcOpsTierSummary(bottomActors),
    };

    // Company totals
    const totals = {
      actorCount: actorsWithScores.length,
      units: totalUnits,
      volume: totalVolume,
      avgDays: companyAvgTurnTime,
      avgComplexity: companyAvgComplexity,
    };

    const companyAverages = {
      units: avgUnits,
      turnTime: companyAvgTurnTime,
      complexity: companyAvgComplexity,
    };

    logInfo('[Scorecard/Operations] Complete', { actors: actorsWithScores.length, totalUnits });

    res.json({
      actors: actorsWithScores,
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
    logError('Error fetching operations scorecard data', error, { userId: req.userId });
    res.status(500).json({ error: error.message || 'Failed to fetch operations scorecard data' });
  }
});

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
router.get('/operations-trends', authenticateToken, attachTenantContext, apiLimiter, async (req: AuthRequest, res) => {
  try {
    const tenantPool = getTenantContext(req).tenantPool;
    
    const actorType = (req.query.actor_type as string) || 'underwriter';
    const monthsCount = parseInt(req.query.months as string) || 12;
    const channelGroup = req.query.channel_group as string | undefined;
    
    if (!['processor', 'underwriter', 'closer'].includes(actorType)) {
      return res.status(400).json({ error: 'Invalid actor_type' });
    }
    
    const config = OPERATIONS_ACTOR_CONFIGS[actorType];
    const vMaxDate = await getVMaxDate(tenantPool);
    
    const effectiveEndDate = new Date(vMaxDate);
    const effectiveStartDate = new Date(vMaxDate.getFullYear(), vMaxDate.getMonth() - monthsCount, 1);
    
    const channelClause = buildChannelWhereClause(channelGroup);
    const startDateStr = formatDateForSQL(effectiveStartDate);
    const endDateStr = formatDateForSQL(effectiveEndDate);
    
    logInfo('[Scorecard/Operations-Trends] Start', { actorType, months: monthsCount });
    
    // Fetch loans with monthly breakdown
    const loansResult = await tenantPool.query(`
      SELECT 
        ${config.actorColumn} as actor_name,
        TO_CHAR(${config.outputDateField}, 'YYYY-MM') as month,
        COUNT(DISTINCT COALESCE(loan_number, loan_id::text)) as units,
        SUM(loan_amount) as volume
      FROM loans
      WHERE ${config.outputDateField} IS NOT NULL
        AND ${config.outputDateField} >= $1
        AND ${config.outputDateField} < $2
        AND ${config.actorColumn} IS NOT NULL
        AND TRIM(${config.actorColumn}) != ''
        AND UPPER(TRIM(${config.actorColumn})) != '99-MISSING'
        ${channelClause}
      GROUP BY ${config.actorColumn}, TO_CHAR(${config.outputDateField}, 'YYYY-MM')
      ORDER BY ${config.actorColumn}, month
    `, [startDateStr, endDateStr]);
    
    // Build actor trends data structure
    const actorMonthlyData = new Map<string, Map<string, { units: number; volume: number }>>();
    const allMonths = new Set<string>();
    
    loansResult.rows.forEach((row: any) => {
      const actorName = row.actor_name;
      const month = row.month;
      allMonths.add(month);
      
      if (!actorMonthlyData.has(actorName)) {
        actorMonthlyData.set(actorName, new Map());
      }
      actorMonthlyData.get(actorName)!.set(month, {
        units: parseInt(row.units) || 0,
        volume: parseFloat(row.volume) || 0,
      });
    });
    
    // Sort months
    const sortedMonths = Array.from(allMonths).sort();
    
    // Build response
    const actors = Array.from(actorMonthlyData.entries()).map(([name, monthData]) => {
      const totalUnits = Array.from(monthData.values()).reduce((sum, d) => sum + d.units, 0);
      const totalVolume = Array.from(monthData.values()).reduce((sum, d) => sum + d.volume, 0);
      
      const monthlyData = sortedMonths.map(month => ({
        month,
        units: monthData.get(month)?.units || 0,
        volume: monthData.get(month)?.volume || 0,
      }));
      
      return {
        name,
        totalUnits,
        totalVolume,
        avgUnitsPerMonth: totalUnits / sortedMonths.length,
        monthlyData,
      };
    }).sort((a, b) => b.totalUnits - a.totalUnits);
    
    // Calculate monthly totals
    const monthlyTotals = sortedMonths.map(month => {
      const monthTotal = actors.reduce((sum, a) => {
        const monthData = a.monthlyData.find(m => m.month === month);
        return sum + (monthData?.units || 0);
      }, 0);
      return { month, units: monthTotal };
    });
    
    logInfo('[Scorecard/Operations-Trends] Complete', { actors: actors.length, months: sortedMonths.length });
    
    res.json({
      actors,
      months: sortedMonths,
      monthlyTotals,
      dateRange: {
        startDate: effectiveStartDate.toISOString(),
        endDate: effectiveEndDate.toISOString(),
        months: monthsCount,
      },
    });
  } catch (error: any) {
    logError('Error fetching operations trends data', error, { userId: req.userId });
    res.status(500).json({ error: error.message || 'Failed to fetch operations trends data' });
  }
});

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
router.get('/sales-trends', authenticateToken, attachTenantContext, apiLimiter, async (req: AuthRequest, res) => {
  try {
    const tenantPool = getTenantContext(req).tenantPool;
    
    const dateRange = (req.query.date_range as string) || '3-months';
    const channelGroup = (req.query.channel_group as string) || 'Retail';
    const monthsBack = dateRange === '6-months' ? 6 : 3;
    
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
    
    logInfo('[Scorecard/Sales-Trends] Start', { dateRange, channel: channelGroup });
    
    // Fetch loans
    const loansResult = await tenantPool.query(`
      SELECT 
        loan_id, loan_number, loan_amount, loan_type, loan_purpose,
        funding_date, application_date, closing_date,
        loan_officer, branch, channel, current_loan_status,
        rate_lock_buy_side_base_price_rate,
        orig_fee_borr_pd, orig_fees_seller, cd_lender_credits
      FROM public.loans
      WHERE funding_date IS NOT NULL
        AND funding_date >= $1
        AND funding_date <= $2
    `, [previousStartDate.toISOString(), currentEndDate.toISOString()]);
    
    const allLoans = loansResult.rows;
    
    // Apply channel filter
    const channelFilteredLoans = allLoans.filter((l: any) => {
      const channel = (l.channel || '').toLowerCase();
      if (channelGroup.toLowerCase() === 'retail') {
        return channel.includes('retail') || channel.includes('brok');
      } else if (channelGroup.toLowerCase() === 'tpo') {
        return channel.includes('whole') || channel.includes('corresp');
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
    const validCurrentLoans = currentPeriodLoans.filter((l: any) => !isActorMissing(l.loan_officer));
    const validPreviousLoans = previousPeriodLoans.filter((l: any) => !isActorMissing(l.loan_officer));
    
    // Helper: turn time
    const calcTurnTime = (loan: any): number | null => {
      if (!loan.closing_date || !loan.application_date) return null;
      const days = (new Date(loan.closing_date).getTime() - new Date(loan.application_date).getTime()) / (1000 * 60 * 60 * 24);
      return days > 0 ? days : null;
    };
    
    // Aggregate per LO
    const loMap = new Map<string, {
      name: string;
      branch: string;
      units: number;
      volume: number;
      revenue: number;
      turnTimes: number[];
      previousUnits: number;
    }>();
    
    validCurrentLoans.forEach((loan: any) => {
      const loName = loan.loan_officer;
      const existing = loMap.get(loName) || {
        name: loName,
        branch: loan.branch || 'Unknown',
        units: 0,
        volume: 0,
        revenue: 0,
        turnTimes: [],
        previousUnits: 0,
      };
      
      existing.units += 1;
      existing.volume += parseFloat(loan.loan_amount || 0);
      existing.revenue += calcLoanRevenue(loan);
      
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
      .filter(lo => lo.units > 0)
      .map((lo, index) => {
        const marginBPS = lo.volume > 0 ? (lo.revenue / lo.volume) * 10000 : 0;
        const trendPercent = lo.previousUnits > 0
          ? ((lo.units - lo.previousUnits) / lo.previousUnits) * 100
          : (lo.units > 0 ? 100 : 0);
        const daysAvg = lo.turnTimes.length > 0
          ? lo.turnTimes.reduce((a, b) => a + b, 0) / lo.turnTimes.length
          : 0;
        const volumeRating = avgVolume > 0 ? (lo.volume / avgVolume) * 100 : 100;
        
        let tier: 'top' | '2nd' | 'bottom' = 'bottom';
        if (volumeRating >= 120) tier = 'top';
        else if (volumeRating >= 80) tier = '2nd';
        
        const nameParts = lo.name.split(' ');
        const initials = nameParts.length >= 2
          ? `${nameParts[0][0]}${nameParts[nameParts.length - 1][0]}`.toUpperCase()
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
    const avgTurnTime = allTurnTimes.length > 0
      ? Math.round(allTurnTimes.reduce((a, b) => a + b, 0) / allTurnTimes.length)
      : 0;
    
    // Fund type breakdown
    const conformingLimit = 726200;
    const fundTypeBreakdown = [
      {
        name: 'Conventional',
        value: validCurrentLoans.filter((l: any) => 
          l.loan_type === 'Conventional' && parseFloat(l.loan_amount || 0) <= conformingLimit
        ).length,
        fill: '#3b82f6',
      },
      {
        name: 'FHA',
        value: validCurrentLoans.filter((l: any) => l.loan_type === 'FHA').length,
        fill: '#10b981',
      },
      {
        name: 'VA',
        value: validCurrentLoans.filter((l: any) => l.loan_type === 'VA').length,
        fill: '#a855f7',
      },
      {
        name: 'USDA',
        value: validCurrentLoans.filter((l: any) => {
          const loanType = (l.loan_type || '').toLowerCase();
          return loanType.includes('farmershome') || loanType === 'usda';
        }).length,
        fill: '#f97316',
      },
      {
        name: 'Jumbo',
        value: validCurrentLoans.filter((l: any) => 
          l.loan_type === 'Conventional' && parseFloat(l.loan_amount || 0) > conformingLimit
        ).length,
        fill: '#ec4899',
      },
    ];
    
    // Monthly performance
    const monthMap = new Map<string, { units: number; volume: number }>();
    validCurrentLoans.forEach((loan: any) => {
      const fundDate = new Date(loan.funding_date);
      const monthKey = `${fundDate.getFullYear()}-${fundDate.toLocaleString('en', { month: 'short' })}`;
      const existing = monthMap.get(monthKey) || { units: 0, volume: 0 };
      monthMap.set(monthKey, {
        units: existing.units + 1,
        volume: existing.volume + parseFloat(loan.loan_amount || 0),
      });
    });
    
    const monthlyPerformance = Array.from(monthMap.entries())
      .map(([month, data]) => ({ month, ...data }))
      .sort((a, b) => a.month.localeCompare(b.month));
    
    logInfo('[Scorecard/Sales-Trends] Complete', { los: loanOfficers.length, totalUnits });
    
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
    logError('Error fetching sales trends data', error, { userId: req.userId });
    res.status(500).json({ error: error.message || 'Failed to fetch sales trends data' });
  }
});

// =============================================================================
// SALES TRENDS DRILLDOWN - GET /api/scorecard/sales-trends/drilldown/:loName
// =============================================================================
// Migrated from: /api/loans/sales-trends/drilldown/:loName
// =============================================================================

/**
 * GET /api/scorecard/sales-trends/drilldown/:loName
 * Get detailed drilldown data for a specific Loan Officer
 */
router.get('/sales-trends/drilldown/:loName', authenticateToken, attachTenantContext, apiLimiter, async (req: AuthRequest, res) => {
  try {
    const tenantPool = getTenantContext(req).tenantPool;
    const loName = req.params.loName as string;
    const decodedLoName = decodeURIComponent(loName);
    
    const dateRange = (req.query.date_range as string) || '3-months';
    const channelGroup = (req.query.channel_group as string) || 'Retail';
    const monthsBack = dateRange === '6-months' ? 6 : 3;
    
    // Get date range
    const vMaxDate = await getVMaxDate(tenantPool);
    const endDate = new Date(vMaxDate);
    const startDate = new Date(vMaxDate);
    startDate.setMonth(startDate.getMonth() - monthsBack);
    startDate.setDate(1);
    
    // Fetch LO's loans
    const loansResult = await tenantPool.query(`
      SELECT 
        loan_id, loan_number, loan_amount, loan_type, loan_purpose,
        funding_date, application_date, closing_date,
        loan_officer, branch, channel, current_loan_status,
        rate_lock_buy_side_base_price_rate,
        orig_fee_borr_pd, orig_fees_seller, cd_lender_credits
      FROM public.loans
      WHERE loan_officer = $1
        AND funding_date IS NOT NULL
        AND funding_date >= $2
        AND funding_date <= $3
    `, [decodedLoName, startDate.toISOString(), endDate.toISOString()]);
    
    const loLoans = loansResult.rows;
    
    // Apply channel filter
    const filteredLoans = loLoans.filter((l: any) => {
      const channel = (l.channel || '').toLowerCase();
      if (channelGroup.toLowerCase() === 'retail') {
        return channel.includes('retail') || channel.includes('brok');
      } else if (channelGroup.toLowerCase() === 'tpo') {
        return channel.includes('whole') || channel.includes('corresp');
      }
      return true;
    });
    
    // Helper: turn time
    const calcTurnTime = (loan: any): number | null => {
      if (!loan.closing_date || !loan.application_date) return null;
      const days = (new Date(loan.closing_date).getTime() - new Date(loan.application_date).getTime()) / (1000 * 60 * 60 * 24);
      return days > 0 ? days : null;
    };
    
    // Calculate metrics
    const totalClosed = filteredLoans.length;
    const totalVolume = filteredLoans.reduce((sum: number, l: any) => sum + parseFloat(l.loan_amount || 0), 0);
    const totalRevenue = filteredLoans.reduce((sum: number, l: any) => sum + calcLoanRevenue(l), 0);
    const avgMargin = totalVolume > 0 ? (totalRevenue / totalVolume) * 10000 : 0;
    
    const turnTimes = filteredLoans.map((l: any) => calcTurnTime(l)).filter((t): t is number => t !== null);
    const turnTime = turnTimes.length > 0 ? turnTimes.reduce((a, b) => a + b, 0) / turnTimes.length : 0;
    
    // Branch rank
    const branchRankResult = await tenantPool.query(`
      SELECT loan_officer, COUNT(*) as units
      FROM public.loans
      WHERE branch = (SELECT branch FROM public.loans WHERE loan_officer = $1 LIMIT 1)
        AND funding_date IS NOT NULL
        AND funding_date >= $2
        AND funding_date <= $3
      GROUP BY loan_officer
      ORDER BY units DESC
    `, [decodedLoName, startDate.toISOString(), endDate.toISOString()]);
    
    const branchLOs = branchRankResult.rows;
    const branchRank = branchLOs.findIndex((r: any) => r.loan_officer === decodedLoName) + 1;
    const branchTotal = branchLOs.length;
    
    // Monthly details
    const monthMap = new Map<string, { loans: any[] }>();
    filteredLoans.forEach((loan: any) => {
      const fundDate = new Date(loan.funding_date);
      const monthKey = `${fundDate.getFullYear()}-${fundDate.toLocaleString('en', { month: 'short' })}`;
      const existing = monthMap.get(monthKey) || { loans: [] };
      existing.loans.push(loan);
      monthMap.set(monthKey, existing);
    });
    
    const monthlyDetails = Array.from(monthMap.entries())
      .map(([month, data]) => {
        const monthLoans = data.loans;
        const monthVolume = monthLoans.reduce((sum: number, l: any) => sum + parseFloat(l.loan_amount || 0), 0);
        const monthRevenue = monthLoans.reduce((sum: number, l: any) => sum + calcLoanRevenue(l), 0);
        const monthTurnTimes = monthLoans.map((l: any) => calcTurnTime(l)).filter((t): t is number => t !== null);
        
        return {
          month,
          closed: monthLoans.length,
          volume: monthVolume,
          margin: monthVolume > 0 ? Math.round((monthRevenue / monthVolume) * 10000) : 0,
          pullThrough: 50, // Placeholder
          turnTime: monthTurnTimes.length > 0
            ? Math.round(monthTurnTimes.reduce((a, b) => a + b, 0) / monthTurnTimes.length)
            : 0,
        };
      })
      .sort((a, b) => b.month.localeCompare(a.month));
    
    // Performance trend
    const performanceTrend = monthlyDetails
      .slice()
      .reverse()
      .map(d => ({
        month: d.month.split('-')[1],
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
        email: 'loan.officer@company.com',
        phone: '(555) 123-4567',
        location: filteredLoans[0]?.branch || 'Unknown',
      },
      monthlyDetails,
      performanceTrend,
    });
  } catch (error: any) {
    logError('Error fetching sales trends drilldown', error, { userId: req.userId, loName: req.params.loName });
    res.status(500).json({ error: error.message || 'Failed to fetch sales trends drilldown' });
  }
});

export default router;
