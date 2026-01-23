/**
 * Tenant Configuration Routes
 * Self-service mapping tool for lender admins
 * Manages personas, custom fields, range rules, filters, and scoring weights
 */

import express, { Response } from 'express';
import { z } from 'zod';
import { authenticateToken, AuthRequest } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import { attachTenantContext, getTenantContext } from '../middleware/tenantContext.js';
import { logInfo, logError, logDebug } from '../services/logger.js';

const router = express.Router();

// ============================================
// PERSONAS
// ============================================

/**
 * GET /api/tenant-config/personas
 * List all personas for the tenant
 */
router.get('/personas', authenticateToken, attachTenantContext, async (req: AuthRequest, res: Response) => {
  try {
    const { tenantPool } = getTenantContext(req);
    
    const result = await tenantPool.query(`
      SELECT id, name, description, is_system, permissions, dashboard_config, created_at, updated_at
      FROM public.personas
      ORDER BY is_system DESC, name ASC
    `);
    
    res.json({ personas: result.rows });
  } catch (error: any) {
    logError('Error fetching personas', error, { userId: req.userId });
    res.status(500).json({ error: 'Failed to fetch personas' });
  }
});

/**
 * POST /api/tenant-config/personas
 * Create a new persona
 */
router.post('/personas', authenticateToken, attachTenantContext, requireRole('tenant_admin', 'super_admin'), async (req: AuthRequest, res: Response) => {
  try {
    const { tenantPool } = getTenantContext(req);
    
    const schema = z.object({
      name: z.string().min(1).max(100),
      description: z.string().optional(),
      permissions: z.record(z.boolean()).optional(),
      dashboard_config: z.record(z.any()).optional(),
    });
    
    const data = schema.parse(req.body);
    
    const result = await tenantPool.query(`
      INSERT INTO public.personas (name, description, permissions, dashboard_config, is_system, created_by)
      VALUES ($1, $2, $3, $4, FALSE, $5)
      RETURNING id, name, description, is_system, permissions, dashboard_config, created_at
    `, [data.name, data.description || null, JSON.stringify(data.permissions || {}), JSON.stringify(data.dashboard_config || {}), req.userId]);
    
    logInfo('Persona created', { userId: req.userId, personaId: result.rows[0].id, name: data.name });
    res.status(201).json({ persona: result.rows[0] });
  } catch (error: any) {
    if (error.code === '23505') {
      return res.status(400).json({ error: 'A persona with this name already exists' });
    }
    logError('Error creating persona', error, { userId: req.userId });
    res.status(500).json({ error: 'Failed to create persona' });
  }
});

/**
 * PUT /api/tenant-config/personas/:id
 * Update a persona
 */
router.put('/personas/:id', authenticateToken, attachTenantContext, requireRole('tenant_admin', 'super_admin'), async (req: AuthRequest, res: Response) => {
  try {
    const { tenantPool } = getTenantContext(req);
    const { id } = req.params;
    
    // Check if it's a system persona
    const checkResult = await tenantPool.query('SELECT is_system FROM public.personas WHERE id = $1', [id]);
    if (checkResult.rows.length === 0) {
      return res.status(404).json({ error: 'Persona not found' });
    }
    if (checkResult.rows[0].is_system) {
      // Only allow updating permissions for system personas, not name
      const schema = z.object({
        permissions: z.record(z.boolean()).optional(),
        dashboard_config: z.record(z.any()).optional(),
      });
      const data = schema.parse(req.body);
      
      const result = await tenantPool.query(`
        UPDATE public.personas
        SET permissions = COALESCE($1, permissions), dashboard_config = COALESCE($2, dashboard_config), updated_at = NOW()
        WHERE id = $3
        RETURNING id, name, description, is_system, permissions, dashboard_config, updated_at
      `, [data.permissions ? JSON.stringify(data.permissions) : null, data.dashboard_config ? JSON.stringify(data.dashboard_config) : null, id]);
      
      return res.json({ persona: result.rows[0] });
    }
    
    const schema = z.object({
      name: z.string().min(1).max(100).optional(),
      description: z.string().optional(),
      permissions: z.record(z.boolean()).optional(),
      dashboard_config: z.record(z.any()).optional(),
    });
    
    const data = schema.parse(req.body);
    
    const result = await tenantPool.query(`
      UPDATE public.personas
      SET name = COALESCE($1, name), description = COALESCE($2, description),
          permissions = COALESCE($3, permissions), dashboard_config = COALESCE($4, dashboard_config),
          updated_at = NOW()
      WHERE id = $5
      RETURNING id, name, description, is_system, permissions, dashboard_config, updated_at
    `, [data.name, data.description, data.permissions ? JSON.stringify(data.permissions) : null, data.dashboard_config ? JSON.stringify(data.dashboard_config) : null, id]);
    
    logInfo('Persona updated', { userId: req.userId, personaId: id });
    res.json({ persona: result.rows[0] });
  } catch (error: any) {
    logError('Error updating persona', error, { userId: req.userId, personaId: req.params.id });
    res.status(500).json({ error: 'Failed to update persona' });
  }
});

/**
 * DELETE /api/tenant-config/personas/:id
 * Delete a persona (only custom personas)
 */
router.delete('/personas/:id', authenticateToken, attachTenantContext, requireRole('tenant_admin', 'super_admin'), async (req: AuthRequest, res: Response) => {
  try {
    const { tenantPool } = getTenantContext(req);
    const { id } = req.params;
    
    const checkResult = await tenantPool.query('SELECT is_system FROM public.personas WHERE id = $1', [id]);
    if (checkResult.rows.length === 0) {
      return res.status(404).json({ error: 'Persona not found' });
    }
    if (checkResult.rows[0].is_system) {
      return res.status(400).json({ error: 'Cannot delete system personas' });
    }
    
    await tenantPool.query('DELETE FROM public.personas WHERE id = $1', [id]);
    
    logInfo('Persona deleted', { userId: req.userId, personaId: id });
    res.json({ success: true });
  } catch (error: any) {
    logError('Error deleting persona', error, { userId: req.userId, personaId: req.params.id });
    res.status(500).json({ error: 'Failed to delete persona' });
  }
});

// ============================================
// CUSTOM FIELDS
// ============================================

/**
 * GET /api/tenant-config/fields
 * List all custom fields
 */
router.get('/fields', authenticateToken, attachTenantContext, async (req: AuthRequest, res: Response) => {
  try {
    const { tenantPool } = getTenantContext(req);
    
    const result = await tenantPool.query(`
      SELECT id, los_field_id, los_field_name, coheus_alias, display_name, data_type, category,
             description, is_enabled, is_custom, visible_to_personas, formatting_rules, created_at, updated_at
      FROM public.custom_fields
      ORDER BY category, display_name
    `);
    
    res.json({ fields: result.rows });
  } catch (error: any) {
    logError('Error fetching custom fields', error, { userId: req.userId });
    res.status(500).json({ error: 'Failed to fetch custom fields' });
  }
});

/**
 * POST /api/tenant-config/fields
 * Create a custom field
 */
router.post('/fields', authenticateToken, attachTenantContext, requireRole('tenant_admin', 'super_admin'), async (req: AuthRequest, res: Response) => {
  try {
    const { tenantPool } = getTenantContext(req);
    
    const schema = z.object({
      los_field_id: z.string().min(1),
      los_field_name: z.string().optional(),
      coheus_alias: z.string().optional(),
      display_name: z.string().min(1),
      data_type: z.enum(['string', 'number', 'date', 'boolean', 'currency', 'percentage']),
      category: z.string().optional(),
      description: z.string().optional(),
      visible_to_personas: z.array(z.string().uuid()).optional(),
      formatting_rules: z.record(z.any()).optional(),
    });
    
    const data = schema.parse(req.body);
    
    const result = await tenantPool.query(`
      INSERT INTO public.custom_fields (los_field_id, los_field_name, coheus_alias, display_name, data_type, 
                                         category, description, visible_to_personas, formatting_rules, is_custom, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, TRUE, $10)
      RETURNING *
    `, [data.los_field_id, data.los_field_name || null, data.coheus_alias || null, data.display_name, data.data_type,
        data.category || null, data.description || null, data.visible_to_personas || null, JSON.stringify(data.formatting_rules || {}), req.userId]);
    
    logInfo('Custom field created', { userId: req.userId, fieldId: result.rows[0].id });
    res.status(201).json({ field: result.rows[0] });
  } catch (error: any) {
    if (error.code === '23505') {
      return res.status(400).json({ error: 'A field with this LOS field ID already exists' });
    }
    logError('Error creating custom field', error, { userId: req.userId });
    res.status(500).json({ error: 'Failed to create custom field' });
  }
});

/**
 * PUT /api/tenant-config/fields/:id
 * Update a custom field
 */
router.put('/fields/:id', authenticateToken, attachTenantContext, requireRole('tenant_admin', 'super_admin'), async (req: AuthRequest, res: Response) => {
  try {
    const { tenantPool } = getTenantContext(req);
    const { id } = req.params;
    
    const schema = z.object({
      display_name: z.string().min(1).optional(),
      category: z.string().optional(),
      description: z.string().optional(),
      is_enabled: z.boolean().optional(),
      visible_to_personas: z.array(z.string().uuid()).optional(),
      formatting_rules: z.record(z.any()).optional(),
    });
    
    const data = schema.parse(req.body);
    
    const result = await tenantPool.query(`
      UPDATE public.custom_fields
      SET display_name = COALESCE($1, display_name), category = COALESCE($2, category),
          description = COALESCE($3, description), is_enabled = COALESCE($4, is_enabled),
          visible_to_personas = COALESCE($5, visible_to_personas), formatting_rules = COALESCE($6, formatting_rules),
          updated_at = NOW()
      WHERE id = $7
      RETURNING *
    `, [data.display_name, data.category, data.description, data.is_enabled, data.visible_to_personas,
        data.formatting_rules ? JSON.stringify(data.formatting_rules) : null, id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Field not found' });
    }
    
    logInfo('Custom field updated', { userId: req.userId, fieldId: id });
    res.json({ field: result.rows[0] });
  } catch (error: any) {
    logError('Error updating custom field', error, { userId: req.userId, fieldId: req.params.id });
    res.status(500).json({ error: 'Failed to update custom field' });
  }
});

/**
 * DELETE /api/tenant-config/fields/:id
 * Delete a custom field
 */
router.delete('/fields/:id', authenticateToken, attachTenantContext, requireRole('tenant_admin', 'super_admin'), async (req: AuthRequest, res: Response) => {
  try {
    const { tenantPool } = getTenantContext(req);
    const { id } = req.params;
    
    const result = await tenantPool.query('DELETE FROM public.custom_fields WHERE id = $1 RETURNING id', [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Field not found' });
    }
    
    logInfo('Custom field deleted', { userId: req.userId, fieldId: id });
    res.json({ success: true });
  } catch (error: any) {
    logError('Error deleting custom field', error, { userId: req.userId, fieldId: req.params.id });
    res.status(500).json({ error: 'Failed to delete custom field' });
  }
});

// ============================================
// RANGE RULES
// ============================================

/**
 * GET /api/tenant-config/range-rules
 * List all range rules
 */
router.get('/range-rules', authenticateToken, attachTenantContext, async (req: AuthRequest, res: Response) => {
  try {
    const { tenantPool } = getTenantContext(req);
    
    const result = await tenantPool.query(`
      SELECT id, field_alias, rule_name, description, conditions, min_value, max_value,
             warning_min, warning_max, severity, tooltip_text, violation_message, highlight_color,
             is_active, created_at, updated_at
      FROM public.range_rules
      ORDER BY field_alias, rule_name
    `);
    
    res.json({ rules: result.rows });
  } catch (error: any) {
    logError('Error fetching range rules', error, { userId: req.userId });
    res.status(500).json({ error: 'Failed to fetch range rules' });
  }
});

/**
 * POST /api/tenant-config/range-rules
 * Create a range rule
 */
router.post('/range-rules', authenticateToken, attachTenantContext, requireRole('tenant_admin', 'super_admin'), async (req: AuthRequest, res: Response) => {
  try {
    const { tenantPool } = getTenantContext(req);
    
    const schema = z.object({
      field_alias: z.string().min(1),
      rule_name: z.string().min(1),
      description: z.string().optional(),
      conditions: z.record(z.any()).optional(),
      min_value: z.number().optional(),
      max_value: z.number().optional(),
      warning_min: z.number().optional(),
      warning_max: z.number().optional(),
      severity: z.enum(['info', 'warning', 'critical']).optional(),
      tooltip_text: z.string().optional(),
      violation_message: z.string().optional(),
      highlight_color: z.string().optional(),
    });
    
    const data = schema.parse(req.body);
    
    const result = await tenantPool.query(`
      INSERT INTO public.range_rules (field_alias, rule_name, description, conditions, min_value, max_value,
                                       warning_min, warning_max, severity, tooltip_text, violation_message,
                                       highlight_color, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING *
    `, [data.field_alias, data.rule_name, data.description || null, JSON.stringify(data.conditions || {}),
        data.min_value ?? null, data.max_value ?? null, data.warning_min ?? null, data.warning_max ?? null,
        data.severity || 'warning', data.tooltip_text || null, data.violation_message || null,
        data.highlight_color || null, req.userId]);
    
    logInfo('Range rule created', { userId: req.userId, ruleId: result.rows[0].id });
    res.status(201).json({ rule: result.rows[0] });
  } catch (error: any) {
    logError('Error creating range rule', error, { userId: req.userId });
    res.status(500).json({ error: 'Failed to create range rule' });
  }
});

/**
 * PUT /api/tenant-config/range-rules/:id
 * Update a range rule
 */
router.put('/range-rules/:id', authenticateToken, attachTenantContext, requireRole('tenant_admin', 'super_admin'), async (req: AuthRequest, res: Response) => {
  try {
    const { tenantPool } = getTenantContext(req);
    const { id } = req.params;
    
    const schema = z.object({
      rule_name: z.string().min(1).optional(),
      description: z.string().optional(),
      conditions: z.record(z.any()).optional(),
      min_value: z.number().nullable().optional(),
      max_value: z.number().nullable().optional(),
      warning_min: z.number().nullable().optional(),
      warning_max: z.number().nullable().optional(),
      severity: z.enum(['info', 'warning', 'critical']).optional(),
      tooltip_text: z.string().optional(),
      violation_message: z.string().optional(),
      highlight_color: z.string().optional(),
      is_active: z.boolean().optional(),
    });
    
    const data = schema.parse(req.body);
    
    const result = await tenantPool.query(`
      UPDATE public.range_rules
      SET rule_name = COALESCE($1, rule_name), description = COALESCE($2, description),
          conditions = COALESCE($3, conditions), min_value = COALESCE($4, min_value),
          max_value = COALESCE($5, max_value), warning_min = COALESCE($6, warning_min),
          warning_max = COALESCE($7, warning_max), severity = COALESCE($8, severity),
          tooltip_text = COALESCE($9, tooltip_text), violation_message = COALESCE($10, violation_message),
          highlight_color = COALESCE($11, highlight_color), is_active = COALESCE($12, is_active),
          updated_at = NOW()
      WHERE id = $13
      RETURNING *
    `, [data.rule_name, data.description, data.conditions ? JSON.stringify(data.conditions) : null,
        data.min_value, data.max_value, data.warning_min, data.warning_max, data.severity,
        data.tooltip_text, data.violation_message, data.highlight_color, data.is_active, id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Range rule not found' });
    }
    
    logInfo('Range rule updated', { userId: req.userId, ruleId: id });
    res.json({ rule: result.rows[0] });
  } catch (error: any) {
    logError('Error updating range rule', error, { userId: req.userId, ruleId: req.params.id });
    res.status(500).json({ error: 'Failed to update range rule' });
  }
});

/**
 * DELETE /api/tenant-config/range-rules/:id
 * Delete a range rule
 */
router.delete('/range-rules/:id', authenticateToken, attachTenantContext, requireRole('tenant_admin', 'super_admin'), async (req: AuthRequest, res: Response) => {
  try {
    const { tenantPool } = getTenantContext(req);
    const { id } = req.params;
    
    const result = await tenantPool.query('DELETE FROM public.range_rules WHERE id = $1 RETURNING id', [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Range rule not found' });
    }
    
    logInfo('Range rule deleted', { userId: req.userId, ruleId: id });
    res.json({ success: true });
  } catch (error: any) {
    logError('Error deleting range rule', error, { userId: req.userId, ruleId: req.params.id });
    res.status(500).json({ error: 'Failed to delete range rule' });
  }
});

// ============================================
// SAVED FILTERS
// ============================================

/**
 * GET /api/tenant-config/filters
 * List filters visible to the current user
 */
router.get('/filters', authenticateToken, attachTenantContext, async (req: AuthRequest, res: Response) => {
  try {
    const { tenantPool } = getTenantContext(req);
    
    // Get filters: personal, or org-wide, or matching user's persona
    const result = await tenantPool.query(`
      SELECT f.id, f.name, f.description, f.filter_expression, f.scope, f.owner_id, f.owner_persona_id,
             f.team_ids, f.is_locked, f.is_default, f.icon, f.color, f.sort_order, f.created_at, f.updated_at,
             p.name as persona_name
      FROM public.saved_filters f
      LEFT JOIN public.personas p ON f.owner_persona_id = p.id
      WHERE f.scope = 'organization'
         OR f.owner_id = $1
         OR f.scope = 'personal' AND f.owner_id = $1
      ORDER BY f.sort_order, f.name
    `, [req.userId]);
    
    res.json({ filters: result.rows });
  } catch (error: any) {
    logError('Error fetching filters', error, { userId: req.userId });
    res.status(500).json({ error: 'Failed to fetch filters' });
  }
});

/**
 * POST /api/tenant-config/filters
 * Create a saved filter
 */
router.post('/filters', authenticateToken, attachTenantContext, async (req: AuthRequest, res: Response) => {
  try {
    const { tenantPool } = getTenantContext(req);
    
    const schema = z.object({
      name: z.string().min(1),
      description: z.string().optional(),
      filter_expression: z.record(z.any()),
      scope: z.enum(['personal', 'team', 'persona', 'organization']),
      owner_persona_id: z.string().uuid().optional(),
      team_ids: z.array(z.string().uuid()).optional(),
      icon: z.string().optional(),
      color: z.string().optional(),
    });
    
    const data = schema.parse(req.body);
    
    // Only admins can create org-wide filters
    if (data.scope === 'organization') {
      const userRole = req.userRole || 'user';
      if (!['tenant_admin', 'super_admin'].includes(userRole)) {
        return res.status(403).json({ error: 'Only admins can create organization-wide filters' });
      }
    }
    
    const result = await tenantPool.query(`
      INSERT INTO public.saved_filters (name, description, filter_expression, scope, owner_id, owner_persona_id,
                                         team_ids, icon, color, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *
    `, [data.name, data.description || null, JSON.stringify(data.filter_expression), data.scope, req.userId,
        data.owner_persona_id || null, data.team_ids || null, data.icon || null, data.color || null, req.userId]);
    
    logInfo('Filter created', { userId: req.userId, filterId: result.rows[0].id });
    res.status(201).json({ filter: result.rows[0] });
  } catch (error: any) {
    logError('Error creating filter', error, { userId: req.userId });
    res.status(500).json({ error: 'Failed to create filter' });
  }
});

/**
 * PUT /api/tenant-config/filters/:id
 * Update a saved filter
 */
router.put('/filters/:id', authenticateToken, attachTenantContext, async (req: AuthRequest, res: Response) => {
  try {
    const { tenantPool } = getTenantContext(req);
    const { id } = req.params;
    
    // Check ownership or admin status
    const checkResult = await tenantPool.query('SELECT owner_id, is_locked, scope FROM public.saved_filters WHERE id = $1', [id]);
    if (checkResult.rows.length === 0) {
      return res.status(404).json({ error: 'Filter not found' });
    }
    
    const filter = checkResult.rows[0];
    const userRole = req.userRole || 'user';
    const isAdmin = ['tenant_admin', 'super_admin'].includes(userRole);
    
    if (filter.is_locked && !isAdmin) {
      return res.status(403).json({ error: 'This filter is locked and cannot be modified' });
    }
    
    if (filter.owner_id !== req.userId && !isAdmin) {
      return res.status(403).json({ error: 'You can only modify your own filters' });
    }
    
    const schema = z.object({
      name: z.string().min(1).optional(),
      description: z.string().optional(),
      filter_expression: z.record(z.any()).optional(),
      is_locked: z.boolean().optional(),
      is_default: z.boolean().optional(),
      icon: z.string().optional(),
      color: z.string().optional(),
      sort_order: z.number().optional(),
    });
    
    const data = schema.parse(req.body);
    
    const result = await tenantPool.query(`
      UPDATE public.saved_filters
      SET name = COALESCE($1, name), description = COALESCE($2, description),
          filter_expression = COALESCE($3, filter_expression), is_locked = COALESCE($4, is_locked),
          is_default = COALESCE($5, is_default), icon = COALESCE($6, icon), color = COALESCE($7, color),
          sort_order = COALESCE($8, sort_order), updated_at = NOW()
      WHERE id = $9
      RETURNING *
    `, [data.name, data.description, data.filter_expression ? JSON.stringify(data.filter_expression) : null,
        isAdmin ? data.is_locked : null, data.is_default, data.icon, data.color, data.sort_order, id]);
    
    logInfo('Filter updated', { userId: req.userId, filterId: id });
    res.json({ filter: result.rows[0] });
  } catch (error: any) {
    logError('Error updating filter', error, { userId: req.userId, filterId: req.params.id });
    res.status(500).json({ error: 'Failed to update filter' });
  }
});

/**
 * DELETE /api/tenant-config/filters/:id
 * Delete a saved filter
 */
router.delete('/filters/:id', authenticateToken, attachTenantContext, async (req: AuthRequest, res: Response) => {
  try {
    const { tenantPool } = getTenantContext(req);
    const { id } = req.params;
    
    const checkResult = await tenantPool.query('SELECT owner_id, is_locked FROM public.saved_filters WHERE id = $1', [id]);
    if (checkResult.rows.length === 0) {
      return res.status(404).json({ error: 'Filter not found' });
    }
    
    const filter = checkResult.rows[0];
    const userRole = req.userRole || 'user';
    const isAdmin = ['tenant_admin', 'super_admin'].includes(userRole);
    
    if (filter.is_locked && !isAdmin) {
      return res.status(403).json({ error: 'This filter is locked and cannot be deleted' });
    }
    
    if (filter.owner_id !== req.userId && !isAdmin) {
      return res.status(403).json({ error: 'You can only delete your own filters' });
    }
    
    await tenantPool.query('DELETE FROM public.saved_filters WHERE id = $1', [id]);
    
    logInfo('Filter deleted', { userId: req.userId, filterId: id });
    res.json({ success: true });
  } catch (error: any) {
    logError('Error deleting filter', error, { userId: req.userId, filterId: req.params.id });
    res.status(500).json({ error: 'Failed to delete filter' });
  }
});

// ============================================
// SCORING WEIGHTS
// ============================================

/**
 * GET /api/tenant-config/scoring-weights/:scorecardType
 * Get scoring weights for a scorecard type
 */
router.get('/scoring-weights/:scorecardType', authenticateToken, attachTenantContext, async (req: AuthRequest, res: Response) => {
  try {
    const { tenantPool } = getTenantContext(req);
    const { scorecardType } = req.params;
    const personaId = req.query.persona_id as string | undefined;
    
    const result = await tenantPool.query(`
      SELECT id, scorecard_type, persona_id, metric_name, weight, is_active, description, created_at, updated_at
      FROM public.scoring_weights
      WHERE scorecard_type = $1 AND (persona_id = $2 OR persona_id IS NULL)
      ORDER BY persona_id NULLS LAST, metric_name
    `, [scorecardType, personaId || null]);
    
    // Group by persona_id
    const weights: Record<string, any[]> = { default: [] };
    for (const row of result.rows) {
      const key = row.persona_id || 'default';
      if (!weights[key]) weights[key] = [];
      weights[key].push(row);
    }
    
    res.json({ weights, scorecardType });
  } catch (error: any) {
    logError('Error fetching scoring weights', error, { userId: req.userId, scorecardType: req.params.scorecardType });
    res.status(500).json({ error: 'Failed to fetch scoring weights' });
  }
});

/**
 * PUT /api/tenant-config/scoring-weights/:scorecardType
 * Update scoring weights for a scorecard type
 */
router.put('/scoring-weights/:scorecardType', authenticateToken, attachTenantContext, requireRole('tenant_admin', 'super_admin'), async (req: AuthRequest, res: Response) => {
  try {
    const { tenantPool } = getTenantContext(req);
    const { scorecardType } = req.params;
    
    const schema = z.object({
      persona_id: z.string().uuid().nullable().optional(),
      weights: z.array(z.object({
        metric_name: z.string(),
        weight: z.number().min(0).max(1),
        description: z.string().optional(),
      })),
    });
    
    const data = schema.parse(req.body);
    
    // Validate weights sum to 1.0 (with tolerance for floating point)
    const totalWeight = data.weights.reduce((sum, w) => sum + w.weight, 0);
    if (Math.abs(totalWeight - 1.0) > 0.01) {
      return res.status(400).json({ error: `Weights must sum to 1.0 (current sum: ${totalWeight.toFixed(2)})` });
    }
    
    // Upsert each weight
    const results = [];
    for (const w of data.weights) {
      const result = await tenantPool.query(`
        INSERT INTO public.scoring_weights (scorecard_type, persona_id, metric_name, weight, description, created_by)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (scorecard_type, persona_id, metric_name)
        DO UPDATE SET weight = $4, description = COALESCE($5, scoring_weights.description), updated_at = NOW()
        RETURNING *
      `, [scorecardType, data.persona_id || null, w.metric_name, w.weight, w.description || null, req.userId]);
      results.push(result.rows[0]);
    }
    
    logInfo('Scoring weights updated', { userId: req.userId, scorecardType, personaId: data.persona_id });
    res.json({ weights: results });
  } catch (error: any) {
    logError('Error updating scoring weights', error, { userId: req.userId, scorecardType: req.params.scorecardType });
    res.status(500).json({ error: 'Failed to update scoring weights' });
  }
});

// ============================================
// COMPLEXITY COMPONENTS
// ============================================

/**
 * GET /api/tenant-config/complexity
 * Get loan complexity component configurations
 */
router.get('/complexity', authenticateToken, attachTenantContext, async (req: AuthRequest, res: Response) => {
  try {
    const { tenantPool } = getTenantContext(req);
    
    const result = await tenantPool.query(`
      SELECT id, component_name, condition_value, weight, description, is_active, created_at, updated_at
      FROM public.complexity_components
      ORDER BY component_name, condition_value
    `);
    
    // Group by component_name
    const components: Record<string, any[]> = {};
    for (const row of result.rows) {
      if (!components[row.component_name]) components[row.component_name] = [];
      components[row.component_name].push(row);
    }
    
    res.json({ components });
  } catch (error: any) {
    logError('Error fetching complexity components', error, { userId: req.userId });
    res.status(500).json({ error: 'Failed to fetch complexity components' });
  }
});

/**
 * PUT /api/tenant-config/complexity/:componentName
 * Update complexity component weights
 */
router.put('/complexity/:componentName', authenticateToken, attachTenantContext, requireRole('tenant_admin', 'super_admin'), async (req: AuthRequest, res: Response) => {
  try {
    const { tenantPool } = getTenantContext(req);
    const { componentName } = req.params;
    
    const schema = z.object({
      values: z.array(z.object({
        condition_value: z.string(),
        weight: z.number(),
        description: z.string().optional(),
        is_active: z.boolean().optional(),
      })),
    });
    
    const data = schema.parse(req.body);
    
    const results = [];
    for (const v of data.values) {
      const result = await tenantPool.query(`
        INSERT INTO public.complexity_components (component_name, condition_value, weight, description, is_active, created_by)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (component_name, condition_value)
        DO UPDATE SET weight = $3, description = COALESCE($4, complexity_components.description), 
                      is_active = COALESCE($5, complexity_components.is_active), updated_at = NOW()
        RETURNING *
      `, [componentName, v.condition_value, v.weight, v.description || null, v.is_active ?? true, req.userId]);
      results.push(result.rows[0]);
    }
    
    logInfo('Complexity components updated', { userId: req.userId, componentName });
    res.json({ components: results });
  } catch (error: any) {
    logError('Error updating complexity components', error, { userId: req.userId, componentName: req.params.componentName });
    res.status(500).json({ error: 'Failed to update complexity components' });
  }
});

// ============================================
// VERSION HISTORY
// ============================================

/**
 * GET /api/tenant-config/versions/:configType
 * Get version history for a config type
 */
router.get('/versions/:configType', authenticateToken, attachTenantContext, async (req: AuthRequest, res: Response) => {
  try {
    const { tenantPool } = getTenantContext(req);
    const { configType } = req.params;
    const configId = req.query.config_id as string | undefined;
    
    let query = `
      SELECT v.id, v.config_type, v.config_id, v.config_data, v.version_number, v.status,
             v.created_by, v.created_at, v.published_at, v.published_by, v.notes,
             u.full_name as created_by_name, u2.full_name as published_by_name
      FROM public.config_versions v
      LEFT JOIN public.users u ON v.created_by = u.id
      LEFT JOIN public.users u2 ON v.published_by = u2.id
      WHERE v.config_type = $1
    `;
    const params: any[] = [configType];
    
    if (configId) {
      query += ` AND v.config_id = $2`;
      params.push(configId);
    }
    
    query += ` ORDER BY v.created_at DESC LIMIT 50`;
    
    const result = await tenantPool.query(query, params);
    
    res.json({ versions: result.rows });
  } catch (error: any) {
    logError('Error fetching version history', error, { userId: req.userId, configType: req.params.configType });
    res.status(500).json({ error: 'Failed to fetch version history' });
  }
});

export default router;
