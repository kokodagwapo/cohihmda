// @ts-nocheck
/**
 * Field Mappings API Routes
 * Allows lenders to customize field names and mappings
 */

import { Router } from 'express';
import { pool } from '../config/database.js';
import { authenticateToken, AuthRequest } from '../middleware/auth.js';
import { apiLimiter } from '../middleware/rateLimiter.js';
import { getTenantFieldMappings, saveTenantFieldMappings } from '../services/fieldMapper.js';
import { suggestFieldMappings } from '../services/fieldMapper.js';
import { z } from 'zod';

const router = Router();

/**
 * GET /api/field-mappings
 * Get field mappings for authenticated tenant
 */
router.get('/', authenticateToken, apiLimiter, async (req: AuthRequest, res) => {
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

    const mappings = await getTenantFieldMappings(tenantId);

    res.json({
      mappings: mappings?.field_mappings || {},
      customDisplayNames: mappings?.custom_display_names || {},
    });
  } catch (error: any) {
    console.error('Error fetching field mappings:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch field mappings' });
  }
});

/**
 * POST /api/field-mappings
 * Save field mappings for authenticated tenant
 */
router.post('/', authenticateToken, apiLimiter, async (req: AuthRequest, res) => {
  try {
    const schema = z.object({
      fieldMappings: z.record(z.object({
        source: z.string(),
        target: z.string(),
        displayName: z.string().optional(),
      })),
      customDisplayNames: z.record(z.string()).optional(),
    });

    const { fieldMappings, customDisplayNames = {} } = schema.parse(req.body);

    // Get tenant_id
    const profileResult = await pool.query(
      'SELECT tenant_id FROM public.profiles WHERE user_id = $1',
      [req.userId]
    );

    if (profileResult.rows.length === 0 || !profileResult.rows[0].tenant_id) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    const tenantId = profileResult.rows[0].tenant_id;

    await saveTenantFieldMappings(tenantId, fieldMappings, customDisplayNames);

    res.json({ success: true, message: 'Field mappings saved successfully' });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request data', details: error.errors });
    }
    console.error('Error saving field mappings:', error);
    res.status(500).json({ error: error.message || 'Failed to save field mappings' });
  }
});

/**
 * POST /api/field-mappings/suggest
 * Suggest field mappings from CSV headers
 */
router.post('/suggest', authenticateToken, apiLimiter, async (req: AuthRequest, res) => {
  try {
    const schema = z.object({
      csvHeaders: z.array(z.string()),
    });

    const { csvHeaders } = schema.parse(req.body);

    const suggestions = suggestFieldMappings(csvHeaders);

    res.json({ suggestions });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request data', details: error.errors });
    }
    console.error('Error suggesting field mappings:', error);
    res.status(500).json({ error: error.message || 'Failed to suggest field mappings' });
  }
});

export default router;
