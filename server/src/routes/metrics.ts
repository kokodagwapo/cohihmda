/**
 * Metrics API Routes
 * RESTful endpoints for querying metrics from the metrics catalog
 * Supports date ranges, filtering, and RAG agent access
 */

import { Router } from 'express';
import { authenticateToken, AuthRequest } from '../middleware/auth.js';
import { attachTenantContext, getTenantContext } from '../middleware/tenantContext.js';
import { queryMetric, queryMetrics, queryMetricsByCategory, queryMetricsGroupedBy, getMetricsCatalog, DateRange, queryFicoDistribution, queryLtvDistribution, queryDtiDistribution, queryLoanMix, queryCreditRiskStory, DistributionBucket, LoanMixRow, CreditRiskStoryData } from '../services/metrics/metricsService.js';
import { explainMetric, explainMetricResult, chatAboutMetrics, getStaticMetricDescriptions, MetricChatMessage } from '../services/metrics/metricsAiService.js';
import { apiLimiter } from '../middleware/rateLimiter.js';
import { pool } from '../config/database.js';
import { getLoanAccessContext } from '../services/userLoanAccessService.js';

/**
 * Helper to get tenant_id - from query param or user's profile
 */
async function resolveTenantId(req: AuthRequest): Promise<string | undefined> {
  // First check query param
  if (req.query.tenant_id) {
    console.log(`[Metrics] Using tenant_id from query param: ${req.query.tenant_id}`);
    return req.query.tenant_id as string;
  }
  
  // Fall back to user's own tenant from profiles table
  try {
    const result = await pool.query(
      'SELECT tenant_id FROM public.profiles WHERE user_id = $1',
      [req.userId]
    );
    const tenantId = result.rows[0]?.tenant_id;
    if (tenantId) {
      console.log(`[Metrics] Using tenant_id from user profile: ${tenantId}`);
      return tenantId;
    }
    console.log(`[Metrics] No tenant_id found in profiles for user ${req.userId}`);
    return undefined;
  } catch (error) {
    console.log('[Metrics] Error getting tenant from profile:', error);
    return undefined;
  }
}

const router = Router();

/**
 * GET /api/metrics/catalog
 * Get list of all available metrics
 */
router.get('/catalog', authenticateToken, apiLimiter, async (req: AuthRequest, res) => {
  try {
    const catalog = getMetricsCatalog().map(m => ({
      id: m.id,
      name: m.name,
      description: m.description,
      category: m.category,
      qlikFormula: m.qlikFormula,
      sqlQuery: m.sqlQuery,
      defaultDateField: m.defaultDateField
    }));
    
    res.json({ metrics: catalog });
  } catch (error: any) {
    console.error('[Metrics] Error fetching catalog:', error);
    res.status(500).json({ error: 'Failed to fetch metrics catalog' });
  }
});

/**
 * GET /api/metrics/:metricId
 * Query a single metric
 * Query params: startDate, endDate (ISO strings), dateField (optional)
 * Respects user-level loan access filtering
 */
router.get('/:metricId', authenticateToken, attachTenantContext, apiLimiter, async (req: AuthRequest, res) => {
  try {
    const { metricId } = req.params;
    const tenantPool = getTenantContext(req).tenantPool;
    
    // Get user's loan access context
    const accessCtx = await getLoanAccessContext(req, tenantPool);
    
    // If user has no access, return zero metric
    if (accessCtx.hasNoAccess) {
      return res.json({
        metricId,
        value: 0,
        metadata: { accessFiltered: true, noAccess: true }
      });
    }
    
    // Parse date range from query params - keep as strings to avoid timezone issues
    const dateRange: DateRange | undefined = req.query.startDate || req.query.endDate
      ? {
          start: (req.query.startDate as string) || null,
          end: (req.query.endDate as string) || null
        }
      : undefined;
    
    const dateField = req.query.dateField as string | undefined;
    
    // Parse additional filters from query params
    const additionalFilters: Record<string, any> = {};
    if (req.query.loan_type) additionalFilters.loan_type = req.query.loan_type;
    if (req.query.branch) additionalFilters.branch = req.query.branch;
    if (req.query.loan_officer_id) additionalFilters.loan_officer_id = req.query.loan_officer_id;
    if (req.query.status) additionalFilters.status = req.query.status;
    
    const result = await queryMetric(tenantPool, metricId, { 
      dateRange, 
      dateField,
      additionalFilters: Object.keys(additionalFilters).length > 0 ? additionalFilters : undefined,
      userAccessFilter: accessCtx.getFilter('l')
    });
    res.json(result);
  } catch (error: any) {
    console.error(`[Metrics] Error querying metric ${req.params.metricId}:`, error);
    res.status(500).json({ error: error.message || 'Failed to query metric' });
  }
});

/**
 * POST /api/metrics/query
 * Query multiple metrics in a single call
 * Body: { metricIds: string[], dateRange?: { start?: string, end?: string }, dateField?: string, groupBy?: string, additionalFilters?: object }
 * Respects user-level loan access filtering
 */
router.post('/query', authenticateToken, attachTenantContext, apiLimiter, async (req: AuthRequest, res) => {
  try {
    const { metricIds, dateRange, dateField, groupBy, additionalFilters } = req.body;
    const tenantPool = getTenantContext(req).tenantPool;
    
    // Get user's loan access context
    const accessCtx = await getLoanAccessContext(req, tenantPool);
    
    // If user has no access, return empty/zero metrics
    if (accessCtx.hasNoAccess) {
      const emptyResults: Record<string, any> = {};
      for (const id of (metricIds || [])) {
        emptyResults[id] = { metricId: id, value: 0, metadata: { accessFiltered: true, noAccess: true } };
      }
      return res.json({ metrics: emptyResults, accessFiltered: true });
    }
    
    if (!Array.isArray(metricIds) || metricIds.length === 0) {
      return res.status(400).json({ error: 'metricIds must be a non-empty array' });
    }
    
    // Pass date range as strings (YYYY-MM-DD format) - don't convert to Date objects
    // to avoid timezone issues when PostgreSQL compares timestamps
    const parsedDateRange: DateRange | undefined = dateRange
      ? {
          start: dateRange.start || null,
          end: dateRange.end || null
        }
      : undefined;
    
    // Debug logging to trace date range issues
    console.log('[Metrics POST /query] Request:', {
      metricIds: metricIds.slice(0, 3).join(', ') + (metricIds.length > 3 ? '...' : ''),
      dateRange: dateRange,
      parsedDateRange: parsedDateRange,
      groupBy,
      additionalFilters,
      hasAccessFilter: accessCtx.requiresFiltering
    });
    
    const options = { 
      dateRange: parsedDateRange, 
      dateField,
      additionalFilters,
      userAccessFilter: accessCtx.getFilter('l')
    };
    
    // If groupBy is specified, return grouped results
    if (groupBy) {
      const allowedGroupBy = ['branch', 'loan_officer', 'channel', 'loan_type', 'loan_purpose', 'occupancy_type', 'processor', 'underwriter', 'investor'];
      if (!allowedGroupBy.includes(groupBy)) {
        return res.status(400).json({ error: `Invalid groupBy. Allowed: ${allowedGroupBy.join(', ')}` });
      }
      
      const groupedResults = await queryMetricsGroupedBy(tenantPool, metricIds, groupBy as any, options);
      return res.json({ metrics: groupedResults, groupedBy: groupBy });
    }
    
    // Non-grouped query (existing behavior)
    const results = await queryMetrics(tenantPool, metricIds, options);
    res.json({ metrics: results });
  } catch (error: any) {
    console.error('[Metrics] Error querying metrics:', error);
    res.status(500).json({ error: error.message || 'Failed to query metrics' });
  }
});

/**
 * GET /api/metrics/category/:category
 * Query all metrics in a category
 * Query params: startDate, endDate (ISO strings), dateField (optional)
 * Respects user-level loan access filtering
 */
router.get('/category/:category', authenticateToken, attachTenantContext, apiLimiter, async (req: AuthRequest, res) => {
  try {
    const { category } = req.params;
    const tenantPool = getTenantContext(req).tenantPool;
    
    // Get user's loan access context
    const accessCtx = await getLoanAccessContext(req, tenantPool);
    
    // If user has no access, return empty metrics
    if (accessCtx.hasNoAccess) {
      return res.json({ metrics: {}, accessFiltered: true, noAccess: true });
    }
    
    // Parse date range from query params - keep as strings to avoid timezone issues
    const dateRange: DateRange | undefined = req.query.startDate || req.query.endDate
      ? {
          start: (req.query.startDate as string) || null,
          end: (req.query.endDate as string) || null
        }
      : undefined;
    
    const dateField = req.query.dateField as string | undefined;
    
    // Parse additional filters from query params
    const additionalFilters: Record<string, any> = {};
    if (req.query.loan_type) additionalFilters.loan_type = req.query.loan_type;
    if (req.query.branch) additionalFilters.branch = req.query.branch;
    if (req.query.loan_officer_id) additionalFilters.loan_officer_id = req.query.loan_officer_id;
    if (req.query.status) additionalFilters.status = req.query.status;
    
    const results = await queryMetricsByCategory(tenantPool, category, { 
      dateRange,
      userAccessFilter: accessCtx.getFilter('l'), 
      dateField,
      additionalFilters: Object.keys(additionalFilters).length > 0 ? additionalFilters : undefined
    });
    res.json({ metrics: results });
  } catch (error: any) {
    console.error(`[Metrics] Error querying category ${req.params.category}:`, error);
    res.status(500).json({ error: error.message || 'Failed to query category metrics' });
  }
});

// ============== Credit Risk Distribution Endpoints ==============

/**
 * POST /api/metrics/distributions
 * Query all three distributions (FICO, LTV, DTI) in a single call
 * Body: { dateRange?: { start?: string, end?: string }, dateField?: string, additionalFilters?: object }
 */
router.post('/distributions', authenticateToken, attachTenantContext, apiLimiter, async (req: AuthRequest, res) => {
  try {
    const { dateRange, dateField, additionalFilters } = req.body;
    const tenantPool = getTenantContext(req).tenantPool;
    
    const parsedDateRange = dateRange
      ? { start: dateRange.start || null, end: dateRange.end || null }
      : undefined;
    
    const options = { dateRange: parsedDateRange, dateField, additionalFilters };
    
    // Query all three distributions in parallel
    const [ficoDistribution, ltvDistribution, dtiDistribution] = await Promise.all([
      queryFicoDistribution(tenantPool, options),
      queryLtvDistribution(tenantPool, options),
      queryDtiDistribution(tenantPool, options)
    ]);
    
    res.json({
      ficoDistribution,
      ltvDistribution,
      dtiDistribution
    });
  } catch (error: any) {
    console.error('[Metrics] Error querying distributions:', error);
    res.status(500).json({ error: error.message || 'Failed to query distributions' });
  }
});

/**
 * POST /api/metrics/loan-mix
 * Query Loan Mix data grouped by dimension
 * Body: { groupBy: 'loan_type' | 'loan_purpose' | 'occupancy_type', dateRange?: { start?: string, end?: string }, dateField?: string, additionalFilters?: object }
 */
router.post('/loan-mix', authenticateToken, attachTenantContext, apiLimiter, async (req: AuthRequest, res) => {
  try {
    const { groupBy, dateRange, dateField, additionalFilters } = req.body;
    const tenantPool = getTenantContext(req).tenantPool;
    
    const allowedGroupBy = ['loan_type', 'loan_purpose', 'occupancy_type'];
    if (!groupBy || !allowedGroupBy.includes(groupBy)) {
      return res.status(400).json({ error: `groupBy is required. Allowed: ${allowedGroupBy.join(', ')}` });
    }
    
    const parsedDateRange = dateRange
      ? { start: dateRange.start || null, end: dateRange.end || null }
      : undefined;
    
    const options = { dateRange: parsedDateRange, dateField, additionalFilters };
    
    const loanMix = await queryLoanMix(tenantPool, groupBy as any, options);
    
    res.json({ loanMix, groupedBy: groupBy });
  } catch (error: any) {
    console.error('[Metrics] Error querying loan mix:', error);
    res.status(500).json({ error: error.message || 'Failed to query loan mix' });
  }
});

/**
 * POST /api/metrics/credit-risk
 * Combined Credit Risk data endpoint - fetches KPIs, distributions, and all loan mix tables
 * Body: { dateRange?: { start?: string, end?: string }, dateField?: string, additionalFilters?: object, applicationType?: string }
 */
router.post('/credit-risk', authenticateToken, attachTenantContext, apiLimiter, async (req: AuthRequest, res) => {
  try {
    const { dateRange, dateField, additionalFilters, applicationType } = req.body;
    const tenantPool = getTenantContext(req).tenantPool;
    
    // Handle application type filter - maps to Qlik's DateType field
    // 'Applications Taken' -> DateType={'Application'} -> application_date
    // 'Funded Production' -> DateType={'Funding'} -> funding_date
    // 'Lost Opportunities' -> [Withdrawn Flag]={1} with ANY date in range (Qlik associative model)
    // 'All Loans' -> DateType={'Started'} -> started_date
    let effectiveDateField = dateField || 'application_date';
    let effectiveFilters = { ...additionalFilters };
    
    if (applicationType === 'Funded Production') {
      effectiveDateField = 'funding_date';
    } else if (applicationType === 'Lost Opportunities') {
      // Credit Risk Management Lost Opportunities:
      // Qlik uses [Withdrawn Flag]={1},[$(vToDate)]={'Yes'} without specifying DateType
      // In Qlik's associative model, this means loans with Withdrawn Flag=1 where ANY date is in range
      // We need to check ALL date fields with OR logic to replicate this behavior
      effectiveDateField = 'any_date'; // Special flag to trigger multi-date filtering
      effectiveFilters.withdrawn_filter = true;
    } else if (applicationType === 'All Loans') {
      effectiveDateField = 'started_date';
    }
    
    const parsedDateRange = dateRange
      ? { start: dateRange.start || null, end: dateRange.end || null }
      : undefined;
    
    const options = { 
      dateRange: parsedDateRange, 
      dateField: effectiveDateField, 
      additionalFilters: effectiveFilters 
    };
    
    // KPI metric IDs
    const kpiMetricIds = ['total_units', 'total_volume', 'wac', 'wa_fico', 'wa_ltv', 'wa_dti'];
    
    // Fetch all data in parallel
    const [kpiResults, ficoDistribution, ltvDistribution, dtiDistribution, loanMixByType, loanMixByPurpose, loanMixByOccupancy, storyData] = await Promise.all([
      queryMetrics(tenantPool, kpiMetricIds, options),
      queryFicoDistribution(tenantPool, options),
      queryLtvDistribution(tenantPool, options),
      queryDtiDistribution(tenantPool, options),
      queryLoanMix(tenantPool, 'loan_type', options),
      queryLoanMix(tenantPool, 'loan_purpose', options),
      queryLoanMix(tenantPool, 'occupancy_type', options),
      queryCreditRiskStory(tenantPool, options)
    ]);
    
    // Transform KPI results to a simple object
    // queryMetrics returns Record<string, MetricResult>, not an array
    const kpis: Record<string, number> = {};
    Object.entries(kpiResults).forEach(([metricId, result]) => {
      kpis[metricId] = typeof result.value === 'number' ? result.value : parseFloat(result.value as string) || 0;
    });
    
    // Calculate largest categories from loan mix data (by VOLUME - matches Qlik!)
    // Qlik uses Sum([Loan Amount]) to find the largest category, not Count([Loan Number])
    const findLargestByVolume = (rows: LoanMixRow[]) => {
      if (!rows || rows.length === 0) return { category: 'N/A', volumePercent: 0 };
      const sorted = [...rows].sort((a, b) => b.volume - a.volume);
      return { category: sorted[0].category, volumePercent: sorted[0].volumePercent };
    };
    
    // Build complete story data
    const creditRiskStory = {
      largestLoanType: findLargestByVolume(loanMixByType),
      largestLoanPurpose: findLargestByVolume(loanMixByPurpose),
      largestOccupancy: findLargestByVolume(loanMixByOccupancy),
      conventionalQualifiedPercent: storyData.conventionalQualifiedPercent,
      governmentQualifiedPercent: storyData.governmentQualifiedPercent
    };
    
    res.json({
      kpis,
      ficoDistribution,
      ltvDistribution,
      dtiDistribution,
      loanMixByType,
      loanMixByPurpose,
      loanMixByOccupancy,
      creditRiskStory,
      filters: {
        dateRange: parsedDateRange,
        dateField: effectiveDateField,
        applicationType
      }
    });
  } catch (error: any) {
    console.error('[Metrics] Error querying credit risk data:', error);
    res.status(500).json({ error: error.message || 'Failed to query credit risk data' });
  }
});

// ============== AI-Powered Metrics Endpoints ==============

/**
 * GET /api/metrics/ai/descriptions
 * Get static natural language descriptions for all metrics (no API call required)
 */
router.get('/ai/descriptions', authenticateToken, apiLimiter, async (req: AuthRequest, res) => {
  try {
    const descriptions = getStaticMetricDescriptions();
    res.json({ descriptions });
  } catch (error: any) {
    console.error('[Metrics] Error fetching descriptions:', error);
    res.status(500).json({ error: 'Failed to fetch metric descriptions' });
  }
});

/**
 * POST /api/metrics/ai/explain
 * Get AI-powered explanation of a metric
 * Body: { metricId: string }
 */
router.post('/ai/explain', authenticateToken, apiLimiter, async (req: AuthRequest, res) => {
  try {
    const { metricId } = req.body;
    const tenantId = await resolveTenantId(req);
    
    if (!metricId) {
      return res.status(400).json({ error: 'metricId is required' });
    }
    
    console.log(`[Metrics AI] Explaining metric ${metricId} for tenant ${tenantId}`);
    const explanation = await explainMetric(metricId, tenantId);
    res.json({ explanation });
  } catch (error: any) {
    console.error(`[Metrics] Error explaining metric:`, error);
    res.status(500).json({ error: error.message || 'Failed to explain metric' });
  }
});

/**
 * POST /api/metrics/ai/explain-result
 * Get AI-powered explanation of a specific metric result
 * Body: { metricId: string, value: number | string, metadata?: object }
 */
router.post('/ai/explain-result', authenticateToken, apiLimiter, async (req: AuthRequest, res) => {
  try {
    const { metricId, value, metadata } = req.body;
    const tenantId = await resolveTenantId(req);
    
    if (!metricId || value === undefined) {
      return res.status(400).json({ error: 'metricId and value are required' });
    }
    
    console.log(`[Metrics AI] Explaining result for ${metricId}, tenant ${tenantId}`);
    const explanation = await explainMetricResult(metricId, value, metadata, tenantId);
    res.json({ explanation });
  } catch (error: any) {
    console.error(`[Metrics] Error explaining result:`, error);
    res.status(500).json({ error: error.message || 'Failed to explain result' });
  }
});

/**
 * POST /api/metrics/ai/chat
 * Interactive chat about metrics
 * Body: { messages: Array<{ role: 'user' | 'assistant', content: string }> }
 */
router.post('/ai/chat', authenticateToken, apiLimiter, async (req: AuthRequest, res) => {
  try {
    const { messages } = req.body;
    const tenantId = await resolveTenantId(req);
    
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'messages must be a non-empty array' });
    }
    
    console.log(`[Metrics AI] Chat for tenant ${tenantId}`);
    
    // Validate message format
    const validMessages: MetricChatMessage[] = messages.map((m: any) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: String(m.content || '')
    }));
    
    const response = await chatAboutMetrics(validMessages, tenantId);
    res.json({ response });
  } catch (error: any) {
    console.error(`[Metrics] Error in chat:`, error);
    res.status(500).json({ error: error.message || 'Failed to process chat' });
  }
});

export default router;
