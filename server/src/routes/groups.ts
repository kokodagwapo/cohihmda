/**
 * User Groups API — CRUD for tenant-scoped user groups (canvas sharing).
 * Requires admin (platform staff or tenant_admin). Uses tenant DB.
 */
import { Router } from 'express';
import { authenticateToken, AuthRequest } from '../middleware/auth.js';
import {
  attachTenantContext,
  getTenantContext,
} from '../middleware/tenantContext.js';
import { requireAnyAdmin, enforceTenantIsolation } from '../middleware/rbac.js';

const router = Router();

router.use(authenticateToken, attachTenantContext, requireAnyAdmin(), enforceTenantIsolation());

// GET / — List all groups with member counts
router.get('/', async (req: AuthRequest, res) => {
  try {
    const { tenantPool } = getTenantContext(req);
    const result = await tenantPool.query(
      `SELECT g.id, g.name, g.description, g.color, g.created_by, g.is_active, g.created_at, g.updated_at,
              (SELECT COUNT(*) FROM public.user_group_memberships m WHERE m.group_id = g.id) AS member_count
       FROM public.user_groups g
       WHERE g.is_active = true
       ORDER BY g.name ASC`,
    );
    res.json({ groups: result.rows });
  } catch (error: any) {
    console.error('[Groups] Error listing groups:', error.message);
    res.status(500).json({ error: 'Failed to list groups', message: error.message });
  }
});

// POST / — Create group
router.post('/', async (req: AuthRequest, res) => {
  try {
    const { tenantPool } = getTenantContext(req);
    const { name, description, color } = req.body || {};
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'name is required' });
    }
    const result = await tenantPool.query(
      `INSERT INTO public.user_groups (name, description, color, created_by)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, description, color, created_by, is_active, created_at, updated_at`,
      [name.trim(), description?.trim() || null, color || null, req.userId],
    );
    res.status(201).json(result.rows[0]);
  } catch (error: any) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'A group with this name already exists' });
    }
    console.error('[Groups] Error creating group:', error.message);
    res.status(500).json({ error: 'Failed to create group', message: error.message });
  }
});

// PUT /:id — Update group
router.put('/:id', async (req: AuthRequest, res) => {
  try {
    const { tenantPool } = getTenantContext(req);
    const { name, description, color, is_active } = req.body || {};
    const updates: string[] = [];
    const values: any[] = [];
    let i = 1;
    if (name !== undefined) {
      updates.push(`name = $${i++}`);
      values.push(typeof name === 'string' ? name.trim() : name);
    }
    if (description !== undefined) {
      updates.push(`description = $${i++}`);
      values.push(description === null || description === '' ? null : String(description).trim());
    }
    if (color !== undefined) {
      updates.push(`color = $${i++}`);
      values.push(color === null || color === '' ? null : color);
    }
    if (typeof is_active === 'boolean') {
      updates.push(`is_active = $${i++}`);
      values.push(is_active);
    }
    if (updates.length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }
    values.push(req.params.id);
    const result = await tenantPool.query(
      `UPDATE public.user_groups SET ${updates.join(', ')}, updated_at = NOW()
       WHERE id = $${i} RETURNING id, name, description, color, created_by, is_active, created_at, updated_at`,
      values,
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Group not found' });
    }
    res.json(result.rows[0]);
  } catch (error: any) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'A group with this name already exists' });
    }
    console.error('[Groups] Error updating group:', error.message);
    res.status(500).json({ error: 'Failed to update group', message: error.message });
  }
});

// DELETE /:id — Delete group (cascades memberships)
router.delete('/:id', async (req: AuthRequest, res) => {
  try {
    const { tenantPool } = getTenantContext(req);
    const result = await tenantPool.query(
      'DELETE FROM public.user_groups WHERE id = $1 RETURNING id',
      [req.params.id],
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Group not found' });
    }
    res.status(204).send();
  } catch (error: any) {
    console.error('[Groups] Error deleting group:', error.message);
    res.status(500).json({ error: 'Failed to delete group', message: error.message });
  }
});

// GET /:id/members — List group members
router.get('/:id/members', async (req: AuthRequest, res) => {
  try {
    const { tenantPool } = getTenantContext(req);
    const result = await tenantPool.query(
      `SELECT u.id, u.email, u.full_name, u.role, m.created_at AS added_at
       FROM public.user_group_memberships m
       JOIN public.users u ON u.id = m.user_id
       WHERE m.group_id = $1
       ORDER BY COALESCE(u.full_name, u.email) ASC`,
      [req.params.id],
    );
    res.json({ members: result.rows });
  } catch (error: any) {
    console.error('[Groups] Error listing members:', error.message);
    res.status(500).json({ error: 'Failed to list members', message: error.message });
  }
});

// POST /:id/members — Add users to group (body: { user_ids: string[] })
router.post('/:id/members', async (req: AuthRequest, res) => {
  try {
    const { tenantPool } = getTenantContext(req);
    const { user_ids: userIds } = req.body || {};
    if (!Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({ error: 'user_ids array is required and non-empty' });
    }
    const groupId = req.params.id;
    const inserted: string[] = [];
    for (const uid of userIds) {
      if (typeof uid !== 'string') continue;
      try {
        await tenantPool.query(
          `INSERT INTO public.user_group_memberships (group_id, user_id) VALUES ($1, $2)
           ON CONFLICT (group_id, user_id) DO NOTHING`,
          [groupId, uid],
        );
        const check = await tenantPool.query(
          'SELECT 1 FROM public.user_group_memberships WHERE group_id = $1 AND user_id = $2',
          [groupId, uid],
        );
        if (check.rows.length > 0) inserted.push(uid);
      } catch (_) {
        // skip invalid ids
      }
    }
    res.json({ added: inserted });
  } catch (error: any) {
    console.error('[Groups] Error adding members:', error.message);
    res.status(500).json({ error: 'Failed to add members', message: error.message });
  }
});

// DELETE /:id/members/:userId — Remove user from group
router.delete('/:id/members/:userId', async (req: AuthRequest, res) => {
  try {
    const { tenantPool } = getTenantContext(req);
    const result = await tenantPool.query(
      'DELETE FROM public.user_group_memberships WHERE group_id = $1 AND user_id = $2 RETURNING id',
      [req.params.id, req.params.userId],
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Member not found in group' });
    }
    res.status(204).send();
  } catch (error: any) {
    console.error('[Groups] Error removing member:', error.message);
    res.status(500).json({ error: 'Failed to remove member', message: error.message });
  }
});

export default router;
