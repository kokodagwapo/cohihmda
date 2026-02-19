import { Router } from 'express';
import { authenticateToken, AuthRequest } from '../../middleware/auth.js';
import { attachTenantContext, getTenantContext } from '../../middleware/tenantContext.js';
import {
  generateSampleData,
  resetSampleData,
  clearTenantData,
} from '../../services/dashboard/dataService.js';

const router = Router();

/**
 * POST /api/dashboard/sample-data
 * Insert sample data matching CSV templates for testing
 */
router.post('/sample-data', authenticateToken, attachTenantContext, async (req: AuthRequest, res) => {
  try {
    const { tenantId } = getTenantContext(req);

    const result = await generateSampleData(tenantId, req.userId!);

    res.json(result);
  } catch (error: any) {
    console.error('Error inserting sample data:', error);
    res.status(500).json({ error: 'Failed to insert sample data', details: error.message });
  }
});

/**
 * POST /api/dashboard/reset-sample-data
 * Clear all existing data and insert fresh realistic sample data
 * Includes full drill-down coverage for business overview, leaderboard, and loan funnel
 */
router.post('/reset-sample-data', authenticateToken, attachTenantContext, async (req: AuthRequest, res) => {
  try {
    const { tenantId } = getTenantContext(req);

    const result = await resetSampleData(tenantId, req.userId!);

    res.json(result);
  } catch (error: any) {
    console.error('Error resetting sample data:', error);
    res.status(500).json({ error: 'Failed to reset sample data', details: error.message });
  }
});

/**
 * POST /api/dashboard/reset-data
 * Clear all existing data for this tenant (no repopulation)
 */
router.post('/reset-data', authenticateToken, attachTenantContext, async (req: AuthRequest, res) => {
  try {
    const { tenantId } = getTenantContext(req);

    await clearTenantData(tenantId);

    res.json({
      success: true,
      message: 'All tenant data cleared. Use Insert Full Demo Data to repopulate.',
    });
  } catch (error: any) {
    console.error('Error resetting data:', error);
    res.status(500).json({ error: 'Failed to reset data', details: error.message });
  }
});

export default router;
