/**
 * Tenant Context Middleware
 * Provides tenant database pool and tenant info to request handlers
 */

import { Request, Response, NextFunction } from 'express';
import { AuthRequest } from './auth.js';
import { pool as managementPool } from '../config/managementDatabase.js';
import { tenantDbManager } from '../config/tenantDatabaseManager.js';
import pg from 'pg';

export interface TenantContext {
  tenantId: string;
  tenantPool: pg.Pool;
  tenantInfo: {
    id: string;
    name: string;
    slug: string;
    database_name: string;
  };
}

declare global {
  namespace Express {
    interface Request {
      tenantContext?: TenantContext;
    }
  }
}

/**
 * Middleware to attach tenant context to request
 * Requires authentication middleware to run first
 * Supports tenant_id query parameter for admins
 */
export async function attachTenantContext(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    // Check if tenant_id is provided in query params (for admin tenant selection)
    const queryTenantId = req.query.tenant_id as string | undefined;
    
    // Get user role to check if they can override tenant
    // Note: Users are stored in the default database, not management DB
    let userRole: string | null = null;
    try {
      // Try to get user role from default database first (where users are stored)
      const { pool: defaultPool } = await import('../config/database.js');
      const userResult = await defaultPool.query(
        `SELECT role FROM public.users WHERE id = $1`,
        [req.userId]
      );
      userRole = userResult.rows[0]?.role || null;
    } catch (error: any) {
      // Fallback: try management DB (in case users are there)
      try {
        const userResult = await managementPool.query(
          `SELECT role FROM public.users WHERE id = $1`,
          [req.userId]
        );
        userRole = userResult.rows[0]?.role || null;
      } catch (fallbackError: any) {
        // Only log if it's not a connection timeout (which is expected if DB is down)
        if (!fallbackError.message?.includes('timeout') && !fallbackError.message?.includes('ECONNREFUSED')) {
          console.warn('[TenantContext] Could not get user role from either database:', fallbackError.message);
        }
      }
    }

    // Map 'admin' role to 'super_admin' for consistency with RBAC
    if (userRole === 'admin') {
      userRole = 'super_admin';
    }

    // If queryTenantId is provided and user is admin, use it
    let tenantId: string | null = null;
    if (queryTenantId && (userRole === 'super_admin' || userRole === 'tenant_admin')) {
      console.log('[TenantContext] Admin user selecting tenant:', { userId: req.userId, userRole, queryTenantId });
      // Verify tenant exists
      const tenantCheck = await managementPool.query(
        `SELECT id FROM coheus_tenants WHERE id = $1 AND status = 'active'`,
        [queryTenantId]
      );
      if (tenantCheck.rows.length > 0) {
        tenantId = queryTenantId;
        console.log('[TenantContext] Tenant verified, using query tenant:', tenantId);
      } else {
        console.warn('[TenantContext] Tenant not found or inactive:', queryTenantId);
        return res.status(404).json({ error: 'Tenant not found or inactive' });
      }
    } else if (queryTenantId) {
      console.warn('[TenantContext] Non-admin user attempted to use tenant_id query param:', { userId: req.userId, userRole, queryTenantId });
    }

    // If no query tenant, get tenant_id from user profile
    if (!tenantId) {
      try {
        // Check user_tenant_mappings in management DB first
        const mappingResult = await managementPool.query(
          `SELECT tenant_id FROM user_tenant_mappings WHERE user_id = $1 AND is_primary = true LIMIT 1`,
          [req.userId]
        );
        if (mappingResult.rows.length > 0) {
          tenantId = mappingResult.rows[0].tenant_id;
        }
      } catch (error) {
        // Fallback: check profiles table (legacy)
        try {
          const profileResult = await managementPool.query(
            `SELECT tenant_id FROM public.profiles WHERE user_id = $1`,
            [req.userId]
          );
          tenantId = profileResult.rows[0]?.tenant_id || null;
        } catch (error) {
          console.warn('[TenantContext] Could not get tenant from management DB');
        }
      }
    }

    if (!tenantId) {
      console.warn('[TenantContext] No tenant found for user:', { userId: req.userId, userRole, queryTenantId });
      return res.status(403).json({ error: 'Tenant not found for user' });
    }

    console.log('[TenantContext] Using tenant:', { userId: req.userId, tenantId, userRole });

    // Get tenant database pool
    const tenantPool = await tenantDbManager.getTenantPool(tenantId);

    // Get tenant info
    const tenantConfig = await tenantDbManager.getTenantConfig(tenantId);

    // Attach to request
    req.tenantContext = {
      tenantId,
      tenantPool,
      tenantInfo: {
        id: tenantConfig.id,
        name: tenantConfig.name,
        slug: tenantConfig.slug,
        database_name: tenantConfig.database_name,
      },
    };

    next();
  } catch (error: any) {
    console.error('[TenantContext] Error attaching tenant context:', error);
    return res.status(500).json({ error: 'Failed to attach tenant context' });
  }
}

/**
 * Helper to get tenant context from request
 */
export function getTenantContext(req: Request): TenantContext {
  if (!req.tenantContext) {
    throw new Error('Tenant context not attached to request');
  }
  return req.tenantContext;
}
