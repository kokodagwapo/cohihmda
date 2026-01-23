/**
 * Authentication Routes
 * 
 * Handles authentication for both:
 * - Super Admins (Cohi internal) - stored in coheus_management.coheus_users
 * - Tenant Users - stored in each tenant's database
 */

import { Router } from 'express';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { authLimiter } from '../middleware/rateLimiter.js';
import { auditLog, logFailedLogin, createSession, endSession, getRecentFailedLogins } from '../services/auditLogger.js';
import { logError, logWarn, logInfo, logDebug } from '../services/logger.js';
import crypto from 'crypto';

const { Pool } = pg;
const router = Router();

// User types for authentication
interface SuperAdminUser {
  id: string;
  email: string;
  encrypted_password: string;
  full_name: string | null;
  role: 'super_admin' | 'platform_admin' | 'support';
  is_active: boolean;
}

interface TenantUser {
  id: string;
  email: string;
  encrypted_password: string;
  full_name: string | null;
  role: 'tenant_admin' | 'admin' | 'user' | 'viewer' | 'loan_officer' | 'processor';
  is_active: boolean;
  tenant_id: string;
  tenant_name: string;
  tenant_slug: string;
}

type AuthUser = (SuperAdminUser & { tenant_id?: null; tenant_name?: null; tenant_slug?: null }) | TenantUser;

// JWT payload structure
interface JwtPayload {
  userId: string;
  email: string;
  role: string;
  tenantId?: string;
  tenantSlug?: string;
  isSuperAdmin: boolean;
}

// Database pools
let managementPool: pg.Pool | null = null;
const tenantPools: Map<string, pg.Pool> = new Map();

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
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });

    managementPool.on('error', (err: any) => {
      logError('[Auth] Management pool error', err, {});
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
      [tenantSlug]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const tenant = result.rows[0];
    const dbHost = tenant.database_host || '127.0.0.1';
    
    const pool = new Pool({
      host: dbHost === 'localhost' ? '127.0.0.1' : dbHost,
      port: tenant.database_port || 5432,
      database: tenant.database_name,
      user: tenant.database_user || process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || 'postgres', // TODO: Decrypt tenant password
      ssl: dbHost !== '127.0.0.1' && dbHost !== 'localhost' ? { rejectUnauthorized: false } : false,
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });

    tenantPools.set(tenantSlug, pool);
    return pool;
  } catch (error: any) {
    logError('[Auth] Failed to get tenant pool', error, { tenantSlug });
    return null;
  }
}

// Get JWT_SECRET lazily to allow dotenv to load first
function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET environment variable is required');
  }
  const trimmedSecret = secret.trim();
  if (trimmedSecret.length < 32) {
    throw new Error('JWT_SECRET must be at least 32 characters long');
  }
  return trimmedSecret;
}

// Validation schemas
const signInSchema = z.object({
  email: z.string().min(1, 'Email is required'),
  password: z.string().min(1, 'Password is required'),
  tenantSlug: z.string().optional(), // Optional - if not provided, check super admin first
});

const signUpSchema = z.object({
  email: z.string().email('Invalid email'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  fullName: z.string().optional(),
  tenantSlug: z.string().optional(),
});

/**
 * Find user in management DB (super admins)
 */
async function findSuperAdmin(email: string): Promise<SuperAdminUser | null> {
  try {
    const pool = getManagementPool();
    const result = await pool.query(
      `SELECT id, email, encrypted_password, full_name, role, is_active
       FROM coheus_users 
       WHERE email = $1`,
      [email]
    );
    
    if (result.rows.length === 0) {
      return null;
    }
    
    return result.rows[0] as SuperAdminUser;
  } catch (error: any) {
    logError('[Auth] Failed to find super admin', error, { email });
    return null;
  }
}

/**
 * Find user in a tenant's database
 */
async function findTenantUser(email: string, tenantSlug?: string): Promise<TenantUser | null> {
  try {
    const mgmtPool = getManagementPool();
    
    // If no tenant slug provided, search all active tenants
    let tenants: Array<{ id: string; slug: string; name: string; database_name: string }>;
    
    if (tenantSlug) {
      const result = await mgmtPool.query(
        `SELECT id, slug, name, database_name FROM coheus_tenants WHERE slug = $1 AND status = 'active'`,
        [tenantSlug]
      );
      tenants = result.rows;
    } else {
      // Search all tenants - in production, might want to limit this
      const result = await mgmtPool.query(
        `SELECT id, slug, name, database_name FROM coheus_tenants WHERE status = 'active' ORDER BY name`
      );
      tenants = result.rows;
    }

    // Search each tenant's database for the user
    for (const tenant of tenants) {
      const tenantPool = await getTenantPool(tenant.slug);
      if (!tenantPool) continue;

      try {
        const userResult = await tenantPool.query(
          `SELECT id, email, encrypted_password, full_name, role, is_active
           FROM users 
           WHERE email = $1`,
          [email]
        );

        if (userResult.rows.length > 0) {
          const user = userResult.rows[0];
          return {
            ...user,
            tenant_id: tenant.id,
            tenant_name: tenant.name,
            tenant_slug: tenant.slug,
          } as TenantUser;
        }
      } catch (error: any) {
        // Tenant DB might not have users table yet
        logDebug('[Auth] Tenant user lookup failed', { tenant: tenant.slug, error: error.message });
      }
    }

    return null;
  } catch (error: any) {
    logError('[Auth] Failed to find tenant user', error, { email, tenantSlug });
    return null;
  }
}

/**
 * Sign In
 */
router.post('/signin', authLimiter, async (req, res) => {
  try {
    const { email, password, tenantSlug } = signInSchema.parse(req.body);
    
    logInfo('[Auth] Sign in attempt', { email, tenantSlug: tenantSlug || 'auto-detect' });

    let user: AuthUser | null = null;
    let isSuperAdmin = false;

    // Strategy: Check super admin first (unless tenant slug is explicitly provided)
    if (!tenantSlug) {
      user = await findSuperAdmin(email);
      if (user) {
        isSuperAdmin = true;
        logDebug('[Auth] Found super admin', { email });
      }
    }

    // If not a super admin, check tenant users
    if (!user) {
      user = await findTenantUser(email, tenantSlug);
      if (user) {
        logDebug('[Auth] Found tenant user', { email, tenant: (user as TenantUser).tenant_slug });
      }
    }

    // User not found
    if (!user) {
      await logFailedLogin({
        email,
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
        failureReason: 'user_not_found',
      }).catch(() => {});
      
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Check if user is active
    if (!user.is_active) {
      await logFailedLogin({
        email,
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
        failureReason: 'user_inactive',
      }).catch(() => {});
      
      return res.status(401).json({ error: 'Account is disabled. Please contact your administrator.' });
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.encrypted_password);
    if (!isValidPassword) {
      await logFailedLogin({
        email,
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
        failureReason: 'invalid_password',
      }).catch(() => {});
      
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Generate JWT token
    const jwtPayload: JwtPayload = {
      userId: user.id,
      email: user.email,
      role: user.role,
      isSuperAdmin,
    };

    if (!isSuperAdmin && 'tenant_id' in user) {
      jwtPayload.tenantId = user.tenant_id;
      jwtPayload.tenantSlug = user.tenant_slug;
    }

    const token = jwt.sign(jwtPayload, getJwtSecret(), { expiresIn: '7d' });

    // Update last login
    try {
      if (isSuperAdmin) {
        const mgmtPool = getManagementPool();
        await mgmtPool.query(
          `UPDATE coheus_users SET last_login_at = NOW() WHERE id = $1`,
          [user.id]
        );
      } else if ('tenant_slug' in user) {
        const tenantPool = await getTenantPool(user.tenant_slug);
        if (tenantPool) {
          await tenantPool.query(
            `UPDATE users SET last_login_at = NOW() WHERE id = $1`,
            [user.id]
          );
        }
      }
    } catch (error) {
      // Non-critical, don't fail login
    }

    // Create session record
    try {
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      await createSession({
        userId: user.id,
        tenantId: 'tenant_id' in user ? user.tenant_id : null,
        tokenHash,
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      });
    } catch (error) {
      // Non-critical
    }

    // Audit log
    await auditLog({
      userId: user.id,
      userEmail: user.email,
      userRole: user.role,
      tenantId: 'tenant_id' in user ? user.tenant_id : null,
      action: 'login',
      resource: 'auth',
      description: `User logged in successfully${isSuperAdmin ? ' (super admin)' : ''}`,
      status: 'success',
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    }).catch(() => {});

    logInfo('[Auth] Sign in successful', { 
      email, 
      role: user.role, 
      isSuperAdmin,
      tenant: 'tenant_slug' in user ? user.tenant_slug : null 
    });

    // Return user info (without password)
    const responseUser = {
      id: user.id,
      email: user.email,
      full_name: user.full_name,
      role: user.role,
      is_super_admin: isSuperAdmin,
      tenant_id: 'tenant_id' in user ? user.tenant_id : null,
      tenant_name: 'tenant_name' in user ? user.tenant_name : null,
      tenant_slug: 'tenant_slug' in user ? user.tenant_slug : null,
    };

    return res.json({ user: responseUser, token });

  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0].message });
    }
    
    logError('[Auth] Sign in error', error, { email: req.body?.email });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Get Current User
 */
router.get('/me', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const decoded = jwt.verify(token, getJwtSecret()) as JwtPayload;

    // Fetch fresh user data
    let user: any = null;

    if (decoded.isSuperAdmin) {
      const mgmtPool = getManagementPool();
      const result = await mgmtPool.query(
        `SELECT id, email, full_name, role, is_active, last_login_at, created_at
         FROM coheus_users WHERE id = $1`,
        [decoded.userId]
      );
      if (result.rows.length > 0) {
        user = {
          ...result.rows[0],
          is_super_admin: true,
          tenant_id: null,
          tenant_name: null,
          tenant_slug: null,
        };
      }
    } else if (decoded.tenantSlug) {
      const tenantPool = await getTenantPool(decoded.tenantSlug);
      if (tenantPool) {
        const result = await tenantPool.query(
          `SELECT id, email, full_name, role, is_active, last_login_at, created_at
           FROM users WHERE id = $1`,
          [decoded.userId]
        );
        if (result.rows.length > 0) {
          // Get tenant info
          const mgmtPool = getManagementPool();
          const tenantResult = await mgmtPool.query(
            `SELECT id, name, slug FROM coheus_tenants WHERE slug = $1`,
            [decoded.tenantSlug]
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
      return res.status(404).json({ error: 'User not found' });
    }

    return res.json({ user });

  } catch (error: any) {
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
    logError('[Auth] /me error', error, {});
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Sign Out
 */
router.post('/signout', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    
    if (token) {
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      await endSession(tokenHash, 'manual').catch(() => {});

      try {
        const decoded = jwt.verify(token, getJwtSecret()) as JwtPayload;
        await auditLog({
          userId: decoded.userId,
          userEmail: decoded.email,
          userRole: decoded.role,
          tenantId: decoded.tenantId || null,
          action: 'logout',
          resource: 'auth',
          description: 'User logged out',
          status: 'success',
          ipAddress: req.ip,
          userAgent: req.get('user-agent'),
        }).catch(() => {});
      } catch (error) {
        // Token might be expired, that's okay
      }
    }

    return res.json({ message: 'Signed out successfully' });
  } catch (error) {
    return res.json({ message: 'Signed out successfully' });
  }
});

/**
 * List all tenants (for login dropdown - public endpoint)
 */
router.get('/tenants', async (req, res) => {
  try {
    const mgmtPool = getManagementPool();
    const result = await mgmtPool.query(
      `SELECT slug, name FROM coheus_tenants WHERE status = 'active' ORDER BY name`
    );
    
    return res.json({ tenants: result.rows });
  } catch (error: any) {
    logError('[Auth] Failed to list tenants', error, {});
    return res.json({ tenants: [] });
  }
});

export default router;
