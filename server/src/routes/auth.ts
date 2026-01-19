import { Router } from 'express';
import { pool, retryQuery } from '../config/database.js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { authLimiter } from '../middleware/rateLimiter.js';
import { auditLog, logFailedLogin, createSession, endSession, getRecentFailedLogins } from '../services/auditLogger.js';
import { logError, logWarn, logInfo, logDebug } from '../services/logger.js';
import crypto from 'crypto';

const router = Router();

type AuthUserRow = {
  id: string;
  email: string;
  encrypted_password: string;
  role: string;
  tenant_id: string | null;
};

// Get JWT_SECRET lazily to allow dotenv to load first
function getJwtSecret(): string {
  try {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      const error = new Error('JWT_SECRET environment variable is required');
      logError('JWT_SECRET missing', error, {
        nodeEnv: process.env.NODE_ENV,
        allEnvKeys: Object.keys(process.env).filter(k => k.includes('JWT') || k.includes('SECRET')),
      });
      throw error;
    }
    if (typeof secret !== 'string') {
      const error = new Error('JWT_SECRET must be a string');
      logError('JWT_SECRET wrong type', error, { 
        type: typeof secret,
        value: String(secret).substring(0, 10) + '...',
      });
      throw error;
    }
    // Check for whitespace issues (common when copying from AWS console)
    const trimmedSecret = secret.trim();
    if (trimmedSecret.length < 32) {
      const error = new Error('JWT_SECRET must be at least 32 characters long');
      logError('JWT_SECRET too short', error, { 
        secretLength: secret.length,
        trimmedLength: trimmedSecret.length,
        hasLeadingWhitespace: secret.length !== secret.trimStart().length,
        hasTrailingWhitespace: secret.length !== secret.trimEnd().length,
      });
      throw error;
    }
    
    // Warn if secret has internal whitespace (might be a copy-paste issue)
    if (/\s/.test(trimmedSecret)) {
      logWarn('JWT_SECRET contains whitespace - this may cause issues', {
        secretLength: trimmedSecret.length,
        hasInternalWhitespace: /\s/.test(trimmedSecret),
      });
    }
    
    return trimmedSecret;
  } catch (error: any) {
    // Re-throw with additional context
    logError('Error in getJwtSecret', error, {
      errorType: error?.constructor?.name,
      errorMessage: error?.message,
    });
    throw error;
  }
}

async function upsertDevEnvAdminUser(email: string, plainPassword: string): Promise<AuthUserRow> {
  const tenantName = 'Default';
  const fullName = 'Dev Admin';

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Ensure tenant exists (case-insensitive)
    const existingTenant = await client.query(
      'SELECT id FROM public.tenants WHERE LOWER(name) = LOWER($1) LIMIT 1',
      [tenantName]
    );

    let tenantId: string;
    if (existingTenant.rows.length > 0) {
      tenantId = existingTenant.rows[0].id;
    } else {
      const createdTenant = await client.query(
        `INSERT INTO public.tenants (name, created_at, updated_at)
         VALUES ($1, NOW(), NOW())
         RETURNING id`,
        [tenantName]
      );
      tenantId = createdTenant.rows[0].id;
    }

    // bcrypt hash required (public.users.encrypted_password is NOT NULL)
    const passwordHash = await bcrypt.hash(plainPassword, 10);

    const userResult = await client.query(
      `INSERT INTO public.users (email, encrypted_password, full_name, role, is_active, tenant_id, created_at, updated_at)
       VALUES ($1, $2, $3, 'admin', true, $4, NOW(), NOW())
       ON CONFLICT (email) DO UPDATE SET
         encrypted_password = EXCLUDED.encrypted_password,
         full_name = EXCLUDED.full_name,
         role = 'admin',
         is_active = true,
         tenant_id = EXCLUDED.tenant_id,
         updated_at = NOW()
       RETURNING id, email, encrypted_password, role, tenant_id`,
      [email, passwordHash, fullName, tenantId]
    );

    const user = userResult.rows[0] as AuthUserRow;

    // Best-effort profile upsert (don't fail login if profiles table missing)
    try {
      const existingProfile = await client.query(
        'SELECT id FROM public.profiles WHERE user_id = $1 LIMIT 1',
        [user.id]
      );

      if (existingProfile.rows.length > 0) {
        await client.query(
          `UPDATE public.profiles
           SET full_name = $2, tenant_id = $3, updated_at = NOW()
           WHERE user_id = $1`,
          [user.id, fullName, tenantId]
        );
      } else {
        await client.query(
          `INSERT INTO public.profiles (user_id, full_name, tenant_id, created_at, updated_at)
           VALUES ($1, $2, $3, NOW(), NOW())`,
          [user.id, fullName, tenantId]
        );
      }
    } catch (profileError: any) {
      logWarn('Dev env login: failed to upsert profile (non-fatal)', {
        email,
        errorMessage: profileError?.message,
        errorCode: profileError?.code,
      });
    }

    await client.query('COMMIT');
    return user;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // ignore rollback failures
    }
    throw error;
  } finally {
    client.release();
  }
}

const signUpSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  full_name: z.string().optional()
});

const signInSchema = z.object({
  email: z.string().email(),
  password: z.string()
});

// Sign up (with rate limiting)
router.post('/signup', authLimiter, async (req, res) => {
  try {
    const { email, password, full_name } = signUpSchema.parse(req.body);
    
    // Check if user exists
    const existingUser = await pool.query(
      'SELECT id FROM public.users WHERE email = $1',
      [email]
    );
    
    if (existingUser.rows.length > 0) {
      return res.status(400).json({ error: 'User already exists' });
    }
    
    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);
    
    // Create user
    const userResult = await pool.query(
      `INSERT INTO public.users (email, encrypted_password, created_at, updated_at)
       VALUES ($1, $2, NOW(), NOW())
       RETURNING id, email`,
      [email, hashedPassword]
    );
    
    const user = userResult.rows[0];
    
    // Create profile if full_name provided
    if (full_name) {
      await pool.query(
        `INSERT INTO public.profiles (user_id, full_name, created_at)
         VALUES ($1, $2, NOW())`,
        [user.id, full_name]
      );
    }
    
    const token = jwt.sign({ userId: user.id, email: user.email }, getJwtSecret(), { expiresIn: '7d' });
    
    res.json({ user, token });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0].message });
    }
    logError('Signup error', error, { email: req.body?.email });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Sign in (with rate limiting)
// Note: authLimiter is applied, but we also check database for failed attempts
router.post('/signin', authLimiter, async (req, res) => {
  // Ensure we always send a response, even if something goes wrong
  let responseSent = false;
  const safeSend = (status: number, data: any) => {
    if (!responseSent && !res.headersSent) {
      responseSent = true;
      try {
        return res.status(status).json(data);
      } catch (sendError) {
        logError('Error sending response in safeSend', sendError, { status, attemptedData: data });
        return null;
      }
    }
    return null;
  };

  // Log environment state (without exposing secrets)
  const envState = {
    hasJwtSecret: !!process.env.JWT_SECRET,
    jwtSecretLength: process.env.JWT_SECRET?.length || 0,
    jwtSecretFirstChar: process.env.JWT_SECRET ? process.env.JWT_SECRET[0] : undefined,
    jwtSecretLastChar: process.env.JWT_SECRET ? process.env.JWT_SECRET[process.env.JWT_SECRET.length - 1] : undefined,
    hasDbHost: !!process.env.DB_HOST,
    hasDbName: !!process.env.DB_NAME,
    hasDbUser: !!process.env.DB_USER,
    hasDbPassword: !!process.env.DB_PASSWORD,
    nodeEnv: process.env.NODE_ENV,
    isAws: !!process.env.AWS_REGION || !!process.env.ELASTIC_BEANSTALK_ENVIRONMENT,
    // Check for common environment variable issues
    jwtSecretHasWhitespace: process.env.JWT_SECRET ? /\s/.test(process.env.JWT_SECRET) : undefined,
  };

  try {
    // Log that we received the request with environment diagnostics
    logInfo('Signin endpoint called', { 
      method: req.method, 
      path: req.path,
      hasBody: !!req.body,
      bodyKeys: req.body ? Object.keys(req.body) : [],
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
      envState,
    });

    // Validate request body exists and is an object
    if (!req.body) {
      logError('Signin request missing body', undefined, { 
        ipAddress: req.ip,
        contentType: req.get('content-type'),
        contentLength: req.get('content-length'),
      });
      return safeSend(400, { error: 'Request body is required' });
    }
    
    if (typeof req.body !== 'object' || Array.isArray(req.body)) {
      logError('Signin request body is not an object', undefined, {
        ipAddress: req.ip,
        bodyType: typeof req.body,
        isArray: Array.isArray(req.body),
        bodyValue: JSON.stringify(req.body).substring(0, 200),
      });
      return safeSend(400, { error: 'Request body must be a JSON object' });
    }

    // Validate and parse request body
    let email: string;
    let password: string;
    try {
      const parsed = signInSchema.parse(req.body);
      email = parsed.email;
      password = parsed.password;
      logDebug('Signin request received', { email, ipAddress: req.ip });
    } catch (parseError: any) {
      logError('Signin request validation failed', parseError, {
        body: req.body,
        bodyType: typeof req.body,
        bodyKeys: req.body ? Object.keys(req.body) : [],
        ipAddress: req.ip,
      });
      if (parseError instanceof z.ZodError) {
        return safeSend(400, { error: parseError.errors[0].message });
      }
      return safeSend(400, { error: 'Invalid request body format' });
    }
    
    // Optional dev-only login via Elastic Beanstalk environment properties (explicitly enabled)
    const devEnvLoginEnabled =
      process.env.NODE_ENV !== 'production' && process.env.ENABLE_DEV_ENV_LOGIN === 'true';

    const envUserName = process.env.USER_NAME_DEV?.trim();
    const envPassword = process.env.USER_PWD_DEV;

    if (devEnvLoginEnabled && (!envUserName || !envPassword)) {
      logWarn('Dev env login enabled but USER_NAME_DEV/USER_PWD_DEV not set', {
        hasUserName: !!envUserName,
        hasUserPwd: !!envPassword,
      });
    }

    let user: AuthUserRow | null = null;
    let passwordVerified = false;
    let authMode: 'db' | 'dev_env' = 'db';

    if (devEnvLoginEnabled && envUserName && envPassword && email === envUserName && password === envPassword) {
      authMode = 'dev_env';
      passwordVerified = true; // validated by matching env vars
      try {
        logInfo('Dev env login matched USER_NAME_DEV/USER_PWD_DEV; bootstrapping admin user', {
          email,
          ipAddress: req.ip,
        });
        user = await upsertDevEnvAdminUser(email, password);
      } catch (devEnvError: any) {
        logError('Dev env login bootstrap failed', devEnvError, {
          email,
          errorMessage: devEnvError?.message,
          errorCode: devEnvError?.code,
        });
        return safeSend(500, { error: 'Failed to initialize dev environment login' });
      }
    }

    // Bypass rate limiting for admin emails (for emergency access) and dev env login
    const isAdminEmail = email === 'admin@ailethia.com' || authMode === 'dev_env';
    
    // Check for too many failed login attempts (rate limiting)
    // Skip this check for admin emails to allow emergency access
    if (!isAdminEmail) {
      try {
        logDebug('Checking rate limits', { email });
        const recentFailures = await getRecentFailedLogins(email, 15);
        logDebug('Rate limit check result', { email, recentFailures });
        if (recentFailures >= 5) {
          await logFailedLogin({
            email,
            ipAddress: req.ip,
            userAgent: req.get('user-agent'),
            failureReason: 'rate_limited',
          });
          return safeSend(429, { error: 'Too many failed login attempts. Please try again in 15 minutes.' });
        }
      } catch (rateLimitError: any) {
        // If rate limiting table doesn't exist yet, just log and continue
        logWarn('Rate limiting check failed (table may not exist)', { 
          email, 
          error: rateLimitError?.message,
          errorCode: rateLimitError?.code,
          errorType: rateLimitError?.constructor?.name,
        });
      }
    }
    
    if (!passwordVerified) {
      // Use retryQuery helper for database connection resilience
      let result;
      try {
        logDebug('Attempting to query user', { email });
        // Check if pool is initialized
        if (!pool) {
          logError('Database pool is not initialized', undefined, { email });
          return safeSend(503, { 
            error: 'Database connection not available. Please try again in a moment.',
            retry: true
          });
        }
        
        result = await retryQuery(
          () => pool.query(
            // Query public.users - simplified query
            `SELECT 
              u.id, 
              u.email, 
              u.encrypted_password, 
              u.role, 
              COALESCE(u.tenant_id, p.tenant_id) as tenant_id 
            FROM public.users u 
            LEFT JOIN public.profiles p ON u.id = p.user_id 
            WHERE u.email = $1`,
            [email]
          ),
          3, // max retries
          1000 // delay between retries
        );
        logDebug('Query successful', { email, userCount: result.rows.length });
      } catch (dbError: any) {
        logError('Database query failed', dbError, {
          email,
          errorType: dbError?.constructor?.name,
          errorCode: dbError?.code,
          errorDetail: dbError?.detail,
        });
        
        const isConnectionError = 
          dbError?.message?.includes('timeout') ||
          dbError?.message?.includes('ECONNREFUSED') ||
          dbError?.message?.includes('connection') ||
          dbError?.code === 'ETIMEDOUT' ||
          dbError?.code === 'ECONNREFUSED';
        
        if (isConnectionError) {
          logError('Database connection error during signin after retries', dbError, { email });
          return safeSend(503, { 
            error: 'Service temporarily unavailable. Database connection failed. Please try again in a moment.',
            retry: true
          });
        }
        
        // Check if table doesn't exist
        if (dbError?.message?.includes('does not exist') || dbError?.code === '42P01') {
          logError('Table public.users does not exist. Please run database migrations.', dbError, { email });
          return safeSend(503, { 
            error: 'Database not initialized. Please restart the server to run migrations.',
            retry: false
          });
        }
        
        // Re-throw to be caught by outer catch
        throw dbError;
      }
      
      if (result.rows.length === 0) {
        await logFailedLogin({
          email,
          ipAddress: req.ip,
          userAgent: req.get('user-agent'),
          failureReason: 'user_not_found',
        });
        return safeSend(401, { error: 'Invalid email or password' });
      }
      
      user = result.rows[0] as AuthUserRow;
      
      // Check if password hash exists
      if (!user.encrypted_password) {
        logError('User found but no password hash', undefined, { email, userId: user.id });
        await logFailedLogin({
          email,
          ipAddress: req.ip,
          userAgent: req.get('user-agent'),
          failureReason: 'invalid_password',
        });
        return safeSend(401, { error: 'Invalid email or password' });
      }
      
      const isValid = await bcrypt.compare(password, user.encrypted_password);
      
      if (!isValid) {
        await logFailedLogin({
          email,
          ipAddress: req.ip,
          userAgent: req.get('user-agent'),
          failureReason: 'invalid_password',
        });
        return safeSend(401, { error: 'Invalid email or password' });
      }

      passwordVerified = true;
    }

    if (!user) {
      logError('Signin: user is missing after verification', undefined, { email, authMode });
      return safeSend(500, { error: 'Internal server error. Please try again.' });
    }
    
    // Generate JWT token
    let token;
    try {
      logDebug('Generating JWT token', { email, userId: user.id, authMode });
      const jwtSecret = getJwtSecret();
      if (!jwtSecret || jwtSecret.length < 32) {
        logError('JWT_SECRET is missing or too short', undefined, { 
          email, 
          userId: user.id,
          secretLength: jwtSecret?.length || 0,
          hasSecret: !!jwtSecret,
        });
        return safeSend(500, { error: 'Server configuration error. Please contact support.' });
      }
      logDebug('JWT_SECRET validated', { email, secretLength: jwtSecret.length });
      token = jwt.sign({ userId: user.id, email: user.email }, jwtSecret, { expiresIn: '7d' });
      logDebug('JWT token generated successfully', { email, userId: user.id, tokenLength: token.length });
    } catch (jwtError: any) {
      logError('JWT signing error', jwtError, { 
        email, 
        userId: user.id,
        errorType: jwtError?.constructor?.name,
        errorMessage: jwtError?.message,
        errorStack: jwtError?.stack,
      });
      // Check if it's a missing secret error
      if (jwtError.message?.includes('JWT_SECRET') || jwtError.message?.includes('required')) {
        return safeSend(500, { error: 'Server configuration error. Please contact support.' });
      }
      return safeSend(500, { error: 'Failed to generate authentication token' });
    }
    
    // Create session record (SOC 2 requirement) - don't block on errors
    try {
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
      
      await createSession({
        userId: user.id,
        tenantId: user.tenant_id || null,
        tokenHash,
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
        expiresAt,
      });
    } catch (sessionError: any) {
      // Log but don't fail - session creation is not critical for login
      logWarn('Session creation failed (non-critical)', { email, userId: user.id, error: sessionError?.message });
    }
    
    // Log successful login - don't block on errors
    try {
      await auditLog({
        userId: user.id,
        userEmail: user.email,
        userRole: user.role,
        tenantId: user.tenant_id || null,
        action: 'login',
        resource: 'auth',
        description: 'User logged in successfully',
        status: 'success',
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
      });
    } catch (auditError: any) {
      // Log but don't fail - audit logging is not critical for login
      logWarn('Audit logging failed (non-critical)', { email, userId: user.id, error: auditError?.message });
    }
    
    // Ensure we have a token before sending response
    if (!token) {
      logError('Token is missing after generation', undefined, { email, userId: user.id });
      return safeSend(500, { error: 'Failed to generate authentication token' });
    }
    
    return safeSend(200, { user: { id: user.id, email: user.email }, token });
  } catch (error: any) {
    // Log the error with full context
    logError('Signin error', error, {
      email: req.body?.email,
      errorType: error?.constructor?.name,
      errorCode: error?.code,
      errorDetail: error?.detail,
      errorMessage: error?.message,
      errorStack: error?.stack,
    });
    
    // If response already sent, don't try to send another
    if (responseSent || res.headersSent) {
      logWarn('Response already sent, cannot send error response', { email: req.body?.email });
      return;
    }
    
    // Handle Zod validation errors
    if (error instanceof z.ZodError) {
      return safeSend(400, { error: error.errors[0].message });
    }
    
    // Handle JWT_SECRET errors
    if (error.message?.includes('JWT_SECRET') || 
        error.message?.includes('required') ||
        error.message?.includes('at least 32 characters')) {
      logError('JWT_SECRET configuration error during signin', error, { email: req.body?.email });
      return safeSend(500, { 
        error: 'Server configuration error. Please contact support.',
        retry: false
      });
    }
    
    // Handle database connection errors
    if (error.message === 'DATABASE_CONNECTION_ERROR' ||
        error.message?.includes('password authentication failed') ||
        error.message?.includes('connection') ||
        error.code === 'ECONNREFUSED' ||
        error.code === 'ETIMEDOUT') {
      logError('Database connection error during signin', error, { email: req.body?.email });
      return safeSend(503, { 
        error: 'Service temporarily unavailable. Database connection failed. Please try again in a moment.',
        retry: true
      });
    }
    
    // Handle missing table error
    if (error.message?.includes('DATABASE_TABLE_MISSING') || 
        error.message?.includes('does not exist') ||
        error.code === '42P01') {
      logError('Database table missing during signin', error, { email: req.body?.email });
      return safeSend(503, { 
        error: 'Database not initialized. Please restart the server to run migrations.',
        retry: false
      });
    }
    
    // Check if it's already a response error
    if (error.status) {
      return safeSend(error.status, { error: error.message });
    }
    
    // Return user-friendly error (don't expose stack traces in production)
    const errorResponse: any = { 
      error: 'Internal server error. Please try again.'
    };
    
    if (process.env.NODE_ENV === 'development') {
      errorResponse.details = error?.message;
      errorResponse.code = error?.code;
      if (error?.stack) {
        errorResponse.stack = error.stack.split('\n').slice(0, 5).join('\n'); // First 5 lines only
      }
    }
    
    // Final attempt to send error response
    try {
      return safeSend(500, errorResponse);
    } catch (sendError) {
      logError('Failed to send error response after all attempts', sendError, { 
        email: req.body?.email,
        originalError: error?.message,
        sendErrorType: sendError?.constructor?.name,
        sendErrorMessage: sendError?.message,
      });
      // If we still can't send, at least try to end the response
      if (!res.headersSent) {
        try {
          res.status(500).end();
        } catch (finalError: any) {
          logError('Completely failed to send any response', finalError, { 
            email: req.body?.email,
            finalErrorType: finalError?.constructor?.name,
            finalErrorMessage: finalError?.message,
          });
        }
      }
    }
  }
});

// Get current user
router.get('/me', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    const decoded = jwt.verify(token, getJwtSecret()) as { userId: string; email: string };
    
      // Try to get user from database with timeout handling
      try {
        const result = await retryQuery(
          () => pool.query(
            `SELECT u.id, u.email, u.role, p.full_name, p.avatar_url, p.tenant_id
             FROM public.users u
             LEFT JOIN public.profiles p ON u.id = p.user_id
             WHERE u.id = $1`,
            [decoded.userId]
          ),
          2, // max retries
          500 // delay between retries
        );
        
        if (result.rows.length === 0) {
          return res.status(404).json({ error: 'User not found' });
        }
        
        res.json({ user: result.rows[0] });
    } catch (dbError: any) {
      // If database query fails, return user info from token (degraded mode)
      logWarn('Database query failed for /me, returning token-based user info', { userId: decoded.userId, error: dbError.message });
      res.json({ 
        user: { 
          id: decoded.userId, 
          email: decoded.email,
          // Note: full_name, avatar_url, tenant_id may be unavailable
        } 
      });
    }
  } catch (error: any) {
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Invalid token' });
    }
    logError('Error in /me endpoint', error, {});
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Sign out (with session tracking)
router.post('/signout', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    
    if (token) {
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      
      // End session
      await endSession(tokenHash, 'manual');
      
      // Try to decode token for audit log
      try {
        const decoded = jwt.verify(token, getJwtSecret()) as { userId: string; email: string };
        
        // Get user details for audit log
        const userResult = await pool.query(
          'SELECT u.role, p.tenant_id FROM public.users u LEFT JOIN public.profiles p ON u.id = p.user_id WHERE u.id = $1',
          [decoded.userId]
        );
        
        if (userResult.rows.length > 0) {
          await auditLog({
            userId: decoded.userId,
            userEmail: decoded.email,
            userRole: userResult.rows[0].role,
            tenantId: userResult.rows[0].tenant_id || null,
            action: 'logout',
            resource: 'auth',
            description: 'User logged out',
            status: 'success',
            ipAddress: req.ip,
            userAgent: req.get('user-agent'),
          });
        }
      } catch (error) {
        // Token might be expired or invalid, that's okay
      }
    }
    
    res.json({ message: 'Signed out successfully' });
  } catch (error) {
    logError('Signout error', error, {});
    res.json({ message: 'Signed out successfully' }); // Always return success for signout
  }
});

export default router;

