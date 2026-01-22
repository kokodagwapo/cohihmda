/**
 * Metrics API Routes
 * RESTful endpoints for querying metrics from the metrics catalog
 * Supports date ranges, filtering, and RAG agent access
 */

import { Router } from 'express';
import { authenticateToken, AuthRequest } from '../middleware/auth.js';
import { attachTenantContext, getTenantContext } from '../middleware/tenantContext.js';
import { queryMetric, queryMetrics, queryMetricsByCategory, getMetricsCatalog, DateRange } from '../services/metrics/metricsService.js';
import { explainMetric, explainMetricResult, chatAboutMetrics, getStaticMetricDescriptions, MetricChatMessage } from '../services/metrics/metricsAiService.js';
import { apiLimiter } from '../middleware/rateLimiter.js';
import { pool } from '../config/database.js';

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
 */
router.get('/:metricId', authenticateToken, attachTenantContext, apiLimiter, async (req: AuthRequest, res) => {
  try {
    const { metricId } = req.params;
    const tenantPool = getTenantContext(req).tenantPool;
    
    // Parse date range from query params
    const dateRange: DateRange | undefined = req.query.startDate || req.query.endDate
      ? {
          start: req.query.startDate ? new Date(req.query.startDate as string) : null,
          end: req.query.endDate ? new Date(req.query.endDate as string) : null
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
      additionalFilters: Object.keys(additionalFilters).length > 0 ? additionalFilters : undefined
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
 * Body: { metricIds: string[], dateRange?: { start?: string, end?: string }, dateField?: string, additionalFilters?: object }
 */
router.post('/query', authenticateToken, attachTenantContext, apiLimiter, async (req: AuthRequest, res) => {
  try {
    const { metricIds, dateRange, dateField, additionalFilters } = req.body;
    const tenantPool = getTenantContext(req).tenantPool;
    
    if (!Array.isArray(metricIds) || metricIds.length === 0) {
      return res.status(400).json({ error: 'metricIds must be a non-empty array' });
    }
    
    // Parse date range if provided
    const parsedDateRange: DateRange | undefined = dateRange
      ? {
          start: dateRange.start ? new Date(dateRange.start) : null,
          end: dateRange.end ? new Date(dateRange.end) : null
        }
      : undefined;
    
    const results = await queryMetrics(tenantPool, metricIds, { 
      dateRange: parsedDateRange, 
      dateField,
      additionalFilters
    });
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
 */
router.get('/category/:category', authenticateToken, attachTenantContext, apiLimiter, async (req: AuthRequest, res) => {
  try {
    const { category } = req.params;
    const tenantPool = getTenantContext(req).tenantPool;
    
    // Parse date range from query params
    const dateRange: DateRange | undefined = req.query.startDate || req.query.endDate
      ? {
          start: req.query.startDate ? new Date(req.query.startDate as string) : null,
          end: req.query.endDate ? new Date(req.query.endDate as string) : null
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
      dateField,
      additionalFilters: Object.keys(additionalFilters).length > 0 ? additionalFilters : undefined
    });
    res.json({ metrics: results });
  } catch (error: any) {
    console.error(`[Metrics] Error querying category ${req.params.category}:`, error);
    res.status(500).json({ error: error.message || 'Failed to query category metrics' });
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
