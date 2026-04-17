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
import type { Pool } from 'pg';
import { authenticateToken, AuthRequest } from '../middleware/auth.js';
import {
  attachTenantContext,
  getTenantContext,
} from '../middleware/tenantContext.js';
import { buildDashboardInsightDeepDiveCanvas } from '../services/workbench/fromDashboardInsightCanvas.js';

const router = Router();

/** Roles allowed to set visibility = 'global' */
const GLOBAL_VISIBILITY_ROLES = ['super_admin', 'platform_admin', 'tenant_admin'];
/** Roles that can fully access all canvases within selected tenant */
const FULL_CANVAS_ACCESS_ROLES = ['super_admin', 'platform_admin'];

function resolveQaAgentRunTag(req: AuthRequest): string | null {
  const headerTag = req.get("X-QA-Agent-Run");
  if (headerTag?.trim()) {
    return headerTag.trim();
  }

  const body = req.body as Record<string, unknown> | undefined;
  if (typeof body?.qaAgentRunTag === "string" && body.qaAgentRunTag.trim()) {
    return body.qaAgentRunTag.trim();
  }

  const metadata =
    body?.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata)
      ? (body.metadata as Record<string, unknown>)
      : null;
  if (typeof metadata?.qaAgentRunTag === "string" && metadata.qaAgentRunTag.trim()) {
    return metadata.qaAgentRunTag.trim();
  }

  return null;
}

function attachQaAgentRunTagToContent(content: unknown, qaAgentRunTag: string | null): unknown {
  if (!qaAgentRunTag) {
    return content;
  }

  const nextContent =
    content && typeof content === "object" && !Array.isArray(content)
      ? { ...(content as Record<string, unknown>) }
      : {};
  const metadata =
    nextContent.metadata &&
    typeof nextContent.metadata === "object" &&
    !Array.isArray(nextContent.metadata)
      ? { ...(nextContent.metadata as Record<string, unknown>) }
      : {};

  return {
    ...nextContent,
    metadata: {
      ...metadata,
      qaAgentRunTag,
    },
  };
}

/**
 * Resolve permission for a user on a canvas: 'owner' | 'editor' | 'viewer'.
 * Uses canvas_share_entries (direct user + group membership); falls back to
 * legacy shared_with_user_ids for backward compat.
 */
async function resolveCanvasPermission(
  tenantPool: Pool,
  canvasId: string,
  userId: string,
  isOwner: boolean,
): Promise<'owner' | 'editor' | 'viewer'> {
  if (isOwner) return 'owner';
  // New table: direct user share
  const direct = await tenantPool.query(
    `SELECT permission FROM public.canvas_share_entries WHERE canvas_id = $1 AND user_id = $2`,
    [canvasId, userId],
  );
  if (direct.rows.length > 0) {
    return direct.rows[0].permission === 'editor' ? 'editor' : 'viewer';
  }
  // New table: via group
  const viaGroup = await tenantPool.query(
    `SELECT e.permission FROM public.canvas_share_entries e
     INNER JOIN public.user_group_memberships m ON m.group_id = e.group_id
     WHERE e.canvas_id = $1 AND m.user_id = $2`,
    [canvasId, userId],
  );
  if (viaGroup.rows.length > 0) {
    const hasEditor = viaGroup.rows.some((r: any) => r.permission === 'editor');
    return hasEditor ? 'editor' : 'viewer';
  }
  // Legacy: shared_with_user_ids implies viewer
  const legacy = await tenantPool.query(
    `SELECT 1 FROM public.workbench_canvases WHERE id = $1 AND visibility = 'shared' AND $2 = ANY(COALESCE(shared_with_user_ids, '{}'))`,
    [canvasId, userId],
  );
  return legacy.rows.length > 0 ? 'viewer' : 'viewer'; // no access will be filtered at list level
}

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
// Returns own + global + shared (via shared_with_user_ids or canvas_share_entries). Includes permission.
// ---------------------------------------------------------------------------
router.get(
  '/',
  authenticateToken,
  attachTenantContext,
  async (req: AuthRequest, res) => {
    try {
      const { tenantPool } = getTenantContext(req);
      const userId = req.userId!;
      const hasFullCanvasAccess = FULL_CANVAS_ACCESS_ROLES.includes(req.userRole || '');

      const result = hasFullCanvasAccess
        ? await tenantPool.query(
            `SELECT
           c.id, c.title, c.content, c.favorited, c.shared, c.created_at, c.updated_at,
           c.visibility, c.shared_with_user_ids,
           c.user_id,
           (c.user_id = $1) AS is_owner,
           u.email AS owner_email,
           u.full_name AS owner_name
         FROM public.workbench_canvases c
         LEFT JOIN public.users u ON u.id = c.user_id
         ORDER BY c.updated_at DESC`,
            [userId],
          )
        : await tenantPool.query(
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
            OR (c.visibility = 'shared' AND $1 = ANY(COALESCE(c.shared_with_user_ids, '{}')))
            OR (c.visibility = 'shared' AND EXISTS (
              SELECT 1 FROM public.canvas_share_entries e
              WHERE e.canvas_id = c.id AND (e.user_id = $1 OR e.group_id IN (
                SELECT m.group_id FROM public.user_group_memberships m WHERE m.user_id = $1
              ))
            ))
         ORDER BY c.updated_at DESC`,
            [userId],
          );

      // Resolve permission for each canvas (owner vs editor vs viewer from share entries)
      const permRows = await tenantPool.query(
        `SELECT e.canvas_id,
                MAX(CASE WHEN e.permission = 'editor' THEN 2 ELSE 1 END) AS perm_level
         FROM public.canvas_share_entries e
         WHERE e.user_id = $1
            OR (e.group_id IS NOT NULL AND EXISTS (
              SELECT 1 FROM public.user_group_memberships m WHERE m.group_id = e.group_id AND m.user_id = $1
            ))
         GROUP BY e.canvas_id`,
        [userId],
      );
      const sharePermMap: Record<string, 'editor' | 'viewer'> = {};
      for (const r of permRows.rows) {
        sharePermMap[r.canvas_id] = r.perm_level === 2 ? 'editor' : 'viewer';
      }

      const canvases = result.rows.map((row: any) => {
        const permission = hasFullCanvasAccess
          ? 'owner'
          : row.is_owner
            ? 'owner'
            : (sharePermMap[row.id] ?? (row.visibility === 'shared' && row.shared_with_user_ids?.length ? 'viewer' : 'viewer'));
        return { ...row, permission };
      });

      res.json({ canvases });
    } catch (error: any) {
      console.error('[Workbench] Error listing canvases:', error.message);
      res.status(500).json({ error: 'Failed to list canvases', message: error.message });
    }
  },
);

// ---------------------------------------------------------------------------
// GET /:id  — Get a single canvas (owner, global, or shared-with). Returns permission.
// ---------------------------------------------------------------------------
router.get(
  '/:id',
  authenticateToken,
  attachTenantContext,
  async (req: AuthRequest, res) => {
    try {
      const { tenantPool } = getTenantContext(req);
      const canvasId = req.params.id;
      const userId = req.userId!;
      const hasFullCanvasAccess = FULL_CANVAS_ACCESS_ROLES.includes(req.userRole || '');

      const result = hasFullCanvasAccess
        ? await tenantPool.query(
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
         WHERE c.id = $1`,
            [canvasId, userId],
          )
        : await tenantPool.query(
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
             OR (c.visibility = 'shared' AND $2 = ANY(COALESCE(c.shared_with_user_ids, '{}')))
             OR (c.visibility = 'shared' AND EXISTS (
               SELECT 1 FROM public.canvas_share_entries e
               WHERE e.canvas_id = c.id AND (e.user_id = $2 OR e.group_id IN (
                 SELECT m.group_id FROM public.user_group_memberships m WHERE m.user_id = $2
               ))
             ))
           )`,
            [canvasId, userId],
          );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Canvas not found' });
      }

      const row = result.rows[0];
      const permission = hasFullCanvasAccess
        ? 'owner'
        : await resolveCanvasPermission(
            tenantPool,
            canvasId as string,
            userId,
            !!row.is_owner,
          );
      let shares: Array<{ userId?: string; groupId?: string; permission: string }> = [];
      if (row.is_owner || hasFullCanvasAccess) {
        const shareRows = await tenantPool.query(
          `SELECT user_id, group_id, permission FROM public.canvas_share_entries WHERE canvas_id = $1`,
          [canvasId],
        );
        shares = shareRows.rows.map((r: any) => ({
          userId: r.user_id || undefined,
          groupId: r.group_id || undefined,
          permission: r.permission || 'viewer',
        }));
      }
      res.json({ ...row, permission, shares });
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
      const qaAgentRunTag = resolveQaAgentRunTag(req);

      // Support both flat fields (from "Open in Workbench") and a pre-packed
      // content object (from future callers).
      const content = attachQaAgentRunTagToContent(rawContent ?? {
        layoutVersion,
        layout: layout ?? [],
        annotations: annotations ?? [],
        background: background ?? { type: 'color', value: '#ffffff' },
        uploadsMeta: uploadsMeta ?? [],
      }, qaAgentRunTag);

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
// PUT /:id  — Update a canvas (owner or editor only; viewer gets 403)
// ---------------------------------------------------------------------------
router.put(
  '/:id',
  authenticateToken,
  attachTenantContext,
  async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const { title, content } = req.body;
      const qaAgentRunTag = resolveQaAgentRunTag(req);

      const { tenantPool } = getTenantContext(req);
      const hasFullCanvasAccess = FULL_CANVAS_ACCESS_ROLES.includes(req.userRole || '');

      const canvasRow = await tenantPool.query(
        'SELECT id, user_id FROM public.workbench_canvases WHERE id = $1',
        [id],
      );
      if (canvasRow.rows.length === 0) {
        return res.status(404).json({ error: 'Canvas not found' });
      }
      const isOwner = canvasRow.rows[0].user_id === req.userId;
      const permission = hasFullCanvasAccess
        ? 'owner'
        : await resolveCanvasPermission(tenantPool, id as string, req.userId!, isOwner);
      if (!hasFullCanvasAccess && permission === 'viewer') {
        return res.status(403).json({ error: 'Viewers cannot edit this canvas' });
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
        params.push(JSON.stringify(attachQaAgentRunTagToContent(content, qaAgentRunTag)));
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
      const hasFullCanvasAccess = FULL_CANVAS_ACCESS_ROLES.includes(req.userRole || '');

      const result = hasFullCanvasAccess
        ? await tenantPool.query(
            'DELETE FROM public.workbench_canvases WHERE id = $1 RETURNING id',
            [id],
          )
        : await tenantPool.query(
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
      const userId = req.userId!;
      const hasFullCanvasAccess = FULL_CANVAS_ACCESS_ROLES.includes(req.userRole || '');

      const result = hasFullCanvasAccess
        ? await tenantPool.query(
            `UPDATE public.workbench_canvases
             SET favorited = $1, updated_at = NOW()
             WHERE id = $2
             RETURNING id, favorited`,
            [!!favorited, id],
          )
        : await tenantPool.query(
            `UPDATE public.workbench_canvases c
             SET favorited = $1, updated_at = NOW()
             WHERE c.id = $2
               AND (
                 c.user_id = $3
                 OR c.visibility = 'global'
                 OR (c.visibility = 'shared' AND $3 = ANY(COALESCE(c.shared_with_user_ids, '{}')))
                 OR (c.visibility = 'shared' AND EXISTS (
                   SELECT 1
                   FROM public.canvas_share_entries e
                   WHERE e.canvas_id = c.id
                     AND (e.user_id = $3 OR e.group_id IN (
                       SELECT m.group_id
                       FROM public.user_group_memberships m
                       WHERE m.user_id = $3
                     ))
                 ))
               )
             RETURNING c.id, c.favorited`,
            [!!favorited, id, userId],
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
// Accepts shares: [{ userId?, groupId?, permission: 'viewer'|'editor' }]. Backward compat: shared_with_user_ids.
// ---------------------------------------------------------------------------
router.put(
  '/:id/visibility',
  authenticateToken,
  attachTenantContext,
  async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const { visibility, shared_with_user_ids, shares } = req.body;
      const { tenantPool } = getTenantContext(req);
      const hasFullCanvasAccess = FULL_CANVAS_ACCESS_ROLES.includes(req.userRole || '');

      // Ownership check — only owners can change visibility
      const ownership = await tenantPool.query(
        'SELECT id, visibility FROM public.workbench_canvases WHERE id = $1 AND user_id = $2',
        [id, req.userId],
      );
      if (ownership.rows.length === 0 && !hasFullCanvasAccess) {
        return res.status(404).json({ error: 'Canvas not found or you are not the owner' });
      }
      if (ownership.rows.length === 0 && hasFullCanvasAccess) {
        const exists = await tenantPool.query(
          'SELECT id FROM public.workbench_canvases WHERE id = $1',
          [id],
        );
        if (exists.rows.length === 0) {
          return res.status(404).json({ error: 'Canvas not found' });
        }
      }

      // Validate visibility value
      if (!['private', 'global', 'shared'].includes(visibility)) {
        return res.status(400).json({ error: 'Invalid visibility. Must be private, global, or shared.' });
      }

      // Only admins can set global
      if (visibility === 'global' && !GLOBAL_VISIBILITY_ROLES.includes(req.userRole || '')) {
        return res.status(403).json({ error: 'Only admins can set global visibility' });
      }

      const sharedWithLegacy: string[] = Array.isArray(shared_with_user_ids) ? shared_with_user_ids : [];
      const sharesList: Array<{ userId?: string; groupId?: string; permission?: string }> = Array.isArray(shares) ? shares : [];
      const client = await tenantPool.connect();
      let resultRows: any[] = [];
      try {
        await client.query('BEGIN');

        // Sync canvas_share_entries: replace with new shares when visibility = 'shared'
        if (visibility === 'shared') {
          await client.query('DELETE FROM public.canvas_share_entries WHERE canvas_id = $1', [id]);
          for (const s of sharesList) {
            const perm = (s.permission === 'editor' ? 'editor' : 'viewer') as 'viewer' | 'editor';
            if (s.userId) {
              await client.query(
                `INSERT INTO public.canvas_share_entries (canvas_id, user_id, permission, shared_by)
                 VALUES ($1, $2, $3, $4)`,
                [id, s.userId, perm, req.userId],
              );
            } else if (s.groupId) {
              await client.query(
                `INSERT INTO public.canvas_share_entries (canvas_id, group_id, permission, shared_by)
                 VALUES ($1, $2, $3, $4)`,
                [id, s.groupId, perm, req.userId],
              );
            }
          }
          // Legacy: ensure shared_with_user_ids is populated from shares for backward compat
          const userIdsFromShares = sharesList.filter(s => s.userId).map(s => s.userId);
          const mergedLegacy = [...new Set([...sharedWithLegacy, ...userIdsFromShares])];
          if (hasFullCanvasAccess) {
            await client.query(
              `UPDATE public.workbench_canvases SET visibility = $1, shared_with_user_ids = $2, updated_at = NOW() WHERE id = $3`,
              [visibility, mergedLegacy, id],
            );
          } else {
            await client.query(
              `UPDATE public.workbench_canvases SET visibility = $1, shared_with_user_ids = $2, updated_at = NOW() WHERE id = $3 AND user_id = $4`,
              [visibility, mergedLegacy, id, req.userId],
            );
          }
        } else {
          if (hasFullCanvasAccess) {
            await client.query(
              `UPDATE public.workbench_canvases SET visibility = $1, shared_with_user_ids = $2, updated_at = NOW() WHERE id = $3`,
              [visibility, visibility === 'private' ? [] : sharedWithLegacy, id],
            );
          } else {
            await client.query(
              `UPDATE public.workbench_canvases SET visibility = $1, shared_with_user_ids = $2, updated_at = NOW() WHERE id = $3 AND user_id = $4`,
              [visibility, visibility === 'private' ? [] : sharedWithLegacy, id, req.userId],
            );
          }
          if (visibility === 'private') {
            await client.query('DELETE FROM public.canvas_share_entries WHERE canvas_id = $1', [id]);
          }
        }

        const result = await client.query(
          `SELECT id, visibility, shared_with_user_ids FROM public.workbench_canvases WHERE id = $1`,
          [id],
        );
        resultRows = result.rows;
        await client.query('COMMIT');
      } catch (txError) {
        await client.query('ROLLBACK');
        throw txError;
      } finally {
        client.release();
      }
      res.json({ success: true, ...resultRows[0] });
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
      const qaAgentRunTag = resolveQaAgentRunTag(req);

      // Create the canvas
      const canvasTitle = `Deep Dive: ${meta.headline.substring(0, 60)}${meta.headline.length > 60 ? '...' : ''}`;
      const createRes = await tenantPool.query(
        `INSERT INTO public.workbench_canvases
           (user_id, title, layout_version, content, created_by_role)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, title, created_at, updated_at`,
        [
          req.userId,
          canvasTitle,
          'freeform-v1',
          JSON.stringify(attachQaAgentRunTagToContent(content, qaAgentRunTag)),
          req.userRole || 'user',
        ],
      );

      console.log(`[Workbench] Created deep-dive canvas ${createRes.rows[0].id} for insight ${insightId}`);
      res.json(createRes.rows[0]);
    } catch (error: any) {
      console.error('[Workbench] Error creating deep-dive canvas:', error.message);
      res.status(500).json({ error: 'Failed to create deep-dive canvas', message: error.message });
    }
  },
);

// ---------------------------------------------------------------------------
// POST /from-dashboard-insight  — Create a deep-dive canvas from a dashboard insight
// ---------------------------------------------------------------------------

function isPlatformStaffRoleWorkbench(role: unknown): boolean {
  return role === 'super_admin' || role === 'platform_admin' || role === 'support';
}

router.post(
  '/from-dashboard-insight',
  authenticateToken,
  attachTenantContext,
  async (req: AuthRequest, res) => {
    try {
      const role = (req as any).userRole || (req as any).role;
      const isPlatformStaff = typeof (req as any).isPlatformStaff === 'function' ? (req as any).isPlatformStaff() : false;
      if (!isPlatformStaff && !isPlatformStaffRoleWorkbench(role)) {
        return res.status(403).json({ error: 'Platform staff access required' });
      }

      const { dashboardInsightId } = req.body || {};
      if (!dashboardInsightId) {
        return res.status(400).json({ error: 'dashboardInsightId is required' });
      }

      const { tenantPool } = getTenantContext(req);
      const insightId = Number(dashboardInsightId);
      if (Number.isNaN(insightId) || insightId <= 0) {
        return res.status(400).json({ error: 'Invalid dashboardInsightId' });
      }

      const rowRes = await tenantPool.query(
        `SELECT id, page_id, page_name, headline, understory, scope, filter_context, evidence_refs
         FROM public.dashboard_generated_insights
         WHERE id = $1`,
        [insightId],
      );
      if (rowRes.rows.length === 0) {
        return res.status(404).json({ error: 'Insight not found' });
      }
      const row = rowRes.rows[0];

      let content: Record<string, unknown>;
      let canvasTitle: string;
      const qaAgentRunTag = resolveQaAgentRunTag(req);
      try {
        const built = buildDashboardInsightDeepDiveCanvas(row);
        content = built.content;
        canvasTitle = built.canvasTitle;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Invalid dashboard insight for deep dive';
        return res.status(400).json({ error: msg });
      }

      const createRes = await tenantPool.query(
        `INSERT INTO public.workbench_canvases
           (user_id, title, layout_version, content, created_by_role)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, title, created_at, updated_at`,
        [
          req.userId,
          canvasTitle,
          'freeform-v1',
          JSON.stringify(attachQaAgentRunTagToContent(content, qaAgentRunTag)),
          req.userRole || 'user',
        ],
      );

      console.log(`[Workbench] Created dashboard deep-dive canvas ${createRes.rows[0].id} for dashboard insight ${insightId}`);
      return res.json(createRes.rows[0]);
    } catch (error: any) {
      console.error('[Workbench] Error creating dashboard deep-dive canvas:', error.message);
      return res.status(500).json({ error: 'Failed to create dashboard deep-dive canvas', message: error.message });
    }
  },
);

export default router;
