/**
 * Workbench Canvas CRUD Routes
 *
 * All operations persist to the tenant-specific database (via attachTenantContext).
 * Platform admins can target a specific tenant via ?tenant_id= query param.
 *
 * Table: public.workbench_canvases (created in tenantDatabaseSchema.ts)
 */
import { Router } from 'express';
import { authenticateToken, AuthRequest } from '../middleware/auth.js';
import {
  attachTenantContext,
  getTenantContext,
} from '../middleware/tenantContext.js';

const router = Router();

// ---------------------------------------------------------------------------
// Ensure table exists (on-demand, idempotent)
// ---------------------------------------------------------------------------
async function ensureCanvasTable(pool: import('pg').Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.workbench_canvases (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL,
      title TEXT NOT NULL DEFAULT 'Untitled Canvas',
      layout_version TEXT NOT NULL DEFAULT 'freeform-v1',
      content JSONB NOT NULL DEFAULT '{}'::jsonb,
      favorited BOOLEAN DEFAULT false,
      shared BOOLEAN DEFAULT false,
      share_pin TEXT,
      share_scope TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_workbench_canvases_user_id
      ON public.workbench_canvases(user_id)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_workbench_canvases_updated
      ON public.workbench_canvases(updated_at DESC)
  `);
}

// ---------------------------------------------------------------------------
// GET /  — List canvases for the current user
// ---------------------------------------------------------------------------
router.get(
  '/',
  authenticateToken,
  attachTenantContext,
  async (req: AuthRequest, res) => {
    try {
      const { tenantPool } = getTenantContext(req);
      await ensureCanvasTable(tenantPool);

      const result = await tenantPool.query(
        `SELECT id, title, content, favorited, shared, created_at, updated_at
         FROM public.workbench_canvases
         WHERE user_id = $1
         ORDER BY updated_at DESC`,
        [req.userId],
      );

      res.json({ canvases: result.rows });
    } catch (error: any) {
      console.error('[Workbench] Error listing canvases:', error.message);
      res.status(500).json({ error: 'Failed to list canvases', message: error.message });
    }
  },
);

// ---------------------------------------------------------------------------
// GET /:id  — Get a single canvas
// ---------------------------------------------------------------------------
router.get(
  '/:id',
  authenticateToken,
  attachTenantContext,
  async (req: AuthRequest, res) => {
    try {
      const { tenantPool } = getTenantContext(req);
      await ensureCanvasTable(tenantPool);

      const result = await tenantPool.query(
        `SELECT id, title, content, favorited, shared, share_pin, share_scope,
                created_at, updated_at
         FROM public.workbench_canvases
         WHERE id = $1 AND user_id = $2`,
        [req.params.id, req.userId],
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Canvas not found' });
      }

      res.json(result.rows[0]);
    } catch (error: any) {
      console.error('[Workbench] Error getting canvas:', error.message);
      res.status(500).json({ error: 'Failed to get canvas', message: error.message });
    }
  },
);

// ---------------------------------------------------------------------------
// POST /  — Create a new canvas
// ---------------------------------------------------------------------------
router.post(
  '/',
  authenticateToken,
  attachTenantContext,
  async (req: AuthRequest, res) => {
    try {
      const {
        title = 'Untitled Canvas',
        layoutVersion = 'freeform-v1',
        layout,
        annotations,
        background,
        uploadsMeta,
        content: rawContent,
      } = req.body;

      // Support both flat fields (from "Open in Workbench") and a pre-packed
      // content object (from future callers).
      const content = rawContent ?? {
        layoutVersion,
        layout: layout ?? [],
        annotations: annotations ?? [],
        background: background ?? { type: 'color', value: '#ffffff' },
        uploadsMeta: uploadsMeta ?? [],
      };

      const { tenantPool } = getTenantContext(req);
      await ensureCanvasTable(tenantPool);

      const result = await tenantPool.query(
        `INSERT INTO public.workbench_canvases
           (user_id, title, layout_version, content)
         VALUES ($1, $2, $3, $4)
         RETURNING id, title, created_at, updated_at`,
        [req.userId, title, layoutVersion, JSON.stringify(content)],
      );

      res.json(result.rows[0]);
    } catch (error: any) {
      console.error('[Workbench] Error creating canvas:', error.message);
      res.status(500).json({ error: 'Failed to create canvas', message: error.message });
    }
  },
);

// ---------------------------------------------------------------------------
// PUT /:id  — Update a canvas
// ---------------------------------------------------------------------------
router.put(
  '/:id',
  authenticateToken,
  attachTenantContext,
  async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const { title, content } = req.body;

      const { tenantPool } = getTenantContext(req);
      await ensureCanvasTable(tenantPool);

      // Ownership check
      const ownership = await tenantPool.query(
        'SELECT id FROM public.workbench_canvases WHERE id = $1 AND user_id = $2',
        [id, req.userId],
      );
      if (ownership.rows.length === 0) {
        return res.status(404).json({ error: 'Canvas not found' });
      }

      const updates: string[] = ['updated_at = NOW()'];
      const params: any[] = [];
      let idx = 1;

      if (title !== undefined) {
        updates.push(`title = $${idx++}`);
        params.push(title);
      }
      if (content !== undefined) {
        updates.push(`content = $${idx++}`);
        params.push(JSON.stringify(content));
      }

      params.push(id);

      await tenantPool.query(
        `UPDATE public.workbench_canvases SET ${updates.join(', ')} WHERE id = $${idx}`,
        params,
      );

      res.json({ success: true });
    } catch (error: any) {
      console.error('[Workbench] Error updating canvas:', error.message);
      res.status(500).json({ error: 'Failed to update canvas', message: error.message });
    }
  },
);

// ---------------------------------------------------------------------------
// DELETE /:id  — Delete a canvas
// ---------------------------------------------------------------------------
router.delete(
  '/:id',
  authenticateToken,
  attachTenantContext,
  async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const { tenantPool } = getTenantContext(req);
      await ensureCanvasTable(tenantPool);

      const result = await tenantPool.query(
        'DELETE FROM public.workbench_canvases WHERE id = $1 AND user_id = $2 RETURNING id',
        [id, req.userId],
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Canvas not found' });
      }

      res.json({ success: true });
    } catch (error: any) {
      console.error('[Workbench] Error deleting canvas:', error.message);
      res.status(500).json({ error: 'Failed to delete canvas', message: error.message });
    }
  },
);

// ---------------------------------------------------------------------------
// POST /:id/favorite  — Toggle favorite
// ---------------------------------------------------------------------------
router.post(
  '/:id/favorite',
  authenticateToken,
  attachTenantContext,
  async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const { favorited } = req.body;
      const { tenantPool } = getTenantContext(req);
      await ensureCanvasTable(tenantPool);

      const result = await tenantPool.query(
        `UPDATE public.workbench_canvases
         SET favorited = $1, updated_at = NOW()
         WHERE id = $2 AND user_id = $3
         RETURNING id, favorited`,
        [!!favorited, id, req.userId],
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Canvas not found' });
      }

      res.json({ success: true, favorited: result.rows[0].favorited });
    } catch (error: any) {
      console.error('[Workbench] Error toggling favorite:', error.message);
      res.status(500).json({ error: 'Failed to update favorite', message: error.message });
    }
  },
);

// ---------------------------------------------------------------------------
// POST /:id/share  — Share a canvas (generate or update share settings)
// ---------------------------------------------------------------------------
router.post(
  '/:id/share',
  authenticateToken,
  attachTenantContext,
  async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const { shared, pin, scope } = req.body;
      const { tenantPool } = getTenantContext(req);
      await ensureCanvasTable(tenantPool);

      const result = await tenantPool.query(
        `UPDATE public.workbench_canvases
         SET shared = $1, share_pin = $2, share_scope = $3, updated_at = NOW()
         WHERE id = $4 AND user_id = $5
         RETURNING id, shared, share_pin, share_scope`,
        [!!shared, pin ?? null, scope ?? null, id, req.userId],
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Canvas not found' });
      }

      res.json({ success: true, ...result.rows[0] });
    } catch (error: any) {
      console.error('[Workbench] Error sharing canvas:', error.message);
      res.status(500).json({ error: 'Failed to share canvas', message: error.message });
    }
  },
);

export default router;
