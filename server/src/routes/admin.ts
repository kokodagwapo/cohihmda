/**
 * Admin Routes
 * Admin-only endpoints for system management
 */

import { Router } from 'express';
import { pool } from '../config/database.js';
import { pool as managementPool } from '../config/managementDatabase.js';
import { authenticateToken, AuthRequest } from '../middleware/auth.js';
import { requireRole, requirePermission } from '../middleware/rbac.js';
import { auditLog } from '../services/auditLogger.js';
import { logError, logWarn, logInfo, logDebug } from '../services/logger.js';
import { getVersionInfo } from '../services/versionService.js';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { tenantDbManager } from '../config/tenantDatabaseManager.js';
import { listTenants } from '../services/tenantProvisioningService.js';

const router = Router();

// Validation schemas
const createUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  full_name: z.string().optional(),
  tenant_id: z.string().uuid().optional(),
  role: z.enum(['super_admin', 'tenant_admin', 'loan_officer', 'processor', 'viewer', 'user']).optional().default('user'),
});

const updateUserSchema = z.object({
  email: z.string().email().optional(),
  full_name: z.string().optional(),
  password: z.string().min(6).optional(),
  tenant_id: z.string().uuid().optional().nullable(),
  role: z.enum(['super_admin', 'tenant_admin', 'loan_officer', 'processor', 'viewer', 'user']).optional(),
});

const createTenantSchema = z.object({
  name: z.string().min(1),
});

const updateTenantSchema = z.object({
  name: z.string().min(1),
});

/**
 * GET /api/admin/stats
 * Get comprehensive overview statistics (role-aware: super admin vs lender admin)
 */
router.get('/stats', authenticateToken, requireRole('super_admin', 'tenant_admin'), async (req: AuthRequest, res) => {
  try {
    // Get user's role from database (requireRole middleware sets req.userRole, but we need to verify)
    const userResult = await pool.query('SELECT role, tenant_id FROM public.users WHERE id = $1', [req.userId]);
    
    const userRole = userResult.rows[0]?.role || 'user';
    const userTenantId = userResult.rows[0]?.tenant_id;
    const isSuperAdmin = userRole === 'super_admin' || userRole === 'admin';

    // Run essential queries in parallel
    // Use management database for tenant count
    const [tenantsResult, usersResult] = await Promise.all([
      managementPool.query('SELECT COUNT(*) as count FROM coheus_tenants WHERE status = $1', ['active']),
      pool.query('SELECT COUNT(*) as count FROM public.users'),
    ]);

    // Return minimal, fast response
    res.json({
      // Basic counts (always available)
      totalTenants: parseInt(tenantsResult.rows[0]?.count || '0'),
      totalUsers: parseInt(usersResult.rows[0]?.count || '0'),
      totalContacts: 0, // Skip for speed
      totalCalls: 0, // Skip for speed
      totalDocuments: 0, // Skip for speed
      totalLoans: 0, // Skip for speed
      deployments: 0,
      losConnections: 0,
      ragDocuments: 0,
      
      // Role-specific data
      isSuperAdmin,
      subscription: null,
      activeSubscriptions: 0,
      costSummary: null,
      
      // Recent activity (zeros for speed)
      recent: {
        newUsers: 0,
        newTenants: 0,
        callsLast7d: 0,
        loansLast7d: 0,
      },
      
      // Loan statistics
      loanStats: null,
    });
  } catch (error: any) {
    logError('Error fetching admin stats', error, { userId: req.userId });
    res.status(500).json({ error: 'Failed to fetch stats', details: error.message });
  }
});

/**
 * GET /api/admin/tenants/:id/metrics
 * Get metrics for a specific tenant (super_admin only)
 */
router.get('/tenants/:id/metrics', authenticateToken, requireRole('super_admin'), async (req: AuthRequest, res) => {
  try {
    const { id: tenantId } = req.params;

    // Get tenant database pool
    const tenantPool = await tenantDbManager.getTenantPool(tenantId);

    // Get connection metrics
    const connectionsResult = await tenantPool.query(
      `SELECT 
        COUNT(*) as total_connections,
        COUNT(*) FILTER (WHERE is_active = true) as active_connections,
        COUNT(*) FILTER (WHERE last_sync_status = 'success') as successful_syncs,
        COUNT(*) FILTER (WHERE last_sync_status = 'failed') as failed_syncs,
        COUNT(*) FILTER (WHERE last_sync_status = 'in_progress') as in_progress_syncs,
        MAX(last_synced_at) as last_sync_time
      FROM public.los_connections`
    );

    // Get loan counts
    let loanCounts = { total_loans: 0, loans_this_month: 0, loans_this_year: 0 };
    try {
      const loansResult = await tenantPool.query(
        `SELECT 
          COUNT(*) as total_loans,
          COUNT(*) FILTER (WHERE created_at >= date_trunc('month', CURRENT_DATE)) as loans_this_month,
          COUNT(*) FILTER (WHERE created_at >= date_trunc('year', CURRENT_DATE)) as loans_this_year
        FROM public.loans`
      );
      if (loansResult.rows.length > 0) {
        loanCounts = loansResult.rows[0];
      }
    } catch (error: any) {
      // Loans table might not exist yet
      logDebug('Loans table not found for tenant metrics', { tenantId, error: error.message });
    }

    // Get user counts
    let userCounts = { total_users: 0 };
    try {
      const usersResult = await tenantPool.query(
        `SELECT COUNT(*) as total_users FROM public.users`
      );
      if (usersResult.rows.length > 0) {
        userCounts = usersResult.rows[0];
      }
    } catch (error: any) {
      logDebug('Users table not found for tenant metrics', { tenantId, error: error.message });
    }

    const metrics = {
      connections: connectionsResult.rows[0] || {
        total_connections: 0,
        active_connections: 0,
        successful_syncs: 0,
        failed_syncs: 0,
        in_progress_syncs: 0,
        last_sync_time: null,
      },
      loans: loanCounts,
      users: userCounts,
    };

    res.json({ metrics });
  } catch (error: any) {
    logError('Error fetching tenant metrics', error, { userId: req.userId, tenantId: req.params.id });
    res.status(500).json({ error: 'Failed to fetch tenant metrics', details: error.message });
  }
});

/**
 * GET /api/admin/tenants
 * Get all tenants (admin only) - from management database
 */
router.get('/tenants', authenticateToken, requireRole('super_admin', 'tenant_admin'), async (req: AuthRequest, res) => {
  try {
    // Get tenants from management database
    const tenants = await listTenants();
    
    // Get user counts for each tenant (from user_tenant_mappings)
    const tenantsWithCounts = await Promise.all(
      tenants.map(async (tenant) => {
        try {
          const userCountResult = await managementPool.query(
            `SELECT COUNT(*) as user_count FROM user_tenant_mappings WHERE tenant_id = $1`,
            [tenant.id]
          );
          
          // Try to get loan count from tenant database
          let loanCount = 0;
          try {
            const tenantPool = await tenantDbManager.getTenantPool(tenant.id);
            const loanCountResult = await tenantPool.query(
              `SELECT COUNT(*) as loan_count FROM public.loans`
            );
            loanCount = parseInt(loanCountResult.rows[0]?.loan_count || '0');
          } catch (error: any) {
            // Loans table might not exist yet
            logDebug('Could not get loan count for tenant', { tenantId: tenant.id, error: error.message });
          }
          
          return {
            ...tenant,
            user_count: parseInt(userCountResult.rows[0]?.user_count || '0'),
            loan_count: loanCount,
          };
        } catch (error: any) {
          logWarn('Error getting counts for tenant', { tenantId: tenant.id, error: error.message });
          return {
            ...tenant,
            user_count: 0,
            loan_count: 0,
          };
        }
      })
    );

    res.json({ tenants: tenantsWithCounts });
  } catch (error: any) {
    logError('Error fetching tenants', error, { userId: req.userId });
    res.status(500).json({ error: 'Failed to fetch tenants', details: error.message });
  }
});

/**
 * GET /api/admin/users
 * Get all users (admin only)
 */
router.get('/users', authenticateToken, requireRole('super_admin', 'tenant_admin'), async (req: AuthRequest, res) => {
  try {
    const userResult = await pool.query(
      'SELECT role, tenant_id FROM public.users WHERE id = $1',
      [req.userId]
    );
    
    const userRole = userResult.rows[0]?.role || 'user';
    const userTenantId = userResult.rows[0]?.tenant_id;
    const isSuperAdmin = userRole === 'super_admin' || userRole === 'admin';

    let query = `
      SELECT 
        u.id,
        u.email,
        u.full_name,
        u.role,
        u.created_at,
        u.updated_at,
        p.tenant_id,
        t.name as tenant_name
      FROM public.users u
      LEFT JOIN public.profiles p ON p.user_id = u.id
      LEFT JOIN coheus_tenants t ON t.id = p.tenant_id
    `;
    
    const params: any[] = [];
    
    // If not super admin, only show users from same tenant
    if (!isSuperAdmin && userTenantId) {
      query += ' WHERE p.tenant_id = $1';
      params.push(userTenantId);
    }
    
    query += ' ORDER BY u.created_at DESC';
    
    const result = await pool.query(query, params);
    
    res.json({ users: result.rows });
  } catch (error: any) {
    logError('Error fetching users', error, { userId: req.userId });
    res.status(500).json({ error: 'Failed to fetch users', details: error.message });
  }
});

/**
 * POST /api/admin/users
 * Create a new user (admin only)
 */
router.post('/users', authenticateToken, requireRole('super_admin', 'tenant_admin'), async (req: AuthRequest, res) => {
  try {
    const validated = createUserSchema.parse(req.body);
    const hashedPassword = await bcrypt.hash(validated.password, 10);
    
    const result = await pool.query(
      `INSERT INTO public.users (email, password_hash, full_name, role, created_at, updated_at)
       VALUES ($1, $2, $3, $4, NOW(), NOW())
       RETURNING id, email, full_name, role, created_at`,
      [validated.email, hashedPassword, validated.full_name || null, validated.role]
    );
    
    const newUser = result.rows[0];
    
    // If tenant_id provided, create profile mapping
    if (validated.tenant_id) {
      await pool.query(
        `INSERT INTO public.profiles (user_id, tenant_id, created_at, updated_at)
         VALUES ($1, $2, NOW(), NOW())
         ON CONFLICT (user_id) DO UPDATE SET tenant_id = $2, updated_at = NOW()`,
        [newUser.id, validated.tenant_id]
      );
    }
    
    auditLog({
      userId: req.userId!,
      action: 'create_user',
      resourceType: 'user',
      resourceId: newUser.id,
      metadata: { email: validated.email, role: validated.role },
    });
    
    res.status(201).json({ user: newUser });
  } catch (error: any) {
    if (error.name === 'ZodError') {
      res.status(400).json({ error: 'Validation error', details: error.errors });
    } else if (error.code === '23505') { // Unique violation
      res.status(409).json({ error: 'User with this email already exists' });
    } else {
      logError('Error creating user', error, { userId: req.userId });
      res.status(500).json({ error: 'Failed to create user', details: error.message });
    }
  }
});

/**
 * PUT /api/admin/users/:id
 * Update a user (admin only)
 */
router.put('/users/:id', authenticateToken, requireRole('super_admin', 'tenant_admin'), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const validated = updateUserSchema.parse(req.body);
    
    const updates: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;
    
    if (validated.email !== undefined) {
      updates.push(`email = $${paramIndex++}`);
      params.push(validated.email);
    }
    
    if (validated.full_name !== undefined) {
      updates.push(`full_name = $${paramIndex++}`);
      params.push(validated.full_name);
    }
    
    if (validated.role !== undefined) {
      updates.push(`role = $${paramIndex++}`);
      params.push(validated.role);
    }
    
    if (validated.password) {
      const hashedPassword = await bcrypt.hash(validated.password, 10);
      updates.push(`password_hash = $${paramIndex++}`);
      params.push(hashedPassword);
    }
    
    updates.push(`updated_at = NOW()`);
    params.push(id);
    
    const result = await pool.query(
      `UPDATE public.users 
       SET ${updates.join(', ')}
       WHERE id = $${paramIndex}
       RETURNING id, email, full_name, role, created_at, updated_at`,
      params
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Update tenant mapping if provided
    if (validated.tenant_id !== undefined) {
      if (validated.tenant_id === null) {
        // Remove tenant mapping
        await pool.query(
          'DELETE FROM public.profiles WHERE user_id = $1',
          [id]
        );
      } else {
        // Update or create tenant mapping
        await pool.query(
          `INSERT INTO public.profiles (user_id, tenant_id, created_at, updated_at)
           VALUES ($1, $2, NOW(), NOW())
           ON CONFLICT (user_id) DO UPDATE SET tenant_id = $2, updated_at = NOW()`,
          [id, validated.tenant_id]
        );
      }
    }
    
    auditLog({
      userId: req.userId!,
      action: 'update_user',
      resourceType: 'user',
      resourceId: id,
      metadata: validated,
    });
    
    res.json({ user: result.rows[0] });
  } catch (error: any) {
    if (error.name === 'ZodError') {
      res.status(400).json({ error: 'Validation error', details: error.errors });
    } else {
      logError('Error updating user', error, { userId: req.userId, userToUpdate: req.params.id });
      res.status(500).json({ error: 'Failed to update user', details: error.message });
    }
  }
});

/**
 * DELETE /api/admin/users/:id
 * Delete a user (admin only)
 */
router.delete('/users/:id', authenticateToken, requireRole('super_admin', 'tenant_admin'), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    
    // Don't allow deleting yourself
    if (id === req.userId) {
      return res.status(400).json({ error: 'Cannot delete your own account' });
    }
    
    const result = await pool.query(
      'DELETE FROM public.users WHERE id = $1 RETURNING id, email',
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    auditLog({
      userId: req.userId!,
      action: 'delete_user',
      resourceType: 'user',
      resourceId: id,
      metadata: { email: result.rows[0].email },
    });
    
    res.json({ message: 'User deleted successfully' });
  } catch (error: any) {
    logError('Error deleting user', error, { userId: req.userId, userToDelete: req.params.id });
    res.status(500).json({ error: 'Failed to delete user', details: error.message });
  }
});

// ============================================================================
// NEW MULTI-DATABASE USER MANAGEMENT APIs
// ============================================================================

/**
 * GET /api/admin/super-admins
 * Get all super admins (from management database coheus_users table)
 */
router.get('/super-admins', authenticateToken, requireRole('super_admin'), async (req: AuthRequest, res) => {
  try {
    const result = await managementPool.query(`
      SELECT 
        id,
        email,
        full_name,
        role,
        is_active,
        last_login_at,
        created_at,
        updated_at
      FROM coheus_users
      ORDER BY created_at DESC
    `);
    
    res.json({ users: result.rows });
  } catch (error: any) {
    logError('Error fetching super admins', error, { userId: req.userId });
    res.status(500).json({ error: 'Failed to fetch super admins', details: error.message });
  }
});

/**
 * POST /api/admin/super-admins
 * Create a new super admin (in management database)
 */
router.post('/super-admins', authenticateToken, requireRole('super_admin'), async (req: AuthRequest, res) => {
  try {
    const schema = z.object({
      email: z.string().min(1),
      password: z.string().min(6),
      full_name: z.string().optional(),
      role: z.enum(['super_admin', 'platform_admin', 'support']).default('platform_admin'),
    });
    
    const validated = schema.parse(req.body);
    const hashedPassword = await bcrypt.hash(validated.password, 10);
    
    const result = await managementPool.query(`
      INSERT INTO coheus_users (email, encrypted_password, full_name, role, is_active)
      VALUES ($1, $2, $3, $4, true)
      RETURNING id, email, full_name, role, is_active, created_at
    `, [validated.email, hashedPassword, validated.full_name || null, validated.role]);
    
    logInfo('Super admin created', { createdBy: req.userId, newUser: validated.email });
    
    res.status(201).json({ user: result.rows[0] });
  } catch (error: any) {
    if (error.code === '23505') {
      res.status(409).json({ error: 'User with this email already exists' });
    } else if (error.name === 'ZodError') {
      res.status(400).json({ error: 'Validation error', details: error.errors });
    } else {
      logError('Error creating super admin', error, { userId: req.userId });
      res.status(500).json({ error: 'Failed to create super admin', details: error.message });
    }
  }
});

/**
 * PUT /api/admin/super-admins/:id
 * Update a super admin
 */
router.put('/super-admins/:id', authenticateToken, requireRole('super_admin'), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const schema = z.object({
      email: z.string().min(1).optional(),
      password: z.string().min(6).optional(),
      full_name: z.string().optional(),
      role: z.enum(['super_admin', 'platform_admin', 'support']).optional(),
      is_active: z.boolean().optional(),
    });
    
    const validated = schema.parse(req.body);
    const updates: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;
    
    if (validated.email !== undefined) {
      updates.push(`email = $${paramIndex++}`);
      params.push(validated.email);
    }
    if (validated.full_name !== undefined) {
      updates.push(`full_name = $${paramIndex++}`);
      params.push(validated.full_name);
    }
    if (validated.role !== undefined) {
      updates.push(`role = $${paramIndex++}`);
      params.push(validated.role);
    }
    if (validated.is_active !== undefined) {
      updates.push(`is_active = $${paramIndex++}`);
      params.push(validated.is_active);
    }
    if (validated.password) {
      const hashedPassword = await bcrypt.hash(validated.password, 10);
      updates.push(`encrypted_password = $${paramIndex++}`);
      params.push(hashedPassword);
    }
    
    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }
    
    updates.push(`updated_at = NOW()`);
    params.push(id);
    
    const result = await managementPool.query(`
      UPDATE coheus_users 
      SET ${updates.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING id, email, full_name, role, is_active, created_at, updated_at
    `, params);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Super admin not found' });
    }
    
    res.json({ user: result.rows[0] });
  } catch (error: any) {
    logError('Error updating super admin', error, { userId: req.userId });
    res.status(500).json({ error: 'Failed to update super admin', details: error.message });
  }
});

/**
 * DELETE /api/admin/super-admins/:id
 * Delete a super admin
 */
router.delete('/super-admins/:id', authenticateToken, requireRole('super_admin'), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    
    if (id === req.userId) {
      return res.status(400).json({ error: 'Cannot delete your own account' });
    }
    
    const result = await managementPool.query(
      'DELETE FROM coheus_users WHERE id = $1 RETURNING id, email',
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Super admin not found' });
    }
    
    logInfo('Super admin deleted', { deletedBy: req.userId, deletedUser: result.rows[0].email });
    
    res.json({ message: 'Super admin deleted successfully' });
  } catch (error: any) {
    logError('Error deleting super admin', error, { userId: req.userId });
    res.status(500).json({ error: 'Failed to delete super admin', details: error.message });
  }
});

/**
 * GET /api/admin/tenants/:tenantId/users
 * Get all users for a specific tenant (from tenant database)
 */
router.get('/tenants/:tenantId/users', authenticateToken, requireRole('super_admin', 'platform_admin', 'tenant_admin'), async (req: AuthRequest, res) => {
  try {
    const { tenantId } = req.params;
    
    // Tenant admins can only access their own tenant's users
    if (req.userRole === 'tenant_admin' && req.tenantId !== tenantId) {
      return res.status(403).json({ 
        error: 'Forbidden', 
        message: 'You can only access users from your own organization' 
      });
    }
    
    // Get tenant pool
    const tenantPool = await tenantDbManager.getTenantPool(tenantId);
    
    const result = await tenantPool.query(`
      SELECT 
        id,
        email,
        full_name,
        role,
        is_active,
        last_login_at,
        created_at,
        updated_at
      FROM users
      ORDER BY created_at DESC
    `);
    
    // Get tenant info for response
    const tenantInfo = await managementPool.query(
      'SELECT id, name, slug FROM coheus_tenants WHERE id = $1',
      [tenantId]
    );
    
    res.json({ 
      users: result.rows,
      tenant: tenantInfo.rows[0] || null
    });
  } catch (error: any) {
    logError('Error fetching tenant users', error, { userId: req.userId, tenantId: req.params.tenantId });
    res.status(500).json({ error: 'Failed to fetch tenant users', details: error.message });
  }
});

/**
 * POST /api/admin/tenants/:tenantId/users
 * Create a new user in a specific tenant
 */
router.post('/tenants/:tenantId/users', authenticateToken, requireRole('super_admin', 'platform_admin', 'tenant_admin'), async (req: AuthRequest, res) => {
  try {
    const { tenantId } = req.params;
    
    // Tenant admins can only create users in their own tenant
    if (req.userRole === 'tenant_admin' && req.tenantId !== tenantId) {
      return res.status(403).json({ 
        error: 'Forbidden', 
        message: 'You can only create users in your own organization' 
      });
    }
    
    const schema = z.object({
      email: z.string().email(),
      password: z.string().min(6),
      full_name: z.string().optional(),
      role: z.enum(['tenant_admin', 'admin', 'user', 'viewer', 'loan_officer', 'processor']).default('user'),
    });
    
    const validated = schema.parse(req.body);
    const hashedPassword = await bcrypt.hash(validated.password, 10);
    
    // Get tenant pool
    const tenantPool = await tenantDbManager.getTenantPool(tenantId);
    
    const result = await tenantPool.query(`
      INSERT INTO users (email, encrypted_password, full_name, role, is_active)
      VALUES ($1, $2, $3, $4, true)
      RETURNING id, email, full_name, role, is_active, created_at
    `, [validated.email, hashedPassword, validated.full_name || null, validated.role]);
    
    // Get tenant info for logging
    const tenantInfo = await managementPool.query(
      'SELECT name FROM coheus_tenants WHERE id = $1',
      [tenantId]
    );
    
    logInfo('Tenant user created', { 
      createdBy: req.userId, 
      newUser: validated.email,
      tenantId,
      tenantName: tenantInfo.rows[0]?.name
    });
    
    res.status(201).json({ user: result.rows[0] });
  } catch (error: any) {
    if (error.code === '23505') {
      res.status(409).json({ error: 'User with this email already exists in this tenant' });
    } else if (error.name === 'ZodError') {
      res.status(400).json({ error: 'Validation error', details: error.errors });
    } else {
      logError('Error creating tenant user', error, { userId: req.userId, tenantId: req.params.tenantId });
      res.status(500).json({ error: 'Failed to create tenant user', details: error.message });
    }
  }
});

/**
 * PUT /api/admin/tenants/:tenantId/users/:userId
 * Update a user in a specific tenant
 */
router.put('/tenants/:tenantId/users/:userId', authenticateToken, requireRole('super_admin', 'platform_admin', 'tenant_admin'), async (req: AuthRequest, res) => {
  try {
    const { tenantId, userId } = req.params;
    
    // Tenant admins can only update users in their own tenant
    if (req.userRole === 'tenant_admin' && req.tenantId !== tenantId) {
      return res.status(403).json({ 
        error: 'Forbidden', 
        message: 'You can only update users in your own organization' 
      });
    }
    
    const schema = z.object({
      email: z.string().email().optional(),
      password: z.string().min(6).optional(),
      full_name: z.string().optional(),
      role: z.enum(['tenant_admin', 'admin', 'user', 'viewer', 'loan_officer', 'processor']).optional(),
      is_active: z.boolean().optional(),
    });
    
    const validated = schema.parse(req.body);
    const updates: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;
    
    if (validated.email !== undefined) {
      updates.push(`email = $${paramIndex++}`);
      params.push(validated.email);
    }
    if (validated.full_name !== undefined) {
      updates.push(`full_name = $${paramIndex++}`);
      params.push(validated.full_name);
    }
    if (validated.role !== undefined) {
      updates.push(`role = $${paramIndex++}`);
      params.push(validated.role);
    }
    if (validated.is_active !== undefined) {
      updates.push(`is_active = $${paramIndex++}`);
      params.push(validated.is_active);
    }
    if (validated.password) {
      const hashedPassword = await bcrypt.hash(validated.password, 10);
      updates.push(`encrypted_password = $${paramIndex++}`);
      params.push(hashedPassword);
    }
    
    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }
    
    updates.push(`updated_at = NOW()`);
    params.push(userId);
    
    const tenantPool = await tenantDbManager.getTenantPool(tenantId);
    
    const result = await tenantPool.query(`
      UPDATE users 
      SET ${updates.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING id, email, full_name, role, is_active, created_at, updated_at
    `, params);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json({ user: result.rows[0] });
  } catch (error: any) {
    logError('Error updating tenant user', error, { userId: req.userId, tenantId: req.params.tenantId });
    res.status(500).json({ error: 'Failed to update tenant user', details: error.message });
  }
});

/**
 * DELETE /api/admin/tenants/:tenantId/users/:userId
 * Delete a user from a specific tenant
 */
router.delete('/tenants/:tenantId/users/:userId', authenticateToken, requireRole('super_admin', 'platform_admin', 'tenant_admin'), async (req: AuthRequest, res) => {
  try {
    const { tenantId, userId } = req.params;
    
    // Tenant admins can only delete users in their own tenant
    if (req.userRole === 'tenant_admin' && req.tenantId !== tenantId) {
      return res.status(403).json({ 
        error: 'Forbidden', 
        message: 'You can only delete users in your own organization' 
      });
    }
    
    const tenantPool = await tenantDbManager.getTenantPool(tenantId);
    
    const result = await tenantPool.query(
      'DELETE FROM users WHERE id = $1 RETURNING id, email',
      [userId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    logInfo('Tenant user deleted', { deletedBy: req.userId, deletedUser: result.rows[0].email, tenantId });
    
    res.json({ message: 'User deleted successfully' });
  } catch (error: any) {
    logError('Error deleting tenant user', error, { userId: req.userId, tenantId: req.params.tenantId });
    res.status(500).json({ error: 'Failed to delete tenant user', details: error.message });
  }
});

/**
 * GET /api/admin/all-users
 * Get all users across all tenants (super admin only)
 * Returns super admins + all tenant users with tenant info
 */
router.get('/all-users', authenticateToken, requireRole('super_admin', 'platform_admin'), async (req: AuthRequest, res) => {
  try {
    // Get super admins from management DB
    const superAdminsResult = await managementPool.query(`
      SELECT 
        id,
        email,
        full_name,
        role,
        is_active,
        last_login_at,
        created_at,
        NULL as tenant_id,
        NULL as tenant_name,
        NULL as tenant_slug,
        true as is_super_admin
      FROM coheus_users
      ORDER BY created_at DESC
    `);
    
    // Get all tenants
    const tenantsResult = await managementPool.query(`
      SELECT id, name, slug, database_name 
      FROM coheus_tenants 
      WHERE status = 'active'
    `);
    
    // Get users from each tenant
    const allTenantUsers: any[] = [];
    
    for (const tenant of tenantsResult.rows) {
      try {
        const tenantPool = await tenantDbManager.getTenantPool(tenant.id);
        const usersResult = await tenantPool.query(`
          SELECT 
            id,
            email,
            full_name,
            role,
            is_active,
            last_login_at,
            created_at
          FROM users
          ORDER BY created_at DESC
        `);
        
        // Add tenant info to each user
        usersResult.rows.forEach(user => {
          allTenantUsers.push({
            ...user,
            tenant_id: tenant.id,
            tenant_name: tenant.name,
            tenant_slug: tenant.slug,
            is_super_admin: false,
          });
        });
      } catch (err: any) {
        logWarn('Could not fetch users from tenant', { tenantId: tenant.id, error: err.message });
      }
    }
    
    res.json({
      superAdmins: superAdminsResult.rows,
      tenantUsers: allTenantUsers,
      tenants: tenantsResult.rows,
    });
  } catch (error: any) {
    logError('Error fetching all users', error, { userId: req.userId });
    res.status(500).json({ error: 'Failed to fetch users', details: error.message });
  }
});

export default router;
