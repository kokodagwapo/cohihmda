/**
 * Insight Details API
 * Returns detailed data for specific insight types (for drill-down modals)
 *
 * When an insightId is provided, the stored detail_query filters are used to
 * reconstruct the EXACT data that the insight was generated from. This
 * guarantees that "7 loans totaling $2.38M" in the headline will show exactly
 * those 7 loans — no more, no less.
 *
 * Column references are resolved dynamically via TenantSchemaResolver so
 * queries adapt to each tenant's actual database schema.
 */

import { Router } from 'express';
import { authenticateToken, AuthRequest } from '../../middleware/auth.js';
import { attachTenantContext, getTenantContext } from '../../middleware/tenantContext.js';
import { handleDatabaseError } from '../../config/database.js';
import { apiLimiter } from '../../middleware/rateLimiter.js';
import { createSchemaResolver } from '../../services/tenantSchemaResolver.js';
import { getTenantRevenueExpression, isActorMissing } from '../../utils/scorecard-utils.js';

const router = Router();

// ============================================================================
// Helper: load stored detail_query from the generated_insights table
// ============================================================================

async function loadDetailFilters(
  tenantPool: any,
  insightId: number
): Promise<Record<string, any> | null> {
  try {
    const result = await tenantPool.query(
      `SELECT detail_query FROM generated_insights WHERE id = $1`,
      [insightId]
    );
    if (result.rows.length === 0) return null;
    return result.rows[0].detail_query || null;
  } catch {
    return null;
  }
}

// ============================================================================
// Helper: date range calculation
// ============================================================================

function calculateStartDate(dateFilter: string): Date {
  const now = new Date();
  switch (dateFilter) {
    case 'today': {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      return d;
    }
    case 'mtd':
      return new Date(now.getFullYear(), now.getMonth(), 1);
    case 'ytd':
    default:
      return new Date(now.getFullYear(), 0, 1);
  }
}

// ============================================================================
// Main route
// ============================================================================

/**
 * GET /api/dashboard/insights/details/:source
 * Query params:
 *   - dateFilter: ytd | mtd | today  (default: ytd)
 *   - insightId:  DB id of the generated_insight row (preferred)
 *   - headline:   Fallback — used to infer filters if insightId is absent
 *   - tenant_id:  For multi-tenant context
 */
router.get('/details/:source', authenticateToken, attachTenantContext, apiLimiter, async (req: AuthRequest, res) => {
  try {
    const tenantContext = getTenantContext(req);
    const tenantPool = tenantContext.tenantPool;
    const { source } = req.params;
    const { dateFilter = 'ytd', insightId, headline = '' } = req.query;
    const startDate = calculateStartDate(String(dateFilter));

    // 1. Try to load stored detail_query from the DB (gold standard)
    let filters: Record<string, any> | null = null;
    if (insightId) {
      filters = await loadDetailFilters(tenantPool, Number(insightId));
    }
    const insightHeadline = String(headline || '').toLowerCase();

    console.log(`[InsightDetails] source=${source}, insightId=${insightId || 'none'}, filters=${filters ? 'stored' : 'fallback'}`);

    // Resolve column names against the tenant's actual schema
    const loans = await createSchemaResolver(tenantPool, 'loans');

    let result: any = { source, dateFilter };

    switch (source) {

      // ====================================================================
      // PREDICTIONS
      // ====================================================================
      case 'predictions': {
        // If we have stored filters with exact loan_ids, use them
        const hasStoredLoanIds = filters?.type === 'predictions' && Array.isArray(filters.loan_ids) && filters.loan_ids.length > 0;

        let predictionsQuery: string;
        let queryParams: any[];

        if (hasStoredLoanIds) {
          // EXACT match: only the loans the insight was generated from.
          // JOIN to loans and filter for active status — predictions for
          // loans that have since been withdrawn/denied/funded are stale.
          predictionsQuery = `
            SELECT 
              lp.loan_id,
              lp.predicted_outcome,
              lp.confidence,
              lp.reasoning,
              lp.risk_factors,
              COALESCE(l.loan_amount, 0) as loan_amount,
              l.loan_type,
              l.current_loan_status as status,
              l.current_milestone as milestone,
              l.interest_rate,
              ${loans.selectExpr('fico_score', 'l')},
              ${loans.selectExpr('ltv', 'l')},
              ${loans.selectExpr('dti', 'l')},
              l.application_date,
              COALESCE(e.first_name || ' ' || e.last_name, ${loans.whereExpr('loan_officer', 'l')}) as loan_officer
            FROM public.loan_predictions lp
            JOIN public.loans l ON l.loan_id = lp.loan_id
            LEFT JOIN public.employees e ON e.id::TEXT = ${loans.whereExpr('loan_officer_id', 'l')}
            WHERE lp.loan_id = ANY($1)
              AND l.current_loan_status = 'Active Loan'
            ORDER BY lp.confidence DESC, COALESCE(l.loan_amount, 0) DESC
          `;
          queryParams = [filters!.loan_ids];
        } else {
          // Fallback: infer filters from headline or stored filter params
          let confidenceMin = filters?.confidence_min ?? 50;
          const confMatch = insightHeadline.match(/>(\d+)%/);
          if (confMatch) confidenceMin = parseInt(confMatch[1]);
          else if (insightHeadline.includes('high') && insightHeadline.includes('confidence')) confidenceMin = 70;

          let outcomeFilter = `('withdraw', 'deny')`;
          const outcomes = filters?.outcomes;
          if (Array.isArray(outcomes) && outcomes.length > 0) {
            outcomeFilter = `(${outcomes.map((o: string) => `'${o}'`).join(', ')})`;
          } else {
            if (insightHeadline.includes('withdraw') && !insightHeadline.includes('deny')) {
              outcomeFilter = `('withdraw')`;
            } else if (insightHeadline.includes('deny') && !insightHeadline.includes('withdraw')) {
              outcomeFilter = `('deny')`;
            }
          }

          predictionsQuery = `
            SELECT 
              lp.loan_id,
              lp.predicted_outcome,
              lp.confidence,
              lp.reasoning,
              lp.risk_factors,
              l.loan_amount,
              l.loan_type,
              l.current_loan_status as status,
              l.current_milestone as milestone,
              l.interest_rate,
              ${loans.selectExpr('fico_score', 'l')},
              ${loans.selectExpr('ltv', 'l')},
              ${loans.selectExpr('dti', 'l')},
              l.application_date,
              COALESCE(e.first_name || ' ' || e.last_name, ${loans.whereExpr('loan_officer', 'l')}) as loan_officer
            FROM public.loan_predictions lp
            JOIN public.loans l ON l.loan_id = lp.loan_id
            LEFT JOIN public.employees e ON e.id::TEXT = ${loans.whereExpr('loan_officer_id', 'l')}
            WHERE lp.predicted_outcome IN ${outcomeFilter}
              AND lp.confidence >= $1
              AND l.current_loan_status = 'Active Loan'
            ORDER BY lp.confidence DESC, l.loan_amount DESC
            LIMIT 200
          `;
          queryParams = [confidenceMin];
        }

        const predictions = await tenantPool.query(predictionsQuery, queryParams);

        const withdrawCount = predictions.rows.filter((r: any) => r.predicted_outcome === 'withdraw').length;
        const denyCount = predictions.rows.filter((r: any) => r.predicted_outcome === 'deny').length;
        const totalAtRiskVolume = predictions.rows.reduce((sum: number, r: any) => sum + (parseFloat(r.loan_amount) || 0), 0);
        const highConfidenceCount = predictions.rows.filter((r: any) => r.confidence >= 70).length;

        const confLabel = hasStoredLoanIds
          ? (filters!.confidence_min ? `≥${filters!.confidence_min}%` : '')
          : '';

        result = {
          ...result,
          title: confLabel
            ? `At-Risk Loans (${confLabel} Fallout Probability)`
            : 'At-Risk Loans (Fallout Predictions)',
          summary: {
            totalAtRisk: predictions.rows.length,
            likelyWithdraw: withdrawCount,
            likelyDeny: denyCount,
            highConfidence: highConfidenceCount,
            totalVolume: totalAtRiskVolume,
            avgConfidence: predictions.rows.length > 0
              ? predictions.rows.reduce((sum: number, r: any) => sum + r.confidence, 0) / predictions.rows.length
              : 0
          },
          loans: predictions.rows.map((row: any) => ({
            loanId: row.loan_id,
            predictedOutcome: row.predicted_outcome,
            confidence: Math.round(row.confidence),
            reasoning: row.reasoning,
            riskFactors: row.risk_factors || [],
            loanAmount: parseFloat(row.loan_amount) || 0,
            loanType: row.loan_type,
            status: row.status,
            milestone: row.milestone || null,
            interestRate: row.interest_rate ? parseFloat(row.interest_rate) : null,
            ficoScore: row.fico_score ? parseInt(row.fico_score) : null,
            ltv: row.ltv ? parseFloat(row.ltv) : null,
            dti: row.dti ? parseFloat(row.dti) : null,
            applicationDate: row.application_date,
            loanOfficer: row.loan_officer
          }))
        };
        break;
      }

      // ====================================================================
      // CREDIT RISK
      // ====================================================================
      case 'credit_risk': {
        const hasStoredCreditIds = filters?.type === 'credit_risk' && Array.isArray(filters.loan_ids) && filters.loan_ids.length > 0;

        let creditRiskQuery: string;
        let creditParams: any[];

        if (hasStoredCreditIds) {
          // EXACT match: only the loans the insight was generated from
          creditRiskQuery = `
            SELECT 
              l.loan_id,
              l.loan_amount,
              l.loan_type,
              l.current_loan_status as status,
              l.current_milestone as milestone,
              l.interest_rate,
              ${loans.selectExpr('fico_score', 'l')},
              ${loans.selectExpr('ltv', 'l')},
              ${loans.selectExpr('dti', 'l')},
              l.application_date,
              COALESCE(e.first_name || ' ' || e.last_name, ${loans.whereExpr('loan_officer', 'l')}) as loan_officer,
              CASE 
                WHEN ${loans.castExpr('fico_score', 'INTEGER', 'l')} < 620 THEN 'Low FICO'
                WHEN ${loans.castExpr('ltv', 'DECIMAL', 'l')} > 95 THEN 'High LTV'
                WHEN ${loans.castExpr('dti', 'DECIMAL', 'l')} > 50 THEN 'High DTI'
                ELSE 'Multiple Factors'
              END as risk_reason
            FROM public.loans l
            LEFT JOIN public.employees e ON e.id::TEXT = ${loans.whereExpr('loan_officer_id', 'l')}
            WHERE l.loan_id = ANY($1)
            ORDER BY l.loan_amount DESC
          `;
          creditParams = [filters!.loan_ids];
        } else {
          // Fallback: re-run query with risk factor filters
          const riskFactors: string[] = filters?.risk_factors
            || ((): string[] => {
              const factors: string[] = [];
              if (insightHeadline.includes('fico')) factors.push('fico');
              if (insightHeadline.includes('ltv')) factors.push('ltv');
              if (insightHeadline.includes('dti')) factors.push('dti');
              return factors.length > 0 ? factors : ['fico', 'ltv', 'dti'];
            })();

          const clauses: string[] = [];
          if (riskFactors.includes('fico')) clauses.push(`${loans.castExpr('fico_score', 'INTEGER', 'l')} < 620`);
          if (riskFactors.includes('ltv')) clauses.push(`${loans.castExpr('ltv', 'DECIMAL', 'l')} > 95`);
          if (riskFactors.includes('dti')) clauses.push(`${loans.castExpr('dti', 'DECIMAL', 'l')} > 50`);
          const riskWhere = clauses.length > 0 ? clauses.join(' OR ') : 'FALSE';

          creditRiskQuery = `
            SELECT 
              l.loan_id,
              l.loan_amount,
              l.loan_type,
              l.current_loan_status as status,
              l.current_milestone as milestone,
              l.interest_rate,
              ${loans.selectExpr('fico_score', 'l')},
              ${loans.selectExpr('ltv', 'l')},
              ${loans.selectExpr('dti', 'l')},
              l.application_date,
              COALESCE(e.first_name || ' ' || e.last_name, ${loans.whereExpr('loan_officer', 'l')}) as loan_officer,
              CASE 
                WHEN ${loans.castExpr('fico_score', 'INTEGER', 'l')} < 620 THEN 'Low FICO'
                WHEN ${loans.castExpr('ltv', 'DECIMAL', 'l')} > 95 THEN 'High LTV'
                WHEN ${loans.castExpr('dti', 'DECIMAL', 'l')} > 50 THEN 'High DTI'
                ELSE 'Multiple Factors'
              END as risk_reason
            FROM public.loans l
            LEFT JOIN public.employees e ON e.id::TEXT = ${loans.whereExpr('loan_officer_id', 'l')}
            WHERE l.current_loan_status = 'Active Loan'
              AND (${riskWhere})
            ORDER BY l.loan_amount DESC
            LIMIT 200
          `;
          creditParams = [];
        }

        const creditRisk = await tenantPool.query(creditRiskQuery, creditParams);

        const lowFicoCount = creditRisk.rows.filter((r: any) => parseInt(r.fico_score) < 620).length;
        const highLtvCount = creditRisk.rows.filter((r: any) => parseFloat(r.ltv) > 95).length;
        const highDtiCount = creditRisk.rows.filter((r: any) => parseFloat(r.dti) > 50).length;

        result = {
          ...result,
          title: 'Credit Risk Loans',
          summary: {
            totalHighRisk: creditRisk.rows.length,
            lowFico: lowFicoCount,
            highLtv: highLtvCount,
            highDti: highDtiCount,
            totalVolume: creditRisk.rows.reduce((sum: number, r: any) => sum + (parseFloat(r.loan_amount) || 0), 0)
          },
          loans: creditRisk.rows.map((row: any) => ({
            loanId: row.loan_id,
            loanAmount: parseFloat(row.loan_amount) || 0,
            loanType: row.loan_type,
            status: row.status,
            milestone: row.milestone || null,
            interestRate: row.interest_rate ? parseFloat(row.interest_rate) : null,
            ficoScore: row.fico_score ? parseInt(row.fico_score) : null,
            ltv: row.ltv ? parseFloat(row.ltv) : null,
            dti: row.dti ? parseFloat(row.dti) : null,
            applicationDate: row.application_date,
            loanOfficer: row.loan_officer,
            riskReason: row.risk_reason
          }))
        };
        break;
      }

      // ====================================================================
      // LOST OPPORTUNITY
      // ====================================================================
      case 'lost_opportunity': {
        const hasStoredLostIds = filters?.type === 'lost_opportunity' && Array.isArray(filters.loan_ids) && filters.loan_ids.length > 0;

        let lostOpportunityQuery: string;
        let lostParams: any[];

        if (hasStoredLostIds) {
          // EXACT match: only the loans the insight was generated from
          lostOpportunityQuery = `
            SELECT 
              l.loan_id,
              l.loan_amount,
              l.loan_type,
              l.current_loan_status as status,
              l.current_milestone as milestone,
              l.interest_rate,
              l.application_date,
              ${loans.selectExpr('fico_score', 'l')},
              ${loans.selectExpr('ltv', 'l')},
              COALESCE(e.first_name || ' ' || e.last_name, ${loans.whereExpr('loan_officer', 'l')}) as loan_officer
            FROM public.loans l
            LEFT JOIN public.employees e ON e.id::TEXT = ${loans.whereExpr('loan_officer_id', 'l')}
            WHERE l.loan_id = ANY($1)
            ORDER BY l.loan_amount DESC
          `;
          lostParams = [filters!.loan_ids];
        } else {
          // Fallback: re-run with status filters
          const statuses: string[] = ((): string[] => {
            if (insightHeadline.includes('withdrawn') && !insightHeadline.includes('denied')) {
              return ['withdrawn', 'cancelled', 'Withdrawn'];
            } else if (insightHeadline.includes('denied') && !insightHeadline.includes('withdrawn')) {
              return ['denied', 'declined', 'Denied'];
            }
            return ['withdrawn', 'cancelled', 'Withdrawn', 'denied', 'declined', 'Denied'];
          })();

          const statusPlaceholders = statuses.map((_: string, i: number) => `$${i + 2}`).join(', ');

          lostOpportunityQuery = `
            SELECT 
              l.loan_id,
              l.loan_amount,
              l.loan_type,
              l.current_loan_status as status,
              l.current_milestone as milestone,
              l.interest_rate,
              l.application_date,
              ${loans.selectExpr('fico_score', 'l')},
              ${loans.selectExpr('ltv', 'l')},
              COALESCE(e.first_name || ' ' || e.last_name, ${loans.whereExpr('loan_officer', 'l')}) as loan_officer
            FROM public.loans l
            LEFT JOIN public.employees e ON e.id::TEXT = ${loans.whereExpr('loan_officer_id', 'l')}
            WHERE l.current_loan_status IN (${statusPlaceholders})
              AND l.application_date >= $1
            ORDER BY l.loan_amount DESC
            LIMIT 200
          `;
          lostParams = [startDate, ...statuses];
        }

        const lostOpp = await tenantPool.query(lostOpportunityQuery, lostParams);

        const withdrawn = lostOpp.rows.filter((r: any) => ['withdrawn', 'cancelled', 'Withdrawn'].includes(r.status));
        const denied = lostOpp.rows.filter((r: any) => ['denied', 'declined', 'Denied'].includes(r.status));

        result = {
          ...result,
          title: 'Lost Opportunity (Withdrawn & Denied)',
          summary: {
            totalLost: lostOpp.rows.length,
            withdrawn: withdrawn.length,
            denied: denied.length,
            withdrawnVolume: withdrawn.reduce((sum: number, r: any) => sum + (parseFloat(r.loan_amount) || 0), 0),
            deniedVolume: denied.reduce((sum: number, r: any) => sum + (parseFloat(r.loan_amount) || 0), 0),
            estimatedLostRevenue: lostOpp.rows.reduce((sum: number, r: any) => sum + (parseFloat(r.loan_amount) || 0), 0) * 0.01
          },
          loans: lostOpp.rows.map((row: any) => ({
            loanId: row.loan_id,
            loanAmount: parseFloat(row.loan_amount) || 0,
            loanType: row.loan_type,
            status: row.status,
            milestone: row.milestone || null,
            interestRate: row.interest_rate ? parseFloat(row.interest_rate) : null,
            applicationDate: row.application_date,
            ficoScore: row.fico_score ? parseInt(row.fico_score) : null,
            ltv: row.ltv ? parseFloat(row.ltv) : null,
            loanOfficer: row.loan_officer
          }))
        };
        break;
      }

      // ====================================================================
      // PIPELINE
      // ====================================================================
      case 'pipeline': {
        const minDays: number | null = filters?.min_days
          ?? (() => {
            const m = insightHeadline.match(/(?:over|>|exceeding|beyond)\s*(\d+)\s*days?/i);
            return m ? parseInt(m[1]) : null;
          })();
        const lockFilter: string | null = filters?.lock_filter
          ?? (() => {
            if (insightHeadline.includes('unlocked') && !insightHeadline.includes('locked')) return 'unlocked';
            if (insightHeadline.includes('locked') && !insightHeadline.includes('unlocked')) return 'locked';
            return null;
          })();

        let pipelineAgeClause = '';
        if (minDays !== null) {
          pipelineAgeClause = `AND (CURRENT_DATE - DATE(l.application_date)) > ${Number(minDays)}`;
        }
        let lockClause = '';
        if (lockFilter === 'unlocked') lockClause = 'AND l.lock_date IS NULL';
        else if (lockFilter === 'locked') lockClause = 'AND l.lock_date IS NOT NULL';

        const pipelineQuery = `
          SELECT 
            l.loan_id,
            l.loan_amount,
            l.loan_type,
            l.current_loan_status as status,
            l.current_milestone as milestone,
            l.interest_rate,
            l.application_date,
            l.lock_date,
            ${loans.selectExpr('fico_score', 'l')},
            ${loans.selectExpr('ltv', 'l')},
            COALESCE(e.first_name || ' ' || e.last_name, ${loans.whereExpr('loan_officer', 'l')}) as loan_officer,
            CASE 
              WHEN l.application_date IS NOT NULL 
              THEN CURRENT_DATE - DATE(l.application_date) 
              ELSE NULL 
            END as days_in_pipeline
          FROM public.loans l
          LEFT JOIN public.employees e ON e.id::TEXT = ${loans.whereExpr('loan_officer_id', 'l')}
          WHERE l.current_loan_status = 'Active Loan'
            ${pipelineAgeClause}
            ${lockClause}
          ORDER BY l.loan_amount DESC
          LIMIT 200
        `;

        const pipeline = await tenantPool.query(pipelineQuery);

        const lockedCount = pipeline.rows.filter((r: any) => r.lock_date).length;
        const over45Days = pipeline.rows.filter((r: any) => r.days_in_pipeline > 45).length;
        const over30Days = pipeline.rows.filter((r: any) => r.days_in_pipeline > 30).length;

        const pipelineTitle = minDays
          ? `Pipeline Loans (>${minDays} Days)`
          : lockFilter === 'unlocked'
            ? 'Active Pipeline (Unlocked)'
            : lockFilter === 'locked'
              ? 'Active Pipeline (Locked)'
              : 'Active Pipeline';

        result = {
          ...result,
          title: pipelineTitle,
          summary: {
            totalActive: pipeline.rows.length,
            locked: lockedCount,
            unlocked: pipeline.rows.length - lockedCount,
            over30Days,
            over45Days,
            totalVolume: pipeline.rows.reduce((sum: number, r: any) => sum + (parseFloat(r.loan_amount) || 0), 0),
            avgDaysInPipeline: pipeline.rows.length > 0
              ? Math.round(pipeline.rows.reduce((sum: number, r: any) => sum + (r.days_in_pipeline || 0), 0) / pipeline.rows.length)
              : 0
          },
          loans: pipeline.rows.map((row: any) => ({
            loanId: row.loan_id,
            loanAmount: parseFloat(row.loan_amount) || 0,
            loanType: row.loan_type,
            status: row.status,
            milestone: row.milestone || null,
            interestRate: row.interest_rate ? parseFloat(row.interest_rate) : null,
            applicationDate: row.application_date,
            lockDate: row.lock_date,
            ficoScore: row.fico_score ? parseInt(row.fico_score) : null,
            ltv: row.ltv ? parseFloat(row.ltv) : null,
            loanOfficer: row.loan_officer,
            daysInPipeline: row.days_in_pipeline
          }))
        };
        break;
      }

      // ====================================================================
      // PERFORMANCE
      // ====================================================================
      case 'performance': {
        const loOfficer = loans.whereExpr('loan_officer', 'l');
        const loOfficerId = loans.whereExpr('loan_officer_id', 'l');

        const performanceQuery = `
          SELECT 
            COALESCE(e.first_name || ' ' || e.last_name, ${loOfficer}, 'Unknown') as loan_officer,
            COUNT(*) as total_loans,
            COUNT(CASE WHEN l.funding_date IS NOT NULL THEN 1 END) as funded_loans,
            SUM(l.loan_amount) as total_volume,
            SUM(CASE WHEN l.funding_date IS NOT NULL THEN l.loan_amount ELSE 0 END) as funded_volume,
            AVG(CASE 
              WHEN l.funding_date IS NOT NULL AND l.application_date IS NOT NULL 
              THEN DATE(l.funding_date) - DATE(l.application_date) 
              ELSE NULL 
            END) as avg_cycle_time
          FROM public.loans l
          LEFT JOIN public.employees e ON e.id::TEXT = ${loOfficerId}
          WHERE l.application_date >= $1
          GROUP BY COALESCE(e.first_name || ' ' || e.last_name, ${loOfficer}, 'Unknown')
          HAVING COUNT(*) >= 1
          ORDER BY SUM(CASE WHEN l.funding_date IS NOT NULL THEN l.loan_amount ELSE 0 END) DESC
          LIMIT 50
        `;

        const performance = await tenantPool.query(performanceQuery, [startDate]);

        // Compute weighted average cycle time across all officers
        let totalCycleWeightedSum = 0;
        let totalCycleWeightCount = 0;
        for (const row of performance.rows) {
          const ct = parseFloat(row.avg_cycle_time);
          const funded = parseInt(row.funded_loans);
          if (!isNaN(ct) && funded > 0) {
            totalCycleWeightedSum += ct * funded;
            totalCycleWeightCount += funded;
          }
        }
        const overallAvgCycleTime = totalCycleWeightCount > 0
          ? Math.round(totalCycleWeightedSum / totalCycleWeightCount)
          : null;

        result = {
          ...result,
          title: 'Performance by Loan Officer',
          summary: {
            totalOfficers: performance.rows.length,
            totalLoans: performance.rows.reduce((sum: number, r: any) => sum + parseInt(r.total_loans), 0),
            totalFunded: performance.rows.reduce((sum: number, r: any) => sum + parseInt(r.funded_loans), 0),
            totalVolume: performance.rows.reduce((sum: number, r: any) => sum + (parseFloat(r.total_volume) || 0), 0),
            avgCycleTime: overallAvgCycleTime,
          },
          officers: performance.rows.map((row: any) => ({
            name: row.loan_officer,
            totalLoans: parseInt(row.total_loans),
            fundedLoans: parseInt(row.funded_loans),
            pullThrough: parseInt(row.total_loans) > 0
              ? Math.round((parseInt(row.funded_loans) / parseInt(row.total_loans)) * 100)
              : 0,
            totalVolume: parseFloat(row.total_volume) || 0,
            fundedVolume: parseFloat(row.funded_volume) || 0,
            avgCycleTime: row.avg_cycle_time ? Math.round(parseFloat(row.avg_cycle_time)) : null
          }))
        };
        break;
      }

      // ====================================================================
      // COMPARISONS / MONTHLY TRENDS
      // ====================================================================
      case 'comparisons': {
        // Group by funding_date so the detail table matches the metrics
        // the LLM sees (funded_volume = loans funded IN that month).
        // Application-date grouping gives different numbers and confuses the detail view.
        const comparisonsQuery = `
          SELECT 
            TO_CHAR(DATE_TRUNC('month', COALESCE(l.funding_date, l.application_date)), 'YYYY-MM') as month,
            COUNT(*) as loans_in_month,
            COUNT(CASE WHEN l.funding_date IS NOT NULL THEN 1 END) as loans_funded,
            SUM(CASE WHEN l.funding_date IS NOT NULL THEN l.loan_amount ELSE 0 END) as funded_volume,
            SUM(l.loan_amount) as total_volume,
            AVG(CASE 
              WHEN l.funding_date IS NOT NULL AND l.application_date IS NOT NULL 
              THEN DATE(l.funding_date) - DATE(l.application_date) 
              ELSE NULL 
            END) as avg_cycle_time
          FROM public.loans l
          WHERE (l.funding_date >= ($1::date - INTERVAL '12 months')
                 OR (l.funding_date IS NULL AND l.application_date >= ($1::date - INTERVAL '12 months')))
          GROUP BY DATE_TRUNC('month', COALESCE(l.funding_date, l.application_date))
          ORDER BY month DESC
          LIMIT 13
        `;

        const comparisons = await tenantPool.query(comparisonsQuery, [startDate]);

        // Compute YTD vs prior year YTD for the summary
        const currentYear = new Date().getFullYear().toString();
        const priorYear = (new Date().getFullYear() - 1).toString();
        const currentMonth = new Date().getMonth() + 1; // 1-12

        const currentYtdRows = comparisons.rows.filter((r: any) => r.month?.startsWith(currentYear));
        const priorYtdRows = comparisons.rows.filter((r: any) => {
          if (!r.month?.startsWith(priorYear)) return false;
          // Only include months up to the same month as current (for fair comparison)
          const monthNum = parseInt(r.month.split('-')[1]);
          return monthNum <= currentMonth;
        });

        const currentYtdVolume = currentYtdRows.reduce((s: number, r: any) => s + (parseFloat(r.funded_volume) || 0), 0);
        const priorYtdVolume = priorYtdRows.reduce((s: number, r: any) => s + (parseFloat(r.funded_volume) || 0), 0);
        const currentYtdFunded = currentYtdRows.reduce((s: number, r: any) => s + (parseInt(r.loans_funded) || 0), 0);
        const priorYtdFunded = priorYtdRows.reduce((s: number, r: any) => s + (parseInt(r.loans_funded) || 0), 0);

        result = {
          ...result,
          title: 'Monthly Trends (by Funding Month)',
          summary: {
            monthsAnalyzed: comparisons.rows.length,
            totalLoans: comparisons.rows.reduce((sum: number, r: any) => sum + parseInt(r.loans_in_month), 0),
            totalFunded: comparisons.rows.reduce((sum: number, r: any) => sum + parseInt(r.loans_funded), 0),
            currentYtdVolume,
            priorYtdVolume,
            currentYtdFunded,
            priorYtdFunded,
            ytdVolumeDelta: priorYtdVolume > 0
              ? Math.round(((currentYtdVolume - priorYtdVolume) / priorYtdVolume) * 1000) / 10
              : null,
          },
          months: comparisons.rows.map((row: any) => ({
            month: row.month,
            loansStarted: parseInt(row.loans_in_month),
            loansFunded: parseInt(row.loans_funded),
            totalVolume: parseFloat(row.total_volume) || 0,
            fundedVolume: parseFloat(row.funded_volume) || 0,
            avgCycleTime: row.avg_cycle_time ? Math.round(parseFloat(row.avg_cycle_time)) : null,
            pullThrough: parseInt(row.loans_in_month) > 0
              ? Math.round((parseInt(row.loans_funded) / parseInt(row.loans_in_month)) * 100)
              : 0
          }))
        };
        break;
      }

      // ====================================================================
      // CLOSING RISK (B3)
      // ====================================================================
      case 'closing_risk': {
        const hasStoredIds = filters?.type === 'closing_risk' && Array.isArray(filters.loan_ids) && filters.loan_ids.length > 0;

        let closingQuery: string;
        let closingParams: any[];

        if (hasStoredIds) {
          closingQuery = `
            SELECT 
              l.loan_id,
              l.loan_amount,
              l.loan_type,
              l.current_loan_status as status,
              l.current_milestone as milestone,
              l.interest_rate,
              l.estimated_closing_date,
              l.ctc_date,
              (l.estimated_closing_date - CURRENT_DATE) as days_to_close,
              l.application_date,
              COALESCE(e.first_name || ' ' || e.last_name, ${loans.whereExpr('loan_officer', 'l')}) as loan_officer
            FROM public.loans l
            LEFT JOIN public.employees e ON e.id::TEXT = ${loans.whereExpr('loan_officer_id', 'l')}
            WHERE l.loan_id = ANY($1)
            ORDER BY l.estimated_closing_date ASC
          `;
          closingParams = [filters!.loan_ids];
        } else {
          closingQuery = `
            SELECT 
              l.loan_id,
              l.loan_amount,
              l.loan_type,
              l.current_loan_status as status,
              l.current_milestone as milestone,
              l.interest_rate,
              l.estimated_closing_date,
              l.ctc_date,
              (l.estimated_closing_date - CURRENT_DATE) as days_to_close,
              l.application_date,
              COALESCE(e.first_name || ' ' || e.last_name, ${loans.whereExpr('loan_officer', 'l')}) as loan_officer
            FROM public.loans l
            LEFT JOIN public.employees e ON e.id::TEXT = ${loans.whereExpr('loan_officer_id', 'l')}
            WHERE l.current_loan_status = 'Active Loan'
              AND l.estimated_closing_date IS NOT NULL
              AND l.estimated_closing_date <= CURRENT_DATE + INTERVAL '10 days'
              AND l.estimated_closing_date >= CURRENT_DATE
              AND l.ctc_date IS NULL
            ORDER BY l.estimated_closing_date ASC
            LIMIT 200
          `;
          closingParams = [];
        }

        const closingRisk = await tenantPool.query(closingQuery, closingParams);

        result = {
          ...result,
          title: 'Closing-Late Risk (No CTC within 10 Days of Close)',
          summary: {
            totalAtRisk: closingRisk.rows.length,
            totalVolume: closingRisk.rows.reduce((sum: number, r: any) => sum + (parseFloat(r.loan_amount) || 0), 0),
            avgDaysToClose: closingRisk.rows.length > 0
              ? Math.round(closingRisk.rows.reduce((sum: number, r: any) => sum + (parseInt(r.days_to_close) || 0), 0) / closingRisk.rows.length)
              : 0,
          },
          loans: closingRisk.rows.map((row: any) => ({
            loanId: row.loan_id,
            loanAmount: parseFloat(row.loan_amount) || 0,
            loanType: row.loan_type,
            status: row.status,
            milestone: row.milestone || null,
            interestRate: row.interest_rate ? parseFloat(row.interest_rate) : null,
            estimatedClosingDate: row.estimated_closing_date,
            ctcDate: row.ctc_date,
            daysToClose: parseInt(row.days_to_close) || 0,
            applicationDate: row.application_date,
            loanOfficer: row.loan_officer,
          }))
        };
        break;
      }

      // ====================================================================
      // LOCK EXPIRATION (C1)
      // ====================================================================
      case 'lock_expiration': {
        const hasStoredIds = filters?.type === 'lock_expiration' && Array.isArray(filters.loan_ids) && filters.loan_ids.length > 0;

        let lockQuery: string;
        let lockParams: any[];

        if (hasStoredIds) {
          lockQuery = `
            SELECT 
              l.loan_id,
              l.loan_amount,
              l.loan_type,
              l.current_loan_status as status,
              l.current_milestone as milestone,
              l.interest_rate,
              l.lock_date,
              l.lock_expiration_date,
              l.lock_days,
              l.ctc_date,
              (l.lock_expiration_date - CURRENT_DATE) as days_to_expiry,
              l.application_date,
              COALESCE(e.first_name || ' ' || e.last_name, ${loans.whereExpr('loan_officer', 'l')}) as loan_officer
            FROM public.loans l
            LEFT JOIN public.employees e ON e.id::TEXT = ${loans.whereExpr('loan_officer_id', 'l')}
            WHERE l.loan_id = ANY($1)
            ORDER BY l.lock_expiration_date ASC
          `;
          lockParams = [filters!.loan_ids];
        } else {
          lockQuery = `
            SELECT 
              l.loan_id,
              l.loan_amount,
              l.loan_type,
              l.current_loan_status as status,
              l.current_milestone as milestone,
              l.interest_rate,
              l.lock_date,
              l.lock_expiration_date,
              l.lock_days,
              l.ctc_date,
              (l.lock_expiration_date - CURRENT_DATE) as days_to_expiry,
              l.application_date,
              COALESCE(e.first_name || ' ' || e.last_name, ${loans.whereExpr('loan_officer', 'l')}) as loan_officer
            FROM public.loans l
            LEFT JOIN public.employees e ON e.id::TEXT = ${loans.whereExpr('loan_officer_id', 'l')}
            WHERE l.current_loan_status = 'Active Loan'
              AND l.lock_date IS NOT NULL
              AND l.lock_expiration_date IS NOT NULL
              AND l.lock_expiration_date <= CURRENT_DATE + INTERVAL '7 days'
              AND l.lock_expiration_date >= CURRENT_DATE
              AND l.ctc_date IS NULL
            ORDER BY l.lock_expiration_date ASC
            LIMIT 200
          `;
          lockParams = [];
        }

        const lockExp = await tenantPool.query(lockQuery, lockParams);

        result = {
          ...result,
          title: 'Lock Expiration Exposure (Expiring within 7 Days, No CTC)',
          summary: {
            totalExpiring: lockExp.rows.length,
            totalVolume: lockExp.rows.reduce((sum: number, r: any) => sum + (parseFloat(r.loan_amount) || 0), 0),
            avgDaysToExpiry: lockExp.rows.length > 0
              ? Math.round(lockExp.rows.reduce((sum: number, r: any) => sum + (parseInt(r.days_to_expiry) || 0), 0) / lockExp.rows.length)
              : 0,
          },
          loans: lockExp.rows.map((row: any) => ({
            loanId: row.loan_id,
            loanAmount: parseFloat(row.loan_amount) || 0,
            loanType: row.loan_type,
            status: row.status,
            milestone: row.milestone || null,
            interestRate: row.interest_rate ? parseFloat(row.interest_rate) : null,
            lockDate: row.lock_date,
            lockExpirationDate: row.lock_expiration_date,
            lockDays: parseInt(row.lock_days) || null,
            ctcDate: row.ctc_date,
            daysToExpiry: parseInt(row.days_to_expiry) || 0,
            applicationDate: row.application_date,
            loanOfficer: row.loan_officer,
          }))
        };
        break;
      }

      // ====================================================================
      // TRID EXPOSURE (G1)
      // ====================================================================
      case 'trid': {
        const hasStoredIds = filters?.type === 'trid' && Array.isArray(filters.loan_ids) && filters.loan_ids.length > 0;

        let tridQuery: string;
        let tridParams: any[];

        if (hasStoredIds) {
          tridQuery = `
            SELECT 
              l.loan_id,
              l.loan_amount,
              l.loan_type,
              l.current_loan_status as status,
              l.current_milestone as milestone,
              l.interest_rate,
              l.estimated_closing_date,
              l.closing_disclosure_sent_date,
              l.closing_disclosure_received_date,
              (l.estimated_closing_date - CURRENT_DATE) as days_to_close,
              l.application_date,
              COALESCE(e.first_name || ' ' || e.last_name, ${loans.whereExpr('loan_officer', 'l')}) as loan_officer
            FROM public.loans l
            LEFT JOIN public.employees e ON e.id::TEXT = ${loans.whereExpr('loan_officer_id', 'l')}
            WHERE l.loan_id = ANY($1)
            ORDER BY l.estimated_closing_date ASC
          `;
          tridParams = [filters!.loan_ids];
        } else {
          tridQuery = `
            SELECT 
              l.loan_id,
              l.loan_amount,
              l.loan_type,
              l.current_loan_status as status,
              l.current_milestone as milestone,
              l.interest_rate,
              l.estimated_closing_date,
              l.closing_disclosure_sent_date,
              l.closing_disclosure_received_date,
              (l.estimated_closing_date - CURRENT_DATE) as days_to_close,
              l.application_date,
              COALESCE(e.first_name || ' ' || e.last_name, ${loans.whereExpr('loan_officer', 'l')}) as loan_officer
            FROM public.loans l
            LEFT JOIN public.employees e ON e.id::TEXT = ${loans.whereExpr('loan_officer_id', 'l')}
            WHERE l.current_loan_status = 'Active Loan'
              AND l.estimated_closing_date IS NOT NULL
              AND l.estimated_closing_date <= CURRENT_DATE + INTERVAL '5 days'
              AND l.estimated_closing_date >= CURRENT_DATE
              AND l.closing_disclosure_sent_date IS NULL
            ORDER BY l.estimated_closing_date ASC
            LIMIT 200
          `;
          tridParams = [];
        }

        const tridLoans = await tenantPool.query(tridQuery, tridParams);

        result = {
          ...result,
          title: 'TRID Timing Exposure (CD Not Sent, Closing within 5 Days)',
          summary: {
            totalAtRisk: tridLoans.rows.length,
            totalVolume: tridLoans.rows.reduce((sum: number, r: any) => sum + (parseFloat(r.loan_amount) || 0), 0),
            avgDaysToClose: tridLoans.rows.length > 0
              ? Math.round(tridLoans.rows.reduce((sum: number, r: any) => sum + (parseInt(r.days_to_close) || 0), 0) / tridLoans.rows.length)
              : 0,
          },
          loans: tridLoans.rows.map((row: any) => ({
            loanId: row.loan_id,
            loanAmount: parseFloat(row.loan_amount) || 0,
            loanType: row.loan_type,
            status: row.status,
            milestone: row.milestone || null,
            interestRate: row.interest_rate ? parseFloat(row.interest_rate) : null,
            estimatedClosingDate: row.estimated_closing_date,
            closingDisclosureSentDate: row.closing_disclosure_sent_date,
            closingDisclosureReceivedDate: row.closing_disclosure_received_date,
            daysToClose: parseInt(row.days_to_close) || 0,
            applicationDate: row.application_date,
            loanOfficer: row.loan_officer,
          }))
        };
        break;
      }

      // ====================================================================
      // MARGIN (C2) — aggregate only, no loan-level drill-down
      // ====================================================================
      case 'margin': {
        const marginDetail = filters?.type === 'margin' ? filters : null;

        result = {
          ...result,
          title: 'Gain-on-Sale Margin (MoM Comparison)',
          summary: {
            currentMonthBps: marginDetail?.currentMonthBps ?? 0,
            priorMonthBps: marginDetail?.priorMonthBps ?? 0,
            deltaBps: marginDetail?.deltaBps ?? 0,
          },
          loans: [] // Margin is an aggregate metric, no individual loan drill-down
        };
        break;
      }

      // ====================================================================
      // CONDITION BACKLOG (D2)
      // ====================================================================
      case 'condition_backlog': {
        const hasStoredIds = filters?.type === 'condition_backlog' && Array.isArray(filters.loan_ids) && filters.loan_ids.length > 0;

        let condQuery: string;
        let condParams: any[];

        if (hasStoredIds) {
          condQuery = `
            SELECT 
              l.loan_id,
              l.loan_amount,
              l.loan_type,
              l.current_loan_status as status,
              l.current_milestone as milestone,
              l.interest_rate,
              COALESCE(l.number_of_conditions, 0) as conditions,
              l.application_date,
              COALESCE(e.first_name || ' ' || e.last_name, ${loans.whereExpr('loan_officer', 'l')}) as loan_officer
            FROM public.loans l
            LEFT JOIN public.employees e ON e.id::TEXT = ${loans.whereExpr('loan_officer_id', 'l')}
            WHERE l.loan_id = ANY($1)
            ORDER BY l.number_of_conditions DESC
          `;
          condParams = [filters!.loan_ids];
        } else {
          condQuery = `
            SELECT 
              l.loan_id,
              l.loan_amount,
              l.loan_type,
              l.current_loan_status as status,
              l.current_milestone as milestone,
              l.interest_rate,
              COALESCE(l.number_of_conditions, 0) as conditions,
              l.application_date,
              COALESCE(e.first_name || ' ' || e.last_name, ${loans.whereExpr('loan_officer', 'l')}) as loan_officer
            FROM public.loans l
            LEFT JOIN public.employees e ON e.id::TEXT = ${loans.whereExpr('loan_officer_id', 'l')}
            WHERE l.current_loan_status = 'Active Loan'
              AND l.number_of_conditions IS NOT NULL
              AND l.number_of_conditions > 10
            ORDER BY l.number_of_conditions DESC
            LIMIT 200
          `;
          condParams = [];
        }

        const condLoans = await tenantPool.query(condQuery, condParams);

        result = {
          ...result,
          title: 'Condition Backlog (Loans with High Outstanding Conditions)',
          summary: {
            totalLoans: condLoans.rows.length,
            avgConditions: condLoans.rows.length > 0
              ? Math.round(condLoans.rows.reduce((sum: number, r: any) => sum + (parseInt(r.conditions) || 0), 0) / condLoans.rows.length * 10) / 10
              : 0,
            totalVolume: condLoans.rows.reduce((sum: number, r: any) => sum + (parseFloat(r.loan_amount) || 0), 0),
          },
          loans: condLoans.rows.map((row: any) => ({
            loanId: row.loan_id,
            loanAmount: parseFloat(row.loan_amount) || 0,
            loanType: row.loan_type,
            status: row.status,
            milestone: row.milestone || null,
            interestRate: row.interest_rate ? parseFloat(row.interest_rate) : null,
            conditions: parseInt(row.conditions) || 0,
            applicationDate: row.application_date,
            loanOfficer: row.loan_officer,
          }))
        };
        break;
      }

      // ====================================================================
      // TIERING — Personnel revenue-based tier breakdown
      // ====================================================================
      case 'tiering': {
        const actorType = filters?.actorType || 'loan_officer';
        const actorColumn = actorType === 'branch' ? 'branch' : 'loan_officer';
        const actorLabel = actorType === 'branch' ? 'Branch' : 'Loan Officer';

        // YTD date range
        const now = new Date();
        const startOfYear = new Date(now.getFullYear(), 0, 1).toISOString().split('T')[0];
        const today = now.toISOString().split('T')[0];
        const closeDateExpr = 'COALESCE(funding_date::date, closing_date)';

        const revenueExpr = await getTenantRevenueExpression(tenantPool);

        // Funded query: revenue, volume, units, BPS, cycle time, revenue per loan
        const tierQuery = `
          SELECT
            ${actorColumn} AS actor_name,
            COUNT(DISTINCT COALESCE(loan_number, loan_id::text)) AS units,
            SUM(loan_amount) AS volume,
            SUM(${revenueExpr}) AS revenue,
            CASE WHEN SUM(loan_amount) > 0
              THEN (SUM(${revenueExpr}) / SUM(loan_amount)) * 10000
              ELSE 0
            END AS revenue_bps,
            CASE WHEN COUNT(DISTINCT COALESCE(loan_number, loan_id::text)) > 0
              THEN SUM(${revenueExpr}) / COUNT(DISTINCT COALESCE(loan_number, loan_id::text))
              ELSE 0
            END AS revenue_per_loan,
            AVG(${closeDateExpr} - application_date) AS avg_cycle_days
          FROM public.loans
          WHERE (funding_date IS NOT NULL OR closing_date IS NOT NULL)
            AND ${closeDateExpr} >= $1
            AND ${closeDateExpr} <= $2
          GROUP BY ${actorColumn}
          HAVING SUM(${revenueExpr}) > 0
          ORDER BY revenue DESC
        `;

        // Application query: started, lost, denied per actor
        const appQuery = `
          SELECT
            ${actorColumn} AS actor_name,
            COUNT(DISTINCT COALESCE(loan_number, loan_id::text)) AS started,
            COUNT(DISTINCT CASE WHEN current_loan_status ILIKE '%withdraw%' OR current_loan_status ILIKE '%cancelled%'
              OR current_loan_status ILIKE '%canceled%' OR current_loan_status ILIKE '%not accepted%'
              OR current_loan_status ILIKE '%incomplete%' THEN COALESCE(loan_number, loan_id::text) END) AS lost,
            COUNT(DISTINCT CASE WHEN current_loan_status ILIKE '%denied%'
              OR current_loan_status ILIKE '%declined%' THEN COALESCE(loan_number, loan_id::text) END) AS denied
          FROM public.loans
          WHERE application_date >= $1 AND application_date <= $2
          GROUP BY ${actorColumn}
        `;

        const [tierResult, appResult] = await Promise.all([
          tenantPool.query(tierQuery, [startOfYear, today]),
          tenantPool.query(appQuery, [startOfYear, today]),
        ]);

        // Build app data lookup
        const appMap = new Map<string, { started: number; lost: number; denied: number }>();
        for (const r of appResult.rows) {
          if (!isActorMissing(r.actor_name)) {
            appMap.set(r.actor_name, { started: parseInt(r.started) || 0, lost: parseInt(r.lost) || 0, denied: parseInt(r.denied) || 0 });
          }
        }

        // Filter out missing actors and compute tiers
        const rawActors = tierResult.rows
          .filter((r: any) => !isActorMissing(r.actor_name))
          .map((r: any) => {
            const name = r.actor_name || 'Unknown';
            const units = parseInt(r.units) || 0;
            const appData = appMap.get(r.actor_name) || { started: 0, lost: 0, denied: 0 };
            const started = Math.max(appData.started, units);
            return {
              name,
              revenue: parseFloat(r.revenue) || 0,
              units,
              volume: parseFloat(r.volume) || 0,
              revenueBps: Math.round(parseFloat(r.revenue_bps) || 0),
              revenuePerLoan: Math.round(parseFloat(r.revenue_per_loan) || 0),
              pullThrough: started > 0 ? Math.round((units / started) * 1000) / 10 : 0,
              avgCycleTime: Math.round(parseFloat(r.avg_cycle_days) || 0),
              lostOpportunityUnits: appData.lost,
              deniedUnits: appData.denied,
            };
          });

        // Assign tiers using cumulative revenue 50/80 thresholds
        const totalRevenue = rawActors.reduce((s: number, a: any) => s + a.revenue, 0);
        let cumRev = 0;
        const tieredActors = rawActors.map((a: any) => {
          cumRev += a.revenue;
          const pct = totalRevenue > 0 ? (cumRev / totalRevenue) * 100 : 0;
          const tier = pct <= 50 ? 'Top' : pct <= 80 ? 'Second' : 'Bottom';
          return { ...a, tier };
        });

        const topCount = tieredActors.filter((a: any) => a.tier === 'Top').length;
        const secondCount = tieredActors.filter((a: any) => a.tier === 'Second').length;
        const bottomCount = tieredActors.filter((a: any) => a.tier === 'Bottom').length;

        // If specific officer names were extracted from the insight, filter to just those officers
        const actorNames: string[] | undefined = filters?.actorNames;
        const isFiltered = actorNames && actorNames.length > 0;
        const displayActors = isFiltered
          ? tieredActors.filter((a: any) =>
              actorNames!.some((n: string) => a.name.toLowerCase() === n.toLowerCase())
            )
          : tieredActors;

        // When filtered to specific officers, compute officer-level summary
        // When showing all officers, show tier distribution summary
        let summary: Record<string, number>;
        let overrideSummaryMetrics: string[] | null = null;

        if (isFiltered && displayActors.length > 0 && displayActors.length <= 10) {
          // Officer-specific summary: show their actual metrics
          const totalUnits = displayActors.reduce((s: number, a: any) => s + a.units, 0);
          const totalVol = displayActors.reduce((s: number, a: any) => s + a.volume, 0);
          const totalRev = displayActors.reduce((s: number, a: any) => s + a.revenue, 0);
          const avgPT = displayActors.length > 0
            ? Math.round(displayActors.reduce((s: number, a: any) => s + a.pullThrough, 0) / displayActors.length * 10) / 10
            : 0;
          const avgCycle = displayActors.length > 0
            ? Math.round(displayActors.reduce((s: number, a: any) => s + a.avgCycleTime, 0) / displayActors.length)
            : 0;
          const totalLost = displayActors.reduce((s: number, a: any) => s + a.lostOpportunityUnits, 0);
          const totalDenied = displayActors.reduce((s: number, a: any) => s + a.deniedUnits, 0);

          summary = {
            officerUnits: totalUnits,
            officerVolume: totalVol,
            officerRevenue: totalRev,
            officerPullThrough: avgPT,
            ...(avgCycle > 0 ? { officerCycleTime: avgCycle } : {}),
            ...(totalLost > 0 ? { officerLost: totalLost } : {}),
            ...(totalDenied > 0 ? { officerDenied: totalDenied } : {}),
          };
          // Override LLM-specified summary metrics with officer-specific ones
          overrideSummaryMetrics = Object.keys(summary);
        } else {
          summary = {
            totalActors: tieredActors.length,
            topCount,
            secondCount,
            bottomCount,
            totalRevenue,
            totalVolume: tieredActors.reduce((s: number, a: any) => s + a.volume, 0),
          };
        }

        const titleSuffix = isFiltered ? ` — ${actorNames!.join(', ')}` : '';

        result = {
          ...result,
          title: `${actorLabel} Tiering — Revenue-Based Pareto Tiers (YTD)${titleSuffix}`,
          summary,
          rows: displayActors.map((a: any) => ({
            name: a.name,
            tier: a.tier,
            revenue: a.revenue,
            units: a.units,
            fundedVolume: a.volume,
            revenueBps: a.revenueBps,
            revenuePerLoan: a.revenuePerLoan,
            pullThrough: a.pullThrough,
            avgCycleTime: a.avgCycleTime,
            lostOpportunityUnits: a.lostOpportunityUnits,
            deniedUnits: a.deniedUnits,
          })),
          // Stash override so we can apply it after displayConfig is built
          _overrideSummaryMetrics: overrideSummaryMetrics,
        };
        break;
      }

      default:
        res.status(400).json({ error: `Unknown insight source: ${source}` });
        return;
    }

    // ====================================================================
    // Attach displayConfig from stored detail_query (or fallback defaults)
    // ====================================================================
    const displayConfig: { columns: string[]; summaryMetrics: string[] } = {
      columns: filters?.detail_columns || [],
      summaryMetrics: filters?.summary_metrics || [],
    };
    // When tiering is filtered to specific officers, override LLM summary metrics
    // with officer-specific metrics instead of tier distribution counts
    if (result._overrideSummaryMetrics) {
      displayConfig.summaryMetrics = result._overrideSummaryMetrics;
      delete result._overrideSummaryMetrics;
    }
    result.displayConfig = displayConfig;

    // Unify loans/officers/months into a single "rows" array for the frontend
    result.rows = result.loans || result.officers || result.months || [];

    // ====================================================================
    // Attach human-readable date range so the frontend can display it
    // ====================================================================
    const endDate = new Date();
    const filterLabel: Record<string, string> = {
      today: 'Today',
      mtd: 'Month to Date',
      ytd: 'Year to Date',
    };
    result.dateRange = {
      label: filterLabel[String(dateFilter)] || 'Year to Date',
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
    };

    res.json(result);

  } catch (error: any) {
    console.error('Error fetching insight details:', error);

    if (handleDatabaseError(error, res, 'Failed to fetch insight details')) {
      return;
    }

    res.status(500).json({
      error: 'Failed to fetch insight details',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

export default router;
