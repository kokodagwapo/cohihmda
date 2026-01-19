/**
 * Audit Logger Service
 * SOC 2 Compliance: Comprehensive audit trail for all system actions
 */

import { pool } from '../config/database.js';
import { logError, logInfo } from './logger.js';

export interface AuditLogEntry {
  // Who
  userId?: string;
  userEmail?: string;
  userRole?: string;
  tenantId?: string | null;
  
  // What
  action: string;
  resource: string;
  resourceId?: string;
  
  // Details
  description?: string;
  changes?: Record<string, any>; // Before/after values
  metadata?: Record<string, any>;
  
  // Result
  status?: 'success' | 'failure' | 'error';
  errorMessage?: string;
  
  // Request Info
  ipAddress?: string;
  userAgent?: string;
  requestId?: string;
}

/**
 * Log an audit event
 */
export async function auditLog(entry: AuditLogEntry): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO public.audit_logs (
        user_id, user_email, user_role, tenant_id,
        action, resource, resource_id,
        description, changes, metadata,
        status, error_message,
        ip_address, user_agent, request_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
      [
        entry.userId || null,
        entry.userEmail || null,
        entry.userRole || null,
        entry.tenantId || null,
        entry.action,
        entry.resource,
        entry.resourceId || null,
        entry.description || null,
        entry.changes ? JSON.stringify(entry.changes) : null,
        entry.metadata ? JSON.stringify(entry.metadata) : null,
        entry.status || 'success',
        entry.errorMessage || null,
        entry.ipAddress || null,
        entry.userAgent || null,
        entry.requestId || null,
      ]
    );
  } catch (error) {
    // Don't throw - audit logging should never break the main flow
    logError('Audit log error', error, { action: entry.action, resource: entry.resource });
  }
}

/**
 * Log data access (for PII tracking)
 */
export async function logDataAccess(params: {
  userId: string;
  tenantId: string | null;
  resourceType: string;
  resourceId: string;
  action: 'view' | 'download' | 'export' | 'print';
  containsPII?: boolean;
  piiFields?: string[];
  purpose?: string;
  ipAddress?: string;
  userAgent?: string;
  metadata?: Record<string, any>;
}): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO public.data_access_logs (
        user_id, tenant_id,
        resource_type, resource_id, action,
        contains_pii, pii_fields,
        purpose, ip_address, user_agent, metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        params.userId,
        params.tenantId || null,
        params.resourceType,
        params.resourceId,
        params.action,
        params.containsPII || false,
        params.piiFields || null,
        params.purpose || null,
        params.ipAddress || null,
        params.userAgent || null,
        params.metadata ? JSON.stringify(params.metadata) : null,
      ]
    );
  } catch (error) {
    logError('Data access log error', error, { userId: params.userId, resourceType: params.resourceType });
  }
}

/**
 * Log failed login attempt
 */
export async function logFailedLogin(params: {
  email: string;
  ipAddress?: string;
  userAgent?: string;
  failureReason: 'invalid_password' | 'user_not_found' | 'account_locked' | 'rate_limited';
  metadata?: Record<string, any>;
}): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO public.failed_login_attempts (
        email, ip_address, user_agent, failure_reason, metadata
      ) VALUES ($1, $2, $3, $4, $5)`,
      [
        params.email,
        params.ipAddress || null,
        params.userAgent || null,
        params.failureReason,
        params.metadata ? JSON.stringify(params.metadata) : null,
      ]
    );
  } catch (error) {
    logError('Failed login log error', error, { email: params.email });
  }
}

/**
 * Create or update user session
 */
export async function createSession(params: {
  userId: string;
  tenantId: string | null;
  tokenHash: string;
  ipAddress?: string;
  userAgent?: string;
  expiresAt: Date;
}): Promise<string> {
  try {
    const result = await pool.query(
      `INSERT INTO public.user_sessions (
        user_id, tenant_id, token_hash, ip_address, user_agent, expires_at
      ) VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id`,
      [
        params.userId,
        params.tenantId || null,
        params.tokenHash,
        params.ipAddress || null,
        params.userAgent || null,
        params.expiresAt,
      ]
    );

    return result.rows[0].id;
  } catch (error) {
    // Don't throw - session creation should never break the main flow
    // If table doesn't exist or there's an error, log it but continue
    logError('Create session error', error, { userId: params.userId });
    // Return a dummy ID so the flow continues
    return 'session-error';
  }
}

/**
 * Update session activity
 */
export async function updateSessionActivity(tokenHash: string): Promise<void> {
  try {
    await pool.query(
      'UPDATE public.user_sessions SET last_activity_at = NOW() WHERE token_hash = $1 AND is_active = true',
      [tokenHash]
    );
  } catch (error) {
    logError('Update session activity error', error, { tokenHash: tokenHash.substring(0, 8) + '...' });
  }
}

/**
 * End user session
 */
export async function endSession(
  tokenHash: string,
  reason: 'manual' | 'timeout' | 'forced' | 'token_expired'
): Promise<void> {
  try {
    await pool.query(
      `UPDATE public.user_sessions 
       SET is_active = false, logout_at = NOW(), logout_reason = $2
       WHERE token_hash = $1 AND is_active = true`,
      [tokenHash, reason]
    );
  } catch (error) {
    logError('End session error', error, { reason });
  }
}

/**
 * Get recent failed login attempts for rate limiting
 */
export async function getRecentFailedLogins(
  email: string,
  withinMinutes: number = 15
): Promise<number> {
  try {
    const result = await pool.query(
      `SELECT COUNT(*) as count 
       FROM public.failed_login_attempts 
       WHERE email = $1 
       AND attempted_at > NOW() - INTERVAL '${withinMinutes} minutes'`,
      [email]
    );

    return parseInt(result.rows[0].count);
  } catch (error) {
    logError('Get failed logins error', error, { email });
    return 0;
  }
}

/**
 * Get audit logs for a user or tenant
 */
export async function getAuditLogs(params: {
  userId?: string;
  tenantId?: string;
  action?: string;
  resource?: string;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  offset?: number;
}): Promise<any[]> {
  try {
    let query = 'SELECT * FROM public.audit_logs WHERE 1=1';
    const values: any[] = [];
    let paramIndex = 1;

    if (params.userId) {
      query += ` AND user_id = $${paramIndex++}`;
      values.push(params.userId);
    }

    if (params.tenantId) {
      query += ` AND tenant_id = $${paramIndex++}`;
      values.push(params.tenantId);
    }

    if (params.action) {
      query += ` AND action = $${paramIndex++}`;
      values.push(params.action);
    }

    if (params.resource) {
      query += ` AND resource = $${paramIndex++}`;
      values.push(params.resource);
    }

    if (params.startDate) {
      query += ` AND timestamp >= $${paramIndex++}`;
      values.push(params.startDate);
    }

    if (params.endDate) {
      query += ` AND timestamp <= $${paramIndex++}`;
      values.push(params.endDate);
    }

    query += ' ORDER BY timestamp DESC';

    if (params.limit) {
      query += ` LIMIT $${paramIndex++}`;
      values.push(params.limit);
    }

    if (params.offset) {
      query += ` OFFSET $${paramIndex++}`;
      values.push(params.offset);
    }

    const result = await pool.query(query, values);
    return result.rows;
  } catch (error) {
    logError('Get audit logs error', error, { userId: params.userId, tenantId: params.tenantId });
    return [];
  }
}

/**
 * Get data access logs (for PII compliance)
 */
export async function getDataAccessLogs(params: {
  userId?: string;
  tenantId?: string;
  resourceType?: string;
  containsPII?: boolean;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
}): Promise<any[]> {
  try {
    let query = 'SELECT * FROM public.data_access_logs WHERE 1=1';
    const values: any[] = [];
    let paramIndex = 1;

    if (params.userId) {
      query += ` AND user_id = $${paramIndex++}`;
      values.push(params.userId);
    }

    if (params.tenantId) {
      query += ` AND tenant_id = $${paramIndex++}`;
      values.push(params.tenantId);
    }

    if (params.resourceType) {
      query += ` AND resource_type = $${paramIndex++}`;
      values.push(params.resourceType);
    }

    if (params.containsPII !== undefined) {
      query += ` AND contains_pii = $${paramIndex++}`;
      values.push(params.containsPII);
    }

    if (params.startDate) {
      query += ` AND accessed_at >= $${paramIndex++}`;
      values.push(params.startDate);
    }

    if (params.endDate) {
      query += ` AND accessed_at <= $${paramIndex++}`;
      values.push(params.endDate);
    }

    query += ' ORDER BY accessed_at DESC';

    if (params.limit) {
      query += ` LIMIT $${paramIndex++}`;
      values.push(params.limit);
    }

    const result = await pool.query(query, values);
    return result.rows;
  } catch (error) {
    logError('Get data access logs error', error, { userId: params.userId, tenantId: params.tenantId });
    return [];
  }
}

/**
 * Clean up old logs (run periodically)
 */
export async function cleanupOldLogs(): Promise<void> {
  try {
    // Clean up audit logs older than 2 years
    await pool.query('SELECT cleanup_old_audit_logs()');
    
    // Clean up expired sessions
    await pool.query('SELECT cleanup_expired_sessions()');
    
    // Clean up old failed login attempts
    await pool.query('SELECT cleanup_old_failed_logins()');
    
    logInfo('Log cleanup completed');
  } catch (error) {
    logError('Log cleanup error', error, {});
  }
}
