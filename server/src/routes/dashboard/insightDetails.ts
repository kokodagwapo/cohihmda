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
          // LEFT JOIN to loans so predictions without a matching loan row
          // still appear (avoids the 7→5 mismatch).
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
              ${loans.selectExpr('fico_score', 'l')},
              ${loans.selectExpr('ltv', 'l')},
              ${loans.selectExpr('dti', 'l')},
              l.application_date,
              COALESCE(e.first_name || ' ' || e.last_name, ${loans.whereExpr('loan_officer', 'l')}) as loan_officer
            FROM public.loan_predictions lp
            LEFT JOIN public.loans l ON l.loan_id = lp.loan_id
            LEFT JOIN public.employees e ON e.id::TEXT = ${loans.whereExpr('loan_officer_id', 'l')}
            WHERE lp.loan_id = ANY($1)
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

        result = {
          ...result,
          title: 'Performance by Loan Officer',
          summary: {
            totalOfficers: performance.rows.length,
            totalLoans: performance.rows.reduce((sum: number, r: any) => sum + parseInt(r.total_loans), 0),
            totalFunded: performance.rows.reduce((sum: number, r: any) => sum + parseInt(r.funded_loans), 0),
            totalVolume: performance.rows.reduce((sum: number, r: any) => sum + (parseFloat(r.total_volume) || 0), 0)
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
        const comparisonsQuery = `
          SELECT 
            TO_CHAR(DATE_TRUNC('month', l.application_date), 'YYYY-MM') as month,
            COUNT(*) as loans_started,
            COUNT(CASE WHEN l.funding_date IS NOT NULL THEN 1 END) as loans_funded,
            SUM(l.loan_amount) as total_volume,
            SUM(CASE WHEN l.funding_date IS NOT NULL THEN l.loan_amount ELSE 0 END) as funded_volume,
            AVG(CASE 
              WHEN l.funding_date IS NOT NULL AND l.application_date IS NOT NULL 
              THEN DATE(l.funding_date) - DATE(l.application_date) 
              ELSE NULL 
            END) as avg_cycle_time
          FROM public.loans l
          WHERE l.application_date >= ($1::date - INTERVAL '12 months')
          GROUP BY DATE_TRUNC('month', l.application_date)
          ORDER BY month DESC
          LIMIT 13
        `;

        const comparisons = await tenantPool.query(comparisonsQuery, [startDate]);

        result = {
          ...result,
          title: 'Monthly Trends',
          summary: {
            monthsAnalyzed: comparisons.rows.length,
            totalLoans: comparisons.rows.reduce((sum: number, r: any) => sum + parseInt(r.loans_started), 0),
            totalFunded: comparisons.rows.reduce((sum: number, r: any) => sum + parseInt(r.loans_funded), 0)
          },
          months: comparisons.rows.map((row: any) => ({
            month: row.month,
            loansStarted: parseInt(row.loans_started),
            loansFunded: parseInt(row.loans_funded),
            totalVolume: parseFloat(row.total_volume) || 0,
            fundedVolume: parseFloat(row.funded_volume) || 0,
            avgCycleTime: row.avg_cycle_time ? Math.round(parseFloat(row.avg_cycle_time)) : null,
            pullThrough: parseInt(row.loans_started) > 0
              ? Math.round((parseInt(row.loans_funded) / parseInt(row.loans_started)) * 100)
              : 0
          }))
        };
        break;
      }

      default:
        res.status(400).json({ error: `Unknown insight source: ${source}` });
        return;
    }

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
