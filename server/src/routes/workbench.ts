/**
 * Workbench Canvas CRUD Routes
 *
 * All operations persist to the tenant-specific database (via attachTenantContext).
 * Platform admins can target a specific tenant via ?tenant_id= query param.
 *
 * Table: public.workbench_canvases
 *   - migration 035_workbench_canvases.sql (base table)
 *   - migration 050_workbench_canvas_sharing.sql (visibility, sharing columns)
 */
import { Router } from 'express';
import { authenticateToken, AuthRequest } from '../middleware/auth.js';
import {
  attachTenantContext,
  getTenantContext,
} from '../middleware/tenantContext.js';

const router = Router();

/** Roles allowed to set visibility = 'global' */
const GLOBAL_VISIBILITY_ROLES = ['super_admin', 'platform_admin', 'tenant_admin', 'admin'];

// ---------------------------------------------------------------------------
// GET /tenant-users  — List users in the current tenant (for sharing picker)
// Must be defined BEFORE the /:id route to avoid matching "tenant-users" as :id
// ---------------------------------------------------------------------------
router.get(
  '/tenant-users',
  authenticateToken,
  attachTenantContext,
  async (req: AuthRequest, res) => {
    try {
      const { tenantPool } = getTenantContext(req);

      const result = await tenantPool.query(
        `SELECT id, email, full_name, role
         FROM public.users
         WHERE COALESCE(is_active, true) = true
           AND (is_platform_user IS NULL OR is_platform_user = false)
         ORDER BY COALESCE(full_name, email) ASC
         LIMIT 500`,
      );

      res.json({ users: result.rows });
    } catch (error: any) {
      console.error('[Workbench] Error listing tenant users:', error.message);
      res.status(500).json({ error: 'Failed to list tenant users', message: error.message });
    }
  },
);

// ---------------------------------------------------------------------------
// GET /  — List canvases visible to the current user
// Returns own canvases + global canvases + canvases shared with user
// ---------------------------------------------------------------------------
router.get(
  '/',
  authenticateToken,
  attachTenantContext,
  async (req: AuthRequest, res) => {
    try {
      const { tenantPool } = getTenantContext(req);

      const result = await tenantPool.query(
        `SELECT
           c.id, c.title, c.content, c.favorited, c.shared, c.created_at, c.updated_at,
           c.visibility, c.shared_with_user_ids,
           c.user_id,
           (c.user_id = $1) AS is_owner,
           u.email AS owner_email,
           u.full_name AS owner_name
         FROM public.workbench_canvases c
         LEFT JOIN public.users u ON u.id = c.user_id
         WHERE c.user_id = $1
            OR c.visibility = 'global'
            OR (c.visibility = 'shared' AND $1 = ANY(c.shared_with_user_ids))
         ORDER BY c.updated_at DESC`,
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
// GET /:id  — Get a single canvas (owner, global, or shared-with)
// ---------------------------------------------------------------------------
router.get(
  '/:id',
  authenticateToken,
  attachTenantContext,
  async (req: AuthRequest, res) => {
    try {
      const { tenantPool } = getTenantContext(req);

      const result = await tenantPool.query(
        `SELECT
           c.id, c.title, c.content, c.favorited, c.shared,
           c.share_pin, c.share_scope,
           c.visibility, c.shared_with_user_ids,
           c.created_at, c.updated_at,
           c.user_id,
           (c.user_id = $2) AS is_owner,
           u.email AS owner_email,
           u.full_name AS owner_name
         FROM public.workbench_canvases c
         LEFT JOIN public.users u ON u.id = c.user_id
         WHERE c.id = $1
           AND (
             c.user_id = $2
             OR c.visibility = 'global'
             OR (c.visibility = 'shared' AND $2 = ANY(c.shared_with_user_ids))
           )`,
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
        visibility: reqVisibility,
        shared_with_user_ids: reqSharedWith,
      } = req.body;

      // Validate visibility
      let visibility: string = reqVisibility ?? 'private';
      if (!['private', 'global', 'shared'].includes(visibility)) {
        visibility = 'private';
      }
      // Only admins can create global canvases
      if (visibility === 'global' && !GLOBAL_VISIBILITY_ROLES.includes(req.userRole || '')) {
        return res.status(403).json({ error: 'Only admins can create global canvases' });
      }

      const sharedWith: string[] = Array.isArray(reqSharedWith) ? reqSharedWith : [];
      const createdByRole = req.userRole || 'user';

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

      const result = await tenantPool.query(
        `INSERT INTO public.workbench_canvases
           (user_id, title, layout_version, content, visibility, created_by_role, shared_with_user_ids)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, title, visibility, created_at, updated_at`,
        [req.userId, title, layoutVersion, JSON.stringify(content), visibility, createdByRole, sharedWith],
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
// POST /:id/share  — Legacy share endpoint (kept for backward compat)
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

// ---------------------------------------------------------------------------
// PUT /:id/visibility  — Update canvas visibility / sharing settings
// ---------------------------------------------------------------------------
router.put(
  '/:id/visibility',
  authenticateToken,
  attachTenantContext,
  async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const { visibility, shared_with_user_ids } = req.body;
      const { tenantPool } = getTenantContext(req);

      // Ownership check — only owners can change visibility
      const ownership = await tenantPool.query(
        'SELECT id, visibility FROM public.workbench_canvases WHERE id = $1 AND user_id = $2',
        [id, req.userId],
      );
      if (ownership.rows.length === 0) {
        return res.status(404).json({ error: 'Canvas not found or you are not the owner' });
      }

      // Validate visibility value
      if (!['private', 'global', 'shared'].includes(visibility)) {
        return res.status(400).json({ error: 'Invalid visibility. Must be private, global, or shared.' });
      }

      // Only admins can set global
      if (visibility === 'global' && !GLOBAL_VISIBILITY_ROLES.includes(req.userRole || '')) {
        return res.status(403).json({ error: 'Only admins can set global visibility' });
      }

      const sharedWith: string[] = Array.isArray(shared_with_user_ids) ? shared_with_user_ids : [];

      const result = await tenantPool.query(
        `UPDATE public.workbench_canvases
         SET visibility = $1, shared_with_user_ids = $2, updated_at = NOW()
         WHERE id = $3 AND user_id = $4
         RETURNING id, visibility, shared_with_user_ids`,
        [visibility, sharedWith, id, req.userId],
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Canvas not found' });
      }

      res.json({ success: true, ...result.rows[0] });
    } catch (error: any) {
      console.error('[Workbench] Error updating visibility:', error.message);
      res.status(500).json({ error: 'Failed to update visibility', message: error.message });
    }
  },
);

// ---------------------------------------------------------------------------
// POST /from-insight  — Create a deep-dive canvas from a stored insight
// ---------------------------------------------------------------------------
import { generateDeepDiveWidgets, type SourceInsightMeta } from '../services/workbench/insightDeepDive.js';

router.post(
  '/from-insight',
  authenticateToken,
  attachTenantContext,
  async (req: AuthRequest, res) => {
    try {
      const { insightId } = req.body;
      if (!insightId) {
        return res.status(400).json({ error: 'insightId is required' });
      }

      const { tenantPool } = getTenantContext(req);

      // Load the insight from generated_insights
      const insightRes = await tenantPool.query(
        `SELECT id, headline, source, bucket, detail_query
         FROM public.generated_insights
         WHERE id = $1`,
        [insightId],
      );

      if (insightRes.rows.length === 0) {
        return res.status(404).json({ error: 'Insight not found' });
      }

      const row = insightRes.rows[0];
      const meta: SourceInsightMeta = {
        id: row.id,
        headline: row.headline || '',
        source: row.source || 'performance',
        bucket: row.bucket || 'working',
        detail_query: row.detail_query || null,
      };

      // Generate widgets
      const widgets = await generateDeepDiveWidgets(tenantPool, meta);

      // ─── Smart layout: charts get more space, tables get full width ───
      // Separate widgets by viz type for intelligent placement
      const chartWidgets = widgets.filter(w => ['line', 'bar', 'horizontal_bar', 'donut', 'area'].includes(w.vizConfig.type));
      const tableWidgets = widgets.filter(w => w.vizConfig.type === 'table');

      // Widget sizes are designed for the panel-open viewport (~1050px usable).
      // The frontend auto-scales items when the Cohi panel opens/closes, but
      // starting at the right size avoids the initial reflow.
      const FULL_WIDTH = 1020;       // full-width widget (fits with panel open)
      const HALF_WIDTH = 496;        // half-width for side-by-side charts (496+24+496=1016)
      const CHART_HEIGHT = 460;      // taller charts for readability
      const TABLE_HEIGHT = 420;      // tables need height for rows
      const GAP = 24;
      const LEFT_MARGIN = 12;

      const ts = Date.now();
      const layout: any[] = [];
      let cursorY = GAP;

      // ─── Charts section: first chart full-width (hero), rest in pairs ───
      chartWidgets.forEach((w, idx) => {
        const isHero = idx === 0;
        const isOdd = chartWidgets.length > 1 && idx > 0;
        const pairIdx = isOdd ? idx - 1 : 0; // pair index within the non-hero set
        const col = isOdd ? ((pairIdx) % 2) : 0;

        let x: number, y: number, width: number;

        if (isHero) {
          // First chart spans full width as the hero visualization
          x = LEFT_MARGIN;
          y = cursorY;
          width = FULL_WIDTH;
          cursorY += CHART_HEIGHT + GAP;
        } else {
          // Subsequent charts in 2-column layout
          if (col === 0) {
            // Left column — also advances cursorY for the row when we start a new pair
          }
          x = LEFT_MARGIN + col * (HALF_WIDTH + GAP);
          y = cursorY;
          width = HALF_WIDTH;
          // Advance cursorY when we complete a row (right col or last odd item)
          if (col === 1 || idx === chartWidgets.length - 1) {
            cursorY += CHART_HEIGHT + GAP;
          }
        }

        layout.push({
          i: `deep-dive-${ts}-chart-${idx}`,
          x,
          y,
          w: width,
          h: CHART_HEIGHT,
          type: 'widget_group' as const,
          payload: {
            type: 'widget_group' as const,
            groupId: `dd-grp-${ts}-chart-${idx}`,
            title: w.title,
            sectionType: 'company-scorecard',
            widgetIds: [],
            filtersCollapsed: true,
            items: [
              {
                kind: 'cohi' as const,
                id: `cohi-dd-${ts}-chart-${idx}`,
                sql: w.sql,
                title: w.title,
                vizConfig: w.vizConfig,
                explanation: w.explanation,
              },
            ],
          },
        });
      });

      // ─── Tables section: each gets full width for readability ───
      tableWidgets.forEach((w, idx) => {
        layout.push({
          i: `deep-dive-${ts}-table-${idx}`,
          x: LEFT_MARGIN,
          y: cursorY,
          w: FULL_WIDTH,
          h: TABLE_HEIGHT,
          type: 'widget_group' as const,
          payload: {
            type: 'widget_group' as const,
            groupId: `dd-grp-${ts}-table-${idx}`,
            title: w.title,
            sectionType: 'company-scorecard',
            widgetIds: [],
            filtersCollapsed: true,
            items: [
              {
                kind: 'cohi' as const,
                id: `cohi-dd-${ts}-table-${idx}`,
                sql: w.sql,
                title: w.title,
                vizConfig: w.vizConfig,
                explanation: w.explanation,
              },
            ],
          },
        });
        cursorY += TABLE_HEIGHT + GAP;
      });

      // Build source insight metadata for the canvas
      const sourceInsight = {
        id: meta.id,
        headline: meta.headline,
        source: meta.source,
        bucket: meta.bucket,
        detail_query: meta.detail_query,
      };

      const content = {
        layoutVersion: 'freeform-v1',
        layout,
        annotations: [],
        background: { type: 'color', value: '#ffffff' },
        uploadsMeta: [],
        sourceInsight,
      };

      // Create the canvas
      const canvasTitle = `Deep Dive: ${meta.headline.substring(0, 60)}${meta.headline.length > 60 ? '...' : ''}`;
      const createRes = await tenantPool.query(
        `INSERT INTO public.workbench_canvases
           (user_id, title, layout_version, content, created_by_role)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, title, created_at, updated_at`,
        [req.userId, canvasTitle, 'freeform-v1', JSON.stringify(content), req.userRole || 'user'],
      );

      console.log(`[Workbench] Created deep-dive canvas ${createRes.rows[0].id} for insight ${insightId}`);
      res.json(createRes.rows[0]);
    } catch (error: any) {
      console.error('[Workbench] Error creating deep-dive canvas:', error.message);
      res.status(500).json({ error: 'Failed to create deep-dive canvas', message: error.message });
    }
  },
);

export default router;
