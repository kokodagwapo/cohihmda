/**
 * User Preferences API Routes
 * Handles user preference storage and retrieval, and password change.
 */

import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { z } from 'zod';
import { retryQuery, isDatabaseConnectionError, handleDatabaseError } from '../config/database.js';
import { pool as managementPool } from '../config/managementDatabase.js';
import { tenantDbManager } from '../config/tenantDatabaseManager.js';
import { authenticateToken, AuthRequest } from '../middleware/auth.js';
import { auditLog } from '../services/auditLogger.js';
import { logError, logInfo } from '../services/logger.js';

const router = Router();

/**
 * GET /api/user/preferences
 * Get all user preferences
 */
router.get('/preferences', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const result = await retryQuery(
      () => managementPool.query(
        `SELECT preference_key, preference_value 
         FROM user_preferences 
         WHERE user_id = $1`,
        [userId]
      ),
      3,
      1000
    );

    const preferences: Record<string, any> = {};
    result.rows.forEach((row: any) => {
      preferences[row.preference_key] = row.preference_value;
    });

    res.json({ preferences });
  } catch (error: any) {
    console.error('Error fetching user preferences:', error);
    console.error('Error details:', {
      message: error.message,
      code: error.code,
      detail: error.detail,
      hint: error.hint,
      table: error.table
    });
    
    // Handle database connection errors
    if (handleDatabaseError(error, res, 'Failed to fetch user preferences')) {
      return;
    }
    
    res.status(500).json({ 
      error: 'Failed to fetch user preferences',
      message: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * GET /api/user/preferences/:key
 * Get a specific user preference
 */
router.get('/preferences/:key', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId;
    const { key } = req.params;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const result = await retryQuery(
      () => managementPool.query(
        `SELECT preference_value 
         FROM user_preferences 
         WHERE user_id = $1 AND preference_key = $2`,
        [userId, key]
      ),
      3,
      1000
    );

    if (result.rows.length === 0) {
      // Return empty response instead of 404 - client will handle missing preference gracefully
      return res.json({ 
        preference_key: key,
        preference_value: null 
      });
    }

    // JSONB is already parsed by PostgreSQL, return as-is
    res.json({ 
      preference_key: key,
      preference_value: result.rows[0].preference_value 
    });
  } catch (error: any) {
    console.error('Error fetching user preference:', error);
    console.error('Error details:', {
      message: error.message,
      code: error.code,
      detail: error.detail,
      hint: error.hint
    });
    
    // Handle database connection errors
    if (handleDatabaseError(error, res, 'Failed to fetch user preference')) {
      return;
    }
    
    res.status(500).json({ 
      error: 'Failed to fetch user preference',
      message: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * PUT /api/user/preferences/:key
 * Update or create a user preference
 */
router.put('/preferences/:key', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId;
    const { key } = req.params;
    const { preference_value } = req.body;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // For JSONB columns, node-postgres expects a JSON string
    // Convert to JSON string if it's an object
    const jsonValue = typeof preference_value === 'string' 
      ? preference_value 
      : JSON.stringify(preference_value);

    await retryQuery(
      () => managementPool.query(
        `INSERT INTO user_preferences (user_id, preference_key, preference_value)
         VALUES ($1, $2, $3::jsonb)
         ON CONFLICT (user_id, preference_key)
         DO UPDATE SET preference_value = $3::jsonb, updated_at = NOW()`,
        [userId, key, jsonValue]
      ),
      3,
      1000
    );

    res.json({ success: true });
  } catch (error: any) {
    console.error('Error updating user preference:', error);
    console.error('Error details:', {
      message: error.message,
      code: error.code,
      detail: error.detail,
      hint: error.hint
    });
    
    // Handle database connection errors
    if (handleDatabaseError(error, res, 'Failed to update user preference')) {
      return;
    }
    
    res.status(500).json({ 
      error: 'Failed to update user preference',
      message: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// -----------------------------------------------------------------------------
// Unified Email Preferences (Notification Hub)
// Schema: emailPreferences = { dailyBrief: { enabled, frequency, deliveryHour, email, sections, newsSourceFilter }, alerts: {...}, unsubscribeToken }
// -----------------------------------------------------------------------------

const DEFAULT_DAILY_BRIEF_SECTIONS = {
  marketSnapshot: true,
  industryNews: true,
  pipelineDigest: false,
  researchUpdates: false,
  trackedMetrics: false,
};

const DEFAULT_EMAIL_PREFERENCES = {
  dailyBrief: {
    enabled: false,
    frequency: 'weekdays',
    deliveryHour: 8,
    email: '',
    sections: DEFAULT_DAILY_BRIEF_SECTIONS,
    newsSourceFilter: [] as string[],
  },
  alerts: {
    criticalInsights: false,
    researchComplete: false,
    trackedMetricBreach: false,
  },
  releaseNotes: {
    enabled: true,
  },
  unsubscribeToken: null as string | null,
};

/**
 * GET /api/user/email-preferences
 * Returns unified email preferences, merging from legacy dailyBriefEmailSubscription if needed.
 */
router.get('/email-preferences', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId;
    const userEmail = req.userEmail || '';
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const prefResult = await retryQuery(
      () => managementPool.query(
        `SELECT preference_value FROM user_preferences WHERE user_id = $1 AND preference_key = 'emailPreferences' LIMIT 1`,
        [userId]
      ),
      3,
      1000
    );
    const emailPrefs = prefResult.rows[0]?.preference_value as Record<string, unknown> | undefined;

    if (emailPrefs && typeof emailPrefs === 'object') {
      const merged = {
        ...DEFAULT_EMAIL_PREFERENCES,
        ...emailPrefs,
        dailyBrief: {
          ...DEFAULT_EMAIL_PREFERENCES.dailyBrief,
          ...(typeof (emailPrefs as any).dailyBrief === 'object' ? (emailPrefs as any).dailyBrief : {}),
          sections: {
            ...DEFAULT_DAILY_BRIEF_SECTIONS,
            ...(typeof (emailPrefs as any).dailyBrief?.sections === 'object' ? (emailPrefs as any).dailyBrief.sections : {}),
          },
        },
        alerts: {
          ...DEFAULT_EMAIL_PREFERENCES.alerts,
          ...(typeof (emailPrefs as any).alerts === 'object' ? (emailPrefs as any).alerts : {}),
        },
        releaseNotes: {
          ...DEFAULT_EMAIL_PREFERENCES.releaseNotes,
          ...(typeof (emailPrefs as any).releaseNotes === 'object' ? (emailPrefs as any).releaseNotes : {}),
        },
      };
      if (!merged.dailyBrief.email && userEmail) merged.dailyBrief.email = userEmail;
      return res.json(merged);
    }

    const legacyResult = await retryQuery(
      () => managementPool.query(
        `SELECT preference_value FROM user_preferences WHERE user_id = $1 AND preference_key = 'dailyBriefEmailSubscription' LIMIT 1`,
        [userId]
      ),
      3,
      1000
    );
    const legacy = legacyResult.rows[0]?.preference_value as { enabled?: boolean; email?: string } | undefined;
    const migrated = {
      ...DEFAULT_EMAIL_PREFERENCES,
      dailyBrief: {
        ...DEFAULT_EMAIL_PREFERENCES.dailyBrief,
        enabled: Boolean(legacy?.enabled),
        email: (legacy?.email || userEmail || '').trim(),
      },
    };
    return res.json(migrated);
  } catch (error: any) {
    console.error('Error fetching email preferences:', error);
    if (handleDatabaseError(error, res, 'Failed to fetch email preferences')) return;
    res.status(500).json({ error: 'Failed to fetch email preferences' });
  }
});

/**
 * PUT /api/user/email-preferences
 * Save unified email preferences. Generates unsubscribeToken when daily brief is first enabled.
 */
router.put('/email-preferences', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId;
    const userEmail = req.userEmail || '';
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const body = req.body as Record<string, unknown>;
    const dailyBrief = body?.dailyBrief as Record<string, unknown> | undefined;
    const releaseNotes = body?.releaseNotes as Record<string, unknown> | undefined;
    const email = String((dailyBrief?.email ?? userEmail) || '').trim();
    if (!email || !email.includes('@')) {
      return res.status(400).json({ error: 'A valid email is required for the daily brief' });
    }

    const existing = await retryQuery(
      () => managementPool.query(
        `SELECT preference_value FROM user_preferences WHERE user_id = $1 AND preference_key = 'emailPreferences' LIMIT 1`,
        [userId]
      ),
      3,
      1000
    );
    const current = (existing.rows[0]?.preference_value as Record<string, unknown>) || {};
    let unsubscribeToken = (current as any).unsubscribeToken as string | null;
    const enablingDailyBrief = Boolean(dailyBrief?.enabled) && !(current as any).dailyBrief?.enabled;
    const enablingReleaseNotes = Boolean(releaseNotes?.enabled) && !(current as any).releaseNotes?.enabled;
    const enabling = enablingDailyBrief || enablingReleaseNotes;
    if (enabling && !unsubscribeToken) {
      unsubscribeToken = crypto.randomUUID();
    }

    const value = {
      ...DEFAULT_EMAIL_PREFERENCES,
      ...body,
      dailyBrief: {
        ...DEFAULT_EMAIL_PREFERENCES.dailyBrief,
        ...(typeof dailyBrief === 'object' ? dailyBrief : {}),
        email,
        sections: {
          ...DEFAULT_DAILY_BRIEF_SECTIONS,
          ...(typeof (dailyBrief as any)?.sections === 'object' ? (dailyBrief as any).sections : {}),
        },
      },
      alerts: {
        ...DEFAULT_EMAIL_PREFERENCES.alerts,
        ...(typeof body?.alerts === 'object' ? body.alerts : {}),
      },
      releaseNotes: {
        ...DEFAULT_EMAIL_PREFERENCES.releaseNotes,
        ...(typeof releaseNotes === 'object' ? releaseNotes : {}),
      },
      unsubscribeToken: unsubscribeToken ?? (current as any).unsubscribeToken ?? null,
    };

    await retryQuery(
      () => managementPool.query(
        `INSERT INTO user_preferences (user_id, preference_key, preference_value)
         VALUES ($1, 'emailPreferences', $2::jsonb)
         ON CONFLICT (user_id, preference_key)
         DO UPDATE SET preference_value = $2::jsonb, updated_at = NOW()`,
        [userId, JSON.stringify(value)]
      ),
      3,
      1000
    );

    res.json({ success: true, preference_value: value });
  } catch (error: any) {
    console.error('Error saving email preferences:', error);
    if (handleDatabaseError(error, res, 'Failed to save email preferences')) return;
    res.status(500).json({ error: 'Failed to save email preferences' });
  }
});

/**
 * GET /api/user/profile
 * Get user profile
 */
router.get('/profile', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Try tenant database first if user has tenant context, fall back to management DB
    let profile = null;
    if (req.tenantId) {
      try {
        const tenantPool = await tenantDbManager.getTenantPool(req.tenantId);
        const result = await tenantPool.query(
          `SELECT p.*, u.email
           FROM profiles p
           JOIN users u ON p.user_id = u.id
           WHERE p.user_id = $1`,
          [userId]
        );
        if (result.rows.length > 0) {
          profile = result.rows[0];
        }
      } catch (e) {
        // Fall through to management DB
      }
    }
    
    if (!profile) {
      // Fall back to management DB (super admins or missing tenant context)
      const result = await managementPool.query(
        `SELECT id, email, full_name, role, created_at, updated_at
         FROM coheus_users
         WHERE id = $1`,
        [userId]
      );
      if (result.rows.length > 0) {
        profile = result.rows[0];
      }
    }

    if (!profile) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    res.json(profile);
  } catch (error: any) {
    console.error('Error fetching user profile:', error);
    
    // Handle database connection errors
    if (handleDatabaseError(error, res, 'Failed to fetch user profile')) {
      return;
    }
    
    res.status(500).json({ error: 'Failed to fetch user profile' });
  }
});

/**
 * PUT /api/user/profile
 * Update user profile
 */
router.put('/profile', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId;
    const { full_name, email } = req.body;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Update in tenant DB if user has tenant context, else management DB
    if (req.tenantId) {
      const tenantPool = await tenantDbManager.getTenantPool(req.tenantId);
      await tenantPool.query(
        `UPDATE profiles SET full_name = $1, updated_at = NOW() WHERE user_id = $2`,
        [full_name, userId]
      );
      if (email) {
        await tenantPool.query(
          `UPDATE users SET email = $1, updated_at = NOW() WHERE id = $2`,
          [email, userId]
        );
      }
    } else {
      // Super admin -- update in management DB
      await managementPool.query(
        `UPDATE coheus_users SET full_name = $1, updated_at = NOW() WHERE id = $2`,
        [full_name, userId]
      );
      if (email) {
        await managementPool.query(
          `UPDATE coheus_users SET email = $1, updated_at = NOW() WHERE id = $2`,
          [email, userId]
        );
      }
    }

    res.json({ success: true });
  } catch (error: any) {
    console.error('Error updating user profile:', error);
    
    // Handle database connection errors
    if (handleDatabaseError(error, res, 'Failed to update user profile')) {
      return;
    }
    
    res.status(500).json({ error: 'Failed to update user profile' });
  }
});

// =============================================================================
// PASSWORD CHANGE (authenticated users only)
// =============================================================================

const passwordChangeSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z.string().min(8, 'New password must be at least 8 characters'),
});

/**
 * PUT /api/user/password
 * Change the authenticated user's password.
 * Only available for password-based auth (rejected for SSO-only users).
 */
router.put('/password', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId;
    const isSuperAdmin = req.isSuperAdmin;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Reject if authenticated via SSO (JWT has authMethod field set by cognitoAuth.ts)
    const authHeader = req.headers['authorization'];
    const token = authHeader?.split(' ')[1];
    if (token) {
      try {
        const jwt = await import('jsonwebtoken');
        const decoded = jwt.default.decode(token) as any;
        if (decoded?.authMethod === 'cognito_sso') {
          return res.status(403).json({
            error: 'Password change is not available for SSO users. Your password is managed by your identity provider.',
          });
        }
      } catch {
        // Ignore decode errors -- proceed with password change
      }
    }

    const { currentPassword, newPassword } = passwordChangeSchema.parse(req.body);

    if (currentPassword === newPassword) {
      return res.status(400).json({ error: 'New password must be different from current password' });
    }

    let updated = false;

    if (isSuperAdmin) {
      // Super admin -- update in management database
      const { pool: managementPool } = await import('../config/managementDatabase.js');
      if (!managementPool) {
        return res.status(500).json({ error: 'Management database not available' });
      }

      const userResult = await managementPool.query(
        `SELECT encrypted_password FROM coheus_users WHERE id = $1 AND is_active = true`,
        [userId]
      );

      if (userResult.rows.length === 0) {
        return res.status(404).json({ error: 'User not found' });
      }

      const isValid = await bcrypt.compare(currentPassword, userResult.rows[0].encrypted_password);
      if (!isValid) {
        return res.status(401).json({ error: 'Current password is incorrect' });
      }

      const hashedPassword = await bcrypt.hash(newPassword, 12);
      await managementPool.query(
        `UPDATE coheus_users 
         SET encrypted_password = $1, password_changed_at = NOW(), failed_login_attempts = 0, locked_until = NULL
         WHERE id = $2`,
        [hashedPassword, userId]
      );
      updated = true;
    } else if (req.tenantId) {
      // Tenant user -- update in tenant database
      const tenantPool = await tenantDbManager.getTenantPool(req.tenantId);
      const userResult = await tenantPool.query(
        `SELECT encrypted_password FROM users WHERE id = $1 AND is_active = true`,
        [userId]
      );

      if (userResult.rows.length === 0) {
        return res.status(404).json({ error: 'User not found' });
      }

      const isValid = await bcrypt.compare(currentPassword, userResult.rows[0].encrypted_password);
      if (!isValid) {
        return res.status(401).json({ error: 'Current password is incorrect' });
      }

      const hashedPassword = await bcrypt.hash(newPassword, 12);
      await tenantPool.query(
        `UPDATE users 
         SET encrypted_password = $1, failed_login_attempts = 0, locked_until = NULL
         WHERE id = $2`,
        [hashedPassword, userId]
      );
      updated = true;
    } else {
      return res.status(400).json({ error: 'Unable to determine user context for password change' });
    }

    if (updated) {
      // Audit log
      await auditLog({
        userId,
        userEmail: req.userEmail || null,
        userRole: req.userRole || null,
        tenantId: req.tenantId || null,
        action: 'password_change',
        resource: 'auth',
        description: 'User changed their password',
        status: 'success',
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
      }).catch(() => {});

      logInfo('[UserPrefs] Password changed', { userId, isSuperAdmin });
      return res.json({ success: true, message: 'Password changed successfully' });
    }

    return res.status(500).json({ error: 'Failed to update password' });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0].message });
    }
    logError('[UserPrefs] Password change error', error, { userId: req.userId });
    
    if (handleDatabaseError(error, res, 'Failed to change password')) {
      return;
    }
    
    return res.status(500).json({ error: 'Failed to change password' });
  }
});

export default router;
