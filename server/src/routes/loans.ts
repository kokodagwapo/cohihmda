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
 * GET /api/loans/schema
 * Get the schema/columns of the loans table for dynamic table rendering
 */
router.get('/schema', authenticateToken, attachTenantContext, apiLimiter, async (req: AuthRequest, res) => {
  try {
    const tenantPool = getTenantContext(req).tenantPool;

    // Get column information from information_schema
    const result = await tenantPool.query(`
      SELECT 
        column_name,
        data_type,
        is_nullable,
        column_default
      FROM information_schema.columns 
      WHERE table_schema = 'public' 
      AND table_name = 'loans'
      ORDER BY ordinal_position
    `);

    // Map to friendly column info
    const columns = result.rows.map(col => ({
      name: col.column_name,
      type: col.data_type,
      nullable: col.is_nullable === 'YES',
      // Generate a display name from column_name
      displayName: col.column_name
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (l: string) => l.toUpperCase()),
      // Categorize columns for UI grouping
      category: categorizeColumn(col.column_name)
    }));

    res.json({ columns });
  } catch (error: any) {
    logError('Error fetching loans schema', error, { userId: req.userId });
    res.status(500).json({ error: error.message || 'Failed to fetch loans schema' });
  }
});

// Helper function to categorize columns
function categorizeColumn(columnName: string): string {
  if (['id', 'loan_id', 'loan_number', 'guid'].includes(columnName)) return 'identifier';
  if (columnName.includes('date') || columnName.includes('_at')) return 'date';
  if (columnName.includes('amount') || columnName.includes('rate') || columnName.includes('ltv') || columnName.includes('dti') || columnName.includes('price') || columnName.includes('value') || columnName.includes('fee') || columnName.includes('income') || columnName.includes('assets')) return 'financial';
  if (columnName.includes('property') || columnName.includes('county') || columnName.includes('state') || columnName.includes('city') || columnName.includes('zip') || columnName.includes('street')) return 'property';
  if (columnName.includes('borrower') || columnName.includes('borr_') || columnName.includes('co_borr')) return 'borrower';
  if (columnName.includes('officer') || columnName.includes('processor') || columnName.includes('underwriter') || columnName.includes('closer')) return 'team';
  if (columnName.includes('status') || columnName.includes('milestone')) return 'status';
  if (columnName.includes('loan_type') || columnName.includes('loan_purpose') || columnName.includes('loan_program') || columnName.includes('product')) return 'loan_details';
  if (columnName.includes('branch') || columnName.includes('channel') || columnName.includes('investor') || columnName.includes('nmls')) return 'organization';
  return 'other';
}

/**
 * GET /api/loans/distinct-values
 * Get distinct values for a specific column (for filter dropdowns)
 */
router.get('/distinct-values/:column', authenticateToken, attachTenantContext, apiLimiter, async (req: AuthRequest, res) => {
  try {
    const tenantPool = getTenantContext(req).tenantPool;
    const { column } = req.params;
    
    // Whitelist of columns that can be queried for distinct values (prevent SQL injection)
    const allowedColumns = [
      'current_loan_status', 'loan_type', 'loan_purpose', 'loan_program', 'product_type',
      'property_state', 'property_city', 'property_county', 'property_type', 'occupancy_type',
      'branch', 'channel', 'investor', 'loan_officer', 'processor', 'underwriter', 'closer',
      'lien_position', 'refinance_cash_out_type', 'atr_loan_type', 'qm_loan_type'
    ];
    
    if (!allowedColumns.includes(column)) {
      return res.status(400).json({ error: 'Invalid column for distinct values query' });
    }

    const result = await tenantPool.query(
      `SELECT DISTINCT ${column} as value FROM public.loans WHERE ${column} IS NOT NULL AND ${column} != '' ORDER BY ${column} LIMIT 100`
    );

    res.json({ values: result.rows.map(r => r.value) });
  } catch (error: any) {
    logError('Error fetching distinct values', error, { userId: req.userId, column: req.params.column });
    res.status(500).json({ error: error.message || 'Failed to fetch distinct values' });
  }
});

/**
 * GET /api/loans/channels
 * Get distinct channel values with counts for channel selector dropdown
 * Returns both the raw channel values and consolidated channel groups (Retail, TPO, etc.)
 * Includes "99-Missing" for loans with null/empty channels (matches Qlik convention)
 */
router.get('/channels', authenticateToken, attachTenantContext, apiLimiter, async (req: AuthRequest, res) => {
  try {
    const tenantPool = getTenantContext(req).tenantPool;

    // Get distinct channels with counts, including null/empty as '99-Missing' (Qlik convention)
    // The '99-Missing' convention comes from Qlik's NullAsValue statement: Set NullValue = '99-Missing';
    // The "99" ensures it sorts to the end alphanumerically
    const result = await tenantPool.query(`
      SELECT 
        COALESCE(NULLIF(TRIM(channel), ''), '99-Missing') as channel,
        COUNT(*) as loan_count,
        -- Consolidated channel group (matches Qlik logic)
        CASE 
          WHEN channel ILIKE '%retail%' OR channel ILIKE '%brok%' THEN 'Retail'
          WHEN channel ILIKE '%whole%' OR channel ILIKE '%corresp%' THEN 'TPO'
          WHEN channel IS NULL OR TRIM(channel) = '' THEN '99-Missing'
          ELSE channel
        END as channel_group
      FROM public.loans 
      GROUP BY 
        COALESCE(NULLIF(TRIM(channel), ''), '99-Missing'),
        CASE 
          WHEN channel ILIKE '%retail%' OR channel ILIKE '%brok%' THEN 'Retail'
          WHEN channel ILIKE '%whole%' OR channel ILIKE '%corresp%' THEN 'TPO'
          WHEN channel IS NULL OR TRIM(channel) = '' THEN '99-Missing'
          ELSE channel
        END
      ORDER BY 
        CASE WHEN COALESCE(NULLIF(TRIM(channel), ''), '99-Missing') = '99-Missing' THEN 1 ELSE 0 END,
        COUNT(*) DESC
    `);

    // Also get the consolidated groups with totals, including 99-Missing
    // Use subquery to allow ordering by alias
    const groupResult = await tenantPool.query(`
      SELECT * FROM (
        SELECT 
          CASE 
            WHEN channel ILIKE '%retail%' OR channel ILIKE '%brok%' THEN 'Retail'
            WHEN channel ILIKE '%whole%' OR channel ILIKE '%corresp%' THEN 'TPO'
            WHEN channel IS NULL OR TRIM(channel) = '' THEN '99-Missing'
            ELSE 'Other'
          END as channel_group,
          COUNT(*) as loan_count
        FROM public.loans 
        GROUP BY 1
      ) grouped
      ORDER BY 
        CASE channel_group
          WHEN 'Retail' THEN 1
          WHEN 'TPO' THEN 2
          WHEN 'Other' THEN 3
          WHEN '99-Missing' THEN 4
          ELSE 5
        END
    `);

    res.json({ 
      channels: result.rows.map(r => ({
        channel: r.channel,
        channelGroup: r.channel_group,
        loanCount: parseInt(r.loan_count)
      })),
      channelGroups: groupResult.rows.map(r => ({
        group: r.channel_group,
        loanCount: parseInt(r.loan_count)
      }))
    });
  } catch (error: any) {
    logError('Error fetching channels', error, { userId: req.userId });
    res.status(500).json({ error: error.message || 'Failed to fetch channels' });
  }
});

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
      limit = '50',
      offset = '0',
      sort_by = 'created_at',
      sort_order = 'desc',
      search,
      ...filterParams
    } = req.query;

    // Build WHERE clause dynamically
    const conditions: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    // Handle search across multiple fields
    if (search && typeof search === 'string' && search.trim()) {
      const searchTerm = `%${search.trim().toLowerCase()}%`;
      conditions.push(`(
        LOWER(COALESCE(loan_id, '')) LIKE $${paramIndex} OR
        LOWER(COALESCE(loan_number, '')) LIKE $${paramIndex} OR
        LOWER(COALESCE(current_loan_status, '')) LIKE $${paramIndex} OR
        LOWER(COALESCE(loan_type, '')) LIKE $${paramIndex} OR
        LOWER(COALESCE(loan_officer, '')) LIKE $${paramIndex} OR
        LOWER(COALESCE(branch, '')) LIKE $${paramIndex} OR
        LOWER(COALESCE(property_city, '')) LIKE $${paramIndex} OR
        LOWER(COALESCE(property_state, '')) LIKE $${paramIndex}
      )`);
      params.push(searchTerm);
      paramIndex++;
    }

    // Handle specific column filters
    const filterableColumns = [
      'current_loan_status', 'loan_type', 'loan_purpose', 'loan_program', 'product_type',
      'property_state', 'property_city', 'property_county', 'property_type', 'occupancy_type',
      'branch', 'channel', 'investor', 'loan_officer', 'processor', 'underwriter', 'closer',
      'lien_position', 'refinance_cash_out_type'
    ];

    for (const [key, value] of Object.entries(filterParams)) {
      if (filterableColumns.includes(key) && value && typeof value === 'string') {
        conditions.push(`${key} = $${paramIndex}`);
        params.push(value);
        paramIndex++;
      }
    }

    // Handle date range filters with configurable date field
    // date_field: which date column to filter on (default: started_date, fallback to application_date, then created_at)
    const allowedDateFields = ['started_date', 'application_date', 'closing_date', 'funding_date', 'lock_date', 'credit_pull_date', 'approval_date', 'created_at'];
    const dateField = filterParams.date_field && allowedDateFields.includes(filterParams.date_field as string) 
      ? filterParams.date_field as string 
      : 'started_date'; // Default to started_date
    
    if (filterParams.start_date && typeof filterParams.start_date === 'string') {
      // Use COALESCE to handle nulls - try the selected field, then fall back to created_at
      conditions.push(`COALESCE(${dateField}, created_at) >= $${paramIndex}`);
      params.push(filterParams.start_date);
      paramIndex++;
    }
    if (filterParams.end_date && typeof filterParams.end_date === 'string') {
      conditions.push(`COALESCE(${dateField}, created_at) <= $${paramIndex}`);
      params.push(filterParams.end_date);
      paramIndex++;
    }

    // Handle amount range filters
    if (filterParams.min_amount && typeof filterParams.min_amount === 'string') {
      conditions.push(`loan_amount >= $${paramIndex}`);
      params.push(parseFloat(filterParams.min_amount));
      paramIndex++;
    }
    if (filterParams.max_amount && typeof filterParams.max_amount === 'string') {
      conditions.push(`loan_amount <= $${paramIndex}`);
      params.push(parseFloat(filterParams.max_amount));
      paramIndex++;
    }

    // Handle null/empty field filters
    // null_fields: comma-separated list of columns that should be NULL/empty
    // not_null_fields: comma-separated list of columns that should NOT be NULL/empty
    const nullableColumns = [
      'started_date', 'application_date', 'closing_date', 'funding_date', 'lock_date', 'credit_pull_date',
      'approval_date', 'ctc_date', 'docs_out_date', 'docs_signing_date',
      'loan_officer', 'processor', 'underwriter', 'closer',
      'fico_score', 'interest_rate', 'loan_amount',
      'property_state', 'property_city', 'branch'
    ];
    
    if (filterParams.null_fields && typeof filterParams.null_fields === 'string') {
      const nullFields = filterParams.null_fields.split(',').filter(f => nullableColumns.includes(f.trim()));
      nullFields.forEach(field => {
        conditions.push(`(${field.trim()} IS NULL OR ${field.trim()}::text = '')`);
      });
    }
    
    if (filterParams.not_null_fields && typeof filterParams.not_null_fields === 'string') {
      const notNullFields = filterParams.not_null_fields.split(',').filter(f => nullableColumns.includes(f.trim()));
      notNullFields.forEach(field => {
        conditions.push(`(${field.trim()} IS NOT NULL AND ${field.trim()}::text != '')`);
      });
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Validate sort column (prevent SQL injection)
    const allowedSortColumns = [
      'loan_id', 'loan_number', 'loan_amount', 'current_loan_status', 'loan_type',
      'application_date', 'closing_date', 'funding_date', 'lock_date', 'created_at',
      'property_state', 'property_city', 'branch', 'loan_officer', 'interest_rate'
    ];
    const sortColumn = allowedSortColumns.includes(sort_by as string) ? sort_by : 'created_at';
    const sortDirection = sort_order === 'asc' ? 'ASC' : 'DESC';

    // Execute main query
    const query = `
      SELECT * FROM public.loans 
      ${whereClause}
      ORDER BY ${sortColumn} ${sortDirection} NULLS LAST
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;
    params.push(parseInt(limit as string), parseInt(offset as string));

    const result = await tenantPool.query(query, params);

    // Get total count for pagination
    const countParams = params.slice(0, -2); // Remove limit and offset
    const countQuery = `SELECT COUNT(*) FROM public.loans ${whereClause}`;
    const countResult = await tenantPool.query(countQuery, countParams);
    const total = parseInt(countResult.rows[0].count);

    res.json({
      loans: result.rows,
      total,
      limit: parseInt(limit as string),
      offset: parseInt(offset as string),
      page: Math.floor(parseInt(offset as string) / parseInt(limit as string)) + 1,
      totalPages: Math.ceil(total / parseInt(limit as string)),
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
 * Uses tenant-specific database via attachTenantContext (same as metrics endpoints)
 */
router.get('/funnel', authenticateToken, attachTenantContext, apiLimiter, async (req: AuthRequest, res) => {
  try {
    const tenantContext = getTenantContext(req);
    const tenantPool = tenantContext.tenantPool;
    const tenantId = tenantContext.tenantId;

    // Parse optional filters
    const yearFilter = req.query.year ? parseInt(req.query.year as string) : null;
    const startDate = req.query.startDate as string | undefined;
    const endDate = req.query.endDate as string | undefined;
    const loanOfficerId = req.query.loan_officer_id as string | undefined;
    const branch = req.query.branch as string | undefined;
    const loanType = req.query.loan_type as string | undefined;
    const channel = req.query.channel as string | undefined;
    // channelGroup allows filtering by consolidated channel (Retail, TPO, etc.)
    // Matches Qlik logic: if(WildMatch(Channel,'*Retail*','*Brok*')>=1,'Retail', if(Wildmatch(Channel,'*Whole*','*Corresp*')>=1,'TPO', Channel))
    const channelGroup = req.query.channel_group as string | undefined;
    // Option to exclude "Out of Range" loans
    // NOTE: The Qlik "Loans Started" waterfall does NOT apply Out of Range filter by default
    // The Out of Range filter is a UI toggle that users can optionally enable
    // Default: false (include all loans, matching Qlik's default funnel behavior)
    const excludeOutOfRange = req.query.exclude_out_of_range === 'true'; // Default: false
    
    // Build WHERE clause for optional filters (no tenant_id needed - tenant DB is already isolated)
    const conditions: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;
    
    // Handle date filtering - MUST use started_date (not application_date)
    // Qlik Logic: Loans Started is filtered by [Started Year], then RESPA App Status is calculated
    // from those started loans based on whether application_date exists
    if (startDate && endDate) {
      // Custom date range filter on started_date
      // Use COALESCE to fall back to created_at only if started_date is NULL
      conditions.push(`COALESCE(started_date, created_at) >= $${paramIndex}`);
      params.push(startDate);
      paramIndex++;
      conditions.push(`COALESCE(started_date, created_at) <= $${paramIndex}`);
      params.push(endDate);
      paramIndex++;
    } else if (yearFilter) {
      // Year filter on started_date
      conditions.push(`EXTRACT(YEAR FROM COALESCE(started_date, created_at)) = $${paramIndex}`);
      params.push(yearFilter);
      paramIndex++;
    }
    if (loanOfficerId) {
      conditions.push(`loan_officer_id = $${paramIndex}`);
      params.push(loanOfficerId);
      paramIndex++;
    }
    if (branch) {
      conditions.push(`branch = $${paramIndex}`);
      params.push(branch);
      paramIndex++;
    }
    if (loanType) {
      conditions.push(`loan_type = $${paramIndex}`);
      params.push(loanType);
      paramIndex++;
    }
    
    // Channel filter - exact match
    if (channel) {
      conditions.push(`channel = $${paramIndex}`);
      params.push(channel);
      paramIndex++;
    }
    
    // Channel Group filter - consolidated channel (Retail, TPO, etc.)
    // Matches Qlik: if(WildMatch(Channel,'*Retail*','*Brok*')>=1,'Retail', if(Wildmatch(Channel,'*Whole*','*Corresp*')>=1,'TPO', Channel))
    if (channelGroup) {
      if (channelGroup === 'Retail') {
        conditions.push(`(channel ILIKE '%retail%' OR channel ILIKE '%brok%')`);
      } else if (channelGroup === 'TPO') {
        conditions.push(`(channel ILIKE '%whole%' OR channel ILIKE '%corresp%')`);
      } else if (channelGroup === '99-Missing') {
        // Qlik convention: 99-Missing represents NULL or empty channel values
        conditions.push(`(channel IS NULL OR TRIM(channel) = '')`);
      } else if (channelGroup === 'Other') {
        // Other = not Retail, not TPO, and not missing
        conditions.push(`(channel IS NOT NULL AND TRIM(channel) != '' AND channel NOT ILIKE '%retail%' AND channel NOT ILIKE '%brok%' AND channel NOT ILIKE '%whole%' AND channel NOT ILIKE '%corresp%')`);
      }
      // If channelGroup is 'All' or not recognized, don't add filter
    }
    
    // Out of Range Exclusion (Qlik default behavior)
    // From Transform.qvs lines 671-675:
    //   if([Interest Rate]<=0 OR [Interest Rate]>=15, 'Yes', 'No') as [Interest Rate Out of Range Flag],
    //   if([FICO Score]<350 OR [FICO Score]>=900, 'Yes', 'No') as [FICO Out of Range Flag],
    //   if([LTV Ratio]>=110 OR [LTV Ratio]<=0, 'Yes', 'No') as [LTV Out of Range Flag],
    //   if([BE DTI Ratio]>=70 OR [BE DTI Ratio]<=0, 'Yes', 'No') as [DTI Out of Range Flag],
    // 
    // IMPORTANT: Upper bounds use STRICT inequality (<), not inclusive (<=)
    if (excludeOutOfRange) {
      // FICO Score: In Range = 350 <= x < 900 (Out of Range = < 350 OR >= 900)
      conditions.push(`(fico_score IS NULL OR (fico_score >= 350 AND fico_score < 900))`);
      // Interest Rate: In Range = 0 < x < 15 (Out of Range = <= 0 OR >= 15)
      conditions.push(`(interest_rate IS NULL OR (interest_rate > 0 AND interest_rate < 15))`);
      // LTV Ratio: In Range = 0 < x < 110 (Out of Range = <= 0 OR >= 110)
      conditions.push(`(ltv_ratio IS NULL OR (ltv_ratio > 0 AND ltv_ratio < 110))`);
      // BE DTI Ratio: In Range = 0 < x < 70 (Out of Range = <= 0 OR >= 70)
      conditions.push(`(be_dti_ratio IS NULL OR (be_dti_ratio > 0 AND be_dti_ratio < 70))`);
    }
    
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    logInfo('[Funnel] Querying tenant database', { 
      whereClause, 
      params,
      tenantId,
      tenantName: tenantContext.tenantInfo.name,
      excludeOutOfRange,
      dateFilter: { startDate, endDate, yearFilter },
      channelFilter: { channel, channelGroup }
    });

    // Get all loans from tenant-specific database (no tenant_id filter needed)
    // Using only columns that exist in the tenant database schema
    // IMPORTANT: started_date is the primary date for "Loans Started" (per Qlik logic)
    //            application_date is used to determine RESPA App Status (has app vs no app)
    // Note: Out of Range columns (fico_score, etc.) are only included if excludeOutOfRange is true
    const baseColumns = `loan_id, loan_amount, loan_type, current_loan_status,
          started_date, application_date, closing_date, lock_date, funding_date, branch`;
    
    // Only include Out of Range columns if we're filtering on them
    const selectColumns = excludeOutOfRange 
      ? `${baseColumns}, fico_score, ltv_ratio, be_dti_ratio, interest_rate`
      : baseColumns;
    
    const loansResult = await retryQuery(
      () => tenantPool.query(
        `SELECT ${selectColumns}
         FROM public.loans 
         ${whereClause}
         ORDER BY COALESCE(started_date, created_at) DESC`,
        params
      ),
      2, // max retries
      500 // delay between retries
    );

    // Debug: Also get total count without date filter to understand the gap
    const totalCountResult = await tenantPool.query(`SELECT COUNT(*) as total FROM public.loans`);
    const totalInDb = totalCountResult.rows[0]?.total || 0;
    
    // Debug: Get count by year to see distribution
    const yearCountResult = await tenantPool.query(`
      SELECT EXTRACT(YEAR FROM COALESCE(started_date, created_at)) as year, COUNT(*) as count
      FROM public.loans 
      GROUP BY EXTRACT(YEAR FROM COALESCE(started_date, created_at))
      ORDER BY year DESC
      LIMIT 5
    `);
    
    // Debug: Get distinct current_loan_status values with counts
    const statusCountResult = await tenantPool.query(`
      SELECT current_loan_status, COUNT(*) as count
      FROM public.loans 
      ${whereClause.length > 0 ? whereClause : ''}
      GROUP BY current_loan_status
      ORDER BY count DESC
    `, params);
    
    logInfo('[Funnel] Query returned', { 
      totalLoans: loansResult.rows.length,
      totalInDb,
      loansByYear: yearCountResult.rows,
      statusCounts: statusCountResult.rows.slice(0, 10), // Top 10 statuses
      tenantId,
      dateFilter: { startDate, endDate, yearFilter },
      sampleLoans: loansResult.rows.slice(0, 3).map(r => ({ 
        current_loan_status: r.current_loan_status,
        started_date: r.started_date,
        application_date: r.application_date,
        funding_date: r.funding_date
      }))
    });

    // Use loan data directly from tenant database
    const loans = loansResult.rows;

    // Infer status based on current_loan_status field (tenant DB format) and dates
    const getInferredStatus = (loan: any) => {
      // First check dates for definitive status (most reliable)
      if (loan.funding_date || loan.closing_date) return 'Closed';
      if (loan.lock_date) return 'Locked';
      
      // Use current_loan_status from tenant database
      const currentStatus = (loan.current_loan_status || '').toString().toLowerCase().trim();
      
      // Map known current_loan_status values (from tenant database)
      // Based on observed values: 'Active Loan', 'Application approved but not accepted', 
      // 'Application denied', 'Application withdrawn', 'File Closed for incompleteness', 'Loan Originated'
      if (currentStatus.includes('active loan')) return 'Active';
      if (currentStatus.includes('loan originated')) return 'Closed';
      if (currentStatus.includes('application denied') || currentStatus.includes('denied')) return 'Denied';
      if (currentStatus.includes('application withdrawn') || currentStatus.includes('withdrawn')) return 'Withdrawn';
      if (currentStatus.includes('file closed') || currentStatus.includes('incompleteness')) return 'Withdrawn';
      if (currentStatus.includes('approved but not accepted')) return 'Active'; // Still in progress
      
      // Handle other common status values
      if (['active', 'submitted', 'approved', 'ctc', 'started', 'inquiry', 'processing', 'underwriting'].includes(currentStatus)) {
        return 'Active';
      }
      if (currentStatus === 'locked') return 'Locked';
      if (['withdrawn', 'cancelled'].includes(currentStatus)) return 'Withdrawn';
      if (['denied', 'declined'].includes(currentStatus)) return 'Denied';
      if (['funded', 'closed', 'originated', 'complete', 'completed'].includes(currentStatus)) return 'Closed';
      
      // If no status or unrecognized, default to active
      return 'Active';
    };

    const loansWithInferredStatus = loans.map(loan => ({
      ...loan,
      inferred_status: getInferredStatus(loan)
    }));

    // Calculate funnel stages
    const loansStarted = loans.length;
    const loansStartedVolume = loans.reduce((sum, l) => sum + parseFloat(l.loan_amount || 0), 0);

    // RESPA App Status logic from Qlik: if(Len(Trim([Application Date]))>0,'Yes','No')
    // Loans with RESPA Application = loans WHERE application_date IS NOT NULL
    // Loans with No RESPA Application = loans WHERE application_date IS NULL
    const loansWithRespaApp = loans.filter(l => 
      l.application_date !== null && l.application_date !== undefined && String(l.application_date).trim() !== ''
    );
    const loansWithRespaAppVolume = loansWithRespaApp.reduce((sum, l) => sum + parseFloat(l.loan_amount || 0), 0);
    
    const loansNoRespaApp = loans.filter(l => 
      l.application_date === null || l.application_date === undefined || String(l.application_date).trim() === ''
    );
    const loansNoRespaAppVolume = loansNoRespaApp.reduce((sum, l) => sum + parseFloat(l.loan_amount || 0), 0);

    // Active Loan Flag from Qlik: if("Current Loan Status" = 'Active Loan' AND Len([Application Date])>0, 'Yes', 'No')
    // "Still Active" loans must have:
    // 1. Current Loan Status = 'Active Loan' (not just any active status)
    // 2. AND application_date exists (not null/empty)
    const stillActive = loans.filter(l => {
      const currentStatus = (l.current_loan_status || '').toString().toLowerCase().trim();
      const hasApplicationDate = l.application_date !== null && l.application_date !== undefined && String(l.application_date).trim() !== '';
      // Active Loan Flag = 'Yes' when status is 'Active Loan' AND has application date
      return currentStatus === 'active loan' && hasApplicationDate;
    });
    const stillActiveVolume = stillActive.reduce((sum, l) => sum + parseFloat(l.loan_amount || 0), 0);

    // Originated loans - Pull Through Originated Flag from Qlik
    // Qlik: If(WildMatch([Current Loan Status],'*Originated*','*purchased*')>0,'Yes','No') as [Pull Through Originated Flag]
    // This checks ONLY the current_loan_status field, not dates
    const originated = loans.filter(l => {
      const currentStatus = (l.current_loan_status || '').toString().toLowerCase();
      return currentStatus.includes('originated') || currentStatus.includes('purchased');
    });
    const originatedVolume = originated.reduce((sum, l) => sum + parseFloat(l.loan_amount || 0), 0);

    // Fallout - Withdrawn
    // Qlik: If(WildMatch([Current Loan Status],'*withdraw*','*not accepted*','*incomp*')>0,1,0)
    // AND [Pull Through Originated Flag]*={No} (not originated)
    const falloutWithdrawn = loans.filter(l => {
      const currentStatus = (l.current_loan_status || '').toString().toLowerCase();
      const isWithdrawn = currentStatus.includes('withdraw') || 
                          currentStatus.includes('not accepted') || 
                          currentStatus.includes('incomp');
      // Exclude if already originated
      const isOriginated = currentStatus.includes('originated') || currentStatus.includes('purchased');
      return isWithdrawn && !isOriginated;
    });
    const falloutWithdrawnVolume = falloutWithdrawn.reduce((sum, l) => sum + parseFloat(l.loan_amount || 0), 0);

    // Fallout - Denied
    // Qlik: If(WildMatch([Current Loan Status],'*denied*')>0,1,0)
    // AND [Pull Through Originated Flag]*={No} (not originated)
    const falloutDenied = loans.filter(l => {
      const currentStatus = (l.current_loan_status || '').toString().toLowerCase();
      const isDenied = currentStatus.includes('denied');
      // Exclude if already originated
      const isOriginated = currentStatus.includes('originated') || currentStatus.includes('purchased');
      return isDenied && !isOriginated;
    });
    const falloutDeniedVolume = falloutDenied.reduce((sum, l) => sum + parseFloat(l.loan_amount || 0), 0);

    // Calculate revenue (simplified - 1% of loan amount)
    const revenueRate = 0.01;

    // Verify: All funnel metrics should already be filtered by started_date (from the WHERE clause)
    // The 'loans' array only contains loans where started_date matches the filter
    logInfo('[Funnel] Calculated funnel breakdown', {
      dateFilter: { startDate, endDate, yearFilter },
      loansStarted,
      respaApp: loansWithRespaApp.length,
      noRespaApp: loansNoRespaApp.length,
      stillActive: stillActive.length,
      originated: originated.length,
      withdrawn: falloutWithdrawn.length,
      denied: falloutDenied.length,
      loansStartedVolume,
      respaAppVolume: loansWithRespaAppVolume,
      noRespaAppVolume: loansNoRespaAppVolume,
      stillActiveVolume,
      originatedVolume,
      // Debug: verify the started_date range of loans in each category
      sampleStartedDates: {
        loansStarted: loans.slice(0, 3).map(l => ({ started_date: l.started_date, application_date: l.application_date })),
        stillActive: stillActive.slice(0, 3).map(l => ({ started_date: l.started_date, status: l.current_loan_status })),
      }
    });

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
      // RESPA App Status from Qlik: if(Len(Trim([Application Date]))>0,'Yes','No')
      // Loans WITH application_date = RESPA App Status 'Yes'
      respaApp: {
        units: loansWithRespaApp.length,
        volume: loansWithRespaAppVolume,
        revenue: loansWithRespaAppVolume * revenueRate,
      },
      // Loans WITHOUT application_date = RESPA App Status 'No'
      noRespaApp: {
        units: loansNoRespaApp.length,
        volume: loansNoRespaAppVolume,
        lostRevenue: loansNoRespaAppVolume * revenueRate,
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
 * Supports date range and channel filtering
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
    
    // Parse date range and channel filters from query params
    const startDate = req.query.startDate as string | undefined;
    const endDate = req.query.endDate as string | undefined;
    const channelGroup = req.query.channel_group as string | undefined;
    
    const now = new Date();
    // Use provided date range or default to current month
    const effectiveStartDate = startDate ? new Date(startDate) : new Date(now.getFullYear(), now.getMonth(), 1);
    const effectiveEndDate = endDate ? new Date(endDate) : now;
    
    // Build WHERE clause for channel filtering
    const conditions: string[] = ['tenant_id = $1'];
    const params: any[] = [tenantId];
    let paramIndex = 2;
    
    // Channel Group filter - consolidated channel (Retail, TPO, etc.)
    if (channelGroup && channelGroup !== 'All') {
      if (channelGroup === 'Retail') {
        conditions.push(`(channel ILIKE '%retail%' OR channel ILIKE '%brok%')`);
      } else if (channelGroup === 'TPO') {
        conditions.push(`(channel ILIKE '%whole%' OR channel ILIKE '%corresp%')`);
      } else if (channelGroup === '99-Missing') {
        conditions.push(`(channel IS NULL OR TRIM(channel) = '')`);
      } else if (channelGroup === 'Other') {
        conditions.push(`(channel IS NOT NULL AND TRIM(channel) != '' AND channel NOT ILIKE '%retail%' AND channel NOT ILIKE '%brok%' AND channel NOT ILIKE '%whole%' AND channel NOT ILIKE '%corresp%')`);
      }
    }
    
    const whereClause = conditions.join(' AND ');

    logInfo('[CompanyOverview] Query params', {
      tenantId,
      startDate: effectiveStartDate.toISOString(),
      endDate: effectiveEndDate.toISOString(),
      channelGroup
    });

    // Get all loans with channel filter applied
    const allLoansResult = await retryQuery(
      () => pool.query(
        `SELECT 
          loan_id, borrower_name, loan_amount, loan_type, status, channel,
          application_date, closing_date, lock_date, funding_date, interest_rate, raw_data
         FROM public.loans 
         WHERE ${whereClause}
         ORDER BY application_date DESC`,
        params
      ),
      2, 500
    );

    const allLoans = allLoansResult.rows;

    // Active Loans (excluding closed/denied/withdrawn) - smart detection
    // Qlik: [Active Loan Flag] = 'Yes' means status is 'Active Loan' AND has application date
    // Use inferred status based on dates and raw status
    const getInferredStatus = (loan: any) => {
      if (loan.closing_date || loan.funding_date) return 'Closed';
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

    // Active Loans - filter by application date within date range
    const activeLoans = allLoans.filter(l => {
      const inferredStatus = getInferredStatus(l);
      if (!['Active', 'Locked', 'Submitted', 'Approved', 'CTC'].includes(inferredStatus)) return false;
      
      // If date range is provided, filter active loans by application date
      if (l.application_date) {
        const appDate = new Date(l.application_date);
        return appDate >= effectiveStartDate && appDate <= effectiveEndDate;
      }
      return true; // Include loans without application date
    });

    // Submitted Loans - loans with application_date in the date range
    const submittedMTD = allLoans.filter(l => {
      if (!l.application_date) return false;
      const appDate = new Date(l.application_date);
      return appDate >= effectiveStartDate && appDate <= effectiveEndDate;
    });

    // Funded Loans - loans with funding_date or closing_date in the date range
    const fundedMTD = allLoans.filter(l => {
      const fundDate = l.funding_date ? new Date(l.funding_date) : (l.closing_date ? new Date(l.closing_date) : null);
      if (!fundDate) return false;
      return fundDate >= effectiveStartDate && fundDate <= effectiveEndDate;
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

    // Loan Type distribution for Submitted
    const submittedByType: Record<string, number> = {};
    submittedMTD.forEach(loan => {
      const type = loan.loan_type || 'Other';
      submittedByType[type] = (submittedByType[type] || 0) + 1;
    });

    // Loan Type distribution for Funded
    const fundedByType: Record<string, number> = {};
    fundedMTD.forEach(loan => {
      const type = loan.loan_type || 'Other';
      fundedByType[type] = (fundedByType[type] || 0) + 1;
    });

    // Calculate averages with WAC formula: Sum(Loan Amount * Interest Rate) / Sum(Loan Amount)
    const activeVolume = activeLoans.reduce((sum, l) => sum + parseFloat(l.loan_amount || 0), 0);
    const activeWac = activeVolume > 0
      ? activeLoans.reduce((sum, l) => {
          const amount = parseFloat(l.loan_amount || 0);
          const rate = parseFloat(l.interest_rate || 0);
          return sum + (amount * rate);
        }, 0) / activeVolume
      : 0;

    const submittedVolume = submittedMTD.reduce((sum, l) => sum + parseFloat(l.loan_amount || 0), 0);
    const submittedWac = submittedVolume > 0
      ? submittedMTD.reduce((sum, l) => {
          const amount = parseFloat(l.loan_amount || 0);
          const rate = parseFloat(l.interest_rate || 0);
          return sum + (amount * rate);
        }, 0) / submittedVolume
      : 0;

    const fundedVolume = fundedMTD.reduce((sum, l) => sum + parseFloat(l.loan_amount || 0), 0);
    const fundedWac = fundedVolume > 0
      ? fundedMTD.reduce((sum, l) => {
          const amount = parseFloat(l.loan_amount || 0);
          const rate = parseFloat(l.interest_rate || 0);
          return sum + (amount * rate);
        }, 0) / fundedVolume
      : 0;

    logInfo('[CompanyOverview] Results', {
      activeCount: activeLoans.length,
      submittedCount: submittedMTD.length,
      fundedCount: fundedMTD.length,
      dateRange: { start: effectiveStartDate.toISOString(), end: effectiveEndDate.toISOString() }
    });

    res.json({
      activeLoans: {
        count: activeLoans.length,
        volume: activeVolume,
        avgInterestRate: activeWac,
      },
      submittedMTD: {
        count: submittedMTD.length,
        volume: submittedVolume,
        avgInterestRate: submittedWac,
      },
      fundedMTD: {
        count: fundedMTD.length,
        volume: fundedVolume,
        avgInterestRate: fundedWac,
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
 * Supports date range and channel filtering
 */
router.get('/operations-overview', authenticateToken, apiLimiter, async (req: AuthRequest, res) => {
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
    
    // Parse date range and channel filters from query params
    const startDate = req.query.startDate as string | undefined;
    const endDate = req.query.endDate as string | undefined;
    const channelGroup = req.query.channel_group as string | undefined;
    
    const now = new Date();
    // Use provided date range or default to current year
    const effectiveStartDate = startDate ? new Date(startDate) : new Date(now.getFullYear(), 0, 1);
    const effectiveEndDate = endDate ? new Date(endDate) : now;
    
    // Build WHERE clause for channel filtering
    const conditions: string[] = ['tenant_id = $1'];
    const params: any[] = [tenantId];
    
    // Channel Group filter - consolidated channel (Retail, TPO, etc.)
    if (channelGroup && channelGroup !== 'All') {
      if (channelGroup === 'Retail') {
        conditions.push(`(channel ILIKE '%retail%' OR channel ILIKE '%brok%')`);
      } else if (channelGroup === 'TPO') {
        conditions.push(`(channel ILIKE '%whole%' OR channel ILIKE '%corresp%')`);
      } else if (channelGroup === '99-Missing') {
        conditions.push(`(channel IS NULL OR TRIM(channel) = '')`);
      } else if (channelGroup === 'Other') {
        conditions.push(`(channel IS NOT NULL AND TRIM(channel) != '' AND channel NOT ILIKE '%retail%' AND channel NOT ILIKE '%brok%' AND channel NOT ILIKE '%whole%' AND channel NOT ILIKE '%corresp%')`);
      }
    }
    
    const whereClause = conditions.join(' AND ');

    logInfo('[OperationsOverview] Query params', {
      tenantId,
      startDate: effectiveStartDate.toISOString(),
      endDate: effectiveEndDate.toISOString(),
      channelGroup
    });

    // Get all loans with channel filter applied
    const loansResult = await retryQuery(
      () => pool.query(
        `SELECT 
          loan_id, borrower_name, loan_amount, loan_type, status, channel,
          application_date, closing_date, lock_date, funding_date, ctc_date, interest_rate, raw_data
         FROM public.loans 
         WHERE ${whereClause}
         ORDER BY application_date DESC`,
        params
      ),
      2, 500
    );

    const allLoans = loansResult.rows;

    // Active Pipeline - smart detection, filtered by date range
    const activeLoans = allLoans.filter(l => {
      const status = (l.status || '').toString().toUpperCase();
      const isStateCode = /^[A-Z]{2}$/.test(status);
      const isActive = isStateCode 
        ? !(l.closing_date || l.funding_date)
        : !['CLOSED', 'FUNDED', 'ORIGINATED', 'WITHDRAWN', 'DENIED', 'COMPLETED'].includes(status);
      
      if (!isActive) return false;
      
      // Filter by application date within date range
      if (l.application_date) {
        const appDate = new Date(l.application_date);
        return appDate >= effectiveStartDate && appDate <= effectiveEndDate;
      }
      return true;
    });
    const activeVolume = activeLoans.reduce((sum, l) => sum + parseFloat(l.loan_amount || 0), 0);

    // Calculate average cycle time (application to closing/funding) for loans within date range
    const loansWithDates = allLoans.filter(l => {
      if (!l.application_date) return false;
      const fundDate = l.funding_date || l.closing_date;
      if (!fundDate) return false;
      
      // Filter by funding date within date range
      const fundDateObj = new Date(fundDate);
      return fundDateObj >= effectiveStartDate && fundDateObj <= effectiveEndDate;
    });
    
    const cycleTimes = loansWithDates.map(l => {
      const fundDate = l.funding_date || l.closing_date;
      return daysBetween(l.application_date, fundDate);
    }).filter(d => d !== null && d > 0) as number[];
    
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

    // Turn Time by Stage - calculate actual times from milestone dates when available
    // Qlik uses NetworkDays function but we'll use calendar days for simplicity
    const appToLockTarget = 10;
    const lockToCTCTarget = 15;
    const ctcToFundingTarget = 10;

    // Calculate actual turn times from milestone dates
    const appToLockTimes = loansWithDates
      .filter(l => l.application_date && l.lock_date)
      .map(l => daysBetween(l.application_date, l.lock_date))
      .filter(d => d !== null && d > 0) as number[];
    
    const lockToCTCTimes = loansWithDates
      .filter(l => l.lock_date && l.ctc_date)
      .map(l => daysBetween(l.lock_date, l.ctc_date))
      .filter(d => d !== null && d > 0) as number[];
    
    const ctcToFundingTimes = loansWithDates
      .filter(l => l.ctc_date && (l.funding_date || l.closing_date))
      .map(l => daysBetween(l.ctc_date, l.funding_date || l.closing_date))
      .filter(d => d !== null && d > 0) as number[];

    // Calculate averages or estimate from cycle time if no milestone dates available
    const appToLockActual = appToLockTimes.length > 0
      ? Math.round(appToLockTimes.reduce((sum, d) => sum + d, 0) / appToLockTimes.length)
      : Math.round(avgCycleTime * 0.28);
    
    const lockToCTCActual = lockToCTCTimes.length > 0
      ? Math.round(lockToCTCTimes.reduce((sum, d) => sum + d, 0) / lockToCTCTimes.length)
      : Math.round(avgCycleTime * 0.42);
    
    const ctcToFundingActual = ctcToFundingTimes.length > 0
      ? Math.round(ctcToFundingTimes.reduce((sum, d) => sum + d, 0) / ctcToFundingTimes.length)
      : Math.round(avgCycleTime * 0.30);

    logInfo('[OperationsOverview] Results', {
      activeCount: activeLoans.length,
      avgCycleTime,
      processingEfficiency,
      dateRange: { start: effectiveStartDate.toISOString(), end: effectiveEndDate.toISOString() }
    });

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
 * GET /api/loans/toptiering
 * Get TopTiering data for Sales Scorecard with Pareto-based tier assignment
 * 
 * Based on Qlik logic:
 * - DateType = 'Funding' (uses funding_date or closing_date)
 * - Sort actors by revenue descending
 * - Calculate cumulative % of total revenue
 * - Assign tiers: Top (<=65%), Second (65-90%), Bottom (>90%)
 * 
 * Query Parameters:
 * - actor: 'branch' | 'loan_officer' (default: 'branch')
 * - startDate: ISO date string
 * - endDate: ISO date string
 * - channel_group: Optional channel filter
 */
router.get('/toptiering', authenticateToken, apiLimiter, async (req: AuthRequest, res) => {
  try {
    // Get tenant_id from query parameter or profile
    let tenantId = req.query.tenant_id as string | undefined;
    
    if (!tenantId) {
      // Fall back to getting tenant_id from profile
      const profileResult = await pool.query(
        'SELECT tenant_id FROM public.profiles WHERE user_id = $1',
        [req.userId]
      );

      if (profileResult.rows.length === 0 || !profileResult.rows[0].tenant_id) {
        return res.status(404).json({ error: 'Tenant not found' });
      }
      tenantId = profileResult.rows[0].tenant_id;
    }

    const actor = (req.query.actor as string) || 'branch';
    const startDate = req.query.startDate as string | undefined;
    const endDate = req.query.endDate as string | undefined;
    const channelGroup = req.query.channel_group as string | undefined;

    // Validate actor type
    if (!['branch', 'loan_officer'].includes(actor)) {
      return res.status(400).json({ error: 'Invalid actor type. Must be "branch" or "loan_officer"' });
    }

    // Determine the grouping column based on actor type
    const actorColumn = actor === 'branch' ? 'branch' : 'loan_officer';

    // Build date range filter
    const now = new Date();
    const effectiveEndDate = endDate ? new Date(endDate) : now;
    const effectiveStartDate = startDate ? new Date(startDate) : new Date(now.getFullYear(), 0, 1);

    logInfo('[TopTiering] Starting query', {
      actor,
      tenantId,
      dateRange: { start: effectiveStartDate.toISOString(), end: effectiveEndDate.toISOString() },
      channelGroup
    });

    // PHASE 1: Fetch ALL loans for tenant with minimal filtering
    // This approach matches the working /company-overview endpoint
    const allLoansResult = await retryQuery(
      () => pool.query(
        `SELECT 
          loan_id, loan_amount, loan_type, current_loan_status, channel,
          funding_date, closing_date, application_date, started_date,
          branch, loan_officer, fico_score, ltv_ratio, be_dti_ratio,
          origination_points, orig_fee_borr_pd, orig_fees_seller, cd_lender_credits
         FROM public.loans 
         WHERE tenant_id = $1`,
        [tenantId]
      ),
      2, 500
    );

    const allLoans = allLoansResult.rows;
    
    logInfo('[TopTiering] Fetched all loans', {
      totalLoans: allLoans.length,
      sampleStatuses: allLoans.slice(0, 5).map(l => l.current_loan_status)
    });

    // PHASE 2: Apply channel filter in JavaScript
    const channelFilteredLoans = allLoans.filter((l: any) => {
      if (!channelGroup || channelGroup === 'All') return true;
      
      const channel = (l.channel || '').toLowerCase();
      if (channelGroup === 'Retail') {
        return channel.includes('retail') || channel.includes('brok');
      } else if (channelGroup === 'TPO') {
        return channel.includes('whole') || channel.includes('corresp');
      } else if (channelGroup === '99-Missing') {
        return !channel || channel.trim() === '';
      } else if (channelGroup === 'Other') {
        return channel && channel.trim() !== '' 
          && !channel.includes('retail') && !channel.includes('brok')
          && !channel.includes('whole') && !channel.includes('corresp');
      }
      return true;
    });

    // PHASE 3: Filter for FUNDED loans in date range
    // A loan is "funded" if it has funding_date or closing_date
    const fundedLoans = channelFilteredLoans.filter((l: any) => {
      const fundDate = l.funding_date || l.closing_date;
      if (!fundDate) return false;
      const fd = new Date(fundDate);
      return fd >= effectiveStartDate && fd <= effectiveEndDate;
    });

    logInfo('[TopTiering] After filtering', {
      channelFiltered: channelFilteredLoans.length,
      fundedInRange: fundedLoans.length
    });

    // PHASE 4: Filter for LOST OPPORTUNITY loans (withdrawn/denied) in date range
    const lostOpportunityLoans = channelFilteredLoans.filter((l: any) => {
      const status = (l.current_loan_status || '').toUpperCase();
      const isLostOpportunity = status.includes('WITHDRAWN') || status.includes('DENIED') || 
                                status.includes('CANCELLED') || status.includes('DECLINED');
      if (!isLostOpportunity) return false;
      
      // Use application_date for lost opportunities
      const appDate = l.application_date;
      if (!appDate) return false;
      const ad = new Date(appDate);
      return ad >= effectiveStartDate && ad <= effectiveEndDate;
    });

    // Denied-only loans (subset of lost opportunity)
    const deniedLoans = lostOpportunityLoans.filter((l: any) => {
      const status = (l.current_loan_status || '').toUpperCase();
      return status.includes('DENIED') || status.includes('DECLINED');
    });

    // PHASE 5: Count STARTED loans in date range (for pull-through calculation)
    const startedLoans = channelFilteredLoans.filter((l: any) => {
      const startedDate = l.started_date || l.application_date;
      if (!startedDate) return false;
      const sd = new Date(startedDate);
      return sd >= effectiveStartDate && sd <= effectiveEndDate;
    });

    // Helper to calculate revenue for a loan
    const calcLoanRevenue = (l: any): number => {
      const origPoints = parseFloat(l.origination_points) || 0;
      const origFeeBorr = parseFloat(l.orig_fee_borr_pd) || 0;
      const origFeeSeller = parseFloat(l.orig_fees_seller) || 0;
      const cdCredits = parseFloat(l.cd_lender_credits) || 0;
      
      // If revenue fields are populated, use them
      if (origPoints + origFeeBorr + origFeeSeller > 0) {
        return origPoints + origFeeBorr + origFeeSeller - cdCredits;
      }
      // Fallback: estimate revenue as 1% of loan amount
      const loanAmount = parseFloat(l.loan_amount) || 0;
      return loanAmount * 0.01;
    };

    // Helper to calculate turn time for a loan
    const calcTurnTime = (l: any): number | null => {
      const appDate = l.application_date;
      const fundDate = l.funding_date || l.closing_date;
      if (!appDate || !fundDate) return null;
      const diffMs = new Date(fundDate).getTime() - new Date(appDate).getTime();
      return Math.round(diffMs / (1000 * 60 * 60 * 24)); // days
    };

    // PHASE 6: Group funded loans by actor and calculate metrics
    const actorMap = new Map<string, {
      loans: any[];
      revenue: number;
      volume: number;
      units: number;
      turnTimes: number[];
      ficoWeighted: { sum: number; weight: number };
      ltvWeighted: { sum: number; weight: number };
      dtiWeighted: { sum: number; weight: number };
    }>();

    fundedLoans.forEach((l: any) => {
      const actorName = l[actorColumn];
      if (!actorName || actorName.trim() === '') return;

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
      const revenue = calcLoanRevenue(l);
      const turnTime = calcTurnTime(l);

      actor.loans.push(l);
      actor.revenue += revenue;
      actor.volume += loanAmount;
      actor.units += 1;
      
      if (turnTime !== null && turnTime > 0) {
        actor.turnTimes.push(turnTime);
      }

      // Weighted averages (weight by loan amount)
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

    // PHASE 7: Calculate totals and sort by revenue for tier assignment
    const actorMetrics = Array.from(actorMap.entries())
      .map(([name, data]) => ({
        name,
        revenue: data.revenue,
        volume: data.volume,
        units: data.units,
        revenueBps: data.volume > 0 ? (data.revenue / data.volume) * 10000 : 0,
        revenuePerLoan: data.units > 0 ? data.revenue / data.units : 0,
        avgTurnTime: data.turnTimes.length > 0 
          ? data.turnTimes.reduce((a, b) => a + b, 0) / data.turnTimes.length 
          : 0,
        waFico: data.ficoWeighted.weight > 0 
          ? data.ficoWeighted.sum / data.ficoWeighted.weight 
          : 0,
        waLtv: data.ltvWeighted.weight > 0 
          ? data.ltvWeighted.sum / data.ltvWeighted.weight 
          : 0,
        waDti: data.dtiWeighted.weight > 0 
          ? data.dtiWeighted.sum / data.dtiWeighted.weight 
          : 0,
      }))
      .sort((a, b) => b.revenue - a.revenue);

    // Calculate total revenue for tier assignment
    const totalRevenue = actorMetrics.reduce((sum, a) => sum + a.revenue, 0);
    const totalVolume = actorMetrics.reduce((sum, a) => sum + a.volume, 0);
    const totalUnits = actorMetrics.reduce((sum, a) => sum + a.units, 0);

    // Assign tiers based on cumulative revenue percentage
    let cumulativeRevenue = 0;
    const actors = actorMetrics.map(a => {
      cumulativeRevenue += a.revenue;
      const cumulativePercent = totalRevenue > 0 ? (cumulativeRevenue / totalRevenue) * 100 : 0;
      
      let tier: 'top' | 'second' | 'bottom';
      if (cumulativePercent <= 65) {
        tier = 'top';
      } else if (cumulativePercent <= 90) {
        tier = 'second';
      } else {
        tier = 'bottom';
      }

      return {
        ...a,
        cumulativePercent,
        tier,
      };
    });

    // PHASE 8: Calculate Lost Opportunity metrics by actor
    const lostOpportunityByActor = new Map<string, { units: number; revenue: number }>();
    const deniedByActor = new Map<string, number>();

    lostOpportunityLoans.forEach((l: any) => {
      const actorName = l[actorColumn];
      if (!actorName || actorName.trim() === '') return;

      if (!lostOpportunityByActor.has(actorName)) {
        lostOpportunityByActor.set(actorName, { units: 0, revenue: 0 });
      }
      const lo = lostOpportunityByActor.get(actorName)!;
      lo.units += 1;
      lo.revenue += calcLoanRevenue(l);
    });

    deniedLoans.forEach((l: any) => {
      const actorName = l[actorColumn];
      if (!actorName || actorName.trim() === '') return;
      deniedByActor.set(actorName, (deniedByActor.get(actorName) || 0) + 1);
    });

    // PHASE 9: Calculate tier summaries
    const topTierActors = actors.filter(a => a.tier === 'top');
    const secondTierActors = actors.filter(a => a.tier === 'second');
    const bottomTierActors = actors.filter(a => a.tier === 'bottom');

    const calcTierSummary = (tierActors: typeof actors) => {
      const tierNames = new Set(tierActors.map(a => a.name));
      
      // Lost opportunity for this tier
      let lostUnits = 0;
      let lostRevenue = 0;
      let deniedUnits = 0;
      
      tierNames.forEach(name => {
        const lo = lostOpportunityByActor.get(name);
        if (lo) {
          lostUnits += lo.units;
          lostRevenue += lo.revenue;
        }
        deniedUnits += deniedByActor.get(name) || 0;
      });

      // Started loans for this tier (for pull-through)
      const tierStartedLoans = startedLoans.filter((l: any) => tierNames.has(l[actorColumn]));
      const tierFundedCount = tierActors.reduce((sum, a) => sum + a.units, 0);
      const pullThrough = tierStartedLoans.length > 0 
        ? (tierFundedCount / tierStartedLoans.length) * 100 
        : 0;

      // Calculate averages
      const validTurnTimes = tierActors.filter(a => a.avgTurnTime > 0);
      const validFicos = tierActors.filter(a => a.waFico > 0);
      const validLtvs = tierActors.filter(a => a.waLtv > 0);
      const validDtis = tierActors.filter(a => a.waDti > 0);

      return {
        count: tierActors.length,
        revenue: tierActors.reduce((sum, a) => sum + a.revenue, 0),
        volume: tierActors.reduce((sum, a) => sum + a.volume, 0),
        units: tierActors.reduce((sum, a) => sum + a.units, 0),
        percent: totalRevenue > 0 
          ? (tierActors.reduce((sum, a) => sum + a.revenue, 0) / totalRevenue) * 100 
          : 0,
        avgTurnTime: validTurnTimes.length > 0 
          ? validTurnTimes.reduce((sum, a) => sum + a.avgTurnTime, 0) / validTurnTimes.length 
          : 0,
        waFico: validFicos.length > 0 
          ? validFicos.reduce((sum, a) => sum + a.waFico, 0) / validFicos.length 
          : 0,
        waLtv: validLtvs.length > 0 
          ? validLtvs.reduce((sum, a) => sum + a.waLtv, 0) / validLtvs.length 
          : 0,
        waDti: validDtis.length > 0 
          ? validDtis.reduce((sum, a) => sum + a.waDti, 0) / validDtis.length 
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

    // Overall totals including lost opportunity metrics
    const totalLostOpportunityUnits = lostOpportunityLoans.length;
    const totalLostOpportunityRevenue = lostOpportunityLoans.reduce((sum: number, l: any) => sum + calcLoanRevenue(l), 0);
    const totalDeniedUnits = deniedLoans.length;
    const totalPullThrough = startedLoans.length > 0 ? (fundedLoans.length / startedLoans.length) * 100 : 0;

    // Calculate overall weighted averages
    const allTurnTimes = actors.filter(a => a.avgTurnTime > 0);
    const allFicos = actors.filter(a => a.waFico > 0);
    const allLtvs = actors.filter(a => a.waLtv > 0);
    const allDtis = actors.filter(a => a.waDti > 0);

    const totals = {
      revenue: totalRevenue,
      volume: totalVolume,
      units: totalUnits,
      avgTurnTime: allTurnTimes.length > 0 
        ? allTurnTimes.reduce((sum, a) => sum + a.avgTurnTime, 0) / allTurnTimes.length 
        : 0,
      waFico: allFicos.length > 0 
        ? allFicos.reduce((sum, a) => sum + a.waFico, 0) / allFicos.length 
        : 0,
      waLtv: allLtvs.length > 0 
        ? allLtvs.reduce((sum, a) => sum + a.waLtv, 0) / allLtvs.length 
        : 0,
      waDti: allDtis.length > 0 
        ? allDtis.reduce((sum, a) => sum + a.waDti, 0) / allDtis.length 
        : 0,
      lostOpportunityUnits: totalLostOpportunityUnits,
      lostOpportunityRevenue: totalLostOpportunityRevenue,
      deniedUnits: totalDeniedUnits,
      pullThrough: totalPullThrough,
    };

    logInfo('[TopTiering] Results', {
      actor,
      actorCount: actors.length,
      dateRange: { start: effectiveStartDate.toISOString(), end: effectiveEndDate.toISOString() },
      tierCounts: { top: topTierActors.length, second: secondTierActors.length, bottom: bottomTierActors.length },
      totals: { revenue: totalRevenue, volume: totalVolume, units: totalUnits },
      lostOpportunity: { units: totalLostOpportunityUnits, revenue: totalLostOpportunityRevenue },
      denied: totalDeniedUnits,
      pullThrough: totalPullThrough
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
    logError('Error fetching toptiering data', error, { userId: req.userId });
    res.status(500).json({ error: error.message || 'Failed to fetch toptiering data' });
  }
});

/**
 * GET /api/loans/sales-scorecard
 * Get TTS (Top Tier Score) Sales Scorecard data with weighted scoring system
 * 
 * Based on Qlik Performance App "Sales Scorecard" sheet
 * 
 * TTS Component Ratings (each compared to company average, 100 = average):
 * - Volume Rating: (Actor Avg Loan Amount / Company Avg Loan Amount) × 100
 * - Margin Rating: (Actor Avg Revenue / Company Avg Revenue) × 100
 * - Turn Time Rating: (Company Avg Turn Time / Actor Turn Time) × 100 (inverse - faster is better)
 * - Pull-Through Rating: (Actor Pull-Through / Company Avg Pull-Through) × 100
 * 
 * TTS Formula (with compound weighting):
 * TTS = (UnitRating × UnitWeight + VolumeRating × VolumeWeight + MarginRating × MarginWeight + 
 *        ConcessionRating × ConcessionWeight + PullThroughRating × PullThroughWeight +
 *        TurnTimeRating × TurnTimeWeight) / 100
 * 
 * Default Weights (from Qlik TTS Formula Documentation):
 * - Unit: 20%, Volume: 20%, Margin: 20%, Concessions: 20%, Pull-Through: 15%, Turn Time: 5%
 * 
 * Tier Assignment (Score-Based Thresholds from Qlik):
 * - Top Tier: TTS > 120
 * - Second Tier (Above Average): TTS 100-120
 * - Bottom Tier: TTS < 100 (combines Below Average 80-100 and Bottom Tier <80)
 * 
 * Date Type: FUNDING DATE (DateType={'Funding'} in Qlik)
 * 
 * Query Parameters:
 * - actor: 'branch' | 'loan_officer' (default: 'loan_officer')
 * - startDate: ISO date string (default: 13 months ago - rolling 13 months)
 * - endDate: ISO date string (default: today)
 * - channel_group: Optional channel filter
 */
router.get('/sales-scorecard', authenticateToken, attachTenantContext, apiLimiter, async (req: AuthRequest, res) => {
  try {
    // Get tenant pool from context (same as other loan endpoints)
    const tenantPool = getTenantContext(req).tenantPool;

    const actor = (req.query.actor as string) || 'loan_officer';
    const startDate = req.query.startDate as string | undefined;
    const endDate = req.query.endDate as string | undefined;
    const channelGroup = req.query.channel_group as string | undefined;

    // Validate actor type
    if (!['branch', 'loan_officer'].includes(actor)) {
      return res.status(400).json({ error: 'Invalid actor type. Must be "branch" or "loan_officer"' });
    }

    const actorColumn = actor === 'branch' ? 'branch' : 'loan_officer';

    // Build date range - DEFAULT to rolling 13 months (per Qlik TTS scorecard standard)
    // Qlik's Rolling13MonthFlag: AddMonths(MonthEnd(vMaxDate), -13, 1) 
    // = First day of the month that is 13 months before the max date's month
    const now = new Date();
    const effectiveEndDate = endDate ? new Date(endDate) : now;
    // Default start date is first day of the month, 13 months ago (Qlik eCCA_TVI_Score_13_Months)
    // Example: If end date is Jan 24, 2026, start = Dec 1, 2024 (first day, 13 months back)
    const effectiveStartDate = startDate 
      ? new Date(startDate) 
      : new Date(effectiveEndDate.getFullYear(), effectiveEndDate.getMonth() - 13, 1);

    // TTS Weight Configuration - matches Qlik eCCA_TVI_Score_13_Months formula (6 components)
    // From TTS_FORMULA_FINDINGS.md: Qlik uses ALL 6 components with NO compound scaling
    // Weights from XML (divided by 10): Volume=2, Margin=2, TurnTime=0.5, PullThrough=1.5, Unit=2, Concession=2
    // Compound scaling is COMMENTED OUT in Qlik - do NOT multiply by VolumeRating/100 or MarginRating/100
    const weightConfig = {
      volume: 2,        // 20% / 10 - Volume Rating weight
      margin: 2,        // 20% / 10 - Margin Rating weight  
      turnTime: 0.5,    // 5% / 10 - Turn Time Rating weight (NO compound scaling)
      pullThrough: 1.5, // 15% / 10 - Pull Through Rating weight (NO compound scaling)
      unit: 2,          // 20% / 10 - Unit Rating weight
      concession: 2,    // 20% / 10 - Concession Rating weight (conditional)
    };
    // Concession is conditional via vCCA_ScorecardIncludeConcession - assume enabled for now
    const includeConcession = true;
    const totalWeight = includeConcession 
      ? weightConfig.volume + weightConfig.margin + weightConfig.turnTime + weightConfig.pullThrough + weightConfig.unit + weightConfig.concession  // = 10
      : weightConfig.volume + weightConfig.margin + weightConfig.turnTime + weightConfig.pullThrough + weightConfig.unit;  // = 8

    logInfo('[SalesScorecard] Starting TTS calculation', {
      actor,
      dateRange: { start: effectiveStartDate.toISOString(), end: effectiveEndDate.toISOString() },
      channelGroup,
      weights: weightConfig
    });

    // PHASE 1: Fetch ALL loans from tenant database (no tenant_id filter needed - pool is tenant-specific)
    // Note: DateType={'Funding'} in Qlik - we filter by funding_date
    // Branch Concession from Qlik: "Branch Price Concession" (Fields.3375) - stored as percentage
    // Qlik only uses Branch Concession for TTS (Corporate Concession is loaded but not used)
    // Added occupancy_type and borr_self_employed for Loan Complexity Score calculation
    // Added rate_lock_buy_side_base_price_rate for Revenue calculation per Qlik Transform.qvs line 549:
    //   Revenue = [Base Buy ($)] + Orig Fee Borr Pd + Orig Fees Seller - CD Lender Credits
    //   [Base Buy ($)] = ((Base Buy - 100) / 100) * Loan Amount
    const allLoansResult = await retryQuery(
      () => tenantPool.query(
        `SELECT 
          loan_id, loan_amount, loan_type, loan_purpose, current_loan_status, channel,
          funding_date, closing_date, application_date, started_date,
          branch, loan_officer, fico_score, ltv_ratio, be_dti_ratio,
          origination_points, orig_fee_borr_pd, orig_fees_seller, cd_lender_credits,
          branch_price_concession, occupancy_type, borr_self_employed,
          rate_lock_buy_side_base_price_rate
         FROM loans`
      ),
      2, 500
    );

    const allLoans = allLoansResult.rows;

    // Debug logging for zero data investigation
    logInfo('[SalesScorecard] Data check', {
      totalLoans: allLoans.length,
      loansWithFundingDate: allLoans.filter((l: any) => l.funding_date).length,
      loansWithClosingDate: allLoans.filter((l: any) => l.closing_date).length,
      loansWithLoanOfficer: allLoans.filter((l: any) => l.loan_officer && l.loan_officer.trim() !== '').length,
      loansWithBranch: allLoans.filter((l: any) => l.branch && l.branch.trim() !== '').length,
      sampleLoanOfficers: [...new Set(allLoans.slice(0, 20).map((l: any) => l.loan_officer).filter(Boolean))],
      sampleBranches: [...new Set(allLoans.slice(0, 20).map((l: any) => l.branch).filter(Boolean))],
    });

    // PHASE 2: Apply channel filter
    const channelFilteredLoans = allLoans.filter((l: any) => {
      if (!channelGroup || channelGroup === 'All') return true;
      
      const channel = (l.channel || '').toLowerCase();
      if (channelGroup === 'Retail') {
        return channel.includes('retail') || channel.includes('brok');
      } else if (channelGroup === 'TPO') {
        return channel.includes('whole') || channel.includes('corresp');
      } else if (channelGroup === '99-Missing') {
        return !channel || channel.trim() === '';
      } else if (channelGroup === 'Other') {
        return channel && channel.trim() !== '' 
          && !channel.includes('retail') && !channel.includes('brok')
          && !channel.includes('whole') && !channel.includes('corresp');
      }
      return true;
    });

    // PHASE 3: Filter for FUNDED loans in date range
    // Qlik: DateType*={'Funding'} - ONLY uses funding_date, no fallback to closing_date
    const fundedLoans = channelFilteredLoans.filter((l: any) => {
      if (!l.funding_date) return false; // Must have funding_date (no fallback)
      const fd = new Date(l.funding_date);
      return fd >= effectiveStartDate && fd <= effectiveEndDate;
    });

    // PHASE 4: Filter for STARTED loans in date range (for pull-through)
    const startedLoans = channelFilteredLoans.filter((l: any) => {
      const startedDate = l.started_date || l.application_date;
      if (!startedDate) return false;
      const sd = new Date(startedDate);
      return sd >= effectiveStartDate && sd <= effectiveEndDate;
    });

    // PHASE 5: Filter for LOST OPPORTUNITY loans (withdrawn/denied) in date range
    const lostOpportunityLoans = channelFilteredLoans.filter((l: any) => {
      const status = (l.current_loan_status || '').toUpperCase();
      const isLostOpportunity = status.includes('WITHDRAWN') || status.includes('DENIED') || 
                                status.includes('CANCELLED') || status.includes('DECLINED');
      if (!isLostOpportunity) return false;
      
      // Use application_date for lost opportunities
      const appDate = l.application_date;
      if (!appDate) return false;
      const ad = new Date(appDate);
      return ad >= effectiveStartDate && ad <= effectiveEndDate;
    });

    // Denied-only loans (subset of lost opportunity)
    const deniedLoans = lostOpportunityLoans.filter((l: any) => {
      const status = (l.current_loan_status || '').toUpperCase();
      return status.includes('DENIED') || status.includes('DECLINED');
    });

    logInfo('[SalesScorecard] Filtered loans', {
      total: allLoans.length,
      channelFiltered: channelFilteredLoans.length,
      funded: fundedLoans.length,
      started: startedLoans.length,
      lostOpportunity: lostOpportunityLoans.length,
      denied: deniedLoans.length
    });

    // Helper functions
    // Revenue calculation per Qlik Transform.qvs line 549:
    //   When vDefaultRevFlag=0: Revenue = [Base Buy ($)] + Orig Fee Borr Pd + Orig Fees Seller - CD Lender Credits
    //   Where [Base Buy ($)] = ((Base Buy - 100) / 100) * Loan Amount
    //   "Base Buy" = rate_lock_buy_side_base_price_rate in our database
    //   If Base Buy is 0/missing, fall back to Origination Points (per Qlik Origination Revenue formula)
    const calcLoanRevenue = (l: any): number => {
      const loanAmount = parseFloat(l.loan_amount) || 0;
      const origPoints = parseFloat(l.origination_points) || 0;
      const origFeeBorr = parseFloat(l.orig_fee_borr_pd) || 0;
      const origFeeSeller = parseFloat(l.orig_fees_seller) || 0;
      const cdCredits = parseFloat(l.cd_lender_credits) || 0;
      
      // rate_lock_buy_side_base_price_rate is stored as a rate (e.g., 102.5 = 2.5% gain over par)
      const baseBuy = parseFloat(l.rate_lock_buy_side_base_price_rate) || 0;
      
      let revenue;
      if (baseBuy > 0 && loanAmount > 0) {
        // Use Base Buy formula when available
        const baseBuyDollars = ((baseBuy - 100) / 100) * loanAmount;
        revenue = baseBuyDollars + origFeeBorr + origFeeSeller - cdCredits;
      } else {
        // Fall back to Origination Points when Base Buy is not available
        // Per Qlik: Origination Revenue = Origination Points + Orig Fee Borr Pd + Orig Fees Seller - CD Lender Credits
        revenue = origPoints + origFeeBorr + origFeeSeller - cdCredits;
      }
      
      // Only use fallback estimate if no revenue data at all
      if (revenue !== 0 || origPoints > 0 || origFeeBorr > 0 || origFeeSeller > 0 || baseBuy > 0) {
        return revenue;
      }
      
      // Fallback: estimate revenue as 1% of loan amount (only if no real data)
      return loanAmount * 0.01;
    };

    const calcTurnTime = (l: any): number | null => {
      const appDate = l.application_date;
      const fundDate = l.funding_date || l.closing_date;
      if (!appDate || !fundDate) return null;
      const diffMs = new Date(fundDate).getTime() - new Date(appDate).getTime();
      return Math.round(diffMs / (1000 * 60 * 60 * 24));
    };

    /**
     * Calculate Loan Complexity Score per Qlik Transform.qvs
     * Sum of 8 components: Loan Purpose, Loan Type, Loan Amount, Occupancy, FICO, LTV, DTI, Employment
     */
    const calcLoanComplexity = (l: any): number => {
      let complexity = 0;
      
      // 1. Loan Purpose Complexity
      const loanPurpose = (l.loan_purpose || '').toUpperCase().trim();
      if (loanPurpose.includes('C TO P') || loanPurpose.includes('CONSTRUCTION')) {
        complexity += 0.3;
      } else if (loanPurpose.includes('PURCHASE')) {
        complexity += 0.1;
      } else if (loanPurpose.includes('REFI') && loanPurpose.includes('CO')) {
        complexity += 0.1; // Refi CO (cash out)
      }
      // Refi No CO = 0, default = 0
      
      // 2. Loan Type Complexity
      const loanType = (l.loan_type || '').toUpperCase().trim();
      if (loanType === 'FHA' || loanType.includes('FHA')) {
        complexity += 0.1;
      } else if (loanType === 'VA' || loanType.includes('VA')) {
        complexity += 0.05;
      }
      // Conventional = 0, default = 0
      
      // 3. Loan Amount Complexity (Jumbo >= $1M)
      const loanAmount = parseFloat(l.loan_amount) || 0;
      if (loanAmount >= 1000000) {
        complexity += 0.1;
      }
      
      // 4. Occupancy Complexity
      const occupancy = (l.occupancy_type || '').toUpperCase().trim();
      if (occupancy.includes('SECOND') || occupancy === 'SECONDHOME') {
        complexity += 0.1;
      } else if (occupancy.includes('INVEST') || occupancy === 'INVESTOR') {
        complexity += 0.1;
      }
      // Primary = 0, default = 0
      
      // 5. FICO Complexity (note: excellent FICO reduces complexity)
      const fico = parseInt(l.fico_score) || 0;
      if (fico > 0) {
        if (fico > 760) {
          complexity -= 0.1; // Excellent credit reduces complexity
        } else if (fico > 681) {
          complexity += 0; // Good credit = neutral
        } else if (fico > 620) {
          complexity += 0.05; // Fair credit
        } else {
          complexity += 0.15; // Poor credit
        }
      }
      
      // 6. LTV Complexity (high LTV >= 95%)
      const ltv = parseFloat(l.ltv_ratio) || 0;
      if (ltv >= 95) {
        complexity += 0.05;
      }
      
      // 7. DTI Complexity (high DTI >= 43%)
      const dti = parseFloat(l.be_dti_ratio) || 0;
      if (dti >= 43) {
        complexity += 0.05;
      }
      
      // 8. Employment Complexity (self-employed)
      const selfEmployed = l.borr_self_employed;
      if (selfEmployed === true || selfEmployed === 'Y' || selfEmployed === 'y' || selfEmployed === 'true' || selfEmployed === '1') {
        complexity += 0.2;
      }
      
      return complexity;
    };

    // PHASE 6: Group funded loans by actor and calculate raw metrics
    interface ActorMetrics {
      units: number;
      volume: number;
      revenue: number;
      marginBpsValues: number[]; // Margin (BPS) values per loan for averaging
      concessions: number[];   // Price concessions for concession rating
      turnTimes: number[];
      complexityScores: number[]; // Loan complexity scores per Qlik
      fundedCount: number;
      startedCount: number;
      applicationCount: number;     // Total applications for this actor (for pull-through denominator)
      pullThroughFundedCount: number; // Loans with funding date (for pull-through numerator)
      lostOpportunityUnits: number;
      lostOpportunityRevenue: number;
      deniedUnits: number;
      ficoWeighted: { sum: number; weight: number };
      ltvWeighted: { sum: number; weight: number };
      dtiWeighted: { sum: number; weight: number };
    }

    const actorMap = new Map<string, ActorMetrics>();

    // Count started loans per actor (legacy - kept for compatibility)
    const actorStartedCount = new Map<string, number>();
    startedLoans.forEach((l: any) => {
      const actorName = l[actorColumn];
      if (!actorName || actorName.trim() === '') return;
      actorStartedCount.set(actorName, (actorStartedCount.get(actorName) || 0) + 1);
    });

    // Count applications per actor (for pull-through calculation)
    // Qlik Pull Through formula from Expressions.csv line 1391-1450:
    //   Numerator: Count({<DateType*={'Application'}, Rolling13MonthFlag*={Yes}, [Active Loan Flag]*={No}, 
    //                     [Pull Through Originated Flag]*={Yes}, ...>}[Loan Number])
    //   Denominator: Count({<DateType*={'Application'}, Rolling13MonthFlag*={Yes}, [Active Loan Flag]*={No}, ...>}[Loan Number])
    // Key points:
    //   - BOTH use DateType={'Application'} (application_date) in rolling 13-month window
    //   - BOTH filter by [Active Loan Flag]={No} (inactive loans only)
    //   - Numerator adds [Pull Through Originated Flag]={Yes} (has funding_date)
    const actorApplicationCountForPullThrough = new Map<string, number>();  // Denominator: all inactive loans
    const actorFundedCountForPullThrough = new Map<string, number>();      // Numerator: inactive loans with funding
    
    channelFilteredLoans.forEach((l: any) => {
      const actorName = l[actorColumn];
      if (!actorName || actorName.trim() === '') return;
      
      // Check application date is in the rolling 13-month window
      const appDate = l.application_date;
      if (!appDate) return;
      const ad = new Date(appDate);
      if (ad < effectiveStartDate || ad > effectiveEndDate) return;
      
      // Check if loan is inactive ([Active Loan Flag]={No})
      // Active loans are those still in process - inactive means funded, withdrawn, denied, etc.
      const hasFundingDate = !!l.funding_date;
      const status = (l.current_loan_status || '').toUpperCase();
      const isInactive = hasFundingDate || 
                         status.includes('WITHDRAWN') || status.includes('DENIED') || 
                         status.includes('CANCELLED') || status.includes('DECLINED') ||
                         status.includes('ORIGINATED') || status.includes('PURCHASED');
      
      if (!isInactive) return; // Skip active loans
      
      // Count as application (denominator) - all inactive loans with application_date in range
      actorApplicationCountForPullThrough.set(actorName, (actorApplicationCountForPullThrough.get(actorName) || 0) + 1);
      
      // Count if funded (numerator) - [Pull Through Originated Flag]={Yes} = has funding_date
      if (hasFundingDate) {
        actorFundedCountForPullThrough.set(actorName, (actorFundedCountForPullThrough.get(actorName) || 0) + 1);
      }
    });

    // Count lost opportunity loans per actor
    const actorLostOpportunity = new Map<string, { units: number; revenue: number }>();
    lostOpportunityLoans.forEach((l: any) => {
      const actorName = l[actorColumn];
      if (!actorName || actorName.trim() === '') return;
      
      if (!actorLostOpportunity.has(actorName)) {
        actorLostOpportunity.set(actorName, { units: 0, revenue: 0 });
      }
      const data = actorLostOpportunity.get(actorName)!;
      data.units += 1;
      data.revenue += calcLoanRevenue(l);
    });

    // Count denied loans per actor
    const actorDenied = new Map<string, number>();
    deniedLoans.forEach((l: any) => {
      const actorName = l[actorColumn];
      if (!actorName || actorName.trim() === '') return;
      actorDenied.set(actorName, (actorDenied.get(actorName) || 0) + 1);
    });

    // Process funded loans
    fundedLoans.forEach((l: any) => {
      const actorName = l[actorColumn];
      if (!actorName || actorName.trim() === '') return;

      if (!actorMap.has(actorName)) {
        const lostOpp = actorLostOpportunity.get(actorName) || { units: 0, revenue: 0 };
        actorMap.set(actorName, {
          units: 0,
          volume: 0,
          revenue: 0,
          marginBpsValues: [],
          concessions: [],
          turnTimes: [],
          complexityScores: [],
          fundedCount: 0,
          startedCount: actorStartedCount.get(actorName) || 0,
          applicationCount: actorApplicationCountForPullThrough.get(actorName) || 0,  // Application count for pull-through denominator (inactive loans with app_date in range)
          pullThroughFundedCount: actorFundedCountForPullThrough.get(actorName) || 0,  // Funded count for pull-through numerator (inactive loans with funding_date)
          lostOpportunityUnits: lostOpp.units,
          lostOpportunityRevenue: lostOpp.revenue,
          deniedUnits: actorDenied.get(actorName) || 0,
          ficoWeighted: { sum: 0, weight: 0 },
          ltvWeighted: { sum: 0, weight: 0 },
          dtiWeighted: { sum: 0, weight: 0 },
        });
      }

      const actorData = actorMap.get(actorName)!;
      const loanAmount = parseFloat(l.loan_amount) || 0;
      const revenue = calcLoanRevenue(l);
      const turnTime = calcTurnTime(l);

      actorData.units += 1;
      actorData.volume += loanAmount;
      actorData.revenue += revenue;
      actorData.fundedCount += 1;
      
      // Track Margin (BPS) per loan for Qlik Margin Rating calculation
      // Qlik uses Avg([Margin (BPS)]) per actor, NOT total revenue
      // Margin BPS = (Revenue / Loan Amount) * 10000
      if (loanAmount > 0) {
        const marginBps = (revenue / loanAmount) * 10000;
        actorData.marginBpsValues.push(marginBps);
      }
      
      if (turnTime !== null && turnTime > 0) {
        actorData.turnTimes.push(turnTime);
      }
      
      // Track price concessions from Qlik: Branch Concession ($) = (Branch Concession / 100) * Loan Amount
      // Qlik only uses Branch Concession for TTS calculations (Corporate Concession is loaded but not used)
      // The database stores branch_price_concession as a percentage (e.g., 0.25 = 0.25%)
      const branchConcessionPct = parseFloat(l.branch_price_concession) || 0;
      
      if (branchConcessionPct !== 0 && loanAmount > 0) {
        // Calculate Branch Concession ($): (Branch Concession / 100) * Loan Amount
        const concessionDollars = (branchConcessionPct / 100) * loanAmount;
        actorData.concessions.push(concessionDollars);
      }
      
      // Track loan complexity score per Qlik Transform.qvs
      const complexityScore = calcLoanComplexity(l);
      actorData.complexityScores.push(complexityScore);
      
      // Debug: Log first 3 loans' complexity breakdown
      if (actorMap.size <= 1 && actorData.complexityScores.length <= 3) {
        logInfo('[SalesScorecard] Complexity Debug', {
          loan_id: l.loan_id,
          loan_purpose: l.loan_purpose,
          loan_type: l.loan_type,
          loan_amount: loanAmount,
          occupancy_type: l.occupancy_type,
          fico_score: l.fico_score,
          ltv_ratio: l.ltv_ratio,
          be_dti_ratio: l.be_dti_ratio,
          borr_self_employed: l.borr_self_employed,
          calculated_complexity: complexityScore,
        });
      }

      // Weighted averages
      if (l.fico_score && loanAmount > 0) {
        actorData.ficoWeighted.sum += parseFloat(l.fico_score) * loanAmount;
        actorData.ficoWeighted.weight += loanAmount;
      }
      if (l.ltv_ratio && loanAmount > 0) {
        actorData.ltvWeighted.sum += parseFloat(l.ltv_ratio) * loanAmount;
        actorData.ltvWeighted.weight += loanAmount;
      }
      if (l.be_dti_ratio && loanAmount > 0) {
        actorData.dtiWeighted.sum += parseFloat(l.be_dti_ratio) * loanAmount;
        actorData.dtiWeighted.weight += loanAmount;
      }
    });

    // PHASE 7: Calculate company-wide averages and totals
    const actorCount = actorMap.size;
    
    // Calculate totals for lost opportunity and denied (company-wide)
    const totalLostOpportunityUnits = lostOpportunityLoans.length;
    const totalLostOpportunityRevenue = lostOpportunityLoans.reduce((sum: number, l: any) => sum + calcLoanRevenue(l), 0);
    const totalDeniedUnits = deniedLoans.length;
    
    // Calculate company-wide weighted averages
    let totalFicoWeightedSum = 0, totalFicoWeight = 0;
    let totalLtvWeightedSum = 0, totalLtvWeight = 0;
    let totalDtiWeightedSum = 0, totalDtiWeight = 0;
    
    fundedLoans.forEach((l: any) => {
      const loanAmount = parseFloat(l.loan_amount) || 0;
      if (l.fico_score && loanAmount > 0) {
        totalFicoWeightedSum += parseFloat(l.fico_score) * loanAmount;
        totalFicoWeight += loanAmount;
      }
      if (l.ltv_ratio && loanAmount > 0) {
        totalLtvWeightedSum += parseFloat(l.ltv_ratio) * loanAmount;
        totalLtvWeight += loanAmount;
      }
      if (l.be_dti_ratio && loanAmount > 0) {
        totalDtiWeightedSum += parseFloat(l.be_dti_ratio) * loanAmount;
        totalDtiWeight += loanAmount;
      }
    });

    // Return empty response if no actors found
    if (actorCount === 0) {
      return res.json({
        actors: [],
        companyAverages: { avgLoanAmount: 0, avgRevenue: 0, avgPullThrough: 0, avgTurnTime: 0 },
        weightConfig,
        tierSummary: {
          top: createEmptyTierSummary(),
          second: createEmptyTierSummary(),
          bottom: createEmptyTierSummary(),
        },
        totals: {
          actorCount: 0,
          units: 0,
          volume: 0,
          revenue: 0,
          avgTurnTime: 0,
          pullThrough: 0,
          waFico: 0,
          waLtv: 0,
          waDti: 0,
          lostOpportunityUnits: 0,
          lostOpportunityRevenue: 0,
          deniedUnits: 0,
          avgTtsScore: 0,
          loanComplexityScore: 100,
        },
        dateRange: { startDate: effectiveStartDate.toISOString(), endDate: effectiveEndDate.toISOString() },
      });
    }

    // Aggregate metrics across all actors
    // Qlik Rating Formulas require TOTALS per actor, then average of totals
    let totalUnits = 0;
    let totalVolume = 0;
    let totalRevenue = 0;
    let totalPullThroughSum = 0;
    let pullThroughCount = 0;
    let totalInverseTurnTimeSum = 0; // Sum of (1/turn_time) for Qlik formula
    let turnTimeActorCount = 0;
    let totalConcessionPerActor = 0; // Sum of total concessions per actor
    let concessionActorCount = 0;
    let totalAvgMarginBpsPerActor = 0; // Sum of Avg Margin BPS per actor
    let marginBpsActorCount = 0;

    actorMap.forEach((data) => {
      totalUnits += data.units;
      totalVolume += data.volume;
      totalRevenue += data.revenue;
      
      // Margin BPS per actor - Qlik uses Avg([Margin (BPS)]) per actor
      // vScorecardMarginAvg = Avg(Aggr(Avg([Margin (BPS)]), Actor))
      if (data.marginBpsValues.length > 0) {
        const avgMarginBps = data.marginBpsValues.reduce((a, b) => a + b, 0) / data.marginBpsValues.length;
        totalAvgMarginBpsPerActor += avgMarginBps;
        marginBpsActorCount++;
      }
      
      // Pull-through per actor (percentage)
      const actorPullThrough = data.startedCount > 0 
        ? (data.fundedCount / data.startedCount) * 100 
        : 0;
      if (actorPullThrough > 0) {
        totalPullThroughSum += actorPullThrough;
        pullThroughCount++;
      }
      
      // Turn time per actor - Qlik uses INVERSE: Pow(TurnTime, -1)
      // vCCA_ScorecardTurnTimeAvg = Avg(Aggr(Pow([Scorecard TurnTime], -1), Actor))
      if (data.turnTimes.length > 0) {
        const avgTurnTime = data.turnTimes.reduce((a, b) => a + b, 0) / data.turnTimes.length;
        if (avgTurnTime > 0) {
          totalInverseTurnTimeSum += 1 / avgTurnTime; // Inverse for Qlik formula
        }
        turnTimeActorCount++;
      }
      
      // Concession per actor - use TOTAL concession for this actor
      if (data.concessions.length > 0) {
        const totalActorConcession = data.concessions.reduce((a, b) => a + b, 0);
        totalConcessionPerActor += totalActorConcession;
        concessionActorCount++;
      }
    });

    // Calculate company-wide averages PER ACTOR (not per loan) for ratings
    // Qlik formulas: Rating = (Actor Value / Avg Actor Value) × 100
    const avgUnitsPerActor = actorCount > 0 ? totalUnits / actorCount : 0;
    const avgVolumePerActor = actorCount > 0 ? totalVolume / actorCount : 0;
    const avgRevenuePerActor = actorCount > 0 ? totalRevenue / actorCount : 0;
    const avgConcessionPerActor = concessionActorCount > 0 ? totalConcessionPerActor / concessionActorCount : 0;
    const avgInverseTurnTime = turnTimeActorCount > 0 ? totalInverseTurnTimeSum / turnTimeActorCount : 1/30;
    const avgPullThroughPerActor = pullThroughCount > 0 ? totalPullThroughSum / pullThroughCount : 70;
    // Margin BPS average: Avg of (Avg Margin BPS per actor) across all actors
    const avgMarginBpsPerActor = marginBpsActorCount > 0 ? totalAvgMarginBpsPerActor / marginBpsActorCount : 100;

    const companyAverages = {
      // For Rating calculations (per-actor totals)
      avgUnitsPerActor,        // Avg units per actor
      avgVolumePerActor,       // Avg total volume per actor
      avgRevenuePerActor,      // Avg total revenue per actor (kept for display)
      avgMarginBpsPerActor,    // Avg of Avg Margin BPS per actor (for Margin Rating)
      avgConcessionPerActor,   // Avg total concession per actor
      avgPullThrough: avgPullThroughPerActor, // Avg pull-through % per actor
      avgInverseTurnTime,      // Avg of (1/turn_time) per actor - for Qlik inverse formula
      // For display (per-loan averages)
      avgLoanAmount: totalUnits > 0 ? totalVolume / totalUnits : 0,
      avgRevenue: totalUnits > 0 ? totalRevenue / totalUnits : 0,
    };

    // Company-wide pull-through
    const companyPullThrough = startedLoans.length > 0 
      ? (fundedLoans.length / startedLoans.length) * 100 
      : 0;

    // Company-wide average turn time
    const companyTurnTimes = fundedLoans
      .map((l: any) => calcTurnTime(l))
      .filter((t): t is number => t !== null && t > 0);
    const companyAvgTurnTime = companyTurnTimes.length > 0 
      ? companyTurnTimes.reduce((a, b) => a + b, 0) / companyTurnTimes.length 
      : 30;

    logInfo('[SalesScorecard] Company averages', companyAverages);

    // PHASE 8: Calculate TTS score for each actor
    interface ActorScore {
      name: string;
      units: number;
      volume: number;
      revenue: number;
      revenueBps: number;
      pullThrough: number;
      avgTurnTime: number;
      waFico: number;
      waLtv: number;
      waDti: number;
      lostOpportunityUnits: number;
      lostOpportunityRevenue: number;
      deniedUnits: number;
      ttsScore: number;
      avgComplexity: number; // Loan complexity score per Qlik Transform.qvs
      tier: 'top' | 'second' | 'bottom';
    }

    const actorScores: ActorScore[] = [];

    actorMap.forEach((data, name) => {
      // Calculate actor's values for ratings
      // Pull Through per Qlik Expressions.csv line 1391-1450:
      //   = Count({DateType={'Application'}, Rolling13MonthFlag={Yes}, [Active Loan Flag]={No}, [Pull Through Originated Flag]={Yes}})
      //     / Count({DateType={'Application'}, Rolling13MonthFlag={Yes}, [Active Loan Flag]={No}})
      // Both use application_date in rolling 13-month window, filter inactive loans only
      // Numerator: inactive loans with funding_date ([Pull Through Originated Flag]={Yes})
      // Denominator: all inactive loans with application_date in range
      const actorPullThrough = data.applicationCount > 0 
        ? (data.pullThroughFundedCount / data.applicationCount) * 100 
        : companyAverages.avgPullThrough;
      const actorAvgTurnTime = data.turnTimes.length > 0 
        ? data.turnTimes.reduce((a, b) => a + b, 0) / data.turnTimes.length 
        : 0;
      const actorTotalConcession = data.concessions.length > 0
        ? data.concessions.reduce((a, b) => a + b, 0)
        : 0;

      // Calculate all 6 ratings per Qlik TTS Formula Documentation
      // Qlik ratings use TOTALS per actor compared to AVG TOTALS across actors
      // Rating = (Actor Total Value / Avg Total Value Per Actor) × 100
      // A rating of 100 = average performance
      
      // 1. Unit Rating: Actor's total units vs avg units per actor
      // Qlik: [Scorecard Output Units] / vScorecardUnitsAverage * 100
      const unitRating = companyAverages.avgUnitsPerActor > 0 
        ? (data.units / companyAverages.avgUnitsPerActor) * 100 
        : 100;
      
      // 2. Volume Rating: Actor's TOTAL volume vs avg TOTAL volume per actor
      // Qlik: [CCA Scorecard Volume] / vCCA_ScorecardVolumeAvg * 100
      // [CCA Scorecard Volume] = Sum of Loan Amount for the actor
      const volumeRating = companyAverages.avgVolumePerActor > 0 
        ? (data.volume / companyAverages.avgVolumePerActor) * 100 
        : 100;
      
      // 3. Margin Rating: Actor's TOTAL revenue dollars vs avg TOTAL revenue per actor
      // From TTS_FORMULA_FINDINGS.md: Uses Revenue in DOLLARS, not BPS
      // Qlik: [CCA Scorecard Margin $] / vCCA_ScorecardMarginAvg * 100
      // [CCA Scorecard Margin $] = Sum([Revenue]) per actor
      const marginRating = companyAverages.avgRevenuePerActor > 0 
        ? (data.revenue / companyAverages.avgRevenuePerActor) * 100 
        : 100;
      
      // 4. Concession Rating: Actor's TOTAL concession vs avg TOTAL concession per actor
      const concessionRating = companyAverages.avgConcessionPerActor > 0 
        ? (actorTotalConcession / companyAverages.avgConcessionPerActor) * 100 
        : 100;
      
      // 5. Pull-Through Rating: Actor's pull-through % vs avg pull-through %
      // Qlik: [CCA Scorecard PullThrough] / vCCA_ScorecardPullThroughAvg * 100
      const pullThroughRating = companyAverages.avgPullThrough > 0 
        ? (actorPullThrough / companyAverages.avgPullThrough) * 100 
        : 100;
      
      // 6. Turn Time Rating: Uses INVERSE formula (shorter time = better rating)
      // Qlik: Pow([CCA Scorecard TurnTime], -1) / vCCA_ScorecardTurnTimeAvg * 100
      // Where vCCA_ScorecardTurnTimeAvg = Avg(Aggr(Pow([Scorecard TurnTime], -1), Actor))
      // Actor Rating = (1/ActorTurnTime) / Avg(1/AllActorTurnTimes) * 100
      const actorInverseTurnTime = actorAvgTurnTime > 0 ? 1 / actorAvgTurnTime : 0;
      const turnTimeRating = companyAverages.avgInverseTurnTime > 0 && actorInverseTurnTime > 0
        ? (actorInverseTurnTime / companyAverages.avgInverseTurnTime) * 100 
        : 100;

      // Calculate TTS score using Qlik's eCCA_TVI_Score_13_Months formula (6 components, NO compound scaling)
      // From TTS_FORMULA_FINDINGS.md: Compound scaling is COMMENTED OUT in Qlik
      // TTS = (VolumeRating×VolumeWeight + MarginRating×MarginWeight + TurnTimeRating×TurnTimeWeight
      //        + PullThroughRating×PullThroughWeight + UnitRating×UnitWeight + ConcessionRating×ConcessionWeight)
      //      / totalWeight
      // Concession is conditional via Pick(vCCA_ScorecardIncludeConcession, 0, value)
      const concessionComponent = includeConcession 
        ? concessionRating * weightConfig.concession 
        : 0;
      
      const ttsScore = (
        volumeRating * weightConfig.volume +
        marginRating * weightConfig.margin +
        turnTimeRating * weightConfig.turnTime +           // NO compound scaling (commented out in Qlik)
        pullThroughRating * weightConfig.pullThrough +     // NO compound scaling (commented out in Qlik)
        unitRating * weightConfig.unit +
        concessionComponent
      ) / totalWeight;

      // Calculate weighted averages
      const waFico = data.ficoWeighted.weight > 0 
        ? data.ficoWeighted.sum / data.ficoWeighted.weight 
        : 0;
      const waLtv = data.ltvWeighted.weight > 0 
        ? data.ltvWeighted.sum / data.ltvWeighted.weight 
        : 0;
      const waDti = data.dtiWeighted.weight > 0 
        ? data.dtiWeighted.sum / data.dtiWeighted.weight 
        : 0;

      // Revenue in basis points
      const revenueBps = data.volume > 0 
        ? (data.revenue / data.volume) * 10000 
        : 0;
      
      // Average loan complexity for this actor
      // Raw complexity is 0.0 to ~0.6, but Qlik displays as: (1 + rawComplexity) * 100
      // So 0.14 raw → 114.0 displayed
      const rawAvgComplexity = data.complexityScores.length > 0
        ? data.complexityScores.reduce((sum, c) => sum + c, 0) / data.complexityScores.length
        : 0;
      const avgComplexity = (1 + rawAvgComplexity) * 100;

      actorScores.push({
        name,
        units: data.units,
        volume: data.volume,
        revenue: data.revenue,
        revenueBps,
        pullThrough: actorPullThrough,
        avgTurnTime: actorAvgTurnTime,
        waFico,
        waLtv,
        waDti,
        lostOpportunityUnits: data.lostOpportunityUnits,
        lostOpportunityRevenue: data.lostOpportunityRevenue,
        deniedUnits: data.deniedUnits,
        ttsScore,
        avgComplexity,
        tier: 'top', // Will be assigned below
      });
    });

    // PHASE 9: Assign tiers based on TTS SCORE THRESHOLDS (from Qlik vCCA_TVI_13MonthTiersDim)
    // - Top Tier: TTS >= 120
    // - Second Tier: TTS >= 80 (and < 120)
    // - Bottom Tier: TTS < 80
    // Filter out LOs with 0 units (no production) - they shouldn't be in the scorecard
    const actorsWithProduction = actorScores.filter(a => a.units > 0);
    actorsWithProduction.sort((a, b) => b.ttsScore - a.ttsScore);

    actorsWithProduction.forEach((actor) => {
      if (actor.ttsScore >= 120) {
        actor.tier = 'top';
      } else if (actor.ttsScore >= 80) {
        actor.tier = 'second';
      } else {
        actor.tier = 'bottom';
      }
    });

    // PHASE 10: Calculate tier summaries
    function createEmptyTierSummary() {
      return {
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
        lostOpportunityUnits: 0,
        lostOpportunityRevenue: 0,
        deniedUnits: 0,
        avgLoRevenue: 0,
        avgLoUnits: 0,
        avgTtsScore: 0,
        loanComplexityScore: 0,
      };
    }

    function calcTierSummary(tierActors: ActorScore[]) {
      if (tierActors.length === 0) return createEmptyTierSummary();
      
      const tierUnits = tierActors.reduce((sum, a) => sum + a.units, 0);
      const tierVolume = tierActors.reduce((sum, a) => sum + a.volume, 0);
      const tierRevenue = tierActors.reduce((sum, a) => sum + a.revenue, 0);
      const tierLostUnits = tierActors.reduce((sum, a) => sum + a.lostOpportunityUnits, 0);
      const tierLostRevenue = tierActors.reduce((sum, a) => sum + a.lostOpportunityRevenue, 0);
      const tierDenied = tierActors.reduce((sum, a) => sum + a.deniedUnits, 0);
      
      // Weighted averages for the tier
      let tierFicoSum = 0, tierFicoWeight = 0;
      let tierLtvSum = 0, tierLtvWeight = 0;
      let tierDtiSum = 0, tierDtiWeight = 0;
      
      tierActors.forEach(a => {
        if (a.waFico > 0 && a.volume > 0) {
          tierFicoSum += a.waFico * a.volume;
          tierFicoWeight += a.volume;
        }
        if (a.waLtv > 0 && a.volume > 0) {
          tierLtvSum += a.waLtv * a.volume;
          tierLtvWeight += a.volume;
        }
        if (a.waDti > 0 && a.volume > 0) {
          tierDtiSum += a.waDti * a.volume;
          tierDtiWeight += a.volume;
        }
      });

      // Average turn time and pull-through for tier
      const tierTurnTimes = tierActors.filter(a => a.avgTurnTime > 0);
      const avgTurnTime = tierTurnTimes.length > 0 
        ? tierTurnTimes.reduce((sum, a) => sum + a.avgTurnTime, 0) / tierTurnTimes.length 
        : 0;
      
      const tierPullThroughs = tierActors.filter(a => a.pullThrough > 0);
      const avgPullThrough = tierPullThroughs.length > 0 
        ? tierPullThroughs.reduce((sum, a) => sum + a.pullThrough, 0) / tierPullThroughs.length 
        : 0;
      
      // Average loan complexity for tier (weighted by units)
      // Note: avgComplexity already has the (1 + raw) * 100 formula applied
      const tierComplexityActors = tierActors.filter((a: any) => a.avgComplexity !== undefined && a.avgComplexity > 0);
      const tierAvgComplexity = tierComplexityActors.length > 0
        ? tierComplexityActors.reduce((sum: number, a: any) => sum + (a.avgComplexity * a.units), 0) / tierUnits
        : 100; // Default to 100 (which is (1 + 0) * 100)

      return {
        count: tierActors.length,
        units: tierUnits,
        unitsPercent: totalUnits > 0 ? (tierUnits / totalUnits) * 100 : 0,
        volume: tierVolume,
        volumePercent: totalVolume > 0 ? (tierVolume / totalVolume) * 100 : 0,
        revenue: tierRevenue,
        revenueBps: tierVolume > 0 ? (tierRevenue / tierVolume) * 10000 : 0,
        avgTurnTime,
        pullThrough: avgPullThrough,
        waFico: tierFicoWeight > 0 ? tierFicoSum / tierFicoWeight : 0,
        waLtv: tierLtvWeight > 0 ? tierLtvSum / tierLtvWeight : 0,
        waDti: tierDtiWeight > 0 ? tierDtiSum / tierDtiWeight : 0,
        lostOpportunityUnits: tierLostUnits,
        lostOpportunityRevenue: tierLostRevenue,
        deniedUnits: tierDenied,
        avgLoRevenue: tierActors.length > 0 ? tierRevenue / tierActors.length : 0,
        avgLoUnits: tierActors.length > 0 ? tierUnits / tierActors.length : 0,
        avgTtsScore: tierActors.length > 0 
          ? tierActors.reduce((sum, a) => sum + a.ttsScore, 0) / tierActors.length 
          : 0,
        loanComplexityScore: tierAvgComplexity,
      };
    }

    const tierSummary = {
      top: calcTierSummary(actorsWithProduction.filter(a => a.tier === 'top')),
      second: calcTierSummary(actorsWithProduction.filter(a => a.tier === 'second')),
      bottom: calcTierSummary(actorsWithProduction.filter(a => a.tier === 'bottom')),
    };

    logInfo('[SalesScorecard] TTS Results', {
      actorCount: actorsWithProduction.length,  // Only count LOs with production
      tierCounts: {
        top: tierSummary.top.count,
        second: tierSummary.second.count,
        bottom: tierSummary.bottom.count,
      },
      topActors: actorsWithProduction.slice(0, 3).map(a => ({ name: a.name, ttsScore: a.ttsScore.toFixed(1), tier: a.tier })),
    });

    // Calculate company-wide totals
    // Average complexity weighted by units across all actors
    // Note: avgComplexity already has the (1 + raw) * 100 formula applied
    const complexityActors = actorsWithProduction.filter((a: any) => a.avgComplexity > 0);
    const totalComplexityWeighted = complexityActors.reduce((sum: number, a: any) => 
      sum + (a.avgComplexity * a.units), 0);
    const avgComplexityTotal = totalUnits > 0 ? totalComplexityWeighted / totalUnits : 100;
    
    const totals = {
      actorCount: actorsWithProduction.length,  // Use filtered count
      units: totalUnits,
      volume: totalVolume,
      revenue: totalRevenue,
      revenueBps: totalVolume > 0 ? (totalRevenue / totalVolume) * 10000 : 0,
      avgTurnTime: companyAvgTurnTime,
      pullThrough: companyPullThrough,
      waFico: totalFicoWeight > 0 ? totalFicoWeightedSum / totalFicoWeight : 0,
      waLtv: totalLtvWeight > 0 ? totalLtvWeightedSum / totalLtvWeight : 0,
      waDti: totalDtiWeight > 0 ? totalDtiWeightedSum / totalDtiWeight : 0,
      lostOpportunityUnits: totalLostOpportunityUnits,
      lostOpportunityRevenue: totalLostOpportunityRevenue,
      deniedUnits: totalDeniedUnits,
      avgLoRevenue: actorsWithProduction.length > 0 ? totalRevenue / actorsWithProduction.length : 0,
      avgLoUnits: actorsWithProduction.length > 0 ? totalUnits / actorsWithProduction.length : 0,
      avgTtsScore: actorsWithProduction.length > 0 
        ? actorsWithProduction.reduce((sum, a) => sum + a.ttsScore, 0) / actorsWithProduction.length 
        : 0,
      loanComplexityScore: avgComplexityTotal,
    };

    res.json({
      actors: actorsWithProduction,  // Only include LOs with production (units > 0)
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
