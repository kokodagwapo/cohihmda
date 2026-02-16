import { Router } from 'express';
import { authenticateToken, AuthRequest } from '../middleware/auth.js';
import { attachTenantContext, getTenantContext } from '../middleware/tenantContext.js';
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
 * Middleware to check superadmin/admin access (with dev-friendly override)
 * Uses auth token role instead of querying legacy public.users
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
      const role = req.userRole || 'user';
      if (req.isSuperAdmin || role === 'super_admin' || role === 'platform_admin' || role === 'admin' || role === 'tenant_admin') {
        return next();
      }
      // In dev, allow access even without admin role for local development
      console.log('Dev mode: Allowing access without admin role');
      return next();
    }

    // In production, use strict requireRole
    return requireRole('super_admin', 'platform_admin', 'tenant_admin')(req, res, next);
  } catch (error: any) {
    console.error('Superadmin check error:', error);
    res.status(500).json({ error: 'Access check failed' });
  }
}

/**
 * GET /api/rag/knowledge-base
 * List all knowledge base entries (superadmin only)
 */
router.get('/', authenticateToken, attachTenantContext, requireSuperAdminOrDev, async (req: AuthRequest, res) => {
  try {
    const { tenantPool } = getTenantContext(req);
    const { category, search } = req.query;

    let query = `
      SELECT 
        kb.id,
        kb.title,
        kb.category,
        kb.priority,
        kb.content,
        kb.keywords,
        kb.is_active,
        kb.created_at,
        kb.updated_at,
        kb.created_by,
        kb.updated_by
      FROM rag_knowledge_base kb
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

    query += ` ORDER BY kb.priority DESC, kb.created_at DESC`;

    const result = await tenantPool.query(query, params);

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
router.get('/categories', authenticateToken, attachTenantContext, requireSuperAdminOrDev, async (req: AuthRequest, res) => {
  try {
    const { tenantPool } = getTenantContext(req);
    const result = await tenantPool.query(
      `SELECT DISTINCT category 
       FROM rag_knowledge_base 
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
router.get('/:id', authenticateToken, attachTenantContext, requireSuperAdminOrDev, async (req: AuthRequest, res) => {
  try {
    const { tenantPool } = getTenantContext(req);
    const { id } = req.params;

    const result = await tenantPool.query(
      `SELECT kb.*
      FROM rag_knowledge_base kb
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
router.post('/', authenticateToken, attachTenantContext, requireSuperAdminOrDev, async (req: AuthRequest, res) => {
  try {
    const { tenantPool } = getTenantContext(req);
    const data = knowledgeEntrySchema.parse(req.body);

    const result = await tenantPool.query(
      `INSERT INTO rag_knowledge_base (
        title, category, priority, content, keywords, is_active, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *`,
      [
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
router.put('/:id', authenticateToken, attachTenantContext, requireSuperAdminOrDev, async (req: AuthRequest, res) => {
  try {
    const { tenantPool } = getTenantContext(req);
    const id = req.params.id as string;
    const updates = updateKnowledgeEntrySchema.parse(req.body);

    // Check if entry exists
    const existingResult = await tenantPool.query(
      'SELECT * FROM rag_knowledge_base WHERE id = $1',
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
      UPDATE rag_knowledge_base
      SET ${updateFields.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING *
    `;

    const result = await tenantPool.query(query, values);

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
router.delete('/:id', authenticateToken, attachTenantContext, requireSuperAdminOrDev, async (req: AuthRequest, res) => {
  try {
    const { tenantPool } = getTenantContext(req);
    const id = req.params.id as string;

    // Check if entry exists
    const existingResult = await tenantPool.query(
      'SELECT title FROM rag_knowledge_base WHERE id = $1',
      [id]
    );

    if (existingResult.rows.length === 0) {
      return res.status(404).json({ error: 'Knowledge base entry not found' });
    }

    await tenantPool.query('DELETE FROM rag_knowledge_base WHERE id = $1', [id]);

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
