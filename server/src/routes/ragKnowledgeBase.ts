import { Router } from 'express';
import { pool } from '../config/database.js';
import { authenticateToken, AuthRequest } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import { z } from 'zod';
import { auditLog } from '../services/auditLogger.js';

const router = Router();

// Validation schemas
const knowledgeEntrySchema = z.object({
  title: z.string().min(1).max(500),
  category: z.string().min(1).max(100),
  priority: z.number().int().min(0).max(1000).optional(),
  content: z.string().min(1),
  keywords: z.array(z.string()).optional(),
  is_active: z.boolean().optional(),
  tenant_id: z.string().uuid().optional(),
});

const updateKnowledgeEntrySchema = knowledgeEntrySchema.partial();

/**
 * Middleware to check superadmin access (with dev-friendly override)
 * Allows access in development or if user is super_admin
 */
async function requireSuperAdminOrDev(req: AuthRequest, res: any, next: any) {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Allow access in development environment
    const isDevelopment = process.env.NODE_ENV !== 'production' || 
                          process.env.ALLOW_DEV_ACCESS === 'true';

    if (isDevelopment) {
      // In dev, still check role but allow if admin/super_admin
      try {
        const result = await pool.query(
          `SELECT 
            CASE 
              WHEN u.role = 'super_admin' THEN 'super_admin'
              WHEN u.role = 'admin' THEN 'super_admin'
              ELSE u.role
            END as role
           FROM public.users u
           WHERE u.id = $1`,
          [req.userId]
        );

        if (result.rows.length > 0) {
          const role = result.rows[0].role;
          // Allow admin/super_admin in dev, or if explicitly allowed
          if (role === 'super_admin' || role === 'admin') {
            return next();
          }
        }
      } catch (error) {
        // If we can't check role in dev, allow access (for local development)
        console.log('Dev mode: Allowing access without role check');
        return next();
      }
    }

    // In production, use strict requireRole
    return requireRole('super_admin')(req, res, next);
  } catch (error: any) {
    console.error('Superadmin check error:', error);
    res.status(500).json({ error: 'Access check failed' });
  }
}

/**
 * GET /api/rag/knowledge-base
 * List all knowledge base entries (superadmin only)
 */
router.get('/', authenticateToken, requireSuperAdminOrDev, async (req: AuthRequest, res) => {
  try {
    const { category, search, tenant_id } = req.query;

    let query = `
      SELECT 
        kb.id,
        kb.tenant_id,
        kb.title,
        kb.category,
        kb.priority,
        kb.content,
        kb.keywords,
        kb.is_active,
        kb.created_at,
        kb.updated_at,
        kb.created_by,
        kb.updated_by,
        u1.email as created_by_email,
        u2.email as updated_by_email,
        t.name as tenant_name
      FROM public.rag_knowledge_base kb
      LEFT JOIN public.users u1 ON kb.created_by = u1.id
      LEFT JOIN public.users u2 ON kb.updated_by = u2.id
      LEFT JOIN public.tenants t ON kb.tenant_id = t.id
      WHERE 1=1
    `;
    const params: any[] = [];
    let paramIndex = 1;

    // Filter by category
    if (category && category !== 'All Categories') {
      query += ` AND kb.category = $${paramIndex}`;
      params.push(category);
      paramIndex++;
    }

    // Search in title, content, or keywords
    if (search && typeof search === 'string' && search.trim()) {
      query += ` AND (
        kb.title ILIKE $${paramIndex} OR 
        kb.content ILIKE $${paramIndex} OR
        EXISTS (
          SELECT 1 FROM unnest(kb.keywords) AS keyword 
          WHERE keyword ILIKE $${paramIndex}
        )
      )`;
      params.push(`%${search.trim()}%`);
      paramIndex++;
    }

    // Filter by tenant (optional, for multi-tenant support)
    if (tenant_id && typeof tenant_id === 'string') {
      query += ` AND kb.tenant_id = $${paramIndex}`;
      params.push(tenant_id);
      paramIndex++;
    }

    query += ` ORDER BY kb.priority DESC, kb.created_at DESC`;

    const result = await pool.query(query, params);

    // Audit log
    await auditLog({
      userId: req.userId,
      userEmail: req.userEmail,
      action: 'read',
      resource: 'rag_knowledge_base',
      description: 'Listed knowledge base entries',
      status: 'success',
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    });

    res.json({ entries: result.rows });
  } catch (error: any) {
    console.error('Error fetching knowledge base entries:', error);
    res.status(500).json({ error: 'Failed to fetch knowledge base entries' });
  }
});

/**
 * GET /api/rag/knowledge-base/categories
 * Get all unique categories
 */
router.get('/categories', authenticateToken, requireSuperAdminOrDev, async (req: AuthRequest, res) => {
  try {
    const result = await pool.query(
      `SELECT DISTINCT category 
       FROM public.rag_knowledge_base 
       WHERE category IS NOT NULL 
       ORDER BY category ASC`
    );

    res.json({ categories: result.rows.map(r => r.category) });
  } catch (error: any) {
    console.error('Error fetching categories:', error);
    res.status(500).json({ error: 'Failed to fetch categories' });
  }
});

/**
 * GET /api/rag/knowledge-base/:id
 * Get a single knowledge base entry
 */
router.get('/:id', authenticateToken, requireSuperAdminOrDev, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `SELECT 
        kb.*,
        u1.email as created_by_email,
        u2.email as updated_by_email,
        t.name as tenant_name
      FROM public.rag_knowledge_base kb
      LEFT JOIN public.users u1 ON kb.created_by = u1.id
      LEFT JOIN public.users u2 ON kb.updated_by = u2.id
      LEFT JOIN public.tenants t ON kb.tenant_id = t.id
      WHERE kb.id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Knowledge base entry not found' });
    }

    res.json({ entry: result.rows[0] });
  } catch (error: any) {
    console.error('Error fetching knowledge base entry:', error);
    res.status(500).json({ error: 'Failed to fetch knowledge base entry' });
  }
});

/**
 * POST /api/rag/knowledge-base
 * Create a new knowledge base entry
 */
router.post('/', authenticateToken, requireSuperAdminOrDev, async (req: AuthRequest, res) => {
  try {
    const data = knowledgeEntrySchema.parse(req.body);

    // Get user's tenant_id if not provided
    let tenantId = data.tenant_id;
    if (!tenantId) {
      const profileResult = await pool.query(
        'SELECT tenant_id FROM public.profiles WHERE user_id = $1',
        [req.userId]
      );
      tenantId = profileResult.rows[0]?.tenant_id || null;
    }

    const result = await pool.query(
      `INSERT INTO public.rag_knowledge_base (
        tenant_id, title, category, priority, content, keywords, is_active, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *`,
      [
        tenantId,
        data.title,
        data.category,
        data.priority ?? 100,
        data.content,
        data.keywords || [],
        data.is_active ?? true,
        req.userId,
      ]
    );

    // Audit log
    await auditLog({
      userId: req.userId,
      userEmail: req.userEmail,
      action: 'create',
      resource: 'rag_knowledge_base',
      resourceId: result.rows[0].id,
      description: `Created knowledge base entry: ${data.title}`,
      status: 'success',
      changes: { title: data.title, category: data.category },
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    });

    res.status(201).json({ entry: result.rows[0] });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request data', details: error.errors });
    }
    console.error('Error creating knowledge base entry:', error);
    res.status(500).json({ error: 'Failed to create knowledge base entry' });
  }
});

/**
 * PUT /api/rag/knowledge-base/:id
 * Update a knowledge base entry
 */
router.put('/:id', authenticateToken, requireSuperAdminOrDev, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const updates = updateKnowledgeEntrySchema.parse(req.body);

    // Check if entry exists
    const existingResult = await pool.query(
      'SELECT * FROM public.rag_knowledge_base WHERE id = $1',
      [id]
    );

    if (existingResult.rows.length === 0) {
      return res.status(404).json({ error: 'Knowledge base entry not found' });
    }

    const existing = existingResult.rows[0];

    // Build dynamic UPDATE query
    const updateFields: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    Object.entries(updates).forEach(([key, value]) => {
      if (value !== undefined && key !== 'tenant_id') {
        updateFields.push(`${key} = $${paramIndex}`);
        values.push(value);
        paramIndex++;
      }
    });

    if (updateFields.length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    // Always update updated_at and updated_by
    updateFields.push(`updated_at = NOW()`);
    updateFields.push(`updated_by = $${paramIndex}`);
    values.push(req.userId);
    paramIndex++;

    values.push(id);

    const query = `
      UPDATE public.rag_knowledge_base
      SET ${updateFields.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING *
    `;

    const result = await pool.query(query, values);

    // Audit log
    await auditLog({
      userId: req.userId,
      userEmail: req.userEmail,
      action: 'update',
      resource: 'rag_knowledge_base',
      resourceId: id,
      description: `Updated knowledge base entry: ${existing.title}`,
      status: 'success',
      changes: Object.keys(updates),
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    });

    res.json({ entry: result.rows[0] });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request data', details: error.errors });
    }
    console.error('Error updating knowledge base entry:', error);
    res.status(500).json({ error: 'Failed to update knowledge base entry' });
  }
});

/**
 * DELETE /api/rag/knowledge-base/:id
 * Delete a knowledge base entry
 */
router.delete('/:id', authenticateToken, requireSuperAdminOrDev, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;

    // Check if entry exists
    const existingResult = await pool.query(
      'SELECT title FROM public.rag_knowledge_base WHERE id = $1',
      [id]
    );

    if (existingResult.rows.length === 0) {
      return res.status(404).json({ error: 'Knowledge base entry not found' });
    }

    await pool.query('DELETE FROM public.rag_knowledge_base WHERE id = $1', [id]);

    // Audit log
    await auditLog({
      userId: req.userId,
      userEmail: req.userEmail,
      action: 'delete',
      resource: 'rag_knowledge_base',
      resourceId: id,
      description: `Deleted knowledge base entry: ${existingResult.rows[0].title}`,
      status: 'success',
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    });

    res.json({ message: 'Knowledge base entry deleted successfully' });
  } catch (error: any) {
    console.error('Error deleting knowledge base entry:', error);
    res.status(500).json({ error: 'Failed to delete knowledge base entry' });
  }
});

export default router;
