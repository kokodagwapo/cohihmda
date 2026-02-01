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
    
    // Use role and tenant from JWT (set by authenticateToken middleware)
    // This avoids expensive database lookups since we already have the info
    const userRole = req.userRole || 'user';
    const jwtTenantId = req.tenantId || null;
    
    console.log('[TenantContext] Using JWT data:', { userId: req.userId, userRole, jwtTenantId, queryTenantId });

    // Only platform staff can use the tenant_id query param to select different tenants
    // Tenant admins and regular users always use their JWT tenant (security: prevents cross-tenant access)
    const isPlatformStaff = ['super_admin', 'platform_admin', 'support'].includes(userRole);
    let tenantId: string | null = null;
    
    if (queryTenantId && isPlatformStaff) {
      // Platform staff can select any tenant
      console.log('[TenantContext] Platform staff selecting tenant:', { userId: req.userId, userRole, queryTenantId });
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
    } else if (queryTenantId && !isPlatformStaff) {
      // Non-platform users cannot use tenant_id query param - silently ignore it
      // Their tenant comes from JWT (secure, cannot be tampered)
      console.warn('[TenantContext] Non-platform user attempted to use tenant_id query param (ignored):', { userId: req.userId, userRole, queryTenantId });
    }

    // If no query tenant, use tenant_id from JWT (for tenant users)
    if (!tenantId && jwtTenantId) {
      console.log('[TenantContext] Using tenant from JWT:', jwtTenantId);
      tenantId = jwtTenantId;
    }

    if (!tenantId) {
      // Super admins without a tenant_id query param should not be blocked
      // They just need to select a tenant in the UI
      if (userRole === 'super_admin' || userRole === 'platform_admin' || userRole === 'support') {
        console.log('[TenantContext] Platform user without tenant selected:', { userId: req.userId, userRole });
        return res.status(400).json({ 
          error: 'No tenant selected', 
          message: 'Please select a tenant to view data',
          requiresTenantSelection: true
        });
      }
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
