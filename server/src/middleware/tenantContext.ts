/**
 * Tenant Context Middleware
 * Provides tenant database pool and tenant info to request handlers
 */

import { Request, Response, NextFunction } from "express";
import { AuthRequest } from "./auth.js";
import { pool as managementPool } from "../config/managementDatabase.js";
import { tenantDbManager } from "../config/tenantDatabaseManager.js";
import pg from "pg";

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

// Cache for shadow user creation to avoid repeated checks
const shadowUserCache = new Map<string, Set<string>>(); // tenantId -> Set of userIds

/**
 * Ensure a platform user has a shadow record in the tenant database
 * This allows platform staff to have chat history, saved dashboards, etc.
 */
async function ensurePlatformUserShadow(
  tenantPool: pg.Pool,
  userId: string,
  userEmail: string | undefined,
  userRole: string,
  tenantId: string
): Promise<void> {
  // Check cache first
  const tenantCache = shadowUserCache.get(tenantId);
  if (tenantCache?.has(userId)) {
    return; // Already ensured this session
  }

  try {
    // Check if user already exists in tenant database
    const existing = await tenantPool.query(
      "SELECT id FROM public.users WHERE id = $1",
      [userId]
    );

    if (existing.rows.length === 0) {
      // Check if is_platform_user column exists
      const columnCheck = await tenantPool.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.columns 
          WHERE table_schema = 'public' 
          AND table_name = 'users' 
          AND column_name = 'is_platform_user'
        ) as exists
      `);

      const hasPlatformUserColumn = columnCheck.rows[0]?.exists;
      const email =
        userEmail || `platform-${userId.substring(0, 8)}@coheus.internal`;

      if (hasPlatformUserColumn) {
        // Modern schema with is_platform_user column
        await tenantPool.query(
          `
          INSERT INTO public.users (id, email, role, is_platform_user, created_at, updated_at)
          VALUES ($1, $2, $3, true, NOW(), NOW())
          ON CONFLICT (id) DO UPDATE SET
            email = EXCLUDED.email,
            role = EXCLUDED.role,
            is_platform_user = true,
            updated_at = NOW()
        `,
          [userId, email, userRole]
        );
      } else {
        // Legacy schema - try with minimal columns
        // Note: This may fail if encrypted_password is NOT NULL
        await tenantPool.query(
          `
          INSERT INTO public.users (id, email, role, encrypted_password, created_at, updated_at)
          VALUES ($1, $2, $3, '', NOW(), NOW())
          ON CONFLICT (id) DO UPDATE SET
            email = EXCLUDED.email,
            role = EXCLUDED.role,
            updated_at = NOW()
        `,
          [userId, email, userRole]
        );
      }

      console.log("[TenantContext] Created shadow user for platform staff:", {
        userId,
        tenantId,
        userRole,
      });
    }

    // Add to cache
    if (!shadowUserCache.has(tenantId)) {
      shadowUserCache.set(tenantId, new Set());
    }
    shadowUserCache.get(tenantId)!.add(userId);
  } catch (error: unknown) {
    // Don't fail the request if shadow user creation fails
    // This could happen if users table schema doesn't support it yet
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    console.warn(
      "[TenantContext] Failed to create shadow user (non-fatal):",
      errorMessage
    );
  }
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
    const userRole = req.userRole || "user";
    const jwtTenantId = req.tenantId || null;

    console.log("[TenantContext] Using JWT data:", {
      userId: req.userId,
      userRole,
      jwtTenantId,
      queryTenantId,
    });

    // Only platform staff can use the tenant_id query param to select different tenants
    // Tenant admins and regular users always use their JWT tenant (security: prevents cross-tenant access)
    const isPlatformStaff = [
      "super_admin",
      "platform_admin",
      "support",
    ].includes(userRole);
    let tenantId: string | null = null;

    if (queryTenantId && isPlatformStaff) {
      // Platform staff can select any tenant
      console.log("[TenantContext] Platform staff selecting tenant:", {
        userId: req.userId,
        userRole,
        queryTenantId,
      });
      // Verify tenant exists
      const tenantCheck = await managementPool.query(
        `SELECT id FROM coheus_tenants WHERE id = $1 AND status = 'active'`,
        [queryTenantId]
      );
      if (tenantCheck.rows.length > 0) {
        tenantId = queryTenantId;
        console.log(
          "[TenantContext] Tenant verified, using query tenant:",
          tenantId
        );
      } else {
        console.warn(
          "[TenantContext] Tenant not found or inactive:",
          queryTenantId
        );
        res.status(404).json({ error: "Tenant not found or inactive" });
        return;
      }
    } else if (queryTenantId && !isPlatformStaff) {
      // Non-platform users cannot use tenant_id query param - silently ignore it
      // Their tenant comes from JWT (secure, cannot be tampered)
      console.warn(
        "[TenantContext] Non-platform user attempted to use tenant_id query param (ignored):",
        { userId: req.userId, userRole, queryTenantId }
      );
    }

    // If no query tenant, use tenant_id from JWT (for tenant users)
    if (!tenantId && jwtTenantId) {
      console.log("[TenantContext] Using tenant from JWT:", jwtTenantId);
      tenantId = jwtTenantId;
    }

    if (!tenantId) {
      // Super admins without a tenant_id query param should not be blocked
      // They just need to select a tenant in the UI
      if (
        userRole === "super_admin" ||
        userRole === "platform_admin" ||
        userRole === "support"
      ) {
        console.log("[TenantContext] Platform user without tenant selected:", {
          userId: req.userId,
          userRole,
        });
        res.status(400).json({
          error: "No tenant selected",
          message: "Please select a tenant to view data",
          requiresTenantSelection: true,
        });
        return;
      }
      console.warn("[TenantContext] No tenant found for user:", {
        userId: req.userId,
        userRole,
        queryTenantId,
      });
      res.status(403).json({ error: "Tenant not found for user" });
      return;
    }

    console.log("[TenantContext] Using tenant:", {
      userId: req.userId,
      tenantId,
      userRole,
    });

    // Get tenant database pool
    const tenantPool = await tenantDbManager.getTenantPool(tenantId);

    // Get tenant info
    const tenantConfig = await tenantDbManager.getTenantConfig(tenantId);

    // For platform staff, ensure they have a shadow user record in the tenant database
    // This allows them to use features like chat history, saved dashboards, etc.
    if (isPlatformStaff && req.userId) {
      await ensurePlatformUserShadow(
        tenantPool,
        req.userId,
        req.userEmail,
        userRole,
        tenantId
      );
    }

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
    console.error("[TenantContext] Error attaching tenant context:", error);
    res.status(500).json({ error: "Failed to attach tenant context" });
    return;
  }
}

/**
 * Helper to get tenant context from request
 */
export function getTenantContext(req: Request): TenantContext {
  if (!req.tenantContext) {
    throw new Error("Tenant context not attached to request");
  }
  return req.tenantContext;
}

/**
 * Request type with tenant context attached
 */
export interface TenantRequest extends AuthRequest {
  tenantContext?: TenantContext;
}
