import { Router } from 'express';
import { authenticateToken, AuthRequest } from '../../middleware/auth.js';
import { z } from 'zod';
import { getTenantId } from '../../utils/tenantUtils.js';
import { handleDatabaseError } from '../../config/database.js';
import { attachTenantContext, getTenantContext } from '../../middleware/tenantContext.js';
import {
  getFunnelData,
  getLeaderboardData,
  getTopTieringRankings,
  getBusinessOverviewMetrics,
  getInsights,
  getClosingFalloutForecast,
} from '../../services/dashboard/analyticsService.js';

const router = Router();

// Validation schemas
const yearQuerySchema = z.object({
  year: z.string().regex(/^\d{4}$/).optional(),
});

/**
 * GET /api/dashboard/funnel
 * Get loan funnel data for a specific year
 */
router.get('/funnel', authenticateToken, attachTenantContext, async (req: AuthRequest, res) => {
  try {
    const { year } = yearQuerySchema.parse(req.query);
    const targetYear = year || new Date().getFullYear().toString();

    const tenantContext = getTenantContext(req);
    const funnelData = await getFunnelData(tenantContext.tenantPool, targetYear);
      res.json({ funnel: funnelData });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request data', details: error.errors });
    }
    console.error('Error fetching funnel data:', error);
    
    // Handle database connection errors
    if (handleDatabaseError(error, res, 'Failed to fetch funnel data')) {
      return;
    }
    
    res.status(500).json({ error: 'Failed to fetch funnel data' });
  }
});

/**
 * GET /api/dashboard/leaderboard
 * Get leaderboard data for a specific timeframe
 */
router.get('/leaderboard', authenticateToken, attachTenantContext, async (req: AuthRequest, res) => {
  try {
    const { timeframe = 'mtd' } = z.object({
      timeframe: z.enum(['wtd', 'mtd', 'qtd', 'ytd']).optional(),
    }).parse(req.query);

    const tenantContext = getTenantContext(req);
    const result = await getLeaderboardData(tenantContext.tenantPool, timeframe as 'wtd' | 'mtd' | 'qtd' | 'ytd');
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
 * GET /api/dashboard/top-tiering
 * Get TopTiering ranking with productivity, profitability, and complexity scoring
 */
router.get('/top-tiering', authenticateToken, attachTenantContext, async (req: AuthRequest, res) => {
  try {
    const tenantContext = getTenantContext(req);
    const result = await getTopTieringRankings(tenantContext.tenantPool);
    res.json(result);
  } catch (error: any) {
    console.error('Error fetching top-tiering rankings:', error);
    
    // Handle database connection errors
    if (handleDatabaseError(error, res, 'Failed to fetch top-tiering rankings')) {
      return;
    }
    
    res.status(500).json({ error: 'Failed to fetch top-tiering rankings' });
  }
});

/**
 * GET /api/dashboard/business-overview
 * Get business overview metrics
 * Query params: year (optional), dateFilter (optional: 'today' | 'mtd' | 'ytd' | 'custom')
 * For custom date range, also accepts: startDate, endDate (ISO strings)
 */
router.get('/business-overview', authenticateToken, attachTenantContext, async (req: AuthRequest, res) => {
  try {
    const { year } = yearQuerySchema.parse(req.query);
    const targetYear = year || new Date().getFullYear().toString();
    const dateFilter = (req.query.dateFilter as 'today' | 'mtd' | 'ytd' | 'custom') || 'ytd';
    
    // Parse custom date range if provided
    let customDateRange: { start: Date; end: Date } | undefined;
    if (dateFilter === 'custom' && req.query.startDate && req.query.endDate) {
      customDateRange = {
        start: new Date(req.query.startDate as string),
        end: new Date(req.query.endDate as string)
      };
    }

    const tenantContext = getTenantContext(req);
    const metrics = await getBusinessOverviewMetrics(
      tenantContext.tenantPool, 
      targetYear,
      dateFilter,
      customDateRange
    );
    res.json(metrics);
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request data', details: error.errors });
    }
    console.error('Error fetching business overview:', error);
    
    // Handle database connection errors
    if (handleDatabaseError(error, res, 'Failed to fetch business overview')) {
      return;
    }
    
    res.status(500).json({ error: 'Failed to fetch business overview' });
  }
});

/**
 * GET /api/dashboard/insights
 * Get comprehensive insights based on loan data, business overview, leaderboard, and industry news
 */
router.get('/insights', authenticateToken, attachTenantContext, async (req: AuthRequest, res) => {
  try {
    const tenantContext = getTenantContext(req);
    const { dateFilter = 'ytd' } = req.query;
    const authHeader = req.headers.authorization;

    const result = await getInsights(tenantContext.tenantPool, dateFilter as string, authHeader);
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
 */
router.get('/closing-fallout-forecast', authenticateToken, attachTenantContext, async (req: AuthRequest, res) => {
  try {
    const tenantContext = getTenantContext(req);
    const { dateFilter = 'ytd' } = req.query;
    const result = await getClosingFalloutForecast(tenantContext.tenantPool, dateFilter as 'today' | 'mtd' | 'ytd' | 'custom');
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

export default router;
