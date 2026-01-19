/**
 * Admin Routes
 * Admin-only endpoints for system management
 */

import { Router } from 'express';
import { pool } from '../config/database.js';
import { authenticateToken, AuthRequest } from '../middleware/auth.js';
import { requireRole, requirePermission } from '../middleware/rbac.js';
import { auditLog } from '../services/auditLogger.js';
import { logError, logWarn, logInfo, logDebug } from '../services/logger.js';
import { getVersionInfo } from '../services/versionService.js';
import bcrypt from 'bcryptjs';
import { z } from 'zod';

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
    // OPTIMIZED: Return basic stats quickly, skip complex queries for tables that don't exist
    
    // Get user's role from database (use users table directly, not profiles)
    const userResult = await pool.query(
      'SELECT role, tenant_id FROM public.users WHERE id = $1',
      [req.userId]
    );
    
    const userRole = userResult.rows[0]?.role || 'user';
    const userTenantId = userResult.rows[0]?.tenant_id;
    const isSuperAdmin = userRole === 'super_admin';

    // FAST: Run only essential queries in parallel
    const [tenantsResult, usersResult] = await Promise.all([
      pool.query('SELECT COUNT(*) as count FROM public.tenants'),
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
    res.status(500).json({ error: 'Failed to fetch admin statistics', details: error.message });
  }
});

/**
 * GET /api/admin/tenants
 * Get all tenants (admin only)
 */
router.get('/tenants', authenticateToken, requireRole('super_admin', 'tenant_admin'), async (req: AuthRequest, res) => {
  try {
    // Try with loans table first, fallback to simpler query if loans table doesn't exist
    let result;
    try {
      result = await pool.query(`
        SELECT 
          t.*,
          COUNT(DISTINCT p.user_id) as user_count,
          COUNT(DISTINCT l.id) as loan_count
        FROM public.tenants t
        LEFT JOIN public.profiles p ON t.id = p.tenant_id
        LEFT JOIN public.loans l ON t.id = l.tenant_id
        GROUP BY t.id
        ORDER BY t.created_at DESC
      `);
    } catch (loansError: any) {
      logWarn('Loans table not found, using simpler query', { userId: req.userId, error: loansError.message });
      // Fallback query without loans table
      result = await pool.query(`
        SELECT 
          t.*,
          COUNT(DISTINCT p.user_id) as user_count,
          0 as loan_count
        FROM public.tenants t
        LEFT JOIN public.profiles p ON t.id = p.tenant_id
        GROUP BY t.id
        ORDER BY t.created_at DESC
      `);
    }

    res.json({ tenants: result.rows });
  } catch (error: any) {
    logError('Error fetching tenants', error, { userId: req.userId });
    res.status(500).json({ error: 'Failed to fetch tenants', details: error.message });
  }
});

/**
 * POST /api/admin/tenants
 * Create a new tenant (admin only)
 */
router.post('/tenants', authenticateToken, requireRole('super_admin'), async (req: AuthRequest, res) => {
  try {
    const { name } = createTenantSchema.parse(req.body);

    // Check if tenant with same name exists
    const existingTenant = await pool.query(
      'SELECT id FROM public.tenants WHERE LOWER(name) = LOWER($1)',
      [name]
    );

    if (existingTenant.rows.length > 0) {
      return res.status(400).json({ error: 'Tenant with this name already exists' });
    }

    // Create tenant
    const result = await pool.query(
      `INSERT INTO public.tenants (name, created_at, updated_at)
       VALUES ($1, NOW(), NOW())
       RETURNING *`,
      [name]
    );

    const tenant = result.rows[0];

    // Create default RAG settings for this tenant
    await pool.query(
      'INSERT INTO public.rag_settings (tenant_id, created_at) VALUES ($1, NOW())',
      [tenant.id]
    );

    res.status(201).json({ tenant });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0].message });
    }
    logError('Error creating tenant', error, { userId: req.userId });
    res.status(500).json({ error: 'Failed to create tenant' });
  }
});

/**
 * PUT /api/admin/tenants/:id
 * Update a tenant (admin only)
 */
router.put('/tenants/:id', authenticateToken, requireRole('super_admin'), async (req: AuthRequest, res) => {
  try {
    const tenantId = req.params.id;
    const { name } = updateTenantSchema.parse(req.body);

    // Check if tenant exists
    const tenantCheck = await pool.query('SELECT id FROM public.tenants WHERE id = $1', [tenantId]);
    if (tenantCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    // Check if new name is already taken by another tenant
    const nameCheck = await pool.query(
      'SELECT id FROM public.tenants WHERE LOWER(name) = LOWER($1) AND id != $2',
      [name, tenantId]
    );
    if (nameCheck.rows.length > 0) {
      return res.status(400).json({ error: 'Tenant name already in use' });
    }

    // Update tenant
    const result = await pool.query(
      `UPDATE public.tenants 
       SET name = $1, updated_at = NOW() 
       WHERE id = $2 
       RETURNING *`,
      [name, tenantId]
    );

    res.json({ tenant: result.rows[0] });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0].message });
    }
    logError('Error updating tenant', error, { userId: req.userId, tenantId: req.params.id });
    res.status(500).json({ error: 'Failed to update tenant' });
  }
});

/**
 * DELETE /api/admin/tenants/:id
 * Delete a tenant (admin only)
 */
router.delete('/tenants/:id', authenticateToken, requireRole('super_admin'), async (req: AuthRequest, res) => {
  try {
    const tenantId = req.params.id;

    // Check if tenant exists
    const tenantCheck = await pool.query('SELECT id, name FROM public.tenants WHERE id = $1', [tenantId]);
    if (tenantCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    // Check if tenant has users
    const userCount = await pool.query(
      'SELECT COUNT(*) as count FROM public.profiles WHERE tenant_id = $1',
      [tenantId]
    );

    if (parseInt(userCount.rows[0].count) > 0) {
      return res.status(400).json({ 
        error: 'Cannot delete tenant with existing users. Please reassign or delete users first.',
        userCount: parseInt(userCount.rows[0].count)
      });
    }

    // Delete tenant (cascade will delete related records)
    await pool.query('DELETE FROM public.tenants WHERE id = $1', [tenantId]);

    res.json({ message: 'Tenant deleted successfully', name: tenantCheck.rows[0].name });
  } catch (error: any) {
    logError('Error deleting tenant', error, { userId: req.userId, tenantId: req.params.id });
    res.status(500).json({ error: 'Failed to delete tenant' });
  }
});

/**
 * GET /api/admin/tenants/:id/users
 * Get all users for a specific tenant (admin only)
 */
router.get('/tenants/:id/users', authenticateToken, requireRole('super_admin', 'tenant_admin'), async (req: AuthRequest, res) => {
  try {
    const tenantId = req.params.id;

    const result = await pool.query(`
      SELECT 
        u.id,
        u.email,
        u.created_at as timestamp,
        u.is_active,
        p.full_name
      FROM public.users u
      JOIN public.profiles p ON u.id = p.user_id
      WHERE p.tenant_id = $1
      ORDER BY u.created_at DESC
    `, [tenantId]);

    res.json({ users: result.rows });
  } catch (error: any) {
    logError('Error fetching tenant users', error, { userId: req.userId, tenantId: req.params.id });
    res.status(500).json({ error: 'Failed to fetch tenant users' });
  }
});

/**
 * GET /api/admin/users
 * Get all users (admin only)
 */
router.get('/users', authenticateToken, requirePermission('users', 'read'), async (req: AuthRequest, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        u.id,
        u.email,
        u.role,
        u.created_at,
        u.email_confirmed_at,
        u.is_active,
        p.full_name,
        p.tenant_id,
        t.name as tenant_name
      FROM public.users u
      LEFT JOIN public.profiles p ON u.id = p.user_id
      LEFT JOIN public.tenants t ON p.tenant_id = t.id
      ORDER BY u.created_at DESC
    `);

    res.json({ users: result.rows });
  } catch (error: any) {
    logError('Error fetching users', error, { userId: req.userId });
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

/**
 * POST /api/admin/users
 * Create a new user (admin only)
 */
router.post('/users', authenticateToken, requirePermission('users', 'create'), async (req: AuthRequest, res) => {
  try {
    const { email, password, full_name, tenant_id, role } = createUserSchema.parse(req.body);

    // Check if user already exists
    const existingUser = await pool.query(
      'SELECT id FROM public.users WHERE email = $1',
      [email]
    );

    if (existingUser.rows.length > 0) {
      return res.status(400).json({ error: 'User with this email already exists' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user with role
    const userResult = await pool.query(
      `INSERT INTO public.users (email, encrypted_password, role, is_active, created_at, updated_at)
       VALUES ($1, $2, $3, true, NOW(), NOW())
       RETURNING id, email, role, is_active, created_at`,
      [email, hashedPassword, role || 'user']
    );

    const user = userResult.rows[0];

    // Create profile
    await pool.query(
      `INSERT INTO public.profiles (user_id, full_name, tenant_id, created_at)
       VALUES ($1, $2, $3, NOW())`,
      [user.id, full_name || null, tenant_id || null]
    );

    // Audit log
    await auditLog({
      userId: req.userId,
      userEmail: req.userEmail,
      tenantId: tenant_id || null,
      action: 'create',
      resource: 'user',
      resourceId: user.id,
      description: `Created user ${email} with role ${role || 'user'}`,
      status: 'success',
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    });

    // Fetch complete user data
    const completeUser = await pool.query(`
      SELECT 
        u.id,
        u.email,
        u.role,
        u.created_at as timestamp,
        u.is_active,
        p.full_name,
        p.tenant_id,
        t.name as tenant_name
      FROM public.users u
      LEFT JOIN public.profiles p ON u.id = p.user_id
      LEFT JOIN public.tenants t ON p.tenant_id = t.id
      WHERE u.id = $1
    `, [user.id]);

    res.status(201).json({ user: completeUser.rows[0] });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0].message });
    }
    logError('Error creating user', error, { userId: req.userId });
    // Return more detailed error message for debugging
    const errorMessage = error.message || 'Failed to create user';
    const isConstraintError = error.code === '23514' || error.message?.includes('check constraint');
    const isForeignKeyError = error.code === '23503' || error.message?.includes('foreign key');
    
    if (isConstraintError) {
      return res.status(400).json({ 
        error: 'Invalid role value. Allowed roles: admin, user, viewer, super_admin, tenant_admin, loan_officer, processor',
        details: errorMessage 
      });
    }
    if (isForeignKeyError) {
      return res.status(400).json({ 
        error: 'Invalid tenant_id. The specified tenant does not exist.',
        details: errorMessage 
      });
    }
    res.status(500).json({ error: 'Failed to create user', details: errorMessage });
  }
});

/**
 * PUT /api/admin/users/:id
 * Update a user (admin only)
 */
router.put('/users/:id', authenticateToken, requirePermission('users', 'update'), async (req: AuthRequest, res) => {
  try {
    const userId = req.params.id;
    const updates = updateUserSchema.parse(req.body);

    // Check if user exists
    const userCheck = await pool.query('SELECT id, email, role FROM public.users WHERE id = $1', [userId]);
    if (userCheck.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const oldUser = userCheck.rows[0];
    const changes: Record<string, any> = {};

    // Update email if provided
    if (updates.email && updates.email !== oldUser.email) {
      // Check if email is already taken by another user
      const emailCheck = await pool.query(
        'SELECT id FROM public.users WHERE email = $1 AND id != $2',
        [updates.email, userId]
      );
      if (emailCheck.rows.length > 0) {
        return res.status(400).json({ error: 'Email already in use by another user' });
      }

      changes.email = { from: oldUser.email, to: updates.email };
      await pool.query(
        'UPDATE public.users SET email = $1, updated_at = NOW() WHERE id = $2',
        [updates.email, userId]
      );
    }

    // Update role if provided
    if (updates.role && updates.role !== oldUser.role) {
      changes.role = { from: oldUser.role, to: updates.role };
      await pool.query(
        'UPDATE public.users SET role = $1, updated_at = NOW() WHERE id = $2',
        [updates.role, userId]
      );
    }

    // Update profile if full_name or tenant_id provided
    if (updates.full_name !== undefined || updates.tenant_id !== undefined) {
      const profileCheck = await pool.query('SELECT id, full_name, tenant_id FROM public.profiles WHERE user_id = $1', [userId]);
      
      if (profileCheck.rows.length > 0) {
        // Update existing profile
        const profileUpdates = [];
        const profileValues = [];
        let paramCount = 1;

        if (updates.full_name !== undefined) {
          changes.full_name = { from: profileCheck.rows[0].full_name, to: updates.full_name };
          profileUpdates.push(`full_name = $${paramCount++}`);
          profileValues.push(updates.full_name);
        }
        if (updates.tenant_id !== undefined) {
          changes.tenant_id = { from: profileCheck.rows[0].tenant_id, to: updates.tenant_id };
          profileUpdates.push(`tenant_id = $${paramCount++}`);
          profileValues.push(updates.tenant_id);
        }
        profileUpdates.push(`updated_at = NOW()`);
        profileValues.push(userId);

        await pool.query(
          `UPDATE public.profiles SET ${profileUpdates.join(', ')} WHERE user_id = $${paramCount}`,
          profileValues
        );
      } else {
        // Create profile if it doesn't exist
        await pool.query(
          `INSERT INTO public.profiles (user_id, full_name, tenant_id, created_at)
           VALUES ($1, $2, $3, NOW())`,
          [userId, updates.full_name || null, updates.tenant_id || null]
        );
      }
    }

    // Audit log
    await auditLog({
      userId: req.userId,
      userEmail: req.userEmail,
      action: 'update',
      resource: 'user',
      resourceId: userId,
      description: `Updated user ${oldUser.email}`,
      changes,
      status: 'success',
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    });

    // Fetch updated user
    const updatedUser = await pool.query(`
      SELECT 
        u.id,
        u.email,
        u.role,
        u.created_at,
        u.email_confirmed_at,
        u.is_active,
        p.full_name,
        p.tenant_id,
        t.name as tenant_name
      FROM public.users u
      LEFT JOIN public.profiles p ON u.id = p.user_id
      LEFT JOIN public.tenants t ON p.tenant_id = t.id
      WHERE u.id = $1
    `, [userId]);

    res.json({ user: updatedUser.rows[0] });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0].message });
    }
    logError('Error updating user', error, { userId: req.userId, targetUserId: req.params.id });
    res.status(500).json({ error: 'Failed to update user' });
  }
});

/**
 * DELETE /api/admin/users/:id
 * Delete a user (admin only)
 */
router.delete('/users/:id', authenticateToken, requirePermission('users', 'delete'), async (req: AuthRequest, res) => {
  try {
    const userId = req.params.id;

    // Prevent deleting yourself
    if (userId === req.userId) {
      return res.status(400).json({ error: 'Cannot delete your own account' });
    }

    // Check if user exists
    const userCheck = await pool.query('SELECT id, email FROM public.users WHERE id = $1', [userId]);
    if (userCheck.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Delete user (cascade will delete profile)
    await pool.query('DELETE FROM public.users WHERE id = $1', [userId]);

    res.json({ message: 'User deleted successfully', email: userCheck.rows[0].email });
  } catch (error: any) {
    logError('Error deleting user', error, { userId: req.userId, targetUserId: req.params.id });
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

/**
 * PUT /api/admin/users/:id/password
 * Reset user password (admin only)
 */
router.put('/users/:id/password', authenticateToken, requireRole('super_admin', 'tenant_admin'), async (req: AuthRequest, res) => {
  try {
    const userId = req.params.id;
    const { password } = z.object({ password: z.string().min(6) }).parse(req.body);

    // Check if user exists
    const userCheck = await pool.query('SELECT id FROM public.users WHERE id = $1', [userId]);
    if (userCheck.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Update password
    await pool.query(
      'UPDATE public.users SET encrypted_password = $1, updated_at = NOW() WHERE id = $2',
      [hashedPassword, userId]
    );

    res.json({ message: 'Password updated successfully' });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0].message });
    }
    logError('Error resetting password', error, { userId: req.userId, targetUserId: req.params.id });
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

/**
 * GET /api/admin/system
 * Get system configuration (admin only)
 */
router.get('/system', authenticateToken, requireRole('super_admin'), async (req: AuthRequest, res) => {
  try {
    // Get system info
    const dbResult = await pool.query('SELECT version() as version');
    const uptimeResult = await pool.query('SELECT NOW() - pg_postmaster_start_time() as uptime');
    
    // Get version information
    const versionInfo = getVersionInfo();
    
    res.json({
      database: {
        version: dbResult.rows[0]?.version || 'Unknown',
        uptime: uptimeResult.rows[0]?.uptime || 'Unknown',
      },
      server: {
        environment: process.env.NODE_ENV || 'development',
        port: process.env.PORT || '3001',
        nodeVersion: process.version,
        version: versionInfo.version,
        commit: versionInfo.commit.short,
        commitFull: versionInfo.commit.full,
        branch: versionInfo.branch,
        tag: versionInfo.tag,
        buildTime: versionInfo.buildTime,
        ebVersionLabel: versionInfo.deployment.ebVersionLabel,
      },
      features: {
        ragEnabled: true,
        costTrackingEnabled: true,
        hybridSyncEnabled: true,
      },
    });
  } catch (error: any) {
    logError('Error fetching system info', error, { userId: req.userId });
    res.status(500).json({ error: 'Failed to fetch system information' });
  }
});

/**
 * GET /api/admin/monitoring
 * Get system monitoring data (admin only)
 */
router.get('/monitoring', authenticateToken, requireRole('super_admin', 'tenant_admin'), async (req: AuthRequest, res) => {
  try {
    // Get recent activity stats
    const [recentUsers, recentTenants, recentCalls, dbSize] = await Promise.all([
      pool.query(`
        SELECT COUNT(*) as count 
        FROM public.users 
        WHERE timestamp > NOW() - INTERVAL '7 days'
      `),
      pool.query(`
        SELECT COUNT(*) as count 
        FROM public.tenants 
        WHERE timestamp > NOW() - INTERVAL '7 days'
      `),
      pool.query(`
        SELECT COUNT(*) as count 
        FROM public.call_sessions 
        WHERE timestamp > NOW() - INTERVAL '24 hours'
      `),
      pool.query(`
        SELECT pg_size_pretty(pg_database_size(current_database())) as size
      `),
    ]);

    // Get daily stats for last 7 days
    const dailyStats = await pool.query(`
      SELECT 
        DATE(timestamp) as date,
        COUNT(*) as count
      FROM public.call_sessions
      WHERE timestamp > NOW() - INTERVAL '7 days'
      GROUP BY DATE(timestamp)
      ORDER BY date ASC
    `);

    res.json({
      recent: {
        newUsers: parseInt(recentUsers.rows[0]?.count || '0'),
        newTenants: parseInt(recentTenants.rows[0]?.count || '0'),
        callsLast24h: parseInt(recentCalls.rows[0]?.count || '0'),
      },
      database: {
        size: dbSize.rows[0]?.size || 'Unknown',
      },
      dailyStats: dailyStats.rows.map((row: any) => ({
        date: row.date,
        count: parseInt(row.count),
      })),
    });
  } catch (error: any) {
    logError('Error fetching monitoring data', error, { userId: req.userId });
    res.status(500).json({ error: 'Failed to fetch monitoring data' });
  }
});

/**
 * GET /api/admin/security
 * Get security settings and audit info (admin only)
 */
router.get('/security', authenticateToken, requireRole('super_admin', 'tenant_admin'), async (req: AuthRequest, res) => {
  try {
    // Get security stats
    const [totalUsers, confirmedUsers, recentLogins, failedLogins, auditStats] = await Promise.all([
      pool.query('SELECT COUNT(*) as count FROM public.users'),
      pool.query('SELECT COUNT(*) as count FROM public.users WHERE is_active IS NOT NULL'),
      pool.query(`
        SELECT COUNT(*) as count 
        FROM public.users 
        WHERE updated_at > NOW() - INTERVAL '7 days'
      `),
      pool.query(`
        SELECT COUNT(*) as count 
        FROM public.audit_logs 
        WHERE action LIKE 'login.failed%' 
        AND timestamp > NOW() - INTERVAL '24 hours'
      `).catch(() => ({ rows: [{ count: '0' }] })),
      pool.query(`
        SELECT 
          COUNT(*) as total_logs,
          COUNT(*) FILTER (WHERE timestamp > NOW() - INTERVAL '24 hours') as last_24h
        FROM public.audit_logs
      `).catch(() => ({ rows: [{ total_logs: '0', last_24h: '0' }] })),
    ]);

    res.json({
      authentication: {
        totalUsers: parseInt(totalUsers.rows[0]?.count || '0'),
        confirmedUsers: parseInt(confirmedUsers.rows[0]?.count || '0'),
        recentLogins: parseInt(recentLogins.rows[0]?.count || '0'),
        failedLogins: parseInt(failedLogins.rows[0]?.count || '0'),
      },
      settings: {
        jwtExpiry: '7d',
        passwordMinLength: 8,
        requireEmailConfirmation: true,
        encryptionEnabled: process.env.ENABLE_ENCRYPTION === 'true',
      },
      auditTrail: {
        totalLogs: parseInt(auditStats.rows[0]?.total_logs || '0'),
        last24h: parseInt(auditStats.rows[0]?.last_24h || '0'),
        retentionDays: 90, // Default retention policy
      },
    });
  } catch (error: any) {
    logError('Error fetching security info', error, { userId: req.userId });
    res.status(500).json({ error: 'Failed to fetch security information' });
  }
});

/**
 * GET /api/admin/audit-logs
 * Get audit trail logs for SOC 2 compliance
 * Supports filtering by action, user, date range, and search
 */
router.get('/audit-logs', authenticateToken, requireRole('super_admin', 'tenant_admin'), async (req: AuthRequest, res) => {
  try {
    const { 
      page = '1', 
      limit = '50', 
      action, 
      user_id, 
      start_date, 
      end_date,
      search 
    } = req.query;

    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
    const offset = (pageNum - 1) * limitNum;

    // Get user info for tenant filtering
    const userResult = await pool.query(
      'SELECT role, tenant_id FROM public.users WHERE id = $1',
      [req.userId]
    );
    const user = userResult.rows[0];
    const isSuperAdmin = user?.role === 'super_admin';
    const userTenantId = user?.tenant_id;

    // Build WHERE clause
    const conditions: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    // Tenant isolation for non-super admins
    if (!isSuperAdmin && userTenantId) {
      conditions.push(`tenant_id = $${paramIndex}`);
      params.push(userTenantId);
      paramIndex++;
    }

    // Filter by action
    if (action) {
      conditions.push(`action = $${paramIndex}`);
      params.push(action);
      paramIndex++;
    }

    // Filter by user
    if (user_id) {
      conditions.push(`user_id = $${paramIndex}`);
      params.push(user_id);
      paramIndex++;
    }

    // Filter by date range
    if (start_date) {
      conditions.push(`timestamp >= $${paramIndex}`);
      params.push(start_date);
      paramIndex++;
    }
    if (end_date) {
      conditions.push(`timestamp <= $${paramIndex}`);
      params.push(end_date);
      paramIndex++;
    }

    // Search in resource (table column), resource_id, description, or metadata
    if (search) {
      conditions.push(`(
        al.resource ILIKE $${paramIndex} OR 
        al.resource_id::text ILIKE $${paramIndex} OR 
        al.description ILIKE $${paramIndex} OR
        al.metadata::text ILIKE $${paramIndex}
      )`);
      params.push(`%${search}%`);
      paramIndex++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Get total count
    const countQuery = `SELECT COUNT(*) as count FROM public.audit_logs ${whereClause}`;
    const countResult = await pool.query(countQuery, params);
    const total = parseInt(countResult.rows[0]?.count || '0');

    // Get audit logs with user details
    const logsQuery = `
      SELECT 
        al.id,
        al.user_id,
        COALESCE(u.email, al.user_email) as user_email,
        COALESCE(p.full_name, al.user_email) as user_name,
        al.action,
        al.resource as resource_type,
        al.resource_id,
        al.description,
        al.changes,
        al.metadata,
        al.status,
        al.error_message,
        al.ip_address,
        al.user_agent,
        al.timestamp as created_at
      FROM public.audit_logs al
      LEFT JOIN public.users u ON al.user_id = u.id
      LEFT JOIN public.profiles p ON u.id = p.user_id
      ${whereClause}
      ORDER BY al.timestamp DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;
    params.push(limitNum, offset);

    const logsResult = await pool.query(logsQuery, params);

    res.json({
      logs: logsResult.rows,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
      },
    });
  } catch (error: any) {
    logError('Error fetching audit logs', error, { userId: req.userId });
    res.status(500).json({ error: 'Failed to fetch audit logs' });
  }
});

/**
 * GET /api/admin/audit-stats
 * Get audit trail statistics for SOC 2 compliance dashboard
 */
// Clear failed login attempts (admin only)
router.post('/clear-failed-logins', authenticateToken, requireRole('super_admin'), async (req: AuthRequest, res) => {
  try {
    const { email } = req.body;
    
    if (email) {
      // Clear failed logins for specific email
      await pool.query(
        'DELETE FROM public.failed_login_attempts WHERE email = $1',
        [email]
      );
      res.json({ 
        success: true, 
        message: `Cleared failed login attempts for ${email}` 
      });
    } else {
      // Clear all failed logins older than 15 minutes
      await pool.query(
        'DELETE FROM public.failed_login_attempts WHERE attempted_at < NOW() - INTERVAL \'15 minutes\''
      );
      res.json({ 
        success: true, 
        message: 'Cleared old failed login attempts' 
      });
    }
  } catch (error: any) {
    logError('Error clearing failed logins', error, { userId: req.userId });
    res.status(500).json({ error: 'Failed to clear failed login attempts' });
  }
});

router.get('/audit-stats', authenticateToken, requireRole('super_admin', 'tenant_admin'), async (req: AuthRequest, res) => {
  try {
    // Get user info for tenant filtering
    const userResult = await pool.query(
      'SELECT role, tenant_id FROM public.users WHERE id = $1',
      [req.userId]
    );
    const user = userResult.rows[0];
    const isSuperAdmin = user?.role === 'super_admin';
    const userTenantId = user?.tenant_id;

    // Build tenant filter safely
    const tenantConditions: string[] = [];
    const tenantParams: any[] = [];
    let tenantParamIndex = 1;

    if (!isSuperAdmin && userTenantId) {
      tenantConditions.push(`tenant_id = $${tenantParamIndex}`);
      tenantParams.push(userTenantId);
    }

    const tenantWhere = tenantConditions.length > 0 ? `WHERE ${tenantConditions.join(' AND ')}` : '';
    const tenantAnd = tenantConditions.length > 0 ? 'AND' : 'WHERE';

    // Get statistics
    const [totalLogs, last24h, last7d, last30d, topActions, topUsers] = await Promise.all([
      pool.query(`SELECT COUNT(*) as count FROM public.audit_logs ${tenantWhere}`, tenantParams),
      pool.query(`SELECT COUNT(*) as count FROM public.audit_logs ${tenantWhere} ${tenantAnd} timestamp > NOW() - INTERVAL '24 hours'`, tenantParams),
      pool.query(`SELECT COUNT(*) as count FROM public.audit_logs ${tenantWhere} ${tenantAnd} timestamp > NOW() - INTERVAL '7 days'`, tenantParams),
      pool.query(`SELECT COUNT(*) as count FROM public.audit_logs ${tenantWhere} ${tenantAnd} timestamp > NOW() - INTERVAL '30 days'`, tenantParams),
      pool.query(`
        SELECT action, COUNT(*)::text as count 
        FROM public.audit_logs 
        ${tenantWhere}
        GROUP BY action 
        ORDER BY count DESC 
        LIMIT 10
      `, tenantParams),
      pool.query(`
        SELECT 
          al.user_id,
          COALESCE(u.email, al.user_email) as user_email,
          COALESCE(p.full_name, u.email, al.user_email) as user_name,
          COUNT(*)::text as action_count
        FROM public.audit_logs al
        LEFT JOIN public.users u ON al.user_id = u.id
        LEFT JOIN public.profiles p ON u.id = p.user_id
        ${tenantWhere}
        GROUP BY al.user_id, u.email, p.full_name, al.user_email
        ORDER BY action_count DESC
        LIMIT 10
      `, tenantParams),
    ]);

    res.json({
      totalLogs: parseInt(totalLogs.rows[0]?.count || '0'),
      last24h: parseInt(last24h.rows[0]?.count || '0'),
      last7d: parseInt(last7d.rows[0]?.count || '0'),
      last30d: parseInt(last30d.rows[0]?.count || '0'),
      topActions: topActions.rows,
      topUsers: topUsers.rows,
    });
  } catch (error: any) {
    logError('Error fetching audit stats', error, { userId: req.userId });
    res.status(500).json({ error: 'Failed to fetch audit statistics' });
  }
});

export default router;

