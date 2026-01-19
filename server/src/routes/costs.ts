import { Router } from 'express';
import { pool } from '../config/database.js';
import { authenticateToken, AuthRequest } from '../middleware/auth.js';
import { z } from 'zod';
import { fetchAWSCosts, syncAWSCostsToDatabase } from '../services/awsCostExplorer.js';
import { costSyncLimiter } from '../middleware/rateLimiter.js';

const router = Router();

// Validation schemas
const budgetSchema = z.object({
  budget_type: z.enum(['monthly', 'daily', 'per_category']),
  category: z.string().optional(),
  budget_amount: z.number().positive(),
  alert_threshold_percent: z.number().int().min(1).max(100).optional(),
  alert_email: z.string().email().optional(),
});

/**
 * GET /api/costs/summary
 * Get cost summary for current billing period
 */
router.get('/summary', authenticateToken, async (req: AuthRequest, res) => {
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

    // Get current month summary
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

    // Aggregate costs by category
    const summaryResult = await pool.query(
      `SELECT 
        service_category,
        SUM(total_cost) as total_cost,
        COUNT(*) as event_count
       FROM public.cost_events
       WHERE tenant_id = $1 AND created_at >= $2 AND created_at <= $3
       GROUP BY service_category
       ORDER BY total_cost DESC`,
      [tenantId, startOfMonth, endOfMonth]
    );

    // Get daily summary for current month
    const dailyResult = await pool.query(
      `SELECT 
        date,
        total_cost,
        voice_gemini_cost + voice_openai_cost + voice_other_cost as voice_total,
        llm_total_cost,
        aws_compute_cost + aws_storage_cost + aws_network_cost + aws_other_cost as aws_total,
        vector_db_cost
       FROM public.cost_daily_summary
       WHERE tenant_id = $1 AND date >= $2 AND date <= $3
       ORDER BY date DESC`,
      [tenantId, startOfMonth.toISOString().split('T')[0], endOfMonth.toISOString().split('T')[0]]
    );

    // Calculate totals
    const totals = summaryResult.rows.reduce(
      (acc, row) => {
        acc.total += parseFloat(row.total_cost);
        acc[row.service_category] = parseFloat(row.total_cost);
        return acc;
      },
      { total: 0 } as Record<string, number>
    );

    // Calculate month-end projection
    const daysInMonth = endOfMonth.getDate();
    const daysElapsed = now.getDate();
    const projectedTotal = totals.total * (daysInMonth / daysElapsed);

    res.json({
      period: {
        start: startOfMonth.toISOString(),
        end: endOfMonth.toISOString(),
        daysElapsed,
        daysInMonth,
      },
      totals,
      projectedTotal: Math.round(projectedTotal * 100) / 100,
      byCategory: summaryResult.rows,
      daily: dailyResult.rows,
    });
  } catch (error: any) {
    console.error('Error fetching cost summary:', error);
    res.status(500).json({ error: 'Failed to fetch cost summary' });
  }
});

/**
 * GET /api/costs/daily
 * Get daily cost breakdown
 */
router.get('/daily', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const { start_date, end_date } = z.object({
      start_date: z.string().optional(),
      end_date: z.string().optional(),
    }).parse(req.query);

    // Get tenant_id
    const profileResult = await pool.query(
      'SELECT tenant_id FROM public.profiles WHERE user_id = $1',
      [req.userId]
    );

    if (profileResult.rows.length === 0 || !profileResult.rows[0].tenant_id) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    const tenantId = profileResult.rows[0].tenant_id;

    const start = start_date || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const end = end_date || new Date().toISOString().split('T')[0];

    const result = await pool.query(
      `SELECT *
       FROM public.cost_daily_summary
       WHERE tenant_id = $1 AND date >= $2 AND date <= $3
       ORDER BY date DESC`,
      [tenantId, start, end]
    );

    res.json({ daily: result.rows });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request data', details: error.errors });
    }
    console.error('Error fetching daily costs:', error);
    res.status(500).json({ error: 'Failed to fetch daily costs' });
  }
});

/**
 * GET /api/costs/by-category
 * Get costs grouped by category
 */
router.get('/by-category', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const { start_date, end_date } = z.object({
      start_date: z.string().optional(),
      end_date: z.string().optional(),
    }).parse(req.query);

    // Get tenant_id
    const profileResult = await pool.query(
      'SELECT tenant_id FROM public.profiles WHERE user_id = $1',
      [req.userId]
    );

    if (profileResult.rows.length === 0 || !profileResult.rows[0].tenant_id) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    const tenantId = profileResult.rows[0].tenant_id;

    const start = start_date || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const end = end_date || new Date().toISOString();

    const result = await pool.query(
      `SELECT 
        service_category,
        service_provider,
        SUM(total_cost) as total_cost,
        COUNT(*) as event_count,
        SUM(usage_amount) as total_usage
       FROM public.cost_events
       WHERE tenant_id = $1 AND created_at >= $2 AND created_at <= $3
       GROUP BY service_category, service_provider
       ORDER BY total_cost DESC`,
      [tenantId, start, end]
    );

    res.json({ byCategory: result.rows });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request data', details: error.errors });
    }
    console.error('Error fetching costs by category:', error);
    res.status(500).json({ error: 'Failed to fetch costs by category' });
  }
});

/**
 * GET /api/costs/voice
 * Get detailed voice AI costs
 */
router.get('/voice', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const { start_date, end_date, tenant_id } = z.object({
      start_date: z.string().optional(),
      end_date: z.string().optional(),
      tenant_id: z.string().uuid().optional(),
    }).parse(req.query);

    // Get user's profile to check if super admin
    const profileResult = await pool.query(
      'SELECT tenant_id FROM public.profiles WHERE user_id = $1',
      [req.userId]
    );
    
    const userTenantId = profileResult.rows[0]?.tenant_id;
    const isSuperAdmin = !userTenantId;
    
    // Determine which tenant_id to use
    let targetTenantId: string;
    if (tenant_id && isSuperAdmin) {
      // Super admin can access any tenant's costs
      targetTenantId = tenant_id;
    } else if (userTenantId) {
      // Regular user can only access their own tenant's costs
      targetTenantId = userTenantId;
    } else {
      return res.status(403).json({ error: 'Access denied. Tenant context required.' });
    }

    const tenantId = targetTenantId;

    const start = start_date || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const end = end_date || new Date().toISOString();

    const result = await pool.query(
      `SELECT 
        service_provider,
        service_name,
        COUNT(DISTINCT session_id) as total_sessions,
        SUM(CASE WHEN usage_type = 'audio_input_minutes' THEN usage_amount ELSE 0 END) as input_minutes,
        SUM(CASE WHEN usage_type = 'audio_output_minutes' THEN usage_amount ELSE 0 END) as output_minutes,
        SUM(total_cost) as total_cost
       FROM public.cost_events
       WHERE tenant_id = $1 
         AND service_category = 'voice_ai'
         AND created_at >= $2 
         AND created_at <= $3
       GROUP BY service_provider, service_name
       ORDER BY total_cost DESC`,
      [tenantId, start, end]
    );

    res.json({ voice: result.rows });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request data', details: error.errors });
    }
    console.error('Error fetching voice costs:', error);
    res.status(500).json({ error: 'Failed to fetch voice costs' });
  }
});

/**
 * GET /api/costs/aws
 * Get detailed AWS infrastructure costs
 */
router.get('/aws', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const { start_date, end_date } = z.object({
      start_date: z.string().optional(),
      end_date: z.string().optional(),
    }).parse(req.query);

    // Get tenant_id
    const profileResult = await pool.query(
      'SELECT tenant_id FROM public.profiles WHERE user_id = $1',
      [req.userId]
    );

    if (profileResult.rows.length === 0 || !profileResult.rows[0].tenant_id) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    const tenantId = profileResult.rows[0].tenant_id;

    const start = start_date || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const end = end_date || new Date().toISOString();

    const result = await pool.query(
      `SELECT 
        service_name,
        usage_type,
        SUM(usage_amount) as total_usage,
        AVG(unit_price) as avg_unit_price,
        SUM(total_cost) as total_cost
       FROM public.cost_events
       WHERE tenant_id = $1 
         AND service_category = 'aws'
         AND created_at >= $2 
         AND created_at <= $3
       GROUP BY service_name, usage_type
       ORDER BY total_cost DESC`,
      [tenantId, start, end]
    );

    res.json({ aws: result.rows });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request data', details: error.errors });
    }
    console.error('Error fetching AWS costs:', error);
    res.status(500).json({ error: 'Failed to fetch AWS costs' });
  }
});

/**
 * GET /api/costs/projections
 * Get month-end cost projections
 */
router.get('/projections', authenticateToken, async (req: AuthRequest, res) => {
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

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const daysElapsed = now.getDate();

    // Get current month costs
    const currentResult = await pool.query(
      `SELECT 
        service_category,
        SUM(total_cost) as total_cost
       FROM public.cost_events
       WHERE tenant_id = $1 AND created_at >= $2
       GROUP BY service_category`,
      [tenantId, startOfMonth]
    );

    const projections = currentResult.rows.map((row) => {
      const current = parseFloat(row.total_cost);
      const projected = current * (daysInMonth / daysElapsed);
      return {
        category: row.service_category,
        current,
        projected: Math.round(projected * 100) / 100,
        daysElapsed,
        daysInMonth,
      };
    });

    const totalCurrent = projections.reduce((sum, p) => sum + p.current, 0);
    const totalProjected = projections.reduce((sum, p) => sum + p.projected, 0);

    res.json({
      period: {
        start: startOfMonth.toISOString(),
        daysElapsed,
        daysInMonth,
      },
      projections,
      totals: {
        current: Math.round(totalCurrent * 100) / 100,
        projected: Math.round(totalProjected * 100) / 100,
      },
    });
  } catch (error: any) {
    console.error('Error fetching cost projections:', error);
    res.status(500).json({ error: 'Failed to fetch cost projections' });
  }
});

/**
 * GET /api/costs/budgets
 * Get budget configurations
 */
router.get('/budgets', authenticateToken, async (req: AuthRequest, res) => {
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

    const result = await pool.query(
      'SELECT * FROM public.cost_budgets WHERE tenant_id = $1 AND is_active = true ORDER BY created_at DESC',
      [tenantId]
    );

    res.json({ budgets: result.rows });
  } catch (error: any) {
    console.error('Error fetching budgets:', error);
    res.status(500).json({ error: 'Failed to fetch budgets' });
  }
});

/**
 * POST /api/costs/budgets
 * Create a new budget alert
 */
router.post('/budgets', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const budget = budgetSchema.parse(req.body);

    // Get tenant_id
    const profileResult = await pool.query(
      'SELECT tenant_id FROM public.profiles WHERE user_id = $1',
      [req.userId]
    );

    if (profileResult.rows.length === 0 || !profileResult.rows[0].tenant_id) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    const tenantId = profileResult.rows[0].tenant_id;

    const result = await pool.query(
      `INSERT INTO public.cost_budgets
       (tenant_id, budget_type, category, budget_amount, alert_threshold_percent, alert_email)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        tenantId,
        budget.budget_type,
        budget.category || null,
        budget.budget_amount,
        budget.alert_threshold_percent || 80,
        budget.alert_email || null,
      ]
    );

    res.status(201).json({ budget: result.rows[0] });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request data', details: error.errors });
    }
    console.error('Error creating budget:', error);
    res.status(500).json({ error: 'Failed to create budget' });
  }
});

/**
 * PUT /api/costs/budgets/:id
 * Update a budget
 */
router.put('/budgets/:id', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const budgetId = req.params.id;
    const updates = budgetSchema.partial().parse(req.body);

    // Get tenant_id
    const profileResult = await pool.query(
      'SELECT tenant_id FROM public.profiles WHERE user_id = $1',
      [req.userId]
    );

    if (profileResult.rows.length === 0 || !profileResult.rows[0].tenant_id) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    const tenantId = profileResult.rows[0].tenant_id;

    // Build update query
    const updateFields: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    Object.entries(updates).forEach(([key, value]) => {
      if (value !== undefined) {
        updateFields.push(`${key} = $${paramIndex}`);
        values.push(value);
        paramIndex++;
      }
    });

    if (updateFields.length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    values.push(budgetId, tenantId);

    const result = await pool.query(
      `UPDATE public.cost_budgets
       SET ${updateFields.join(', ')}, updated_at = NOW()
       WHERE id = $${paramIndex} AND tenant_id = $${paramIndex + 1}
       RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Budget not found' });
    }

    res.json({ budget: result.rows[0] });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request data', details: error.errors });
    }
    console.error('Error updating budget:', error);
    res.status(500).json({ error: 'Failed to update budget' });
  }
});

/**
 * DELETE /api/costs/budgets/:id
 * Delete a budget (soft delete by setting is_active = false)
 */
router.delete('/budgets/:id', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const budgetId = req.params.id;

    // Get tenant_id
    const profileResult = await pool.query(
      'SELECT tenant_id FROM public.profiles WHERE user_id = $1',
      [req.userId]
    );

    if (profileResult.rows.length === 0 || !profileResult.rows[0].tenant_id) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    const tenantId = profileResult.rows[0].tenant_id;

    const result = await pool.query(
      `UPDATE public.cost_budgets
       SET is_active = false, updated_at = NOW()
       WHERE id = $1 AND tenant_id = $2
       RETURNING *`,
      [budgetId, tenantId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Budget not found' });
    }

    res.json({ message: 'Budget deleted successfully' });
  } catch (error: any) {
    console.error('Error deleting budget:', error);
    res.status(500).json({ error: 'Failed to delete budget' });
  }
});

/**
 * POST /api/costs/export
 * Export cost report (CSV/JSON)
 */
router.post('/export', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const { format, start_date, end_date } = z.object({
      format: z.enum(['csv', 'json']).optional(),
      start_date: z.string().optional(),
      end_date: z.string().optional(),
    }).parse(req.body);

    // Get tenant_id
    const profileResult = await pool.query(
      'SELECT tenant_id FROM public.profiles WHERE user_id = $1',
      [req.userId]
    );

    if (profileResult.rows.length === 0 || !profileResult.rows[0].tenant_id) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    const tenantId = profileResult.rows[0].tenant_id;

    const start = start_date || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const end = end_date || new Date().toISOString();

    const result = await pool.query(
      `SELECT *
       FROM public.cost_events
       WHERE tenant_id = $1 AND created_at >= $2 AND created_at <= $3
       ORDER BY created_at DESC`,
      [tenantId, start, end]
    );

    if (format === 'csv') {
      // Convert to CSV
      const headers = Object.keys(result.rows[0] || {});
      const csvRows = [
        headers.join(','),
        ...result.rows.map((row) => headers.map((h) => JSON.stringify(row[h] || '')).join(',')),
      ];

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="costs-${tenantId}-${Date.now()}.csv"`);
      return res.send(csvRows.join('\n'));
    }

    // Default to JSON
    res.json({ costs: result.rows });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request data', details: error.errors });
    }
    console.error('Error exporting costs:', error);
    res.status(500).json({ error: 'Failed to export costs' });
  }
});

/**
 * POST /api/costs/aws/sync
 * Sync AWS costs from Cost Explorer API
 */
router.post('/aws/sync', costSyncLimiter, authenticateToken, async (req: AuthRequest, res) => {
  try {
    const { start_date, end_date, instance_id } = z.object({
      start_date: z.string().optional(),
      end_date: z.string().optional(),
      instance_id: z.string().uuid().optional(),
    }).parse(req.body);

    // Get tenant_id
    const profileResult = await pool.query(
      'SELECT tenant_id FROM public.profiles WHERE user_id = $1',
      [req.userId]
    );

    if (profileResult.rows.length === 0 || !profileResult.rows[0].tenant_id) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    const tenantId = profileResult.rows[0].tenant_id;

    // Get instance_id (use provided or find cloud instance)
    let targetInstanceId = instance_id;
    if (!targetInstanceId) {
      const instanceResult = await pool.query(
        `SELECT id FROM public.deployment_instances
         WHERE tenant_id = $1 AND instance_type = 'cloud' AND status = 'active'
         LIMIT 1`,
        [tenantId]
      );
      if (instanceResult.rows.length > 0) {
        targetInstanceId = instanceResult.rows[0].id;
      }
    }

    if (!targetInstanceId) {
      return res.status(404).json({ error: 'No cloud instance found for AWS cost sync' });
    }

    // Set date range (default to current month)
    const now = new Date();
    const start = start_date ? new Date(start_date) : new Date(now.getFullYear(), now.getMonth(), 1);
    const end = end_date ? new Date(end_date) : new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

    // Fetch AWS costs
    const costData = await fetchAWSCosts(start, end, tenantId);

    // Sync to database
    await syncAWSCostsToDatabase(tenantId, targetInstanceId, costData);

    res.json({
      success: true,
      message: 'AWS costs synced successfully',
      period: costData.period,
      totalCost: costData.totalCost,
      services: costData.byService.length,
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request data', details: error.errors });
    }
    console.error('Error syncing AWS costs:', error);
    res.status(500).json({ error: 'Failed to sync AWS costs', details: error.message });
  }
});

export default router;

