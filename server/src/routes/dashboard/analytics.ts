import { Router } from 'express';
import { authenticateToken, AuthRequest } from '../../middleware/auth.js';
import { z } from 'zod';
import { getTenantId } from '../../utils/tenantUtils.js';
import { handleDatabaseError } from '../../config/database.js';
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
router.get('/funnel', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const { year } = yearQuerySchema.parse(req.query);
    const targetYear = year || new Date().getFullYear().toString();

    // Get tenant_id using helper function (supports super admins)
    const tenantId = await getTenantId(req.userId!, req.query.tenant_id as string);

    if (!tenantId) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    const funnelData = await getFunnelData(tenantId, targetYear);
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
router.get('/leaderboard', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const { timeframe = 'mtd' } = z.object({
      timeframe: z.enum(['wtd', 'mtd', 'qtd', 'ytd']).optional(),
    }).parse(req.query);

    // Get tenant_id using helper function (supports super admins)
    const tenantId = await getTenantId(req.userId!, req.query.tenant_id as string);

    if (!tenantId) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    const result = await getLeaderboardData(tenantId, timeframe as 'wtd' | 'mtd' | 'qtd' | 'ytd');
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
router.get('/top-tiering', authenticateToken, async (req: AuthRequest, res) => {
  try {
    // Get tenant_id using helper function (supports super admins)
    const tenantId = await getTenantId(req.userId!, req.query.tenant_id as string);

    if (!tenantId) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    const result = await getTopTieringRankings(tenantId);
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
 */
router.get('/business-overview', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const { year } = yearQuerySchema.parse(req.query);
    const targetYear = year || new Date().getFullYear().toString();

    // Get tenant_id using helper function (supports super admins)
    const tenantId = await getTenantId(req.userId!, req.query.tenant_id as string);

    if (!tenantId) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    const metrics = await getBusinessOverviewMetrics(tenantId, targetYear);
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
router.get('/insights', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const tenantId = await getTenantId(req.userId!, req.query.tenant_id as string);
    if (!tenantId) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    const { dateFilter = 'ytd' } = req.query;
    const authHeader = req.headers.authorization;

    const result = await getInsights(tenantId, dateFilter as string, authHeader);
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
router.get('/closing-fallout-forecast', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const tenantId = await getTenantId(req.userId!, req.query.tenant_id as string);
    if (!tenantId) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    const { dateFilter = 'ytd' } = req.query;
    const result = await getClosingFalloutForecast(tenantId, dateFilter as 'today' | 'mtd' | 'ytd' | 'custom');
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
