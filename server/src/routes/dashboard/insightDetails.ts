/**
 * Insight Details API
 * Returns detailed data for specific insight types (for drill-down modals)
 */

import { Router } from 'express';
import { authenticateToken, AuthRequest } from '../../middleware/auth.js';
import { attachTenantContext, getTenantContext } from '../../middleware/tenantContext.js';
import { handleDatabaseError } from '../../config/database.js';
import { apiLimiter } from '../../middleware/rateLimiter.js';

const router = Router();

/**
 * GET /api/dashboard/insights/details/:source
 * Get detailed data for a specific insight source
 * 
 * Sources: predictions, credit_risk, lost_opportunity, pipeline, performance
 */
router.get('/details/:source', authenticateToken, attachTenantContext, apiLimiter, async (req: AuthRequest, res) => {
  try {
    const tenantContext = getTenantContext(req);
    const tenantPool = tenantContext.tenantPool;
    const { source } = req.params;
    const { dateFilter = 'ytd' } = req.query;

    // Calculate date range
    let startDate: Date | null = null;
    const endDate = new Date();
    
    switch (dateFilter) {
      case 'today':
        startDate = new Date();
        startDate.setHours(0, 0, 0, 0);
        break;
      case 'mtd':
        startDate = new Date(endDate.getFullYear(), endDate.getMonth(), 1);
        break;
      case 'ytd':
        startDate = new Date(endDate.getFullYear(), 0, 1);
        break;
      default:
        startDate = new Date(endDate.getFullYear(), 0, 1);
    }

    let result: any = { source, dateFilter };

    switch (source) {
      case 'predictions': {
        // Get high-risk loans with full details
        const predictionsQuery = `
          SELECT 
            lp.loan_id,
            lp.predicted_outcome,
            lp.confidence,
            lp.reasoning,
            lp.risk_factors,
            l.loan_amount,
            l.loan_type,
            l.current_loan_status as status,
            l.fico_score,
            l.ltv,
            l.dti,
            l.application_date,
            COALESCE(e.first_name || ' ' || e.last_name, l.loan_officer) as loan_officer
          FROM public.loan_predictions lp
          JOIN public.loans l ON l.loan_id = lp.loan_id
          LEFT JOIN public.employees e ON e.id::TEXT = l.loan_officer_id
          WHERE lp.predicted_outcome IN ('withdraw', 'deny')
            AND lp.confidence >= 50
          ORDER BY lp.confidence DESC, l.loan_amount DESC
          LIMIT 100
        `;
        
        const predictions = await tenantPool.query(predictionsQuery);
        
        // Summary stats
        const withdrawCount = predictions.rows.filter(r => r.predicted_outcome === 'withdraw').length;
        const denyCount = predictions.rows.filter(r => r.predicted_outcome === 'deny').length;
        const totalAtRiskVolume = predictions.rows.reduce((sum, r) => sum + (parseFloat(r.loan_amount) || 0), 0);
        const highConfidenceCount = predictions.rows.filter(r => r.confidence >= 70).length;
        
        result = {
          ...result,
          title: 'At-Risk Loans (Fallout Predictions)',
          summary: {
            totalAtRisk: predictions.rows.length,
            likelyWithdraw: withdrawCount,
            likelyDeny: denyCount,
            highConfidence: highConfidenceCount,
            totalVolume: totalAtRiskVolume,
            avgConfidence: predictions.rows.length > 0 
              ? predictions.rows.reduce((sum, r) => sum + r.confidence, 0) / predictions.rows.length 
              : 0
          },
          loans: predictions.rows.map(row => ({
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

      case 'credit_risk': {
        // Get loans with credit risk issues
        const creditRiskQuery = `
          SELECT 
            l.loan_id,
            l.loan_amount,
            l.loan_type,
            l.current_loan_status as status,
            l.fico_score,
            l.ltv,
            l.dti,
            l.application_date,
            COALESCE(e.first_name || ' ' || e.last_name, l.loan_officer) as loan_officer,
            CASE 
              WHEN CAST(l.fico_score AS INTEGER) < 620 THEN 'Low FICO'
              WHEN CAST(l.ltv AS DECIMAL) > 95 THEN 'High LTV'
              WHEN CAST(l.dti AS DECIMAL) > 50 THEN 'High DTI'
              ELSE 'Multiple Factors'
            END as risk_reason
          FROM public.loans l
          LEFT JOIN public.employees e ON e.id::TEXT = l.loan_officer_id
          WHERE l.current_loan_status = 'Active Loan'
            AND (
              CAST(l.fico_score AS INTEGER) < 620
              OR CAST(l.ltv AS DECIMAL) > 95
              OR CAST(l.dti AS DECIMAL) > 50
            )
          ORDER BY l.loan_amount DESC
          LIMIT 100
        `;
        
        const creditRisk = await tenantPool.query(creditRiskQuery);
        
        const lowFicoCount = creditRisk.rows.filter(r => parseInt(r.fico_score) < 620).length;
        const highLtvCount = creditRisk.rows.filter(r => parseFloat(r.ltv) > 95).length;
        const highDtiCount = creditRisk.rows.filter(r => parseFloat(r.dti) > 50).length;
        
        result = {
          ...result,
          title: 'Credit Risk Loans',
          summary: {
            totalHighRisk: creditRisk.rows.length,
            lowFico: lowFicoCount,
            highLtv: highLtvCount,
            highDti: highDtiCount,
            totalVolume: creditRisk.rows.reduce((sum, r) => sum + (parseFloat(r.loan_amount) || 0), 0)
          },
          loans: creditRisk.rows.map(row => ({
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

      case 'lost_opportunity': {
        // Get withdrawn and denied loans
        const lostOpportunityQuery = `
          SELECT 
            l.loan_id,
            l.loan_amount,
            l.loan_type,
            l.current_loan_status as status,
            l.application_date,
            l.fico_score,
            l.ltv,
            COALESCE(e.first_name || ' ' || e.last_name, l.loan_officer) as loan_officer
          FROM public.loans l
          LEFT JOIN public.employees e ON e.id::TEXT = l.loan_officer_id
          WHERE l.current_loan_status IN ('withdrawn', 'cancelled', 'Withdrawn', 'denied', 'declined', 'Denied')
            AND l.application_date >= $1
          ORDER BY l.loan_amount DESC
          LIMIT 100
        `;
        
        const lostOpp = await tenantPool.query(lostOpportunityQuery, [startDate]);
        
        const withdrawn = lostOpp.rows.filter(r => ['withdrawn', 'cancelled', 'Withdrawn'].includes(r.status));
        const denied = lostOpp.rows.filter(r => ['denied', 'declined', 'Denied'].includes(r.status));
        
        result = {
          ...result,
          title: 'Lost Opportunity (Withdrawn & Denied)',
          summary: {
            totalLost: lostOpp.rows.length,
            withdrawn: withdrawn.length,
            denied: denied.length,
            withdrawnVolume: withdrawn.reduce((sum, r) => sum + (parseFloat(r.loan_amount) || 0), 0),
            deniedVolume: denied.reduce((sum, r) => sum + (parseFloat(r.loan_amount) || 0), 0),
            estimatedLostRevenue: lostOpp.rows.reduce((sum, r) => sum + (parseFloat(r.loan_amount) || 0), 0) * 0.01
          },
          loans: lostOpp.rows.map(row => ({
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

      case 'pipeline': {
        // Get active pipeline loans
        const pipelineQuery = `
          SELECT 
            l.loan_id,
            l.loan_amount,
            l.loan_type,
            l.current_loan_status as status,
            l.application_date,
            l.lock_date,
            l.fico_score,
            l.ltv,
            COALESCE(e.first_name || ' ' || e.last_name, l.loan_officer) as loan_officer,
            CASE 
              WHEN l.application_date IS NOT NULL 
              THEN CURRENT_DATE - DATE(l.application_date) 
              ELSE NULL 
            END as days_in_pipeline
          FROM public.loans l
          LEFT JOIN public.employees e ON e.id::TEXT = l.loan_officer_id
          WHERE l.current_loan_status = 'Active Loan'
          ORDER BY l.loan_amount DESC
          LIMIT 100
        `;
        
        const pipeline = await tenantPool.query(pipelineQuery);
        
        const lockedCount = pipeline.rows.filter(r => r.lock_date).length;
        const over45Days = pipeline.rows.filter(r => r.days_in_pipeline > 45).length;
        const over30Days = pipeline.rows.filter(r => r.days_in_pipeline > 30).length;
        
        result = {
          ...result,
          title: 'Active Pipeline',
          summary: {
            totalActive: pipeline.rows.length,
            locked: lockedCount,
            unlocked: pipeline.rows.length - lockedCount,
            over30Days: over30Days,
            over45Days: over45Days,
            totalVolume: pipeline.rows.reduce((sum, r) => sum + (parseFloat(r.loan_amount) || 0), 0),
            avgDaysInPipeline: pipeline.rows.length > 0
              ? Math.round(pipeline.rows.reduce((sum, r) => sum + (r.days_in_pipeline || 0), 0) / pipeline.rows.length)
              : 0
          },
          loans: pipeline.rows.map(row => ({
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

      case 'performance': {
        // Get performance metrics by loan officer
        const performanceQuery = `
          SELECT 
            COALESCE(e.first_name || ' ' || e.last_name, l.loan_officer, 'Unknown') as loan_officer,
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
          LEFT JOIN public.employees e ON e.id::TEXT = l.loan_officer_id
          WHERE l.application_date >= $1
          GROUP BY COALESCE(e.first_name || ' ' || e.last_name, l.loan_officer, 'Unknown')
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
            totalLoans: performance.rows.reduce((sum, r) => sum + parseInt(r.total_loans), 0),
            totalFunded: performance.rows.reduce((sum, r) => sum + parseInt(r.funded_loans), 0),
            totalVolume: performance.rows.reduce((sum, r) => sum + (parseFloat(r.total_volume) || 0), 0)
          },
          officers: performance.rows.map(row => ({
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

      case 'comparisons': {
        // Get monthly comparison data
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
          WHERE l.application_date >= $1 - INTERVAL '12 months'
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
            totalLoans: comparisons.rows.reduce((sum, r) => sum + parseInt(r.loans_started), 0),
            totalFunded: comparisons.rows.reduce((sum, r) => sum + parseInt(r.loans_funded), 0)
          },
          months: comparisons.rows.map(row => ({
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
