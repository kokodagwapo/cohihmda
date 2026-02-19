/**
 * Admin Routes
 * Admin-only endpoints for system management
 */

import { Router } from "express";
import pg from "pg";
import { pool } from "../config/database.js";
import { pool as managementPool } from "../config/managementDatabase.js";
import { authenticateToken, AuthRequest } from "../middleware/auth.js";
import { requireRole, requirePermission, requirePlatformStaff } from "../middleware/rbac.js";
import { auditLog } from "../services/auditLogger.js";
import { logError, logWarn, logInfo, logDebug } from "../services/logger.js";
import { getVersionInfo } from "../services/versionService.js";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { tenantDbManager } from "../config/tenantDatabaseManager.js";
import { listTenants } from "../services/tenantProvisioningService.js";
import { createEncompassUserSyncService } from "../services/encompassUserSyncService.js";
import ssoConfigRoutes from "./admin/ssoConfig.js";

const router = Router();

/**
 * Helper to resolve tenant context for platform admins
 * Platform admins can pass tenant_id to specify which tenant to operate on
 * Tenant admins use their own tenant from the token
 * 
 * Returns tenantSlug, tenantId, and optionally the tenantPool
 */
async function resolveTenantContext(
  req: AuthRequest,
  tenantIdParam?: string,
  options?: { includePool?: boolean },
): Promise<{ tenantSlug: string; tenantId: string; tenantPool?: pg.Pool } | null> {
  const isPlatformAdmin =
    req.userRole === "super_admin" || req.userRole === "platform_admin";

  let tenantSlug: string | undefined;
  let tenantId: string | undefined;

  // For platform admins with a tenant_id parameter
  if (isPlatformAdmin && tenantIdParam) {
    const result = await managementPool.query(
      "SELECT id, slug FROM coheus_tenants WHERE id = $1",
      [tenantIdParam],
    );
    if (result.rows.length > 0) {
      tenantSlug = result.rows[0].slug;
      tenantId = result.rows[0].id;
    }
  }
  // For tenant users, use their tenant from token
  else if (req.tenantSlug) {
    const result = await managementPool.query(
      "SELECT id FROM coheus_tenants WHERE slug = $1",
      [req.tenantSlug],
    );
    if (result.rows.length > 0) {
      tenantSlug = req.tenantSlug;
      tenantId = result.rows[0].id;
    }
  }

  if (!tenantSlug || !tenantId) {
    return null;
  }

  // Optionally include the pool
  if (options?.includePool) {
    const tenantPool = await tenantDbManager.getTenantPool(tenantSlug);
    return { tenantSlug, tenantId, tenantPool: tenantPool || undefined };
  }

  return { tenantSlug, tenantId };
}

// Validation schemas
const createUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  full_name: z.string().optional(),
  tenant_id: z.string().uuid().optional(),
  role: z
    .enum([
      "super_admin",
      "tenant_admin",
      "loan_officer",
      "processor",
      "viewer",
      "user",
    ])
    .optional()
    .default("user"),
});

const updateUserSchema = z.object({
  email: z.string().email().optional(),
  full_name: z.string().optional(),
  password: z.string().min(6).optional(),
  tenant_id: z.string().uuid().optional().nullable(),
  role: z
    .enum([
      "super_admin",
      "tenant_admin",
      "loan_officer",
      "processor",
      "viewer",
      "user",
    ])
    .optional(),
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
router.get(
  "/stats",
  authenticateToken,
  requirePlatformStaff(),
  async (req: AuthRequest, res) => {
  try {
    // Use auth token values instead of querying legacy public.users
    const userRole = req.userRole || "user";
    const userTenantId = req.tenantId || null;
    const isSuperAdmin = req.isSuperAdmin || userRole === "super_admin" || userRole === "platform_admin";

    // Run essential queries in parallel using management database
    const [tenantsResult, usersResult] = await Promise.all([
        managementPool.query(
          "SELECT COUNT(*) as count FROM coheus_tenants WHERE status = $1",
          ["active"],
        ),
        managementPool.query("SELECT COUNT(*) as count FROM coheus_users WHERE is_active = true"),
    ]);

    // Return minimal, fast response
    res.json({
      // Basic counts (always available)
        totalTenants: parseInt(tenantsResult.rows[0]?.count || "0"),
        totalUsers: parseInt(usersResult.rows[0]?.count || "0"),
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
      logError("Error fetching admin stats", error, { userId: req.userId });
      res
        .status(500)
        .json({ error: "Failed to fetch stats", details: error.message });
    }
  },
);

/**
 * GET /api/admin/tenants/:id/metrics
 * Get metrics for a specific tenant (super_admin only)
 */
router.get(
  "/tenants/:id/metrics",
  authenticateToken,
  requireRole("super_admin"),
  async (req: AuthRequest, res) => {
  try {
    const tenantId = req.params.id as string;

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
      FROM public.los_connections`,
    );

    // Get loan counts
      let loanCounts = {
        total_loans: 0,
        loans_this_month: 0,
        loans_this_year: 0,
      };
    try {
      const loansResult = await tenantPool.query(
        `SELECT 
          COUNT(*) as total_loans,
          COUNT(*) FILTER (WHERE created_at >= date_trunc('month', CURRENT_DATE)) as loans_this_month,
          COUNT(*) FILTER (WHERE created_at >= date_trunc('year', CURRENT_DATE)) as loans_this_year
        FROM public.loans`,
      );
      if (loansResult.rows.length > 0) {
        loanCounts = loansResult.rows[0];
      }
    } catch (error: any) {
      // Loans table might not exist yet
        logDebug("Loans table not found for tenant metrics", {
          tenantId,
          error: error.message,
        });
    }

    // Get user counts
    let userCounts = { total_users: 0 };
    try {
      const usersResult = await tenantPool.query(
          `SELECT COUNT(*) as total_users FROM public.users`,
      );
      if (usersResult.rows.length > 0) {
        userCounts = usersResult.rows[0];
      }
    } catch (error: any) {
        logDebug("Users table not found for tenant metrics", {
          tenantId,
          error: error.message,
        });
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
      logError("Error fetching tenant metrics", error, {
        userId: req.userId,
        tenantId: req.params.id as string,
      });
      res
        .status(500)
        .json({
          error: "Failed to fetch tenant metrics",
          details: error.message,
        });
    }
  },
);

/**
 * GET /api/admin/tenants
 * Get all tenants (admin only) - from management database
 */
router.get(
  "/tenants",
  authenticateToken,
  requirePlatformStaff(),
  async (req: AuthRequest, res) => {
  try {
    // Get tenants from management database
    const tenants = await listTenants();
    
    // Get user counts for each tenant (from user_tenant_mappings)
    const tenantsWithCounts = await Promise.all(
      tenants.map(async (tenant) => {
        try {
          const userCountResult = await managementPool.query(
            `SELECT COUNT(*) as user_count FROM user_tenant_mappings WHERE tenant_id = $1`,
              [tenant.id],
          );
          
          // Try to get loan count from tenant database
          let loanCount = 0;
          try {
            const tenantPool = await tenantDbManager.getTenantPool(tenant.id);
            const loanCountResult = await tenantPool.query(
                `SELECT COUNT(*) as loan_count FROM public.loans`,
            );
              loanCount = parseInt(loanCountResult.rows[0]?.loan_count || "0");
          } catch (error: any) {
            // Loans table might not exist yet
              logDebug("Could not get loan count for tenant", {
                tenantId: tenant.id,
                error: error.message,
              });
          }
          
          return {
            ...tenant,
              user_count: parseInt(userCountResult.rows[0]?.user_count || "0"),
            loan_count: loanCount,
          };
        } catch (error: any) {
            logWarn("Error getting counts for tenant", {
              tenantId: tenant.id,
              error: error.message,
            });
          return {
            ...tenant,
            user_count: 0,
            loan_count: 0,
          };
        }
        }),
    );

    res.json({ tenants: tenantsWithCounts });
  } catch (error: any) {
      logError("Error fetching tenants", error, { userId: req.userId });
      res
        .status(500)
        .json({ error: "Failed to fetch tenants", details: error.message });
    }
  },
);

/**
 * GET /api/admin/users
 * Get all users (admin only)
 */
router.get(
  "/users",
  authenticateToken,
  requirePlatformStaff(),
  async (req: AuthRequest, res) => {
  try {
    // Use auth token values instead of querying legacy public.users
    const userRole = req.userRole || "user";
    const userTenantId = req.tenantId || null;
    const isSuperAdmin = req.isSuperAdmin || userRole === "super_admin" || userRole === "platform_admin";

    let query = `
      SELECT 
        u.id,
        u.email,
        u.full_name,
        u.role,
        u.created_at,
        u.updated_at,
        m.tenant_id,
        t.name as tenant_name
      FROM coheus_users u
      LEFT JOIN user_tenant_mappings m ON m.user_id = u.id
      LEFT JOIN coheus_tenants t ON t.id = m.tenant_id
    `;
    
    const params: any[] = [];
    
    // If not super admin, only show users from same tenant
    if (!isSuperAdmin && userTenantId) {
        query += " WHERE m.tenant_id = $1";
      params.push(userTenantId);
    }
    
      query += " ORDER BY u.created_at DESC";
    
    const result = await managementPool.query(query, params);
    
    res.json({ users: result.rows });
  } catch (error: any) {
      logError("Error fetching users", error, { userId: req.userId });
      res
        .status(500)
        .json({ error: "Failed to fetch users", details: error.message });
    }
  },
);

/**
 * POST /api/admin/users
 * Create a new user (admin only)
 */
router.post(
  "/users",
  authenticateToken,
  requirePlatformStaff(),
  async (req: AuthRequest, res) => {
  try {
    const validated = createUserSchema.parse(req.body);

    // Prevent privilege escalation: non-platform staff cannot assign elevated roles
    const PLATFORM_ONLY_ROLES = new Set(["super_admin", "platform_admin", "support", "tenant_admin"]);
    const callerRole = req.userRole || "user";
    const isPlatformStaff = ["super_admin", "platform_admin", "support", "admin"].includes(callerRole);
    if (!isPlatformStaff && PLATFORM_ONLY_ROLES.has(validated.role)) {
      return res.status(403).json({
        error: "Forbidden",
        message: `Your role (${callerRole}) cannot assign the '${validated.role}' role.`,
      });
    }

    const hashedPassword = await bcrypt.hash(validated.password, 10);
    
    const result = await managementPool.query(
      `INSERT INTO coheus_users (email, encrypted_password, full_name, role, created_at, updated_at)
       VALUES ($1, $2, $3, $4, NOW(), NOW())
       RETURNING id, email, full_name, role, created_at`,
        [
          validated.email,
          hashedPassword,
          validated.full_name || null,
          validated.role,
        ],
    );
    
    const newUser = result.rows[0];
    
    // If tenant_id provided, create tenant mapping
    if (validated.tenant_id) {
      await managementPool.query(
        `INSERT INTO user_tenant_mappings (user_id, tenant_id, role, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW())
         ON CONFLICT (user_id, tenant_id) DO UPDATE SET role = $3, updated_at = NOW()`,
          [newUser.id, validated.tenant_id, validated.role || 'user'],
      );
    }
    
    auditLog({
      userId: req.userId!,
        action: "create_user",
        resource: "user",
      resourceId: newUser.id,
      metadata: { email: validated.email, role: validated.role },
    });
    
    res.status(201).json({ user: newUser });
  } catch (error: any) {
      if (error.name === "ZodError") {
        res
          .status(400)
          .json({ error: "Validation error", details: error.errors });
      } else if (error.code === "23505") {
        // Unique violation
        res.status(409).json({ error: "User with this email already exists" });
    } else {
        logError("Error creating user", error, { userId: req.userId });
        res
          .status(500)
          .json({ error: "Failed to create user", details: error.message });
      }
    }
  },
);

/**
 * PUT /api/admin/users/:id
 * Update a user (admin only)
 */
router.put(
  "/users/:id",
  authenticateToken,
  requirePlatformStaff(),
  async (req: AuthRequest, res) => {
  try {
    const id = req.params.id as string;
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
    
    const result = await managementPool.query(
      `UPDATE coheus_users 
       SET ${updates.join(", ")}
       WHERE id = $${paramIndex}
       RETURNING id, email, full_name, role, created_at, updated_at`,
        params,
    );
    
    if (result.rows.length === 0) {
        return res.status(404).json({ error: "User not found" });
    }
    
    // Update tenant mapping if provided
    if (validated.tenant_id !== undefined) {
      if (validated.tenant_id === null) {
        // Remove tenant mapping
          await managementPool.query("DELETE FROM user_tenant_mappings WHERE user_id = $1", [
            id,
          ]);
      } else {
        // Update or create tenant mapping
        await managementPool.query(
          `INSERT INTO user_tenant_mappings (user_id, tenant_id, role, created_at, updated_at)
           VALUES ($1, $2, $3, NOW(), NOW())
           ON CONFLICT (user_id, tenant_id) DO UPDATE SET updated_at = NOW()`,
            [id, validated.tenant_id, validated.role || 'user'],
        );
      }
    }
    
    auditLog({
      userId: req.userId!,
        action: "update_user",
        resource: "user",
      resourceId: id,
      metadata: validated,
    });
    
    res.json({ user: result.rows[0] });
  } catch (error: any) {
      if (error.name === "ZodError") {
        res
          .status(400)
          .json({ error: "Validation error", details: error.errors });
    } else {
        logError("Error updating user", error, {
          userId: req.userId,
          userToUpdate: req.params.id as string,
        });
        res
          .status(500)
          .json({ error: "Failed to update user", details: error.message });
      }
    }
  },
);

/**
 * DELETE /api/admin/users/:id
 * Delete a user (admin only)
 */
router.delete(
  "/users/:id",
  authenticateToken,
  requirePlatformStaff(),
  async (req: AuthRequest, res) => {
  try {
    const id = req.params.id as string;
    
    // Don't allow deleting yourself
    if (id === req.userId) {
        return res
          .status(400)
          .json({ error: "Cannot delete your own account" });
    }
    
    const result = await managementPool.query(
        "DELETE FROM coheus_users WHERE id = $1 RETURNING id, email",
        [id],
    );
    
    if (result.rows.length === 0) {
        return res.status(404).json({ error: "User not found" });
    }
    
    auditLog({
      userId: req.userId!,
        action: "delete_user",
        resource: "user",
      resourceId: id,
      metadata: { email: result.rows[0].email },
    });
    
      res.json({ message: "User deleted successfully" });
  } catch (error: any) {
      logError("Error deleting user", error, {
        userId: req.userId,
        userToDelete: req.params.id as string,
      });
      res
        .status(500)
        .json({ error: "Failed to delete user", details: error.message });
    }
  },
);

// ============================================================================
// NEW MULTI-DATABASE USER MANAGEMENT APIs
// ============================================================================

/**
 * GET /api/admin/super-admins
 * Get all super admins (from management database coheus_users table)
 */
router.get(
  "/super-admins",
  authenticateToken,
  requireRole("super_admin"),
  async (req: AuthRequest, res) => {
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
      logError("Error fetching super admins", error, { userId: req.userId });
      res
        .status(500)
        .json({
          error: "Failed to fetch super admins",
          details: error.message,
        });
    }
  },
);

/**
 * POST /api/admin/super-admins
 * Create a new super admin (in management database)
 */
router.post(
  "/super-admins",
  authenticateToken,
  requireRole("super_admin"),
  async (req: AuthRequest, res) => {
  try {
    const schema = z.object({
      email: z.string().min(1),
      password: z.string().min(6),
      full_name: z.string().optional(),
        role: z
          .enum(["super_admin", "platform_admin", "support"])
          .default("platform_admin"),
    });
    
    const validated = schema.parse(req.body);
    const hashedPassword = await bcrypt.hash(validated.password, 10);
    
      const result = await managementPool.query(
        `
      INSERT INTO coheus_users (email, encrypted_password, full_name, role, is_active)
      VALUES ($1, $2, $3, $4, true)
      RETURNING id, email, full_name, role, is_active, created_at
    `,
        [
          validated.email,
          hashedPassword,
          validated.full_name || null,
          validated.role,
        ],
      );

      logInfo("Super admin created", {
        createdBy: req.userId,
        newUser: validated.email,
      });
    
    res.status(201).json({ user: result.rows[0] });
  } catch (error: any) {
      if (error.code === "23505") {
        res.status(409).json({ error: "User with this email already exists" });
      } else if (error.name === "ZodError") {
        res
          .status(400)
          .json({ error: "Validation error", details: error.errors });
    } else {
        logError("Error creating super admin", error, { userId: req.userId });
        res
          .status(500)
          .json({
            error: "Failed to create super admin",
            details: error.message,
          });
      }
    }
  },
);

/**
 * PUT /api/admin/super-admins/:id
 * Update a super admin
 */
router.put(
  "/super-admins/:id",
  authenticateToken,
  requireRole("super_admin"),
  async (req: AuthRequest, res) => {
  try {
    const id = req.params.id as string;
    const schema = z.object({
      email: z.string().min(1).optional(),
      password: z.string().min(6).optional(),
      full_name: z.string().optional(),
        role: z.enum(["super_admin", "platform_admin", "support"]).optional(),
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
        return res.status(400).json({ error: "No fields to update" });
    }
    
    updates.push(`updated_at = NOW()`);
    params.push(id);
    
      const result = await managementPool.query(
        `
      UPDATE coheus_users 
      SET ${updates.join(", ")}
      WHERE id = $${paramIndex}
      RETURNING id, email, full_name, role, is_active, created_at, updated_at
    `,
        params,
      );
    
    if (result.rows.length === 0) {
        return res.status(404).json({ error: "Super admin not found" });
    }
    
    res.json({ user: result.rows[0] });
  } catch (error: any) {
      logError("Error updating super admin", error, { userId: req.userId });
      res
        .status(500)
        .json({
          error: "Failed to update super admin",
          details: error.message,
        });
    }
  },
);

/**
 * DELETE /api/admin/super-admins/:id
 * Delete a super admin
 */
router.delete(
  "/super-admins/:id",
  authenticateToken,
  requireRole("super_admin"),
  async (req: AuthRequest, res) => {
  try {
    const id = req.params.id as string;
    
    if (id === req.userId) {
        return res
          .status(400)
          .json({ error: "Cannot delete your own account" });
    }
    
    const result = await managementPool.query(
        "DELETE FROM coheus_users WHERE id = $1 RETURNING id, email",
        [id],
    );
    
    if (result.rows.length === 0) {
        return res.status(404).json({ error: "Super admin not found" });
    }
    
      logInfo("Super admin deleted", {
        deletedBy: req.userId,
        deletedUser: result.rows[0].email,
      });
    
      res.json({ message: "Super admin deleted successfully" });
  } catch (error: any) {
      logError("Error deleting super admin", error, { userId: req.userId });
      res
        .status(500)
        .json({
          error: "Failed to delete super admin",
          details: error.message,
        });
    }
  },
);

/**
 * GET /api/admin/tenants/:tenantId/users
 * Get all users for a specific tenant (from tenant database)
 */
router.get(
  "/tenants/:tenantId/users",
  authenticateToken,
  requireRole("super_admin", "platform_admin", "tenant_admin"),
  async (req: AuthRequest, res) => {
  try {
    const tenantId = req.params.tenantId as string;
    
    // Tenant admins can only access their own tenant's users
      if (req.userRole === "tenant_admin" && req.tenantId !== tenantId) {
      return res.status(403).json({ 
          error: "Forbidden",
          message: "You can only access users from your own organization",
      });
    }
    
    // Get tenant pool
    const tenantPool = await tenantDbManager.getTenantPool(tenantId);
    
    // Filter out super_admin role -- that's a platform-level role that should
    // never appear in a tenant's user list (may have been JIT-created via SSO)
    const result = await tenantPool.query(`
      SELECT 
        id,
        email,
        full_name,
        role,
        is_active,
        last_login_at,
        created_at,
        updated_at,
        encompass_user_id,
        los_connection_id,
        loan_access_mode,
        loan_access_synced_at
      FROM users
      WHERE role != 'super_admin'
      ORDER BY created_at DESC
    `);
    
    // Get tenant info for response
    const tenantInfo = await managementPool.query(
        "SELECT id, name, slug FROM coheus_tenants WHERE id = $1",
        [tenantId],
    );
    
    res.json({ 
      users: result.rows,
        tenant: tenantInfo.rows[0] || null,
    });
  } catch (error: any) {
      logError("Error fetching tenant users", error, {
        userId: req.userId,
        tenantId: req.params.tenantId as string,
      });
      res
        .status(500)
        .json({
          error: "Failed to fetch tenant users",
          details: error.message,
        });
    }
  },
);

/**
 * POST /api/admin/tenants/:tenantId/users
 * Create a new user in a specific tenant
 */
router.post(
  "/tenants/:tenantId/users",
  authenticateToken,
  requireRole("super_admin", "platform_admin", "tenant_admin"),
  async (req: AuthRequest, res) => {
  try {
    const tenantId = req.params.tenantId as string;
    
    // Tenant admins can only create users in their own tenant
      if (req.userRole === "tenant_admin" && req.tenantId !== tenantId) {
      return res.status(403).json({ 
          error: "Forbidden",
          message: "You can only create users in your own organization",
      });
    }
    
    // Reject platform-level roles in tenant databases
    if (req.body.role === "super_admin" || req.body.role === "platform_admin") {
      return res.status(400).json({
        error: "Cannot create platform-level users in a tenant. Use the platform admin management instead.",
      });
    }

    const schema = z.object({
      email: z.string().email(),
      password: z.string().min(6),
      full_name: z.string().optional(),
        role: z
          .enum([
            "tenant_admin",
            "admin",
            "user",
            "viewer",
            "loan_officer",
            "processor",
          ])
          .default("user"),
    });
    
    const validated = schema.parse(req.body);
    const hashedPassword = await bcrypt.hash(validated.password, 10);
    
    // Get tenant pool
    const tenantPool = await tenantDbManager.getTenantPool(tenantId);
    
      const result = await tenantPool.query(
        `
      INSERT INTO users (email, encrypted_password, full_name, role, is_active, loan_access_mode)
      VALUES ($1, $2, $3, $4, true, 'full_access')
      RETURNING id, email, full_name, role, is_active, created_at
    `,
        [
          validated.email,
          hashedPassword,
          validated.full_name || null,
          validated.role,
        ],
      );
    
    // Get tenant info for logging
    const tenantInfo = await managementPool.query(
        "SELECT name FROM coheus_tenants WHERE id = $1",
        [tenantId],
    );
    
      logInfo("Tenant user created", {
      createdBy: req.userId, 
      newUser: validated.email,
      tenantId,
        tenantName: tenantInfo.rows[0]?.name,
    });
    
    res.status(201).json({ user: result.rows[0] });
  } catch (error: any) {
      if (error.code === "23505") {
        res
          .status(409)
          .json({
            error: "User with this email already exists in this tenant",
          });
      } else if (error.name === "ZodError") {
        res
          .status(400)
          .json({ error: "Validation error", details: error.errors });
    } else {
        logError("Error creating tenant user", error, {
          userId: req.userId,
          tenantId: req.params.tenantId as string,
        });
        res
          .status(500)
          .json({
            error: "Failed to create tenant user",
            details: error.message,
          });
      }
    }
  },
);

/**
 * PUT /api/admin/tenants/:tenantId/users/:userId
 * Update a user in a specific tenant
 */
router.put(
  "/tenants/:tenantId/users/:userId",
  authenticateToken,
  requireRole("super_admin", "platform_admin", "tenant_admin"),
  async (req: AuthRequest, res) => {
  try {
    const tenantId = req.params.tenantId as string;
    const userId = req.params.userId as string;
    
    // Tenant admins can only update users in their own tenant
      if (req.userRole === "tenant_admin" && req.tenantId !== tenantId) {
      return res.status(403).json({ 
          error: "Forbidden",
          message: "You can only update users in your own organization",
      });
    }
    
    const schema = z.object({
      email: z.string().email().optional(),
      password: z.string().min(6).optional(),
      full_name: z.string().optional(),
        role: z
          .enum([
            "tenant_admin",
            "admin",
            "user",
            "viewer",
            "loan_officer",
            "processor",
          ])
          .optional(),
      is_active: z.boolean().optional(),
      loan_access_mode: z.enum(["encompass_sync", "full_access", "no_access", "manual"]).optional(),
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
    if (validated.loan_access_mode !== undefined) {
      updates.push(`loan_access_mode = $${paramIndex++}`);
      params.push(validated.loan_access_mode);
    }
    
    if (updates.length === 0) {
        return res.status(400).json({ error: "No fields to update" });
    }
    
    updates.push(`updated_at = NOW()`);
    params.push(userId);
    
    const tenantPool = await tenantDbManager.getTenantPool(tenantId);
    
      const result = await tenantPool.query(
        `
      UPDATE users 
      SET ${updates.join(", ")}
      WHERE id = $${paramIndex}
      RETURNING id, email, full_name, role, is_active, created_at, updated_at, 
                encompass_user_id, los_connection_id, loan_access_mode, loan_access_synced_at
    `,
        params,
      );
    
    if (result.rows.length === 0) {
        return res.status(404).json({ error: "User not found" });
    }
    
    res.json({ user: result.rows[0] });
  } catch (error: any) {
      logError("Error updating tenant user", error, {
        userId: req.userId,
        tenantId: req.params.tenantId as string,
      });
      res
        .status(500)
        .json({
          error: "Failed to update tenant user",
          details: error.message,
        });
    }
  },
);

/**
 * DELETE /api/admin/tenants/:tenantId/users/:userId
 * Delete a user from a specific tenant
 */
router.delete(
  "/tenants/:tenantId/users/:userId",
  authenticateToken,
  requireRole("super_admin", "platform_admin", "tenant_admin"),
  async (req: AuthRequest, res) => {
  try {
    const tenantId = req.params.tenantId as string;
    const userId = req.params.userId as string;
    
    // Tenant admins can only delete users in their own tenant
      if (req.userRole === "tenant_admin" && req.tenantId !== tenantId) {
      return res.status(403).json({ 
          error: "Forbidden",
          message: "You can only delete users in your own organization",
      });
    }
    
    const tenantPool = await tenantDbManager.getTenantPool(tenantId);
    
    const result = await tenantPool.query(
        "DELETE FROM users WHERE id = $1 RETURNING id, email",
        [userId],
    );
    
    if (result.rows.length === 0) {
        return res.status(404).json({ error: "User not found" });
      }

      logInfo("Tenant user deleted", {
        deletedBy: req.userId,
        deletedUser: result.rows[0].email,
        tenantId,
      });

      res.json({ message: "User deleted successfully" });
  } catch (error: any) {
      logError("Error deleting tenant user", error, {
        userId: req.userId,
        tenantId: req.params.tenantId as string,
      });
      res
        .status(500)
        .json({
          error: "Failed to delete tenant user",
          details: error.message,
        });
    }
  },
);

/**
 * GET /api/admin/tenants/:tenantId/usage
 * Get usage statistics for a specific tenant
 */
router.get(
  "/tenants/:tenantId/usage",
  authenticateToken,
  requireRole("super_admin", "platform_admin", "tenant_admin"),
  async (req: AuthRequest, res) => {
    try {
      const tenantId = req.params.tenantId as string;

      // Tenant admins can only view their own tenant's usage
      if (req.userRole === "tenant_admin" && req.tenantId !== tenantId) {
        return res.status(403).json({
          error: "Forbidden",
          message: "You can only view usage for your own organization",
        });
      }

      const tenantPool = await tenantDbManager.getTenantPool(tenantId);

      // Run queries in parallel
      const [userCount, loanCount, storageResult, lastSyncResult] =
        await Promise.all([
          tenantPool.query("SELECT COUNT(*) as count FROM users"),
          tenantPool.query("SELECT COUNT(*) as count FROM loans"),
          tenantPool.query(
            "SELECT pg_database_size(current_database()) as size_bytes",
          ),
          tenantPool.query(
            "SELECT last_synced_at FROM los_connections WHERE is_active = true ORDER BY last_synced_at DESC NULLS LAST LIMIT 1",
          ),
        ]);

      const users = parseInt(userCount.rows[0]?.count || "0");
      const loans = parseInt(loanCount.rows[0]?.count || "0");
      const storageBytes = parseInt(
        storageResult.rows[0]?.size_bytes || "0",
      );
      const storageGB = Math.round((storageBytes / 1073741824) * 100) / 100;
      const lastSync = lastSyncResult.rows[0]?.last_synced_at || null;

      res.json({
        users: { current: users, limit: 0, percentage: 0 },
        loans: { current: loans, limit: 0, percentage: 0 },
        storage: {
          current: storageGB,
          limit: 0,
          percentage: 0,
          unit: "GB",
        },
        last_sync: lastSync,
        sync_status: lastSync ? "healthy" : "warning",
      });
    } catch (error: any) {
      logError("Error fetching tenant usage", error, {
        userId: req.userId,
        tenantId: req.params.tenantId as string,
      });
      res.status(500).json({
        error: "Failed to fetch usage statistics",
        details: error.message,
      });
    }
  },
);

/**
 * GET /api/admin/all-users
 * Get all users across all tenants (super admin only)
 * Returns super admins + all tenant users with tenant info
 */
router.get(
  "/all-users",
  authenticateToken,
  requireRole("super_admin", "platform_admin"),
  async (req: AuthRequest, res) => {
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
            created_at,
            encompass_user_id,
            los_connection_id,
            loan_access_mode,
            loan_access_synced_at
          FROM users
          ORDER BY created_at DESC
        `);
        
        // Add tenant info to each user
          usersResult.rows.forEach((user) => {
          allTenantUsers.push({
            ...user,
            tenant_id: tenant.id,
            tenant_name: tenant.name,
            tenant_slug: tenant.slug,
            is_super_admin: false,
          });
        });
      } catch (err: any) {
          logWarn("Could not fetch users from tenant", {
            tenantId: tenant.id,
            error: err.message,
          });
      }
    }
    
    res.json({
      superAdmins: superAdminsResult.rows,
      tenantUsers: allTenantUsers,
      tenants: tenantsResult.rows,
    });
  } catch (error: any) {
      logError("Error fetching all users", error, { userId: req.userId });
      res
        .status(500)
        .json({ error: "Failed to fetch users", details: error.message });
    }
  },
);

// =============================================================================
// ENCOMPASS USER MANAGEMENT
// =============================================================================

/**
 * Get cached Encompass users
 */
router.get(
  "/encompass-users",
  authenticateToken,
  requireRole("super_admin", "platform_admin", "tenant_admin", "admin"),
  async (req: AuthRequest, res) => {
    try {
      const {
        los_connection_id,
        search,
        enabled_only,
        unlinked_only,
        page,
        limit,
        tenant_id,
      } = req.query;

      if (!los_connection_id || typeof los_connection_id !== "string") {
        return res.status(400).json({ error: "los_connection_id is required" });
      }

      // Resolve tenant context (supports platform admin with tenant_id param)
      const tenantContext = await resolveTenantContext(
        req,
        tenant_id as string | undefined,
      );
      if (!tenantContext) {
        return res.status(400).json({ error: "Tenant context required" });
      }

      const tenantPool = await tenantDbManager.getTenantPool(
        tenantContext.tenantSlug,
      );
      if (!tenantPool) {
        return res.status(404).json({ error: "Tenant not found" });
      }

      const syncService = createEncompassUserSyncService(
        tenantPool,
        tenantContext.tenantId,
      );

      const result = await syncService.getCachedUsers(los_connection_id, {
        search: search as string,
        enabledOnly: enabled_only === "true",
        unlinkedOnly: unlinked_only === "true",
        page: page ? parseInt(page as string, 10) : 1,
        limit: limit ? parseInt(limit as string, 10) : 50,
      });

      return res.json(result);
    } catch (error: any) {
      logError("Error fetching Encompass users", error, { userId: req.userId });
      return res.status(500).json({
        error: "Failed to fetch Encompass users",
        details: error.message,
      });
    }
  },
);

/**
 * Sync Encompass users from API
 */
router.post(
  "/encompass-users/sync",
  authenticateToken,
  requireRole("super_admin", "platform_admin", "tenant_admin", "admin"),
  async (req: AuthRequest, res) => {
    try {
      const { los_connection_id, tenant_id } = req.body;

      if (!los_connection_id) {
        return res.status(400).json({ error: "los_connection_id is required" });
      }

      // Resolve tenant context (supports platform admin with tenant_id param)
      const tenantContext = await resolveTenantContext(req, tenant_id);
      if (!tenantContext) {
        return res.status(400).json({ error: "Tenant context required" });
      }

      const tenantPool = await tenantDbManager.getTenantPool(
        tenantContext.tenantSlug,
      );
      if (!tenantPool) {
        return res.status(404).json({ error: "Tenant not found" });
      }

      const syncService = createEncompassUserSyncService(
        tenantPool,
        tenantContext.tenantId,
      );
      const result = await syncService.syncUsers(los_connection_id, req.userId);

      // Audit log
      await auditLog({
        userId: req.userId,
        userEmail: req.userEmail,
        userRole: req.userRole,
        tenantId: tenantContext.tenantId,
        action: "encompass_user_sync",
        resource: "encompass_users",
        description: `Synced ${result.users_fetched} users from Encompass`,
        status: result.success ? "success" : "failure",
        metadata: result,
      }).catch(() => {});

      return res.json(result);
    } catch (error: any) {
      logError("Error syncing Encompass users", error, { userId: req.userId });
      return res.status(500)
        .json({
          error: "Failed to sync Encompass users",
          details: error.message,
        });
    }
  },
);

/**
 * Invite Encompass user to Cohi
 */
router.post(
  "/encompass-users/:encompassUserId/invite",
  authenticateToken,
  requireRole("super_admin", "platform_admin", "tenant_admin", "admin"),
  async (req: AuthRequest, res) => {
    try {
      const encompassUserId = req.params.encompassUserId as string;
      const { los_connection_id, role, invite_method, password, tenant_id } =
        req.body;

      if (!los_connection_id) {
        return res.status(400).json({ error: "los_connection_id is required" });
      }

      // Validate password for manual invite method
      if (invite_method === "manual" && (!password || password.length < 8)) {
        return res.status(400).json({
          error:
            "Password is required for manual invite and must be at least 8 characters",
        });
      }

      // Resolve tenant context (supports platform admin with tenant_id param)
      const tenantContext = await resolveTenantContext(req, tenant_id);
      if (!tenantContext) {
        return res.status(400).json({ error: "Tenant context required" });
      }

      const tenantPool = await tenantDbManager.getTenantPool(
        tenantContext.tenantSlug,
      );
      if (!tenantPool) {
        return res.status(404).json({ error: "Tenant not found" });
      }

      const syncService = createEncompassUserSyncService(
        tenantPool,
        tenantContext.tenantId,
      );
      const result = await syncService.inviteUser(
        encompassUserId,
        los_connection_id,
        {
          role: role || "user",
          invite_method: invite_method || "email",
          password: password, // Pass password for manual invites
          inviter_name: req.userEmail,
        },
      );

      if (result.success) {
        // Audit log
        await auditLog({
          userId: req.userId,
          userEmail: req.userEmail,
          userRole: req.userRole,
          tenantId: tenantContext.tenantId,
          action: "user_invited",
          resource: "users",
          resourceId: result.cohi_user_id,
          description: `Invited Encompass user ${encompassUserId} to Cohi`,
          status: "success",
          metadata: { encompassUserId, role, invite_method },
        }).catch(() => {});
      }

      return res.json(result);
    } catch (error: any) {
      logError("Error inviting Encompass user", error, { userId: req.userId });
      return res
        .status(500)
        .json({ error: "Failed to invite user", details: error.message });
    }
  },
);

/**
 * Bulk invite Encompass users
 */
router.post(
  "/encompass-users/bulk-invite",
  authenticateToken,
  requireRole("super_admin", "platform_admin", "tenant_admin", "admin"),
  async (req: AuthRequest, res) => {
    try {
      const {
        los_connection_id,
        encompass_user_ids,
        role,
        invite_method,
        tenant_id,
      } = req.body;

      if (
        !los_connection_id ||
        !encompass_user_ids ||
        !Array.isArray(encompass_user_ids)
      ) {
        return res.status(400).json({
          error: "los_connection_id and encompass_user_ids are required",
        });
      }

      // Resolve tenant context (supports platform admin with tenant_id param)
      const tenantContext = await resolveTenantContext(req, tenant_id);
      if (!tenantContext) {
        return res.status(400).json({ error: "Tenant context required" });
      }

      const tenantPool = await tenantDbManager.getTenantPool(
        tenantContext.tenantSlug,
      );
      if (!tenantPool) {
        return res.status(404).json({ error: "Tenant not found" });
      }

      const syncService = createEncompassUserSyncService(
        tenantPool,
        tenantContext.tenantId,
      );
      const result = await syncService.bulkInviteUsers(
        encompass_user_ids,
        los_connection_id,
        {
          role: role || "user",
          invite_method: invite_method || "email",
          inviter_name: req.userEmail,
        },
      );

      // Audit log
      await auditLog({
        userId: req.userId,
        userEmail: req.userEmail,
        userRole: req.userRole,
        tenantId: tenantContext.tenantId,
        action: "users_bulk_invited",
        resource: "users",
        description: `Bulk invited ${result.success_count} of ${encompass_user_ids.length} Encompass users`,
        status: result.failed_count === 0 ? "success" : "partial",
        metadata: {
          success_count: result.success_count,
          failed_count: result.failed_count,
        },
      }).catch(() => {});

      return res.json(result);
    } catch (error: any) {
      logError("Error bulk inviting Encompass users", error, {
        userId: req.userId,
      });
      return res
        .status(500)
        .json({ error: "Failed to bulk invite users", details: error.message });
    }
  },
);

/**
 * Link existing Cohi user to Encompass user
 */
router.post(
  "/users/:userId/link-encompass",
  authenticateToken,
  requireRole("super_admin", "platform_admin", "tenant_admin", "admin"),
  async (req: AuthRequest, res) => {
    try {
      const userId = req.params.userId as string;
      const { encompass_user_id, los_connection_id } = req.body;

      if (!encompass_user_id || !los_connection_id) {
        return res
          .status(400)
          .json({
            error: "encompass_user_id and los_connection_id are required",
          });
      }

      const tenantSlug = req.tenantSlug;
      if (!tenantSlug) {
        return res.status(400).json({ error: "Tenant context required" });
      }

      const tenantPool = await tenantDbManager.getTenantPool(tenantSlug);
      if (!tenantPool) {
        return res.status(404).json({ error: "Tenant not found" });
      }

      const tenantResult = await managementPool.query(
        "SELECT id FROM coheus_tenants WHERE slug = $1",
        [tenantSlug],
      );
      const tenantId = tenantResult.rows[0]?.id;

      const syncService = createEncompassUserSyncService(tenantPool, tenantId);
      const result = await syncService.linkUserToEncompass(
        userId,
        encompass_user_id,
        los_connection_id,
      );

      if (result.success) {
        // Get loan count for user
        const { getUserAccessibleLoansCount } =
          await import("../services/userLoanAccessService.js");
        const loanCount = await getUserAccessibleLoansCount(userId, tenantPool);

        // Audit log
        await auditLog({
          userId: req.userId,
          userEmail: req.userEmail,
          userRole: req.userRole,
          tenantId,
          action: "user_linked_to_encompass",
          resource: "users",
          resourceId: userId,
          description: `Linked user to Encompass user ${encompass_user_id}`,
          status: "success",
          metadata: {
            encompass_user_id,
            los_connection_id,
            accessible_loan_count: loanCount,
          },
        }).catch(() => {});

        return res.json({ ...result, accessible_loan_count: loanCount });
      }

      return res.status(400).json(result);
    } catch (error: any) {
      logError("Error linking user to Encompass", error, {
        userId: req.userId,
      });
      return res
        .status(500)
        .json({ error: "Failed to link user", details: error.message });
    }
  },
);

/**
 * Unlink Cohi user from Encompass
 */
router.post(
  "/users/:userId/unlink-encompass",
  authenticateToken,
  requireRole("super_admin", "platform_admin", "tenant_admin", "admin"),
  async (req: AuthRequest, res) => {
    try {
      const userId = req.params.userId as string;

      const tenantSlug = req.tenantSlug;
      if (!tenantSlug) {
        return res.status(400).json({ error: "Tenant context required" });
      }

      const tenantPool = await tenantDbManager.getTenantPool(tenantSlug);
      if (!tenantPool) {
        return res.status(404).json({ error: "Tenant not found" });
      }

      const tenantResult = await managementPool.query(
        "SELECT id FROM coheus_tenants WHERE slug = $1",
        [tenantSlug],
      );
      const tenantId = tenantResult.rows[0]?.id;

      const syncService = createEncompassUserSyncService(tenantPool, tenantId);
      const result = await syncService.unlinkUserFromEncompass(userId);

      if (result.success) {
        await auditLog({
          userId: req.userId,
          userEmail: req.userEmail,
          userRole: req.userRole,
          tenantId,
          action: "user_unlinked_from_encompass",
          resource: "users",
          resourceId: userId,
          description: "Unlinked user from Encompass",
          status: "success",
        }).catch(() => {});
      }

      return res.json(result);
    } catch (error: any) {
      logError("Error unlinking user from Encompass", error, {
        userId: req.userId,
      });
      return res
        .status(500)
        .json({ error: "Failed to unlink user", details: error.message });
    }
  },
);

/**
 * Get Encompass user sync history
 */
router.get(
  "/encompass-users/sync-history",
  authenticateToken,
  requireRole("super_admin", "platform_admin", "tenant_admin", "admin"),
  async (req: AuthRequest, res) => {
    try {
      const { los_connection_id, limit, tenant_id } = req.query;

      if (!los_connection_id || typeof los_connection_id !== "string") {
        return res.status(400).json({ error: "los_connection_id is required" });
      }

      // Resolve tenant context (supports platform admin with tenant_id param)
      const tenantContext = await resolveTenantContext(
        req,
        tenant_id as string | undefined,
      );
      if (!tenantContext) {
        return res.status(400).json({ error: "Tenant context required" });
      }

      const tenantPool = await tenantDbManager.getTenantPool(
        tenantContext.tenantSlug,
      );
      if (!tenantPool) {
        return res.status(404).json({ error: "Tenant not found" });
      }

      const syncService = createEncompassUserSyncService(
        tenantPool,
        tenantContext.tenantId,
      );
      const history = await syncService.getSyncHistory(
        los_connection_id,
        limit ? parseInt(limit as string, 10) : 10,
      );

      return res.json({ history });
    } catch (error: any) {
      logError("Error fetching sync history", error, { userId: req.userId });
      return res.status(500).json({
        error: "Failed to fetch sync history",
        details: error.message,
      });
    }
  },
);

/**
 * Sync user's loan access from Encompass
 * Uses impersonation to query Pipeline API with user's permissions
 */
router.post(
  "/users/:userId/sync-loan-access",
  authenticateToken,
  requireRole("super_admin", "platform_admin", "tenant_admin", "admin"),
  async (req: AuthRequest, res) => {
    try {
      const userId = req.params.userId as string;

      // Resolve tenant context - platform admins can pass tenant_id, tenant admins use their own
      const tenantContext = await resolveTenantContext(
        req, 
        req.body.tenant_id || req.query.tenant_id,
        { includePool: true }
      );
      if (!tenantContext) {
        return res.status(400).json({ error: "Tenant context required" });
      }

      const { tenantId, tenantPool } = tenantContext;
      if (!tenantPool) {
        return res.status(404).json({ error: "Tenant not found" });
      }

      const { syncUserLoanAccess } = await import(
        "../services/userLoanAccessService.js"
      );
      const result = await syncUserLoanAccess(userId, tenantPool, tenantId);

      if (result.success) {
        await auditLog({
          userId: req.userId,
          userEmail: req.userEmail,
          userRole: req.userRole,
          tenantId,
          action: "user_loan_access_synced",
          resource: "users",
          resourceId: userId,
          description: `Synced loan access for user: ${result.loansAccessible} loans accessible`,
          status: "success",
          metadata: result,
        }).catch(() => {});
      }

      return res.json(result);
    } catch (error: any) {
      logError("Error syncing user loan access", error, {
        userId: req.userId,
      });
      return res
        .status(500)
        .json({ error: "Failed to sync loan access", details: error.message });
    }
  },
);

/**
 * Get user's loan access sync history
 */
router.get(
  "/users/:userId/loan-access-history",
  authenticateToken,
  requireRole("super_admin", "platform_admin", "tenant_admin", "admin"),
  async (req: AuthRequest, res) => {
    try {
      const userId = req.params.userId as string;
      const { limit } = req.query;

      const tenantSlug = req.tenantSlug;
      if (!tenantSlug) {
        return res.status(400).json({ error: "Tenant context required" });
      }

      const tenantPool = await tenantDbManager.getTenantPool(tenantSlug);
      if (!tenantPool) {
        return res.status(404).json({ error: "Tenant not found" });
      }

      const { getUserLoanAccessSyncHistory } = await import(
        "../services/userLoanAccessService.js"
      );
      const history = await getUserLoanAccessSyncHistory(
        userId,
        tenantPool,
        limit ? parseInt(limit as string, 10) : 10,
      );

      return res.json({ history });
    } catch (error: any) {
      logError("Error fetching user loan access history", error, {
        userId: req.userId,
      });
      return res
        .status(500)
        .json({
          error: "Failed to fetch loan access history",
          details: error.message,
        });
    }
  },
);

/**
 * Debug endpoint to check loan access state
 * Helps diagnose why users might see 0 loans
 */
router.get(
  "/users/:userId/loan-access-debug",
  authenticateToken,
  requireRole("super_admin", "platform_admin", "tenant_admin", "admin"),
  async (req: AuthRequest, res) => {
    try {
      const userId = req.params.userId as string;

      const tenantSlug = req.tenantSlug;
      if (!tenantSlug) {
        return res.status(400).json({ error: "Tenant context required" });
      }

      const tenantPool = await tenantDbManager.getTenantPool(tenantSlug);
      if (!tenantPool) {
        return res.status(404).json({ error: "Tenant not found" });
      }

      // Get user info
      const userResult = await tenantPool.query(
        `SELECT id, email, role, encompass_user_id, los_connection_id, 
                loan_access_mode, loan_access_synced_at 
         FROM users WHERE id = $1`,
        [userId],
      );
      const user = userResult.rows[0];
      if (!user) {
        return res.status(404).json({ error: "User not found in tenant database" });
      }

      // Count user_loan_access entries
      const accessCountResult = await tenantPool.query(
        `SELECT COUNT(*) as count FROM user_loan_access WHERE user_id = $1`,
        [userId],
      );
      const accessCount = parseInt(accessCountResult.rows[0]?.count || '0', 10);

      // Sample some user_loan_access GUIDs
      const sampleAccessResult = await tenantPool.query(
        `SELECT loan_guid FROM user_loan_access WHERE user_id = $1 LIMIT 5`,
        [userId],
      );
      const sampleAccessGuids = sampleAccessResult.rows.map(r => r.loan_guid);

      // Count loans with guid populated
      const loansWithGuidResult = await tenantPool.query(
        `SELECT COUNT(*) as count FROM loans WHERE guid IS NOT NULL`,
      );
      const loansWithGuid = parseInt(loansWithGuidResult.rows[0]?.count || '0', 10);

      // Total loans
      const totalLoansResult = await tenantPool.query(
        `SELECT COUNT(*) as count FROM loans`,
      );
      const totalLoans = parseInt(totalLoansResult.rows[0]?.count || '0', 10);

      // Sample some loan GUIDs
      const sampleLoansResult = await tenantPool.query(
        `SELECT guid, loan_id, loan_number FROM loans WHERE guid IS NOT NULL LIMIT 5`,
      );
      const sampleLoans = sampleLoansResult.rows;

      // Check if any user_loan_access GUIDs match loans
      const matchingLoansResult = await tenantPool.query(
        `SELECT COUNT(*) as count 
         FROM user_loan_access ula 
         INNER JOIN loans l ON l.guid = ula.loan_guid 
         WHERE ula.user_id = $1`,
        [userId],
      );
      const matchingLoans = parseInt(matchingLoansResult.rows[0]?.count || '0', 10);

      return res.json({
        user: {
          id: user.id,
          email: user.email,
          role: user.role,
          encompassUserId: user.encompass_user_id,
          losConnectionId: user.los_connection_id,
          loanAccessMode: user.loan_access_mode,
          loanAccessSyncedAt: user.loan_access_synced_at,
        },
        loanAccess: {
          userLoanAccessCount: accessCount,
          sampleUserAccessGuids: sampleAccessGuids,
        },
        loans: {
          totalLoans,
          loansWithGuid,
          loansWithoutGuid: totalLoans - loansWithGuid,
          sampleLoans,
        },
        matching: {
          matchingLoans,
          issue: matchingLoans === 0 && accessCount > 0 
            ? "GUID format mismatch - user_loan_access.loan_guid doesn't match loans.guid format"
            : matchingLoans === 0 && accessCount === 0
            ? "No loan access synced yet - run sync-loan-access"
            : loansWithGuid === 0
            ? "loans.guid column not populated - re-sync loans"
            : "OK",
        },
      });
    } catch (error: any) {
      logError("Error debugging user loan access", error, {
        userId: req.userId,
      });
      return res
        .status(500)
        .json({
          error: "Failed to debug loan access",
          details: error.message,
        });
    }
  },
);

/**
 * Bulk sync loan access for all linked users
 */
router.post(
  "/encompass-users/sync-all-loan-access",
  authenticateToken,
  requireRole("super_admin", "platform_admin", "tenant_admin", "admin"),
  async (req: AuthRequest, res) => {
    try {
      const { los_connection_id } = req.body;

      if (!los_connection_id) {
        return res.status(400).json({ error: "los_connection_id is required" });
      }

      const tenantSlug = req.tenantSlug;
      if (!tenantSlug) {
        return res.status(400).json({ error: "Tenant context required" });
      }

      const tenantPool = await tenantDbManager.getTenantPool(tenantSlug);
      if (!tenantPool) {
        return res.status(404).json({ error: "Tenant not found" });
      }

      const tenantResult = await managementPool.query(
        "SELECT id FROM coheus_tenants WHERE slug = $1",
        [tenantSlug],
      );
      const tenantId = tenantResult.rows[0]?.id;

      // Get all users linked to Encompass for this connection
      const usersResult = await tenantPool.query(
        `SELECT id, encompass_user_id FROM users 
         WHERE los_connection_id = $1 AND encompass_user_id IS NOT NULL AND is_active = true`,
        [los_connection_id],
      );

      const { syncUserLoanAccess } = await import(
        "../services/userLoanAccessService.js"
      );

      const results = {
        total: usersResult.rows.length,
        success: 0,
        failed: 0,
        details: [] as Array<{
          userId: string;
          success: boolean;
          loansAccessible?: number;
          error?: string;
        }>,
      };

      // Sync each user (sequentially to avoid rate limits)
      for (const user of usersResult.rows) {
        const result = await syncUserLoanAccess(user.id, tenantPool, tenantId);
        if (result.success) {
          results.success++;
        } else {
          results.failed++;
        }
        results.details.push({
          userId: user.id,
          success: result.success,
          loansAccessible: result.loansAccessible,
          error: result.error,
        });
      }

      await auditLog({
        userId: req.userId,
        userEmail: req.userEmail,
        userRole: req.userRole,
        tenantId,
        action: "bulk_loan_access_sync",
        resource: "users",
        description: `Bulk synced loan access for ${results.total} users`,
        status: results.failed === 0 ? "success" : "partial",
        metadata: {
          total: results.total,
          success: results.success,
          failed: results.failed,
        },
      }).catch(() => {});

      return res.json(results);
    } catch (error: any) {
      logError("Error bulk syncing loan access", error, {
        userId: req.userId,
      });
      return res
        .status(500)
        .json({
          error: "Failed to bulk sync loan access",
          details: error.message,
        });
    }
  },
);

// ============================================================================
// Sync Management Routes (Platform Admin)
// Cross-tenant view of all LOS connections and their sync status
// ============================================================================

/**
 * GET /api/admin/sync-management
 * Get all LOS connections across all tenants with sync status
 */
router.get(
  "/sync-management",
  authenticateToken,
  requireRole("super_admin", "platform_admin"),
  async (req: AuthRequest, res) => {
    try {
      // Get all active tenants
      const tenantsResult = await managementPool.query(
        `SELECT id, name, slug FROM coheus_tenants WHERE status = 'active' ORDER BY name`
      );

      const allConnections: any[] = [];

      for (const tenant of tenantsResult.rows) {
        try {
          const tenantPool = await tenantDbManager.getTenantPool(tenant.id);

          // Auto-fix stale 'in_progress' statuses left from server crashes/restarts.
          // If a connection has been 'in_progress' for more than 30 minutes, it's stale.
          const STALE_THRESHOLD_MINUTES = 30;
          await tenantPool.query(
            `UPDATE public.los_connections
             SET last_sync_status = 'interrupted',
                 last_sync_error = 'Sync was interrupted (server restart or crash)',
                 updated_at = NOW()
             WHERE last_sync_status = 'in_progress'
               AND updated_at < NOW() - INTERVAL '${STALE_THRESHOLD_MINUTES} minutes'`
          ).catch(() => {});

          // Query connections from tenant database
          const connectionsResult = await tenantPool.query(
            `SELECT id, name, los_type, connection_method, sync_enabled, sync_frequency,
                    last_synced_at, last_sync_status, last_sync_error, last_loan_modified_at,
                    is_active, created_at, updated_at
             FROM public.los_connections
             ORDER BY name`
          );

          // Get loan count for this tenant
          let loanCount = 0;
          try {
            const loanResult = await tenantPool.query(
              "SELECT COUNT(*) as count FROM public.loans"
            );
            loanCount = parseInt(loanResult.rows[0]?.count || "0", 10);
          } catch {
            // loans table may not exist
          }

          for (const conn of connectionsResult.rows) {
            allConnections.push({
              ...conn,
              tenant_id: tenant.id,
              tenant_name: tenant.name,
              tenant_slug: tenant.slug,
              loan_count: loanCount,
            });
          }
        } catch (error: any) {
          // Tenant DB might not have los_connections table yet — skip
          if (error.code !== "42P01") {
            logWarn("Error querying connections for tenant", {
              tenantId: tenant.id,
              tenantName: tenant.name,
              error: error.message,
            });
          }
        }
      }

      // Get scheduler info
      const schedulerInfo = {
        interval_minutes: 15,
        next_run_estimate: new Date(
          Date.now() + 15 * 60 * 1000
        ).toISOString(),
      };

      return res.json({
        connections: allConnections,
        scheduler: schedulerInfo,
        total_tenants: tenantsResult.rows.length,
      });
    } catch (error: any) {
      logError("Error fetching sync management data", error, {
        userId: req.userId,
      });
      return res
        .status(500)
        .json({ error: "Failed to fetch sync management data" });
    }
  }
);

/**
 * PUT /api/admin/sync-management/:connectionId
 * Update sync settings for a connection (enable/disable, change frequency)
 */
router.put(
  "/sync-management/:connectionId",
  authenticateToken,
  requireRole("super_admin", "platform_admin"),
  async (req: AuthRequest, res) => {
    try {
      const connectionId = req.params.connectionId as string;
      const { tenant_id, sync_enabled, sync_frequency } = req.body;

      if (!tenant_id) {
        return res.status(400).json({ error: "tenant_id is required" });
      }

      // Validate sync_frequency if provided
      const validFrequencies = ["realtime", "hourly", "daily", "weekly"];
      if (sync_frequency && !validFrequencies.includes(sync_frequency)) {
        return res.status(400).json({
          error: `Invalid sync_frequency. Must be one of: ${validFrequencies.join(", ")}`,
        });
      }

      const tenantPool = await tenantDbManager.getTenantPool(tenant_id);

      // Build update query dynamically
      const updates: string[] = [];
      const values: any[] = [];
      let paramIndex = 1;

      if (typeof sync_enabled === "boolean") {
        updates.push(`sync_enabled = $${paramIndex++}`);
        values.push(sync_enabled);
      }

      if (sync_frequency) {
        updates.push(`sync_frequency = $${paramIndex++}`);
        values.push(sync_frequency);
      }

      if (updates.length === 0) {
        return res.status(400).json({ error: "No valid fields to update" });
      }

      updates.push("updated_at = NOW()");
      values.push(connectionId);

      const result = await tenantPool.query(
        `UPDATE public.los_connections 
         SET ${updates.join(", ")} 
         WHERE id = $${paramIndex} 
         RETURNING id, name, sync_enabled, sync_frequency, last_synced_at, last_sync_status`,
        values
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Connection not found" });
      }

      // Audit log
      auditLog({
        userId: req.userId as string,
        action: "sync_settings_updated",
        resource: "los_connection",
        resourceId: connectionId,
        metadata: {
          tenant_id,
          sync_enabled,
          sync_frequency,
        },
      }).catch(() => {});

      logInfo("Sync settings updated", {
        userId: req.userId,
        connectionId,
        tenant_id,
        sync_enabled,
        sync_frequency,
      });

      return res.json({ connection: result.rows[0] });
    } catch (error: any) {
      logError("Error updating sync settings", error, {
        userId: req.userId,
        connectionId: req.params.connectionId,
      });
      return res
        .status(500)
        .json({ error: "Failed to update sync settings" });
    }
  }
);

/**
 * POST /api/admin/sync-management/:connectionId/trigger
 * Manually trigger a sync for a specific connection from the platform admin view
 */
router.post(
  "/sync-management/:connectionId/trigger",
  authenticateToken,
  requireRole("super_admin", "platform_admin"),
  async (req: AuthRequest, res) => {
    try {
      const connectionId = req.params.connectionId as string;
      const { tenant_id } = req.body;

      if (!tenant_id) {
        return res.status(400).json({ error: "tenant_id is required" });
      }

      const tenantId = tenant_id as string;
      const tenantPool = await tenantDbManager.getTenantPool(tenantId);

      // Get full connection details (need sync state for incremental sync)
      const connResult = await tenantPool.query(
        `SELECT id, los_type, connection_method, last_synced_at, last_loan_modified_at,
                encompass_selected_folders
         FROM public.los_connections WHERE id = $1`,
        [connectionId]
      );

      if (connResult.rows.length === 0) {
        return res.status(404).json({ error: "Connection not found" });
      }

      const conn = connResult.rows[0];

      // Trigger sync based on type (same logic as los.ts sync route)
      if (conn.connection_method === "api" && conn.los_type === "encompass") {
        const { EncompassEtlService } = await import(
          "../services/etl/encompassEtlService.js"
        );
        const etlService = new EncompassEtlService(tenantPool);

        // Determine modifiedFrom for incremental sync (same logic as manual sync in los.ts)
        let modifiedFrom: Date | undefined;
        const lastLoanModifiedAt = conn.last_loan_modified_at;
        const lastSyncedAt = conn.last_synced_at;

        // Check if there are existing loans
        let loansCount = 0;
        try {
          const countResult = await tenantPool.query(
            "SELECT COUNT(*) as count FROM public.loans"
          );
          loansCount = parseInt(countResult.rows[0]?.count || "0", 10);
        } catch {
          // loans table may not exist
        }

        if (lastLoanModifiedAt && loansCount > 0) {
          // Best case: use last_loan_modified_at from a previous successful sync
          modifiedFrom = new Date(lastLoanModifiedAt);
        } else if (loansCount > 0) {
          // Fallback: query MAX(last_modified_date) directly from loans table.
          // This handles the case where a previous sync was interrupted before
          // last_loan_modified_at could be written, but loans were already loaded.
          try {
            const maxResult = await tenantPool.query(
              `SELECT MAX(last_modified_date) as max_modified FROM public.loans WHERE last_modified_date IS NOT NULL`
            );
            if (maxResult.rows[0]?.max_modified) {
              modifiedFrom = new Date(maxResult.rows[0].max_modified);
            }
          } catch {
            // will do full sync
          }
        }
        // If no modifiedFrom and no existing loans, full sync (modifiedFrom stays undefined)

        // Set loanStartDate to 36 months ago (matching Qlik's vLoanStartDate)
        const threeYearsAgo = new Date();
        threeYearsAgo.setMonth(threeYearsAgo.getMonth() - 36);
        threeYearsAgo.setDate(1);
        threeYearsAgo.setHours(0, 0, 0, 0);

        // Parse selected folders
        let selectedFolders: string[] = [];
        if (conn.encompass_selected_folders) {
          try {
            selectedFolders = typeof conn.encompass_selected_folders === "string"
              ? JSON.parse(conn.encompass_selected_folders)
              : conn.encompass_selected_folders;
          } catch {
            selectedFolders = [];
          }
        }

        logInfo("Admin trigger sync", {
          connectionId,
          tenantId,
          modifiedFrom: modifiedFrom?.toISOString() || "full sync",
          loansCount,
          folders: selectedFolders.length,
        });

        // Run sync asynchronously
        etlService
          .syncLoans(tenantId, connectionId, {
            fullSync: false,
            modifiedFrom,
            loanStartDate: threeYearsAgo,
            loanStartDateField: "Fields.Log.MS.Date.Started",
            folderNames: selectedFolders.length > 0 ? selectedFolders : undefined,
          })
          .catch((error) => {
            logError("Background sync error (admin trigger)", error, {
              userId: req.userId,
              connectionId,
              tenant_id,
            });
          });

        return res.json({
          success: true,
          message: modifiedFrom
            ? `Incremental sync started (changes since ${modifiedFrom.toISOString()})`
            : "Full sync started (no previous sync data)",
        });
      } else if (conn.connection_method === "api") {
        const { syncLoansFromAPI } = await import(
          "../services/losApiService.js"
        );
        syncLoansFromAPI(connectionId).catch((error) => {
          logError("Background API sync error (admin trigger)", error, {
            userId: req.userId,
            connectionId,
          });
        });

        return res.json({
          success: true,
          message: "API sync started",
        });
      } else {
        return res.status(400).json({
          error: "Manual trigger not supported for this connection method",
        });
      }
    } catch (error: any) {
      logError("Error triggering sync", error, {
        userId: req.userId,
        connectionId: req.params.connectionId,
      });
      return res.status(500).json({ error: "Failed to trigger sync" });
    }
  }
);

/**
 * GET /api/admin/sync-management/:connectionId/history
 * Get sync history for a specific connection
 */
router.get(
  "/sync-management/:connectionId/history",
  authenticateToken,
  requireRole("super_admin", "platform_admin"),
  async (req: AuthRequest, res) => {
    try {
      const connectionId = req.params.connectionId as string;
      const tenantId = req.query.tenant_id as string;
      const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);

      if (!tenantId) {
        return res.status(400).json({ error: "tenant_id query parameter is required" });
      }

      const tenantPool = await tenantDbManager.getTenantPool(tenantId);

      const result = await tenantPool.query(
        `SELECT id, los_connection_id, sync_type, status,
                loans_added, loans_updated, loans_failed,
                total_loans_after, modified_from, duration_ms,
                error_message, started_at, completed_at
         FROM public.los_sync_history
         WHERE los_connection_id = $1
         ORDER BY started_at DESC
         LIMIT $2`,
        [connectionId, limit]
      );

      return res.json({ history: result.rows });
    } catch (error: any) {
      // Table may not exist yet for older tenants
      if (error.code === "42P01") {
        return res.json({ history: [] });
      }
      logError("Error fetching sync history", error, {
        userId: req.userId,
        connectionId: req.params.connectionId,
      });
      return res.status(500).json({ error: "Failed to fetch sync history" });
    }
  }
);

// Mount SSO configuration routes
router.use("/sso", ssoConfigRoutes);

export default router;
