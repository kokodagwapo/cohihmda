/**
 * Loans API Routes
 * Provides endpoints for querying loan data from the database
 */

import { Router } from 'express';
import fs from 'fs';
import { pool, retryQuery, handleDatabaseError } from '../config/database.js';
import { authenticateToken, AuthRequest } from '../middleware/auth.js';
import { attachTenantContext, getTenantContext } from '../middleware/tenantContext.js';
import { apiLimiter } from '../middleware/rateLimiter.js';
import { logError, logWarn, logInfo, logDebug } from '../services/logger.js';

// Helper function to calculate days between dates
function daysBetween(date1: Date | string | null, date2: Date | string | null): number | null {
  if (!date1 || !date2) return null;
  const d1 = new Date(date1);
  const d2 = new Date(date2);
  if (isNaN(d1.getTime()) || isNaN(d2.getTime())) return null;
  return Math.round((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24));
}

const router = Router();

/**
 * GET /api/loans
 * Get loans for authenticated tenant with optional filters
 * Uses tenant-specific database (no tenant_id in WHERE clause)
 */
router.get('/', authenticateToken, attachTenantContext, apiLimiter, async (req: AuthRequest, res) => {
  try {
    const tenantPool = getTenantContext(req).tenantPool;

    // Parse query parameters
    const {
      status,
      loan_type,
      limit = '100',
      offset = '0',
      start_date,
      end_date,
    } = req.query;

    // Build query (no tenant_id filter - using tenant-specific database)
    let query = 'SELECT * FROM public.loans WHERE 1=1';
    const params: any[] = [];
    let paramIndex = 1;

    if (status) {
      query += ` AND status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }

    if (loan_type) {
      query += ` AND loan_type = $${paramIndex}`;
      params.push(loan_type);
      paramIndex++;
    }

    if (start_date) {
      query += ` AND application_date >= $${paramIndex}`;
      params.push(start_date);
      paramIndex++;
    }

    if (end_date) {
      query += ` AND application_date <= $${paramIndex}`;
      params.push(end_date);
      paramIndex++;
    }

    query += ` ORDER BY created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(parseInt(limit as string), parseInt(offset as string));

    const result = await tenantPool.query(query, params);

    // Get total count for pagination (no tenant_id filter - using tenant-specific database)
    let countQuery = 'SELECT COUNT(*) FROM public.loans WHERE 1=1';
    const countParams: any[] = [];
    let countParamIndex = 1;

    if (status) {
      countQuery += ` AND status = $${countParamIndex}`;
      countParams.push(status);
      countParamIndex++;
    }

    if (loan_type) {
      countQuery += ` AND loan_type = $${countParamIndex}`;
      countParams.push(loan_type);
      countParamIndex++;
    }

    if (start_date) {
      countQuery += ` AND application_date >= $${countParamIndex}`;
      countParams.push(start_date);
      countParamIndex++;
    }

    if (end_date) {
      countQuery += ` AND application_date <= $${countParamIndex}`;
      countParams.push(end_date);
      countParamIndex++;
    }

    const countResult = await tenantPool.query(countQuery, countParams);
    const total = parseInt(countResult.rows[0].count);

    res.json({
      loans: result.rows,
      total,
      limit: parseInt(limit as string),
      offset: parseInt(offset as string),
    });
  } catch (error: any) {
    logError('Error fetching loans', error, { userId: req.userId });
    
    // Handle database connection errors
    if (handleDatabaseError(error, res, 'Failed to fetch loans')) {
      return;
    }
    
    res.status(500).json({ error: error.message || 'Failed to fetch loans' });
  }
});

/**
 * GET /api/loans/stats
 * Get aggregated loan statistics for business overview
 */
router.get('/stats', authenticateToken, apiLimiter, async (req: AuthRequest, res) => {
  try {
    // Get tenant_id from query or user profile (supports super admins)
    let tenantId = req.query.tenant_id as string;
    
    if (!tenantId) {
      const profileResult = await retryQuery(
        () => pool.query(
          'SELECT tenant_id FROM public.profiles WHERE user_id = $1',
          [req.userId]
        ),
        3, 1000
      );
      tenantId = profileResult.rows[0]?.tenant_id;
    }
    
    // If still no tenant, check if user is super admin and use Default Tenant
    if (!tenantId) {
      const userResult = await retryQuery(
        () => pool.query(
          'SELECT role FROM public.users WHERE id = $1',
          [req.userId]
        ),
        3, 1000
      );
      if (userResult.rows[0]?.role === 'super_admin') {
        const defaultTenantResult = await retryQuery(
          () => pool.query(
            `SELECT id FROM public.tenants WHERE name = 'Default Tenant' LIMIT 1`
          ),
          3, 1000
        );
        if (defaultTenantResult.rows.length > 0) {
          tenantId = defaultTenantResult.rows[0].id;
        }
      }
    }

    if (!tenantId) {
      logWarn('No tenant found for user', { userId: req.userId });
      return res.status(404).json({ error: 'Tenant not found' });
    }
    logDebug('User to tenant mapping', { userId: req.userId, tenantId });


    // Get date filter (today, mtd, ytd, or custom)
    // For business overview stats, always use 'all' to show all imported loans
    // This ensures the overview cards show correct counts regardless of date filter selection
    const { dateFilter = 'all' } = req.query;
    const effectiveDateFilter = 'all'; // Always use 'all' for stats to show all imported data

    // Calculate date range - always use 'all' to show all loans
    let startDate: Date | null = null;

    // Get all loans for tenant (optimized query - only select needed columns)
    // Use retryQuery for database resilience
    // Note: Include loans with NULL application_date to match funnel endpoint behavior
    const loansResult = await retryQuery(
      () => {
        if (startDate) {
          return pool.query(
            `SELECT 
              loan_id, borrower_name, loan_amount, loan_type, status, 
              application_date, closing_date, lock_date, interest_rate,
              loan_purpose, branch, credit_pull_date, cycle_time_days,
              raw_data
             FROM public.loans 
             WHERE tenant_id = $1 
             AND (application_date >= $2 OR application_date IS NULL)
             ORDER BY application_date DESC NULLS LAST`,
            [tenantId, startDate]
          );
        } else {
          // Get all loans without date filter
          return pool.query(
            `SELECT 
              loan_id, borrower_name, loan_amount, loan_type, status, 
              application_date, closing_date, lock_date, interest_rate,
              loan_purpose, branch, credit_pull_date, cycle_time_days,
              raw_data
             FROM public.loans 
             WHERE tenant_id = $1 
             ORDER BY application_date DESC NULLS LAST`,
            [tenantId]
          );
        }
      },
      2, // max retries
      500 // delay between retries
    );

    // Enhance loans with data from raw_data for fields not in main columns
    const loans = loansResult.rows.map(loan => {
      const rawData = typeof loan.raw_data === 'string' ? JSON.parse(loan.raw_data) : (loan.raw_data || {});
      return {
        ...loan,
        // Extract fields from raw_data if not in main columns
        fico_score: rawData.fico_score || rawData.fico,
        ltv: rawData.ltv || rawData.loan_to_value,
        respa_date: rawData.respa_date || rawData.respaDate,
        fallout_reason: rawData.fallout_reason || rawData.falloutReason || rawData.fallout,
        loan_officer_name: rawData.loan_officer_name || rawData.loan_officer || rawData.officer_name,
      };
    });


    // Debug logging - detailed
    logDebug('Stats API request', { tenantId, loanCount: loans.length, dateFilter, startDate });
    if (loans.length > 0) {
      logDebug('Sample loans', {
        tenantId,
        sampleLoans: loans.slice(0, 3).map(l => ({
          loan_id: l.loan_id,
          status: l.status,
          application_date: l.application_date,
          has_lock_date: !!l.lock_date,
          has_closing_date: !!l.closing_date,
          has_credit_pull_date: !!l.credit_pull_date
        }))
      });
    } else {
      // Check if there are ANY loans in the database for debugging
      const allLoansCheck = await pool.query('SELECT COUNT(*) as total FROM public.loans');
      const tenantLoansCheck = await pool.query('SELECT COUNT(*) as total FROM public.loans WHERE tenant_id = $1', [tenantId]);
      const loansWithNullDate = await pool.query('SELECT COUNT(*) as total FROM public.loans WHERE tenant_id = $1 AND application_date IS NULL', [tenantId]);
      const allTenantsCheck = await pool.query('SELECT tenant_id, COUNT(*) as count FROM public.loans GROUP BY tenant_id LIMIT 5');
      logDebug('No loans found for tenant', {
        tenantId,
        totalLoansInDB: allLoansCheck.rows[0]?.total || 0,
        tenantLoans: tenantLoansCheck.rows[0]?.total || 0,
        loansWithNullDate: loansWithNullDate.rows[0]?.total || 0,
        loansByTenant: allTenantsCheck.rows
      });
    }

    // Calculate statistics with smart status detection
    // Infer status based on dates and raw status
    const getInferredStatus = (loan: any) => {
      if (loan.closing_date) return 'Closed';
      if (loan.lock_date) return 'Locked';
      const rawStatus = (loan.status || '').toString().toUpperCase();
      // Handle all possible status values from both LOS imports and sample data
      if (['ACTIVE', 'SUBMITTED', 'APPROVED', 'CTC', 'STARTED', 'INQUIRY', 'PROCESSING', 'UNDERWRITING'].includes(rawStatus)) return 'Active';
      if (['WITHDRAWN', 'CANCELLED'].includes(rawStatus)) return 'Withdrawn';
      if (['DENIED', 'DECLINED', 'REJECTED'].includes(rawStatus)) return 'Denied';
      if (['ORIGINATED', 'FUNDED', 'CLOSED', 'COMPLETE', 'COMPLETED'].includes(rawStatus)) return 'Closed';
      if (['LOCKED'].includes(rawStatus)) return 'Locked';
      // If status is a state code (2 letters), treat as active
      if (/^[A-Z]{2}$/.test(rawStatus)) return 'Active';
      return 'Active'; // Default
    };

    const loansWithInferredStatus = loans.map(loan => ({
      ...loan,
      inferred_status: getInferredStatus(loan)
    }));

    const activeLoans = loansWithInferredStatus.filter(l =>
      ['Active', 'Locked'].includes(l.inferred_status)
    );
    
    const closedLoans = loansWithInferredStatus.filter(l =>
      l.inferred_status === 'Closed'
    );
    
    // Locked Loans - use inferred_status for consistency
    const lockedLoans = loansWithInferredStatus.filter(l =>
      l.inferred_status === 'Locked'
    );


    // Group by loan type - use loansWithInferredStatus to include inferred_status
    const byLoanType = loansWithInferredStatus.reduce((acc: any, loan: any) => {
      const type = loan.loan_type || 'Other';
      if (!acc[type]) {
        acc[type] = { count: 0, volume: 0, loans: [] };
      }
      acc[type].count++;
      acc[type].volume += parseFloat(loan.loan_amount || 0);
      acc[type].loans.push(loan);
      return acc;
    }, {});

    // Group by status
    const byStatus = loans.reduce((acc: any, loan: any) => {
      const status = loan.status || 'Unknown';
      if (!acc[status]) {
        acc[status] = { count: 0, volume: 0 };
      }
      acc[status].count++;
      acc[status].volume += parseFloat(loan.loan_amount || 0);
      return acc;
    }, {});

    // Calculate averages
    const avgLoanAmount = loans.length > 0
      ? loans.reduce((sum, l) => sum + parseFloat(l.loan_amount || 0), 0) / loans.length
      : 0;
    const avgInterestRate = loans.filter(l => l.interest_rate).length > 0
      ? loans
          .filter(l => l.interest_rate)
          .reduce((sum, l) => sum + parseFloat(l.interest_rate || 0), 0) / loans.filter(l => l.interest_rate).length
      : 0;

    // Calculate cycle time (average days from application to closing)
    // Use cycle_time_days if available, otherwise calculate from dates
    const loansWithCycleTime = loans.filter(l => {
      // Prefer cycle_time_days if it exists and is valid
      if (l.cycle_time_days && !isNaN(parseFloat(l.cycle_time_days)) && parseFloat(l.cycle_time_days) > 0) {
        return true;
      }
      // Fall back to calculating from dates
      return l.application_date && l.closing_date;
    });
    const avgCycleTime = loansWithCycleTime.length > 0
      ? loansWithCycleTime.reduce((sum, l) => {
          // Use cycle_time_days if available, otherwise calculate from dates
          if (l.cycle_time_days && !isNaN(parseFloat(l.cycle_time_days)) && parseFloat(l.cycle_time_days) > 0) {
            return sum + parseFloat(l.cycle_time_days);
          }
          // Fall back to calculating from dates
          const days = daysBetween(l.application_date, l.closing_date);
          return sum + (days || 0);
        }, 0) / loansWithCycleTime.length
      : 0;

    // Calculate pull-through rate (originated / loansStarted)
    // Formula: (Closed/Originated Loans) / (Total Loans Started) * 100
    // This matches the frontend calculation: originated / loansStarted * 100
    const pullThroughRate = loans.length > 0
      ? (closedLoans.length / loans.length) * 100
      : 0;

    // Calculate credit pulls - count loans that have a credit_pull_date
    const creditPulls = loans.filter(l => l.credit_pull_date !== null && l.credit_pull_date !== undefined).length;

    // Debug logging for calculated stats
    logDebug('Calculated stats', {
      tenantId,
      total: loans.length,
      active: activeLoans.length,
      closed: closedLoans.length,
      locked: lockedLoans.length,
      avgCycleTime: Math.round(avgCycleTime),
      pullThroughRate: parseFloat(pullThroughRate.toFixed(1)),
      creditPulls
    });
    
    // Additional debug: Show status breakdown
    if (loans.length > 0) {
      const statusBreakdown = loansWithInferredStatus.reduce((acc: any, loan: any) => {
        const status = loan.inferred_status || 'Unknown';
        acc[status] = (acc[status] || 0) + 1;
        return acc;
      }, {});
      logDebug('Status breakdown', { tenantId, statusBreakdown });
      logDebug('Loans with credit_pull_date', { tenantId, count: loans.filter(l => l.credit_pull_date).length });
      logDebug('Loans with cycle_time_days', { tenantId, count: loans.filter(l => l.cycle_time_days && parseFloat(l.cycle_time_days) > 0).length });
    }

    res.json({
      total: loans.length,
      active: activeLoans.length,
      closed: closedLoans.length,
      locked: lockedLoans.length,
      byLoanType,
      byStatus,
      avgLoanAmount,
      avgInterestRate,
      totalVolume: loans.reduce((sum, l) => sum + parseFloat(l.loan_amount || 0), 0),
      avgCycleTime: Math.round(avgCycleTime),
      pullThroughRate: parseFloat(pullThroughRate.toFixed(1)),
      creditPulls,
      activeVolume: activeLoans.reduce((sum, l) => sum + parseFloat(l.loan_amount || 0), 0),
      closedVolume: closedLoans.reduce((sum, l) => sum + parseFloat(l.loan_amount || 0), 0),
      lockedVolume: lockedLoans.reduce((sum, l) => sum + parseFloat(l.loan_amount || 0), 0),
    });
  } catch (error: any) {
    logError('Error fetching loan statistics', error, { userId: req.userId });
    
    // Handle database connection errors
    if (handleDatabaseError(error, res, 'Failed to fetch loan statistics')) {
      return;
    }
    
    res.status(500).json({ error: error.message || 'Failed to fetch loan statistics' });
  }
});

/**
 * GET /api/loans/funnel
 * Get funnel data calculated from loans
 */
router.get('/funnel', authenticateToken, apiLimiter, async (req: AuthRequest, res) => {
  try {
    // Get tenant_id from query or user profile (supports super admins)
    let tenantId = req.query.tenant_id as string;
    
    if (!tenantId) {
      const profileResult = await retryQuery(
        () => pool.query(
          'SELECT tenant_id FROM public.profiles WHERE user_id = $1',
          [req.userId]
        ),
        3, 1000
      );
      tenantId = profileResult.rows[0]?.tenant_id;
    }
    
    // If still no tenant, check if user is super admin and use Default Tenant
    if (!tenantId) {
      const userResult = await retryQuery(
        () => pool.query(
          'SELECT role FROM public.users WHERE id = $1',
          [req.userId]
        ),
        3, 1000
      );
      if (userResult.rows[0]?.role === 'super_admin') {
        const defaultTenantResult = await retryQuery(
          () => pool.query(
            `SELECT id FROM public.tenants WHERE name = 'Default Tenant' LIMIT 1`
          ),
          3, 1000
        );
        if (defaultTenantResult.rows.length > 0) {
          tenantId = defaultTenantResult.rows[0].id;
        }
      }
    }

    if (!tenantId) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    // Get all loans for tenant (optimized query - select needed columns including raw_data)
    // Use retryQuery for database resilience
    const loansResult = await retryQuery(
      () => pool.query(
        `SELECT 
          loan_id, borrower_name, loan_amount, loan_type, status, 
          application_date, closing_date, lock_date, interest_rate,
          loan_purpose, branch, credit_pull_date, cycle_time_days,
          raw_data
         FROM public.loans 
         WHERE tenant_id = $1 
         ORDER BY application_date DESC`,
        [tenantId]
      ),
      2, // max retries
      500 // delay between retries
    );

    // Enhance loans with data from raw_data for fields not in main columns
    const loans = loansResult.rows.map(loan => {
      const rawData = typeof loan.raw_data === 'string' ? JSON.parse(loan.raw_data) : (loan.raw_data || {});
      return {
        ...loan,
        // Extract fields from raw_data if not in main columns
        fico_score: rawData.fico_score || rawData.fico,
        ltv: rawData.ltv || rawData.loan_to_value,
        respa_date: rawData.respa_date || rawData.respaDate,
        fallout_reason: rawData.fallout_reason || rawData.falloutReason || rawData.fallout,
        loan_officer_name: rawData.loan_officer_name || rawData.loan_officer || rawData.officer_name,
      };
    });

    // Infer status based on dates and raw status
    const getInferredStatus = (loan: any) => {
      if (loan.closing_date) return 'Closed';
      if (loan.lock_date) return 'Locked';
      const rawStatus = (loan.status || '').toString().toUpperCase();
      // Handle all possible status values from both LOS imports and sample data
      if (['ACTIVE', 'SUBMITTED', 'APPROVED', 'CTC', 'STARTED', 'INQUIRY', 'PROCESSING', 'UNDERWRITING'].includes(rawStatus)) return 'Active';
      if (['WITHDRAWN', 'CANCELLED'].includes(rawStatus)) return 'Withdrawn';
      if (['DENIED', 'DECLINED', 'REJECTED'].includes(rawStatus)) return 'Denied';
      if (['ORIGINATED', 'FUNDED', 'CLOSED', 'COMPLETE', 'COMPLETED'].includes(rawStatus)) return 'Closed';
      if (['LOCKED'].includes(rawStatus)) return 'Locked';
      // If status is a state code (2 letters), treat as active
      if (/^[A-Z]{2}$/.test(rawStatus)) return 'Active';
      return 'Active'; // Default
    };

    const loansWithInferredStatus = loans.map(loan => ({
      ...loan,
      inferred_status: getInferredStatus(loan)
    }));

    // Calculate funnel stages
    const loansStarted = loans.length;
    const loansStartedVolume = loans.reduce((sum, l) => sum + parseFloat(l.loan_amount || 0), 0);

    // Active loans (not closed) - smart detection
    const stillActive = loansWithInferredStatus.filter(l =>
      ['Active', 'Locked', 'Submitted', 'Approved', 'CTC'].includes(l.inferred_status)
    );
    const stillActiveVolume = stillActive.reduce((sum, l) => sum + parseFloat(l.loan_amount || 0), 0);

    // Originated/Closed loans - smart detection
    const originated = loansWithInferredStatus.filter(l =>
      ['Closed', 'Originated', 'Funded'].includes(l.inferred_status)
    );
    const originatedVolume = originated.reduce((sum, l) => sum + parseFloat(l.loan_amount || 0), 0);

    // Fallout - Withdrawn (use inferred_status for consistency)
    const falloutWithdrawn = loansWithInferredStatus.filter(l =>
      l.inferred_status === 'Withdrawn'
    );
    const falloutWithdrawnVolume = falloutWithdrawn.reduce((sum, l) => sum + parseFloat(l.loan_amount || 0), 0);

    // Fallout - Denied (use inferred_status for consistency)
    const falloutDenied = loansWithInferredStatus.filter(l =>
      l.inferred_status === 'Denied'
    );
    const falloutDeniedVolume = falloutDenied.reduce((sum, l) => sum + parseFloat(l.loan_amount || 0), 0);

    // No RESPA Apps (loans that didn't proceed to RESPA stage - estimate as small percentage)
    const noRespaApp = Math.max(0, Math.floor(loansStarted * 0.004)); // ~0.4% of loans
    const noRespaAppVolume = Math.floor(loansStartedVolume * 0.004);

    // Calculate revenue (simplified - 1% of loan amount)
    const revenueRate = 0.01;

    res.json({
      loansStarted: {
        units: loansStarted,
        volume: loansStartedVolume,
        revenue: loansStartedVolume * revenueRate,
      },
      stillActive: {
        units: stillActive.length,
        volume: stillActiveVolume,
        revenue: stillActiveVolume * revenueRate,
      },
      originated: {
        units: originated.length,
        volume: originatedVolume,
        revenue: originatedVolume * revenueRate,
      },
      falloutWithdrawn: {
        units: falloutWithdrawn.length,
        volume: falloutWithdrawnVolume,
        lostRevenue: falloutWithdrawnVolume * revenueRate,
      },
      falloutDenied: {
        units: falloutDenied.length,
        volume: falloutDeniedVolume,
        lostRevenue: falloutDeniedVolume * revenueRate,
      },
      // For compatibility with existing schema
      respaApp: {
        units: loansStarted - noRespaApp, // Loans that proceeded to RESPA
        volume: loansStartedVolume - noRespaAppVolume,
        revenue: (loansStartedVolume - noRespaAppVolume) * revenueRate,
      },
      noRespaApp: {
        units: noRespaApp,
        volume: noRespaAppVolume,
        lostRevenue: noRespaAppVolume * revenueRate,
      },
    });
  } catch (error: any) {
    logError('Error calculating funnel data', error, { userId: req.userId });
    
    // Handle database connection errors
    if (handleDatabaseError(error, res, 'Failed to calculate funnel data')) {
      return;
    }
    
    res.status(500).json({ error: error.message || 'Failed to calculate funnel data' });
  }
});

/**
 * GET /api/loans/company-overview
 * Get company overview metrics (Active Loans, Submitted MTD, Funded MTD, Aging, Loan Types)
 */
router.get('/company-overview', authenticateToken, apiLimiter, async (req: AuthRequest, res) => {
  try {
    // Get tenant_id from query or user profile (supports super admins)
    let tenantId = req.query.tenant_id as string;
    
    if (!tenantId) {
      const profileResult = await pool.query(
        'SELECT tenant_id FROM public.profiles WHERE user_id = $1',
        [req.userId]
      );
      tenantId = profileResult.rows[0]?.tenant_id;
    }
    
    // If still no tenant, check if user is super admin and use Default Tenant
    if (!tenantId) {
      const userResult = await pool.query(
        'SELECT role FROM public.users WHERE id = $1',
        [req.userId]
      );
      if (userResult.rows[0]?.role === 'super_admin') {
        const defaultTenantResult = await pool.query(
          `SELECT id FROM public.tenants WHERE name = 'Default Tenant' LIMIT 1`
        );
        if (defaultTenantResult.rows.length > 0) {
          tenantId = defaultTenantResult.rows[0].id;
        }
      }
    }

    if (!tenantId) {
      return res.status(404).json({ error: 'Tenant not found' });
    }
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    // Get all loans
    const allLoansResult = await retryQuery(
      () => pool.query(
        `SELECT 
          loan_id, borrower_name, loan_amount, loan_type, status, 
          application_date, closing_date, interest_rate, raw_data
         FROM public.loans 
         WHERE tenant_id = $1 
         ORDER BY application_date DESC`,
        [tenantId]
      ),
      2, 500
    );

    const allLoans = allLoansResult.rows;

    // Active Loans (excluding closed/denied/withdrawn) - smart detection
    // Use inferred status based on dates and raw status
    const getInferredStatus = (loan: any) => {
      if (loan.closing_date) return 'Closed';
      if (loan.lock_date) return 'Locked';
      const rawStatus = (loan.status || '').toString().toUpperCase();
      // Handle all possible status values from both LOS imports and sample data
      if (['ACTIVE', 'SUBMITTED', 'APPROVED', 'CTC', 'STARTED', 'INQUIRY', 'PROCESSING', 'UNDERWRITING'].includes(rawStatus)) return 'Active';
      if (['WITHDRAWN', 'CANCELLED'].includes(rawStatus)) return 'Withdrawn';
      if (['DENIED', 'DECLINED', 'REJECTED'].includes(rawStatus)) return 'Denied';
      if (['ORIGINATED', 'FUNDED', 'CLOSED', 'COMPLETE', 'COMPLETED'].includes(rawStatus)) return 'Closed';
      if (['LOCKED'].includes(rawStatus)) return 'Locked';
      // If status is a state code (2 letters), treat as active
      if (/^[A-Z]{2}$/.test(rawStatus)) return 'Active';
      return 'Active'; // Default
    };

    const activeLoans = allLoans.filter(l => {
      const inferredStatus = getInferredStatus(l);
      return ['Active', 'Locked', 'Submitted', 'Approved', 'CTC'].includes(inferredStatus);
    });

    // Submitted Loans MTD (estimate: loans with application_date in current month)
    const submittedMTD = allLoans.filter(l => {
      if (!l.application_date) return false;
      const appDate = new Date(l.application_date);
      return appDate >= monthStart;
    });

    // Funded Loans MTD (loans with closing_date in current month)
    const fundedMTD = allLoans.filter(l => {
      if (!l.closing_date) return false;
      const closeDate = new Date(l.closing_date);
      return closeDate >= monthStart;
    });

    // Aging of Active Loans (days since application)
    const agingRanges = {
      '0-15': 0,
      '16-30': 0,
      '31-45': 0,
      '46-60': 0,
      '61-90': 0,
      '>90': 0,
    };

    activeLoans.forEach(loan => {
      if (!loan.application_date) return;
      const days = daysBetween(loan.application_date, now);
      if (days === null) return;
      if (days <= 15) agingRanges['0-15']++;
      else if (days <= 30) agingRanges['16-30']++;
      else if (days <= 45) agingRanges['31-45']++;
      else if (days <= 60) agingRanges['46-60']++;
      else if (days <= 90) agingRanges['61-90']++;
      else agingRanges['>90']++;
    });

    // Loan Type distribution for MTD Submitted
    const submittedByType: Record<string, number> = {};
    submittedMTD.forEach(loan => {
      const type = loan.loan_type || 'Other';
      submittedByType[type] = (submittedByType[type] || 0) + 1;
    });

    // Loan Type distribution for MTD Funded
    const fundedByType: Record<string, number> = {};
    fundedMTD.forEach(loan => {
      const type = loan.loan_type || 'Other';
      fundedByType[type] = (fundedByType[type] || 0) + 1;
    });

    // Calculate averages
    const activeVolume = activeLoans.reduce((sum, l) => sum + parseFloat(l.loan_amount || 0), 0);
    const activeAvgRate = activeLoans.filter(l => l.interest_rate).length > 0
      ? activeLoans.filter(l => l.interest_rate)
          .reduce((sum, l) => sum + parseFloat(l.interest_rate || 0), 0) / activeLoans.filter(l => l.interest_rate).length
      : 0;

    const submittedVolume = submittedMTD.reduce((sum, l) => sum + parseFloat(l.loan_amount || 0), 0);
    const submittedAvgRate = submittedMTD.filter(l => l.interest_rate).length > 0
      ? submittedMTD.filter(l => l.interest_rate)
          .reduce((sum, l) => sum + parseFloat(l.interest_rate || 0), 0) / submittedMTD.filter(l => l.interest_rate).length
      : 0;

    const fundedVolume = fundedMTD.reduce((sum, l) => sum + parseFloat(l.loan_amount || 0), 0);
    const fundedAvgRate = fundedMTD.filter(l => l.interest_rate).length > 0
      ? fundedMTD.filter(l => l.interest_rate)
          .reduce((sum, l) => sum + parseFloat(l.interest_rate || 0), 0) / fundedMTD.filter(l => l.interest_rate).length
      : 0;

    res.json({
      activeLoans: {
        count: activeLoans.length,
        volume: activeVolume,
        avgInterestRate: activeAvgRate,
      },
      submittedMTD: {
        count: submittedMTD.length,
        volume: submittedVolume,
        avgInterestRate: submittedAvgRate,
      },
      fundedMTD: {
        count: fundedMTD.length,
        volume: fundedVolume,
        avgInterestRate: fundedAvgRate,
      },
      aging: agingRanges,
      submittedByType,
      fundedByType,
    });
  } catch (error: any) {
    logError('Error fetching company overview', error, { userId: req.userId });
    res.status(500).json({ error: error.message || 'Failed to fetch company overview' });
  }
});

/**
 * GET /api/loans/operations-overview
 * Get operations overview metrics (Cycle Time, Active Pipeline, Processing Efficiency, Turn Time by Stage)
 */
router.get('/operations-overview', authenticateToken, apiLimiter, async (req: AuthRequest, res) => {
  try {
    // Get tenant_id
    const profileResult = await pool.query(
      'SELECT tenant_id FROM public.profiles WHERE user_id = $1',
      [req.userId]
    );

    if (profileResult.rows.length === 0 || !profileResult.rows[0].tenant_id) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    const tenantId = profileResult.rows[0].tenant_id;

    // Get all loans
    const loansResult = await retryQuery(
      () => pool.query(
        `SELECT 
          loan_id, borrower_name, loan_amount, loan_type, status, 
          application_date, closing_date, lock_date, interest_rate, raw_data
         FROM public.loans 
         WHERE tenant_id = $1 
         ORDER BY application_date DESC`,
        [tenantId]
      ),
      2, 500
    );

    const loans = loansResult.rows;

    // Active Pipeline - smart detection
    const activeLoans = loans.filter(l => {
      const status = (l.status || '').toString().toUpperCase();
      const isStateCode = /^[A-Z]{2}$/.test(status);
      
      if (isStateCode) {
        // State code means it's likely active (has application but no closing)
        return !l.closing_date;
      }
      
      // Proper status values - exclude closed statuses
      return !['CLOSED', 'FUNDED', 'ORIGINATED', 'WITHDRAWN', 'DENIED', 'COMPLETED'].includes(status);
    });
    const activeVolume = activeLoans.reduce((sum, l) => sum + parseFloat(l.loan_amount || 0), 0);

    // Calculate average cycle time (application to closing)
    const loansWithDates = loans.filter(l => l.application_date && l.closing_date);
    const cycleTimes = loansWithDates.map(l => daysBetween(l.application_date, l.closing_date)).filter(d => d !== null) as number[];
    const avgCycleTime = cycleTimes.length > 0
      ? Math.round(cycleTimes.reduce((sum, d) => sum + d, 0) / cycleTimes.length)
      : 43; // Default fallback

    // Processing Efficiency (loans processed within target timeframe)
    // Target: 35 days, calculate percentage within target
    const targetCycleTime = 35;
    const withinTarget = cycleTimes.filter(d => d <= targetCycleTime).length;
    const processingEfficiency = cycleTimes.length > 0
      ? Math.round((withinTarget / cycleTimes.length) * 100)
      : 87; // Default fallback

    // Turn Time by Stage (estimate based on cycle time breakdown)
    // Application to Lock: ~28% of cycle time
    // Lock to CTC: ~42% of cycle time
    // CTC to Funding: ~30% of cycle time
    const appToLockTarget = 10;
    const lockToCTCTarget = 15;
    const ctcToFundingTarget = 10;

    const appToLockActual = Math.round(avgCycleTime * 0.28);
    const lockToCTCActual = Math.round(avgCycleTime * 0.42);
    const ctcToFundingActual = Math.round(avgCycleTime * 0.30);

    res.json({
      avgCycleTime: {
        current: avgCycleTime,
        target: targetCycleTime,
      },
      activePipeline: {
        count: activeLoans.length,
        volume: activeVolume,
      },
      processingEfficiency: {
        current: processingEfficiency,
        target: 90,
      },
      turnTimeByStage: {
        appToLock: {
          target: appToLockTarget,
          actual: appToLockActual,
          overTarget: appToLockActual - appToLockTarget,
          percentOver: Math.round(((appToLockActual - appToLockTarget) / appToLockTarget) * 100),
        },
        lockToCTC: {
          target: lockToCTCTarget,
          actual: lockToCTCActual,
          overTarget: lockToCTCActual - lockToCTCTarget,
          percentOver: Math.round(((lockToCTCActual - lockToCTCTarget) / lockToCTCTarget) * 100),
        },
        ctcToFunding: {
          target: ctcToFundingTarget,
          actual: ctcToFundingActual,
          overTarget: ctcToFundingActual - ctcToFundingTarget,
          percentOver: Math.round(((ctcToFundingActual - ctcToFundingTarget) / ctcToFundingTarget) * 100),
        },
      },
    });
  } catch (error: any) {
    logError('Error fetching operations overview', error, { userId: req.userId });
    res.status(500).json({ error: error.message || 'Failed to fetch operations overview' });
  }
});

/**
 * GET /api/loans/diagnostic
 * Diagnostic endpoint to check database state (for debugging)
 */
router.get('/diagnostic', authenticateToken, apiLimiter, async (req: AuthRequest, res) => {
  try {
    // Get tenant_id
    const profileResult = await pool.query(
      'SELECT tenant_id FROM public.profiles WHERE user_id = $1',
      [req.userId]
    );

    const tenantId = profileResult.rows[0]?.tenant_id;

    // Get all loans count
    const allLoansResult = await pool.query('SELECT COUNT(*) as total FROM public.loans');
    const totalLoans = allLoansResult.rows[0]?.total || 0;

    // Get loans by tenant
    const loansByTenantResult = await pool.query(
      'SELECT tenant_id, COUNT(*) as count FROM public.loans GROUP BY tenant_id LIMIT 10'
    );

    // Get user's tenant loans
    let userLoansCount = 0;
    let userLoansSample: any[] = [];
    if (tenantId) {
      const userLoansResult = await pool.query(
        'SELECT loan_id, borrower_name, status, lock_date, closing_date FROM public.loans WHERE tenant_id = $1 LIMIT 5',
        [tenantId]
      );
      userLoansCount = userLoansResult.rows.length;
      userLoansSample = userLoansResult.rows;
    }

    res.json({
      userId: req.userId,
      tenantId: tenantId || 'NOT FOUND',
      totalLoansInDatabase: parseInt(totalLoans),
      loansByTenant: loansByTenantResult.rows.map(r => ({
        tenant_id: r.tenant_id,
        count: parseInt(r.count)
      })),
      userTenantLoansCount: userLoansCount,
      userTenantLoansSample: userLoansSample
    });
  } catch (error: any) {
    logError('Diagnostic endpoint error', error, { userId: req.userId });
    res.status(500).json({ error: error.message });
  }
});

/**
 * PUT /api/loans/:loanId
 * Update a loan (admin/tenant owner only)
 */
router.put('/:loanId', authenticateToken, apiLimiter, async (req: AuthRequest, res) => {
  try {
    const { loanId } = req.params;
    const profileResult = await pool.query(
      'SELECT tenant_id FROM public.profiles WHERE user_id = $1',
      [req.userId]
    );

    if (profileResult.rows.length === 0 || !profileResult.rows[0].tenant_id) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    const tenantId = profileResult.rows[0].tenant_id;

    // Verify loan belongs to tenant
    const loanCheck = await pool.query(
      'SELECT loan_id FROM public.loans WHERE loan_id = $1 AND tenant_id = $2',
      [loanId, tenantId]
    );

    if (loanCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Loan not found or access denied' });
    }

    // Build update query dynamically based on provided fields
    const allowedFields = [
      'borrower_name', 'loan_amount', 'loan_type', 'status',
      'application_date', 'closing_date', 'lock_date', 'interest_rate',
      'loan_officer_name', 'branch', 'fico_score', 'ltv', 'loan_purpose',
      'credit_pull_date', 'property_address', 'property_city', 'property_state',
      'property_zip', 'nmls_id', 'loan_officer_role'
    ];

    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    Object.keys(req.body).forEach((key) => {
      if (allowedFields.includes(key) && req.body[key] !== undefined) {
        updates.push(`${key} = $${paramIndex}`);
        values.push(req.body[key] === '' ? null : req.body[key]);
        paramIndex++;
      }
    });

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    values.push(loanId, tenantId);
    const query = `
      UPDATE public.loans 
      SET ${updates.join(', ')}, updated_at = NOW()
      WHERE loan_id = $${paramIndex} AND tenant_id = $${paramIndex + 1}
      RETURNING *
    `;

    const result = await pool.query(query, values);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Loan not found or update failed' });
    }

    res.json({ loan: result.rows[0], message: 'Loan updated successfully' });
  } catch (error: any) {
    logError('Error updating loan', error, { userId: req.userId, loanId: req.params.id });
    res.status(500).json({ error: error.message || 'Failed to update loan' });
  }
});

/**
 * DELETE /api/loans/:loanId
 * Delete a loan (admin/tenant owner only)
 */
router.delete('/:loanId', authenticateToken, apiLimiter, async (req: AuthRequest, res) => {
  try {
    const { loanId } = req.params;
    const profileResult = await pool.query(
      'SELECT tenant_id FROM public.profiles WHERE user_id = $1',
      [req.userId]
    );

    if (profileResult.rows.length === 0 || !profileResult.rows[0].tenant_id) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    const tenantId = profileResult.rows[0].tenant_id;

    // Verify loan belongs to tenant and delete
    const result = await pool.query(
      'DELETE FROM public.loans WHERE loan_id = $1 AND tenant_id = $2 RETURNING loan_id',
      [loanId, tenantId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Loan not found or access denied' });
    }

    res.json({ message: 'Loan deleted successfully', loanId: result.rows[0].loan_id });
  } catch (error: any) {
    logError('Error deleting loan', error, { userId: req.userId, loanId: req.params.id });
    res.status(500).json({ error: error.message || 'Failed to delete loan' });
  }
});

export default router;
