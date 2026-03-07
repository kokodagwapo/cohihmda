/**
 * Tenant Context Middleware
 * Provides tenant database pool and tenant info to request handlers
 */

import { Request, Response, NextFunction } from "express";
import { AuthRequest } from "./auth.js";
import { pool as managementPool } from "../config/managementDatabase.js";
import { tenantDbManager } from "../config/tenantDatabaseManager.js";
import { auditLog } from "../services/auditLogger.js";

export interface TenantContext {
  tenantId: string;
  tenantPool: import("pg").Pool;
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
    const queryTenantId = req.query.tenant_id as string | undefined;
    const userRole = req.userRole || "user";
    const jwtTenantId = req.tenantId || null;

    console.log("[TenantContext] Using JWT data:", {
      userId: req.userId,
      userRole,
      jwtTenantId,
      queryTenantId,
    });

    const isPlatformStaff = [
      "super_admin",
      "platform_admin",
      "support",
    ].includes(userRole);
    let tenantId: string | null = null;

    if (queryTenantId && isPlatformStaff) {
      console.log("[TenantContext] Platform staff selecting tenant:", {
        userId: req.userId,
        userRole,
        queryTenantId,
      });
      const tenantCheck = await managementPool.query(
        `SELECT id FROM coheus_tenants WHERE id = $1 AND status = 'active'`,
        [queryTenantId]
      );
      if (tenantCheck.rows.length > 0) {
        tenantId = queryTenantId;

        auditLog({
          userId: req.userId!,
          userEmail: req.userEmail,
          userRole,
          tenantId: queryTenantId,
          action: "cross_tenant_access",
          resource: req.path,
          status: "success",
          metadata: {
            method: req.method,
            originalTenantId: jwtTenantId,
            targetTenantId: queryTenantId,
          },
          ipAddress: req.ip,
          userAgent: req.get("user-agent"),
        }).catch(() => {});

      } else {
        console.warn(
          "[TenantContext] Tenant not found or inactive:",
          queryTenantId
        );
        res.status(404).json({ error: "Tenant not found or inactive" });
        return;
      }
    } else if (queryTenantId && !isPlatformStaff) {
      console.warn(
        "[TenantContext] Non-platform user attempted to use tenant_id query param (ignored):",
        { userId: req.userId, userRole, queryTenantId }
      );
    }

    if (!tenantId && jwtTenantId) {
      console.log("[TenantContext] Using tenant from JWT:", jwtTenantId);
      tenantId = jwtTenantId;
    }

    if (!tenantId) {
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

    const tenantPool = await tenantDbManager.getTenantPool(tenantId);
    const tenantConfig = await tenantDbManager.getTenantConfig(tenantId);

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

// Path prefixes that do NOT need tenant context
const TENANT_EXEMPT_PREFIXES = [
  "/api/auth",
  "/api/subscriptions/plans",
  "/api/subscriptions/checkout/public",
  "/api/subscriptions/webhook",
  "/api/news",
  "/api/version",
  "/health",
  "/api/health",
];

/**
 * Global middleware: attempts to attach tenant context on every authenticated
 * request that hasn't already been handled by the explicit per-route middleware.
 * Defence-in-depth layer — never sends an error response, only silently skips.
 */
export async function globalTenantContext(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  if (req.tenantContext) {
    return next();
  }

  const path = req.originalUrl || req.path;
  if (TENANT_EXEMPT_PREFIXES.some((p) => path.startsWith(p))) {
    return next();
  }

  if (!req.userId) {
    return next();
  }

  try {
    const userRole = req.userRole || "user";
    const jwtTenantId = req.tenantId || null;
    const queryTenantId = req.query.tenant_id as string | undefined;
    const isPlatformStaff = ["super_admin", "platform_admin", "support"].includes(userRole);

    let tenantId: string | null = null;

    if (queryTenantId && isPlatformStaff) {
      const tenantCheck = await managementPool.query(
        `SELECT id FROM coheus_tenants WHERE id = $1 AND status = 'active'`,
        [queryTenantId]
      );
      if (tenantCheck.rows.length > 0) {
        tenantId = queryTenantId;
      }
    }

    if (!tenantId && jwtTenantId) {
      tenantId = jwtTenantId;
    }

    if (!tenantId) {
      return next();
    }

    const tenantPool = await tenantDbManager.getTenantPool(tenantId);
    const tenantConfig = await tenantDbManager.getTenantConfig(tenantId);

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
  } catch (_err) {
    // Silently continue — defense-in-depth, not primary protection
  }

  next();
}
