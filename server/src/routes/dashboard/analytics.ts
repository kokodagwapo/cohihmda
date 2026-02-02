import { Router } from 'express';
import { authenticateToken, AuthRequest } from '../../middleware/auth.js';
import { z } from 'zod';
import { getTenantId } from '../../utils/tenantUtils.js';
import { handleDatabaseError } from '../../config/database.js';
import { attachTenantContext, getTenantContext } from '../../middleware/tenantContext.js';
import { getLoanAccessContext } from '../../services/userLoanAccessService.js';
import {
  getLeaderboardData,
  getInsights,
  getClosingFalloutForecast,
  getDashboardOverview,
} from '../../services/dashboard/analyticsService.js';

const router = Router();

// Validation schemas
const yearQuerySchema = z.object({
  year: z.string().regex(/^\d{4}$/).optional(),
});

// =============================================================================
// REMOVED DUPLICATE ENDPOINTS (Backend Routes Consolidation)
// =============================================================================
// /funnel - Use /api/loans/funnel instead (more feature-complete with filters)
// /top-tiering - Use /api/toptiering instead (consolidated endpoint)
// /business-overview - Use /api/dashboard/overview instead (consolidated)
// =============================================================================

/**
 * GET /api/dashboard/leaderboard
 * Get leaderboard data for a specific timeframe
 * Supports filters: branch, scope (all/branch/team)
 * Supports custom date range with startDate and endDate parameters
 * Respects user-level loan access filtering
 */
router.get('/leaderboard', authenticateToken, attachTenantContext, async (req: AuthRequest, res) => {
  try {
    const querySchema = z.object({
      // Extended timeframes: wtd, mtd, qtd, ytd, lm (last month), lq (last quarter), ly (last year), custom
      timeframe: z.enum(['wtd', 'mtd', 'qtd', 'ytd', 'lm', 'lq', 'ly', 'custom']).optional(),
      branch: z.string().optional(),
      scope: z.enum(['all', 'branch', 'team']).optional(),
      startDate: z.string().optional(), // For custom date range (YYYY-MM-DD)
      endDate: z.string().optional(),   // For custom date range (YYYY-MM-DD)
    });
    
    const { timeframe = 'mtd', branch, scope, startDate, endDate } = querySchema.parse(req.query);

    const tenantContext = getTenantContext(req);
    
    // Get user's loan access context
    const accessCtx = await getLoanAccessContext(req, tenantContext.tenantPool);
    
    // If user has no access, return empty leaderboard
    if (accessCtx.hasNoAccess) {
      return res.json({ 
        timeframe, 
        entries: [], 
        period: { start: startDate || '', end: endDate || '' },
        accessFiltered: true 
      });
    }
    
    // Build filters object with access filter
    const filters = {
      branch: branch || undefined,
      scope: (scope as 'all' | 'branch' | 'team') || 'all',
      startDate: startDate || undefined,
      endDate: endDate || undefined,
      userAccessFilter: accessCtx.getFilter('l'),
    };
    
    const result = await getLeaderboardData(
      tenantContext.tenantPool, 
      timeframe as 'wtd' | 'mtd' | 'qtd' | 'ytd' | 'lm' | 'lq' | 'ly' | 'custom',
      filters
    );
    res.json(result);
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request data', details: error.errors });
    }
    console.error('Error fetching leaderboard:', error);
    
    // Handle database connection errors
    if (handleDatabaseError(error, res, 'Failed to fetch leaderboard')) {
      return;
    }
    
    res.status(500).json({ error: 'Failed to fetch leaderboard' });
  }
});

/**
 * GET /api/dashboard/insights
 * Get comprehensive insights based on loan data, business overview, leaderboard, and industry news
 * Respects user-level loan access filtering
 * 
 * Query params:
 * - dateFilter: 'today' | 'mtd' | 'ytd' | 'rolling_90_days' | 'rolling_13_months' (default: 'ytd')
 * - useLLM: 'true' | 'false' - Use LLM-based dynamic insights (default: true)
 * - forceRefresh: 'true' | 'false' - Force regeneration, bypass cache (default: false)
 */
router.get('/insights', authenticateToken, attachTenantContext, async (req: AuthRequest, res) => {
  try {
    const tenantContext = getTenantContext(req);
    const { 
      dateFilter = 'ytd',
      useLLM = 'true',
      forceRefresh = 'false'
    } = req.query;
    const authHeader = req.headers.authorization;

    // Get user's loan access context
    const accessCtx = await getLoanAccessContext(req, tenantContext.tenantPool);
    
    // If user has no access, return empty insights
    if (accessCtx.hasNoAccess) {
      return res.json({ 
        insights: [], 
        metrics: {},
        accessFiltered: true,
        noAccess: true 
      });
    }

    const result = await getInsights(
      tenantContext.tenantPool, 
      dateFilter as string, 
      authHeader,
      {
        useLLM: useLLM === 'true',
        tenantId: tenantContext.tenantId,
        forceRefresh: forceRefresh === 'true',
        userAccessFilter: accessCtx.getFilter('l'),
      }
    );
    res.json(result);
  } catch (error: any) {
    console.error('Error generating insights:', error);
    
    // Handle database connection errors
    if (handleDatabaseError(error, res, 'Failed to generate insights')) {
      return;
    }
    
    res.status(500).json({ error: 'Failed to generate insights', details: process.env.NODE_ENV === 'development' ? error.message : undefined });
  }
});

/**
 * GET /api/dashboard/closing-fallout-forecast
 * Get closing and fallout forecast with Qlik formulas (pull-through by loan type, active aging, predictions)
 * Respects user-level loan access filtering
 */
router.get('/closing-fallout-forecast', authenticateToken, attachTenantContext, async (req: AuthRequest, res) => {
  try {
    const tenantContext = getTenantContext(req);
    const { dateFilter = 'ytd' } = req.query;
    
    // Get user's loan access context
    const accessCtx = await getLoanAccessContext(req, tenantContext.tenantPool);
    
    // If user has no access, return empty forecast
    if (accessCtx.hasNoAccess) {
      return res.json({ 
        forecast: {}, 
        accessFiltered: true,
        noAccess: true 
      });
    }
    
    const result = await getClosingFalloutForecast(
      tenantContext.tenantPool, 
      dateFilter as 'today' | 'mtd' | 'ytd' | 'custom',
      { userAccessFilter: accessCtx.getFilter('l') }
    );
    res.json(result);
  } catch (error: any) {
    console.error('Error fetching closing and fallout forecast:', error);
    
    // Handle database connection errors
    if (handleDatabaseError(error, res, 'Failed to fetch closing and fallout forecast')) {
      return;
    }
    
    res.status(500).json({ error: 'Failed to fetch closing and fallout forecast', details: process.env.NODE_ENV === 'development' ? error.message : undefined });
  }
});

/**
 * GET /api/dashboard/overview
 * PERFORMANCE: Consolidated endpoint that returns stats, funnel, critical loans, and predictions in one call.
 * This reduces frontend API calls from 4 to 1, improving initial page load and reducing network waterfall.
 * Query params: period (optional: 'all' | 'mtd' | 'ytd' | 'last_month' | 'last_year' | year string)
 * Respects user-level loan access filtering
 */
router.get('/overview', authenticateToken, attachTenantContext, async (req: AuthRequest, res) => {
  try {
    const tenantContext = getTenantContext(req);
    const { period = 'all' } = req.query;
    
    // Get user's loan access context
    const accessCtx = await getLoanAccessContext(req, tenantContext.tenantPool);
    
    // If user has no access, return empty overview
    if (accessCtx.hasNoAccess) {
      return res.json({ 
        stats: { total: 0, active: 0, closed: 0, locked: 0 },
        funnel: [],
        criticalLoans: [],
        accessFiltered: true,
        noAccess: true 
      });
    }
    
    const result = await getDashboardOverview(
      tenantContext.tenantPool, 
      period as string,
      { userAccessFilter: accessCtx.getFilter('l') }
    );
    res.json(result);
  } catch (error: any) {
    console.error('Error fetching dashboard overview:', error);
    
    // Handle database connection errors
    if (handleDatabaseError(error, res, 'Failed to fetch dashboard overview')) {
      return;
    }
    
    res.status(500).json({ error: 'Failed to fetch dashboard overview', details: process.env.NODE_ENV === 'development' ? error.message : undefined });
  }
});

export default router;
