/**
 * Role-Based Access Control (RBAC) Middleware
 * SOC 2 Compliance: Access control and audit logging
 */

import { Response, NextFunction } from 'express';
import pg from 'pg';
import { AuthRequest } from './auth.js';
import { pool } from '../config/database.js';
import { auditLog } from '../services/auditLogger.js';
import { logError, logWarn, logInfo, logDebug } from '../services/logger.js';

const { Pool } = pg;

// Management database pool for checking super admins
let managementPool: pg.Pool | null = null;

function getManagementPool(): pg.Pool {
  if (!managementPool) {
    const dbHost = (process.env.DB_HOST || 'localhost').trim();
    const rawHost = dbHost === 'localhost' || dbHost === '127.0.0.1' ? '127.0.0.1' : dbHost;
    
    managementPool = new Pool({
      host: rawHost,
      port: parseInt(process.env.DB_PORT || '5432'),
      database: process.env.MANAGEMENT_DB_NAME || 'coheus_management',
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || 'postgres',
      ssl: rawHost !== '127.0.0.1' && rawHost !== 'localhost' ? { rejectUnauthorized: false } : false,
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });

    managementPool.on('error', (err: any) => {
      logError('[RBAC] Management pool error', err, {});
    });
  }
  return managementPool;
}

export interface RBACRequest extends AuthRequest {
  userRole?: string;
  userTenantId?: string;
}

type CanvasOnlyRule = {
  prefix: string;
  methods: ReadonlySet<string>;
};

const CANVAS_ONLY_RULES: CanvasOnlyRule[] = [
  { prefix: '/api/auth', methods: new Set(['GET', 'POST']) },
  { prefix: '/api/workbench/canvases', methods: new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) },
  { prefix: '/api/loans', methods: new Set(['GET', 'POST']) },
  { prefix: '/api/metrics', methods: new Set(['GET', 'POST']) },
  { prefix: '/api/dashboard', methods: new Set(['GET', 'POST']) },
  { prefix: '/api/pipeline-analysis', methods: new Set(['GET', 'POST']) },
  { prefix: '/api/scorecard', methods: new Set(['GET', 'POST']) },
  { prefix: '/api/toptiering', methods: new Set(['GET', 'POST']) },
  { prefix: '/api/predictions', methods: new Set(['GET', 'POST']) },
  { prefix: '/api/fallout', methods: new Set(['GET', 'POST']) },
  { prefix: '/api/pricing-dashboard', methods: new Set(['GET', 'POST']) },
];

const CANVAS_ONLY_BLOCKED_MUTATIONS: Array<{ method: string; prefix: string }> = [
  // Explicit side-effect endpoints that canvas-only users should never invoke.
  { method: 'POST', prefix: '/api/loans/sync-market-rates' },
  { method: 'POST', prefix: '/api/loans/email-card' },
];

function normalizeRequestPath(rawPath: string): string {
  const pathWithoutQuery = rawPath.split('?')[0] || '/';
  return pathWithoutQuery.endsWith('/') && pathWithoutQuery.length > 1
    ? pathWithoutQuery.slice(0, -1)
    : pathWithoutQuery;
}

export function isCanvasOnlyRequestAllowed(path: string, method: string): boolean {
  const normalizedPath = normalizeRequestPath(path || '');
  const normalizedMethod = (method || 'GET').toUpperCase();

  const isBlocked = CANVAS_ONLY_BLOCKED_MUTATIONS.some(
    (entry) =>
      entry.method === normalizedMethod &&
      (normalizedPath === entry.prefix || normalizedPath.startsWith(`${entry.prefix}/`)),
  );
  if (isBlocked) return false;

  const matchingRule = CANVAS_ONLY_RULES.find(
    (rule) =>
      normalizedPath === rule.prefix || normalizedPath.startsWith(`${rule.prefix}/`),
  );
  if (!matchingRule) return false;

  return matchingRule.methods.has(normalizedMethod);
}

/**
 * Check if user has permission for resource/action
 */
export async function checkPermission(
  role: string,
  resource: string,
  action: string
): Promise<boolean> {
  try {
    // Super admin has all permissions
    if (role === 'super_admin') return true;

    // Fallback: If permissions table doesn't exist, use role-based defaults
    if (role === 'super_admin') return true;
    
    // Tenant admin has most permissions except super admin only features
    if (role === 'tenant_admin') {
      // Tenant admin can manage users, tenants (their own), loans, etc.
      if (['users', 'tenants', 'loans', 'contacts', 'calls'].includes(resource)) {
        return ['read', 'create', 'update', 'delete'].includes(action);
      }
      return false;
    }

    // Try to check permissions table if it exists
    try {
      const result = await pool.query(
        `SELECT 1 FROM public.permissions 
         WHERE role = $1 
         AND (resource = $2 OR resource = '*') 
         AND (action = $3 OR action = '*')
         LIMIT 1`,
        [role, resource, action]
      );

      if (result.rows.length > 0) {
        return true;
      }
    } catch (tableError: any) {
      // Permissions table doesn't exist - use role-based fallback
      // This is expected in initial setup
      if (tableError.code === '42P01') { // Table doesn't exist
        logDebug('Permissions table not found, using role-based fallback', { role, resource, action });
      } else {
        logError('Permission check error', tableError, { role, resource, action });
      }
    }

    // Default: regular users have read-only access to most resources
    if (role === 'user' && action === 'read') {
      return ['users', 'loans', 'contacts', 'calls'].includes(resource);
    }

    return false;
  } catch (error) {
    logError('Permission check error', error, { role, resource, action });
    return false;
  }
}

/**
 * Get user's role and tenant from database
 * First checks management DB for super admins, then falls back to legacy users table
 */
async function getUserRoleAndTenant(userId: string): Promise<{ role: string; tenantId: string | null }> {
  try {
    logDebug('getUserRoleAndTenant: querying for userId', { userId });
    
    // First, check management database for super admins (coheus_users)
    try {
      const mgmtPool = getManagementPool();
      const superAdminResult = await mgmtPool.query(
        `SELECT role, is_active FROM coheus_users WHERE id = $1`,
        [userId]
      );
      
      if (superAdminResult.rows.length > 0) {
        const user = superAdminResult.rows[0];
        if (!user.is_active) {
          throw new Error('User account is disabled');
        }
        logDebug('getUserRoleAndTenant: found super admin', { userId, role: user.role });
        return {
          role: user.role, // super_admin, platform_admin, or support
          tenantId: null,  // Super admins don't belong to a specific tenant
        };
      }
    } catch (mgmtError: any) {
      // Management DB might not be set up or coheus_users table doesn't exist
      // Fall through to legacy check
      if (mgmtError.code !== '42P01') { // Not a "table doesn't exist" error
        logDebug('getUserRoleAndTenant: management DB check failed', { userId, error: mgmtError.message });
      }
    }
    
    // Fall back to legacy public.users table for tenant users
    const userResult = await pool.query(
      `SELECT 
         CASE 
           WHEN u.role = 'super_admin' THEN 'super_admin'
           WHEN u.role = 'tenant_admin' THEN 'tenant_admin'
           WHEN u.role = 'user' THEN 'user'
           WHEN u.role = 'viewer' THEN 'viewer'
           ELSE u.role
         END as role,
         COALESCE(u.tenant_id, p.tenant_id) as tenant_id
       FROM public.users u
       LEFT JOIN public.profiles p ON u.id = p.user_id
       WHERE u.id = $1`,
      [userId]
    );
    logDebug('getUserRoleAndTenant: legacy query result', { userId, rowCount: userResult.rows.length, role: userResult.rows[0]?.role, tenantId: userResult.rows[0]?.tenant_id });

    if (userResult.rows.length === 0) {
      throw new Error('User not found');
    }

    return {
      role: userResult.rows[0].role || 'user',
      tenantId: userResult.rows[0].tenant_id || null,
    };
  } catch (error: any) {
    throw error;
  }
}

/**
 * Middleware to require specific permission
 * Usage: requirePermission('loans', 'create')
 */
export function requirePermission(resource: string, action: string) {
  return async (req: RBACRequest, res: Response, next: NextFunction) => {
    try {
      if (!req.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      // Use role from JWT (set by authenticateToken middleware)
      // This avoids expensive database lookups since we already have the info
      const role = req.userRole || 'user';
      const tenantId = req.tenantId || null;
      req.userTenantId = tenantId;
      
      // Debug logging
      logDebug('requirePermission check', { userId: req.userId, role, resource, action, path: req.path });

      // Check permission
      const hasPermission = await checkPermission(role, resource, action);
      
      logDebug('Permission result', { userId: req.userId, role, resource, action, hasPermission });

      if (!hasPermission) {
        // Log failed authorization attempt
        await auditLog({
          userId: req.userId,
          userEmail: req.userEmail,
          userRole: role,
          tenantId: tenantId,
          action: action,
          resource: resource,
          status: 'failure',
          errorMessage: `Permission denied: ${role} cannot ${action} ${resource}`,
          ipAddress: req.ip,
          userAgent: req.get('user-agent'),
        });

        return res.status(403).json({ 
          error: 'Forbidden', 
          message: `You do not have permission to ${action} ${resource}` 
        });
      }

      next();
    } catch (error: any) {
      logError('RBAC middleware error', error, { userId: req.userId, resource, action });
      res.status(500).json({ error: 'Permission check failed' });
    }
  };
}

/**
 * Middleware to require specific role(s)
 * Usage: requireRole('tenant_admin', 'super_admin')
 */
export function requireRole(...allowedRoles: string[]) {
  return async (req: RBACRequest, res: Response, next: NextFunction) => {
    try {
      if (!req.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      // Use role from JWT (set by authenticateToken middleware)
      const role = req.userRole || 'user';
      const tenantId = req.tenantId || null;
      req.userTenantId = tenantId;
      
      if (!allowedRoles.includes(role)) {
        // Log failed authorization attempt (ignore errors since audit may fail for new users)
        auditLog({
          userId: req.userId,
          userEmail: req.userEmail,
          userRole: role,
          tenantId: tenantId,
          action: 'access',
          resource: req.path,
          status: 'failure',
          errorMessage: `Role denied: ${role} not in allowed roles [${allowedRoles.join(', ')}]`,
          ipAddress: req.ip,
          userAgent: req.get('user-agent'),
        }).catch(() => {}); // Ignore audit errors

        return res.status(403).json({ 
          error: 'Forbidden', 
          message: `This action requires one of: ${allowedRoles.join(', ')}. Your role: ${role}` 
        });
      }

      next();
    } catch (error: any) {
      logError('Role check error', error, { userId: req.userId, allowedRoles });
      res.status(500).json({ error: 'Role check failed' });
    }
  };
}

const PLATFORM_STAFF_ROLES = new Set(["super_admin", "platform_admin", "support"]);
const ADMIN_ROLES = new Set([...PLATFORM_STAFF_ROLES, "tenant_admin"]);

/**
 * Middleware: restrict to platform-level staff only.
 * Rejects tenant_admin and below — use for endpoints that manage tenants,
 * subscriptions, platform settings, or cross-tenant data.
 */
export function requirePlatformStaff() {
  return async (req: RBACRequest, res: Response, next: NextFunction) => {
    try {
      if (!req.userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }
      const role = req.userRole || "user";
      req.userTenantId = req.tenantId || null;

      if (!PLATFORM_STAFF_ROLES.has(role)) {
        auditLog({
          userId: req.userId,
          userEmail: req.userEmail,
          userRole: role,
          tenantId: req.tenantId || null,
          action: "access",
          resource: req.path,
          status: "failure",
          errorMessage: `Platform staff required — caller role: ${role}`,
          ipAddress: req.ip,
          userAgent: req.get("user-agent"),
        }).catch(() => {});

        return res.status(403).json({
          error: "Forbidden",
          message: "This action requires platform staff access.",
        });
      }
      next();
    } catch (error: any) {
      logError("requirePlatformStaff error", error, { userId: req.userId });
      res.status(500).json({ error: "Role check failed" });
    }
  };
}

/**
 * Middleware: restrict to any admin role (platform staff OR tenant_admin).
 * Use for endpoints that are admin-only but should work within a tenant scope.
 */
export function requireAnyAdmin() {
  return async (req: RBACRequest, res: Response, next: NextFunction) => {
    try {
      if (!req.userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }
      const role = req.userRole || "user";
      req.userTenantId = req.tenantId || null;

      if (!ADMIN_ROLES.has(role)) {
        return res.status(403).json({
          error: "Forbidden",
          message: "This action requires admin access.",
        });
      }
      next();
    } catch (error: any) {
      logError("requireAnyAdmin error", error, { userId: req.userId });
      res.status(500).json({ error: "Role check failed" });
    }
  };
}

/**
 * Middleware to enforce tenant isolation
 * Ensures users can only access data from their own tenant
 */
export function enforceTenantIsolation() {
  return async (req: RBACRequest, res: Response, next: NextFunction) => {
    try {
      if (!req.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      // Use role and tenant from JWT (set by authenticateToken middleware)
      const role = req.userRole || 'user';
      const tenantId = req.tenantId || null;
      req.userTenantId = tenantId;

      // Super admin and platform staff can access any tenant
      if (role === 'super_admin' || role === 'platform_admin' || role === 'support') {
        return next();
      }

      // Regular users must have a tenant
      if (!tenantId) {
        return res.status(403).json({ 
          error: 'Forbidden', 
          message: 'User must be associated with a tenant' 
        });
      }

      // Check if request is trying to access another tenant's data
      const requestedTenantId = req.query.tenant_id || req.body.tenant_id || req.params.tenant_id;
      
      if (requestedTenantId && requestedTenantId !== tenantId) {
        auditLog({
          userId: req.userId,
          userEmail: req.userEmail,
          userRole: role,
          tenantId: tenantId,
          action: 'access',
          resource: req.path,
          status: 'failure',
          errorMessage: `Attempted to access another tenant's data: ${requestedTenantId}`,
          ipAddress: req.ip,
          userAgent: req.get('user-agent'),
        }).catch(() => {}); // Ignore audit errors

        return res.status(403).json({ 
          error: 'Forbidden', 
          message: 'Cannot access data from another tenant' 
        });
      }

      next();
    } catch (error: any) {
      logError('Tenant isolation error', error, { userId: req.userId });
      res.status(500).json({ error: 'Tenant isolation check failed' });
    }
  };
}

/**
 * Middleware: block canvas_only users from non-canvas routes.
 * Allowed routes and methods are defined in isCanvasOnlyRequestAllowed().
 * Must run after authenticateToken.
 */
export function requireFullAccess() {
  return async (req: RBACRequest, res: Response, next: NextFunction) => {
    try {
      if (!req.userId) {
        return next();
      }
      const accessMode = req.userAccessMode ?? 'full';
      if (accessMode !== 'canvas_only') {
        return next();
      }
      const path = req.originalUrl || req.url || '';
      const method = (req.method || 'GET').toUpperCase();
      if (isCanvasOnlyRequestAllowed(path, method)) {
        return next();
      }
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Canvas-only users cannot access this resource.',
      });
    } catch (error: any) {
      logError('requireFullAccess error', error, { userId: req.userId });
      res.status(500).json({ error: 'Access check failed' });
    }
  };
}

/**
 * Get all permissions for a role
 */
export async function getRolePermissions(role: string): Promise<Array<{ resource: string; action: string }>> {
  try {
    const result = await pool.query(
      'SELECT resource, action FROM public.permissions WHERE role = $1 ORDER BY resource, action',
      [role]
    );

    return result.rows;
  } catch (error) {
    logError('Error fetching role permissions', error, { role });
    return [];
  }
}

/**
 * Check if user can access specific resource instance
 * For example, can user edit loan #123?
 */
export async function canAccessResource(
  userId: string,
  resourceType: string,
  resourceId: string,
  action: string
): Promise<boolean> {
  try {
    const { role, tenantId } = await getUserRoleAndTenant(userId);

    // Check base permission first
    const hasPermission = await checkPermission(role, resourceType, action);
    if (!hasPermission) return false;

    // Super admin can access everything
    if (role === 'super_admin') return true;

    // Check tenant isolation for the specific resource
    // This would need to be customized based on your resource tables
    // Example for loans:
    if (resourceType === 'loans') {
      const result = await pool.query(
        'SELECT 1 FROM public.loans WHERE id = $1 AND tenant_id = $2',
        [resourceId, tenantId]
      );
      return result.rows.length > 0;
    }

    // Add similar checks for other resource types
    return true;
  } catch (error) {
    logError('Resource access check error', error, { userId, resourceType, resourceId, action });
    return false;
  }
}
