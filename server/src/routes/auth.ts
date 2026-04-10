/**
 * Authentication Routes
 *
 * Handles authentication for both:
 * - Super Admins (Cohi internal) - stored in coheus_management.coheus_users
 * - Tenant Users - stored in each tenant's database
 */

import { Router } from "express";
import pg from "pg";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { authLimiter } from "../middleware/rateLimiter.js";
import {
  auditLog,
  logFailedLogin,
  createSession,
  endSession,
  getRecentFailedLogins,
} from "../services/auditLogger.js";
import { logError, logWarn, logInfo, logDebug } from "../services/logger.js";
import crypto from "crypto";
import * as cognitoAuth from "../services/cognito/cognitoAuthService.js";
import {
  type LoanScope,
  type TenantPersona,
} from "../utils/userAccessProfile.js";

const { Pool } = pg;
const router = Router();

// User types for authentication
interface SuperAdminUser {
  id: string;
  email: string;
  encrypted_password: string;
  full_name: string | null;
  role: "super_admin" | "platform_admin" | "support";
  is_active: boolean;
  locked_until?: Date | null;
  failed_login_attempts?: number;
}

interface TenantUser {
  id: string;
  email: string;
  encrypted_password: string;
  full_name: string | null;
  role: "tenant_admin" | "user";
  is_active: boolean;
  tenant_id: string;
  tenant_name: string;
  tenant_slug: string;
  locked_until?: Date | null;
  failed_login_attempts?: number;
  persona?: TenantPersona;
  loan_scope?: LoanScope;
}

type AuthUser =
  | (SuperAdminUser & {
      tenant_id?: null;
      tenant_name?: null;
      tenant_slug?: null;
    })
  | TenantUser;

// JWT payload structure
interface JwtPayload {
  userId: string;
  email: string;
  role: string;
  tenantId?: string;
  tenantSlug?: string;
  isSuperAdmin: boolean;
  persona?: TenantPersona;
}

// Database pools
let managementPool: pg.Pool | null = null;
const tenantPools: Map<string, pg.Pool> = new Map();

function getManagementPool(): pg.Pool {
  if (!managementPool) {
    const dbHost = (process.env.DB_HOST || "localhost").trim();
    const rawHost =
      dbHost === "localhost" || dbHost === "127.0.0.1" ? "127.0.0.1" : dbHost;

    managementPool = new Pool({
      host: rawHost,
      port: parseInt(process.env.DB_PORT || "5432"),
      database: process.env.MANAGEMENT_DB_NAME || "coheus_management",
      user: process.env.DB_USER || "postgres",
      password: process.env.DB_PASSWORD || "postgres",
      ssl:
        rawHost !== "127.0.0.1" && rawHost !== "localhost"
          ? { rejectUnauthorized: false }
          : false,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });

    managementPool.on("error", (err: any) => {
      logError("[Auth] Management pool error", err, {});
    });
  }
  return managementPool;
}

async function getTenantPool(tenantSlug: string): Promise<pg.Pool | null> {
  // Check cache first
  if (tenantPools.has(tenantSlug)) {
    return tenantPools.get(tenantSlug)!;
  }

  try {
    // Get tenant connection info from management DB
    const mgmtPool = getManagementPool();
    const result = await mgmtPool.query(
      `SELECT database_name, database_host, database_port, database_user, database_password_encrypted, status
       FROM coheus_tenants 
       WHERE slug = $1 AND status = 'active'`,
      [tenantSlug],
    );

    if (result.rows.length === 0) {
      return null;
    }

    const tenant = result.rows[0];
    const dbHost = tenant.database_host || "127.0.0.1";

    const pool = new Pool({
      host: dbHost === "localhost" ? "127.0.0.1" : dbHost,
      port: tenant.database_port || 5432,
      database: tenant.database_name,
      user: tenant.database_user || process.env.DB_USER || "postgres",
      password: process.env.DB_PASSWORD || "postgres", // TODO: Decrypt tenant password
      ssl:
        dbHost !== "127.0.0.1" && dbHost !== "localhost"
          ? { rejectUnauthorized: false }
          : false,
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });

    tenantPools.set(tenantSlug, pool);
    return pool;
  } catch (error: any) {
    logError("[Auth] Failed to get tenant pool", error, { tenantSlug });
    return null;
  }
}

// Get JWT_SECRET lazily to allow dotenv to load first
function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET environment variable is required");
  }
  const trimmedSecret = secret.trim();
  if (trimmedSecret.length < 32) {
    throw new Error("JWT_SECRET must be at least 32 characters long");
  }
  return trimmedSecret;
}

// Validation schemas
const signInSchema = z.object({
  email: z.string().min(1, "Email is required"),
  password: z.string().min(1, "Password is required"),
  tenantSlug: z.string().optional(), // Optional - if not provided, check super admin first
});

const signUpSchema = z.object({
  email: z.string().email("Invalid email"),
  password: z.string().min(6, "Password must be at least 6 characters"),
  fullName: z.string().optional(),
  tenantSlug: z.string().optional(),
});

/**
 * Find user in management DB (super admins)
 */
async function findSuperAdmin(email: string): Promise<
  | (SuperAdminUser & {
      failed_login_attempts: number;
      locked_until: Date | null;
    })
  | null
> {
  try {
    const pool = getManagementPool();
    const result = await pool.query(
      `SELECT id, email, encrypted_password, full_name, role, is_active, 
              failed_login_attempts, locked_until
       FROM coheus_users 
       WHERE email = $1`,
      [email],
    );

    if (result.rows.length === 0) {
      return null;
    }

    return result.rows[0];
  } catch (error: any) {
    logError("[Auth] Failed to find super admin", error, { email });
    return null;
  }
}

/**
 * Find user in a tenant's database
 */
async function findTenantUser(
  email: string,
  tenantSlug?: string,
): Promise<
  | (TenantUser & { failed_login_attempts: number; locked_until: Date | null })
  | null
> {
  try {
    const mgmtPool = getManagementPool();

    // If no tenant slug provided, search all active tenants
    let tenants: Array<{
      id: string;
      slug: string;
      name: string;
      database_name: string;
    }>;

    if (tenantSlug) {
      const result = await mgmtPool.query(
        `SELECT id, slug, name, database_name FROM coheus_tenants WHERE slug = $1 AND status = 'active'`,
        [tenantSlug],
      );
      tenants = result.rows;
    } else {
      // Search all tenants - in production, might want to limit this
      const result = await mgmtPool.query(
        `SELECT id, slug, name, database_name FROM coheus_tenants WHERE status = 'active' ORDER BY name`,
      );
      tenants = result.rows;
    }

    // Search each tenant's database for the user
    for (const tenant of tenants) {
      const tenantPool = await getTenantPool(tenant.slug);
      if (!tenantPool) continue;

      try {
        const userResult = await tenantPool.query(
          `SELECT id, email, encrypted_password, full_name, role, is_active,
                  failed_login_attempts, locked_until,
                  persona,
                  loan_scope
           FROM users 
           WHERE email = $1`,
          [email],
        );

        if (userResult.rows.length > 0) {
          const user = userResult.rows[0];
          return {
            ...user,
            tenant_id: tenant.id,
            tenant_name: tenant.name,
            tenant_slug: tenant.slug,
          };
        }
      } catch (error: any) {
        // Tenant DB might not have users table yet
        logDebug("[Auth] Tenant user lookup failed", {
          tenant: tenant.slug,
          error: error.message,
        });
      }
    }

    return null;
  } catch (error: any) {
    logError("[Auth] Failed to find tenant user", error, { email, tenantSlug });
    return null;
  }
}

/**
 * Find a user in the DB by email (for post-Cognito auth lookup).
 * Returns user + isSuperAdmin flag.
 */
async function findUserByEmail(
  email: string,
  tenantSlug?: string,
): Promise<{ user: AuthUser; isSuperAdmin: boolean } | null> {
  if (!tenantSlug) {
    const superAdmin = await findSuperAdmin(email);
    if (superAdmin && superAdmin.is_active) {
      return { user: superAdmin, isSuperAdmin: true };
    }
  }

  const tenantUser = await findTenantUser(email, tenantSlug);
  if (tenantUser && tenantUser.is_active) {
    return { user: tenantUser, isSuperAdmin: false };
  }

  return null;
}

/**
 * Issue an app JWT and create a session for the given user.
 */
async function issueAppToken(
  user: AuthUser,
  isSuperAdmin: boolean,
  req: any,
): Promise<{ token: string; refreshToken?: string }> {
  const jwtPayload: JwtPayload = {
    userId: user.id,
    email: user.email,
    role: user.role,
    isSuperAdmin,
    persona: !isSuperAdmin && "persona" in user ? user.persona : undefined,
  };

  if (!isSuperAdmin && "tenant_id" in user) {
    jwtPayload.tenantId = user.tenant_id;
    jwtPayload.tenantSlug = user.tenant_slug;
  }

  const token = jwt.sign(jwtPayload, getJwtSecret(), { expiresIn: "1h" });

  // Update last login (non-critical)
  try {
    if (isSuperAdmin) {
      const mgmtPool = getManagementPool();
      await mgmtPool.query(
        `UPDATE coheus_users SET last_login_at = NOW(), failed_login_attempts = 0, locked_until = NULL WHERE id = $1`,
        [user.id],
      );
    } else if ("tenant_slug" in user) {
      const tenantPool = await getTenantPool(user.tenant_slug);
      if (tenantPool) {
        await tenantPool.query(
          `UPDATE users SET last_login_at = NOW(), failed_login_attempts = 0, locked_until = NULL WHERE id = $1`,
          [user.id],
        );
      }
    }
  } catch {}

  // Create session record (non-critical)
  try {
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    await createSession({
      userId: user.id,
      tenantId: "tenant_id" in user ? user.tenant_id : null,
      tokenHash,
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
  } catch {}

  await auditLog({
    userId: user.id,
    userEmail: user.email,
    userRole: user.role,
    tenantId: "tenant_id" in user ? user.tenant_id : null,
    action: "login",
    resource: "auth",
    description: `User logged in successfully${isSuperAdmin ? " (super admin)" : ""}`,
    status: "success",
    ipAddress: req.ip,
    userAgent: req.get("user-agent"),
  }).catch(() => {});

  return { token };
}

/**
 * Sign In
 * Cognito-only sign in path.
 */
router.post("/signin", authLimiter, async (req, res) => {
  try {
    const { email, password, tenantSlug } = signInSchema.parse(req.body);

    logInfo("[Auth] Sign in attempt", {
      email,
      tenantSlug: tenantSlug || "auto-detect",
      useCognito: cognitoAuth.isCognitoAuthEnabled(),
    });

    // Fail closed: this deployment requires Cognito as the only auth source.
    if (!cognitoAuth.isCognitoAuthEnabled()) {
      logError(
        "[Auth] Cognito password auth is disabled while /signin was requested",
        new Error("COGNITO_PASSWORD_AUTH_DISABLED"),
        { email, tenantSlug: tenantSlug || "auto-detect" },
      );
      return res.status(503).json({
        error:
          "Authentication service is temporarily unavailable. Cognito password authentication is required.",
      });
    }

    // --- Cognito auth path (single source of truth for all users when enabled) ---
    try {
      const result = await cognitoAuth.signIn(email, password);

      if (!result.authenticated && result.challengeName) {
        if (
          result.challengeName === "SOFTWARE_TOKEN_MFA" ||
          result.challengeName === "EMAIL_OTP" ||
          result.challengeName === "SMS_MFA"
        ) {
          return res.json({
            mfaRequired: true,
            challengeName: result.challengeName,
            session: result.session,
            email,
          });
        }
        if (result.challengeName === "MFA_SETUP") {
          return res.json({
            mfaSetupRequired: true,
            challengeName: result.challengeName,
            session: result.session,
            email,
          });
        }
        if (result.challengeName === "NEW_PASSWORD_REQUIRED") {
          return res.json({
            newPasswordRequired: true,
            session: result.session,
            email,
          });
        }
        return res
          .status(400)
          .json({ error: `Unsupported challenge: ${result.challengeName}` });
      }

      // Cognito auth succeeded -- find user in DB
      const found = await findUserByEmail(email, tenantSlug);
      if (!found) {
        return res.status(401).json({ error: "User not found in application" });
      }

      // Hardened enforcement: never issue an app token until Cognito MFA is enabled.
      // This prevents bypass when pool MFA is OPTIONAL and user has not enrolled yet.
      try {
        const userMfa = await cognitoAuth.getUser(email);
        if (!userMfa.mfaEnabled) {
          return res.status(403).json({
            mfaSetupRequired: true,
            email,
            cognitoAccessToken: result.accessToken,
          });
        }
      } catch (mfaStatusError: unknown) {
        logWarn(
          "[Auth] Failed to evaluate Cognito MFA status, failing closed",
          {
            email,
            error:
              mfaStatusError instanceof Error
                ? mfaStatusError.message
                : String(mfaStatusError),
          },
        );
        return res.status(403).json({
          mfaSetupRequired: true,
          email,
          cognitoAccessToken: result.accessToken,
        });
      }

      // Store cognito_sub if not already linked
      if (result.cognitoSub) {
        await linkCognitoSub(
          found.user,
          found.isSuperAdmin,
          result.cognitoSub,
        ).catch(() => {});
      }

      const { token } = await issueAppToken(
        found.user,
        found.isSuperAdmin,
        req,
      );

      logInfo("[Auth] Cognito sign in successful", { email });

      return res.json({
        user: buildUserResponse(found.user, found.isSuperAdmin),
        token,
        refreshToken: result.refreshToken,
        cognitoAccessToken: result.accessToken,
      });
    } catch (cognitoError: any) {
      await logFailedLogin({
        email,
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
        failureReason: cognitoError.code || "cognito_error",
      }).catch(() => {});

      const statusCode = cognitoError.statusCode || 401;
      return res
        .status(statusCode)
        .json({ error: cognitoError.message || "Authentication failed" });
    }
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0].message });
    }
    logError("[Auth] Sign in error", error, { email: req.body?.email });
    return res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * Set new password during first login (NEW_PASSWORD_REQUIRED challenge).
 * After Cognito accepts the new password it may return another challenge (MFA_SETUP)
 * or authenticate the user directly.
 */
router.post("/new-password", authLimiter, async (req, res) => {
  try {
    const { email, session, newPassword } = z
      .object({
        email: z.string().email(),
        session: z.string().min(1),
        newPassword: z
          .string()
          .min(10, "Password must be at least 10 characters"),
      })
      .parse(req.body);

    const result = await cognitoAuth.respondToNewPasswordChallenge(
      email,
      session,
      newPassword,
    );

    // Cognito may return another challenge (e.g. MFA_SETUP) after the password is set
    if (!result.authenticated && result.challengeName) {
      return res.json({
        mfaRequired: result.challengeName === "SOFTWARE_TOKEN_MFA",
        mfaSetupRequired: result.challengeName === "MFA_SETUP",
        challengeName: result.challengeName,
        session: result.session,
        email,
      });
    }

    // Password is updated. Enforce mandatory MFA setup before issuing app JWT.
    return res.json({
      refreshToken: result.refreshToken,
      cognitoAccessToken: result.accessToken,
      mfaSetupRequired: true,
      email,
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0].message });
    }
    const statusCode = error.statusCode || 400;
    return res
      .status(statusCode)
      .json({ error: error.message || "Failed to set new password" });
  }
});

/**
 * Verify MFA code during sign-in
 */
router.post("/mfa/verify", authLimiter, async (req, res) => {
  try {
    const { email, session, code, challengeName, tenantSlug } = z
      .object({
        email: z.string().email(),
        session: z.string().min(1),
        code: z.string().length(6),
        challengeName: z
          .enum(["SOFTWARE_TOKEN_MFA", "EMAIL_OTP", "SMS_MFA"])
          .optional(),
        tenantSlug: z.string().optional(),
      })
      .parse(req.body);

    const result = await cognitoAuth.respondToMfaChallenge(
      email,
      session,
      code,
      challengeName || "SOFTWARE_TOKEN_MFA",
    );

    if (!result.authenticated) {
      return res.status(401).json({ error: "MFA verification failed" });
    }

    const found = await findUserByEmail(email, tenantSlug);
    if (!found) {
      return res.status(401).json({ error: "User not found in application" });
    }

    if (result.cognitoSub) {
      await linkCognitoSub(
        found.user,
        found.isSuperAdmin,
        result.cognitoSub,
      ).catch(() => {});
    }

    const { token } = await issueAppToken(found.user, found.isSuperAdmin, req);

    logInfo("[Auth] MFA verification successful", { email });

    return res.json({
      user: buildUserResponse(found.user, found.isSuperAdmin),
      token,
      refreshToken: result.refreshToken,
      cognitoAccessToken: result.accessToken,
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0].message });
    }
    const statusCode = error.statusCode || 401;
    return res
      .status(statusCode)
      .json({ error: error.message || "MFA verification failed" });
  }
});

/**
 * Refresh app token using Cognito refresh token
 */
router.post("/refresh", async (req, res) => {
  try {
    const { refreshToken } = z
      .object({ refreshToken: z.string().min(1) })
      .parse(req.body);

    if (!cognitoAuth.isCognitoAuthEnabled()) {
      return res
        .status(400)
        .json({ error: "Token refresh not available in local dev mode" });
    }

    const result = await cognitoAuth.refreshTokens(refreshToken);

    // Decode sub to find user
    const found = await findUserByCognitoSub(result.cognitoSub);
    if (!found) {
      return res.status(401).json({ error: "User not found" });
    }

    const { token } = await issueAppToken(found.user, found.isSuperAdmin, req);

    return res.json({ token });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0].message });
    }
    return res.status(401).json({ error: "Token refresh failed" });
  }
});

// --- Helper functions for Cognito integration ---

function buildUserResponse(user: AuthUser, isSuperAdmin: boolean) {
  return {
    id: user.id,
    email: user.email,
    full_name: user.full_name,
    role: user.role,
    is_super_admin: isSuperAdmin,
    tenant_id: "tenant_id" in user ? user.tenant_id : null,
    tenant_name: "tenant_name" in user ? user.tenant_name : null,
    tenant_slug: "tenant_slug" in user ? user.tenant_slug : null,
    persona: !isSuperAdmin && "persona" in user ? user.persona : undefined,
    loan_scope:
      !isSuperAdmin && "loan_scope" in user ? user.loan_scope : undefined,
  };
}

async function linkCognitoSub(
  user: AuthUser,
  isSuperAdmin: boolean,
  cognitoSub: string,
): Promise<void> {
  try {
    if (isSuperAdmin) {
      await getManagementPool().query(
        `UPDATE coheus_users SET cognito_sub = $1 WHERE id = $2 AND (cognito_sub IS NULL OR cognito_sub <> $1)`,
        [cognitoSub, user.id],
      );
    } else if ("tenant_slug" in user) {
      const tenantPool = await getTenantPool(user.tenant_slug);
      if (tenantPool) {
        await tenantPool.query(
          `UPDATE users SET cognito_sub = $1 WHERE id = $2 AND (cognito_sub IS NULL OR cognito_sub <> $1)`,
          [cognitoSub, user.id],
        );
      }
    }
  } catch (error: any) {
    logDebug("[Auth] Failed to link cognito_sub", { error: error.message });
  }
}

async function findUserByCognitoSub(
  cognitoSub: string,
): Promise<{ user: AuthUser; isSuperAdmin: boolean } | null> {
  // Check management DB first
  try {
    const mgmtPool = getManagementPool();
    const result = await mgmtPool.query(
      `SELECT id, email, encrypted_password, full_name, role, is_active, failed_login_attempts, locked_until
       FROM coheus_users WHERE cognito_sub = $1`,
      [cognitoSub],
    );
    if (result.rows.length > 0 && result.rows[0].is_active) {
      return { user: result.rows[0], isSuperAdmin: true };
    }
  } catch {}

  // Check all active tenants
  try {
    const mgmtPool = getManagementPool();
    const tenants = await mgmtPool.query(
      `SELECT id, slug, name FROM coheus_tenants WHERE status = 'active'`,
    );
    for (const tenant of tenants.rows) {
      const tenantPool = await getTenantPool(tenant.slug);
      if (!tenantPool) continue;
      try {
        const result = await tenantPool.query(
          `SELECT id, email, encrypted_password, full_name, role, is_active, failed_login_attempts, locked_until,
                  persona, loan_scope
           FROM users WHERE cognito_sub = $1`,
          [cognitoSub],
        );
        if (result.rows.length > 0 && result.rows[0].is_active) {
          return {
            user: {
              ...result.rows[0],
              tenant_id: tenant.id,
              tenant_name: tenant.name,
              tenant_slug: tenant.slug,
            },
            isSuperAdmin: false,
          };
        }
      } catch {}
    }
  } catch {}

  return null;
}

/**
 * Get Current User
 */
router.get("/me", async (req, res) => {
  try {
    const token = req.headers.authorization?.replace("Bearer ", "");
    if (!token) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const decoded = jwt.verify(token, getJwtSecret()) as JwtPayload;

    // Fetch fresh user data
    let user: any = null;

    if (decoded.isSuperAdmin) {
      const mgmtPool = getManagementPool();
      const result = await mgmtPool.query(
        `SELECT id, email, full_name, role, is_active, last_login_at, created_at
         FROM coheus_users WHERE id = $1`,
        [decoded.userId],
      );
      if (result.rows.length > 0) {
        user = {
          ...result.rows[0],
          is_super_admin: true,
          tenant_id: null,
          tenant_name: null,
          tenant_slug: null,
          persona: undefined,
          loan_scope: undefined,
        };
      }
    } else if (decoded.tenantSlug) {
      const tenantPool = await getTenantPool(decoded.tenantSlug);
      if (tenantPool) {
        const result = await tenantPool.query(
          `SELECT id, email, full_name, role, is_active, last_login_at, created_at,
                  persona, loan_scope
           FROM users WHERE id = $1`,
          [decoded.userId],
        );
        if (result.rows.length > 0) {
          // Get tenant info
          const mgmtPool = getManagementPool();
          const tenantResult = await mgmtPool.query(
            `SELECT id, name, slug FROM coheus_tenants WHERE slug = $1`,
            [decoded.tenantSlug],
          );
          const tenant = tenantResult.rows[0];

          user = {
            ...result.rows[0],
            is_super_admin: false,
            tenant_id: tenant?.id,
            tenant_name: tenant?.name,
            tenant_slug: tenant?.slug,
          };
        }
      }
    }

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    return res.json({ user });
  } catch (error: any) {
    if (
      error.name === "JsonWebTokenError" ||
      error.name === "TokenExpiredError"
    ) {
      return res.status(401).json({ error: "Invalid or expired token" });
    }
    logError("[Auth] /me error", error, {});
    return res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * Sign Out
 */
router.post("/signout", async (req, res) => {
  try {
    const token = req.headers.authorization?.replace("Bearer ", "");

    if (token) {
      const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
      await endSession(tokenHash, "manual").catch(() => {});

      try {
        const decoded = jwt.verify(token, getJwtSecret()) as JwtPayload;
        await auditLog({
          userId: decoded.userId,
          userEmail: decoded.email,
          userRole: decoded.role,
          tenantId: decoded.tenantId || null,
          action: "logout",
          resource: "auth",
          description: "User logged out",
          status: "success",
          ipAddress: req.ip,
          userAgent: req.get("user-agent"),
        }).catch(() => {});
      } catch (error) {
        // Token might be expired, that's okay
      }
    }

    return res.json({ message: "Signed out successfully" });
  } catch (error) {
    return res.json({ message: "Signed out successfully" });
  }
});

/**
 * List all tenants (for login dropdown - public endpoint)
 */
router.get("/tenants", async (req, res) => {
  try {
    const mgmtPool = getManagementPool();
    const result = await mgmtPool.query(
      `SELECT slug, name FROM coheus_tenants WHERE status = 'active' ORDER BY name`,
    );

    return res.json({ tenants: result.rows });
  } catch (error: any) {
    logError("[Auth] Failed to list tenants", error, {});
    return res.json({ tenants: [] });
  }
});

// =============================================================================
// PASSWORD RESET
// =============================================================================

const passwordResetRequestSchema = z.object({
  email: z.string().email("Invalid email"),
  tenantSlug: z.string().optional(),
});

/**
 * Request Password Reset
 * Generates a 6-digit code, stores its hash in the management DB, and sends
 * the code to the user via SES. This bypasses Cognito's ForgotPassword API
 * which is unreliable for users created via AdminCreateUser.
 */
router.post("/password-reset/request", authLimiter, async (req, res) => {
  try {
    const { email, tenantSlug } = passwordResetRequestSchema.parse(req.body);
    logInfo("[Auth] Password reset requested", { email, tenantSlug });

    const successMsg =
      "If an account exists with this email, you will receive password reset instructions.";

    if (!cognitoAuth.isCognitoAuthEnabled()) {
      return res.status(503).json({
        error:
          "Password reset is temporarily unavailable. Cognito password authentication is required.",
      });
    }

    // Only send if the user actually exists (but always return generic message)
    const found = await findUserByEmail(email, tenantSlug);
    if (!found) {
      return res.json({ message: successMsg, useCognito: true });
    }

    const code = crypto.randomInt(100000, 999999).toString();
    const tokenHash = crypto.createHash("sha256").update(code).digest("hex");
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    const mgmt = getManagementPool();
    await mgmt.query(
      `INSERT INTO password_reset_tokens (email, token_hash, tenant_slug, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [email, tokenHash, tenantSlug || null, expiresAt],
    );

    try {
      const { sendPasswordResetEmail } =
        await import("../services/emailService.js");
      const { resolveFrontendUrl } = await import("../utils/frontendUrl.js");
      const frontendUrl = resolveFrontendUrl();
      const resetUrl = `${frontendUrl}/reset-password?email=${encodeURIComponent(email)}&code=${code}`;
      const userName = found.user.full_name || undefined;
      await sendPasswordResetEmail(email, resetUrl, userName, { strict: true });
      logInfo("[Auth] Password reset email sent via SES", { email });
    } catch (emailError: any) {
      logError(
        "[Auth] Failed to send password reset email via SES",
        emailError,
        { email },
      );
    }

    return res.json({ message: successMsg, useCognito: true });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0].message });
    }
    logError("[Auth] Password reset request error", error, {});
    return res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * Confirm Password Reset
 * Validates the 6-digit code against the management DB, then sets the new
 * password in Cognito via AdminSetUserPassword. Re-enables email MFA afterwards.
 */
router.post("/password-reset/confirm", authLimiter, async (req, res) => {
  try {
    const body = req.body;

    if (!cognitoAuth.isCognitoAuthEnabled()) {
      return res.status(503).json({
        error:
          "Password reset confirmation is temporarily unavailable. Cognito password authentication is required.",
      });
    }

    if (!body?.email || !body?.code) {
      return res.status(400).json({
        error: "email and code are required for password reset confirmation",
      });
    }

    const { email, code, newPassword } = z
      .object({
        email: z.string().email(),
        code: z.string().min(1),
        newPassword: z
          .string()
          .min(10, "Password must be at least 10 characters"),
      })
      .parse(body);

    const tokenHash = crypto.createHash("sha256").update(code).digest("hex");
    const mgmt = getManagementPool();
    const tokenResult = await mgmt.query(
      `UPDATE password_reset_tokens
       SET used_at = NOW()
       WHERE email = $1 AND token_hash = $2 AND used_at IS NULL AND expires_at > NOW()
       RETURNING id`,
      [email, tokenHash],
    );

    if (tokenResult.rows.length === 0) {
      return res.status(400).json({
        error: "Invalid or expired reset code. Please request a new one.",
      });
    }

    await cognitoAuth.adminSetUserPassword(email, newPassword);

    // Restore email MFA (AdminSetUserPassword may clear preferences)
    try {
      const userInfo = await cognitoAuth.getUser(email);
      if (!userInfo.mfaEnabled) {
        await cognitoAuth.enableEmailMfa(email);
        logInfo("[Auth] Re-enabled email MFA after password reset", { email });
      }
    } catch (mfaError: any) {
      logWarn("[Auth] Failed to restore MFA after password reset", {
        email,
        error: mfaError.message,
      });
    }

    await auditLog({
      userId: null,
      userEmail: email,
      userRole: null,
      tenantId: null,
      action: "password_reset",
      resource: "auth",
      description: "Password reset completed via token + AdminSetUserPassword",
      status: "success",
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
    }).catch(() => {});

    return res.json({
      message:
        "Password reset successful. You can now log in with your new password.",
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0].message });
    }
    logError("[Auth] Password reset confirm error", error, {
      email: req.body?.email,
    });
    const statusCode = error.statusCode || 500;
    return res
      .status(statusCode)
      .json({ error: error.message || "Internal server error" });
  }
});

// =============================================================================
// IMPERSONATION (Super Admin Only)
// =============================================================================

const impersonateSchema = z.object({
  targetUserId: z.string().uuid("Invalid user ID"),
  targetTenantSlug: z.string().min(1, "Tenant slug is required"),
});

/**
 * Start Impersonation (Super Admin Only)
 */
router.post("/impersonate", async (req, res) => {
  try {
    // Verify current user is super admin
    const authToken = req.headers.authorization?.replace("Bearer ", "");
    if (!authToken) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const decoded = jwt.verify(authToken, getJwtSecret()) as JwtPayload;

    if (!decoded.isSuperAdmin || decoded.role !== "super_admin") {
      return res
        .status(403)
        .json({ error: "Only super admins can impersonate users" });
    }

    const { targetUserId, targetTenantSlug } = impersonateSchema.parse(
      req.body,
    );

    // Get target user from tenant DB
    const tenantPool = await getTenantPool(targetTenantSlug);
    if (!tenantPool) {
      return res.status(404).json({ error: "Tenant not found" });
    }

    const userResult = await tenantPool.query(
      `SELECT id, email, full_name, role, is_active FROM users WHERE id = $1`,
      [targetUserId],
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    const targetUser = userResult.rows[0];

    if (!targetUser.is_active) {
      return res
        .status(400)
        .json({ error: "Cannot impersonate inactive user" });
    }

    // Get tenant info
    const mgmtPool = getManagementPool();
    const tenantResult = await mgmtPool.query(
      `SELECT id, name, slug FROM coheus_tenants WHERE slug = $1`,
      [targetTenantSlug],
    );
    const tenant = tenantResult.rows[0];

    // Create impersonation token (shorter expiry)
    const impersonationPayload = {
      userId: targetUser.id,
      email: targetUser.email,
      role: targetUser.role,
      tenantId: tenant.id,
      tenantSlug: tenant.slug,
      isSuperAdmin: false,
      isImpersonating: true,
      impersonatedBy: decoded.userId,
      impersonatorEmail: decoded.email,
    };

    const impersonationToken = jwt.sign(impersonationPayload, getJwtSecret(), {
      expiresIn: "1h", // 1 hour max for impersonation
    });

    // Audit log the impersonation
    await auditLog({
      userId: decoded.userId,
      userEmail: decoded.email,
      userRole: decoded.role,
      tenantId: tenant.id,
      action: "impersonation_start",
      resource: "auth",
      description: `Started impersonating ${targetUser.email} (${targetUser.role})`,
      status: "success",
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
      metadata: {
        targetUserId: targetUser.id,
        targetUserEmail: targetUser.email,
        targetUserRole: targetUser.role,
        tenantSlug: tenant.slug,
      },
    }).catch(() => {});

    logInfo("[Auth] Impersonation started", {
      impersonator: decoded.email,
      target: targetUser.email,
      tenant: tenant.slug,
    });

    return res.json({
      user: {
        id: targetUser.id,
        email: targetUser.email,
        full_name: targetUser.full_name,
        role: targetUser.role,
        is_super_admin: false,
        tenant_id: tenant.id,
        tenant_name: tenant.name,
        tenant_slug: tenant.slug,
        is_impersonating: true,
        impersonated_by: decoded.email,
      },
      token: impersonationToken,
      originalToken: authToken, // Return original token for ending impersonation
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0].message });
    }
    if (
      error.name === "JsonWebTokenError" ||
      error.name === "TokenExpiredError"
    ) {
      return res.status(401).json({ error: "Invalid or expired token" });
    }
    logError("[Auth] Impersonate error", error, {});
    return res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * End Impersonation
 */
router.post("/end-impersonation", async (req, res) => {
  try {
    const authToken = req.headers.authorization?.replace("Bearer ", "");
    if (!authToken) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const decoded = jwt.verify(authToken, getJwtSecret()) as JwtPayload & {
      isImpersonating?: boolean;
      impersonatedBy?: string;
      impersonatorEmail?: string;
    };

    if (!decoded.isImpersonating) {
      return res.status(400).json({ error: "Not currently impersonating" });
    }

    // Audit log
    await auditLog({
      userId: decoded.impersonatedBy || null,
      userEmail: decoded.impersonatorEmail || null,
      userRole: "super_admin",
      tenantId: decoded.tenantId || null,
      action: "impersonation_end",
      resource: "auth",
      description: `Ended impersonation of ${decoded.email}`,
      status: "success",
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
    }).catch(() => {});

    logInfo("[Auth] Impersonation ended", {
      impersonator: decoded.impersonatorEmail,
      target: decoded.email,
    });

    return res.json({ message: "Impersonation ended" });
  } catch (error: any) {
    if (
      error.name === "JsonWebTokenError" ||
      error.name === "TokenExpiredError"
    ) {
      return res.status(401).json({ error: "Invalid or expired token" });
    }
    logError("[Auth] End impersonation error", error, {});
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
