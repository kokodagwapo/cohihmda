/**
 * Data Quality API Routes
 * Provides endpoints for data quality monitoring and analysis
 * Inspired by Qlik Data Pilot features
 */

import { Router } from 'express';
import { authenticateToken, AuthRequest } from '../middleware/auth.js';
import { attachTenantContext, getTenantContext } from '../middleware/tenantContext.js';
import { apiLimiter } from '../middleware/rateLimiter.js';
import { logError, logWarn, logInfo } from '../services/logger.js';

const router = Router();

/**
 * Crucial fields list from Qlik Data Pilot
 * These are priority fields that should always be populated
 */
const CRUCIAL_FIELDS = [
  { name: 'Funding Date', column: 'funding_date', priority: 1 },
  { name: 'Branch', column: 'branch', priority: 2 },
  { name: 'Closing Date', column: 'closing_date', priority: 3 },
  { name: 'Started Date', column: 'started_date', priority: 4 },
  { name: 'Loan Officer', column: 'loan_officer', priority: 5 },
  { name: 'Processor', column: 'processor', priority: 6 },
  { name: 'Underwriter', column: 'underwriter', priority: 7 },
  { name: 'Closer', column: 'closer', priority: 8 },
  { name: 'Account Executive', column: 'account_executive', priority: 9 },
  { name: 'Conditional Approval Date', column: 'conditional_approval_date', priority: 10 },
  { name: 'Credit Pull Date', column: 'credit_pull_date', priority: 11 },
  { name: 'CTC Date', column: 'ctc_date', priority: 12 },
  { name: 'Estimated Closing Date', column: 'estimated_closing_date', priority: 13 },
  { name: 'Investor Purchase Date', column: 'investor_purchase_date', priority: 14 },
  { name: 'Resubmittal Date', column: 'resubmittal_date', priority: 15 },
  { name: 'Shipped Date', column: 'shipped_date', priority: 16 },
  { name: 'UW Approval Date', column: 'uw_approval_date', priority: 17 },
  { name: 'UW Final Approval Date', column: 'uw_final_approval_date', priority: 18 },
  { name: 'Submitted To Processing Date', column: 'submitted_to_processing_date', priority: 19 },
  { name: 'Submitted To Underwriting Date', column: 'submitted_to_underwriting_date', priority: 20 },
  { name: 'Loan Amount', column: 'loan_amount', priority: 21 },
  { name: 'Loan Number', column: 'loan_number', priority: 22 },
  { name: 'Current Status Date', column: 'current_status_date', priority: 23 },
  { name: 'UW Denied Date', column: 'uw_denied_date', priority: 24 },
  { name: 'Application Date', column: 'application_date', priority: 25 },
  { name: 'Loan Estimate Sent Date', column: 'loan_estimate_sent_date', priority: 26 },
  { name: 'Rate Lock Buy Side Base Price Rate', column: 'rate_lock_buy_side_base_price_rate', priority: 27 },
  { name: 'Loan Source', column: 'loan_source', priority: 28 },
  { name: 'Investor Status', column: 'investor_status', priority: 29 },
];

/**
 * Range configuration for key loan metrics
 */
const RANGE_CONFIG = {
  fico: { min: 300, max: 850, label: 'FICO Score', column: 'fico_score' },
  ltv: { min: 0, max: 100, label: 'LTV Ratio', column: 'ltv_ratio' },
  dti: { min: 0, max: 100, label: 'DTI Ratio', column: 'dti_ratio' },
  interestRate: { min: 0, max: 15, label: 'Interest Rate', column: 'interest_rate' },
};

/**
 * GET /api/data-quality/crucial-fields-status
 * Get population status for crucial fields
 */
router.get('/crucial-fields-status', authenticateToken, attachTenantContext, apiLimiter, async (req: AuthRequest, res) => {
  try {
    const tenantPool = getTenantContext(req).tenantPool;
    
    // Get total loan count
    const countResult = await tenantPool.query('SELECT COUNT(*) as total FROM loans');
    const totalLoans = parseInt(countResult.rows[0]?.total || '0');
    
    if (totalLoans === 0) {
      return res.json({ 
        success: true, 
        crucialFields: [],
        totalLoans: 0 
      });
    }

    // Check which columns actually exist in the loans table
    const columnsResult = await tenantPool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_schema = 'public' AND table_name = 'loans'
    `);
    const existingColumns = new Set(columnsResult.rows.map(r => r.column_name));

    // Build queries for each crucial field that exists
    const crucialFieldsStatus = [];
    
    for (const field of CRUCIAL_FIELDS) {
      if (existingColumns.has(field.column)) {
        const populatedResult = await tenantPool.query(`
          SELECT COUNT(*) as populated 
          FROM loans 
          WHERE ${field.column} IS NOT NULL 
            AND TRIM(CAST(${field.column} AS TEXT)) != ''
            AND CAST(${field.column} AS TEXT) NOT IN ('99-Missing', 'No Data', 'No Branch Found')
        `);
        
        const populatedCount = parseInt(populatedResult.rows[0]?.populated || '0');
        const populationRate = totalLoans > 0 ? (populatedCount / totalLoans) * 100 : 0;
        
        crucialFieldsStatus.push({
          name: field.name,
          column: field.column,
          priority: field.priority,
          populationRate: Math.round(populationRate * 10) / 10,
          populatedCount,
          totalCount: totalLoans,
          status: populationRate >= 80 ? 'good' : populationRate >= 50 ? 'warning' : 'critical'
        });
      } else {
        // Column doesn't exist
        crucialFieldsStatus.push({
          name: field.name,
          column: field.column,
          priority: field.priority,
          populationRate: 0,
          populatedCount: 0,
          totalCount: totalLoans,
          status: 'critical',
          missing: true
        });
      }
    }

    res.json({
      success: true,
      crucialFields: crucialFieldsStatus,
      totalLoans
    });
  } catch (error: unknown) {
    logError('Error fetching crucial fields status', { error });
    res.status(500).json({ error: 'Failed to fetch crucial fields status' });
  }
});

/**
 * GET /api/data-quality/range-analysis
 * Get distribution data for key metrics (FICO, LTV, DTI, Interest Rate)
 */
router.get('/range-analysis', authenticateToken, attachTenantContext, apiLimiter, async (req: AuthRequest, res) => {
  try {
    const tenantPool = getTenantContext(req).tenantPool;
    
    // Check which columns exist
    const columnsResult = await tenantPool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_schema = 'public' AND table_name = 'loans'
    `);
    const existingColumns = new Set(columnsResult.rows.map(r => r.column_name));

    const rangeAnalysis: Record<string, {
      inRange: number;
      outOfRange: number;
      distribution: { range: string; count: number }[];
    }> = {};

    // FICO Score Analysis (300-850)
    if (existingColumns.has('fico_score')) {
      const ficoResult = await tenantPool.query(`
        SELECT 
          SUM(CASE WHEN fico_score >= 300 AND fico_score <= 850 THEN 1 ELSE 0 END) as in_range,
          SUM(CASE WHEN fico_score < 300 OR fico_score > 850 THEN 1 ELSE 0 END) as out_of_range,
          SUM(CASE WHEN fico_score >= 300 AND fico_score <= 579 THEN 1 ELSE 0 END) as range_300_579,
          SUM(CASE WHEN fico_score >= 580 AND fico_score <= 669 THEN 1 ELSE 0 END) as range_580_669,
          SUM(CASE WHEN fico_score >= 670 AND fico_score <= 739 THEN 1 ELSE 0 END) as range_670_739,
          SUM(CASE WHEN fico_score >= 740 AND fico_score <= 799 THEN 1 ELSE 0 END) as range_740_799,
          SUM(CASE WHEN fico_score >= 800 AND fico_score <= 850 THEN 1 ELSE 0 END) as range_800_850
        FROM loans
        WHERE fico_score IS NOT NULL
      `);
      
      const r = ficoResult.rows[0] || {};
      rangeAnalysis.fico = {
        inRange: parseInt(r.in_range || '0'),
        outOfRange: parseInt(r.out_of_range || '0'),
        distribution: [
          { range: '300-579', count: parseInt(r.range_300_579 || '0') },
          { range: '580-669', count: parseInt(r.range_580_669 || '0') },
          { range: '670-739', count: parseInt(r.range_670_739 || '0') },
          { range: '740-799', count: parseInt(r.range_740_799 || '0') },
          { range: '800-850', count: parseInt(r.range_800_850 || '0') },
          { range: 'Out of Range', count: parseInt(r.out_of_range || '0') }
        ]
      };
    }

    // LTV Ratio Analysis (0-100%)
    if (existingColumns.has('ltv_ratio')) {
      const ltvResult = await tenantPool.query(`
        SELECT 
          SUM(CASE WHEN ltv_ratio >= 0 AND ltv_ratio <= 100 THEN 1 ELSE 0 END) as in_range,
          SUM(CASE WHEN ltv_ratio < 0 OR ltv_ratio > 100 THEN 1 ELSE 0 END) as out_of_range,
          SUM(CASE WHEN ltv_ratio >= 0 AND ltv_ratio <= 60 THEN 1 ELSE 0 END) as range_0_60,
          SUM(CASE WHEN ltv_ratio > 60 AND ltv_ratio <= 70 THEN 1 ELSE 0 END) as range_61_70,
          SUM(CASE WHEN ltv_ratio > 70 AND ltv_ratio <= 80 THEN 1 ELSE 0 END) as range_71_80,
          SUM(CASE WHEN ltv_ratio > 80 AND ltv_ratio <= 90 THEN 1 ELSE 0 END) as range_81_90,
          SUM(CASE WHEN ltv_ratio > 90 AND ltv_ratio <= 100 THEN 1 ELSE 0 END) as range_91_100
        FROM loans
        WHERE ltv_ratio IS NOT NULL
      `);
      
      const r = ltvResult.rows[0] || {};
      rangeAnalysis.ltv = {
        inRange: parseInt(r.in_range || '0'),
        outOfRange: parseInt(r.out_of_range || '0'),
        distribution: [
          { range: '0-60%', count: parseInt(r.range_0_60 || '0') },
          { range: '61-70%', count: parseInt(r.range_61_70 || '0') },
          { range: '71-80%', count: parseInt(r.range_71_80 || '0') },
          { range: '81-90%', count: parseInt(r.range_81_90 || '0') },
          { range: '91-100%', count: parseInt(r.range_91_100 || '0') },
          { range: 'Over 100%', count: parseInt(r.out_of_range || '0') }
        ]
      };
    }

    // DTI Ratio Analysis (0-100%)
    if (existingColumns.has('dti_ratio')) {
      const dtiResult = await tenantPool.query(`
        SELECT 
          SUM(CASE WHEN dti_ratio >= 0 AND dti_ratio <= 100 THEN 1 ELSE 0 END) as in_range,
          SUM(CASE WHEN dti_ratio < 0 OR dti_ratio > 100 THEN 1 ELSE 0 END) as out_of_range,
          SUM(CASE WHEN dti_ratio >= 0 AND dti_ratio <= 20 THEN 1 ELSE 0 END) as range_0_20,
          SUM(CASE WHEN dti_ratio > 20 AND dti_ratio <= 35 THEN 1 ELSE 0 END) as range_21_35,
          SUM(CASE WHEN dti_ratio > 35 AND dti_ratio <= 43 THEN 1 ELSE 0 END) as range_36_43,
          SUM(CASE WHEN dti_ratio > 43 AND dti_ratio <= 50 THEN 1 ELSE 0 END) as range_44_50,
          SUM(CASE WHEN dti_ratio > 50 AND dti_ratio <= 100 THEN 1 ELSE 0 END) as range_51_100
        FROM loans
        WHERE dti_ratio IS NOT NULL
      `);
      
      const r = dtiResult.rows[0] || {};
      rangeAnalysis.dti = {
        inRange: parseInt(r.in_range || '0'),
        outOfRange: parseInt(r.out_of_range || '0'),
        distribution: [
          { range: '0-20%', count: parseInt(r.range_0_20 || '0') },
          { range: '21-35%', count: parseInt(r.range_21_35 || '0') },
          { range: '36-43%', count: parseInt(r.range_36_43 || '0') },
          { range: '44-50%', count: parseInt(r.range_44_50 || '0') },
          { range: '51-100%', count: parseInt(r.range_51_100 || '0') },
          { range: 'Over 100%', count: parseInt(r.out_of_range || '0') }
        ]
      };
    }

    // Interest Rate Analysis (0-15%)
    if (existingColumns.has('interest_rate')) {
      const rateResult = await tenantPool.query(`
        SELECT 
          SUM(CASE WHEN interest_rate >= 0 AND interest_rate <= 15 THEN 1 ELSE 0 END) as in_range,
          SUM(CASE WHEN interest_rate < 0 OR interest_rate > 15 THEN 1 ELSE 0 END) as out_of_range,
          SUM(CASE WHEN interest_rate >= 0 AND interest_rate <= 3 THEN 1 ELSE 0 END) as range_0_3,
          SUM(CASE WHEN interest_rate > 3 AND interest_rate <= 5 THEN 1 ELSE 0 END) as range_3_5,
          SUM(CASE WHEN interest_rate > 5 AND interest_rate <= 7 THEN 1 ELSE 0 END) as range_5_7,
          SUM(CASE WHEN interest_rate > 7 AND interest_rate <= 10 THEN 1 ELSE 0 END) as range_7_10,
          SUM(CASE WHEN interest_rate > 10 AND interest_rate <= 15 THEN 1 ELSE 0 END) as range_10_15
        FROM loans
        WHERE interest_rate IS NOT NULL
      `);
      
      const r = rateResult.rows[0] || {};
      rangeAnalysis.interestRate = {
        inRange: parseInt(r.in_range || '0'),
        outOfRange: parseInt(r.out_of_range || '0'),
        distribution: [
          { range: '0-3%', count: parseInt(r.range_0_3 || '0') },
          { range: '3-5%', count: parseInt(r.range_3_5 || '0') },
          { range: '5-7%', count: parseInt(r.range_5_7 || '0') },
          { range: '7-10%', count: parseInt(r.range_7_10 || '0') },
          { range: '10-15%', count: parseInt(r.range_10_15 || '0') },
          { range: 'Over 15%', count: parseInt(r.out_of_range || '0') }
        ]
      };
    }

    res.json({
      success: true,
      rangeAnalysis
    });
  } catch (error: unknown) {
    logError('Error fetching range analysis', { error });
    res.status(500).json({ error: 'Failed to fetch range analysis' });
  }
});

/**
 * GET /api/data-quality/warnings-grouped
 * Get data quality warnings grouped by type
 */
router.get('/warnings-grouped', authenticateToken, attachTenantContext, apiLimiter, async (req: AuthRequest, res) => {
  try {
    const tenantPool = getTenantContext(req).tenantPool;
    
    // Check which columns exist
    const columnsResult = await tenantPool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_schema = 'public' AND table_name = 'loans'
    `);
    const existingColumns = new Set(columnsResult.rows.map(r => r.column_name));

    const warnings: Array<{
      id: string;
      type: string;
      severity: string;
      field: string;
      description: string;
      count: number;
      sample_loans: string[];
    }> = [];

    // Check for missing required fields (loan_number, loan_amount)
    if (existingColumns.has('loan_number')) {
      const missingLoanNumber = await tenantPool.query(`
        SELECT loan_id, loan_number
        FROM loans
        WHERE loan_number IS NULL OR TRIM(loan_number) = ''
        LIMIT 5
      `);
      if (missingLoanNumber.rows.length > 0) {
        const countResult = await tenantPool.query(`
          SELECT COUNT(*) as count FROM loans WHERE loan_number IS NULL OR TRIM(loan_number) = ''
        `);
        warnings.push({
          id: 'missing_loan_number',
          type: 'missing_required',
          severity: 'critical',
          field: 'loan_number',
          description: 'Loan number is missing',
          count: parseInt(countResult.rows[0]?.count || '0'),
          sample_loans: missingLoanNumber.rows.map(r => r.loan_id).slice(0, 5)
        });
      }
    }

    // Check for out-of-range interest rates
    if (existingColumns.has('interest_rate')) {
      const highRates = await tenantPool.query(`
        SELECT loan_id, loan_number, interest_rate
        FROM loans
        WHERE interest_rate > 15 OR interest_rate < 0
        LIMIT 5
      `);
      if (highRates.rows.length > 0) {
        const countResult = await tenantPool.query(`
          SELECT COUNT(*) as count FROM loans WHERE interest_rate > 15 OR interest_rate < 0
        `);
        warnings.push({
          id: 'out_of_range_interest_rate',
          type: 'out_of_range',
          severity: 'critical',
          field: 'interest_rate',
          description: 'Interest rate is outside expected range (0-15%)',
          count: parseInt(countResult.rows[0]?.count || '0'),
          sample_loans: highRates.rows.map(r => r.loan_number || r.loan_id).slice(0, 5)
        });
      }
    }

    // Check for LTV > 100%
    if (existingColumns.has('ltv_ratio')) {
      const highLtv = await tenantPool.query(`
        SELECT loan_id, loan_number, ltv_ratio
        FROM loans
        WHERE ltv_ratio > 100
        LIMIT 5
      `);
      if (highLtv.rows.length > 0) {
        const countResult = await tenantPool.query(`
          SELECT COUNT(*) as count FROM loans WHERE ltv_ratio > 100
        `);
        warnings.push({
          id: 'out_of_range_ltv',
          type: 'out_of_range',
          severity: 'warning',
          field: 'ltv_ratio',
          description: 'LTV ratio exceeds 100%',
          count: parseInt(countResult.rows[0]?.count || '0'),
          sample_loans: highLtv.rows.map(r => r.loan_number || r.loan_id).slice(0, 5)
        });
      }
    }

    // Check for missing loan officer
    if (existingColumns.has('loan_officer')) {
      const missingLo = await tenantPool.query(`
        SELECT loan_id, loan_number
        FROM loans
        WHERE loan_officer IS NULL 
          OR TRIM(loan_officer) = '' 
          OR loan_officer IN ('99-Missing', 'No Data')
        LIMIT 5
      `);
      if (missingLo.rows.length > 0) {
        const countResult = await tenantPool.query(`
          SELECT COUNT(*) as count FROM loans 
          WHERE loan_officer IS NULL 
            OR TRIM(loan_officer) = '' 
            OR loan_officer IN ('99-Missing', 'No Data')
        `);
        warnings.push({
          id: 'missing_loan_officer',
          type: 'missing_required',
          severity: 'warning',
          field: 'loan_officer',
          description: 'Loan officer is missing or invalid',
          count: parseInt(countResult.rows[0]?.count || '0'),
          sample_loans: missingLo.rows.map(r => r.loan_number || r.loan_id).slice(0, 5)
        });
      }
    }

    // Check for future closing dates (more than 6 months out)
    if (existingColumns.has('closing_date')) {
      const futureClosing = await tenantPool.query(`
        SELECT loan_id, loan_number, closing_date
        FROM loans
        WHERE closing_date > CURRENT_DATE + INTERVAL '6 months'
        LIMIT 5
      `);
      if (futureClosing.rows.length > 0) {
        const countResult = await tenantPool.query(`
          SELECT COUNT(*) as count FROM loans WHERE closing_date > CURRENT_DATE + INTERVAL '6 months'
        `);
        warnings.push({
          id: 'future_closing_date',
          type: 'future_date',
          severity: 'info',
          field: 'closing_date',
          description: 'Closing date is more than 6 months in the future',
          count: parseInt(countResult.rows[0]?.count || '0'),
          sample_loans: futureClosing.rows.map(r => r.loan_number || r.loan_id).slice(0, 5)
        });
      }
    }

    // Group warnings by type for summary
    const groupedSummary = warnings.reduce((acc, w) => {
      acc[w.type] = (acc[w.type] || 0) + w.count;
      return acc;
    }, {} as Record<string, number>);

    res.json({
      success: true,
      warnings,
      summary: groupedSummary,
      totalWarnings: warnings.reduce((sum, w) => sum + w.count, 0)
    });
  } catch (error: unknown) {
    logError('Error fetching grouped warnings', { error });
    res.status(500).json({ error: 'Failed to fetch grouped warnings' });
  }
});

/**
 * GET /api/data-quality/metrics
 * Get overall data quality metrics summary
 */
router.get('/metrics', authenticateToken, attachTenantContext, apiLimiter, async (req: AuthRequest, res) => {
  try {
    const tenantPool = getTenantContext(req).tenantPool;
    
    // Get total loan count
    const countResult = await tenantPool.query('SELECT COUNT(*) as total FROM loans');
    const totalLoans = parseInt(countResult.rows[0]?.total || '0');
    
    if (totalLoans === 0) {
      return res.json({ 
        success: true, 
        metrics: {
          total_loans: 0,
          loans_with_issues: 0,
          total_issues: 0,
          quality_score: 100,
          critical_issues: 0,
          warning_issues: 0,
          info_issues: 0
        }
      });
    }

    // Calculate various quality issues
    const columnsResult = await tenantPool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_schema = 'public' AND table_name = 'loans'
    `);
    const existingColumns = new Set(columnsResult.rows.map(r => r.column_name));

    let criticalIssues = 0;
    let warningIssues = 0;
    let infoIssues = 0;

    // Count critical issues
    if (existingColumns.has('interest_rate')) {
      const result = await tenantPool.query(`SELECT COUNT(*) as c FROM loans WHERE interest_rate > 15 OR interest_rate < 0`);
      criticalIssues += parseInt(result.rows[0]?.c || '0');
    }
    if (existingColumns.has('loan_number')) {
      const result = await tenantPool.query(`SELECT COUNT(*) as c FROM loans WHERE loan_number IS NULL OR TRIM(loan_number) = ''`);
      criticalIssues += parseInt(result.rows[0]?.c || '0');
    }

    // Count warning issues
    if (existingColumns.has('ltv_ratio')) {
      const result = await tenantPool.query(`SELECT COUNT(*) as c FROM loans WHERE ltv_ratio > 100`);
      warningIssues += parseInt(result.rows[0]?.c || '0');
    }
    if (existingColumns.has('loan_officer')) {
      const result = await tenantPool.query(`SELECT COUNT(*) as c FROM loans WHERE loan_officer IS NULL OR TRIM(loan_officer) = '' OR loan_officer IN ('99-Missing', 'No Data')`);
      warningIssues += parseInt(result.rows[0]?.c || '0');
    }

    // Count info issues
    if (existingColumns.has('closing_date')) {
      const result = await tenantPool.query(`SELECT COUNT(*) as c FROM loans WHERE closing_date > CURRENT_DATE + INTERVAL '6 months'`);
      infoIssues += parseInt(result.rows[0]?.c || '0');
    }

    const totalIssues = criticalIssues + warningIssues + infoIssues;
    const loansWithIssues = Math.min(totalIssues, totalLoans); // Rough estimate
    
    // Calculate quality score (100 - percentage of loans with issues, weighted by severity)
    const weightedIssueScore = (criticalIssues * 3 + warningIssues * 2 + infoIssues * 1) / totalLoans;
    const qualityScore = Math.max(0, Math.min(100, Math.round(100 - (weightedIssueScore * 10))));

    res.json({
      success: true,
      metrics: {
        total_loans: totalLoans,
        loans_with_issues: loansWithIssues,
        total_issues: totalIssues,
        quality_score: qualityScore,
        critical_issues: criticalIssues,
        warning_issues: warningIssues,
        info_issues: infoIssues
      }
    });
  } catch (error: unknown) {
    logError('Error fetching data quality metrics', { error });
    res.status(500).json({ error: 'Failed to fetch data quality metrics' });
  }
});

export default router;
