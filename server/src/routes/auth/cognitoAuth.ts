/**
 * Cognito Authentication Routes
 * Handles AWS Cognito SSO callback and token exchange
 */

import { Router } from "express";
import { z } from "zod";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import pg from "pg";
import {
  exchangeCodeForTokens,
  verifyIdToken,
  extractUserInfo,
  buildAuthorizationUrl,
  buildLogoutUrl,
  isCognitoConfigured,
  getCognitoConfig,
  type CognitoUserInfo,
} from "../../services/cognito/cognitoService.js";
import { auditLog, createSession } from "../../services/auditLogger.js";
import { logError, logInfo, logDebug, logWarn } from "../../services/logger.js";

const { Pool } = pg;
const router = Router();

// Database pools (shared with main auth)
let managementPool: pg.Pool | null = null;

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
    });
  }
  return managementPool;
}

async function getTenantPoolBySlug(
  tenantSlug: string,
): Promise<pg.Pool | null> {
  try {
    const mgmtPool = getManagementPool();
    const result = await mgmtPool.query(
      `SELECT database_name, database_host, database_port, database_user
       FROM coheus_tenants 
       WHERE slug = $1 AND status = 'active'`,
      [tenantSlug],
    );

    if (result.rows.length === 0) return null;

    const tenant = result.rows[0];
    const dbHost = tenant.database_host || "127.0.0.1";

    return new Pool({
      host: dbHost === "localhost" ? "127.0.0.1" : dbHost,
      port: tenant.database_port || 5432,
      database: tenant.database_name,
      user: tenant.database_user || process.env.DB_USER || "postgres",
      password: process.env.DB_PASSWORD || "postgres",
      ssl:
        dbHost !== "127.0.0.1" && dbHost !== "localhost"
          ? { rejectUnauthorized: false }
          : false,
      max: 5,
    });
  } catch (error: any) {
    logError("[CognitoAuth] Failed to get tenant pool", error, { tenantSlug });
    return null;
  }
}

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET environment variable is required");
  }
  return secret.trim();
}

// Schema for state parameter (tenant info encoded)
interface SsoState {
  tenantSlug?: string;
  returnUrl?: string;
  nonce: string;
  timestamp: number;
}

/**
 * Get the primary frontend URL for SSO redirects
 * FRONTEND_URL may contain comma-separated values for CORS, but we need just the first one
 */
function getPrimaryFrontendUrl(): string {
  const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
  // Handle comma-separated URLs (take the first one)
  return frontendUrl.split(",")[0].trim();
}

/**
 * Get Cognito configuration (public endpoint)
 */
router.get("/config", (req, res) => {
  const config = getCognitoConfig();
  return res.json({
    isConfigured: config.isConfigured,
    domain: config.domain,
    region: config.region,
  });
});

/**
 * Start SSO flow - redirects to Cognito
 */
router.get("/authorize", async (req, res) => {
  try {
    if (!isCognitoConfigured()) {
      return res.status(503).json({ error: "SSO is not configured" });
    }

    const tenantSlug = req.query.tenant as string | undefined;
    const returnUrl = req.query.returnUrl as string | undefined;
    const idpHint = req.query.idp as string | undefined;

    // Build state with nonce for CSRF protection
    const state: SsoState = {
      tenantSlug,
      returnUrl,
      nonce: crypto.randomBytes(16).toString("hex"),
      timestamp: Date.now(),
    };

    const stateEncoded = Buffer.from(JSON.stringify(state)).toString(
      "base64url",
    );
    const frontendUrl = getPrimaryFrontendUrl();
    const redirectUri = `${frontendUrl}/auth/sso/callback`;

    const authUrl = buildAuthorizationUrl(redirectUri, stateEncoded, idpHint);

    logInfo("[CognitoAuth] Redirecting to Cognito", {
      tenantSlug,
      hasIdpHint: !!idpHint,
    });

    return res.redirect(authUrl);
  } catch (error: any) {
    logError("[CognitoAuth] Authorize error", error, {});
    return res.status(500).json({ error: "Failed to start SSO flow" });
  }
});

/**
 * Cognito callback - exchange code for tokens
 */
router.post("/callback", async (req, res) => {
  try {
    if (!isCognitoConfigured()) {
      return res.status(503).json({ error: "SSO is not configured" });
    }

    const { code, state } = req.body;

    if (!code) {
      return res.status(400).json({ error: "Authorization code is required" });
    }

    // Decode and validate state
    let ssoState: SsoState | null = null;
    if (state) {
      try {
        ssoState = JSON.parse(Buffer.from(state, "base64url").toString());

        // Check state is not too old (5 minute max)
        if (Date.now() - ssoState.timestamp > 5 * 60 * 1000) {
          return res
            .status(400)
            .json({ error: "SSO session expired. Please try again." });
        }
      } catch (e) {
        logWarn("[CognitoAuth] Invalid state parameter", { state });
      }
    }

    const frontendUrl = getPrimaryFrontendUrl();
    const redirectUri = `${frontendUrl}/auth/sso/callback`;

    // Exchange code for tokens
    const tokens = await exchangeCodeForTokens(code, redirectUri);

    // Verify and decode ID token
    const idTokenPayload = await verifyIdToken(tokens.id_token);
    const userInfo = extractUserInfo(idTokenPayload);

    logDebug("[CognitoAuth] User authenticated via SSO", {
      email: userInfo.email,
      idpName: userInfo.idpName,
    });

    // Find or create user
    const { user, tenantSlug, isSuperAdmin } = await findOrCreateSsoUser(
      userInfo,
      ssoState?.tenantSlug,
    );

    if (!user) {
      return res.status(401).json({
        error: "User not found or not authorized for this tenant",
        email: userInfo.email,
      });
    }

    // Generate JWT
    const jwtPayload = {
      userId: user.id,
      email: user.email,
      role: user.role,
      isSuperAdmin,
      tenantId: user.tenant_id,
      tenantSlug,
      authMethod: "cognito_sso",
    };

    const token = jwt.sign(jwtPayload, getJwtSecret(), { expiresIn: "7d" });

    // Create session
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    await createSession({
      userId: user.id,
      tenantId: user.tenant_id || null,
      tokenHash,
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    }).catch(() => {});

    // Log SSO login to tenant's history (if tenant DB available)
    if (tenantSlug) {
      await logSsoLogin(tenantSlug, user, userInfo, "success").catch(() => {});
    }

    // Audit log
    await auditLog({
      userId: user.id,
      userEmail: user.email,
      userRole: user.role,
      tenantId: user.tenant_id || null,
      action: "login",
      resource: "auth",
      description: `SSO login via ${userInfo.idpName || "Cognito"}`,
      status: "success",
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
    }).catch(() => {});

    logInfo("[CognitoAuth] SSO login successful", {
      email: user.email,
      tenant: tenantSlug,
      idp: userInfo.idpName,
    });

    return res.json({
      user: {
        id: user.id,
        email: user.email,
        full_name: user.full_name,
        role: user.role,
        is_super_admin: isSuperAdmin,
        tenant_id: user.tenant_id,
        tenant_name: user.tenant_name,
        tenant_slug: tenantSlug,
      },
      token,
      returnUrl: ssoState?.returnUrl,
    });
  } catch (error: any) {
    logError("[CognitoAuth] Callback error", error, {});

    // Try to log failed attempt
    if (req.body.state) {
      try {
        const state = JSON.parse(
          Buffer.from(req.body.state, "base64url").toString(),
        );
        if (state.tenantSlug) {
          await logSsoLogin(
            state.tenantSlug,
            null,
            null,
            "failed",
            error.message,
          ).catch(() => {});
        }
      } catch (e) {}
    }

    return res.status(401).json({ error: "SSO authentication failed" });
  }
});

/**
 * SSO logout
 */
router.get("/logout", (req, res) => {
  if (!isCognitoConfigured()) {
    return res.redirect("/");
  }

  const frontendUrl = getPrimaryFrontendUrl();
  const logoutUrl = buildLogoutUrl(`${frontendUrl}/`);

  return res.redirect(logoutUrl);
});

/**
 * Lookup tenant by email domain (for SSO routing)
 */
router.get("/lookup-tenant", async (req, res) => {
  try {
    const email = req.query.email as string;
    if (!email) {
      return res.status(400).json({ error: "Email is required" });
    }

    const domain = email.split("@")[1]?.toLowerCase();
    if (!domain) {
      return res.status(400).json({ error: "Invalid email format" });
    }

    const mgmtPool = getManagementPool();

    // Check tenant identity providers for matching email domain
    const result = await mgmtPool.query(
      `
      SELECT 
        t.id as tenant_id,
        t.slug as tenant_slug,
        t.name as tenant_name,
        t.auth_config,
        tip.provider_type,
        tip.cognito_idp_name,
        tip.idp_type
      FROM coheus_tenants t
      JOIN tenant_identity_providers tip ON tip.tenant_id = t.id
      WHERE t.status = 'active'
        AND tip.is_enabled = true
        AND $1 = ANY(tip.email_domains)
      ORDER BY tip.is_primary DESC
      LIMIT 1
    `,
      [domain],
    );

    if (result.rows.length === 0) {
      // No SSO configured for this domain, allow email/password
      return res.json({
        sso_available: false,
        allow_password: true,
      });
    }

    const row = result.rows[0];
    const authConfig = row.auth_config || { mode: "hybrid" };

    return res.json({
      tenant_id: row.tenant_id,
      tenant_slug: row.tenant_slug,
      tenant_name: row.tenant_name,
      sso_available: true,
      sso_method: row.provider_type,
      idp_name: row.cognito_idp_name,
      idp_type: row.idp_type,
      allow_password:
        authConfig.mode !== "sso_only" &&
        authConfig.allow_email_password !== false,
      auth_mode: authConfig.mode,
    });
  } catch (error: any) {
    logError("[CognitoAuth] Lookup tenant error", error, {});
    return res.status(500).json({ error: "Failed to lookup tenant" });
  }
});

// Domains that are allowed to auto-provision platform users via SSO
// Add your company domain(s) here
const PLATFORM_JIT_DOMAINS = [
  'teraverde.com',
  'coheus.io',
  'coheus.com',
];

/**
 * Find or create user from SSO
 */
async function findOrCreateSsoUser(
  userInfo: CognitoUserInfo,
  tenantSlugHint?: string,
): Promise<
  | { user: any; tenantSlug: string | null; isSuperAdmin: boolean }
  | { user: null; tenantSlug: null; isSuperAdmin: false }
> {
  const mgmtPool = getManagementPool();
  const email = userInfo.email.toLowerCase();
  const emailDomain = email.split("@")[1];

  // Check if this is an existing platform user
  const platformUserResult = await mgmtPool.query(
    `SELECT id, email, full_name, role, is_active 
     FROM coheus_users WHERE email = $1`,
    [email],
  );

  if (platformUserResult.rows.length > 0) {
    const platformUser = platformUserResult.rows[0];
    if (!platformUser.is_active) {
      return { user: null, tenantSlug: null, isSuperAdmin: false };
    }

    // Update last login
    await mgmtPool.query(
      `UPDATE coheus_users SET last_login_at = NOW() WHERE id = $1`,
      [platformUser.id],
    );

    const isSuperAdmin = ['super_admin', 'platform_admin'].includes(platformUser.role);
    
    return {
      user: {
        ...platformUser,
        tenant_id: null,
        tenant_name: null,
      },
      tenantSlug: null,
      isSuperAdmin,
    };
  }

  // Find tenant by hint or email domain
  let tenantSlug = tenantSlugHint;
  let tenantInfo: any = null;

  if (tenantSlug) {
    const result = await mgmtPool.query(
      `SELECT id, slug, name FROM coheus_tenants WHERE slug = $1 AND status = 'active'`,
      [tenantSlug],
    );
    if (result.rows.length > 0) {
      tenantInfo = result.rows[0];
    }
  }

  if (!tenantInfo) {
    // Try to find tenant by email domain
    const domainResult = await mgmtPool.query(
      `
      SELECT 
        t.id, t.slug, t.name
      FROM coheus_tenants t
      JOIN tenant_identity_providers tip ON tip.tenant_id = t.id
      WHERE t.status = 'active'
        AND tip.is_enabled = true
        AND $1 = ANY(tip.email_domains)
      LIMIT 1
    `,
      [emailDomain],
    );

    if (domainResult.rows.length > 0) {
      tenantInfo = domainResult.rows[0];
      tenantSlug = tenantInfo.slug;
    }
  }

  // If no tenant found, check if we should JIT provision a platform user
  if (!tenantInfo) {
    // Check if email domain is allowed for platform JIT provisioning
    if (PLATFORM_JIT_DOMAINS.includes(emailDomain)) {
      logInfo("[CognitoAuth] JIT provisioning new platform user as super_admin", { email, domain: emailDomain });
      
      // Create new platform user with 'super_admin' role - full access to all tenants and features
      const newPlatformUser = await mgmtPool.query(
        `INSERT INTO coheus_users (email, full_name, role, is_active, encrypted_password, last_login_at)
         VALUES ($1, $2, 'super_admin', true, $3, NOW())
         RETURNING id, email, full_name, role, is_active`,
        [
          email,
          userInfo.fullName ||
            `${userInfo.firstName || ""} ${userInfo.lastName || ""}`.trim() ||
            email.split("@")[0],
          crypto.randomBytes(32).toString("hex"), // Random password (not usable - SSO only)
        ],
      );

      const user = newPlatformUser.rows[0];
      return {
        user: {
          ...user,
          tenant_id: null,
          tenant_name: null,
        },
        tenantSlug: null,
        isSuperAdmin: true, // Platform users from allowed domains get super_admin
      };
    }

    logWarn("[CognitoAuth] No tenant found for SSO user and domain not in JIT list", { 
      email, 
      domain: emailDomain,
      allowedDomains: PLATFORM_JIT_DOMAINS,
    });
    return { user: null, tenantSlug: null, isSuperAdmin: false };
  }

  // Get tenant pool
  const tenantPool = await getTenantPoolBySlug(tenantInfo.slug);
  if (!tenantPool) {
    return { user: null, tenantSlug: null, isSuperAdmin: false };
  }

  try {
    // Check if user exists in tenant DB
    const userResult = await tenantPool.query(
      `SELECT id, email, full_name, role, is_active, encompass_user_id 
       FROM users WHERE email = $1`,
      [email],
    );

    if (userResult.rows.length > 0) {
      const user = userResult.rows[0];
      if (!user.is_active) {
        await tenantPool.end();
        return { user: null, tenantSlug: null, isSuperAdmin: false };
      }

      // Update last login and SSO info
      await tenantPool.query(
        `UPDATE users SET last_login_at = NOW() WHERE id = $1`,
        [user.id],
      );

      await tenantPool.end();

      return {
        user: {
          ...user,
          tenant_id: tenantInfo.id,
          tenant_name: tenantInfo.name,
        },
        tenantSlug: tenantInfo.slug,
        isSuperAdmin: false,
      };
    }

    // JIT provisioning - create new user
    const newUserResult = await tenantPool.query(
      `
      INSERT INTO users (email, full_name, role, encrypted_password, is_active, encompass_user_id)
      VALUES ($1, $2, $3, $4, true, $5)
      RETURNING id, email, full_name, role, is_active, encompass_user_id
    `,
      [
        email,
        userInfo.fullName ||
          `${userInfo.firstName || ""} ${userInfo.lastName || ""}`.trim() ||
          null,
        userInfo.role || "user", // Default role from IdP or 'user'
        crypto.randomBytes(32).toString("hex"), // Random password (not usable)
        userInfo.encompassUserId || null,
      ],
    );

    await tenantPool.end();

    const newUser = newUserResult.rows[0];
    logInfo("[CognitoAuth] JIT provisioned new user", {
      email,
      tenant: tenantInfo.slug,
    });

    return {
      user: {
        ...newUser,
        tenant_id: tenantInfo.id,
        tenant_name: tenantInfo.name,
      },
      tenantSlug: tenantInfo.slug,
      isSuperAdmin: false,
    };
  } catch (error: any) {
    await tenantPool.end().catch(() => {});
    throw error;
  }
}

/**
 * Log SSO login attempt to tenant's sso_login_history table
 */
async function logSsoLogin(
  tenantSlug: string,
  user: any | null,
  userInfo: CognitoUserInfo | null,
  status: "success" | "failed",
  errorMessage?: string,
): Promise<void> {
  try {
    const tenantPool = await getTenantPoolBySlug(tenantSlug);
    if (!tenantPool) return;

    await tenantPool.query(
      `
      INSERT INTO sso_login_history 
        (user_id, user_email, user_name, provider, cognito_idp_name, status, error_message, idp_subject)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `,
      [
        user?.id || null,
        userInfo?.email || user?.email || "unknown",
        userInfo?.fullName || user?.full_name || null,
        "cognito_sso",
        userInfo?.idpName || null,
        status,
        errorMessage || null,
        userInfo?.sub || null,
      ],
    );

    await tenantPool.end();
  } catch (error: any) {
    logDebug("[CognitoAuth] Failed to log SSO login", { error: error.message });
  }
}

export default router;
